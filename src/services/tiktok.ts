export interface TikTokVideo {
  id: string;
  title: string;
  author: string;
  authorHandle: string;
  /** Canonical profile URL when the API provides it (tiktok-rewriter: uploader_url). */
  uploaderUrl?: string;
  /** @handle / uniqueId for the creator (tiktok-rewriter: uploader_id). */
  uploaderId?: string;
  /** Unix timestamp in milliseconds when TikTok/yt-dlp provides publish time. */
  createdAt?: number;
  /** Video duration in seconds when TikTok/yt-dlp provides it. */
  durationSeconds?: number;
  /** Source video width when TikTok/yt-dlp provides dimensions. */
  width?: number;
  /** Source video height when TikTok/yt-dlp provides dimensions. */
  height?: number;
  /** Short-lived clean playback URLs captured during listing; tried before public download fallbacks. */
  cleanPlaybackUrls?: string[];
  playUrl: string;
  dynamicCover: string;
  /** Stable source cover URL used by the backend to refresh the local thumbnail cache. */
  thumbnailSourceUrl?: string;
  /** Alternate thumbnail URL shape used by some backend workflows. */
  thumbnailUrl?: string;
  stats: {
    diggCount: number;
    shareCount: number;
    commentCount: number;
    playCount: number;
  };
}

export interface TikTokPlaylist {
  title: string;
  author: string;
  videos: TikTokVideo[];
  source?: string;
  stale?: boolean;
  warning?: string;
}

/** Collection, single video, and profile (@handle) listings all use this same POST body and server script. */
export async function fetchTikTokPlaylist(
  url: string,
  count = 50,
  seedVideoUrl?: string,
  options?: { forceNetwork?: boolean },
): Promise<TikTokPlaylist> {
  const response = await fetch("/api/tiktok/list", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, count, seedVideoUrl: seedVideoUrl || "", forceNetwork: !!options?.forceNetwork }),
  });
  const data = (await response.json().catch(() => ({}))) as { error?: string } & Partial<TikTokPlaylist>;
  if (!response.ok) {
    throw new Error(data.error || "Failed to list TikTok videos");
  }
  if (data.error) {
    throw new Error(data.error);
  }
  if (!data.videos || !Array.isArray(data.videos)) {
    throw new Error("Invalid response from TikTok listing");
  }
  return data as TikTokPlaylist;
}
