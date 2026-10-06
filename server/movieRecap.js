// Movie to Recap: a full film in, a narrated long-form recap (10-20 min, 16:9) and/or a Short
// (60-90 s, 9:16) out. The film never passes through the app: scripts/movie_recap.py downloads,
// analyses and renders it on the media worker that declares the "movie" capability (the VPS),
// running detached so deploys can't kill it. The app owns the parts that need keys: describing
// frames, writing the script, narrating, and planning the cuts (src/utils/recapCuts.js).
//
// Copyright-safety rules the render follows (see the research in the PR): 3-4 s cuts, film skipped
// between every cut, no footage reused, the film's own audio dropped entirely, a light zoom and
// colour shift on every cut, and narration plus captions carrying the story.
import crypto from "node:crypto";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { openRouterConfigured, requestOpenRouter } from "../src/utils/openRouterClient.js";
import { withUsageUser } from "../src/utils/usageMeter.js";
import { assetStoreConfigured, ensureFile, removeFile, saveFile } from "./assetStore.js";
import { musicCapability, publicMessage, streamOpenRouterAudio } from "./creatorWorkspace.js";
import { planRecapCuts } from "../src/utils/recapCuts.js";
import { adoptStudioMedia, saveVibeProject } from "./vibeEdit.js";

let deps = {};
const SCRIPT = path.resolve("scripts/movie_recap.py");
// Gap after every narration line once its own silences are trimmed: just enough to breathe.
const PAUSE = 0.12;
const PACE = { natural: 1, brisk: 1.1, fast: 1.2 };
const POLL_MS = 15000;
const MAX_UPLOAD = 1.5 * 1024 * 1024 * 1024;
const FILE = /^[A-Za-z0-9._-]{1,120}$/;
const ID = /^rcp_[a-f0-9]{24}$/;
// House standards: full recaps run 10-17 minutes; Shorts 60-90 seconds.
export const RECAP_LIMITS = { longMinutes: [10, 17], shortSeconds: [60, 90] };
// Measured from the channel's own recaps: about 185 words a minute long-form, 200 in Shorts.
const WORDS_PER_MINUTE = { long: 185, short: 200 };

