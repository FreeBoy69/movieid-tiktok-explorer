// Turns whatever a person pastes for a TikTok source into the channel (or collection)
// to follow: share text from the phone app, links without https://, vm./vt. short links,
// /t/ links, m.tiktok.com/h5/share/usr/<id> profile shares, and single-video links.
// Short video links redirect to https://www.tiktok.com/@/video/<id> with an empty handle,
// so the channel comes from TikTok's oEmbed author when the path doesn't carry it.
import { parseTikTokUrl } from "../src/utils/tiktokUrl.js";

const MOBILE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

function isTikTokHost(hostname = "") {
  const host = String(hostname).toLowerCase();
  return host === "tiktok.com" || host.endsWith(".tiktok.com");
}

const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });

/** Follows TikTok's own redirects (never leaving tiktok.com) and returns the final URL. */
export async function followTikTokRedirects(url, fetcher = fetch, hops = 5) {
  let current = new URL(url);
  for (let hop = 0; hop < hops; hop++) {
    const response = await fetcher(current.toString(), { method: "GET", redirect: "manual", headers: { "User-Agent": MOBILE_UA }, signal: AbortSignal.timeout(10000) });
    const location = response.headers.get("location");
    if (![301, 302, 303, 307, 308].includes(response.status) || !location) return current.toString();
    const next = new URL(location, current);
    if (!/^https?:$/.test(next.protocol) || !isTikTokHost(next.hostname)) return current.toString();
    current = next;
  }
  return current.toString();
}

/** The @handle of a video's author, from TikTok's public oEmbed endpoint (two URL forms, one retry on a rate limit). */
export async function tiktokVideoAuthor(videoId, fetcher = fetch, { retryDelayMs = 1200 } = {}) {
  for (const form of [`https://www.tiktok.com/@/video/${videoId}`, `https://www.tiktok.com/video/${videoId}`]) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await fetcher(`https://www.tiktok.com/oembed?url=${encodeURIComponent(form)}`, { headers: { "User-Agent": MOBILE_UA }, signal: AbortSignal.timeout(10000) });
      if (response.status === 429 && attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
        continue;
      }
      if (!response.ok) break;
      const data = await response.json().catch(() => ({}));
      const fromUrl = String(data.author_url || "").match(/tiktok\.com\/@([^/?#]+)/i)?.[1] || "";
      const handle = String(data.author_unique_id || fromUrl || "").replace(/^@/, "").trim();
      if (handle) return handle;
      break;
    }
  }
  return "";
}

const profileUrl = (handle) => `https://www.tiktok.com/@${encodeURIComponent(handle)}`;

/**
 * Resolves pasted text to a TikTok source: { url, handle, kind, from }.
 * kind is "profile" or "collection". A video link becomes its author's profile.
 * @param {string} input
 * @param {{ fetcher?: typeof fetch, authorFallback?: (videoId: string) => Promise<string> }} [options]
 */
export async function resolveTikTokSource(input, { fetcher = fetch, authorFallback } = {}) {
  let parsed = parseTikTokUrl(input);
  if (!parsed.valid) throw fail("That isn't a TikTok link. Paste a channel, video, or collection link from TikTok.");
  const from = parsed.raw;
  const wasShort = parsed.isShortLink;
  const needsRedirect = parsed.isShortLink || /\/h5\/share\/usr\//i.test(parsed.raw) || (parsed.kind === "unknown" && !parsed.handle);
  if (needsRedirect) {
    const finalUrl = await followTikTokRedirects(parsed.raw, fetcher).catch(() => parsed.raw);
    const next = parseTikTokUrl(finalUrl);
    if (next.valid) parsed = next;
  }
  if (parsed.kind === "collection") return { url: parsed.url, handle: parsed.handle, kind: "collection", from };
  if (parsed.handle && parsed.handle.toLowerCase() !== "user" && ["profile", "video", "photo", "live"].includes(parsed.kind)) {
    return { url: profileUrl(parsed.handle), handle: parsed.handle, kind: "profile", from };
  }
  if (parsed.id) {
    // oEmbed is rate limited; the video downloader's metadata is the second way to find the author.
    const handle = (await tiktokVideoAuthor(parsed.id, fetcher).catch(() => ""))
      || String((await authorFallback?.(parsed.id).catch(() => "")) || "").replace(/^@/, "").trim();
    if (handle) return { url: profileUrl(handle), handle, kind: "profile", from };
    throw fail("Couldn't find whose channel that video is on. Open the channel in TikTok and share its profile link instead.", 422);
  }
  if (wasShort) throw fail("That TikTok short link didn't open. Check that it isn't expired, or paste the channel link.", 422);
  throw fail("Paste a TikTok channel, video, or collection link, like https://www.tiktok.com/@name.");
}
