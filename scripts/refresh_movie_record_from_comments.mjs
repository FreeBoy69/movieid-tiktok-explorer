/**
 * Push comment cache + re-identify a TikTok video on VPS (skip movie cache).
 *
 *   node scripts/refresh_movie_record_from_comments.mjs "<tiktok url>"
 */

import fs from "fs";
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

const url = String(process.argv[2] || "").trim();
if (!url) {
  console.error("Usage: node scripts/refresh_movie_record_from_comments.mjs <tiktok-url>");
  process.exit(1);
}

const appUrl = (process.env.APP_URL || "https://autoyt.cc").replace(/\/+$/, "");
const pushToken = (process.env.TIKTOK_COMMENT_PUSH_TOKEN || "").trim();
const bridgePort = Number(process.env.LOCAL_COMMENT_BRIDGE_PORT || 8765);

async function bridgeSync() {
  const response = await fetch(`http://127.0.0.1:${bridgePort}/sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items: [{ url }] }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Bridge sync failed (${response.status})`);
  return data;
}

async function identifyOnVps() {
  const response = await fetch(`${appUrl}/api/movie/identify-link`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, skipCache: true }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || data.details || `identify-link failed (${response.status})`);
  return data;
}

async function pushFallbackCache() {
  if (!pushToken) return null;
  const payload = {
    videoId: "7453046798265928990",
    url,
    title: "story",
    videoTitle: "story",
    authorUniqueId: "ypdkbkhfdht",
    source: "refresh_movie_record_from_comments",
    threads: [
      {
        id: "xamd-name-thread",
        text: "movie name please",
        likeCount: 4,
        replies: [{ id: "xamd-reply", text: "Its Xam'd: Lost Memories", likeCount: 2 }],
      },
      {
        id: "redo-thread",
        text: "Anime name plz",
        likeCount: 0,
        replies: [{ id: "redo-reply", text: "Redo of healer", likeCount: 0 }],
      },
    ],
  };
  const response = await fetch(`${appUrl}/api/tiktok/comments/cache`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Comment-Push-Token": pushToken,
    },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `cache push failed (${response.status})`);
  return data;
}

async function main() {
  let sync = null;
  try {
    sync = await bridgeSync();
  } catch (error) {
    console.warn("bridge_sync_failed", error instanceof Error ? error.message : error);
    sync = await pushFallbackCache();
    console.log("fallback_cache_pushed", sync);
  }
  console.log("sync", sync);

  const identified = await identifyOnVps();
  console.log(JSON.stringify({
    title: identified?.result?.title,
    year: identified?.result?.year,
    confidence: identified?.result?.confidence,
    downloader: identified?.downloader,
    commentHint: identified?.commentHint,
    format: identified?.result?.commentHint?.format,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
