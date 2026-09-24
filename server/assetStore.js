// Durable storage for generated media.
//
// The LingCode hosted app has only a tmpfs /tmp, wiped on every deploy and
// restart, so creator images, voiceovers, music, and renders would vanish.
// Files stay in /tmp as a working cache and are mirrored to the backend's
// object storage, then restored on demand.
//
// This backend only accepts inline uploads (no presigned PUT), capped at 10 MB
// each, so a file is stored as encrypted parts of at most 8 MB plus a small
// encrypted manifest. The public bucket is the only one reachable without an
// end-user login, so everything is encrypted with AES-256-GCM under a key
// derived from AUTH_SECRET: what the bucket holds is unreadable on its own.
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

const PART_BYTES = 8 * 1024 * 1024;
const BUCKET = "public";
const PREFIX = "autoyt-store";

function config(env = process.env) {
  const gateway = String(env.LINGCODE_GATEWAY_URL || (env.LINGCODE_BACKEND_ID ? `https://lingcode.dev/api/cloud/be/${env.LINGCODE_BACKEND_ID}` : "")).replace(/\/+$/, "");
  const anon = String(env.LINGCODE_ANON_KEY || "").trim();
  const secret = String(env.AUTH_SECRET || env.SESSION_SECRET || "").trim();
  return { gateway, anon, secret };
}
export function assetStoreConfigured(env = process.env) {
  const { gateway, anon, secret } = config(env);
  return Boolean(gateway && anon && secret);
}
const keyFor = (secret) => Buffer.from(crypto.hkdfSync("sha256", secret, "autoyt-asset-store", "aes-256-gcm", 32));

export function sealBytes(plain, secret) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", keyFor(secret), iv);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
}
export function openBytes(sealed, secret) {
  const decipher = crypto.createDecipheriv("aes-256-gcm", keyFor(secret), sealed.subarray(0, 12));
  decipher.setAuthTag(sealed.subarray(12, 28));
  return Buffer.concat([decipher.update(sealed.subarray(28)), decipher.final()]);
}
// Object names are hashed, so the bucket doesn't reveal project or file names.
const objectName = (key, suffix, secret) =>
  `${PREFIX}/${crypto.createHmac("sha256", keyFor(secret)).update(key).digest("hex")}.${suffix}`;

async function request(route, { body, raw } = {}) {
  const { gateway, anon } = config();
  const response = await fetch(`${gateway}${route}`, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Bearer ${anon}`, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(120000),
  });
  if (raw) return response;
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    const error = new Error(`Asset store ${route.split("?")[0]} failed (${response.status}): ${data.message || data.error || "request failed"}`);
    error.status = response.status;
    throw error;
  }
  return data.data ?? data;
}
async function put(name, bytes) {
  await request("/storage/upload", {
    body: { bucket: BUCKET, path: name, content_type: "application/octet-stream", data_b64: bytes.toString("base64") },
  });
}
async function get(name) {
  const response = await request(`/storage/object?bucket=${BUCKET}&path=${encodeURIComponent(name)}`, { raw: true });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Asset store read failed (${response.status})`);
  return Buffer.from(await response.arrayBuffer());
}