const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const timer = setTimeout(resolve, ms);
  signal?.addEventListener("abort", () => { clearTimeout(timer); reject(signal.reason || new Error("Stopped")); }, { once: true });
});
const clip = (value, max) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const clamp = (value, low, high, fallback) => { const n = Number(value); return Number.isFinite(n) ? Math.min(high, Math.max(low, n)) : fallback; };
const fmtTime = (seconds) => { const s = Math.max(0, Math.round(seconds)); const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const r = s % 60; return h ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`; };

// ---------- Storage: per-user project folders, mirrored to object storage ----------
const root = () => path.resolve(process.env.CREATOR_ASSETS_DIR || "data/creator-assets", "recaps");
const userKey = (userId) => crypto.createHash("sha256").update(String(userId)).digest("hex").slice(0, 24);
const projectDir = (userId, id) => path.join(root(), userKey(userId), id);
const storeKey = (userId, id, name) => `recaps/${userKey(userId)}/${id}/${name}`;
async function persist(userId, id, file) {
  if (!assetStoreConfigured()) return;
  await saveFile(storeKey(userId, id, path.basename(file)), file).catch((error) => console.warn(`[movie-recap] could not store ${path.basename(file)}: ${error.message}`));
}
async function restore(userId, id, name) {
  const file = path.join(projectDir(userId, id), name);
  if (fsSync.existsSync(file)) return file;
  return (await ensureFile(storeKey(userId, id, name), file)) ? file : "";
}
async function readJson(userId, id, name, fallback = null) {
  const file = await restore(userId, id, name);
  if (!file) return fallback;
  try { return JSON.parse(await fs.readFile(file, "utf8")); } catch { return fallback; }
}
async function writeJson(userId, id, name, value, { store = true } = {}) {
  const dir = projectDir(userId, id);
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, name);
  await fs.writeFile(`${file}.part`, JSON.stringify(value));
  await fs.rename(`${file}.part`, file);
  if (store) await persist(userId, id, file);
}

const indexes = new Map();
const indexFile = (userId) => path.join(root(), userKey(userId), "index.json");
async function index(userId) {
  if (indexes.has(userId)) return indexes.get(userId);
  const file = indexFile(userId);
  await ensureFile(`recaps/${userKey(userId)}/index.json`, file);
  let ids = [];
  try { ids = JSON.parse(await fs.readFile(file, "utf8")); } catch {}
  indexes.set(userId, Array.isArray(ids) ? ids : []);
  return indexes.get(userId);
}
async function saveIndex(userId) {
  const file = indexFile(userId);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(await index(userId)));
  if (assetStoreConfigured()) await saveFile(`recaps/${userKey(userId)}/index.json`, file).catch(() => {});
}

// Projects that were mid-pipeline when this process started; resumed once at boot.
const activeFile = () => path.join(root(), "active.json");
async function activeList() {
  await ensureFile("recaps/active.json", activeFile());
  try { return JSON.parse(await fs.readFile(activeFile(), "utf8")); } catch { return []; }
}
async function setActive(userId, id, on) {
  const list = (await activeList()).filter((entry) => entry.id !== id);
  if (on) list.push({ userId, id });
  await fs.mkdir(root(), { recursive: true });
  await fs.writeFile(activeFile(), JSON.stringify(list));
  if (assetStoreConfigured()) await saveFile("recaps/active.json", activeFile()).catch(() => {});
}

const projects = new Map(); // `${userId}:${id}` -> project, so polling never re-reads storage
async function load(userId, id) {
  if (!ID.test(String(id))) throw fail("Recap not found", 404);
  const key = `${userId}:${id}`;
  if (projects.has(key)) return projects.get(key);
  const project = await readJson(userId, id, "project.json");
  if (!project) throw fail("Recap not found", 404);
  projects.set(key, project);
  return project;
}
async function save(userId, project, patch = {}) {
  Object.assign(project, patch, { updatedAt: new Date().toISOString() });
  projects.set(`${userId}:${project.id}`, project);
  await writeJson(userId, project.id, "project.json", project);
  return project;
}

// ---------- Media worker calls ----------
function worker(args, { timeoutMs = 10 * 60 * 1000, signal } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.MOVIE_RECAP_PYTHON || "python3", [SCRIPT, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    const abort = () => child.kill("SIGKILL");
    signal?.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (chunk) => { out += chunk; });
    child.stderr.on("data", (chunk) => { err += chunk; });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      const line = out.trim().split("\n").filter(Boolean).pop() || "";
      try {
        const value = JSON.parse(line);
        if (value.error) return reject(fail(value.error, 502));
        resolve(value);
      } catch {
        reject(new Error(`The media worker failed (${code}): ${(err || out).trim().slice(-600)}`));
      }
    });
  });
}
const scratch = async (userId, id, name) => {
  const dir = path.join(projectDir(userId, id), "work", `${name}-${crypto.randomBytes(4).toString("hex")}`);
  await fs.mkdir(dir, { recursive: true });
  return dir;
};

// ---------- Pipeline ----------
const running = new Map(); // project id -> AbortController
function report(userId, project, message, progress, extra = {}) {
  return save(userId, project, { message, progress: Math.max(0, Math.min(1, progress)), ...extra });
}

async function waitForWorker(userId, project, phase, { from, to, out, signal }) {
  let missing = 0;
  for (;;) {
    await sleep(POLL_MS, signal);
    const status = await worker(["status", "--project", project.id, ...(out ? ["--out", out] : [])], { timeoutMs: 5 * 60 * 1000, signal }).catch((error) => ({ state: "unreachable", error: error.message }));
    if (status.state === "done") return status;
    if (status.state === "failed") throw fail(status.error || "The media worker failed.", 502);
    if (["missing", "stalled"].includes(status.state)) {
      if (++missing > 2) throw fail(phase === "analyze" ? "The media worker lost this film. Start the recap again." : "The media worker stopped rendering. Press Render to try again.", 502);
      continue;
    }
    if (status.state === "unreachable") continue;
    missing = 0;
    await report(userId, project, status.message || project.message, from + (to - from) * Number(status.progress || 0));
  }
}

async function stageAnalyze(userId, project, signal) {
  if (!project.remote?.analyzeStarted) {
    const args = ["start-analyze", "--project", project.id, "--options", JSON.stringify({ language: project.options.language || "" })];
    if (project.source.kind === "link") args.push("--url", project.source.url);
    else args.push("--file", await restore(userId, project.id, project.source.file));
    await report(userId, project, "Sending the film to the media worker", 0.01);
    await worker(args, { timeoutMs: 60 * 60 * 1000, signal });
    await save(userId, project, { remote: { ...project.remote, analyzeStarted: true } });
  }
  const out = await scratch(userId, project.id, "analysis");
  await waitForWorker(userId, project, "analyze", { from: 0.02, to: 0.45, out, signal });
  const analysis = JSON.parse(await fs.readFile(path.join(out, "analysis.json"), "utf8"));
  await writeJson(userId, project.id, "analysis.json", analysis);
  // Contact sheets are packed into one file so a recap costs two stored objects, not hundreds.
  const sheetDir = path.join(out, "sheets");
  const names = (await fs.readdir(sheetDir)).filter((name) => name.endsWith(".jpg")).sort();
  const buffers = await Promise.all(names.map((name) => fs.readFile(path.join(sheetDir, name))));
  const offsets = {};
  let at = 0;
  names.forEach((name, i) => { offsets[name] = [at, buffers[i].length]; at += buffers[i].length; });
  const dir = projectDir(userId, project.id);
  await fs.writeFile(path.join(dir, "sheets.pack"), Buffer.concat(buffers));
  await persist(userId, project.id, path.join(dir, "sheets.pack"));
  await writeJson(userId, project.id, "sheets.json", offsets);
  await fs.rm(out, { recursive: true, force: true });
  await save(userId, project, {
    stage: "describing",
    film: { duration: analysis.duration, shots: analysis.shots.length, scenes: analysis.scenes.length, lines: analysis.transcript.length, shotEvery: analysis.shotEvery, sheet: analysis.sheet },
  });
}

async function sheetBytes(userId, id, name) {
  const offsets = await readJson(userId, id, "sheets.json", {});
  const span = offsets[name];
  if (!span) return null;
  const pack = await restore(userId, id, "sheets.pack");
  if (!pack) return null;
  const handle = await fs.open(pack, "r");
  try {
    const buffer = Buffer.alloc(span[1]);
    await handle.read(buffer, 0, span[1], span[0]);
    return buffer;
  } finally {
    await handle.close();
  }
}

async function stageDescribe(userId, project, signal) {
  const offsets = await readJson(userId, project.id, "sheets.json", {});
  const names = Object.keys(offsets).sort();
  const described = await readJson(userId, project.id, "descriptions.json", {});
  const perCall = 3;
  const batches = [];
  for (let i = 0; i < names.length; i += perCall) batches.push(names.slice(i, i + perCall));
  const todo = batches.filter((batch) => !batch.every((name) => described[`sheet:${name}`]));
  let finished = batches.length - todo.length;
  const model = process.env.MOVIE_RECAP_VISION_MODEL || "google/gemini-3.8-flash";
  const describeBatch = async (batch) => {
    const content = [{ type: "text", text: `These are contact sheets from one film. Every tile is a frame, and the white number in its corner is the shot number. For every numbered tile, describe what is on screen in at most 16 words: who (by look, e.g. "the young woman in the red coat"), what they do, where, and the mood. Do not guess names. Also tag the shot: "s" is "close" (the subject fills over half the frame), "medium" (a whole person or object, 20-50% of the frame), "wide" (subjects small or far away), or "none" (no clear subject: empty scenery, sky, black); "a" is true when a character or object is visibly doing something; "t" is true when the frame shows text, a logo, a title card, credits, or burned-in subtitles; "k" is true when it is too dark to read. Return JSON: {"tiles":[{"n":<shot number>,"d":"<description>","s":"close","a":true,"t":false,"k":false}]} covering every tile.` }];
    for (const name of batch) {
      const bytes = await sheetBytes(userId, project.id, name);
      if (bytes) content.push({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${bytes.toString("base64")}` } });
    }
    const { value } = await requestOpenRouter({ kind: "vision", model, json: true, maxTokens: 6000, temperature: 0.2, reasoningEffort: "low", signal, messages: [{ role: "user", content }], validate: (v) => { if (!Array.isArray(v?.tiles)) throw new Error("No tiles"); } });
    for (const tile of value.tiles) {
      const n = Number(tile?.n);
      if (Number.isInteger(n) && n >= 0) {
        described[n] = clip(tile.d, 160);
        // Rough-cutting standards: shot size, action, on-screen text, darkness.
        described[`tag:${n}`] = { s: ["close", "medium", "wide", "none"].includes(tile.s) ? tile.s : "", a: tile.a === true, t: tile.t === true, k: tile.k === true };
      }
    }
    for (const name of batch) described[`sheet:${name}`] = 1;
    finished += 1;
  };
  const queue = [...todo];
  const workers = Array.from({ length: 3 }, async () => {
    while (queue.length) {
      signal.throwIfAborted();
      const batch = queue.shift();
      // One retry: providers sometimes return an empty response for a whole batch.
      await describeBatch(batch).catch((error) => { if (signal.aborted) throw error; return describeBatch(batch); }).catch((error) => {
        if (signal.aborted) throw error;
        console.warn(`[movie-recap] frame batch skipped: ${error.message}`);
        for (const name of batch) described[`sheet:${name}`] = 1;
        finished += 1;
      });
      if (finished % 4 === 0 || !queue.length) {
        await writeJson(userId, project.id, "descriptions.json", described);
        await report(userId, project, `Watching the film (${finished} of ${batches.length} frame sheets)`, 0.45 + 0.25 * (finished / Math.max(1, batches.length)));
      }
    }
  });
  await Promise.all(workers);
  await writeJson(userId, project.id, "descriptions.json", described);
  await save(userId, project, { stage: "writing" });
}

function timelineText(analysis, described) {
  const rows = [];
  for (const shot of analysis.shots) if (described[shot.i]) rows.push([shot.t, `[${fmtTime(shot.t)}] SHOT ${shot.i}: ${described[shot.i]}`]);
  for (const line of analysis.transcript) if (line.text) rows.push([line.start + 0.01, `[${fmtTime(line.start)}] SAYS: ${clip(line.text, 140)}`]);
  return rows.sort((a, b) => a[0] - b[0]).map((row) => row[1]).join("\n");
}

