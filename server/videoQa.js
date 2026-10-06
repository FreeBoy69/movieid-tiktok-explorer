// A quality gate for finished videos, adapted from showtime's `qa` (github.com/FavioVazquez/showtime, MIT):
// one ffmpeg pass measures loudness, true peak, loudness range, black and frozen stretches, and dead air;
// caption cues are checked for line length, reading speed, and flashes; the file for the platform's specs.
// Each finding is PASS, WARN, or FAIL with the time it happens and what to do. A FAIL holds an automated
// upload; a WARN is shown next to the video.
//
// Thresholds follow showtime's references/qa.md and captions_rules.py:
//   loudness  -14 LUFS integrated: WARN past 1 LU off, FAIL past 3 LU; true peak above -1 dBTP WARNs
//   black     an unplanned black run of 0.5 s or more WARNs (frame 0 black too: it is the thumbnail)
//   frozen    no visible change for 2.5 s WARNs, 6 s FAILs
//   quiet     near silence over 2 s mid-video WARNs; sound still playing on the last frame WARNs
//   captions  at most 2 lines, 42 characters a line (32 vertical), 20 characters a second for 3+ words,
//             no cue under 0.4 s
import { spawn } from "node:child_process";

export const QA_LIMITS = {
  lufs: -14,
  lufsWarn: 1,
  lufsFail: 3,
  truePeak: -1,
  blackSeconds: 0.5,
  frozenWarn: 2.5,
  frozenFail: 6,
  quietSeconds: 2,
  captionLines: 2,
  captionChars: 42,
  captionCharsVertical: 32,
  captionCps: 20,
  captionCpsMinWords: 3,
  captionFlash: 0.4,
};

// What each platform accepts (duration in seconds).
export const PLATFORMS = {
  "youtube-shorts": { name: "YouTube Shorts", vertical: true, maxSeconds: 180, minHeight: 720 },
  youtube: { name: "YouTube", maxSeconds: 12 * 3600, minHeight: 720 },
  tiktok: { name: "TikTok", vertical: true, maxSeconds: 600, minHeight: 720 },
  instagram: { name: "Instagram Reels", vertical: true, maxSeconds: 180, minHeight: 720 },
};

const round = (value, places = 2) => Math.round(value * 10 ** places) / 10 ** places;
const finding = (level, rule, message, extra = {}) => ({ level, rule, message, ...extra });

/** Parses ffmpeg's stderr from the measurement pass into numbers. */
export function parseMeasurements(stderr) {
  const text = String(stderr || "");
  const summary = text.slice(text.lastIndexOf("Summary:"));
  const num = (re, source = summary) => {
    const m = source.match(re);
    return m ? Number(m[1]) : null;
  };
  const pairs = (startRe, endRe) => {
    const starts = [...text.matchAll(startRe)].map((m) => Number(m[1]));
    const ends = [...text.matchAll(endRe)].map((m) => Number(m[1]));
    return starts.map((start, i) => ({ start, end: ends[i] ?? null }));
  };
  const black = [...text.matchAll(/black_start:([\d.]+) black_end:([\d.]+)/g)].map((m) => ({ start: Number(m[1]), end: Number(m[2]) }));
  return {
    lufs: num(/I:\s+(-?[\d.]+) LUFS/),
    lra: num(/LRA:\s+(-?[\d.]+) LU/),
    truePeak: num(/Peak:\s+(-?[\d.]+|-inf) dBFS/),
    black,
    frozen: pairs(/freeze_start: ([\d.]+)/g, /freeze_end: ([\d.]+)/g),
    silence: pairs(/silence_start: (-?[\d.]+)/g, /silence_end: ([\d.]+)/g),
    // The last 0.15 s, when the caller measured it in the same text (scripts/movie_recap.py does).
    tailRms: (() => {
      const rms = [...text.matchAll(/RMS level dB:\s*(-?[\d.]+|-inf)/g)].pop();
      return rms ? (rms[1] === "-inf" ? -120 : Number(rms[1])) : null;
    })(),
  };
}

