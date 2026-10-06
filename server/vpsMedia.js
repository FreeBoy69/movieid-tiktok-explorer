// Big finished media (Movie to Recap videos and their Vibe Edit picture tracks) stays on the media worker
// (the VPS), in /var/lib/autoyt-media, and its nginx serves it at /media/ through the same Cloudflare tunnel
// as Voicebox. The hosted app has 512 MB of memory and /tmp in RAM, so a 400 MB file passing through it
// crashes it; instead the app hands out short-lived links nginx checks with its secure_link module:
//   md5 = base64url(md5(`${expires}${uri} ${secret}`)), secret = sha256("autoyt-media:" + WORKER_SCRIPT_TOKEN)
// The worker derives the same secret from the token it already shares with the app.
import crypto from "node:crypto";

let baseProvider = () => "";
/** Where the media worker's tunnel is (the app learns it from the worker's registration). */
export function setMediaBase(provider) {
  baseProvider = provider;
}

const secret = (env = process.env) => {
  const token = String(env.WORKER_SCRIPT_TOKEN || "").trim();
  return token ? crypto.createHash("sha256").update(`autoyt-media:${token}`).digest("hex") : "";
};

export const mediaAvailable = () => Boolean(secret() && baseProvider());

/** A link to a file under the media root ("<project>/<name>"), valid for `ttl` seconds. */
export function signedMediaUrl(relPath, { ttl = 6 * 3600, download = false, now = Date.now(), base = baseProvider(), env = process.env } = {}) {
  const key = secret(env);
  const rel = String(relPath || "").replace(/^\/+/, "");
  if (!key || !base || !/^[A-Za-z0-9_-]+\/(?!\.)[A-Za-z0-9._-]+$/.test(rel)) return "";
  const uri = `/media/${rel}`;
  // Rounded up to the hour, so a file's link stays the same for an hour and the browser can reuse what it
  // already downloaded (the Vibe Edit preview reopens the same picture file often).
  const expires = Math.ceil((Math.floor(now / 1000) + ttl) / 3600) * 3600;
  const md5 = crypto.createHash("md5").update(`${expires}${uri} ${key}`).digest("base64url");
  return `${String(base).replace(/\/+$/, "")}${uri}?md5=${md5}&expires=${expires}${download ? "&dl=1" : ""}`;
}
