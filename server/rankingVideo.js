// Ranking Video: a topic becomes a narrated vertical countdown Short made from real clips found on
// YouTube and TikTok (the @GuruRanks format, fixed where it was weak), or a ~7 s reaction loop.
//   1. Concept: one text call plans the two-line title, the hook, and N entries with search queries.
//   2. Search: YouTube (web search, then yt-dlp on the YouTube worker) and TikTok keyword search;
//      agency and licensing uploads are skipped by their metadata.
//   3. Check: every candidate is downloaded and read by one vision call (6 frames, its cuts, a short
//      transcript) for fit, quality, the best 3-4 s window, and the burned-in captions or watermarks
//      to crop away. The strongest clip becomes #1; runners-up stay on the plan for swaps.
//   4. Script and voice: a hook line and a line per entry, labels written from what the clip shows.
//   5. Render: one ffmpeg call (creatorCommand, so the media worker when this host has none) over a
//      blurred fill, with the title band and the rank list as PNG overlays drawn here from the caption
//      fonts' own outlines (no libass, no system fonts), the original audio ducked under narration.
// Pure helpers are exported for server/rankingVideo.test.ts; the pipeline takes its I/O as options.
import fs from "node:fs/promises";
import path from "node:path";
import { requestOpenRouter } from "../src/utils/openRouterClient.js";
import { creatorCommand, captionFontBytes } from "./creatorWorkspace.js";
import { frameArgs, parseSceneTimes } from "./videoWatch.js";
import { CAPTION_FONTS, captionBurnFilter, captionChunks, captionsAss, findCaptionStyle } from "../src/utils/captionStyles.js";
import { buildNicheIndex, classifyNiche } from "../src/utils/nicheClassifier.js";

export const RANKING = {
  width: 1080,
  height: 1920,
  fps: 30,
  minCount: 3,
  maxCount: 10,
  defaultCount: 5,
  // Candidates checked per entry, and the longest source worth downloading.
  candidates: 4,
  preferSeconds: 90,
  maxSourceSeconds: 240,
  checkFrames: 6,
  // An entry's screen time: its narration line, then a few seconds of the clip's own sound, sized so
  // the countdown lands near targetSeconds (20-30 s).
  windowMin: 4,
  windowMax: 8,
  entryMax: 10,
  targetSeconds: 24,
  afterMin: 1.5,
  afterMax: 5,
  hold: 0.8,
  loopTail: 0.3,
  // Clip audio while the narrator speaks (-12 dB).
  duck: 0.25,
  reactionSeconds: 1.6,
  // Layout, as fractions of the frame: the title band, and the rank list's column.
  band: 0.1,
  listX: 0.05,
  listTop: 0.3,
  listBottom: 0.8,
};
export const RANKING_TEMPLATES = ["countdown", "reaction-loop"];
export const RANKING_DEFAULT_CAPTION_STYLE = "hormozi";
export const RANKING_DEFAULT_REACTION = "cartoon forest animals in Santa hats laughing hysterically, rolling on the snowy ground, bright Pixar-style 3D animation";
// The narrator's default: Gemini's upbeat voice, which suits a countdown.
export const RANKING_DEFAULT_VOICE = "Puck";
// #1 yellow, #2 orange, #3 red, the rest white.
export const RANK_COLORS = { 1: "#FFD60A", 2: "#FF8A00", 3: "#FF3B30" };
export const rankColor = (rank) => RANK_COLORS[rank] || "#FFFFFF";
const TITLE_RED = "#FF3B30";
const TITLE_YELLOW = "#FFD60A";
const TITLE_FONT = CAPTION_FONTS.Anton;
const EMOJI_FONT_FILE = "NotoEmoji.ttf";

const clip = (value, max) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const round = (n, places = 2) => Math.round(n * 10 ** places) / 10 ** places;
const num = (value, fallback = null) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));
const even = (value) => 2 * Math.round(value / 2);
const fail = (message, statusCode = 422) => Object.assign(new Error(message), { statusCode });
const blocked = (error) => error?.name === "UsageBlockedError" || error?.status === 402 || error?.statusCode === 402;

// ---------- Settings (pure) ----------

/** The Ranking Video settings from a studio request (normalizeRequest spreads these in). */
export function rankingSettings(s = {}, { captionStyleOk = (id) => Boolean(findCaptionStyle(id)) } = {}) {
  const template = RANKING_TEMPLATES.includes(s.template) ? s.template : "countdown";
  const count = template === "reaction-loop" ? 1 : clamp(Math.round(num(s.count, RANKING.defaultCount)), RANKING.minCount, RANKING.maxCount);
  const picks = {};
  if (s.picks && typeof s.picks === "object")
    for (const [rank, id] of Object.entries(s.picks).slice(0, RANKING.maxCount)) {
      const r = Math.round(Number(rank));
      if (r >= 1 && r <= RANKING.maxCount && /^(youtube|tiktok):[\w-]{1,40}$/.test(String(id))) picks[r] = String(id);
    }
  return {
    template,
    count,
    language: clip(s.language, 40) || "English",
    voiceId: clip(s.voiceId, 200) || undefined,
    captions: s.captions !== false,
    captionStyle: captionStyleOk(s.captionStyle) ? String(s.captionStyle) : RANKING_DEFAULT_CAPTION_STYLE,
    // The countdown keeps the clips' own sound; the reaction loop plays over music.
    music: typeof s.music === "boolean" ? s.music : template === "reaction-loop",
    reactionPrompt: template === "reaction-loop" ? clip(s.reactionPrompt, 300) || RANKING_DEFAULT_REACTION : undefined,
    planId: /^job-[a-z0-9-]+$/.test(String(s.planId || "")) ? String(s.planId) : undefined,
    ...(Object.keys(picks).length ? { picks } : {}),
  };
}

// ---------- Concept (pure) ----------

/** The countdown format from the format library, as grounding for the plan. */
export function formatGuide(library = []) {
  const f = (Array.isArray(library) ? library : []).find((item) => item?.id === "ranked-countdown");
  if (!f) return "";
  return [
    `FORMAT "${f.name}": ${clip(f.summary, 300)}`,
    f.hookTemplates?.length && `Hook patterns that work: ${f.hookTemplates.slice(0, 4).map((h) => `"${clip(h, 120)}"`).join(" ")}`,
    f.titlePatterns?.length && `Title patterns: ${f.titlePatterns.slice(0, 4).join(" | ")}`,
    f.retentionTips?.length && `Retention: ${f.retentionTips.slice(0, 3).join(" ")}`,
    f.trendNote && `Watch out: ${clip(f.trendNote, 300)}`,
  ].filter(Boolean).join("\n");
}

/** The niche a topic belongs to, from the niche library (null when nothing fits). */
export function topicNiche(library, topic) {
  if (!topic || !Array.isArray(library) || !library.length) return null;
  const match = classifyNiche(buildNicheIndex(library), { title: topic, query: topic });
  return match && !match.fallback ? match : null;
}

