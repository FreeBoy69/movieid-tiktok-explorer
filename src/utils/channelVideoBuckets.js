export function normalizeChannelVideoKind(value = "") {
  const kind = String(value || "").trim().toLowerCase();
  return kind === "shorts" || kind === "videos" ? kind : "all";
}

export function channelVideoKindMatches(video = {}, kind = "all") {
  const normalizedKind = normalizeChannelVideoKind(kind);
  const durationSeconds = Math.max(0, Number(video?.durationSeconds || 0));
  if (normalizedKind === "shorts")
    return durationSeconds <= 180;
  if (normalizedKind === "videos")
    return durationSeconds > 180;
  return true;
}

export function shouldContinueChannelVideoBucket({
  kind = "all",
  resultCount = 0,
  targetCount = 0,
  nextPageToken = "",
  pagesScanned = 0,
  maxPages = 1,
} = {}) {
  return normalizeChannelVideoKind(kind) !== "all"
    && Number(resultCount || 0) < Number(targetCount || 0)
    && Boolean(String(nextPageToken || "").trim())
    && Number(pagesScanned || 0) < Number(maxPages || 0);
}
