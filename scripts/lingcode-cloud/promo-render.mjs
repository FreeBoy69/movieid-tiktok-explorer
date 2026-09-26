// Runs on the Promo-capable VPS worker, under an unprivileged user.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import puppeteer from "puppeteer-core";

const inspect = process.argv[2] === "--inspect";
const [htmlFile, output, widthText, heightText, durationText, fpsText, audioFile] = process.argv.slice(inspect ? 3 : 2);
const width = Number(widthText), height = Number(heightText), duration = Number(durationText), fps = Number(fpsText);
if (!htmlFile || !output || ![width, height, duration, fps].every(Number.isFinite) || width < 320 || width > 3840 || height < 320 || height > 3840 || duration <= 0 || duration > 180 || fps < 1 || fps > 60 || (inspect && fps > 12)) {
  throw new Error("Invalid Promo render arguments");
}
const chrome = process.env.PROMO_CHROME_PATH;
if (!chrome) throw new Error("PROMO_CHROME_PATH is required");
const frames = await fs.mkdtemp(path.join(os.tmpdir(), "promo-frames-"));
let browser;
try {
  browser = await puppeteer.launch({
    executablePath: chrome,
    headless: "shell",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--hide-scrollbars", "--mute-audio", "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error?.message || error).slice(0, 300)));
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  await page.setRequestInterception(true);
  page.on("request", (request) => (/^(data|blob|about):/.test(request.url()) ? request.continue() : request.abort()));
  const html = await fs.readFile(htmlFile, "utf8");
  const flag = "<script>window.__PROMO_RENDER__=true</script>";
  const marked = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (tag) => tag + flag) : flag + html;
  await page.setContent(marked, { waitUntil: "load", timeout: 45000 });
  await page.evaluate(() => document.fonts?.ready?.then(() => undefined));
  const hasSeek = await page.evaluate(() => typeof window.seek === "function");
  if (inspect) {
    const samples = Math.round(fps);
    const times = Array.from({ length: samples }, (_, i) => Number((0.4 + i * (duration - 0.9) / Math.max(1, samples - 1)).toFixed(2)));
    const frames = [];
    for (const t of times) {
      try { await page.evaluate((time) => window.__promoSeek(time), t); }
      catch (error) { errors.push(`seek(${t}) threw: ${String(error?.message || error).slice(0, 200)}`); }
      const texts = await page.evaluate(() => [...new Set((document.querySelector("#stage")?.innerText || "").split("\n").map((text) => text.trim()).filter(Boolean))].slice(0, 12));
      const jpeg = (await page.screenshot({ type: "jpeg", quality: 72, optimizeForSpeed: true })).toString("base64");
      frames.push({ t, jpeg, texts, issues: [] });
    }
    const started = Date.now();
    for (let i = 0; i < 10; i++) await page.evaluate((time) => window.__promoSeek(time), i * duration / 10).catch(() => {});
    const seekMs = (Date.now() - started) / 10;
    await fs.writeFile(output, JSON.stringify({ errors: [...new Set(errors)].slice(0, 12), hasSeek, frames, seekMs }));
  } else {
  if (!(await page.evaluate(() => typeof window.__promoSeek === "function"))) throw new Error("Promo film has no seek function");
  const total = Math.round(duration * fps);
  for (let frame = 0; frame < total; frame++) {
    await page.evaluate((time) => window.__promoSeek(time), frame / fps);
    await page.screenshot({ type: "jpeg", quality: 90, optimizeForSpeed: true, path: path.join(frames, `${String(frame).padStart(5, "0")}.jpg`) });
    if (frame % 60 === 0) console.log(`Rendered ${frame + 1}/${total} frames`);
  }
  await browser.close();
  browser = null;
  const fade = Math.min(1.5, duration / 8);
  const args = ["-y", "-v", "error", "-framerate", String(fps), "-i", path.join(frames, "%05d.jpg")];
  if (audioFile !== "-") args.push("-i", audioFile, "-map", "0:v", "-map", "1:a", "-af", `apad,atrim=0:${duration},afade=t=in:d=0.04,afade=t=out:st=${(duration - fade).toFixed(2)}:d=${fade.toFixed(2)},loudnorm=I=-14:TP=-1.5:LRA=11`, "-c:a", "aac", "-b:a", "192k");
  args.push("-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-t", String(duration), output);
  await new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-4000); });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`ffmpeg failed: ${stderr}`)));
  });
  console.log(`Rendered ${total}/${total} frames`);
  }
} finally {
  await browser?.close().catch(() => {});
  await fs.rm(frames, { recursive: true, force: true }).catch(() => {});
}
