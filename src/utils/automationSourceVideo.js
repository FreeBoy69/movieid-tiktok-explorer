export function isYouTubeUrl(value = "") {
  return /(?:youtube\.com|youtu\.be)/i.test(String(value || ""));
}

export function isTikTokSourceUrl(value = "") {
  return /(?:^|\.)tiktok\.com|vm\.tiktok\.com|vt\.tiktok\.com/i.test(String(value || ""));
}

const YOUTUBE_VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const TIKTOK_VIDEO_ID = /^\d{8,30}$/;

export function savedSourcePlatformFromUrl(url = "") {
  if (isYouTubeUrl(url))
    return "youtube";
  if (isTikTokSourceUrl(url))
    return "tiktok";
  return "unknown";
}

export function repairLegacyFakeTikTokYouTubeUrl(url = "") {
  const raw = String(url || "").trim();
  if (!raw)
    return "";
  const legacy = raw.match(/tiktok\.com\/(?:@[^/]+\/)?video\/([A-Za-z0-9_-]{11})(?:[/?#]|$)/i);
  if (legacy && YOUTUBE_VIDEO_ID.test(legacy[1]) && !TIKTOK_VIDEO_ID.test(legacy[1]))
    return `https://www.youtube.com/watch?v=${legacy[1]}`;
  return raw;
}

export function automationVideoSourceUrl(video = {}) {
  const candidates = [
    video?.playUrl,
    video?.sourceUrl,
    video?.url,
  ];
  for (const candidate of candidates) {
    const repaired = repairLegacyFakeTikTokYouTubeUrl(candidate);
    if (repaired)
      return repaired;
  }
  const id = String(video?.id || "").trim();
  if (id && YOUTUBE_VIDEO_ID.test(id) && !TIKTOK_VIDEO_ID.test(id))
    return `https://www.youtube.com/watch?v=${id}`;
  if (id && TIKTOK_VIDEO_ID.test(id)) {
    const handle = String(video?.authorHandle || video?.author || "").replace(/^@+/, "").trim();
    return handle
      ? `https://www.tiktok.com/@${handle}/video/${id}`
      : `https://www.tiktok.com/video/${id}`;
  }
  return "";
}

export function automationVideoPlatform(video = {}, sourceListUrl = "") {
  const explicit = String(video?.sourcePlatform || "").trim().toLowerCase();
  if (explicit === "youtube" || explicit === "tiktok")
    return explicit;

  const url = automationVideoSourceUrl(video);
  if (isYouTubeUrl(url))
    return "youtube";
  if (isTikTokSourceUrl(url))
    return "tiktok";

  const listPlatform = savedSourcePlatformFromUrl(sourceListUrl);
  if (listPlatform === "youtube" || listPlatform === "tiktok")
    return listPlatform;

  const id = String(video?.id || "").trim();
  if (id && TIKTOK_VIDEO_ID.test(id))
    return "tiktok";
  if (id && YOUTUBE_VIDEO_ID.test(id))
    return "youtube";

  return isTikTokSourceUrl(sourceListUrl) ? "tiktok" : "youtube";
}

export function normalizeAutomationSourceVideo(video = {}, sourceListUrl = "") {
  const platform = automationVideoPlatform(video, sourceListUrl);
  const playUrl = automationVideoSourceUrl(video);
  return {
    ...video,
    sourcePlatform: platform,
    playUrl,
    sourceUrl: playUrl || video?.sourceUrl || video?.url || "",
  };
}

export function automationSourceKeyForVideo(video = {}, sourceListUrl = "") {
  const platform = automationVideoPlatform(video, sourceListUrl);
  const id = String(video?.id || "").trim();
  if (id)
    return `${platform}:${id}`;
  const url = automationVideoSourceUrl(video);
  if (url)
    return `url:${url}`;
  return "";
}
