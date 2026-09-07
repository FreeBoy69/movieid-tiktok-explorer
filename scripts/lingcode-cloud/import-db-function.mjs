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
  const head = stmt.replace(/^(?:\s*--[^\n]*(\n|$))+/, "");
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

/* ---------- batching ---------- */

function buildBatches(list) {
  const batches = [];
  let batch = [];
  let size = 0;
  let maxGz = 0;
  const flush = () => {
    if (!batch.length) return;
    let payload = batch;
    // shrink until the gzipped envelope fits under the wire cap
    while (payload.length) {
      const gz = zlib.gzipSync(Buffer.from(JSON.stringify(payload), "utf8"), { level: 6 });
      if (gz.length <= BATCH_GZ_CAP) { batches.push(gz); maxGz = Math.max(maxGz, gz.length); return; }
      if (payload.length === 1) throw new Error(`single statement too large after gzip (${payload[0].length} raw bytes -> ${gz.length} gz): ${payload[0].slice(0, 120)}`);
      payload = payload.slice(0, Math.ceil(payload.length / 2));
    }
  };
  for (const stmt of list) {
    // strip leading comment/blank lines; skip if nothing executable remains
    const executable = stmt.replace(/^(\s*--[^\n]*(\n|$))+/, "").trim();
    if (!executable) continue;
    if (size + stmt.length > BATCH_RAW_CAP && batch.length) flush(), (batch = []), (size = 0);
    batch.push(stmt);
    size += stmt.length + 2;
    if (stmt.length > BATCH_RAW_CAP) flush(), (batch = []), (size = 0); // oversized travels alone
  }
  flush();
  buildBatches.maxGz = maxGz;
  return batches;
}

const plan = [
  { name: "pre-DDL", batches: buildBatches(phases.pre), concurrency: 1 },
  { name: "data", batches: buildBatches(phases.data), concurrency: DATA_CONCURRENCY },
  { name: "post-DDL", batches: buildBatches(phases.post), concurrency: 1 },
];

console.log(`statements=${statements.length} kept=${kept.length} final=${finalStatements.length}`);
console.log(`auth: dropped=${droppedAuth} refsRenamed=${renamedRefs}; inserts split into ${splitInserts} chunks; oversized singles=${oversizedRows}`);
console.log(`batches: ${plan.map((p) => `${p.name}=${p.batches.length}`).join(" ")} maxGz=${(buildBatches.maxGz / 1024).toFixed(0)}KB`);

if (args["emit-ddl"]) {
  const dir = args["emit-ddl"];
  fs.mkdirSync(dir, { recursive: true });
  // permissive policies: server.js enforces its own authz; the platform force-enables RLS
  const tables = [...new Set(phases.pre.map((s) => { const m = s.match(/CREATE TABLE (\w+)/); return m && m[1]; }).filter(Boolean))];
  const policies = tables.map((t) => `CREATE POLICY app_all ON ${t} FOR ALL USING (true) WITH CHECK (true);`).join("\n");
  fs.writeFileSync(`${dir}/pre.sql`, phases.pre.join("\n") + "\n" + policies + "\n");
  fs.writeFileSync(`${dir}/post.sql`, phases.post.join("\n") + "\n");
  console.log(`ddl written: ${dir}/pre.sql (${tables.length} tables + policies), ${dir}/post.sql`);
}
if (dryRun) process.exit(0);

/* ---------- execution ---------- */

const endpoint = `${baseUrl}/functions/db-import`;
let done = 0;
const total = plan.reduce((n, p) => n + p.batches.length, 0);
const started = Date.now();

async function sendBatch(gz, label) {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { authorization: `Bearer ${anon}`, "content-type": "application/json" },
    body: JSON.stringify({ input: { token, gz: gz.toString("base64") } }),
  }).catch((err) => ({ ok: false, status: 0, text: async () => String(err) }));
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { ok: false, error: text.slice(0, 300) }; }
  const inner = body && typeof body === "object" && "data" in body ? body.data : body;
  const innerFailed = inner && typeof inner === "object" && inner.ok === false;
  if (!res.ok || body.ok === false || innerFailed) {
    const detail = innerFailed ? `${inner.error} (statement index ${inner.index} in batch)` : JSON.stringify(body).slice(0, 300);
    throw new Error(`${label} failed (HTTP ${res.status}): ${detail}`);
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
    for (let i = 0; i < phase.batches.length; i++) await sendBatch(phase.batches[i], label(i));
  } else {
    let cursor = 0;
    const workers = Array.from({ length: phase.concurrency }, async () => {
      while (cursor < phase.batches.length) {
        const i = cursor++;
        await sendBatch(phase.batches[i], label(i));
      }
    });
    await Promise.all(workers);
  }
  console.log(`phase ${phase.name} done`);
}
console.log(`import complete in ${((Date.now() - started) / 60000).toFixed(1)}min`);
