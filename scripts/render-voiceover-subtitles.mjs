import fs from "node:fs";
import path from "node:path";
import { buildSubtitleCues, normalizeSubtitleSettings, subtitleRegion, subtitlesAss, subtitlesSrt, subtitleVideoFilter } from "../src/utils/voiceoverSubtitles.js";

export async function renderVoiceoverSubtitles({ inputPath, outputPath, workspace, transcript, dimensions, duration, settings }, runFfmpeg) {
  const resolved = normalizeSubtitleSettings(settings);
  const region = subtitleRegion(dimensions, resolved);
  const maxChars = Math.max(16, Math.floor((region.width * .88) / (region.fontSize * .65)) * region.maxLines);
  const cues = buildSubtitleCues(transcript.segments, duration, maxChars);
  if (!cues.length) throw new Error("No timed speech found in the updated voiceover. Subtitles were not exported.");
  const assPath = path.join(workspace, "updated-voiceover.ass");
  const srtPath = path.join(workspace, "updated-voiceover.srt");
  fs.writeFileSync(assPath, subtitlesAss(cues, dimensions, resolved));
  fs.writeFileSync(srtPath, subtitlesSrt(cues));
  await runFfmpeg(["-y", "-i", inputPath, "-filter_complex", subtitleVideoFilter(dimensions, resolved, assPath), "-map", "[captioned]", "-map", "0:a:0", "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p", "-c:a", "copy", "-t", String(duration), "-movflags", "+faststart", outputPath], Math.max(20 * 60 * 1000, duration * 10000));
  return { settings: resolved, cueCount: cues.length, timingSource: "updated-voiceover-audio", srtPath };
}
