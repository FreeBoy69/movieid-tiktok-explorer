import type { TikTokPlaylist } from "../services/tiktok";

const OLD_STORAGE_KEY = "movieid-explorer:saved-tiktok-playlists";
const MIGRATION_KEY = "movieid-explorer:saved-tiktok-playlists:postgres-migrated";

export function normalizePlaylistListUrl(u: string): string {
  if (!u || typeof u !== "string") return "";
  const clean = u.trim().split("#")[0];
  try {
    const parsed = new URL(clean.startsWith("//") ? `https:${clean}` : clean);
    if (parsed.hostname.replace(/^www\./i, "").toLowerCase() === "tiktok.com" && parsed.pathname.replace(/\/+$/, "").toLowerCase() === "/search") {
      const query = (parsed.searchParams.get("q") || parsed.searchParams.get("keyword") || "").trim().toLowerCase();
      return query ? `https://www.tiktok.com/search?q=${encodeURIComponent(query)}` : "https://www.tiktok.com/search";
    }
  } catch {
    // Fall through to the generic path normalizer.
  }
  return clean.split("?")[0].replace(/\/+$/, "").toLowerCase();
}

export interface SavedPlaylistRecord {
  key?: string;
  playlist: TikTokPlaylist;
  analyzedUrl: string;
  savedAt: number;
}

export interface SavedPlaylistSummary {
  key: string;
  slug: string;
  analyzedUrl: string;
  title: string;
  videoCount: number;
  savedAt: number;
  thumb: string;
}

export function slugifySavedPlaylistTitle(title: string): string {
  const slug = (title || "playlist")
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70);
  return slug || "playlist";
}

export function slugifySavedPost(video: { id?: string; title?: string; authorHandle?: string; author?: string }): string {
  const handle = (video.authorHandle || video.author || "post").replace(/^@/, "");
  const title = video.title || "video";
  const id = video.id ? `-${video.id}` : "";
  return slugifySavedPlaylistTitle(`${handle}-${title}${id}`);
}

async function readJson<T>(response: Response): Promise<T> {
  const data = (await response.json().catch(() => ({}))) as { error?: string } & T;
  if (!response.ok) throw new Error(data.error || "Saved playlist database unavailable");
  return data as T;
}

let migrationAttempted = false;

async function migrateBrowserSavesOnce(): Promise<void> {
  if (migrationAttempted || typeof window === "undefined") return;
  migrationAttempted = true;
  if (window.localStorage.getItem(MIGRATION_KEY) === "1") return;

  const raw = window.localStorage.getItem(OLD_STORAGE_KEY);
  if (!raw) {
    window.localStorage.setItem(MIGRATION_KEY, "1");
    return;
  }

  const parsed = JSON.parse(raw) as Record<string, SavedPlaylistRecord>;
  const records = Object.entries(parsed || {}).filter(([, row]) => row?.playlist?.videos?.length);
  if (!records.length) {
    window.localStorage.setItem(MIGRATION_KEY, "1");
    return;
  }

  for (const [key, row] of records) {
    await setSavedPlaylist(key, row.playlist, row.analyzedUrl || key);
  }
  window.localStorage.setItem(MIGRATION_KEY, "1");
}

function validRecord(record: SavedPlaylistRecord | null | undefined): SavedPlaylistRecord | null {
  if (!record?.playlist?.videos?.length) return null;
  return record;
}

export async function getSavedPlaylist(rawUrl: string): Promise<SavedPlaylistRecord | null> {
  const k = normalizePlaylistListUrl(rawUrl);
  if (!k) return null;
  const response = await fetch(`/api/saved/tiktok-playlists/by-url?url=${encodeURIComponent(k)}`);
  const data = await readJson<{ record: SavedPlaylistRecord | null }>(response);
  return validRecord(data.record);
}

export async function setSavedPlaylist(rawUrl: string, playlist: TikTokPlaylist, analyzedUrl: string): Promise<SavedPlaylistRecord | null> {
  const k = normalizePlaylistListUrl(rawUrl);
  if (!k || !playlist?.videos?.length) return null;
  const response = await fetch("/api/saved/tiktok-playlists", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rawUrl: k, playlist, analyzedUrl: (analyzedUrl || rawUrl).trim() }),
  });
  const data = await readJson<{ record: SavedPlaylistRecord | null }>(response);
  return validRecord(data.record);
}

export async function listSavedPlaylistSummaries(): Promise<SavedPlaylistSummary[]> {
  await migrateBrowserSavesOnce();
  const response = await fetch("/api/saved/tiktok-playlists");
  const data = await readJson<{ summaries: SavedPlaylistSummary[] }>(response);
  return Array.isArray(data.summaries) ? data.summaries : [];
}

export async function getSavedPlaylistBySlug(slug: string): Promise<SavedPlaylistRecord | null> {
  const wanted = slugifySavedPlaylistTitle(slug);
  if (!wanted) return null;
  const response = await fetch(`/api/saved/tiktok-playlists/by-slug/${encodeURIComponent(wanted)}`);
  const data = await readJson<{ record: SavedPlaylistRecord | null }>(response);
  return validRecord(data.record);
}

export async function getSavedPostBySlug(slug: string): Promise<{ record: SavedPlaylistRecord; videoIndex: number } | null> {
  const wanted = slugifySavedPlaylistTitle(slug);
  if (!wanted) return null;
  const response = await fetch(`/api/saved/tiktok-posts/${encodeURIComponent(wanted)}`);
  const data = await readJson<{ found: { record: SavedPlaylistRecord; videoIndex: number } | null }>(response);
  if (!data.found?.record?.playlist?.videos?.length) return null;
  return data.found;
}

export async function removeSavedPlaylist(key: string): Promise<void> {
  if (!key) return;
  const response = await fetch(`/api/saved/tiktok-playlists?key=${encodeURIComponent(key)}`, { method: "DELETE" });
  await readJson<{ ok: boolean }>(response);
}
