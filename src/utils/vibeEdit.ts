// Vibe Edit project model and pure edit operations. Modeled on Donkey Cut's
// ProjectDoc (Apache-2.0, github.com/donkeycut/donkey), trimmed to what this
// editor ships: video/image clips on stacked tracks, soundtrack lanes with
// ducking, text titles, and word-timed captions. Every operation returns a new
// project so the store can keep an undo history by reference.

export type VibeAspect = "16:9" | "9:16" | "1:1" | "4:5" | "21:9";
export const VIBE_ASPECTS: { id: VibeAspect; label: string }[] = [
  { id: "16:9", label: "Landscape" },
  { id: "9:16", label: "Portrait" },
  { id: "1:1", label: "Square" },
  { id: "4:5", label: "Feed" },
  { id: "21:9", label: "Cinema" },
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
  /** A recap's whole film (its editing copy): clips cut from it carry film times, and the timeline's
   *  thumbnails come from the recap's contact sheets (one tile every `every` seconds). */
  film?: { recapId: string; sheets?: { base: string; every: number; cols: number; rows: number } };
  /** A motion graphic (a title, card, or overlay) rendered from HTML: the clip is its video, and this is what
   *  the motion editor reopens to change it. `edits` is its edits layer (src/utils/videoGraphics.js). */
  motion?: {
    html: string;
    seconds: number;
    width: number;
    height: number;
    edits?: Record<string, unknown>;
    kind?: string;
    vars?: Record<string, string>;
    /** How it's filmed: a HyperFrames title template (with vars), a seek(t) film (Promo, Explainer), or HyperFrames HTML (Vibe Motion). */
    engine?: "title" | "promo" | "html";
    /** Edited since it was last filmed: the export films it again first. */
    dirty?: boolean;
  };
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
  /** A recap cut's footage: where it sits in the film (seconds) and Jev's match score (0-100). */
  match?: { film?: number; score?: number };
  /** Editor's color label (CLIP_LABELS id), for organizing only. */
  label?: string;
  /** How the clip comes in (videoLooks.js VIDEO_TRANSITIONS): fade, flash, glitch, or zoom; plays on its own frames. */
  transition?: string;
  /** A recap cut's look, previewed here and rendered from the film on export: mirrored, black and white, a held
   *  first frame, blurred film subtitles. `seed` keeps the cut's zoom and pan from the first render. */
  look?: { flip?: boolean; bw?: boolean; freeze?: boolean; subs?: boolean; seed?: number };
  /** A slow camera move across the clip (videoLooks.js VIDEO_MOTIONS): push, pull, or a pan. */
  motion?: string;
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
  label?: string;
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
  label?: string;
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
  /** Named points on the ruler (beats, chapter starts): edits snap to them. */
  markers?: VibeMarker[];
  /** One look laid over every picture (videoLooks.js VIDEO_LOOKS): grade, texture, vignette. */
  look?: string;
  /** Where the edit came from, which decides its extra tools: a recap finds better shots for its cuts, a Create
   *  Video project regenerates its scenes, a film episode re-renders its scenes; its export becomes their video. */
  source?: { kind: "recap"; recapId: string; format: "long" | "short"; film?: boolean; zoom?: number } | { kind: "create-video"; projectId: string } | { kind: "drama"; episodeId: string; seriesId?: string } | { kind: "studio"; generationId: string; tab: string };
  createdAt: number;
  updatedAt: number;
}

/** Color labels for organizing the timeline (Premiere's label colors). They never reach the render. */
export const CLIP_LABELS: { id: string; name: string; color: string }[] = [
  { id: "rose", name: "Rose", color: "#d9536a" },
  { id: "amber", name: "Amber", color: "#d1902a" },
  { id: "green", name: "Green", color: "#3f9d68" },
  { id: "teal", name: "Teal", color: "#2f9ea3" },
  { id: "blue", name: "Blue", color: "#4f7fe0" },
  { id: "violet", name: "Violet", color: "#8a68d8" },
];

