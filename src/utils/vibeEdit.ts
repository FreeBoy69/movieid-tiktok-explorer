// Vibe Edit project model and pure edit operations. Modeled on Donkey Cut's
// ProjectDoc (Apache-2.0, github.com/donkeycut/donkey), trimmed to what this
// editor ships: video/image clips on stacked tracks, soundtrack lanes with
// ducking, text titles, and word-timed captions. Every operation returns a new
// project so the store can keep an undo history by reference.

export type VibeAspect = "16:9" | "9:16" | "1:1" | "4:5";
export const VIBE_ASPECTS: { id: VibeAspect; label: string }[] = [
  { id: "16:9", label: "Landscape" },
  { id: "9:16", label: "Portrait" },
  { id: "1:1", label: "Square" },
  { id: "4:5", label: "Feed" },
];

export type VibeAssetKind = "video" | "audio" | "image";
export type VibeAssetOrigin = "upload" | "link" | "voiceover" | "music" | "generated";

export interface VibeAsset {
  id: string;
  kind: VibeAssetKind;
  name: string;
  url: string;
  /** Studio file name (up-…/gen-…) the server renders from. */
  file?: string;
  /** Source length in seconds; absent for stills. */
  duration?: number;
  width?: number;
  height?: number;
  origin?: VibeAssetOrigin;
  /** BCP-47 tag of what a voiceover speaks. */
  language?: string;
  /** Kept on the media worker ("<project>/<file>"), streamed through a signed link: large recap media. */
  remote?: string;
}

/** A picture on a video track. Track 0 is the base sequence; higher tracks
 * composite in front. `in`/`out` trim the source (stills use 0..length). */
export interface VibeClip {
  id: string;
  assetId: string;
  track: number;
  start: number;
  in: number;
  out: number;
  volume?: number;
  muted?: boolean;
  fit?: "fit" | "fill";
  /** Scale past the frame, centred (1 = none): a punch-in. */
  zoom?: number;
  grade?: VibeGrade;
  /** Treatment for the clip's own sound (vibeSound.js). */
  preset?: string;
  /** An editor's note on the shot ("should show Ned at the party"), used when finding a better one. */
  note?: string;
  /** Flagged for a better shot, to replace with the others in one go. */
  flagged?: boolean;
}

/** Color correction: contrast and saturation are multipliers (1 = none), brightness an offset (-1..1). */
export interface VibeGrade {
  contrast?: number;
  saturation?: number;
  brightness?: number;
}

export interface VibeAudioClip {
  id: string;
  assetId: string;
  lane: number;
  start: number;
  in: number;
  out: number;
  volume: number;
  fadeIn?: number;
  fadeOut?: number;
  /** While this clip plays, everything else drops to this gain (0..1). */
  duck?: number;
  /** Voice treatment preset id (see vibeSound.ts). */
  preset?: string;
  name?: string;
}

export interface VibeText {
  id: string;
  text: string;
  start: number;
  end: number;
  /** Anchor as frame fractions. */
  x: number;
  y: number;
  /** px at a 1080-wide frame. */
  size: number;
  color: string;
  look?: "plain" | "boxed" | "outline";
}

export interface VibeWord {
  t0: number;
  t1: number;
  w: string;
}

export interface VibeCue {
  id: string;
  start: number;
  end: number;
  text: string;
  words?: VibeWord[];
}

/** The editor's own looks ("clean", "hook", "punchy", "minimal", "highlight",
 * "bubble", "neon") or any id from the shared caption catalog (captionStyles.js). */
export type CaptionStyleId = string;

export interface VibeCaptions {
  cues: VibeCue[];
  show: boolean;
  style: CaptionStyleId;
  wordHighlight: boolean;
  /** Vertical anchor as a frame fraction; absent = the style's spot. */
  y?: number;
  /** px at a 1080-wide frame; absent = the style's size. */
  size?: number;
  locale?: string;
}

/** Per-track switches, keyed by trackKey(): "v0", "v1", "a0", "text", "cue". */
export interface VibeTrackState {
  muted?: boolean;
  hidden?: boolean;
  locked?: boolean;
}

