import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { composeAvatarRemake, createFfmpegRunner } from "../src/utils/avatarProviders.js";

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "autoyt-avatar-qa-"));
const runFfmpeg = createFfmpegRunner(process.env.FFMPEG_PATH || "ffmpeg");
const ffmpeg = (args) => execFileSync(process.env.FFMPEG_PATH || "ffmpeg", ["-v", "error", ...args], { maxBuffer: 20 * 1024 * 1024 });
const narration = path.join(workspace, "narration.wav");
ffmpeg(["-f", "lavfi", "-i", "sine=frequency=880:duration=6:sample_rate=48000", narration]);

function frame(file, time, crop) {
  return ffmpeg(["-ss", String(time), "-i", file, "-frames:v", "1", "-vf", crop, "-pix_fmt", "rgb24", "-f", "rawvideo", "-"]);
}
function difference(a, b) {
  assert.equal(a.length, b.length);
  let sum = 0;
  for (let index = 0; index < a.length; index++) sum += Math.abs(a[index] - b[index]);
  return sum / a.length;
}
for (const [aspectRatio, width, height, side] of [["9:16", 720, 1280, "bottom"], ["16:9", 1280, 720, "right"]]) {
  const name = aspectRatio.replace(":", "-");
  const source = path.join(workspace, `${name}-source.mp4`);
  const avatar = path.join(workspace, `${name}-avatar.mp4`);
  const output = path.join(workspace, `${name}-result.mp4`);
  ffmpeg(["-f", "lavfi", "-i", `testsrc2=size=${width}x${height}:rate=30:duration=6`, "-f", "lavfi", "-i", "sine=frequency=220:duration=6", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "18", "-c:a", "aac", source]);
  ffmpeg(["-f", "lavfi", "-i", `color=c=red:size=${width}x${height}:rate=30:duration=6`, "-c:v", "libx264", "-preset", "ultrafast", avatar]);
  await composeAvatarRemake({ sourcePath: source, avatarPath: avatar, narrationPath: narration, outputPath: output,
    layout: "smart", aspectRatio, durationSeconds: 6, runFfmpeg,
    scenes: [{ start: 0, end: 2, role: "split", presenterSide: side, splitAt: 0.5 }, { start: 2, end: 4, role: "broll" }, { start: 4, end: 6, role: "talking-head" }],
  });
  const retained = side === "bottom" ? `crop=${width}:600:0:0` : `crop=600:${height}:0:0`;
  const replaced = side === "bottom" ? `crop=${width}:600:0:680` : `crop=600:${height}:680:0`;
  const full = `crop=${width}:${height}:0:0`;
  const scores = {
    splitRetained: difference(frame(source, 1, retained), frame(output, 1, retained)),
    splitReplaced: difference(frame(source, 1, replaced), frame(output, 1, replaced)),
    brollRetained: difference(frame(source, 3, full), frame(output, 3, full)),
    presenterReplaced: difference(frame(source, 5, full), frame(output, 5, full)),
  };
  assert.ok(scores.splitRetained < 5, JSON.stringify(scores));
  assert.ok(scores.brollRetained < 5, JSON.stringify(scores));
  assert.ok(scores.splitReplaced > 20 && scores.presenterReplaced > 20, JSON.stringify(scores));
  const probe = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-count_frames", "-show_streams", "-show_format", "-of", "json", output]));
  const video = probe.streams.find(stream => stream.codec_type === "video");
  assert.equal(video.width, width); assert.equal(video.height, height);
  assert.equal(Number(video.nb_read_frames), 180);
  assert.ok(Math.abs(Number(probe.format.duration) - 6) < 0.1);
  assert.equal(probe.streams.find(stream => stream.codec_type === "audio").codec_name, "aac");
  const audio = ffmpeg(["-ss", "1", "-i", output, "-t", "1", "-vn", "-ac", "1", "-ar", "48000", "-f", "f32le", "-"]);
  const magnitude = (frequency) => {
    let sin = 0, cos = 0;
    for (let index = 0; index < audio.length / 4; index++) {
      const value = audio.readFloatLE(index * 4), angle = 2 * Math.PI * frequency * index / 48000;
      sin += value * Math.sin(angle); cos += value * Math.cos(angle);
    }
    return Math.hypot(sin, cos);
  };
  assert.ok(magnitude(880) > magnitude(220) * 100, "Only replacement narration should be audible");
  console.log(`${aspectRatio}: 180 frames, 6 seconds, narration-only audio, pixel checks ${JSON.stringify(scores)}`);
}
console.log(`Artifacts: ${workspace}`);
