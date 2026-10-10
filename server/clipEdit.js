// AI Clipping finishing: the pure pieces behind filler and silence trimming,
// emoji captions, and the brand kit. Everything here works on numbers and
// strings so it can be tested without ffmpeg; creatorStudio's runClipping
// runs the commands.
//
// Timelines: a clip's words are relative to the clip start (0 = the first
// frame of the cut). Trimming keeps a list of { start, end } spans on that
// timeline; remapTime moves a time onto the trimmed (joined) timeline.

// ---------- Filler words ----------
// Always filler when spoken on their own.
const HESITATIONS = new Set(["um", "umm", "ummm", "uh", "uhh", "uhm", "uhhh", "erm", "er", "err", "hmm", "hm", "hmmm", "mm", "mmm"]);
const bare = (text) => String(text || "").toLowerCase().replace(/[^a-z']/g, "");
const endsWithBreak = (text) => /[,.;:!?…—-]["'”’)]*$/.test(String(text || "").trim());
const wordText = (word) => String(word?.word ?? word?.text ?? "").trim();

/**
 * Indices of filler words. Hesitations (um, uh, erm, hmm) always count;
 * "you know" and "like" only when set off by commas on both sides, the way
 * Whisper punctuates a verbal tic (", like," / ", you know,"). Anything less
 * clear stays: cutting a real word is worse than keeping a tic.
 */
export function fillerIndexes(words) {
  const list = Array.isArray(words) ? words : [];
  const out = new Set();
  for (let i = 0; i < list.length; i++) {
    const text = wordText(list[i]);
    const plain = bare(text);
    if (!plain) continue;
    if (HESITATIONS.has(plain)) {
      out.add(i);
      continue;
    }
    const before = i === 0 || endsWithBreak(wordText(list[i - 1]));
    if (plain === "like" && i > 0 && before && /,["'”’)]*$/.test(text)) out.add(i);
    if (plain === "you" && bare(wordText(list[i + 1])) === "know" && before && /,["'”’)]*$/.test(wordText(list[i + 1])) && i + 2 < list.length) {
      out.add(i);
      out.add(i + 1);
      i++;
    }
  }
  return out;
}

/** The words of a moment from Whisper segments, relative to the clip start. */
export function clipWords(segments, clipStart, clipEnd) {
  const start = Number(clipStart) || 0;
  const length = Math.max(0, (Number(clipEnd) || 0) - start);
  const words = [];
  for (const segment of Array.isArray(segments) ? segments : []) {
    for (const word of Array.isArray(segment?.words) ? segment.words : []) {
      const text = wordText(word);
      const a = Number(word.start), b = Number(word.end);
      if (!text || !Number.isFinite(a) || !Number.isFinite(b)) continue;
      const middle = (a + b) / 2;
      if (middle < start || middle >= start + length) continue;
      words.push({ word: text, start: round(Math.max(0, a - start)), end: round(Math.min(length, Math.max(b, a + 0.05) - start)) });
    }
  }
  return words.sort((x, y) => x.start - y.start);
}

/**
 * Spans of the clip to keep: speech, minus filler words and pauses longer than
 * `maxPause`. Each kept word gets `pad` seconds either side so cuts never clip
 * a consonant. Returns [{ start, end }] in order; the whole clip when nothing
 * is worth cutting (or there are no word timings to cut by).
 */
export function keptSegments(words, duration, { maxPause = 0.6, pad = 0.08, minCut = 0.12 } = {}) {
  const length = Math.max(0, Number(duration) || 0);
  const whole = [{ start: 0, end: length }];
  const list = (Array.isArray(words) ? words : []).filter((w) => Number.isFinite(w.start) && Number.isFinite(w.end) && w.end > w.start);
  if (!list.length || !length) return whole;
  const fillers = fillerIndexes(list);
  const spans = [];
  let pending = []; // filler words since the last kept word
  let previous = null;
  for (let i = 0; i < list.length; i++) {
    const word = list[i];
    if (fillers.has(i)) {
      pending.push(word);
      continue;
    }
    let start = Math.max(0, word.start - pad);
    const end = Math.min(length, word.end + pad);
    const last = spans.at(-1);
    if (!last) {
      // Lead-in: a short breath before the first word stays; dead air or a hesitation goes.
      if (pending.length) start = Math.max(start, pending.at(-1).end);
      else if (word.start <= maxPause) start = 0;
      spans.push({ start, end });
    } else if (pending.length) {
      last.end = Math.min(last.end, pending[0].start);
      start = Math.max(start, pending.at(-1).end);
      spans.push({ start, end });
    } else if (word.start - previous.end <= maxPause) {
      last.end = Math.max(last.end, end);
    } else {
      spans.push({ start, end });
    }
    pending = [];
    previous = word;
  }
  if (!spans.length) return whole;
  const tail = spans.at(-1);
  if (!pending.length && length - previous.end <= maxPause) tail.end = length;
  else if (pending.length) tail.end = Math.min(tail.end, pending[0].start);
  // Merge touching spans and drop slivers left by the clamps.
  const merged = [];
  for (const span of spans) {
    if (span.end - span.start < 0.04) continue;
    const last = merged.at(-1);
    if (last && span.start - last.end < minCut) last.end = Math.max(last.end, span.end);
    else merged.push({ start: round(span.start), end: round(span.end) });
  }
  for (const span of merged) span.end = round(span.end);
  if (!merged.length) return whole;
  return length - keptDuration(merged) < minCut ? whole : merged;
}

const round = (value) => Math.round(value * 1000) / 1000;
export const keptDuration = (spans) => round((spans || []).reduce((sum, span) => sum + Math.max(0, span.end - span.start), 0));

/** A time on the clip timeline moved onto the trimmed timeline; cut time snaps to the next kept span. */
export function remapTime(time, spans) {
  let offset = 0;
  for (const span of spans) {
    if (time < span.start) return round(offset);
    if (time <= span.end) return round(offset + time - span.start);
    offset += span.end - span.start;
  }
  return round(offset);
}

/** Words on the trimmed timeline. Words that were cut (fillers) drop out. */
export function remapWords(words, spans) {
  return (words || [])
    .filter((word) => spans.some((span) => (word.start + word.end) / 2 >= span.start && (word.start + word.end) / 2 <= span.end))
    .map((word) => {
      const start = remapTime(word.start, spans);
      return { ...word, start, end: Math.max(start + 0.05, remapTime(word.end, spans)) };
    });
}

/**
 * The segments for a clip's captions, relative to the clip (and to the trimmed
 * timeline when `spans` cut anything). Segments with Whisper word timings keep
 * them; ones without keep only their text and times.
 */
export function clipCaptionSegments(segments, clipStart, clipEnd, spans = null) {
  const start = Number(clipStart) || 0;
  const length = Math.max(0, (Number(clipEnd) || 0) - start);
  const map = (t) => (spans ? remapTime(t, spans) : round(t));
  const out = [];
  for (const segment of Array.isArray(segments) ? segments : []) {
    const a = Math.max(0, Number(segment.start) - start), b = Math.min(length, Number(segment.end) - start);
    if (!(b > a)) continue;
    const words = clipWords([segment], clipStart, clipEnd);
    const kept = spans ? remapWords(words, spans) : words;
    const text = words.length ? kept.map((word) => word.word).join(" ") : String(segment.text || "").replace(/\s+/g, " ").trim();
    if (!text) continue;
    const from = kept.length ? kept[0].start : map(a);
    const to = kept.length ? kept.at(-1).end : map(b);
    if (to > from) out.push({ start: from, end: to, text, ...(words.length ? { words: kept } : {}) });
  }
  return out;
}

/** ffmpeg -filter_complex that joins the kept spans of input 0 into [kv] (and [ka] when there is audio). */
export function trimFilter(spans, { audio = true } = {}) {
  const parts = [];
  const labels = [];
  spans.forEach((span, i) => {
    const range = `start=${span.start.toFixed(3)}:end=${span.end.toFixed(3)}`;
    parts.push(`[0:v]trim=${range},setpts=PTS-STARTPTS[v${i}]`);
    if (audio) parts.push(`[0:a]atrim=${range},asetpts=PTS-STARTPTS[a${i}]`);
    labels.push(audio ? `[v${i}][a${i}]` : `[v${i}]`);
  });
  parts.push(`${labels.join("")}concat=n=${spans.length}:v=1:a=${audio ? 1 : 0}[kv]${audio ? "[ka]" : ""}`);
  return parts.join(";");
}

// ---------- Emoji captions ----------
const EMOJI = /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator})(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|\p{Regional_Indicator}|️|‍)*$/u;

/** The text model prompt for picking emoji: chunk index → emoji for about one chunk in three. */
export function emojiMessages(chunks) {
  const lines = chunks.map((chunk, i) => `${i}: ${chunk.words.map((word) => word.text ?? word.word).join(" ")}`).join("\n");
  const most = Math.max(1, Math.ceil(chunks.length / 3));
  return [{
    role: "user",
    content: `These are the caption lines of a short video, one per line, numbered. Pick up to ${most} lines whose key word has an obvious, well-known emoji (money 💰, fire 🔥, brain 🧠, rocket 🚀, heart ❤️, laughing 😂), spread through the video, and give each one emoji. Skip lines where no emoji clearly fits, and never use flags, hand gestures that could offend, or emoji about religion or politics. Return JSON only: {"emoji":{"<line number>":"<one emoji>"}}

${lines}`,
  }];
}

/** The model's answer cleaned up: a Map of chunk index → one emoji, at most one chunk in three. */
export function cleanEmojiPicks(value, count) {
  const picks = new Map();
  const most = Math.max(1, Math.ceil(count / 3));
  const entries = value && typeof value.emoji === "object" && value.emoji ? Object.entries(value.emoji) : [];
  for (const [key, raw] of entries) {
    const index = Number(key);
    const emoji = String(raw || "").trim();
    if (!Number.isInteger(index) || index < 0 || index >= count || picks.has(index)) continue;
    if (!emoji || emoji.length > 16 || !EMOJI.test(emoji)) continue;
    picks.set(index, emoji);
    if (picks.size >= most) break;
  }
  return picks;
}

/** Chunks with each pick attached to the chunk's last word, where the ASS writer renders it. */
export function withEmoji(chunks, picks) {
  return chunks.map((chunk, i) => {
    const emoji = picks.get(i);
    if (!emoji || !chunk.words.length) return chunk;
    const words = chunk.words.slice();
    words[words.length - 1] = { ...words.at(-1), emoji };
    return { ...chunk, words };
  });
}

// ---------- Brand kit ----------
export const LOGO_POSITIONS = ["top-left", "top-right", "bottom-left", "bottom-right"];
const HEX = /^#[0-9a-f]{6}$/i;

/** A caption style with the kit's font and colours over it (primary = caption text, accent = the spoken word). */
export function brandedCaptionStyle(style, kit, fonts) {
  if (!style || !kit) return style;
  const colors = { ...style.colors };
  if (HEX.test(String(kit.primaryColor || ""))) colors.text = kit.primaryColor;
  if (HEX.test(String(kit.accentColor || ""))) {
    colors.active = kit.accentColor;
    if (colors.box) colors.box = kit.accentColor;
  }
  const font = kit.captionFont && fonts?.[kit.captionFont] ? kit.captionFont : style.font;
  return { ...style, font, colors };
}

/**
 * The finishing filters appended after framing: the logo overlay, then the
 * burned captions on top. `input` is the framed video's label (e.g. "framed");
 * `captionFilter` is a complete `ass=…` / `subtitles=…` filter or empty; `logo`
 * is { index, position, opacity } for an image input. Returns the filter
 * strings to join with ";" and the label of the finished picture.
 */
export function clipFinishFilters(input, { captionFilter = "", logo = null, width = 720 } = {}) {
  const graph = [];
  let current = input;
  if (logo && Number.isInteger(logo.index)) {
    const size = Math.max(48, Math.round(width * 0.16));
    const margin = Math.max(12, Math.round(width * 0.035));
    const opacity = Math.min(1, Math.max(0.1, Number(logo.opacity) || 1));
    const position = LOGO_POSITIONS.includes(logo.position) ? logo.position : "top-right";
    const x = position.endsWith("left") ? `${margin}` : `W-w-${margin}`;
    const y = position.startsWith("top") ? `${margin}` : `H-h-${margin}`;
    graph.push(`[${logo.index}:v]scale=${size}:-1,format=rgba,colorchannelmixer=aa=${opacity.toFixed(2)}[logo]`);
    graph.push(`[${current}][logo]overlay=${x}:${y}:format=auto[branded]`);
    current = "branded";
  }
  if (captionFilter) {
    graph.push(`[${current}]${captionFilter}[captioned]`);
    current = "captioned";
  }
  graph.push(`[${current}]format=yuv420p[outv]`);
  return { graph, output: "outv" };
}

/**
 * The filter that puts an intro and/or outro around a clip. Inputs are in
 * order (intro?, clip, outro?), each { audio: boolean, duration }; every part is
 * scaled and padded to the clip's frame and frame rate, and silent parts get
 * silence so the concat has audio throughout.
 */
export function bookendFilter(parts, { width, height, fps }) {
  const graph = [];
  const labels = [];
  const rate = Number(fps) > 0 && Number(fps) <= 120 ? Number(fps) : 30;
  parts.forEach((part, i) => {
    graph.push(`[${i}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=${rate},format=yuv420p[bv${i}]`);
    graph.push(part.audio
      ? `[${i}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[ba${i}]`
      : `anullsrc=r=48000:cl=stereo,atrim=duration=${Math.max(0.1, Number(part.duration) || 0.1).toFixed(3)}[ba${i}]`);
    labels.push(`[bv${i}][ba${i}]`);
  });
  graph.push(`${labels.join("")}concat=n=${parts.length}:v=1:a=1[bv][ba]`);
  return graph.join(";");
}
