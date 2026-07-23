const RADAR_STOP_WORDS = new Set([
  "a", "an", "and", "are", "best", "channel", "channels", "content", "discover", "find", "for", "from",
  "in", "latest", "new", "of", "on", "recent", "the", "to", "top", "trending", "video", "videos",
  "viral", "with", "youtube",
]);

function cleanRadarText(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/&amp;/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function youtubeRadarQueryTokens(value = "") {
  return Array.from(new Set(cleanRadarText(value)
    .split(/\s+/)
    .filter((token) => token.length >= 2 && !RADAR_STOP_WORDS.has(token))));
}

export function buildYouTubeRadarSearchQueries(query, options = {}) {
  const clean = String(query || "").replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const duration = String(options.duration || "any");
  const limit = Math.min(Math.max(Number(options.limit) || 4, 1), 8);
  const tokens = youtubeRadarQueryTokens(clean);
  const core = tokens.slice(0, 6).join(" ") || clean;
  const text = cleanRadarText(clean);
  const variants = [clean];

  if (/(anime|manga|manhwa|manhua|donghua|webtoon|isekai|shonen)/.test(text)) {
    variants.push(`${core} recap`, `${core} explained`, `${core} story`);
  } else if (/(movie|film|cinema|ending|recap)/.test(text)) {
    variants.push(`${core} recap`, `${core} explained`, `${core} ending`);
  } else if (/(animation|animated|cartoon|moral|fruit story)/.test(text)) {
    variants.push(`${core} animated story`, `${core} animation`, `${core} story`);
  } else if (/(geography|country|map|border|island|continent)/.test(text)) {
    variants.push(`${core} facts`, `${core} explained`, `${core} documentary`);
  } else {
    variants.push(`${core} explained`, `${core} documentary`);
  }
  if (duration === "short" || /\bshorts?\b/.test(text)) variants.push(`${core} shorts`);

  return Array.from(new Set(variants
    .map((value) => value.replace(/\s+/g, " ").trim())
    .filter((value) => value.length >= 3)))
    .slice(0, limit);
}

export function youtubeRadarRelevanceScore(item = {}, query = "") {
  const tokens = youtubeRadarQueryTokens(query);
  if (!tokens.length) return 55;
  const title = cleanRadarText(item.title);
  const description = cleanRadarText(item.description);
  const tags = cleanRadarText(Array.isArray(item.tags) ? item.tags.join(" ") : item.tags);
  const channel = cleanRadarText(item.channelTitle);
  const exact = cleanRadarText(query);
  const weightedHits = tokens.reduce((score, token) => {
    if (title.includes(token)) return score + 1;
    if (tags.includes(token)) return score + 0.7;
    if (description.includes(token)) return score + 0.45;
    if (channel.includes(token)) return score + 0.25;
    return score;
  }, 0);
  const tokenScore = Math.min(100, (weightedHits / tokens.length) * 100);
  const exactBoost = exact.length >= 6 && `${title} ${description} ${tags}`.includes(exact) ? 22 : 0;
  return Math.round(Math.min(100, tokenScore + exactBoost));
}

export function calculateYouTubeRadarScores(input = {}) {
  const views = Math.max(0, Number(input.viewCount || 0));
  const subscribers = Math.max(0, Number(input.subscriberCount || 0));
  const viewsPerHour = Math.max(0, Number(input.viewsPerHour || 0));
  const likes = Math.max(0, Number(input.likeCount || 0));
  const comments = Math.max(0, Number(input.commentCount || 0));
  const ageHours = Math.max(1, Number(input.ageHours || 1));
  const relevanceScore = Math.max(0, Math.min(100, Number(input.relevanceScore || 0)));
  const facelessScore = Math.max(0, Math.min(100, Number(input.facelessScore || 0)));
  const velocityScore = Math.min(100, Math.log10(viewsPerHour + 1) * 27);
  const channelLiftScore = subscribers > 0
    ? Math.min(100, (views / subscribers) * 35)
    : Math.min(78, velocityScore);
  const outlierScore = Math.round(channelLiftScore * 0.55 + velocityScore * 0.45);
  const engagementRate = views > 0 ? ((likes + comments * 2) / views) * 100 : 0;
  const engagementScore = Math.min(100, engagementRate * 15);
  const freshnessScore = Math.max(0, 100 - (ageHours / (24 * 30)) * 100);
  const opportunityScore = Math.round(Math.min(100,
    outlierScore * 0.42
    + relevanceScore * 0.27
    + facelessScore * 0.11
    + engagementScore * 0.08
    + freshnessScore * 0.12
  ));
  const discoveryScore = Math.round(Math.min(100,
    opportunityScore * 0.52
    + velocityScore * 0.24
    + freshnessScore * 0.14
    + relevanceScore * 0.1
  ));
  return {
    channelLiftScore: Math.round(channelLiftScore),
    discoveryScore,
    engagementRate: Math.round(engagementRate * 100) / 100,
    freshnessScore: Math.round(freshnessScore),
    opportunityScore,
    outlierScore,
    relevanceScore,
    velocityScore: Math.round(velocityScore),
  };
}

export function rankYouTubeRadarVideos(videos = []) {
  return [...videos].sort((a, b) =>
    Number(b.discoveryScore || 0) - Number(a.discoveryScore || 0)
    || Number(b.viewsPerHour || 0) - Number(a.viewsPerHour || 0)
    || Number(b.viewCount || 0) - Number(a.viewCount || 0));
}
