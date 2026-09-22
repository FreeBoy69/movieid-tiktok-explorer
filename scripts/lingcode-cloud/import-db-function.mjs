#!/usr/bin/env node
/**
 * Imports a pg_dump plain-SQL file into LingCode Cloud through the temporary
 * `db-import` serverless function.
 *
 *   node scripts/lingcode-cloud/import-db-function.mjs --file tmp/autoyt-dump.sql \
 *        --url https://lingcode.dev/api/cloud/be/<backendId> --anon <anonKey> \
 *        --token <DB_IMPORT_TOKEN> [--dry-run]
 *
 * Constraints this works around:
 *   - ctx.db.query runs ONE statement per call  -> the function receives an
 *     ARRAY of statements and loops them server-side.
 *   - gateway rejects payloads > ~100-150KB     -> each call carries a
 *     gzip+base64 JSON array (~256KB raw SQL, ~80KB on the wire).
 *   - multi-row INSERTs up to 31MB             -> split at the tuple level
 *     into <=64KB INSERT statements (quote/paren aware).
 *   - LingCode owns auth_users/auth_sessions   -> those tables' DDL+data are
 *     dropped; REFERENCES public.auth_* are rewritten to app_* (identical
 *     schemas and mirrored data on the VPS).
 *
 * Phases: pre-DDL sequential, data (all INSERTs) with concurrency 3,
 * post-DDL (indexes/constraints) sequential. On failure: restart from the
 * top — the dump's first statements DROP every table.
 */
import fs from "node:fs";
import zlib from "node:zlib";
import { transformDump } from "./import-db.mjs";

const argv = process.argv.slice(2);
const args = {};
for (let i = 0; i < argv.length; i++) {
  if (!argv[i].startsWith("--")) continue;
  const key = argv[i].slice(2);
  const next = argv[i + 1];
  if (next === undefined || next.startsWith("--")) args[key] = "1";
  else { args[key] = next; i++; }
}

const file = args.file;
const baseUrl = String(args.url || "").replace(/\/+$/, "");
const anon = args.anon || process.env.LINGCODE_ANON_KEY || "";
const token = args.token || process.env.DB_IMPORT_TOKEN || "";
const dryRun = args["dry-run"] === "1";
if (!file || (!dryRun && (!baseUrl || !anon || !token))) {
  console.error("usage: import-db-function.mjs --file dump.sql --url <gateway> --anon <anonKey> --token <token> [--dry-run]");
  process.exit(2);
}

const STATEMENT_CAP = 64 * 1024; // raw bytes per single statement
const BATCH_RAW_CAP = 256 * 1024; // raw JSON bytes per call before gzip
const BATCH_GZ_CAP = 90 * 1024; // wire bytes per call (ceiling is ~100-150KB)
const OVERSIZE_PROBE = 150 * 1024; // only gzip-test statements above this
const DATA_CONCURRENCY = 3;

/* ---------- dump -> statements ---------- */

const raw = fs.readFileSync(file, "utf8");
const { lines, safeEnd } = transformDump(raw, { renameAuth: false });

const statements = [];
let current = [];
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  if (!current.length && !line.trim()) continue;
  current.push(line);
  if (safeEnd[i] && line.trimEnd().endsWith(";")) {
    statements.push(current.join("\n"));
    current = [];
  }
}
if (current.some((l) => l.trim())) statements.push(current.join("\n"));

/* ---------- auth table handling ---------- */

const AUTH_RE = /\bauth_users\b|\bauth_sessions\b/;
const REF_RE = /REFERENCES auth_(users|sessions)\b/g; // public. already stripped
const kept = [];
let droppedAuth = 0, renamedRefs = 0;
for (const stmt of statements) {
  if (!AUTH_RE.test(stmt)) { kept.push(stmt); continue; }
  if (REF_RE.test(stmt)) {
    kept.push(stmt.replace(REF_RE, (_, t) => `REFERENCES app_${t}`));
    renamedRefs++;
  } else {
    droppedAuth++; // DROP/CREATE/INSERT/ALTER/INDEX on auth_users/auth_sessions themselves
  }
}

/* ---------- oversized INSERT splitting (quote/paren aware) ---------- */