/** Set or clear (null) the color label on clips, sounds, and titles. */
export function setLabel(p: VibeProject, ids: string[], label: string | null): VibeProject {
  const wanted = new Set(ids);
  const apply = <T extends { id: string; label?: string }>(x: T): T => {
    if (!wanted.has(x.id)) return x;
    const next = { ...x };
    if (label && CLIP_LABELS.some((l) => l.id === label)) next.label = label;
    else delete next.label;
    return next;
  };
  return touch(p, { clips: p.clips.map(apply), audio: p.audio.map(apply), texts: p.texts.map(apply) });
}

export interface VibeMarker {
  id: string;
  time: number;
  label?: string;
}

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
    markers: (Array.isArray(raw.markers) ? raw.markers : [])
      .filter((m) => m && m.id && Number.isFinite(Number(m.time)) && Number(m.time) >= 0)
      .map((m) => ({ id: String(m.id), time: Number(m.time), ...(m.label ? { label: String(m.label).slice(0, 60) } : {}) }))
      .sort((a, b) => a.time - b.time),
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

/** The film asset of a recap edit, when its clips play from the film. */
export function filmAssetOf(p: Pick<VibeProject, "assets">): VibeAsset | undefined {
  return p.assets.find((a) => a.film && a.kind === "video");
}

/** Points a clip at another moment of the film, keeping its place and length on the timeline: a shot picked
 *  by hand from the whole film. The old cut's look and its "better shot" flag go with it. */
export function replaceFromFilm(p: VibeProject, clipId: string, assetId: string, from: number, length?: number): VibeProject {
  const asset = assetById(p, assetId);
  const clip = p.clips.find((c) => c.id === clipId);
  if (!asset || !clip) return p;
  const span = Math.max(MIN_ITEM_SECONDS, length ?? clip.out - clip.in);
  const total = asset.duration || Infinity;
  const start = round(Math.max(0, Math.min(from, total - span)));
  const { look, flagged, note, ...rest } = clip;
  const next: VibeClip = { ...rest, assetId, in: start, out: round(start + span), muted: true, match: { film: start }, ...(Number.isInteger(look?.seed) ? { look: { seed: look!.seed } } : {}) };
  return touch(p, { clips: p.clips.map((c) => (c.id === clipId ? next : c)) });
}

/** Lays film from `from` to `to` onto a video track at `at`, over whatever is there (an overwrite edit):
 *  clips under it are trimmed or split, nothing after it moves, so the picture stays in sync with the narration. */
