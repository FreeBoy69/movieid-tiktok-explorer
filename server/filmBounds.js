// Where a film's story runs: after its opening titles and before its end credits, so a recap never cuts
// a studio logo, an opening title, or a credit roll. Sources, most reliable first:
//   1. Online segment databases, keyed by the film's TMDB / IMDb id (found by title and year on TMDB):
//      TheIntroDB (api.theintrodb.org, intro and credits by TMDB id) and IntroDB (api.introdb.app, intro
//      and outro by IMDb id). Both are free to read.
//   2. The file's own chapter marks, when a chapter is named for the credits or the opening.
//   3. What the frames show: the vision pass tags title cards, credits text, and black frames.
//   4. Fixed guards: the first 1% (up to 90 s) and the last 7% (up to 8 min).
// Every source is sanity-checked against the file: an opening ends in the first 15%, credits start after
// 70%. Releases differ by a few seconds (studio logos), so an online credits time that lands past the end
// of this file is re-anchored to its end.

const clampNumber = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
export const DEFAULT_BOUNDS = (duration) => ({ start: Math.min(90, duration * 0.01), end: duration - Math.min(480, duration * 0.07) });

/** Title and year from a release file name ("Spider-Man.Brand.New.Day.2026.REPACK.1080p.AMZN.WEB-DL..."). */
export function parseReleaseName(raw) {
  let name = String(raw || "").trim();
  if (!name) return null;
  try {
    // A signed download link names the file in its content-disposition parameter.
    const url = new URL(name);
    const disposition = url.searchParams.get("response-content-disposition") || "";
    const quoted = disposition.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
    name = quoted ? decodeURIComponent(quoted[1]) : decodeURIComponent(url.pathname.split("/").pop() || "");
  } catch {}
  // A file host's own name ("mega.nz", "pixeldrain.com") or a share link's id ("YE0R3TLK") names no film.
  if (/^(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,6}$/i.test(name) && !/\.(mkv|mp4|mov|webm|m4v|avi)$/i.test(name)) return null;
  if (/^[A-Za-z0-9_-]{5,}$/.test(name) && /\d/.test(name) && /[A-Z]/.test(name) && /[a-z]|^[A-Z0-9_-]+$/.test(name) && !/[a-z]{3,}[\s._-]/i.test(name)) return null;
  name = name.replace(/\.[a-z0-9]{2,4}$/i, "").replace(/[._]+/g, " ").replace(/\s+/g, " ").trim();
  const year = name.match(/(?:^|[\s([])((?:19|20)\d{2})(?=$|[\s)\]])/);
  let title = year ? name.slice(0, year.index).trim() : name;
  title = title.replace(/\b(1080p|2160p|720p|480p|4k|uhd|hdr|web[- ]?dl|webrip|bluray|brrip|repack|proper|x26[45]|h ?26[45]|hevc|av1|aac|ddp?\d?(?: \d)?|multi|dual audio)\b.*$/i, "").replace(/[\s([-]+$/, "").trim();
  if (!title || title.length < 2) return null;
  return { title, year: year ? Number(year[1]) : null };
}

/** TMDB movie for a title and year: {tmdbId, imdbId, title, year, runtime}, or null. */
export async function lookupFilm({ title, year }, { fetch = globalThis.fetch, env = process.env, signal, duration = 0 } = {}) {
  const key = String(env.TMDB_API_KEY || "").replace(/^["']|["']$/g, "").trim();
  const bearer = String(env.TMDB_READ_ACCESS_TOKEN || env.TMDB_ACCESS_TOKEN || "").replace(/^["']|["']$/g, "").trim();
  if (!title || (!key && !bearer)) return null;
  const get = async (pathName, params = {}) => {
    const url = new URL(`https://api.themoviedb.org/3/${pathName}`);
    for (const [k, v] of Object.entries(params)) if (v) url.searchParams.set(k, String(v));
    if (key) url.searchParams.set("api_key", key);
    const response = await fetch(url, { headers: bearer ? { Authorization: `Bearer ${bearer}` } : {}, signal: signal || AbortSignal.timeout(12000) });
    if (!response.ok) throw new Error(`TMDB ${response.status}`);
    return response.json();
  };
  let results = (await get("search/movie", { query: title, year: year || "" })).results || [];
  if (!results.length && year) results = (await get("search/movie", { query: title })).results || [];
  // TMDB's first hit for a loose name can be any film ("mega" finds Mega Cyclone), so a match must carry
  // the name's words, and its runtime must fit the file when both are known.
  const exact = (r) => words(r.title).join(" ") === words(title).join(" ");
  const fitting = results.filter((r) => titleFits(title, r.title || r.original_title)).sort((a, b) => exact(b) - exact(a));
  for (const pick of fitting.slice(0, 3)) {
    const details = await get(`movie/${pick.id}`, { append_to_response: "external_ids" });
    const runtime = Number(details.runtime) || null;
    if (!runtimeFits(runtime, duration)) continue;
    return {
      tmdbId: pick.id,
      imdbId: details.imdb_id || details.external_ids?.imdb_id || null,
      title: details.title || pick.title,
      year: Number(String(details.release_date || pick.release_date || "").slice(0, 4)) || null,
      runtime,
    };
  }
  return null;
}

const words = (text) => String(text || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").split(" ").filter((w) => w && !["the", "a", "an", "of", "and"].includes(w));

/** Whether a TMDB title is the film a name asks for: every word of the name is in it (the name may leave
 *  off a subtitle, "Fall 2" for "Fall 2: Deadpoint"), and it adds at most a short subtitle. */
export function titleFits(name, candidate) {
  const want = words(name);
  const have = words(candidate);
  if (!want.length || !have.length) return false;
  if (!want.every((w) => have.includes(w))) return false;
  // "mega" is in "Mega Cyclone", but a one-word name only fits a one-word title or "Name: Subtitle".
  if (want.length === 1 && have.length > 1 && !new RegExp(`^${want[0]}\\s*[:-]`, "i").test(String(candidate).trim())) return false;
  return have.length - want.length <= 4;
}

/** Whether a film's runtime (minutes) fits the file's length (seconds): within 20 minutes or 20%. */
export function runtimeFits(runtime, duration) {
  if (!runtime || !duration) return true;
  return Math.abs(runtime * 60 - duration) <= Math.max(20 * 60, duration * 0.2);
}

/** Opening and credits times from the online segment databases: {introEnd, creditsStart, source} (seconds). */
export async function onlineSegments(film, duration, { fetch = globalThis.fetch, signal } = {}) {
  if (!film) return null;
  const tries = [];
  if (film.tmdbId)
    tries.push(async () => {
      const url = `https://api.theintrodb.org/v3/media?tmdb_id=${film.tmdbId}&duration_ms=${Math.round(duration * 1000)}`;
      const data = await (await fetch(url, { signal: signal || AbortSignal.timeout(12000) })).json();
      const intro = (data.intro || [])[0];
      const credits = (data.credits || [])[0];
      return {
        introEnd: intro ? clampNumber(intro.end_ms) / 1000 : null,
        creditsStart: credits ? clampNumber(credits.start_ms) / 1000 : null,
        creditsEnd: credits ? clampNumber(credits.end_ms) / 1000 : null,
        source: "TheIntroDB",
      };
    });
  if (film.imdbId)
    tries.push(async () => {
      const url = `https://api.introdb.app/segments?imdb_id=${film.imdbId}&is_movie=true`;
      const data = await (await fetch(url, { signal: signal || AbortSignal.timeout(12000) })).json();
      const seg = (value) => (Array.isArray(value) ? value[0] : value) || null;
      const intro = seg(data.intro);
      const outro = seg(data.outro);
      return {
        introEnd: intro ? clampNumber(intro.end_sec ?? intro.end) : null,
        creditsStart: outro ? clampNumber(outro.start_sec ?? outro.start) : null,
        creditsEnd: outro ? clampNumber(outro.end_sec ?? outro.end) : null,
        source: "IntroDB",
      };
    });
  const found = { introEnd: null, creditsStart: null, sources: [] };
  for (const attempt of tries) {
    const result = await attempt().catch(() => null);
    if (!result) continue;
    if (found.introEnd == null && result.introEnd != null) { found.introEnd = result.introEnd; found.sources.push(`opening: ${result.source}`); }
    if (found.creditsStart == null && result.creditsStart != null) {
      let start = result.creditsStart;
      // Another release of the film can run a little longer or shorter: keep the credits' length and
      // anchor them to the end of this file when the database's time lands past it.
      if (result.creditsEnd != null && start >= duration - 30) start = duration - (result.creditsEnd - result.creditsStart);
      found.creditsStart = start;
      found.sources.push(`credits: ${result.source}`);
    }
    if (found.introEnd != null && found.creditsStart != null) break;
  }
  return found;
}

/** Opening and credits from chapter names ("Opening Credits", "End Credits", "Credits"). */
export function chapterSegments(chapters = [], duration) {
  const found = { introEnd: null, creditsStart: null };
  for (const chapter of chapters) {
    const title = String(chapter.title || "").toLowerCase();
    if (/\b(end|closing)\s*(credits|titles)\b|^credits$|\boutro\b/.test(title) && chapter.start > duration * 0.6 && found.creditsStart == null) found.creditsStart = chapter.start;
    if (/\b(opening|main)\s*(credits|titles)\b|\bintro\b|^titles$/.test(title) && chapter.start < duration * 0.15 && found.introEnd == null) found.introEnd = chapter.end;
  }
  return found;
}

/** Opening and credits from the vision tags: a run of title-card, credits, or black frames at either end. */
export function visualSegments(analysis, described) {
  const shots = (analysis?.shots || []).filter((shot) => described?.[`tag:${shot.i}`]);
  if (shots.length < 20) return { introEnd: null, creditsStart: null };
  const duration = analysis.duration;
  const offStory = (shot) => {
    const tag = described[`tag:${shot.i}`];
    return tag.t || tag.k || tag.s === "none";
  };
  // Credits: walking back from the end, the start of the run of text, black, or empty frames. A
  // post-credits scene at the very end (up to about 3 minutes of story frames) is stepped over; once
  // credits are found, three story frames in a row mean the story has resumed.
  let creditsStart = null;
  let off = 0;
  let storyRun = 0;
  const stepOver = Math.round(180 / (analysis.shotEvery || 3));
  for (let k = shots.length - 1; k >= 0 && shots[k].t > duration * 0.7; k--) {
    if (offStory(shots[k])) {
      off++;
      storyRun = 0;
      creditsStart = shots[k].t;
    } else if (++storyRun >= (off >= 10 ? 3 : stepOver)) break;
  }
  if (off < 5) creditsStart = null;
  // Opening: the first run of three story frames (no titles, not black) inside the first 15%.
  let introEnd = null;
  for (let k = 0; k + 2 < shots.length && shots[k].t < duration * 0.15; k++) {
    if (!offStory(shots[k]) && !offStory(shots[k + 1]) && !offStory(shots[k + 2])) {
      introEnd = k > 0 ? shots[k].t - analysis.shotEvery / 2 : null;
      break;
    }
  }
  return { introEnd, creditsStart };
}

/** The story's span from every source, each checked against the file, falling back to fixed guards. */
export function storyBounds(duration, { online = null, chapters = null, visual = null } = {}) {
  const fallback = DEFAULT_BOUNDS(duration);
  const startOk = (t) => t != null && t > 0 && t < duration * 0.15;
  const endOk = (t) => t != null && t > duration * 0.7 && t < duration - 5;
  const pick = (candidates, ok) => candidates.find(([value]) => ok(value)) || null;
  const start = pick([[online?.introEnd, online?.sources?.find((s) => s.startsWith("opening"))?.split(": ")[1]], [chapters?.introEnd, "chapters"], [visual?.introEnd, "frames"]], startOk);
  const end = pick([[online?.creditsStart, online?.sources?.find((s) => s.startsWith("credits"))?.split(": ")[1]], [chapters?.creditsStart, "chapters"], [visual?.creditsStart, "frames"]], endOk);
  return {
    // A couple of seconds of margin either side of the marks.
    start: Math.round((start ? start[0] + 2 : fallback.start) * 100) / 100,
    end: Math.round((end ? end[0] - 2 : fallback.end) * 100) / 100,
    from: { start: start ? start[1] : "estimate", end: end ? end[1] : "estimate" },
  };
}
