// Niche Finder: a search hit says little about the channel behind it, so each candidate
// channel's latest uploads are fetched and the channel is judged on those (typical views,
// best and newest video, upload rate, first upload, language, likely monetization).

const CACHE_MS = 6 * 3600 * 1000;
const cache = new Map();

/** Memoizes a discovery result for a few hours: YouTube search quota is scarce. */
export async function cachedDiscovery(key, load) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const value = await load();
  cache.set(key, { at: Date.now(), value });
  if (cache.size > 120) cache.delete(cache.keys().next().value);
  return value;
}

const language = (value) => String(value || "").trim().toLowerCase().slice(0, 2);
const isoSeconds = (iso) => {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(String(iso || ""));
  return m ? (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0) : 0;
};
const thumb = (t = {}) => t.maxres?.url || t.standard?.url || t.high?.url || t.medium?.url || t.default?.url || "";

async function inBatches(items, size, run) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(run))));
  return out;
}

// YouTube Partner Program: 1,000 subscribers and 4,000 public watch hours in a year.
// Watch hours are estimated from the fetched uploads at ~35% average view duration.
function likelyMonetized(subscribers, uploads) {
  if (subscribers < 1000) return "unlikely";
  const year = Date.now() - 365 * 86400000;
  const hours = uploads
    .filter((v) => Date.parse(v.publishedAt) >= year && v.durationSeconds > 180)
    .reduce((sum, v) => sum + (v.viewCount * v.durationSeconds * 0.35) / 3600, 0);
  return hours >= 4000 ? "likely" : "unlikely";
}

/**
 * Replaces search hits with each channel's latest uploads, in the shape the ranker reads.
 * `youtube(path, params)` is the Data API fetcher; `faceless(title, description, channel)`
 * returns { score, hits }. Channels that can't be read keep their search hits.
 * @param {any[]} hits
 * @param {{ youtube?: (path: string, params: Record<string, unknown>) => Promise<any>, faceless?: (title: string, description: string, channel: string) => { score: number, hits?: string[] }, limit?: number, uploads?: number }} [options]
 */
