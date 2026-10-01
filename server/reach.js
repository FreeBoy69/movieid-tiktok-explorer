// Reach: how the app gets at the internet, modelled on Agent Reach
// (github.com/Panniantong/agent-reach, MIT). Each channel has an ORDERED list
// of backends: the first is preferred, the rest are fallbacks, and a backend is
// only "active" after it has really answered. Pure helpers live here; the
// routes in server.js and miniTools.js wire them to fetchers and yt-dlp.

const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0 Safari/537.36";
export const JINA_READER = "https://r.jina.ai/";
const MAX_PAGE_BYTES = 5 * 1024 * 1024;

// ---------- Web pages: Jina Reader first (clean Markdown), direct fetch as the fallback ----------

/** Jina and Cloudflare challenge pages look like content; recognise them so the fallback runs. */
export function isAntibotPage(text) {
  const sample = String(text || "").slice(0, 4096).toLowerCase();
  const jinaCaptcha = sample.includes("warning:") && sample.includes("requiring captcha");
  const challenge = ["title: just a moment...", "## performing security verification", "title: attention required! | cloudflare"].some((marker) => sample.includes(marker));
  const cloudflare = sample.includes("title: attention required! | cloudflare") && (sample.includes("ray id") || sample.includes("/cdn-cgi/challenge-platform/"));
  return (jinaCaptcha && challenge) || cloudflare;
}

/** Only clearly public http(s) targets, normalised; bare hosts get https://. */
export function normalizePublicUrl(value) {
  const raw = String(value || "").trim();
  if (!raw || /[\s\\\u0000-\u001f\u007f]/.test(raw)) throw fail("Paste a public http(s) link");
  const candidate = raw.includes("://") ? raw : `https://${raw}`;
  let url;
  try {
    url = new URL(candidate);
  } catch {
    throw fail("Paste a public http(s) link");
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  const blockedHosts = new Set(["localhost", "local", "internal", "lan", "home.arpa", "instance-data", "metadata.google.internal", "ip6-localhost", "ip6-loopback", "localdomain"]);
  const blockedSuffix = [".local", ".internal", ".lan", ".home.arpa", ".localdomain", ".localhost"];
  if (!["http:", "https:"].includes(url.protocol) || !host || url.username || url.password || host.includes("%") || blockedHosts.has(host) || blockedSuffix.some((s) => host.endsWith(s)) || (!host.includes(".") && !/^\[?[0-9a-f:.]+\]?$/i.test(host)))
    throw fail("Paste a public http(s) link");
  return url.toString();
}

const decodeEntities = (text) => String(text || "")
  .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));

