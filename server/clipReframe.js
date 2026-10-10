// AI reframe for clips: a vision model reads a few frames, picks a layout, and
// marks faces and regions; buildReframeFilter turns that into an FFmpeg graph.
import fs from "node:fs/promises";
import path from "node:path";
import { requestOpenRouter } from "../src/utils/openRouterClient.js";
import { creatorCommand } from "./creatorWorkspace.js";

export const REFRAME_LAYOUTS = ["single", "split", "screen", "gameplay", "action"];
const MAX_FRAMES = 20;
const FRAME_EVERY = 1.5;

// Fractions in, a clean box out (or null).
function cleanBox(box) {
  if (!box || typeof box !== "object") return null;
  const n = (v) => Number(v);
  let [x, y, w, h] = [n(box.x), n(box.y), n(box.w), n(box.h)];
  if (![x, y, w, h].every(Number.isFinite)) return null;
  x = Math.min(1, Math.max(0, x));
  y = Math.min(1, Math.max(0, y));
  w = Math.min(1 - x, w);
  h = Math.min(1 - y, h);
  return w >= 0.01 && h >= 0.01 ? { x, y, w, h } : null;
}

// Model JSON + the frame times → { layout, frames: [{ t, subject, faces, facecam, content }] }.
export function normalizeFramingAnalysis(value, times) {
  const layout = REFRAME_LAYOUTS.includes(value?.layout) ? value.layout : "single";
  const list = Array.isArray(value?.frames) ? value.frames : [];
  const frames = times.map((t, i) => {
    const raw = list.find((f) => Number(f?.i) === i + 1) || list[i] || {};
    return {
      t,
      subject: cleanBox(raw.subject),
      faces: (Array.isArray(raw.faces) ? raw.faces : []).map(cleanBox).filter(Boolean).slice(0, 2),
      facecam: cleanBox(raw.facecam),
      content: cleanBox(raw.content),
    };
  });
  return { layout, frames };
}

async function probeSize(command, source, signal) {
  const probe = JSON.parse(await command(process.env.FFPROBE_PATH || "ffprobe", [
    "-v", "error", "-select_streams", "v:0",
    "-show_entries", "stream=width,height:stream_tags=rotate:stream_side_data=rotation", "-of", "json", source,
  ], signal));
  const stream = probe.streams?.[0] || {};
  const rotation = Math.abs(Number(stream.tags?.rotate ?? stream.side_data_list?.find((d) => d.rotation !== undefined)?.rotation) || 0) % 180;
  const width = Number(stream.width), height = Number(stream.height);
  // FFmpeg autorotates, so a portrait phone video is framed upright.
  return rotation === 90 ? { width: height, height: width } : { width, height };
}

