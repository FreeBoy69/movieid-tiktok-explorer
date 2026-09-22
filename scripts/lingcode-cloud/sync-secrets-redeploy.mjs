#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const mcp = JSON.parse(fs.readFileSync(path.join(root, ".mcp.json"), "utf8"));
const token = mcp.mcpServers["lingcode-cloud"].env.LINGCODE_TOKEN;
const BE = process.env.LINGCODE_BACKEND_ID || "32f0868d386a15ec19705ef0";
const APP = process.env.LINGCODE_APP_ID || "happ-41f124436115bb2dc719d991";
const API = process.env.LINGCODE_API_BASE || "https://lingcode.dev";
const SKIP = new Set(["DATABASE_URL", "PORT", "NODE_ENV", "PSQL_PATH", "FFMPEG_PATH", "FFPROBE_PATH", "PYTHON_PATH"]);

function parseEnv(file) {
  const out = {};
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    const key = line.slice(0, i).trim();
    let val = line.slice(i + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if (key) out[key] = val;
  }
  return out;
}

async function putSecret(key, value) {
  const res = await fetch(`${API}/api/cloud/account/backends/${BE}/secrets/${encodeURIComponent(key)}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": "Mozilla/5.0",
    },
    body: JSON.stringify({ value }),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text || "{}"); } catch { json = { raw: text.slice(0, 120) }; }
  return { status: res.status, ok: res.ok && json.ok !== false };
}

const env = parseEnv(path.join(root, ".env"));
const want = {};
for (const [k, v] of Object.entries(env)) {
  if (SKIP.has(k) || !v) continue;
  want[k] = v;
}
want.APP_URL = "https://autoyt.cc";
if (want.AUTH_SECRET && !want.SESSION_SECRET) want.SESSION_SECRET = want.AUTH_SECRET;
if (want.SESSION_SECRET && !want.AUTH_SECRET) want.AUTH_SECRET = want.SESSION_SECRET;

let ok = 0;
let fail = 0;
for (const [k, v] of Object.entries(want)) {
  const r = await putSecret(k, v);
  if (r.ok) {
    ok += 1;
    console.log("OK", k);
  } else {
    fail += 1;
    console.log("FAIL", k, r.status);
  }
}
console.log(`secrets ok=${ok} fail=${fail}`);

const bundle = path.join(root, "tmp/lingcode-app-source.tgz");
const buf = fs.readFileSync(bundle);
const up = await fetch(`${API}/api/cloud/account/backends/${BE}/apps/${APP}/source`, {
  method: "PUT",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/gzip",
    Accept: "application/json",
    "User-Agent": "Mozilla/5.0",
  },
  body: buf,
});
console.log("redeploy", up.status, (await up.text()).slice(0, 300));
process.exit(fail ? 1 : 0);
