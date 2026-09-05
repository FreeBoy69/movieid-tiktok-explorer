#!/usr/bin/env node
/**
 * Streams a pg_dump plain-SQL file into the hosted app's /api/admin/db-import endpoint.
 *
 *   node scripts/lingcode-cloud/import-db.mjs --file tmp/autoyt-vps.sql \
 *        --url https://autoyt.apps.lingcode.app --token "$DB_IMPORT_TOKEN" [--dry-run]
 *
 * Transforms applied to the dump so it fits the LingCode Cloud tenant schema:
 *   - drops search_path resets, schema DDL, psql meta-commands and newer SET options
 *   - strips the "public." qualifier (the tenant role's default search_path is its own schema)
 *   - renames auth_users/auth_sessions to app_users/app_sessions (LingCode owns auth_users)
 * Rewrites only touch SQL outside single-quoted literals, so stored data is never altered.
 * Each batch runs as one implicit transaction; the first batch drops and recreates tables,
 * so re-run the whole import from the start if a batch fails.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DROP_STATEMENT = [
  /^SELECT pg_catalog\.set_config\('search_path'/,
  /^\\/, // \restrict, \unrestrict, \connect ...
  /^(CREATE|DROP|ALTER|COMMENT ON) SCHEMA\b/,
  /^SET (transaction_timeout|idle_in_transaction_session_timeout)\b/,
];
const STATEMENT_START = /^(--|SET |SELECT |CREATE |DROP |ALTER |INSERT |COPY |GRANT |REVOKE |DO )/;

function rewriteSql(segment) {
  return segment
    .replace(/\bpublic\./g, "")
    .replace(/\bauth_users/g, "app_users")
    .replace(/\bauth_sessions/g, "app_sessions");
}

/**
 * Returns { lines, safeEnd } where safeEnd[i] is true when line i ends outside a string literal.
 * Standard-conforming strings only ('' escapes a quote), which is what pg_dump emits.
 */
export function transformDump(text) {
  const source = text.replace(/\r\n?/g, "\n");
  const lines = [];
  const safeEnd = [];
  let inQuote = false;
  let lineStartsOutside = true;
  let line = "";
  let segment = "";
  const flushSegment = () => {
    line += rewriteSql(segment);
    segment = "";
  };
  const pushLine = () => {
    const keep = !(lineStartsOutside && DROP_STATEMENT.some((re) => re.test(line)));
    if (keep) {
      lines.push(line);
      safeEnd.push(!inQuote);
    }
    lineStartsOutside = !inQuote;
    line = "";
  };
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (inQuote) {
      if (ch === "'") {
        if (source[i + 1] === "'") {
          line += "''";
          i++;
        } else {
          inQuote = false;
          line += "'";
        }
      } else if (ch === "\n") {
        pushLine();
      } else {
        line += ch;
      }
      continue;
    }
    if (ch === "'") {
      flushSegment();
      inQuote = true;
      line += "'";
    } else if (ch === "\n") {
      flushSegment();
      pushLine();
    } else {
      segment += ch;
    }
  }
  flushSegment();
  if (line) pushLine();
  return { lines, safeEnd };
}

export function splitIntoBatches({ lines, safeEnd }, maxBytes) {
  const batches = [];
  let current = [];
  let size = 0;
  for (let i = 0; i < lines.length; i++) {
    current.push(lines[i]);
    size += lines[i].length + 1;
    const next = lines[i + 1];
    const boundary = safeEnd[i] && lines[i].trimEnd().endsWith(";")
      && (next === undefined || next.trim() === "" || STATEMENT_START.test(next));
    if (size >= maxBytes && boundary) {
      batches.push(current.join("\n"));
      current = [];
      size = 0;
    }
  }
  if (current.some((entry) => entry.trim())) batches.push(current.join("\n"));
  return batches;
}

async function main() {
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
  const token = args.token || process.env.DB_IMPORT_TOKEN || "";
  const dryRun = args["dry-run"] === "1";
  const batchBytes = Number(args["batch-bytes"]) || 3 * 1024 * 1024;
  if (!file || (!dryRun && (!baseUrl || !token))) {
    console.error("usage: import-db.mjs --file dump.sql --url https://<app>.apps.lingcode.app --token <DB_IMPORT_TOKEN> [--dry-run] [--batch-bytes N]");
    process.exit(2);
  }
  const raw = fs.readFileSync(file, "utf8");
  const transformed = transformDump(raw);
  const batches = splitIntoBatches(transformed, batchBytes);
  console.log(`dump lines=${raw.split("\n").length} kept=${transformed.lines.length} batches=${batches.length}`);
  if (dryRun) {
    const out = path.join(path.dirname(file), `${path.basename(file, ".sql")}.transformed.sql`);
    fs.writeFileSync(out, transformed.lines.join("\n"));
    console.log(`dry run: wrote ${out}`);
    return;
  }
  for (let i = 0; i < batches.length; i++) {
    const started = Date.now();
    const response = await fetch(`${baseUrl}/api/admin/db-import`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/sql" },
      body: batches[i],
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.ok === false) {
      console.error(`batch ${i + 1}/${batches.length} failed (HTTP ${response.status}): ${body.error || JSON.stringify(body)}`);
      process.exit(1);
    }
    console.log(`batch ${i + 1}/${batches.length} ok in ${Date.now() - started}ms`);
  }
  console.log("import complete");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
