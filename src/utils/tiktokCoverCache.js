export const TIKTOK_COVER_ROUTE_PREFIX = "/api/tiktok/covers/";

export function isLocalTikTokCoverUrl(value) {
  return typeof value === "string" && value.startsWith(TIKTOK_COVER_ROUTE_PREFIX);
}

export function isExpiredTikTokSignedCoverUrl(value, nowMs = Date.now()) {
  if (!value || typeof value !== "string" || isLocalTikTokCoverUrl(value)) return false;
  try {
    const parsed = new URL(value);
    if (!/tiktokcdn/i.test(parsed.hostname)) return false;
    const expires = Number(parsed.searchParams.get("x-expires") || 0);
    return expires > 0 && expires * 1000 < nowMs;
  } catch {
    return false;
  }
}

export function freshTikTokCover(value, nowMs = Date.now()) {
  const cover = String(value || "");
  if (!cover) return "";
  if (isLocalTikTokCoverUrl(cover)) return cover;
  return isExpiredTikTokSignedCoverUrl(cover, nowMs) ? "" : cover;
}

export function tiktokCoverSourceUrl(video) {
  const current = String(video?.dynamicCover || "").trim();
  if (current && !isLocalTikTokCoverUrl(current)) return current;
  const source = String(video?.thumbnailSourceUrl || video?.thumbnailUrl || "").trim();
  return isLocalTikTokCoverUrl(source) ? "" : source;
}

export function applyCachedTikTokCover(video, cachedCoverUrl, nowMs = Date.now()) {
  if (!video || typeof video !== "object") return video;
  const source = tiktokCoverSourceUrl(video);
  const local = isLocalTikTokCoverUrl(cachedCoverUrl) ? cachedCoverUrl : "";
  return {
    ...video,
    ...(source ? { thumbnailSourceUrl: source } : {}),
    dynamicCover: local || freshTikTokCover(video.dynamicCover, nowMs),
  };
}
