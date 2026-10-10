// Watch a video like an editor: one frame per shot (scene changes), pacing numbers, a dense pass over
// the hook, and the transcript, then a vision model's read of it all as a report with how to make a
// video like it in AutoYT. Ported from the local watch skill (frames.py, pacing.py, hook.py,
// report.py) and github.com/bradautomates/claude-video, in Node: media commands go through
// creatorCommand (the remote media worker when this host has no ffmpeg), AI calls through
// requestOpenRouter (metered inside the caller's usage context).
// Movie to Recap uses the same functions to learn a reference recap's style (recapStyleProfile).
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { requestOpenRouter } from "../src/utils/openRouterClient.js";
import { creatorCommand } from "./creatorWorkspace.js";
import { CAPTION_STYLES } from "../src/utils/captionStyles.js";
import { SHORTFILM_TEMPLATES } from "../src/utils/shortfilmTemplates.js";
import { EXPLAINER_TEMPLATES } from "../src/utils/explainerPresets.js";
import { PROMO_TEMPLATES } from "../src/utils/promoPresets.js";
import { DRAMA_TEMPLATES } from "../src/utils/dramaTemplates.js";
import { ART_STYLE_PRESETS } from "../src/utils/creatorPipeline.js";

export const WATCH = {
  // Longer videos are watched up to here: past ten minutes frame coverage is already sparse.
  maxSeconds: 30 * 60,
  maxFrames: 100,
  frameWidth: 512,
  sceneThreshold: 0.3,
  hookSeconds: 10,
  hookFps: 2,
  // The hook pass only runs on videos this long; shorter ones are already sampled about once a second.
  hookMinSeconds: 30,
  imagesPerCall: 24,
};

