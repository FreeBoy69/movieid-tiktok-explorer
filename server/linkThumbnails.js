// A pasted link becomes a reference image. A YouTube video link resolves to its
// thumbnail straight from YouTube's image CDN (no page fetch, which YouTube often
// blocks from servers); other video sites use their cover image from yt-dlp.

const YOUTUBE_HOSTS = /^(?:www\.|m\.|music\.)?(?:youtube\.com|youtube-nocookie\.com)$/i;
const VIDEO_HOSTS = /(?:^|\.)(?:tiktok\.com|vimeo\.com|instagram\.com|facebook\.com|fb\.watch|x\.com|twitter\.com|dailymotion\.com|twitch\.tv|reddit\.com|streamable\.com|rumble\.com|bilibili\.com|kick\.com)$/i;

function parse(value) {
  const text = String(value || "").trim();
  try {
    return new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
}

/** The 11-character video ID of a YouTube watch, short, embed, live, or youtu.be link. */
export function youtubeVideoId(value) {
  const url = parse(value);
  if (!url) return "";
  let id = "";
  if (/^(?:www\.)?youtu\.be$/i.test(url.hostname)) id = url.pathname.split("/")[1] || "";
  else if (YOUTUBE_HOSTS.test(url.hostname)) {
    id = url.searchParams.get("v") || "";
    const match = url.pathname.match(/^\/(?:shorts|embed|live|v)\/([^/?#]+)/i);
    if (!id && match) id = match[1];
  }
  return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : "";
}

/** Thumbnail URLs for a YouTube link, largest first (maxres is missing on some videos). */
export function youtubeThumbnailUrls(value) {
  const id = youtubeVideoId(value);
  return id ? ["maxresdefault", "sddefault", "hqdefault"].map((size) => `https://i.ytimg.com/vi/${id}/${size}.jpg`) : [];
}

/** True for links to a video page on a site yt-dlp can read a cover image from. */
export function isVideoPageLink(value) {
  const url = parse(value);
  return Boolean(url && VIDEO_HOSTS.test(url.hostname));
}
