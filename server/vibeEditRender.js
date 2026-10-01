// Builds the ffmpeg command that renders a Vibe Edit project to MP4. Pure: it
// takes the project, local paths for each asset, which videos carry sound, and
// an optional concat list of full-frame transparent PNGs (titles + captions,
// drawn by the browser with the same code the preview uses, so no libass is
// needed), and returns the argument list.
import { soundFilters } from "../src/utils/vibeSound.js";

const FPS = 30;
const SIZES = { "16:9": [1920, 1080], "9:16": [1080, 1920], "1:1": [1080, 1080], "4:5": [1080, 1350] };
const n = (v) => String(Math.round(Number(v) * 1000) / 1000);
const len = (c) => Math.max(0.05, c.out - c.in);
const end = (c) => c.start + len(c);

export function renderSize(aspect) {
  return SIZES[aspect] || SIZES["9:16"];
}

export function renderDuration(project) {
  const ends = [
    ...project.clips.map(end),
    ...project.audio.map(end),
    ...project.texts.map((t) => t.end),
    ...(project.captions?.cues || []).map((c) => c.end),
  ];
  return Math.max(0.5, ...ends, 0);
}

/** Time windows where a ducking clip (voiceover) plays, with its gain. */
export function duckWindows(project) {
  return project.audio
    .filter((c) => typeof c.duck === "number" && c.duck < 1)
    .map((c) => ({ id: c.id, from: c.start, to: end(c), gain: Math.max(0, c.duck) }));
}

