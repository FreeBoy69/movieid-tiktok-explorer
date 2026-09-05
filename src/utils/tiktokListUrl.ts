import type { TikTokVideo } from "../services/tiktok";
import { canonicalTikTokProfileUrl, parseTikTokUrl } from "./tiktokUrl.js";

/**
 * TikTok list URL rules aligned with tiktok-rewriter ChannelVideosPage + PlaylistDownloaderPage:
 * profile post listing uses a bare https://www.tiktok.com/@handle URL for the same analyze API as collections.
 */

export function handleFromTikTokProfileUrl(url: string): string {
  return parseTikTokUrl(url).handle;
}

/** True when path is only /@handle (query/hash ignored). */
export function isBareTikTokProfileUrl(url: string): boolean {
  return parseTikTokUrl(url).kind === "profile";
}

/**
 * Canonical profile URL for POST /api/tiktok/list when listing a creator’s videos (user.videos).
 */
export function canonicalBareTikTokProfileUrl(input: string): string | null {
  const parsed = parseTikTokUrl(input);
  if (parsed.kind === "profile") return canonicalTikTokProfileUrl(input) || null;
  if (parsed.handle && parsed.handle.toLowerCase() !== "user") return `https://www.tiktok.com/@${encodeURIComponent(parsed.handle)}`;
  return null;
}

export function handleFromPlayUrl(playUrl: string): string | null {
  const h = parseTikTokUrl(playUrl).handle;
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
