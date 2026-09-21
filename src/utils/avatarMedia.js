import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const TTL = 2 * 60 * 60 * 1000;
const VALID_TOKEN = /^[a-f0-9]{64}$/;

/** Unguessable, short-lived capability URLs for provider fetches, not public exports. */
export function publishAvatarMedia(filePath, rootDir, baseUrl, now = Date.now()) {
  const base = new URL(baseUrl);
  if (base.protocol !== "https:") throw new Error("Set APP_URL to the public HTTPS app URL for avatar generation.");
  fs.mkdirSync(rootDir, { recursive: true, mode: 0o700 });
  for (const entry of fs.readdirSync(rootDir)) {
    if (!/^[a-f0-9]{64}\.(mp3|json)$/.test(entry)) continue;
    const target = path.join(rootDir, entry);
    if (now - fs.statSync(target).mtimeMs > TTL) fs.rmSync(target, { force: true });
  }
  const token = crypto.randomBytes(32).toString("hex");
  const output = path.join(rootDir, `${token}.mp3`);
  fs.copyFileSync(filePath, output);
  fs.chmodSync(output, 0o600);
  fs.writeFileSync(path.join(rootDir, `${token}.json`), JSON.stringify({ expiresAt: now + TTL }), { mode: 0o600 });
  return new URL(`/api/automation/voice/avatar-input/${token}`, base).href;
}

export function resolveAvatarMedia(token, rootDir, now = Date.now()) {
  if (!VALID_TOKEN.test(String(token))) return null;
  try {
    const metadata = JSON.parse(fs.readFileSync(path.join(rootDir, `${token}.json`), "utf8"));
    const filePath = path.join(rootDir, `${token}.mp3`);
    return Number.isFinite(metadata.expiresAt) && metadata.expiresAt > now && fs.existsSync(filePath) ? filePath : null;
  } catch { return null; }
}
