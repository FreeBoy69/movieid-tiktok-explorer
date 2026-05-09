import dotenv from "dotenv";
import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import { execSync, spawn } from "child_process";
import fs from "fs";
import cors from "cors";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const projectRoot = process.cwd();
dotenv.config({ path: path.join(projectRoot, ".env") });
dotenv.config({ path: path.join(projectRoot, ".env.local"), override: true });

type TikTokListPayload = { title: string; author: string; videos: unknown[] };

type TmdbSearchResult = {
  id: number;
  media_type?: "movie" | "tv" | "person";
  title?: string;
  name?: string;
  original_name?: string;
  release_date?: string;
  first_air_date?: string;
  poster_path?: string | null;
  vote_count?: number;
  popularity?: number;
};

type TmdbSearchResponse = {
  results?: TmdbSearchResult[];
};

type TmdbExternalIdsResponse = {
  imdb_id?: string | null;
};

type TmdbMovieDetailsResponse = TmdbSearchResult & {
  original_title?: string;
  overview?: string;
  tagline?: string;
  runtime?: number | null;
  name?: string;
  original_name?: string;
  first_air_date?: string;
  episode_run_time?: number[];
  genres?: Array<{ id: number; name: string }>;
  vote_average?: number;
  status?: string;
  original_language?: string;
  origin_country?: string[];
  production_countries?: Array<{ iso_3166_1: string; name: string }>;
  backdrop_path?: string | null;
  external_ids?: TmdbExternalIdsResponse;
  created_by?: Array<{ name?: string }>;
  credits?: {
    cast?: Array<{
      name?: string;
      character?: string;
      profile_path?: string | null;
      order?: number;
    }>;
    crew?: Array<{
      name?: string;
      job?: string;
    }>;
  };
};

function normalizeExecutablePath(p: string): string {
  return p.replace(/^["']|["']$/g, "").trim();
}

/** python.org installs under %LocalAppData%\Programs\Python — visible even when `python` is not on PATH for the Node process. */
function findPythonWindowsUserInstall(): string | null {
  const found: string[] = [];
  const tryDir = (base: string) => {
    if (!base || !fs.existsSync(base)) return;
    try {
      for (const name of fs.readdirSync(base)) {
        if (!/^python\d/i.test(name)) continue;
        const exe = path.join(base, name, "python.exe");
        if (fs.existsSync(exe)) found.push(exe);
      }
    } catch {
      /* ignore */
    }
  };
  if (process.env.LOCALAPPDATA) {
    tryDir(path.join(process.env.LOCALAPPDATA, "Programs", "Python"));
  }
  if (process.env.PROGRAMFILES) {
    tryDir(path.join(process.env.PROGRAMFILES, "Python"));
  }
  if (!found.length) return null;
  found.sort();
  return found[found.length - 1] ?? null;
}

/** Prefer a real python.exe. Avoid `py -3`: it often targets a stale C:\\Python312\\python.exe and mishandles paths with `&`. */
function resolvePythonExecutable(scriptPath: string): { cmd: string; args: string[] } {
  const args = [scriptPath];
  const fromEnv = process.env.PYTHON_PATH
    ? normalizeExecutablePath(process.env.PYTHON_PATH)
    : "";
  if (fromEnv && fs.existsSync(fromEnv)) {
    return { cmd: fromEnv, args };
  }

  if (process.platform === "win32") {
    const userPy = findPythonWindowsUserInstall();
    if (userPy) {
      return { cmd: userPy, args };
    }

    const whereExe = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "where.exe");
    for (const name of ["python", "python3"]) {
      try {
        const out = execSync(`"${whereExe}" ${name}`, {
          encoding: "utf-8",
          windowsHide: true,
        }).trim();
        const first = out
          .split(/\r?\n/)
          .map((line) => line.trim())
          .find((line) => line.length > 0 && !/^INFO:/i.test(line));
        if (first && fs.existsSync(first)) {
          return { cmd: first, args };
        }
      } catch {
        /* try next */
      }
    }
    return { cmd: "py", args: ["-3", ...args] };
  }

  return { cmd: "python3", args };
}

function runTikTokListScript(
  url: string,
  count: number,
  seedVideoUrl?: string,
): Promise<TikTokListPayload> {
  const scriptPath = path.join(__dirname, "scripts", "tiktok_list.py");
  const { cmd, args } = resolvePythonExecutable(scriptPath);
  // Hard cap so a stuck Playwright session can't hang /api/tiktok/list forever.
  // Matches tiktok-rewriter's 180s ceiling on analyze_playlist plus buffer for yt-dlp fallback.
  const timeoutMs = Math.min(
    Math.max(Number(process.env.TIKTOK_LIST_TIMEOUT_MS) || 240000, 30000),
    600000,
  );

  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: __dirname,
      env: { ...process.env },
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let killedByTimeout = false;
    const killTimer = setTimeout(() => {
      killedByTimeout = true;
      try {
        child.kill("SIGKILL");
      } catch {
        /* already dead */
      }
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (err) => {
      clearTimeout(killTimer);
      const hint =
        process.platform === "win32"
          ? " Set PYTHON_PATH in .env.local to the full path of python.exe (py launcher often targets a missing install)."
          : "";
      reject(new Error(`${err instanceof Error ? err.message : String(err)}${hint}`));
    });
    child.on("close", (code) => {
      clearTimeout(killTimer);
      if (killedByTimeout) {
        reject(
          new Error(
            `TikTok listing timed out after ${Math.round(timeoutMs / 1000)}s. Playwright likely hung during session init — set TIKTOK_MS_TOKEN or raise TIKTOK_LIST_TIMEOUT_MS.`,
          ),
        );
        return;
      }
      try {
        const data = JSON.parse(stdout || "{}") as TikTokListPayload & { error?: string };
        if (data.error) {
          reject(new Error(data.error));
          return;
        }
        if (!Array.isArray(data.videos)) {
          reject(new Error(stderr || stdout || `TikTok listing failed (exit ${code})`));
          return;
        }
        resolve(data);
      } catch {
        reject(new Error(stderr || stdout || `TikTok listing failed (exit ${code})`));
      }
    });
    child.stdin.write(JSON.stringify({ url, count, seedVideoUrl: seedVideoUrl || "" }));
    child.stdin.end();
  });
}

