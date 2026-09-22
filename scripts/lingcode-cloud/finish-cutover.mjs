#!/usr/bin/env node
/**
 * Sync .env secrets into LingCode Cloud, attach autoyt.cc, redeploy hosted app.
 * Does not print secret values.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const mcp = JSON.parse(fs.readFileSync(path.join(root, ".mcp.json"), "utf8"));
const token = mcp.mcpServers["lingcode-cloud"].env.LINGCODE_TOKEN;
const BE = process.env.LINGCODE_BACKEND_ID || "32f0868d386a15ec19705ef0";
const APP = process.env.LINGCODE_APP_ID || "happ-41f124436115bb2dc719d991";
const API = process.env.LINGCODE_API_BASE || "https://lingcode.dev";
const DOMAIN = process.env.LINGCODE_DOMAIN || "autoyt.cc";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

const SKIP = new Set([
  "DATABASE_URL", "PORT", "NODE_ENV", "PSQL_PATH",
  "FFMPEG_PATH", "FFPROBE_PATH", "PYTHON_PATH",
]);

function parseEnv(file) {
  const out = {};
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    const key = line.slice(0, i).trim();
    let val = line.slice(i + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (key) out[key] = val;
  }
  return out;
}

async function api(method, p, body) {
  const res = await fetch(`${API}${p}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "User-Agent": UA,
      Accept: "application/json",
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text.slice(0, 400) }; }
  return { status: res.status, json };
}

function log(...a) { console.log(...a); }

const envPath = path.join(root, ".env");
if (!fs.existsSync(envPath)) {
  console.error("Missing .env at project root");
  process.exit(1);
}

const env = parseEnv(envPath);
const want = {};
for (const [k, v] of Object.entries(env)) {
  if (SKIP.has(k) || !v) continue;
  want[k] = v;
}
want.APP_URL = `https://${DOMAIN}`;
if (want.AUTH_SECRET && !want.SESSION_SECRET) want.SESSION_SECRET = want.AUTH_SECRET;
if (want.SESSION_SECRET && !want.AUTH_SECRET) want.AUTH_SECRET = want.SESSION_SECRET;

log("secrets to sync:", Object.keys(want).sort().join(", "));

const listed = await api("GET", `/api/cloud/account/backends/${BE}/secrets`);
log("list secrets", listed.status, Array.isArray(listed.json?.data) ? listed.json.data.map((s) => s.key).join(", ") : listed.json);

const probes = [
  ["POST", `/api/cloud/account/backends/${BE}/secrets`, (k, v) => ({ key: k, value: v })],
  ["POST", `/api/cloud/account/backends/${BE}/secrets`, (k, v) => ({ name: k, value: v })],
  ["PUT", `/api/cloud/account/backends/${BE}/secrets`, (k, v) => ({ key: k, value: v })],
  ["PUT", `/api/cloud/account/backends/${BE}/secrets`, (k, v) => ({ secrets: { [k]: v } })],
  ["POST", `/api/cloud/account/backends/${BE}/secrets/bulk`, (k, v) => ({ secrets: { [k]: v } })],
  ["PUT", `/api/cloud/account/backends/${BE}/secrets/bulk`, (k, v) => ({ secrets: { [k]: v } })],
  ["POST", `/api/cloud/account/backends/${BE}/apps/${APP}/secrets`, (k, v) => ({ key: k, value: v })],
  ["PUT", `/api/cloud/account/backends/${BE}/apps/${APP}/secrets`, (k, v) => ({ key: k, value: v })],
];

let writer = null;
for (const [method, p, bodyFn] of probes) {
  const r = await api(method, p, bodyFn("CURL_PROBE_SECRET", "probe-ok"));
  log(`probe ${method} ${p} -> ${r.status}`, JSON.stringify(r.json).slice(0, 180));
  if ((r.status === 200 || r.status === 201) && r.json?.ok !== false) {
    writer = { method, path: p, bodyFn };
    break;
  }
}

if (!writer) {
  console.error("Could not find a working secrets write API");
  process.exit(2);
}
log("using writer", writer.method, writer.path);

let ok = 0; let fail = 0;
for (const [k, v] of Object.entries(want)) {
  const r = await api(writer.method, writer.path.includes("/bulk")
    ? writer.path
    : writer.path.replace(/CURL_PROBE_SECRET/, k),
  writer.path.includes("/bulk") ? { secrets: { [k]: v } } : writer.bodyFn(k, v));
  if (r.status === 200 || r.status === 201) {
    ok += 1;
    log("set", k, "ok");
  } else {
    fail += 1;
    log("set", k, "FAIL", r.status, JSON.stringify(r.json).slice(0, 160));
  }
}
log(`secrets done ok=${ok} fail=${fail}`);

const domainBodies = [
  { domain: DOMAIN },
  { hostname: DOMAIN },
  { host: DOMAIN },
  { name: DOMAIN },
  { domain: DOMAIN, appId: APP },
  { domain: DOMAIN, app_id: APP },
];
const domainPaths = [
  ["POST", `/api/cloud/account/backends/${BE}/apps/${APP}/domains`],
  ["POST", `/api/cloud/account/backends/${BE}/apps/${APP}/custom-domains`],
  ["POST", `/api/cloud/account/backends/${BE}/domains`],
  ["POST", `/api/cloud/account/backends/${BE}/custom-domains`],
  ["PUT", `/api/cloud/account/backends/${BE}/apps/${APP}/domain`],
  ["POST", `/api/cloud/account/backends/${BE}/apps/${APP}/attach-domain`],
];

let domainOk = false;
for (const [method, p] of domainPaths) {
  for (const body of domainBodies) {
    const r = await api(method, p, body);
    if (r.status === 404 || r.status === 405) continue;
    log(`domain ${method} ${p} ${JSON.stringify(body)} -> ${r.status}`, JSON.stringify(r.json).slice(0, 220));
    if ((r.status === 200 || r.status === 201) && r.json?.ok !== false) {
      domainOk = true;
      break;
    }
  }
  if (domainOk) break;
}
if (!domainOk) log("WARN: could not attach domain via API — check console Domains UI");

// Redeploy by re-uploading current bundle (secrets inject on next deploy)
const bundle = path.join(root, "tmp/lingcode-app-source.tgz");
if (!fs.existsSync(bundle)) {
  log("building bundle…");
  execFileSync("bash", [path.join(root, "scripts/lingcode-cloud/build-app-bundle.sh"), bundle], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, SKIP_BUILD: process.env.SKIP_BUILD || "0" },
  });
}

const buf = fs.readFileSync(bundle);
const up = await fetch(`${API}/api/cloud/account/backends/${BE}/apps/${APP}/source`, {
  method: "PUT",
  headers: {
    Authorization: `Bearer ${token}`,
    "User-Agent": UA,
    "Content-Type": "application/gzip",
    Accept: "application/json",
  },
  body: buf,
});
const upText = await up.text();
log("redeploy", up.status, upText.slice(0, 300));

log("DNS target (docs): A", DOMAIN, "-> 138.197.107.228 (DNS-only / unproxied)");
log("Current DNS:");
try {
  const dig = execFileSync("dig", ["+short", DOMAIN, "A"], { encoding: "utf8" }).trim();
  log(" ", dig || "(none)");
} catch (e) {
  log(" dig failed", e.message);
}
