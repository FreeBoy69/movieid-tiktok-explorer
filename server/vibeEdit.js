// Vibe Edit: a browser video editor with an AI assistant, ported from Donkey
// Cut (Apache-2.0, github.com/donkeycut/donkey) onto AutoYT's own services.
// The editor runs in the browser; this module stores projects, transcribes
// media into word timings, voices scripts, answers the chat with edit actions,
// imports music, and renders the timeline to MP4 with ffmpeg (which runs on
// the compute worker through the remoteMedia spawn patch when the host has
// none). Media lives in the Creator Studio file space, so uploads, generated
// shots and renders all share /api/studio/files.
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { assetStoreConfigured, ensureFile, saveFile } from "./assetStore.js";
import { buildRenderArgs, overlayConcatList, renderDuration } from "./vibeEditRender.js";
import { chatPrompt, sanitizeActions, summarizeProject } from "../src/utils/vibeEditActions.js";
import { SOUND_PRESETS } from "../src/utils/vibeSound.js";

const FILE_NAME = /^(up|gen)-[a-z0-9-]+\.(png|jpg|webp|gif|mp4|mov|webm|mp3|wav|m4a|ogg)$/;
const PROJECT_ID = /^vp_[a-z0-9]+$/;
const MAX_PROJECTS = 200;
const MAX_PROJECT_BYTES = 4 * 1024 * 1024;
const MAX_VOICE_LINES = 200;
const MAX_VOICE_CHARS = 20000;
const MAX_RENDER_SECONDS = 15 * 60;
const MAX_ACTIVE_RENDERS = 2;
const SAMPLE_RATE = 24000;

let deps = {};
export function configureVibeEdit(dependencies) {
  deps = dependencies;
}

const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const newId = (prefix) => `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(5).toString("hex")}`;

// ---------- Storage: the Creator Studio file space (same layout and keys) ----------
const root = () =>
  path.resolve(process.env.CREATOR_STUDIO_DIR || path.join(process.env.CREATOR_ASSETS_DIR || "data/creator-assets", "studio"));
const userKey = (userId) => crypto.createHash("sha256").update(String(userId)).digest("hex").slice(0, 24);
const userDir = (userId) => path.join(root(), userKey(userId));
const storeKey = (userId, file) => `studio/${userKey(userId)}/${file}`;
const fileUrl = (name) => `/api/studio/files/${encodeURIComponent(name)}`;

async function persist(userId, file) {
  if (!assetStoreConfigured()) return;
  await saveFile(storeKey(userId, path.basename(file)), file).catch((error) =>
    console.warn(`[vibe-edit] could not store ${path.basename(file)}: ${error.message}`),
  );
}
/** A signed-in user's Creator Studio file on local disk (restored from storage when needed). */
export async function studioFilePath(userId, name) {
  return readable(userId, name);
}
async function readable(userId, name) {
  if (!FILE_NAME.test(String(name || ""))) throw fail("That media file isn't part of your library");
  const file = path.join(userDir(userId), name);
  if (!(await ensureFile(storeKey(userId, name), file))) throw fail("A media file is no longer available. Upload it again.", 404);
  return file;
}
async function writeOwned(userId, name, bytes) {
  const file = path.join(userDir(userId), name);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const partial = `${file}.${crypto.randomBytes(4).toString("hex")}`;
  await fs.writeFile(partial, bytes);
  await fs.rename(partial, file);
  await persist(userId, file);
  return file;
}
async function readOwned(userId, name) {
  const file = path.join(userDir(userId), name);
  await ensureFile(storeKey(userId, name), file);
  return fs.readFile(file, "utf8").catch(() => null);
}

