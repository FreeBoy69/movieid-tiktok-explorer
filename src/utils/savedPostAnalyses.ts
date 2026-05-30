import type { TikTokVideo } from "../services/tiktok";
import type { MovieResult } from "../types";
import { normalizePlaylistListUrl } from "./savedTikTokPlaylists";

const STORAGE_KEY = "movieid-explorer:tiktok-post-analyses";

export interface SavedPostAnalysis {
  result: MovieResult;
  analyzedAt: number;
  video?: TikTokVideo;
  playlistKey?: string;
}

export function readLocalSavedPostAnalyses(): Record<string, SavedPostAnalysis> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, SavedPostAnalysis>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function writeLocalSavedPostAnalysis(slug: string, analysis: SavedPostAnalysis): void {
  if (!slug || typeof window === "undefined") return;
  const all = readLocalSavedPostAnalyses();
  all[slug] = analysis;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
}

export function mergePostAnalyses(...groups: Array<Record<string, SavedPostAnalysis> | undefined>): Record<string, SavedPostAnalysis> {
  const out: Record<string, SavedPostAnalysis> = {};
  for (const group of groups) {
    for (const [slug, analysis] of Object.entries(group || {})) {
      if (!slug || !analysis?.result) continue;
      const previous = out[slug];
      if (!previous || Number(analysis.analyzedAt || 0) >= Number(previous.analyzedAt || 0)) {
        out[slug] = analysis;
      }
    }
  }
  return out;
}

export function analysisAutoTags(result: MovieResult): string[] {
  const loose = result as MovieResult & { genre?: string };
  const tags = [
    ...(Array.isArray(result?.tmdb?.genres) ? result.tmdb.genres : []),
    ...(Array.isArray(result?.mal?.genres) ? result.mal.genres : []),
    loose?.genre,
    result?.mediaType,
    result?.year ? String(result.year) : "",
    result?.tmdb?.releaseDate ? String(result.tmdb.releaseDate).slice(0, 4) : "",
  ];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const tag = String(raw || "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 48);
    const key = tag.toLowerCase();
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
}

async function readJson<T>(response: Response): Promise<T> {
  const data = (await response.json().catch(() => ({}))) as { error?: string } & T;
  if (!response.ok) throw new Error(data.error || "Saved post analysis database unavailable");
  return data as T;
}

export async function listSavedPostAnalyses(playlistKey: string): Promise<Record<string, SavedPostAnalysis>> {
  const key = normalizePlaylistListUrl(playlistKey);
  const query = key ? `?playlistKey=${encodeURIComponent(key)}` : "";
  const response = await fetch(`/api/saved/tiktok-post-analyses${query}`);
  const data = await readJson<{ analyses: Record<string, SavedPostAnalysis> }>(response);
  return data.analyses || {};
}

export async function saveSavedPostAnalysis(slug: string, analysis: SavedPostAnalysis): Promise<SavedPostAnalysis | null> {
  if (!slug || !analysis?.result) return null;
  writeLocalSavedPostAnalysis(slug, analysis);
  const response = await fetch("/api/saved/tiktok-post-analyses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      slug,
      playlistKey: normalizePlaylistListUrl(analysis.playlistKey || ""),
      video: analysis.video || null,
      result: analysis.result,
      analyzedAt: analysis.analyzedAt,
    }),
  });
  const data = await readJson<{ analysis: SavedPostAnalysis | null }>(response);
  return data.analysis || null;
}
