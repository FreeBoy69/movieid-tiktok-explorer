import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

const version = "0.8.77";

function binary() {
  const configured = String(process.env.HYPERFRAMES_BIN || "").trim();
  if (configured) return configured;
  const local = path.resolve("node_modules/.bin/hyperframes");
  return fsSync.existsSync(local) ? local : "";
}

// The hosted app has no Chrome, so in production HyperFrames runs on the media
// worker (scripts/hyperframes_render.py, which needs the "movie" capability:
// the worker that renders Movie to Recap's graphics). Locally the pinned CLI
// in node_modules renders directly.
const remote = () => Boolean(process.env.LINGCODE_APP_ID && process.env.WORKER_SCRIPT_TOKEN);
const SCRIPT = path.resolve("scripts/hyperframes_render.py");

export function hyperframesAvailable() {
  return process.env.HYPERFRAMES_ENABLED !== "false" && (remote() || Boolean(binary()));
}

function run(command, args, signal) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], signal });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk).slice(-6000);
    });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`HyperFrames render failed: ${stderr.slice(-1800)}`)));
  });
}

/**
 * Render a HyperFrames project: `files` maps a name inside the project to its
 * text, or to { path } for a file to copy (fonts, gsap, images). With `rows`,
 * one output per row of variables is written to `output` with {index} filled
 * in; returns the list of outputs. `format` "mov" keeps transparency (ProRes 4444).
 */
export async function renderHyperframesProject({ files, composition = "index.html", output, format = "mp4", fps = 30, rows = null, signal, workers = 2 }) {
  if (!hyperframesAvailable()) throw new Error(`HyperFrames ${version} is not available`);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "autoyt-hyperframes-"));
  const project = path.join(root, "project");
  await fs.mkdir(project, { recursive: true });
  try {
    for (const [name, content] of Object.entries(files)) {
      const target = path.join(project, name);
      await fs.mkdir(path.dirname(target), { recursive: true });
      if (content && typeof content === "object" && content.path) await fs.copyFile(content.path, target);
      else await fs.writeFile(target, String(content ?? ""), "utf8");
    }
    let batch = "";
    if (rows) {
      batch = path.join(root, "rows.json");
      await fs.writeFile(batch, JSON.stringify(rows));
    }
    // Remote outputs come back only from the temp directory, so render there and move them after.
    const out = path.join(root, "out");
    await fs.mkdir(out, { recursive: true });
    const ext = path.extname(String(output).replace("{index}", "0")) || `.${format}`;
    const local = path.join(out, rows ? `render-{index}${ext}` : `render${ext}`);
    if (remote()) {
      const { creatorCommand } = await import("./creatorWorkspace.js");
      await creatorCommand(process.env.PYTHON_PATH || "python3", [SCRIPT, project, local, "--composition", composition, "--format", format, "--fps", String(fps), "--workers", String(workers), ...(batch ? ["--batch", batch] : [])], signal);
    } else {
      await run(binary(), ["render", project, "-c", composition, "--output", local, "--format", format, "--fps", String(fps), "--workers", String(workers), "--no-browser-gpu", "--quiet", ...(batch ? ["--batch", batch] : [])], signal);
    }
    const targets = rows ? rows.map((_, index) => String(output).replace("{index}", String(index))) : [output];
    const done = [];
    for (const [index, target] of targets.entries()) {
      const made = rows ? local.replace("{index}", String(index)) : local;
      if (!(await fs.stat(made).catch(() => null))?.size) continue;
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.copyFile(made, target);
      done.push(target);
    }
    if (!done.length) throw new Error("HyperFrames produced no video");
    return rows ? targets.map((target) => (done.includes(target) ? target : null)) : output;
  } finally {
    await fs.rm(root, { recursive: true, force: true }).catch(() => {});
  }
}

/** GSAP and the caption fonts, as project files for a composition that loads gsap.min.js and fonts/*.ttf. */
export function hyperframesKit(fonts = ["Anton.ttf", "Inter.ttf", "Montserrat.ttf", "PlayfairDisplay.ttf"]) {
  const fontDir = ["dist/fonts/captions", "public/fonts/captions"].map((d) => path.resolve(d)).find((d) => fsSync.existsSync(path.join(d, fonts[0])));
  const files = { "gsap.min.js": { path: path.resolve("node_modules/gsap/dist/gsap.min.js") } };
  for (const font of fonts) if (fontDir) files[`fonts/${font}`] = { path: path.join(fontDir, font) };
  return files;
}

