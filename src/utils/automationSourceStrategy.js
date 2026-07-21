const NICHE_FAMILIES = {
  anime: ["anime", "manga", "donghua", "manhwa", "webtoon", "isekai", "otaku"],
  animation: ["animation", "animated", "cartoon", "ai story", "ai stories", "fruit story", "animal story"],
  movies: ["movie", "movies", "film", "cinema", "hollywood", "recap"],
  sports: ["sport", "sports", "football", "soccer", "world cup", "basketball", "cycling", "wrestling"],
  geography: ["geography", "geo facts", "country", "countries", "border", "map", "travel"],
  animals: ["animal", "animals", "cat", "dog", "wildlife", "pet"],
  technology: ["technology", "tech", "ai", "artificial intelligence", "robot", "automation"],
};

const RELATED_FAMILIES = new Set([
  "anime:animation",
  "animation:anime",
  "animation:animals",
  "animals:animation",
  "movies:anime",
  "anime:movies",
]);

function clean(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function cleanHandle(value) {
  return String(value || "").toLowerCase().trim().replace(/^@+/, "").replace(/[^a-z0-9._-]+/g, "");
}

function familySet(value) {
  const text = clean(Array.isArray(value) ? value.join(" ") : value);
  const families = new Set();
  if (!text) return families;
  for (const [family, keywords] of Object.entries(NICHE_FAMILIES)) {
    if (keywords.some((keyword) => keyword.length <= 3
      ? (` ${text} `).includes(` ${keyword} `)
      : text.includes(keyword))) families.add(family);
  }
  return families;
}

function sourceText(video = {}) {
  return [
    video.title,
    video.description,
    video.author,
    video.authorHandle,
    video.sourceCollectionTitle,
    ...(Array.isArray(video.sourceCollectionTags) ? video.sourceCollectionTags : []),
  ].filter(Boolean).join(" ");
}

function targetText(settings = {}) {
  return [settings.genreFocus, settings.microNicheGoal, ...(Array.isArray(settings.sourceTags) ? settings.sourceTags : [])].filter(Boolean).join(" ");
}

export function sourceChannelIdentity(video = {}) {
  const author = cleanHandle(video.authorHandle || video.author || "");
  if (author) return author;
  try {
    const url = new URL(String(video.playUrl || video.sourceUrl || video.url || ""));
    const handle = url.pathname.match(/\/@([^/]+)/)?.[1] || "";
    if (handle) return cleanHandle(handle);
  } catch {
    // Keep videos with missing author metadata in one fallback channel.
  }
  return "unknown-source";
}

export function sourceNicheCompatibility(video = {}, settings = {}) {
  const targets = familySet(targetText(settings));
  const sources = familySet(sourceText(video));
  if (!targets.size || !sources.size) return { score: 0, match: "unknown", targetFamilies: [...targets], sourceFamilies: [...sources] };
  for (const target of targets) {
    if (sources.has(target)) return { score: 3, match: "exact", targetFamilies: [...targets], sourceFamilies: [...sources] };
    for (const source of sources) {
      if (RELATED_FAMILIES.has(`${target}:${source}`)) return { score: 2, match: "related", targetFamilies: [...targets], sourceFamilies: [...sources] };
    }
  }
  return { score: -3, match: "mismatch", targetFamilies: [...targets], sourceFamilies: [...sources] };
}

function stableUnit(value) {
  let hash = 2166136261;
  for (const char of String(value || "")) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

function profileValue(profileData = {}) {
  return profileData?.profile || profileData || {};
}

export function sourceChannelNeedsExploration(profileData = {}, settings = {}) {
  if (settings.sourceExplorationEnabled === false) return false;
  const profile = profileValue(profileData);
  const samples = Number(profile.samples || 0);
  const averageViews = samples > 0 ? Number(profile.totalViews || 0) / samples : 0;
  const threshold = Math.max(100, Math.min(Number(settings.sourceUnderperformingViewThreshold) || 1000, 100000));
  return samples < 3 || averageViews < threshold;
}

function historicalSource(profile, channel) {
  return (profile.bestSources || []).find((row) => cleanHandle(row?.label) === channel) || null;
}

export function planSourceChannelCandidates(videos = [], options = {}) {
  const settings = options.settings || {};
  const profile = profileValue(options.profileData);
  const seed = String(options.seed || "automation-source-plan");
  const groups = new Map();
  for (const video of videos) {
    const channel = sourceChannelIdentity(video);
    if (!groups.has(channel)) groups.set(channel, []);
    groups.get(channel).push(video);
  }

  const samples = Number(profile.samples || 0);
  const averageViews = samples > 0 ? Number(profile.totalViews || 0) / samples : 0;
  const underperforming = sourceChannelNeedsExploration(profile, settings);
  const nicheMode = ["balanced", "strict", "off"].includes(String(settings.sourceNicheMode || "")) ? String(settings.sourceNicheMode) : "balanced";
  const maxChannels = Math.max(2, Math.min(Number(settings.sourceExplorationChannels) || 6, 12));
  const rows = [...groups.entries()].map(([channel, channelVideos]) => {
    const niche = nicheMode === "off" ? { score: 0, match: "off" } : sourceNicheCompatibility(channelVideos[0], settings);
    const history = historicalSource(profile, channel);
    const uploads = Number(history?.uploads || 0);
    const views = Number(history?.views || 0);
    const historicalAverage = uploads > 0 ? views / uploads : 0;
    const novelty = uploads === 0 ? 35 : historicalAverage < (Number(settings.sourceUnderperformingViewThreshold) || 1000) ? -20 : 10;
    const random = stableUnit(`${seed}:${channel}`);
    return {
      channel,
      videos: channelVideos,
      niche,
      history,
      score: Number(niche.score || 0) * 100 + novelty + random * 80,
    };
  });

  const eligible = nicheMode === "strict" ? rows.filter((row) => row.niche.match !== "mismatch") : rows;
  const pool = eligible.length ? eligible : rows;
  const allowedChannels = new Set(pool.map((row) => row.channel));
  const allowedVideos = nicheMode === "strict" && eligible.length
    ? videos.filter((video) => allowedChannels.has(sourceChannelIdentity(video)))
    : videos;
  const shouldDiversify = underperforming && pool.length > 1;
  const selected = shouldDiversify
    ? [...pool].sort((a, b) => b.score - a.score).slice(0, maxChannels)
    : pool;

  if (!shouldDiversify) {
    return {
      videos: [...allowedVideos],
      strategy: {
        mode: "exploit",
        reason: groups.size <= 1 ? "single_source_channel" : "channel_performance_is_healthy",
        underperforming,
        averageViews: Math.round(averageViews),
        candidateChannels: groups.size,
        selectedChannels: selected.map((row) => row.channel),
        nicheMode,
      },
    };
  }

  const prioritized = [];
  const maxLength = Math.max(...selected.map((row) => row.videos.length));
  for (let index = 0; index < maxLength; index += 1) {
    for (const row of selected) {
      if (row.videos[index]) prioritized.push(row.videos[index]);
    }
  }
  const selectedVideos = new Set(prioritized);
  prioritized.push(...allowedVideos.filter((video) => !selectedVideos.has(video)));

  return {
    videos: prioritized,
    strategy: {
      mode: "explore",
      reason: samples < 3 ? "insufficient_performance_samples" : "average_views_below_threshold",
      underperforming: true,
      averageViews: Math.round(averageViews),
      candidateChannels: groups.size,
      selectedChannels: selected.map((row) => row.channel),
      nicheMode,
    },
  };
}