// ---------- Projects ----------
// One JSON file per project plus a small index, serialized per user.
const chains = new Map();
function serial(userId, fn) {
  const next = (chains.get(userId) || Promise.resolve()).then(fn, fn);
  chains.set(userId, next.catch(() => {}));
  return next;
}
async function readIndex(userId) {
  try {
    const list = JSON.parse((await readOwned(userId, "vibe-index.json")) || "[]");
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}
const projectFile = (id) => `vibe-${id}.json`;

export function projectSummary(doc) {
  const cover = doc.assets?.find((a) => a.kind === "image" || a.kind === "video");
  const ends = [...(doc.clips || []), ...(doc.audio || [])].map((c) => c.start + c.out - c.in);
  return {
    id: doc.id,
    name: String(doc.name || "Untitled edit").slice(0, 120),
    aspect: doc.aspect,
    updatedAt: doc.updatedAt || Date.now(),
    duration: Math.round(Math.max(0, ...ends) * 10) / 10,
    clips: (doc.clips || []).length,
    ...(cover ? { cover: { kind: cover.kind, url: cover.url } } : {}),
  };
}

function checkProject(doc) {
  if (!doc || typeof doc !== "object" || !PROJECT_ID.test(String(doc.id || ""))) throw fail("That project can't be saved");
  if (!Array.isArray(doc.assets) || !Array.isArray(doc.clips) || !Array.isArray(doc.audio)) throw fail("That project is damaged");
  const bytes = Buffer.byteLength(JSON.stringify(doc));
  if (bytes > MAX_PROJECT_BYTES) throw fail("This project is too large to save");
  return doc;
}

// ---------- Voiceover ----------
/** Parse a 16-bit PCM WAV; null for anything else. */
export function parseWav(buf) {
  if (buf.length < 44 || buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") return null;
  let offset = 12;
  let fmt = null;
  while (offset + 8 <= buf.length) {
    const id = buf.toString("ascii", offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === "fmt ") fmt = { format: buf.readUInt16LE(body), channels: buf.readUInt16LE(body + 2), rate: buf.readUInt32LE(body + 4), bits: buf.readUInt16LE(body + 14) };
    if (id === "data" && fmt) {
      if (fmt.format !== 1 || fmt.bits !== 16) return null;
      const end = Math.min(buf.length, body + size);
      const frames = Math.floor((end - body) / (2 * fmt.channels));
      const mono = new Int16Array(frames);
      for (let i = 0; i < frames; i++) {
        let sum = 0;
        for (let c = 0; c < fmt.channels; c++) sum += buf.readInt16LE(body + (i * fmt.channels + c) * 2);
        mono[i] = Math.round(sum / fmt.channels);
      }
      return { samples: mono, rate: fmt.rate };
    }
    offset = body + size + (size % 2);
  }
  return null;
}

function resample({ samples, rate }, target) {
  if (rate === target) return samples;
  const out = new Int16Array(Math.round((samples.length * target) / rate));
  for (let i = 0; i < out.length; i++) {
    const pos = (i * rate) / target;
    const a = Math.floor(pos);
    const b = Math.min(samples.length - 1, a + 1);
    out[i] = Math.round(samples[a] + (samples[b] - samples[a]) * (pos - a));
  }
  return out;
}

/** Trim leading/trailing near-silence so lines sit tight on their cues. */
export function trimSilence(samples, rate, threshold = 400) {
  const pad = Math.round(rate * 0.04);
  let a = 0;
  let b = samples.length - 1;
  while (a < b && Math.abs(samples[a]) < threshold) a++;
  while (b > a && Math.abs(samples[b]) < threshold) b--;
  return samples.subarray(Math.max(0, a - pad), Math.min(samples.length, b + pad + 1));
}

export function wavFromPcm(samples, rate = SAMPLE_RATE) {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) data.writeInt16LE(samples[i], i * 2);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

/**
 * Lay spoken lines out on a timeline. Lines with `at` land there unless the
 * previous line is still speaking (then they wait); lines without `at` follow
 * the previous one after `gap` seconds. Returns sample offsets and the layout.
 */
export function layoutLines(lines, durations, gap = 0.25) {
  const timed = lines.some((l) => Number.isFinite(l.at));
  const origin = timed ? Math.min(...lines.filter((l) => Number.isFinite(l.at)).map((l) => l.at)) : 0;
  let cursor = 0;
  return lines.map((line, i) => {
    const wanted = Number.isFinite(line.at) ? line.at - origin : cursor + (i ? gap : 0);
    const start = Math.max(wanted, cursor);
    cursor = start + durations[i];
    return { id: line.id, start: Math.round((origin + start) * 1000) / 1000, offset: start, duration: Math.round(durations[i] * 1000) / 1000 };
  });
}

function runFfmpeg(args, signal) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.FFMPEG_PATH || "ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr?.on("data", (chunk) => {
      stderr = (stderr + chunk).slice(-4000);
    });
    const abort = () => child.kill("SIGKILL");
    signal?.addEventListener("abort", abort, { once: true });
    child.on("error", (error) => {
      signal?.removeEventListener("abort", abort);
      reject(error);
    });
    child.on("close", (code) => {
      signal?.removeEventListener("abort", abort);
      if (signal?.aborted) return reject(fail("Stopped"));
      if (code === 0) resolve();
      else reject(new Error(stderr.trim().split("\n").slice(-3).join(" ") || `ffmpeg exited ${code}`));
    });
  });
}

