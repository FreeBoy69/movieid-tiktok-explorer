function cleanGenre(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function cleanGenres(values) {
  const unique = new Set();
  (Array.isArray(values) ? values : []).forEach((value) => {
    const genre = cleanGenre(value);
    if (genre) unique.add(genre);
  });
  return [...unique];
}

function videoKey(video = {}) {
  return String(video.id || video.playUrl || video.url || "").trim();
}

function movieResultVerified(result = {}) {
  return result.manualCorrection === true || result.sourceVerification?.verified === true;
}

export function officialGenresFromMovieResult(result = {}) {
  return cleanGenres([
    ...(Array.isArray(result?.tmdb?.genres) ? result.tmdb.genres : []),
    ...(Array.isArray(result?.mal?.genres) ? result.mal.genres : []),
  ]);
}

export function genreMembershipFromMovieResult(video = {}, result = {}) {
  const genres = officialGenresFromMovieResult(result);
  const source = result?.mal?.genres?.length ? "mal" : result?.tmdb?.genres?.length ? "tmdb" : "";
  const verified = movieResultVerified(result) && genres.length > 0;

  return {
    videoKey: videoKey(video),
    video,
    title: String(result.title || result?.mal?.englishTitle || result?.mal?.title || result?.tmdb?.title || "").trim(),
    year: String(result.year || result?.tmdb?.releaseDate || result?.mal?.startDate || "").match(/\d{4}/)?.[0] || "",
    posterUrl: String(result.posterUrl || result?.mal?.imageUrl || "").trim(),
    genres,
    source,
    sourceTitleId: result?.mal?.id ? String(result.mal.id) : result?.tmdb?.id ? String(result.tmdb.id) : "",
    confidence: Number(result.confidence || 0),
    status: verified ? "verified" : "needs_review",
    reason: verified ? "official_genres" : genres.length ? "title_not_verified" : "official_genres_missing",
    scannedAt: Date.now(),
  };
}

export function genreMembershipFromStoryResult(video = {}, result = {}) {
  const genres = cleanGenres(result.genres);
  const confidence = Number(result.confidence || 0);
  const storySummary = String(result.summary || result.storySummary || "").replace(/\s+/g, " ").trim();
  const storySignals = cleanGenres(result.storySignals || result.signals);
  const inferred = genres.length > 0;

  return {
    videoKey: videoKey(video),
    video,
    title: String(result.title || "").trim(),
    genres,
    source: "story_ai",
    confidence,
    status: inferred ? "inferred" : "needs_review",
    reason: inferred ? "transcript_story_genres" : "story_genres_missing",
    storySummary,
    storySignals,
    transcriptExcerpt: String(result.transcriptExcerpt || "").replace(/\s+/g, " ").trim(),
    scannedAt: Date.now(),
  };
}

export function normalizeSavedPlaylistGenreMembership(membership = {}) {
  const genres = cleanGenres(membership.genres);
  const status = membership.status === "verified" && genres.length
    ? "verified"
    : membership.status === "inferred" && genres.length
      ? "inferred"
      : "needs_review";
  return {
    ...membership,
    videoKey: videoKey({ id: membership.videoKey }) || videoKey(membership.video),
    video: membership.video || {},
    title: String(membership.title || "").trim(),
    year: String(membership.year || "").match(/\d{4}/)?.[0] || "",
    genres,
    source: String(membership.source || "").trim(),
    sourceTitleId: String(membership.sourceTitleId || "").trim(),
    confidence: Number(membership.confidence || 0),
    status,
    reason: String(membership.reason || (status === "verified" ? "official_genres" : "needs_review")).trim(),
    storySummary: String(membership.storySummary || "").replace(/\s+/g, " ").trim(),
    storySignals: cleanGenres(membership.storySignals),
    transcriptExcerpt: String(membership.transcriptExcerpt || "").replace(/\s+/g, " ").trim(),
    scannedAt: Number(membership.scannedAt || 0),
  };
}

export function groupSavedPlaylistGenreMemberships(memberships = []) {
  const grouped = new Map();
  const add = (genre, membership) => {
    const existing = grouped.get(genre) || [];
    if (!existing.some((item) => item.videoKey === membership.videoKey)) existing.push(membership);
    grouped.set(genre, existing);
  };

  memberships
    .map(normalizeSavedPlaylistGenreMembership)
    .filter((membership) => membership.videoKey)
    .forEach((membership) => {
      if ((membership.status !== "verified" && membership.status !== "inferred") || !membership.genres.length) {
        add("Needs Review", membership);
        return;
      }
      membership.genres.forEach((genre) => add(genre, membership));
    });

  return [...grouped.entries()]
    .map(([genre, items]) => ({ genre, count: items.length, items }))
    .sort((a, b) => {
      if (a.genre === "Needs Review") return 1;
      if (b.genre === "Needs Review") return -1;
      return a.genre.localeCompare(b.genre);
    });
}

export function mergeSavedPlaylistGenreMemberships(previous = [], updates = []) {
  const merged = new Map();
  [...previous, ...updates]
    .map(normalizeSavedPlaylistGenreMembership)
    .filter((membership) => membership.videoKey)
    .forEach((membership) => merged.set(membership.videoKey, membership));
  return [...merged.values()];
}

export function pendingSavedPlaylistGenreVideos(videos = [], memberships = [], batchSize = 8) {
  const scannedKeys = new Set(
    memberships
      .map(normalizeSavedPlaylistGenreMembership)
      .map((membership) => membership.videoKey)
      .filter(Boolean),
  );
  const max = Math.min(Math.max(Number(batchSize) || 8, 1), 50);
  return (Array.isArray(videos) ? videos : [])
    .filter((video) => {
      const key = videoKey(video);
      return key && !scannedKeys.has(key);
    })
    .slice(0, max);
}

export function savedPlaylistGenreScanSummary(videos = [], memberships = []) {
  const playlistKeys = new Set((Array.isArray(videos) ? videos : []).map(videoKey).filter(Boolean));
  const scanned = memberships
    .map(normalizeSavedPlaylistGenreMembership)
    .filter((membership) => membership.videoKey && playlistKeys.has(membership.videoKey));
  const verified = scanned.filter((membership) => membership.status === "verified").length;
  const inferred = scanned.filter((membership) => membership.status === "inferred").length;
  const needsReview = scanned.length - verified - inferred;
  return {
    total: playlistKeys.size,
    scanned: scanned.length,
    verified,
    inferred,
    needsReview,
    pending: Math.max(0, playlistKeys.size - scanned.length),
  };
}
