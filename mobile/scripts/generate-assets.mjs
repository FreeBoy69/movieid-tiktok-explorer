#!/usr/bin/env node
// Renders the iOS/Android app icons and splash screens from the AutoYT mark
// (logo/Favicon.svg: a black play glyph on brand yellow). macOS only: uses
// headless Google Chrome to rasterise and `sips` to resize.
//   node mobile/scripts/generate-assets.mjs
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const chrome = process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "autoyt-assets-"));
const YELLOW = "#f9dc0b";
const DARK = "#0f1113";
// The rounded play glyph from logo/Favicon.svg (0.87:1), in an 87.4x100 box.
const PLAY = `<path d="M7 2.2C3.8.4 0 2.4 0 6v88c0 3.6 3.8 5.6 7 3.8L84 54c3.2-1.8 3.2-6.2 0-8Z"/>`;

function glyph(size, color) {
  // Optical centre: a triangle reads centred when nudged ~5% toward its point.
  return `<svg viewBox="0 0 87.4 100" width="${size * 0.874}" height="${size}" style="transform:translateX(${size * 0.05}px)"><g fill="${color}">${PLAY}</g></svg>`;
}

function render(name, width, height, body, background = "transparent") {
  const html = path.join(tmp, `${name}.html`);
  const png = path.join(tmp, `${name}.png`);
  fs.writeFileSync(html, `<!doctype html><html><body style="margin:0;width:${width}px;height:${height}px;background:${background};display:grid;place-items:center;overflow:hidden">${body}</body></html>`);
  execFileSync(chrome, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1", "--default-background-color=00000000", `--window-size=${width},${height}`, `--screenshot=${png}`, `file://${html}`], { stdio: "ignore" });
  return png;
}

function resize(source, target, width, height = width) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  execFileSync("sips", ["-z", String(height), String(width), source, "--out", target], { stdio: "ignore" });
}

// iOS: one 1024px full-bleed icon (iOS applies the corner mask; no alpha allowed).
const iosIcon = render("ios-icon", 1024, 1024, glyph(400, "#111111"), YELLOW);
resize(iosIcon, path.join(root, "ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png"), 1024);

// Splash: the yellow tile on the app's dark background, matching mobile/shell/offline.html.
const tile = (size) => `<div style="width:${size}px;height:${size}px;border-radius:${size * 0.25}px;background:${YELLOW};display:grid;place-items:center;box-shadow:0 ${size * 0.12}px ${size * 0.3}px rgb(0 0 0 / 0.45)">${glyph(size * 0.4, "#111111")}</div>`;
const splash = render("splash", 2732, 2732, tile(300), DARK);
for (const suffix of ["", "-1", "-2"]) {
  fs.copyFileSync(splash, path.join(root, `ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732${suffix}.png`));
}

// Android adaptive icon: yellow background colour (values/ic_launcher_background.xml)
// plus this foreground, with the glyph inside the 66dp safe zone of the 108dp canvas.
const res = path.join(root, "android/app/src/main/res");
const foreground = render("fg", 432, 432, glyph(118, "#111111"));
const legacy = render("legacy", 512, 512, `<div style="width:512px;height:512px;border-radius:112px;background:${YELLOW};display:grid;place-items:center">${glyph(200, "#111111")}</div>`);
const round = render("round", 512, 512, `<div style="width:512px;height:512px;border-radius:50%;background:${YELLOW};display:grid;place-items:center">${glyph(190, "#111111")}</div>`);
const densities = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
for (const [density, scale] of Object.entries(densities)) {
  const dir = path.join(res, `mipmap-${density}`);
  resize(foreground, path.join(dir, "ic_launcher_foreground.png"), Math.round(108 * scale));
  resize(legacy, path.join(dir, "ic_launcher.png"), Math.round(48 * scale));
  resize(round, path.join(dir, "ic_launcher_round.png"), Math.round(48 * scale));
}

// Android 12+ splash icon: 240dp canvas, icon inside the 160dp circle.
const splashIcon = render("splash-icon", 960, 960, tile(400));
resize(splashIcon, path.join(res, "drawable-xxxhdpi/splash_icon.png"), 960);

// Pre-Android 12 splash bitmaps (portrait and landscape per density).
const sizes = { mdpi: [320, 480], hdpi: [480, 800], xhdpi: [720, 1280], xxhdpi: [960, 1600], xxxhdpi: [1280, 1920] };
for (const [density, [w, h]] of Object.entries(sizes)) {
  const tileSize = Math.round(w * 0.24);
  const port = render(`port-${density}`, w, h, tile(tileSize), DARK);
  const land = render(`land-${density}`, h, w, tile(tileSize), DARK);
  fs.copyFileSync(port, path.join(res, `drawable-port-${density}/splash.png`));
  fs.copyFileSync(land, path.join(res, `drawable-land-${density}/splash.png`));
}
fs.copyFileSync(render("splash-default", 480, 800, tile(115), DARK), path.join(res, "drawable/splash.png"));

fs.rmSync(tmp, { recursive: true, force: true });
console.log("App icons and splash screens written.");