/** Render one self-contained HTML composition (assets: [{ path, name }] copied beside it). */
export async function renderHyperframesHtml({ html, output, width, height, fps = 30, signal, assets = [] }) {
  let composition = String(html || "");
  if (!/<data-composition-id|data-composition-id=/i.test(composition)) throw new Error("HyperFrames composition is missing data-composition-id");
  const files = {};
  for (const asset of Array.isArray(assets) ? assets : []) {
    if (!asset?.path || !asset?.name) continue;
    const name = path.basename(String(asset.name));
    files[name] = { path: String(asset.path) };
    composition = composition.split(fileUrl(asset.path)).join(name);
  }
  files["index.html"] = composition;
  return renderHyperframesProject({ files, output, fps, signal, workers: 1 });
}

const escapeHtml = (value) => String(value || "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#39;");

const fileUrl = (file) => pathToFileURL(path.resolve(file)).href;

function parseSrt(srt) {
  return String(srt || "").split(/\r?\n\s*\r?\n/).map((block) => {
    const lines = block.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const timing = lines.find((line) => line.includes("-->"));
    if (!timing) return null;
    const [from, to] = timing.split("-->").map((item) => item.trim());
    const seconds = (value) => {
      const match = value.match(/(\d+):(\d+):(\d+)[,.](\d+)/);
      return match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(`0.${match[4]}`) : 0;
    };
    const start = seconds(from), end = seconds(to);
    return end > start ? { start, duration: end - start, text: lines.slice(lines.indexOf(timing) + 1).join(" ") } : null;
  }).filter(Boolean);
}

/** Create a deterministic overlay composition for animated captions and scene effects. */
export function buildHyperframesOverlay({ input, captions, scenes = [], width, height, duration, effect = "cinematic" }) {
  const cues = parseSrt(captions);
  const sceneEffects = scenes.map((scene, index) => `<div class="scene-effect effect-${escapeHtml(effect)}" data-start="${Number(scene.start) || 0}" data-duration="${Math.max(0.1, (Number(scene.end) || 0) - (Number(scene.start) || 0))}" data-track-index="${index + 1}"></div>`).join("");
  const captionElements = cues.map((cue, index) => `<div class="hf-caption" data-start="${cue.start.toFixed(3)}" data-duration="${cue.duration.toFixed(3)}" data-track-index="${scenes.length + index + 1}"><span>${escapeHtml(cue.text)}</span></div>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#000}#root{position:relative;width:${width}px;height:${height}px;overflow:hidden;background:#000;font-family:Inter,Arial,sans-serif}.hf-base{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}.scene-effect{position:absolute;inset:0;pointer-events:none;opacity:.18;mix-blend-mode:screen;background:radial-gradient(ellipse at 50% 48%,transparent 42%,rgba(249,220,11,.2) 100%);animation:hf-pulse 2.4s ease-in-out infinite}.effect-flat-motion{background:linear-gradient(120deg,transparent 45%,rgba(249,220,11,.16),transparent 55%);background-size:220% 100%;animation:hf-sweep 1.9s ease-in-out infinite}.effect-minimal-diagram{opacity:.1;background:linear-gradient(90deg,transparent,rgba(255,255,255,.2),transparent);animation:hf-sweep 3.4s ease-in-out infinite}.hf-caption{position:absolute;left:7%;right:7%;bottom:8%;display:grid;place-items:center;text-align:center;color:#fff;filter:drop-shadow(0 3px 8px rgba(0,0,0,.72));font-size:${Math.max(26, Math.round(width / 34))}px;font-weight:800;line-height:1.08;letter-spacing:-.02em;text-wrap:balance}.hf-caption span{max-width:90%;padding:.18em .46em;border-radius:.28em;background:rgba(8,10,14,.72);box-shadow:0 0 0 .08em rgba(249,220,11,.9)}.hf-caption{animation:hf-caption-in .28s cubic-bezier(.2,.8,.2,1) both}@keyframes hf-caption-in{from{opacity:0;transform:translateY(24px) scale(.96)}to{opacity:1;transform:translateY(0) scale(1)}}@keyframes hf-pulse{0%,100%{transform:scale(1);opacity:.1}50%{transform:scale(1.035);opacity:.24}}@keyframes hf-sweep{0%{background-position:-120% 0}100%{background-position:120% 0}}
</style></head><body><div id="root" data-composition-id="root" data-width="${width}" data-height="${height}" data-duration="${duration}"><video class="clip hf-base" data-start="0" data-duration="${duration}" data-track-index="0" data-has-audio="true" src="${fileUrl(input)}" playsinline></video>${sceneEffects}${captionElements}</div></body></html>`;
}
