const TIKTOK_ID = /^\d{8,30}$/;

function cleanInput(value = "") {
  const raw = String(value || "")
    .trim()
    .replace(/^[\u2018\u2019\u201c\u201d"']+|[\u2018\u2019\u201c\u201d"']+$/g, "");
  if (!raw) return "";
  const urlFromText = raw.match(/(?:https?:)?\/\/[^\s<>"']+/i)?.[0];
  const candidate = urlFromText || raw;
  return candidate.replace(/[),.;!?]+$/g, "").trim();
}

function withScheme(value = "") {
  const clean = cleanInput(value);
  if (!clean) return "";
  if (clean.startsWith("//")) return `https:${clean}`;
  if (/^https?:\/\//i.test(clean)) return clean;
  if (/^@[-._a-z0-9]+$/i.test(clean)) return `https://www.tiktok.com/${clean}`;
  if (/^(?:[a-z0-9-]+\.)*tiktok\.com(?:\/|$)/i.test(clean)) return `https://${clean}`;
  return clean;
}

function isTikTokHost(hostname = "") {
  const host = String(hostname || "").toLowerCase().replace(/\.+$/, "");
  return host === "tiktok.com" || host.endsWith(".tiktok.com");
}

function decodePathSegment(value = "") {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function extractIdFromPath(pathname = "") {
  const path = decodePathSegment(pathname);
  const patterns = [
    /\/@[^/]+\/(?:video|photo)\/(\d{8,30})(?:[/?]|$)/i,
    /\/(?:video|photo)\/(\d{8,30})(?:[/?]|$)/i,
    /\/(?:embed\/v2|player\/v1|v)\/(\d{8,30})(?:\.html?)?(?:[/?]|$)/i,
    /\/share\/(?:video|item)\/(\d{8,30})(?:[/?]|$)/i,
  ];
  for (const pattern of patterns) {
    const match = path.match(pattern);
    if (match?.[1] && TIKTOK_ID.test(match[1])) return match[1];
  }
  return "";
}

function extractIdFromQuery(searchParams) {
  for (const key of ["item_id", "itemId", "aweme_id", "awemeId", "video_id", "videoId"]) {
    const value = String(searchParams.get(key) || "").trim();
    if (TIKTOK_ID.test(value)) return value;
  }
  return "";
}

function handleFromPath(pathname = "") {
  const match = decodePathSegment(pathname).match(/\/@([^/?#]+)/);
  if (!match?.[1]) return "";
  return String(match[1]).replace(/^@+/, "").trim();
}

function inputKind(pathname = "", host = "", hasId = false) {
  const path = decodePathSegment(pathname).replace(/\/+$/, "").toLowerCase();
  if (/(?:^|\/)photo\//.test(path)) return "photo";
  if (hasId) return "video";
  if (host === "vm.tiktok.com" || host === "vt.tiktok.com" || /^\/t\//.test(path) || /^\/h5\/share\//.test(path)) return "short";
  if (/^\/@[^/]+\/live(?:\/|$)/.test(path) || /^\/live(?:\/|$)/.test(path)) return "live";
  if (/^\/search(?:\/|$)/.test(path) || /^\/discover(?:\/|$)/.test(path)) return "search";
  if (/^\/@[^/]+\/(?:collection|collections|playlist|playlists|mix|favorites|favourite|saved)(?:\/|$)/.test(path)
    || /^\/(?:collection|collections|playlist|playlists|mix)(?:\/|$)/.test(path)) return "collection";
  if (/^\/@[^/]+$/.test(path)) return "profile";
  return "unknown";
}

function canonicalUrlFor({ kind, id, handle, parsed }) {
  if ((kind === "video" || kind === "photo") && id) {
    const postKind = kind === "photo" ? "photo" : "video";
    return handle
      ? `https://www.tiktok.com/@${encodeURIComponent(handle)}/${postKind}/${id}`
      : `https://www.tiktok.com/video/${id}`;
  }
  if (kind === "profile" && handle) return `https://www.tiktok.com/@${encodeURIComponent(handle)}`;
  if (kind === "search") {
    const query = String(parsed.searchParams.get("q") || parsed.searchParams.get("keyword") || "").trim();
    return query ? `https://www.tiktok.com/search?q=${encodeURIComponent(query)}` : "https://www.tiktok.com/search";
  }
  if (kind === "collection") {
    const url = new URL(parsed.toString());
    url.protocol = "https:";
    url.hostname = "www.tiktok.com";
    url.hash = "";
    for (const key of ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "lang", "is_from_webapp", "sender_device", "sender_web_id"]) {
      url.searchParams.delete(key);
    }
    return url.toString();
  }
  const url = new URL(parsed.toString());
  url.hash = "";
  return url.toString();
}

/**
 * Parse known TikTok URL shapes without following redirects. Short/share URLs stay intact
 * until a server-side resolver follows TikTok's redirect chain.
 */
export function parseTikTokUrl(value = "") {
  const supplied = withScheme(value);
  if (!supplied) return { valid: false, raw: "", url: "", kind: "unknown", id: "", handle: "", isShortLink: false };
  let parsed;
  try {
    parsed = new URL(supplied);
  } catch {
    return { valid: false, raw: supplied, url: "", kind: "unknown", id: "", handle: "", isShortLink: false };
  }
  if (!/^https?:$/i.test(parsed.protocol) || !isTikTokHost(parsed.hostname)) {
    return { valid: false, raw: supplied, url: "", kind: "unknown", id: "", handle: "", isShortLink: false };
  }
  const id = extractIdFromPath(parsed.pathname) || extractIdFromQuery(parsed.searchParams);
  const handle = handleFromPath(parsed.pathname);
  const kind = inputKind(parsed.pathname, parsed.hostname.toLowerCase(), Boolean(id));
  const isShortLink = kind === "short";
  return {
    valid: true,
    raw: supplied,
    url: canonicalUrlFor({ kind, id, handle, parsed }),
    kind,
    id,
    handle,
    isShortLink,
  };
}

export function isTikTokUrl(value = "") {
  return parseTikTokUrl(value).valid;
}

export function extractTikTokVideoId(value = "") {
  return parseTikTokUrl(value).id;
}

export function canonicalTikTokPostUrl(value = "") {
  const parsed = parseTikTokUrl(value);
  return parsed.valid && parsed.id ? parsed.url : "";
}

export function canonicalTikTokProfileUrl(value = "") {
  const parsed = parseTikTokUrl(value);
  return parsed.valid && parsed.kind === "profile" ? parsed.url : "";
}

export function normalizeTikTokInputUrl(value = "") {
  const parsed = parseTikTokUrl(value);
  return parsed.valid ? parsed.url : "";
}