export function overwriteFromFilm(p: VibeProject, assetId: string, from: number, to: number, at: number, track = 0): { project: VibeProject; id: string } {
  const asset = assetById(p, assetId);
  if (!asset || !(to - from >= MIN_ITEM_SECONDS)) return { project: p, id: "" };
  const start = round(Math.max(0, at));
  const end = round(start + (to - from));
  const kept: VibeClip[] = [];
  for (const c of p.clips) {
    const cEnd = clipEnd(c);
    if (c.track !== track || cEnd <= start + 1e-4 || c.start >= end - 1e-4) {
      kept.push(c);
      continue;
    }
    // The part before the new clip, and the part after it, each kept when long enough to show.
    if (c.start < start - MIN_ITEM_SECONDS) kept.push({ ...c, out: round(c.in + (start - c.start)) });
    if (cEnd > end + MIN_ITEM_SECONDS) kept.push({ ...c, id: c.start < start - MIN_ITEM_SECONDS ? vibeId("c") : c.id, start: end, in: round(c.in + (end - c.start)) });
  }
  const clip: VibeClip = { id: vibeId("c"), assetId, track, start, in: round(from), out: round(to), fit: "fill", muted: true, match: { film: round(from) } };
  return { project: touch(p, { clips: [...kept, clip] }), id: clip.id };
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
  motion?: string | null;
  transition?: string | null;
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

/** Delete track-0 clips and pull everything after each one left to close the
 * gap. Locked tracks keep their place, and a locked clip is not deleted. */
export function rippleDelete(p: VibeProject, id: string): VibeProject {
  if (isLocked(p, id)) return p;
  const clip = p.clips.find((c) => c.id === id);
  if (!clip || clip.track !== 0) return deleteItems(p, [id]);
  return shiftAfter(deleteItems(p, [id]), clipEnd(clip), -clipLength(clip));
}

/** Cut every clip/audio/text under `time` (or only `ids`) into two. */
export function splitAt(p: VibeProject, time: number, ids?: string[]): VibeProject {
  const wanted = ids && new Set(ids);
  const locked = (key: string) => Boolean(trackState(p, key).locked);
  const lockedIds = new Set([
    ...p.clips.filter((c) => locked(trackKey("video", c.track))).map((c) => c.id),
    ...p.audio.filter((c) => locked(trackKey("audio", c.lane))).map((c) => c.id),
    ...(locked("text") ? p.texts.map((t) => t.id) : []),
  ]);
  // A locked track is never cut.
  const hit = (id: string, start: number, end: number) =>
    !lockedIds.has(id) && (!wanted || wanted.has(id)) && time > start + MIN_ITEM_SECONDS && time < end - MIN_ITEM_SECONDS;
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
    case "21:9":
      return { w: 2520, h: 1080 };
    default:
      return { w: 1080, h: 1920 };
  }
}

