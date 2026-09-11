import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { renderVoiceoverSubtitles } from "./render-voiceover-subtitles.mjs";

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "autoyt-auto-captions-"));
const command = (binary, args) => execFileSync(binary, args, { maxBuffer: 40 * 1024 * 1024 });
const ffmpeg = async args => { command("ffmpeg", ["-hide_banner", "-loglevel", "error", ...args]); };
const detect = async file => JSON.parse(command(process.env.SUBTITLE_STYLE_PYTHON || "python3", [new URL("./subtitle_style.py", import.meta.url).pathname, file]));
const transcript = { segments: [{ words: [{ start: 1, end: 2, word: "New narration." }] }] };
for (const [width, height] of [[640, 360], [360, 640]]) {
  const inputPath = path.join(workspace, `source-${width}.mp4`);
  const outputPath = path.join(workspace, `replaced-${width}.mp4`);
  const top = Math.round(height * .42), size = Math.round(width * .045);
  const secondTop = top + Math.round(size * 1.5);
  const draw = (text, y) => `drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:text='${text}':fontsize=${size}:fontcolor=yellow:borderw=2:bordercolor=black:x=(w-tw)/2:y=${y}`;
  await ffmpeg(["-y", "-f", "lavfi", "-i", `testsrc2=size=${width}x${height}:rate=12`, "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-vf", `${draw("Original narration here", top)},${draw("Second subtitle line", secondTop)}`, "-t", "3", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", inputPath]);
  let calls = 0;
  const result = await renderVoiceoverSubtitles({ inputPath, outputPath, workspace, transcript, dimensions: { width, height }, duration: 3,
    settings: { treatment: "strip", y: 85, height: 10 },
    detectOriginalSubtitles: async file => { calls++; return detect(file); } }, ffmpeg);
  assert.equal(calls, 1);
  assert.equal(result.settings.autoPlacement, true);
  const detectedTop = result.settings.y * height / 100;
  const detectedBottom = (result.settings.y + result.settings.height) * height / 100;
  assert.ok(detectedTop <= top + 2, `Detected top ${detectedTop} must cover original ${top}`);
  assert.ok(detectedBottom >= secondTop + size * .7, "Both old subtitle lines must be covered");
  const frame = command("ffmpeg", ["-v", "error", "-ss", "0.2", "-i", outputPath, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
  for (let y = top; y < secondTop + size * .7; y++) {
    for (let x = Math.round(width * .2); x < width * .8; x++) {
      const offset = (y * width + x) * 3;
      assert.ok(Math.max(...frame.subarray(offset, offset + 3)) < 24, "Old caption pixels must be opaque before new speech");
    }
  }
  const hash = file => command("ffmpeg", ["-v", "error", "-i", file, "-map", "0:a", "-c:a", "copy", "-f", "hash", "-"]).toString();
  assert.equal(hash(inputPath), hash(outputPath));
  assert.match(fs.readFileSync(result.srtPath, "utf8"), /00:00:01,000 --> 00:00:02,000/);
  await ffmpeg(["-y", "-ss", "1.5", "-i", outputPath, "-frames:v", "1", path.join(workspace, `replaced-${width}.png`)]);
  console.log(JSON.stringify({ width, height, detected: result.settings, sampleCount: result.detection.sampleCount }));
}
let encoded = false;
await assert.rejects(renderVoiceoverSubtitles({ inputPath: "missing.mp4", outputPath: "unused.mp4", workspace, transcript, dimensions: { width: 640, height: 360 }, duration: 3,
  settings: {}, detectOriginalSubtitles: async () => { throw new Error("No reliable captions"); } }, async () => { encoded = true; }), /No reliable captions/);
assert.equal(encoded, false, "An uncertain detection must not export a guessed black strip");
console.log(`Automatic subtitle placement passed. Artifacts: ${workspace}`);