export function conceptPrompt({ topic, count, language, template, format = "", niche = null }) {
  const loop = template === "reaction-loop";
  return `You plan viral vertical Shorts made from real clips found on YouTube and TikTok.
${loop
    ? `FORMAT: a ~7 second loop. One real fail clip: the setup, a cut to a funny AI reaction, the payoff, the reaction again. Plan exactly 1 entry: the fail clip to search for.`
    : `FORMAT: a 20-30 second countdown from #${count} to #1; each entry is the narrator's line, then a few seconds of the clip playing with its own sound; hard cuts, real clips, a big two-line title band on top, a rank list on the left. #1 is the most shocking or funniest.`}
${format ? `${format}\n` : ""}${niche ? `NICHE: ${niche.macroNiche} > ${niche.subNiche}\n` : ""}
${topic ? `TOPIC: ${topic}` : `NO TOPIC GIVEN: pick one topic that real short clips exist for in abundance on YouTube Shorts and TikTok (funny animals, kids, fails, sports moments, satisfying, nature), phrased like "funniest toddler fails".`}
LANGUAGE for the title, hook, and labels: ${language}. Search queries stay in English unless the topic is local to another language.

Write:
- "topic": the topic in a few words.
- "title": two short lines in capitals (at most 3 words each), e.g. ["TOP 5 FUNNIEST", "TODDLER FAILS"]; "red" is one word of it to colour red, "yellow" another word to colour yellow (copy them exactly).
- "hook": one spoken line of at most 9 words for the first 2 seconds that makes people stay (tease #1, never "welcome", never "in this video").
- "entries": ${loop ? 1 : count} different moments. Each: "queries" (1-2 YouTube/TikTok search phrases, 2-5 words, no hashtags, broad enough that dozens of short single-moment clips exist for them, e.g. "toddler slips funny" rather than "toddler slips on banana peel in kitchen"), "moment" (what the clip must show, one sentence), "label" (an idea for the on-screen label, at most 3 words).
Entries must be clearly different from each other, so the clips found are different.
Return JSON only: {"topic":"","title":{"lines":["",""],"red":"","yellow":""},"hook":"","entries":[{"queries":[""],"moment":"","label":""}]}`;
}

const words = (text) => clip(text, 400).split(" ").filter(Boolean);
const capWords = (text, max) => words(text).slice(0, max).join(" ");

/** The planner's answer, cleaned: a two-line title whose coloured words are really in it, N entries. */
export function normalizeConcept(value, { topic = "", count = RANKING.defaultCount, template = "countdown" } = {}) {
  const v = value && typeof value === "object" ? value : {};
  const want = template === "reaction-loop" ? 1 : count;
  const lines = (Array.isArray(v.title?.lines) ? v.title.lines : [v.title]).map((l) => capWords(l, 4).toUpperCase()).filter(Boolean).slice(0, 2);
  const theTopic = clip(v.topic, 120) || clip(topic, 120);
  if (!lines.length) lines.push(...(template === "reaction-loop" ? ["WAIT FOR IT"] : [`TOP ${want}`, capWords(theTopic, 3).toUpperCase() || "MOMENTS"]));
  const titleWords = lines.join(" ").split(" ");
  const has = (word) => titleWords.includes(clip(word, 40).toUpperCase());
  const red = has(v.title?.red) ? clip(v.title.red, 40).toUpperCase() : titleWords.at(-1);
  const yellow = has(v.title?.yellow) && clip(v.title.yellow, 40).toUpperCase() !== red ? clip(v.title.yellow, 40).toUpperCase() : titleWords.find((w) => w !== red && !/^(TOP|THE|OF|A|AN|\d+)$/.test(w)) || "";
  const entries = (Array.isArray(v.entries) ? v.entries : [])
    .map((e) => ({
      queries: (Array.isArray(e?.queries) ? e.queries : [e?.query]).map((q) => clip(String(q || "").replace(/#/g, ""), 80)).filter(Boolean).slice(0, 2),
      moment: clip(e?.moment, 240),
      label: capWords(e?.label, 3),
    }))
    .filter((e) => e.queries.length)
    .slice(0, want);
  if (!entries.length) throw fail("The plan came back without any clips to look for. Try again or reword the topic.", 502);
  return { topic: theTopic, title: { lines, red, yellow }, hook: capWords(v.hook, 12), entries };
}

// ---------- Search (pure) ----------

// Agency and licensing uploads (and anything claiming copyright) are never used.
const LICENSED = /jukin|viral\s*hog|storyful|newsflare|caters|licens(?:e|ed|ing)|©|\(c\)\s*\d{4}|all rights reserved/i;
export const licensedSource = (c) => LICENSED.test(`${c?.uploader || ""} ${c?.title || ""} ${c?.description || ""}`);

/** "1:23" or "45" or "1:02:03" as seconds; null when unreadable. */
export function parseClock(value) {
  if (Number.isFinite(value)) return Number(value);
  const parts = String(value || "").trim().split(":").map(Number);
  if (!parts.length || parts.some((p) => !Number.isFinite(p))) return null;
  return parts.reduce((total, p) => total * 60 + p, 0);
}

export function youtubeCandidate(v) {
  const id = String(v?.id || "").trim();
  if (!/^[\w-]{11}$/.test(id)) return null;
  return {
    id: `youtube:${id}`,
    platform: "youtube",
    url: v.url && /^https:\/\/(www\.)?youtube\.com\/shorts\//.test(v.url) ? v.url : `https://www.youtube.com/watch?v=${id}`,
    title: clip(v.title, 200),
    uploader: clip(v.uploader || v.channel, 100),
    description: clip(v.description, 500),
    duration: parseClock(v.duration),
  };
}

export function tiktokCandidate(v) {
  const id = String(v?.id || "").trim();
  if (!/^\d{6,30}$/.test(id)) return null;
  const handle = clip(v.authorHandle || v.uploaderId, 60).replace(/^@/, "");
  return {
    id: `tiktok:${id}`,
    platform: "tiktok",
    url: /^https:\/\/www\.tiktok\.com\//.test(String(v.playUrl || "")) ? v.playUrl : `https://www.tiktok.com/@${handle || "_"}/video/${id}`,
    title: clip(v.title || v.desc, 200),
    uploader: clip(v.author || handle, 100) + (handle && v.author && v.author !== handle ? ` (@${handle})` : ""),
    description: "",
    duration: num(v.durationSeconds ?? v.duration),
  };
}

/**
 * The candidates worth checking for one entry: no licensed sources, no repeats (of each other or of
 * clips other entries already took), short ones first, the two platforms interleaved.
 */
export function shortlist(found, { taken = new Set(), max = RANKING.candidates } = {}) {
  const seen = new Set(taken);
  const usable = [];
  for (const c of found) {
    if (!c || seen.has(c.id) || licensedSource(c)) continue;
    if (c.duration !== null && c.duration !== undefined && (c.duration < 3 || c.duration > RANKING.maxSourceSeconds)) continue;
    seen.add(c.id);
    usable.push(c);
  }
  const rank = (c) => (c.duration === null || c.duration === undefined ? 1 : c.duration <= RANKING.preferSeconds ? 0 : 2);
  const sorted = usable.map((c, i) => ({ c, i })).sort((a, b) => rank(a.c) - rank(b.c) || a.i - b.i).map((x) => x.c);
  const byPlatform = { youtube: sorted.filter((c) => c.platform === "youtube"), tiktok: sorted.filter((c) => c.platform === "tiktok") };
  const out = [];
  while (out.length < max && (byPlatform.youtube.length || byPlatform.tiktok.length))
    for (const p of ["youtube", "tiktok"]) if (out.length < max && byPlatform[p].length) out.push(byPlatform[p].shift());
  return out;
}

// ---------- Check (pure) ----------

/** When to take the check frames: spread evenly over the part of the clip that is looked at. */
export function checkTimes(duration, n = RANKING.checkFrames) {
  const d = Math.min(Number(duration) || 0, RANKING.preferSeconds);
  if (d <= 0) return [0];
  return Array.from({ length: n }, (_, i) => round(((i + 0.5) * d) / n, 2));
}

export function checkPrompt({ topic, entry, candidate, times, cuts, transcript, duration, loop = false }) {
  return `You check a real video clip for a vertical ranking Short about "${topic}".
WANTED: ${entry.moment || entry.label}${entry.label ? ` (label idea: ${entry.label})` : ""}.
THE CLIP: "${candidate.title || "untitled"}" by ${candidate.uploader || "unknown"} on ${candidate.platform}, ${round(duration, 1)} s long. ${times.length} frames, labelled with their times.${cuts.length ? ` Its own cuts (scene changes) are at: ${cuts.slice(0, 30).map((t) => `${round(t, 1)}s`).join(", ")}.` : " It has no hard cuts."}
${transcript ? `What is said or heard: ${clip(transcript, 1200)}\n` : ""}
Judge from the frames only; never invent what you can't see.
- "fit" 0-10: does it really show the wanted kind of moment, or at least a strong moment for the topic? (0 = unrelated, a slideshow, a talking head, or only title cards; a compilation is fine when one of its moments fits)
- "quality" 0-10: sharp, well lit, the action readable on a phone, not a screen recording of another video.
- "sees": what actually happens, one sentence.
- "branding": true when a licensing agency or reposting brand shows anywhere (ViralHog, Jukin, Storyful, Newsflare, Caters, "upload & license", "licensing"), else false.
- "window": the best ${loop ? "4-6" : "5-8"} seconds of the action {"start","end"} in seconds, ending just after the payoff; never on an intro, end card, subscribe screen, or title card.
- "cuts": 1-3 pieces inside the window to play in order (hard cuts between them); one piece when the moment is one take.
${loop ? `- "payoff": the second the funny or shocking moment hits, inside the window.\n` : ""}- "boxes": burned-in captions, subtitles, usernames, logos, or watermarks added on top of the footage, each {"kind":"captions|watermark|logo|text","x","y","w","h"} as fractions 0-1 of the frame (x,y the top-left). [] when there are none.
- "label": an on-screen label for THIS clip, at most 3 words, from what it really shows (e.g. "Cake Faceplant"), and "emoji": one emoji that fits.
- "line": one spoken narration line about this clip, at most 12 words, punchy, no rank number.
Return JSON only: {"fit":0,"quality":0,"branding":false,"sees":"","window":{"start":0,"end":0},"cuts":[{"start":0,"end":0}],${loop ? `"payoff":0,` : ""}"boxes":[],"label":"","emoji":"","line":""}`;
}

