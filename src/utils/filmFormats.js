// Create Film formats. Create Drama's pipeline (concept → cast and locations
// locked once → outline → per unit: screenplay → storyboard → audio track →
// Seedance clip → final cut) makes four kinds of film. A format changes the
// words the writers are given, how many units the film has and how long they
// run, and where a scene's timing comes from: spoken dialogue for the dramas
// and films, the song for a music video. Shared by the server and the UI.

export const FILM_FORMATS = {
  series: {
    id: "series",
    label: "Create Series",
    title: "Create Series",
    tagline: "From a first idea to a series of connected episodes.",
    unit: "Episode",
    units: "Episodes",
    count: { min: 3, max: 30, default: 10 },
    lengths: [
      { seconds: 60, label: "1 min", words: 200 },
      { seconds: 90, label: "1.5 min", words: 300 },
      { seconds: 120, label: "2 min", words: 400 },
    ],
    shotTemplateId: "micro-drama",
    maxScenes: 6,
    maxBeats: 9,
    dialogue: true,
    plan: { hook: "Hook", goal: "Goal", turn: "Turn", payoff: "Payoff", cliffhanger: "Ends on" },
    placeholder: "Describe your drama: who wants what, and what stands in the way",
    noun: "series",
    poster: "Original premium short-drama series cover",
  },
  short: {
    id: "short",
    label: "Short Film",
    title: "Create Short Film",
    tagline: "One complete story, from first idea to finished film.",
    unit: "Film",
    units: "Film",
    count: { min: 1, max: 1, default: 1 },
    lengths: [
      { seconds: 120, label: "2 min", words: 280 },
      { seconds: 180, label: "3 min", words: 420 },
      { seconds: 300, label: "5 min", words: 700 },
    ],
    shotTemplateId: "cinematic-film",
    maxScenes: 14,
    maxBeats: 9,
    dialogue: true,
    plan: { hook: "Opening", goal: "Want", turn: "Turn", payoff: "Climax", cliffhanger: "Ending" },
    placeholder: "Describe your short film: who wants what, what stands in the way, and how it ends",
    noun: "film",
    poster: "Original festival-quality short film poster artwork",
  },
  long: {
    id: "long",
    label: "Long Film",
    title: "Create Long Film",
    tagline: "A feature-length story told in parts, with the same cast throughout.",
    unit: "Part",
    units: "Parts",
    count: { min: 3, max: 12, default: 5 },
    lengths: [
      { seconds: 240, label: "4 min", words: 560 },
      { seconds: 360, label: "6 min", words: 840 },
      { seconds: 600, label: "10 min", words: 1400 },
    ],
    shotTemplateId: "cinematic-film",
    maxScenes: 24,
    maxBeats: 9,
    dialogue: true,
    plan: { hook: "Opening", goal: "Goal", turn: "Turn", payoff: "Payoff", cliffhanger: "Leads into" },
    placeholder: "Describe your film: the world, who wants what, and the journey across the whole story",
    noun: "film",
    poster: "Original feature film theatrical poster artwork",
  },
  music: {
    id: "music",
    label: "Music Video",
    title: "Create Music Video",
    tagline: "Start from a song: lyrics, a concept, then a video cut to the music.",
    unit: "Video",
    units: "Video",
    count: { min: 1, max: 1, default: 1 },
    lengths: [{ seconds: 0, label: "Song length", words: 0 }],
    shotTemplateId: "music-video",
    maxScenes: 48,
    maxBeats: 6,
    dialogue: false,
    plan: { hook: "Opening image", goal: "Story", turn: "Turn", payoff: "Peak", cliffhanger: "Final image" },
    placeholder: "Anything the video should do: the story, the world, the vibe",
    noun: "music video",
    poster: "Original music video cover artwork",
  },
};

export const FILM_FORMAT_IDS = Object.keys(FILM_FORMATS);
export const filmFormat = (id) => FILM_FORMATS[id] || FILM_FORMATS.series;
export const isFilmFormat = (id) => Object.prototype.hasOwnProperty.call(FILM_FORMATS, String(id || ""));

/** The length option a unit runs to, falling back to the format's first. */
export function formatLength(format, seconds) {
  const lengths = filmFormat(format).lengths;
  return lengths.find((option) => option.seconds === Number(seconds)) || lengths[0];
}

/** Clamp a requested unit count into the format's range. */
export function formatCount(format, value) {
  const range = filmFormat(format).count;
  return Math.min(range.max, Math.max(range.min, Math.round(Number(value) || range.default)));
}