export interface VibeProject {
  version: 1;
  id: string;
  name: string;
  aspect: VibeAspect;
  background: string;
  assets: VibeAsset[];
  clips: VibeClip[];
  audio: VibeAudioClip[];
  texts: VibeText[];
  captions: VibeCaptions;
  tracks?: Record<string, VibeTrackState>;
  /** Where the edit came from: a Movie to Recap render can find better shots for its cuts. */
  source?: { kind: "recap"; recapId: string; format: "long" | "short" };
  createdAt: number;
  updatedAt: number;
}

export type VibeSelection =
  | { kind: "clip"; id: string }
  | { kind: "audio"; id: string }
  | { kind: "text"; id: string }
  | { kind: "cue"; id: string };

export type TrackKind = "video" | "audio" | "text" | "cue";
export const trackKey = (kind: TrackKind, row = 0) => (kind === "video" ? `v${row}` : kind === "audio" ? `a${row}` : kind);
export const trackState = (p: VibeProject, key: string): VibeTrackState => p.tracks?.[key] || {};

export function setTrackState(p: VibeProject, key: string, patch: VibeTrackState): VibeProject {
  const next = { ...trackState(p, key), ...patch };
  const tracks = { ...(p.tracks || {}) };
  if (!next.muted && !next.hidden && !next.locked) delete tracks[key];
  else tracks[key] = next;
  return { ...p, tracks, updatedAt: Date.now() };
}

/** The track an item lives on, for lock checks. */
export function itemTrack(p: VibeProject, id: string): string | null {
  const clip = p.clips.find((c) => c.id === id);
  if (clip) return trackKey("video", clip.track);
  const sound = p.audio.find((c) => c.id === id);
  if (sound) return trackKey("audio", sound.lane);
  if (p.texts.some((t) => t.id === id)) return "text";
  if (p.captions.cues.some((c) => c.id === id)) return "cue";
  return null;
}
export const isLocked = (p: VibeProject, id: string) => {
  const key = itemTrack(p, id);
  return Boolean(key && trackState(p, key).locked);
};

export const IMAGE_SECONDS = 5;
export const MIN_ITEM_SECONDS = 0.1;
export const DUCK_DEFAULT = 0.4;