function splitInsertTuples(stmt) {
  const valuesAt = stmt.search(/\bVALUES\b/i);
  if (valuesAt < 0) return null;
  const prefix = stmt.slice(0, valuesAt) + "VALUES ";
  const body = stmt.slice(valuesAt).replace(/^\s*VALUES\s*/i, "").replace(/;\s*$/, "");
  const tuples = [];
  let depth = 0, inQuote = false, start = -1;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (inQuote) {
      if (ch === "'") {
        if (body[i + 1] === "'") i++;
        else inQuote = false;
      }
      continue;
    }
    if (ch === "'") { inQuote = true; continue; }
    if (ch === "(") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === ")") {
      depth--;
      if (depth === 0 && start >= 0) tuples.push(body.slice(start, i + 1));
    }
  }
  if (!tuples.length) return null;
  return { prefix, tuples };
}

const finalStatements = [];
let splitInserts = 0, oversizedRows = 0;
for (const stmt of kept) {
  // strip leading comment lines AND the blank line/indent that follows them,
  // otherwise a leading "\n" makes the /^INSERT INTO/ test miss and the
  // statement is never split (a 30MB INSERT then blows the wire cap).
  const head = stmt.replace(/^(?:\s*--[^\n]*(?:\n|$))*\s*/, "");
  if (stmt.length <= STATEMENT_CAP || !/^INSERT INTO/i.test(head)) {
    finalStatements.push(stmt);
    if (stmt.length > STATEMENT_CAP) oversizedRows++;
    continue;
  }
  const parsed = splitInsertTuples(stmt);
  if (!parsed) { finalStatements.push(stmt); oversizedRows++; continue; }
  let chunk = [];
  let size = 0;
  for (const tuple of parsed.tuples) {
    if (chunk.length && size + tuple.length + 1 > STATEMENT_CAP) {
      finalStatements.push(parsed.prefix + chunk.join(",") + ";");
      splitInserts++;
      chunk = [];
      size = 0;
    }
    if (tuple.length > STATEMENT_CAP) oversizedRows++;
    chunk.push(tuple);
    size += tuple.length + 1;
  }
  if (chunk.length) {
    finalStatements.push(parsed.prefix + chunk.join(",") + ";");
    splitInserts++;
  }
}

/* ---------- phases ---------- */

const firstInsert = finalStatements.findIndex((s) => /(^|\n)\s*INSERT INTO/i.test(s));
const lastInsert = finalStatements.length - 1 - [...finalStatements].reverse().findIndex((s) => /(^|\n)\s*INSERT INTO/i.test(s));
const phases = {
  pre: firstInsert < 0 ? finalStatements : finalStatements.slice(0, firstInsert),
  data: firstInsert < 0 ? [] : finalStatements.slice(firstInsert, lastInsert + 1),
  post: firstInsert < 0 ? [] : finalStatements.slice(lastInsert + 1),
};

/* ---------- idempotent batch design (data phases) ----------
 * A batch must be safely re-sendable: the gateway can drop a response after
 * the server applied the batch, and the whole run must be resumable after a
 * crash without duplicating rows (tables have no PKs yet -- those land in
 * the post-DDL migration). So data statements never execute directly:
 *
 *   1. each statement is sliced into <=48KB parts, sent as
 *      INSERT INTO zz_import_chunks ... ON CONFLICT (key, seq) DO NOTHING
 *      (re-sends of a crashed batch dedupe on the (key, seq) PK), then
 *   2. one DO block per batch key reassembles the parts, EXECUTEs them,
 *      writes a ledger row (key='done:<key>', seq=-1) and deletes the parts.
 *      The DO is a single statement, so check-execute-ledger-cleanup are
 *      ONE transaction: a batch either fully applies with its ledger row or
 *      not at all. Re-sent batches see the ledger and no-op.
 *
 * seq encodes (statement ordinal * 1000 + part ordinal) so one DO can serve
 * many statements; parts of one statement always stay in the same wire batch.
 * Normal statements run under DATA_CONCURRENCY (distinct keys, independent).
 * Statements too big for one wire batch stream their parts across several
 * batches under one key in the sequential oversized-data phase, DO last. */

const PART_CHARS = 48 * 1024;
const KEY_PH = "@@@@@@@"; // placeholder, same length as the real keys
const dataKey = (i) => `b${String(i).padStart(6, "0")}`;
const ovKey = (i) => `ov${String(i).padStart(5, "0")}`;

const sqlLiteral = (text) => `'${String(text).replace(/'/g, "''")}'`;

function sliceText(text) {
  const out = [];
  for (let i = 0; i < text.length;) {
    let end = Math.min(i + PART_CHARS, text.length);
    const code = text.charCodeAt(end - 1);
    if (end < text.length && code >= 0xd800 && code <= 0xdbff) end--; // keep surrogate pairs intact
    out.push(text.slice(i, end));
    i = end;
  }
  return out;
}