const clip = (value, max) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const round = (n, places = 2) => Math.round(n * 10 ** places) / 10 ** places;
const num = (value) => (Number.isFinite(Number(value)) ? Number(value) : null);
export function formatTime(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${r}` : `${m}:${r}`;
}

// ---------- Frames and pacing (pure) ----------

/** Frames to look at for a video this long (the skill's budget: dense when short, capped when long). */
export function frameBudget(duration, max = WATCH.maxFrames) {
  const d = Number(duration) || 0;
  if (d <= 0) return 1;
  if (d <= 30) return Math.min(max, Math.max(12, Math.round(d)));
  if (d <= 60) return Math.min(max, 40);
  if (d <= 180) return Math.min(max, 60);
  if (d <= 600) return Math.min(max, 80);
  return max;
}

/** Shot starts from ffmpeg's metadata print ("pts_time:12.4" or "pts_time=12.4"), sorted, no repeats. */
export function parseSceneTimes(text) {
  const times = [...String(text || "").matchAll(/pts_time[:=]\s*(-?[\d.]+)/g)].map((m) => Number(m[1])).filter((t) => Number.isFinite(t) && t > 0.05);
  return [...new Set(times.map((t) => round(t, 3)))].sort((a, b) => a - b);
}

/** Cuts per minute and shot lengths from the cut times (pacing.py): shot 0 starts at 0. */
export function computePacing(cuts, duration) {
  const d = Number(duration) || 0;
  if (d <= 0) return { shotCount: 0, cutsPerMinute: 0, meanShot: 0, medianShot: 0, shots: [] };
  const starts = [0, ...(cuts || []).filter((t) => t > 0.05 && t < d)].sort((a, b) => a - b);
  const shots = starts.map((start, i) => ({ start: round(start), duration: round(Math.max(0, (starts[i + 1] ?? d) - start)) }));
  const lengths = shots.map((s) => s.duration).sort((a, b) => a - b);
  const mid = lengths.length >> 1;
  const median = lengths.length % 2 ? lengths[mid] : (lengths[mid - 1] + lengths[mid]) / 2;
  return {
    shotCount: shots.length,
    // Cuts, not shots: one unbroken take is 0 cuts a minute.
    cutsPerMinute: round((shots.length - 1) / (d / 60)),
    meanShot: round(lengths.reduce((sum, n) => sum + n, 0) / lengths.length),
    medianShot: round(median),
    shots,
  };
}

/**
 * When to take each frame: the start of every shot (just after the cut, past any dissolve), spread
 * evenly when there are more shots than the budget, padded with evenly spaced frames when there are
 * too few cuts (talking heads, screen recordings).
 */
export function pickFrameTimes(cuts, duration, budget) {
  const d = Number(duration) || 0;
  const n = Math.max(1, Math.round(budget) || 1);
  const starts = [0, ...(cuts || []).filter((t) => t > 0.05 && t < d - 0.2).map((t) => Math.min(d - 0.1, t + 0.15))];
  let picked;
  if (starts.length > n) {
    const spread = n === 1 ? [0] : Array.from({ length: n }, (_, i) => Math.round((i * (starts.length - 1)) / (n - 1)));
    picked = [...new Set(spread)].map((i) => ({ t: starts[i], from: "cut" }));
  } else {
    picked = starts.map((t) => ({ t, from: "cut" }));
    const step = d / n;
    for (let k = 0; k < n && picked.length < n; k++) {
      const t = (k + 0.5) * step;
      if (t < d && !picked.some((p) => Math.abs(p.t - t) < step / 2)) picked.push({ t, from: "even" });
    }
  }
  return picked.map((p) => ({ ...p, t: round(p.t) })).sort((a, b) => a.t - b.t);
}

/** An ffmpeg select expression that keeps the first frame at or after each time, in order. */
export function selectExpression(times) {
  return times.map((t, i) => `eq(selected_n\\,${i})*gte(t\\,${Number(t).toFixed(2)})`).join("+");
}

/** The ffmpeg arguments that write the shot frames, and the hook frames (2 fps over 0-10 s) with them. */
export function frameArgs({ file, dir, times, window, hook }) {
  const scale = `scale=${WATCH.frameWidth}:-2`;
  const select = `select='${selectExpression(times)}',${scale}`;
  const graph = hook
    ? `[0:v]split=2[a][b];[a]${select}[s];[b]trim=0:${WATCH.hookSeconds},setpts=PTS-STARTPTS,fps=${WATCH.hookFps},${scale}[h]`
    : `[0:v]${select}[s]`;
  return [
    "-y", "-v", "error", "-t", String(Math.ceil(window)), "-i", file,
    "-filter_complex", graph,
    "-map", "[s]", "-fps_mode", "vfr", "-q:v", "4", path.join(dir, "frame-%03d.jpg"),
    ...(hook ? ["-map", "[h]", "-q:v", "4", path.join(dir, "hook-%02d.jpg")] : []),
  ];
}

// ---------- Transcript (pure) ----------

const segmentWords = (segments) => (segments || []).reduce((sum, s) => sum + String(s.text || "").split(/\s+/).filter(Boolean).length, 0);
export const transcriptLines = (segments, max = 40000) => (segments || []).map((s) => `[${formatTime(s.start)}] ${clip(s.text, 400)}`).join("\n").slice(0, max);

/** What is said over the hook: word timings when the transcript has them, else its lines. */
export function hookTranscript(segments, seconds = WATCH.hookSeconds) {
  const words = (segments || []).flatMap((s) => (Array.isArray(s.words) ? s.words : [])).filter((w) => Number(w.start) < seconds);
  if (words.length) return words.map((w) => `[${Number(w.start).toFixed(2)}s] ${clip(w.word || w.text, 40)}`).join("\n");
  return (segments || []).filter((s) => Number(s.start) < seconds).map((s) => `[${Number(s.start).toFixed(1)}s] ${clip(s.text, 300)}`).join("\n");
}

/** Narration speed and sentence length, measured from the transcript (sentences need punctuation). */
export function narrationStats(segments) {
  const list = (segments || []).filter((s) => clip(s.text, 10));
  if (!list.length) return { words: 0, wordsPerMinute: null, sentenceWords: null };
  const words = segmentWords(list);
  const span = Math.max(1, Number(list[list.length - 1].end || list[list.length - 1].start) - Number(list[0].start || 0));
  const text = list.map((s) => s.text).join(" ");
  const sentences = text.split(/[.!?]+(?=\s|$)/).map((s) => s.split(/\s+/).filter(Boolean).length).filter((n) => n > 0);
  return { words, wordsPerMinute: Math.round(words / (span / 60)), sentenceWords: sentences.length >= 3 ? round(words / sentences.length, 1) : null };
}

// ---------- What AutoYT can make (grounds the "recreate" steps) ----------

/** The tools a recreate plan may name, with the settings each really takes. */
export const WATCH_TOOLS = [
  { name: "Create Video", where: "Create Video (/create)", makes: "a narrated video from an idea or script: script, voiceover, AI images or animation or stock footage per scene, captions, music, export", settings: "template (shotTemplateId), art style, aspect 16:9 | 9:16 | 1:1, scene seconds, word count, tone, voice, caption style" },
  { name: "Movie to Recap", where: "Tools > Movie to Recap (/tools/movie-recap)", makes: "a full film into a narrated long recap (10-17 min, 16:9) and/or a Short (60-90 s, 9:16), cut in 2-4 s shots with the film's audio dropped", settings: "formats long | short, longMinutes 10-17, shortSeconds 60-90, tone dramatic | suspense | funny | calm, pace, voice, captions on/off, music on/off, motion graphics on/off, transforms zoom | pan | color | mirror | speed, styleReference (a recap link whose style to match)" },
  { name: "AI Clipping", where: "Video > AI Clipping", makes: "short clips cut from a long video, picked from the transcript", settings: "clipLength short | medium | long, clipAspect 9:16 | 1:1 | 16:9, clipFraming auto (AI reframe follows faces) | crop | blur | fit, clipCaptions on/off, clipCaptionStyle (caption style id), clipEmoji, clipTrimFillers (filler and silence trim), clipUseBrandKit (logo, caption look, intro and outro)" },
  { name: "Vibe Edit", where: "Video > Vibe Edit", makes: "edits footage you have on a timeline by chatting: captions in any caption style, AI voiceover in 30 voices with direction, music, B-roll, motion graphics, auto edit, export", settings: "caption style, voice and direction, music, B-roll, auto edit" },
  { name: "Explainer Studio", where: "Video > Explainer Studio", makes: "a narrated walkthrough of a product from its site, screenshots, or screen recordings, up to 180 s", settings: "template, length 60 | 90 | 120 | 180 s, aspect, voice (built-in or your cloned voice), captions, music" },
  { name: "Promo Studio", where: "Video > Promo Studio", makes: "a motion-graphics launch or promo film from a link, images, or a brief", settings: "template, aspect 16:9 | 9:16 | 1:1, duration 15 | 30 | 45 s, music" },
  { name: "Vibe Motion", where: "Video > Vibe Motion", makes: "a prompted motion graphic: animated titles, lower thirds, kinetic type, data animations", settings: "prompt, aspect, duration" },
  { name: "Create Series", where: "Create Film > Create Series", makes: "a short drama series, episode by episode, with a recurring cast, voices, and AI video clips", settings: "template, episode length, cast, art style" },
  { name: "Short Film", where: "Create Film > Short Film", makes: "one complete AI-filmed story of two to five minutes", settings: "idea, cast, art style, cinema look" },
  { name: "Video Studio", where: "Video > Video Studio", makes: "single AI video shots from text or an image", settings: "model, prompt, aspect, duration" },
  { name: "Marketing Studio", where: "Video > Marketing Studio", makes: "a short product ad video from a product photo", settings: "ad format, hook, setting, avatar" },
  { name: "Lip Sync", where: "Video > Lip Sync", makes: "a portrait that speaks an audio track", settings: "portrait, audio up to 3 min" },
  { name: "Music Generation", where: "Audio > Music Generation", makes: "an original music cue from a prompt", settings: "genre, mood, instruments, tempo, instrumental" },
  { name: "Thumbnail Maker", where: "Image tools > Thumbnail Maker", makes: "a 16:9 thumbnail with a title", settings: "title, style, reference thumbnails" },
];
const findTool = (name) => WATCH_TOOLS.find((t) => t.name.toLowerCase() === clip(name, 60).toLowerCase())?.name || "";
const TEMPLATE_IDS = new Set([...SHORTFILM_TEMPLATES, ...EXPLAINER_TEMPLATES, ...PROMO_TEMPLATES, ...DRAMA_TEMPLATES].map((t) => t.id));
const CAPTION_IDS = new Set(CAPTION_STYLES.map((s) => s.id));

/** The catalogue the report's recreate plan is grounded in: tools, templates, caption styles, voices, art styles. */
export function watchCatalog({ voices = [] } = {}) {
  const list = (items, line) => items.map(line).join("\n");
  return `TOOLS (name: where; what it makes; settings it takes):
${list(WATCH_TOOLS, (t) => `- ${t.name}: ${t.where}; ${t.makes}; settings: ${t.settings}`)}

CREATE VIDEO TEMPLATES (template id: name, genre, aspect: tagline):
${list(SHORTFILM_TEMPLATES, (t) => `- ${t.id}: ${t.name}, ${t.genre || ""}, ${t.aspect || ""}: ${clip(t.tagline, 120)}`)}

EXPLAINER STUDIO TEMPLATES: ${EXPLAINER_TEMPLATES.map((t) => `${t.id} (${t.name})`).join(", ")}
PROMO STUDIO TEMPLATES: ${PROMO_TEMPLATES.map((t) => `${t.id} (${t.name})`).join(", ")}
CREATE SERIES TEMPLATES: ${DRAMA_TEMPLATES.map((t) => `${t.id} (${t.name}, ${t.genre})`).join(", ")}
ART STYLES (Create Video, Create Film): ${ART_STYLE_PRESETS.map((s) => `${s.id} (${s.name})`).join(", ")}

CAPTION STYLES (id: name: look; best for):
${list(CAPTION_STYLES, (s) => `- ${s.id}: ${s.name}: ${clip(s.description, 110)}; ${clip(s.bestFor, 60)}`)}
${voices.length ? `\nBUILT-IN VOICES (name: description): ${voices.slice(0, 40).map((v) => `${clip(v.name, 30)}: ${clip(v.description, 60)}`).join("; ")}. Users can also clone their own voice.` : ""}`;
}

// ---------- Prompts (pure) ----------

/** One vision call's prompt: these frames, what is said over them, and the per-frame notes to return. */
export function observePrompt({ frames, label, transcript }) {
  return `You are watching a video like a video editor. These are ${frames.length} frames (${label}); each is labelled with its time in the video. Describe only what is visible: never guess at sound.
For each frame, in order: "shot" (close-up | medium | wide | screen recording | graphic | text card | b-roll | other), "subject" (who or what, a few words), "text" (on-screen words exactly as written, else ""), "captions" (if burned-in captions or subtitles show: their font weight, case, colours, highlighted word, box or outline, position, and how many words at a time; else ""), "look" (colour grade, lighting, framing, and effects such as zoom, split screen, picture-in-picture, a few words).
Then "notes": one to three sentences on what happens across these frames and the editing patterns you see (zooms, transitions, overlays, recurring layouts). The frames are seconds apart, so movement between them is expected: only call something a cut when the framing or location clearly changes.
${transcript ? `What is said over this stretch, for context:\n${transcript}\n` : ""}Return JSON only: {"frames":[{"shot":"","subject":"","text":"","captions":"","look":""}],"notes":""}`;
}

/** The final call: everything measured and seen, written up as the report. */
export function reportPrompt({ facts, observations, notes, transcript, hook, question, catalog }) {
  const pacing = facts.pacing;
  return `You are a senior video editor and YouTube strategist. You watched a video for a creator and write them a breakdown, then a plan to make a video like it in AutoYT, their video app.

THE VIDEO: ${facts.title ? `"${facts.title}"` : "(untitled)"}${facts.url ? ` ${facts.url}` : ""}, ${formatTime(facts.duration)} long${facts.analysedSeconds < facts.duration ? `; you watched the first ${formatTime(facts.analysedSeconds)}` : ""}, ${facts.width && facts.height ? `${facts.width}x${facts.height} (${facts.width < facts.height ? "vertical" : facts.width === facts.height ? "square" : "horizontal"})` : "size unknown"}.
PACING (measured from scene changes): ${pacing.shotCount} shots, ${pacing.cutsPerMinute} cuts a minute, mean shot ${pacing.meanShot}s, median ${pacing.medianShot}s. These counts are the truth about editing: never describe more cuts or jump cuts than they show. The frames are sampled seconds apart, so a subject moving or a handheld camera drifting between them is not a cut.
NARRATION (measured): ${facts.speech.words ? `${facts.speech.words} words, about ${facts.speech.wordsPerMinute} words a minute${facts.speech.sentenceWords ? `, ${facts.speech.sentenceWords} words a sentence` : ""}` : "no speech found"}; transcript from ${facts.transcriptSource}.
${question ? `\nTHE CREATOR'S QUESTION (answer it first, in "answer", and let it steer the whole report): ${question}\n` : ""}
FRAMES (time, kind, then what was seen; "hook" frames are a 2-per-second pass over the first 10 s):
${observations.map((o) => `[${o.t.toFixed(1)}s ${o.kind}] ${[o.shot, o.subject, o.text && `text "${o.text}"`, o.captions && `captions: ${o.captions}`, o.look].filter(Boolean).join(" | ")}`).join("\n").slice(0, 30000)}

EDITOR NOTES FROM THE FRAMES:
${notes.join("\n") || "(none)"}

WHAT IS SAID IN THE FIRST ${WATCH.hookSeconds} SECONDS:
${hook || "(nothing)"}

TRANSCRIPT:
${transcript || "(no speech)"}

WHAT AUTOYT CAN MAKE (name only these tools, templates, caption styles, and voices, exactly as written):
${catalog}

Write the report. Be concrete and honest: the frames and the transcript are all you have, so you can't hear music, sound effects, or the voice's timbre; say what you infer and from what, and say what you can't tell. Timestamps in seconds.
"recreate" is a plan the creator can follow in AutoYT today: pick the one tool that makes this kind of video best, the template, caption style, and voice closest to what you saw (ids from the lists, or "" when nothing fits), the settings to choose (only settings that tool takes), concrete steps, and a ready-to-paste "prompt" for that tool (for Create Video: the idea and script direction with hook, structure, tone, scene seconds, and visual style; for Movie to Recap or AI Clipping: the focus or angle to give it). Name other tools only for parts the main one can't do. Never invent a tool, setting, template, or style.
Return JSON only:
{"answer":"","summary":["3-5 bullets"],"keyMoments":[{"t":0,"what":""}],"hook":{"pattern":"question | contrarian claim | in medias res | demo first | shock visual | list promise | story tease | other (say which)","breakdown":[{"t":0,"see":"","say":""}]},"editorialProfile":{"fingerprint":"one line, e.g. Tight jump-cut talking head, B-roll every sentence, word-by-word yellow captions"},"visualStyle":{"shots":"","framing":"","colour":"","textOverlays":"","captions":""},"audio":{"narration":"","music":"","sfx":"","cantTell":""},"narration":{"person":"first | second | third | none","tense":"present | past | mixed | none","voice":""},"structure":[{"from":0,"to":0,"beat":""}],"quotable":[{"t":0,"line":""}],"recreate":{"tool":"","why":"","template":"","captionStyle":"","voice":"","settings":{"setting":"value"},"steps":[""],"prompt":"","alsoUse":[{"tool":"","for":""}]}}`;
}

// ---------- Report (pure) ----------

const list = (value, max, map) => (Array.isArray(value) ? value : []).slice(0, max).map(map).filter(Boolean);
const timeIn = (value, duration) => { const t = num(value); return t === null ? null : round(Math.min(Math.max(0, t), duration || t), 1); };

/** The model's report, cleaned: strings clipped, ids checked against the catalogue, numbers from the measurements. */
export function normalizeReport(value, facts) {
  const v = value && typeof value === "object" ? value : {};
  const d = facts.duration || 0;
  const r = v.recreate && typeof v.recreate === "object" ? v.recreate : {};
  const tool = findTool(r.tool) || "Create Video";
  const settings = Object.fromEntries(Object.entries(r.settings && typeof r.settings === "object" ? r.settings : {}).slice(0, 14).map(([k, val]) => [clip(k, 40), clip(typeof val === "object" ? JSON.stringify(val) : val, 160)]).filter(([k, val]) => k && val));
  const pacing = facts.pacing;
  const person = ["first", "second", "third", "none"].includes(v.narration?.person) ? v.narration.person : "";
  const tense = ["present", "past", "mixed", "none"].includes(v.narration?.tense) ? v.narration.tense : "";
  return {
    question: clip(facts.question, 600),
    answer: clip(v.answer, 3000),
    summary: list(v.summary, 6, (s) => clip(s, 300)),
    keyMoments: list(v.keyMoments, 12, (m) => (clip(m?.what, 300) ? { t: timeIn(m.t, d) ?? 0, what: clip(m.what, 300) } : null)),
    hook: {
      pattern: clip(v.hook?.pattern, 120),
      breakdown: list(v.hook?.breakdown, 24, (b) => (clip(b?.see, 10) || clip(b?.say, 10) ? { t: timeIn(b.t, WATCH.hookSeconds) ?? 0, see: clip(b.see, 240), say: clip(b.say, 240) } : null)),
    },
    editorialProfile: {
      fingerprint: clip(v.editorialProfile?.fingerprint, 240),
      shots: pacing.shotCount,
      cutsPerMinute: pacing.cutsPerMinute,
      meanShot: pacing.meanShot,
      medianShot: pacing.medianShot,
      wordsPerMinute: facts.speech.wordsPerMinute,
      sentenceWords: facts.speech.sentenceWords,
    },
    visualStyle: Object.fromEntries(["shots", "framing", "colour", "textOverlays", "captions"].map((k) => [k, clip(v.visualStyle?.[k], 400)])),
    audio: Object.fromEntries(["narration", "music", "sfx", "cantTell"].map((k) => [k, clip(v.audio?.[k], 400)])),
    narration: { person, tense, voice: clip(v.narration?.voice, 160) },
    structure: list(v.structure, 16, (b) => (clip(b?.beat, 10) ? { from: timeIn(b.from, d) ?? 0, to: timeIn(b.to, d) ?? 0, beat: clip(b.beat, 300) } : null)),
    quotable: list(v.quotable, 6, (q) => (clip(q?.line, 5) ? { t: timeIn(q.t, d) ?? 0, line: clip(q.line, 300) } : null)),
    recreate: {
      tool,
      why: clip(r.why, 400),
      template: TEMPLATE_IDS.has(clip(r.template, 60)) ? clip(r.template, 60) : "",
      captionStyle: CAPTION_IDS.has(clip(r.captionStyle, 40)) ? clip(r.captionStyle, 40) : "",
      voice: clip(r.voice, 60),
      settings,
      steps: list(r.steps, 12, (s) => clip(s, 400)),
      prompt: clip(r.prompt, 4000),
      alsoUse: list(r.alsoUse, 4, (a) => (findTool(a?.tool) && findTool(a.tool) !== tool ? { tool: findTool(a.tool), for: clip(a.for, 200) } : null)),
    },
    source: {
      title: clip(facts.title, 200),
      url: clip(facts.url, 500),
      duration: round(d, 1),
      analysedSeconds: round(facts.analysedSeconds || d, 1),
      width: facts.width || 0,
      height: facts.height || 0,
      transcript: facts.transcriptSource,
      frames: facts.frameCount,
      hookFrames: facts.hookCount,
    },
  };
}

/** The report as Markdown (the readable output and the download). */
export function reportMarkdown(report) {
  const t = (s) => `[${formatTime(s)}]`;
  const out = [`# ${report.source.title || "Video breakdown"}`, ""];
  out.push(`${report.source.url ? `${report.source.url} · ` : ""}${formatTime(report.source.duration)}${report.source.analysedSeconds < report.source.duration ? ` (first ${formatTime(report.source.analysedSeconds)} watched)` : ""} · ${report.source.frames} frames · transcript: ${report.source.transcript}`, "");
  if (report.question) out.push(`## Your question`, "", `> ${report.question}`, "", report.answer || "_No direct answer could be given from what was seen and said._", "");
  if (report.summary.length) out.push("## TL;DR", "", ...report.summary.map((s) => `- ${s}`), "");
  const r = report.recreate;
  out.push(`## Make one like it in AutoYT: ${r.tool}`, "");
  if (r.why) out.push(r.why, "");
  const picks = [r.template && `Template: \`${r.template}\``, r.captionStyle && `Caption style: \`${r.captionStyle}\``, r.voice && `Voice: ${r.voice}`, ...Object.entries(r.settings).map(([k, v]) => `${k}: ${v}`)].filter(Boolean);
  if (picks.length) out.push(...picks.map((p) => `- ${p}`), "");
  if (r.steps.length) out.push(...r.steps.map((s, i) => `${i + 1}. ${s}`), "");
  if (r.prompt) out.push("Prompt to paste:", "", "```", r.prompt, "```", "");
  if (r.alsoUse.length) out.push(...r.alsoUse.map((a) => `- Also ${a.tool}: ${a.for}`), "");
  if (report.keyMoments.length) out.push("## Key moments", "", ...report.keyMoments.map((m) => `- **${t(m.t)}** ${m.what}`), "");
  out.push(`## Hook (0-${WATCH.hookSeconds}s)${report.hook.pattern ? `: ${report.hook.pattern}` : ""}`, "");
  if (report.hook.breakdown.length) out.push(...report.hook.breakdown.map((b) => `- **${b.t.toFixed(1)}s** ${[b.see, b.say && `"${b.say}"`].filter(Boolean).join(" · ")}`), "");
  const e = report.editorialProfile;
  out.push("## Editorial profile", "", ...(e.fingerprint ? [e.fingerprint, ""] : []), `- Shots: ${e.shots} · ${e.cutsPerMinute} cuts a minute`, `- Shot length: mean ${e.meanShot}s, median ${e.medianShot}s`);
  if (e.wordsPerMinute) out.push(`- Narration: ${e.wordsPerMinute} words a minute${e.sentenceWords ? `, ${e.sentenceWords} words a sentence` : ""}`);
  out.push("");
  const label = { shots: "Shots", framing: "Framing", colour: "Colour", textOverlays: "Text on screen", captions: "Captions", narration: "Narration", music: "Music", sfx: "Sound effects", cantTell: "Can't tell" };
  const section = (title, obj) => { const rows = Object.entries(obj).filter(([, v]) => v); if (rows.length) out.push(`## ${title}`, "", ...rows.map(([k, v]) => `- **${label[k] || k}:** ${v}`), ""); };
  section("Visual style", report.visualStyle);
  section("Audio", report.audio);
  if (report.structure.length) out.push("## Structure", "", ...report.structure.map((b) => `- **${t(b.from)}–${t(b.to)}** ${b.beat}`), "");
  if (report.quotable.length) out.push("## Quotable", "", ...report.quotable.map((q) => `- **${t(q.t)}** "${q.line}"`), "");
  return out.join("\n");
}