export async function enrichDiscoveryChannels(hits = [], { youtube, faceless, limit = 40, uploads = 15 } = {}) {
  const byChannel = new Map();
  for (const video of hits) {
    if (!video.channelId) continue;
    if (!byChannel.has(video.channelId)) byChannel.set(video.channelId, []);
    byChannel.get(video.channelId).push(video);
  }
  const ids = [...byChannel.keys()].slice(0, limit);
  if (!ids.length || !youtube) return hits;

  const channels = new Map();
  for (let i = 0; i < ids.length; i += 50) {
    const data = await youtube("channels", { part: "snippet,statistics,contentDetails", id: ids.slice(i, i + 50).join(","), maxResults: 50 }).catch(() => ({ items: [] }));
    for (const item of data.items || []) channels.set(item.id, item);
  }
  const playlists = await inBatches(ids, 8, async (id) => {
    const playlistId = channels.get(id)?.contentDetails?.relatedPlaylists?.uploads || `UU${id.slice(2)}`;
    const data = await youtube("playlistItems", { part: "contentDetails", playlistId, maxResults: uploads }).catch(() => ({ items: [] }));
    return [id, (data.items || []).map((item) => item.contentDetails?.videoId).filter(Boolean)];
  });
  const videoIds = [...new Set(playlists.flatMap(([, list]) => list))];
  const details = new Map();
  for (let i = 0; i < videoIds.length; i += 50) {
    const data = await youtube("videos", { part: "snippet,statistics,contentDetails", id: videoIds.slice(i, i + 50).join(","), maxResults: 50 }).catch(() => ({ items: [] }));
    for (const item of data.items || []) details.set(item.id, item);
  }

  const now = Date.now();
  const out = [];
  for (const [id, list] of playlists) {
    const found = byChannel.get(id);
    const channel = channels.get(id);
    const items = list.map((videoId) => details.get(videoId)).filter(Boolean);
    // YouTube's auto-generated "Artist - Topic" music channels aren't creators.
    if (/ - Topic$/.test(channel?.snippet?.title || "")) continue;
    if (!channel || !items.length) {
      out.push(...found);
      continue;
    }
    const snippet = channel.snippet || {};
    const stats = channel.statistics || {};
    const subscriberCount = stats.hiddenSubscriberCount ? null : Number(stats.subscriberCount || 0);
    const videoCount = Number(stats.videoCount || 0);
    const hit = found[0];
    const discoveryScore = found.reduce((sum, v) => sum + Number(v.discoveryScore || 0), 0) / found.length;
    const hitIds = new Set(found.map((v) => v.id));
    const videos = items.map((video) => {
      const s = video.snippet || {};
      const viewCount = Number(video.statistics?.viewCount || 0);
      const ageHours = Math.max(1, (now - Date.parse(s.publishedAt || "")) / 36e5) || 1;
      return {
        id: video.id,
        url: `https://www.youtube.com/watch?v=${video.id}`,
        title: s.title || "Untitled video",
        thumbnailUrl: thumb(s.thumbnails),
        publishedAt: s.publishedAt || "",
        viewCount,
        viewsPerHour: Math.round(viewCount / ageHours),
        durationSeconds: isoSeconds(video.contentDetails?.duration),
        language: language(s.defaultAudioLanguage || s.defaultLanguage),
        searchHit: hitIds.has(video.id) || undefined,
      };
    });
    const oldest = videos.reduce((min, v) => Math.min(min, Date.parse(v.publishedAt) || min), Infinity);
    // The first upload is known when every upload was fetched; otherwise fall back to the
    // channel's creation date, which is never later than its first upload.
    const firstUploadAt = videoCount && videos.length >= videoCount && Number.isFinite(oldest) ? new Date(oldest).toISOString() : snippet.publishedAt || "";
    const channelLanguage = language(snippet.defaultLanguage) || mostCommon(videos.map((v) => v.language).filter(Boolean));
    const facelessScore = channelFaceless(snippet.title, videos.map((v) => v.title), faceless);
    const monetized = subscriberCount === null ? "unknown" : likelyMonetized(subscriberCount, videos);
    for (const video of videos)
      out.push({
        ...video,
        channelId: id,
        channelTitle: snippet.title || hit.channelTitle,
        channelUrl: snippet.customUrl ? `https://www.youtube.com/${snippet.customUrl}` : `https://www.youtube.com/channel/${id}`,
        channelHandle: snippet.customUrl || "",
        channelThumbnailUrl: thumb(snippet.thumbnails),
        channelPublishedAt: snippet.publishedAt || "",
        channelFirstUploadAt: firstUploadAt,
        channelVideoCount: videoCount,
        channelMonetized: monetized,
        subscriberCount,
        language: video.language || channelLanguage,
        region: snippet.country || hit.region || "",
        niche: hit.niche || "",
        discoveryScore,
        facelessScore,
      });
  }
  return out;
}

// Faceless is judged across the channel, not per title: narration formats (stories, facts,
// explained, recaps) push it up, first-person titles ("I tried", "my day") pull it down.
const PERSONAL = /\b(i|i'm|me|my|vlog|daily life|family|travel with|my day|we|our)\b/i;
function channelFaceless(channelTitle, titles, faceless) {
  if (!titles.length) return null;
  const signals = new Set();
  if (faceless) for (const title of [channelTitle, ...titles]) for (const hit of faceless(title, "", "").hits || []) signals.add(hit);
  const personal = titles.filter((title) => PERSONAL.test(title)).length / titles.length;
  return Math.round(Math.max(0, Math.min(100, 55 + Math.min(30, signals.size * 6) - personal * 70)));
}

function mostCommon(values) {
  const counts = new Map();
  for (const v of values) counts.set(v, (counts.get(v) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "";
}