let seq = 0;
export function vibeId(prefix: string): string {
  seq = (seq + 1) % 1e6;
  return `${prefix}_${Date.now().toString(36)}${seq.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

const round = (n: number) => Math.round(n * 1000) / 1000;

export function emptyProject(name = "Untitled edit", aspect: VibeAspect = "9:16"): VibeProject {
  const now = Date.now();
  return {
    version: 1,
    id: vibeId("vp"),
    name,
    aspect,
    background: "#000000",
    assets: [],
    clips: [],
    audio: [],
    texts: [],
    captions: { cues: [], show: true, style: "clean", wordHighlight: true },
    createdAt: now,
    updatedAt: now,
  };
}

/** Repair a project read from storage or produced by a model: drop items that
 * point at missing assets, clamp negative times, and fill required fields. */
export function normalizeProject(raw: Partial<VibeProject> | null | undefined): VibeProject {
  const base = emptyProject();
  if (!raw || typeof raw !== "object") return base;
  const assets = Array.isArray(raw.assets) ? raw.assets.filter((a) => a && a.id && a.url) : [];
  const ids = new Set(assets.map((a) => a.id));
  const fix = <T extends { start: number; in: number; out: number }>(item: T): T => ({
    ...item,
    start: Math.max(0, Number(item.start) || 0),
    in: Math.max(0, Number(item.in) || 0),
    out: Math.max((Number(item.in) || 0) + MIN_ITEM_SECONDS, Number(item.out) || 0),
  });
  const captions = { ...base.captions, ...(raw.captions || {}) };
  captions.cues = Array.isArray(captions.cues) ? captions.cues.filter((c) => c && c.text && c.end > c.start) : [];
  return {
    ...base,
    ...raw,
    version: 1,
    aspect: VIBE_ASPECTS.some((a) => a.id === raw.aspect) ? (raw.aspect as VibeAspect) : base.aspect,
    assets,
    clips: (Array.isArray(raw.clips) ? raw.clips : []).filter((c) => ids.has(c.assetId)).map((c) => fix({ ...c, track: Math.max(0, Math.round(c.track || 0)) })),
    audio: (Array.isArray(raw.audio) ? raw.audio : []).filter((c) => ids.has(c.assetId)).map((c) => fix({ ...c, lane: Math.max(0, Math.round(c.lane || 0)), volume: c.volume ?? 1 })),
    texts: Array.isArray(raw.texts) ? raw.texts.filter((t) => t && t.end > t.start) : [],
    captions,
  };
}

export const clipLength = (c: { in: number; out: number }) => Math.max(0, c.out - c.in);
export const clipEnd = (c: { start: number; in: number; out: number }) => c.start + clipLength(c);

/** Where the last thing on the timeline ends. */
export function projectDuration(p: VibeProject): number {
  const ends = [
    ...p.clips.map(clipEnd),
    ...p.audio.map(clipEnd),
    ...p.texts.map((t) => t.end),
    ...p.captions.cues.map((c) => c.end),
  ];
  return ends.length ? round(Math.max(...ends)) : 0;
}

export const assetById = (p: VibeProject, id: string) => p.assets.find((a) => a.id === id);

function touch(p: VibeProject, patch: Partial<VibeProject>): VibeProject {
  return { ...p, ...patch, updatedAt: Date.now() };
}

/** The end of the given video track (or audio lane), where an append lands. */
export function trackEnd(p: VibeProject, kind: "clip" | "audio", row: number): number {
  const items = kind === "clip" ? p.clips.filter((c) => c.track === row) : p.audio.filter((c) => c.lane === row);
  return items.length ? round(Math.max(...items.map(clipEnd))) : 0;
}

/** The lowest audio lane free for [start, end), adding a new lane when all are taken. */
export function freeLane(p: VibeProject, start: number, end: number): number {
  for (let lane = 0; ; lane++) {
    const busy = p.audio.some((c) => c.lane === lane && c.start < end - 1e-3 && clipEnd(c) > start + 1e-3);
    if (!busy) return lane;
  }
}

export function addAsset(p: VibeProject, asset: VibeAsset): VibeProject {
  if (p.assets.some((a) => a.id === asset.id)) return p;
  return touch(p, { assets: [...p.assets, asset] });
}

export interface PlaceOptions {
  at?: number;
  track?: number;
  lane?: number;
  duck?: number;
  volume?: number;
}

/** Put an asset on the timeline: pictures on a video track (appended to track
 * 0 by default), sound on the first free audio lane at the playhead. Returns
 * the new project and the placed item's id. */
export function placeAsset(p: VibeProject, assetId: string, opts: PlaceOptions = {}): { project: VibeProject; id: string } {
  const asset = assetById(p, assetId);
  if (!asset) return { project: p, id: "" };
  const length = asset.kind === "image" ? IMAGE_SECONDS : Math.max(MIN_ITEM_SECONDS, asset.duration || IMAGE_SECONDS);
  if (asset.kind === "audio") {
    const start = round(Math.max(0, opts.at ?? 0));
    const lane = opts.lane ?? freeLane(p, start, start + length);
    const clip: VibeAudioClip = {
      id: vibeId("a"),
      assetId,
      lane,
      start,
      in: 0,
      out: round(length),
      volume: opts.volume ?? 1,
      ...(opts.duck !== undefined && opts.duck < 1 ? { duck: opts.duck } : {}),
      name: asset.name,
    };
    return { project: touch(p, { audio: [...p.audio, clip] }), id: clip.id };
  }
  const track = Math.max(0, opts.track ?? 0);
  const start = round(Math.max(0, opts.at ?? trackEnd(p, "clip", track)));
  const clip: VibeClip = { id: vibeId("c"), assetId, track, start, in: 0, out: round(length) };
  return { project: touch(p, { clips: [...p.clips, clip] }), id: clip.id };
}

export interface ItemPatch {
  start?: number;
  in?: number;
  out?: number;
  track?: number;
  lane?: number;
  volume?: number;
  muted?: boolean;
  duck?: number | null;
  fadeIn?: number;
  fadeOut?: number;
  preset?: string | null;
  fit?: "fit" | "fill";
  zoom?: number | null;
  grade?: VibeGrade | null;
  note?: string;
  flagged?: boolean;
}

function patchTimed<T extends VibeClip | VibeAudioClip>(item: T, patch: ItemPatch, sourceLength?: number): T {
  const next: Record<string, unknown> = { ...item };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    if (v === null) delete next[k];
    else next[k] = v;
  }
  const out = next as T;
  out.start = round(Math.max(0, out.start));
  out.in = round(Math.max(0, out.in));
  const cap = sourceLength && sourceLength > 0 ? sourceLength : Infinity;
  out.out = round(Math.min(cap, Math.max(out.in + MIN_ITEM_SECONDS, out.out)));
  if ("volume" in out && typeof out.volume === "number") out.volume = Math.min(3, Math.max(0, out.volume));
  if ("zoom" in out && typeof out.zoom === "number") out.zoom = Math.min(2, Math.max(1, out.zoom));
  return out;
}

/** Edit one clip, audio clip, text, or cue by id. Trims are clamped to the
 * source length so a drag can never reach past the media. */
export function updateItem(p: VibeProject, id: string, patch: ItemPatch & Partial<VibeText> & Partial<VibeCue>): VibeProject {
  const lengthOf = (assetId: string) => {
    const a = assetById(p, assetId);
    return a?.kind === "image" ? undefined : a?.duration;
  };
  if (p.clips.some((c) => c.id === id)) {
    return touch(p, { clips: p.clips.map((c) => (c.id === id ? patchTimed(c, patch, lengthOf(c.assetId)) : c)) });
  }
  if (p.audio.some((c) => c.id === id)) {
    return touch(p, { audio: p.audio.map((c) => (c.id === id ? patchTimed(c, patch, lengthOf(c.assetId)) : c)) });
  }
  if (p.texts.some((t) => t.id === id)) {
    return touch(p, {
      texts: p.texts.map((t) => {
        if (t.id !== id) return t;
        const next = { ...t, ...(patch as Partial<VibeText>) };
        next.start = round(Math.max(0, next.start));
        next.end = round(Math.max(next.start + MIN_ITEM_SECONDS, next.end));
        return next;
      }),
    });
  }
  if (p.captions.cues.some((c) => c.id === id)) {
    const cues = p.captions.cues.map((c) => {
      if (c.id !== id) return c;
      const next = { ...c, ...(patch as Partial<VibeCue>) };
      // A hand edit that changes the word count invalidates the word timings.
      if (patch.text !== undefined && c.words && patch.text.trim().split(/\s+/).length !== c.words.length) delete next.words;
      next.start = round(Math.max(0, next.start));
      next.end = round(Math.max(next.start + MIN_ITEM_SECONDS, next.end));
      return next;
    });
    return touch(p, { captions: { ...p.captions, cues } });
  }
  return p;
}

/** Shift an item to a new start (and row), keeping its length. */
export function moveItem(p: VibeProject, id: string, start: number, row?: number): VibeProject {
  const text = p.texts.find((t) => t.id === id);
  if (text) return updateItem(p, id, { start, end: start + (text.end - text.start) });
  const cue = p.captions.cues.find((c) => c.id === id);
  if (cue) {
    const shift = Math.max(0, start) - cue.start;
    return updateItem(p, id, {
      start: cue.start + shift,
      end: cue.end + shift,
      ...(cue.words ? { words: cue.words.map((w) => ({ ...w, t0: round(w.t0 + shift), t1: round(w.t1 + shift) })) } : {}),
    });
  }
  if (p.clips.some((c) => c.id === id)) return updateItem(p, id, { start, ...(row !== undefined ? { track: Math.max(0, row) } : {}) });
  return updateItem(p, id, { start, ...(row !== undefined ? { lane: Math.max(0, row) } : {}) });
}

export function deleteItems(p: VibeProject, ids: string[]): VibeProject {
  const gone = new Set(ids);
  return touch(p, {
    clips: p.clips.filter((c) => !gone.has(c.id)),
    audio: p.audio.filter((c) => !gone.has(c.id)),
    texts: p.texts.filter((t) => !gone.has(t.id)),
    captions: { ...p.captions, cues: p.captions.cues.filter((c) => !gone.has(c.id)) },
  });
}

/** Delete track-0 clips and pull everything after each one left to close the gap. */
export function rippleDelete(p: VibeProject, id: string): VibeProject {
  const clip = p.clips.find((c) => c.id === id);
  if (!clip || clip.track !== 0) return deleteItems(p, [id]);
  const gap = clipLength(clip);
  const after = (t: number) => t >= clipEnd(clip) - 1e-3;
  const shift = <T extends { start: number }>(x: T): T => (after(x.start) ? { ...x, start: round(x.start - gap) } : x);
  const next = deleteItems(p, [id]);
  return touch(next, {
    clips: next.clips.map(shift),
    audio: next.audio.map(shift),
    texts: next.texts.map((t) => (after(t.start) ? { ...t, start: round(t.start - gap), end: round(t.end - gap) } : t)),
    captions: {
      ...next.captions,
      cues: next.captions.cues.map((c) =>
        after(c.start)
          ? { ...c, start: round(c.start - gap), end: round(c.end - gap), words: c.words?.map((w) => ({ ...w, t0: round(w.t0 - gap), t1: round(w.t1 - gap) })) }
          : c,
      ),
    },
  });
}

/** Cut every clip/audio/text under `time` (or only `ids`) into two. */
export function splitAt(p: VibeProject, time: number, ids?: string[]): VibeProject {
  const wanted = ids && new Set(ids);
  const hit = (id: string, start: number, end: number) =>
    (!wanted || wanted.has(id)) && time > start + MIN_ITEM_SECONDS && time < end - MIN_ITEM_SECONDS;
  const splitTimed = <T extends VibeClip | VibeAudioClip>(list: T[], prefix: string): T[] =>
    list.flatMap((c) => {
      if (!hit(c.id, c.start, clipEnd(c))) return [c];
      const cut = round(c.in + (time - c.start));
      const left = { ...c, out: cut } as T;
      const right = { ...c, id: vibeId(prefix), start: round(time), in: cut } as T;
      if ("fadeOut" in left) delete (left as VibeAudioClip).fadeOut;
      if ("fadeIn" in right) delete (right as VibeAudioClip).fadeIn;
      return [left, right];
    });
  const texts = p.texts.flatMap((t) =>
    hit(t.id, t.start, t.end) ? [{ ...t, end: round(time) }, { ...t, id: vibeId("t"), start: round(time) }] : [t],
  );
  return touch(p, { clips: splitTimed(p.clips, "c"), audio: splitTimed(p.audio, "a"), texts });
}

export function addText(p: VibeProject, text: Partial<VibeText> & { text: string }, at = 0): { project: VibeProject; id: string } {
  const item: VibeText = {
    id: vibeId("t"),
    start: round(Math.max(0, at)),
    end: round(Math.max(0, at) + 3),
    x: 0.5,
    y: 0.2,
    size: 72,
    color: "#ffffff",
    look: "plain",
    ...text,
  };
  item.end = Math.max(item.start + MIN_ITEM_SECONDS, item.end);
  return { project: touch(p, { texts: [...p.texts, item] }), id: item.id };
}

export function setCaptions(p: VibeProject, cues: VibeCue[], locale?: string): VibeProject {
  const clean = cues
    .filter((c) => c.text?.trim() && c.end > c.start)
    .map((c) => ({ ...c, id: c.id || vibeId("q"), start: round(c.start), end: round(c.end) }))
    .sort((a, b) => a.start - b.start);
  return touch(p, { captions: { ...p.captions, cues: clean, ...(locale ? { locale } : {}) } });
}

export function setCaptionLook(p: VibeProject, look: Partial<Omit<VibeCaptions, "cues">>): VibeProject {
  return touch(p, { captions: { ...p.captions, ...look } });
}

/** Re-time cues to where a generated voiceover actually speaks them, never
 * letting one overlap the next. */
export function retimeCues(p: VibeProject, layout: { id: string; start: number; duration: number }[]): VibeProject {
  const byId = new Map(layout.map((l, i) => [l.id, { ...l, next: layout[i + 1]?.start ?? Infinity }]));
  const cues = p.captions.cues.map((c) => {
    const l = byId.get(c.id);
    if (!l) return c;
    const end = Math.min(l.start + l.duration, l.next);
    // Spread the words proportionally over the new span.
    const words = c.words?.length
      ? c.words.map((w, i, all) => ({ w: w.w, t0: round(l.start + ((end - l.start) * i) / all.length), t1: round(l.start + ((end - l.start) * (i + 1)) / all.length) }))
      : undefined;
    return { ...c, start: round(l.start), end: round(end), ...(words ? { words } : {}) };
  });
  return touch(p, { captions: { ...p.captions, cues } });
}

/** Split plain script text into readable caption-sized lines. */
export function scriptToLines(script: string, maxWords = 14): string[] {
  const sentences = script
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[.!?。！？])\s+/)
    .filter(Boolean);
  const lines: string[] = [];
  for (const s of sentences) {
    const words = s.split(" ");
    for (let i = 0; i < words.length; i += maxWords) lines.push(words.slice(i, i + maxWords).join(" "));
  }
  return lines;
}

/** Group transcribed words into caption cues of at most `perCue` words,
 * breaking early at sentence ends and long pauses. */
export function wordsToCues(words: VibeWord[], perCue = 6): VibeCue[] {
  const cues: VibeCue[] = [];
  let cur: VibeWord[] = [];
  const flush = () => {
    if (!cur.length) return;
    cues.push({ id: vibeId("q"), start: round(cur[0].t0), end: round(cur[cur.length - 1].t1), text: cur.map((w) => w.w).join(" "), words: cur });
    cur = [];
  };
  words.forEach((w, i) => {
    const prev = words[i - 1];
    if (cur.length && prev && w.t0 - prev.t1 > 0.6) flush();
    cur.push({ t0: w.t0, t1: Math.max(w.t1, w.t0 + 0.05), w: w.w.trim() });
    if (cur.length >= perCue || /[.!?。！？]$/.test(w.w.trim())) flush();
  });
  flush();
  return cues;
}

/** What is visible/audible at `time`: the top-most picture per track, active
 * texts, and the caption cue being spoken. */
export function frameAt(p: VibeProject, time: number) {
  const inside = (s: number, e: number) => time >= s - 1e-4 && time < e;
  const clips = p.clips.filter((c) => inside(c.start, clipEnd(c))).sort((a, b) => a.track - b.track);
  const audio = p.audio.filter((c) => inside(c.start, clipEnd(c)));
  const texts = p.texts.filter((t) => inside(t.start, t.end));
  const cue = p.captions.cues.find((c) => inside(c.start, c.end));
  // Ducking: any audible ducking clip lowers everything that does not duck.
  const duck = audio.reduce((g, c) => (c.duck !== undefined ? Math.min(g, c.duck) : g), 1);
  return { clips, audio, texts, cue, duck };
}

/** Frame size in pixels for an export of the given aspect (short side 1080). */
export function frameSize(aspect: VibeAspect): { w: number; h: number } {
  switch (aspect) {
    case "16:9":
      return { w: 1920, h: 1080 };
    case "1:1":
      return { w: 1080, h: 1080 };
    case "4:5":
      return { w: 1080, h: 1350 };
    default:
      return { w: 1080, h: 1920 };
  }
}

/** Snap a time to the nearest edge (clip boundaries + playhead) within `tolerance`. */
export function snapTime(p: VibeProject, time: number, tolerance: number, extra: number[] = [], ignore?: string): number {
  const edges = [0, ...extra];
  for (const c of [...p.clips, ...p.audio]) if (c.id !== ignore) edges.push(c.start, clipEnd(c));
  for (const t of p.texts) if (t.id !== ignore) edges.push(t.start, t.end);
  let best = time;
  let dist = tolerance;
  for (const e of edges) {
    const d = Math.abs(e - time);
    if (d < dist) {
      dist = d;
      best = e;
    }
  }
  return round(best);
}

export function formatTime(t: number, frames = false): string {
  const s = Math.max(0, t);
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const tail = frames ? `.${Math.floor((s % 1) * 10)}` : "";
  return `${m}:${sec.toString().padStart(2, "0")}${tail}`;
}

export const FPS = 30;
/** HH:MM:SS:FF at 30 fps, the way an editor shows the playhead. */
export function formatTimecode(t: number): string {
  const total = Math.max(0, Math.round(t * FPS));
  const f = total % FPS;
  const s = Math.floor(total / FPS);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}:${p(f)}`;
}

/** The Movie to Recap render an edit came from: recorded on the edit, or, for edits made before that,
 *  read off its recap picture track's address (/api/recaps/<id>/media/picture-<format>.mp4). */
export function recapSource(project: Pick<VibeProject, "source" | "assets">): VibeProject["source"] | null {
  if (project.source?.kind === "recap") return project.source;
  for (const asset of project.assets || []) {
    const m = String(asset.url || "").match(/\/api\/recaps\/(rcp_[A-Za-z0-9]+)\/media\/picture-(long|short)\.mp4/);
    if (m) return { kind: "recap", recapId: m[1], format: m[2] as "long" | "short" };
  }
  return null;
}