function runProbe(file) {
  return new Promise((resolve) => {
    const child = spawn(process.env.FFPROBE_PATH || "ffprobe", ["-v", "error", "-show_entries", "stream=codec_type", "-of", "json", file], { stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    child.stdout?.on("data", (chunk) => (out += chunk));
    child.on("error", () => resolve(null));
    child.on("close", () => {
      try {
        resolve(JSON.parse(out).streams?.map((s) => s.codec_type) || []);
      } catch {
        resolve(null);
      }
    });
  });
}

async function toPcm(spoken, workDir, index) {
  const parsed = spoken.extension === "wav" ? parseWav(spoken.audio) : null;
  if (parsed) return resample(parsed, SAMPLE_RATE);
  const input = path.join(workDir, `line-${index}.${spoken.extension || "mp3"}`);
  const output = path.join(workDir, `line-${index}.wav`);
  await fs.writeFile(input, spoken.audio);
  await runFfmpeg(["-y", "-hide_banner", "-loglevel", "error", "-i", input, "-ac", "1", "-ar", String(SAMPLE_RATE), "-c:a", "pcm_s16le", output]);
  const converted = parseWav(await fs.readFile(output));
  if (!converted) throw new Error("The voice came back in a format that can't be read");
  return resample(converted, SAMPLE_RATE);
}

const PLAN_PROMPT = (direction, lines) => `You prepare a voiceover before a text-to-speech voice reads it.
DIRECTION (free text about how to say it): ${JSON.stringify(direction)}
LINES: ${JSON.stringify(lines)}
Decide whether the direction asks for the lines to be spoken in a language different from the one they are written in.
Return JSON: {"language": BCP-47 tag or null, "delivery": the direction with any language request removed or null, "lines": the lines translated into "language" (same count and order, keep tone and punctuation) or null}.
Set "language" only when the direction actually asks to speak in a language. When the direction is only about tone or pace, return language null, lines null, and the whole direction in delivery.`;

/** Read a delivery direction for a language ask; translate when it names one.
 * Any failure passes the inputs through so a voiceover never breaks on prep. */
async function planVoiceover(texts, direction, language) {
  const passthrough = { texts, direction, language };
  if (!direction || !deps.generateJson) return passthrough;
  try {
    const plan = await deps.generateJson(PLAN_PROMPT(direction, texts), { maxTokens: 8000, timeoutMs: 60000 });
    const translated = Array.isArray(plan?.lines) && plan.lines.length === texts.length && plan.lines.every((l) => typeof l === "string" && l.trim()) ? plan.lines : null;
    return {
      texts: translated || texts,
      direction: typeof plan?.delivery === "string" && plan.delivery.trim() ? plan.delivery.trim() : translated ? "" : direction,
      language: typeof plan?.language === "string" && plan.language.trim() ? plan.language.trim() : language,
    };
  } catch {
    return passthrough;
  }
}

async function voiceover(userId, body) {
  const voiceId = String(body?.voiceId || "").trim();
  if (!voiceId) throw fail("Pick a voice first");
  if (!deps.speak) throw fail("Voices aren't available on this server", 503);
  if (deps.voiceAllowed && !(await deps.voiceAllowed(userId, voiceId))) throw fail("That voice isn't available to you");
  const raw = (Array.isArray(body?.lines) ? body.lines : [])
    .map((l, i) => ({ id: String(l?.id || `l${i}`).slice(0, 60), text: String(l?.text || "").replace(/\s+/g, " ").trim(), at: Number.isFinite(Number(l?.at)) && l?.at !== null && l?.at !== undefined ? Number(l.at) : undefined }))
    .filter((l) => l.text);
  if (!raw.length) throw fail("Write something to say first");
  if (raw.length > MAX_VOICE_LINES) throw fail(`Voice up to ${MAX_VOICE_LINES} lines at a time`);
  if (raw.reduce((n, l) => n + l.text.length, 0) > MAX_VOICE_CHARS) throw fail("That script is too long for one voiceover. Split it up.");

  const direction = String(body?.direction || "").trim().slice(0, 300);
  const language = String(body?.language || "").trim().slice(0, 12);
  const plan = await planVoiceover(raw.map((l) => l.text), direction, language && language !== "auto" ? language : "");
  const lines = raw.map((l, i) => ({ ...l, text: plan.texts[i] || l.text }));

  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "autoyt-vibe-voice-"));
  try {
    const clips = new Array(lines.length);
    let next = 0;
    const worker = async () => {
      while (next < lines.length) {
        const i = next++;
        const say = () => deps.speak({ voiceId, text: lines[i].text, direction: plan.direction, language: plan.language });
        let spoken;
        try {
          spoken = await say();
        } catch (error) {
          if (error?.statusCode === 402 || /insufficient|credit/i.test(error?.message || "")) throw error;
          // The speech backend rejects the odd call spuriously; one resend usually lands.
          spoken = await say().catch((again) => {
            const snippet = lines[i].text.length > 40 ? `${lines[i].text.slice(0, 40)}…` : lines[i].text;
            throw fail(lines.length > 1 ? `Line ${i + 1} ("${snippet}"): ${again.message}` : again.message, again.statusCode || 502);
          });
        }
        clips[i] = trimSilence(await toPcm(spoken, workDir, i), SAMPLE_RATE);
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, lines.length) }, worker));

    const layout = layoutLines(lines, clips.map((c) => c.length / SAMPLE_RATE), Number(body?.gap) >= 0 ? Math.min(2, Number(body.gap)) : 0.25);
    const total = Math.max(...layout.map((l, i) => Math.round(l.offset * SAMPLE_RATE) + clips[i].length));
    const mix = new Int16Array(total);
    layout.forEach((l, i) => mix.set(clips[i], Math.round(l.offset * SAMPLE_RATE)));
    const name = `${newId("gen-vibe")}.wav`;
    await writeOwned(userId, name, wavFromPcm(mix));
    return {
      file: name,
      url: fileUrl(name),
      duration: Math.round((total / SAMPLE_RATE) * 1000) / 1000,
      start: layout[0].start - layout[0].offset,
      layout: layout.map((l, i) => ({ id: l.id, start: l.start, duration: l.duration, text: lines[i].text })),
      ...(plan.language ? { language: plan.language } : {}),
    };
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