const TONES = {
  dramatic: "gripping and dramatic, building tension toward each turn",
  suspense: "suspenseful, holding back just enough to keep viewers watching",
  funny: "witty and playful, with light jokes that never undercut the story",
  calm: "calm and clear, a confident storyteller",
};

/** The script prompt: the film's timeline plus the channel's house style (exported for tests and tuning). */
export function recapScriptPrompt(project, analysis, described) {
  const { formats, longMinutes, shortSeconds, tone, language, filmTitle, channelName } = project.options;
  const wantLong = formats.includes("long");
  const wantShort = formats.includes("short");
  const longWords = Math.round(longMinutes * WORDS_PER_MINUTE.long);
  const shortWords = Math.round((shortSeconds / 60) * WORDS_PER_MINUTE.short);
  const film = analysis.duration;
  const prompt = `You write narration for faceless movie-recap videos. Below is everything we know about one film, in time order: what is on screen at each sampled SHOT (one every ${analysis.shotEvery} s) and what characters SAY.

FILM LENGTH: ${fmtTime(film)} (${Math.round(film)} seconds)

${timelineText(analysis, described)}

${filmTitle ? `THE FILM: ${filmTitle}\n\n` : ""}Write ${[wantLong && `a long recap of about ${longWords} words (${longMinutes} minutes spoken)`, wantShort && `a Short of about ${shortWords} words (${shortSeconds} seconds spoken)`].filter(Boolean).join(" and ")}. ${language ? `Write in ${language}.` : "Write in the language the characters speak."}

House style for every recap:
- Third person, present tense, ${TONES[tone] || TONES.dramatic}. Short, punchy sentences with strong verbs; no filler ("meanwhile", "little did he know", "it turns out").
- Tell the story through what characters DO on screen. Every line should describe something visible: a character acting, reacting, or speaking. Avoid lines about empty scenery.
- Use the characters' names from the film: from the dialogue, or from your knowledge of this film when its title is given. Otherwise describe them ("the detective", "her brother").
- Never mention actors, directors, awards, box office, release background, or behind-the-scenes facts.
- Keep personal opinion to one short sentence in a Short and a few sentences in a long recap.
- Never use the words "rape" or "drug abuse" ("murder" is fine). No discriminatory language about religion, gender, race, region, or sexual orientation.
- The narration carries the story in your own words. Quote dialogue rarely and never more than six words.
- Ignore opening titles, studio logos, and end credits.
${wantLong ? `
Long recap (${longMinutes} minutes):
- Open with a welcome: "Hi, welcome to ${channelName || "the channel"}." Then two or three sentences teasing the film's most gripping moments${filmTitle ? `, then name it: "This is the [year] movie ${filmTitle}." (use the year if you know it)` : ""}.
- Then tell the whole story in chronological order, skipping scenes that don't matter, through the ending. Narrate the climax rather than replaying it.
- End with the outro: "Thank you for watching ${channelName || "the channel"}. This has been our recap of ${filmTitle || "[the film]"}. If you enjoyed it, like and subscribe, and tell us in the comments what you thought of the ending. Until next time, take care."
- Beats of 2-3 sentences (30-50 words), about ${Math.round(longWords / 40)} beats in all. Their film stretches move forward through the film and are at least 45 seconds long.
` : ""}${wantShort ? `
Short (${shortSeconds} seconds):
- One main character (at most three) and one storyline from one stretch of the film. Do not summarize the whole film and do not explain unrelated plots. It need not be chronological.
- First 5 seconds: the hook. The character doing something strange, shocking, or unexpected; a reversal that makes a stranger stay.
- Next: what happens because of it, and its result.
- Middle: the second climax, pushing the same storyline further or turning it around.
- Then continue it toward a peak.
- Last 10 seconds: end on suspense, with a question or an unresolved moment ("What will he do next?").
- Beats of 18-30 words, about ${Math.round(shortWords / 24)} beats and ${shortWords} words in all. A Short under ${Math.round(shortWords * 0.85)} words is too short.
` : ""}
Every beat gives "from" and "to": the stretch of film, in seconds, it narrates. Every beat lists "shots": up to 6 SHOT numbers that best show what the narration says, preferring close and medium shots of characters in action.
Return JSON only:
{"title":"<recap title, max 80 characters>",${wantLong ? `"long":{"beats":[{"text":"...","from":0,"to":0,"shots":[0]}]},` : ""}${wantShort ? `"short":{"title":"<Short title, max 70 characters>","beats":[{"text":"...","from":0,"to":0,"shots":[0]}]},` : ""}"logline":"<one sentence on what the film is about>"}`;
  return { prompt, wantLong, wantShort, film, longWords, shortWords };
}

const scriptWords = (beats) => (Array.isArray(beats) ? beats : []).reduce((sum, beat) => sum + String(beat?.text || "").split(/\s+/).filter(Boolean).length, 0);

/** What the draft is missing against the word budget, or "" when it is long enough (models underwrite Shorts badly). */
export function scriptShortfall(value, { wantLong, wantShort, longWords, shortWords }) {
  const notes = [];
  const longHas = scriptWords(value?.long?.beats);
  const shortHas = scriptWords(value?.short?.beats);
  if (wantLong && longHas < longWords * 0.8) notes.push(`The long recap has ${longHas} words but needs about ${longWords}. Add beats covering more of the story.`);
  if (wantShort && shortHas < shortWords * 0.85) notes.push(`The Short has ${shortHas} words but needs about ${shortWords}. Add beats that push the same storyline further.`);
  return notes.join(" ");
}

async function stageWrite(userId, project, signal) {
  await report(userId, project, "Writing the recap script", 0.72);
  const analysis = await readJson(userId, project.id, "analysis.json");
  const described = await readJson(userId, project.id, "descriptions.json", {});
  const budget = recapScriptPrompt(project, analysis, described);
  const { prompt, wantLong, wantShort, film } = budget;
  const model = process.env.MOVIE_RECAP_SCRIPT_MODEL || "google/gemini-3.8-flash";
  const ask = (messages) => requestOpenRouter({
    kind: "text", model, json: true, maxTokens: 24000, temperature: 0.7, reasoningEffort: "low", signal, timeoutMs: 8 * 60 * 1000,
    messages,
    validate: (v) => {
      if (wantLong && !(v?.long?.beats?.length > 3)) throw new Error("No long beats");
      if (wantShort && !(v?.short?.beats?.length > 1)) throw new Error("No short beats");
    },
  });
  let { value } = await ask([{ role: "user", content: prompt }]);
  const shortfall = scriptShortfall(value, budget);
  if (shortfall) {
    // One revision pass: the same draft back with the exact counts, keeping whichever comes out longer.
    const revised = await ask([
      { role: "user", content: prompt },
      { role: "assistant", content: JSON.stringify(value) },
      { role: "user", content: `${shortfall} Keep the house style and every rule above. Return the complete JSON again.` },
    ]).then((result) => result.value, () => null);
    const total = (v) => scriptWords(v?.long?.beats) + scriptWords(v?.short?.beats);
    if (revised && total(revised) > total(value)) value = revised;
  }
  const beats = (list) => (Array.isArray(list) ? list : []).map((beat, i) => {
    const from = clamp(beat?.from, 0, film, 0);
    const to = clamp(beat?.to, from + 5, film, Math.min(film, from + 60));
    return {
      id: `b${i}`,
      text: clip(beat?.text, 600),
      from: Math.round(from),
      to: Math.round(to),
      shots: (Array.isArray(beat?.shots) ? beat.shots : []).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n < analysis.shots.length).slice(0, 6),
    };
  }).filter((beat) => beat.text);
  const script = {
    title: clip(value.title, 80) || project.title,
    logline: clip(value.logline, 240),
    ...(wantLong ? { long: { beats: beats(value.long.beats) } } : {}),
    ...(wantShort ? { short: { title: clip(value.short.title, 70), beats: beats(value.short.beats) } } : {}),
  };
  await save(userId, project, { stage: "review", status: "review", script, message: "Script ready for review", progress: 0.75, title: script.title || project.title });
}

