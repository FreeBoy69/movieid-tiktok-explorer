import fs from "node:fs";
import path from "node:path";
import { createVoiceoverScene } from "../src/utils/voiceoverTimeline.js";

export function scenesFromDetection(metadata, duration) {
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("Video duration could not be read.");
  const candidates = [...String(metadata).matchAll(/^lavfi\.scd\.time=([\d.]+)$/gm)]
    .map(match => Number(match[1])).filter(Number.isFinite).sort((a, b) => a - b);
  const boundaries = [0];
  for (const time of candidates) {
    if (time - boundaries.at(-1) >= 0.35 && duration - time >= 0.35) boundaries.push(time);
  }
  boundaries.push(duration);
  return boundaries.slice(0, -1).map((start, index) => createVoiceoverScene({
    start, end: boundaries[index + 1], label: `Scene ${index + 1}`,
  }));
}

export async function detectVideoScenes(sourcePath, workspace, duration, runFfmpeg, onProgress) {
  const metadataPath = path.join(workspace, "scene-cuts.txt");
  const progressPath = path.join(workspace, "scene-progress.txt");
  // FFmpeg filter paths have their own escaping rules, separate from shell quoting.
  const escaped = metadataPath.replace(/\\/g, "/").replace(/'/g, "'\\\\''").replace(/:/g, "\\:");
  const timer = setInterval(() => {
    try {
      const output = fs.readFileSync(progressPath, "utf8");
      const times = [...output.matchAll(/^out_time_us=(\d+)$/gm)];
      const seconds = Number(times.at(-1)?.[1] || 0) / 1e6;
      onProgress?.(Math.min(1, seconds / duration));
    } catch { /* The progress file is created after decoding starts. */ }
  }, 2000);
  try {
    await runFfmpeg([
      "-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-threads", "2", "-i", sourcePath,
      "-map", "0:v:0", "-an", "-sn", "-dn", "-filter_threads", "1",
      "-vf", `setpts=PTS-STARTPTS,scale=320:-2,scdet=threshold=10,metadata=mode=print:key=lavfi.scd.time:file='${escaped}'`,
      "-progress", progressPath, "-nostats", "-f", "null", "-",
    ], Math.max(180000, (duration * 2 + 60) * 1000));
    const scenes = scenesFromDetection(fs.readFileSync(metadataPath, "utf8"), duration);
    onProgress?.(1);
    return scenes;
  } finally {
    clearInterval(timer);
    fs.rmSync(metadataPath, { force: true });
    fs.rmSync(progressPath, { force: true });
  }
}
