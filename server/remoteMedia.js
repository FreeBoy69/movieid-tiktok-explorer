// Remote media execution.
//
// The LingCode hosted app runs on a read-only Node image with no ffmpeg,
// ffprobe, python3, yt-dlp, or zip. Every feature that shells out to those
// programs would fail there. Instead of rewriting each feature, this module
// patches child_process so that when one of those programs is missing locally,
// the call runs on a container-compute worker (scripts/lingcode-cloud/job-exec.mjs)
// that has the toolchain.
//
// How a call travels:
//   1. spawn("ffmpeg", args) returns a stand-in ChildProcess immediately.
//   2. The call is queued in this process. Paths in the arguments are sorted
//      into input files (uploaded to the worker) and watched directories
//      (new or changed files there are sent back).
//   3. The worker long-polls GET /internal/exec/claim, downloads the inputs,
//      runs the program under a mirrored path layout, streams stdout/stderr
//      back, uploads new files, and posts the exit code.
//   4. The stand-in emits the same events a real child would.
//
// Child Node processes the app starts (voice studio renderers) load this module
// with --import and send their calls to the parent over localhost, so a single
// queue serves every process.
import childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import fsp from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath, pathToFileURL } from "node:url";
import crypto from "node:crypto";

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, "..");
const original = {
  spawn: childProcess.spawn,
  spawnSync: childProcess.spawnSync,
};

// Programs that may run remotely, keyed by the name the worker runs.
const PROGRAMS = {
  ffmpeg: "ffmpeg",
  ffprobe: "ffprobe",
  python: "python3",
  python3: "python3",
  "yt-dlp": "yt-dlp",
  zip: "zip",
  demucs: "demucs",
};
export function remoteProgram(command) {
  const raw = String(command || "");
  const base = path.basename(raw).replace(/\.exe$/i, "").toLowerCase();
  if (PROGRAMS[base]) return PROGRAMS[base];
  if (/^python\d+(\.\d+)?$/.test(base)) return "python3";
  if (raw && raw === process.env.FFMPEG_PATH) return "ffmpeg";
  if (raw && raw === process.env.FFPROBE_PATH) return "ffprobe";
  if (raw && raw === process.env.PYTHON_PATH) return "python3";
  return "";
}

const localCheck = new Map();
function locallyAvailable(command) {
  if (process.env.REMOTE_MEDIA === "force") return false;
  if (process.env.REMOTE_MEDIA === "off") return true;
  if (localCheck.has(command)) return localCheck.get(command);
  const probe = original.spawnSync(command, [remoteProgram(command) === "zip" ? "-v" : "--version"], {
    stdio: "ignore",
    timeout: 8000,
  });
  const ok = !probe.error;
  localCheck.set(command, ok);
  return ok;
}
export function shouldRunRemotely(command) {
  return Boolean(remoteProgram(command)) && !locallyAvailable(command);
}

// ---------- Path analysis ----------
const roots = () =>
  [...new Set([path.resolve(os.tmpdir()), path.resolve(appRoot), process.env.REMOTE_MEDIA_EXTRA_ROOT].filter(Boolean))];
const isTmp = (p) => p.startsWith(path.resolve(os.tmpdir()) + path.sep) || (process.env.REMOTE_MEDIA_EXTRA_ROOT && p.startsWith(process.env.REMOTE_MEDIA_EXTRA_ROOT + path.sep));
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const MAX_TREE_BYTES = 1.5 * 1024 * 1024 * 1024;

function walk(dir, out, budget) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out, budget);
    else if (entry.isFile()) {
      const size = fs.statSync(full).size;
      budget.bytes += size;
      if (budget.bytes > MAX_TREE_BYTES) throw new Error("Too much data to send to the media worker in one call");
      out.add(full);
    }
  }
}