// House standard: background music fits the film's mood and sits 10-15 dB under the voice. One
// instrumental bed per recap from the app's music model; the worker loops it to length.
const MUSIC_MOOD = {
  dramatic: "epic cinematic orchestral underscore, driving strings and low percussion",
  suspense: "dark suspense underscore, pulsing synths and tense strings",
  funny: "light playful underscore, plucked strings and soft percussion",
  calm: "warm ambient cinematic underscore, soft piano and pads",
};
async function generateMusicBed(userId, project, signal) {
  const capability = musicCapability();
  if (!capability.available) return;
  await report(userId, project, "Scoring a music bed", 0.82);
  try {
    const audio = await streamOpenRouterAudio({
      model: capability.model,
      messages: [{ role: "user", content: `${MUSIC_MOOD[project.options.tone] || MUSIC_MOOD.dramatic} for a movie recap video. The story: ${project.script?.logline || project.title}. Instrumental only: no vocals, no lyrics. Keep one steady energy with no silences or big drops, so it can loop quietly under narration.` }],
      modalities: ["text", "audio"],
      audio: { format: "wav" },
      stream: true,
    }, signal);
    if (!["wav", "mp3", "ogg"].includes(audio.extension)) return;
    const file = `music.${audio.extension}`;
    const full = path.join(projectDir(userId, project.id), file);
    await fs.writeFile(full, audio.bytes);
    const probe = await scratch(userId, project.id, "music");
    await fs.copyFile(full, path.join(probe, file));
    const { lengths } = await worker(["measure", "--out", probe], { timeoutMs: 5 * 60 * 1000, signal });
    await fs.rm(probe, { recursive: true, force: true });
    await persist(userId, project.id, full);
    await save(userId, project, { music: { file, seconds: Number(lengths[file]) || 0 } });
  } catch (error) {
    if (signal.aborted) throw error;
    // A recap without music is still a recap; the narration and cuts don't depend on it.
    console.warn(`[movie-recap] music bed skipped: ${error.message}`);
  }
}

const audioDir = (userId, id) => path.join(projectDir(userId, id), "audio");
const beatHash = (voiceId, text) => crypto.createHash("sha1").update(`${voiceId}\n${text}`).digest("hex").slice(0, 16);

async function stageVoice(userId, project, signal) {
  if (!deps.speak) throw fail("Narration isn't available on this server.", 503);
  const dir = audioDir(userId, project.id);
  await fs.mkdir(dir, { recursive: true });
  const jobs = [];
  for (const format of project.options.formats) for (const beat of project.script[format]?.beats || []) jobs.push({ format, beat });
  let done = 0;
  const queue = [...jobs];
  const voiceId = project.options.voiceId;
  await Promise.all(Array.from({ length: 3 }, async () => {
    while (queue.length) {
      signal.throwIfAborted();
      const { beat } = queue.shift();
      const hash = beatHash(voiceId, beat.text);
      const existing = ["wav", "mp3"].map((ext) => path.join(dir, `${hash}.${ext}`)).find((file) => fsSync.existsSync(file));
      if (!existing) {
        // Voice services drop the odd request; one bad line shouldn't fail a whole recap.
        let spoken;
        for (let attempt = 1; ; attempt++) {
          try {
            spoken = await deps.speak({ voiceId, text: beat.text, signal, direction: `${TONES[project.options.tone] || TONES.dramatic}; quick, energetic delivery with no long pauses` });
            break;
          } catch (error) {
            if (signal.aborted || attempt >= 3) throw error;
            await sleep(2000 * attempt, signal);
          }
        }
        const { audio, extension } = spoken;
        await fs.writeFile(path.join(dir, `${hash}.${extension === "mp3" ? "mp3" : "wav"}`), audio);
      }
      beat.audio = path.basename(existing || ["wav", "mp3"].map((ext) => path.join(dir, `${hash}.${ext}`)).find((file) => fsSync.existsSync(file)));
      done += 1;
      if (done % 5 === 0 || !queue.length) await report(userId, project, `Recording the narration (${done} of ${jobs.length} lines)`, 0.76 + 0.06 * (done / jobs.length));
    }
  }));
  // Keep only this script's clips, then trim their silences and set the pace in one worker call.
  const keep = new Set(jobs.map((job) => job.beat.audio));
  for (const name of await fs.readdir(dir)) if (!keep.has(name)) await fs.rm(path.join(dir, name), { force: true });
  await report(userId, project, "Tightening the narration", 0.82);
  const tempo = PACE[project.options.pace] || PACE.brisk;
  const { lengths } = await worker(["tighten", "--out", dir, "--tempo", String(tempo)], { timeoutMs: 15 * 60 * 1000, signal });
  for (const { beat } of jobs) {
    const tight = lengths[beat.audio];
    beat.audio = tight?.name || beat.audio;
    beat.seconds = Number(tight?.seconds) || 0;
  }
  if (jobs.some((job) => !(job.beat.seconds > 0))) throw fail("Some narration lines came back empty. Try another voice.", 502);
  if (project.options.music !== false && !project.music?.file) await generateMusicBed(userId, project, signal);
  await save(userId, project, { stage: "planning" });
}

/** Caption chunks timed over each line: Shorts get one or two words at a time, long recaps a short line. */
function captionLines(beats, pauses = PAUSE, { maxWords = 6, maxChars = 40 } = {}) {
  const lines = [];
  let at = 0;
  for (const beat of beats) {
    const words = beat.text.split(/\s+/).filter(Boolean);
    const chunks = [];
    let current = [];
    for (const word of words) {
      const next = [...current, word].join(" ");
      if (current.length && (current.length >= maxWords || next.length > maxChars)) {
        chunks.push(current.join(" "));
        current = [];
      }
      current.push(word);
    }
    if (current.length) chunks.push(current.join(" "));
    const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0) || 1;
    let t = at;
    for (const chunk of chunks) {
      const span = beat.seconds * (chunk.length / total);
      lines.push({ start: Math.round(t * 100) / 100, end: Math.round((t + span) * 100) / 100, text: chunk });
      t += span;
    }
    at += beat.seconds + pauses;
  }
  return lines;
}

/** The stretch of film a beat may cut from: its own range, widened until it can hold its cuts and gaps. */
function beatWindow(beat, film) {
  const duration = beat.seconds + PAUSE;
  const need = duration * 2.6 + 8;
  let from = beat.from;
  let to = Math.max(beat.to, beat.from + 1);
  if (to - from < need) {
    const grow = (need - (to - from)) / 2;
    from = Math.max(1, from - grow);
    to = Math.min(film - 1, to + grow);
  }
  return { from, to, duration };
}