// ---------- Writers' briefs per format ----------
// The concept editor, head writer, and screenwriter all get one paragraph that
// says what kind of film this is. The series wording is Create Drama's own.
export const FORMAT_WRITING = {
  series: {
    concept: "You are a development editor for original vertical short-drama series.",
    conceptShape: "Short episodes need a first-seconds hook, a reversal and a cliffhanger.",
    outline: "You are the head writer of an original vertical short drama series for an English-speaking audience.",
    units: (count, seconds) =>
      `Write exactly ${count} episodes of about ${seconds} seconds each. Every episode is a state change: it starts from the previous cliffhanger, pays off part of the promise, and ends on a sharper question. Escalate across the series: a reveal or power shift roughly every three episodes, the biggest twist near the end, and a satisfying finale that resolves the core promise.`,
    screenplay: (aspect) => `You write one episode of a ${aspect} short drama as a production screenplay.`,
    shape: "Open on the hook and end on the episode's cliffhanger (on the finale, resolve the core promise).",
  },
  short: {
    concept: "You are a development producer for original short films.",
    conceptShape: "A short film is one complete story: a clear want, rising obstacles, a turn, a climax, and an ending that lands, with a strong opening image.",
    outline: "You are the screenwriter of an original short film for an English-speaking audience.",
    units: (_count, seconds) =>
      `Plan exactly 1 film of about ${seconds} seconds as one entry in "episodes": "hook" is the opening image and situation, "goal" what the lead wants and what opposes them, "turn" the reversal or decision that changes everything, "payoff" the climax, and "cliffhanger" the ending and final image. The story is complete: it resolves, it does not tease a sequel.`,
    screenplay: (aspect) => `You write a complete ${aspect} short film as a production screenplay.`,
    shape: "Open on a strong image that sets up the want, build through the obstacles, land the turn and the climax, and end on the final image from the plan. The film is complete; it resolves.",
  },
  long: {
    concept: "You are a development producer for original feature films.",
    conceptShape: "A feature needs a world that sustains a long story, a lead with a deep want and flaw, rising stakes across acts, a midpoint reversal, a dark moment, a climax, and a resolution.",
    outline: "You are the screenwriter of an original feature film for an English-speaking audience, told in consecutive parts.",
    units: (count, seconds) =>
      `Plan exactly ${count} consecutive parts of about ${seconds} seconds each, as the "episodes" list. Together they form one three-act film: the first part sets up the world and the want, the middle parts escalate with a midpoint reversal near the centre and a dark moment late, the last part holds the climax and the resolution. Each part's "hook" is where it opens, "goal" what the lead pursues in it, "turn" its reversal, "payoff" what it delivers, and "cliffhanger" the hand-off into the next part (in the last part, the ending and final image).`,
    screenplay: (aspect) => `You write one part of a ${aspect} feature film as a production screenplay. The parts play back to back as one film.`,
    shape: "Pick up exactly where the previous part ended, and end on the hand-off into the next part (in the last part, the resolution and final image). No recaps.",
  },
  music: {
    concept: "You are a music video director developing an original concept for a song.",
    conceptShape: "Build the concept from the lyrics: a visual story or world the song's meaning and mood point to, with the performers and any story characters, a look that suits the genre, and a peak image for the biggest moment of the song. It must work as pure images; nobody speaks.",
    outline: "You are the director of an original music video.",
    units: () =>
      `Plan exactly 1 video as one entry in "episodes": "hook" is the opening image before the first line, "goal" the story thread the video follows, "turn" what changes at the bridge or second half, "payoff" the peak image for the biggest chorus, and "cliffhanger" the final image as the song ends.`,
    screenplay: (aspect) => `You direct a ${aspect} music video, shot by shot, cut to the song.`,
    shape: "",
  },
};
export const formatWriting = (format) => FORMAT_WRITING[format] || FORMAT_WRITING.series;

// ---------- Music video: the song sets the timing ----------
const round = (n) => Math.round(Number(n) * 100) / 100;

/** Clean, time-sorted lyric lines inside the song. */
export function normalizeLyrics(lines, duration = Infinity) {
  const max = Number.isFinite(Number(duration)) && Number(duration) > 0 ? Number(duration) : Infinity;
  return (Array.isArray(lines) ? lines : [])
    .map((line, i) => ({
      id: /^[a-z0-9-]{1,24}$/.test(String(line?.id || "")) ? String(line.id) : `l${i + 1}`,
      start: round(Math.max(0, Math.min(max, Number(line?.start) || 0))),
      end: round(Math.max(0, Math.min(max, Number(line?.end) || 0))),
      text: String(line?.text ?? "").replace(/\s+/g, " ").trim().slice(0, 200),
    }))
    .filter((line) => line.text && line.end > line.start)
    .sort((a, b) => a.start - b.start)
    .slice(0, 400);
}

