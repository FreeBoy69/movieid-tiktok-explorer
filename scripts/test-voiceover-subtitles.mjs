import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { renderVoiceoverSubtitles } from "./render-voiceover-subtitles.mjs";

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "autoyt-subtitles-"));
function command(binary, args, binaryOutput = false) {
  const result = spawnSync(binary, args, { encoding: binaryOutput ? undefined : "utf8", maxBuffer: 30 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(String(result.stderr || result.error));
  return result.stdout;
}
const ffmpeg = async (args) => { command(process.env.FFMPEG_PATH || "ffmpeg", ["-hide_banner", "-loglevel", "error", ...args]); };
const transcript = { segments: [{ words: [{ start: .4, end: .8, word: "Updated" }, { start: .8, end: 1.2, word: "voiceover" }, { start: 1.2, end: 1.7, word: "captions." }] }] };
for (const [width, height] of [[640, 360], [360, 640]]) {
  const inputPath = path.join(workspace, `source-${width}.mp4`);
  await ffmpeg(["-y", "-f", "lavfi", "-i", `testsrc2=size=${width}x${height}:rate=25`, "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-t", "2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", inputPath]);
  for (const treatment of ["strip", "blur"]) {
    const outputPath = path.join(workspace, `${treatment}-${width}.mp4`);
    const result = await renderVoiceoverSubtitles({ inputPath, outputPath, workspace, transcript, dimensions: { width, height }, duration: 2, settings: { treatment, autoPlacement: false, y: 70, height: 20 } }, ffmpeg);
    const probe = JSON.parse(command("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", outputPath]));
    const video = probe.streams.find((s) => s.codec_type === "video");
    assert.equal(video.width, width); assert.equal(video.height, height);
    assert.ok(Math.abs(Number(probe.format.duration) - 2) < .15);
    assert.ok(probe.streams.some((s) => s.codec_type === "audio"));
    const audioHash = (file) => command("ffmpeg", ["-v", "error", "-i", file, "-map", "0:a", "-c:a", "copy", "-f", "hash", "-"]);
    assert.equal(audioHash(inputPath), audioHash(outputPath), "Audio packets must be unchanged");
    assert.equal(result.cueCount, 1);
    assert.ok(fs.readFileSync(result.srtPath, "utf8").includes("00:00:00,400 --> 00:00:01,700"));
    const frame = command("ffmpeg", ["-v", "error", "-ss", "0.1", "-i", outputPath, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], true);
    if (treatment === "strip") {
      const pixel = (Math.floor(height * .8) * width + Math.floor(width / 2)) * 3;
      assert.ok(frame[pixel] < 10 && frame[pixel + 1] < 10 && frame[pixel + 2] < 10, "The strip must be opaque before speech starts");
      if (process.env.SUBTITLE_STYLE_PYTHON) {
        const style = JSON.parse(command(process.env.SUBTITLE_STYLE_PYTHON, [new URL("./subtitle_style.py", import.meta.url).pathname, outputPath]));
        assert.ok(style.sampleCount >= 4, "Style detection needs agreement across frames");
        assert.ok(style.y < 80 && style.y + style.height > 80, "Estimated band must cover the actual captions");
      }
    }
    await ffmpeg(["-y", "-ss", "1", "-i", outputPath, "-frames:v", "1", path.join(workspace, `${treatment}-${width}.png`)]);
  }
}
console.log(JSON.stringify({ passed: true, renders: 4, workspace, checks: ["portrait and landscape dimensions", "unchanged encoded audio", "duration", "caption timing", "opaque strip pixels"] }));