/** The words heard over each cut of a beat, spread over the beat's narration in proportion to length. */
function wordsPerCut(beat, cuts) {
  const words = beat.text.split(/\s+/).filter(Boolean);
  const per = beat.seconds / Math.max(1, words.length);
  let local = 0;
  return cuts.map((cut) => {
    const from = local;
    local += cut.duration;
    return words.filter((_, i) => (i + 0.5) * per >= from && (i + 0.5) * per < local).join(" ");
  });
}

/**
 * @param {any} project
 * @param {{ duration: number, shots: Array<{ i: number, t: number }> }} analysis
 * @param {Record<string, Record<string, Array<number | null>>>} [matches] per format, per beat: the film time matched to each cut
 */
export function buildRecapPlan(project, analysis, matches = {}) {
  const film = analysis.duration;
  const shotTime = (n) => analysis.shots[n]?.t;
  const formats = {};
  const stats = {};
  const edit = {};
  for (const format of project.options.formats) {
    const beats = project.script[format]?.beats || [];
    const planned = planRecapCuts({
      seed: `${project.id}-${format}`,
      filmDuration: film,
      beats: beats.map((beat) => {
        // Each cut needs 3-4 s plus a skipped gap, so a beat needs about 2.5x its length of film.
        const { from, to, duration } = beatWindow(beat, film);
        return { id: beat.id, duration, from, to, anchors: beat.shots.map(shotTime).filter((t) => t !== undefined), cutAnchors: matches[format]?.[beat.id] };
      }),
    });
    formats[format] = {
      cuts: planned.cuts.map(({ start, end, duration }) => ({ start, end, duration })),
      audioFiles: beats.map((beat) => beat.audio),
      pause: PAUSE,
      captions: captionLines(beats, PAUSE, format === "short" ? { maxWords: 2, maxChars: 14 } : { maxWords: 7, maxChars: 44 }),
    };
    stats[format] = { ...planned.stats, seconds: Math.round(beats.reduce((sum, beat) => sum + beat.seconds + PAUSE, 0)) };
    let at = 0;
    edit[format] = {
      cuts: planned.cuts.map(({ at: position, duration, beatId }) => ({ at: position, duration, beatId })),
      beats: beats.map((beat) => { const entry = { start: Math.round(at * 1000) / 1000, seconds: beat.seconds }; at += beat.seconds + PAUSE; return entry; }),
      captions: formats[format].captions,
    };
  }
  const music = project.music?.file ? { name: project.music.file, under: 12 } : undefined;
  return { plan: { seed: project.id, transforms: project.options.transforms, captions: project.options.captions !== false, font: CAPTION_FONT, formats, ...(music ? { music } : {}) }, stats, edit };
}

const STOP_WORDS = new Set("a an the and or but if then so to of in on at by for with from up down out over under into onto as is are was were be been being he she it they them his her its their this that these those who what when where while there here not no yes all any one two three just than too very can will would could should has have had do does did".split(" "));
const wordsOf = (text) => String(text || "").toLowerCase().match(/[a-z']+/g)?.map((w) => w.replace(/'s$/, "").replace(/(ing|ed|es|s)$/, "")).filter((w) => w.length > 2 && !STOP_WORDS.has(w)) || [];
/** Frames anywhere in the film whose description best shares a line's words, rare words counting most
 *  (a "butterfly" outweighs a "rabbit" seen in every shot): a safety net for when the writer's film
 *  range for that line is off. Titles and credits are skipped. */
function framesMatchingWords(text, analysis, described, limit = 14) {
  const wanted = new Set(wordsOf(text));
  if (!wanted.size) return [];
  const film = analysis.duration;
  const low = Math.min(90, film * 0.01);
  const high = film - Math.min(480, film * 0.07);
  const pool = analysis.shots.filter((shot) => shot.t > low && shot.t < high && described[shot.i]).map((shot) => ({ shot, words: new Set(wordsOf(described[shot.i])) }));
  const frequency = new Map();
  for (const { words } of pool) for (const w of words) frequency.set(w, (frequency.get(w) || 0) + 1);
  const weight = (w) => Math.log((pool.length + 1) / ((frequency.get(w) || 0) + 1));
  return pool
    .map(({ shot, words }) => ({ shot, score: [...words].filter((w) => wanted.has(w)).reduce((sum, w) => sum + weight(w), 0) }))
    .filter((row) => row.score >= 1.5)
    .sort((a, b) => b.score - a.score || a.shot.t - b.shot.t)
    .slice(0, limit)
    .map((row) => row.shot);
}

// Rough-cutting standards: never cut a frame with no subject, on-screen text (logos, titles,
// credits, subtitles), or too dark to read. Frames described before tags existed stay usable.
function usableFrame(described, n) {
  if (!described[n]) return false;
  const tag = described[`tag:${n}`];
  return !tag || (tag.s !== "none" && !tag.t && !tag.k);
}
function frameTag(described, n) {
  const tag = described[`tag:${n}`];
  if (!tag) return "";
  return ` [${[tag.s, tag.a ? "action" : "still"].filter(Boolean).join(", ")}]`;
}

/**
 * Picks, for every cut, the described frame that best shows the words spoken over it. The first plan
 * fixes how many cuts each line gets; the model chooses a frame per cut from the line's stretch of
 * film; the plan is then rebuilt around those frames with every cut rule still enforced.
 * @returns {Promise<Record<string, Record<string, Array<number | null>>>>}
 */
export async function matchCutsToFrames(project, analysis, described, firstEdit, { signal, request = requestOpenRouter } = {}) {
  const film = analysis.duration;
  const model = process.env.MOVIE_RECAP_SCRIPT_MODEL || "google/gemini-3.8-flash";
  const matches = {};
  for (const format of project.options.formats) {
    const beats = project.script[format]?.beats || [];
    const cutsByBeat = new Map();
    for (const cut of firstEdit[format]?.cuts || []) cutsByBeat.set(cut.beatId, [...(cutsByBeat.get(cut.beatId) || []), cut]);
    const tasks = beats.map((beat) => {
      const cuts = cutsByBeat.get(beat.id) || [];
      const { from, to } = beatWindow(beat, film);
      let candidates = analysis.shots.filter((shot) => shot.t >= from && shot.t <= to && usableFrame(described, shot.i));
      if (candidates.length > 44) candidates = candidates.filter((_, i) => i % Math.ceil(candidates.length / 44) === 0);
      const seen = new Set(candidates.map((shot) => shot.i));
      for (const shot of framesMatchingWords(beat.text, analysis, described)) if (!seen.has(shot.i) && usableFrame(described, shot.i)) { candidates.push(shot); seen.add(shot.i); }
      candidates.sort((a, b) => a.t - b.t);
      return { beat, cuts, says: wordsPerCut(beat, cuts), candidates };
    }).filter((task) => task.cuts.length && task.candidates.length > 1);
    matches[format] = {};
    const batches = [];
    for (let i = 0; i < tasks.length; i += 6) batches.push(tasks.slice(i, i + 6));
    const queue = [...batches];
    await Promise.all(Array.from({ length: 3 }, async () => {
      while (queue.length) {
        signal?.throwIfAborted();
        const batch = queue.shift();
        const brief = batch.map((task) => [
          `LINE ${task.beat.id}: "${task.beat.text}"`,
          ...task.says.map((words, k) => `  CUT ${k + 1} (${task.cuts[k].duration.toFixed(1)} s) says: "${words || "(pause)"}"`),
          "  FRAMES:",
          ...task.candidates.map((shot) => `  #${shot.i} @${fmtTime(shot.t)}${frameTag(described, shot.i)}: ${described[shot.i]}`),
        ].join("\n")).join("\n\n");
        try {
          const { value } = await request({
            kind: "text", model, json: true, maxTokens: 4000, temperature: 0.2, reasoningEffort: "low", signal,
            messages: [{ role: "user", content: `You are editing a movie recap. For every CUT, pick the one FRAME (by its # number, from that line's list) that best shows what the narrator says during that cut: the same character, action, object, or place. What is said matters more than where the frame sits in the film. Strongly prefer [close] and [medium] frames where someone is doing something [action]; use [wide] only when nothing closer fits. Prefer frames in story order within a line, and never pick the same frame twice or two frames less than 6 seconds apart in one line.\n\n${brief}\n\nReturn JSON only: {"lines":[{"id":"<line id>","cuts":[<frame number for cut 1>, ...]}]} with exactly one frame per cut.` }],
            validate: (v) => { if (!Array.isArray(v?.lines)) throw new Error("No lines"); },
          });
          for (const line of value.lines) {
            const task = batch.find((t) => t.beat.id === String(line?.id));
            if (!task || !Array.isArray(line.cuts) || line.cuts.length !== task.cuts.length) continue;
            const allowed = new Map(task.candidates.map((shot) => [shot.i, shot.t]));
            matches[format][task.beat.id] = line.cuts.map((n) => allowed.get(Number(n)) ?? null);
          }
        } catch (error) {
          if (signal?.aborted) throw error;
          console.warn(`[movie-recap] frame matching skipped for a batch: ${error.message}`);
        }
      }
    }));
  }
  return matches;
}