const hexColor = (c) => (/^#[0-9a-f]{6}$/i.test(String(c)) ? String(c).slice(1) : "000000");

/**
 * @param {object} o
 * @param {object} o.project normalized VibeProject
 * @param {(asset: object) => string|null} o.pathOf local file for an asset
 * @param {Set<string>|string[]} [o.audible] asset ids whose video has an audio stream
 * @param {string|null} [o.overlayList] concat-demuxer list of overlay PNGs
 * @param {string} o.output
 */
export function buildRenderArgs({ project, pathOf, audible = [], overlayList = null, output }) {
  const [W, H] = renderSize(project.aspect);
  const D = renderDuration(project);
  const hasSound = new Set(audible);
  const assets = new Map(project.assets.map((a) => [a.id, a]));
  const args = ["-y", "-hide_banner", "-loglevel", "error"];
  const filters = [];
  let input = 0;

  filters.push(`color=c=0x${hexColor(project.background)}:s=${W}x${H}:r=${FPS}:d=${n(D)},format=yuv420p[base]`);
  let last = "base";

  const audioSources = [];
  const visuals = [...project.clips].sort((a, b) => a.track - b.track || a.start - b.start);
  for (const clip of visuals) {
    const asset = assets.get(clip.assetId);
    const file = asset && pathOf(asset);
    if (!file) continue;
    const i = input++;
    if (asset.kind === "image") args.push("-loop", "1", "-framerate", String(FPS), "-t", n(len(clip)), "-i", file);
    else args.push("-ss", n(clip.in), "-t", n(len(clip)), "-i", file);
    const scale = clip.fit === "fill"
      ? `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}`
      : `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black@0`;
    filters.push(`[${i}:v]fps=${FPS},${scale},setsar=1,format=yuva420p,setpts=PTS-STARTPTS+${n(clip.start)}/TB[v${i}]`);
    filters.push(`[${last}][v${i}]overlay=eof_action=pass:enable='between(t,${n(clip.start)},${n(end(clip) - 0.001)})'[o${i}]`);
    last = `o${i}`;
    if (asset.kind === "video" && !clip.muted && (clip.volume ?? 1) > 0 && hasSound.has(asset.id)) {
      audioSources.push({ label: `${i}:a`, start: clip.start, end: end(clip), volume: clip.volume ?? 1, duck: undefined, id: clip.id });
    }
  }

  if (overlayList) {
    const i = input++;
    args.push("-f", "concat", "-safe", "0", "-i", overlayList);
    filters.push(`[${i}:v]format=rgba,setpts=PTS-STARTPTS[ovl]`);
    filters.push(`[${last}][ovl]overlay=eof_action=pass:format=auto[ovo]`);
    last = "ovo";
  }
  filters.push(`[${last}]format=yuv420p,trim=duration=${n(D)}[vout]`);

  for (const clip of project.audio) {
    const asset = assets.get(clip.assetId);
    const file = asset && pathOf(asset);
    if (!file || clip.volume <= 0) continue;
    const i = input++;
    args.push("-ss", n(clip.in), "-t", n(len(clip)), "-i", file);
    audioSources.push({ label: `${i}:a`, start: clip.start, end: end(clip), volume: clip.volume, duck: clip.duck, id: clip.id, fadeIn: clip.fadeIn, fadeOut: clip.fadeOut, preset: clip.preset });
  }

  const ducks = duckWindows(project);
  const mixed = audioSources.map((src, k) => {
    const chain = [`aresample=48000`, `aformat=sample_fmts=fltp:channel_layouts=stereo`, `asetpts=PTS-STARTPTS`];
    const fx = soundFilters(src.preset);
    if (fx) chain.push(fx);
    if (src.volume !== 1) chain.push(`volume=${n(src.volume)}`);
    const length = src.end - src.start;
    if (src.fadeIn > 0) chain.push(`afade=t=in:st=0:d=${n(Math.min(src.fadeIn, length))}`);
    if (src.fadeOut > 0) chain.push(`afade=t=out:st=${n(Math.max(0, length - src.fadeOut))}:d=${n(Math.min(src.fadeOut, length))}`);
    const ms = Math.round(src.start * 1000);
    if (ms > 0) chain.push(`adelay=${ms}:all=1`);
    // Everything that does not duck drops under each voiceover window.
    if (src.duck === undefined) {
      for (const w of ducks) {
        if (w.to <= src.start || w.from >= src.end) continue;
        chain.push(`volume=${n(w.gain)}:enable='between(t,${n(w.from)},${n(w.to)})'`);
      }
    }
    filters.push(`[${src.label}]${chain.join(",")}[a${k}]`);
    return `[a${k}]`;
  });
  if (mixed.length) {
    filters.push(`${mixed.join("")}amix=inputs=${mixed.length}:normalize=0:duration=longest,alimiter=limit=0.97:level=false,apad,atrim=duration=${n(D)}[aout]`);
  } else {
    filters.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${n(D)}[aout]`);
  }

  args.push(
    "-filter_complex", filters.join(";"),
    "-map", "[vout]", "-map", "[aout]",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-r", String(FPS),
    "-c:a", "aac", "-b:a", "192k",
    "-movflags", "+faststart",
    "-t", n(D),
    output,
  );
  return { args, duration: D, width: W, height: H };
}

/** Concat-demuxer list for overlay frames: each PNG holds until the next one.
 * `frames` are sorted, non-overlapping { t0, t1, file }; gaps get `blank`. */
export function overlayConcatList(frames, blank, duration) {
  const lines = ["ffconcat version 1.0"];
  let cursor = 0;
  const push = (file, d) => {
    if (d <= 0.0005) return;
    lines.push(`file '${String(file).replace(/'/g, "'\\''")}'`, `duration ${n(d)}`);
  };
  for (const f of [...frames].sort((a, b) => a.t0 - b.t0)) {
    const t0 = Math.max(cursor, f.t0);
    const t1 = Math.min(duration, f.t1);
    if (t1 <= t0) continue;
    push(blank, t0 - cursor);
    push(f.file, t1 - t0);
    cursor = t1;
  }
  push(blank, duration - cursor);
  // The demuxer drops the last entry's duration unless the file repeats.
  const lastFile = lines.filter((l) => l.startsWith("file ")).at(-1) || `file '${blank}'`;
  lines.push(lastFile);
  return lines.join("\n") + "\n";
}