// Sorts every path mentioned in a command into input files and directories
// whose new files must come back. Exported for tests.
export function analyzeCall(program, args, cwd) {
  const workDir = path.resolve(cwd || process.cwd());
  const inputs = new Set();
  const watch = new Set();
  const pattern = new RegExp(`(${roots().map(escape).join("|")})(?:/[^\\s'"|,;:=\\[\\]()<>]*)?`, "g");
  const consider = (candidate) => {
    const full = path.resolve(workDir, candidate);
    let stat = null;
    try {
      stat = fs.statSync(full);
    } catch {}
    if (stat?.isFile()) {
      inputs.add(full);
      if (isTmp(full)) watch.add(path.dirname(full));
    } else if (stat?.isDirectory()) {
      if (isTmp(full)) {
        watch.add(full);
        const budget = { bytes: 0 };
        const files = new Set();
        walk(full, files, budget);
        files.forEach((file) => inputs.add(file));
      }
    } else if (isTmp(full) || isTmp(path.dirname(full))) {
      // Not there yet: an output. Its directory is watched.
      watch.add(path.dirname(full));
    }
  };
  for (const arg of args.map(String)) {
    const matches = arg.match(pattern) || [];
    for (const match of matches) consider(match.replace(/[\\]+$/, ""));
    // A bare relative path (for example "clips.txt" or ".") resolved against cwd.
    if (!matches.length && !arg.startsWith("-") && arg.length < 400 && !/[\s:=]/.test(arg)) {
      const full = path.resolve(workDir, arg);
      if (fs.existsSync(full) || isTmp(workDir)) consider(arg);
    }
  }
  if (isTmp(workDir)) watch.add(workDir);
  // ffmpeg concat lists name their clips in the file, not on the command line.
  if (program === "ffmpeg")
    for (let i = 0; i < args.length - 1; i++) {
      if (args[i] !== "-f" || args[i + 1] !== "concat") continue;
      const list = args.slice(i).find((value, j, rest) => rest[j - 1] === "-i");
      const listPath = list && path.resolve(workDir, list);
      if (!listPath || !fs.existsSync(listPath)) continue;
      for (const line of fs.readFileSync(listPath, "utf8").split(/\r?\n/)) {
        const match = line.match(/^\s*file\s+'(.+)'\s*$/);
        if (match) {
          const clip = path.resolve(path.dirname(listPath), match[1].replace(/'\\''/g, "'"));
          if (fs.existsSync(clip)) inputs.add(clip);
        }
      }
    }
  // Python scripts import their neighbours.
  if (program === "python3")
    for (const file of [...inputs])
      if (file.endsWith(".py"))
        for (const sibling of fs.readdirSync(path.dirname(file)))
          if (sibling.endsWith(".py")) inputs.add(path.join(path.dirname(file), sibling));
  return { inputs: [...inputs], watch: [...watch], cwd: workDir, roots: roots() };
}

// ---------- Queue (parent process only) ----------
const execs = new Map();
const pending = [];
const claimWaiters = [];
const CLAIM_TIMEOUT_MS = Number(process.env.REMOTE_MEDIA_CLAIM_TIMEOUT_MS) || 150000;
const RUN_TIMEOUT_MS = 60 * 60 * 1000;
let lastWorkerSeen = 0;
const lastCapableSeen = {};

// The media image has python3 but no zip. AutoYT only calls "zip -q -r OUT
// paths..." relative to cwd, which Python's zipfile reproduces exactly.
const ZIP_PY = `
import os, sys, zipfile
args = [a for a in sys.argv[1:] if not a.startswith("-")]
out, paths = args[0], args[1:]
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for p in paths:
        if os.path.isdir(p):
            for root, dirs, files in os.walk(p):
                dirs.sort()
                for f in sorted(files):
                    full = os.path.join(root, f)
                    if os.path.abspath(full) != os.path.abspath(out):
                        z.write(full, os.path.normpath(full))
        elif os.path.exists(p):
            z.write(p, os.path.normpath(p))
`;
// AutoYT's scripts import packages the media image lacks. This runs the script
// after installing them once per worker run into its scratch disk, under a
// lock so parallel calls don't race.
const PY_BOOTSTRAP = `
import fcntl, importlib, importlib.util, os, runpy, subprocess, sys
target = os.path.join(os.environ.get("SCRATCH_DIR") or "/tmp", "pydeps")
os.makedirs(target, exist_ok=True)
sys.path.insert(0, target)
wanted = [("requests", "requests"), ("cv2", "opencv-python-headless")]
missing = [pkg for mod, pkg in wanted if importlib.util.find_spec(mod) is None]
if missing:
    with open(os.path.join(target, ".lock"), "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        importlib.invalidate_caches()
        missing = [pkg for mod, pkg in wanted if importlib.util.find_spec(mod) is None]
        if missing:
            subprocess.run([sys.executable, "-m", "pip", "install", "--quiet", "--disable-pip-version-check",
                            "--no-warn-script-location", "--break-system-packages", "--target", target, *missing],
                           stdout=sys.stderr, check=False)
            importlib.invalidate_caches()
os.environ["PYTHONPATH"] = os.pathsep.join([target, os.environ.get("PYTHONPATH", "")]).strip(os.pathsep)
script = sys.argv[1]
sys.argv = sys.argv[1:]
sys.path.insert(0, os.path.dirname(os.path.abspath(script)))
runpy.run_path(script, run_name="__main__")
`;
// Rewrites a call into what the managed media image can run.
export function adaptForWorker(program, args) {
  if (program === "python3" && args[0] === "-m" && args[1] === "yt_dlp") return ["yt-dlp", args.slice(2)];
  if (program === "zip") return ["python3", ["-c", ZIP_PY, ...args]];
  if (program === "python3" && args[0] && !args[0].startsWith("-") && args[0].endsWith(".py"))
    return ["python3", ["-c", PY_BOOTSTRAP, ...args]];
  return [program, args];
}

// YouTube bot-checks datacenter IPs, including LingCode compute, so its
// downloads go only to a worker that declares it can reach YouTube.
export function requiredCapability(program, args) {
  return program === "yt-dlp" && args.some((arg) => /^https?:\/\/([a-z0-9-]+\.)*(youtube\.com|youtu\.be)\//i.test(String(arg)))
    ? "youtube"
    : "";
}
export const canTake = (exec, capabilities) => !exec.requires || capabilities.has(exec.requires);

function createExec({ program, args, cwd, env, stdin = "" }) {
  const analysis = analyzeCall(program, args, cwd);
  [program, args] = adaptForWorker(program, args);
  const requires = requiredCapability(program, args);
  const id = `exec_${crypto.randomUUID()}`;
  const exec = {
    id,
    program,
    args,
    env,
    stdin,
    ...analysis,
    requires,
    status: "queued",
    createdAt: Date.now(),
    events: [],
    listeners: new Set(),
    outputs: [],
  };
  exec.push = (event) => {
    exec.events.push(event);
    for (const listener of exec.listeners) listener(event);
  };
  exec.finish = (code, signal, error) => {
    if (exec.status === "done") return;
    exec.status = "done";
    if (error || (code !== 0 && code !== null))
      console.warn(`[remote-media] ${exec.program} ${exec.args.slice(0, 3).join(" ").slice(0, 160)} -> code=${code} ${String(error || "").slice(0, 300)}`);
    clearTimeout(exec.claimTimer);
    clearTimeout(exec.runTimer);
    exec.push({ type: "exit", code, signal: signal || null, error: error || "" });
    setTimeout(() => execs.delete(id), 10 * 60 * 1000).unref();
  };
  exec.claimTimer = setTimeout(() => {
    if (exec.status !== "queued") return;
    const index = pending.indexOf(exec);
    if (index >= 0) pending.splice(index, 1);
    exec.finish(null, null, exec.requires === "youtube" && !(lastCapableSeen.youtube && Date.now() - lastCapableSeen.youtube < 5 * 60 * 1000)
      ? "The YouTube download worker isn't running, so YouTube videos can't be fetched right now."
      : lastWorkerSeen && Date.now() - lastWorkerSeen < 5 * 60 * 1000
        ? "The media worker is busy. Try again in a minute."
        : "The media worker isn't running, so audio and video can't be processed right now.");
  }, CLAIM_TIMEOUT_MS);
  exec.claimTimer.unref?.();
  execs.set(id, exec);
  const index = claimWaiters.findIndex((waiter) => canTake(exec, waiter.capabilities));
  if (index >= 0) claimWaiters.splice(index, 1)[0](exec);
  else pending.push(exec);
  return exec;
}

// Parent: runs a remote call and exposes it as a ChildProcess-like object.
function remoteChild(command, args, options = {}) {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  child.pid = 0;
  child.exitCode = null;
  child.signalCode = null;
  child.killed = false;
  const program = remoteProgram(command);
  const envOverrides = {};
  for (const [key, value] of Object.entries(options.env || {}))
    if (process.env[key] !== value && !/KEY|SECRET|TOKEN|PASSWORD|DATABASE_URL/i.test(key)) envOverrides[key] = value;
  let finished = false;
  const done = (code, signal, error) => {
    if (finished) return;
    finished = true;
    child.exitCode = code;
    child.signalCode = signal;
    child.stdout.end();
    child.stderr.end();
    if (error && code === null && !signal) {
      child.emit("error", Object.assign(new Error(error), { code: "EREMOTE" }));
      child.emit("close", 1, null);
      return;
    }
    if (error) child.stderr.write?.(`\n${error}\n`);
    child.emit("exit", code, signal);
    child.emit("close", code, signal);
  };
  const onEvent = (event) => {
    if (event.type === "stdout") child.stdout.write(Buffer.from(event.data, "base64"));
    else if (event.type === "stderr") child.stderr.write(Buffer.from(event.data, "base64"));
    else if (event.type === "exit") done(event.code, event.signal, event.error);
  };
  let cancel = () => {};
  let started = false;
  const startLocal = (stdin) => {
    let exec;
    try {
      exec = createExec({ program, args: args.map(String), cwd: options.cwd, env: envOverrides, stdin });
    } catch (error) {
      queueMicrotask(() => done(null, null, error.message));
      return;
    }
    child.pid = Number.parseInt(exec.id.slice(-6), 16) || 1;
    exec.listeners.add(onEvent);
    cancel = (signal) => {
      exec.cancelled = signal || "SIGTERM";
      if (exec.status === "queued") {
        const index = pending.indexOf(exec);
        if (index >= 0) pending.splice(index, 1);
        exec.finish(null, exec.cancelled);
      }
    };
  };
  const startBridge = (stdin) => {
    // Child process: hand the call to the parent over localhost.
    const base = process.env.REMOTE_MEDIA_PARENT;
    const headers = { "content-type": "application/json", "x-worker-token": process.env.REMOTE_MEDIA_TOKEN || "" };
    let id = "";
    let cursor = 0;
    let stopped = false;
    (async () => {
      try {
        const created = await fetch(`${base}/internal/exec/local`, {
          method: "POST",
          headers,
          body: JSON.stringify({ program, args: args.map(String), cwd: options.cwd || process.cwd(), env: envOverrides, stdin }),
        }).then((r) => r.json());
        if (!created.id) throw new Error(created.error || "The media bridge refused the call");
        id = created.id;
        while (!stopped) {
          const batch = await fetch(`${base}/internal/exec/${id}/events?cursor=${cursor}`, { headers }).then((r) => r.json());
          for (const event of batch.events || []) onEvent(event);
          cursor = batch.cursor ?? cursor;
          if ((batch.events || []).some((event) => event.type === "exit")) return;
        }
      } catch (error) {
        done(null, null, `Media bridge failed: ${error.message}`);
      }
    })();
    cancel = (signal) => {
      stopped = true;
      if (id) void fetch(`${base}/internal/exec/${id}/cancel`, { method: "POST", headers, body: JSON.stringify({ signal }) }).catch(() => {});
      done(null, signal || "SIGTERM");
    };
  };
  child.kill = (signal = "SIGTERM") => {
    child.killed = true;
    if (!started) {
      // Cancelled before the call was handed off: never start it.
      started = true;
      done(null, signal);
      return true;
    }
    cancel(signal);
    return true;
  };
  if (options.signal) {
    if (options.signal.aborted) queueMicrotask(() => child.kill());
    else
      options.signal.addEventListener(
        "abort",
        () => {
          child.kill();
          child.emit("error", Object.assign(new Error("The operation was aborted"), { name: "AbortError", code: "ABORT_ERR" }));
        },
        { once: true },
      );
  }
  queueMicrotask(() => child.emit("spawn"));
  // Callers that feed stdin write and end it right after spawn. Collect it,
  // then start once it ends, or after a moment when nothing was written.
  const input = [];
  const timers = [];
  const start = () => {
    timers.forEach(clearTimeout);
    if (started) return;
    started = true;
    const stdin = Buffer.concat(input).toString("base64");
    if (process.env.REMOTE_MEDIA_PARENT && !globalThis.__remoteMediaParent) startBridge(stdin);
    else startLocal(stdin);
  };
  child.stdin.on("data", (chunk) => input.push(Buffer.from(chunk)));
  child.stdin.on("finish", start);
  // Referenced on purpose: a small child process must stay alive until the
  // call is handed off. Both are cleared once it starts.
  timers.push(setTimeout(() => {
    if (!input.length) start();
  }, 200));
  timers.push(setTimeout(start, 10000));
  return child;
}

// Version and import probes can't wait for a worker, so they are answered from
// what the managed media image is known to carry.
const REMOTE_PYTHON_MODULES = new Set(
  String(process.env.REMOTE_MEDIA_PYTHON_MODULES || "faster_whisper,numpy,cv2,requests,yt_dlp,json,sys,os,subprocess,pathlib,re,math")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean),
);
function remoteSyncProbe(command, args) {
  const program = remoteProgram(command);
  const text = args.map(String);
  const fake = (status, stdout = "") => ({ pid: 0, status, signal: null, stdout, stderr: "", output: [null, stdout, ""], error: undefined });
  if (text.some((arg) => ["-version", "--version", "-v", "-h", "--help"].includes(arg))) return fake(0, `${program} (remote media worker)\n`);
  if (program === "python3" && text[0] === "-c") {
    const modules = [...text[1].matchAll(/import\s+([\w.,\s]+)/g)].flatMap((m) => m[1].split(",")).map((m) => m.trim().split(/[.\s]/)[0]).filter(Boolean);
    return fake(modules.every((name) => REMOTE_PYTHON_MODULES.has(name)) ? 0 : 1);
  }
  return null;
}

export function installRemoteMedia() {
  if (globalThis.__remoteMediaInstalled) return;
  globalThis.__remoteMediaInstalled = true;
  const preload = pathToFileURL(fileURLToPath(import.meta.url)).href;
  childProcess.spawn = function spawn(command, args, options) {
    if (!Array.isArray(args)) {
      options = args;
      args = [];
    }
    if (command === process.execPath && process.env.REMOTE_MEDIA_PARENT && !args.includes("--import")) {
      // Child Node processes load this module too, so their calls reach the queue.
      args = ["--import", preload, ...args];
    }
    if (shouldRunRemotely(command)) return remoteChild(command, args || [], options || {});
    return original.spawn.call(this, command, args, options);
  };
  childProcess.spawnSync = function spawnSync(command, args, options) {
    if (Array.isArray(args) && shouldRunRemotely(command)) {
      const probe = remoteSyncProbe(command, args);
      if (probe) return probe;
    }
    return original.spawnSync.call(this, command, args, options);
  };
  syncBuiltinESMExports();
}

// ---------- HTTP endpoints for the worker and child processes ----------
export function registerRemoteMedia(app, { token = process.env.WORKER_SCRIPT_TOKEN, port = process.env.PORT || 3000 } = {}) {
  globalThis.__remoteMediaParent = true;
  const secret = String(token || "").trim();
  if (secret) {
    process.env.REMOTE_MEDIA_PARENT = `http://127.0.0.1:${port}`;
    process.env.REMOTE_MEDIA_TOKEN = secret;
  }
  const authorized = (req) => {
    const offered = String(req.get("x-worker-token") || "");
    return Boolean(secret) && offered.length === secret.length && crypto.timingSafeEqual(Buffer.from(offered), Buffer.from(secret));
  };
  const guard = (handler) => async (req, res) => {
    if (!authorized(req)) return res.status(401).json({ error: "Unauthorized" });
    try {
      await handler(req, res);
    } catch (error) {
      if (!res.headersSent) res.status(400).json({ error: error.message });
    }
  };
  const find = (req) => {
    const exec = execs.get(req.params.id);
    if (!exec) throw Object.assign(new Error("Unknown exec"), { status: 404 });
    return exec;
  };
  const inside = (exec, file) => exec.watch.some((dir) => file === dir || file.startsWith(dir + path.sep));

  // Worker source, served like the transcription worker's.
  app.get("/internal/job-exec.mjs", guard((req, res) => {
    res.type("text/javascript").send(fs.readFileSync(path.join(appRoot, "scripts", "lingcode-cloud", "job-exec.mjs"), "utf8"));
  }));
  // Long-poll: hands the next queued call to a worker, or 204 after ~15s.
  // Longer holds get cut by the edge proxy with a 502.
  app.get("/internal/exec/claim", guard(async (req, res) => {
    lastWorkerSeen = Date.now();
    const capabilities = new Set(String(req.query.capabilities || "").split(",").map((item) => item.trim()).filter(Boolean));
    for (const capability of capabilities) lastCapableSeen[capability] = Date.now();
    const give = (exec) => {
      exec.status = "running";
      exec.worker = String(req.query.worker || "worker").slice(0, 80);
      clearTimeout(exec.claimTimer);
      exec.runTimer = setTimeout(() => exec.finish(null, null, "The media worker took too long"), RUN_TIMEOUT_MS);
      exec.runTimer.unref?.();
      res.json({
        id: exec.id,
        program: exec.program,
        args: exec.args,
        cwd: exec.cwd,
        env: exec.env,
        stdin: exec.stdin || "",
        roots: exec.roots,
        watch: exec.watch,
        inputs: exec.inputs.map((file) => ({ path: file, size: fs.statSync(file).size })),
      });
    };
    const nextIndex = pending.findIndex((exec) => canTake(exec, capabilities));
    if (nextIndex >= 0) return give(pending.splice(nextIndex, 1)[0]);
    let timer;
    const waiter = Object.assign((exec) => {
      clearTimeout(timer);
      if (res.writableEnded || req.socket.destroyed) {
        pending.unshift(exec);
        return;
      }
      give(exec);
    }, { capabilities });
    claimWaiters.push(waiter);
    timer = setTimeout(() => {
      const index = claimWaiters.indexOf(waiter);
      if (index >= 0) claimWaiters.splice(index, 1);
      res.status(204).end();
    }, 15000);
    req.on("close", () => {
      const index = claimWaiters.indexOf(waiter);
      if (index >= 0) claimWaiters.splice(index, 1);
      clearTimeout(timer);
    });
  }));
  app.get("/internal/exec/:id/input", guard(async (req, res) => {
    const exec = find(req);
    const file = path.resolve(String(req.query.path || ""));
    if (!exec.inputs.includes(file)) return res.status(403).json({ error: "Not an input of this call" });
    // A plain stream: express's sendFile refuses any path with a dot-folder.
    const stat = await fsp.stat(file).catch(() => null);
    if (!stat?.isFile()) {
      console.warn(`[remote-media] input vanished before the worker fetched it: ${file}`);
      return res.status(404).json({ error: `Input ${path.basename(file)} no longer exists` });
    }
    res.setHeader("content-type", "application/octet-stream");
    res.setHeader("content-length", String(stat.size));
    fs.createReadStream(file).pipe(res);
  }));
  app.put("/internal/exec/:id/output", guard(async (req, res) => {
    const exec = find(req);
    const file = path.resolve(String(req.query.path || ""));
    if (!inside(exec, file) || !isTmp(file)) return res.status(403).json({ error: "Outputs must stay inside the call's working directories" });
    await fsp.mkdir(path.dirname(file), { recursive: true });
    const partial = `${file}.part-${crypto.randomUUID().slice(0, 8)}`;
    await new Promise((resolve, reject) => {
      const out = fs.createWriteStream(partial);
      req.pipe(out);
      out.on("finish", resolve);
      out.on("error", reject);
      req.on("error", reject);
    });
    await fsp.rename(partial, file);
    exec.outputs.push(file);
    res.json({ ok: true });
  }));
  app.post("/internal/exec/:id/stream", guard((req, res) => {
    const exec = find(req);
    if (req.body?.stdout) exec.push({ type: "stdout", data: String(req.body.stdout) });
    if (req.body?.stderr) exec.push({ type: "stderr", data: String(req.body.stderr) });
    res.json({ cancelled: exec.cancelled || null });
  }));
  app.post("/internal/exec/:id/finish", guard((req, res) => {
    const exec = find(req);
    if (req.body?.stdout) exec.push({ type: "stdout", data: String(req.body.stdout) });
    if (req.body?.stderr) exec.push({ type: "stderr", data: String(req.body.stderr) });
    exec.finish(req.body?.code ?? null, req.body?.signal || null, req.body?.error || "");
    res.json({ ok: true });
  }));
  // Child processes on this host.
  app.post("/internal/exec/local", guard((req, res) => {
    if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress)) return res.status(403).json({ error: "Local only" });
    const exec = createExec({
      program: remoteProgram(req.body.program) || String(req.body.program),
      args: (req.body.args || []).map(String),
      cwd: req.body.cwd,
      env: req.body.env || {},
      stdin: String(req.body.stdin || ""),
    });
    res.json({ id: exec.id });
  }));
  app.get("/internal/exec/:id/events", guard(async (req, res) => {
    const exec = find(req);
    const cursor = Number(req.query.cursor) || 0;
    const send = () => res.json({ events: exec.events.slice(cursor), cursor: exec.events.length });
    if (exec.events.length > cursor) return send();
    const listener = () => {
      exec.listeners.delete(listener);
      clearTimeout(timer);
      if (!res.headersSent) send();
    };
    const timer = setTimeout(listener, 20000);
    exec.listeners.add(listener);
  }));
  app.post("/internal/exec/:id/cancel", guard((req, res) => {
    const exec = find(req);
    exec.cancelled = String(req.body?.signal || "SIGTERM");
    if (exec.status === "queued") {
      const index = pending.indexOf(exec);
      if (index >= 0) pending.splice(index, 1);
      exec.finish(null, exec.cancelled);
    }
    res.json({ ok: true });
  }));
  app.get("/internal/exec/status", guard((req, res) => {
    res.json({ queued: pending.length, running: [...execs.values()].filter((e) => e.status === "running").length, workerSeenAgoMs: lastWorkerSeen ? Date.now() - lastWorkerSeen : null });
  }));
}

// Worker health for /health: true when a worker has polled recently.
export function remoteMediaStatus() {
  return {
    workerSeenAgoSeconds: lastWorkerSeen ? Math.round((Date.now() - lastWorkerSeen) / 1000) : null,
    queued: pending.length,
  };
}

if (process.env.REMOTE_MEDIA_PARENT && !globalThis.__remoteMediaParent) installRemoteMedia();