// Captions are set in Montserrat (OFL), shipped with the app and sent along with the narration.
const CAPTION_FONT = "Montserrat.ttf";
const captionFontPath = () => ["dist/fonts/captions", "public/fonts/captions"].map((dir) => path.resolve(dir, CAPTION_FONT)).find((file) => fsSync.existsSync(file));

async function stagePlanAndRender(userId, project, signal) {
  if (!project.remote?.renderStarted) {
    await report(userId, project, "Matching footage to every line", 0.83);
    const analysis = await readJson(userId, project.id, "analysis.json");
    const described = await readJson(userId, project.id, "descriptions.json", {});
    const first = buildRecapPlan(project, analysis);
    const matches = await matchCutsToFrames(project, analysis, described, first.edit, { signal });
    const { plan, stats, edit } = buildRecapPlan(project, analysis, matches);
    const work = await scratch(userId, project.id, "render");
    const audio = path.join(work, "audio");
    await fs.mkdir(audio, { recursive: true });
    for (const format of Object.keys(plan.formats))
      for (const name of plan.formats[format].audioFiles) await fs.copyFile(path.join(audioDir(userId, project.id), name), path.join(audio, name));
    const font = captionFontPath();
    if (font) await fs.copyFile(font, path.join(audio, CAPTION_FONT));
    else delete plan.font;
    if (plan.music) {
      const musicFile = await restore(userId, project.id, plan.music.name);
      if (musicFile) await fs.copyFile(musicFile, path.join(audio, plan.music.name));
      else delete plan.music;
    }
    await fs.writeFile(path.join(work, "plan.json"), JSON.stringify(plan));
    await save(userId, project, { stats, edit, stage: "rendering" });
    await report(userId, project, "Sending the edit to the media worker", 0.84);
    await worker(["start-render", "--project", project.id, "--plan", path.join(work, "plan.json"), "--audio-dir", audio], { timeoutMs: 20 * 60 * 1000, signal });
    await fs.rm(work, { recursive: true, force: true });
    await save(userId, project, { remote: { ...project.remote, renderStarted: true } });
  }
  const status = await waitForWorker(userId, project, "render", { from: 0.85, to: 0.97, signal });
  await save(userId, project, { stage: "finishing", rendered: status.outputs || [] });
}

function musicClips(edit, length) {
  const last = edit.beats.at(-1);
  const total = last ? last.start + last.seconds + PAUSE : 0;
  const clips = [];
  for (let at = 0, i = 0; at < total - 0.05; at += length, i++) {
    const out = Math.min(length, total - at);
    clips.push({ id: `music${i}`, assetId: "recap_music", lane: 2, start: Math.round(at * 1000) / 1000, in: 0, out: Math.round(out * 1000) / 1000, volume: 0.25, fadeIn: i === 0 ? 1.5 : 0, fadeOut: at + length >= total ? 2.5 : 0, name: "Music bed" });
  }
  return clips;
}

// The rendered recap as a Vibe Edit project: every cut a clip over the cut picture, every narration
// line an audio clip, every caption a cue with word timings. Tweak there, then export.
export function recapVibeProject(project, format, picture, voice, music) {
  const edit = project.edit?.[format] || { cuts: [], beats: [], captions: [] };
  const now = Date.now();
  const short = format === "short";
  const words = (text, start, end) => {
    const list = text.split(/\s+/).filter(Boolean);
    const per = (end - start) / Math.max(1, list.length);
    return list.map((w, i) => ({ w, t0: Math.round((start + i * per) * 1000) / 1000, t1: Math.round((start + (i + 1) * per) * 1000) / 1000 }));
  };
  return {
    version: 1,
    id: `vp_${crypto.randomBytes(6).toString("hex")}`,
    name: clip(`${(short && project.script?.short?.title) || project.title}${short ? " (Short)" : ""}`, 120),
    aspect: short ? "9:16" : "16:9",
    background: "#000000",
    assets: [
      { id: "recap_picture", kind: "video", name: "Recap cuts", url: picture.url, file: picture.file, duration: picture.duration, width: short ? 1080 : 1920, height: short ? 1920 : 1080, origin: "generated" },
      { id: "recap_voice", kind: "audio", name: "Narration", url: voice.url, file: voice.file, duration: voice.duration, origin: "voiceover" },
      ...(music ? [{ id: "recap_music", kind: "audio", name: "Music bed", url: music.url, file: music.file, duration: music.duration, origin: "music" }] : []),
    ],
    clips: edit.cuts.map((cut, i) => ({ id: `cut${i}`, assetId: "recap_picture", track: 0, start: cut.at, in: cut.at, out: Math.round((cut.at + cut.duration) * 1000) / 1000, fit: "fill" })),
    audio: [
      ...edit.beats.map((beat, i) => ({ id: `line${i}`, assetId: "recap_voice", lane: 1, start: beat.start, in: beat.start, out: Math.round((beat.start + beat.seconds) * 1000) / 1000, volume: 1, name: `Line ${i + 1}` })),
      // The bed repeats end to end under the whole edit, about 12 dB down.
      ...(music?.duration > 1 ? musicClips(edit, music.duration) : []),
    ],
    texts: [],
    captions: {
      cues: edit.captions.map((line, i) => ({ id: `cap${i}`, start: line.start, end: line.end, text: line.text, words: words(line.text, line.start, line.end) })),
      show: project.options.captions !== false,
      style: short ? "hook" : "clean",
      wordHighlight: true,
    },
    createdAt: now,
    updatedAt: now,
  };
}

