import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readJson(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(text.slice(0, 240) || `HTTP ${response.status}`);
  }
}

function mediaTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".wav") return "audio/wav";
  if (ext === ".mp3") return "audio/mpeg";
  if (ext === ".m4a") return "audio/mp4";
  if (ext === ".mp4") return "video/mp4";
  return "application/octet-stream";
}

function dataUrlForFile(filePath) {
  const buffer = fs.readFileSync(filePath);
  return `data:${mediaTypeFor(filePath)};base64,${buffer.toString("base64")}`;
}

async function downloadToFile(url, targetPath) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed (${response.status}).`);
  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(targetPath, buffer);
  return targetPath;
}

/** HeyGen: upload local file → asset_id, then create image+audio talking video. */
export async function generateHeyGenTalkingAvatar({ imagePath, audioPath, workspace, aspectRatio = "9:16", resolution = "720p", onProgress }) {
  const apiKey = String(process.env.HEYGEN_API_KEY || "").trim();
  if (!apiKey) throw new Error("Set HEYGEN_API_KEY to use HeyGen avatar remakes.");
  const headers = { "x-api-key": apiKey };
  onProgress?.("Uploading face and narration to HeyGen", 0.15);

  async function uploadAsset(filePath) {
    const form = new FormData();
    const blob = new Blob([fs.readFileSync(filePath)], { type: mediaTypeFor(filePath) });
    form.append("file", blob, path.basename(filePath));
    const response = await fetch("https://api.heygen.com/v3/assets", { method: "POST", headers, body: form });
    const payload = await readJson(response);
    if (!response.ok) throw new Error(payload?.error?.message || payload?.message || `HeyGen upload failed (${response.status}).`);
    const assetId = payload?.data?.asset_id || payload?.data?.id || payload?.asset_id;
    if (!assetId) throw new Error("HeyGen upload did not return an asset id.");
    return assetId;
  }

  const imageAssetId = await uploadAsset(imagePath);
  const audioAssetId = await uploadAsset(audioPath);
  onProgress?.("Generating HeyGen talking avatar", 0.35);

  const create = await fetch("https://api.heygen.com/v3/videos", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "image",
      image: { type: "asset_id", asset_id: imageAssetId },
      audio_asset_id: audioAssetId,
      aspect_ratio: aspectRatio === "16:9" ? "16:9" : "9:16",
      resolution: resolution === "480p" ? "720p" : resolution,
      expressiveness: "low",
    }),
  });
  const created = await readJson(create);
  if (!create.ok) throw new Error(created?.error?.message || created?.message || `HeyGen create failed (${create.status}).`);
  const videoId = created?.data?.video_id || created?.data?.id || created?.video_id;
  if (!videoId) throw new Error("HeyGen did not return a video id.");

  const started = Date.now();
  while (Date.now() - started < 12 * 60 * 1000) {
    await sleep(4000);
    const statusRes = await fetch(`https://api.heygen.com/v3/videos/${encodeURIComponent(videoId)}`, { headers });
    const statusPayload = await readJson(statusRes);
    if (!statusRes.ok) throw new Error(statusPayload?.error?.message || `HeyGen status failed (${statusRes.status}).`);
    const data = statusPayload?.data || statusPayload;
    const status = String(data.status || "").toLowerCase();
    onProgress?.(`HeyGen avatar ${status || "processing"}`, 0.45);
    if (status === "completed" || status === "success") {
      const url = data.video_url || data.url || data.videoUrl;
      if (!url) throw new Error("HeyGen finished without a video URL.");
      const target = path.join(workspace, "avatar-talking.mp4");
      await downloadToFile(url, target);
      return { path: target, provider: "heygen", videoId };
    }
    if (["failed", "error", "canceled", "cancelled"].includes(status)) {
      throw new Error(data.error?.message || data.failure_message || data.error_message || "HeyGen avatar generation failed.");
    }
  }
  throw new Error("HeyGen avatar generation timed out.");
}

