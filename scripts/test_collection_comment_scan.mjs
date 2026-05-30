/**
 * Test comment-first scan flow for a saved collection (bridge + identify-link).
 * Usage: node scripts/test_collection_comment_scan.mjs --limit 5
 */
import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import { attachMovieIdentificationSource, getMovieIdentificationSourceDisplay } from "../src/utils/movieIdentificationSource.js";

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

const limitArg = process.argv.indexOf("--limit");
const limit = limitArg >= 0 ? Math.max(1, Number(process.argv[limitArg + 1] || 5)) : 5;
const appUrl = (process.env.APP_URL || "https://autoyt.cc").replace(/\/+$/, "");
const bridgePort = Number(process.env.LOCAL_COMMENT_BRIDGE_PORT || 8765);

const urlsRaw = spawnSync("ssh", ["-o", "BatchMode=yes", "root@212.95.34.95", "bash /tmp/vps_williams_video_urls.sh"], {
  encoding: "utf8",
});
if (urlsRaw.status !== 0) {
  console.error(urlsRaw.stderr || urlsRaw.stdout);
  process.exit(1);
}
const videos = JSON.parse(urlsRaw.stdout.trim() || "[]");
const sample = videos.slice(0, limit);

async function bridgeHealth() {
  try {
    const response = await fetch(`http://127.0.0.1:${bridgePort}/health`, { signal: AbortSignal.timeout(4000) });
    const data = await response.json();
    return data.ok === true;
  } catch {
    return false;
  }
}

async function bridgeSync(url) {
  const response = await fetch(`http://127.0.0.1:${bridgePort}/sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items: [{ url }] }),
    signal: AbortSignal.timeout(240_000),
  });
  return response.json().catch(() => ({}));
}

async function identify(url) {
  const response = await fetch(`${appUrl}/api/movie/identify-link`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, skipCache: true }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || data.details || `HTTP ${response.status}`);
  return data;
}

const bridgeOk = await bridgeHealth();
console.log(JSON.stringify({ collection: "c-williams41", totalVideos: videos.length, testing: sample.length, bridgeOk }, null, 2));

const results = [];
for (const video of sample) {
  const url = String(video.url || "").trim();
  if (!url) continue;
  process.stdout.write(`\nScanning ${video.id || url}...\n`);
  if (bridgeOk) {
    try {
      await bridgeSync(url);
    } catch (error) {
      console.warn("bridge_failed", error instanceof Error ? error.message : error);
    }
  }
  try {
    const data = await identify(url);
    const result = attachMovieIdentificationSource(data.result || {}, data.downloader || "");
    const display = getMovieIdentificationSourceDisplay(result, data.downloader || "");
    results.push({
      id: video.id,
      title: result.title,
      source: display.source,
      label: display.label,
      downloader: data.downloader,
      commentHint: Boolean(data.commentHint || result.commentHint),
    });
    console.log(`  -> ${result.title} [${display.label}]`);
  } catch (error) {
    results.push({ id: video.id, error: error instanceof Error ? error.message : String(error) });
    console.log(`  -> ERROR ${results.at(-1).error}`);
  }
}

const counts = results.reduce((acc, row) => {
  if (!row.source) return acc;
  acc[row.source] = (acc[row.source] || 0) + 1;
  return acc;
}, {});

console.log("\nSUMMARY", JSON.stringify({ tested: results.length, counts, results }, null, 2));
