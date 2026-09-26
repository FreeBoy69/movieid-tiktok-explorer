// Browser-rendered public-site research for Promo Studio. Chrome never fetches
// the network directly; requests are fulfilled by the hosted app's safe fetch.
import fs from "node:fs/promises";
import puppeteer from "puppeteer-core";

const [url, output, widthText, heightText, shotsText, budgetText] = process.argv.slice(2);
const width = Number(widthText), height = Number(heightText), shots = Number(shotsText), maxRequests = Number(budgetText);
if (!/^https?:\/\//i.test(url || "") || !output || ![width, height, shots, maxRequests].every(Number.isFinite) || width < 320 || width > 2000 || height < 320 || height > 1600 || shots < 1 || shots > 5 || maxRequests < 1 || maxRequests > 200) {
  throw new Error("Invalid Promo capture arguments");
}
const app = String(process.env.APP_URL || "https://autoyt.cc").replace(/\/+$/, "");
const token = process.env.WORKER_SCRIPT_TOKEN;
const chrome = process.env.PROMO_CHROME_PATH;
if (!token || !chrome) throw new Error("Promo capture worker is not configured");
const ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36";
const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: "shell",
  env: { PATH: process.env.PATH || "/usr/bin:/bin", HOME: process.env.HOME || "/tmp", TMPDIR: process.env.TMPDIR || "/tmp" },
  args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--proxy-server=127.0.0.1:9", "--proxy-bypass-list=<-loopback>"],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  await page.setUserAgent(ua);
  await page.setRequestInterception(true);
  let budget = maxRequests;
  const bodies = new Map();
  const allowed = new Set(["document", "stylesheet", "image", "font", "script", "fetch", "xhr"]);
  page.on("request", async (request) => {
    const target = request.url();
    if (/^(data|blob):/.test(target)) return void request.continue().catch(() => {});
    if (request.method() !== "GET" || !allowed.has(request.resourceType()) || budget-- <= 0) return void request.abort().catch(() => {});
    try {
      const response = await fetch(`${app}/internal/promo/fetch`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-worker-token": token },
        body: JSON.stringify({ url: target, accept: request.headers().accept || "*/*", maxBytes: request.resourceType() === "image" ? 1.5 * 1024 * 1024 : 5 * 1024 * 1024, userAgent: ua }),
        signal: AbortSignal.timeout(18000),
      });
      if (!response.ok) throw new Error(`Resource answered ${response.status}`);
      const body = Buffer.from(await response.arrayBuffer());
      const type = response.headers.get("content-type") || "application/octet-stream";
      if (request.resourceType() === "image") bodies.set(target, { type, body });
      await request.respond({ status: 200, contentType: type, body, headers: { "access-control-allow-origin": "*" } });
    } catch {
      await request.abort().catch(() => {});
    }
  });
  await page.goto(url, { waitUntil: "networkidle2", timeout: 45000 }).catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 1200));
  const screens = [];
  const pageHeight = await page.evaluate(() => {
    const candidates = [document.scrollingElement, ...document.querySelectorAll("main,section,div")].filter(Boolean);
    window.__promoCaptureScroller = candidates
      .filter((node) => node.clientHeight >= innerHeight * 0.4 && node.scrollHeight > node.clientHeight + innerHeight * 0.4)
      .sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight))[0] || document.scrollingElement;
    return window.__promoCaptureScroller?.scrollHeight || innerHeight;
  }).catch(() => height);
  for (let i = 0; i < shots; i++) {
    const y = Math.round(i * height * 0.92);
    if (i && y > pageHeight - height * 0.4) break;
    await page.evaluate((top) => {
      const node = window.__promoCaptureScroller || document.scrollingElement;
      if (node === document.scrollingElement) window.scrollTo(0, top);
      else node.scrollTo(0, top);
    }, y).catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 700));
    screens.push((await page.screenshot({ type: "jpeg", quality: 78 })).toString("base64"));
  }
  const seen = await page.evaluate(() => ({
    text: (document.body?.innerText || "").replace(/\s+/g, " ").trim().slice(0, 8000),
    headings: [...document.querySelectorAll("h1,h2,h3")].map((node) => (node.textContent || "").replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 24),
    actions: [...document.querySelectorAll("button,a[href]")].map((node) => (node.textContent || "").replace(/\s+/g, " ").trim()).filter((value) => value.length >= 2 && value.length <= 32).slice(0, 28),
    images: [...document.images].filter((img) => img.naturalWidth >= 360 && img.naturalHeight >= 200 && img.getBoundingClientRect().width >= 160)
      .map((img) => ({ src: img.currentSrc || img.src, width: img.naturalWidth, height: img.naturalHeight, alt: (img.alt || "").slice(0, 120) })),
    links: [...document.querySelectorAll("a[href]")].map((a) => ({ href: a.href, text: (a.textContent || "").replace(/\s+/g, " ").trim().slice(0, 40) })),
  })).catch(() => ({ text: "", headings: [], actions: [], images: [], links: [] }));
  if (!seen.text || seen.text.length < 20) throw new Error("The website did not render enough content to use as a reference");
  const images = seen.images.flatMap((image) => {
    const hit = bodies.get(image.src);
    return hit ? [{ ...image, type: hit.type, body: hit.body.toString("base64") }] : [];
  }).sort((a, b) => b.width * b.height - a.width * a.height).slice(0, 8);
  await fs.writeFile(output, JSON.stringify({ screens, text: seen.text, headings: seen.headings, actions: seen.actions, images, links: seen.links }));
  console.log(`Captured ${seen.text.length} text characters, ${screens.length} views, and ${images.length} images`);
} finally {
  await browser.close().catch(() => {});
}