// ---------- Renders ----------
const renders = new Map();
const activeRenders = (userId) => [...renders.values()].filter((r) => r.userId === userId && r.status === "running").length;
const publicRender = (r) => ({ id: r.id, status: r.status, progress: r.progress, error: r.error, url: r.url, file: r.file, duration: r.duration, createdAt: r.createdAt });

function decodePng(dataUrl) {
  const match = /^data:image\/png;base64,([a-z0-9+/=]+)$/i.exec(String(dataUrl || ""));
  if (!match) return null;
  const bytes = Buffer.from(match[1], "base64");
  return bytes.length > 8 && bytes.length < 6 * 1024 * 1024 ? bytes : null;
}

async function startRender(userId, body) {
  const project = checkProject(body?.project);
  if (activeRenders(userId) >= MAX_ACTIVE_RENDERS) throw fail("Two exports are already running. Wait for one to finish.", 429);
  const duration = renderDuration(project);
  if (duration > MAX_RENDER_SECONDS) throw fail("Exports can be up to 15 minutes long");
  if (!project.clips.length && !project.audio.length && !project.texts.length) throw fail("Add something to the timeline first");
  const overlays = (Array.isArray(body?.overlays) ? body.overlays : []).slice(0, 4000);
  const job = { id: newId("render"), userId, status: "running", progress: 0, createdAt: new Date().toISOString(), controller: new AbortController() };
  renders.set(job.id, job);
  runRender(job, project, overlays).catch(() => {});
  return job;
}

