// Your own film sources for Movie to Recap: sites saved by name and link, searched together for a film.
// A link with {query} is a search address ("https://site.com/search?q={query}"); a plain site link is
// searched the WordPress way (/?s=), which most film sites run on. Results are the links on the result
// page whose text best matches the film's name (and year). A page that builds its results in JavaScript
// is read through the Jina page reader instead. Every fetch goes through the app's public-only fetcher.
import { JINA_READER, normalizePublicUrl } from "./reach.js";

const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0 Safari/537.36";
export const MAX_SOURCES = 20;
const PER_SOURCE = 8;
const STOP = new Set(["the", "a", "an", "of", "and", "in", "on", "to", "movie", "film", "full", "watch", "download", "free", "online"]);

const decode = (text) => String(text || "")
  .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
const tokens = (text) => decode(text).toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").filter((w) => w && !STOP.has(w));

/** A saved source, checked: a name and a public http(s) link, which may hold {query}. */
export function normalizeSource(raw) {
  const name = String(raw?.name || "").replace(/\s+/g, " ").trim().slice(0, 60);
  const link = String(raw?.url || "").trim();
  if (!link) throw fail("Add the source's link");
  const url = normalizePublicUrl(link.replace(/\{query\}/g, "QUERYTOKEN")).replace(/QUERYTOKEN/g, "{query}");
  return { id: String(raw?.id || "").match(/^src_[a-z0-9]{6,16}$/)?.[0] || `src_${Math.random().toString(36).slice(2, 10)}`, name: name || new URL(url.replace("{query}", "x")).hostname.replace(/^www\./, ""), url };
}

/** The addresses to try for a search: the source's own search address, else the common site searches. */
export function searchUrls(source, query) {
  const q = encodeURIComponent(String(query || "").trim());
  if (source.url.includes("{query}")) return [source.url.replace(/\{query\}/g, q)];
  const origin = new URL(source.url).origin;
  return [`${origin}/?s=${q}`, `${origin}/search?q=${q}`];
}

/** Every link on a page (HTML anchors, or Markdown links from the page reader) with its visible text. */
export function pageLinks(body, base) {
  const out = [];
  const add = (href, text) => {
    try {
      const url = new URL(decode(href).trim(), base);
      if (!["http:", "https:"].includes(url.protocol)) return;
      url.hash = "";
      out.push({ url: url.toString(), text: decode(text).replace(/\s+/g, " ").trim() });
    } catch {}
  };
  const html = String(body || "");
  for (const m of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = m[1].match(/href\s*=\s*["']([^"']+)["']/i)?.[1];
    if (!href) continue;
    const title = m[1].match(/title\s*=\s*["']([^"']+)["']/i)?.[1] || "";
    const alt = m[2].match(/alt\s*=\s*["']([^"']+)["']/i)?.[1] || "";
    // The visible text, then a tooltip or image alt only when it adds something.
    const pieces = [];
    for (const piece of [m[2].replace(/<[^>]+>/g, " "), title, alt].map((p) => decode(p).replace(/\s+/g, " ").trim()))
      if (piece && !pieces.some((p) => p.toLowerCase().includes(piece.toLowerCase()))) pieces.push(piece);
    add(href, pieces.join(" "));
  }
  for (const m of html.matchAll(/\[([^\]]{2,200})\]\((https?:\/\/[^)\s]+)\)/g)) add(m[2], m[1]);
  return out;
}

/** How well a link matches the film (0..1), or 0 when it doesn't name it: most of the film's words must
 *  appear in its text or address, and a matching year counts extra. */
export function matchScore(link, query) {
  const wanted = tokens(query).filter((w) => !/^(19|20)\d{2}$/.test(w));
  if (!wanted.length) return 0;
  const year = String(query).match(/\b(19|20)\d{2}\b/)?.[0];
  let path = "";
  try { path = decodeURIComponent(new URL(link.url).pathname); } catch {}
  const have = new Set([...tokens(link.text), ...tokens(path)]);
  const found = wanted.filter((w) => have.has(w)).length;
  const coverage = found / wanted.length;
  if (coverage < 0.6 || (wanted.length >= 2 && found < 2)) return 0;
  const extra = Math.max(0, have.size - wanted.length);
  return Math.min(1, coverage * 0.8 + (year && have.has(year) ? 0.15 : 0) + 0.05 / (1 + extra / 6));
}

/** The film's results on one page, best first: on the source's site, not navigation or listing links. */
export function rankResults(links, query, site) {
  const seen = new Set();
  const results = [];
  for (const link of links) {
    let url;
    try { url = new URL(link.url); } catch { continue; }
    if (site && url.hostname.replace(/^www\./, "") !== site) continue;
    if (/\/(category|tag|tags|genre|page|author|search|feed|wp-login|wp-admin|login|register)(\/|$)|[?&](s|q|search|action|redlink)=/i.test(url.pathname + url.search)) continue;
    if (/does not exist|create this page/i.test(link.text)) continue;
    const score = matchScore(link, query);
    if (!score || seen.has(link.url)) continue;
    seen.add(link.url);
    results.push({ url: link.url, title: link.text.slice(0, 160) || url.pathname, score: Math.round(score * 100) });
  }
  return results.sort((a, b) => b.score - a.score || a.title.length - b.title.length).slice(0, PER_SOURCE);
}

/** One source's results for a film. Tries the direct page, then the page reader for JavaScript sites. */
export async function searchSource(source, query, { fetcher }) {
  const site = new URL(source.url.replace("{query}", "x")).hostname.replace(/^www\./, "");
  let lastError = "";
  for (const address of searchUrls(source, query)) {
    for (const viaReader of [false, true]) {
      try {
        const target = viaReader ? `${JINA_READER}${address}` : address;
        // The page reader gets the fetcher's own agent: a browser one makes it hit Cloudflare's challenge.
        const { body } = await fetcher(target, viaReader
          ? { accept: "text/plain", maxBytes: 3 * 1024 * 1024, timeoutMs: 25000 }
          : { accept: "text/html,application/xhtml+xml", maxBytes: 3 * 1024 * 1024, timeoutMs: 15000, userAgent: UA });
        const results = rankResults(pageLinks(body.toString("utf8"), address), query, site);
        if (results.length) return { source: { id: source.id, name: source.name }, results };
      } catch (error) {
        lastError = error?.message || String(error);
      }
    }
  }
  return { source: { id: source.id, name: source.name }, results: [], ...(lastError ? { error: lastError.slice(0, 160) } : {}) };
}

/** Every source searched at once (four at a time). */
export async function searchSources(sources, query, { fetcher }) {
  const q = String(query || "").trim().slice(0, 120);
  if (q.length < 2) throw fail("Type the film's name");
  const out = [];
  const queue = [...sources];
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (queue.length) {
      const source = queue.shift();
      out.push(await searchSource(source, q, { fetcher }));
    }
  }));
  return sources.map((s) => out.find((r) => r.source.id === s.id)).filter(Boolean);
}