function tmdbImage(pathName?: string | null, size = "w500"): string {
  return pathName ? `https://image.tmdb.org/t/p/${size}${pathName}` : "";
}

function runYtDlpDownload(url: string, outputPath: string): Promise<void> {
  const python = resolvePythonExecutable("-m").cmd;
  const timeoutMs = Math.min(
    Math.max(Number(process.env.TIKTOK_DOWNLOAD_TIMEOUT_MS) || 180000, 30000),
    600000,
  );
  const args = [
    "-m",
    "yt_dlp",
    "-f",
    "worstvideo[ext=mp4]+worstaudio[ext=m4a]/worst[ext=mp4]/worst",
    "--merge-output-format",
    "mp4",
    "--no-check-certificate",
    "--force-overwrites",
    "--no-playlist",
    "--extractor-args",
    "tiktok:api_hostname=api16-normal-c-useast1a.tiktokv.com",
    "-o",
    outputPath,
    url,
  ];

  return new Promise((resolve, reject) => {
    const child = spawn(python, args, {
      cwd: __dirname,
      env: { ...process.env },
      windowsHide: true,
    });
    let stderr = "";
    let stdout = "";
    let killedByTimeout = false;
    const timer = setTimeout(() => {
      killedByTimeout = true;
      try {
        child.kill("SIGKILL");
      } catch {
        /* already dead */
      }
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (killedByTimeout) {
        reject(new Error(`yt-dlp download timed out after ${Math.round(timeoutMs / 1000)}s`));
        return;
      }
      if (code !== 0) {
        reject(new Error(stderr || stdout || `yt-dlp exited with code ${code}`));
        return;
      }
      resolve();
    });
  });
}