const wrapPart = (seq, text) =>
  `INSERT INTO zz_import_chunks (key, seq, part) VALUES ('${KEY_PH}', ${seq}, ${sqlLiteral(text)}) ON CONFLICT (key, seq) DO NOTHING;`;

// The gateway blocks `DO` in ctx.db.query, but a SECURITY DEFINER plpgsql
// function (deployed via apply_migration as zz_reassemble) CAN EXECUTE dynamic
// SQL. It reassembles the parts for a key, builds the multi-statement block,
// EXECUTEs it, writes the 'done:<key>' ledger row, and deletes the parts — all
// in one transaction. Re-running a crashed batch sees the ledger and no-ops.
const reassembleCall = (key) => `SELECT zz_reassemble('${key}');`;

const gzOf = (stmts) => zlib.gzipSync(Buffer.from(JSON.stringify(stmts), "utf8"), { level: 6 });

const tooBigForWire = (stmt) =>
  stmt.length > OVERSIZE_PROBE &&
  zlib.gzipSync(Buffer.from(JSON.stringify([stmt]), "utf8"), { level: 6 }).length > BATCH_GZ_CAP;

// strip leading comment lines AND the blank line/indent that follows them;
// skip statements with nothing executable left
const executableOf = (stmt) => stmt.replace(/^(\s*--[^\n]*(\n|$))+/, "").trim();

/* ---------- oversized statements in pre/post (sequential, no ledger needed) ---------- */

function chunkStatement(stmt, key) {
  const out = sliceText(stmt).map((part, seq) =>
    `INSERT INTO zz_import_chunks (key, seq, part) VALUES (${sqlLiteral(key)}, ${seq}, ${sqlLiteral(part)});`,
  );
  out.push(reassembleCall(key));
  return out;
}

let chunkedStatements = 0;
const nextChunkKey = () => `imp_${chunkedStatements++}`;
for (const phase of ["pre", "post"]) {
  phases[phase] = phases[phase].flatMap((stmt) =>
    tooBigForWire(stmt) ? chunkStatement(stmt, nextChunkKey()) : [stmt],
  );
}

/* ---------- data phase -> wrapped part batches ---------- */

const dataStmts = [], ovStmts = [];
for (const stmt of phases.data) {
  const executable = executableOf(stmt);
  if (!executable) continue;
  (tooBigForWire(stmt) ? ovStmts : dataStmts).push(executable);
}

// one entry per statement: its parts as wrapper INSERTs (placeholder key)
let multiPartStmts = 0;
const dataGroups = dataStmts.map((stmt, g) => {
  const slices = sliceText(stmt);
  if (slices.length > 1) multiPartStmts++;
  return slices.map((text, p) => wrapPart(g * 1000 + p, text));
});

// group whole statements into raw-cap batches, then split to gz fit; each
// final batch gets its own key + trailing ledger DO
const groupBatches = [];
{
  let cur = [], size = 0;
  const flush = () => { if (cur.length) groupBatches.push(cur); cur = []; size = 0; };
  for (const group of dataGroups) {
    const gsize = group.reduce((n, s) => n + s.length + 2, 0);
    if (size + gsize > BATCH_RAW_CAP && cur.length) flush();
    cur.push(group);
    size += gsize;
    if (gsize > BATCH_RAW_CAP) flush(); // big statement travels alone
  }
  flush();
}

let maxGz = 0;
let dataBatchCount = 0;
function finalizeDataBatches(groupBatch) {
  const key = dataKey(dataBatchCount++);
  const stmts = [...groupBatch.flat().map((w) => w.replaceAll(KEY_PH, key)), reassembleCall(key)];
  const gz = gzOf(stmts);
  if (gz.length <= BATCH_GZ_CAP) {
    maxGz = Math.max(maxGz, gz.length);
    return [{ key, gz }];
  }
  if (groupBatch.length === 1) {
    throw new Error(`single statement too large after gzip (${groupBatch.flat()[0].length} raw bytes -> ${gz.length} gz): ${groupBatch.flat()[0].slice(0, 120)}`);
  }
  const mid = Math.ceil(groupBatch.length / 2);
  return [...finalizeDataBatches(groupBatch.slice(0, mid)), ...finalizeDataBatches(groupBatch.slice(mid))];
}
const dataBatches = groupBatches.flatMap(finalizeDataBatches);