async function runRender(job, project, overlays) {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "autoyt-vibe-render-"));
  try {
    const paths = new Map();
    const used = new Set([...project.clips, ...project.audio].map((c) => c.assetId));
    for (const asset of project.assets) {
      if (!used.has(asset.id)) continue;
      const name = String(asset.file || decodeURIComponent(String(asset.url || "").split("/api/studio/files/")[1]?.split("?")[0] || ""));
      paths.set(asset.id, await readable(job.userId, name));
    }
    job.progress = 0.1;
    const audible = [];
    for (const asset of project.assets) {
      if (asset.kind !== "video" || !paths.has(asset.id)) continue;
      const streams = await runProbe(paths.get(asset.id));
      // Unknown (probe unavailable) counts as silent rather than failing the graph.
      if (streams?.includes("audio")) audible.push(asset.id);
    }
    job.progress = 0.2;

    let overlayList = null;
    const frames = [];
    for (const [i, frame] of overlays.entries()) {
      const bytes = decodePng(frame?.png);
      const t0 = Number(frame?.t0);
      const t1 = Number(frame?.t1);
      if (!bytes || !(t1 > t0)) continue;
      const file = path.join(workDir, `ov-${i}.png`);
      await fs.writeFile(file, bytes);
      frames.push({ t0, t1, file });
    }
    if (frames.length) {
      const blank = decodePng(overlays.find((o) => o?.blank)?.png);
      if (!blank) throw fail("The export is missing its blank frame");
      const blankFile = path.join(workDir, "ov-blank.png");
      await fs.writeFile(blankFile, blank);
      overlayList = path.join(workDir, "overlays.txt");
      await fs.writeFile(overlayList, overlayConcatList(frames, blankFile, renderDuration(project)));
    }
    job.progress = 0.3;

    const output = path.join(workDir, "out.mp4");
    const { args, duration } = buildRenderArgs({ project, pathOf: (a) => paths.get(a.id) || null, audible, overlayList, output });
    const ticker = setInterval(() => {
      job.progress = Math.min(0.95, job.progress + 0.02);
    }, 2000);
    try {
      await runFfmpeg(args, job.controller.signal);
    } finally {
      clearInterval(ticker);
    }
    const name = `${newId("gen-vibe")}.mp4`;
    await writeOwned(job.userId, name, await fs.readFile(output));
    Object.assign(job, { status: "completed", progress: 1, file: name, url: fileUrl(name), duration });
  } catch (error) {
    Object.assign(job, { status: job.controller.signal.aborted ? "stopped" : "failed", error: String(error?.message || error).slice(0, 400) });
    console.warn(`[vibe-edit] render ${job.id} ${job.status}: ${job.error}`);
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
    // Finished jobs stay pollable for a while, then go.
    setTimeout(() => renders.delete(job.id), 6 * 60 * 60 * 1000).unref?.();
  }
}

// ---------- Transcription ----------
async function transcribe(userId, body) {
  if (!deps.transcribe) throw fail("Transcription isn't available on this server", 503);
  const file = await readable(userId, String(body?.file || ""));
  const result = await deps.transcribe(file, { maxDurationSeconds: 1800 });
  const words = [];
  for (const segment of result?.segments || []) {
    if (segment.words?.length) for (const w of segment.words) words.push({ t0: w.start, t1: w.end, w: w.word });
    else if (segment.text) {
      // No word timings: spread the segment's words evenly over it.
      const parts = segment.text.split(/\s+/).filter(Boolean);
      parts.forEach((w, i) => words.push({ t0: segment.start + ((segment.end - segment.start) * i) / parts.length, t1: segment.start + ((segment.end - segment.start) * (i + 1)) / parts.length, w }));
    }
  }
  return { text: String(result?.text || "").trim(), words };
}

// ---------- Chat ----------
async function chat(userId, body) {
  const project = checkProject(body?.project);
  const message = String(body?.message || "").trim();
  if (!message) throw fail("Say what you'd like to change");
  if (!deps.generateJson) throw fail("The assistant isn't available on this server", 503);
  const voices = (Array.isArray(body?.voices) ? body.voices : []).map((v) => String(v).slice(0, 60)).filter(Boolean).slice(0, 60);
  const summary = summarizeProject(project, {
    playhead: Number(body?.playhead) || 0,
    ...(body?.selection ? { selected: body.selection } : {}),
  });
  const prompt = chatPrompt({
    summary,
    message,
    history: Array.isArray(body?.history) ? body.history : [],
    voices,
    presets: SOUND_PRESETS.map((p) => `${p.id} (${p.character})`),
  });
  const result = await deps.generateJson(prompt, { maxTokens: 6000, timeoutMs: 90000, requiredAnyKeys: ["reply", "actions"] });
  return {
    reply: String(result?.reply || "Done.").slice(0, 1200),
    actions: sanitizeActions(result?.actions),
  };
}

