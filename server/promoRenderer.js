// Promo Studio renderer. A film is one HTML document whose window.seek(t) is a
// pure function of time, so every frame is a deterministic seek in headless
// Chrome: sample frames for the model to review, then JPEG frames into ffmpeg.
import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import puppeteer from "puppeteer-core";
import { creatorCommand } from "./creatorWorkspace.js";

const HOST = "data-promo-host";
const KIT = "data-promo-kit";

function newestBinary(root, name) {
  if (!fsSync.existsSync(root)) return "";
  const found = [];
  const walk = (dir, depth) => {
    if (depth > 4) return;
    for (const entry of fsSync.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, depth + 1);
      else if (entry.name === name) found.push(full);
    }
  };
  try {
    walk(root, 0);
  } catch {}
  return found.sort().at(-1) || "";
}

/** The Chrome used for checks and renders: configured, then the HyperFrames, Puppeteer, or Playwright cache, then a system install. */
export function promoChromePath(env = process.env) {
  const configured = String(env.PROMO_CHROME_PATH || env.PUPPETEER_EXECUTABLE_PATH || "").trim();
  if (configured) return fsSync.existsSync(configured) ? configured : "";
  const home = os.homedir();
  const playwright = [env.PLAYWRIGHT_BROWSERS_PATH, path.join(home, ".cache/ms-playwright"), path.join(home, "Library/Caches/ms-playwright")].filter(Boolean);
  const cached =
    [path.join(home, ".cache/hyperframes/chrome"), path.join(home, ".cache/puppeteer/chrome-headless-shell"), ...playwright].map((root) => newestBinary(root, "chrome-headless-shell")).find(Boolean) ||
    playwright.map((root) => newestBinary(root, "headless_shell")).find(Boolean);
  if (cached) return cached;
  return ["/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].find((file) => fsSync.existsSync(file)) || "";
}

const hyperframesBin = () => [String(process.env.HYPERFRAMES_BIN || "").trim(), path.resolve("node_modules/.bin/hyperframes")].find((file) => file && fsSync.existsSync(file)) || "";
let downloading = null;
export async function ensurePromoChrome() {
  const found = promoChromePath();
  if (found) return found;
  if (process.env.LINGCODE_APP_ID) return "";
  const bin = hyperframesBin();
  if (!bin) return "";
  downloading ||= (async () => {
    await creatorCommand(bin, ["browser", "ensure"], AbortSignal.timeout(5 * 60 * 1000));
    const stdout = await creatorCommand(bin, ["browser", "path"], AbortSignal.timeout(30000));
    const file = String(stdout || "").trim().split(/\r?\n/).pop() || "";
    return fsSync.existsSync(file) ? file : "";
  })().catch((error) => {
    console.warn(`[promo] could not get Chrome: ${error.message}`);
    return "";
  }).finally(() => setTimeout(() => (downloading = null), 60000));
  return downloading;
}
export const promoRendererAvailable = () => Boolean(promoChromePath() || (process.env.LINGCODE_APP_ID && process.env.WORKER_SCRIPT_TOKEN) || hyperframesBin());

// Helpers every film can use as window.M, so the model spends tokens on design, not easing math.
const MOTION_LIB = `(function(){
var clamp=function(v,a,b){return Math.min(b===undefined?1:b,Math.max(a===undefined?0:a,v))};
var lerp=function(a,b,k){return a+(b-a)*k};
var ease={linear:function(k){return k},inOut:function(k){return k<.5?4*k*k*k:1-Math.pow(-2*k+2,3)/2},out:function(k){return 1-Math.pow(1-k,3)},in:function(k){return k*k*k},outExpo:function(k){return k>=1?1:1-Math.pow(2,-10*k)},inOutExpo:function(k){return k<=0?0:k>=1?1:k<.5?Math.pow(2,20*k-10)/2:(2-Math.pow(2,-20*k+10))/2},outBack:function(k){var c=1.2;return 1+(c+1)*Math.pow(k-1,3)+c*Math.pow(k-1,2)}};
function ramp(t,t0,t1,fn){if(t1<=t0)return t>=t1?1:0;var k=clamp((t-t0)/(t1-t0));return (typeof fn==="function"?fn:ease[fn||"inOut"])(k)}
function spring(t,t0,o){o=o||{};if(t<=t0)return 0;var s=o.stiffness||170,d=o.damping||26,m=o.mass||1,x=t-t0,w=Math.sqrt(s/m),z=d/(2*Math.sqrt(s*m));if(z<1){var wd=w*Math.sqrt(1-z*z);return 1-Math.exp(-z*w*x)*(Math.cos(wd*x)+(z*w/wd)*Math.sin(wd*x))}return 1-Math.exp(-w*x)*(1+w*x)}
function hash(n){var x=Math.sin(n*127.1+311.7)*43758.5453;return x-Math.floor(x)}
function stagger(i,step,start){return (start||0)+i*(step||0.06)}
function map(v,a,b,c,d){return lerp(c,d,clamp((v-a)/(b-a)))}
window.M={clamp:clamp,lerp:lerp,ease:ease,ramp:ramp,spring:spring,hash:hash,stagger:stagger,map:map};
})();`;

/**
 * Wrap the model's film with the host: fonts, assets, the motion helpers, a
 * seeded Math.random, stage fitting, and __promoSeek, which also pins any CSS
 * or Web Animations to the same clock. Outside the renderer it plays in a loop.
 */
export function hostPromoDocument(html, { width, height, duration, fontCss = "", assets = {} }) {
  const kit = JSON.stringify({ fontCss, assets }).replace(/</g, "\\u003c");
  const head =
    `<script type="application/json" ${KIT}>${kit}</script>` +
    `<style ${HOST}>${fontCss}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#000}#stage{position:absolute!important;left:50%!important;top:50%!important;width:${width}px!important;height:${height}px!important;transform-origin:center center;overflow:hidden}</style>` +
    `<script ${HOST}>window.__PROMO__={width:${width},height:${height},duration:${duration}};` +
    `(function(){var s=1234567;Math.random=function(){s|=0;s=s+0x6D2B79F5|0;var t=Math.imul(s^s>>>15,1|s);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}})();` +
    MOTION_LIB +
    `(function(){var A=JSON.parse(document.querySelector("script[${KIT}]").textContent).assets||{};` +
    `function fix(el){["src","href"].forEach(function(k){var v=el.getAttribute&&el.getAttribute(k);if(v&&v.indexOf("asset:")===0&&A[v.slice(6)])el.setAttribute(k,A[v.slice(6)])})}` +
    `function sweep(root){if(!root.querySelectorAll)return;fix(root);root.querySelectorAll("[src^='asset:'],[href^='asset:']").forEach(fix)}` +
    `new MutationObserver(function(list){list.forEach(function(m){if(m.type==="attributes")fix(m.target);else m.addedNodes.forEach(sweep)})}).observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:["src","href"]});` +
    `window.promoAsset=function(id){return A[id]||""};` +
    `function fit(){var s=document.getElementById("stage");if(!s)return;var k=Math.min(innerWidth/${width},innerHeight/${height});s.style.transform="translate(-50%,-50%) scale("+k+")"}` +
    `addEventListener("resize",fit);document.addEventListener("DOMContentLoaded",function(){sweep(document);fit()});addEventListener("load",fit);` +
    `window.__promoSeek=async function(t){t=Math.max(0,Math.min(${duration},t));window.__promoTime=t;if(typeof window.seek==="function"){var r=window.seek(t);if(r&&typeof r.then==="function")await r}if(document.getAnimations)document.getAnimations().forEach(function(a){try{a.pause();a.currentTime=t*1000}catch(e){}})};` +
    `if(!window.__PROMO_RENDER__)addEventListener("load",function(){var s0=null;function loop(n){if(s0===null)s0=n;window.__promoSeek(((n-s0)/1000)%${duration});requestAnimationFrame(loop)}requestAnimationFrame(loop)});` +
    `})();</script>`;
  const doc = /<!doctype/i.test(html) ? String(html) : `<!doctype html>${html}`;
  return /<head[^>]*>/i.test(doc) ? doc.replace(/<head[^>]*>/i, (tag) => tag + head) : doc.replace(/<html[^>]*>/i, (tag) => `${tag}<head>${head}</head>`);
}

/** The model's own document, for revisions: the host blocks removed. */
export const stripPromoHost = (html) => String(html).replace(new RegExp(`<(style|script)[^>]*\\s(?:${HOST}|${KIT})[^>]*>[\\s\\S]*?</\\1>`, "g"), "");
export function promoKit(html) {
  const match = String(html).match(new RegExp(`<script[^>]*\\s${KIT}[^>]*>([\\s\\S]*?)</script>`));
  try {
    const kit = JSON.parse(match?.[1] || "{}");
    return { fontCss: String(kit.fontCss || ""), assets: kit.assets && typeof kit.assets === "object" ? kit.assets : {} };
  } catch {
    return { fontCss: "", assets: {} };
  }
}

async function launch(signal) {
  const executablePath = await ensurePromoChrome();
  if (!executablePath) throw Object.assign(new Error("Promo rendering needs Chrome on the server"), { statusCode: 503, code: "NO_CHROME" });
  const browser = await puppeteer.launch({
    executablePath,
    headless: /headless[-_]shell/.test(executablePath) ? "shell" : true,
    args: ["--hide-scrollbars", "--mute-audio", "--font-render-hinting=none", "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", ...(process.getuid?.() === 0 ? ["--no-sandbox"] : [])],
  });
  const close = () => void browser.close().catch(() => {});
  signal?.addEventListener("abort", close, { once: true });
  return { browser, close: () => { signal?.removeEventListener("abort", close); close(); } };
}

const SITE_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36";
const SITE_TYPES = new Set(["document", "stylesheet", "image", "font", "script", "fetch", "xhr"]);
/**
 * Open a website in Chrome to see it the way a visitor does: viewport screenshots down the page,
 * the images it actually shows (with their bytes), its rendered text, and its internal links.
 * Chrome never touches the network itself: every request goes through fetcher (safePublicFetch),
 * which refuses private addresses at every redirect.
 */
export async function captureSite(url, { fetcher, signal, width = 1440, height = 900, shots = 3, maxRequests = 180 }) {
  if (process.env.LINGCODE_APP_ID && process.env.WORKER_SCRIPT_TOKEN) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "autoyt-promo-capture-"));
    try {
      const reportFile = path.join(dir, "site.json");
      await creatorCommand("autoyt-promo-render", ["--capture", url, reportFile, String(width), String(height), String(shots), String(maxRequests)], signal);
      const report = JSON.parse(await fs.readFile(reportFile, "utf8"));
      return {
        ...report,
        screens: report.screens.map((jpeg) => Buffer.from(jpeg, "base64")),
        images: report.images.map((image) => ({ ...image, body: Buffer.from(image.body, "base64") })),
      };
    } finally {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }
  const { browser, close } = await launch(signal);
  try {
    const page = await browser.newPage();
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    await page.setUserAgent(SITE_UA);
    await page.setRequestInterception(true);
    const bodies = new Map();
    let budget = maxRequests;
    page.on("request", async (request) => {
      const target = request.url();
      if (/^(data|blob):/.test(target)) return void request.continue().catch(() => {});
      if (request.method() !== "GET" || !SITE_TYPES.has(request.resourceType()) || budget-- <= 0) return void request.abort().catch(() => {});
      try {
        const result = await fetcher(target, { accept: request.headers().accept || "*/*", maxBytes: 5 * 1024 * 1024, timeoutMs: 12000, userAgent: SITE_UA });
        if (request.resourceType() === "image") bodies.set(target, { type: result.type, body: result.body });
        await request.respond({ status: 200, contentType: result.type || "application/octet-stream", body: result.body, headers: { "access-control-allow-origin": "*" } });
      } catch {
        await request.abort().catch(() => {});
      }
    });
    await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 }).catch(() => {});
    signal?.throwIfAborted();
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const screens = [];
    const pageHeight = await page.evaluate(() => document.documentElement.scrollHeight).catch(() => height);
    for (let i = 0; i < shots; i++) {
      const y = Math.round(i * height * 0.92);
      if (i && y > pageHeight - height * 0.4) break;
      await page.evaluate((top) => window.scrollTo(0, top), y).catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 700));
      screens.push(Buffer.from(await page.screenshot({ type: "jpeg", quality: 78 })));
    }
    const seen = await page
      .evaluate(() => ({
        text: (document.body?.innerText || "").replace(/\s+/g, " ").trim().slice(0, 8000),
        headings: [...document.querySelectorAll("h1,h2,h3")].map((node) => (node.textContent || "").replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 24),
        actions: [...document.querySelectorAll("button,a[href]")].map((node) => (node.textContent || "").replace(/\s+/g, " ").trim()).filter((value) => value.length >= 2 && value.length <= 32).slice(0, 28),
        images: [...document.images]
          .filter((img) => img.naturalWidth >= 360 && img.naturalHeight >= 200 && img.getBoundingClientRect().width >= 160)
          .map((img) => ({ src: img.currentSrc || img.src, width: img.naturalWidth, height: img.naturalHeight, alt: (img.alt || "").slice(0, 120) })),
        links: [...document.querySelectorAll("a[href]")].map((a) => ({ href: a.href, text: (a.textContent || "").replace(/\s+/g, " ").trim().slice(0, 40) })),
      }))
      .catch(() => ({ text: "", headings: [], actions: [], images: [], links: [] }));
    const images = [];
    for (const image of seen.images) {
      const hit = bodies.get(image.src);
      if (hit && !images.some((item) => item.src === image.src)) images.push({ ...image, ...hit });
    }
    images.sort((a, b) => b.width * b.height - a.width * a.height);
    return { screens, text: seen.text, headings: seen.headings, actions: seen.actions, images: images.slice(0, 8), links: seen.links };
  } finally {
    close();
  }
}

