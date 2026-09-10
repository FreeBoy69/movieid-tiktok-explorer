import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

// Run against Vite with PLAYWRIGHT_MODULE pointing to an installed Playwright module when needed.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const artifacts = fs.mkdtempSync(path.join(os.tmpdir(), "autoyt-timeline-"));
const video = path.join(artifacts, "source.mp4");
const thumb = path.join(artifacts, "source.png");
execFileSync(process.env.FFMPEG_PATH || "ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=4:duration=12", "-c:v", "libx264", "-pix_fmt", "yuv420p", video]);
execFileSync(process.env.FFMPEG_PATH || "ffmpeg", ["-v", "error", "-y", "-i", video, "-frames:v", "1", thumb]);
const browser = await chromium.launch({ channel: process.env.CHROME_CHANNEL || "chrome", headless: true });
try {
  for (const { width, height, theme } of [{ width: 1440, height: 1000, theme: "light" }, { width: 1024, height: 900, theme: "light" }, { width: 390, height: 844, theme: "light" }, { width: 1440, height: 1000, theme: "dark" }]) {
    const page = await browser.newPage({ viewport: { width, height } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/fixture.mp4", r => {
      const bytes = fs.readFileSync(video);
      const range = /bytes=(\d+)-(\d*)/.exec(r.request().headers().range || "");
      const start = range ? Number(range[1]) : 0;
      const end = range?.[2] ? Number(range[2]) : bytes.length - 1;
      return r.fulfill({ status: range ? 206 : 200, contentType: "video/mp4", headers: { "Accept-Ranges": "bytes", ...(range ? { "Content-Range": `bytes ${start}-${end}/${bytes.length}` } : {}) }, body: bytes.subarray(start, end + 1) });
    });
    await page.route("**/fixture.png", r => r.fulfill({ contentType: "image/png", body: fs.readFileSync(thumb) }));
    await page.route("**/api/**", async route => {
      const url = new URL(route.request().url());
      let data = { jobs: [], processes: [], agents: [], uploads: [], accounts: [], threads: [] };
      if (url.pathname === "/api/auth/session") data = { user: { id: "test", name: "Editor" }, accounts: [], activeAccount: null };
      else if (url.pathname === "/api/automation/agents") data = { agents: [{ id: "agent-test", name: "Recap channel" }] };
      else if (url.pathname === "/api/automation/agents/agent-test") data = { uploads: [{ id: "upload-test", title: "The journey home", thumbnailUrl: "/fixture.png", sourceUrl: "https://example.com/test" }] };
      else if (url.pathname === "/api/automation/voice/status") data = { online: true, profiles: [{ id: "voice-1", name: "Recap narrator" }], stemEngine: "Demucs AI" };
      else if (url.pathname.endsWith("narration-styles")) data = { styles: [] };
      else if (url.pathname.endsWith("/latest")) data = { job: { id: "render-test", status: "done", result: { mode: "voiceover", script: "They begin a hopeful journey home.", source: { url: "/fixture.mp4" }, file: { url: "/fixture.mp4" }, narration: { url: "/fixture.mp4" }, profile: { name: "Recap narrator" }, timing: { passed: true, sourceDurationSeconds: 12, sceneCount: 3 } } } };
      else if (url.pathname.endsWith("/music/search")) data = { tracks: [{ id: "music-test", title: "A hopeful beginning", creator: "Test artist", provider: "Jamendo", license: "CC BY", attribution: "A hopeful beginning by Test artist, CC BY 4.0.", url: "/fixture.mp4", landingUrl: "https://example.com/music" }] };
      await route.fulfill({ json: data });
    });
    await page.goto(`${process.env.UI_BASE_URL || "http://127.0.0.1:4176"}/voiceover?agent=agent-test&upload=upload-test`);
    const timeline = page.getByRole("region", { name: "Timeline", exact: true });
    await page.waitForFunction(() => document.querySelectorAll(".st-scene").length === 3);
    await page.waitForFunction(() => document.querySelector(".vs-canvas-stage video")?.readyState >= 2);
    await page.locator(".voice-workspace").evaluate((el, value) => el.setAttribute("data-theme", value), theme);
    const ruler = page.getByRole("slider", { name: "Timeline playhead" });
    await ruler.focus();
    await ruler.press("Home");
    await page.waitForTimeout(100);
    await ruler.press("Shift+ArrowRight");
    await page.waitForFunction(() => Number(document.querySelector('[aria-label="Timeline playhead"]').getAttribute("aria-valuenow")) > 4.5);
    await timeline.getByRole("button", { name: "Split scene", exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll(".st-scene").length === 4);
    await timeline.getByRole("button", { name: "Undo scene edit" }).click();
    assert.equal(await page.locator(".st-scene").count(), 3);
    await timeline.getByRole("button", { name: "Redo scene edit" }).click();
    assert.equal(await page.locator(".st-scene").count(), 4);
    await page.getByLabel("Timeline zoom", { exact: true }).fill("4");
    await page.locator(".st-lanes").evaluate(el => { el.scrollLeft = el.scrollWidth - el.clientWidth; });
    const box = await page.locator(".st-lanes").boundingBox();
    await page.mouse.click(box.x + box.width * .6, box.y + 10);
    assert.ok(Number(await ruler.getAttribute("aria-valuenow")) > 9, "Seeking while scrolled uses the full timeline offset");
    await timeline.getByRole("button", { name: "Fit timeline to width" }).click();
    assert.equal(await page.locator(".st-lanes").evaluate(el => el.scrollLeft), 0);
    await timeline.getByRole("button", { name: "Split screen", exact: true }).click();
    assert.equal(await page.getByRole("tab", { name: "Split screen", exact: true }).getAttribute("aria-selected"), "true");
    await page.getByRole("button", { name: /Full avatar/ }).waitFor();
    await timeline.getByRole("button", { name: "Audio library", exact: true }).click();
    await page.getByLabel("Audio library provider").selectOption("pixabay");
    assert.match(await page.getByRole("link", { name: "Search Pixabay" }).getAttribute("href"), /^https:\/\/pixabay.com\/music\/search\//);
    await page.getByLabel("Audio library provider").selectOption("openverse");
    await page.getByRole("button", { name: "Use track", exact: true }).click();
    assert.equal(await timeline.getByText("A hopeful beginning", { exact: true }).count(), 1);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []);
    await page.screenshot({ path: path.join(artifacts, `${width}-${theme}.png`), fullPage: true });
    await timeline.screenshot({ path: path.join(artifacts, `timeline-${width}-${theme}.png`) });
    await page.close();
  }
} finally { await browser.close(); }
console.log(`Scene edits, scroll seeking, provider navigation and responsive checks passed. Screenshots: ${artifacts}`);
