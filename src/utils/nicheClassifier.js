// Sorts a video or channel into the niche library's taxonomy by the words it uses.
//
// Each library entry contributes its seed keywords, search queries and sub-niche name as
// phrases. A phrase matches whole words only ("mars" is not in "Marshall"). Phrases in the
// title count most, then the channel name and tags, then the description; the search that found the video is a
// tiebreaker, never the deciding signal, so a "sleep" search doesn't make every result a
// sleep video. Longer phrases are more specific, so they weigh more.

const FIELD_WEIGHTS = { title: 3, channel: 2, tags: 2, description: 1, query: 0.5 };
const MIN_SCORE = 3;

// YouTube's own category, used when no phrase matches.
const CATEGORY_FALLBACK = [
  [/gaming/i, "Gaming"],
  [/music/i, "Music"],
  [/sports/i, "Sports"],
  [/comedy/i, "Comedy"],
  [/pets|animals/i, "Pets & animals"],
  [/autos|vehicles/i, "Cars"],
  [/travel|events/i, "Travel"],
  [/news|politics/i, "News & politics"],
  [/howto|style/i, "How-to & style"],
  [/science|technology/i, "Science & tech"],
  [/education/i, "Education"],
  [/film|animation/i, "Film & animation"],
  [/entertainment/i, "Entertainment"],
  [/people|blogs/i, "Vlogs & personalities"],
];

const normalize = (text) =>
  ` ${String(text || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()} `;

/** Phrases per library entry, ready to match. Build once per library. */
export function buildNicheIndex(entries = []) {
  return entries
    .filter((entry) => entry && entry.macroNiche && entry.subNiche)
    .map((entry) => {
      const phrases = new Map();
      const add = (value, base) => {
        const phrase = normalize(value).trim();
        if (phrase.length < 3) return;
        const words = phrase.split(" ").length;
        phrases.set(phrase, Math.max(phrases.get(phrase) || 0, base + (words - 1)));
      };
      for (const keyword of entry.seedKeywords || []) add(keyword, 2);
      for (const query of entry.acquisitionQueries || []) add(query, 1.5);
      add(entry.subNiche, 2);
      return { id: entry.id, macroNiche: entry.macroNiche, subNiche: entry.subNiche, phrases: [...phrases] };
    });
}

/**
 * { macroNiche, subNiche, msnId, label, score } for the best match, or a YouTube-category
 * fallback ({ label, fallback: true }), or null when nothing fits.
 * @param {ReturnType<typeof buildNicheIndex>} index
 * @param {{ title?: string, channel?: string, tags?: string | string[], description?: string, query?: string, category?: string }} video
 */
export function classifyNiche(index, video = {}) {
  const fields = {
    title: normalize(video.title),
    // "AniQuickRecaps" -> "ani quick recaps": channel names are often one camel-cased word.
    channel: normalize(String(video.channel || "").replace(/([a-z])([A-Z])/g, "$1 $2")),
    tags: normalize(Array.isArray(video.tags) ? video.tags.join(" ") : video.tags),
    description: normalize(String(video.description || "").slice(0, 600)),
    query: normalize(video.query),
  };
  // Sub-niches compete on their best entry, so a sub-niche with many entries can't win on count alone.
  let best = null;
  const bySub = new Map();
  for (const entry of index) {
    let score = 0;
    let decisive = 0;
    for (const [phrase, weight] of entry.phrases) {
      const needle = ` ${phrase} `;
      for (const [field, fieldWeight] of Object.entries(FIELD_WEIGHTS)) {
        if (!fields[field].includes(needle)) continue;
        score += weight * fieldWeight;
        if (field !== "query") decisive += 1;
      }
    }
    if (!decisive) continue;
    const key = `${entry.macroNiche}::${entry.subNiche}`;
    if (!bySub.has(key) || bySub.get(key).score < score) bySub.set(key, { entry, score });
  }
  for (const candidate of bySub.values()) if (!best || candidate.score > best.score) best = candidate;
  if (best && best.score >= MIN_SCORE)
    return { macroNiche: best.entry.macroNiche, subNiche: best.entry.subNiche, msnId: best.entry.id, label: best.entry.subNiche, score: Math.round(best.score * 10) / 10 };
  const category = String(video.category || "");
  const fallback = CATEGORY_FALLBACK.find(([pattern]) => pattern.test(category));
  return fallback ? { label: fallback[1], fallback: true, score: 0 } : null;
}