/** LongCat via WaveSpeed: photo + audio → talking avatar. */
export async function generateLongCatTalkingAvatar({ imagePath, audioPath, workspace, resolution = "720p", prompt = "", onProgress }) {
  const apiKey = String(process.env.WAVESPEED_API_KEY || "").trim();
  if (!apiKey) throw new Error("Set WAVESPEED_API_KEY to use LongCat avatar remakes.");
  onProgress?.("Submitting LongCat avatar job", 0.2);
  const submit = await fetch("https://api.wavespeed.ai/api/v3/wavespeed-ai/longcat-avatar", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      image: dataUrlForFile(imagePath),
      audio: dataUrlForFile(audioPath),
      resolution: resolution === "480p" ? "480p" : "720p",
      prompt: prompt || undefined,
    }),
  });
  const submitted = await readJson(submit);
  if (!submit.ok) throw new Error(submitted?.error || submitted?.message || `LongCat submit failed (${submit.status}).`);
  const task = submitted?.data || submitted;
  const predictionId = task.id;
  if (!predictionId) throw new Error("LongCat did not return a prediction id.");

  const started = Date.now();
  while (Date.now() - started < 20 * 60 * 1000) {
    await sleep(3000);
    const statusRes = await fetch(`https://api.wavespeed.ai/api/v3/predictions/${encodeURIComponent(predictionId)}/result`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const statusPayload = await readJson(statusRes);
    if (!statusRes.ok) throw new Error(statusPayload?.error || statusPayload?.message || `LongCat status failed (${statusRes.status}).`);
    const result = statusPayload?.data || statusPayload;
    const status = String(result.status || "").toLowerCase();
    onProgress?.(`LongCat avatar ${status || "processing"}`, 0.5);
    if (status === "completed") {
      const outputs = result.outputs || result.output || [];
      const url = Array.isArray(outputs) ? outputs[0] : outputs;
      if (!url || typeof url !== "string") throw new Error("LongCat finished without an output URL.");
      const target = path.join(workspace, "avatar-talking.mp4");
      await downloadToFile(url, target);
      return { path: target, provider: "longcat", predictionId };
    }
    if (["failed", "cancelled", "timeout", "deleted"].includes(status)) {
      throw new Error(result.error || result.message || "LongCat avatar generation failed.");
    }
  }
  throw new Error("LongCat avatar generation timed out.");
}

/** Layout preview: hold the face image for the narration duration (no paid API). */
export async function generatePreviewTalkingAvatar({ imagePath, audioPath, workspace, durationSeconds, runFfmpeg }) {
  const target = path.join(workspace, "avatar-preview.mp4");
  const duration = Math.max(1, Number(durationSeconds) || 5);
  await runFfmpeg([
    "-y",
    "-loop", "1",
    "-i", imagePath,
    "-i", audioPath,
    "-vf", "scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,fps=30,format=yuv420p",
    "-c:v", "libx264",
    "-tune", "stillimage",
    "-c:a", "aac",
    "-b:a", "192k",
    "-shortest",
    "-t", String(duration),
    "-movflags", "+faststart",
    target,
  ], Math.max(60_000, duration * 4000));
  return { path: target, provider: "preview" };
}

export async function generateTalkingAvatar(provider, options) {
  if (provider === "heygen") return generateHeyGenTalkingAvatar(options);
  if (provider === "longcat") return generateLongCatTalkingAvatar(options);
  return generatePreviewTalkingAvatar(options);
}