/** A readable text version of an HTML page: title plus paragraphs, no scripts, styles, or chrome. */
export function htmlToText(html) {
  let s = String(html || "");
  const title = decodeEntities(s.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").replace(/\s+/g, " ").trim();
  s = s.replace(/<!--[\s\S]*?-->/g, "");
  s = s.replace(/<head\b[\s\S]*?<\/head\s*>/i, " ");
  s = s.replace(/<(script|style|noscript|svg|template|iframe|nav|footer|header|form|aside)\b[\s\S]*?<\/\1\s*>/gi, " ");
  s = s.replace(/<(?:br|hr)\b[^>]*>/gi, "\n");
  s = s.replace(/<\/(?:p|div|li|h[1-6]|tr|section|article|blockquote|pre|td|th|dd|dt)\s*>/gi, "\n");
  s = s.replace(/<h([1-6])\b[^>]*>/gi, (_, n) => `\n${"#".repeat(Number(n))} `);
  s = s.replace(/<li\b[^>]*>/gi, "- ");
  s = s.replace(/<[^>]+>/g, " ");
  s = decodeEntities(s);
  s = s.replace(/[ \t\f\v]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return { title, text: s };
}

/** Markdown from Jina: lift its Title:/URL Source: header out of the body. */
export function parseJinaReader(markdown) {
  const raw = String(markdown || "").replace(/\r\n/g, "\n");
  const title = raw.match(/^Title:\s*(.+)$/m)?.[1]?.trim() || "";
  const body = raw.replace(/^(Title|URL Source|Published Time|Warning):.*$/gm, "").replace(/^Markdown Content:\s*$/m, "").replace(/\n{3,}/g, "\n\n").trim();
  return { title, text: body };
}

/**
 * Reads a page as text. Backends in order: Jina Reader, then a direct fetch
 * cleaned locally. `fetcher(url, options)` is safePublicFetch-shaped.
 */
/**
 * @param {string} rawUrl
 * @param {{ fetcher: (url: string, options?: Record<string, unknown>) => Promise<{ url: URL; type: string; body: Buffer }>; timeoutMs?: number; maxChars?: number }} options
 */
export async function readWebPage(rawUrl, { fetcher, timeoutMs = 25000, maxChars = 60000 }) {
  const url = normalizePublicUrl(rawUrl);
  const errors = [];
  try {
    const result = await fetcher(`${JINA_READER}${url}`, { accept: "text/plain", maxBytes: MAX_PAGE_BYTES, timeoutMs, userAgent: UA });
    const text = result.body.toString("utf8");
    if (isAntibotPage(text)) throw new Error("the site answered with a verification page");
    const page = parseJinaReader(text);
    if (page.text.length < 40) throw new Error("the page came back empty");
    return { url, title: page.title, text: page.text.slice(0, maxChars), backend: "jina-reader", truncated: page.text.length > maxChars };
  } catch (error) {
    errors.push(`Jina Reader: ${error.message}`);
  }
  try {
    const result = await fetcher(url, { accept: "text/html,text/plain;q=0.9,*/*;q=0.5", maxBytes: MAX_PAGE_BYTES, timeoutMs, userAgent: UA });
    const type = String(result.type || "");
    const raw = result.body.toString("utf8");
    const page = /html/i.test(type) || /<html[\s>]/i.test(raw) ? htmlToText(raw) : { title: "", text: raw.trim() };
    if (page.text.length < 40) throw new Error("the page came back empty");
    return { url, title: page.title, text: page.text.slice(0, maxChars), backend: "direct", truncated: page.text.length > maxChars };
  } catch (error) {
    errors.push(`Direct fetch: ${error.message}`);
  }
  throw fail(`Could not read that page. ${errors.join(" · ")}`, 502);
}

// ---------- YouTube captions: yt-dlp's info JSON lists them; fetch the track before transcribing audio ----------

const LANGUAGE_PREFERENCE = ["en", "en-US", "en-GB", "en-orig"];
/** Chooses the caption track to use: manual before automatic, English before the original language before anything. */
export function pickCaptionTrack(info, preferred = LANGUAGE_PREFERENCE) {
  const sources = [["manual", info?.subtitles], ["auto", info?.automatic_captions]];
  const wanted = [...preferred, ...(info?.language ? [String(info.language), `${info.language}-orig`] : [])];
  for (const [kind, tracks] of sources) {
    if (!tracks || typeof tracks !== "object") continue;
    const languages = Object.keys(tracks).filter((lang) => Array.isArray(tracks[lang]) && tracks[lang].length);
    if (!languages.length) continue;
    const ordered = [
      ...wanted.filter((lang) => languages.includes(lang)),
      ...languages.filter((lang) => !wanted.includes(lang) && !/-(?:[a-z]{2,3})$/i.test(lang) && !lang.includes("-")).sort(),
      ...languages.filter((lang) => !wanted.includes(lang)).sort(),
    ];
    for (const lang of [...new Set(ordered)]) {
      const formats = tracks[lang];
      const format = ["json3", "vtt", "srv3", "ttml"].map((ext) => formats.find((f) => f?.ext === ext && f?.url)).find(Boolean);
      if (format) return { kind, language: lang, ext: format.ext, url: format.url };
    }
  }
  return null;
}

const clean = (text) => String(text || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

/** YouTube's json3 caption format: events with start, duration, and text segments. */
export function parseJson3(json) {
  const data = typeof json === "string" ? JSON.parse(json) : json;
  const segments = [];
  for (const event of Array.isArray(data?.events) ? data.events : []) {
    const text = clean((event.segs || []).map((seg) => seg?.utf8 || "").join(""));
    if (!text || text === "\n") continue;
    const start = Number(event.tStartMs) / 1000;
    const end = start + (Number(event.dDurationMs) || 2000) / 1000;
    segments.push({ start, end, text });
  }
  return segments;
}

const vttTime = (value) => {
  const parts = String(value).trim().split(":").map(Number);
  return parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts[0] * 60 + parts[1];
};
/** WebVTT cues; styling tags and positioning are dropped. */
export function parseVtt(text) {
  const segments = [];
  const blocks = String(text || "").replace(/\r\n/g, "\n").split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.split("\n").filter((line) => line.trim());
    const timing = lines.findIndex((line) => line.includes("-->"));
    if (timing < 0) continue;
    const [from, to] = lines[timing].split("-->").map((part) => part.trim().split(/\s+/)[0]);
    const body = clean(lines.slice(timing + 1).join(" "));
    if (!body) continue;
    segments.push({ start: vttTime(from.replace(",", ".")), end: vttTime(to.replace(",", ".")), text: body });
  }
  return segments;
}

/**
 * Auto captions repeat the previous line while the next one types in
 * (rolling captions). Keep each new phrase once, extending the earlier cue.
 */
export function dedupeSegments(segments) {
  const out = [];
  for (const segment of segments) {
    const text = clean(segment.text);
    if (!text) continue;
    const last = out[out.length - 1];
    if (last) {
      if (last.text === text) {
        last.end = Math.max(last.end, segment.end);
        continue;
      }
      if (text.startsWith(last.text) && text.length - last.text.length < 160) {
        last.text = text;
        last.end = Math.max(last.end, segment.end);
        continue;
      }
      if (last.text.endsWith(text)) continue;
    }
    out.push({ start: segment.start, end: segment.end, text });
  }
  return out;
}

export const segmentsToText = (segments) => segments.map((s) => s.text).join(" ").replace(/\s+/g, " ").trim();

/**
 * Full captions for a video from its yt-dlp info JSON, or null when it has
 * none. `fetcher` is safePublicFetch-shaped; caption URLs are short-lived.
 */
/**
 * @param {Record<string, any>} info
 * @param {{ fetcher: (url: string, options?: Record<string, unknown>) => Promise<{ url: URL; type: string; body: Buffer }>; timeoutMs?: number }} options
 */
export async function youtubeCaptions(info, { fetcher, timeoutMs = 20000 }) {
  const track = pickCaptionTrack(info);
  if (!track) return null;
  const result = await fetcher(track.url, { accept: "*/*", maxBytes: 20 * 1024 * 1024, timeoutMs, userAgent: UA });
  const body = result.body.toString("utf8");
  if (!body.trim()) throw fail("The caption track came back empty", 502);
  const parsed = track.ext === "json3" ? parseJson3(body) : parseVtt(body);
  const segments = dedupeSegments(parsed);
  if (!segments.length) throw fail("The caption track had no text", 502);
  return { text: segmentsToText(segments), segments, language: track.language, kind: track.kind, backend: "youtube-captions" };
}

// ---------- Doctor: which channels answer right now ----------

/**
 * Checks every channel the app reaches the internet through. Each probe is
 * independent and bounded so one dead channel never takes the report down.
 * `probes` supplies the environment: see server.js for the wiring.
 */
export async function reachDoctor(probes = {}) {
  const channels = [
    { id: "web", name: "Web pages", tier: 0, backends: ["jina-reader", "direct"], probe: probes.web },
    { id: "youtube-captions", name: "YouTube captions", tier: 0, backends: ["yt-dlp info + caption track", "whisper"], probe: probes.youtubeCaptions },
    { id: "youtube-media", name: "YouTube downloads", tier: 0, backends: ["yt-dlp on the YouTube worker"], probe: probes.youtubeMedia },
    { id: "social-media", name: "TikTok and other video links", tier: 0, backends: ["yt-dlp on the media worker"], probe: probes.socialMedia },
    { id: "transcription", name: "Audio transcription", tier: 0, backends: ["faster-whisper on the media worker"], probe: probes.transcription },
    { id: "text-models", name: "Text models", tier: 1, backends: ["OpenRouter", "DeepSeek", "DashScope", "Gemini"], probe: probes.textModels },
    { id: "image-models", name: "Image and video models", tier: 1, backends: ["VideoRouter", "OpenRouter"], probe: probes.imageModels },
    { id: "film-data", name: "Film and series data", tier: 1, backends: ["TMDB"], probe: probes.filmData },
    { id: "voices", name: "Cloned voices", tier: 2, backends: ["Voicebox tunnel"], probe: probes.voices },
  ];
  const results = await Promise.all(channels.map(async (channel) => {
    const base = { id: channel.id, name: channel.name, tier: channel.tier, backends: channel.backends };
    if (!channel.probe) return { ...base, status: "off", message: "No probe wired for this channel", activeBackend: null };
    try {
      const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("the check took longer than 8 seconds")), 8000));
      const result = await Promise.race([channel.probe(), timeout]);
      return { ...base, status: result?.status || "ok", message: String(result?.message || "Working"), activeBackend: result?.activeBackend ?? (result?.status === "ok" ? channel.backends[0] : null) };
    } catch (error) {
      return { ...base, status: "error", message: `Check failed: ${String(error?.message || error).slice(0, 200)}`, activeBackend: null };
    }
  }));
  const ok = results.filter((r) => r.status === "ok").length;
  return { checkedAt: new Date().toISOString(), ok, total: results.length, channels: results };
}