/** Snap a time to the nearest edge (clip boundaries + playhead) within `tolerance`. */
export function snapTime(p: VibeProject, time: number, tolerance: number, extra: number[] = [], ignore?: string): number {
  const edges = [0, ...extra];
  for (const c of [...p.clips, ...p.audio]) if (c.id !== ignore) edges.push(c.start, clipEnd(c));
  for (const t of p.texts) if (t.id !== ignore) edges.push(t.start, t.end);
  for (const m of p.markers || []) edges.push(m.time);
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

// ---------- Timeline editing: groups, ripple, gaps, markers ----------

/** Every item's id with its time span, for selection and group edits. */
function spans(p: VibeProject): { id: string; start: number; end: number }[] {
  return [
    ...p.clips.map((c) => ({ id: c.id, start: c.start, end: clipEnd(c) })),
    ...p.audio.map((c) => ({ id: c.id, start: c.start, end: clipEnd(c) })),
    ...p.texts.map((t) => ({ id: t.id, start: t.start, end: t.end })),
    ...p.captions.cues.map((c) => ({ id: c.id, start: c.start, end: c.end })),
  ];
}

/** Move several items by the same amount, keeping their spacing. Locked
 * tracks stay put, and the group stops at zero rather than squashing. */
export function moveItems(p: VibeProject, ids: string[], delta: number): VibeProject {
  const wanted = new Set(ids.filter((id) => !isLocked(p, id)));
  const group = spans(p).filter((s) => wanted.has(s.id));
  if (!group.length || !delta) return p;
  const shift = Math.max(delta, -Math.min(...group.map((s) => s.start)));
  if (!shift) return p;
  return group.reduce((next, s) => moveItem(next, s.id, round(s.start + shift)), p);
}

/** Is [start, end) clear on a video track or audio lane? */
function rowFree(list: (VibeClip | VibeAudioClip)[], rowOf: (c: VibeClip | VibeAudioClip) => number, row: number, start: number, end: number) {
  return !list.some((c) => rowOf(c) === row && c.start < end - 1e-3 && clipEnd(c) > start + 1e-3);
}

/** Copy items to just after the selection, on the same rows when there is
 * room, otherwise on the next free row up. Returns the copies' ids. */
export function duplicateItems(p: VibeProject, ids: string[]): { project: VibeProject; ids: string[] } {
  const wanted = new Set(ids.filter((id) => !isLocked(p, id)));
  const group = spans(p).filter((s) => wanted.has(s.id));
  if (!group.length) return { project: p, ids: [] };
  const offset = round(Math.max(...group.map((s) => s.end)) - Math.min(...group.map((s) => s.start)));
  const made: string[] = [];
  let clips = [...p.clips];
  let audio = [...p.audio];
  for (const c of p.clips.filter((c) => wanted.has(c.id))) {
    const start = round(c.start + offset);
    const end = start + clipLength(c);
    let track = c.track;
    while (!rowFree(clips, (x) => (x as VibeClip).track, track, start, end)) track += 1;
    const copy = { ...c, id: vibeId("c"), start, track };
    clips.push(copy);
    made.push(copy.id);
  }
  for (const c of p.audio.filter((c) => wanted.has(c.id))) {
    const start = round(c.start + offset);
    const end = start + clipLength(c);
    let lane = c.lane;
    while (!rowFree(audio, (x) => (x as VibeAudioClip).lane, lane, start, end)) lane += 1;
    const copy = { ...c, id: vibeId("a"), start, lane };
    audio.push(copy);
    made.push(copy.id);
  }
  const texts = [...p.texts];
  for (const t of p.texts.filter((t) => wanted.has(t.id))) {
    const copy = { ...t, id: vibeId("t"), start: round(t.start + offset), end: round(t.end + offset) };
    texts.push(copy);
    made.push(copy.id);
  }
  const cues = [...p.captions.cues];
  for (const c of p.captions.cues.filter((c) => wanted.has(c.id))) {
    const copy = { ...c, id: vibeId("q"), start: round(c.start + offset), end: round(c.end + offset), words: c.words?.map((w) => ({ ...w, t0: round(w.t0 + offset), t1: round(w.t1 + offset) })) };
    cues.push(copy);
    made.push(copy.id);
  }
  clips = clips.sort((a, b) => a.start - b.start);
  audio = audio.sort((a, b) => a.start - b.start);
  return { project: touch(p, { clips, audio, texts, captions: { ...p.captions, cues: cues.sort((a, b) => a.start - b.start) } }), ids: made };
}

/** Pull everything that starts at or after `time` by `delta` seconds (negative = left), markers too. */
export function shiftAfter(p: VibeProject, time: number, delta: number): VibeProject {
  const after = (t: number) => t >= time - 1e-3;
  const at = (t: number) => round(Math.max(0, t + delta));
  // Locked tracks keep their place, the way a locked track sits out a ripple in Premiere.
  const free = (key: string) => !trackState(p, key).locked;
  const texts = free("text");
  const cues = free("cue");
  return touch(p, {
    clips: p.clips.map((c) => (after(c.start) && free(trackKey("video", c.track)) ? { ...c, start: at(c.start) } : c)),
    audio: p.audio.map((c) => (after(c.start) && free(trackKey("audio", c.lane)) ? { ...c, start: at(c.start) } : c)),
    texts: p.texts.map((t) => (texts && after(t.start) ? { ...t, start: at(t.start), end: at(t.end) } : t)),
    captions: {
      ...p.captions,
      cues: p.captions.cues.map((c) => (cues && after(c.start) ? { ...c, start: at(c.start), end: at(c.end), words: c.words?.map((w) => ({ ...w, t0: at(w.t0), t1: at(w.t1) })) } : c)),
    },
    markers: (p.markers || []).map((m) => (after(m.time) ? { ...m, time: at(m.time) } : m)),
  });
}

/** Delete several items, closing the gaps that base-track clips leave behind. */
export function rippleDeleteItems(p: VibeProject, ids: string[]): VibeProject {
  const unlocked = ids.filter((id) => !isLocked(p, id));
  const base = p.clips.filter((c) => c.track === 0 && unlocked.includes(c.id)).sort((a, b) => b.start - a.start);
  let next = deleteItems(p, unlocked.filter((id) => !base.some((c) => c.id === id)));
  for (const c of base) next = rippleDelete(next, c.id);
  return next;
}

/** Empty stretches on the base track before and between its clips. */
export function baseGaps(p: VibeProject): { start: number; end: number }[] {
  const base = p.clips.filter((c) => c.track === 0).sort((a, b) => a.start - b.start);
  const gaps: { start: number; end: number }[] = [];
  let cursor = 0;
  for (const c of base) {
    if (c.start - cursor > 0.05) gaps.push({ start: round(cursor), end: round(c.start) });
    cursor = Math.max(cursor, clipEnd(c));
  }
  return gaps;
}

/** Close the base-track gap under `time` by pulling everything after it left. */
export function closeGap(p: VibeProject, time: number): VibeProject {
  const gap = baseGaps(p).find((g) => time >= g.start - 1e-3 && time <= g.end + 1e-3);
  return gap ? shiftAfter(p, gap.end, -(gap.end - gap.start)) : p;
}

/** Cut an item back to `time`: "start" drops what plays before it, "end" what plays after.
 * Base-track clips ripple, so the edit closes up behind them. */
export function trimToTime(p: VibeProject, ids: string[], time: number, side: "start" | "end"): VibeProject {
  let next = p;
  const wanted = new Set(ids.filter((id) => !isLocked(p, id)));
  const hits = spans(p).filter((s) => wanted.has(s.id) && time > s.start + MIN_ITEM_SECONDS && time < s.end - MIN_ITEM_SECONDS);
  // Right to left, so a ripple never moves an item we have yet to trim.
  for (const s of hits.sort((a, b) => b.start - a.start)) {
    const clip = next.clips.find((c) => c.id === s.id);
    const timed = clip || next.audio.find((c) => c.id === s.id);
    const ripple = clip?.track === 0;
    if (side === "start") {
      const cut = round(time - s.start);
      if (timed) {
        next = updateItem(next, s.id, ripple ? { in: timed.in + cut } : { start: time, in: timed.in + cut });
        if (ripple) next = shiftAfter(next, s.end, -cut);
      } else next = updateItem(next, s.id, { start: time });
    } else {
      const cut = round(s.end - time);
      if (timed) {
        next = updateItem(next, s.id, { out: timed.out - cut });
        if (ripple) next = shiftAfter(next, s.end, -cut);
      } else next = updateItem(next, s.id, { end: time } as Partial<VibeText>);
    }
  }
  return next;
}

/** A drag-trim on a base-track clip that keeps the edit closed up behind it
 * (a magnetic main track): the clip's start stays put and everything after its
 * old end moves by the change in length. */
export function rippleTrim(base: VibeProject, id: string, side: "start" | "end", delta: number): VibeProject {
  const clip = base.clips.find((c) => c.id === id);
  if (!clip) return base;
  const asset = assetById(base, clip.assetId);
  const cap = asset?.kind === "image" ? Infinity : asset?.duration ?? Infinity;
  let change: number;
  let next: VibeProject;
  if (side === "start") {
    // Dragging the head right drops footage from the front; left brings it back.
    const inPoint = Math.min(clip.out - MIN_ITEM_SECONDS, Math.max(0, clip.in + delta));
    change = clip.in - inPoint;
    next = updateItem(base, id, { in: inPoint });
  } else {
    const out = Math.min(cap, Math.max(clip.in + MIN_ITEM_SECONDS, clip.out + delta));
    change = out - clip.out;
    next = updateItem(base, id, { out });
  }
  if (Math.abs(change) < 1e-6) return next;
  return shiftAfter(next, clipEnd(clip), change);
}

/** Drop empty video tracks (above the base) and empty audio lanes, closing
 * the stack up the way CapCut does. Track switches move with their tracks. */
export function compactTracks(p: VibeProject): VibeProject {
  const used = (rows: number[]) => [...new Set(rows)].sort((a, b) => a - b);
  const video = used([0, ...p.clips.map((c) => c.track)]);
  const audio = used(p.audio.map((c) => c.lane));
  const vMap = new Map(video.map((t, i) => [t, i]));
  const aMap = new Map(audio.map((l, i) => [l, i]));
  const moved = video.some((t, i) => t !== i) || audio.some((l, i) => l !== i);
  if (!moved) return p;
  const tracks: Record<string, VibeTrackState> = {};
  for (const [key, st] of Object.entries(p.tracks || {})) {
    const m = key.match(/^([va])(\d+)$/);
    if (!m) tracks[key] = st;
    else {
      const next = (m[1] === "v" ? vMap : aMap).get(Number(m[2]));
      if (next !== undefined) tracks[`${m[1]}${next}`] = st;
    }
  }
  return touch(p, {
    clips: p.clips.map((c) => (vMap.get(c.track) === c.track ? c : { ...c, track: vMap.get(c.track)! })),
    audio: p.audio.map((c) => (aMap.get(c.lane) === c.lane ? c : { ...c, lane: aMap.get(c.lane)! })),
    tracks,
  });
}

/** Every cut, item edge, and marker, sorted: where ↑/↓ jump the playhead. */
export function editPoints(p: VibeProject): number[] {
  const out = new Set<number>([0]);
  for (const s of spans(p)) {
    out.add(round(s.start));
    out.add(round(s.end));
  }
  for (const m of p.markers || []) out.add(round(m.time));
  return [...out].sort((a, b) => a - b);
}

/** Add a marker at `time`, or remove the one already within a frame of it. */
export function toggleMarker(p: VibeProject, time: number): VibeProject {
  const markers = p.markers || [];
  const near = markers.find((m) => Math.abs(m.time - time) < 1 / FPS);
  if (near) return touch(p, { markers: markers.filter((m) => m.id !== near.id) });
  return touch(p, { markers: [...markers, { id: vibeId("m"), time: round(Math.max(0, time)) }].sort((a, b) => a.time - b.time) });
}

export function updateMarker(p: VibeProject, id: string, patch: { time?: number; label?: string }): VibeProject {
  const markers = (p.markers || []).map((m) => {
    if (m.id !== id) return m;
    const next = { ...m, ...(patch.time !== undefined ? { time: round(Math.max(0, patch.time)) } : {}) };
    if (patch.label !== undefined) {
      if (patch.label.trim()) next.label = patch.label.trim().slice(0, 60);
      else delete next.label;
    }
    return next;
  });
  return touch(p, { markers: markers.sort((a, b) => a.time - b.time) });
}

export const removeMarker = (p: VibeProject, id: string) => touch(p, { markers: (p.markers || []).filter((m) => m.id !== id) });

/** Parse what someone types into the timecode box: "1:23", "83.5", "00:01:23:12". */
export function parseTimecode(text: string): number | null {
  const raw = text.trim();
  if (!raw) return null;
  if (/^\d+(\.\d+)?$/.test(raw)) return Number(raw);
  const parts = raw.split(":").map((x) => x.trim());
  if (parts.some((x) => !/^\d+(\.\d+)?$/.test(x))) return null;
  const n = parts.map(Number);
  if (n.length === 2) return n[0] * 60 + n[1];
  if (n.length === 3) return n[0] * 3600 + n[1] * 60 + n[2];
  if (n.length === 4) return n[0] * 3600 + n[1] * 60 + n[2] + n[3] / FPS;
  return null;
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
export function recapSource(project: Pick<VibeProject, "source" | "assets">): Extract<NonNullable<VibeProject["source"]>, { kind: "recap" }> | null {
  if (project.source?.kind === "recap") return project.source;
  for (const asset of project.assets || []) {
    const m = String(asset.url || "").match(/\/api\/recaps\/(rcp_[A-Za-z0-9]+)\/media\/picture-(long|short)\.mp4/);
    if (m) return { kind: "recap", recapId: m[1], format: m[2] as "long" | "short" };
  }
  return null;
}
