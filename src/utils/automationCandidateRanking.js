const STOP_WORDS = new Set([
  "about", "after", "again", "against", "before", "being", "could", "from", "have", "into", "more", "most",
  "other", "over", "recap", "short", "shorts", "that", "their", "them", "then", "there", "these", "they", "this",
  "video", "viral", "what", "when", "where", "which", "while", "with", "would", "your", "youtube", "tiktok",
]);

function cleanHandle(value) {
  return String(value || "").toLowerCase().trim().replace(/^@+/, "").replace(/[^a-z0-9._-]+/g, "");
}

function tokens(value) {
  return [...new Set(String(value || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/)
    .map((word) => word.replace(/s$/i, "")).filter((word) => word.length >= 3 && !STOP_WORDS.has(word)))];
}

function textMatch(label, text) {
  const wanted = tokens(label);
  if (!wanted.length) return 0;
  const available = new Set(tokens(text));
  const hits = wanted.filter((word) => available.has(word)).length;
  if (!hits) return 0;
  if (wanted.length === 1) return hits === 1 ? 1 : 0;
  return hits / wanted.length;
}

function profileRows(profile, key) {
  return (Array.isArray(profile?.[key]) ? profile[key] : []).filter((row) => row && Number(row.uploads || 0) > 0);
}

function rowStrength(row, base, cap) {
  const uploads = Number(row?.uploads || 0);
  const averageViews = uploads > 0 ? Number(row?.views || 0) / uploads : 0;
  return base + Math.min(cap, Math.log10(Math.max(averageViews, 1)) * 11) + Math.min(12, uploads * 2);
}

function createdAtMs(video) {
  const raw = video?.createdAt ?? video?.createTime ?? video?.timestamp ?? video?.uploadDate ?? video?.publishedAt ?? "";
  if (typeof raw === "number") return raw > 100000000000 ? raw : raw * 1000;
  if (/^\d+$/.test(String(raw || ""))) {
    const number = Number(raw);
    return number > 100000000000 ? number : number * 1000;
  }
  const parsed = Date.parse(String(raw || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function sourceViews(video) {
  return Number(video?.stats?.playCount || video?.stats?.viewCount || video?.playCount || video?.viewCount || 0) || 0;
}

export function scoreAutomationCandidate(video = {}, options = {}) {
  const profile = options.profile?.profile || options.profile || {};
  const titleText = [video.title, video.description, video.sourceCollectionTitle, ...(video.sourceCollectionTags || [])].filter(Boolean).join(" ");
  const author = cleanHandle(video.authorHandle || video.author || "");
  const source = profileRows(profile, "bestSources").find((row) => cleanHandle(row.label) === author);
  const nicheMatches = profileRows(profile, "bestMicroNiches").map((row) => ({ row, match: textMatch(row.label, titleText) }))
    .filter((entry) => entry.match >= (tokens(entry.row.label).length <= 1 ? 1 : 0.5))
    .sort((a, b) => b.match - a.match || Number(b.row.views || 0) - Number(a.row.views || 0));
  let score = 0;
  const reasons = [];
  if (source) {
    const value = rowStrength(source, 75, 48);
    score += value;
    reasons.push({ type: "channel_history", score: value, label: source.label });
  }
  if (nicheMatches[0]) {
    const value = rowStrength(nicheMatches[0].row, 48, 38) * nicheMatches[0].match;
    score += value;
    reasons.push({ type: "channel_niche_history", score: value, label: nicheMatches[0].row.label });
  }
  const now = Number(options.now || Date.now());
  const velocityMatches = (Array.isArray(options.youtubeSignals) ? options.youtubeSignals : []).map((signal) => {
    const published = Date.parse(String(signal.publishedAt || ""));
    return { signal, ageDays: Number.isFinite(published) ? (now - published) / 86400000 : Infinity, match: textMatch(`${signal.title || ""} ${signal.niche || ""}`, titleText) };
  }).filter((entry) => entry.ageDays >= 0 && entry.ageDays <= 30 && entry.match >= 0.34)
    .sort((a, b) => Number(b.signal.velocity || 0) - Number(a.signal.velocity || 0));
  if (velocityMatches.length) {
    const best = velocityMatches[0];
    const recency = best.ageDays <= 7 ? 1 : 0.55;
    const velocity = Number(best.signal.velocity || best.signal.viewsPerHour || 0);
    const corroboration = Math.min(12, new Set(velocityMatches.map((entry) => entry.signal.channelId || entry.signal.channelTitle || entry.signal.title)).size * 4);
    const value = Math.min(48, Math.log10(Math.max(velocity, 1) + 1) * 15) * best.match * recency + corroboration;
    score += value;
    reasons.push({ type: "youtube_velocity", score: value, label: best.signal.title || best.signal.niche || "recent niche signal" });
  }
  const ageDays = createdAtMs(video) ? Math.max(0, (now - createdAtMs(video)) / 86400000) : Infinity;
  const freshness = ageDays <= 7 ? 18 : ageDays <= 30 ? 10 : ageDays <= 90 ? 4 : 0;
  score += freshness;
  if (freshness) reasons.push({ type: "freshness", score: freshness, label: `${Math.round(ageDays)}d` });
  if (options.hookMatch) score += 14;
  if (options.durationMatch) score += 9;
  if (options.formatMatch) score += 7;
  score += Number(options.decisionAdjustment || 0);
  const platformTieBreaker = Math.min(5, Math.log10(Math.max(sourceViews(video), 1)) * 0.75);
  return { score: Math.round(score * 100) / 100, reasons, platformTieBreaker };
}

export function rankAutomationCandidatesByEvidence(videos = [], options = {}) {
  return [...videos].map((video, index) => ({ video, index, result: scoreAutomationCandidate(video, options.context ? options.context(video) : options) }))
    .sort((a, b) => {
      const scoreDelta = b.result.score - a.result.score;
      if (Math.abs(scoreDelta) >= 1) return scoreDelta;
      const mode = String(options.sourcePriority || "views");
      if (mode === "newest") {
        const delta = createdAtMs(b.video) - createdAtMs(a.video);
        if (delta) return delta;
      }
      if (mode === "oldest") {
        const delta = createdAtMs(a.video) - createdAtMs(b.video);
        if (delta) return delta;
      }
      return sourceViews(b.video) - sourceViews(a.video) || a.index - b.index;
    }).map((entry) => entry.video);
}