async function stageFinish(userId, project, signal) {
  const outputs = [];
  const media = {};
  for (const output of project.rendered || []) {
    const label = output.format === "short" ? "Short" : "long recap";
    await report(userId, project, output.kind === "final" ? `Delivering the ${label}` : `Preparing the ${label} for Vibe Edit`, 0.97);
    const out = await scratch(userId, project.id, "fetch");
    await worker(["fetch", "--project", project.id, "--name", output.name, "--out", out], { timeoutMs: 60 * 60 * 1000, signal });
    const fetched = path.join(out, output.name);
    if (output.kind === "final") {
      const name = `${output.format === "short" ? "short" : "long"}-${crypto.randomBytes(3).toString("hex")}.mp4`;
      const file = path.join(projectDir(userId, project.id), name);
      await fs.rename(fetched, file);
      await persist(userId, project.id, file);
      outputs.push({ format: output.format, file: name, size: output.size, duration: output.duration });
    } else {
      const adopted = await adoptStudioMedia(userId, fetched, output.kind === "picture" ? "mp4" : "m4a");
      media[output.format] = { ...media[output.format], [output.kind]: { ...adopted, duration: output.duration } };
    }
    await fs.rm(out, { recursive: true, force: true });
  }
  const vibe = {};
  // The music bed joins every format's edit as one shared studio file.
  let music;
  if (project.music?.file) {
    const musicFile = await restore(userId, project.id, project.music.file);
    if (musicFile) music = { ...(await adoptStudioMedia(userId, musicFile, path.extname(project.music.file).slice(1)).catch(() => ({}))), duration: project.music.seconds };
    if (!music?.file) music = undefined;
  }
  for (const format of Object.keys(media)) {
    const { picture, narration } = media[format];
    if (!picture || !narration) continue;
    const doc = recapVibeProject(project, format, picture, narration, music);
    await saveVibeProject(userId, doc);
    vibe[format] = doc.id;
  }
  await save(userId, project, { stage: "done", status: "done", outputs, vibe, message: "", progress: 1, remote: { ...project.remote, renderStarted: false } });
}

function start(userId, id) {
  if (running.has(id)) return;
  const controller = new AbortController();
  running.set(id, controller);
  withUsageUser(userId, "tools:movie-recap", async () => {
    let project;
    try {
      project = await load(userId, id);
      await setActive(userId, id, true);
      await save(userId, project, { status: "working", error: "" });
      for (let guard = 0; guard < 12; guard++) {
        const stage = project.stage;
        if (stage === "analyzing") await stageAnalyze(userId, project, controller.signal);
        else if (stage === "describing") await stageDescribe(userId, project, controller.signal);
        else if (stage === "writing") await stageWrite(userId, project, controller.signal);
        else if (stage === "voicing") await stageVoice(userId, project, controller.signal);
        else if (stage === "planning" || stage === "rendering") await stagePlanAndRender(userId, project, controller.signal);
        else if (stage === "finishing") await stageFinish(userId, project, controller.signal);
        else break;
      }
    } catch (error) {
      if (project) {
        const stopped = controller.signal.aborted;
        await save(userId, project, {
          status: stopped ? "cancelled" : "failed",
          error: stopped ? "Stopped" : publicMessage(error instanceof Error ? error.message : String(error)),
          message: "",
        }).catch(() => {});
      }
    } finally {
      running.delete(id);
      await setActive(userId, id, false).catch(() => {});
    }
  });
}

function summary(project) {
  const { id, title, status, stage, message, progress, error, options, film, outputs, stats, createdAt, updatedAt, source, vibe } = project;
  return { id, title, status, stage, message, progress, error, options, film, vibe: vibe || {}, outputs: (outputs || []).map((o) => ({ ...o, url: `/api/recaps/${id}/files/${o.file}` })), stats, createdAt, updatedAt, source: { kind: source.kind, name: source.name } };
}

// ---------- Routes ----------
export function configureMovieRecap(dependencies) {
  deps = dependencies;
  // Resume whatever was mid-pipeline when the app last stopped (deploys restart it).
  setTimeout(async () => {
    for (const entry of await activeList().catch(() => [])) {
      try {
        const project = await load(entry.userId, entry.id);
        if (project.status === "working" || project.status === "queued") start(entry.userId, entry.id);
      } catch {}
    }
  }, 20 * 1000).unref?.();
}

