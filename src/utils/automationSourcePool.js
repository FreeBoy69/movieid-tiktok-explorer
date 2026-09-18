import { automationSourceKeyForVideo, automationVideoSourceUrl } from "./automationSourceVideo.js";
import { planSourceChannelCandidates, sourceNicheCompatibility } from "./automationSourceStrategy.js";

export function poolSourceIdentity(value = "") {
  try {
    const url = new URL(value);
    return `${url.hostname.toLowerCase().replace(/^www\./, "")}${decodeURIComponent(url.pathname).replace(/\/+$/, "").toLowerCase()}${url.searchParams.has("list") ? `?list=${url.searchParams.get("list")}` : ""}`;
  } catch { return String(value || "").trim().toLowerCase(); }
}

export function poolVideoKey(video) {
  return automationSourceKeyForVideo({ ...video, id: video.id || video.sourceVideoId, playUrl: video.playUrl || video.sourceUrl });
}

export function sourceUploadIndex(uploads = []) {
  return new Set(uploads.flatMap((upload) => [poolVideoKey(upload), upload.sourceKey, automationVideoSourceUrl(upload)].filter(Boolean)));
}

export function sourceVideoUsed(video, used) {
  return used.has(poolVideoKey(video)) || used.has(automationVideoSourceUrl(video));
}

// Membership identifies old uploads; new uploads also record the selected pool URL.
export function sourcePoolUsage(sources, uploads = [], settings = {}) {
  const used = sourceUploadIndex(uploads);
  const successful = uploads.filter((u) => ["uploaded", "scheduled", "published"].includes(u.status));
  const recent = [...successful].sort((a, b) => Number(b.createdAt) - Number(a.createdAt)).slice(0, Math.max(30, sources.length * 4));
  return sources.map((source) => {
    const key = poolSourceIdentity(source.url);
    const videos = [...new Map((source.videos || []).map((v) => [poolVideoKey(v), v])).values()].filter((v) => poolVideoKey(v));
    const keys = new Set(videos.map(poolVideoKey));
    const belongs = (u) => u.sourceListUrl
      ? poolSourceIdentity(u.sourceListUrl) === key
      : keys.has(poolVideoKey(u)) || poolSourceIdentity(String(u.sourceUrl || "").split("/video/")[0]) === key;
    const usedCount = videos.filter((v) => sourceVideoUsed(v, used)).length;
    const available = videos.filter((v) => !sourceVideoUsed(v, used));
    const eligible = available.filter((v) => settings.sourceNicheMode !== "strict" || sourceNicheCompatibility(v, settings).match !== "mismatch");
    const prior = successful.filter(belongs);
    const lastIndex = recent.findIndex(belongs);
    return {
      url: source.url, key, title: source.title || source.url, primary: Boolean(source.primary),
      total: videos.length, used: usedCount, remaining: videos.length - usedCount, eligible: eligible.length,
      percent: videos.length ? Math.round(usedCount / videos.length * 100) : 0,
      posts: prior.length, recentPosts: recent.filter(belongs).length,
      lastUsedAt: prior.length ? Math.max(...prior.map((u) => Number(u.createdAt) || 0)) : null,
      runsSinceLastUse: lastIndex < 0 ? recent.length : lastIndex,
      lastScannedAt: source.savedAt || null,
      status: !videos.length ? "not_scanned" : !available.length ? "exhausted" : !eligible.length ? "niche_mismatch" : "ready",
    };
  });
}

// Preserve video quality ranking inside each source, with bounded waiting across sources.
export function planSourcePoolCandidates(videos = [], options = {}) {
  const eligibleVideos = options.settings?.sourceNicheMode === "strict"
    ? videos.filter((video) => sourceNicheCompatibility(video, options.settings).match !== "mismatch") : videos;
  const plan = planSourceChannelCandidates(eligibleVideos, options);
  if (videos.length && !eligibleVideos.length) plan.strategy.reason = "no_niche_compatible_sources";
  const groups = new Map();
  for (const video of plan.videos) {
    const key = poolSourceIdentity(video.sourceListUrl) || "collection";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(video);
  }
  if (groups.size < 2) return plan;
  const history = options.sourceUsage || [];
  const fallbackHistory = sourcePoolUsage([...groups].map(([key, items]) => ({ url: items[0].sourceListUrl || key, videos: items })), options.uploads || [], options.settings);
  const waitLimit = Math.max(3, groups.size * 2);
  const rows = [...groups].map(([key, items], index) => {
    const usage = history.find((row) => row.key === key) || fallbackHistory.find((row) => row.key === key);
    const wait = usage?.runsSinceLastUse ?? waitLimit;
    // Rank provides a bounded preference for the strongest source, never an exclusion.
    const weight = 1 + (groups.size - index) / groups.size;
    return { key, items, index, wait, overdue: !usage?.posts || wait >= waitLimit,
      load: (Number(usage?.recentPosts || 0) + 1) / weight };
  }).sort((a, b) => Number(b.overdue) - Number(a.overdue)
    || (a.overdue ? b.wait - a.wait : a.load - b.load) || a.index - b.index);
  const ordered = [];
  const maxLength = Math.max(...rows.map((row) => row.items.length));
  for (let i = 0; i < maxLength; i++) for (const row of rows) if (row.items[i]) ordered.push(row.items[i]);
  return { videos: ordered, strategy: { ...plan.strategy, poolRotation: true,
    poolReason: rows[0].overdue ? "unused_or_overdue_source" : "performance_weighted_rotation",
    selectedPoolSources: rows.map((row) => row.key), maxWaitRuns: waitLimit } };
}