const EMOJI = /\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic}️?)*/u;
/** The first emoji in the text, or "". */
export const firstEmoji = (value) => (String(value || "").match(EMOJI) || [""])[0];
/** At most 3 words of label, without any emoji in it. */
export const cleanLabel = (value) => capWords(String(value || "").replace(new RegExp(EMOJI.source, "gu"), " ").replace(/["“”]/g, ""), 3);
/** At most 12 words of narration. */
export const cleanLine = (value, max = 12) => capWords(String(value || "").replace(new RegExp(EMOJI.source, "gu"), " "), max);

/** The vision check, cleaned: window and cuts inside the clip, boxes inside the frame, a score. */
export function normalizeCheck(value, { duration, loop = false }) {
  const v = value && typeof value === "object" ? value : {};
  const d = Math.max(0.5, Number(duration) || 0);
  const [lo, hi] = loop ? [4, 6.5] : [RANKING.windowMin, RANKING.windowMax];
  let start = clamp(num(v.window?.start, 0), 0, d);
  let end = clamp(num(v.window?.end, start + 3.5), 0, d);
  if (end - start < lo) end = Math.min(d, start + lo);
  if (end - start < lo) start = Math.max(0, end - lo);
  if (end - start > hi) start = end - hi;
  const cuts = (Array.isArray(v.cuts) ? v.cuts : [])
    .map((c) => ({ start: clamp(num(c?.start, start), start, end), end: clamp(num(c?.end, end), start, end) }))
    .filter((c) => c.end - c.start >= 0.6)
    .sort((a, b) => a.start - b.start)
    .filter((c, i, list) => !i || c.start >= list[i - 1].end - 0.05)
    .slice(0, 3);
  const fit = clamp(num(v.fit, 0), 0, 10);
  const quality = clamp(num(v.quality, 0), 0, 10);
  const boxes = (Array.isArray(v.boxes) ? v.boxes : [])
    .map((b) => ({ kind: clip(b?.kind, 20) || "text", x: clamp(num(b?.x, 0), 0, 1), y: clamp(num(b?.y, 0), 0, 1), w: clamp(num(b?.w, 0), 0, 1), h: clamp(num(b?.h, 0), 0, 1) }))
    .filter((b) => b.w > 0.01 && b.h > 0.01)
    .slice(0, 8);
  const payoff = loop ? clamp(num(v.payoff, (start + end) / 2), start + 1, end - 0.6) : undefined;
  return {
    fit,
    quality,
    score: round(fit * 0.65 + quality * 0.35, 2),
    // Agency or licensing branding on screen rules a clip out, as its metadata would.
    usable: fit >= 5 && quality >= 4 && v.branding !== true,
    branding: v.branding === true,
    sees: clip(v.sees, 300),
    window: { start: round(start), end: round(end) },
    cuts: (cuts.length ? cuts : [{ start, end }]).map((c) => ({ start: round(c.start), end: round(c.end) })),
    ...(loop ? { payoff: round(payoff) } : {}),
    boxes,
    label: cleanLabel(v.label),
    emoji: firstEmoji(v.emoji) || firstEmoji(v.label),
    line: cleanLine(v.line),
  };
}

/**
 * The picture inside any black bars, from ffmpeg cropdetect's per-frame metadata (reset=1, printed with
 * metadata=mode=print): the box most frames agree on, so a full-frame intro or end card doesn't hide
 * bars the rest of the clip has. With `window` ({ start, end } seconds) only frames inside it count
 * (a video can switch between full-frame and boxed footage), all frames when none are. Null when there
 * are no bars.
 */
export function parseCropDetect(text, { width, height }, window = null) {
  const all = new Map(), inside = new Map();
  let frame = {};
  let t = null;
  for (const m of String(text || "").matchAll(/pts_time:([\d.]+)|lavfi\.cropdetect\.(w|h|x|y)=(\d+)/g)) {
    if (m[1] !== undefined) { t = Number(m[1]); frame = {}; continue; }
    frame[m[2]] = Number(m[3]);
    if (m[2] !== "y") continue;
    if (["w", "h", "x"].every((k) => Number.isFinite(frame[k]))) {
      const key = `${frame.w}:${frame.h}:${frame.x}:${frame.y}`;
      all.set(key, (all.get(key) || 0) + 1);
      if (window && t !== null && t >= window.start && t <= window.end) inside.set(key, (inside.get(key) || 0) + 1);
    }
    frame = {};
  }
  const counts = inside.size ? inside : all;
  if (!counts.size) return null;
  const [w, h, x, y] = [...counts].sort((a, b) => b[1] - a[1])[0][0].split(":").map(Number);
  // Bars thinner than 2% are noise. A narrow picture is a real one only when it spans the full other
  // side (a 9:16 phone video boxed into 16:9 is 32% wide); otherwise it's a dark scene, not bars.
  const narrow = (w < width * 0.3 && h < height * 0.9) || (h < height * 0.3 && w < width * 0.9);
  if (narrow || w < width * 0.2 || h < height * 0.2 || (w >= width * 0.98 && h >= height * 0.98)) return null;
  return { x, y, w, h };
}

/**
 * The part of the frame to keep: inside any black bars (`active`, pixels), with burned-in captions and
 * watermarks outside it. A box low in the picture trims the bottom up to it, a high one the top,
 * failing that a side; a box that would leave under 70% of the picture's height or width, or under 60%
 * of its area, is left in. Returns pixels, even-sized.
 */
export function keepRegion(boxes, { width, height }, active = null, { minSide = 0.7, minArea = 0.6 } = {}) {
  const W = Math.max(2, Number(width) || 2), H = Math.max(2, Number(height) || 2);
  const a = active ? { left: active.x / W, top: active.y / H, right: (active.x + active.w) / W, bottom: (active.y + active.h) / H } : { left: 0, top: 0, right: 1, bottom: 1 };
  const aw = a.right - a.left, ah = a.bottom - a.top;
  let { top, bottom, left, right } = a;
  const ok = (t, b, l, r) => b - t >= minSide * ah && r - l >= minSide * aw && (b - t) * (r - l) >= minArea * aw * ah;
  for (const box of boxes || []) {
    // Boxes on the bars go with the bars.
    if (box.x >= a.right || box.x + box.w <= a.left || box.y >= a.bottom || box.y + box.h <= a.top) continue;
    const cy = (box.y + box.h / 2 - a.top) / ah;
    const cx = (box.x + box.w / 2 - a.left) / aw;
    if (cy >= 0.5 && ok(top, Math.min(bottom, box.y), left, right)) bottom = Math.min(bottom, box.y);
    else if (cy < 0.5 && ok(Math.max(top, box.y + box.h), bottom, left, right)) top = Math.max(top, box.y + box.h);
    else if (cx >= 0.5 && ok(top, bottom, left, Math.min(right, box.x))) right = Math.min(right, box.x);
    else if (cx < 0.5 && ok(top, bottom, Math.max(left, box.x + box.w), right)) left = Math.max(left, box.x + box.w);
  }
  const x = even(left * W), y = even(top * H);
  return { x, y, w: Math.max(2, Math.min(W - x, even((right - left) * W))), h: Math.max(2, Math.min(H - y, even((bottom - top) * H))) };
}

/**
 * The clip for each entry: the best usable candidate no other entry took. Entries with none are
 * dropped (fewer than `min` left fails, naming them); the rest are ranked by clip strength, so #1 is
 * the strongest. Runners-up (other usable candidates, best first) stay with each entry for swaps.
 */
export function pickClips(entries, checked, { min = RANKING.minCount } = {}) {
  const used = new Set();
  const picked = [];
  const empty = [];
  // Entries with the fewest good options choose first, so one clip isn't spent where another would do.
  const order = entries.map((entry, i) => ({ entry, i, options: (checked[i] || []).filter((c) => c.check?.usable).sort((a, b) => b.check.score - a.check.score) }))
    .sort((a, b) => a.options.length - b.options.length);
  const left = [];
  for (const { entry, i, options } of order) {
    const chosen = options.find((c) => !used.has(c.id));
    if (!chosen) {
      left.push({ entry, i });
      continue;
    }
    used.add(chosen.id);
    picked.push({ index: i, entry, chosen, runnersUp: options.filter((c) => c !== chosen).slice(0, 3) });
  }
  // An entry whose own search found nothing usable takes the best spare clip another entry's search
  // turned up (it fits the topic; its label is written from what it shows), or is dropped.
  const spare = order.flatMap((o) => o.options).filter((c, k, all) => all.findIndex((x) => x.id === c.id) === k).sort((a, b) => b.check.score - a.check.score);
  for (const { entry, i } of left) {
    const chosen = spare.find((c) => !used.has(c.id));
    if (!chosen) {
      empty.push(entry.label || entry.moment || `entry ${i + 1}`);
      continue;
    }
    used.add(chosen.id);
    picked.push({ index: i, entry: { ...entry, label: "", moment: chosen.check.sees || entry.moment }, chosen, runnersUp: spare.filter((c) => !used.has(c.id)).slice(0, 3) });
  }
  if (picked.length < min)
    throw fail(`Not enough usable clips were found (${picked.length} of ${entries.length}). Nothing good turned up for: ${empty.map((e) => `"${e}"`).join(", ") || "any entry"}. Try a broader topic or fewer entries.`);
  picked.sort((a, b) => b.chosen.check.score - a.chosen.check.score || a.index - b.index);
  // A runner-up is never a clip another entry plays.
  return picked.map((p, k) => ({ ...p, runnersUp: p.runnersUp.filter((c) => !used.has(c.id)), rank: k + 1 }));
}

// ---------- Script (pure) ----------

export function scriptPrompt({ topic, language, hook, picked }) {
  const rows = [...picked].sort((a, b) => b.rank - a.rank);
  return `You write the narration for a vertical countdown Short about "${topic}" in ${language}. It counts down from #${rows.length} to #1. Each line is said as its clip starts; then the clip plays on with its own sound for a few seconds, so the line must not describe the payoff before it happens: set it up.
Draft hook: "${hook}"
THE CLIPS, in the order they play (what each really shows):
${rows.map((p) => `#${p.rank}: ${p.chosen.check.sees || p.entry.moment} (label idea: ${p.chosen.check.label || p.entry.label})`).join("\n")}
Write:
- "hook": the opening line, at most 9 words, spoken in the first 2 seconds; it makes people stay (tease #1). Never "welcome" or "in this video".
- For each rank: "line": 6-9 words (never more than 12), said over that clip, starting with the number ("Number five: ..."), about what's in THAT clip (never what it doesn't show), punchy, and short enough to say in ${rows.length > 6 ? 2.5 : 3} seconds; "label": at most 3 words for the on-screen list, from what's in the clip; "emoji": one emoji.
#1 gets the biggest reaction.
Return JSON only: {"hook":"","entries":[{"rank":1,"line":"","label":"","emoji":""}]}`;
}

/** The script, cleaned and matched to the ranks; anything missing falls back to the clip's own check. */
export function normalizeScript(value, picked, { hook = "" } = {}) {
  const v = value && typeof value === "object" ? value : {};
  const byRank = new Map((Array.isArray(v.entries) ? v.entries : []).map((e) => [Math.round(Number(e?.rank)), e]));
  return {
    hook: cleanLine(v.hook, 9) || cleanLine(hook, 9),
    entries: picked.map((p) => {
      const e = byRank.get(p.rank) || {};
      return {
        rank: p.rank,
        line: cleanLine(e.line) || cleanLine(`Number ${p.rank}: ${p.chosen.check.line}`),
        label: cleanLabel(e.label) || p.chosen.check.label || cleanLabel(p.entry.label) || `Pick ${p.rank}`,
        emoji: firstEmoji(e.emoji) || p.chosen.check.emoji || "",
      };
    }),
  };
}

// ---------- Timeline (pure) ----------

/**
 * Where everything lands, counting down: each entry plays its cuts, stretched (from the source around
 * the window) when its narration needs longer; the hook rides the first clip; #1 holds, then a short
 * tail of the opening frame so a replay loops cleanly.
 * @param {Array<{ rank: number, cuts: Array<{start:number,end:number}>, duration: number, lineSeconds: number }>} entries
 */
export function buildTimeline(entries, { hookSeconds = 0, hold = RANKING.hold, loopTail = RANKING.loopTail } = {}) {
  const order = [...entries].sort((a, b) => b.rank - a.rank);
  /** @type {Array<{ rank: number, start: number, length: number, at: number, hold?: number, tail?: boolean, muted?: boolean }>} */
  const segments = [];
  const voice = [];
  const rows = [];
  let t = 0;
  const leadOf = (k) => (k === 0 && hookSeconds > 0 ? hookSeconds + 0.25 : 0.15);
  // After each line the clip plays on with its own sound; how long is shared out so the whole video
  // lands near the target length.
  const spoken = order.reduce((sum, e, k) => sum + leadOf(k) + (e.lineSeconds || 0), 0) + hold;
  const after = order.length ? clamp((RANKING.targetSeconds - spoken) / order.length, RANKING.afterMin, RANKING.afterMax) : 0;
  order.forEach((e, k) => {
    const lead = leadOf(k);
    const need = lead + (e.lineSeconds || 0) + after;
    const cuts = e.cuts.map((c) => ({ ...c }));
    const have = cuts.reduce((sum, c) => sum + (c.end - c.start), 0);
    // A long window plays at most a second past its share, so the video stays near the target.
    let want = clamp(Math.max(need, Math.min(have, need + 1)), RANKING.windowMin, RANKING.entryMax);
    // Longer than the cuts: start the first one earlier (the run-up to the moment), then run the last
    // one on by at most a second (past the payoff a source often cuts to an end card).
    let extra = want - have;
    if (extra > 0.01) {
      const before = Math.min(extra, cuts[0].start);
      cuts[0].start -= before;
      extra -= before;
      const last = cuts[cuts.length - 1];
      const runOn = Math.min(extra, 2, Math.max(0, (e.duration || last.end) - last.end - 0.3));
      last.end += runOn;
      extra -= runOn;
      want -= extra;
    } else if (have > want + 0.01) {
      // Too long: trim from the front, so the payoff at the end of the window stays.
      let cut = have - want;
      while (cut > 0.01 && cuts.length) {
        const first = cuts[0];
        const take = Math.min(cut, first.end - first.start);
        first.start += take;
        cut -= take;
        if (first.end - first.start < 0.2) cuts.shift();
      }
    }
    const from = t;
    for (const c of cuts) {
      const length = round(c.end - c.start, 3);
      if (length < 0.2) continue;
      segments.push({ rank: e.rank, start: round(c.start, 3), length, at: round(t, 3) });
      t += length;
    }
    if (k === 0 && hookSeconds > 0) voice.push({ kind: "hook", at: 0.1, seconds: hookSeconds });
    // A line never starts over the one before it, even when a short clip couldn't stretch to fit it.
    const prev = voice.at(-1);
    if (e.lineSeconds) voice.push({ kind: "line", rank: e.rank, at: round(Math.max(from + lead, prev ? prev.at + prev.seconds + 0.1 : 0), 3), seconds: e.lineSeconds });
    rows.push({ rank: e.rank, from: round(from, 3), to: round(t, 3) });
  });
  if (segments.length && hold > 0) {
    segments[segments.length - 1].hold = hold;
    t += hold;
    rows[rows.length - 1].to = round(t, 3);
  }
  if (segments.length && loopTail > 0) {
    segments.push({ rank: segments[0].rank, start: segments[0].start, length: loopTail, at: round(t, 3), tail: true, muted: true });
    t += loopTail;
  }
  return { segments, voice, rows, duration: round(t, 3) };
}

/** Narration windows the clip audio ducks under. */
export const duckWindows = (voice) => voice.map((v) => ({ from: round(Math.max(0, v.at - 0.08), 3), to: round(v.at + v.seconds + 0.12, 3) }));

/** Which labels show in each stretch: all numbers from frame 0, each label from its clip's start. */
export function overlayStates(rows, duration) {
  const states = rows.map((row, k) => ({ t0: row.from, t1: k + 1 < rows.length ? rows[k + 1].from : duration, shown: rows.slice(0, k + 1).map((r) => r.rank) }));
  // The loop tail shows the opening state again.
  if (states.length && states.at(-1).t1 > rows.at(-1).to + 0.001) {
    states.at(-1).t1 = rows.at(-1).to;
    states.push({ t0: rows.at(-1).to, t1: duration, shown: states[0].shown });
  }
  return states;
}

// ---------- Fonts: outlines straight from the TTF (pure) ----------

/** A minimal TrueType reader: cmap (formats 4 and 12), hmtx, and glyf outlines with composites. */
export function parseFont(bytes) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const tables = {};
  const count = buf.readUInt16BE(4);
  for (let i = 0; i < count; i++) {
    const at = 12 + i * 16;
    tables[buf.toString("latin1", at, at + 4)] = { offset: buf.readUInt32BE(at + 8), length: buf.readUInt32BE(at + 12) };
  }
  for (const tag of ["head", "hhea", "hmtx", "maxp", "cmap", "loca", "glyf"]) if (!tables[tag]) throw new Error(`Font has no ${tag} table`);
  const head = tables.head.offset;
  const unitsPerEm = buf.readUInt16BE(head + 18);
  const longLoca = buf.readInt16BE(head + 50) === 1;
  const numGlyphs = buf.readUInt16BE(tables.maxp.offset + 4);
  const hhea = tables.hhea.offset;
  const ascender = buf.readInt16BE(hhea + 4);
  const descender = buf.readInt16BE(hhea + 6);
  const metrics = buf.readUInt16BE(hhea + 34);
  const advance = (id) => buf.readUInt16BE(tables.hmtx.offset + 4 * Math.min(id, metrics - 1));
  const loca = (id) => (longLoca ? buf.readUInt32BE(tables.loca.offset + id * 4) : buf.readUInt16BE(tables.loca.offset + id * 2) * 2);

  // Character map: format 12 (full Unicode, emoji) preferred over format 4 (the BMP).
  const cmap = tables.cmap.offset;
  /** @type {(cp: number) => number} */
  let lookup = (_cp) => 0;
  const subtables = Array.from({ length: buf.readUInt16BE(cmap + 2) }, (_, i) => ({ platform: buf.readUInt16BE(cmap + 4 + i * 8), encoding: buf.readUInt16BE(cmap + 6 + i * 8), offset: cmap + buf.readUInt32BE(cmap + 8 + i * 8) }))
    .map((s) => ({ ...s, format: buf.readUInt16BE(s.offset) }));
  const f12 = subtables.find((s) => s.format === 12 && (s.platform === 3 || s.platform === 0));
  const f4 = subtables.find((s) => s.format === 4 && (s.platform === 3 || s.platform === 0));
  if (f12) {
    const groups = buf.readUInt32BE(f12.offset + 12);
    lookup = (cp) => {
      let lo = 0, hi = groups - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const at = f12.offset + 16 + mid * 12;
        const start = buf.readUInt32BE(at), end = buf.readUInt32BE(at + 4);
        if (cp < start) hi = mid - 1;
        else if (cp > end) lo = mid + 1;
        else return buf.readUInt32BE(at + 8) + cp - start;
      }
      return 0;
    };
  } else if (f4) {
    const o = f4.offset;
    const segX2 = buf.readUInt16BE(o + 6);
    const ends = o + 14, starts = ends + segX2 + 2, deltas = starts + segX2, ranges = deltas + segX2;
    lookup = (cp) => {
      if (cp > 0xffff) return 0;
      for (let i = 0; i < segX2; i += 2) {
        if (cp > buf.readUInt16BE(ends + i)) continue;
        const start = buf.readUInt16BE(starts + i);
        if (cp < start) return 0;
        const delta = buf.readInt16BE(deltas + i);
        const range = buf.readUInt16BE(ranges + i);
        if (!range) return (cp + delta) & 0xffff;
        const g = buf.readUInt16BE(ranges + i + range + (cp - start) * 2);
        return g ? (g + delta) & 0xffff : 0;
      }
      return 0;
    };
  }

  // Contours as point lists ({x, y, on}), composites resolved.
  const contours = (id, depth = 0) => {
    if (id >= numGlyphs || depth > 6) return [];
    const start = loca(id), end = loca(id + 1);
    if (end <= start) return [];
    const g = tables.glyf.offset + start;
    const n = buf.readInt16BE(g);
    if (n >= 0) {
      const endPts = Array.from({ length: n }, (_, i) => buf.readUInt16BE(g + 10 + i * 2));
      const total = n ? endPts[n - 1] + 1 : 0;
      let p = g + 10 + n * 2;
      p += 2 + buf.readUInt16BE(p);
      const flags = [];
      while (flags.length < total) {
        const f = buf[p++];
        flags.push(f);
        if (f & 8) for (let r = buf[p++]; r > 0; r--) flags.push(f);
      }
      const coords = (short, same) => {
        let v = 0;
        return flags.map((f) => {
          if (f & short) v += buf[p++] * (f & same ? 1 : -1);
          else if (!(f & same)) { v += buf.readInt16BE(p); p += 2; }
          return v;
        });
      };
      const xs = coords(2, 16);
      const ys = coords(4, 32);
      const out = [];
      let from = 0;
      for (const last of endPts) {
        out.push(Array.from({ length: last - from + 1 }, (_, k) => ({ x: xs[from + k], y: ys[from + k], on: Boolean(flags[from + k] & 1) })));
        from = last + 1;
      }
      return out;
    }
    const out = [];
    let p = g + 10;
    for (;;) {
      const flags = buf.readUInt16BE(p);
      const glyph = buf.readUInt16BE(p + 2);
      p += 4;
      let dx, dy;
      if (flags & 1) { dx = buf.readInt16BE(p); dy = buf.readInt16BE(p + 2); p += 4; }
      else { dx = buf.readInt8(p); dy = buf.readInt8(p + 1); p += 2; }
      if (!(flags & 2)) { dx = 0; dy = 0; }
      let [a, b, c, d] = [1, 0, 0, 1];
      const f2 = (at) => buf.readInt16BE(at) / 16384;
      if (flags & 8) { a = d = f2(p); p += 2; }
      else if (flags & 64) { a = f2(p); d = f2(p + 2); p += 4; }
      else if (flags & 128) { a = f2(p); b = f2(p + 2); c = f2(p + 4); d = f2(p + 6); p += 8; }
      for (const contour of contours(glyph, depth + 1)) out.push(contour.map((pt) => ({ x: a * pt.x + c * pt.y + dx, y: b * pt.x + d * pt.y + dy, on: pt.on })));
      if (!(flags & 32)) break;
    }
    return out;
  };

  /** The glyph's outline as SVG path data at this size, its origin at (x, baseline). */
  const glyphPath = (id, x, baseline, scale) => {
    const X = (v) => round(x + v * scale, 2);
    const Y = (v) => round(baseline - v * scale, 2);
    let d = "";
    for (const pts of contours(id)) {
      if (pts.length < 2) continue;
      // Start on an on-curve point (or the midpoint of two off-curve ones).
      let k = pts.findIndex((pt) => pt.on);
      const ring = k < 0 ? pts : [...pts.slice(k), ...pts.slice(0, k)];
      const start = k < 0 ? { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2, on: true } : ring[0];
      const rest = k < 0 ? ring : ring.slice(1);
      d += `M${X(start.x)} ${Y(start.y)}`;
      let control = null;
      for (const pt of [...rest, start]) {
        if (pt.on) {
          d += control ? `Q${X(control.x)} ${Y(control.y)} ${X(pt.x)} ${Y(pt.y)}` : `L${X(pt.x)} ${Y(pt.y)}`;
          control = null;
        } else if (control) {
          const mid = { x: (control.x + pt.x) / 2, y: (control.y + pt.y) / 2 };
          d += `Q${X(control.x)} ${Y(control.y)} ${X(mid.x)} ${Y(mid.y)}`;
          control = pt;
        } else control = pt;
      }
      if (control) d += `Q${X(control.x)} ${Y(control.y)} ${X(start.x)} ${Y(start.y)}`;
      d += "Z";
    }
    return d;
  };
  return { unitsPerEm, ascender, descender, numGlyphs, glyph: lookup, advance, glyphPath };
}

const INVISIBLE = new Set([0xfe0f, 0xfe0e, 0x200d]);
/**
 * Text set in the first font that has each character (the title face, then emoji), as SVG path data.
 * Returns { d, width } with the origin at (x, baseline).
 */
export function textOutline(fonts, text, { size, x = 0, baseline = 0, tracking = 0 }) {
  let pen = x;
  const parts = [];
  for (const ch of String(text || "")) {
    const cp = ch.codePointAt(0);
    if (INVISIBLE.has(cp)) continue;
    const font = fonts.find((f) => f.glyph(cp)) || fonts[0];
    const id = font.glyph(cp);
    const scale = size / font.unitsPerEm;
    // Emoji sit a touch lower and smaller than caps so they read as one line.
    const emoji = font !== fonts[0];
    const s = emoji ? scale * 0.86 : scale;
    if (id) parts.push(font.glyphPath(id, pen, baseline + (emoji ? size * 0.06 : 0), s));
    pen += font.advance(id) * s + (emoji ? size * 0.08 : tracking);
  }
  return { d: parts.join(""), width: pen - x };
}

// ---------- Overlays (SVG, rasterised by sharp) ----------

const esc = (value) => String(value).replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]);

/** The title band: two lines in the heavy condensed face, one word red and one yellow. */
export function titleBandSvg(fonts, title, { width = RANKING.width, height = RANKING.height } = {}) {
  const band = Math.round(height * RANKING.band);
  const lines = title.lines.slice(0, 2);
  const lineSize = (band * 0.84) / Math.max(1, lines.length) / 1.02;
  const out = [`<rect x="0" y="0" width="${width}" height="${band}" fill="#07070A" fill-opacity="0.94"/>`];
  lines.forEach((line, i) => {
    const w = line.split(" ");
    // Shrink a long line to fit the width.
    const measure = textOutline(fonts, line, { size: lineSize, tracking: lineSize * 0.02 }).width;
    const size = Math.min(lineSize, (width * 0.92 * lineSize) / Math.max(1, measure));
    const space = size * 0.24;
    const widths = w.map((word) => textOutline(fonts, word, { size, tracking: size * 0.02 }).width);
    let x = (width - (widths.reduce((a, b) => a + b, 0) + space * (w.length - 1))) / 2;
    const top = band * 0.08 + (band * 0.84 * i) / lines.length;
    const baseline = top + (band * 0.84) / lines.length / 2 + size * 0.36;
    w.forEach((word, k) => {
      const fill = word === title.red ? TITLE_RED : word === title.yellow ? TITLE_YELLOW : "#FFFFFF";
      out.push(`<path d="${textOutline(fonts, word, { size, x, baseline, tracking: size * 0.02 }).d}" fill="${fill}"/>`);
      x += widths[k] + space;
    });
  });
  return out.join("");
}

/** The rank list at the left: every number from frame 0, each label once its clip has started. */
export function rankListSvg(fonts, rows, shown, { width = RANKING.width, height = RANKING.height } = {}) {
  const n = rows.length;
  const top = height * RANKING.listTop;
  const rowH = (height * (RANKING.listBottom - RANKING.listTop)) / Math.max(n, 1);
  // Large enough to read on a phone: about 6.6% of the frame width for five rows.
  const label = Math.min(rowH * 0.46, width * 0.066);
  const numberSize = label * 1.3;
  const x0 = width * RANKING.listX;
  const maxRight = width * 0.95;
  const out = [];
  for (const row of [...rows].sort((a, b) => a.rank - b.rank)) {
    const baseline = top + (row.rank - 0.5) * rowH + numberSize * 0.36;
    const numberText = `${row.rank}.`;
    const number = textOutline(fonts, numberText, { size: numberSize, x: x0, baseline });
    const stroke = (size) => `stroke="#000000" stroke-width="${round(size * 0.13)}" stroke-linejoin="round" paint-order="stroke"`;
    if (shown.includes(row.rank) && row.label) {
      const lx = x0 + number.width + label * 0.32;
      const text = `${row.label.toUpperCase()}${row.emoji ? ` ${row.emoji}` : ""}`;
      let size = label;
      let set = textOutline(fonts, text, { size, x: lx, baseline: baseline - (numberSize - size) * 0.36, tracking: size * 0.015 });
      if (lx + set.width > maxRight) {
        size = (label * (maxRight - lx)) / set.width;
        set = textOutline(fonts, text, { size, x: lx, baseline: baseline - (numberSize - size) * 0.36, tracking: size * 0.015 });
      }
      const pad = label * 0.22;
      out.push(`<rect x="${round(x0 - pad)}" y="${round(baseline - numberSize * 0.92)}" width="${round(lx - x0 + set.width + pad * 2)}" height="${round(numberSize * 1.16)}" rx="${round(label * 0.24)}" fill="#000000" fill-opacity="0.42"/>`);
      out.push(`<path d="${set.d}" fill="#FFFFFF" ${stroke(size)}/>`);
    }
    out.push(`<path d="${number.d}" fill="${rankColor(row.rank)}" ${stroke(numberSize)}/>`);
  }
  return out.join("");
}

export const svgDocument = (body, { width = RANKING.width, height = RANKING.height } = {}) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`;

let fontCache = null;
async function loadFonts() {
  if (fontCache) return fontCache;
  const [title, emoji] = await Promise.all([captionFontBytes(TITLE_FONT), captionFontBytes(EMOJI_FONT_FILE)]);
  if (!title) throw fail("The title font is missing from this server.", 503);
  fontCache = [parseFont(title), ...(emoji ? [parseFont(emoji)] : [])];
  return fontCache;
}

/** One full-frame PNG per overlay state, and the ffconcat list that times them. */
async function writeOverlays({ dir, title, rows, states, duration, withTitle = true }) {
  const { default: sharp } = await import("sharp");
  const fonts = await loadFonts();
  const band = withTitle ? titleBandSvg(fonts, title) : "";
  const lines = ["ffconcat version 1.0"];
  let last = "";
  for (const [i, state] of states.entries()) {
    const file = path.join(dir, `overlay-${i}.png`);
    await sharp(Buffer.from(svgDocument(band + (rows.length > 1 ? rankListSvg(fonts, rows, state.shown) : "")))).png({ compressionLevel: 6 }).toFile(file);
    const length = Math.max(0.04, state.t1 - state.t0);
    lines.push(`file '${file.replace(/'/g, "'\\''")}'`, `duration ${round(length, 3)}`);
    last = file;
  }
  // The demuxer drops the last entry's duration unless the file repeats.
  lines.push(`file '${last.replace(/'/g, "'\\''")}'`);
  const list = path.join(dir, "overlays.ffconcat");
  await fs.writeFile(list, `${lines.join("\n")}\n`);
  return { list, duration };
}

// ---------- Render arguments (pure) ----------

const n3 = (v) => String(round(Number(v), 3));

/**
 * The ffmpeg arguments for the finished Short.
 * segments: { file, start, length, crop:{x,y,w,h}, audio, hold?, muted?, fill? } in play order.
 * voice: { file, at } narration clips; ducks: windows the clip audio drops under.
 * fill: true plays the clip full-frame (reaction loop); otherwise it sits centred over a blurred copy.
 */
export function renderArgs({ segments, voice = [], ducks = [], music = null, keepClipAudio = true, overlayList = null, captionFilter = "", duration, output, width = RANKING.width, height = RANKING.height, fps = RANKING.fps }) {
  const args = ["-y", "-hide_banner", "-loglevel", "error"];
  const graph = [];
  const band = Math.round(height * RANKING.band);
  const area = { top: band, height: height - band };
  let input = 0;
  const pieces = [];
  for (const [k, s] of segments.entries()) {
    const i = input++;
    args.push("-ss", n3(s.start), "-t", n3(s.length), "-i", s.file);
    const crop = s.crop ? `crop=${s.crop.w}:${s.crop.h}:${s.crop.x}:${s.crop.y},` : "";
    const hold = s.hold ? `,tpad=stop_mode=clone:stop_duration=${n3(s.hold)}` : "";
    const total = s.length + (s.hold || 0);
    if (s.fill) {
      graph.push(`[${i}:v]${crop}fps=${fps},scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1${hold},setpts=PTS-STARTPTS,format=yuv420p[v${k}]`);
    } else {
      // The clip as large as fits under the title band, centred there, over a blurred copy of itself.
      const cw = s.crop?.w || s.width || width, ch = s.crop?.h || s.height || height;
      const scale = Math.min(width / cw, (area.height * 0.97) / ch);
      const fw = even(cw * scale), fh = even(ch * scale);
      const y = Math.round(area.top + (area.height - fh) / 2);
      graph.push(`[${i}:v]${crop}fps=${fps},setsar=1,split[s${k}][f${k}]`);
      graph.push(`[s${k}]scale=270:480:force_original_aspect_ratio=increase,crop=270:480,boxblur=12:2,eq=brightness=-0.12:saturation=1.1,scale=${width}:${height}[b${k}]`);
      graph.push(`[f${k}]scale=${fw}:${fh}[c${k}]`);
      graph.push(`[b${k}][c${k}]overlay=x=${Math.round((width - fw) / 2)}:y=${y}${hold},setsar=1,setpts=PTS-STARTPTS,format=yuv420p[v${k}]`);
    }
    // Each clip's sound, level-matched (loudness normalised), padded or silent to its length.
    if (keepClipAudio && s.audio && !s.muted)
      graph.push(`[${i}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,loudnorm=I=-16:TP=-2:LRA=11,aresample=48000,asetpts=PTS-STARTPTS,apad,atrim=duration=${n3(total)}${s.hold ? `,afade=t=out:st=${n3(Math.max(0, total - s.hold - 0.1))}:d=${n3(s.hold + 0.1)}` : ""}[a${k}]`);
    else graph.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${n3(total)}[a${k}]`);
    pieces.push(`[v${k}][a${k}]`);
  }
  graph.push(`${pieces.join("")}concat=n=${segments.length}:v=1:a=1[cv][ca]`);
  let video = "cv";
  if (overlayList) {
    const i = input++;
    args.push("-f", "concat", "-safe", "0", "-i", overlayList);
    graph.push(`[${i}:v]format=rgba,setpts=PTS-STARTPTS[ovl]`);
    graph.push(`[cv][ovl]overlay=eof_action=repeat:format=auto[ov]`);
    video = "ov";
  }
  graph.push(`[${video}]${captionFilter ? `${captionFilter},` : ""}format=yuv420p,trim=duration=${n3(duration)}[vout]`);
  // The clips' sound drops about 12 dB under every narration line and is back to full between them.
  const duck = ducks.map((w) => `volume=${RANKING.duck}:enable='between(t,${n3(w.from)},${n3(w.to)})'`).join(",");
  const mix = [`[ca]${duck || "anull"}[clipmix]`];
  const inputs = ["[clipmix]"];
  for (const [k, v] of voice.entries()) {
    const i = input++;
    args.push("-i", v.file);
    mix.push(`[${i}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,volume=1.15,adelay=${Math.round(v.at * 1000)}:all=1[n${k}]`);
    inputs.push(`[n${k}]`);
  }
  if (music) {
    const i = input++;
    args.push("-stream_loop", "-1", "-i", music);
    const under = voice.length ? ducks.map((w) => `volume=0.5:enable='between(t,${n3(w.from)},${n3(w.to)})'`).join(",") : "";
    mix.push(`[${i}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=duration=${n3(duration)},volume=${keepClipAudio ? 0.22 : 0.8}${under ? `,${under}` : ""},afade=t=out:st=${n3(Math.max(0, duration - 0.6))}:d=0.6[m]`);
    inputs.push("[m]");
  }
  graph.push(...mix);
  graph.push(`${inputs.join("")}amix=inputs=${inputs.length}:normalize=0:duration=first,alimiter=limit=0.95:level=false,apad,atrim=duration=${n3(duration)}[aout]`);
  args.push(
    "-filter_complex", graph.join(";"),
    "-map", "[vout]", "-map", "[aout]",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-r", String(fps),
    "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-t", n3(duration), output,
  );
  return args;
}

/** The reaction loop: setup → reaction → payoff → reaction, full-frame. */
export function reactionSegments(chosen, reaction) {
  const { window, payoff } = chosen.check;
  const r = Math.min(RANKING.reactionSeconds, Math.max(0.8, (reaction.duration || 3) / 2));
  const setupStart = Math.max(window.start, payoff - 3);
  return [
    { kind: "setup", start: round(setupStart, 3), length: round(payoff - setupStart, 3) },
    { kind: "reaction", start: 0, length: round(r, 3) },
    { kind: "payoff", start: round(payoff, 3), length: round(Math.min(window.end, payoff + 2) - payoff, 3) },
    { kind: "reaction", start: round(Math.min(r, Math.max(0, (reaction.duration || r * 2) - r)), 3), length: round(r, 3) },
  ].filter((s) => s.length >= 0.3);
}

// ---------- Sources (pure) ----------

const stamp = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, "0")}`;
/** The credit list: every clip used, where it came from, and the part that was used. */
export function sourcesList(picked) {
  return [...picked].sort((a, b) => a.rank - b.rank).map((p) => ({
    rank: p.rank,
    label: p.label || p.chosen.check.label,
    url: p.chosen.url,
    platform: p.chosen.platform,
    uploader: p.chosen.uploader,
    title: p.chosen.title,
    used: p.chosen.check.cuts.map((c) => ({ start: c.start, end: c.end })),
  }));
}
export function sourcesMarkdown(title, sources) {
  return [`# Sources: ${title}`, "", "Clips used in this video, so you can credit their creators:", "",
    ...sources.map((s) => `- #${s.rank} ${s.label ? `${s.label}: ` : ""}${s.uploader || "unknown"} on ${s.platform === "tiktok" ? "TikTok" : "YouTube"} — ${s.url} (used ${s.used.map((u) => `${stamp(u.start)}–${stamp(u.end)}`).join(", ")})`),
    ""].join("\n");
}

/** The candidate as kept on the plan (no local paths). */
const planCandidate = (c) => ({ id: c.id, platform: c.platform, url: c.url, title: c.title, uploader: c.uploader, duration: c.duration, width: c.width, height: c.height, audio: c.audio, check: c.check });

/** A saved plan with swaps applied: the picked runner-up becomes the clip, its own label and line come with it. */
export function applyPicks(plan, picks = {}) {
  const entries = plan.entries.map((e) => {
    const id = picks[e.rank];
    const swap = id && id !== e.chosen.id ? e.runnersUp.find((c) => c.id === id) : null;
    if (!swap) return e;
    return {
      ...e,
      chosen: swap,
      runnersUp: [e.chosen, ...e.runnersUp.filter((c) => c.id !== id)],
      label: swap.check.label || e.label,
      emoji: swap.check.emoji || e.emoji,
      line: cleanLine(`Number ${e.rank}: ${swap.check.line}`) || e.line,
    };
  });
  return { ...plan, entries };
}

// ---------- The pipeline ----------

async function probe(command, file, signal) {
  const out = JSON.parse(await command(process.env.FFPROBE_PATH || "ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height", "-of", "json", file], signal));
  const video = (out.streams || []).find((s) => s.codec_type === "video") || {};
  return { duration: Number(out.format?.duration) || 0, width: Number(video.width) || 0, height: Number(video.height) || 0, audio: (out.streams || []).some((s) => s.codec_type === "audio") };
}

async function pool(items, limit, run) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await run(items[i], i);
    }
  }));
  return out;
}

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return null;
  }
}

