// The front end's own scripts and styles, packed into one file for the hosted app.
//
// The hosted-app intake takes at most 500 files, and the built front end alone
// is ~430 (most of them template images and fonts). Vite's hashed scripts and
// styles grow with every page that loads on demand, so the bundle script packs
// them into dist/assets.pack (a plain ustar archive) and the server serves them
// from memory: a few MB, read once at boot. Images and fonts stay ordinary
// files because server code reads some of them from disk.
import fs from "fs";
import path from "path";
import crypto from "crypto";

const BLOCK = 512;

function field(buf, start, length) {
  const raw = buf.subarray(start, start + length);
  const end = raw.indexOf(0);
  return raw.subarray(0, end === -1 ? raw.length : end).toString("utf8");
}

/** Read a ustar archive into a map of relative path -> bytes (regular files only). */
export function readPack(buf) {
  const files = new Map();
  let off = 0;
  while (off + BLOCK <= buf.length) {
    const name = field(buf, off, 100);
    if (!name) break; // two zero blocks end the archive
    const size = parseInt(field(buf, off + 124, 12).trim() || "0", 8);
    const type = field(buf, off + 156, 1) || "0";
    const prefix = field(buf, off + 345, 155);
    const data = buf.subarray(off + BLOCK, off + BLOCK + size);
    if (type === "0") files.set((prefix ? `${prefix}/` : "") + name.replace(/^\.\//, ""), Buffer.from(data));
    off += BLOCK + Math.ceil(size / BLOCK) * BLOCK;
  }
  return files;
}

/** The packed assets next to the built page, or null when the scripts are plain files (local builds). */
export function loadPackedAssets(distDir) {
  const file = path.join(distDir, "assets.pack");
  if (!fs.existsSync(file)) return null;
  const files = readPack(fs.readFileSync(file));
  const entries = new Map();
  for (const [name, bytes] of files) {
    entries.set(name, { bytes, etag: `"${crypto.createHash("sha1").update(bytes).digest("base64url").slice(0, 16)}"` });
  }
  return entries;
}

/** Serve packed files under /assets the way express.static would: immutable caching, ETags, HEAD. */
export function packedAssetsMiddleware(entries) {
  return (req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    const name = decodeURIComponent(req.path.replace(/^\/+/, ""));
    const entry = entries.get(name);
    if (!entry) return next();
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.setHeader("ETag", entry.etag);
    res.type(path.extname(name));
    if (req.headers["if-none-match"] === entry.etag) return res.status(304).end();
    res.setHeader("Content-Length", entry.bytes.length);
    if (req.method === "HEAD") return res.end();
    return res.end(entry.bytes);
  };
}