/** Findings from the measurements, the file's stream info, and (optionally) its caption cues. */
export function judgeVideo({ measurements, info, cues = [], platform = "", expect = {} }) {
  const out = [];
  const L = QA_LIMITS;
  const duration = Number(info?.duration) || 0;
  const vertical = info?.height > info?.width;
  const m = measurements || {};

  // File and platform
  if (info?.video && info.video !== "h264") out.push(finding("WARN", "codec", `Video is ${info.video}, not H.264; some players and platforms re-encode or refuse it.`));
  if (info?.pixFmt && info.pixFmt !== "yuv420p") out.push(finding("WARN", "pixel_format", `Pixel format is ${info.pixFmt}; use yuv420p so every player shows it.`));
  if (!info?.audio) out.push(finding("WARN", "no_audio", "The video has no sound."));
  if (expect.duration && Math.abs(duration - expect.duration) > 1 / (info?.fps || 30) + 0.05)
    out.push(finding("WARN", "duration", `The video runs ${round(duration)} s; ${round(expect.duration)} s was expected.`));
  const spec = PLATFORMS[platform];
  if (spec) {
    if (duration > spec.maxSeconds) out.push(finding("FAIL", "too_long", `${spec.name} takes up to ${spec.maxSeconds} s; this runs ${round(duration)} s.`));
    if (spec.vertical && !vertical) out.push(finding("WARN", "not_vertical", `${spec.name} is vertical (9:16); this video is ${info.width}x${info.height}.`));
    if (Math.min(info?.width || 0, info?.height || 0) < spec.minHeight) out.push(finding("WARN", "low_resolution", `${info.width}x${info.height} is below ${spec.minHeight}p; it will look soft.`));
  }

  // Sound
  if (info?.audio && m.lufs != null) {
    const off = Math.abs(m.lufs - L.lufs);
    if (off > L.lufsFail) out.push(finding("FAIL", "loudness", `Loudness is ${round(m.lufs, 1)} LUFS; aim for ${L.lufs} (${m.lufs > L.lufs ? "too loud" : "too quiet"}).`));
    else if (off > L.lufsWarn) out.push(finding("WARN", "loudness", `Loudness is ${round(m.lufs, 1)} LUFS; aim for ${L.lufs}.`));
  }
  if (info?.audio && m.truePeak != null && m.truePeak > L.truePeak) out.push(finding("WARN", "true_peak", `Peaks reach ${round(m.truePeak, 1)} dBTP and may clip after upload; keep them under ${L.truePeak}.`));
  for (const run of m.silence || []) {
    const end = run.end ?? duration;
    // Leading and trailing silence are fades; mid-video dead air is the problem.
    if (run.start > 0.5 && end < duration - 0.5 && end - run.start >= L.quietSeconds)
      out.push(finding("WARN", "quiet_stretch", `Near silence for ${round(end - run.start, 1)} s.`, { at: round(run.start) }));
  }
  // The last 0.15 s should have faded out: louder than -40 dB there is sound cut off mid-decay.
  if (info?.audio && m.tailRms != null && m.tailRms > -40) out.push(finding("WARN", "abrupt_end", "Sound is still playing on the last frame; fade it out or end on a button.", { at: round(duration) }));

  // Picture
  for (const run of m.black || []) {
    if (run.end - run.start >= L.blackSeconds || run.start < 0.04)
      out.push(finding("WARN", "black", run.start < 0.04 ? "The first frame is black (it is the thumbnail)." : `Black for ${round(run.end - run.start, 1)} s.`, { at: round(run.start) }));
  }
  for (const run of m.frozen || []) {
    const length = (run.end ?? duration) - run.start;
    const last = (run.end ?? duration) >= duration - 0.1;
    // A held end card is designed; a frozen middle is not.
    if (last && length < L.frozenFail) continue;
    if (length >= L.frozenFail) out.push(finding("FAIL", "frozen", `The picture doesn't change for ${round(length, 1)} s.`, { at: round(run.start) }));
    else if (length >= L.frozenWarn) out.push(finding("WARN", "frozen", `The picture doesn't change for ${round(length, 1)} s.`, { at: round(run.start) }));
  }

  // Captions
  const maxChars = vertical ? L.captionCharsVertical : L.captionChars;
  let flashes = 0;
  for (const cue of cues) {
    const lines = String(cue.text || "").split(/\n/);
    const text = lines.join(" ").trim();
    const seconds = Number(cue.end) - Number(cue.start);
    if (!text || !(seconds > 0)) continue;
    if (lines.length > L.captionLines) out.push(finding("WARN", "caption_lines", `A caption runs ${lines.length} lines: "${text.slice(0, 40)}"`, { at: round(cue.start) }));
    const longest = Math.max(...lines.map((line) => line.length));
    if (longest > maxChars) out.push(finding("WARN", "caption_long", `A caption line has ${longest} characters (${maxChars} fit): "${text.slice(0, 40)}"`, { at: round(cue.start) }));
    if (text.split(/\s+/).length >= L.captionCpsMinWords && text.length / seconds > L.captionCps)
      out.push(finding("WARN", "caption_fast", `A caption needs ${round(text.length / seconds, 1)} characters a second to read (${L.captionCps} max): "${text.slice(0, 40)}"`, { at: round(cue.start) }));
    if (seconds < L.captionFlash) flashes++;
  }
  if (flashes) out.push(finding("WARN", "caption_flash", `${flashes} caption${flashes === 1 ? " is" : "s are"} on screen under ${L.captionFlash} s.`));

  const verdict = out.some((f) => f.level === "FAIL") ? "FAIL" : out.some((f) => f.level === "WARN") ? "WARN" : "PASS";
  return { verdict, findings: out, numbers: { duration: round(duration), lufs: m.lufs, truePeak: m.truePeak, lra: m.lra, width: info?.width, height: info?.height, fps: info?.fps } };
}