/** A short digest that leads the generation for Juel, whose reads are clipped: the answer and the plan first. */
export function reportBrief(report) {
  const r = report.recreate;
  return [
    report.answer && `Answer: ${report.answer}`,
    report.summary.length && `TL;DR: ${report.summary.join(" / ")}`,
    `Make it with ${r.tool}${r.template ? ` (template ${r.template})` : ""}${r.captionStyle ? `, caption style ${r.captionStyle}` : ""}${r.voice ? `, voice ${r.voice}` : ""}${Object.keys(r.settings).length ? `; settings ${Object.entries(r.settings).map(([k, v]) => `${k}=${v}`).join(", ")}` : ""}.`,
    r.prompt && `Prompt: ${r.prompt}`,
    `Pacing: ${report.editorialProfile.cutsPerMinute} cuts/min, median shot ${report.editorialProfile.medianShot}s. Hook: ${report.hook.pattern || "n/a"}.`,
  ].filter(Boolean).join("\n").slice(0, 2400);
}

/** The best frames to keep with the report: the hook, the longest shot, and a few spread through. */
export function heroFrames(frames, pacing, max = 4) {
  if (!frames.length) return [];
  const chosen = new Set([0]);
  const longest = [...(pacing.shots || [])].sort((a, b) => b.duration - a.duration)[0];
  if (longest) {
    const i = frames.findIndex((f) => f.t >= longest.start);
    if (i >= 0) chosen.add(i);
  }
  for (let k = 1; chosen.size < Math.min(max, frames.length) && k < max * 3; k++) chosen.add(Math.min(frames.length - 1, Math.round((k * frames.length) / max)));
  return [...chosen].sort((a, b) => a - b).slice(0, max).map((i) => frames[i]);
}

