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
import zlib from "zlib";

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

/** The packed assets next to the built page, or null when the scripts are plain files (local builds).
 *  Files under previous/ are the build before this one (the bundle script fetches them from the live
 *  app): a tab opened before the deploy still asks for them by name, so they're served under their own
 *  names too, behind this build's. They're left out of the list the next build fetches, so one
 *  generation is kept, not every one. */
export function loadPackedAssets(distDir) {
  const file = path.join(distDir, "assets.pack");
  if (!fs.existsSync(file)) return null;
  const files = readPack(fs.readFileSync(file));
  const entries = new Map();
  const entry = (bytes, previous) => ({ bytes, previous, etag: `"${crypto.createHash("sha1").update(bytes).digest("base64url").slice(0, 16)}"` });
  for (const [name, bytes] of files) if (!name.startsWith("previous/")) entries.set(name, entry(bytes, false));
  for (const [name, bytes] of files) {
    const bare = name.replace(/^previous\//, "");
    if (name !== bare && !entries.has(bare)) entries.set(bare, entry(bytes, true));
  }
  return entries;
}

/** The names of this build's own files, one per line: what the next build fetches to keep. */
export function currentAssetList(entries) {
  return [...entries].filter(([, e]) => !e.previous).map(([name]) => name).sort().join("\n");
}

// Nothing in front of the app compresses, and the main script alone is ~900 KB; Brotli takes it to about
// a quarter. Files are compressed the first time they're asked for, then kept with the entry.
const COMPRESSIBLE = /\.(js|mjs|css|json|svg|txt|map|wasm)$/i;

/** The best encoding this request accepts that's worth sending for the file: "br", "gzip", or "". */
export function pickEncoding(acceptEncoding, name, size) {
  if (size < 1024 || !COMPRESSIBLE.test(name)) return "";
  const accepted = String(acceptEncoding || "").toLowerCase();
  if (/\bbr\b/.test(accepted)) return "br";
  if (/\bgzip\b/.test(accepted)) return "gzip";
  return "";
}

/** The entry's bytes in that encoding (made once, then kept). */
export function encodedBytes(entry, encoding) {
  if (!encoding) return entry.bytes;
  entry.encoded = entry.encoded || {};
  if (!entry.encoded[encoding]) {
    entry.encoded[encoding] = encoding === "br"
      ? zlib.brotliCompressSync(entry.bytes, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: entry.bytes.length } })
      : zlib.gzipSync(entry.bytes, { level: 9 });
  }
  return entry.encoded[encoding];
}

/** Serve packed files under /assets the way express.static would: immutable caching, ETags, HEAD,
 *  and Brotli or gzip when the browser takes it. */
export function packedAssetsMiddleware(entries) {
  return (req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    const name = decodeURIComponent(req.path.replace(/^\/+/, ""));
    if (name === ".list") {
      res.setHeader("Cache-Control", "no-store");
      return res.type("text/plain").send(currentAssetList(entries));
    }
    const entry = entries.get(name);
    if (!entry) return next();
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.setHeader("Vary", "Accept-Encoding");
    res.type(path.extname(name));
    const encoding = pickEncoding(req.headers["accept-encoding"], name, entry.bytes.length);
    // Each encoding is a different body, so it gets its own validator.
    const etag = encoding ? `${entry.etag.slice(0, -1)}-${encoding}"` : entry.etag;
    res.setHeader("ETag", etag);
    if (req.headers["if-none-match"] === etag) return res.status(304).end();
    const body = encodedBytes(entry, encoding);
    if (encoding) res.setHeader("Content-Encoding", encoding);
    res.setHeader("Content-Length", body.length);
    if (req.method === "HEAD") return res.end();
    return res.end(body);
  };
}

/** Compresses large JSON answers (niche searches, galleries, reports) for browsers that take it. Streams
 *  and files are untouched: only `res.json` bodies of 8 KB or more. */
export function compressJson() {
  return (req, res, next) => {
    const json = res.json.bind(res);
    res.json = (body) => {
      const accepted = req.headers["accept-encoding"];
      const text = JSON.stringify(body);
      const encoding = text === undefined || res.headersSent ? "" : pickEncoding(accepted, "body.json", Buffer.byteLength(text) >= 8192 ? 8192 : 0);
      if (!encoding) return json(body);
      const out = encoding === "br"
        ? zlib.brotliCompressSync(text, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } })
        : zlib.gzipSync(text, { level: 6 });
      if (!res.get("Content-Type")) res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Content-Encoding", encoding);
      res.setHeader("Vary", "Accept-Encoding");
      res.setHeader("Content-Length", out.length);
      return res.end(req.method === "HEAD" ? undefined : out);
    };
    next();
  };
}