/** Every candidate for every entry, from both platforms; one failing search only loses its results. */
async function searchAll({ entries, searchYouTube, searchTikTok, onStatus, signal }) {
  const taken = new Set();
  const out = [];
  for (const [i, entry] of entries.entries()) {
    signal?.throwIfAborted();
    await onStatus(`Finding clips for #${entries.length - i}`);
    const found = [];
    const tries = [];
    for (const [q, query] of entry.queries.entries()) {
      if (searchYouTube) tries.push(searchYouTube(query, 10).then((list) => list.map(youtubeCandidate)));
      // TikTok search is slower: the first query only.
      if (searchTikTok && q === 0) tries.push(searchTikTok(query, 12).then((list) => list.map(tiktokCandidate)));
    }
    for (const result of await Promise.allSettled(tries)) {
      if (result.status === "fulfilled") found.push(...result.value.filter(Boolean));
      else console.warn(`[ranking] a search failed: ${result.reason?.message || result.reason}`);
    }
    const list = shortlist(found, { taken });
    list.forEach((c) => taken.add(c.id));
    out.push(list);
  }
  return out;
}

/** Downloads one candidate and has the vision model check it. Returns it with .file and .check, or null. */
async function checkCandidate({ candidate, entry, topic, dir, loop, download, transcribe, command, request, signal }) {
  const base = candidate.id.replace(/[^\w-]/g, "_");
  const file = path.join(dir, `${base}.mp4`);
  try {
    await download(candidate.url, file, { signal });
    const found = (await fs.readdir(dir)).find((name) => name.startsWith(`${base}.`) && !name.endsWith(".part") && !name.endsWith(".json"));
    const local = found ? path.join(dir, found) : file;
    const media = await probe(command, local, signal);
    if (!(media.duration > 1) || !media.width) return null;
    const window = Math.min(media.duration, RANKING.preferSeconds);
    const frameDir = path.join(dir, `${base}-frames`);
    await fs.mkdir(frameDir, { recursive: true });
    const times = checkTimes(media.duration);
    // Scene cuts, the check frames (written to frameDir), and black bars, at once.
    const [scenes, , bars] = await Promise.all([
      command(process.env.FFMPEG_PATH || "ffmpeg", ["-hide_banner", "-nostats", "-v", "error", "-t", String(Math.ceil(window)), "-i", local, "-an", "-sn", "-vf", "scale=320:-2,select='gt(scene\\,0.3)',metadata=mode=print:file=-", "-f", "null", "-"], signal).catch(() => ""),
      command(process.env.FFMPEG_PATH || "ffmpeg", frameArgs({ file: local, dir: frameDir, times, window, hook: false }), signal),
      // Black bars (a vertical video letterboxed into 16:9, or the reverse) are cropped off too.
      command(process.env.FFMPEG_PATH || "ffmpeg", ["-hide_banner", "-nostats", "-v", "error", "-t", String(Math.ceil(window)), "-i", local, "-an", "-sn", "-vf", "fps=2,cropdetect=limit=0.09:round=2:reset=1,metadata=mode=print:file=-", "-f", "null", "-"], signal).catch(() => ""),
    ]);
    const names = (await fs.readdir(frameDir)).filter((n) => n.endsWith(".jpg")).sort();
    if (!names.length) return null;
    const frames = await Promise.all(names.map(async (name, i) => ({ t: times[i] ?? times.at(-1), bytes: await fs.readFile(path.join(frameDir, name)) })));
    let transcript = "";
    if (transcribe && media.audio && media.duration <= RANKING.preferSeconds) {
      try {
        const result = await transcribe(local, { signal, maxDurationSeconds: Math.ceil(window) + 1 });
        transcript = (result?.segments || []).map((s) => `[${round(Number(s.start), 1)}s] ${clip(s.text, 200)}`).join(" ");
      } catch (error) {
        signal?.throwIfAborted();
        if (blocked(error)) throw error;
      }
    }
    const content = [{ type: "text", text: checkPrompt({ topic, entry, candidate, times: frames.map((f) => f.t), cuts: parseSceneTimes(scenes), transcript, duration: media.duration, loop }) }];
    for (const f of frames) {
      content.push({ type: "text", text: `Frame at ${f.t.toFixed(1)}s` });
      content.push({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${f.bytes.toString("base64")}` } });
    }
    const { value } = await request({
      // Reasoning models return nothing on long JSON unless reasoning is kept low (see videoWatch.js).
      kind: "vision", json: true, maxTokens: 1500, temperature: 0.2, reasoningEffort: "low", signal, timeoutMs: 120000,
      messages: [{ role: "user", content }],
      validate: (v) => { if (!v || typeof v !== "object" || v.fit === undefined) throw new Error("The clip check came back empty"); },
    });
    await fs.rm(frameDir, { recursive: true, force: true }).catch(() => {});
    const check = normalizeCheck(value, { duration: media.duration, loop });
    console.info(`[ranking] checked ${candidate.url}: fit ${check.fit}, quality ${check.quality}${check.usable ? "" : " (not used)"}: ${check.sees}`);
    return { ...candidate, file: local, duration: round(media.duration, 2), width: media.width, height: media.height, audio: media.audio, check: { ...check, crop: keepRegion(check.boxes, media, parseCropDetect(bars, media, check.window)) } };
  } catch (error) {
    signal?.throwIfAborted();
    if (blocked(error)) throw error;
    console.warn(`[ranking] skipped ${candidate.url}: ${error.message}`);
    await fs.rm(file, { force: true }).catch(() => {});
    return null;
  }
}

/** Narration line to a WAV (voice output through the app's speech path) with its length. */
async function speakLine({ text, voiceId, speak, dir, name, command, signal }) {
  // Gemini voices read a leading "Say …:" as delivery, not words; a countdown wants it quick.
  const spoken = await speak({ voiceId, text, signal, direction: "Say quickly, like an excited countdown host" });
  const raw = path.join(dir, `${name}-raw.${spoken.extension || "wav"}`);
  await fs.writeFile(raw, spoken.audio);
  // The silence the voice leaves at both ends is trimmed, and the read is a touch faster.
  const file = path.join(dir, `${name}.wav`);
  await command(process.env.FFMPEG_PATH || "ffmpeg", ["-y", "-v", "error", "-i", raw, "-af", `${TRIM_SILENCE},areverse,${TRIM_SILENCE},areverse,atempo=1.12`, "-ar", "48000", file], signal);
  const media = await probe(command, file, signal);
  return { file, seconds: round(media.duration, 3) };
}
const TRIM_SILENCE = "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.05";

/**
 * @typedef {{
 *   topic?: string, settings: any, dir: string, plan?: any, picks?: Record<string, string>,
 *   download: (url: string, file: string, options?: { signal?: AbortSignal }) => Promise<unknown>,
 *   searchYouTube?: ((query: string, limit: number) => Promise<any[]>) | null,
 *   searchTikTok?: ((query: string, limit: number) => Promise<any[]>) | null,
 *   speak: (request: { voiceId: string, text: string, signal?: AbortSignal, direction?: string }) => Promise<{ audio: Buffer, extension?: string }>,
 *   transcribe?: ((file: string, options: any) => Promise<any>) | null,
 *   reaction?: (request: { prompt: string }) => Promise<string>,
 *   music?: (request: { prompt: string }) => Promise<string>,
 *   voiceId?: string, formatLibrary?: any[] | null, nicheLibrary?: any[] | null, burnCaptions?: boolean,
 *   onPlan?: (plan: any) => unknown,
 *   command?: (program: string, args: string[], signal?: AbortSignal) => Promise<string>,
 *   request?: (options: any) => Promise<{ value: any }>,
 *   signal?: AbortSignal, onStatus?: (message: string) => unknown,
 * }} RankingOptions
 */
/**
 * Makes a Ranking Video. I/O comes in as options so it runs (and is smoke-tested) anywhere:
 *   download(url, file, {signal}), searchYouTube(query, limit), searchTikTok(query, limit),
 *   speak({voiceId, text, signal, direction}) → {audio, extension}, transcribe(file, options),
 *   reaction({prompt}) → local mp4 (reaction loop), music({prompt}) → local audio file,
 *   command (creatorCommand), request (requestOpenRouter), captions: whether ASS can be burned.
 * With `plan` (a previous run's), nothing is searched or checked again: picks swap clips, then it renders.
 * Returns { file, plan, sources, markdown }.
 * @param {RankingOptions} options
 */
export async function makeRankingVideo({
  topic = "", settings, dir, plan: previous = null, picks = {},
  download, searchYouTube, searchTikTok, speak, transcribe, reaction, music, voiceId,
  formatLibrary = null, nicheLibrary = null, burnCaptions = false, onPlan = () => {},
  command = creatorCommand, request = requestOpenRouter, signal, onStatus = () => {},
}) {
  const loop = settings.template === "reaction-loop";
  let plan;
  if (previous) {
    plan = applyPicks(previous, picks);
  } else {
    // 1. Concept
    await onStatus(topic ? "Planning the countdown" : "Picking a topic");
    const library = formatLibrary || (await readJson(path.resolve("data", "format-library.json"))) || [];
    const niches = nicheLibrary || (await readJson(path.resolve("data", "premium-niche-library.json"))) || [];
    const { value: conceptValue } = await request({
      kind: "text", json: true, maxTokens: 2500, temperature: 0.6, reasoningEffort: "low", signal, timeoutMs: 90000,
      messages: [{ role: "user", content: conceptPrompt({ topic, count: settings.count, language: settings.language, template: settings.template, format: formatGuide(library), niche: topicNiche(niches, topic) }) }],
      validate: (v) => { if (!Array.isArray(v?.entries) || !v.entries.length) throw new Error("The plan came back without entries"); },
    });
    const concept = normalizeConcept(conceptValue, { topic, count: settings.count, template: settings.template });
    // 2. Search
    const found = await searchAll({ entries: concept.entries, searchYouTube, searchTikTok, onStatus, signal });
    const total = found.reduce((sum, list) => sum + list.length, 0);
    if (!total) throw fail("No clips could be found for this topic on YouTube or TikTok right now. Try again or reword the topic.", 502);
    // 3. Check
    await onStatus(`Checking ${total} clips`);
    let done = 0;
    const jobs = found.flatMap((list, i) => list.map((candidate) => ({ candidate, i })));
    const results = await pool(jobs, 3, async ({ candidate, i }) => {
      const checked = await checkCandidate({ candidate, entry: concept.entries[i], topic: concept.topic, dir, loop, download, transcribe, command, request, signal });
      done += 1;
      await onStatus(`Checking clips (${done} of ${total})`);
      return checked;
    });
    const byEntry = concept.entries.map((_, i) => jobs.map((job, k) => (job.i === i ? results[k] : null)).filter(Boolean));
    const picked = pickClips(concept.entries, byEntry, { min: loop ? 1 : Math.min(RANKING.minCount, concept.entries.length) });
    // 4. Script
    let script = { hook: concept.hook, entries: picked.map((p) => ({ rank: p.rank, line: cleanLine(`Number ${p.rank}: ${p.chosen.check.line}`), label: p.chosen.check.label || p.entry.label, emoji: p.chosen.check.emoji })) };
    if (!loop) {
      await onStatus("Writing the narration");
      try {
        const { value } = await request({
          kind: "text", json: true, maxTokens: 2000, temperature: 0.5, reasoningEffort: "low", signal, timeoutMs: 90000,
          messages: [{ role: "user", content: scriptPrompt({ topic: concept.topic, language: settings.language, hook: concept.hook, picked }) }],
          validate: (v) => { if (!Array.isArray(v?.entries)) throw new Error("The narration came back empty"); },
        });
        script = normalizeScript(value, picked, { hook: concept.hook });
      } catch (error) {
        signal?.throwIfAborted();
        if (blocked(error)) throw error;
        console.warn(`[ranking] narration fell back to the clip checks: ${error.message}`);
      }
    }
    const lines = new Map(script.entries.map((e) => [e.rank, e]));
    plan = {
      topic: concept.topic,
      title: concept.title,
      hook: script.hook,
      template: settings.template,
      language: settings.language,
      entries: picked.map((p) => ({
        rank: p.rank,
        moment: p.entry.moment,
        queries: p.entry.queries,
        label: lines.get(p.rank)?.label || p.chosen.check.label,
        emoji: lines.get(p.rank)?.emoji || p.chosen.check.emoji,
        line: lines.get(p.rank)?.line || "",
        chosen: planCandidate(p.chosen),
        runnersUp: p.runnersUp.map(planCandidate),
      })).sort((a, b) => a.rank - b.rank),
    };
    // Local files for the render, by candidate id.
    plan.files = Object.fromEntries(picked.map((p) => [p.chosen.id, p.chosen.file]));
  }

  await onPlan(plan);
  // The chosen clips on disk (a swap downloads them again).
  const files = { ...(plan.files || {}) };
  delete plan.files;
  for (const e of plan.entries) {
    if (files[e.chosen.id]) continue;
    signal?.throwIfAborted();
    await onStatus(`Fetching the clip for #${e.rank}`);
    const file = path.join(dir, `${e.chosen.id.replace(/[^\w-]/g, "_")}.mp4`);
    await download(e.chosen.url, file, { signal });
    const found = (await fs.readdir(dir)).find((name) => name.startsWith(path.basename(file, ".mp4") + ".") && !name.endsWith(".part"));
    if (!found) throw fail(`The clip for #${e.rank} could not be downloaded again. Pick another one.`, 502);
    files[e.chosen.id] = path.join(dir, found);
  }

  const output = path.join(dir, "ranking.mp4");
  if (loop) {
    // 5b. Reaction loop: the fail clip, a reaction cutaway, the payoff, the reaction again.
    const e = plan.entries[0];
    await onStatus("Making the reaction");
    const reactionFile = await reaction({ prompt: settings.reactionPrompt || RANKING_DEFAULT_REACTION });
    const r = await probe(command, reactionFile, signal);
    const bed = settings.music && music ? await music({ prompt: "Short bouncy comedic loop, playful pizzicato and light percussion, instrumental only, steady energy so it loops" }).catch((error) => { signal?.throwIfAborted(); if (blocked(error)) throw error; console.warn(`[ranking] music skipped: ${error.message}`); return null; }) : null;
    const parts = reactionSegments(e.chosen, r);
    const segments = parts.map((p) => (p.kind === "reaction"
      ? { file: reactionFile, start: p.start, length: p.length, fill: true, audio: r.audio, muted: true }
      : { file: files[e.chosen.id], start: p.start, length: p.length, fill: true, crop: e.chosen.check.crop, audio: e.chosen.audio }));
    const duration = round(segments.reduce((sum, s) => sum + s.length, 0), 3);
    await onStatus("Rendering");
    await command(process.env.FFMPEG_PATH || "ffmpeg", renderArgs({ segments, music: bed, keepClipAudio: !bed, duration, output }), signal);
    plan.timeline = { duration, parts };
  } else {
    // 5. Voice: the hook and a line per entry.
    await onStatus("Recording the narration");
    const hook = plan.hook ? await speakLine({ text: plan.hook, voiceId, speak, dir, name: "voice-hook", command, signal }) : null;
    const spoken = new Map();
    for (const e of plan.entries) if (e.line) spoken.set(e.rank, await speakLine({ text: e.line, voiceId, speak, dir, name: `voice-${e.rank}`, command, signal }));
    const timeline = buildTimeline(plan.entries.map((e) => ({ rank: e.rank, cuts: e.chosen.check.cuts, duration: e.chosen.duration, lineSeconds: spoken.get(e.rank)?.seconds || 0 })), { hookSeconds: hook?.seconds || 0 });
    const byRank = new Map(plan.entries.map((e) => [e.rank, e]));
    const voice = timeline.voice.map((v) => ({ ...v, file: v.kind === "hook" ? hook.file : spoken.get(v.rank).file }));
    // 6. Overlays: the title band and the rank list, one PNG per state.
    await onStatus("Rendering");
    const rows = plan.entries.map((e) => ({ rank: e.rank, label: e.label, emoji: e.emoji }));
    const { list } = await writeOverlays({ dir, title: plan.title, rows, states: overlayStates(timeline.rows, timeline.duration), duration: timeline.duration });
    let captionFilter = "";
    if (settings.captions && burnCaptions) {
      const style = { ...(findCaptionStyle(settings.captionStyle) || findCaptionStyle(RANKING_DEFAULT_CAPTION_STYLE)), y: 88 };
      const segments = voice.map((v) => ({ start: v.at, end: v.at + v.seconds, text: v.kind === "hook" ? plan.hook : byRank.get(v.rank).line }));
      const chunks = captionChunks(segments, timeline.duration, style);
      const bytes = await captionFontBytes(CAPTION_FONTS[style.font]);
      const ass = path.join(dir, "captions.ass");
      await fs.writeFile(ass, captionsAss(chunks, style, { width: RANKING.width, height: RANKING.height }, { fonts: bytes ? [{ file: CAPTION_FONTS[style.font], bytes }] : [] }));
      captionFilter = captionBurnFilter(ass);
    }
    const bed = settings.music && music ? await music({ prompt: "Upbeat light background loop for a funny countdown video, instrumental only, steady energy" }).catch((error) => { signal?.throwIfAborted(); if (blocked(error)) throw error; console.warn(`[ranking] music skipped: ${error.message}`); return null; }) : null;
    const segments = timeline.segments.map((s) => {
      const e = byRank.get(s.rank);
      return { ...s, file: files[e.chosen.id], crop: e.chosen.check.crop, width: e.chosen.width, height: e.chosen.height, audio: e.chosen.audio };
    });
    await command(process.env.FFMPEG_PATH || "ffmpeg", renderArgs({ segments, voice, ducks: duckWindows(voice), music: bed, overlayList: list, captionFilter, duration: timeline.duration, output }), signal);
    plan.timeline = { duration: timeline.duration, rows: timeline.rows };
  }
  const sources = sourcesList(plan.entries.map((e) => ({ rank: e.rank, label: e.label, chosen: e.chosen })));
  return { file: output, plan, sources, markdown: sourcesMarkdown(plan.title.lines.join(" "), sources) };
}
