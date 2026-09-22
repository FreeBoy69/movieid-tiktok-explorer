// Self-contained Postgres migrator that runs INSIDE a LingCode container-compute
// job. It has LINGCODE_DB_URL in the environment (a real, role-scoped Postgres
// connection with FULL SQL and no gateway caps), and pulls a gzipped pg_dump
// (--inserts format) from a temporary HTTPS URL, gunzips it, and replays it.
//
//   node job-import.mjs <dumpUrl> [--truncate]
//
// --truncate: TRUNCATE every target table first, then replay data. This is the
// only reliable way to get an exact match after a partial/duplicate prior import.
// Without it, the job appends and will produce duplicate keys.
import zlib from "node:zlib";
import pg from "pg";

const [dumpUrl, ...rest] = process.argv.slice(2);
const truncate = rest.includes("--truncate");
if (!dumpUrl || !process.env.LINGCODE_DB_URL) {
  console.error("usage: node job-import.mjs <dumpUrl> [--truncate]");
  process.exit(2);
}

const client = new pg.Client({ connectionString: process.env.LINGCODE_DB_URL });
await client.connect();

const log = (...a) => console.log(new Date().toISOString(), ...a);

// download + gunzip
log("fetching", dumpUrl);
const res = await fetch(dumpUrl);
if (!res.ok) { log("fetch failed", res.status); process.exit(1); }
const gzBuf = Buffer.from(await res.arrayBuffer());
log("downloaded", (gzBuf.length / 1e6).toFixed(1), "MB gzipped");
const sql = zlib.gunzipSync(gzBuf).toString("utf8");
log("gunzipped to", (sql.length / 1e6).toFixed(1), "MB SQL");

// Split on a semicolon that terminates a statement (pg_dump --inserts emits an
// INSERT statement per row-group, each ending with ");\n"). We scan char-by-char
// to only treat a ";" as a terminator when we're outside a single-quoted literal
// ('' is an escaped quote; standard_conforming_strings means no backslash escapes).
function splitStatements(text) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const stmts = [];
  let cur = [];
  for (const line of lines) {
    cur.push(line);
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === "'") {
        if (q && line[i + 1] === "'") { i++; continue; }
        q = !q;
      }
    }
    if (!q && line.trimEnd().endsWith(";")) {
      const stmt = cur.join("\n").trim();
      if (stmt) stmts.push(stmt);
      cur = [];
    }
  }
  if (cur.some((l) => l.trim())) stmts.push(cur.join("\n").trim());
  return stmts;
}

const statements = splitStatements(sql);
log("statements:", statements.length);

// We only ever replay INSERT statements; the schema was applied via apply_migration,
// so every CREATE/ALTER/DROP/GRANT in the dump is ignored.
// pg_dump precedes each table's data with a "-- Data for Name: <t>" comment block,
// so the statement text starts with comment lines. Slice from the first line-anchored
// INSERT INTO (the `m` flag is essential — `^` alone only matches position 0).
const stripComments = (s) => {
  const m = s.match(/^INSERT INTO /m);
  return m ? s.slice(m.index) : s.trimStart();
};

// Fix schema qualification. The source carries stale legacy auth_users/auth_sessions
// tables that are strict subsets of app_users/app_sessions; those are dropped entirely
// (their IDs already live in the app_* tables), so we skip their INSERTs rather than
// rename them. LingCode owns auth_users/auth_sessions anyway.
const DROP_TABLES = new Set(["auth_users", "auth_sessions"]);
const rewrite = (s) => s.replace(/\bpublic\./g, "");

// Discover INSERT target tables (in statement order) so we can truncate them.
const insertTables = [];
const insertStmts = [];
for (const s of statements) {
  let q = rewrite(s);
  const cleaned = stripComments(q);
  const m = cleaned.match(/^INSERT INTO\s+([a-zA-Z_][a-zA-Z0-9_]*)/);
  if (m) {
    const tbl = m[1];
    if (DROP_TABLES.has(tbl)) continue; // legacy subset, dropped
    if (!insertTables.includes(tbl)) insertTables.push(tbl);
    insertStmts.push({ tbl, q: cleaned });
  }
}
log("insert statements:", insertStmts.length, "across", insertTables.length, "tables");

// TARGET TABLES we expect (mirrors the applied schema). only truncate those that
// exist so we don't error on a missing table.
// The tenant role owns its rows but not the tables, so TRUNCATE is denied; DELETE
// is granted. Try TRUNCATE first (far cheaper) and fall back to DELETE, and abort
// if neither works — silently importing on top of existing rows duplicates data.
if (truncate) {
  log("clearing", insertTables.length, "tables");
  for (const tbl of insertTables) {
    try {
      await client.query(`TRUNCATE TABLE ${tbl} CASCADE`);
    } catch {
      const { rowCount } = await client.query(`DELETE FROM ${tbl}`);
      log("cleared", tbl, "via DELETE,", rowCount, "rows removed");
    }
  }
  log("clear done");
}

let done = 0, failed = 0;
const failures = [];
const t0 = Date.now();
for (let i = 0; i < insertStmts.length; i++) {
  const { tbl, q } = insertStmts[i];
  try {
    await client.query(q);
    done++;
  } catch (err) {
    // A single bad statement must not abort; record precisely and continue.
    failed++;
    if (failures.length < 50) failures.push(`${tbl}: ${String(err.message || err).slice(0, 160)}`);
  }
  if (done % 200 === 0) {
    log(`progress ${done}/${insertStmts.length} inserts, ${((Date.now() - t0) / 1000).toFixed(0)}s, ${failed} failed`);
  }
}

log("done:", done, "executed,", failed, "failed,", ((Date.now() - t0) / 60000).toFixed(1), "min");
if (failures.length) {
  log("--- failures (first " + failures.length + ") ---");
  for (const f of failures) log("  " + f);
}
await client.end();