/** Lyric lines from Whisper segments: long segments split on their words. */
export function lyricsFromSegments(segments, { maxSeconds = 7 } = {}) {
  const lines = [];
  for (const segment of Array.isArray(segments) ? segments : []) {
    const words = (segment.words || []).filter((w) => String(w.word || "").trim());
    if (segment.end - segment.start <= maxSeconds || words.length < 4) {
      lines.push({ start: segment.start, end: segment.end, text: segment.text });
      continue;
    }
    let current = [];
    for (const word of words) {
      if (current.length && word.end - current[0].start > maxSeconds) {
        lines.push({ start: current[0].start, end: current[current.length - 1].end, text: current.map((w) => w.word).join(" ") });
        current = [];
      }
      current.push(word);
    }
    if (current.length) lines.push({ start: current[0].start, end: current[current.length - 1].end, text: current.map((w) => w.word).join(" ") });
  }
  return normalizeLyrics(lines.map((line, i) => ({ ...line, id: `l${i + 1}` })));
}

const msRound = (n) => Math.round(Number(n) * 1000) / 1000;
const nearestTime = (list, t) => list.reduce((best, x) => (best === undefined || Math.abs(x - t) < Math.abs(best - t) ? x : best), undefined);

/**
 * A song's beat grid clamped to the song: tempo, beat times, and bar starts
 * (4/4) in seconds. Null when there is no usable tempo.
 */
export function normalizeBeatGrid(grid, duration = Infinity) {
  const bpm = Number(grid?.bpm);
  if (!(bpm >= 40 && bpm <= 260)) return null;
  const max = Number(duration) > 0 ? Number(duration) : Infinity;
  const times = (list) =>
    [...new Set((Array.isArray(list) ? list : []).map(Number).filter((t) => Number.isFinite(t) && t >= 0 && t <= max).map(msRound))]
      .sort((a, b) => a - b)
      .slice(0, 4000);
  const beats = times(grid.beats);
  if (beats.length < 4) return null;
  const bars = times(grid.bars);
  return { bpm: Math.round(bpm * 10) / 10, beats, bars: bars.length ? bars : beats.filter((_, i) => i % 4 === 0) };
}

/** A scene's slice of the beat grid, in seconds from the scene start. */
export function sceneBeatGrid(scene, grid) {
  if (!grid?.bpm) return null;
  const start = Number(scene?.start) || 0;
  const end = Number(scene?.end) || 0;
  const inside = (list) => (list || []).filter((t) => t >= start - 0.02 && t < end - 0.05).map((t) => msRound(Math.max(0, t - start)));
  return { bpm: grid.bpm, beats: inside(grid.beats), bars: inside(grid.bars) };
}

// Scene cuts on the beat grid: every cut is a bar line. Among the bars that
// keep a scene within [min, max], take the one nearest `target`, favouring the
// bar a lyric line starts on (where verses and hooks turn) and whole phrases
// of an even number of bars.
function barSpans(lines, total, grid, { target, max, min }) {
  const barLength = 240 / grid.bpm;
  const bars = grid.bars.filter((t) => t > 0.3 && t < total - 0.3);
  const lyricBars = new Set();
  for (const line of lines) {
    const bar = nearestTime(bars, line.start);
    if (bar !== undefined && Math.abs(bar - line.start) <= barLength / 2) lyricBars.add(bar);
  }
  const spans = [];
  let start = 0;
  while (total - start > max) {
    let best = null;
    for (const t of bars) {
      const span = t - start;
      if (span < min || span > max) continue;
      const count = Math.round(span / barLength);
      const cost = Math.abs(span - target) - (lyricBars.has(t) ? barLength : 0) - (count > 0 && count % 2 === 0 ? barLength / 4 : 0) + (total - t < min ? 100 : 0);
      if (!best || cost < best.cost) best = { t, cost };
    }
    // No bar in reach (a gap in the grid): cut at the target.
    const end = best ? best.t : start + Math.min(target, total - start - min);
    spans.push([start, end]);
    start = end;
  }
  spans.push([start, total]);
  return spans;
}

/**
 * Cut a song into scenes that tile it from 0 to its end. With a beat grid,
 * cuts fall on bar lines (lyric bars first); without one, on lyric line
 * starts. Scenes aim for `target` seconds, never exceed `max` (one clip), and
 * never drop under `min`. Each scene carries the lyric lines it holds, and
 * with a grid, how many bars it runs.
 */