// Films run with no network at all: data: URLs only.
async function openFilm(browser, html, { width, height, scale = 1 }) {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error?.message || error).slice(0, 300)));
  page.on("console", (message) => message.type() === "error" && errors.push(message.text().slice(0, 300)));
  await page.setRequestInterception(true);
  page.on("request", (request) => (/^(data|blob|about):/.test(request.url()) ? request.continue() : request.abort()));
  await page.setViewport({ width, height, deviceScaleFactor: scale });
  // setContent rewrites the existing about:blank document, so evaluateOnNewDocument never runs; the flag
  // must be in the markup ahead of the host script or its preview loop keeps seeking to wall-clock time.
  const flag = "<script>window.__PROMO_RENDER__=true</script>";
  const marked = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (tag) => tag + flag) : flag + html;
  await page.setContent(marked, { waitUntil: "load", timeout: 45000 });
  await page.evaluate(() => document.fonts?.ready?.then(() => undefined));
  const hasSeek = await page.evaluate(() => typeof window.seek === "function");
  return { page, errors, hasSeek };
}
const seekTo = (page, t) => page.evaluate((time) => window.__promoSeek(time), t);

// Runs in the page: visible text, and text that is cut off, crowded, overlapping, or tiny.
function auditFrame() {
  const stage = document.getElementById("stage");
  if (!stage) return { texts: [], issues: ["There is no #stage element"] };
  const box = stage.getBoundingClientRect();
  const { width: W, height: H } = window.__PROMO__;
  const k = box.width / W || 1;
  const opacity = (el) => {
    let o = 1;
    for (let node = el; node && node !== document.body; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden") return 0;
      o *= Number(style.opacity);
    }
    return o;
  };
  const items = [];
  const walker = document.createTreeWalker(stage, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent.replace(/\s+/g, " ").trim();
    const el = node.parentElement;
    if (!text || !el || el.closest("script,style")) continue;
    const o = opacity(el);
    if (o < 0.08) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    const r = range.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    const style = getComputedStyle(el);
    // Outlined type with no fill (a big step number behind a word) is a backdrop, not competing text.
    const ghost = /rgba\(.*,\s*0\)|transparent/.test(style.webkitTextFillColor || style.color) && !/text/.test(style.backgroundClip || style.webkitBackgroundClip);
    items.push({ text: text.slice(0, 80), o, ghost, size: parseFloat(style.fontSize) * k, x: (r.left - box.left) / k, y: (r.top - box.top) / k, w: r.width / k, h: r.height / k });
  }
  const issues = [];
  const margin = Math.min(W, H) * 0.04;
  for (const item of items) {
    if (item.o < 0.6) continue;
    if (item.x < -2 || item.y < -2 || item.x + item.w > W + 2 || item.y + item.h > H + 2) issues.push(`"${item.text}" is cut off by the frame edge`);
    else if (item.x < margin || item.y < margin || item.x + item.w > W - margin || item.y + item.h > H - margin) issues.push(`"${item.text}" sits outside the title-safe margin`);
    if (item.size < Math.min(W, H) / 45) issues.push(`"${item.text}" is ${Math.round(item.size)}px, too small to read`);
  }
  const solid = items.filter((item) => item.o >= 0.6 && !item.ghost);
  for (let i = 0; i < solid.length; i++)
    for (let j = i + 1; j < solid.length; j++) {
      const a = solid[i], b = solid[j];
      const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
      const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
      if (ix * iy > 0.25 * Math.min(a.w * a.h, b.w * b.h)) issues.push(`"${a.text}" overlaps "${b.text}"`);
    }
  return { texts: [...new Set(items.filter((item) => item.o >= 0.6).map((item) => item.text))].slice(0, 12), issues: [...new Set(issues)].slice(0, 10) };
}