// ---------- Recap style reference (pure) ----------

/** What Movie to Recap takes from a reference recap: hook, narration, rhythm, cut pace, captions, music. */
export function recapStyleProfile(report) {
  const e = report.editorialProfile;
  return {
    url: report.source.url,
    title: report.source.title,
    watchedSeconds: report.source.analysedSeconds,
    hook: report.hook.pattern,
    fingerprint: e.fingerprint,
    narration: report.narration,
    sentenceWords: e.sentenceWords,
    wordsPerMinute: e.wordsPerMinute,
    medianShot: e.medianShot,
    cutsPerMinute: e.cutsPerMinute,
    captions: report.visualStyle.captions,
    music: report.audio.music,
  };
}

/** The reference's shot length as a cut range inside the house bounds (2-4 s), or null when unknown. */
export function styleClipRange(profile, bounds = [2, 4]) {
  const median = Number(profile?.medianShot);
  if (!(median > 0) || !(Number(profile?.cutsPerMinute) > 0)) return null;
  const [low, high] = bounds;
  const centre = Math.min(high - 0.5, Math.max(low + 0.5, median));
  return { minClip: round(Math.max(low, centre - 0.75), 2), maxClip: round(Math.min(high, centre + 0.75), 2) };
}

/** The style profile as guidance for the recap script prompt. It never overrides the house rules. */
export function recapStyleGuidance(profile) {
  if (!profile) return "";
  const n = profile.narration || {};
  const rows = [
    profile.hook && `- Its opening hook pattern: ${profile.hook}. Use that energy in the first lines, while the first line still opens on the film's first scene (no introduction, no teaser, no "This is the movie").`,
    profile.fingerprint && `- Its style: ${profile.fingerprint}.`,
    (n.person || n.tense) && `- Its narration: ${[n.person && n.person !== "none" && `${n.person} person`, n.tense && n.tense !== "none" && `${n.tense} tense`].filter(Boolean).join(", ") || "unclear"}${n.voice ? `, ${n.voice}` : ""}. The house rule (third person, present tense) still applies.`,
    profile.sentenceWords && `- Its sentences average ${profile.sentenceWords} words: match that rhythm.`,
    profile.wordsPerMinute && `- It is narrated at about ${profile.wordsPerMinute} words a minute (your word budget above stays as given).`,
    profile.medianShot && `- It cuts every ${profile.medianShot} s on average (${profile.cutsPerMinute} cuts a minute).`,
    profile.captions && `- Its captions: ${profile.captions}.`,
    profile.music && `- Its music: ${profile.music}.`,
  ].filter(Boolean);
  return rows.length ? `STYLE REFERENCE: the creator wants this recap to feel like a reference recap they like. Follow its voice and rhythm where it fits, but every house rule above and below wins over it:\n${rows.join("\n")}` : "";
}