function tmdbAuthHeaders(): HeadersInit {
  const bearer = (process.env.TMDB_READ_ACCESS_TOKEN || process.env.TMDB_ACCESS_TOKEN || "")
    .replace(/^["']|["']$/g, "")
    .trim();
  return bearer ? { Authorization: `Bearer ${bearer}` } : {};
}

function tmdbApiKey(): string {
  return (process.env.TMDB_API_KEY || "").replace(/^["']|["']$/g, "").trim();
}

async function fetchTmdbJson<T>(pathName: string, params: Record<string, string> = {}): Promise<T> {
  const apiKey = tmdbApiKey();
  const headers = tmdbAuthHeaders();
  if (!apiKey && !("Authorization" in headers)) {
    throw new Error("TMDB_API_KEY or TMDB_READ_ACCESS_TOKEN is not configured");
  }
  const url = new URL(`https://api.themoviedb.org/3/${pathName.replace(/^\/+/, "")}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value) url.searchParams.set(key, value);
  });
  if (apiKey) url.searchParams.set("api_key", apiKey);
  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`TMDB request failed (${response.status})`);
  }
  return (await response.json()) as T;
}

function tmdbResultTitle(result: TmdbSearchResult): string {
  return result.title || result.name || "";
}

function tmdbResultDate(result: TmdbSearchResult): string {
  return result.release_date || result.first_air_date || "";
}

function chooseTmdbTitle(
  results: TmdbSearchResult[],
  title: string,
  year?: string,
): TmdbSearchResult | null {
  const wantedYear = (year || "").match(/\d{4}/)?.[0] || "";
  const normalizedTitle = title.trim().toLowerCase();
  const withPosters = results.filter((r) => r.poster_path && (r.media_type === "movie" || r.media_type === "tv"));
  if (!withPosters.length) return null;
  return (
    withPosters.find((r) => {
      const resultYear = tmdbResultDate(r).slice(0, 4);
      return tmdbResultTitle(r).trim().toLowerCase() === normalizedTitle && (!wantedYear || resultYear === wantedYear);
    }) ||
    withPosters.find((r) => !wantedYear || tmdbResultDate(r).slice(0, 4) === wantedYear) ||
    withPosters.sort((a, b) => (b.vote_count || 0) - (a.vote_count || 0) || (b.popularity || 0) - (a.popularity || 0))[0] ||
    null
  );
}
function youtubeApiKey() {
  return (process.env.YOUTUBE_API_KEY || process.env.YT_API_KEY || "").replace(/^["']|["']$/g, "").trim();
}

async function fetchYouTubeJson(pathName, params = {}) {
  const key = youtubeApiKey();
  if (!key) {
    throw new Error("YOUTUBE_API_KEY is not configured. Add it to .env.local.");
  }

  const url = new URL(`https://www.googleapis.com/youtube/v3/${pathName.replace(/^\/+/, "")}`);
  url.searchParams.set("key", key);
  Object.entries(params).forEach(([paramKey, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(paramKey, String(value));
    }
  });

  const response = await fetch(url);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.error?.message || `YouTube request failed (${response.status})`;
    throw new Error(message);
  }
  return data;
}

function isoDurationToSeconds(duration) {
  const match = String(duration || "").match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  const [, days, hours, minutes, seconds] = match;
  return Number(days || 0) * 86400 + Number(hours || 0) * 3600 + Number(minutes || 0) * 60 + Number(seconds || 0);
}

function compactKeyword(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/&amp;/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 3 && !["video", "official", "shorts", "youtube", "with", "from", "that", "this", "your", "what", "when", "where", "into"].includes(word));
}

const YOUTUBE_CATEGORY_ID_TO_NAME: Record<string, string> = {
  "1": "Film & Animation",
  "2": "Autos & Vehicles",
  "10": "Music",
  "15": "Pets & Animals",
  "17": "Sports",
  "19": "Travel & Events",
  "20": "Gaming",
  "22": "People & Blogs",
  "23": "Comedy",
  "24": "Entertainment",
  "25": "News & Politics",
  "26": "Howto & Style",
  "27": "Education",
  "28": "Science & Technology",
  "29": "Nonprofits & Activism",
};

function getYoutubeCategoryName(categoryId: string) {
  const id = String(categoryId ?? "").trim();
  if (!id || id === "0") return "Not classified";
  return YOUTUBE_CATEGORY_ID_TO_NAME[id] || "Uncategorized";
}

function matchesVideoDurationFilter(durationKey: string, seconds: number) {
  if (durationKey === "any") return true;
  const s = Number(seconds) || 0;
  if (durationKey === "short") return s < 240;
  if (durationKey === "medium") return s >= 240 && s < 1200;
  if (durationKey === "long") return s >= 1200;
  return true;
}

function inferNiche(title, description, userQuery: string, categoryName: string, tagsText: string) {
  const tags = String(tagsText || "");
  const text = `${title} ${description} ${userQuery} ${tags}`.toLowerCase();
  const rules: Array<[string, string[]]> = [
    ["movie & TV recap", ["recap", "ending explained", "ending", "movie review", "film explained"]],
    ["movie recap", ["movie", "recap", "film", "cinema", "trailer", "full movie"]],
    ["documentary & explainers", ["documentary", "docuseries", "miniseries", "investigative", "exposed", "scandal", "controversy"]],
    ["AI & automation", ["chatgpt", "openai", "midjourney", "gemini", "robot", "automation", "artificial intelligence", "llm", "neural", "sora", "claude"]],
    ["space & astronomy", ["space", "nasa", "spacex", "moon", "mars", "galaxy", "planet", "solar", "astronom", "cosmos", "ufo", "james webb"]],
    ["history & war", ["history", "ancient", "ww2", "wwii", "empire", "civilization", "battle of", "dynasty"]],
    ["money & business", ["stonks", "stock", "passive income", "money", "business", "startup", "crypto", "invest", "hustle", "revenue"]],
    ["true crime", ["true crime", "unsolved", "serial killer", "case file", "murder", "mystery", "jury", "court case"]],
    ["health & fitness", ["gym", "workout", "diet", "protein", "longevity", "health", "sleep", "meditation", "yoga", "keto", "gains", "primal"]],
    [
      "coding & software",
      [
        "coding",
        "python",
        "javascript",
        "typescript",
        "github",
        "programming",
        "debug",
        "react.js",
        "next.js",
        "node.js",
        "api",
        "devops",
        "linux",
        "cursor",
        "stack overflow",
      ],
    ],
    [
      "reaction & review",
      ["reaction video", "reacts", "first time", "honest review", "rating", "game breakdown", "tier list", "i watched"],
    ],
    ["shorts & clips", ["#shorts", "shorts", "short video", "clip", "bitesized"]],
    ["challenge & viral", ["challenge", "dare", "prank", "viral", "trending", "gone wrong", "satisfying", "satisfy"]],
    ["music & audio", ["cover", "lyrics", "remix", "acoustic", "beat", "album", "mv", "official video", "live performance"]],
    ["podcast & talk", ["podcast", "interview", "ep.", "livestream", "q&a", "debate", "opinion", "rant"]],
    ["beauty & fashion", ["makeup", "skincare", "outfit", "fashion", "grwm", "aesthetic", "nails", "hairstyle"]],
    ["food & cooking", ["recipe", "cooking", "mukbang", "eat", "food review", "chef", "kitchen", "baking"]],
  ];
  for (const [label, keywords] of rules) {
    for (const keyword of keywords) {
      if (text.includes(String(keyword).toLowerCase())) return label;
    }
  }
  const cat = String(categoryName || "").toLowerCase();
  if (cat.includes("film") || cat.includes("animation")) {
    if (/(movie|recap|trailer|scene|cinema|short film)/.test(text)) return "Film & long-form (category)";
    return "Animation & video (category)";
  }
  if (cat.includes("gaming")) return "Gaming (category)";
  if (cat.includes("science") || cat.includes("technology")) {
    if (/(space|nasa|planet|physics|quantum|data science|ml\b|code)/.test(text)) return "STEM & digital (category)";
    return "Science & tech (category)";
  }
  if (cat.includes("howto") || cat.includes("style")) return "How-to & life skills (category)";
  if (cat.includes("education")) return "Education (category)";
  if (cat.includes("entertainment")) return "Entertainment (category)";
  if (cat.includes("news") || cat.includes("politics")) return "News & politics (category)";
  if (cat.includes("people") || cat.includes("blogs")) {
    const topWord = compactKeyword(`${title} ${userQuery} ${tags}`)[0];
    return topWord ? `${topWord} · creator` : "Creator & lifestyle (category)";
  }
  if (cat.includes("music")) return "Music (category)";
  if (cat.includes("sports")) return "Sports (category)";
  if (cat.includes("pets") || cat.includes("animals")) return "Pets & animals (category)";
  if (cat.includes("travel") || cat.includes("events")) return "Travel & events (category)";
  if (cat.includes("comedy")) return "Comedy (category)";
  if (cat.includes("nonprofit")) return "Nonprofit (category)";
  if (cat.includes("autos") || cat.includes("vehicles")) return "Autos (category)";
  const topWordN = compactKeyword(`${title} ${userQuery} ${tags}`)[0];
  if (topWordN) return `${topWordN} (topic signal)`;
  if (categoryName && categoryName !== "Uncategorized" && categoryName !== "Not classified") return `General · ${categoryName}`;
  return "emerging / multi-topic";
}

function facelessSignals(title, description, channelTitle) {
  const text = `${title} ${description} ${channelTitle}`.toLowerCase();
  const signals = ["recap", "explained", "facts", "documentary", "story", "stories", "mystery", "history", "top 10", "compilation", "animation", "ai voice", "motivation", "shorts"];
  const hits = signals.filter((signal) => text.includes(signal));
  const personalBrandPenalty = /\b(i|me|my|vlog|daily life|family|travel with|my day)\b/i.test(text) ? 1 : 0;
  const score = Math.max(0, Math.min(100, 42 + hits.length * 9 - personalBrandPenalty * 22));
  return { score, hits: hits.slice(0, 4) };
}

function estimateRpm(niche) {
  const n = String(niche || "").toLowerCase();
  if (/(money|business|finance|tech|software|ai)/.test(n)) return "$8-$24";
  if (/(health|fitness)/.test(n)) return "$5-$16";
  if (/(history|space|crime|movie|story)/.test(n)) return "$2-$9";
  return "$2-$7";
}

function competitionLabel(channelCount, medianSubscribers) {
  if (medianSubscribers < 25000 && channelCount < 12) return "Low";
  if (medianSubscribers < 150000 && channelCount < 28) return "Medium";
  return "High";
}

function median(values) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function buildYouTubeRadarVideos(videos, channelMap, query) {
  const now = Date.now();
  return videos.map((video) => {
    const snippet = video.snippet || {};
    const stats = video.statistics || {};
    const details = video.contentDetails || {};
    const channel = channelMap.get(snippet.channelId) || {};
    const channelStats = channel.statistics || {};
    const viewCount = Number(stats.viewCount || 0);
    const likeCount = Number(stats.likeCount || 0);
    const commentCount = Number(stats.commentCount || 0);
    const subscriberCount = channelStats.hiddenSubscriberCount ? 0 : Number(channelStats.subscriberCount || 0);
    const publishedAt = snippet.publishedAt || "";
    const ageHours = publishedAt ? Math.max(1, (now - new Date(publishedAt).getTime()) / 36e5) : 1;
    const viewsPerHour = Math.round(viewCount / ageHours);
    const outlierScore = Math.round(Math.min(100, (viewCount / Math.max(subscriberCount, 1)) * 18 + viewsPerHour / 180));
    const categoryId = String(snippet.categoryId ?? "").trim() || "0";
    const categoryName = getYoutubeCategoryName(categoryId);
    const tagStr = Array.isArray(snippet.tags) ? snippet.tags.join(" ") : "";
    const niche = inferNiche(snippet.title, snippet.description, query, categoryName, tagStr);
    const face = facelessSignals(snippet.title, snippet.description, snippet.channelTitle);
    const opportunityScore = Math.round(Math.min(100, outlierScore * 0.46 + face.score * 0.28 + Math.min(100, viewsPerHour / 60) * 0.18 + (subscriberCount < 100000 ? 8 : 0)));
    return {
      id: video.id,
      url: `https://www.youtube.com/watch?v=${video.id}`,
      title: snippet.title || "Untitled video",
      description: snippet.description || "",
      thumbnailUrl: snippet.thumbnails?.medium?.url || snippet.thumbnails?.default?.url || "",
      channelId: snippet.channelId || "",
      channelTitle: snippet.channelTitle || "Unknown channel",
      channelUrl: snippet.channelId ? `https://www.youtube.com/channel/${snippet.channelId}` : "",
      categoryId,
      categoryName,
      publishedAt,
      viewCount,
      likeCount,
      commentCount,
      subscriberCount,
      viewsPerHour,
      outlierScore,
      opportunityScore,
      facelessScore: face.score,
      facelessSignals: face.hits,
      niche,
      durationSeconds: isoDurationToSeconds(details.duration),
      rpmEstimate: estimateRpm(niche),
    };
  });
}

function buildYouTubeNiches(radarVideos) {
  const groups = new Map();
  for (const video of radarVideos) {
    const current = groups.get(video.niche) || [];
    current.push(video);
    groups.set(video.niche, current);
  }
  return Array.from(groups.entries())
    .map(([name, videos]) => {
      const medianSubscribers = median(videos.map((video) => video.subscriberCount));
      const avgOpportunity = Math.round(videos.reduce((sum, video) => sum + video.opportunityScore, 0) / videos.length);
      const avgVph = Math.round(videos.reduce((sum, video) => sum + video.viewsPerHour, 0) / videos.length);
      return {
        name,
        opportunityScore: avgOpportunity,
        competition: competitionLabel(new Set(videos.map((video) => video.channelId)).size, medianSubscribers),
        estimatedRpm: estimateRpm(name),
        outlierCount: videos.filter((video) => video.outlierScore >= 55).length,
        medianSubscribers,
        viewsPerHour: avgVph,
        topVideos: videos.slice(0, 3).map((video) => video.id),
        angles: [`Fast-paced ${name} breakdowns with a strong first-line hook`, `Series format: 5-8 repeatable examples per upload`, `Shorts-to-longform funnel using the same topic cluster`],
      };
    })
    .sort((a, b) => b.opportunityScore - a.opportunityScore);
}

const YT_RADAR_REGIONS = new Set(["US", "GB", "CA", "AU", "IN"]);
const YT_RADAR_ORDERS = new Set(["date", "relevance", "viewCount"]);
const YT_RADAR_DURATIONS = new Set(["any", "short", "medium", "long"]);

function normalizeYouTubeRadarInput(body: unknown) {
  const b = body && typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  const query = String(b.query ?? "").trim();
  const maxN = Number(b.maxResults);
  const maxResults = Math.min(Math.max(Number.isFinite(maxN) && maxN > 0 ? maxN : 30, 5), 50);
  const dayN = Number(b.publishedAfterDays);
  const publishedAfterDays = Math.min(Math.max(Number.isFinite(dayN) && dayN > 0 ? dayN : 90, 1), 3650);
  let regionCode = String(b.regionCode ?? "US")
    .trim()
    .toUpperCase();
  if (!/^[A-Z]{2}$/.test(regionCode) || !YT_RADAR_REGIONS.has(regionCode)) regionCode = "US";
  const rawLang = String(b.relevanceLanguage ?? "en").trim().toLowerCase();
  const relevanceLanguage = rawLang.slice(0, 2) || "en";
  let order = String(b.order ?? "viewCount").toLowerCase();
  if (!YT_RADAR_ORDERS.has(order)) order = "viewCount";
  let duration = String(b.duration ?? "any").toLowerCase();
  if (!YT_RADAR_DURATIONS.has(duration)) duration = "any";
  const wantsTrending =
    b.trending === true ||
    b.trending === 1 ||
    String(b.mode ?? "").toLowerCase() === "trending" ||
    String(b.scanMode ?? "").toLowerCase() === "trending";
  const mode = wantsTrending ? "trending" : "search";
  return { mode, query, maxResults, publishedAfterDays, regionCode, relevanceLanguage, order, duration };
}

function orderRadarVideosBySearch(
  videos: ReturnType<typeof buildYouTubeRadarVideos>,
  order: string,
) {
  if (order === "viewCount") return [...videos].sort((a, b) => b.viewCount - a.viewCount);
  if (order === "date")
    return [...videos].sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
  return [...videos];
}

type NormalizedRadar = ReturnType<typeof normalizeYouTubeRadarInput>;

async function getYouTubeSearchRadar(n: NormalizedRadar) {
  const { query: cleanQuery, maxResults, regionCode, relevanceLanguage, order, duration, publishedAfterDays } = n;
  if (!cleanQuery) throw new Error("Search query is required");
  const publishedAfter = new Date(Date.now() - publishedAfterDays * 864e5).toISOString();
  const search = await fetchYouTubeJson("search", {
    part: "snippet",
    type: "video",
    q: cleanQuery,
    maxResults,
    order,
    regionCode,
    relevanceLanguage,
    videoDuration: duration === "any" ? "" : duration,
    publishedAfter,
    safeSearch: "none",
  });

  const ids = (search.items || []).map((item: { id?: { videoId?: string } }) => item.id?.videoId).filter(Boolean) as string[];
  if (!ids.length) {
    return {
      query: cleanQuery,
      scanMode: "search" as const,
      generatedAt: new Date().toISOString(),
      videos: [],
      niches: [],
      summary: { videoCount: 0, avgOpportunity: 0, avgViewsPerHour: 0, bestNiche: "", apiMode: "youtube-data-api" },
    };
  }

  const videoData = await fetchYouTubeJson("videos", {
    part: "snippet,statistics,contentDetails",
    id: ids.join(","),
    maxResults: Math.min(50, maxResults),
  });
  const byId = new Map((videoData.items || []).map((video: { id: string }) => [video.id, video]));
  const searchOrderItems = ids.map((id) => byId.get(id)).filter(Boolean);
  const channelIds = Array.from(
    new Set(
      (searchOrderItems as Array<{ snippet?: { channelId?: string } }>)
        .map((video) => video.snippet?.channelId)
        .filter(Boolean) as string[],
    ),
  );
  const channelMap = new Map();
  for (let i = 0; i < channelIds.length; i += 50) {
    const chunk = channelIds.slice(i, i + 50);
    const channelData = await fetchYouTubeJson("channels", {
      part: "snippet,statistics",
      id: chunk.join(","),
      maxResults: chunk.length,
    });
    for (const channel of channelData.items || []) {
      channelMap.set(channel.id, channel);
    }
  }

  const built = buildYouTubeRadarVideos(searchOrderItems, channelMap, cleanQuery);
  const videos = orderRadarVideosBySearch(built, order);
  const niches = buildYouTubeNiches(videos);
  return {
    query: cleanQuery,
    scanMode: "search" as const,
    generatedAt: new Date().toISOString(),
    videos,
    niches,
    summary: {
      videoCount: videos.length,
      avgOpportunity: videos.length
        ? Math.round(videos.reduce((sum, video) => sum + video.opportunityScore, 0) / videos.length)
        : 0,
      avgViewsPerHour: videos.length
        ? Math.round(videos.reduce((sum, video) => sum + video.viewsPerHour, 0) / videos.length)
        : 0,
      bestNiche: niches[0]?.name || "",
      apiMode: "youtube-data-api",
    },
  };
}

async function getYouTubeTrendingRadar(n: NormalizedRadar) {
  const { maxResults, regionCode, order, duration, publishedAfterDays } = n;
  const videoData = await fetchYouTubeJson("videos", {
    part: "snippet,statistics,contentDetails",
    chart: "mostPopular",
    regionCode,
    maxResults: 50,
  });
  const cutoff = Date.now() - publishedAfterDays * 864e5;
  let items = (videoData.items || []).filter((v: { snippet?: { publishedAt?: string } }) => {
    const t = v.snippet?.publishedAt;
    if (!t) return false;
    return new Date(t).getTime() >= cutoff;
  });
  items = items.filter((v: { contentDetails?: { duration?: string } }) => {
    const sec = isoDurationToSeconds(v.contentDetails?.duration);
    return matchesVideoDurationFilter(duration, sec);
  });
  if (n.query && String(n.query).trim()) {
    const terms = String(n.query)
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    items = items.filter((v: { snippet?: { title?: string; description?: string; tags?: string[] } }) => {
      const s = v.snippet || {};
      const blob = `${s.title} ${s.description || ""} ${(Array.isArray(s.tags) ? s.tags.join(" ") : "")}`.toLowerCase();
      return terms.every((t) => blob.includes(t));
    });
  }
  const channelIds = Array.from(
    new Set(items.map((video: { snippet?: { channelId?: string } }) => video.snippet?.channelId).filter(Boolean) as string[]),
  );
  const channelMap = new Map();
  for (let i = 0; i < channelIds.length; i += 50) {
    const chunk = channelIds.slice(i, i + 50);
    const channelData = await fetchYouTubeJson("channels", {
      part: "snippet,statistics",
      id: chunk.join(","),
      maxResults: chunk.length,
    });
    for (const channel of channelData.items || []) {
      channelMap.set(channel.id, channel);
    }
  }
  const nicheContext = "regional trending";
  const built = buildYouTubeRadarVideos(items, channelMap, nicheContext);
  const ordered = orderRadarVideosBySearch(built, order);
  const videos = ordered.slice(0, maxResults);
  const niches = buildYouTubeNiches(videos);
  const qLabel =
    n.query && String(n.query).trim()
      ? `Regional viral · matching “${String(n.query).trim()}”`
      : "YouTube regional viral (most popular chart)";
  return {
    query: qLabel,
    scanMode: "trending" as const,
    generatedAt: new Date().toISOString(),
    videos,
    niches,
    summary: {
      videoCount: videos.length,
      avgOpportunity: videos.length
        ? Math.round(videos.reduce((sum, video) => sum + video.opportunityScore, 0) / videos.length)
        : 0,
      avgViewsPerHour: videos.length
        ? Math.round(videos.reduce((sum, video) => sum + video.viewsPerHour, 0) / videos.length)
        : 0,
      bestNiche: niches[0]?.name || "",
      apiMode: "youtube-trending-mostPopular",
    },
  };
}

async function getYouTubeRadar(body: unknown) {
  const n = normalizeYouTubeRadarInput(body);
  if (!n.query || !n.query.trim() || n.mode === "trending") return getYouTubeTrendingRadar(n);
  return getYouTubeSearchRadar(n);
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(cors());
  app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || "100mb" }));

  app.post("/api/tiktok/list", async (req, res) => {
    const { url, count, seedVideoUrl } = req.body as {
      url?: string;
      count?: number;
      seedVideoUrl?: string;
    };
    if (!url || typeof url !== "string") {
      return res.status(400).json({ error: "URL is required" });
    }
    const maxList = Math.min(Math.max(Number(process.env.TIKTOK_LIST_MAX) || 5000, 1), 10000);
    const n = Math.min(Math.max(Number(count) || 30, 1), maxList);
    const seed = typeof seedVideoUrl === "string" ? seedVideoUrl.trim() : "";
    try {
      const playlist = await runTikTokListScript(url.trim(), n, seed);
      res.json(playlist);
    } catch (e) {
      console.error("TikTok list error:", e);
      const message = e instanceof Error ? e.message : "TikTok listing failed";
      res.status(500).json({ error: message });
    }
  });

  app.post("/api/youtube/radar", async (req, res) => {
    try {
      const q = (req as express.Request & { query?: { trending?: string } }).query || {};
      const body =
        req.body && typeof req.body === "object" && !Array.isArray(req.body) ? { ...req.body } : {};
      if (q.trending === "1" || String(q.trending).toLowerCase() === "true") (body as Record<string, unknown>).trending = true;
      const radar = await getYouTubeRadar(body);
      res.json(radar);
    } catch (error) {
      console.error("YouTube radar error:", error);
      res.status(500).json({
        error: error instanceof Error ? error.message : "YouTube radar scan failed",
      });
    }
  });

  // API Route: TikTok Download & Proxy
  app.post("/api/tiktok/process", async (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: "URL is required" });

    console.log(`Processing TikTok URL: ${url}`);

    const tempFile = path.join(__dirname, `temp_video_${Date.now()}.mp4`);
    try {
      await runYtDlpDownload(String(url).trim(), tempFile);
      console.log(`Video downloaded to ${tempFile}`);

      const videoData = fs.readFileSync(tempFile);
      const base64Video = videoData.toString("base64");
      fs.unlinkSync(tempFile);

      res.json({
        success: true,
        base64: base64Video,
        mimeType: "video/mp4",
      });
    } catch (error) {
      console.error("yt-dlp download error:", error);
      try {
        if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
      } catch {
        /* best-effort cleanup */
      }
      res.status(500).json({
        error: "Failed to download video with yt-dlp.",
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.get("/api/movie/poster", async (req, res) => {
    const title = typeof req.query.title === "string" ? req.query.title.trim() : "";
    const year = typeof req.query.year === "string" ? req.query.year.trim() : "";
    if (!title) return res.status(400).json({ error: "title is required" });
    try {
      const data = await fetchTmdbJson<TmdbSearchResponse>("search/multi", {
        query: title,
        include_adult: "false",
      });
      const match = chooseTmdbTitle(data.results || [], title, year);
      if (!match?.poster_path || (match.media_type !== "movie" && match.media_type !== "tv")) {
        return res.json({ posterUrl: "", tmdbUrl: "", title, notFound: true });
      }
      const mediaType = match.media_type;
      const details = await fetchTmdbJson<TmdbMovieDetailsResponse>(`${mediaType}/${match.id}`, {
        append_to_response: "credits,external_ids",
      });
      const imdbId = details.external_ids?.imdb_id || "";
      const director =
        mediaType === "movie"
          ? details.credits?.crew?.find((person) => person.job === "Director")?.name || ""
          : details.created_by?.map((person) => person.name).filter(Boolean).join(", ") || "";
      const resolvedTitle = details.title || details.name || match.title || match.name || title;
      const releaseDate = details.release_date || details.first_air_date || match.release_date || match.first_air_date || "";
      res.json({
        posterUrl: tmdbImage(details.poster_path || match.poster_path, "w500"),
        backdropUrl: tmdbImage(details.backdrop_path, "w1280"),
        tmdbUrl: `https://www.themoviedb.org/${mediaType}/${match.id}`,
        imdbUrl: imdbId ? `https://www.imdb.com/title/${imdbId}/` : "",
        id: details.id || match.id,
        mediaType,
        title: resolvedTitle,
        originalTitle: details.original_title || details.original_name || "",
        overview: details.overview || "",
        tagline: details.tagline || "",
        releaseDate,
        runtime: details.runtime || details.episode_run_time?.[0] || null,
        genres: (details.genres || []).map((genre) => genre.name).filter(Boolean),
        rating: typeof details.vote_average === "number" ? details.vote_average : null,
        voteCount: details.vote_count || 0,
        status: details.status || "",
        language: details.original_language || "",
        countries:
          mediaType === "movie"
            ? (details.production_countries || []).map((country) => country.name).filter(Boolean)
            : details.origin_country || [],
        director,
        cast: (details.credits?.cast || [])
          .sort((a, b) => (a.order || 0) - (b.order || 0))
          .slice(0, 8)
          .map((person) => ({
            name: person.name || "",
            character: person.character || "",
            profileUrl: tmdbImage(person.profile_path, "w185"),
          }))
          .filter((person) => person.name),
      });
    } catch (error) {
      console.error("TMDB poster error:", error);
      res.status(500).json({
        error: error instanceof Error ? error.message : "TMDB poster lookup failed",
      });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    const serveDevIndex: express.RequestHandler = async (req, res, next) => {
      try {
        const indexPath = path.join(__dirname, "index.html");
        const rawHtml = fs.readFileSync(indexPath, "utf8");
        const html = await vite.transformIndexHtml(req.originalUrl, rawHtml);
        res.status(200).set({ "Content-Type": "text/html" }).end(html);
      } catch (error) {
        vite.ssrFixStacktrace(error as Error);
        next(error);
      }
    };
    app.get("/", serveDevIndex);
    app.get("/playlist/:slug", serveDevIndex);
    app.get("/channel/:slug", serveDevIndex);
    app.get("/post/:slug", serveDevIndex);
    app.get("/youtube", serveDevIndex);
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
