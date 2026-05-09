import type { TikTokVideo } from "../services/tiktok";

/**
 * TikTok list URL rules aligned with tiktok-rewriter ChannelVideosPage + PlaylistDownloaderPage:
 * profile post listing uses a bare https://www.tiktok.com/@handle URL for the same analyze API as collections.
 */

export function handleFromTikTokProfileUrl(url: string): string {
  const m = url.match(/tiktok\.com\/@([^/?#]+)/i);
  return m ? m[1].replace(/^@/, "") : "";
}

/** True when path is only /@handle (query/hash ignored). */
export function isBareTikTokProfileUrl(url: string): boolean {
  const raw = url.trim().split("#")[0].split("?")[0].replace(/\/$/, "");
  return /^https?:\/\/(www\.)?tiktok\.com\/@[^/]+$/i.test(raw);
}

/**
 * Canonical profile URL for POST /api/tiktok/list when listing a creator’s videos (user.videos).
 */
export function canonicalBareTikTokProfileUrl(input: string): string | null {
  const raw = input.trim().split("#")[0];
  const base = raw.split("?")[0].replace(/\/$/, "");
  if (/^https?:\/\/(www\.)?tiktok\.com\/@[^/]+$/i.test(base)) {
    const h = handleFromTikTokProfileUrl(raw);
    if (!h || h === "user") return null;
    return `https://www.tiktok.com/@${h}`;
  }
  const m = raw.match(/tiktok\.com\/@([^/]+)\/video\/\d+/i);
  if (m) {
    let h = m[1].trim().replace(/^@/, "");
    try {
      h = decodeURIComponent(h);
    } catch {
      /* ignore */
    }
    if (h && h !== "user") return `https://www.tiktok.com/@${h}`;
  }
  return null;
}

export function handleFromPlayUrl(playUrl: string): string | null {
  const m = playUrl.match(/tiktok\.com\/@([^/]+)\/video\//i);
  if (!m) return null;
  const h = m[1].replace(/^@/, "").trim();
  return h && h !== "user" ? h : null;
}

/** Resolve row → bare profile URL for the same list API as pasting @handle in the form. */
export function channelListingUrl(video: TikTokVideo): string | null {
  let handle = (video.uploaderId || video.authorHandle || "").trim().replace(/^@/, "");
  if (!handle || handle === "user") {
    const fromPlay = video.playUrl ? handleFromPlayUrl(video.playUrl) : null;
    if (fromPlay) handle = fromPlay;
  }
  if (!handle || handle === "user") return null;
  return `https://www.tiktok.com/@${handle}`;
}
