// What a recap knows about its film, for the motion graphics: title, year, genres, runtime, rating,
// tagline, poster, and the main characters' names. TMDB (TMDB_API_KEY) is the source; IMDb's public
// suggestion endpoint fills in a poster when TMDB has none. IMDb ratings need a paid API, so the rating
// shown is TMDB's.

const IMG = "https://image.tmdb.org/t/p";

const tmdbKey = (env) => String(env.TMDB_API_KEY || "").replace(/^["']|["']$/g, "").trim();
const tmdbBearer = (env) => String(env.TMDB_READ_ACCESS_TOKEN || env.TMDB_ACCESS_TOKEN || "").replace(/^["']|["']$/g, "").trim();

/** Full movie info by TMDB id, or null. */
export async function movieInfo(tmdbId, { fetch = globalThis.fetch, env = process.env, signal } = {}) {
  const key = tmdbKey(env);
  const bearer = tmdbBearer(env);
  if (!tmdbId || (!key && !bearer)) return null;
  const url = new URL(`https://api.themoviedb.org/3/movie/${tmdbId}`);
  url.searchParams.set("append_to_response", "credits,external_ids");
  if (key) url.searchParams.set("api_key", key);
  const response = await fetch(url, { headers: bearer ? { Authorization: `Bearer ${bearer}` } : {}, signal: signal || AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`TMDB ${response.status}`);
  const d = await response.json();
  const imdbId = d.imdb_id || d.external_ids?.imdb_id || null;
  let poster = d.poster_path ? `${IMG}/w500${d.poster_path}` : "";
  if (!poster && imdbId) poster = await imdbPoster(imdbId, { fetch, signal }).catch(() => "");
  return {
    tmdbId: d.id,
    imdbId,
    title: d.title || "",
    year: Number(String(d.release_date || "").slice(0, 4)) || null,
    tagline: String(d.tagline || "").slice(0, 120),
    genres: (d.genres || []).map((g) => g.name).slice(0, 3),
    runtime: Number(d.runtime) || null,
    rating: d.vote_count >= 20 ? Math.round(Number(d.vote_average) * 10) / 10 : null,
    poster,
    backdrop: d.backdrop_path ? `${IMG}/w1280${d.backdrop_path}` : "",
    // Characters in billing order: "Peter Parker / Spider-Man" becomes a name and an alias.
    characters: (d.credits?.cast || [])
      .filter((c) => c.character && !/^(himself|herself|themselves|self|voice)\b/i.test(c.character))
      .slice(0, 14)
      .map((c) => {
        const [name, ...alias] = String(c.character).replace(/\s*\((voice|uncredited)\)/gi, "").split(/\s*\/\s*/);
        return { name: name.trim(), alias: alias.join(" / ").trim(), order: c.order, actor: String(c.name || ""), photo: c.profile_path ? `${IMG}/w185${c.profile_path}` : "" };
      })
      .filter((c) => c.name.length > 1),
  };
}

/** A poster from IMDb's public suggestion endpoint (no key), or "". */
export async function imdbPoster(imdbId, { fetch = globalThis.fetch, signal } = {}) {
  const response = await fetch(`https://v2.sg.media-imdb.com/suggestion/t/${imdbId}.json`, { signal: signal || AbortSignal.timeout(10000) });
  if (!response.ok) return "";
  const data = await response.json();
  const hit = (data.d || []).find((item) => item.id === imdbId);
  return hit?.i?.imageUrl || "";
}
