// Auto edit for talking-head footage: find the dead air, filler words, and
// retakes in a word-timed transcript, cut them out of the whole timeline with
// a ripple, then punch in on the jump cuts. Pure, so the editor and the tests
// share it; the editor wires each step to the store as one undo.
import { clipEnd, clipLength, MIN_ITEM_SECONDS, vibeId, type VibeClip, type VibeCue, type VibeGrade, type VibeProject, type VibeWord } from "./vibeEdit";

export type Range = [number, number];

const round = (n: number) => Math.round(n * 1000) / 1000;

/** Sorted, merged ranges; touching or near-touching ranges join. */
export function mergeRanges(ranges: Range[], join = 0.05): Range[] {
  const sorted = ranges.filter(([a, b]) => b - a > 0.01).map(([a, b]) => [a, b] as Range).sort((x, y) => x[0] - y[0]);
  const out: Range[] = [];
  for (const r of sorted) {
    const last = out.at(-1);
    if (last && r[0] <= last[1] + join) last[1] = Math.max(last[1], r[1]);
    else out.push([r[0], r[1]]);
  }
  return out.map(([a, b]) => [round(a), round(b)] as Range);
}

// ---------- Finding what to cut ----------
export const FILLER_WORDS = new Set(["um", "umm", "uh", "uhh", "uhm", "erm", "er", "err", "ah", "ahh", "hmm", "hm", "mm", "mmm"]);
const token = (w: string) => w.toLowerCase().replace(/[^a-z0-9']/g, "");

export interface CutOptions {
  /** A pause longer than this is dead air. */
  minSilence?: number;
  /** Breath kept either side of speech, so cuts don't clip words. */
  pad?: number;
  /** Timeline span the words belong to: dead air before the first word and after the last is cut too. */
  start?: number;
  end?: number;
}

/** Pauses between words (and before the first / after the last) longer than `minSilence`. */
export function findSilences(words: VibeWord[], { minSilence = 0.5, pad = 0.12, start, end }: CutOptions = {}): Range[] {
  const out: Range[] = [];
  const keepBreath = (a: number, b: number) => (b - a > minSilence ? out.push([a + pad, b - pad]) : 0);
  if (!words.length) return out;
  if (start !== undefined) keepBreath(start - pad, words[0].t0);
  for (let i = 0; i < words.length - 1; i++) keepBreath(words[i].t1, words[i + 1].t0);
  if (end !== undefined) keepBreath(words.at(-1)!.t1, end + pad);
  return out.filter(([a, b]) => b > a);
}

/** "um", "uh" and friends, cut from the end of the word before to the start of the word after. */
export function findFillers(words: VibeWord[]): Range[] {
  const out: Range[] = [];
  words.forEach((w, i) => {
    if (!FILLER_WORDS.has(token(w.w))) return;
    const from = i > 0 ? Math.max(words[i - 1].t1, w.t0 - 0.08) : w.t0;
    const to = i < words.length - 1 ? Math.min(words[i + 1].t0, w.t1 + 0.08) : w.t1;
    out.push([from, to]);
  });
  return out;
}

/**
 * Retakes: a phrase of at least `minWords` words that starts again within a
 * few words ("so today I want, so today I want to show you"). The first,
 * abandoned attempt is cut up to where the repeat begins.
 */
export function findRetakes(words: VibeWord[], { minWords = 3, lookahead = 24, maxGap = 12 } = {}): Range[] {
  const t = words.map((w) => token(w.w));
  const out: Range[] = [];
  let i = 0;
  while (i < t.length) {
    let found = -1;
    for (let j = i + 1; j <= Math.min(t.length - minWords, i + lookahead); j++) {
      if (words[j].t0 - words[i].t0 > maxGap) break;
      let k = 0;
      while (j + k < t.length && i + k < j && t[i + k] && t[i + k] === t[j + k]) k++;
      if (k >= minWords) {
        found = j;
        break;
      }
    }
    if (found < 0) {
      i++;
      continue;
    }
    out.push([words[i].t0, words[found].t0]);
    i = found;
  }
  return out;
}

export interface SpeechCuts {
  silences: Range[];
  fillers: Range[];
  retakes: Range[];
  /** Everything above merged: what gets removed. */
  ranges: Range[];
  seconds: number;
}
export function speechCuts(words: VibeWord[], kinds: { silences?: boolean; fillers?: boolean; retakes?: boolean } = {}, options: CutOptions = {}): SpeechCuts {
  const silences = kinds.silences === false ? [] : findSilences(words, options);
  const fillers = kinds.fillers === false ? [] : findFillers(words);
  const retakes = kinds.retakes === false ? [] : findRetakes(words);
  const ranges = mergeRanges([...silences, ...fillers, ...retakes]);
  return { silences, fillers, retakes, ranges, seconds: round(ranges.reduce((s, [a, b]) => s + (b - a), 0)) };
}

// ---------- Cutting the timeline ----------
type Timed = { start: number; in: number; out: number; id: string };

// `continuous` items (a music bed) are never split: they keep playing through
// the cut and just end sooner, so the music doesn't stutter at every cut.
function rippleTimed<T extends Timed>(items: T[], a: number, b: number, prefix: string, continuous: (c: T) => boolean = () => false): T[] {
  const d = b - a;
  const out: T[] = [];
  for (const c of items) {
    const s = c.start;
    const e = clipEnd(c);
    if (e <= a + 1e-6) out.push(c);
    else if (s >= b - 1e-6) out.push({ ...c, start: round(s - d) });
    else if (continuous(c)) out.push({ ...c, start: round(Math.min(s, a)), out: round(c.out - (Math.min(e, b) - Math.max(s, a))) });
    else if (s >= a && e <= b) continue;
    else if (s < a && e > b) {
      out.push({ ...c, out: round(c.in + (a - s)) });
      out.push({ ...c, id: vibeId(prefix), start: round(a), in: round(c.in + (b - s)) });
    } else if (s < a) out.push({ ...c, out: round(c.in + (a - s)) });
    else out.push({ ...c, start: round(a), in: round(c.in + (b - s)) });
  }
  return out.filter((c) => clipLength(c) >= MIN_ITEM_SECONDS);
}

function rippleSpan<T extends { start: number; end: number }>(item: T, a: number, b: number): T | null {
  const d = b - a;
  const shift = (t: number) => (t <= a ? t : t >= b ? t - d : a);
  const start = round(shift(item.start));
  const end = round(shift(item.end));
  return end - start >= MIN_ITEM_SECONDS ? { ...item, start, end } : null;
}

function rippleCue(cue: VibeCue, a: number, b: number): VibeCue | null {
  const span = rippleSpan(cue, a, b);
  if (!span) return null;
  if (!cue.words?.length) return span;
  const d = b - a;
  const words = cue.words
    .filter((w) => !(w.t0 >= a - 1e-6 && w.t1 <= b + 1e-6))
    .map((w) => ({ ...w, t0: round(w.t0 >= b ? w.t0 - d : Math.min(w.t0, a)), t1: round(w.t1 >= b ? w.t1 - d : Math.min(w.t1, a)) }));
  if (!words.length) return null;
  return { ...span, words, text: words.map((w) => w.w.trim()).join(" ") };
}

/** Remove one span of timeline time from every track and close the gap. */
export function rippleRange(p: VibeProject, a: number, b: number): VibeProject {
  if (!(b - a > 0.001)) return p;
  return {
    ...p,
    clips: rippleTimed(p.clips, a, b, "c"),
    audio: rippleTimed(p.audio, a, b, "a", (c) => p.assets.find((x) => x.id === c.assetId)?.origin === "music"),
    texts: p.texts.map((t) => rippleSpan(t, a, b)).filter((t): t is NonNullable<typeof t> => Boolean(t)),
    captions: { ...p.captions, cues: p.captions.cues.map((c) => rippleCue(c, a, b)).filter((c): c is VibeCue => Boolean(c)) },
    updatedAt: Date.now(),
  };
}

/** Remove many spans at once; later spans go first so earlier times stay valid. */
export function rippleRanges(p: VibeProject, ranges: Range[]): VibeProject {
  return mergeRanges(ranges).reverse().reduce((q, [a, b]) => rippleRange(q, a, b), p);
}

// ---------- Look ----------
export const PUNCH_ZOOM = 1.12;

/**
 * Punch in on alternate pieces of the main track wherever one piece of the
 * same footage butts against the next (a jump cut), so the cut reads as a
 * camera change. Other clips are left as they are.
 */
export function punchInCuts(p: VibeProject, zoom = PUNCH_ZOOM): { project: VibeProject; count: number } {
  const base = p.clips.filter((c) => c.track === 0).sort((x, y) => x.start - y.start);
  const zooms = new Map<string, number>();
  let run = 0;
  base.forEach((c, i) => {
    const prev = base[i - 1];
    const jump = prev && prev.assetId === c.assetId && Math.abs(clipEnd(prev) - c.start) < 0.02;
    run = jump ? run + 1 : 0;
    if (jump || base[i + 1]?.assetId === c.assetId) zooms.set(c.id, run % 2 ? zoom : 1);
  });
  const count = [...zooms.values()].filter((z) => z > 1).length;
  return {
    project: { ...p, clips: p.clips.map((c) => (zooms.has(c.id) ? { ...c, zoom: zooms.get(c.id) } : c)), updatedAt: Date.now() },
    count,
  };
}

/** A gentle contrast and saturation lift, like a quick Lumetri pass. */
export const COLOR_BOOST: VibeGrade = { contrast: 1.12, saturation: 1.22, brightness: 0.02 };

export function gradeClips(p: VibeProject, grade: VibeGrade | undefined, ids?: string[]): VibeProject {
  const only = ids ? new Set(ids) : null;
  return {
    ...p,
    clips: p.clips.map((c): VibeClip => (only && !only.has(c.id) ? c : grade ? { ...c, grade } : (({ grade: _drop, ...rest }) => rest)(c))),
    updatedAt: Date.now(),
  };
}

/** CSS filter for the preview; the export uses ffmpeg's eq with the same numbers. */
export function gradeFilter(grade: VibeGrade | undefined): string {
  if (!grade) return "";
  const parts = [];
  if (grade.brightness) parts.push(`brightness(${round(1 + grade.brightness)})`);
  if (grade.contrast && grade.contrast !== 1) parts.push(`contrast(${grade.contrast})`);
  if (grade.saturation && grade.saturation !== 1) parts.push(`saturate(${grade.saturation})`);
  return parts.join(" ");
}

// ---------- B-roll ----------
/** Spoken moments that can carry b-roll: whole cues past the opening hook, spread over the video. */
export function brollMoments(cues: VibeCue[], { count = 4, skipFirst = 2.5, minSeconds = 1.6, maxSeconds = 3.2 } = {}): { start: number; end: number; text: string }[] {
  const pool = cues.filter((c) => c.start >= skipFirst && c.end - c.start >= minSeconds * 0.8 && c.text.split(/\s+/).length >= 3);
  if (!pool.length) return [];
  const picks: VibeCue[] = [];
  const step = pool.length / Math.min(count, pool.length);
  for (let k = 0; k < Math.min(count, pool.length); k++) picks.push(pool[Math.floor(k * step + step / 2)]);
  return picks.map((c) => ({ start: round(c.start), end: round(Math.min(c.end, c.start + maxSeconds)), text: c.text }));
}