// ---------- The pipeline ----------

const blocked = (error) => error?.name === "UsageBlockedError" || error?.status === 402 || error?.statusCode === 402;

async function probe(command, file, signal) {
  const out = JSON.parse(await command(process.env.FFPROBE_PATH || "ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height", "-of", "json", file], signal));
  const video = (out.streams || []).find((s) => s.codec_type === "video") || {};
  return { duration: Number(out.format?.duration) || 0, width: Number(video.width) || 0, height: Number(video.height) || 0, audio: (out.streams || []).some((s) => s.codec_type === "audio") };
}

async function sceneCuts(command, file, window, signal) {
  const out = await command(process.env.FFMPEG_PATH || "ffmpeg", [
    "-hide_banner", "-nostats", "-v", "error", "-t", String(Math.ceil(window)), "-i", file, "-an", "-sn",
    "-vf", `scale=320:-2,select='gt(scene\\,${WATCH.sceneThreshold})',metadata=mode=print:file=-`, "-f", "null", "-",
  ], signal);
  return parseSceneTimes(out).filter((t) => t < window);
}

/** Frames, pacing, and the hook frames of a local video file (no AI). Exported for the smoke test.
 *  @param {{ file: string, maxSeconds?: number, maxFrames?: number, signal?: AbortSignal, command?: (program: string, args: string[], signal?: AbortSignal) => Promise<string>, onStatus?: (message: string) => unknown }} options */
