// Media worker for AutoYT. Runs anywhere Docker runs -- your Mac, a VPS, any
// cloud box, or LingCode container-compute if that ever exposes a job API.
//
// It needs the three toolchains the hosted-app tier lacks (yt-dlp, ffmpeg,
// faster-whisper -- all ENOENT there, see /health?deps=1) and does what the old
// in-process POST /api/transcribe did: download -> extract audio -> transcribe.
//
// Talks to the backend over the HTTPS data-API gateway with the anon key rather
// than a direct Postgres connection, because LingCode does not hand out a
// LINGCODE_DB_URL outside its own container-compute jobs. That also means this
// worker needs no database credentials and no VPC access -- just the anon key.
//
//   LINGCODE_GATEWAY_URL=https://lingcode.dev/api/cloud/be/<backendId> \
//   LINGCODE_ANON_KEY=<anon key> \
//   node job-transcribe.mjs [--once] [--idle-exit SECONDS]
//
// --once:      claim at most one job, then exit. This is the mode to use under a
//              cron schedule (every minute, overlap: skip).
// --idle-exit: when looping, exit after N seconds of an empty queue (default 300).
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const argv = process.argv.slice(2);
const once = argv.includes("--once");
const idleExitSeconds = Number(argv[argv.indexOf("--idle-exit") + 1]) || 300;

const GATEWAY = String(process.env.LINGCODE_GATEWAY_URL || "").replace(/\/+$/, "");
const ANON = String(process.env.LINGCODE_ANON_KEY || "");
if (!GATEWAY || !ANON) {
  console.error("usage: LINGCODE_GATEWAY_URL=... LINGCODE_ANON_KEY=... node job-transcribe.mjs [--once]");
  process.exit(2);
}

const SCRATCH = process.env.SCRATCH_DIR || os.tmpdir();
const WORKER_ID = `${os.hostname()}-${process.pid}`;
const log = (...a) => console.log(new Date().toISOString(), ...a);

/** One call against the data API. Throws on transport or cloud_error. */
async function api(op, body) {
  const res = await fetch(`${GATEWAY}/${op}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${ANON}` },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed;
  try { parsed = JSON.parse(text); }
  catch { throw new Error(`${op}: non-JSON response (${res.status}) ${text.slice(0, 200)}`); }
  if (!parsed.ok) throw new Error(`${op}: ${parsed.message || parsed.error || "failed"}`);
  return parsed.data;
}

// Which queue this worker drains. Overridable so a second worker can be brought
// up on its own kind and proven end to end without racing the incumbent one.
const WORKER_KIND = String(process.env.WORKER_KIND || "transcribe");
const claimJob = (kind) => api("rpc", { fn: "claim_media_job", args: [kind, WORKER_ID, 900] });
const patchJob = (id, patch) => api("update", { table: "media_jobs", where: { id }, patch });

function run(cmd, args, { timeoutMs = 20 * 60 * 1000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error(`${cmd} timed out after ${timeoutMs}ms`)); }, timeoutMs);
    child.stdout.on("data", (c) => { out += c; });
    // Keep only the tail: ffmpeg and yt-dlp are extremely chatty on stderr.
    child.stderr.on("data", (c) => { err += c; if (err.length > 8000) err = err.slice(-8000); });
    child.on("error", (e) => { clearTimeout(timer); reject(new Error(`${cmd} failed to start: ${e.code === "ENOENT" ? "not installed in this image" : e.message}`)); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout: out, stderr: err });
      else reject(new Error(`${cmd} exited ${code}: ${err.trim().split("\n").slice(-3).join(" ")}`));
    });
  });
}

// Transcription runs on faster-whisper inside the container-compute image, which
// ships it preinstalled. The OpenAI API is not a usable fallback on this account
// (it answers billing_not_active), so this path must work standalone.
//
// The script is written out at run time rather than shipped as a file, so the
// worker stays a single self-contained module that the job can curl.
const WHISPER_PY = `
import json, sys
from faster_whisper import WhisperModel
model = WhisperModel("base", device="cpu", compute_type="int8")
segments, _info = model.transcribe(sys.argv[1], vad_filter=True)
out = [{"start": s.start, "end": s.end, "text": s.text} for s in segments]
text = " ".join(s["text"].strip() for s in out).strip()
print(json.dumps({"success": bool(text), "text": text, "segments": out,
                  "error": None if text else "No speech detected in the audio."}))
`;

async function transcribeLocally(audioPath, dir) {
  const scriptPath = path.join(dir, "whisper_run.py");
  fs.writeFileSync(scriptPath, WHISPER_PY);
  // Weights download into HF_HOME (pointed at scratch) on first use, so allow a
  // generous timeout for the very first transcription of a run.
  const { stdout } = await run("python3", [scriptPath, audioPath], { timeoutMs: 45 * 60 * 1000 });
  const parsed = lastJsonLine(stdout);
  if (!parsed) throw new Error(`No JSON from whisper: ${stdout.slice(-400)}`);
  if (!parsed.success) throw new Error(parsed.error || "Transcription failed");
  return { text: parsed.text, segments: parsed.segments };
}

