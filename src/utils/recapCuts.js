// Movie to Recap cut planner. Turns narration beats into a list of film cuts that follow the
// copyright-safety rules the tool promises:
//   - every cut is 3 to 4 seconds (a beat shorter than 3 s gets one cut of its own length),
//   - consecutive cuts never touch: at least `minGap` seconds of film are skipped between them,
//     so no continuous stretch of the film survives,
//   - no second of the film is used twice,
//   - cuts follow the story: each beat draws from its own stretch of the film.
// Pure and deterministic for a seed, so the server, the UI preview, and tests agree.

const DEFAULTS = { minClip: 3, maxClip: 4, minGap: 1.5, maxGap: 5, edgeGuard: 1 };

function rng(seed) {
  let h = 2166136261 >>> 0;
  for (const ch of String(seed ?? "recap")) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Splits a beat's narration time into cut lengths, each within [minClip, maxClip]. */
export function cutLengths(duration, { minClip = 3, maxClip = 4 } = {}, random = Math.random) {
  if (!(duration > 0)) return [];
  if (duration <= maxClip) return [duration];
  const count = Math.max(Math.ceil(duration / maxClip), 1);
  const lengths = [];
  let left = duration;
  for (let i = count; i > 0; i--) {
    if (i === 1) {
      lengths.push(left);
      break;
    }
    // Leave the remaining cuts room to stay inside [minClip, maxClip].
    const low = Math.max(minClip, left - (i - 1) * maxClip);
    const high = Math.min(maxClip, left - (i - 1) * minClip);
    const length = high <= low ? low : low + (high - low) * random();
    lengths.push(length);
    left -= length;
  }
  // Round to the millisecond, letting the last cut absorb the rounding so the beat stays exact.
  const rounded = lengths.map((value) => Math.round(value * 1000) / 1000);
  rounded[rounded.length - 1] = Math.round((duration - rounded.slice(0, -1).reduce((sum, value) => sum + value, 0)) * 1000) / 1000;
  return rounded;
}

function overlaps(used, start, end, pad) {
  return used.some((range) => start < range.end + pad && end > range.start - pad);
}

/** The free start nearest to `wanted` (searching both ways, up to `reach` seconds), or -1. */
function nearestFree(used, wanted, length, low, high, pad, reach = 20) {
  for (let offset = 0; offset <= reach; offset += 0.25) {
    for (const t of offset ? [wanted + offset, wanted - offset] : [wanted]) {
      if (t >= low && t + length <= high && !overlaps(used, t, t + length, pad)) return t;
    }
  }
  return -1;
}

/**
 * Each beat may carry `cutAnchors`: one film time per cut (the frame matched to the words spoken
 * over that cut). A matched cut is centred on its frame, moved only as far as the rules require.
 * @param {{ beats: Array<{ id: string, duration: number, from: number, to: number, anchors?: number[], cutAnchors?: Array<number | null> }>, filmDuration: number, seed?: string, minClip?: number, maxClip?: number, minGap?: number, maxGap?: number }} input
 * @returns {{ cuts: Array<{ beatId: string, start: number, end: number, duration: number, at: number }>, stats: { cuts: number, footageSeconds: number, filmShare: number, averageCut: number, shortestGap: number } }}
 */
export function planRecapCuts(input) {
  const options = { ...DEFAULTS, ...input };
  const film = Number(input.filmDuration) || 0;
  const random = rng(input.seed);
  // Opening titles and end credits are never cut: by default the first 1% (up to 90 s) and the
  // last 7% (up to 8 min) of the film are off limits.
  const startGuard = Math.max(options.edgeGuard, input.startGuard ?? Math.min(90, film * 0.01));
  const endGuard = Math.max(options.edgeGuard, input.endGuard ?? Math.min(480, film * 0.07));
  const used = [];
  const cuts = [];
  let timeline = 0;
  let cursor = startGuard;
  let previousFrom = -Infinity;
  for (const beat of input.beats || []) {
    const lengths = cutLengths(Number(beat.duration) || 0, options, random);
    if (!lengths.length) continue;
    const lastUsable = film - endGuard;
    const from = Math.max(startGuard, Math.min(Number(beat.from) || 0, lastUsable - 1));
    const to = Math.max(from + 1, Math.min(Number(beat.to) || film, lastUsable));
    // Spread the beat's cuts over its stretch of film, preferring the shots the writer anchored.
    const anchors = (beat.anchors || []).filter((t) => t >= from && t < to).sort((a, b) => a - b);
    const span = to - from;
    const step = span / lengths.length;
    // A beat that jumps back in the film (a Short's hook, a flashback) starts over from its own
    // stretch; the used-footage check still keeps it off anything already shown.
    cursor = from < previousFrom ? from : Math.max(cursor, from);
    previousFrom = from;
    for (let i = 0; i < lengths.length; i++) {
      const length = lengths[i];
      const gap = options.minGap + (options.maxGap - options.minGap) * random();
      const wanted = anchors.length ? anchors[Math.min(anchors.length - 1, Math.floor((i * anchors.length) / lengths.length))] : from + step * i;
      const matched = Array.isArray(beat.cutAnchors) && beat.cutAnchors.length === lengths.length ? beat.cutAnchors[i] : null;
      let start = Number.isFinite(matched)
        ? nearestFree(used, Math.max(startGuard, Math.min(matched - length / 2, lastUsable - length)), length, startGuard, lastUsable, options.minGap)
        : -1;
      if (start < 0) {
        start = Math.max(wanted, cursor);
        // Walk forward until the cut fits the film without touching a used stretch.
        while (start + length <= film - endGuard && overlaps(used, start, start + length, options.minGap)) start += 0.5;
      }
      if (start + length > film - endGuard) {
        // Out of film past this point: look backwards for any free stretch that keeps the gaps.
        start = -1;
        for (let t = film - endGuard - length; t >= startGuard; t -= 0.5) {
          if (!overlaps(used, t, t + length, options.minGap)) {
            start = t;
            break;
          }
        }
        if (start < 0) throw new Error("The film is too short for a recap this long with gaps between every cut. Choose a shorter recap.");
      }
      const cut = {
        beatId: String(beat.id),
        start: Math.round(start * 1000) / 1000,
        end: Math.round((start + length) * 1000) / 1000,
        duration: length,
        at: Math.round(timeline * 1000) / 1000,
      };
      cuts.push(cut);
      used.push(cut);
      timeline += length;
      cursor = cut.end + gap;
    }
  }
  const footageSeconds = cuts.reduce((sum, cut) => sum + cut.duration, 0);
  const sorted = [...cuts].sort((a, b) => a.start - b.start);
  let shortestGap = Infinity;
  for (let i = 1; i < sorted.length; i++) shortestGap = Math.min(shortestGap, sorted[i].start - sorted[i - 1].end);
  return {
    cuts,
    stats: {
      cuts: cuts.length,
      footageSeconds: Math.round(footageSeconds * 10) / 10,
      filmShare: film ? Math.round((footageSeconds / film) * 1000) / 1000 : 0,
      averageCut: cuts.length ? Math.round((footageSeconds / cuts.length) * 100) / 100 : 0,
      shortestGap: Number.isFinite(shortestGap) ? Math.round(shortestGap * 100) / 100 : 0,
    },
  };
}