// Saves one local file under a logical key such as "creator/<project>/<file>".
export async function saveFile(key, file) {
  const { secret } = config();
  // One part in memory at a time: the hosted app has 512 MB, and rendered
  // videos and bundles can be larger than what is left of it.
  const handle = await fsp.open(file, "r");
  const hash = crypto.createHash("sha256");
  const nonce = crypto.randomBytes(6).toString("hex");
  let size = 0,
    parts = 0;
  try {
    const buffer = Buffer.alloc(PART_BYTES);
    for (;;) {
      let filled = 0;
      while (filled < PART_BYTES) {
        const { bytesRead } = await handle.read(buffer, filled, PART_BYTES - filled, size + filled);
        if (!bytesRead) break;
        filled += bytesRead;
      }
      if (!filled && parts) break;
      const part = buffer.subarray(0, filled);
      hash.update(part);
      await put(objectName(key, `${nonce}.${parts}`, secret), sealBytes(part, secret));
      size += filled;
      parts++;
      if (filled < PART_BYTES) break;
    }
  } finally {
    await handle.close();
  }
  const previous = await readManifest(key).catch(() => null);
  const manifest = {
    key,
    bytes: size,
    parts,
    nonce,
    sha256: hash.digest("hex"),
    savedAt: Date.now(),
  };
  await put(objectName(key, "m", secret), sealBytes(Buffer.from(JSON.stringify(manifest)), secret));
  // Parts from an earlier version of this file are no longer referenced.
  if (previous && previous.nonce !== nonce)
    for (let i = 0; i < previous.parts; i++)
      await request("/storage/remove", { body: { bucket: BUCKET, path: objectName(key, `${previous.nonce}.${i}`, secret) } }).catch(() => {});
  return manifest;
}
async function readManifest(key) {
  const { secret } = config();
  const sealed = await get(objectName(key, "m", secret));
  return sealed ? JSON.parse(openBytes(sealed, secret).toString("utf8")) : null;
}
// Restores a file if the store has it. Returns false when it doesn't.
export async function restoreFile(key, file) {
  const { secret } = config();
  const manifest = await readManifest(key);
  if (!manifest) return false;
  // Parts are written as they arrive, so a large file never sits in memory whole.
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const partial = `${file}.restore-${crypto.randomUUID().slice(0, 8)}`;
  const hash = crypto.createHash("sha256");
  const handle = await fsp.open(partial, "w");
  try {
    for (let i = 0; i < manifest.parts; i++) {
      const sealed = await get(objectName(key, `${manifest.nonce}.${i}`, secret));
      if (!sealed) throw new Error(`Stored file ${path.basename(file)} is missing part ${i + 1} of ${manifest.parts}`);
      const part = openBytes(sealed, secret);
      hash.update(part);
      await handle.write(part);
    }
  } catch (error) {
    await handle.close();
    await fsp.rm(partial, { force: true });
    throw error;
  }
  await handle.close();
  if (hash.digest("hex") !== manifest.sha256) {
    await fsp.rm(partial, { force: true });
    throw new Error(`Stored file ${path.basename(file)} failed its integrity check`);
  }
  await fsp.rename(partial, file);
  return true;
}
export async function removeFile(key) {
  const { secret } = config();
  const manifest = await readManifest(key).catch(() => null);
  if (!manifest) return false;
  for (let i = 0; i < manifest.parts; i++)
    await request("/storage/remove", { body: { bucket: BUCKET, path: objectName(key, `${manifest.nonce}.${i}`, secret) } }).catch(() => {});
  await request("/storage/remove", { body: { bucket: BUCKET, path: objectName(key, "m", secret) } }).catch(() => {});
  return true;
}

// ---------- Directory mirroring ----------
// Remembers what was saved in this process, so a sweep only uploads new or
// changed files. After a restart the cache is empty, and so is /tmp.
const saved = new Map();
const queues = new Map();
const serial = (name, task) => {
  const next = (queues.get(name) || Promise.resolve()).then(task, task);
  queues.set(name, next.catch(() => {}));
  return next;
};
export function markSaved(file) {
  try {
    const stat = fs.statSync(file);
    saved.set(file, `${stat.size}:${stat.mtimeMs}`);
  } catch {}
}
// Saves every top-level file in dir that changed since the last save.
export function saveDirectory(prefix, dir, { skip = () => false } = {}) {
  if (!assetStoreConfigured()) return Promise.resolve(0);
  return serial(dir, async () => {
    let count = 0;
    const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isFile() || /\.(part|restore)-/.test(entry.name) || skip(entry.name)) continue;
      const file = path.join(dir, entry.name);
      const stat = await fsp.stat(file).catch(() => null);
      if (!stat) continue;
      const stamp = `${stat.size}:${stat.mtimeMs}`;
      if (saved.get(file) === stamp) continue;
      try {
        await saveFile(`${prefix}/${entry.name}`, file);
        saved.set(file, stamp);
        count++;
      } catch (error) {
        console.warn(`[asset-store] could not save ${entry.name}: ${error.message}`);
      }
    }
    return count;
  });
}
// Restores a file that is missing locally. Safe to call for files never saved.
const restoring = new Map();
export async function ensureFile(key, file) {
  if (fs.existsSync(file) || !assetStoreConfigured()) return fs.existsSync(file);
  if (!restoring.has(file))
    restoring.set(
      file,
      restoreFile(key, file)
        .then((ok) => {
          if (ok) markSaved(file);
          return ok;
        })
        .catch((error) => {
          console.warn(`[asset-store] could not restore ${path.basename(file)}: ${error.message}`);
          return false;
        })
        .finally(() => restoring.delete(file)),
    );
  return restoring.get(file);
}