function run(program, args, { timeoutMs = 20 * 60 * 1000, signal } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    const abort = () => child.kill("SIGKILL");
    signal?.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (chunk) => { out += chunk; });
    child.stderr.on("data", (chunk) => { err += chunk; });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      resolve({ code, out, err });
    });
  });
}

/** Stream facts from ffprobe: codec, size, fps, pixel format, duration, audio. */
export async function probeVideo(file, { signal } = {}) {
  const { out } = await run(process.env.FFPROBE_PATH || "ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_type,codec_name,width,height,pix_fmt,avg_frame_rate", "-of", "json", file], { timeoutMs: 120000, signal });
  const data = JSON.parse(out || "{}");
  const video = (data.streams || []).find((s) => s.codec_type === "video");
  const audio = (data.streams || []).find((s) => s.codec_type === "audio");
  const [n, d] = String(video?.avg_frame_rate || "30/1").split("/").map(Number);
  return { duration: Number(data.format?.duration) || 0, width: video?.width || 0, height: video?.height || 0, fps: d ? n / d : n, video: video?.codec_name || "", pixFmt: video?.pix_fmt || "", audio: audio?.codec_name || "" };
}

/** Runs the gate on a finished video. Never throws for a video it can read; returns {verdict, findings, numbers}. */
export async function checkVideo(file, { cues = [], platform = "", expect = {}, signal } = {}) {
  const info = await probeVideo(file, { signal });
  const filters = [];
  const args = ["-hide_banner", "-nostats", "-i", file];
  if (info.audio) filters.push("[0:a]ebur128=peak=true,silencedetect=noise=-50dB:d=0.3[a]");
  filters.push("[0:v]fps=10,scale=320:-2,blackdetect=d=0.1:pix_th=0.08,freezedetect=n=0.002:d=2[v]");
  args.push("-filter_complex", filters.join(";"), ...(info.audio ? ["-map", "[a]", "-f", "null", "-"] : []), "-map", "[v]", "-f", "null", "-");
  const { err } = await run(process.env.FFMPEG_PATH || "ffmpeg", args, { signal });
  const measurements = parseMeasurements(err);
  if (info.audio) {
    const tail = await run(process.env.FFMPEG_PATH || "ffmpeg", ["-hide_banner", "-nostats", "-sseof", "-0.15", "-i", file, "-vn", "-af", "astats=measure_perchannel=none", "-f", "null", "-"], { timeoutMs: 120000, signal });
    const rms = tail.err.match(/RMS level dB:\s*(-?[\d.]+|-inf)/);
    measurements.tailRms = rms ? (rms[1] === "-inf" ? -120 : Number(rms[1])) : null;
  }
  return judgeVideo({ measurements, info, cues, platform, expect });
}