/** Escape path for ffmpeg concat demuxer. */
function concatPath(filePath) {
  return filePath.replace(/'/g, "'\\''");
}

export async function applyTimelineScenes(sourcePath, scenes, workspace, runFfmpeg, probeDuration) {
  const list = (Array.isArray(scenes) ? scenes : []).filter((scene) => Number(scene.sourceEnd) > Number(scene.sourceStart));
  if (list.length <= 1) return sourcePath;
  const partsDir = path.join(workspace, "timeline-parts");
  fs.mkdirSync(partsDir, { recursive: true });
  const partPaths = [];
  for (let index = 0; index < list.length; index += 1) {
    const scene = list[index];
    const start = Math.max(0, Number(scene.sourceStart) || 0);
    const end = Math.max(start + 0.05, Number(scene.sourceEnd) || start + 0.05);
    const partPath = path.join(partsDir, `part_${String(index).padStart(3, "0")}.mp4`);
    await runFfmpeg([
      "-y",
      "-ss", String(start),
      "-to", String(end),
      "-i", sourcePath,
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-crf", "18",
      "-c:a", "aac",
      "-b:a", "192k",
      "-avoid_negative_ts", "make_zero",
      "-movflags", "+faststart",
      partPath,
    ], 10 * 60 * 1000);
    partPaths.push(partPath);
  }
  const listFile = path.join(workspace, "timeline-concat.txt");
  fs.writeFileSync(listFile, partPaths.map((part) => `file '${concatPath(part)}'`).join("\n"));
  const outputPath = path.join(workspace, "timeline-cut.mp4");
  await runFfmpeg([
    "-y",
    "-f", "concat",
    "-safe", "0",
    "-i", listFile,
    "-c", "copy",
    "-movflags", "+faststart",
    outputPath,
  ], 10 * 60 * 1000);
  if (probeDuration) await probeDuration(outputPath);
  return outputPath;
}

/**
 * Compose remake:
 * - split: top = source B-roll/screen, bottom = talking avatar
 * - full: avatar fills frame (source discarded visually, audio from avatar)
 */
export async function composeAvatarRemake({
  sourcePath,
  avatarPath,
  outputPath,
  layout = "split",
  splitRatio = 0.48,
  durationSeconds,
  runFfmpeg,
}) {
  const duration = Math.max(1, Number(durationSeconds) || 5);
  const ratio = Math.min(0.7, Math.max(0.3, Number(splitRatio) || 0.48));
  const topH = Math.round(1280 * ratio);
  const bottomH = 1280 - topH;

  if (layout === "full") {
    await runFfmpeg([
      "-y",
      "-i", avatarPath,
      "-vf", "scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,fps=30,format=yuv420p",
      "-c:v", "libx264",
      "-preset", "fast",
      "-crf", "18",
      "-c:a", "aac",
      "-b:a", "192k",
      "-t", String(duration),
      "-movflags", "+faststart",
      outputPath,
    ], Math.max(120_000, duration * 8000));
    return outputPath;
  }

  await runFfmpeg([
    "-y",
    "-i", sourcePath,
    "-i", avatarPath,
    "-filter_complex",
    [
      `[0:v]scale=720:${topH}:force_original_aspect_ratio=increase,crop=720:${topH},setsar=1[top]`,
      `[1:v]scale=720:${bottomH}:force_original_aspect_ratio=increase,crop=720:${bottomH},setsar=1[bottom]`,
      `[top][bottom]vstack=inputs=2,fps=30,format=yuv420p[v]`,
      `[1:a]aformat=sample_rates=48000:channel_layouts=stereo[a]`,
    ].join(";"),
    "-map", "[v]",
    "-map", "[a]",
    "-c:v", "libx264",
    "-preset", "fast",
    "-crf", "18",
    "-c:a", "aac",
    "-b:a", "192k",
    "-t", String(duration),
    "-movflags", "+faststart",
    outputPath,
  ], Math.max(180_000, duration * 10000));
  return outputPath;
}

/** Optional helper if callers prefer spawning ffmpeg without existing runFfmpeg. */
export function createFfmpegRunner(ffmpegBin = "ffmpeg") {
  return function runFfmpeg(args, timeoutMs = 10 * 60 * 1000) {
    return new Promise((resolve, reject) => {
      const child = spawn(ffmpegBin, args, { stdio: ["ignore", "ignore", "pipe"] });
      let stderr = "";
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error("ffmpeg timed out."));
      }, timeoutMs);
      child.stderr.on("data", (chunk) => { stderr += String(chunk); if (stderr.length > 8000) stderr = stderr.slice(-8000); });
      child.on("error", (error) => { clearTimeout(timer); reject(error); });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(stderr.trim().split("\n").slice(-4).join(" ") || `ffmpeg exited ${code}`));
      });
    });
  };
}
