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
import { publicMessage } from "./creatorWorkspace.js";
import { planRecapCuts } from "../src/utils/recapCuts.js";
import { adoptStudioMedia, saveVibeProject } from "./vibeEdit.js";

let deps = {};
const SCRIPT = path.resolve("scripts/movie_recap.py");
const PAUSE = 0.35;
const POLL_MS = 15000;
const MAX_UPLOAD = 1.5 * 1024 * 1024 * 1024;
const FILE = /^[A-Za-z0-9._-]{1,120}$/;
const ID = /^rcp_[a-f0-9]{24}$/;
export const RECAP_LIMITS = { longMinutes: [10, 20], shortSeconds: [60, 90] };

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
    const content = [{ type: "text", text: `These are contact sheets from one film. Every tile is a frame, and the white number in its corner is the shot number. For every numbered tile, describe what is on screen in at most 16 words: who (by look, e.g. "the young woman in the red coat"), what they do, where, and the mood. Do not guess names. Return JSON: {"tiles":[{"n":<shot number>,"d":"<description>"}]} covering every tile.` }];
    for (const name of batch) {
      const bytes = await sheetBytes(userId, project.id, name);
      if (bytes) content.push({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${bytes.toString("base64")}` } });
    }
    const { value } = await requestOpenRouter({ kind: "vision", model, json: true, maxTokens: 6000, temperature: 0.2, reasoningEffort: "low", signal, messages: [{ role: "user", content }], validate: (v) => { if (!Array.isArray(v?.tiles)) throw new Error("No tiles"); } });
    for (const tile of value.tiles) {
      const n = Number(tile?.n);
      if (Number.isInteger(n) && n >= 0) described[n] = clip(tile.d, 160);
    }
    for (const name of batch) described[`sheet:${name}`] = 1;
    finished += 1;
  };
  const queue = [...todo];
  const workers = Array.from({ length: 3 }, async () => {
    while (queue.length) {
      signal.throwIfAborted();
      const batch = queue.shift();
      await describeBatch(batch).catch((error) => {
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

async function stageWrite(userId, project, signal) {
  await report(userId, project, "Writing the recap script", 0.72);
  const analysis = await readJson(userId, project.id, "analysis.json");
  const described = await readJson(userId, project.id, "descriptions.json", {});
  const { formats, longMinutes, shortSeconds, tone, language } = project.options;
  const wantLong = formats.includes("long");
  const wantShort = formats.includes("short");
  const longWords = Math.round(longMinutes * 145);
  const shortWords = Math.round(shortSeconds * 2.4);
  const film = analysis.duration;
  const prompt = `You write narration for faceless movie-recap videos. Below is everything we know about one film, in time order: what is on screen at each sampled SHOT (one every ${analysis.shotEvery} s) and what characters SAY.

FILM LENGTH: ${fmtTime(film)} (${Math.round(film)} seconds)

${timelineText(analysis, described)}

Write ${[wantLong && `a long recap of about ${longWords} words (${longMinutes} minutes spoken)`, wantShort && `a Short of about ${shortWords} words (${shortSeconds} seconds spoken)`].filter(Boolean).join(" and ")}.
Voice: third person, present tense, ${TONES[tone] || TONES.dramatic}. ${language ? `Write in ${language}.` : "Write in the language the characters speak."}
Rules:
- The narration carries the story in your own words. Quote dialogue rarely and never more than six words.
- Ignore opening titles, studio logos, and end credits; narrate the story only.
- Name characters only when the dialogue names them; otherwise describe them ("the detective", "her brother").
- Open with a hook that makes a stranger stay. Tell the whole story in order, including the ending: narrate the climax rather than replaying it.
- Long recap: beats of 2-3 sentences (30-50 words), in story order, together covering the whole film.
- Short: open on the most striking moment, then the setup, then the turn, then end on the outcome; beats of 10-25 words; jumping in time is fine.
- Every beat gives "from" and "to": the stretch of film, in seconds, it narrates. Long-recap stretches move forward through the film and are at least 45 seconds long.
- Every beat lists "shots": up to 6 SHOT numbers that best show what the narration says.
Return JSON only:
{"title":"<recap title, max 80 characters>",${wantLong ? `"long":{"beats":[{"text":"...","from":0,"to":0,"shots":[0]}]},` : ""}${wantShort ? `"short":{"title":"<Short title, max 70 characters>","beats":[{"text":"...","from":0,"to":0,"shots":[0]}]},` : ""}"logline":"<one sentence on what the film is about>"}`;
  const model = process.env.MOVIE_RECAP_SCRIPT_MODEL || "google/gemini-3.8-flash";
  const { value } = await requestOpenRouter({
    kind: "text", model, json: true, maxTokens: 24000, temperature: 0.7, reasoningEffort: "low", signal, timeoutMs: 8 * 60 * 1000,
    messages: [{ role: "user", content: prompt }],
    validate: (v) => {
      if (wantLong && !(v?.long?.beats?.length > 3)) throw new Error("No long beats");
      if (wantShort && !(v?.short?.beats?.length > 1)) throw new Error("No short beats");
    },
  });
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
            spoken = await deps.speak({ voiceId, text: beat.text, signal, direction: TONES[project.options.tone] || "" });
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
  // Keep only this script's clips, then measure them all in one worker call.
  const keep = new Set(jobs.map((job) => job.beat.audio));
  for (const name of await fs.readdir(dir)) if (!keep.has(name)) await fs.rm(path.join(dir, name), { force: true });
  const { lengths } = await worker(["measure", "--out", dir], { timeoutMs: 10 * 60 * 1000, signal });
  for (const { beat } of jobs) beat.seconds = Number(lengths[beat.audio]) || 0;
  if (jobs.some((job) => !(job.beat.seconds > 0))) throw fail("Some narration lines came back empty. Try another voice.", 502);
  await save(userId, project, { stage: "planning" });
}

function captionLines(beats, pauses = PAUSE) {
  const lines = [];
  let at = 0;
  for (const beat of beats) {
    const words = beat.text.split(/\s+/).filter(Boolean);
    const chunks = [];
    for (let i = 0; i < words.length; i += 6) chunks.push(words.slice(i, i + 6).join(" "));
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

export function buildRecapPlan(project, analysis) {
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
        const duration = beat.seconds + PAUSE;
        // Each cut needs 3-4 s plus a skipped gap, so a beat needs about 2.5x its length of film.
        const need = duration * 2.6 + 8;
        let from = beat.from;
        let to = Math.max(beat.to, beat.from + 1);
        if (to - from < need) {
          const grow = (need - (to - from)) / 2;
          from = Math.max(1, from - grow);
          to = Math.min(film - 1, to + grow);
        }
        return { id: beat.id, duration, from, to, anchors: beat.shots.map(shotTime).filter((t) => t !== undefined) };
      }),
    });
    formats[format] = {
      cuts: planned.cuts.map(({ start, end, duration }) => ({ start, end, duration })),
      audioFiles: beats.map((beat) => beat.audio),
      pause: PAUSE,
      captions: captionLines(beats),
    };
    stats[format] = { ...planned.stats, seconds: Math.round(beats.reduce((sum, beat) => sum + beat.seconds + PAUSE, 0)) };
    let at = 0;
    edit[format] = {
      cuts: planned.cuts.map(({ at: position, duration }) => ({ at: position, duration })),
      beats: beats.map((beat) => { const entry = { start: Math.round(at * 1000) / 1000, seconds: beat.seconds }; at += beat.seconds + PAUSE; return entry; }),
      captions: formats[format].captions,
    };
  }
  return { plan: { seed: project.id, transforms: project.options.transforms, captions: project.options.captions !== false, formats }, stats, edit };
}

async function stagePlanAndRender(userId, project, signal) {
  if (!project.remote?.renderStarted) {
    await report(userId, project, "Planning 3-4 second cuts", 0.83);
    const analysis = await readJson(userId, project.id, "analysis.json");
    const { plan, stats, edit } = buildRecapPlan(project, analysis);
    const work = await scratch(userId, project.id, "render");
    const audio = path.join(work, "audio");
    await fs.mkdir(audio, { recursive: true });
    for (const format of Object.keys(plan.formats))
      for (const name of plan.formats[format].audioFiles) await fs.copyFile(path.join(audioDir(userId, project.id), name), path.join(audio, name));
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

// The rendered recap as a Vibe Edit project: every cut a clip over the cut picture, every narration
// line an audio clip, every caption a cue with word timings. Tweak there, then export.
export function recapVibeProject(project, format, picture, voice) {
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
    ],
    clips: edit.cuts.map((cut, i) => ({ id: `cut${i}`, assetId: "recap_picture", track: 0, start: cut.at, in: cut.at, out: Math.round((cut.at + cut.duration) * 1000) / 1000, fit: "fill" })),
    audio: edit.beats.map((beat, i) => ({ id: `line${i}`, assetId: "recap_voice", lane: 1, start: beat.start, in: beat.start, out: Math.round((beat.start + beat.seconds) * 1000) / 1000, volume: 1, name: `Line ${i + 1}` })),
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
  for (const format of Object.keys(media)) {
    const { picture, narration } = media[format];
    if (!picture || !narration) continue;
    const doc = recapVibeProject(project, format, picture, narration);
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
      title: clip(body.title, 80) || "Untitled recap",
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
