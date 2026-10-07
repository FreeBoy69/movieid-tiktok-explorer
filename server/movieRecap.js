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
import { judgeVideo, parseMeasurements } from "./videoQa.js";
import { movieInfo } from "./movieInfo.js";
import { mediaAvailable, signedMediaUrl } from "./vpsMedia.js";
import { rerankWithJev } from "../src/utils/jevDecision.js";
import { MAX_SOURCES, normalizeSource, searchSources } from "./filmSources.js";
import { narrationWpm, RECAP_PACE, RECAP_STEPS, stepAt } from "../src/utils/recapSteps.js";
import { GRAPHIC_TEMPLATES, graphicsBatches, planRecapGraphics } from "./recapGraphics.js";
import { alignBeats, chapterSegments, lineWords, charactersHeard, DEFAULT_BOUNDS, filmCharacters, lookupFilm, onlineSegments, parseReleaseName, storyBounds, titleFits, visualSegments } from "./filmBounds.js";
import { adoptStudioMedia, saveVibeProject } from "./vibeEdit.js";

let deps = {};
const SCRIPT = path.resolve("scripts/movie_recap.py");
// Gap after every narration line once its own silences are trimmed: just enough to breathe.
const PAUSE = 0.12;
const PACE = RECAP_PACE;
const POLL_MS = 15000;
const MAX_UPLOAD = 1.5 * 1024 * 1024 * 1024;
const FILE = /^[A-Za-z0-9._-]{1,120}$/;
const ID = /^rcp_[a-f0-9]{24}$/;
// House standards: full recaps run 10-17 minutes; Shorts 60-90 seconds.
export const RECAP_LIMITS = { longMinutes: [10, 17], shortSeconds: [60, 90] };
// Measured from the channel's own recaps: about 185 words a minute long-form, 200 in Shorts.


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
// Writes to one file run one at a time, each through its own temporary name: parallel steps (the frame
// describers report progress together) once shared "project.json.part", and the second rename failed
// with ENOENT, failing the recap.
const writeQueues = new Map();
export async function writeJson(userId, id, name, value, { store = true } = {}) {
  const dir = projectDir(userId, id);
  const file = path.join(dir, name);
  const text = JSON.stringify(value);
  const previous = writeQueues.get(file) || Promise.resolve();
  const next = previous.catch(() => {}).then(async () => {
    await fs.mkdir(dir, { recursive: true });
    const part = `${file}.${crypto.randomBytes(4).toString("hex")}.part`;
    await fs.writeFile(part, text);
    await fs.rename(part, file);
    if (store) await persist(userId, id, file);
  });
  writeQueues.set(file, next);
  try {
    await next;
  } finally {
    if (writeQueues.get(file) === next) writeQueues.delete(file);
  }
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
/**
 * The recap's clock, for the progress screen: working time (pauses like script review or a failure don't
 * count), when each step started and ended (by progress, see src/utils/recapSteps.js), and the last
 * forty status messages with their times.
 */
export function tickClock(project, patch, now = Date.now()) {
  const clock = (project.clock ||= { workMs: 0, since: null, steps: {}, log: [] });
  const working = project.status === "working";
  if (working && clock.since == null) clock.since = now;
  if (!working && clock.since != null) {
    clock.workMs += now - clock.since;
    clock.since = null;
  }
  if (working) {
    const step = stepAt(project.progress);
    const entry = clock.steps[step.id];
    // A step run again (a retry, a re-render) starts its clock over.
    if (!entry || entry.end) clock.steps[step.id] = { start: now };
    for (const other of RECAP_STEPS) {
      const e = clock.steps[other.id];
      if (other.from < step.from && e && !e.end) e.end = now;
      // Later steps of an earlier run are cleared when the recap goes back (re-render from review).
      if (other.from > step.from && e && e.start < (clock.steps[step.id]?.start ?? now)) delete clock.steps[other.id];
    }
  }
  const message = typeof patch.message === "string" ? patch.message.trim() : "";
  if (message && message !== clock.log.at(-1)?.m) clock.log = [...clock.log, { t: now, m: message.slice(0, 160) }].slice(-40);
  return clock;
}

async function save(userId, project, patch = {}) {
  Object.assign(project, patch, { updatedAt: new Date().toISOString() });
  tickClock(project, patch);
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

const RESUMES = 2;
/** How long a working recap may go without an update before Try again restarts it. */
export const STUCK_MS = 10 * 60 * 1000;
async function waitForWorker(userId, project, phase, { from, to, out, signal, resume = null }) {
  let missing = 0;
  let resumed = 0;
  for (;;) {
    await sleep(POLL_MS, signal);
    const status = await worker(["status", "--project", project.id, ...(out ? ["--out", out] : [])], { timeoutMs: 5 * 60 * 1000, signal }).catch((error) => ({ state: "unreachable", error: error.message }));
    if (status.state === "done") return status;
    if (status.state === "failed") throw fail(status.error || "The media worker failed.", 502);
    if (["missing", "stalled"].includes(status.state)) {
      // The worker's process died: start it again, keeping what it finished, before giving up.
      if (resume && status.state === "stalled" && resumed < RESUMES) {
        resumed++;
        missing = 0;
        console.warn(`[movie-recap] ${project.id} ${phase} stalled, resuming (${resumed}/${RESUMES})`);
        await report(userId, project, "The media worker stopped. Picking up where it left off", project.progress);
        await resume().catch((error) => { if (signal?.aborted) throw error; console.warn(`[movie-recap] resume failed: ${error.message}`); });
        continue;
      }
      if (++missing > 2) throw fail(phase === "analyze" ? "The media worker stopped analysing this film. Press Try again to pick up where it left off." : "The media worker stopped rendering. Press Try again to pick up where it left off.", 502);
      continue;
    }
    if (status.state === "unreachable") continue;
    missing = 0;
    await report(userId, project, status.message || project.message, from + (to - from) * Number(status.progress || 0));
  }
}

async function stageAnalyze(userId, project, signal) {
  if (!project.remote?.analyzeStarted) {
    await report(userId, project, "Sending the film to the media worker", 0.01);
    await worker(await analyzeArgs(userId, project), { timeoutMs: 60 * 60 * 1000, signal });
    await save(userId, project, { remote: { ...project.remote, analyzeStarted: true } });
  }
  const out = await scratch(userId, project.id, "analysis");
  // A worker run that dies (a crash, a reboot) is resumed: the film and finished transcript chunks are kept.
  const resume = async () => worker(await analyzeArgs(userId, project), { timeoutMs: 60 * 60 * 1000, signal });
  await waitForWorker(userId, project, "analyze", { from: 0.02, to: 0.45, out, signal, resume });
  const analysis = JSON.parse(await fs.readFile(path.join(out, "analysis.json"), "utf8"));
  // Where the story runs, so no cut lands on an opening title or the end credits.
  const known = await findStoryBounds(project, analysis, signal);
  analysis.bounds = known.bounds;
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
    film: { duration: analysis.duration, shots: analysis.shots.length, scenes: analysis.scenes.length, lines: analysis.transcript.length, shotEvery: analysis.shotEvery, sheet: analysis.sheet, ...(analysis.height ? { height: analysis.height } : {}), bounds: analysis.bounds, ...(known.film ? { title: known.film.title, year: known.film.year, tmdbId: known.film.tmdbId, imdbId: known.film.imdbId, from: known.film.from, checked: FILM_CHECK } : { from: "none", checked: FILM_CHECK }) },
    ...(known.film?.poster ? { poster: known.film.poster } : {}),
    // A film found on TMDB names itself in the script ("This is the 2026 movie ...") when the user didn't.
    ...(known.film && !project.options.filmTitle ? { options: { ...project.options, filmTitle: known.film.year ? `${known.film.title} (${known.film.year})` : known.film.title, filmTitleAuto: true } } : {}),
  });
}

/** Where each cut of a format sits in the film: from the edit, else from the render plan on the worker. */
async function cutFilmTimes(project, format) {
  const cuts = project.edit?.[format]?.cuts || [];
  if (cuts.length && cuts.every((c) => Number.isFinite(c.start))) return cuts.map((c) => ({ start: c.start, end: c.start + c.duration }));
  const info = await worker(["plan-info", "--project", project.id, "--options", JSON.stringify({ format })], { timeoutMs: 2 * 60 * 1000 });
  return info.cuts || [];
}

/** Jev's 0-100 scale as a class an editor can read. */
export const matchClass = (score) => (!Number.isFinite(score) ? "unscored" : score >= 87.5 ? "excellent" : score >= 62.5 ? "strong" : score >= 37.5 ? "plausible" : score >= 12.5 ? "weak" : "poor");

/**
 * The best shots for one cut's narration, ranked: the AI's top picks from nearby footage (in film order
 * for a long recap) plus the frames whose descriptions share the words, scored by Jev against what is
 * said over the cut (and an editor's note) and classed excellent to poor. Ties keep the AI's order.
 */
