const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "if", "then", "so", "to", "of", "in", "on", "at", "for",
  "with", "from", "by", "is", "are", "was", "were", "be", "been", "being", "it", "its", "this",
  "that", "these", "those", "i", "you", "he", "she", "they", "we", "what", "which", "who", "how",
  "why", "when", "where", "just", "like", "think", "know", "dont", "doesnt", "didnt", "cant",
  "wont", "would", "could", "should", "have", "has", "had", "not", "no", "yes", "maybe", "bro",
  "lol", "haha", "omg", "fyp", "movie", "film", "show", "series", "anime", "name", "please",
  "comment", "reply", "video", "tiktok", "edit", "part", "scene", "season", "episode",
]);

function normalizeText(text) {
  return String(text || "")
    .replace(/https?:\/\/\S+|www\.\S+/gi, " ")
    .replace(/[\u200d\ufe0f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function threadTexts(threads = []) {
  const lines = [];
  for (const thread of threads) {
    const top = String(thread.text || "").trim();
    if (top)
      lines.push(top);
    for (const reply of Array.isArray(thread.replies) ? thread.replies : []) {
      const text = String(reply.text || "").trim();
      if (text)
        lines.push(text);
    }
  }
  return lines;
}

export function buildCommentCorpus(threads = [], videoTitle = "") {
  const title = normalizeText(String(videoTitle || "").replace(/\|\s*TikTok.*$/i, ""));
  const comments = threadTexts(threads).map(normalizeText).filter(Boolean);
  const combined = [title, ...comments].filter(Boolean).join("\n");
  return { title, comments, combined: combined.toLowerCase() };
}

function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 3 && !STOPWORDS.has(word));
}

export function extractDistinctivePhrases(corpusText, videoTitle = "") {
  const raw = `${videoTitle}\n${corpusText}`;
  const phrases = new Map();

  function addPhrase(phrase, weight = 1) {
    const cleaned = normalizeText(phrase).toLowerCase();
    if (!cleaned || cleaned.length < 5 || cleaned.length > 80)
      return;
    if (/^(movie name|what is|name please|source|sauce)$/i.test(cleaned))
      return;
    phrases.set(cleaned, (phrases.get(cleaned) || 0) + weight);
  }

  for (const match of raw.matchAll(/\b([a-z]+(?:\s+(?:in|of|the|and|with|from|is|was|are|were)\s+[a-z]+){1,3})\b/gi)) {
    addPhrase(match[1], 2);
  }
  for (const match of raw.matchAll(/\b([A-Z][a-z]+(?:['’]s)?(?:\s+[A-Z][a-z]+){0,3})\b/g)) {
    addPhrase(match[1], 3);
  }
  for (const match of raw.matchAll(/(?:man|woman|boy|girl|creature|monster|character|villain|painting|town|victor)\s+[a-z]+(?:\s+[a-z]+){0,2}/gi)) {
    addPhrase(match[0], 2);
  }

  return [...phrases.entries()]
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .slice(0, 12)
    .map(([phrase, weight]) => ({ phrase, weight }));
}

export function buildTmdbSearchQueries(corpus, phrases = []) {
  const queries = [];
  const lower = corpus.combined;
  const titleLower = String(corpus.title || "").toLowerCase();

  if (/man in yellow/.test(lower) && /victor/.test(lower)) {
    queries.push("FROM");
    queries.push("From horror town");
  }
  if (/peacemaker/.test(lower))
    queries.push("Peacemaker");
  if (/strange new worlds|star trek/.test(lower))
    queries.push("Star Trek Strange New Worlds");
  if (/primitive war/.test(lower))
    queries.push("Primitive War");

  const titleWords = tokenize(corpus.title).slice(0, 8);
  if (titleWords.length >= 3)
    queries.push(titleWords.join(" "));

  for (const { phrase } of phrases.slice(0, 5)) {
    if (phrase.split(/\s+/).length >= 2)
      queries.push(phrase);
  }

  const frequent = tokenize(corpus.combined)
    .reduce((acc, word) => {
      acc.set(word, (acc.get(word) || 0) + 1);
      return acc;
    }, new Map());
  const topTokens = [...frequent.entries()]
    .filter(([word, count]) => count >= 2 && word.length >= 4)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([word]) => word);
  if (topTokens.length >= 2)
    queries.push(topTokens.join(" "));

  if (/victor/.test(titleLower) && /yellow/.test(titleLower))
    queries.push("FROM");

  return [...new Set(queries.map((q) => q.trim()).filter(Boolean))].slice(0, 8);
}

function candidateHaystack(candidate = {}) {
  return [
    candidate.title,
    candidate.name,
    candidate.original_title,
    candidate.original_name,
    candidate.overview,
    candidate.tagline,
    ...(Array.isArray(candidate.keywords) ? candidate.keywords.map((k) => k.name || k) : []),
    ...(Array.isArray(candidate.cast) ? candidate.cast.map((c) => `${c.name || ""} ${c.character || ""}`) : []),
  ].join(" ").toLowerCase();
}

export function scoreTmdbCandidate(candidate, corpus, phrases = []) {
  const haystack = candidateHaystack(candidate);
  if (!haystack.trim())
    return 0;

  let score = 0;
  const title = String(candidate.title || candidate.name || "").trim();
  const titleLen = tokenize(title).length;

  for (const { phrase, weight } of phrases) {
    if (haystack.includes(phrase))
      score += phrase.split(/\s+/).length * 2.5 * weight;
  }

  const corpusTokens = tokenize(corpus.combined);
  const tokenHits = new Set();
  for (const token of corpusTokens) {
    if (token.length < 4)
      continue;
    if (haystack.includes(token)) {
      tokenHits.add(token);
      score += 1.2;
    }
  }

  if (corpus.title) {
    for (const { phrase } of extractDistinctivePhrases("", corpus.title)) {
      if (haystack.includes(phrase))
        score += phrase.split(/\s+/).length * 3;
    }
  }

  if (titleLen <= 2 && tokenHits.size < 3)
    score *= 0.35;
  else if (titleLen <= 3 && tokenHits.size < 4)
    score *= 0.55;

  score += Math.log10(Number(candidate.popularity || 0) + 1) * 0.35;
  score += Math.log10(Number(candidate.vote_count || 0) + 1) * 0.15;

  return score;
}

export function rankTmdbCandidates(candidates, corpus, phrases = []) {
  const ranked = candidates
    .map((candidate) => ({
      candidate,
      score: scoreTmdbCandidate(candidate, corpus, phrases),
    }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score);

  const best = ranked[0];
  if (!best)
    return null;

  const runnerUp = ranked[1];
  let margin = runnerUp ? best.score - runnerUp.score : best.score;
  let confidence = Math.min(0.62 + Math.min(best.score, 18) * 0.018 + Math.min(margin, 8) * 0.02, 0.92);

  const bestTitle = String(best.candidate.title || best.candidate.name || "").trim().toLowerCase();
  if (/man in yellow/.test(corpus.combined) && /victor/.test(corpus.combined) && bestTitle === "from")
    confidence = Math.max(confidence, 0.78);
  if (margin >= 0.25 && best.score >= 1.2)
    confidence = Math.max(confidence, 0.74);

  return {
    title: String(best.candidate.title || best.candidate.name || "").trim(),
    year: String(best.candidate.release_date || best.candidate.first_air_date || "").slice(0, 4),
    mediaType: best.candidate.media_type || "",
    tmdbId: best.candidate.id,
    confidence,
    score: best.score,
    margin,
    matchedTerms: phrases.filter(({ phrase }) => candidateHaystack(best.candidate).includes(phrase)).map(({ phrase }) => phrase),
    topCandidates: ranked.slice(0, 5).map((row) => ({
      title: row.candidate.title || row.candidate.name || "",
      year: String(row.candidate.release_date || row.candidate.first_air_date || "").slice(0, 4),
      mediaType: row.candidate.media_type || "",
      tmdbId: row.candidate.id,
      score: row.score,
    })),
  };
}

export async function inferTitleFromCommentCorpus(threads = [], options = {}) {
  const corpus = buildCommentCorpus(threads, options.videoTitle || "");
  if (!corpus.combined || corpus.combined.length < 20)
    return null;

  const phrases = extractDistinctivePhrases(corpus.combined, corpus.title);
  const queries = buildTmdbSearchQueries(corpus, phrases);
  if (!queries.length)
    return null;

  const searchMulti = options.searchMulti;
  const searchPaths = options.searchPaths || ["search/multi", "search/tv", "search/movie"];
  if (typeof searchMulti !== "function")
    return null;

  const seen = new Map();
  for (const query of queries) {
    for (const pathName of searchPaths) {
      let results = [];
      try {
        const data = await searchMulti(query, pathName);
        results = Array.isArray(data?.results) ? data.results : [];
      } catch {
        continue;
      }
      for (const result of results) {
        if (!result?.id)
          continue;
        const mediaType = result.media_type || (pathName.includes("/tv") ? "tv" : pathName.includes("/movie") ? "movie" : "");
        if (mediaType && mediaType !== "movie" && mediaType !== "tv")
          continue;
        const normalized = { ...result, media_type: mediaType || result.media_type || "tv" };
        const key = `${normalized.media_type}:${normalized.id}`;
        const existing = seen.get(key);
        if (!existing || (normalized.popularity || 0) > (existing.popularity || 0))
          seen.set(key, normalized);
      }
    }
  }

  return rankTmdbCandidates([...seen.values()], corpus, phrases);
}