/** Load the film, sample frames as small JPEGs, and report errors and layout problems at each. */
export async function inspectPromo(html, { width, height, duration, samples = 8, signal }) {
  if (process.env.LINGCODE_APP_ID && process.env.WORKER_SCRIPT_TOKEN) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "autoyt-promo-inspect-"));
    try {
      const source = path.join(dir, "film.html");
      const reportFile = path.join(dir, "report.json");
      await fs.writeFile(source, html);
      await creatorCommand("autoyt-promo-render", ["--inspect", source, reportFile, String(width), String(height), String(duration), String(samples)], signal);
      const report = JSON.parse(await fs.readFile(reportFile, "utf8"));
      return { ...report, frames: report.frames.map((frame) => ({ ...frame, jpeg: Buffer.from(frame.jpeg, "base64") })) };
    } finally {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }
  const { browser, close } = await launch(signal);
  try {
    const { page, errors, hasSeek } = await openFilm(browser, html, { width, height, scale: Math.min(1, 960 / Math.max(width, height)) });
    const times = Array.from({ length: samples }, (_, i) => Number((0.4 + (i * (duration - 0.9)) / (samples - 1)).toFixed(2)));
    const frames = [];
    for (const t of times) {
      signal?.throwIfAborted();
      try {
        await seekTo(page, t);
      } catch (error) {
        errors.push(`seek(${t}) threw: ${String(error?.message || error).slice(0, 200)}`);
      }
      const audit = await page.evaluate(auditFrame).catch(() => ({ texts: [], issues: [] }));
      const jpeg = await page.screenshot({ type: "jpeg", quality: 72, optimizeForSpeed: true });
      frames.push({ t, jpeg: Buffer.from(jpeg), ...audit });
    }
    const started = Date.now();
    for (let i = 0; i < 10; i++) await seekTo(page, (i * duration) / 10).catch(() => {});
    const seekMs = (Date.now() - started) / 10;
    // seek(t) must not depend on earlier calls: revisit the samples backwards and compare what is on screen.
    for (const frame of [...frames].reverse()) {
      await seekTo(page, frame.t).catch(() => {});
      const again = await page.evaluate(auditFrame).catch(() => null);
      const extra = again?.texts.filter((text) => !frame.texts.includes(text)) || [];
      const missing = frame.texts.filter((text) => !again?.texts.includes(text));
      if (again && (extra.length || missing.length))
        errors.push(`seek(${frame.t}) depends on earlier seek calls: jumping there backwards ${extra.length ? `also shows "${extra.slice(0, 3).join('", "')}"` : ""}${extra.length && missing.length ? " and " : ""}${missing.length ? `loses "${missing.slice(0, 3).join('", "')}"` : ""}. Every element's visibility, position, and text must be set from t on every call, including elements of other scenes.`);
    }
    return { errors: [...new Set(errors)].slice(0, 12), hasSeek, frames, seekMs };
  } finally {
    close();
  }
}