export function registerMovieRecap(app) {
  const route = (handler) => async (req, res) => {
    try {
      const session = await deps.session(req);
      if (!session?.user) throw fail("Sign in required", 401);
      await handler(req, res, String(session.user.id));
    } catch (error) {
      if (!error.statusCode) console.error("[movie-recap]", error);
      res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : publicMessage(error.message || "Something went wrong") });
    }
  };

  app.get("/api/recaps", route(async (_req, res, userId) => {
    const list = [];
    for (const id of (await index(userId)).slice(0, 40)) {
      try { list.push(summary(await load(userId, id))); } catch {}
    }
    res.json({ recaps: list, limits: RECAP_LIMITS });
  }));

  // Streams a film straight to disk (no body buffering) for recaps from a local file.
  app.post("/api/recaps/uploads", route(async (req, res, userId) => {
    const name = clip(decodeURIComponent(String(req.headers["x-file-name"] || "movie.mp4")), 120);
    const ext = (path.extname(name).toLowerCase().match(/^\.(mp4|mov|mkv|webm|m4v|avi)$/) || [])[1];
    if (!ext) throw fail("Upload an MP4, MOV, MKV, WebM, M4V, or AVI file.");
    const declared = Number(req.headers["content-length"] || 0);
    if (declared > MAX_UPLOAD) throw fail("Files up to 1.5 GB can be uploaded. Paste a link for larger films.", 413);
    const id = `rcp_${crypto.randomBytes(12).toString("hex")}`;
    const dir = projectDir(userId, id);
    await fs.mkdir(dir, { recursive: true });
    const file = `source.${ext}`;
    let size = 0;
    await new Promise((resolve, reject) => {
      const out = fsSync.createWriteStream(path.join(dir, file));
      req.on("data", (chunk) => {
        size += chunk.length;
        if (size > MAX_UPLOAD) { req.destroy(); out.destroy(); reject(fail("Files up to 1.5 GB can be uploaded. Paste a link for larger films.", 413)); }
      });
      req.pipe(out);
      out.on("finish", resolve);
      out.on("error", reject);
      req.on("error", reject);
    });
    res.json({ upload: id, name, size });
  }));

  app.post("/api/recaps", route(async (req, res, userId) => {
    if (!openRouterConfigured()) throw fail("Recaps aren't set up on this server yet.", 503);
    const body = req.body || {};
    const formats = ["long", "short"].filter((f) => (Array.isArray(body.formats) ? body.formats : ["long"]).includes(f));
    if (!formats.length) throw fail("Choose a long recap, a Short, or both.");
    const voiceId = clip(body.voiceId, 200);
    if (!voiceId) throw fail("Choose a narration voice.");
    if (deps.voiceAllowed && !(await deps.voiceAllowed(userId, voiceId))) throw fail("That voice isn't available. Pick another voice.", 403);
    let source;
    let id;
    if (body.upload) {
      id = String(body.upload);
      if (!ID.test(id)) throw fail("That upload is no longer available.");
      const file = (await fs.readdir(projectDir(userId, id)).catch(() => [])).find((name) => name.startsWith("source."));
      if (!file) throw fail("That upload is no longer available. Upload it again.");
      source = { kind: "upload", file, name: clip(body.uploadName, 120) || file };
    } else {
      const url = String(body.url || "").trim();
      let parsed;
      try { parsed = new URL(url); } catch {}
      if (!parsed || !["https:", "http:"].includes(parsed.protocol)) throw fail("Paste a full link to the film, starting with https://");
      id = `rcp_${crypto.randomBytes(12).toString("hex")}`;
      source = { kind: "link", url: parsed.href, name: parsed.hostname.replace(/^www\./, "") };
    }
    const active = [];
    for (const other of await index(userId)) {
      try { const p = await load(userId, other); if (p.status === "working") active.push(p); } catch {}
    }
    if (active.length >= 2) throw fail("Two recaps are already in progress. Wait for one to finish.", 429);
    const transforms = body.transforms || {};
    const now = new Date().toISOString();
    const project = {
      id,
      title: clip(body.filmTitle, 80) || clip(body.title, 80) || "Untitled recap",
      status: "queued",
      stage: "analyzing",
      message: "Queued",
      progress: 0,
      error: "",
      source,
      options: {
        formats,
        longMinutes: clamp(body.longMinutes, ...RECAP_LIMITS.longMinutes, 12),
        shortSeconds: clamp(body.shortSeconds, ...RECAP_LIMITS.shortSeconds, 75),
        voiceId,
        tone: TONES[body.tone] ? body.tone : "dramatic",
        pace: PACE[body.pace] ? body.pace : "brisk",
        filmTitle: clip(body.filmTitle, 120),
        channelName: clip(body.channelName, 60),
        music: body.music !== false,
        language: clip(body.language, 40),
        captions: body.captions !== false,
        transforms: { zoom: transforms.zoom !== false, color: transforms.color !== false, mirror: transforms.mirror === true, speed: transforms.speed === true },
      },
      remote: {},
      createdAt: now,
      updatedAt: now,
    };
    if (source.kind === "upload") await persist(userId, id, path.join(projectDir(userId, id), source.file));
    await save(userId, project);
    (await index(userId)).unshift(id);
    await saveIndex(userId);
    start(userId, id);
    res.status(202).json({ recap: summary(project) });
  }));

  app.get("/api/recaps/:id", route(async (req, res, userId) => {
    const project = await load(userId, req.params.id);
    res.json({ recap: { ...summary(project), script: project.script || null } });
  }));

  // Frame thumbnails for the script editor: shot n sits on sheet floor(n/12), tile n%12.
  app.get("/api/recaps/:id/sheets/:name", route(async (req, res, userId) => {
    await load(userId, req.params.id);
    if (!/^s\d{3}\.jpg$/.test(req.params.name)) throw fail("Not found", 404);
    const bytes = await sheetBytes(userId, req.params.id, req.params.name);
    if (!bytes) throw fail("Not found", 404);
    res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
    res.type("image/jpeg").send(bytes);
  }));

  app.patch("/api/recaps/:id/script", route(async (req, res, userId) => {
    const project = await load(userId, req.params.id);
    if (!project.script) throw fail("The script isn't written yet.");
    if (project.status === "working") throw fail("Wait for the current step to finish before editing.", 409);
    const film = project.film?.duration || 0;
    const incoming = req.body?.script || {};
    if (typeof incoming.title === "string") project.script.title = clip(incoming.title, 80) || project.script.title;
    for (const format of project.options.formats) {
      const beats = incoming[format]?.beats;
      if (!Array.isArray(beats)) continue;
      const known = new Map((project.script[format]?.beats || []).map((beat) => [beat.id, beat]));
      project.script[format].beats = beats.slice(0, 200).map((beat, i) => {
        const prior = known.get(String(beat?.id)) || {};
        const from = clamp(beat?.from ?? prior.from, 0, film, 0);
        return { id: String(beat?.id || `n${i}`), text: clip(beat?.text, 600), from: Math.round(from), to: Math.round(clamp(beat?.to ?? prior.to, from + 5, film, from + 60)), shots: Array.isArray(prior.shots) ? prior.shots : [] };
      }).filter((beat) => beat.text);
      if (typeof incoming[format]?.title === "string") project.script[format].title = clip(incoming[format].title, 70);
    }
    await save(userId, project, { title: project.script.title || project.title });
    res.json({ recap: { ...summary(project), script: project.script } });
  }));

  app.post("/api/recaps/:id/render", route(async (req, res, userId) => {
    const project = await load(userId, req.params.id);
    if (!project.script) throw fail("The script isn't written yet.");
    if (project.status === "working") throw fail("This recap is already working.", 409);
    if (typeof req.body?.voiceId === "string" && req.body.voiceId && req.body.voiceId !== project.options.voiceId) {
      if (deps.voiceAllowed && !(await deps.voiceAllowed(userId, req.body.voiceId))) throw fail("That voice isn't available. Pick another voice.", 403);
      project.options.voiceId = clip(req.body.voiceId, 200);
    }
    await save(userId, project, { stage: "voicing", status: "queued", error: "", message: "Queued", progress: 0.75, remote: { ...project.remote, renderStarted: false } });
    start(userId, project.id);
    res.status(202).json({ recap: summary(project) });
  }));

  app.post("/api/recaps/:id/retry", route(async (req, res, userId) => {
    const project = await load(userId, req.params.id);
    if (project.status === "working") throw fail("This recap is already working.", 409);
    await save(userId, project, { status: "queued", error: "", message: "Retrying", remote: project.stage === "analyzing" ? {} : project.remote });
    start(userId, project.id);
    res.status(202).json({ recap: summary(project) });
  }));

  app.post("/api/recaps/:id/cancel", route(async (req, res, userId) => {
    const project = await load(userId, req.params.id);
    running.get(project.id)?.abort(new Error("Stopped"));
    await worker(["stop", "--project", project.id], { timeoutMs: 2 * 60 * 1000 }).catch(() => null);
    await save(userId, project, { status: "cancelled", error: "Stopped", message: "" });
    res.json({ recap: summary(project) });
  }));

  app.delete("/api/recaps/:id", route(async (req, res, userId) => {
    const project = await load(userId, req.params.id);
    running.get(project.id)?.abort(new Error("Deleted"));
    void worker(["cleanup", "--project", project.id], { timeoutMs: 2 * 60 * 1000 }).catch(() => null);
    const list = await index(userId);
    const at = list.indexOf(project.id);
    if (at >= 0) list.splice(at, 1);
    await saveIndex(userId);
    projects.delete(`${userId}:${project.id}`);
    for (const name of ["project.json", "analysis.json", "descriptions.json", "sheets.json", "sheets.pack", ...(project.outputs || []).map((o) => o.file), project.source.file].filter(Boolean))
      await removeFile(storeKey(userId, project.id, name)).catch(() => {});
    await fs.rm(projectDir(userId, project.id), { recursive: true, force: true });
    res.json({ ok: true });
  }));

  app.get("/api/recaps/:id/files/:name", route(async (req, res, userId) => {
    const project = await load(userId, req.params.id);
    const name = String(req.params.name);
    const output = (project.outputs || []).find((o) => o.file === name);
    if (!output || !FILE.test(name)) throw fail("Not found", 404);
    const file = await restore(userId, project.id, name);
    if (!file) throw fail("That video is no longer available. Render it again.", 404);
    if (req.query.download) res.attachment(`${clip(project.title, 60).replace(/[^\w -]+/g, "") || "recap"} - ${output.format === "short" ? "Short" : "Recap"}.mp4`);
    res.sendFile(file, { headers: { "Cache-Control": "private, max-age=3600" } });
  }));
}
