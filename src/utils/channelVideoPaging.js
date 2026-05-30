export function shouldPrefetchChannelVideoPage({
  workspaceTab = "",
  longVideoCount = 0,
  nextPageToken = "",
  loadingMore = false,
  error = "",
} = {}) {
  return workspaceTab === "videos"
    && Number(longVideoCount || 0) === 0
    && Boolean(String(nextPageToken || "").trim())
    && loadingMore !== true
    && !String(error || "").trim();
}
