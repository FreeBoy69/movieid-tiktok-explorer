import { canonicalTikTokPostUrl, isTikTokUrl, normalizeTikTokInputUrl } from "./tiktokUrl.js";

export function isYouTubeUrl(value = "") {
  return /(?:youtube\.com|youtu\.be)/i.test(String(value || ""));
}

export function isTikTokSourceUrl(value = "") {
  return isTikTokUrl(value);
}

export function isDirectChannelSourceUrl(value = "") {
  const tiktok = normalizeTikTokInputUrl(value);
  if (tiktok)
    return /^https:\/\/www\.tiktok\.com\/@[^/]+$/i.test(tiktok);
  const raw = String(value || "").trim();
  if (!raw) return false;
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const path = url.pathname.replace(/\/+$/, "");
    if (host === "youtube.com" || host === "m.youtube.com")
      return /^\/(?:@[^/]+|channel\/[^/]+|c\/[^/]+|user\/[^/]+)$/i.test(path);
  } catch {
    return false;
  }
  return false;
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
    if (!repaired) continue;
    const canonicalTikTok = canonicalTikTokPostUrl(repaired);
    if (canonicalTikTok) return canonicalTikTok;
    const normalizedTikTok = normalizeTikTokInputUrl(repaired);
    if (normalizedTikTok) return normalizedTikTok;
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
    sourceListUrl: sourceListUrl || video.sourceListUrl || "",
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

/**
 * The creators behind a playlist or collection source, as channel URLs ranked by how many of the
 * playlist's videos they made. Agents whose source is a playlist follow these channels too, so the
 * pool keeps growing as those creators post instead of running out with the playlist.
 * TikTok uses the author handle; YouTube uses the uploader's channel URL.
 */
export function playlistCreatorChannels(videos = [], { exclude = [], limit = 12 } = {}) {
  const excluded = new Set(exclude.map((value) => channelKey(value)).filter(Boolean));
  const counts = new Map();
  for (const video of Array.isArray(videos) ? videos : []) {
    const url = creatorChannelUrl(video);
    const key = channelKey(url);
    if (!key || excluded.has(key)) continue;
    const entry = counts.get(key) || { url, handle: key.replace(/^(tiktok|youtube):/, ""), count: 0 };
    entry.count += 1;
    counts.set(key, entry);
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.handle.localeCompare(b.handle)).slice(0, Math.max(0, limit));
}

function creatorChannelUrl(video = {}) {
  const uploader = String(video?.uploaderUrl || video?.channelUrl || video?.channel_url || "").trim();
  if (uploader && isDirectChannelSourceUrl(uploader)) return normalizeTikTokInputUrl(uploader) || uploader.replace(/\/+$/, "");
  const handle = String(video?.authorHandle || "").trim().replace(/^@/, "")
    || String(video?.playUrl || video?.sourceUrl || "").match(/tiktok\.com\/@([^/?#\s]+)\/(?:video|photo)\//i)?.[1]
    || "";
  if (!handle || handle.toLowerCase() === "user" || !/^[\w.-]+$/.test(handle)) return "";
  return `https://www.tiktok.com/@${handle}`;
}

function channelKey(value = "") {
  const text = String(value || "").trim();
  if (!text) return "";
  const tiktok = normalizeTikTokInputUrl(text);
  const handle = tiktok.match(/^https:\/\/www\.tiktok\.com\/@([^/?#]+)$/i)?.[1];
  if (handle) return `tiktok:${decodeURIComponent(handle).toLowerCase()}`;
  try {
    const url = new URL(text);
    if (/(^|\.)youtube\.com$/i.test(url.hostname)) return `youtube:${url.pathname.replace(/\/+$/, "").toLowerCase()}`;
  } catch {}
  return "";
}
