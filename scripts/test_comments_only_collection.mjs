/**
 * Comments-only test: bridge sync all collection URLs, then identify-link without Gemini.
 *   node scripts/test_comments_only_collection.mjs --slug c-williams41
 */
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { attachMovieIdentificationSource, getMovieIdentificationSourceDisplay } from "../src/utils/movieIdentificationSource.js";

const LOCAL_COMMENT_BRIDGE = "http://127.0.0.1:8765";

async function syncLocalCommentBridge(items, timeoutMs = 240_000) {
  try {
    const response = await fetch(`${LOCAL_COMMENT_BRIDGE}/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return null;
    return response.json();
  } catch (error) {
    console.warn("bridge_chunk_failed", error instanceof Error ? error.message : error);
    return null;
  }
}

async function syncLocalCommentBridgeForVideos(videos, options = {}) {
  const onProgress = options.onChunk || options.onProgress;
  const chunkSize = Math.max(1, options.chunkSize ?? 3);
  const items = videos.map((video) => ({
    url: String(video.playUrl || "").trim(),
    videoId: String(video.id || ""),
    title: video.title,
  })).filter((item) => item.url);
  let synced = 0;
  let failed = 0;
  for (let index = 0; index < items.length; index += chunkSize) {
    const chunk = items.slice(index, index + chunkSize);
    const result = await syncLocalCommentBridge(chunk, Math.max(240_000, chunk.length * 180_000));
    if (result) {
      synced += result.synced || 0;
      failed += result.failed || 0;
    } else {
      failed += chunk.length;
    }
    onProgress?.({ done: Math.min(index + chunk.length, items.length), total: items.length });
  }
  return { synced, failed };
}

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

const slugArg = process.argv.indexOf("--slug");
const slug = slugArg >= 0 ? String(process.argv[slugArg + 1] || "c-williams41").trim() : "c-williams41";
const appUrl = (process.env.APP_URL || "https://autoyt.cc").replace(/\/+$/, "");

function fetchVideosForSlug(targetSlug) {
  const script = `cd /opt/autoyt/app && DBURL=$(grep '^DATABASE_URL=' .env | cut -d= -f2-) && KEY=$(psql "$DBURL" -tAc "SELECT key FROM saved_tiktok_playlists WHERE slug='${targetSlug}' LIMIT 1;" | tr -d '[:space:]') && psql "$DBURL" -tAc "SELECT json_agg(json_build_object('id', v->>'id', 'playUrl', COALESCE(NULLIF(v->>'playUrl',''), 'https://www.tiktok.com/@' || COALESCE(NULLIF(v->>'authorHandle',''),'unknown') || '/video/' || (v->>'id')), 'title', LEFT(COALESCE(v->>'title',''), 120), 'authorHandle', COALESCE(v->>'authorHandle',''))) FROM saved_tiktok_playlists p, LATERAL jsonb_array_elements(p.playlist->'videos') v WHERE p.key = '$KEY';"`;
  const out = spawnSync("ssh", ["-o", "BatchMode=yes", "root@212.95.34.95", script], { encoding: "utf8" });
  if (out.status !== 0) throw new Error(out.stderr || out.stdout || "Could not load collection videos");
  return JSON.parse(out.stdout.trim() || "[]");
}

async function identifyCommentsOnly(url) {
  const response = await fetch(`${appUrl}/api/movie/identify-link`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, skipCache: true, geminiFallback: false, commentsOnly: true }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    return { ok: false, error: data.error || `HTTP ${response.status}` };
  }
  const result = attachMovieIdentificationSource(data.result || {}, "tiktok-comments");
  const display = getMovieIdentificationSourceDisplay(result, "tiktok-comments");
  return { ok: true, title: result.title, source: display.source, label: display.label, commentHint: data.commentHint };
}

async function main() {
  const videos = fetchVideosForSlug(slug);
  console.log(`Collection ${slug}: ${videos.length} videos\n`);

  let bridge = { synced: 0, failed: 0 };
  const healthOk = await fetch(`${LOCAL_COMMENT_BRIDGE}/health`, { signal: AbortSignal.timeout(4000) })
    .then((response) => response.json())
    .then((data) => data?.ok === true)
    .catch(() => false);

  if (healthOk) {
    console.log("Phase 1: local bridge comment sync...");
    bridge = await syncLocalCommentBridgeForVideos(videos, {
      chunkSize: 1,
      onChunk: ({ done, total }) => console.log(`  comments synced progress ${done}/${total}`),
    });
    console.log(`Bridge done: synced=${bridge.synced} failed=${bridge.failed}\n`);
  } else {
    console.warn("Phase 1 skipped: comment bridge offline\n");
  }

  console.log("Phase 2: comments-only identify (no Gemini)...");
  const results = [];
  for (const video of videos) {
    const url = String(video.playUrl || "").trim();
    if (!url) continue;
    process.stdout.write(`${video.id}: `);
    const hit = await identifyCommentsOnly(url);
    if (hit.ok) {
      console.log(`${hit.title} [${hit.label}]`);
      results.push({ id: video.id, ok: true, title: hit.title, source: hit.source });
    } else {
      console.log(`no comment ID (${hit.error})`);
      results.push({ id: video.id, ok: false, error: hit.error });
    }
  }

  const commentHits = results.filter((row) => row.ok);
  console.log("\nSUMMARY");
  console.log(JSON.stringify({
    slug,
    total: videos.length,
    bridgeSynced: bridge.synced,
    bridgeFailed: bridge.failed,
    commentIdentified: commentHits.length,
    commentMissed: results.length - commentHits.length,
    hits: commentHits,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