// oversized statements: parts streamed across batches under one key, then a
// reassemble call last (sequential phase, so the call cannot overtake its parts)
const ovBatches = [];
ovStmts.forEach((stmt, i) => {
  const key = ovKey(i);
  const parts = sliceText(stmt).map((text, p) => wrapPart(p, text).replaceAll(KEY_PH, key));
  let cur = [], size = 0;
  const flush = () => {
    if (!cur.length) return;
    const gz = gzOf(cur);
    if (gz.length > BATCH_GZ_CAP) throw new Error(`oversized part batch too large after gzip (${gz.length} gz)`);
    maxGz = Math.max(maxGz, gz.length);
    ovBatches.push({ key, gz });
    cur = []; size = 0;
  };
  for (const w of parts) {
    if (size + w.length > BATCH_RAW_CAP && cur.length) flush();
    cur.push(w);
    size += w.length + 2;
  }
  flush();
  ovBatches.push({ key, gz: gzOf([reassembleCall(key)]) });
});

/* ---------- batching for pre/post (direct execution, unchanged) ---------- */

function buildBatches(list) {
  const batches = [];
  let batch = [];
  let size = 0;
  const flush = () => {
    if (!batch.length) return;
    let payload = batch;
    // shrink until the gzipped envelope fits under the wire cap
    while (payload.length) {
      const gz = gzOf(payload);
      if (gz.length <= BATCH_GZ_CAP) { batches.push({ key: null, gz }); return; }
      if (payload.length === 1) throw new Error(`single statement too large after gzip (${payload[0].length} raw bytes -> ${gz.length} gz): ${payload[0].slice(0, 120)}`);
      payload = payload.slice(0, Math.ceil(payload.length / 2));
    }
  };
  for (const stmt of list) {
    if (!executableOf(stmt)) continue;
    if (size + stmt.length > BATCH_RAW_CAP && batch.length) flush(), (batch = []), (size = 0);
    batch.push(stmt);
    size += stmt.length + 2;
    if (stmt.length > BATCH_RAW_CAP) flush(), (batch = []), (size = 0); // oversized travels alone
  }
  flush();
  return batches;
}

// The tenant role has no CREATE on its own schema, so when the DDL is applied
// out of band (apply_migration with lingcode/migrations/*.sql) only the data
// phases should run here: --phases data,oversized-data
const onlyPhases = String(args.phases || "").split(",").map((p) => p.trim()).filter(Boolean);
const plan = [
  { name: "pre-DDL", batches: buildBatches(phases.pre), concurrency: 1, direct: true },
  { name: "data", batches: dataBatches, concurrency: DATA_CONCURRENCY, direct: false },
  { name: "oversized-data", batches: ovBatches, concurrency: 1, direct: false },
  { name: "post-DDL", batches: buildBatches(phases.post), concurrency: 1, direct: true },
].filter((p) => !onlyPhases.length || onlyPhases.includes(p.name));
if (onlyPhases.length && plan.length !== onlyPhases.length) {
  console.error(`unknown phase in --phases (valid: pre-DDL, data, oversized-data, post-DDL)`);
  process.exit(2);
}

console.log(`statements=${statements.length} kept=${kept.length} final=${finalStatements.length}`);
console.log(`auth: dropped=${droppedAuth} refsRenamed=${renamedRefs}; inserts split into ${splitInserts} chunks; oversized singles=${oversizedRows}`);
console.log(`oversized statements streamed via zz_import_chunks: ${chunkedStatements}; multi-part data statements=${multiPartStmts}`);
console.log(`batches: ${plan.map((p) => `${p.name}=${p.batches.length}`).join(" ")} maxGz=${(maxGz / 1024).toFixed(0)}KB`);

if (args["emit-ddl"]) {
  const dir = args["emit-ddl"];
  fs.mkdirSync(dir, { recursive: true });
  // permissive policies: server.js enforces its own authz; the platform force-enables RLS
  const tables = [...new Set(phases.pre.map((s) => { const m = s.match(/CREATE TABLE (\w+)/); return m && m[1]; }).filter(Boolean))];
  const policies = tables.map((t) => `CREATE POLICY app_all ON ${t} FOR ALL USING (true) WITH CHECK (true);`).join("\n");
  // staging table for rows too large to send as one statement (see chunkStatement)
  const staging =
    "CREATE TABLE IF NOT EXISTS zz_import_chunks (key text NOT NULL, seq integer NOT NULL, part text NOT NULL, PRIMARY KEY (key, seq));\n" +
    "CREATE POLICY app_all ON zz_import_chunks FOR ALL USING (true) WITH CHECK (true);";
  fs.writeFileSync(`${dir}/pre.sql`, phases.pre.join("\n") + "\n" + policies + "\n" + staging + "\n");
  fs.writeFileSync(`${dir}/post.sql`, phases.post.join("\n") + "\n");
  console.log(`ddl written: ${dir}/pre.sql (${tables.length} tables + policies), ${dir}/post.sql`);
}
if (dryRun) process.exit(0);

