// Media exec worker for AutoYT (see server/remoteMedia.js).
//
// The hosted app has no ffmpeg/ffprobe/python3/yt-dlp/zip, so it hands those
// calls to this worker, which runs on LingCode container-compute with the
// managed lingcode/compute-media:22 image. The worker long-polls the hosted app
// for calls, rebuilds each call's files under $SCRATCH_DIR at mirrored paths,
// runs the program, streams output back, and uploads any file the program
// created or changed in the call's watched directories.
//
//   APP_URL=https://autoyt.cc WORKER_SCRIPT_TOKEN=... node job-exec.mjs
//
// Env:
//   APP_URL                hosted app base URL (defaults to https://autoyt.cc)
//   WORKER_SCRIPT_TOKEN    shared secret the hosted app checks
//   SCRATCH_DIR            disk-backed scratch (set by container-compute)
//   EXEC_IDLE_EXIT         seconds without work before exiting (default 600)
//   EXEC_CONCURRENCY       calls handled at once (default 2)
//   EXEC_MAX_LIFETIME      seconds before it stops taking calls (default 1800)
import { spawn } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const APP = String(process.env.APP_URL || "https://autoyt.cc").replace(/\/+$/, "");
const TOKEN = String(process.env.WORKER_SCRIPT_TOKEN || "").trim();
const SCRATCH = process.env.SCRATCH_DIR || os.tmpdir();
const IDLE_EXIT_MS = (Number(process.env.EXEC_IDLE_EXIT) || 600) * 1000;
const CONCURRENCY = Math.max(1, Number(process.env.EXEC_CONCURRENCY) || 2);
// Stop taking new calls after this long so the next scheduled run fetches the
// newest worker code from the hosted app after a deploy.
const MAX_LIFETIME_MS = (Number(process.env.EXEC_MAX_LIFETIME) || 1800) * 1000;
const bornAt = Date.now();
const WORKER = `${os.hostname()}-${process.pid}`;
const log = (...parts) => console.log(new Date().toISOString(), ...parts);
if (!TOKEN) {
  console.error("WORKER_SCRIPT_TOKEN is required");
  process.exit(2);
}
const headers = { "x-worker-token": TOKEN };
let lastWork = Date.now();

async function call(method, route, { json, body, query } = {}) {
  const url = new URL(`${APP}${route}`);
  for (const [key, value] of Object.entries(query || {})) url.searchParams.set(key, value);
  const response = await fetch(url, {
    method,
    headers: json ? { ...headers, "content-type": "application/json" } : { ...headers, ...(body ? { "content-type": "application/octet-stream" } : {}) },
    body: json ? JSON.stringify(json) : body,
    ...(body && !json ? { duplex: "half" } : {}),
  });
  return response;
}

// Every hosted-app root (its /tmp, its app directory) maps to its own folder
// under scratch, so absolute paths in arguments keep working.
function mapper(roots, base) {
  const pairs = roots
    .map((root, index) => [root, path.join(base, `r${index}`)])
    .sort((a, b) => b[0].length - a[0].length);
  const toLocal = (text) => {
    let out = String(text);
    for (const [root, local] of pairs) out = out.split(root).join(local);
    return out;
  };
  // Output text mentions scratch paths; callers expect the hosted-app paths.
  const unmapText = (buffer) => {
    if (buffer.includes(0)) return buffer;
    let text = buffer.toString("utf8");
    for (const [root, local] of pairs) text = text.split(local).join(root);
    return Buffer.from(text, "utf8");
  };
  const toRemote = (file) => {
    for (const [root, local] of pairs) if (file === local || file.startsWith(local + path.sep)) return root + file.slice(local.length);
    return null;
  };
  return { toLocal, toRemote, unmapText };
}

async function snapshot(dirs) {
  const seen = new Map();
  const visit = async (dir) => {
    let entries = [];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await visit(full);
      else if (entry.isFile()) {
        const stat = await fsp.stat(full);
        seen.set(full, `${stat.size}:${stat.mtimeMs}`);
      }
    }
  };
  for (const dir of dirs) await visit(dir);
  return seen;
}