// faster-whisper prints load/progress chatter before its result, so take the
// LAST JSON object on stdout -- matching what server.js does today.
function lastJsonLine(stdout) {
  const lines = String(stdout).trim().split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (line.startsWith("{") && line.endsWith("}")) {
      try { return JSON.parse(line); } catch { /* keep scanning upward */ }
    }
  }
  return null;
}

async function progress(id, fraction, message) {
  await patchJob(id, { progress: fraction, message });
  log(`  [${fraction.toFixed(2)}] ${message}`);
}

async function transcribe(job) {
  const url = String(job.params?.url || "").trim();
  if (!url) throw new Error("params.url is required");

  const dir = fs.mkdtempSync(path.join(SCRATCH, "transcribe-"));
  const audioPath = path.join(dir, "audio.wav");
  try {
    await progress(job.id, 0.1, "Downloading source");
    // Only the audio is ever used, so skip the video stream entirely: less
    // bandwidth, less scratch, and no merge step. Let yt-dlp choose the
    // extension (%(ext)s) -- forcing "-o source.mp4" does NOT transcode, it just
    // writes a differently-named container and ffmpeg then finds nothing.
    // Some hosts (Wikimedia, several CDNs) 403 yt-dlp's default UA outright.
    const ytArgs = ["--no-playlist", "--no-check-certificate", "-f", "ba/b",
      "--user-agent", process.env.YTDLP_USER_AGENT
        || "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      "-o", path.join(dir, "source.%(ext)s")];
    // Google rate-limits datacenter IPs ("Sign in to confirm you're not a bot").
    // A cookies export supplied via env lets the download proceed from compute.
    const cookies = String(process.env.YTDLP_COOKIES || "").trim();
    if (cookies) {
      const cookiePath = path.join(dir, "cookies.txt");
      fs.writeFileSync(cookiePath, cookies.endsWith("\n") ? cookies : cookies + "\n", { mode: 0o600 });
      ytArgs.push("--cookies", cookiePath);
    }
    await run("yt-dlp", [...ytArgs, url]);
    const downloaded = fs.readdirSync(dir).filter((name) => name.startsWith("source."));
    if (!downloaded.length) throw new Error("yt-dlp reported success but produced no file.");
    const sourcePath = path.join(dir, downloaded[0]);

    await progress(job.id, 0.45, "Extracting audio");
    await run("ffmpeg", ["-y", "-i", sourcePath, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "64k", audioPath]);

    await progress(job.id, 0.6, "Transcribing");
    const parsed = await transcribeLocally(audioPath, dir);

    await progress(job.id, 0.95, "Finalizing");
    return { success: true, text: parsed.text, segments: parsed.segments ?? null };
  } finally {
    // A cron-driven container is ephemeral, but a looping worker would otherwise
    // fill the scratch volume across jobs.
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const HANDLERS = { transcribe };

log(`worker ${WORKER_ID} up; kind=${WORKER_KIND}; gateway=${GATEWAY}; scratch=${SCRATCH}`);
let idleSince = Date.now();
for (;;) {
  let rows = null;
  try { rows = await claimJob(WORKER_KIND); }
  catch (e) { log("claim failed:", e.message); if (once) process.exit(1); await new Promise((r) => setTimeout(r, 5000)); continue; }

  const job = Array.isArray(rows) ? rows[0] : rows;
  if (!job) {
    if (once) { log("no queued jobs; --once so exiting"); break; }
    if (Date.now() - idleSince > idleExitSeconds * 1000) { log(`idle ${idleExitSeconds}s; exiting`); break; }
    await new Promise((r) => setTimeout(r, 3000));
    continue;
  }

  idleSince = Date.now();
  log(`claimed ${job.id} (${job.kind}) attempt ${job.attempts}/${job.max_attempts}`);
  try {
    const result = await (HANDLERS[job.kind] || transcribe)(job);
    await patchJob(job.id, { status: "done", result, progress: 1, message: "Complete", finished_at: new Date().toISOString() });
    log(`done ${job.id}`);
  } catch (error) {
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 2000);
    // Only bury the job once retries are spent, so a transient network blip does
    // not permanently fail a render the user paid for.
    const terminal = job.attempts >= job.max_attempts;
    await patchJob(job.id, terminal
      ? { status: "failed", error: message, message, finished_at: new Date().toISOString() }
      : { status: "queued", error: message, message }).catch((e) => log("could not record failure:", e.message));
    log(`${terminal ? "failed" : "retrying"} ${job.id}: ${message}`);
  }
  if (once) break;
}