// ---------- Music import ----------
const AUDIO_TYPES = { "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/wav": "wav", "audio/x-wav": "wav", "audio/wave": "wav", "audio/ogg": "ogg", "audio/mp4": "m4a", "audio/x-m4a": "m4a", "application/ogg": "ogg" };
async function importAudio(userId, body) {
  if (!deps.fetchPublic) throw fail("Imports aren't available on this server", 503);
  const { body: bytes, type, url } = await deps.fetchPublic(String(body?.url || ""), { accept: "audio/*", maxBytes: 20 * 1024 * 1024, timeoutMs: 45000 });
  const mime = String(type).split(";")[0].trim().toLowerCase();
  const ext = AUDIO_TYPES[mime] || (/\.(mp3|wav|ogg|m4a)(\?|$)/i.exec(url.pathname)?.[1] || "").toLowerCase();
  if (!ext) throw fail("That link isn't an audio file");
  if (bytes.length < 1000) throw fail("That audio file is empty");
  const name = `${newId("up")}.${ext}`;
  await writeOwned(userId, name, bytes);
  return { file: name, url: fileUrl(name) };
}

// ---------- Routes ----------
export function registerVibeEdit(app) {
  const route = (handler) => async (req, res) => {
    try {
      const session = await deps.session(req);
      if (!session?.user) throw fail("Sign in required", 401);
      await handler(req, res, String(session.user.id));
    } catch (error) {
      if (!res.headersSent) res.status(error.statusCode || 400).json({ error: String(error.message || "Something went wrong").slice(0, 400) });
    }
  };

  app.get("/api/vibe-edit/projects", route(async (_req, res, userId) => {
    res.json({ projects: await readIndex(userId) });
  }));

  app.get("/api/vibe-edit/projects/:id", route(async (req, res, userId) => {
    if (!PROJECT_ID.test(req.params.id)) throw fail("Project not found", 404);
    const text = await readOwned(userId, projectFile(req.params.id));
    if (!text) throw fail("Project not found", 404);
    res.json({ project: JSON.parse(text) });
  }));

  app.put("/api/vibe-edit/projects/:id", route(async (req, res, userId) => {
    const doc = checkProject(req.body?.project);
    if (doc.id !== req.params.id) throw fail("Project id mismatch");
    const summary = await serial(userId, async () => {
      await writeOwned(userId, projectFile(doc.id), JSON.stringify(doc));
      const index = (await readIndex(userId)).filter((p) => p.id !== doc.id);
      const entry = projectSummary(doc);
      index.unshift(entry);
      await writeOwned(userId, "vibe-index.json", JSON.stringify(index.slice(0, MAX_PROJECTS)));
      return entry;
    });
    res.json({ project: summary });
  }));

  app.delete("/api/vibe-edit/projects/:id", route(async (req, res, userId) => {
    if (!PROJECT_ID.test(req.params.id)) throw fail("Project not found", 404);
    await serial(userId, async () => {
      const index = (await readIndex(userId)).filter((p) => p.id !== req.params.id);
      await writeOwned(userId, "vibe-index.json", JSON.stringify(index));
    });
    res.json({ ok: true });
  }));

  app.post("/api/vibe-edit/transcribe", route(async (req, res, userId) => {
    res.json(await transcribe(userId, req.body));
  }));

  app.post("/api/vibe-edit/voiceover", route(async (req, res, userId) => {
    res.json(await voiceover(userId, req.body));
  }));

  app.post("/api/vibe-edit/chat", route(async (req, res, userId) => {
    res.json(await chat(userId, req.body));
  }));

  app.post("/api/vibe-edit/import-audio", route(async (req, res, userId) => {
    res.json(await importAudio(userId, req.body));
  }));

  app.post("/api/vibe-edit/renders", route(async (req, res, userId) => {
    const job = await startRender(userId, req.body);
    res.status(202).json({ render: publicRender(job) });
  }));

  app.get("/api/vibe-edit/renders/:id", route(async (req, res, userId) => {
    const job = renders.get(req.params.id);
    if (!job || job.userId !== userId) throw fail("Export not found", 404);
    res.json({ render: publicRender(job) });
  }));

  app.post("/api/vibe-edit/renders/:id/stop", route(async (req, res, userId) => {
    const job = renders.get(req.params.id);
    if (!job || job.userId !== userId) throw fail("Export not found", 404);
    job.controller.abort();
    res.json({ render: publicRender(job) });
  }));
}