export async function rankShotsForCut(userId, project, format, index, note = "", { request = requestOpenRouter, jev = rerankWithJev } = {}) {
  const analysis = await readJson(userId, project.id, "analysis.json");
  const described = await readJson(userId, project.id, "descriptions.json", {});
  if (!analysis) throw fail("This recap's analysis is no longer available.", 410);
  const edit = project.edit[format];
  const cut = edit.cuts[index];
  const times = await cutFilmTimes(project, format);
  const here = times[index] || { start: 0, end: 0 };
  const beat = (project.script?.[format]?.beats || []).find((b) => b.id === cut.beatId) || { text: "", from: here.start, to: here.end };
  const said = (edit.captions || []).filter((line) => line.end > cut.at && line.start < cut.at + cut.duration).map((line) => line.text).join(" ");
  // Where to look: around this shot, between its neighbours in a long recap (which runs in film order).
  const { start: storyStart, end: storyEnd } = storyRange(analysis);
  const long = format === "long";
  const lo = long ? Math.max(storyStart, (times[index - 1]?.end ?? here.start - 60) - 5) : Math.max(storyStart, Math.min(beat.from, here.start) - 60);
  const hi = long ? Math.min(storyEnd, (times[index + 1]?.start ?? here.end + 60) + 5) : Math.min(storyEnd, Math.max(beat.to, here.end) + 60);
  const span = hi - lo < 40 ? { lo: Math.max(storyStart, (lo + hi) / 2 - 20), hi: Math.min(storyEnd, (lo + hi) / 2 + 20) } : { lo, hi };
  const used = times.filter((_, k) => k !== index);
  const free = (t) => !used.some((u) => t > u.start - 2 && t < u.end + 2) && Math.abs(t - (here.start + here.end) / 2) > 3;
  let candidates = analysis.shots.filter((shot) => shot.t >= span.lo && shot.t <= span.hi && free(shot.t) && usableFrame(described, shot.i, format, true));
  if (candidates.length < 4) candidates = analysis.shots.filter((shot) => shot.t >= span.lo && shot.t <= span.hi && free(shot.t) && usableFrame(described, shot.i, format));
  for (const shot of framesMatchingWords(`${said} ${note}`, analysis, described, 10, { from: span.lo, to: span.hi })) if (!candidates.includes(shot) && free(shot.t)) candidates.push(shot);
  if (candidates.length > 48) candidates = candidates.filter((_, k) => k % Math.ceil(candidates.length / 48) === 0);
  if (!candidates.length) throw fail("There's no unused footage near this point of the film to choose from.", 422);
  candidates.sort((a, b) => a.t - b.t);
  const current = analysis.shots.reduce((best, shot) => (Math.abs(shot.t - (here.start + here.end) / 2) < Math.abs(best.t - (here.start + here.end) / 2) ? shot : best), analysis.shots[0]);
  const model = process.env.MOVIE_RECAP_SCRIPT_MODEL || "google/gemini-3.8-flash";
  let picks = [];
  try {
    const { value } = await request({
      kind: "text", model, json: true, maxTokens: 900, temperature: 0.2, reasoningEffort: "low",
      messages: [{ role: "user", content: `You are choosing footage for one shot in a movie recap. The narrator says: "${said || beat.text}"
The whole line: "${beat.text}"
The current shot shows: ${described[current?.i] || "(unknown)"}.${note ? ` An editor asks for: "${note}".` : ""}
Pick the three FRAMES below that best show what is being said${note ? " and what the editor asks for" : ""}, best first: the same character, action, object, or place. Prefer [close] and [medium] frames of someone acting.
FRAMES (in film order):
${candidates.map((shot) => `#${shot.i} @${fmtTime(shot.t)}${frameTag(described, shot.i)}: ${described[shot.i] || ""}`).join("\n")}
Return JSON only: {"frames": [{"frame": <frame number>, "why": "<under 15 words>"}]}` }],
      validate: (v) => { if (!Array.isArray(listOf(v, "frames"))) throw new Error("No frames"); },
    });
    picks = listOf(value, "frames").map((f) => ({ shot: candidates.find((shot) => shot.i === Number(f?.frame)), why: clip(f?.why, 120) })).filter((f) => f.shot).slice(0, 3);
  } catch (error) {
    console.warn(`[movie-recap] shot picks skipped: ${error.message}`);
  }
  const shortlist = picks.map((p) => p.shot);
  for (const shot of framesMatchingWords(`${said} ${note} ${beat.text}`, { ...analysis, shots: candidates }, described, 10)) if (shortlist.length < 10 && !shortlist.includes(shot)) shortlist.push(shot);
  for (let i = 0; shortlist.length < 6 && i < candidates.length; i += Math.max(1, Math.floor(candidates.length / 6))) if (!shortlist.includes(candidates[i])) shortlist.push(candidates[i]);
  const ranked = shortlist.length > 1
    ? await jev(shortlist, {
        rubric: `${JEV_RUBRIC}${note ? " An editor also asked for this shot to show: " + note : ""}`,
        context: { saidDuringCut: said || beat.text, wholeLine: beat.text, editorNote: note },
        describe: (shot) => ({ filmTime: fmtTime(shot.t), shows: described[shot.i] || "", shot: frameTag(described, shot.i).trim() }),
        minimumConfidence: 0,
      }).catch(() => shortlist)
    : shortlist;
  const aiRank = (shot) => { const k = picks.findIndex((p) => p.shot.i === shot.i); return k < 0 ? 99 : k; };
  const score = (shot) => (Number.isFinite(Number(shot.jevScore)) ? Number(shot.jevScore) : NaN);
  const sheet = analysis.sheet || { cols: 4, rows: 3 };
  const per = (sheet.cols || 4) * (sheet.rows || 3);
  const shots = [...ranked]
    .sort((a, b) => (Number.isFinite(score(b)) ? score(b) : -1) - (Number.isFinite(score(a)) ? score(a) : -1) || aiRank(a) - aiRank(b))
    .map((shot) => ({
      n: shot.i,
      t: shot.t,
      filmTime: fmtTime(shot.t),
      description: described[shot.i] || "",
      tags: frameTag(described, shot.i).replace(/[[\]]/g, "").trim(),
      score: Number.isFinite(score(shot)) ? score(shot) : null,
      match: matchClass(score(shot)),
      aiPick: aiRank(shot) < 99,
      why: picks.find((p) => p.shot.i === shot.i)?.why || "",
      // Where its picture is in the contact sheets (4x3 tiles), for a thumbnail.
      sheet: `s${String(Math.floor(shot.i / per)).padStart(3, "0")}.jpg`,
      col: (shot.i % per) % (sheet.cols || 4),
      row: Math.floor((shot.i % per) / (sheet.cols || 4)),
    }));
  return { said: said || beat.text, line: beat.text, current: { t: current?.t, description: described[current?.i] || "" }, shots };
}

/** Cuts the shot at film time `t` for one cut (same look as the recap) and records it. Returns the asset. */
export async function cutShotAt(userId, project, format, index, t) {
  const analysis = await readJson(userId, project.id, "analysis.json");
  const cut = project.edit[format].cuts[index];
  const { start: storyStart } = storyRange(analysis);
  const length = cut.duration;
  const start = Math.max(storyStart, Math.min(analysis.duration - length - 1, Number(t) - length / 2));
  const name = `recut-${crypto.randomBytes(5).toString("hex")}`;
  const published = await worker(["recut", "--project", project.id, "--name", name, "--options", JSON.stringify({ format, index, start, duration: length, name })], { timeoutMs: 10 * 60 * 1000 });
  // Remember where this cut now sits, so the next fix doesn't offer the same footage again.
  project.edit[format].cuts[index].start = start;
  await save(userId, project, { edit: project.edit });
  return { kind: "video", name: `Shot ${index + 1} (replaced)`, url: `/api/recaps/${project.id}/media/${name}.mp4`, remote: published.path, duration: length, width: format === "short" ? 1080 : 1920, height: format === "short" ? 1920 : 1080, origin: "generated" };
}

/** The top-ranked shot for one cut, cut and ready for Vibe Edit. */
export async function findBetterShot(userId, project, format, index, note, options = {}) {
  const { shots } = await rankShotsForCut(userId, project, format, index, note, options);
  const best = shots[0];
  if (!best) throw fail("There's no better footage near this point of the film.", 422);
  return { asset: await cutShotAt(userId, project, format, index, best.t), frame: { t: best.t, description: best.description, why: best.why, match: best.match, score: best.score } };
}

/** Up to 16 of the film's backdrops (w1280, no text) and its poster, from TMDB. [] when it has none. */
async function recapBackdrops(project, tmdbId, { fetch: get = globalThis.fetch, env = process.env } = {}) {
  const key = String(env.TMDB_API_KEY || "").replace(/^["']|["']$/g, "").trim();
  if (!tmdbId || !key) return [];
  const response = await get(`https://api.themoviedb.org/3/movie/${tmdbId}/images?include_image_language=null,en&api_key=${encodeURIComponent(key)}`, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`TMDB ${response.status}`);
  const data = await response.json();
  const backdrops = (data.backdrops || []).filter((b) => !b.iso_639_1).sort((a, b) => (b.vote_count || 0) - (a.vote_count || 0) || (b.width || 0) - (a.width || 0));
  // The official poster: English first, then the best voted.
  const posters = [...(data.posters || [])].sort((a, b) => Number(b.iso_639_1 === "en") - Number(a.iso_639_1 === "en") || (b.vote_count || 0) - (a.vote_count || 0));
  return {
    images: backdrops.slice(0, 16).map((b) => `https://image.tmdb.org/t/p/w1280${b.file_path}`),
    poster: posters[0] ? `https://image.tmdb.org/t/p/w342${posters[0].file_path}` : null,
  };
}

const backfilling = new Set();
function backfillPoster(userId, project) {
  if (backfilling.has(project.id)) return;
  backfilling.add(project.id);
  void filmStills(userId, project)
    .then(() => (project.poster === undefined ? save(userId, project, { poster: null }) : null))
    .catch(() => {})
    .finally(() => backfilling.delete(project.id));
}

/** The film's stills and poster for the screens, fetched once per film and kept on the recap. */
async function filmStills(userId, project) {
  const tmdbId = await recapTmdbId(userId, project).catch((error) => {
    console.warn(`[movie-recap] film lookup skipped: ${error.message}`);
    return null;
  });
  if (tmdbId && (project.backdrops?.tmdbId !== tmdbId || project.poster === undefined)) {
    const found = await recapBackdrops(project, tmdbId).catch((error) => {
      console.warn(`[movie-recap] backdrops skipped: ${error.message}`);
      return null;
    });
    if (found) await save(userId, project, { backdrops: { tmdbId, images: found.images }, poster: found.poster || project.poster || null });
  }
  return { tmdbId, images: tmdbId && project.backdrops?.tmdbId === tmdbId ? project.backdrops.images : [] };
}

/** The film's TMDB id: the one the analysis found (and checked), else found now from its names. Before the
 *  analysis, only a title the user typed counts; a link alone says too little to look up. */
const FILM_CHECK = 3;
async function recapTmdbId(userId, project, signal) {
  // Found (or not) by this check already; recaps checked by an older one (TMDB's first hit for any name,
  // then no dialogue check) are looked up again.
  if (project.film?.from && project.film.checked === FILM_CHECK) return project.film.tmdbId || null;
  const analysis = project.film ? await readJson(userId, project.id, "analysis.json") : null;
  if (!analysis) {
    const typed = parseReleaseName(project.options.filmTitle);
    return typed ? (await lookupFilm(typed, { signal }))?.tmdbId || null : null;
  }
  const { film, from, rejected = [] } = await resolveFilm(project, analysis, signal);
  // A saved film title that turned out to be another film (its characters never come up) goes, so no
  // title card or script names it.
  const wrongTitle = parseReleaseName(project.options.filmTitle);
  const clearTitle = wrongTitle && rejected.includes(wrongTitle.title.toLowerCase());
  if (!film) await save(userId, project, { film: { ...project.film, title: undefined, year: undefined, tmdbId: null, imdbId: null, from: "none", checked: FILM_CHECK }, ...(clearTitle ? { options: { ...project.options, filmTitle: "", filmTitleAuto: true } } : {}) });
  else {
    // The film title the script and graphics use follows the checked film, unless the user typed one
    // that names it.
    const typed = parseReleaseName(project.options.filmTitle);
    const keepTyped = typed && !project.options.filmTitleAuto && titleFits(typed.title, film.title);
    await save(userId, project, {
      film: { ...project.film, title: film.title, year: film.year, tmdbId: film.tmdbId, imdbId: film.imdbId, from, checked: FILM_CHECK },
      ...(film.poster ? { poster: film.poster } : {}),
      ...(keepTyped ? {} : { options: { ...project.options, filmTitle: film.year ? `${film.title} (${film.year})` : film.title, filmTitleAuto: true } }),
      // Stills of another film go.
      ...(project.backdrops?.tmdbId && project.backdrops.tmdbId !== film.tmdbId ? { backdrops: null } : {}),
    });
  }
  return film?.tmdbId || null;
}

/** The film's TMDB info, or null when TMDB has no match. */
async function recapMovie(userId, project, signal) {
  const tmdbId = await recapTmdbId(userId, project, signal);
  return tmdbId ? movieInfo(tmdbId, { signal }) : null;
}

const GRAPHIC_FONTS = ["Montserrat.ttf", "Inter.ttf", "Anton.ttf"];
const GSAP_FILE = () => ["node_modules/gsap/dist/gsap.min.js"].map((file) => path.resolve(file)).find((file) => fsSync.existsSync(file));

/** Writes the long recap's motion graphics (HyperFrames templates, their batch rows, poster, fonts, GSAP)
 *  into `dir` for the media worker, and returns what the plan needs. Null when there is nothing to show. */
/**
 * Name cards only over a character who is on screen. A card went up at the first mention of a name, so
 * Fall 2 showed "SHILOH HUNTER" over a parked car (she is dead; the narration only mentions her) and "JAX
 * HUNTER" over a scrapbook. For each card, the clips from the mention to 12 s after it are shown to the
 * vision model with the actor's TMDB headshot; the card moves to the first clip that shows them, or goes.
 */
export async function placeNameCards(events, edit, characters, look, { signal = undefined, request = requestOpenRouter, fetchPhoto = (url) => fetch(url, { signal: AbortSignal.timeout(15000) }).then((r) => (r.ok ? r.arrayBuffer().then((b) => Buffer.from(b)) : null)) } = {}) {
  const names = events.filter((event) => event.type === "name");
  if (!names.length) return events;
  const model = process.env.MOVIE_RECAP_VISION_MODEL || "google/gemini-3.8-flash";
  const kept = events.filter((event) => event.type !== "name");
  for (const event of names) {
    signal?.throwIfAborted();
    const character = characters.find((c) => c.name === event.vars.name);
    const photo = character?.photo ? await fetchPhoto(character.photo).catch(() => null) : null;
    const length = event.end - event.start;
    const clips = edit.cuts.filter((cut) => cut.at + cut.duration > event.start - 0.5 && cut.at < event.start + 12).slice(0, 6);
    if (!photo || !clips.length) continue;
    const { frames } = await look(clips.map((cut) => cut.start + cut.duration / 2));
    const content = [{ type: "text", text: `Reference: a photo of the actor who plays ${event.vars.name}.` }, { type: "image_url", image_url: { url: `data:image/jpeg;base64,${photo.toString("base64")}` } }, { type: "text", text: `These are frames from the film. Which of them clearly show ${event.vars.name} (this actor, as they look in the film), facing the camera enough to recognise? Return JSON {"frames":[<numbers of the frames that show them>]}.` }];
    frames.forEach((frame, n) => frame && content.push({ type: "text", text: `Frame ${n}:` }, { type: "image_url", image_url: { url: `data:image/jpeg;base64,${frame.toString("base64")}` } }));
    const shown = await request({ kind: "vision", model, json: true, maxTokens: 300, temperature: 0, reasoningEffort: "low", signal, messages: [{ role: "user", content }], validate: (v) => { if (!Array.isArray(listOf(v, "frames"))) throw new Error("No frames"); } })
      .then(({ value }) => listOf(value, "frames").map(Number).filter(Number.isInteger))
      .catch((error) => { if (signal?.aborted) throw error; return []; });
    const first = clips.find((_, n) => shown.includes(n));
    if (!first) continue;
    const start = Math.round(Math.max(first.at + 0.2, event.start - 0.5) * 100) / 100;
    if (kept.some((other) => start < other.end + 0.4 && start + length > other.start - 0.4)) continue;
    kept.push({ ...event, start, end: Math.round((start + length) * 100) / 100 });
  }
  return kept.sort((a, b) => a.start - b.start);
}

export async function prepareGraphics(userId, project, edit, dir, signal) {
  const gsap = GSAP_FILE();
  if (!gsap || !edit?.captions?.length) return null;
  const movie = await recapMovie(userId, project, signal).catch((error) => {
    console.warn(`[movie-recap] TMDB lookup skipped: ${error.message}`);
    return null;
  });
  const last = edit.beats.at(-1);
  const duration = last ? last.start + last.seconds : 0;
  const plan = planRecapGraphics({ captions: edit.captions, duration, movie, filmTitle: project.options.filmTitle || "", channelName: project.options.channelName });
  if (plan.events.some((event) => event.type === "name")) {
    plan.events = await placeNameCards(plan.events, edit, movie?.characters || [], (times) => lookAt(userId, project, times, signal), { signal }).catch((error) => {
      if (signal?.aborted) throw error;
      console.warn(`[movie-recap] name-card check skipped: ${error.message}`);
      // Unchecked, a card could name someone who isn't there: leave them out.
      return plan.events.filter((event) => event.type !== "name");
    });
  }
  if (!plan.events.length && !plan.watermark) return null;
  await fs.mkdir(path.join(dir, "fonts"), { recursive: true });
  await fs.copyFile(gsap, path.join(dir, "gsap.min.js"));
  for (const font of GRAPHIC_FONTS) {
    const file = ["dist/fonts/captions", "public/fonts/captions"].map((d) => path.resolve(d, font)).find((f) => fsSync.existsSync(f));
    if (file) await fs.copyFile(file, path.join(dir, "fonts", font));
  }
  if (movie?.poster && plan.events.some((e) => e.type === "title")) {
    const response = await fetch(movie.poster, { signal: AbortSignal.timeout(20000) }).catch(() => null);
    if (response?.ok) await fs.writeFile(path.join(dir, "poster.jpg"), Buffer.from(await response.arrayBuffer()));
    else for (const e of plan.events) if (e.type === "title") e.vars.poster = "";
  }
  const batches = graphicsBatches(plan);
  for (const batch of batches) {
    await fs.writeFile(path.join(dir, `${batch.type}.html`), GRAPHIC_TEMPLATES[batch.type]);
    await fs.writeFile(path.join(dir, `${batch.type}.json`), JSON.stringify(batch.rows));
  }
  return {
    batches: batches.map(({ type, events }) => ({ type, events })),
    watermark: plan.watermark,
    summary: { events: plan.events.map(({ type, start, vars }) => ({ type, start, label: vars.name || vars.title || vars.channel || "" })), movie: movie ? { title: movie.title, year: movie.year, poster: movie.poster, rating: movie.rating } : null },
  };
}

async function analyzeArgs(userId, project) {
  const args = ["start-analyze", "--project", project.id, "--options", JSON.stringify({ language: project.options.language || "", name: clip(project.source.name, 200) })];
  if (project.source.kind === "link") args.push("--url", project.source.url);
  else args.push("--file", await restore(userId, project.id, project.source.file));
  return args;
}

/** Names the film might go by, most trusted first: what the user typed, the downloaded file's name, the
 *  file's title tag, the uploaded file's name, then the link (host names and share ids never count). */
export function filmNames(project, analysis = null) {
  // The script names the film in its opening ("This is the 2026 movie Fall 2."): the writer often knows it
  // from the dialogue even when nothing else does.
  const opening = (project.script?.long?.beats || project.script?.short?.beats || []).slice(0, 3).map((beat) => beat.text).join(" ");
  const said = opening.match(/\bthis is the (?:(\d{4}) )?(?:movie|film) ([^.!?]{2,80})/i);
  const raw = [project.options.filmTitle, analysis?.screenTitle, said ? `${said[2].trim()}${said[1] ? ` ${said[1]}` : ""}` : "", analysis?.fileName, analysis?.titleTag, project.source.kind === "upload" ? project.source.name : "", project.source.kind === "link" ? project.source.url : ""];
  const seen = new Set();
  return raw.map((name) => parseReleaseName(name)).filter((named) => named && !seen.has(named.title.toLowerCase()) && seen.add(named.title.toLowerCase()));
}

/** Which film this is, on TMDB: by its names (checked against the file's length), else by asking a model
 *  to recognise it from its dialogue. {film, from} or {film: null}. Never fails the recap. */
async function resolveFilm(project, analysis, signal) {
  const duration = analysis?.duration || 0;
  // A match must also be this film: its characters' names come up in the dialogue (a "Mega Cyclone"
  // never passes for Fall 2, whatever name led to it).
  const heard = async (film) => {
    if (!analysis?.transcript?.length) return true;
    const names = await filmCharacters(film.tmdbId, { signal }).catch(() => []);
    return charactersHeard(names, analysis.transcript);
  };
  const rejected = [];
  try {
    for (const named of filmNames(project, analysis)) {
      const film = await lookupFilm(named, { signal, duration });
      if (film && (await heard(film))) return { film, from: "name" };
      if (film) rejected.push(named.title.toLowerCase());
    }
    const guess = analysis?.transcript?.length ? await recogniseFilm(analysis, signal) : null;
    const film = guess ? await lookupFilm(guess, { signal, duration }) : null;
    if (film && (await heard(film))) return { film, from: "dialogue" };
    if (film) rejected.push(guess.title.toLowerCase());
  } catch (error) {
    if (signal?.aborted) throw error;
    console.warn(`[movie-recap] film lookup skipped: ${error.message}`);
  }
  return { film: null, rejected };
}

/** The film's title and year as a model recognises it from the dialogue (character names, plot), or null. */
async function recogniseFilm(analysis, signal) {
  if (!openRouterConfigured()) return null;
  const lines = analysis.transcript.filter((line) => line.text).map((line) => line.text);
  // Lines from across the film: the names and the plot both help.
  const step = Math.max(1, Math.floor(lines.length / 220));
  const sample = lines.filter((_, i) => i % step === 0).slice(0, 220).join("\n").slice(0, 14000);
  const { value } = await requestOpenRouter({
    kind: "text", model: process.env.MOVIE_RECAP_VISION_MODEL || "google/gemini-3.8-flash", json: true, maxTokens: 300, temperature: 0, reasoningEffort: "low", signal,
    messages: [{ role: "user", content: `Here is dialogue sampled from a ${Math.round(analysis.duration / 60)}-minute film, transcribed automatically (names may be misspelled). Which film is it? Use the character names and the plot. Return JSON {"title":"<the film's title>","year":<release year or null>,"confident":true|false}. Set confident to false unless you recognise this specific film, not just its genre.\n\n${sample}` }],
    validate: (v) => { if (typeof v?.title !== "string") throw new Error("No title"); },
  });
  if (value.confident !== true) return null;
  return parseReleaseName(value.year ? `${value.title} ${value.year}` : value.title);
}

/** The story's span (after the opening titles, before the credits) from the online segment databases and
 *  the film's chapters; the vision pass fills in what they leave open. Never fails the recap. */
async function findStoryBounds(project, analysis, signal) {
  const duration = analysis.duration;
  const { film, from } = await resolveFilm(project, analysis, signal);
  let online = null;
  try {
    online = film ? await onlineSegments(film, duration, { signal }) : null;
  } catch (error) {
    if (signal?.aborted) throw error;
    console.warn(`[movie-recap] segment lookup skipped: ${error.message}`);
  }
  const bounds = storyBounds(duration, { online, chapters: chapterSegments(analysis.chapters || [], duration) });
  return { bounds, film: film ? { ...film, from } : null };
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

/** A model's JSON list, whether it came wrapped ({"tiles":[...]}) or bare ([...]), as Gemini sometimes sends it. */
const listOf = (value, key) => (Array.isArray(value) ? value : value?.[key]);

/** The film's main characters from TMDB (name, actor, photo), kept on the recap for its film. The
 *  transcript mishears names and the frames show faces, so the describer and the writer both get them. */
async function recapCast(userId, project, signal) {
  const tmdbId = project.film?.tmdbId;
  if (!tmdbId) return [];
  if (project.cast?.tmdbId === tmdbId) return project.cast.characters;
  const info = await movieInfo(tmdbId, { signal }).catch(() => null);
  const characters = (info?.characters || []).slice(0, 10).map(({ name, alias, actor, photo }) => ({ name, alias, actor, photo }));
  await save(userId, project, { cast: { tmdbId, characters } });
  return characters;
}

/** The script with its characters' names set to the cast list (and nothing else changed). Lines whose
 *  text changes get recorded again on the next render. Returns { script, changed: number of lines }. */
export async function correctNames(script, cast, formats, { request = requestOpenRouter, signal = undefined } = {}) {
  const lines = [];
  for (const format of formats) for (const beat of script[format]?.beats || []) lines.push({ id: `${format}:${beat.id}`, text: beat.text });
  if (!lines.length) return { script, changed: 0 };
  const model = process.env.MOVIE_RECAP_SCRIPT_MODEL || "google/gemini-3.8-flash";
  const { value } = await request({
    kind: "text", model, json: true, maxTokens: 16000, temperature: 0, reasoningEffort: "low", signal,
    messages: [{ role: "user", content: `A movie recap script was written from an automatic transcript, which mishears names: a character may be called by a wrong or misspelled name, or two characters may be mixed up. Here is the film's cast list:\n${cast.map((c) => `- ${c.name}${c.alias ? ` (also ${c.alias})` : ""}${c.actor ? `, played by ${c.actor}` : ""}`).join("\n")}\n\nCorrect the character names in these lines to the cast list, using the story to tell who is who. Use the name people call each character by (usually the first name: "Jon", not "Jon Platt"); a full name at most once, where they are introduced. A name the story itself reveals (a false identity, a nickname, a twist) can stay even if the cast list doesn't show it. Change nothing but names: same sentences, same order. Leave a line as it is when its names are right or it names no one. Return JSON {"lines":[{"id":"<id>","text":"<the line>"}]} with every line.\n\n${JSON.stringify(lines)}` }],
    validate: (v) => { if (!Array.isArray(listOf(v, "lines"))) throw new Error("No lines"); },
  });
  const fixed = new Map(listOf(value, "lines").filter((line) => typeof line?.text === "string" && line.text.trim()).map((line) => [String(line.id), clip(line.text, 600)]));
  let changed = 0;
  const out = { ...script };
  for (const format of formats) {
    if (!script[format]?.beats) continue;
    out[format] = { ...script[format], beats: script[format].beats.map((beat) => {
      const text = fixed.get(`${format}:${beat.id}`);
      // A rewrite that does more than swap names (much longer or shorter) is not taken.
      if (!text || text === beat.text || Math.abs(text.length - beat.text.length) > beat.text.length * 0.25) return beat;
      changed++;
      return { ...beat, text };
    }) };
  }
  return { script: out, changed };
}

/** Headshots of the first few characters with photos, as vision content to put before the frames. */
export async function castReference(characters, signal) {
  const content = [];
  for (const character of characters.filter((c) => c.photo).slice(0, 8)) {
    try {
      const response = await fetch(character.photo, { signal: signal || AbortSignal.timeout(15000) });
      if (!response.ok) continue;
      const bytes = Buffer.from(await response.arrayBuffer());
      content.push({ type: "text", text: `${character.name}${character.actor ? ` (played by ${character.actor})` : ""}:` }, { type: "image_url", image_url: { url: `data:image/jpeg;base64,${bytes.toString("base64")}` } });
    } catch (error) {
      if (signal?.aborted) throw error;
    }
  }
  return content.length ? [{ type: "text", text: "The film's main characters, each with a photo of the actor who plays them:" }, ...content] : [];
}

async function stageDescribe(userId, project, signal) {
  const offsets = await readJson(userId, project.id, "sheets.json", {});
  // Faces to put names to: the cast's headshots go with every batch of frames.
  const cast = await recapCast(userId, project, signal).catch(() => []);
  const castContent = await castReference(cast, signal).catch(() => []);
  const names = Object.keys(offsets).sort();
  const described = await readJson(userId, project.id, "descriptions.json", {});
  const perCall = 3;
  const batches = [];
  for (let i = 0; i < names.length; i += perCall) batches.push(names.slice(i, i + perCall));
  const todo = batches.filter((batch) => !batch.every((name) => described[`sheet:${name}`]));
  let finished = batches.length - todo.length;
  const model = process.env.MOVIE_RECAP_VISION_MODEL || "google/gemini-3.8-flash";
  const describeBatch = async (batch) => {
    const content = [{ type: "text", text: `These are contact sheets from one film. Every tile is a frame, and the white number in its corner is the shot number. For every numbered tile, describe what is on screen in at most 16 words: who, what they do, where, and the mood. ${castContent.length ? "Name a person only when their face clearly matches one of the main characters pictured after these instructions (\"Jax, in a teal jacket, ...\"); anyone else, or anyone you aren't sure of, by look (\"a bearded man in a cap\")." : "Describe people by look (\"the young woman in the red coat\"); do not guess names."} Also tag the shot: "s" is "close" (the subject fills over half the frame), "medium" (a whole person or object, 20-50% of the frame), "wide" (subjects small or far away), or "none" (no clear subject: empty scenery, sky, black); "a" is true when a character or object is visibly doing something; "t" is true when the frame shows a logo, a title card, credits, a sign or caption naming real people, or other on-screen text (not subtitles); "u" is true when the film's own subtitles (lines of dialogue burned into the picture) are visible; "k" is true when it is too dark to read, or so blurred, chaotic, or full of effects that no subject stands out; "g" is true for graphic content (nudity, gore, open wounds, lots of blood); "e" is true when the main character sits at the far left or far right edge of their own tile (the outer sixth), so a vertical crop of the middle would lose them. Return JSON: {"tiles":[{"n":<shot number>,"d":"<description>","s":"close","a":true,"t":false,"u":false,"k":false,"g":false,"e":false}]} covering every tile.` }];
    content.push(...castContent);
    for (const name of batch) {
      const bytes = await sheetBytes(userId, project.id, name);
      if (bytes) content.push({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${bytes.toString("base64")}` } });
    }
    const { value } = await requestOpenRouter({ kind: "vision", model, json: true, maxTokens: 6000, temperature: 0.2, reasoningEffort: "low", signal, messages: [{ role: "user", content }], validate: (v) => { if (!Array.isArray(listOf(v, "tiles"))) throw new Error("No tiles"); } });
    for (const tile of listOf(value, "tiles")) {
      const n = Number(tile?.n);
      if (Number.isInteger(n) && n >= 0) {
        described[n] = clip(tile.d, 160);
        // Rough-cutting standards: shot size, action, on-screen text, darkness.
        described[`tag:${n}`] = { s: ["close", "medium", "wide", "none"].includes(tile.s) ? tile.s : "", a: tile.a === true, t: tile.t === true, u: tile.u === true, k: tile.k === true, g: tile.g === true, e: tile.e === true };
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
  // Fill in an opening or credits time the databases and chapters didn't give, from what the frames show.
  const analysis = await readJson(userId, project.id, "analysis.json");
  if (analysis && !analysis.bounds) {
    // Analysed before story bounds existed: look them up now.
    const known = await findStoryBounds(project, analysis, signal);
    analysis.bounds = known.bounds;
    await writeJson(userId, project.id, "analysis.json", analysis);
    await save(userId, project, {
      film: { ...project.film, bounds: known.bounds, ...(known.film ? { title: known.film.title, year: known.film.year, tmdbId: known.film.tmdbId, imdbId: known.film.imdbId, from: known.film.from, checked: FILM_CHECK } : { from: "none", checked: FILM_CHECK }) },
      ...(known.film?.poster ? { poster: known.film.poster } : {}),
      ...(known.film && !project.options.filmTitle ? { options: { ...project.options, filmTitle: known.film.year ? `${known.film.title} (${known.film.year})` : known.film.title, filmTitleAuto: true } } : {}),
    });
  }
  if (analysis?.bounds && (analysis.bounds.from.start === "estimate" || analysis.bounds.from.end === "estimate")) {
    const seen = visualSegments(analysis, described);
    const merged = storyBounds(analysis.duration, {
      online: { introEnd: analysis.bounds.from.start === "estimate" ? null : analysis.bounds.start - 2, creditsStart: analysis.bounds.from.end === "estimate" ? null : analysis.bounds.end + 2, sources: [`opening: ${analysis.bounds.from.start}`, `credits: ${analysis.bounds.from.end}`] },
      visual: seen,
    });
    analysis.bounds = merged;
    await writeJson(userId, project.id, "analysis.json", analysis);
    await save(userId, project, { film: { ...project.film, bounds: merged } });
  }
  // The film's title off its own title card, then the film looked up again when no name confirmed it
  // (a share link names nothing; a model's guess from the dialogue can miss).
  if (analysis && analysis.screenTitle === undefined) {
    analysis.screenTitle = await readScreenTitle(analysis, described, (times) => lookAt(userId, project, times, signal), { signal }).catch((error) => {
      if (signal.aborted) throw error;
      console.warn(`[movie-recap] title card skipped: ${error.message}`);
      return "";
    });
    await writeJson(userId, project.id, "analysis.json", analysis);
    const typed = project.options.filmTitle && !project.options.filmTitleAuto;
    if (analysis.screenTitle && !typed && project.film?.from !== "name") {
      project.film = { ...project.film, checked: 0 };
      await recapTmdbId(userId, project, signal).catch((error) => console.warn(`[movie-recap] film lookup skipped: ${error.message}`));
    }
  }
  await save(userId, project, { stage: "writing" });
}

/** Empty-frame stretches, less those holding a frame a line was matched to (an object the line names). */
function emptyUnlessMatched(spans = [], matched = {}) {
  const chosen = Object.values(matched || {}).flat().filter(Number.isFinite);
  return spans.filter(([a, b]) => !chosen.some((t) => t >= a - 0.5 && t <= b + 0.5));
}

/** Text frames as stretches to keep cuts off (a frame stands for the 3 s around it): opening credits over
 *  the first scene leave the story between title cards usable. */
export function prepareCutRules(analysis, described) {
  const half = (analysis.shotEvery || 3) / 2 + 0.1;
  analysis.avoid = (analysis.shots || []).filter((shot) => creditFrame(described, shot.i)).map((shot) => [shot.t - half, shot.t + half]);
  // Frames with no subject (empty sky, scenery, black): no cut lands there unless a line matched that frame
  // for what it names (see buildRecapPlan). Dark frames stay usable: blocking them shut out Fall 2's whole
  // night-rain prologue.
  analysis.emptySpans = (analysis.shots || []).filter((shot) => { const tag = described[`tag:${shot.i}`]; return tag && !tag.t && tag.s === "none"; }).map((shot) => [shot.t - half, shot.t + half]);
  // Frames tagged graphic (blood, gore): a cut near one plays in black and white.
  analysis.graphicTimes = (analysis.shots || []).filter((shot) => described[`tag:${shot.i}`]?.g).map((shot) => shot.t);
  // An opening found from the frames by an older rule (which took dark frames for lead-in) is found again.
  if (analysis.bounds?.from?.start === "frames") {
    const seen = visualSegments(analysis, described);
    const start = seen.introEnd != null && seen.introEnd < analysis.duration * 0.15 ? seen.introEnd + 2 : DEFAULT_BOUNDS(analysis.duration).start;
    analysis.bounds = { ...analysis.bounds, start: Math.round(start * 100) / 100 };
  }
  return analysis;
}

/** The story's span: what the bounds say, else the fixed guards. */
export const storyRange = (analysis) => analysis.bounds || DEFAULT_BOUNDS(analysis.duration);

function timelineText(analysis, described) {
  const rows = [];
  const { start, end } = storyRange(analysis);
  // The writer only sees the story: nothing before the opening ends or after the credits begin.
  for (const shot of analysis.shots) if (described[shot.i] && shot.t >= start && shot.t <= end) rows.push([shot.t, `[${fmtTime(shot.t)}] SHOT ${shot.i}: ${described[shot.i]}`]);
  for (const line of analysis.transcript) if (line.text && line.start >= start && line.start <= end) rows.push([line.start + 0.01, `[${fmtTime(line.start)}] SAYS: ${clip(line.text, 140)}`]);
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
  const cast = project.cast?.characters || [];
  const wantLong = formats.includes("long");
  const wantShort = formats.includes("short");
  // Words for the length asked, at the rate the narration really plays (voice and pace, pauses trimmed).
  const wpm = narrationWpm(project.options.pace);
  const longWords = Math.round(longMinutes * wpm);
  const shortWords = Math.round((shortSeconds / 60) * wpm);
  const film = analysis.duration;
  const prompt = `You write narration for faceless movie-recap videos. Below is everything we know about one film, in time order: what is on screen at each sampled SHOT (one every ${analysis.shotEvery} s) and what characters SAY.

FILM LENGTH: ${fmtTime(film)} (${Math.round(film)} seconds). THE STORY RUNS ${fmtTime(storyRange(analysis).start)}–${fmtTime(storyRange(analysis).end)}: everything outside it is opening titles or end credits, so every beat's film stretch stays inside it.

${timelineText(analysis, described)}

${filmTitle ? `THE FILM: ${filmTitle}\n\n` : ""}${cast.length ? `THE CHARACTERS (the film's cast list, in billing order):\n${cast.map((c) => `- ${c.name}${c.alias ? ` (also ${c.alias})` : ""}${c.actor ? `, played by ${c.actor}` : ""}`).join("\n")}\n\n` : ""}Write ${[wantLong && `a long recap of about ${longWords} words (${longMinutes} minutes spoken)`, wantShort && `a Short of about ${shortWords} words (${shortSeconds} seconds spoken)`].filter(Boolean).join(" and ")}. ${language ? `Write in ${language}.` : "Write in the language the characters speak."}

House style for every recap:
- Third person, present tense, ${TONES[tone] || TONES.dramatic}. Short, punchy sentences with strong verbs; no filler ("meanwhile", "little did he know", "it turns out").
- Tell the story through what characters DO on screen. Every line should describe something visible: a character acting, reacting, or speaking. Avoid lines about empty scenery.
- ${cast.length ? `Call the characters by their names in THE CHARACTERS list, spelled exactly as there (the name people call them by, usually the first name; a full name at most where they are introduced): the transcript mishears names, and the frame descriptions name people the list names. A name the story reveals (a false identity, a twist) can be used too. Anyone not on the list is described ("the bartender", "her brother").` : `Use the characters' names from the film: from the dialogue, or from your knowledge of this film when its title is given. Otherwise describe them ("the detective", "her brother").`}
- Never mention actors, directors, awards, box office, release background, or behind-the-scenes facts.
- Keep personal opinion to one short sentence in a Short and a few sentences in a long recap.
- Never use the words "rape" or "drug abuse" ("murder" is fine). No discriminatory language about religion, gender, race, region, or sexual orientation.
- The narration carries the story in your own words. Quote dialogue rarely and never more than six words.
- Ignore opening titles, studio logos, and end credits.
- Plain international English: no idioms, slang, memes, or sayings a viewer abroad (or YouTube's auto-translate) wouldn't follow. Write proper nouns as they're spoken.
- Keep every pronoun right: he, she, and it never mixed up for the same character.
- Never rush: no line that skims a whole plot point in one breath ("He wakes up, buys clothes, then calls his friends"). Give each moment its action.
- Punctuate for the voice: commas for breath, full stops for weight, so the narrator lands the emotion.
${wantLong ? `
Long recap (${longMinutes} minutes):
- No introduction: no welcome, no teaser of later moments, no "This is the movie ...". The first line goes straight into the story at the film's first scene, e.g. "The movie opens with ..." or "The movie begins as ...".
- Tell the whole story in chronological order, skipping scenes that don't matter, through the ending. Narrate the climax rather than replaying it.
- Give the thrilling set-pieces room: the climax and every big action moment (a fall, a chase, a fight, a near-miss on a collapsing bridge, a desperate swing or jump) get several lines that follow it moment by moment, what happens and then what happens next, so the footage can follow it too. Save the words from quiet scenes, not from these.
- End with the outro: "Thank you for watching ${channelName || "the channel"}. This has been our recap of ${filmTitle || "[the film]"}. If you enjoyed it, like and subscribe, and tell us in the comments what you thought of the ending. Until next time, take care."
- Beats of 2-3 sentences (30-50 words), about ${Math.round(longWords / 40)} beats in all. Their film stretches move forward through the film and are at least 45 seconds long.
` : ""}${wantShort ? `
Short (${shortSeconds} seconds):
- One main character (at most three named) and one storyline from one stretch of the film. No introduction ("This movie tells the story of...", "This is a thrilling film"); start in the action. No one to three sentences that sum up the whole plot. Do not summarize the whole film and do not explain unrelated plots. It need not be chronological.
- First 5 seconds: the hook. The character doing something strange, shocking, or unexpected; a reversal that makes a stranger stay.
- Next: what happens because of it, and its result.
- Middle: the second climax, pushing the same storyline further or turning it around.
- Then continue it toward a peak.
- Last 10 seconds: end on suspense, with a question or an unresolved moment ("What will he do next?").
- Beats of 18-30 words, about ${Math.round(shortWords / 24)} beats and ${shortWords} words in all. A Short under ${Math.round(shortWords * 0.85)} words is too short.
` : ""}
Every beat gives "from" and "to": the stretch of film it narrates, as timestamps copied exactly from the timeline above ("57:36", "1:04:22"); never convert them to seconds. Every beat lists "shots": up to 6 SHOT numbers that best show what the narration says, preferring close and medium shots of characters in action.
Return JSON only:
{"title":"<recap title, max 80 characters>",${wantLong ? `"long":{"beats":[{"text":"...","from":"12:34","to":"13:40","shots":[0]}]},` : ""}${wantShort ? `"short":{"title":"<Short title, max 70 characters>","beats":[{"text":"...","from":"12:34","to":"13:40","shots":[0]}]},` : ""}"logline":"<one sentence on what the film is about>"}`;
  return { prompt, wantLong, wantShort, film, longWords, shortWords };
}

const scriptWords = (beats) => (Array.isArray(beats) ? beats : []).reduce((sum, beat) => sum + String(beat?.text || "").split(/\s+/).filter(Boolean).length, 0);

/** What the draft is missing against the word budget, or "" when it is long enough (models underwrite Shorts badly). */
export function scriptShortfall(value, { wantLong, wantShort, longWords, shortWords }) {
  const notes = [];
  const longHas = scriptWords(value?.long?.beats);
  const shortHas = scriptWords(value?.short?.beats);
  if (wantLong && longHas < longWords * 0.92) notes.push(`The long recap has ${longHas} words but needs about ${longWords}. Add beats covering more of the story.`);
  if (wantShort && shortHas < shortWords * 0.92) notes.push(`The Short has ${shortHas} words but needs about ${shortWords}. Add beats that push the same storyline further.`);
  return notes.join(" ");
}

/** Seconds from a film timestamp ("57:36", "1:04:22") or a number of seconds; NaN when neither. */
export function filmSeconds(value) {
  if (typeof value === "number") return value;
  const text = String(value ?? "").trim();
  if (/^\d+(\.\d+)?$/.test(text)) return Number(text);
  const parts = text.match(/^(?:(\d+):)?(\d{1,2}):(\d{2})(?:\.\d+)?$/);
  return parts ? Number(parts[1] || 0) * 3600 + Number(parts[2]) * 60 + Number(parts[3]) : NaN;
}

/** The script with every line's film stretch checked against what the line says (server/recapAlign.js):
 *  a long recap's lines in film order, a Short's wherever each fits. Lines whose stretch agrees keep it. */
export function placeScript(script, analysis, described) {
  const out = { ...script };
  for (const format of ["long", "short"]) {
    const beats = script[format]?.beats;
    if (!beats?.length) continue;
    const story = storyRange(analysis);
    const free = format === "long" ? teaserLines(beats) : [];
    const placed = alignBeats(beats, analysis, described, story, { chronological: format === "long", free });
    if (format === "long") {
      // A long recap's lines split the story between them: each line's film runs from halfway after the
      // line before to halfway before the line after, so no line shows what the next one is about to say
      // (with overlapping stretches, a Fall 2 recap showed the guide while the narration was still on the
      // bartender).
      // The teaser stands outside the order: its footage comes from where its words point (the climax it
      // previews), and the story's stretches are shared out among the other lines.
      const inOrder = beats.map((_, k) => k).filter((k) => !free[k]);
      const seconds = (beat) => Number(beat.seconds) || beat.text.split(/\s+/).filter(Boolean).length / (narrationWpm(analysis.pace) / 60);
      const spans = partitionStory(inOrder.map((k) => placed[k].centre), story, inOrder.map((k) => seconds(beats[k]) * STRETCH_PER_SECOND));
      const spanOf = new Map(inOrder.map((k, n) => [k, spans[n]]));
      out[format] = { ...script[format], beats: beats.map((beat, k) => {
        const span = free[k] ? placed[k] : spanOf.get(k);
        return { ...beat, from: Math.round(span.from), to: Math.round(span.to), placed: true, ...(free[k] ? { teaser: true } : {}) };
      }) };
    } else {
      out[format] = { ...script[format], beats: beats.map((beat, k) => (placed[k].moved ? { ...beat, from: Math.round(placed[k].from), to: Math.round(placed[k].to), placed: true } : beat)) };
    }
  }
  return out;
}

/** The opening teaser of a long recap: the welcome and the lines up to "This is the [year] movie ...", which
 *  preview the film's biggest moments rather than its start. */
export function teaserLines(beats) {
  // A line marked as the intro (the storyboard's Intro switch), else an older script's welcome and teaser.
  if (beats.some((beat) => beat.teaser)) return beats.map((beat) => Boolean(beat.teaser));
  const free = beats.map(() => false);
  const named = beats.slice(0, 3).findIndex((beat) => /\bthis is the (\d{4} )?(movie|film)\b/i.test(beat.text));
  const last = named >= 0 ? named : /^\s*(hi|hello|hey|welcome)\b/i.test(beats[0]?.text || "") ? 0 : -1;
  for (let k = 0; k <= last; k++) free[k] = true;
  return free;
}

/** Film each line's cuts need: its cuts, the film skipped between them (1.5-5 s), and the short camera
 *  shots passed over to keep each cut inside one shot. Measured on Fall 2 (median shot 2.1 s): a cut
 *  second used 2.6 s of film at the median and 4.3 s at the 75th percentile. */
export const STRETCH_PER_SECOND = 3.2;

/**
 * Non-overlapping film stretches for lines in film order: each line gets the film its cuts need, as close as
 * order allows to where its words point. A stretch narrower than its cuts overflowed into the next line's
 * and pushed every later line forward (Fall 2's footage ran ahead of its narration), so the stretches are
 * laid out like boxes on a shelf: each starts where its line wants, unless the line before needs the room,
 * found by isotonic regression on the starts. Then the gaps between are shared at their midpoints.
 */
export function partitionStory(centres, story, needs = centres.map(() => 0)) {
  const length = Math.max(1, story.end - story.start);
  const total = needs.reduce((sum, need) => sum + need, 0);
  // When the lines need more film than the story has, each gets its share.
  const scale = total > length ? length / total : 1;
  const need = needs.map((n) => n * scale);
  const before = [];
  let sum = 0;
  for (const n of need) { before.push(sum); sum += n; }
  // Wanted start of each line, less the room the lines before it take: a sequence that must not decrease.
  const wanted = centres.map((c, k) => c - need[k] / 2 - before[k]);
  const blocks = [];
  for (let k = 0; k < wanted.length; k++) {
    blocks.push({ value: wanted[k], count: 1 });
    while (blocks.length > 1 && blocks[blocks.length - 2].value > blocks[blocks.length - 1].value) {
      const last = blocks.pop();
      const prev = blocks[blocks.length - 1];
      prev.value = (prev.value * prev.count + last.value * last.count) / (prev.count + last.count);
      prev.count += last.count;
    }
  }
  const level = blocks.flatMap((block) => Array(block.count).fill(block.value));
  // Inside the story, end to end.
  const lowest = story.start;
  const highest = story.end - sum;
  const starts = level.map((t, k) => Math.min(Math.max(t, lowest), highest) + before[k]);
  for (let k = 1; k < starts.length; k++) starts[k] = Math.max(starts[k], starts[k - 1] + need[k - 1]);
  // Free film between two stretches goes half to each.
  return starts.map((s0, k) => {
    const s1 = s0 + need[k];
    const from = k > 0 ? (starts[k - 1] + need[k - 1] + s0) / 2 : Math.max(story.start, s0 - 30);
    const to = k + 1 < starts.length ? (s1 + starts[k + 1]) / 2 : Math.min(story.end, s1 + 60);
    return { from, to: Math.max(to, from + 1) };
  });
}

async function stageWrite(userId, project, signal) {
  await report(userId, project, "Writing the recap script", 0.72);
  // The cast for the film as identified now (the title card can change it after the frames are described).
  await recapCast(userId, project, signal).catch(() => []);
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
  // Up to two revision passes: the draft back with the exact counts, keeping whichever comes out longer.
  // Models underwrite, and every missing 200 words is a minute short of the length asked for.
  const total = (v) => scriptWords(v?.long?.beats) + scriptWords(v?.short?.beats);
  for (let pass = 0; pass < 2; pass++) {
    const shortfall = scriptShortfall(value, budget);
    if (!shortfall) break;
    await report(userId, project, "Writing the recap script (lengthening it to fit)", 0.73);
    const revised = await ask([
      { role: "user", content: prompt },
      { role: "assistant", content: JSON.stringify(value) },
      { role: "user", content: `${shortfall} Keep the house style and every rule above. Return the complete JSON again.` },
    ]).then((result) => result.value, () => null);
    if (!revised || total(revised) <= total(value)) break;
    value = revised;
  }
  const beats = (list) => (Array.isArray(list) ? list : []).map((beat, i) => {
    const from = clamp(filmSeconds(beat?.from), 0, film, 0);
    const to = clamp(filmSeconds(beat?.to), from + 5, film, Math.min(film, from + 60));
    return {
      id: `b${i}`,
      text: clip(beat?.text, 600),
      from: Math.round(from),
      to: Math.round(to),
      shots: (Array.isArray(beat?.shots) ? beat.shots : []).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n < analysis.shots.length).slice(0, 6),
    };
  }).filter((beat) => beat.text);
  const script = placeScript({
    title: clip(value.title, 80) || project.title,
    logline: clip(value.logline, 240),
    ...(wantLong ? { long: { beats: beats(value.long.beats) } } : {}),
    ...(wantShort ? { short: { title: clip(value.short.title, 70), beats: beats(value.short.beats) } } : {}),
  }, analysis, described);
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
  // Hosted voices take three lines at once; the local Voicebox models share one CPU server and run out of
  // memory when asked for several at a time, so they get one line at a time.
  const lanes = String(voiceId).startsWith("openrouter:") ? 2 : 1;
  await Promise.all(Array.from({ length: lanes }, async () => {
    while (queue.length) {
      signal.throwIfAborted();
      const { beat } = queue.shift();
      const hash = beatHash(voiceId, beat.text);
      // Lines recorded before an app restart come back from storage instead of being recorded again.
      let existing = ["wav", "mp3"].map((ext) => path.join(dir, `${hash}.${ext}`)).find((file) => fsSync.existsSync(file));
      if (!existing && assetStoreConfigured()) {
        for (const ext of ["wav", "mp3"]) {
          const file = path.join(dir, `${hash}.${ext}`);
          if (!existing && (await ensureFile(storeKey(userId, project.id, `line-${hash}.${ext}`), file).catch(() => false))) existing = file;
        }
      }
      if (!existing) {
        // Voice services drop the odd request; one bad line shouldn't fail a whole recap.
        let spoken;
        for (let attempt = 1; ; attempt++) {
          try {
            spoken = await deps.speak({ voiceId, text: beat.text, signal, direction: `${TONES[project.options.tone] || TONES.dramatic}; quick, energetic delivery with no long pauses` });
            break;
          } catch (error) {
            // A rate limit (cloud voices allow about 20 lines a minute on a new account) clears within a
            // minute: wait it out, several times, instead of failing the recap.
            const limited = /\b429\b|rate limit/i.test(String(error?.message || error));
            if (signal.aborted || attempt >= (limited ? 8 : 3)) throw error;
            if (limited) await report(userId, project, `The voice service is busy. Waiting a minute, then continuing (${done} of ${jobs.length} lines recorded)`, project.progress);
            await sleep(limited ? 30000 + 10000 * attempt : 2000 * attempt, signal);
          }
        }
        const { audio, extension } = spoken;
        const ext = extension === "mp3" ? "mp3" : "wav";
        await fs.writeFile(path.join(dir, `${hash}.${ext}`), audio);
        if (assetStoreConfigured()) await saveFile(storeKey(userId, project.id, `line-${hash}.${ext}`), path.join(dir, `${hash}.${ext}`)).catch((error) => console.warn(`[movie-recap] could not store a line: ${error.message}`));
      }
      beat.audio = path.basename(existing || ["wav", "mp3"].map((ext) => path.join(dir, `${hash}.${ext}`)).find((file) => fsSync.existsSync(file)));
      done += 1;
      if (lanes === 1 || done % 5 === 0 || !queue.length) await report(userId, project, `Recording the narration (${done} of ${jobs.length} lines)`, 0.76 + 0.06 * (done / jobs.length));
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

// Editing standard: when two cuts in a row sit close together in the film, mirror the second so the
// pair doesn't read as one continuous stretch (never two mirrored in a row).
const CLOSE_CUTS = 8;
export function mirrorCloseCuts(cuts) {
  let previous = null;
  return cuts.map((cut) => {
    const flip = Boolean(previous && !previous.flip && Math.abs(cut.start - previous.end) < CLOSE_CUTS);
    previous = { ...cut, flip };
    return flip ? previous : cut;
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
    // The opening keeps up a quicker pace: the first two story lines cut at 1.5-2.5 s.
    const opening = new Set(beats.filter((beat) => !beat.teaser).slice(0, 2).map((beat) => beat.id));
    const planned = planRecapCuts({
      seed: `${project.id}-${format}`,
      filmDuration: film,
      // Cuts stay inside the story: after the opening titles, before the end credits.
      startGuard: storyRange(analysis).start,
      endGuard: film - storyRange(analysis).end,
      sceneCuts: (analysis.scenes || []).slice(1).map((scene) => scene.start),
      chronological: format === "long",
      noSceneReturn: format === "short",
      avoid: [...(analysis.avoid || []), ...emptyUnlessMatched(analysis.emptySpans, matches[format])],
      shotCuts: analysis.shotCuts,
      sourceScale: project.options.transforms?.speed ? 1.05 : 1,
      beats: beats.map((beat) => {
        // Each cut needs 3-4 s plus a skipped gap, so a beat needs about 2.5x its length of film.
        const { from, to, duration } = beatWindow(beat, film);
        return { id: beat.id, duration, from, to, anchors: beat.shots.map(shotTime).filter((t) => t !== undefined), cutAnchors: matches[format]?.[beat.id], ...(beat.teaser ? { free: true, minClip: INTRO_CUT[0], maxClip: INTRO_CUT[1], lengths: phraseCutLengths(beat.text, duration, INTRO_CUT[0], INTRO_CUT[1]) } : opening.has(beat.id) ? { minClip: 1.5, maxClip: 2.5 } : {}) };
      }),
    });
    const graphic = (cut) => (analysis.graphicTimes || []).some((t) => t > cut.start - 1.5 && t < cut.end + 1.5);
    formats[format] = {
      cuts: mirrorCloseCuts(planned.cuts.map(({ start, end, duration }) => ({ start, end, duration, ...(graphic({ start, end }) ? { bw: true } : {}) }))),
      audioFiles: beats.map((beat) => beat.audio),
      pause: PAUSE,
      captions: captionLines(beats, PAUSE, format === "short" ? { maxWords: 2, maxChars: 14 } : { maxWords: 7, maxChars: 44 }),
    };
    const scored = (matches.jevScores?.[format] && Object.values(matches.jevScores[format]).flat().filter(Number.isFinite)) || [];
    stats[format] = { ...planned.stats, ...(scored.length ? { weak: scored.filter((score) => score < WEAK_MATCH).length } : {}), seconds: Math.round(beats.reduce((sum, beat) => sum + beat.seconds + PAUSE, 0)) };
    let at = 0;
    edit[format] = {
      // `start` is where the cut sits in the film, so one shot can be swapped later ("find a better shot");
      // `jev` is the classifier's score for its frame, and `weak` flags a match worth an editor's look.
      cuts: planned.cuts.map(({ at: position, duration, beatId, start }, i, all) => {
        const k = all.slice(0, i).filter((c) => c.beatId === beatId).length;
        const score = matches.jevScores?.[format]?.[beatId]?.[k];
        return { at: position, duration, beatId, start, ...(Number.isFinite(score) ? { jev: score, weak: score < WEAK_MATCH } : {}) };
      }),
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
function framesMatchingWords(text, analysis, described, limit = 14, range = null) {
  const wanted = new Set(wordsOf(text));
  if (!wanted.size) return [];
  const story = storyRange(analysis);
  const low = Math.max(story.start, range?.from ?? -Infinity);
  const high = Math.min(story.end, range?.to ?? Infinity);
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
function usableFrame(described, n, format = "long", strict = false) {
  if (!described[n]) return false;
  const tag = described[`tag:${n}`];
  if (!tag) return true;
  if (tag.s === "none" || creditFrame(described, n)) return false;
  // Rough-cutting standard: no wide shots and no static ones (only the camera moving). Relaxed when a line's
  // stretch has too few frames left. Dark frames and graphic ones are not filtered: darkness is a ranking
  // preference (the matcher sees [dark] and the render lifts exposure), and graphic frames play in black and
  // white. Filtering darkness shut out Fall 2's whole night prologue.
  if (strict && (tag.s === "wide" || tag.a === false)) return false;
  // A Short shows the middle of the frame, so a character at the far edge can't be centred.
  return format !== "short" || !tag.e;
}
/** A frame of credits, a title card, or a logo: text laid over the film (or over black), not text in the
 *  story. The frame tags mark any on-screen text, so Fall 2's news-and-social-media montage (tickers,
 *  "#FALLGIRL trending", phone screens) was kept off limits with the credits and its line ran late. */
// Credit wording only: a news channel's logo or a headline ("title") is part of the story.
const CREDIT_WORDS = /\b(credits?|title card|opening titles?|end titles?|(studio|production|distributor|company) logo|productions?\b|presents|presented by|directed by|director|starring|studios|pictures presents|a film by|distribut\w+ by|copyright|in association|executive producer|produced by|written by)\b/i;
function creditFrame(described, n) {
  const tag = described[`tag:${n}`];
  if (!tag?.t) return false;
  if (tag.s === "none" || tag.k) return true;
  return CREDIT_WORDS.test(String(described[n] || "")) || /\btext on (a |an )?(black|dark|plain)\b/i.test(String(described[n] || ""));
}

/** A frame of an object or place with no person in it (a warning sign, a mountain): usable only for a line
 *  that names it. */
function objectFrame(described, n) {
  const tag = described[`tag:${n}`];
  // Text in the story counts (a news page, a phone screen, a sign): only credits don't.
  return Boolean(described[n] && tag && tag.s === "none" && !creditFrame(described, n) && !tag.k);
}
function frameTag(described, n) {
  const tag = described[`tag:${n}`];
  if (!tag) return "";
  return ` [${[tag.s === "none" ? "no person" : tag.s, tag.a ? "action" : "still", tag.k && "dark", tag.g && "graphic", tag.t && "on-screen text", tag.u && "subtitled"].filter(Boolean).join(", ")}]`;
}

/**
 * Picks, for every cut, the described frame that best shows the words spoken over it. The first plan
 * fixes how many cuts each line gets; the model chooses a frame per cut from the line's stretch of
 * film; the plan is then rebuilt around those frames with every cut rule still enforced.
 * @returns {Promise<Record<string, Record<string, Array<number | null>>>>}
 */
export async function matchCutsToFrames(project, analysis, described, firstEdit, { signal, request = requestOpenRouter, jev = process.env.MOVIE_RECAP_JEV === "off" ? null : rerankWithJev } = {}) {
  const film = analysis.duration;
  const model = process.env.MOVIE_RECAP_SCRIPT_MODEL || "google/gemini-3.8-flash";
  const matches = {};
  // Jev's score (0-100) for each cut's frame, per format and line: the classifier that flags weak matches.
  const jevScores = {};
  Object.defineProperty(matches, "jevScores", { value: jevScores, enumerable: false });
  for (const format of project.options.formats) {
    const beats = project.script[format]?.beats || [];
    const cutsByBeat = new Map();
    for (const cut of firstEdit[format]?.cuts || []) cutsByBeat.set(cut.beatId, [...(cutsByBeat.get(cut.beatId) || []), cut]);
    // A long recap tells the film in order: each line draws from its own stretch, never earlier than the
    // line before, and word matches stay between its neighbours. Only Shorts may jump around the film.
    const chronological = format === "long";
    const windows = chronologicalWindows(beats, film, chronological);
    const tasks = beats.map((beat, k) => {
      const cuts = cutsByBeat.get(beat.id) || [];
      const { from, to } = windows[k];
      const inWindow = (strict) => analysis.shots.filter((shot) => shot.t >= from && shot.t <= to && usableFrame(described, shot.i, format, strict));
      let candidates = inWindow(true);
      if (candidates.length < cuts.length + 2) candidates = inWindow(false);
      const seen = new Set(candidates.map((shot) => shot.i));
      // A long recap's word matches stay in the line's own stretch: a neighbour's would show what is
      // about to be said, or what was.
      const near = chronological ? { from, to } : null;
      // Frames whose descriptions share the line's words; one with no person in it (the warning sign) only
      // gets in this way, because the line names what it shows.
      const worded = framesMatchingWords(beat.text, analysis, described, 14, near).filter((shot) => !seen.has(shot.i) && (usableFrame(described, shot.i, format, true) || objectFrame(described, shot.i)));
      // Thin long stretches evenly, but never drop a frame whose description shares the line's words.
      const cap = Math.max(24, 64 - worded.length);
      if (candidates.length > cap) {
        const keep = new Set(framesMatchingWords(beat.text, { ...analysis, shots: candidates }, described, 20).map((shot) => shot.i));
        const step = Math.ceil(candidates.length / cap);
        candidates = candidates.filter((shot, i) => i % step === 0 || keep.has(shot.i));
      }
      for (const shot of worded) { candidates.push(shot); seen.add(shot.i); }
      candidates.sort((a, b) => a.t - b.t);
      return { beat, cuts, says: wordsPerCut(beat, cuts), candidates };
    }).filter((task) => task.cuts.length && task.candidates.length > 1);
    matches[format] = {};
    const batches = [];
    for (let i = 0; i < tasks.length; i += 4) batches.push(tasks.slice(i, i + 4));
    const queue = [...batches];
    await Promise.all(Array.from({ length: 3 }, async () => {
      while (queue.length) {
        signal?.throwIfAborted();
        const batch = queue.shift();
        const brief = batch.map((task) => [
          `LINE ${task.beat.id}${task.beat.teaser ? " (the opening teaser: it previews later moments, so its frames come from wherever they show what it says, not film order)" : ""}: "${task.beat.text}"`,
          ...task.says.map((words, k) => `  CUT ${k + 1} (${task.cuts[k].duration.toFixed(1)} s) says: "${words || "(pause)"}"`),
          "  FRAMES:",
          ...task.candidates.map((shot) => `  #${shot.i} @${fmtTime(shot.t)}${frameTag(described, shot.i)}: ${described[shot.i]}`),
        ].join("\n")).join("\n\n");
        try {
          const { value } = await request({
            kind: "text", model, json: true, maxTokens: 4000, temperature: 0.2, reasoningEffort: "low", signal,
            messages: [{ role: "user", content: `You are editing a movie recap. For every CUT, pick the one FRAME (by its # number, from that line's list) that best shows what the narrator says during that cut: the same character, action, object, or place. What is said matters more than where the frame sits in the film. Strongly prefer [close] and [medium] frames where someone is doing something [action]; use [wide] only when nothing closer fits. Pick a [no person] frame (an object or place alone) only when the words name that object or place. When the words describe an action (someone falls, jumps, is shot, attacked, or killed), pick the frame of that moment itself, even if it is [dark] or [graphic]: dark frames get brightened and graphic ones play in black and white. Between frames that match equally, prefer one that isn't [dark]. [subtitled] frames carry the film's own subtitles, which get blurred out: pick one only when it is clearly the best match. ${chronological ? "This is a full recap told in film order: frames are listed in film order, and each cut's frame must come at or after the frame of the cut before it, including across lines. Never go back to an earlier scene unless the line itself says so (a flashback or a memory)." : "Prefer frames in story order within a line."} Never pick the same frame twice or two frames less than 6 seconds apart in one line.\n\n${brief}\n\nReturn JSON only: {"lines":[{"id":"<line id>","cuts":[<frame number for cut 1>, ...]}]} with exactly one frame per cut.` }],
            validate: (v) => { if (!Array.isArray(listOf(v, "lines"))) throw new Error("No lines"); },
          });
          for (const line of listOf(value, "lines")) {
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
    // Jev ranks a shortlist of frames for every cut against the words spoken over it.
    if (jev) await rankCutsWithJev(tasks, matches[format], analysis, described, { signal, jev, scores: (jevScores[format] = {}) });
    if (chronological) {
      matches[format] = keepInOrder(beats, matches[format]);
      // A frame the order rule dropped isn't the cut's frame any more, so its score goes too.
      for (const [beatId, list] of Object.entries(jevScores[format] || {})) list.forEach((_, k) => { if (matches[format][beatId]?.[k] == null) list[k] = null; });
    }
  }
  return matches;
}

const JEV_LANES = 6;
/** Below "plausible" on Jev's scale (0 poor, 25 weak, 50 plausible, 75 strong, 100 excellent). */
export const WEAK_MATCH = 50;
const JEV_RUBRIC = "You are matching footage to a movie recap's narration. Score how well each film frame shows what the narrator says during this cut: the same character, action, object, or place scores high; another scene, character, or moment scores low. Between equally good matches, a close or medium shot of someone acting beats a wide or static one. A frame of an object or place with no person in it scores high only when the words name that object or place; otherwise it scores lowest. When the words describe an action (someone falls, jumps, is shot, attacked, or killed), the frame of that moment scores highest and frames before or after it score low. A dark frame that shows the moment beats a bright one that doesn't.";

/** Up to 10 frames for one cut: the matcher's pick, the frames whose descriptions best share the cut's
 *  words (rare words weigh most), and an even spread across the line's stretch. */
export function cutShortlist(task, k, picked, analysis, described) {
  const list = [];
  const add = (shot) => shot && !list.some((s) => s.i === shot.i) && list.length < 10 && list.push(shot);
  if (Number.isFinite(picked)) add(task.candidates.find((shot) => Math.abs(shot.t - picked) < 0.01));
  const words = `${task.says[k] || ""} ${task.says[k] || ""} ${task.beat.text}`;
  for (const shot of framesMatchingWords(words, { ...analysis, shots: task.candidates }, described, 6)) add(shot);
  const step = Math.max(1, Math.floor(task.candidates.length / 4));
  for (let i = 0; i < task.candidates.length && list.length < 10; i += step) add(task.candidates[i]);
  return list.sort((a, b) => a.t - b.t);
}

/** Jev scores each cut's shortlist (0-100) against the narration over that cut and the best one becomes
 *  the cut's frame; a tie keeps the matcher's pick. Any Jev failure leaves the matcher's choice. */
async function rankCutsWithJev(tasks, chosen, analysis, described, { signal, jev = rerankWithJev, scores = null } = {}) {
  const jobs = [];
  for (const task of tasks) task.cuts.forEach((_, k) => jobs.push({ task, k }));
  await Promise.all(Array.from({ length: JEV_LANES }, async () => {
    while (jobs.length) {
      signal?.throwIfAborted();
      const { task, k } = jobs.shift();
      const current = chosen[task.beat.id]?.[k];
      const shortlist = cutShortlist(task, k, current, analysis, described);
      if (shortlist.length < 2) continue;
      const ranked = await jev(shortlist, {
        rubric: JEV_RUBRIC,
        context: { saidDuringCut: task.says[k] || "", wholeLine: task.beat.text },
        describe: (shot) => ({ filmTime: fmtTime(shot.t), shows: described[shot.i] || "", shot: frameTag(described, shot.i).trim() }),
        minimumConfidence: 0,
      }).catch(() => shortlist);
      const best = ranked[0];
      if (!best || !Number.isFinite(Number(best.jevScore))) continue;
      const mine = ranked.find((shot) => Number.isFinite(current) && Math.abs(shot.t - current) < 0.01);
      const pick = mine && Number(mine.jevScore) >= Number(best.jevScore) ? mine : best;
      if (!chosen[task.beat.id]) chosen[task.beat.id] = task.cuts.map(() => null);
      chosen[task.beat.id][k] = pick.t;
      // The classifier: Jev's score for the frame each cut ends up with.
      if (scores) (scores[task.beat.id] ||= task.cuts.map(() => null))[k] = Number(pick.jevScore);
    }
  }));
}

/** Each line's stretch of film, made to move forward through the film for a long recap. */
export function chronologicalWindows(beats, film, chronological) {
  let floor = 0;
  return beats.map((beat) => {
    const window = beatWindow(beat, film);
    // The opening teaser previews later moments: it keeps its own stretch and doesn't move the order.
    if (!chronological || beat.teaser) return window;
    const from = Math.max(window.from, floor);
    const to = Math.max(window.to, from + Math.max(20, window.duration * 2.6));
    floor = Math.max(floor, Math.min(window.from, beat.from ?? window.from));
    return { ...window, from, to: Math.min(film - 1, to) };
  });
}

/** Drops matched frames that would send a long recap back to an earlier scene (a few seconds of slack):
 *  those cuts then follow the film forward from the cut before. */
const BACK_SLACK = 4;
export function keepInOrder(beats, matches = {}) {
  const out = {};
  let last = -Infinity;
  for (const beat of beats) {
    const list = matches[beat.id];
    if (!list) continue;
    if (beat.teaser) {
      out[beat.id] = list;
      continue;
    }
    out[beat.id] = list.map((t) => {
      if (!Number.isFinite(t)) return null;
      if (t < last - BACK_SLACK) return null;
      last = Math.max(last, t);
      return t;
    });
  }
  return out;
}

// ---------- Short centring check ----------
// A Short shows only the middle of each frame (the film fills a band 73% of the portrait height), so
// the crop must sit on the main character. The check looks at the real frames near the start and end
// of every cut, places the crop on the character, and swaps out any cut where the character can't be
// centred (at the edge of the frame, or no character at all), then looks again.
const SHORT_BAND = Math.floor((1920 * 0.73) / 2) * 2;
/** Half the share of the film's width a Short shows, so crop centres can range over [half, 1 - half]. */
export function shortHalfWindow(aspect = 16 / 9, zoom = true) {
  return Math.min(0.5, 1080 / (SHORT_BAND * (zoom ? 1.06 : 1) * aspect) / 2);
}
const CENTRE_SLACK = 0.05; // how far (as a share of film width) a character may sit from the crop's centre
const CHECK_ROUNDS = 2;

/** Where a cut's character sits and whether the crop can put them in the middle. */
export function centreVerdict(xa, xb, half) {
  const known = [xa, xb].filter((x) => Number.isFinite(x));
  if (!known.length) return { ok: false, reason: "no-character" };
  const [x0, x1] = known.length === 2 ? known : [known[0], known[0]];
  const reach = (x) => Math.min(1 - half, Math.max(half, x));
  const ok = Math.abs(x0 - reach(x0)) <= CENTRE_SLACK && Math.abs(x1 - reach(x1)) <= CENTRE_SLACK;
  return { ok, reason: ok ? "" : "edge", x0: Math.round(reach(x0) * 1000) / 1000, x1: Math.round(reach(x1) * 1000) / 1000 };
}

async function locateCharacters(frames, { signal, request }) {
  const model = process.env.MOVIE_RECAP_VISION_MODEL || "google/gemini-3.8-flash";
  const found = {};
  const batches = [];
  // Six frames a call: with more, or with frames tiled into a sheet, the model loses track of which is which.
  for (let i = 0; i < frames.length; i += 6) batches.push(frames.slice(i, i + 6).map((bytes, k) => ({ n: i + k, bytes })));
  await Promise.all(batches.map(async (batch) => {
    const content = [{ type: "text", text: `Each image below is one frame from a film, labelled "Frame n". In every frame, find the main character: the person, animal, or creature the moment is about (if several, the one speaking, acting, or facing the camera; a character seen small or from behind still counts). Give "x", how far across that frame the centre of the character's face sits (their head or body if the face is hidden), from 0 at the frame's left edge to 100 at its right edge, measured within that frame alone. Use null only when no person, animal, or creature is visible at all. Return JSON only: {"frames":[{"n":<frame number>,"x":<0-100 or null>}]} with one entry per frame.` }];
    for (const { n, bytes } of batch) {
      if (!bytes) continue;
      content.push({ type: "text", text: `Frame ${n}:` }, { type: "image_url", image_url: { url: `data:image/jpeg;base64,${bytes.toString("base64")}` } });
    }
    const call = () => request({ kind: "vision", model, json: true, maxTokens: 3000, temperature: 0.1, reasoningEffort: "low", signal, messages: [{ role: "user", content }], validate: (v) => { if (!Array.isArray(listOf(v, "frames"))) throw new Error("No frames"); } });
    const { value } = await call().catch((error) => { if (signal?.aborted) throw error; return call(); });
    for (const frame of listOf(value, "frames")) {
      const n = Number(frame?.n);
      if (!Number.isInteger(n)) continue;
      const x = frame?.x === null || frame?.x === undefined || frame?.x === "" ? NaN : Number(frame.x);
      found[n] = Number.isFinite(x) ? Math.max(0, Math.min(100, x)) / 100 : null;
    }
  }));
  return found;
}

/** Another frame for a cut that failed the check: in its line's stretch, centrable, clear of the line's other cuts. */
function replacementFrame(analysis, described, beat, film, wanted, others, tried) {
  const { from, to } = beatWindow(beat, film);
  let best = null;
  for (const shot of analysis.shots) {
    if (shot.t < from || shot.t > to || tried.has(shot.i) || !usableFrame(described, shot.i, "short", true)) continue;
    const tag = described[`tag:${shot.i}`] || {};
    if (tag.e) continue;
    if (others.some((t) => t !== null && Math.abs(t - shot.t) < 6)) continue;
    const score = (tag.s === "close" || tag.s === "medium" ? 1 : 0) + (tag.a ? 0.5 : 0) - Math.abs(shot.t - wanted) / 30;
    if (!best || score > best.score) best = { shot, score };
  }
  return best?.shot || null;
}

/**
 * Runs the centring check on the Short and returns the plan with a crop position on every cut.
 * `look(times)` returns one frame of the film per time (frames[n] at times[n], null if unreadable) and its aspect.
 * @returns {Promise<{ plan: any, stats: any, edit: any, check: { cuts: number, centred: number, replaced: number } }>}
 */
export async function centreShortCuts(project, analysis, described, built, matches, { look, signal = undefined, request = requestOpenRouter }) {
  const film = analysis.duration;
  const beats = project.script.short?.beats || [];
  const zoom = project.options.transforms?.zoom !== false;
  const tried = new Map(); // beat id -> frames already rejected or used for it
  let current = built;
  let replaced = 0;
  let verdicts = [];
  for (let round = 0; ; round++) {
    const cuts = current.plan.formats.short.cuts;
    const times = cuts.flatMap((cut) => { const length = cut.end - cut.start; return [cut.start + length * 0.15, cut.start + length * 0.85]; });
    const { frames, aspect } = await look(times);
    const half = shortHalfWindow(aspect, zoom);
    const found = await locateCharacters(frames, { signal, request });
    verdicts = cuts.map((_, i) => centreVerdict(found[i * 2], found[i * 2 + 1], half));
    const failing = verdicts.map((v, i) => (v.ok ? -1 : i)).filter((i) => i >= 0);
    if (!failing.length || round >= CHECK_ROUNDS) break;
    // Swap each failing cut's frame for a centrable one from the same line, then re-plan.
    const next = { ...matches, short: { ...(matches.short || {}) } };
    Object.defineProperty(next, "jevScores", { value: matches.jevScores, enumerable: false });
    const editCuts = current.edit.short.cuts;
    let changed = 0;
    for (const i of failing) {
      const beatId = editCuts[i].beatId;
      const beat = beats.find((b) => b.id === beatId);
      if (!beat) continue;
      const lineCuts = editCuts.map((cut, k) => ({ cut, k })).filter(({ cut }) => cut.beatId === beatId);
      const slot = lineCuts.findIndex(({ k }) => k === i);
      const anchors = next.short[beatId] ? [...next.short[beatId]] : lineCuts.map(({ k }) => cuts[k].start);
      const used = tried.get(beatId) || new Set();
      const wanted = cuts[i].start;
      const nearest = analysis.shots.reduce((a, b) => (Math.abs(b.t - wanted) < Math.abs(a.t - wanted) ? b : a), analysis.shots[0]);
      if (nearest) used.add(nearest.i);
      const pick = replacementFrame(analysis, described, beat, film, wanted, anchors.filter((_, k) => k !== slot), used);
      tried.set(beatId, used);
      if (!pick) continue;
      used.add(pick.i);
      anchors[slot] = pick.t;
      next.short[beatId] = anchors;
      changed++;
    }
    if (!changed) break;
    replaced += changed;
    matches = next;
    const rebuilt = buildRecapPlan(project, analysis, matches);
    current = { ...current, plan: { ...current.plan, formats: { ...current.plan.formats, short: rebuilt.plan.formats.short } }, stats: { ...current.stats, short: rebuilt.stats.short }, edit: { ...current.edit, short: rebuilt.edit.short } };
  }
  const cuts = current.plan.formats.short.cuts.map((cut, i) => (Number.isFinite(verdicts[i]?.x0) ? { ...cut, x0: verdicts[i].x0, x1: verdicts[i].x1 } : cut));
  const check = { cuts: cuts.length, centred: verdicts.filter((v) => v.ok).length, replaced };
  return {
    plan: { ...current.plan, formats: { ...current.plan.formats, short: { ...current.plan.formats.short, cuts } } },
    stats: { ...current.stats, short: { ...current.stats.short, centred: check.centred } },
    edit: current.edit,
    check,
  };
}

// ---------- Credits check ----------
// The frame tags keep cuts off credits, but opening credits often run over the first scene and one tag in
// a few seconds can miss a title card. Every cut near the start or end of the story is looked at again
// on real frames from the film; one showing credits, a title card, or a logo moves on and its frame is
// kept clear, and any still showing text after two tries arrives flagged in Vibe Edit.
const TEXT_EDGE_START = 240;
const TEXT_EDGE_END = 180;

export async function framesWithText(frames, { signal = undefined, request = requestOpenRouter } = {}) {
  const model = process.env.MOVIE_RECAP_VISION_MODEL || "google/gemini-3.8-flash";
  const found = [];
  for (let i = 0; i < frames.length; i += 12) {
    const content = [{ type: "text", text: "These are frames from a film. For each numbered frame, say whether it shows opening or end credits, a title card, a studio or distributor logo, or other text laid over the picture (names, roles, \"in association with\"). Dialogue subtitles at the bottom don't count, and neither does text that is part of the story: signs in the scene, news tickers and broadcasts, phone or computer screens, social-media posts and messages. Return JSON {\"frames\":[{\"n\":<number>,\"text\":true|false}]} for every frame." }];
    for (let n = i; n < Math.min(frames.length, i + 12); n++) {
      if (!frames[n]) continue;
      content.push({ type: "text", text: `Frame ${n}:` }, { type: "image_url", image_url: { url: `data:image/jpeg;base64,${frames[n].toString("base64")}` } });
    }
    if (content.length < 2) continue;
    const { value } = await request({ kind: "vision", model, json: true, maxTokens: 1500, temperature: 0, reasoningEffort: "low", signal, messages: [{ role: "user", content }], validate: (v) => { if (!Array.isArray(listOf(v, "frames"))) throw new Error("No frames"); } });
    for (const frame of listOf(value, "frames")) if (frame?.text === true && Number.isInteger(Number(frame.n))) found.push(Number(frame.n));
  }
  return new Set(found);
}

export async function fixTextCuts(project, analysis, built, matches, { look, signal = undefined, request = requestOpenRouter }) {
  let current = built;
  const flagged = {};
  const story = storyRange(analysis);
  for (const format of Object.keys(current.plan.formats)) {
    for (let round = 0; ; round++) {
      signal?.throwIfAborted();
      const cuts = current.plan.formats[format].cuts;
      const edge = cuts.map((cut, i) => i).filter((i) => cuts[i].start < story.start + TEXT_EDGE_START || cuts[i].end > story.end - TEXT_EDGE_END);
      if (!edge.length) { flagged[format] = []; break; }
      const times = edge.flatMap((i) => [cuts[i].start + 0.3, (cuts[i].start + cuts[i].end) / 2, cuts[i].end - 0.3]);
      const { frames } = await look(times);
      const texty = await framesWithText(frames, { signal, request });
      const bad = edge.filter((_, k) => [0, 1, 2].some((j) => texty.has(k * 3 + j)));
      flagged[format] = bad;
      if (!bad.length || round >= 2) break;
      // Keep the text frames clear from now on, and move each cut on in its line's film.
      for (const [k, i] of edge.entries()) for (let j = 0; j < 3; j++) if (texty.has(k * 3 + j)) analysis.avoid = [...(analysis.avoid || []), [times[k * 3 + j] - 2, times[k * 3 + j] + 2]];
      const next = { ...matches, [format]: { ...(matches[format] || {}) } };
      Object.defineProperty(next, "jevScores", { value: matches.jevScores, enumerable: false });
      const editCuts = current.edit[format].cuts;
      for (const i of bad) {
        const beatId = editCuts[i].beatId;
        const lineCuts = editCuts.map((cut, k) => ({ cut, k })).filter(({ cut }) => cut.beatId === beatId);
        const slot = lineCuts.findIndex(({ k }) => k === i);
        const anchors = next[format][beatId] ? [...next[format][beatId]] : lineCuts.map(({ k }) => cuts[k].start + cuts[k].duration / 2);
        anchors[slot] = cuts[i].end + 10;
        next[format][beatId] = anchors;
      }
      matches = next;
      const rebuilt = buildRecapPlan(project, analysis, matches);
      current = { ...current, plan: { ...current.plan, formats: { ...current.plan.formats, [format]: rebuilt.plan.formats[format] } }, stats: { ...current.stats, [format]: rebuilt.stats[format] }, edit: { ...current.edit, [format]: rebuilt.edit[format] } };
    }
  }
  const edit = { ...current.edit };
  for (const [format, bad] of Object.entries(flagged)) {
    if (!edit[format] || !bad.length) continue;
    const marked = new Set(bad);
    edit[format] = { ...edit[format], cuts: edit[format].cuts.map((cut, i) => (marked.has(i) ? { ...cut, text: true, weak: true } : cut)) };
  }
  return { ...current, edit, matches };
}

// ---------- Visual match check ----------
// The matcher and Jev choose frames from text descriptions. This looks at the real frame each cut ends up
// on, next to the words spoken over it, and rates the fit 0-3 (3 shows what is said, 2 the right people or
// place, 1 loosely related, 0 unrelated or no clear subject). A cut rated 0 or 1 tries the frames whose
// descriptions best share its words, keeps the better of old and new, and one still weak arrives flagged.
const FIT_RUBRIC = "You are checking a movie recap's edit. Each numbered frame is the shot shown while the narrator says the quoted words. Rate how well the frame shows what is said: 3 = it shows that action, person, or thing; 2 = the right people or place, a related moment; 1 = loosely related; 0 = unrelated, or no clear subject (a blur, a torso, empty sky or scenery). A frame of an object or place with no person in it scores 2 or 3 only when the words name that object or place (a warning sign, the summit); otherwise 0. When the words describe an action (someone falls, jumps, is shot, attacked, or killed), only a frame of that moment scores 3; the people before or after it score 1. Darkness alone doesn't lower the score if the people and action can be made out. Judge only the picture against the words.";

/** Words spoken over each cut of an edit, from its timed captions. */
function wordsOverCuts(edit) {
  return edit.cuts.map((cut) => edit.captions.filter((line) => line.end > cut.at + 0.1 && line.start < cut.at + cut.duration - 0.1).map((line) => line.text).join(" "));
}

export async function rateFrames(frames, said, { signal = undefined, request = requestOpenRouter } = {}) {
  const model = process.env.MOVIE_RECAP_VISION_MODEL || "google/gemini-3.8-flash";
  const fit = new Array(frames.length).fill(null);
  // Frames showing blood or gore, which play in black and white.
  const gore = new Array(frames.length).fill(false);
  Object.defineProperty(fit, "gore", { value: gore, enumerable: false });
  const batches = [];
  for (let i = 0; i < frames.length; i += 10) batches.push(i);
  const queue = [...batches];
  await Promise.all(Array.from({ length: 3 }, async () => {
    while (queue.length) {
      signal?.throwIfAborted();
      const first = queue.shift();
      const content = [{ type: "text", text: `${FIT_RUBRIC} For every frame also say whether a person (or a face, hands, a body acting) is visible, name what the frame shows in a few plain words, and say whether blood, gore, or an open wound is visible. Return JSON {"frames":[{"n":<number>,"person":true|false,"shows":"<a few words>","gore":true|false,"fit":0-3}]} for every frame.` }];
      for (let n = first; n < Math.min(frames.length, first + 10); n++) {
        if (!frames[n]) continue;
        content.push({ type: "text", text: `Frame ${n}, while the narrator says: "${clip(said[n], 240) || "(a pause)"}"` }, { type: "image_url", image_url: { url: `data:image/jpeg;base64,${frames[n].toString("base64")}` } });
      }
      if (content.length < 2) continue;
      try {
        const { value } = await request({ kind: "vision", model, json: true, maxTokens: 1500, temperature: 0, reasoningEffort: "low", signal, messages: [{ role: "user", content }], validate: (v) => { if (!Array.isArray(listOf(v, "frames"))) throw new Error("No frames"); } });
        for (const frame of listOf(value, "frames")) {
          const n = Number(frame?.n);
          if (!Number.isInteger(n) || n < 0 || n >= fit.length || !Number.isFinite(Number(frame.fit))) continue;
          fit[n] = Math.max(0, Math.min(3, Number(frame.fit)));
          gore[n] = frame.gore === true;
          // The house rule, applied here rather than left to the model: a frame with no person in it fits
          // only when the words name what it shows (the warning sign, the clouds).
          if (frame.person === false) {
            const named = new Set(lineWords(said[n]));
            if (!lineWords(frame.shows).some((w) => named.has(w))) fit[n] = 0;
          }
        }
      } catch (error) {
        if (signal?.aborted) throw error;
        console.warn(`[movie-recap] match check skipped a batch: ${error.message}`);
      }
    }
  }));
  return fit;
}

export async function checkMatchesVisually(project, analysis, described, built, matches, { look, signal = undefined, request = requestOpenRouter }) {
  let current = built;
  const fits = {};
  for (const format of Object.keys(current.plan.formats)) {
    const cuts = () => current.plan.formats[format].cuts;
    const middle = (cut) => cut.start + cut.duration / 2;
    const said = wordsOverCuts(current.edit[format]);
    const { frames } = await look(cuts().map(middle));
    const fit = await rateFrames(frames, said, { signal, request });
    const gore = [...(fit.gore || [])];
    // Frames already shown or tried stay out of the next picks.
    const taken = new Set(cuts().map((cut) => Math.round(middle(cut))));
    for (let round = 0; round < 2; round++) {
      // The intro's cuts are replaced by the montage of best clips, so they aren't worth replacing here.
      const teaserIds = new Set((project.script[format]?.beats || []).filter((beat) => beat.teaser).map((beat) => beat.id));
      const weak = fit.map((f, i) => (f !== null && f <= 1 && !teaserIds.has(current.edit[format].cuts[i]?.beatId) ? i : -1)).filter((i) => i >= 0);
      if (!weak.length) break;
      // Each weak cut gets the frame from its line's film whose description best shares its words.
      const next = { ...matches, [format]: { ...(matches[format] || {}) } };
      Object.defineProperty(next, "jevScores", { value: matches.jevScores, enumerable: false });
      const editCuts = current.edit[format].cuts;
      const beats = project.script[format]?.beats || [];
      const tried = new Map();
      for (const i of weak) {
        const beat = beats.find((b) => b.id === editCuts[i].beatId);
        if (!beat) continue;
        const { from, to } = beatWindow(beat, analysis.duration);
        const pool = framesMatchingWords(`${said[i]} ${said[i]} ${beat.text}`, analysis, described, 8, format === "long" ? { from, to } : null)
          .filter((shot) => (usableFrame(described, shot.i, format, true) || objectFrame(described, shot.i)) && !taken.has(Math.round(shot.t)) && Math.abs(shot.t - middle(cuts()[i])) > 4);
        const pick = pool[0];
        if (!pick) continue;
        taken.add(Math.round(pick.t));
        const lineCuts = editCuts.map((cut, k) => ({ cut, k })).filter(({ cut }) => cut.beatId === beat.id);
        const slot = lineCuts.findIndex(({ k }) => k === i);
        const anchors = next[format][beat.id] ? [...next[format][beat.id]] : lineCuts.map(({ k }) => middle(cuts()[k]));
        tried.set(i, { beatId: beat.id, slot, before: anchors[slot] });
        anchors[slot] = pick.t;
        next[format][beat.id] = anchors;
      }
      if (tried.size) {
        const rebuilt = buildRecapPlan(project, analysis, next);
        const changed = [...tried.keys()];
        const { frames: newFrames } = await look(changed.map((i) => middle(rebuilt.plan.formats[format].cuts[i])));
        const newFit = await rateFrames(newFrames, changed.map((i) => said[i]), { signal, request });
        // Keep a new frame only where it rates higher; put the rest back.
        changed.forEach((i, k) => {
          if (newFit[k] !== null && newFit[k] > (fit[i] ?? 0)) { fit[i] = newFit[k]; gore[i] = Boolean(newFit.gore?.[k]); }
          else { const { beatId, slot, before } = tried.get(i); next[format][beatId][slot] = before; }
        });
        matches = next;
        const settled = buildRecapPlan(project, analysis, matches);
        current = { ...current, plan: { ...current.plan, formats: { ...current.plan.formats, [format]: settled.plan.formats[format] } }, stats: { ...current.stats, [format]: settled.stats[format] }, edit: { ...current.edit, [format]: settled.edit[format] } };
      } else break;
    }
    fits[format] = fit;
    // Cuts the check saw blood or gore in play in black and white.
    current = { ...current, plan: { ...current.plan, formats: { ...current.plan.formats, [format]: { ...current.plan.formats[format], cuts: current.plan.formats[format].cuts.map((cut, i) => (gore[i] ? { ...cut, bw: true } : cut)) } } } };
  }
  const edit = { ...current.edit };
  const stats = { ...current.stats };
  for (const [format, fit] of Object.entries(fits)) {
    if (!edit[format]) continue;
    edit[format] = { ...edit[format], cuts: edit[format].cuts.map((cut, i) => (fit[i] === null || fit[i] === undefined ? cut : { ...cut, fit: fit[i], ...(fit[i] <= 1 ? { weak: true } : {}) })) };
    const rated = fit.filter((f) => f !== null);
    stats[format] = { ...stats[format], shown: rated.filter((f) => f >= 2).length, rated: rated.length };
  }
  return { ...current, edit, stats, matches };
}

// ---------- Opening montage ----------
// Every recap opens on its most captivating shot: Jev ranks the recap's clips as an opening hook (a
// close-up with a strange, exciting, or eerie charge beats a calm wide shot), and an intro plays the top
// four or five from different scenes in quick cuts timed to its narration's phrasing.
const HOOK_RUBRIC = "You are choosing the opening shot of a movie recap video, the one that makes a scrolling viewer stop. Score how captivating each frame is on its own: a close-up of a face in fear, shock, rage, or a strange, unsettling, or exciting moment scores highest; intense action (a fall, a fight, a leap, danger) scores high; something weird or eerie that makes you want to know more scores high. A calm conversation, an establishing shot, scenery, or a shot with no clear subject scores low.";

/** The recap's clips ranked as an opening hook, best first (edit cut indices), from Jev in rounds of ten. */
export async function rankCaptivating(project, analysis, described, edit, { jev = rerankWithJev, look = null, signal = undefined, request = requestOpenRouter } = {}) {
  const teaser = new Set((project.script.long?.beats || []).filter((beat) => beat.teaser).map((beat) => beat.id));
  const shotAt = (t) => analysis.shots.reduce((a, b) => (Math.abs(b.t - t) < Math.abs(a.t - t) ? b : a), analysis.shots[0]);
  const pool = edit.cuts.map((cut, i) => {
    const shot = shotAt(cut.start + cut.duration / 2);
    const tag = described[`tag:${shot?.i}`] || {};
    // A shortlist first: close-ups and action, well matched, rate highest.
    const prior = (tag.s === "close" ? 3 : tag.s === "medium" ? 1 : 0) + (tag.a ? 1.5 : 0) + (tag.k ? -1 : 0) + (Number.isFinite(cut.fit) ? cut.fit * 0.5 : 0);
    return { i, shot, cut, prior, shows: described[shot?.i] || "" };
  }).filter((item) => !teaser.has(item.cut.beatId) && !item.cut.weak && item.shows && !creditFrame(described, item.shot?.i)).sort((a, b) => b.prior - a.prior).slice(0, 40);
  if (pool.length < 2) return pool.map((item) => item.i);
  // What each clip really shows: the nearest sampled frame (every 3 s) can be another camera shot in a fast
  // scene, and a clip described as a scream opened Fall 2's recap on raindrops. The top two dozen are
  // looked at on their own middle frame; ones with no person in them drop out.
  let shortlist = pool;
  if (look) {
    try {
      const top = pool.slice(0, 24);
      const { frames } = await look(top.map((item) => item.cut.start + item.cut.duration / 2));
      const model = process.env.MOVIE_RECAP_VISION_MODEL || "google/gemini-3.8-flash";
      const seen = new Map();
      for (let k = 0; k < top.length; k += 12) {
        const content = [{ type: "text", text: `${HOOK_RUBRIC} For each numbered frame, say in a few words what it shows, whether a person (a face or a body) is clearly visible, and rate it as an opening shot from 0 to 10. Return JSON {"frames":[{"n":<number>,"shows":"<a few words>","person":true|false,"hook":0-10}]}.` }];
        for (let n = k; n < Math.min(top.length, k + 12); n++) if (frames[n]) content.push({ type: "text", text: `Frame ${n}:` }, { type: "image_url", image_url: { url: `data:image/jpeg;base64,${frames[n].toString("base64")}` } });
        const { value } = await request({ kind: "vision", model, json: true, maxTokens: 1500, temperature: 0, reasoningEffort: "low", signal, messages: [{ role: "user", content }], validate: (v) => { if (!Array.isArray(listOf(v, "frames"))) throw new Error("No frames"); } });
        for (const frame of listOf(value, "frames")) if (Number.isInteger(Number(frame?.n))) seen.set(Number(frame.n), frame);
      }
      const looked = top.map((item, n) => ({ item, frame: seen.get(n) })).filter(({ frame }) => frame && frame.person === true)
        .sort((a, b) => Number(b.frame.hook || 0) - Number(a.frame.hook || 0))
        .map(({ item, frame }) => ({ ...item, shows: clip(frame.shows, 160) || item.shows, hook: Number(frame.hook) || 0, looked: true }));
      if (looked.length >= 2) shortlist = looked;
    } catch (error) {
      if (signal?.aborted) throw error;
      console.warn(`[movie-recap] hook frames skipped: ${error.message}`);
    }
  }
  // Unseen, only close and medium shots of someone acting stay in (the safe guess at a person on screen).
  if (!shortlist[0]?.looked) shortlist = shortlist.filter((item) => { const tag = described[`tag:${item.shot?.i}`] || {}; return (tag.s === "close" || tag.s === "medium") && !tag.k; });
  if (!shortlist.length) return [];
  const describe = (item) => ({ shows: item.shows, shot: frameTag(described, item.shot.i).trim() });
  const rank = async (items) => (await jev(items, { rubric: HOOK_RUBRIC, context: { film: project.film?.title || project.title }, describe, minimumConfidence: 0 }).catch(() => items));
  const finalists = [];
  for (let k = 0; k < shortlist.length; k += 10) {
    signal?.throwIfAborted();
    finalists.push(...(await rank(shortlist.slice(k, k + 10))).slice(0, 5));
  }
  const ordered = finalists.length > 10 ? [...(await rank(finalists.slice(0, 10))), ...finalists.slice(10)] : await rank(finalists);
  // The eye on the real frame leads; Jev's ranking breaks ties and orders the unseen.
  const score = (item, n) => (item.looked ? item.hook * 10 : 0) + (Number.isFinite(Number(item.jevScore)) ? Number(item.jevScore) * 0.3 : (ordered.length - n));
  const best = ordered.map((item, n) => ({ item, s: score(item, n) })).sort((a, b) => b.s - a.s).map(({ item }) => item);
  // Every looked-at clip stays a candidate, in order, for the montage to match to its words.
  const rest = shortlist.filter((item) => !best.includes(item));
  const order = [...best, ...rest].map((item) => item.i);
  Object.defineProperty(order, "shows", { value: new Map([...best, ...rest].map((item) => [item.i, item.shows])), enumerable: false });
  return order;
}

/** Cut lengths for an intro line that follow its narration: cuts change where the phrasing breaks (a
 *  comma, a full stop), each between 1.4 and 2.6 s, summing to the line's length. */
export function phraseCutLengths(text, duration, min = 1.4, max = 2.6) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const total = words.reduce((sum, w) => sum + w.length + 1, 0) || 1;
  // Where each word ends, in seconds, and whether the phrasing breaks after it.
  let at = 0;
  const marks = words.map((w) => { at += ((w.length + 1) / total) * duration; return { t: at, breaks: /[,.;:!?]$/.test(w) }; });
  const lengths = [];
  let last = 0;
  for (const mark of marks) {
    const length = mark.t - last;
    if (length >= max || (mark.breaks && length >= min)) { lengths.push(length); last = mark.t; }
  }
  if (duration - last > 0.01) lengths.push(duration - last);
  // Too short a tail joins the cut before; too long a cut splits.
  const fixed = [];
  for (const length of lengths) {
    if (length < min && fixed.length) fixed[fixed.length - 1] += length;
    else if (length > max * 1.5) { const n = Math.ceil(length / max); for (let k = 0; k < n; k++) fixed.push(length / n); }
    else fixed.push(length);
  }
  const rounded = fixed.map((l) => Math.round(l * 1000) / 1000);
  rounded[rounded.length - 1] = Math.round((duration - rounded.slice(0, -1).reduce((s, l) => s + l, 0)) * 1000) / 1000;
  return rounded;
}

/** A recap without an intro opens on its most captivating clip. */
export function openOnBest(project, built, order, format = "long") {
  const plan = built.plan.formats[format];
  const edit = built.edit[format];
  if (!plan?.cuts.length || !edit || (project.script[format]?.beats || []).some((beat) => beat.teaser)) return built;
  const first = plan.cuts[0];
  const best = order.map((i) => ({ i, cut: plan.cuts[i] })).find(({ i, cut }) => i > 0 && cut && cut.end - cut.start >= first.duration - 0.01);
  if (!best) return built;
  const start = best.cut.start + (best.cut.end - best.cut.start - first.duration) / 2;
  const cuts = [{ ...first, start: Math.round(start * 1000) / 1000, end: Math.round((start + first.duration) * 1000) / 1000, flip: false, ...(best.cut.bw ? { bw: true } : {}) }, ...plan.cuts.slice(1)];
  const editCuts = [{ ...edit.cuts[0], start: cuts[0].start, hook: true }, ...edit.cuts.slice(1)];
  return { ...built, plan: { ...built.plan, formats: { ...built.plan.formats, [format]: { ...plan, cuts } } }, edit: { ...built.edit, [format]: { ...edit, cuts: editCuts } } };
}
/** Cut lengths for the intro montage: quick cuts of the best shots (seconds, shortest and longest). */
const INTRO_CUT = [0.9, 1.6];

/** A title, description, and tags YouTube accepts: it rejects a title over 100 characters, "<" or ">"
 *  anywhere in the title or description, a description over 5,000 bytes, and tags over 500 characters in
 *  all. */
export function youtubeSafeMetadata({ title, description, tags }) {
  const clean = (text) => String(text || "").replace(/[<>]/g, "").replace(/\s+\n/g, "\n").trim();
  let desc = clean(description);
  while (Buffer.byteLength(desc, "utf8") > 4900) desc = desc.slice(0, -50);
  const kept = [];
  let total = 0;
  for (const tag of (Array.isArray(tags) ? tags : []).map((t) => clean(t).replace(/,/g, " ").slice(0, 60)).filter(Boolean)) {
    // YouTube counts a tag with a space as if quoted (two characters more), plus a comma between tags.
    const cost = tag.length + (tag.includes(" ") ? 2 : 0) + (kept.length ? 1 : 0);
    if (total + cost > 480) break;
    kept.push(tag);
    total += cost;
  }
  return { title: clean(title).replace(/\s+/g, " ").slice(0, 100).trim(), description: desc, tags: kept };
}

/** The intro line the storyboard's Intro switch adds: two or three sentences teasing the film's most
 *  gripping moments, then naming it. */
export async function writeIntro(project, { request = requestOpenRouter, signal = undefined } = {}) {
  const beats = project.script?.long?.beats || [];
  const title = project.film?.title || String(project.options.filmTitle || "").replace(/\s*\(\d{4}\)\s*$/, "") || project.title;
  const year = project.film?.year;
  const model = process.env.MOVIE_RECAP_SCRIPT_MODEL || "google/gemini-3.8-flash";
  const { value } = await request({
    kind: "text", model, json: true, maxTokens: 800, temperature: 0.7, reasoningEffort: "low", signal,
    messages: [{ role: "user", content: `Write the opening line of a movie recap video, spoken over a fast montage of the film's best shots: two or three short, gripping sentences teasing its biggest moments (the danger, the twist, what is at stake) without giving away the ending and with no opinion, then "This is the ${year ? `${year} ` : ""}movie ${title}." Plain international English, about 35-50 words. The story, from the recap's script:\n${clip(project.script?.logline, 300)}\n${beats.slice(0, 40).map((beat) => beat.text).join(" ").slice(0, 6000)}\n\nReturn JSON {"text":"<the line>"}.` }],
    validate: (v) => { if (typeof v?.text !== "string" || v.text.trim().length < 20) throw new Error("No intro"); },
  });
  return clip(value.text, 600);
}

// A script that still opens with an intro (a welcome and a teaser, from before scripts opened straight on
// the story) shows a montage of the recap's best clips over it: the best-rated cuts from different
// scenes across the film, in story order. The one place a recap shows a moment twice.
export function fillTeaserMontage(project, built, format = "long", order = null, described = {}, analysis = null) {
  const beats = project.script[format]?.beats || [];
  const teaser = new Map(beats.filter((beat) => beat.teaser).map((beat) => [beat.id, beat]));
  const edit = built.edit[format];
  const plan = built.plan.formats[format];
  if (!teaser.size || !edit || !plan) return built;
  const slots = edit.cuts.map((cut, i) => (teaser.has(cut.beatId) ? i : -1)).filter((i) => i >= 0);
  const score = (cut) => (Number.isFinite(cut.fit) ? cut.fit * 100 : 150) + (Number.isFinite(cut.jev) ? cut.jev : 50);
  // Candidates: Jev's hook ranking when there is one (best first), else the best-matched clips.
  const ranked = order?.length
    ? order.filter((i) => edit.cuts[i] && !teaser.has(edit.cuts[i].beatId)).slice(0, 24)
    : edit.cuts.map((cut, i) => ({ cut, i })).filter(({ cut }) => !teaser.has(cut.beatId) && !cut.weak).sort((a, b) => score(b.cut) - score(a.cut)).slice(0, 24).map(({ i }) => i);
  // What each candidate shows: what the eye saw on its frame, else the nearest frame's description.
  const shotAt = (t) => analysis?.shots?.reduce((a, b) => (Math.abs(b.t - t) < Math.abs(a.t - t) ? b : a), analysis.shots[0]);
  const shows = (i) => order?.shows?.get(i) || described[shotAt(plan.cuts[i].start + plan.cuts[i].duration / 2)?.i] || "";
  // The words heard over each intro cut, from its captions.
  const said = (k) => edit.captions.filter((line) => line.end > edit.cuts[k].at + 0.05 && line.start < edit.cuts[k].at + edit.cuts[k].duration - 0.05).map((line) => line.text).join(" ");
  const chosen = new Map();
  const taken = [];
  for (const [n, k] of slots.entries()) {
    const words = new Set(lineWords(said(k)));
    const length = plan.cuts[k].duration;
    const fits = (i, apart) => plan.cuts[i].end - plan.cuts[i].start >= length - 0.01 && !taken.some((j) => j === i || Math.abs(plan.cuts[j].start - plan.cuts[i].start) < apart);
    // The opening cut takes the top-ranked clip; each cut after it the best mix of rank and a match to
    // the words heard over it ("a narrow ledge" over the ledge).
    const value = (i, rank) => (n === 0 ? 0 : lineWords(shows(i)).filter((w) => words.has(w)).length) + (1 - rank / ranked.length) * 1.5;
    let pick = null;
    for (const apart of [30, 8]) {
      let best = -Infinity;
      ranked.forEach((i, rank) => { if (fits(i, apart) && value(i, rank) > best) { best = value(i, rank); pick = i; } });
      if (pick !== null) break;
    }
    if (pick === null) break;
    chosen.set(k, pick);
    taken.push(pick);
  }
  if (chosen.size < slots.length) return built;
  const cuts = [...plan.cuts];
  const editCuts = [...edit.cuts];
  for (const [k, i] of chosen) {
    const source = plan.cuts[i];
    const length = cuts[k].duration;
    const start = source.start + (source.end - source.start - length) / 2;
    cuts[k] = { ...cuts[k], start: Math.round(start * 1000) / 1000, end: Math.round((start + length) * 1000) / 1000, ...(source.bw ? { bw: true } : {}), flip: false };
    const { jev, fit } = edit.cuts[i];
    editCuts[k] = { ...editCuts[k], start: cuts[k].start, ...(Number.isFinite(jev) ? { jev } : {}), ...(Number.isFinite(fit) ? { fit } : {}), weak: false, montage: true };
  }
  return { ...built, plan: { ...built.plan, formats: { ...built.plan.formats, [format]: { ...plan, cuts } } }, edit: { ...built.edit, [format]: { ...edit, cuts: editCuts } } };
}

// ---------- Jump cuts ----------
// Two cuts in a row from one camera shot (a few seconds skipped inside it) read as a jump cut. The worker
// compares the last frame of each cut with the first of the next (tiny frames evened out for brightness
// and contrast, scripts/movie_recap.py frame_difference): same-shot pairs score under about 50, a cut to
// another shot 75 and up. A jump cut's second cut moves on in the film to a later moment and the plan is
// rebuilt; one still jumping after two tries is flagged for the editor in Vibe Edit.
export const JUMP_DIFF = 55;
const JUMP_ROUNDS = 2;
const JUMP_SKIP = 8;

/** Indices of cuts that jump-cut from the cut before, from the worker's frame differences. */
export function jumpCutIndices(cuts, diffs, pairs) {
  return pairs.map((pair, n) => (Number.isFinite(diffs[n]) && diffs[n] < JUMP_DIFF ? pair.index : -1)).filter((i) => i >= 0);
}

/** Pairs to compare: each cut's end against the next cut's start, when the two are near in the film. */
export function jumpPairs(cuts, only = null) {
  const pairs = [];
  for (let i = 1; i < cuts.length; i++) {
    if (only && !only.has(i)) continue;
    // Far apart in the film, two cuts are never the same camera shot.
    if (Math.abs(cuts[i].start - cuts[i - 1].end) > 120) continue;
    pairs.push({ index: i, times: [Math.max(0, cuts[i - 1].end - 0.1), cuts[i].start + 0.1] });
  }
  return pairs;
}

/** Neighbouring frames that differ by this much may still be one camera setup a moment later (the same
 *  face, a little moved: Fall 2's #27 and #108 scored 70-71); the vision model judges those. */
export const JUMP_MAYBE = 85;
const JUMP_RUBRIC = "Each pair is the last frame of one clip (A) and the first frame of the next clip (B) in a movie recap. For each pair, say whether the cut from A to B is a jump cut: B shows the same subject from the same or nearly the same camera angle and framing, so the cut looks like a skip in time rather than a new shot. A cut to a different person, a different angle (a reverse shot, wide to close), or a different place is not a jump cut.";

/** Which borderline pairs (frames A and B per pair) the vision model sees as jump cuts. */
export async function confirmJumps(framePairs, { signal = undefined, request = requestOpenRouter } = {}) {
  const model = process.env.MOVIE_RECAP_VISION_MODEL || "google/gemini-3.8-flash";
  const jumps = new Set();
  for (let i = 0; i < framePairs.length; i += 8) {
    const content = [{ type: "text", text: `${JUMP_RUBRIC} Return JSON {"pairs":[{"n":<number>,"jump":true|false}]} for every pair.` }];
    for (let n = i; n < Math.min(framePairs.length, i + 8); n++) {
      const [a, b] = framePairs[n];
      if (!a || !b) continue;
      content.push({ type: "text", text: `Pair ${n} A:` }, { type: "image_url", image_url: { url: `data:image/jpeg;base64,${a.toString("base64")}` } }, { type: "text", text: `Pair ${n} B:` }, { type: "image_url", image_url: { url: `data:image/jpeg;base64,${b.toString("base64")}` } });
    }
    if (content.length < 2) continue;
    const { value } = await request({ kind: "vision", model, json: true, maxTokens: 1000, temperature: 0, reasoningEffort: "low", signal, messages: [{ role: "user", content }], validate: (v) => { if (!Array.isArray(listOf(v, "pairs"))) throw new Error("No pairs"); } });
    for (const pair of listOf(value, "pairs")) if (pair?.jump === true && Number.isInteger(Number(pair.n))) jumps.add(Number(pair.n));
  }
  return jumps;
}

export async function fixJumpCuts(project, analysis, built, matches, { compare, look = null, signal = undefined }) {
  let current = built;
  const flagged = {};
  for (const format of Object.keys(current.plan.formats)) {
    let only = null;
    for (let round = 0; round <= JUMP_ROUNDS; round++) {
      signal?.throwIfAborted();
      const cuts = current.plan.formats[format].cuts;
      const pairs = jumpPairs(cuts, only);
      if (!pairs.length) { flagged[format] = []; break; }
      const diffs = await compare(pairs.map((pair) => pair.times));
      const jumps = jumpCutIndices(cuts, diffs, pairs);
      // Borderline pairs: the vision model looks at both frames.
      const maybe = pairs.filter((pair, n) => Number.isFinite(diffs[n]) && diffs[n] >= JUMP_DIFF && diffs[n] < JUMP_MAYBE);
      if (look && maybe.length) {
        try {
          const { frames } = await look(maybe.flatMap((pair) => pair.times));
          const confirmed = await confirmJumps(maybe.map((_, n) => [frames[n * 2], frames[n * 2 + 1]]), { signal });
          maybe.forEach((pair, n) => { if (confirmed.has(n) && !jumps.includes(pair.index)) jumps.push(pair.index); });
        } catch (error) {
          if (signal?.aborted) throw error;
          console.warn(`[movie-recap] jump-cut look skipped: ${error.message}`);
        }
      }
      flagged[format] = jumps;
      if (!jumps.length || round === JUMP_ROUNDS) break;
      // Move the second cut of each jump on to a later moment of its line's film.
      const next = { ...matches, [format]: { ...(matches[format] || {}) } };
      Object.defineProperty(next, "jevScores", { value: matches.jevScores, enumerable: false });
      const editCuts = current.edit[format].cuts;
      for (const i of jumps) {
        const beatId = editCuts[i].beatId;
        const lineCuts = editCuts.map((cut, k) => ({ cut, k })).filter(({ cut }) => cut.beatId === beatId);
        const slot = lineCuts.findIndex(({ k }) => k === i);
        const anchors = next[format][beatId] ? [...next[format][beatId]] : lineCuts.map(({ k }) => cuts[k].start + cuts[k].duration / 2);
        anchors[slot] = cuts[i].start + cuts[i].duration / 2 + JUMP_SKIP;
        next[format][beatId] = anchors;
      }
      matches = next;
      const rebuilt = buildRecapPlan(project, analysis, matches);
      current = { ...current, plan: { ...current.plan, formats: { ...current.plan.formats, [format]: rebuilt.plan.formats[format] } }, stats: { ...current.stats, [format]: rebuilt.stats[format] }, edit: { ...current.edit, [format]: rebuilt.edit[format] } };
      only = new Set(jumps.flatMap((i) => [i, i + 1]));
    }
  }
  // Jump cuts left after the tries arrive flagged in Vibe Edit, like weak matches.
  const edit = { ...current.edit };
  const stats = { ...current.stats };
  for (const [format, jumps] of Object.entries(flagged)) {
    if (!edit[format]) continue;
    const marked = new Set(jumps);
    edit[format] = { ...edit[format], cuts: edit[format].cuts.map((cut, i) => (marked.has(i) ? { ...cut, jump: true, weak: true } : cut)) };
    stats[format] = { ...stats[format], jumpCuts: jumps.length };
  }
  return { ...current, edit, stats, matches };
}

// Editing standard: the film's own subtitles never show. Frames with them are allowed when they are the
// best match, and every cut near a subtitled frame, or (in a subtitled film) over spoken dialogue, gets
// its subtitle band blurred at render.
export function markSubtitledCuts(plan, analysis, described) {
  const tagged = analysis.shots.filter((shot) => described[`tag:${shot.i}`]);
  const subtitled = tagged.filter((shot) => described[`tag:${shot.i}`].u);
  if (!subtitled.length) return plan;
  const wholeFilm = subtitled.length >= tagged.length * 0.15;
  const lines = wholeFilm ? (analysis.transcript || []).filter((line) => line.text) : [];
  const near = (cut) =>
    subtitled.some((shot) => shot.t > cut.start - 1.5 && shot.t < cut.end + 1.5) ||
    lines.some((line) => line.start < cut.end + 0.5 && line.end > cut.start - 0.5);
  const formats = {};
  for (const [format, spec] of Object.entries(plan.formats)) formats[format] = { ...spec, cuts: spec.cuts.map((cut) => (near(cut) ? { ...cut, subs: true } : cut)) };
  return { ...plan, formats };
}

// Captions are set in Montserrat (OFL), shipped with the app and sent along with the narration.
const CAPTION_FONT = "Montserrat.ttf";
const captionFontPath = () => ["dist/fonts/captions", "public/fonts/captions"].map((dir) => path.resolve(dir, CAPTION_FONT)).find((file) => fsSync.existsSync(file));

// The camera-cut threshold the worker searches films at (scripts/movie_recap.py SHOT_THRESHOLD): cuts found
// at another are found again.
const SHOT_THRESHOLD = 5;

/** Real frames from the film on the media worker, one per time (null where unreadable), and its aspect. */
async function lookAt(userId, project, times, signal) {
  const out = await scratch(userId, project.id, "check");
  try {
    const result = await worker(["frames", "--project", project.id, "--options", JSON.stringify({ times: times.map((t) => Math.round(t * 1000) / 1000) }), "--out", out], { timeoutMs: 15 * 60 * 1000, signal });
    return { frames: await Promise.all(result.frames.map((name) => (name ? fs.readFile(path.join(out, name)).catch(() => null) : null))), aspect: Number(result.aspect) || 16 / 9 };
  } finally {
    await fs.rm(out, { recursive: true, force: true });
  }
}

/** The film's own title as its opening shows it (the main title card), read off frames with on-screen
 *  text in the first minutes; "" when none shows it. */
export async function readScreenTitle(analysis, described, look, { signal = undefined, request = requestOpenRouter } = {}) {
  const opening = Math.min(analysis.duration * 0.15, 900);
  let shots = analysis.shots.filter((shot) => shot.t < opening && described[`tag:${shot.i}`]?.t);
  // No tagged title cards: a spread of the first five minutes.
  if (!shots.length) shots = analysis.shots.filter((shot, i) => shot.t < 300 && i % 7 === 0);
  if (!shots.length) return "";
  const step = Math.max(1, Math.ceil(shots.length / 16));
  const times = shots.filter((_, i) => i % step === 0).slice(0, 16).map((shot) => shot.t);
  const { frames } = await look(times);
  const content = [{ type: "text", text: "These frames are from the opening of a film. If one shows the film's own title (its main title card), return it exactly as written. A studio or distributor logo, a person's name, a credit, or a sign in the scene is not the title. Return JSON {\"title\": \"<the title>\" or null}." }];
  frames.forEach((frame, n) => frame && content.push({ type: "text", text: `Frame ${n}:` }, { type: "image_url", image_url: { url: `data:image/jpeg;base64,${frame.toString("base64")}` } }));
  if (content.length < 2) return "";
  const model = process.env.MOVIE_RECAP_VISION_MODEL || "google/gemini-3.8-flash";
  const { value } = await request({ kind: "vision", model, json: true, maxTokens: 300, temperature: 0, reasoningEffort: "low", signal, messages: [{ role: "user", content }], validate: (v) => { if (!v || typeof v !== "object") throw new Error("No answer"); } });
  return typeof value.title === "string" ? clip(value.title, 120) : "";
}

/** Stops a render up front when the AI provider can't take requests (out of credits): matching, the
 *  real-frame checks, the opening ranking, and the jump-cut and name-card checks all run on it, and
 *  without it a render quietly fell back to worse choices (Fall 2 opened on a scrapbook). */
export async function checkAiCredits({ request = requestOpenRouter, signal = undefined } = {}) {
  try {
    await request({ kind: "text", model: process.env.MOVIE_RECAP_SCRIPT_MODEL || "google/gemini-3.8-flash", maxTokens: 5, temperature: 0, signal, messages: [{ role: "user", content: "Reply OK." }] });
  } catch (error) {
    if (signal?.aborted) throw error;
    if (/\b402\b|insufficient credits|out of credits/i.test(String(error?.message || error)))
      throw fail("OpenRouter is out of credits, so the footage matching and the checks can't run. Add credits at openrouter.ai/settings/credits, then press Try again.", 402);
  }
}

async function stagePlanAndRender(userId, project, signal) {
  if (!project.remote?.renderStarted) {
    await checkAiCredits({ signal });
    await report(userId, project, "Matching footage to every line", 0.83);
    const analysis = await readJson(userId, project.id, "analysis.json");
    const described = await readJson(userId, project.id, "descriptions.json", {});
    // Every camera cut in the film, so each clip stays inside one shot. Recaps analysed before shots were
    // recorded get them now (one pass over the film on the media worker, about 7 minutes for 98 minutes).
    if (!Array.isArray(analysis.shotCuts) || analysis.shotThreshold !== SHOT_THRESHOLD) {
      await report(userId, project, "Finding every camera shot in the film", 0.83);
      try {
        const found = await worker(["shots", "--project", project.id], { timeoutMs: 90 * 60 * 1000, signal });
        analysis.shotCuts = found.shotCuts || [];
        analysis.shotThreshold = found.threshold;
        await writeJson(userId, project.id, "analysis.json", analysis);
      } catch (error) {
        if (signal.aborted) throw error;
        console.warn(`[movie-recap] shot detection skipped: ${error.message}`);
      }
    }
    // Credits, titles, and logos never reach a recap: every frame showing on-screen text is kept clear of
    // cuts, and cuts near the edges are checked again on real frames.
    prepareCutRules(analysis, described);
    // Lines placed by what they say before any footage is matched: covers scripts written before the
    // check and lines changed on the storyboard.
    await save(userId, project, { script: placeScript(project.script, analysis, described) });
    const first = buildRecapPlan(project, analysis);
    let matches = await matchCutsToFrames(project, analysis, described, first.edit, { signal });
    let { plan, stats, edit } = buildRecapPlan(project, analysis, matches);
    const look = (times) => lookAt(userId, project, times, signal);
    await report(userId, project, "Checking no credits or titles made it in", 0.831);
    try {
      const fixed = await fixTextCuts(project, analysis, { plan, stats, edit }, matches, { look, signal });
      ({ plan, stats, edit } = fixed);
      matches = fixed.matches;
    } catch (error) {
      if (signal.aborted) throw error;
      console.warn(`[movie-recap] credits check skipped: ${error.message}`);
    }
    await report(userId, project, "Looking at every cut next to its narration", 0.8315);
    try {
      const checked = await checkMatchesVisually(project, analysis, described, { plan, stats, edit }, matches, { look, signal });
      ({ plan, stats, edit } = checked);
      matches = checked.matches;
    } catch (error) {
      if (signal.aborted) throw error;
      console.warn(`[movie-recap] visual match check skipped: ${error.message}`);
    }
    await report(userId, project, "Checking for jump cuts", 0.832);
    try {
      const compare = async (pairs) => (await worker(["similar", "--project", project.id, "--options", JSON.stringify({ pairs: pairs.map((p) => p.map((t) => Math.round(t * 1000) / 1000)) })], { timeoutMs: 15 * 60 * 1000, signal })).diffs || [];
      const fixed = await fixJumpCuts(project, analysis, { plan, stats, edit }, matches, { compare, look, signal });
      ({ plan, stats, edit } = fixed);
      matches = fixed.matches;
    } catch (error) {
      if (signal.aborted) throw error;
      console.warn(`[movie-recap] jump-cut check skipped: ${error.message}`);
    }
    // The opening: Jev ranks the clips as a hook; an intro plays the top four or five, a recap without one
    // opens on the best.
    if (edit.long) {
      await report(userId, project, "Choosing the opening shots", 0.8335);
      const order = await rankCaptivating(project, analysis, described, edit.long, { look, signal }).catch((error) => {
        if (signal.aborted) throw error;
        console.warn(`[movie-recap] hook ranking skipped: ${error.message}`);
        return null;
      });
      ({ plan, stats, edit } = fillTeaserMontage(project, { plan, stats, edit }, "long", order, described, analysis));
      if (order) ({ plan, stats, edit } = openOnBest(project, { plan, stats, edit }, order));
    }
    if (plan.formats.short?.cuts.length) {
      await report(userId, project, "Checking the main character is centred in every Short cut", 0.835);
      try {
        ({ plan, stats, edit } = await centreShortCuts(project, analysis, described, { plan, stats, edit }, matches, { look, signal }));
      } catch (error) {
        if (signal.aborted) throw error;
        // Without the check the Short still renders, cropped to the middle of the frame.
        console.warn(`[movie-recap] centring check skipped: ${error.message}`);
      }
    }
    plan = markSubtitledCuts(plan, analysis, described);
    const work = await scratch(userId, project.id, "render");
    const audio = path.join(work, "audio");
    await fs.mkdir(audio, { recursive: true });
    for (const format of Object.keys(plan.formats))
      for (const name of plan.formats[format].audioFiles) await fs.copyFile(path.join(audioDir(userId, project.id), name), path.join(audio, name));
    const font = captionFontPath();
    if (font) await fs.copyFile(font, path.join(audio, CAPTION_FONT));
    else delete plan.font;
    if (plan.formats.long && project.options.graphics !== false) {
      const graphics = await prepareGraphics(userId, project, edit.long, path.join(audio, "graphics"), signal).catch((error) => {
        if (signal.aborted) throw error;
        console.warn(`[movie-recap] motion graphics skipped: ${error.message}`);
        return null;
      });
      if (graphics) {
        plan.formats.long.graphics = graphics.batches;
        plan.watermark = graphics.watermark;
        await save(userId, project, { graphics: graphics.summary });
      }
    }
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
  const resume = () => worker(["start-render", "--project", project.id], { timeoutMs: 20 * 60 * 1000, signal });
  const status = await waitForWorker(userId, project, "render", { from: 0.85, to: 0.97, signal, resume });
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
    // Lets Vibe Edit ask this recap for a better shot for any cut.
    source: { kind: "recap", recapId: project.id, format },
    assets: [
      { id: "recap_picture", kind: "video", name: "Recap cuts", url: picture.url, file: picture.file, ...(picture.remote ? { remote: picture.remote } : {}), duration: picture.duration, width: short ? 1080 : 1920, height: short ? 1920 : 1080, origin: "generated" },
      { id: "recap_voice", kind: "audio", name: "Narration", url: voice.url, file: voice.file, duration: voice.duration, origin: "voiceover" },
      ...(music ? [{ id: "recap_music", kind: "audio", name: "Music bed", url: music.url, file: music.file, duration: music.duration, origin: "music" }] : []),
    ],
    // Cuts the classifier rated weak arrive flagged, ready for "Replace all flagged shots".
    clips: edit.cuts.map((cut, i) => ({ id: `cut${i}`, assetId: "recap_picture", track: 0, start: cut.at, in: cut.at, out: Math.round((cut.at + cut.duration) * 1000) / 1000, fit: "fill", match: { film: cut.start, ...(Number.isFinite(cut.jev) ? { score: cut.jev } : {}) }, ...(cut.weak ? { flagged: true } : {}), ...(cut.text ? { note: "Shows credits or a title: replace this shot" } : cut.angle ? { note: "The camera angle changes partway through this clip" } : cut.fit !== undefined && cut.fit <= 1 ? { note: "May not show what the narration says here" } : cut.jump ? { note: "Jump cut: the same camera shot as the cut before" } : {}) })),
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

/** The quality gate's verdict on a finished recap, from the worker's measurements of the final file. */
export function recapQa(project, output) {
  const short = output.format === "short";
  const info = { duration: output.duration, width: short ? 1080 : 1920, height: short ? 1920 : 1080, fps: 30, video: "h264", pixFmt: "yuv420p", audio: "aac" };
  const cues = project.options.captions !== false ? project.edit?.[output.format]?.captions || [] : [];
  const { verdict, findings, numbers } = judgeVideo({ measurements: parseMeasurements(output.qa), info, cues, platform: short ? "youtube-shorts" : "youtube" });
  return { verdict, findings: findings.slice(0, 12), lufs: numbers.lufs, truePeak: numbers.truePeak };
}

async function stageFinish(userId, project, signal) {
  const outputs = [];
  const media = {};
  // The finished video and the edit's picture track are hundreds of MB: they stay on the media worker
  // and are served from there (server/vpsMedia.js). The hosted app has 512 MB with /tmp in RAM, and
  // pulling a 10-minute recap's files into it crashed it into a restart loop.
  const onWorker = mediaAvailable();
  for (const output of project.rendered || []) {
    const label = output.format === "short" ? "Short" : "long recap";
    await report(userId, project, output.kind === "final" ? `Delivering the ${label}` : `Preparing the ${label} for Vibe Edit`, 0.97);
    if (onWorker && output.kind !== "narration") {
      const published = await worker(["publish", "--project", project.id, "--name", output.name], { timeoutMs: 10 * 60 * 1000, signal });
      if (output.kind === "final") {
        outputs.push({ format: output.format, file: output.name, remote: published.path, size: published.size || output.size, duration: output.duration, ...(output.qa ? { qa: recapQa(project, output) } : {}) });
      } else {
        const url = `/api/recaps/${project.id}/media/${encodeURIComponent(output.name)}`;
        media[output.format] = { ...media[output.format], picture: { file: "", url, remote: published.path, duration: output.duration } };
      }
      continue;
    }
    const out = await scratch(userId, project.id, "fetch");
    await worker(["fetch", "--project", project.id, "--name", output.name, "--out", out], { timeoutMs: 60 * 60 * 1000, signal });
    const fetched = path.join(out, output.name);
    if (output.kind === "final") {
      const name = `${output.format === "short" ? "short" : "long"}-${crypto.randomBytes(3).toString("hex")}.mp4`;
      const file = path.join(projectDir(userId, project.id), name);
      await fs.rename(fetched, file);
      await persist(userId, project.id, file);
      outputs.push({ format: output.format, file: name, size: output.size, duration: output.duration, ...(output.qa ? { qa: recapQa(project, output) } : {}) });
    } else {
      const adopted = await adoptStudioMedia(userId, fetched, output.kind === "picture" ? "mp4" : "m4a");
      media[output.format] = { ...media[output.format], [output.kind]: { ...adopted, duration: output.duration } };
    }
    await fs.rm(out, { recursive: true, force: true });
  }
  // The finished picture's cut check: clips whose angle changes partway through, and jump cuts, arrive
  // flagged in Vibe Edit and counted on the result.
  const edit = { ...(project.edit || {}) };
  const stats = { ...(project.stats || {}) };
  for (const output of project.rendered || []) {
    if (output.kind !== "final" || !output.cuts || !edit[output.format]) continue;
    const angle = new Set(output.cuts.angleChanges || []);
    const jumps = new Set(output.cuts.jumpCuts || []);
    // Borderline neighbours: the vision model looks at both sides of the cut, on frames from the film.
    const maybe = (output.cuts.maybeJumps || []).filter((i) => i > 0 && edit[output.format].cuts[i] && edit[output.format].cuts[i - 1]);
    if (maybe.length) {
      try {
        const cuts = edit[output.format].cuts;
        const times = maybe.flatMap((i) => [cuts[i - 1].start + cuts[i - 1].duration - 0.07, cuts[i].start + 0.07]);
        const { frames } = await lookAt(userId, project, times, signal);
        const confirmed = await confirmJumps(maybe.map((_, n) => [frames[n * 2], frames[n * 2 + 1]]), { signal });
        maybe.forEach((i, n) => confirmed.has(n) && jumps.add(i));
      } catch (error) {
        if (signal.aborted) throw error;
        console.warn(`[movie-recap] jump-cut look skipped: ${error.message}`);
      }
    }
    edit[output.format] = { ...edit[output.format], cuts: edit[output.format].cuts.map((cut, i) => (angle.has(i) || jumps.has(i) ? { ...cut, ...(angle.has(i) ? { angle: true } : {}), ...(jumps.has(i) ? { jump: true } : {}), weak: true } : cut)) };
    stats[output.format] = { ...stats[output.format], angleChanges: angle.size, jumpCuts: jumps.size, weak: edit[output.format].cuts.filter((cut) => cut.weak).length };
  }
  project.edit = edit;
  project.stats = stats;
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
  await save(userId, project, { stage: "done", status: "done", outputs, vibe, edit, stats, message: "", progress: 1, remote: { ...project.remote, renderStarted: false } });
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
  const { id, title, status, stage, message, progress, error, options, film, outputs, stats, createdAt, updatedAt, source, vibe, graphics, clock, poster, posts } = project;
  // A post still "uploading" an hour on was cut off (the server restarted under it): say so.
  const shownPosts = (posts || []).map((post) => (post.status === "uploading" && Date.now() - post.at > 60 * 60 * 1000 ? { ...post, status: "failed", error: "The upload was interrupted (the server restarted). Post again." } : post));
  return { id, title, status, stage, message, progress, error, options, film, graphics, poster: poster || null, posts: shownPosts, vibe: vibe || {}, serverNow: Date.now(),
    clock: clock ? { workMs: clock.workMs, since: clock.since, steps: clock.steps, log: (clock.log || []).slice(-12) } : null, outputs: (outputs || []).map((o) => ({ ...o, url: `/api/recaps/${id}/files/${o.file}` })), stats, createdAt, updatedAt, source: { kind: source.kind, name: source.name } };
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

  // Your own film sources: sites saved by name and link, searched together to find a film.
  const sourcesFile = (userId) => path.join(root(), userKey(userId), "sources.json");
  const sourcesKey = (userId) => `recaps/${userKey(userId)}/sources.json`;
  async function readSources(userId) {
    const file = sourcesFile(userId);
    await ensureFile(sourcesKey(userId), file);
    try { return JSON.parse(await fs.readFile(file, "utf8")); } catch { return []; }
  }
  app.get("/api/recaps/sources", route(async (req, res, userId) => {
    res.json({ sources: await readSources(userId) });
  }));
  app.put("/api/recaps/sources", route(async (req, res, userId) => {
    const list = Array.isArray(req.body?.sources) ? req.body.sources : [];
    if (list.length > MAX_SOURCES) throw fail(`Save up to ${MAX_SOURCES} sources.`);
    const sources = list.map(normalizeSource);
    const file = sourcesFile(userId);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(sources));
    if (assetStoreConfigured()) await saveFile(sourcesKey(userId), file).catch((error) => console.warn(`[movie-recap] could not store sources: ${error.message}`));
    res.json({ sources });
  }));
  app.post("/api/recaps/sources/search", route(async (req, res, userId) => {
    const sources = await readSources(userId);
    if (!sources.length) throw fail("Add a source first.");
    if (!deps.fetcher) throw fail("Searching isn't available on this server.", 503);
    res.json({ results: await searchSources(sources, req.body?.query, { fetcher: deps.fetcher }) });
  }));

  app.get("/api/recaps", route(async (_req, res, userId) => {
    const list = [];
    const missing = [];
    for (const id of (await index(userId)).slice(0, 40)) {
      try {
        const project = await load(userId, id);
        list.push(summary(project));
        if (project.poster === undefined && project.film && project.status !== "working") missing.push(project);
      } catch {}
    }
    // Recaps made before posters were kept pick theirs up in the background, a few at a time.
    for (const project of missing.slice(0, 4)) backfillPoster(userId, project);
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
        graphics: body.graphics !== false,
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

  // Stills from the film (TMDB backdrops without text) for the progress screen's slideshow.
  app.get("/api/recaps/:id/backdrops", route(async (req, res, userId) => {
    const project = await load(userId, req.params.id);
    const { tmdbId, images } = await filmStills(userId, project);
    res.setHeader("Cache-Control", "no-store");
    res.json({ images, tmdbId: tmdbId || null });
  }));

  app.get("/api/recaps/:id", route(async (req, res, userId) => {
    const project = await load(userId, req.params.id);
    if (project.poster === undefined && project.film && project.status !== "working") backfillPoster(userId, project);
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

  // Post a finished recap to one of the user's channels, the way automation agents post: their connected
  // channels, a title, description, and tags written in that channel's style, and the upload, which streams
  // from the media worker so the hosted app never holds the file.
  app.get("/api/recaps/:id/post/channels", route(async (req, res, userId) => {
    await load(userId, req.params.id);
    if (!deps.channels) throw fail("Posting isn't set up on this server.", 503);
    const accounts = await deps.channels(userId);
    res.json({ channels: accounts.map((a) => ({ id: a.id, title: a.channelTitle || a.channelHandle || a.email || "Channel", handle: a.channelHandle || "", platform: a.platform || "youtube", thumbnail: a.thumbnailUrl || "" })) });
  }));

  app.post("/api/recaps/:id/post/draft", route(async (req, res, userId) => {
    const project = await load(userId, req.params.id);
    if (!deps.postMetadata) throw fail("Posting isn't set up on this server.", 503);
    const format = req.body?.format === "short" ? "short" : "long";
    const accountId = clip(req.body?.accountId, 120);
    if (!accountId) throw fail("Choose a channel.");
    const beats = project.script?.[format]?.beats || [];
    const movie = {
      title: project.film?.title || project.options.filmTitle || project.title,
      summary: [project.script?.logline, format === "short" ? project.script?.short?.title : project.script?.title].filter(Boolean).join(" "),
      genre: "",
      // The narration stands in for the transcript: it is what the video says.
      transcript: { fullText: beats.map((beat) => beat.text).join(" ") },
      ...(project.film?.year ? { year: project.film.year } : {}),
    };
    const meta = await withUsageUser(userId, "tools:movie-recap-post", () => deps.postMetadata(userId, accountId, movie));
    res.json({ draft: { title: clip(meta.title, 150), description: String(meta.description || "").slice(0, 4500), tags: (meta.tags || []).slice(0, 15).map((t) => clip(t, 60)) } });
  }));

  app.post("/api/recaps/:id/post", route(async (req, res, userId) => {
    const project = await load(userId, req.params.id);
    if (!deps.publishUrl) throw fail("Posting isn't set up on this server.", 503);
    const format = req.body?.format === "short" ? "short" : "long";
    const output = (project.outputs || []).find((o) => o.format === format);
    if (!output) throw fail("This format hasn't been rendered.", 409);
    if (!output.remote) throw fail("Render the recap again to post it (older renders aren't on the media server).", 409);
    const url = signedMediaUrl(output.remote, { ttl: 12 * 3600 });
    if (!url) throw fail("The media server isn't reachable right now. Try again in a minute.", 503);
    const accountId = clip(req.body?.accountId, 120);
    const title = clip(req.body?.title, 150);
    if (!accountId || !title) throw fail("Choose a channel and give the video a title.");
    const metadata = { ...youtubeSafeMetadata({ title, description: req.body?.description, tags: req.body?.tags }), privacyStatus: ["public", "unlisted", "private"].includes(req.body?.privacy) ? req.body.privacy : "private" };
    const post = { id: `post_${crypto.randomBytes(5).toString("hex")}`, format, accountId, channel: clip(req.body?.channel, 120), title, privacy: metadata.privacyStatus, status: "uploading", at: Date.now() };
    await save(userId, project, { posts: [post, ...(project.posts || [])].slice(0, 20) });
    res.status(202).json({ recap: { ...summary(project), script: project.script || null } });
    // The upload runs on after the reply (a 300 MB recap takes a few minutes); the recap records how it went.
    void withUsageUser(userId, "tools:movie-recap-post", () => deps.publishUrl(userId, accountId, metadata, url))
      .then(async (result) => {
        const current = await load(userId, project.id);
        await save(userId, current, { posts: (current.posts || []).map((p) => (p.id === post.id ? { ...p, status: "posted", url: result.url || "", provider: result.provider } : p)) });
      })
      .catch(async (error) => {
        console.warn(`[movie-recap] post failed: ${error.message}${error.cause ? ` (${error.cause.message || error.cause})` : ""}`);
        const current = await load(userId, project.id).catch(() => null);
        // fetch reports "fetch failed" with the real reason underneath.
        const reason = error instanceof Error ? (error.cause?.message ? `${error.message}: ${error.cause.message}` : error.message) : String(error);
        if (current) await save(userId, current, { posts: (current.posts || []).map((p) => (p.id === post.id ? { ...p, status: "failed", error: clip(publicMessage(reason), 300) } : p)) });
      });
  }));

  // The storyboard's Intro switch: on, a teaser line goes first and plays over a quick montage of the
  // recap's best shots; off, the intro goes (new scripts open straight on the story).
  app.post("/api/recaps/:id/intro", route(async (req, res, userId) => {
    const project = await load(userId, req.params.id);
    if (!project.script?.long?.beats?.length) throw fail("Only a long recap has an intro.", 409);
    if (project.status === "working") throw fail("Wait for the current step to finish before editing.", 409);
    const beats = project.script.long.beats;
    const free = teaserLines(beats);
    const rest = beats.filter((_, k) => !free[k]);
    let next = rest;
    if (req.body?.on === true) {
      const text = await withUsageUser(userId, "tools:movie-recap", () => writeIntro({ ...project, script: { ...project.script, long: { ...project.script.long, beats: rest } } }));
      const film = project.film?.duration || 0;
      next = [{ id: `intro${crypto.randomBytes(2).toString("hex")}`, text, from: Math.round(film * 0.6), to: Math.round(film * 0.6) + 60, shots: [], teaser: true }, ...rest];
    }
    await save(userId, project, { script: { ...project.script, long: { ...project.script.long, beats: next } }, options: { ...project.options, intro: req.body?.on === true } });
    res.json({ recap: { ...summary(project), script: project.script } });
  }));

  // Correct character names: a script written before the cast list was used (or with names the transcript
  // misheard) has its names set to the film's cast from TMDB, and nothing else changed.
  app.post("/api/recaps/:id/names", route(async (req, res, userId) => {
    const project = await load(userId, req.params.id);
    if (!project.script) throw fail("The script isn't written yet.");
    if (project.status === "working") throw fail("Wait for the current step to finish before editing.", 409);
    const cast = await recapCast(userId, project);
    if (!cast.length) throw fail("This film's cast isn't known, so there are no names to check against.", 409);
    const corrected = await withUsageUser(userId, "tools:movie-recap", () => correctNames(project.script, cast, project.options.formats));
    await save(userId, project, { script: corrected.script });
    res.json({ recap: { ...summary(project), script: project.script }, changed: corrected.changed });
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
        return { id: String(beat?.id || `n${i}`), text: clip(beat?.text, 600), from: Math.round(from), to: Math.round(clamp(beat?.to ?? prior.to, from + 5, film, from + 60)), shots: Array.isArray(prior.shots) ? prior.shots : [], ...(prior.teaser ? { teaser: true } : {}) };
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
    // Captions can be switched on or off from the storyboard, right before rendering.
    if (typeof req.body?.captions === "boolean") project.options.captions = req.body.captions;
    await save(userId, project, { stage: "voicing", status: "queued", error: "", message: "Queued", progress: 0.75, remote: { ...project.remote, renderStarted: false } });
    start(userId, project.id);
    res.status(202).json({ recap: summary(project) });
  }));

  app.post("/api/recaps/:id/retry", route(async (req, res, userId) => {
    const project = await load(userId, req.params.id);
    // A recap that has said nothing new for a while can be restarted from where it is.
    const quiet = Date.now() - Date.parse(project.updatedAt || 0) > STUCK_MS;
    if (project.status === "working" && !quiet) throw fail("This recap is already working.", 409);
    // A retry can switch the narrator (a cloud voice that hit its rate limit, or a slow cloned voice).
    if (typeof req.body?.voiceId === "string" && req.body.voiceId && req.body.voiceId !== project.options.voiceId) {
      if (deps.voiceAllowed && !(await deps.voiceAllowed(userId, req.body.voiceId))) throw fail("That voice isn't available. Pick another voice.", 403);
      project.options.voiceId = clip(req.body.voiceId, 200);
    }
    running.get(project.id)?.abort(new Error("Restarting"));
    running.delete(project.id);
    await save(userId, project, { status: "queued", error: "", message: "Retrying", remote: project.stage === "analyzing" ? {} : project.remote });
    start(userId, project.id);
    res.status(202).json({ recap: summary(project) });
  }));

  // Back to the storyboard: stops the render (narration, cutting) and reopens the script with its settings,
  // so the editor can change lines or the narrator and render again. The analysis and script are kept.
  app.post("/api/recaps/:id/back", route(async (req, res, userId) => {
    const project = await load(userId, req.params.id);
    if (!project.script) throw fail("The script isn't written yet. Stop the recap instead.", 409);
    running.get(project.id)?.abort(new Error("Back to the storyboard"));
    running.delete(project.id);
    await worker(["stop", "--project", project.id], { timeoutMs: 2 * 60 * 1000 }).catch(() => null);
    await save(userId, project, { stage: "review", status: "review", error: "", message: "Script ready for review", progress: 0.75, remote: { ...project.remote, renderStarted: false } });
    res.json({ recap: { ...summary(project), script: project.script } });
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
    // The stored narration lines.
    for (const format of project.options.formats) for (const beat of project.script?.[format]?.beats || []) for (const ext of ["wav", "mp3"])
      await removeFile(storeKey(userId, project.id, `line-${beatHash(project.options.voiceId, beat.text)}.${ext}`)).catch(() => {});
    await fs.rm(projectDir(userId, project.id), { recursive: true, force: true });
    res.json({ ok: true });
  }));

  // "Find a better shot": an editor flags one cut of a finished recap (with an optional note), and the AI
  // picks a better frame for the words spoken over it, from nearby in the film (in order for a long recap);
  // the media worker cuts that shot with the same look, and Vibe Edit swaps it in.
  app.post("/api/recaps/:id/recut", route(async (req, res, userId) => {
    const project = await load(userId, req.params.id);
    const format = req.body?.format === "short" ? "short" : "long";
    const index = Math.round(Number(req.body?.index));
    const note = clip(req.body?.note, 400);
    const edit = project.edit?.[format];
    if (!edit?.cuts?.[index]) throw fail("That shot isn't part of this recap.", 404);
    if (!mediaAvailable()) throw fail("The media server is reconnecting. Try again in a minute.", 503);
    const chosen = Number(req.body?.t);
    const result = await withUsageUser(userId, "tools:movie-recap", async () => {
      if (!Number.isFinite(chosen)) return findBetterShot(userId, project, format, index, note);
      const analysis = await readJson(userId, project.id, "analysis.json");
      const { start, end } = storyRange(analysis);
      if (chosen < start || chosen > end) throw fail("That moment is outside the film's story.", 400);
      return { asset: await cutShotAt(userId, project, format, index, chosen), frame: { t: chosen } };
    });
    res.json(result);
  }));

  // The best shots for one cut's narration, ranked and classed by Jev, for an editor to choose from.
  app.post("/api/recaps/:id/shots", route(async (req, res, userId) => {
    const project = await load(userId, req.params.id);
    const format = req.body?.format === "short" ? "short" : "long";
    const index = Math.round(Number(req.body?.index));
    if (!project.edit?.[format]?.cuts?.[index]) throw fail("That shot isn't part of this recap.", 404);
    res.json(await withUsageUser(userId, "tools:movie-recap", () => rankShotsForCut(userId, project, format, index, clip(req.body?.note, 400))));
  }));

  // The Vibe Edit picture track of a recap, kept on the media worker.
  app.get("/api/recaps/:id/media/:name", route(async (req, res, userId) => {
    const project = await load(userId, req.params.id);
    const name = path.basename(String(req.params.name));
    if (!/^(picture-(long|short)|recut-[a-z0-9-]{6,40})\.mp4$/.test(name)) throw fail("Not found", 404);
    const url = signedMediaUrl(`${project.id}/${name}`);
    if (!url) throw fail("The media server is reconnecting. Try again in a minute.", 503);
    res.setHeader("Cache-Control", "no-store");
    res.redirect(302, url);
  }));

  app.get("/api/recaps/:id/files/:name", route(async (req, res, userId) => {
    const project = await load(userId, req.params.id);
    const name = String(req.params.name);
    const output = (project.outputs || []).find((o) => o.file === name);
    if (!output || !FILE.test(name)) throw fail("Not found", 404);
    if (output.remote) {
      // Served by the media worker: a short-lived signed link, never through this app.
      const url = signedMediaUrl(output.remote, { download: Boolean(req.query.download) });
      if (!url) throw fail("The media server is reconnecting. Try again in a minute.", 503);
      res.setHeader("Cache-Control", "no-store");
      return res.redirect(302, url);
    }
    const file = await restore(userId, project.id, name);
    if (!file) throw fail("That video is no longer available. Render it again.", 404);
    if (req.query.download) res.attachment(`${clip(project.title, 60).replace(/[^\w -]+/g, "") || "recap"} - ${output.format === "short" ? "Short" : "Recap"}.mp4`);
    res.sendFile(file, { headers: { "Cache-Control": "private, max-age=3600" } });
  }));
}