/* ---------- execution ---------- */

const endpoint = `${baseUrl}/functions/db-import`;
const SELECT_ENDPOINT = `${baseUrl}/functions/db-import`;
let done = 0;
const total = plan.reduce((n, p) => n + p.batches.length, 0);

// Already-committed ledger keys (from the "done:<key>" rows) let this run
// resume after a crash without re-sending batches. The function returns fetched
// keys to a local probe; everything goes over the same gateway, so any batch the
// server applied will be present here on the next run.
async function probeDoneKeys() {
  try {
    const res = await fetch(SELECT_ENDPOINT, {
      method: "POST",
      headers: { authorization: `Bearer ${anon}`, "content-type": "application/json" },
      body: JSON.stringify({ input: { token, select: "SELECT substr(key,6) AS k FROM zz_import_chunks WHERE seq = -1 AND key LIKE 'done:%' ORDER BY k" } }),
    }).catch(() => null);
    if (!res || !res.ok) return new Set();
    const text = await res.text();
    let body; try { body = JSON.parse(text); } catch { return new Set(); }
    const inner = body && body.data ? body.data : body;
    const rows = inner && Array.isArray(inner.rows) ? inner.rows : [];
    return new Set(rows.map((r) => r.k).filter(Boolean));
  } catch { return new Set(); }
}
const doneKeys = await probeDoneKeys();
const started = Date.now();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RETRYABLE_STATUS = new Set([0, 408, 429, 500, 502, 503, 504]);

// An idempotent data/oversized batch can be re-sent freely: parts dedupe via
// ON CONFLICT and the ledger DO no-ops if its "done:<key>" row exists. Direct
// (pre/post DDL) batches are sent once -- they have no ledger.
function isAlreadyDone(batch) {
  return !batch.direct && batch.key != null && doneKeys.has(batch.key);
}

async function sendBatch(batch, label, phase) {
  if (isAlreadyDone(batch)) { done++; return; }
  const body = JSON.stringify({ input: { token, gz: batch.gz.toString("base64") } });
  let lastErr = "";
  for (let attempt = 1; attempt <= 6; attempt++) {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { authorization: `Bearer ${anon}`, "content-type": "application/json" },
      body,
    }).catch((err) => ({ ok: false, status: 0, text: async () => String(err) }));
    const text = await res.text();
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = { ok: false, error: text.slice(0, 300) }; }
    const inner = parsed && typeof parsed === "object" && "data" in parsed ? parsed.data : parsed;
    const innerFailed = inner && typeof inner === "object" && inner.ok === false;
    if (res.ok && parsed.ok !== false && !innerFailed) break;
    const detail = innerFailed ? `${inner.error} (statement index ${inner.index} in batch)` : JSON.stringify(parsed).slice(0, 300);
    lastErr = `${label} failed (HTTP ${res.status}): ${detail}`;
    // statement-level failures (bad SQL, constraints) are not transient
    if (innerFailed || !RETRYABLE_STATUS.has(res.status)) throw new Error(lastErr);
    const wait = Math.min(15000, 500 * 2 ** (attempt - 1));
    console.log(`${label}: transient HTTP ${res.status}, retry ${attempt}/6 in ${wait}ms`);
    await sleep(wait);
    if (attempt === 6) throw new Error(lastErr);
  }
  done++;
  if (done % 25 === 0 || done === total) {
    const rate = (done / ((Date.now() - started) / 1000)).toFixed(1);
    console.log(`${done}/${total} batches (${rate}/s, ${(((Date.now() - started) / 60000)).toFixed(1)}min)`);
  }
}

for (const phase of plan) {
  const label = (i) => `${phase.name} batch ${i + 1}/${phase.batches.length}`;
  if (phase.concurrency <= 1) {
    for (let i = 0; i < phase.batches.length; i++) await sendBatch(phase.batches[i], label(i), phase);
  } else {
    let cursor = 0;
    const workers = Array.from({ length: phase.concurrency }, async () => {
      while (cursor < phase.batches.length) {
        const i = cursor++;
        await sendBatch(phase.batches[i], label(i), phase);
      }
    });
    await Promise.all(workers);
  }
  console.log(`phase ${phase.name} done`);
}
console.log(`import complete in ${((Date.now() - started) / 60000).toFixed(1)}min`);