async function handle(job) {
  const started = Date.now();
  const base = path.join(SCRATCH, job.id);
  const { toLocal, toRemote, unmapText } = mapper(job.roots, base);
  let stdoutBuffer = [],
    stderrBuffer = [],
    child = null,
    cancelled = null,
    lastContact = Date.now();
  const flush = async (final) => {
    const stdout = unmapText(Buffer.concat(stdoutBuffer)).toString("base64");
    const stderr = unmapText(Buffer.concat(stderrBuffer)).toString("base64");
    stdoutBuffer = [];
    stderrBuffer = [];
    if (final) return { stdout, stderr };
    const response = await call("POST", `/internal/exec/${job.id}/stream`, { json: { stdout, stderr } }).catch(() => null);
    const data = response?.ok ? await response.json().catch(() => ({})) : {};
    if (response?.ok) lastContact = Date.now();
    // Stop when the caller cancelled, when the hosted app no longer knows this
    // call (it restarted), or when it has been unreachable for a minute.
    const stop = data.cancelled || (response?.status === 404 && "SIGTERM") || (Date.now() - lastContact > 60000 && "SIGTERM");
    if (stop && child && !cancelled) {
      cancelled = stop;
      child.kill(stop);
    }
    return {};
  };
  try {
    const watch = job.watch.map(toLocal);
    for (const dir of watch) await fsp.mkdir(dir, { recursive: true });
    await fsp.mkdir(toLocal(job.cwd), { recursive: true });
    for (const input of job.inputs) {
      const target = toLocal(input.path);
      await fsp.mkdir(path.dirname(target), { recursive: true });
      const response = await call("GET", `/internal/exec/${job.id}/input`, { query: { path: input.path } });
      if (!response.ok) throw new Error(`Could not fetch input ${path.basename(input.path)} (${response.status})`);
      await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(target));
    }
    const before = await snapshot(watch);
    const program = job.program;
    const args = job.args.map(toLocal);
    const code = await new Promise((resolve, reject) => {
      child = spawn(program, args, {
        cwd: toLocal(job.cwd),
        env: {
          ...process.env,
          ...Object.fromEntries(Object.entries(job.env || {}).map(([k, v]) => [k, toLocal(v)])),
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      child.stdout.on("data", (chunk) => stdoutBuffer.push(chunk));
      child.stderr.on("data", (chunk) => stderrBuffer.push(chunk));
      const ticker = setInterval(() => void flush(false), 1500);
      child.on("error", (error) => {
        clearInterval(ticker);
        reject(new Error(error.code === "ENOENT" ? `${job.program} is not installed on the media worker` : error.message));
      });
      child.on("close", (exitCode, signal) => {
        clearInterval(ticker);
        resolve({ exitCode, signal });
      });
    });
    const after = await snapshot(watch);
    let uploaded = 0;
    for (const [file, stamp] of after) {
      if (before.get(file) === stamp || file.includes(".part-")) continue;
      const remote = toRemote(file);
      if (!remote) continue;
      const response = await call("PUT", `/internal/exec/${job.id}/output`, { query: { path: remote }, body: fs.createReadStream(file) });
      if (!response.ok) throw new Error(`Could not return ${path.basename(file)} (${response.status})`);
      uploaded++;
    }
    const rest = await flush(true);
    await call("POST", `/internal/exec/${job.id}/finish`, { json: { code: code.exitCode, signal: code.signal, ...rest } });
    log(`${job.program} ${job.id} exit=${code.exitCode} outputs=${uploaded} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  } catch (error) {
    const rest = await flush(true).catch(() => ({}));
    await call("POST", `/internal/exec/${job.id}/finish`, { json: { code: null, error: error.message, ...rest } }).catch(() => {});
    log(`${job.program} ${job.id} failed: ${error.message}`);
  } finally {
    await fsp.rm(base, { recursive: true, force: true }).catch(() => {});
  }
}

async function lane(index) {
  while (Date.now() - lastWork < IDLE_EXIT_MS && Date.now() - bornAt < MAX_LIFETIME_MS) {
    let response;
    try {
      response = await call("GET", "/internal/exec/claim", { query: { worker: `${WORKER}-${index}` } });
    } catch (error) {
      log(`claim failed: ${error.message}`);
      await new Promise((resolve) => setTimeout(resolve, 3000));
      continue;
    }
    if (response.status === 204) continue;
    if (!response.ok) {
      log(`claim returned ${response.status}`);
      await new Promise((resolve) => setTimeout(resolve, 5000));
      continue;
    }
    const job = await response.json();
    lastWork = Date.now();
    await handle(job);
    lastWork = Date.now();
  }
}

log(`media exec worker ${WORKER} polling ${APP} with ${CONCURRENCY} lanes`);
await Promise.all(Array.from({ length: CONCURRENCY }, (_, index) => lane(index)));
log("idle, exiting");
