/**
 * One-off: list TikTok URL via local server, download clips, concat to 3–4 min MP4.
 * Requires: node server.js running on PORT (default 3000), ffmpeg on PATH.
 *
 * Usage: node scripts/build-local-compilation.mjs [tiktokUrl]
 */
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const DEFAULT_URL = "https://www.tiktok.com/search/video?q=ai%20fruit&t=1777735191574";
const MIN_SEC = 180;
const MAX_SEC = 240;
const LIST_COUNT = 60;

const BASE = `http://127.0.0.1:${process.env.PORT || 3000}`;

/** Match CompilationStudio vertical layout */
const VF_VERTICAL =
  "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p";

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: "inherit", shell: false, ...opts });
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))));
  });
}

function clipDurationSeconds(v) {
  const s = Number(v.durationSeconds ?? v.duration ?? 0);
  if (Number.isFinite(s) && s > 0) return Math.min(s, 600);
  return 40;
}

function pickVideos(videos) {
  const sorted = [...videos].sort((a, b) => (b.stats?.playCount || 0) - (a.stats?.playCount || 0));
  const picked = [];
  let total = 0;
  const seen = new Set();
  for (const v of sorted) {
    if (!v.playUrl || seen.has(v.id)) continue;
    const d = clipDurationSeconds(v);
    if (picked.length >= 40) break;
    if (total >= MAX_SEC) break;
    if (total >= MIN_SEC && total + d > MAX_SEC) continue;
    picked.push(v);
    seen.add(v.id);
    total += d;
  }
  if (total < MIN_SEC) {
    for (const v of sorted) {
      if (seen.has(v.id)) continue;
      const d = clipDurationSeconds(v);
      picked.push(v);
      seen.add(v.id);
      total += d;
      if (total >= MIN_SEC) break;
    }
  }
  return { picked, totalSeconds: total };
}

async function ensureServer() {
  try {
    const r = await fetch(`${BASE}/`, { method: "GET", signal: AbortSignal.timeout(4000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
  } catch (e) {
    throw new Error(`No server at ${BASE}. Run: node server.js (from project root). ${e.message || e}`);
  }
}

async function listTikTok(url) {
  const response = await fetch(`${BASE}/api/tiktok/list`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, count: LIST_COUNT, seedVideoUrl: "", forceNetwork: true }),
  });
  const text = await response.text();
  let data = {};
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`List failed (${response.status}): ${text.slice(0, 400)}`);
  }
  if (!response.ok) throw new Error(data.error || `List failed (${response.status})`);
  if (!Array.isArray(data.videos) || !data.videos.length) throw new Error("No videos returned for this URL");
  return data;
}

async function downloadClip(playUrl, candidateUrls, outPath) {
  const response = await fetch(`${BASE}/api/tiktok/process`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: playUrl, candidateUrls: candidateUrls || [] }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || data.details || `Download failed (${response.status})`);
  const rel = String(data.videoUrl || "");
  if (!rel.startsWith("/")) throw new Error("No videoUrl in process response");
  const vidRes = await fetch(`${BASE}${rel}`);
  if (!vidRes.ok) throw new Error(`Fetch ${rel} failed (${vidRes.status})`);
  const buf = Buffer.from(await vidRes.arrayBuffer());
  fs.writeFileSync(outPath, buf);
}

async function main() {
  const sourceUrl = process.argv[2] || DEFAULT_URL;
  await ensureServer();
  console.log("Listing TikTok results…");
  const playlist = await listTikTok(sourceUrl);
  const { picked, totalSeconds } = pickVideos(playlist.videos);
  console.log(`Picked ${picked.length} clips (~${Math.round(totalSeconds)}s target ${MIN_SEC}–${MAX_SEC}s)`);

  const workDir = path.join(PROJECT_ROOT, "tmp", `cli-compilation-${Date.now()}`);
  fs.mkdirSync(workDir, { recursive: true });
  const exportsDir = path.join(PROJECT_ROOT, "exports");
  fs.mkdirSync(exportsDir, { recursive: true });
  const outFile = path.join(exportsDir, `compilation-ai-fruit-${Date.now()}.mp4`);

  const normalized = [];
  let i = 0;
  for (const v of picked) {
    i += 1;
    const raw = path.join(workDir, `raw_${String(i).padStart(3, "0")}.mp4`);
    const norm = path.join(workDir, `clip_${String(i).padStart(3, "0")}.mp4`);
    process.stdout.write(`[${i}/${picked.length}] ${v.id || ""} … `);
    try {
      await downloadClip(v.playUrl, v.cleanPlaybackUrls, raw);
      await run("ffmpeg", [
        "-y",
        "-i",
        raw,
        "-vf",
        VF_VERTICAL,
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "20",
        "-c:a",
        "aac",
        "-ar",
        "44100",
        "-ac",
        "2",
        "-b:a",
        "160k",
        "-movflags",
        "+faststart",
        norm,
      ]);
      normalized.push(norm);
      console.log("ok");
    } catch (e) {
      console.log("skip:", e instanceof Error ? e.message : e);
    }
  }

  if (!normalized.length) {
    throw new Error("No clips downloaded successfully.");
  }

  const concatList = path.join(workDir, "concat.txt");
  const esc = (p) => p.replace(/\\/g, "/").replace(/'/g, "'\\''");
  fs.writeFileSync(concatList, normalized.map((p) => `file '${esc(p)}'`).join("\n"), "utf8");

  console.log("Concatenating…");
  await run("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", concatList, "-c", "copy", "-movflags", "+faststart", outFile]);

  try {
    fs.rmSync(workDir, { recursive: true, force: true });
  } catch {
    /* keep for debug */
  }

  const stat = fs.statSync(outFile);
  console.log("\nDone.");
  console.log("Output:", outFile);
  console.log("Size:", Math.round(stat.size / 1024 / 1024), "MB");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