// Samples the clip and asks the vision model how to frame it.
export async function analyzeClipFraming({ source, start, end, dir, signal, command = creatorCommand, request = requestOpenRouter }) {
  const length = Math.max(0.5, end - start);
  const every = Math.max(FRAME_EVERY, length / MAX_FRAMES);
  const frameDir = await fs.mkdtemp(path.join(dir, "reframe-"));
  try {
    const { width, height } = await probeSize(command, source, signal);
    await command(process.env.FFMPEG_PATH || "ffmpeg", [
      "-y", "-v", "error", "-ss", start.toFixed(2), "-i", source, "-t", length.toFixed(2),
      "-vf", `fps=1/${every.toFixed(3)},scale=512:-2`, "-frames:v", String(MAX_FRAMES), "-q:v", "6",
      path.join(frameDir, "frame-%02d.jpg"),
    ], signal);
    const names = (await fs.readdir(frameDir)).filter((name) => name.endsWith(".jpg")).sort();
    if (!names.length) throw new Error("No frames could be read");
    const times = names.map((_, i) => Math.min(length, i * every));
    const images = await Promise.all(names.map((name) => fs.readFile(path.join(frameDir, name))));
    const content = [{
      type: "text",
      text: `These are ${images.length} frames from one ${length.toFixed(1)}s video clip that will be reframed for a vertical phone screen. Frame N is at the time shown before it.
Pick one layout for the whole clip:
- "single": one main speaker or subject to follow.
- "split": two speakers who both matter (an interview or podcast seen together).
- "screen": a speaker facecam plus a shared screen or slides.
- "gameplay": a streamer facecam plus game footage.
- "action": no talking head; follow the main moving subject (sports, wildlife, vehicles).
For every frame give boxes as fractions of the frame: x and y are the top-left corner, w and h the size.
- "subject": the person speaking or the main subject (single, action).
- "faces": the two speakers' faces, left to right (split).
- "facecam": the webcam or camera region showing the person (screen, gameplay).
- "content": the shared screen, slides or game region (screen, gameplay).
Use null or [] when a region is not visible. Return JSON only:
{"layout":"single","frames":[{"i":1,"subject":{"x":0.4,"y":0.1,"w":0.2,"h":0.3},"faces":[],"facecam":null,"content":null}]}`,
    }];
    images.forEach((bytes, i) => {
      content.push({ type: "text", text: `Frame ${i + 1} at ${times[i].toFixed(1)}s` });
      content.push({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${bytes.toString("base64")}` } });
    });
    const { value } = await request({
      kind: "vision",
      json: true,
      maxTokens: 4000,
      temperature: 0,
      signal,
      timeoutMs: 120000,
      messages: [{ role: "user", content }],
      validate: (v) => {
        if (!Array.isArray(v?.frames)) throw new Error("No frames returned");
      },
    });
    return { ...normalizeFramingAnalysis(value, times), width, height };
  } finally {
    await fs.rm(frameDir, { recursive: true, force: true }).catch(() => {});
  }
}

const even = (v) => Math.max(2, 2 * Math.floor(v / 2));
const num = (v, places = 3) => String(Number(v.toFixed(places)));
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : NaN;
};

// Fills gaps in a sparse track by holding/interpolating neighbours. Null when empty.
function fillTrack(values) {
  const known = values.map((v, i) => (Number.isFinite(v) ? i : -1)).filter((i) => i >= 0);
  if (!known.length) return null;
  return values.map((v, i) => {
    if (Number.isFinite(v)) return v;
    const before = known.filter((k) => k < i).pop();
    const after = known.find((k) => k > i);
    if (before === undefined) return values[after];
    if (after === undefined) return values[before];
    return values[before] + (values[after] - values[before]) * (i - before) / (after - before);
  });
}

// Turns raw window positions into calm camera keyframes: holds small drift,
// cuts on big jumps (a new speaker), eases the rest and caps pan speed.
export function smoothPath(times, positions, { max, window, maxSpeed }) {
  const clamp = (v) => Math.min(max, Math.max(0, v));
  const raw = positions.map(clamp);
  const dead = window * 0.06;
  const held = [];
  for (const v of raw) held.push(held.length && Math.abs(v - held[held.length - 1]) < dead ? held[held.length - 1] : v);
  // Split into shots at jumps of over half the window; smooth within each.
  const shots = [[0]];
  for (let i = 1; i < held.length; i++) {
    if (Math.abs(held[i] - held[i - 1]) > window * 0.5) shots.push([i]);
    else shots[shots.length - 1].push(i);
  }
  const keys = [];
  for (const shot of shots) {
    const eased = shot.map((idx, k) => {
      const prev = held[shot[Math.max(0, k - 1)]], next = held[shot[Math.min(shot.length - 1, k + 1)]];
      return (prev + 2 * held[idx] + next) / 4;
    });
    for (let k = 1; k < eased.length; k++) {
      const step = maxSpeed * (times[shot[k]] - times[shot[k - 1]]);
      eased[k] = Math.min(eased[k - 1] + step, Math.max(eased[k - 1] - step, eased[k]));
    }
    shot.forEach((idx, k) => {
      const v = Math.round(clamp(eased[k]));
      // A cut: hold the old shot until halfway to the new frame, then jump.
      if (k === 0 && keys.length) keys.push({ t: (times[idx - 1] + times[idx]) / 2, v: keys[keys.length - 1].v }, { t: (times[idx - 1] + times[idx]) / 2, v });
      else keys.push({ t: times[idx], v });
    });
  }
  return keys;
}

// A flat (unnested) piecewise-linear expression of t through the keyframes.
export function pathExpression(keys) {
  if (!keys.length) return "0";
  let expr = num(keys[0].v, 0);
  for (let i = 1; i < keys.length; i++) {
    const a = keys[i - 1], b = keys[i];
    const delta = b.v - a.v;
    if (!delta) continue;
    const span = b.t - a.t;
    const sign = delta > 0 ? "+" : "-";
    if (span <= 0.001) expr += `${sign}${num(Math.abs(delta), 0)}*gte(t,${num(a.t)})`;
    else expr += `${sign}${num(Math.abs(delta) / span, 4)}*clip(t-${num(a.t)},0,${num(span)})`;
  }
  return expr;
}

function centreCrop(outW, outH, label) {
  return { filter: `[0:v]crop='min(iw,ih*${outW}/${outH})':'min(ih,iw*${outH}/${outW})',scale=${outW}:${outH},setsar=1${label}`, label, layout: "centre" };
}

// A moving crop of a fixed size whose centre follows the track.
function followCrop(frames, pick, { W, H, cw, ch, anchorY, maxSpeed }) {
  const times = frames.map((f) => f.t);
  const boxes = frames.map(pick);
  const xs = fillTrack(boxes.map((b) => (b ? (b.x + b.w / 2) * W - cw / 2 : NaN)));
  const ys = fillTrack(boxes.map((b) => (b ? (b.y + b.h * anchorY) * H - ch / 2 : NaN)));
  if (!xs || !ys) return null;
  const x = cw < W ? pathExpression(smoothPath(times, xs, { max: W - cw, window: cw, maxSpeed: maxSpeed * cw })) : "0";
  const y = ch < H ? pathExpression(smoothPath(times, ys, { max: H - ch, window: ch, maxSpeed: maxSpeed * ch })) : "0";
  return `crop=w=${cw}:h=${ch}:x='${x}':y='${y}'`;
}

// Window of a panel's aspect that fits inside the source.
function fitWindow(W, H, aspect) {
  const ch = Math.min(H, W / aspect);
  return { cw: even(Math.min(W, ch * aspect)), ch: even(ch) };
}

function staticRegion(frames, key) {
  const boxes = frames.map((f) => f[key]).filter(Boolean);
  if (!boxes.length) return null;
  return cleanBox({ x: median(boxes.map((b) => b.x)), y: median(boxes.map((b) => b.y)), w: median(boxes.map((b) => b.w)), h: median(boxes.map((b) => b.h)) });
}

// Crops a region (fractions) to exactly fill a panel, cropping the long side.
function fillRegion(box, W, H, pw, ph) {
  const rw = Math.max(2, box.w * W), rh = Math.max(2, box.h * H);
  const aspect = pw / ph;
  const cw = Math.min(rw, rh * aspect), ch = Math.min(rh, rw / aspect);
  const x = Math.max(0, Math.min(W - cw, box.x * W + (rw - cw) / 2));
  const y = Math.max(0, Math.min(H - ch, box.y * H + (rh - ch) / 2));
  return `crop=${even(cw)}:${even(ch)}:${Math.floor(x)}:${Math.floor(y)},scale=${pw}:${ph},setsar=1`;
}

// Pure: analysis + source size → { filter, label } ending at outW x outH.
/** @param {any} analysis @param {{ width?: number, height?: number, duration?: number, outW?: number, outH?: number, label?: string }} [options] */
export function buildReframeFilter(analysis, { width, height, duration, outW = 720, outH = 1280, label = "[framed]" } = {}) {
  const W = Number(width), H = Number(height);
  const frames = (analysis?.frames || []).filter((f) => Number.isFinite(f?.t) && f.t >= 0 && (!duration || f.t <= duration + 1));
  if (!(W > 0 && H > 0) || !frames.length || !REFRAME_LAYOUTS.includes(analysis?.layout)) return centreCrop(outW, outH, label);
  const { layout } = analysis;
  // Pan at most this many window-widths per second.
  const maxSpeed = layout === "action" ? 0.9 : 0.5;

  const single = (pickLayout) => {
    const { cw, ch } = fitWindow(W, H, outW / outH);
    const pick = (f) => f.subject || f.faces[0] || f.facecam || null;
    // Faces sit a little above centre; moving subjects stay centred.
    const crop = followCrop(frames, pick, { W, H, cw, ch, anchorY: pickLayout === "action" ? 0.5 : 0.8, maxSpeed });
    return crop ? { filter: `[0:v]${crop},scale=${outW}:${outH},setsar=1${label}`, label, layout: pickLayout } : centreCrop(outW, outH, label);
  };

  if (layout === "single" || layout === "action") return single(layout);

  if (layout === "split") {
    const pw = outW, ph = even(outH / 2), ph2 = outH - ph;
    // Left/right speaker tracks; a lone face goes to the nearer track.
    const left = [], right = [];
    for (const f of frames) {
      const faces = [...f.faces].sort((a, b) => a.x + a.w / 2 - (b.x + b.w / 2));
      if (faces.length >= 2) {
        left.push(faces[0]);
        right.push(faces[1]);
      } else if (faces.length === 1) {
        const onLeft = faces[0].x + faces[0].w / 2 < 0.5;
        left.push(onLeft ? faces[0] : null);
        right.push(onLeft ? null : faces[0]);
      } else {
        left.push(null);
        right.push(null);
      }
    }
    if (!left.some(Boolean) || !right.some(Boolean)) return single("single");
    // Head-and-shoulders window sized from the typical face height.
    const faceH = median([...left, ...right].filter(Boolean).map((b) => b.h)) * H;
    const aspect = pw / ph;
    let ch = Math.min(H, Math.max(H * 0.3, faceH * 2.6));
    let cw = ch * aspect;
    if (cw > W) {
      cw = W;
      ch = W / aspect;
    }
    const size = { W, H, cw: even(cw), ch: even(ch), anchorY: 0.7, maxSpeed };
    const top = followCrop(frames.map((f, i) => ({ ...f, a: left[i] })), (f) => f.a, size);
    const bottom = followCrop(frames.map((f, i) => ({ ...f, b: right[i] })), (f) => f.b, size);
    if (!top || !bottom) return single("single");
    return {
      filter: `[0:v]split=2[rfa][rfb];[rfa]${top},scale=${pw}:${ph},setsar=1[rft];[rfb]${bottom},scale=${pw}:${ph2},setsar=1[rfm];[rft][rfm]vstack,setsar=1${label}`,
      label,
      layout,
    };
  }

  // screen / gameplay: facecam on top, the content below.
  const facecam = staticRegion(frames, "facecam");
  if (!facecam) return single("single");
  const content = staticRegion(frames, "content") || { x: 0, y: 0, w: 1, h: 1 };
  const ph = even(outH * 0.4), ph2 = outH - ph;
  const camera = fillRegion(facecam, W, H, outW, ph);
  // Slides stay whole over a blurred fill so text isn't cut off; games fill.
  const lower = layout === "screen"
    ? `crop=${even(content.w * W)}:${even(content.h * H)}:${Math.floor(content.x * W)}:${Math.floor(content.y * H)},split=2[rfbg][rffg];[rfbg]scale=${outW}:${ph2}:force_original_aspect_ratio=increase,crop=${outW}:${ph2},gblur=sigma=24[rfbg2];[rffg]scale=${outW}:${ph2}:force_original_aspect_ratio=decrease[rffg2];[rfbg2][rffg2]overlay=(W-w)/2:(H-h)/2,setsar=1`
    : fillRegion(content, W, H, outW, ph2);
  return {
    filter: `[0:v]split=2[rfa][rfb];[rfa]${camera}[rft];[rfb]${lower}[rfm];[rft][rfm]vstack,setsar=1${label}`,
    label,
    layout,
  };
}
