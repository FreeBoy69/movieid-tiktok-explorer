/**
 * Fetch comments locally for a saved collection and push to VPS, then run movie scan batches.
 *
 *   node scripts/sync_collection_movie_scan.mjs --key <playlist-key>
 *
 * Requires local_comment_bridge logic + signed-in session cookie is NOT needed for push token.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";

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

const args = process.argv.slice(2);
const keyIndex = args.indexOf("--key");
const playlistKey = keyIndex >= 0 ? String(args[keyIndex + 1] || "").trim() : "";
const limitIndex = args.indexOf("--limit");
const limit = limitIndex >= 0 ? Math.max(1, Number(args[limitIndex + 1] || 20)) : 20;

if (!playlistKey) {
  console.error("Usage: node scripts/sync_collection_movie_scan.mjs --key <playlist-key> [--limit 20]");
  process.exit(2);
}

const VPS_URL = (process.env.APP_URL || "https://autoyt.cc").replace(/\/+$/, "");
const BRIDGE = `http://127.0.0.1:${process.env.LOCAL_COMMENT_BRIDGE_PORT || 8765}`;

async function bridgeRequest(path, body) {
  const response = await fetch(`${BRIDGE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Bridge ${path} failed (${response.status})`);
  return data;
}

async function main() {
  const pendingRes = await fetch(`${VPS_URL}/api/saved/tiktok-playlists/movie-scan/pending?key=${encodeURIComponent(playlistKey)}`, {
    credentials: "include",
  });
  const pendingData = await pendingRes.json().catch(() => ({}));
  if (!pendingRes.ok)
    throw new Error(pendingData.error || `Could not load pending comments (${pendingRes.status}). Sign in at ${VPS_URL} in your browser first.`);

  const items = (pendingData.pendingComments || []).slice(0, limit);
  console.log(`pending_comments=${items.length}`);

  if (items.length) {
    try {
      const health = await fetch(`${BRIDGE}/health`).then((r) => r.json());
      console.log("bridge", health);
    } catch {
      console.error("Start bridge first: node scripts/local_comment_bridge.mjs");
      process.exit(1);
    }
    const sync = await bridgeRequest("/sync", { items, playlistKey });
    console.log("comment_sync", sync);
  }

  console.log("Run Scan all videos in the collection UI to complete Movie ID on VPS (comments first, Gemini fallback).");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