export function songScenePlan(lyrics, duration, { target = 8, max = 12, min = 4, grid = null } = {}) {
  const total = Number(duration) || 0;
  if (total < min) return total > 0 ? [{ id: "s1", start: 0, end: round(total), lyrics: normalizeLyrics(lyrics, total) }] : [];
  const lines = normalizeLyrics(lyrics, total);
  const beatGrid = normalizeBeatGrid(grid, total);
  const spans = beatGrid && beatGrid.bars.length >= 2 ? barSpans(lines, total, beatGrid, { target, max, min }) : lyricSpans(lines, total, { target, max, min });
  // Fold a too-short scene into its neighbour while that stays within one clip.
  for (let i = 0; i < spans.length; i++) {
    if (spans.length < 2 || spans[i][1] - spans[i][0] >= min) continue;
    const prev = spans[i - 1];
    const nextSpan = spans[i + 1];
    if (prev && spans[i][1] - prev[0] <= max) {
      prev[1] = spans[i][1];
      spans.splice(i--, 1);
    } else if (nextSpan && nextSpan[1] - spans[i][0] <= max) {
      nextSpan[0] = spans[i][0];
      spans.splice(i--, 1);
    }
  }
  return spans.map(([s, e], i) => ({
    id: `s${i + 1}`,
    start: round(s),
    end: round(e),
    ...(beatGrid ? { bars: Math.max(1, Math.round(((e - s) * beatGrid.bpm) / 240)) } : {}),
    lyrics: lines.filter((line) => {
      const overlap = Math.min(line.end, e) - Math.max(line.start, s);
      return overlap > 0 && overlap >= (line.end - line.start) / 2;
    }),
  }));
}

function lyricSpans(lines, total, { target, max, min }) {
  const points = [0];
  for (const line of lines) if (line.start > points[points.length - 1] + 0.3 && line.start < total - 0.3) points.push(line.start);
  points.push(total);

  let spans = [];
  let start = 0;
  for (let i = 1; i < points.length; i++) {
    const end = points[i];
    const next = points[i + 1];
    const span = end - start;
    const last = i === points.length - 1;
    const wouldOverflow = next !== undefined && next - start > max;
    if (last || span >= target || (wouldOverflow && span >= min)) {
      spans.push([start, end]);
      start = end;
    }
  }
  // Split anything still longer than one clip into equal parts.
  spans = spans.flatMap(([s, e]) => {
    const n = Math.ceil((e - s) / max - 1e-9);
    if (n <= 1) return [[s, e]];
    return Array.from({ length: n }, (_, k) => [s + ((e - s) * k) / n, s + ((e - s) * (k + 1)) / n]);
  });
  return spans;
}

const squash = (text) => String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Timeline of a music-video scene, in seconds from the scene start: a beat
 * that sings a lyric line sits on that line's time; other beats share the
 * time that is left, in order, with each shot change snapped to the nearest
 * beat when the scene's beat grid (from sceneBeatGrid) is given.
 */
export function musicSceneTimeline(scene, grid = null) {
  const pulse = (grid?.beats || []).filter((t) => t > 0);
  const start = Number(scene.start) || 0;
  const length = Math.max(0.5, (Number(scene.end) || 0) - start);
  const lyrics = normalizeLyrics(scene.lyrics || []);
  const used = new Set();
  const placed = (scene.beats || []).map((beat) => {
    if (!beat.line) return { beat, at: null };
    const match = lyrics.find((line) => !used.has(line.id) && squash(line.text) === squash(beat.line))
      || lyrics.find((line) => !used.has(line.id) && squash(line.text).includes(squash(beat.line).slice(0, 24)));
    if (!match) return { beat, at: null };
    used.add(match.id);
    return { beat, at: [Math.max(0, match.start - start), Math.min(length, match.end - start)] };
  });
  // Fill the unplaced beats between their placed neighbours.
  const out = [];
  let i = 0;
  while (i < placed.length) {
    if (placed[i].at) {
      out.push(placed[i]);
      i++;
      continue;
    }
    let j = i;
    while (j < placed.length && !placed[j].at) j++;
    const from = out.length ? out[out.length - 1].at[1] : 0;
    const to = j < placed.length ? placed[j].at[0] : length;
    const span = Math.max(0.2, to - from);
    const cuts = [from];
    for (let k = 1; k < j - i; k++) {
      const even = from + (span * k) / (j - i);
      const beat = nearestTime(pulse.filter((t) => t > cuts[cuts.length - 1] + 0.3 && t < to - 0.3), even);
      cuts.push(beat !== undefined && Math.abs(beat - even) <= span / (j - i) / 2 ? beat : even);
    }
    cuts.push(from + span);
    for (let k = i; k < j; k++) out.push({ beat: placed[k].beat, at: [cuts[k - i], cuts[k - i + 1]] });
    i = j;
  }
  return out.map(({ beat, at }) => ({
    beatId: beat.id,
    speaker: beat.speaker,
    line: beat.line,
    emotion: beat.emotion,
    start: round(at[0]),
    end: round(Math.max(at[0] + 0.1, at[1])),
    silent: !beat.line,
  }));
}

/** Seconds the screenplay should cover for a unit of this format. */
export function unitSeconds(format, series) {
  const drama = series?.metadata?.drama || series || {};
  if (format === "music") return Number(drama.song?.duration) || 0;
  return formatLength(format, drama.episodeSeconds).seconds;
}
