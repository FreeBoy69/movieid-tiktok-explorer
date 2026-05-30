function compactString(value, max = 2200) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1).trim()}...` : text;
}

export function databaseSummaryCandidate(result = {}) {
  const mal = result.mal || {};
  const malSummary = compactString(mal.synopsis);
  if (mal.id && malSummary) {
    return {
      provider: "mal",
      id: String(mal.id),
      title: String(mal.englishTitle || result.title || mal.title || "").trim(),
      originalTitle: String(mal.title || mal.originalTitle || "").trim(),
      mediaType: String(mal.type || result.mediaType || "").trim(),
      year: String(mal.startDate || result.year || "").match(/\d{4}/)?.[0] || "",
      summary: malSummary,
      genres: Array.isArray(mal.genres) ? mal.genres.slice(0, 8) : [],
    };
  }

  const tmdb = result.tmdb || {};
  const tmdbSummary = compactString(tmdb.overview);
  if (tmdb.id && tmdbSummary) {
    return {
      provider: "tmdb",
      id: String(tmdb.id),
      title: String(result.title || tmdb.title || "").trim(),
      originalTitle: String(tmdb.originalTitle || "").trim(),
      mediaType: String(tmdb.mediaType || result.mediaType || "").trim(),
      year: String(tmdb.releaseDate || result.year || "").match(/\d{4}/)?.[0] || "",
      summary: tmdbSummary,
      genres: Array.isArray(tmdb.genres) ? tmdb.genres.slice(0, 8) : [],
    };
  }
  return null;
}

export function databaseSummaryCandidates(results = []) {
  const candidates = [];
  const seen = new Set();
  for (const result of Array.isArray(results) ? results : []) {
    const candidate = databaseSummaryCandidate(result);
    const key = candidate ? `${candidate.provider}:${candidate.id}` : "";
    if (!candidate || seen.has(key))
      continue;
    seen.add(key);
    candidates.push(candidate);
  }
  return candidates;
}

export function movieIdResultMayBeCached(result = {}) {
  return result.manualCorrection === true || result.sourceVerification?.verified !== false;
}

export function capUnverifiedMovieIdResult(result = {}, status = "unverified", details = {}) {
  return {
    ...result,
    confidence: Math.min(Number(result.confidence || 0), 0.79),
    sourceVerification: {
      verified: false,
      status,
      ...details,
    },
  };
}

export function verifiedMovieIdResult(result = {}, candidate = {}, verdict = {}) {
  const confidence = Number(verdict.confidence || result.confidence || 0);
  return {
    ...result,
    confidence: Math.min(Math.max(confidence, 0), 1),
    sourceVerification: {
      verified: true,
      status: "database_summary_verified",
      provider: String(candidate.provider || ""),
      databaseId: String(candidate.id || ""),
      databaseTitle: String(candidate.title || ""),
      reason: compactString(verdict.reason, 800),
      confidence: Math.min(Math.max(confidence, 0), 1),
    },
  };
}
