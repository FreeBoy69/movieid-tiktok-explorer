/**
 * Local comment bridge — headless Playwright fetch + push to VPS cache.
 *
 *   node scripts/local_comment_bridge.mjs
 *
 * Env (.env.local):
 *   TIKTOK_COMMENT_PUSH_TOKEN=...
 *   APP_URL=https://autoyt.cc
 *   LOCAL_COMMENT_BRIDGE_PORT=8765
 */

import { spawn } from "child_process";
import fs from "fs";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

for (const file of [".env", ".env.local"]) {
  const filePath = path.join(root, file);
  if (!fs.existsSync(filePath)) continue;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (!(key in process.env)) process.env[key] = value;
  }
}

const PORT = Number(process.env.LOCAL_COMMENT_BRIDGE_PORT || 8765);
const VPS_URL = (process.env.APP_URL || "https://autoyt.cc").replace(/\/+$/, "");
const PUSH_TOKEN = (process.env.TIKTOK_COMMENT_PUSH_TOKEN || "").trim();

function resolvePythonCommand() {
  const configured = (process.env.PYTHON_PATH || "").trim();
  if (configured) {
    const parts = configured.split(/\s+/).filter(Boolean);
    const exe = parts[0];
    if (fs.existsSync(exe) || (!exe.includes("/") && !exe.includes("\\")))
      return { cmd: parts[0], prefixArgs: parts.slice(1) };
  }
  if (process.platform === "win32") return { cmd: "py", prefixArgs: ["-3"] };
  return { cmd: "python3", prefixArgs: [] };
}

async function fetchComments(url, attempt = 1) {
  const { cmd, prefixArgs } = resolvePythonCommand();
  const args = [...prefixArgs, "scripts/local_comment_fetcher.py", url];
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: root,
      env: { ...process.env, MODE_A_HEADLESS: process.env.MODE_A_HEADLESS || "true" },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", () => {
      const line = stdout.trim().split(/\r?\n/).filter(Boolean).pop() || "{}";
      try {
        const data = JSON.parse(line);
        if (!data.threadCount && !data.threads?.length) {
          const error = new Error(stderr || stdout || "No comments returned");
          if (attempt < 3) {
            setTimeout(() => {
              fetchComments(url, attempt + 1).then(resolve).catch(reject);
            }, 2000 * attempt);
            return;
          }
          reject(error);
          return;
        }
        resolve(data);
      } catch (error) {
        if (attempt < 3) {
          setTimeout(() => {
            fetchComments(url, attempt + 1).then(resolve).catch(reject);
          }, 2000 * attempt);
          return;
        }
        reject(new Error(stderr || stdout || String(error)));
      }
    });
  });
}

async function pushToVps(payload) {
  if (!PUSH_TOKEN)
    throw new Error("TIKTOK_COMMENT_PUSH_TOKEN missing in .env.local");
  const response = await fetch(`${VPS_URL}/api/tiktok/comments/cache`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Comment-Push-Token": PUSH_TOKEN,
    },
    body: JSON.stringify({
      videoId: payload.videoId,
      url: payload.url,
      title: payload.title,
      videoTitle: payload.title,
      authorUniqueId: payload.authorUniqueId || "",
      threads: payload.threads || [],
      source: "local_comment_bridge",
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(data.error || `VPS push failed (${response.status})`);
  return data;
}

async function syncItems(items = []) {
  let synced = 0;
  let failed = 0;
  for (const item of items) {
    const url = String(item?.url || "").trim();
    if (!url) {
      failed += 1;
      continue;
    }
    try {
      const fetched = await fetchComments(url);
      await pushToVps({
        url,
        videoId: fetched.videoId || item.videoId,
        title: fetched.title,
        authorUniqueId: fetched.authorUniqueId,
        threads: fetched.threads,
      });
      synced += 1;
    } catch (error) {
      console.error("sync_failed", url, error instanceof Error ? error.message : error);
      failed += 1;
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  return { synced, failed };
}

const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, vps: VPS_URL, hasToken: Boolean(PUSH_TOKEN) }));
    return;
  }
  if (req.method === "POST" && req.url === "/sync") {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", async () => {
      try {
        const parsed = JSON.parse(body || "{}");
        const items = Array.isArray(parsed.items) ? parsed.items : [];
        const result = await syncItems(items);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
      } catch (error) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
      }
    });
    return;
  }
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`local_comment_bridge listening on http://127.0.0.1:${PORT}`);
  console.log(`push_target=${VPS_URL} token=${PUSH_TOKEN ? "set" : "missing"}`);
});