/** Render every frame and encode the MP4, mixing in the music bed when there is one. */
export async function renderPromo({ html, width, height, duration, fps = 30, output, audio, signal, workers = process.env.LINGCODE_APP_ID ? 1 : 3, onProgress }) {
  if (process.env.LINGCODE_APP_ID && process.env.WORKER_SCRIPT_TOKEN) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "autoyt-promo-remote-"));
    try {
      const source = path.join(dir, "film.html");
      await fs.writeFile(source, html);
      await creatorCommand("autoyt-promo-render", [source, output, String(width), String(height), String(duration), String(fps), audio?.path || "-"], signal);
      onProgress?.(1);
      return output;
    } finally {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "autoyt-promo-"));
  const { browser, close } = await launch(signal);
  try {
    const total = Math.round(duration * fps);
    const size = Math.ceil(total / workers);
    let done = 0;
    await Promise.all(
      Array.from({ length: workers }, async (_, worker) => {
        const from = worker * size, to = Math.min(total, from + size);
        if (from >= to) return;
        const { page } = await openFilm(browser, html, { width, height });
        for (let frame = from; frame < to; frame++) {
          signal?.throwIfAborted();
          await seekTo(page, frame / fps);
          await page.screenshot({ type: "jpeg", quality: 92, optimizeForSpeed: true, path: path.join(dir, `${String(frame).padStart(5, "0")}.jpg`) });
          done++;
          if (done % 30 === 0) onProgress?.(done / total);
        }
        await page.close().catch(() => {});
      }),
    );
    close();
    const fade = Math.min(1.5, duration / 8);
    await creatorCommand(process.env.FFMPEG_PATH || "ffmpeg", [
      "-y", "-v", "error",
      "-framerate", String(fps), "-i", path.join(dir, "%05d.jpg"),
      ...(audio ? [...(audio.inputArgs || []), "-i", audio.path] : []),
      ...(audio ? ["-map", "0:v", "-map", "1:a", "-af", `apad,atrim=0:${duration},afade=t=in:d=0.04,afade=t=out:st=${(duration - fade).toFixed(2)}:d=${fade.toFixed(2)},loudnorm=I=-14:TP=-1.5:LRA=11`, "-c:a", "aac", "-b:a", "192k"] : []),
      "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
      "-t", String(duration), output,
    ], signal);
    return output;
  } finally {
    close();
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