export async function measureVideo({ file, maxSeconds = WATCH.maxSeconds, maxFrames = WATCH.maxFrames, signal, command = creatorCommand, onStatus = () => {} }) {
  const media = await probe(command, file, signal);
  if (!(media.duration > 0)) throw Object.assign(new Error("That video has no readable picture."), { statusCode: 422 });
  const window = Math.min(media.duration, maxSeconds);
  await onStatus("Finding the cuts");
  const cuts = await sceneCuts(command, file, window, signal);
  const pacing = computePacing(cuts, window);
  const times = pickFrameTimes(cuts, window, frameBudget(window, maxFrames));
  const hook = media.duration >= WATCH.hookMinSeconds;
  await onStatus(`Taking ${times.length} frames${hook ? " and the hook" : ""}`);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "autoyt-watch-"));
  try {
    await command(process.env.FFMPEG_PATH || "ffmpeg", frameArgs({ file, dir, times: times.map((f) => f.t), window, hook }), signal);
    const names = (await fs.readdir(dir)).sort();
    const read = (prefix, at) => Promise.all(names.filter((n) => n.startsWith(prefix)).map(async (name, i) => ({ t: at(i), bytes: await fs.readFile(path.join(dir, name)) })));
    const frames = (await read("frame-", (i) => times[i]?.t ?? times[times.length - 1].t)).map((f) => ({ ...f, kind: "shot" }));
    const hookFrames = hook ? (await read("hook-", (i) => i / WATCH.hookFps)).map((f) => ({ ...f, kind: "hook" })) : [];
    if (!frames.length) throw Object.assign(new Error("No frames could be read from that video."), { statusCode: 422 });
    return { media, window, cuts, pacing, frames, hookFrames };
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function getTranscript({ file, url, window, transcribe, captions, signal, hasAudio }) {
  let title = "";
  if (url && captions) {
    try {
      const found = await captions(url);
      title = clip(found?.title, 200);
      const segments = (found?.segments || []).filter((s) => Number(s.start) < window);
      if (segments.length) return { source: "captions", segments, title };
    } catch (error) {
      signal?.throwIfAborted();
      console.warn(`[watch] captions unavailable: ${error.message}`);
    }
  }
  if (transcribe && hasAudio) {
    try {
      const result = await transcribe(file, { signal, maxDurationSeconds: Math.ceil(window) + 1 });
      if (result?.segments?.length) return { source: "whisper", segments: result.segments, title };
    } catch (error) {
      signal?.throwIfAborted();
      if (blocked(error)) throw error;
      console.warn(`[watch] transcription failed: ${error.message}`);
    }
  }
  return { source: "none", segments: [], title };
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

/** Every frame seen by the vision model in chunks; a chunk that fails is skipped unless all do. */
async function observe({ frames, segments, request, signal, onStatus }) {
  const chunks = [];
  // The hook pass and the shot frames go in separate batches, so each batch is told what it holds.
  for (const kind of ["hook", "shot"]) {
    const some = frames.filter((f) => f.kind === kind);
    for (let i = 0; i < some.length; i += WATCH.imagesPerCall) chunks.push(some.slice(i, i + WATCH.imagesPerCall));
  }
  let done = 0;
  let lastError;
  const results = await pool(chunks, 2, async (chunk) => {
    const from = chunk[0].t;
    const to = chunk[chunk.length - 1].t;
    const said = (segments || []).filter((s) => Number(s.end ?? s.start) >= from - 2 && Number(s.start) <= to + 2);
    const label = chunk[0].kind === "hook" ? `the opening, 2 per second` : `one per shot, ${formatTime(from)} to ${formatTime(to)}`;
    const content = [{ type: "text", text: observePrompt({ frames: chunk, label, transcript: transcriptLines(said, 4000) }) }];
    for (const f of chunk) {
      content.push({ type: "text", text: `Frame at ${f.t.toFixed(1)}s` });
      content.push({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${f.bytes.toString("base64")}` } });
    }
    try {
      const { value } = await request({
        kind: "vision", json: true, maxTokens: 6000, temperature: 0.2, signal, timeoutMs: 180000,
        messages: [{ role: "user", content }],
        validate: (v) => { if (!Array.isArray(v?.frames)) throw new Error("No frames returned"); },
      });
      return {
        frames: chunk.map((f, i) => { const o = value.frames[i] || {}; return { t: f.t, kind: f.kind, shot: clip(o.shot, 40), subject: clip(o.subject, 120), text: clip(o.text, 200), captions: clip(o.captions, 200), look: clip(o.look, 160) }; }),
        notes: clip(value.notes, 600),
      };
    } catch (error) {
      signal?.throwIfAborted();
      if (blocked(error)) throw error;
      lastError = error;
      console.warn(`[watch] a frame batch could not be read: ${error.message}`);
      return null;
    } finally {
      done += 1;
      await onStatus(`Watching (${done} of ${chunks.length})`);
    }
  });
  const ok = results.filter(Boolean);
  if (!ok.length) throw lastError || new Error("The video could not be watched.");
  return { observations: ok.flatMap((r) => r.frames).sort((a, b) => a.t - b.t), notes: ok.map((r) => r.notes).filter(Boolean) };
}

/**
 * Watches a local video file and writes the report. `url` is the link it came from (captions first);
 * `transcribe(file, options)` and `captions(url)` are the app's transcription and caption readers.
 * Returns { report, markdown, brief, heroes, pacing }.
 * @param {{ file: string, url?: string, title?: string, question?: string, maxSeconds?: number, maxFrames?: number, voices?: Array<{ name: string, description?: string }>, transcribe?: (file: string, options: { signal?: AbortSignal, maxDurationSeconds?: number }) => Promise<any>, captions?: (url: string) => Promise<any>, signal?: AbortSignal, onStatus?: (message: string) => unknown, command?: (program: string, args: string[], signal?: AbortSignal) => Promise<string>, request?: (options: any) => Promise<{ value: any }> }} options
 */
export async function watchVideo({ file, url = "", title = "", question = "", maxSeconds = WATCH.maxSeconds, maxFrames = WATCH.maxFrames, voices = [], transcribe, captions, signal, onStatus = () => {}, command = creatorCommand, request = requestOpenRouter }) {
  const measured = await measureVideo({ file, maxSeconds, maxFrames, signal, command, onStatus });
  await onStatus("Reading the transcript");
  const transcript = await getTranscript({ file, url, window: measured.window, transcribe, captions, signal, hasAudio: measured.media.audio });
  const facts = {
    title: title || transcript.title,
    url,
    question,
    duration: measured.media.duration,
    analysedSeconds: measured.window,
    width: measured.media.width,
    height: measured.media.height,
    pacing: measured.pacing,
    speech: narrationStats(transcript.segments),
    transcriptSource: transcript.source === "captions" ? "platform captions" : transcript.source === "whisper" ? "Whisper" : "none (no speech found)",
    frameCount: measured.frames.length,
    hookCount: measured.hookFrames.length,
  };
  const { observations, notes } = await observe({ frames: [...measured.hookFrames, ...measured.frames], segments: transcript.segments, request, signal, onStatus });
  await onStatus("Writing the breakdown");
  const { value } = await request({
    // Long JSON from a reasoning model comes back empty unless reasoning is kept low.
    kind: "text", json: true, maxTokens: 9000, temperature: 0.3, reasoningEffort: "low", signal, timeoutMs: 240000,
    messages: [{ role: "user", content: reportPrompt({ facts, observations, notes, transcript: transcriptLines(transcript.segments, 30000), hook: hookTranscript(transcript.segments), question, catalog: watchCatalog({ voices }) }) }],
    validate: (v) => { if (!v?.recreate || !Array.isArray(v?.summary)) throw new Error("The breakdown came back incomplete"); },
  });
  const report = normalizeReport(value, facts);
  return { report, markdown: reportMarkdown(report), brief: reportBrief(report), heroes: heroFrames(measured.frames, measured.pacing), pacing: measured.pacing };
}

