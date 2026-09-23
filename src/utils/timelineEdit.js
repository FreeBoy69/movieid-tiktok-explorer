// Pure helpers for the video editor timeline: timecode, ruler ticks, snapping,
// and the scene edits (merge, ripple trim) that keep scenes contiguous.

export const TIMELINE_FPS = 30;
export const MIN_SCENE = 0.5;

const pad = (n) => String(n).padStart(2, "0");

// 83.5 -> "01:23:15" (minutes:seconds:frames at 30 fps); hours appear past 60 minutes.
export function timecode(seconds, fps = TIMELINE_FPS) {
  const total = Math.max(0, Math.round((Number(seconds) || 0) * fps));
  const frames = total % fps;
  const secs = Math.floor(total / fps);
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return `${h ? `${h}:` : ""}${pad(m)}:${pad(s)}:${pad(frames)}`;
}

// Short ruler label: "0:05", "1:20", "1:02:03".
export function rulerLabel(seconds) {
  const secs = Math.round(seconds);
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

const STEPS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
// Labelled tick interval so labels sit at least minGap pixels apart.
export function tickStep(pxPerSecond, minGap = 84) {
  return STEPS.find((step) => step * pxPerSecond >= minGap) || STEPS[STEPS.length - 1];
}

// Ticks between from and to: labelled majors plus four minors between each.
export function rulerTicks(from, to, pxPerSecond) {
  const major = tickStep(pxPerSecond);
  const minor = major / 5;
  const ticks = [];
  const start = Math.max(0, Math.floor(from / minor) * minor);
  for (let i = 0, t = start; t <= to + 1e-6 && i < 2000; i++, t = start + i * minor) {
    const time = Math.round(t * 1000) / 1000;
    const isMajor = Math.abs(time / major - Math.round(time / major)) < 1e-6;
    ticks.push({ time, major: isMajor });
  }
  return ticks;
}

// Nearest candidate within `threshold` seconds, or the value itself.
export function snapTime(value, candidates, threshold) {
  let best = value;
  let distance = threshold;
  for (const candidate of candidates) {
    const gap = Math.abs(candidate - value);
    if (gap <= distance) {
      best = candidate;
      distance = gap;
    }
  }
  return { time: best, snapped: best !== value };
}

const excerpt = (lines, start, end) =>
  lines
    .filter((line) => line.start >= start - 0.01 && line.start < end - 0.01)
    .map((line) => line.text)
    .join(" ")
    .trim();

// Joins scene `index` with the next one. The first scene keeps its image and prompt.
export function mergeScenes(scenes, index, lines = []) {
  if (index < 0 || index >= scenes.length - 1) throw new Error("Pick a scene that has another scene after it");
  const a = scenes[index];
  const b = scenes[index + 1];
  const text = excerpt(lines, a.start, b.end) || [a.text, b.text].filter(Boolean).join(" ");
  return [...scenes.slice(0, index), { ...a, end: b.end, text }, ...scenes.slice(index + 2)];
}

// Moves the cut between scene `index` and the next, keeping both at least MIN_SCENE long.
export function trimBoundary(scenes, index, time, lines = []) {
  if (index < 0 || index >= scenes.length - 1) return scenes;
  const a = scenes[index];
  const b = scenes[index + 1];
  const cut = Math.min(b.end - MIN_SCENE, Math.max(a.start + MIN_SCENE, Math.round(time * 100) / 100));
  if (cut === a.end) return scenes;
  const next = [...scenes];
  next[index] = { ...a, end: cut, text: excerpt(lines, a.start, cut) || a.text };
  next[index + 1] = { ...b, start: cut, text: excerpt(lines, cut, b.end) || b.text };
  return next;
}

// Cuts scene `index` at `time`. The right half keeps the prompt but needs its own image.
export function splitAt(scenes, time, lines = []) {
  const index = scenes.findIndex((scene) => time > scene.start + MIN_SCENE - 1e-6 && time < scene.end - MIN_SCENE + 1e-6);
  if (index < 0) throw new Error(`Move the playhead at least ${MIN_SCENE}s inside a scene to split it`);
  const scene = scenes[index];
  const cut = Math.round(time * 100) / 100;
  let id = `${scene.id}-split-${Math.round(cut * 100)}`;
  while (scenes.some((item) => item.id === id)) id += "x";
  return [
    ...scenes.slice(0, index),
    { ...scene, end: cut, text: excerpt(lines, scene.start, cut) || scene.text },
    { ...scene, id, start: cut, text: excerpt(lines, cut, scene.end) || scene.text, asset: null, clip: null, error: undefined },
    ...scenes.slice(index + 1),
  ];
}

// Ripple delete: the neighbour takes over the removed scene's time, so nothing leaves a gap.
export function removeScene(scenes, index, lines = []) {
  if (scenes.length < 2) throw new Error("A video needs at least one scene");
  if (index < 0 || index >= scenes.length) return scenes;
  if (index > 0) {
    const prev = scenes[index - 1];
    const removed = scenes[index];
    const merged = { ...prev, end: removed.end, text: excerpt(lines, prev.start, removed.end) || [prev.text, removed.text].filter(Boolean).join(" ") };
    return [...scenes.slice(0, index - 1), merged, ...scenes.slice(index + 1)];
  }
  const [first, next, ...rest] = scenes;
  return [{ ...next, start: first.start, text: excerpt(lines, first.start, next.end) || [first.text, next.text].filter(Boolean).join(" ") }, ...rest];
}
