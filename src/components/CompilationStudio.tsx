import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, ArrowLeft, CheckCircle2, Clock3, Film, Heart, Layers3, Loader2, MessageCircle, Play, RefreshCw, Scissors, Search, Share2, Sparkles, User, Youtube, Zap } from "lucide-react";
import { AuthSessionPayload, ConnectedYouTubeAccount, MovieResult, YouTubePlaylistSummary } from "../types";
import { TikTokPlaylist, TikTokVideo, fetchTikTokPlaylist } from "../services/tiktok";
import { cn } from "../lib/utils";
import { channelListingUrl } from "../utils/tiktokListUrl";
import { identifyMovie, identifyMovieFromLink } from "../services/gemini";
import { MovieAnalysisTabs } from "./MovieAnalysisTabs";
import { StandardVideoCard } from "./StandardCards";
import { announceBackgroundProcess } from "../utils/backgroundProcesses";
import {
  buildDeepLinkHref,
  currentAppPath,
  navigateBack,
  writeDeepLink,
  type CompilationSortMode,
  type CompilationSourceMode,
  type TikTokDeepLink,
} from "../utils/tiktokRoute";

type SortMode = CompilationSortMode;
type PlaylistMode = "none" | "existing" | "create";
type SourceMode = CompilationSourceMode;
type CompilePanelTab = "settings" | "upload";
type CompilationJob = {
  id: string;
  status: "queued" | "running" | "done" | "error";
  message?: string;
  progress?: number | null;
  result?: any;
  error?: string;
};

type SearchPrefetch = {
  url: string;
  count: number;
  promise: Promise<TikTokPlaylist>;
};

const SEARCH_PAGE_SIZE = 20;

interface ProcessedTikTokVideo {
  mimeType: string;
  videoUrl?: string;
  base64?: string;
}

interface SavedPostAnalysis {
  result: MovieResult;
  analyzedAt: number;
}

interface CompilationStudioProps {
  auth: AuthSessionPayload;
  embedded?: boolean;
  initialAccountId?: string;
  initialMode?: CompilationSourceMode;
  initialQuery?: string;
  initialCount?: number;
  initialLoaded?: number;
  initialSort?: CompilationSortMode;
  initialClipId?: string;
  initialReturnTo?: string;
  routeKey?: string;
}

interface CompilationSnapshot {
  playlist: TikTokPlaylist;
  selectedIds: string[];
  mode: CompilationSourceMode;
  query: string;
  count: number;
  loadedSearchUrl: string;
  sort: CompilationSortMode;
  title: string;
  description: string;
  postAnalyses: Record<string, SavedPostAnalysis>;
  scrollTop: number;
}

const MAX_COMPILATION_SNAPSHOTS = 16;
const compilationSnapshots = new Map<string, CompilationSnapshot>();

function clampClipCount(value: number | undefined, fallback = 100): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(5000, Math.max(1, Math.floor(parsed)));
}

function videoRouteId(video: TikTokVideo): string {
  return String(video.id || video.playUrl || "").trim();
}

function rememberCompilationSnapshot(href: string, snapshot: CompilationSnapshot): void {
  if (!href) return;
  compilationSnapshots.delete(href);
  compilationSnapshots.set(href, snapshot);
  while (compilationSnapshots.size > MAX_COMPILATION_SNAPSHOTS) {
    const oldest = compilationSnapshots.keys().next().value as string | undefined;
    if (!oldest) break;
    compilationSnapshots.delete(oldest);
  }
}

function nestedCompileReturnTo(path: string | undefined): string {
  if (!path) return "";
  try {
    return new URL(path, "https://autoyt.local").searchParams.get("from") || "";
  } catch {
    return "";
  }
}

function compilationBackLabel(path: string): string {
  try {
    const parsed = new URL(path, "https://autoyt.local");
    if (parsed.searchParams.get("clip")) return "Back to clip";
    if (parsed.searchParams.get("mode") === "search") return "Back to search results";
    if (parsed.searchParams.get("mode") === "url") return "Back to source";
  } catch {
    // The router will apply its safe fallback for malformed paths.
  }
  return "Back";
}

function compact(value?: number | string | null): string {
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(Number(value || 0));
}

function durationSeconds(video: TikTokVideo): number {
  const seconds = Number(video.durationSeconds || 0);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
}

function formatDuration(seconds: number): string {
  if (!seconds) return "unknown";
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours) return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

function videoViews(video: TikTokVideo): number {
  return Number(video.stats?.playCount || 0);
}

function videoCreatedAt(video: TikTokVideo): number {
  const value = Number(video.createdAt || 0);
  return Number.isFinite(value) ? value : 0;
}

function sortVideos(videos: TikTokVideo[], sort: SortMode): TikTokVideo[] {
  return [...videos].sort((a, b) => {
    if (sort === "oldest") return videoCreatedAt(a) - videoCreatedAt(b);
    if (sort === "newest") return videoCreatedAt(b) - videoCreatedAt(a);
    if (sort === "length") return durationSeconds(b) - durationSeconds(a);
    return videoViews(b) - videoViews(a);
  });
}

function mergeTikTokVideos(existing: TikTokVideo[], incoming: TikTokVideo[], limit: number): TikTokVideo[] {
  const videos: TikTokVideo[] = [];
  const seen = new Set<string>();
  for (const video of [...existing, ...incoming]) {
    const key = String(video.id || video.playUrl || "").trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    videos.push(video);
    if (videos.length >= limit) break;
  }
  return videos;
}

function searchTermToTikTokUrl(value: string): string {
  const term = value.trim();
  if (!term) return "";
  if (/^https?:\/\//i.test(term)) return term;
  return `https://www.tiktok.com/search?q=${encodeURIComponent(term)}`;
}

function cleanTikTokProcessError(message: string): string {
  const raw = String(message || "").trim();
  if (/only exposing images|only images are available/i.test(raw)) return "TikTok exposed this clip as photo/slideshow mode and AutoYT could not rebuild it as a video.";
  if (/No clean \d+p TikTok source/i.test(raw)) return raw.split("\n").slice(-1)[0] || "No clean TikTok video source was available for this post.";
  return raw || "Could not download video";
}

async function processTikTokVideo(video: TikTokVideo, options?: { returnBase64?: boolean }): Promise<ProcessedTikTokVideo> {
  const url = video.playUrl?.trim();
  if (!url) throw new Error("No video URL");
  const response = await fetch("/api/tiktok/process", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url,
      returnBase64: !!options?.returnBase64,
      candidateUrls: video.cleanPlaybackUrls || [],
    }),
  });
  const data = (await response.json().catch(() => ({}))) as { error?: string; details?: string; base64?: string; videoUrl?: string; mimeType?: string };
  if (!response.ok) throw new Error(cleanTikTokProcessError(data.details || data.error || "Could not download video"));
  if (data.videoUrl) return { videoUrl: data.videoUrl, mimeType: data.mimeType || "video/mp4" };
  if (data.base64) return { base64: data.base64, mimeType: data.mimeType || "video/mp4" };
  throw new Error("Could not download video");
}

async function fetchVideoBlob(video: TikTokVideo): Promise<{ blob: Blob; mimeType: string }> {
  const data = await processTikTokVideo(video);
  const mimeType = data.mimeType || "video/mp4";
  if (data.videoUrl) {
    try {
      const response = await fetch(data.videoUrl);
      if (!response.ok) throw new Error("Downloaded video expired before analysis could start.");
      return { blob: await response.blob(), mimeType };
    } catch (err) {
      const fallback = await processTikTokVideo(video, { returnBase64: true });
      if (!fallback.base64) throw err;
      const bin = atob(fallback.base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return { blob: new Blob([bytes], { type: fallback.mimeType || mimeType }), mimeType: fallback.mimeType || mimeType };
    }
  }
  if (data.base64) {
    const bin = atob(data.base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { blob: new Blob([bytes], { type: mimeType }), mimeType };
  }
  throw new Error("Could not download video");
}

async function tiktokVideoToFile(video: TikTokVideo): Promise<File> {
  const { blob, mimeType } = await fetchVideoBlob(video);
  return new File([blob], `tiktok_${video.id || Date.now()}.mp4`, { type: mimeType });
}

async function identifyTikTokVideoMovie(video: TikTokVideo): Promise<MovieResult> {
  const url = String(video.playUrl || "").trim();
  if (/tiktok\.com/i.test(url)) {
    try {
      return await identifyMovieFromLink(url, video.cleanPlaybackUrls || []);
    } catch (err) {
      console.warn("TikTok link Movie ID failed, falling back to uploaded clip:", err instanceof Error ? err.message : err);
    }
  }
  const file = await tiktokVideoToFile(video);
  return identifyMovie(file);
}

async function readApiJson(response: Response, fallback: string): Promise<any> {
  const text = await response.text();
  let data: any = {};
  if (text.trim()) {
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`${fallback}. Server returned ${response.status}.`);
    }
  }
  if (!response.ok) throw new Error(data.error || fallback);
  return data;
}

export function CompilationStudio({
  auth,
  embedded = false,
  initialAccountId = "",
  initialMode = "url",
  initialQuery = "",
  initialCount = 100,
  initialLoaded,
  initialSort = "views",
  initialClipId = "",
  initialReturnTo = "",
  routeKey = "",
}: CompilationStudioProps) {
  const [url, setUrl] = useState(initialQuery);
  const [sourceMode, setSourceMode] = useState<SourceMode>(initialMode);
  const [count, setCount] = useState(() => clampClipCount(initialCount));
  const [playlist, setPlaylist] = useState<TikTokPlaylist | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [previewVideo, setPreviewVideo] = useState<TikTokVideo | null>(null);
  const [postAnalyses, setPostAnalyses] = useState<Record<string, SavedPostAnalysis>>({});
  const [analyzingVideoId, setAnalyzingVideoId] = useState("");
  const [analysisError, setAnalysisError] = useState("");
  const [previewError, setPreviewError] = useState("");
  const [sort, setSort] = useState<SortMode>(initialSort);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [metadataLoading, setMetadataLoading] = useState(false);
  const [loadedSearchUrl, setLoadedSearchUrl] = useState("");
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [downloadUrl, setDownloadUrl] = useState("");
  const [jobMessage, setJobMessage] = useState("");
  const [accountId, setAccountId] = useState(initialAccountId || auth.activeAccount?.id || auth.accounts[0]?.id || "");
  const [playlists, setPlaylists] = useState<YouTubePlaylistSummary[]>([]);
  const [playlistMode, setPlaylistMode] = useState<PlaylistMode>("none");
  const [targetPlaylistId, setTargetPlaylistId] = useState("");
  const [createPlaylistTitle, setCreatePlaylistTitle] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [privacyStatus, setPrivacyStatus] = useState("private");
  const [layout, setLayout] = useState<"vertical" | "landscape">("vertical");
  const [minMinutes, setMinMinutes] = useState<number | "">("");
  const [maxMinutes, setMaxMinutes] = useState<number | "">("");
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [panelTab, setPanelTab] = useState<CompilePanelTab>("settings");
  const [sourceReturnTo, setSourceReturnTo] = useState(() => initialClipId ? nestedCompileReturnTo(initialReturnTo) : initialReturnTo);
  const [backTarget, setBackTarget] = useState(initialReturnTo);
  const searchPrefetchRef = useRef<SearchPrefetch | null>(null);
  const probedMetadataIdsRef = useRef<Set<string>>(new Set());
  const mountedRef = useRef(true);
  const resultsScrollRef = useRef<HTMLElement>(null);
  const locallyHandledHrefRef = useRef("");
  const lastRouteKeyRef = useRef("");
  const routeLoadSequenceRef = useRef(0);

  useEffect(() => () => {
    mountedRef.current = false;
  }, []);

  const account = useMemo<ConnectedYouTubeAccount | null>(() => auth.accounts.find((item) => item.id === accountId) || auth.activeAccount || auth.accounts[0] || null, [accountId, auth.accounts, auth.activeAccount]);
  const sortedVideos = useMemo(() => sortVideos(playlist?.videos || [], sort), [playlist?.videos, sort]);
  const selectedVideos = useMemo(() => sortedVideos.filter((video) => selectedIds.has(video.id)), [selectedIds, sortedVideos]);
  const totalSeconds = useMemo(() => selectedVideos.reduce((sum, video) => sum + durationSeconds(video), 0), [selectedVideos]);
  const unknownSelectedDurations = useMemo(() => selectedVideos.filter((video) => !durationSeconds(video)).length, [selectedVideos]);
  const estimatedTotalSeconds = useMemo(() => selectedVideos.reduce((sum, video) => sum + (durationSeconds(video) || 60), 0), [selectedVideos]);
  const minTargetMinutes = typeof minMinutes === "number" && Number.isFinite(minMinutes) ? minMinutes : 0;
  const maxTargetMinutes = typeof maxMinutes === "number" && Number.isFinite(maxMinutes) ? maxMinutes : 0;
  const targetSeconds = maxTargetMinutes > 0 ? maxTargetMinutes * 60 : Number.POSITIVE_INFINITY;
  const targetLabel = minTargetMinutes || maxTargetMinutes ? `${minTargetMinutes || ""}${minTargetMinutes && maxTargetMinutes ? "-" : ""}${maxTargetMinutes || ""}m` : "";

  const makeCompilationLink = useCallback((options: {
    mode?: CompilationSourceMode;
    query?: string;
    count?: number;
    loaded?: number;
    sort?: CompilationSortMode;
    clipId?: string;
    returnTo?: string | null;
  } = {}): TikTokDeepLink => {
    const nextQuery = (options.query ?? url).trim();
    const nextCount = clampClipCount(options.count ?? count);
    const loaded = options.loaded ?? playlist?.videos.length ?? initialLoaded;
    return {
      view: "compile",
      compileMode: options.mode ?? sourceMode,
      compileQuery: nextQuery || undefined,
      compileCount: nextQuery ? nextCount : undefined,
      compileLoaded: nextQuery && loaded ? Math.min(nextCount, clampClipCount(loaded, nextCount)) : undefined,
      compileSort: options.sort ?? sort,
      compileClipId: options.clipId || undefined,
      returnTo: options.returnTo === null ? undefined : (options.returnTo ?? sourceReturnTo) || undefined,
    };
  }, [count, initialLoaded, playlist?.videos.length, sort, sourceMode, sourceReturnTo, url]);

  const currentSourceHref = useCallback((options: {
    mode?: CompilationSourceMode;
    query?: string;
    count?: number;
    loaded?: number;
    sort?: CompilationSortMode;
    returnTo?: string | null;
  } = {}) => buildDeepLinkHref(makeCompilationLink({ ...options, clipId: "" })), [makeCompilationLink]);

  const writeCompilationLink = useCallback((link: TikTokDeepLink, replace = false) => {
    if (embedded) return;
    const href = buildDeepLinkHref(link);
    locallyHandledHrefRef.current = href === currentAppPath() ? "" : href;
    writeDeepLink(link, replace);
  }, [embedded]);

  const rememberCurrentSource = useCallback((options: {
    playlist?: TikTokPlaylist | null;
    selectedIds?: Set<string>;
    mode?: CompilationSourceMode;
    query?: string;
    count?: number;
    loadedSearchUrl?: string;
    sort?: CompilationSortMode;
    returnTo?: string | null;
    title?: string;
    description?: string;
    scrollTop?: number;
  } = {}): string => {
    const nextPlaylist = options.playlist === undefined ? playlist : options.playlist;
    const nextQuery = (options.query ?? url).trim();
    if (!nextPlaylist || !nextQuery) return "";
    const nextMode = options.mode ?? sourceMode;
    const nextCount = clampClipCount(options.count ?? count);
    const nextSort = options.sort ?? sort;
    const href = currentSourceHref({
      mode: nextMode,
      query: nextQuery,
      count: nextCount,
      loaded: nextPlaylist.videos.length,
      sort: nextSort,
      returnTo: options.returnTo,
    });
    const previous = compilationSnapshots.get(href);
    rememberCompilationSnapshot(href, {
      playlist: nextPlaylist,
      selectedIds: Array.from(options.selectedIds ?? selectedIds),
      mode: nextMode,
      query: nextQuery,
      count: nextCount,
      loadedSearchUrl: options.loadedSearchUrl ?? loadedSearchUrl,
      sort: nextSort,
      title: options.title ?? title,
      description: options.description ?? description,
      postAnalyses,
      scrollTop: options.scrollTop ?? resultsScrollRef.current?.scrollTop ?? previous?.scrollTop ?? 0,
    });
    return href;
  }, [count, currentSourceHref, description, loadedSearchUrl, playlist, postAnalyses, selectedIds, sort, sourceMode, title, url]);

  function startSearchPrefetch(source: string, loadedCount: number, targetCount = count) {
    const nextCount = Math.min(targetCount, loadedCount + SEARCH_PAGE_SIZE);
    if (!source || nextCount <= loadedCount) {
      searchPrefetchRef.current = null;
      return;
    }
    const existing = searchPrefetchRef.current;
    if (existing?.url === source && existing.count >= nextCount) return;
    const promise = fetchTikTokPlaylist(source, nextCount, undefined, { forceNetwork: true });
    const prefetch = { url: source, count: nextCount, promise };
    searchPrefetchRef.current = prefetch;
    void promise.catch(() => {
      if (searchPrefetchRef.current === prefetch) searchPrefetchRef.current = null;
    });
  }

  const loadPlaylists = useCallback(async (nextAccountId = accountId) => {
    if (!nextAccountId) {
      setPlaylists([]);
      return;
    }
    try {
      const response = await fetch(`/api/youtube/playlists?accountId=${encodeURIComponent(nextAccountId)}`);
      const data = await readApiJson(response, "Could not load YouTube playlists");
      setPlaylists(data.playlists || []);
    } catch {
      setPlaylists([]);
    }
  }, [accountId]);

  useEffect(() => {
    const effectiveRouteKey = routeKey || `${initialMode}:${initialQuery}:${initialCount}:${initialLoaded || ""}:${initialSort}:${initialClipId}:${initialReturnTo}`;
    if (effectiveRouteKey === lastRouteKeyRef.current) return;
    lastRouteKeyRef.current = effectiveRouteKey;

    if (locallyHandledHrefRef.current === currentAppPath()) {
      locallyHandledHrefRef.current = "";
      return;
    }
    locallyHandledHrefRef.current = "";

    const sequence = ++routeLoadSequenceRef.current;
    const routeMode = initialMode || "url";
    const routeQuery = initialQuery.trim();
    const routeCount = clampClipCount(initialCount);
    const routeSort = initialSort || "views";
    const routeLoaded = initialLoaded ? Math.min(routeCount, clampClipCount(initialLoaded, routeCount)) : undefined;
    const routeSourceReturnTo = initialClipId ? nestedCompileReturnTo(initialReturnTo) : initialReturnTo;
    const reconstructedSourceHref = buildDeepLinkHref({
      view: "compile",
      compileMode: routeMode,
      compileQuery: routeQuery || undefined,
      compileCount: routeQuery ? routeCount : undefined,
      compileLoaded: routeQuery ? routeLoaded : undefined,
      compileSort: routeSort,
      returnTo: routeSourceReturnTo || undefined,
    });
    const sourceHref = initialClipId && initialReturnTo.startsWith("/compile")
      ? initialReturnTo
      : reconstructedSourceHref;

    setSourceMode(routeMode);
    setUrl(routeQuery);
    setCount(routeCount);
    setSort(routeSort);
    setSourceReturnTo(routeSourceReturnTo);
    setBackTarget(initialClipId ? (initialReturnTo || sourceHref) : initialReturnTo);
    setPreviewError("");
    setAnalysisError("");

    if (!routeQuery) {
      searchPrefetchRef.current = null;
      probedMetadataIdsRef.current.clear();
      setPlaylist(null);
      setLoadedSearchUrl("");
      setSelectedIds(new Set());
      setPreviewVideo(null);
      setNotice("");
      setError("");
      setLoading(false);
      return;
    }

    const snapshot = compilationSnapshots.get(sourceHref);
    if (snapshot) {
      setPlaylist(snapshot.playlist);
      setSelectedIds(new Set(snapshot.selectedIds));
      setLoadedSearchUrl(snapshot.loadedSearchUrl);
      setTitle(snapshot.title);
      setDescription(snapshot.description);
      setPostAnalyses(snapshot.postAnalyses);
      const requestedClip = initialClipId
        ? snapshot.playlist.videos.find((video) => videoRouteId(video) === initialClipId) || null
        : null;
      setPreviewVideo(requestedClip);
      setNotice(initialClipId && !requestedClip ? "That clip is no longer in these results. Showing the source instead." : "");
      setError("");
      setLoading(false);
      window.requestAnimationFrame(() => {
        if (resultsScrollRef.current) resultsScrollRef.current.scrollTop = snapshot.scrollTop;
      });
      return;
    }

    const source = routeMode === "search" ? searchTermToTikTokUrl(routeQuery) : routeQuery;
    const fetchCount = routeLoaded || (routeMode === "search" ? Math.min(routeCount, SEARCH_PAGE_SIZE) : routeCount);
    setLoading(true);
    setError("");
    setNotice("Restoring source…");
    void fetchTikTokPlaylist(source, fetchCount, undefined, { forceNetwork: true })
      .then((data) => {
        if (!mountedRef.current || sequence !== routeLoadSequenceRef.current) return;
        searchPrefetchRef.current = null;
        probedMetadataIdsRef.current.clear();
        setPlaylist(data);
        setLoadedSearchUrl(routeMode === "search" ? source : "");
        setSelectedIds(new Set());
        const requestedClip = initialClipId
          ? data.videos.find((video) => videoRouteId(video) === initialClipId) || null
          : null;
        setPreviewVideo(requestedClip);
        const nextTitle = `${data.title || data.author || "AutoYT"} compilation`.slice(0, 100);
        const nextDescription = `A curated compilation from ${data.title || data.author || "selected clips"}.`;
        setTitle(nextTitle);
        setDescription(nextDescription);
        setNotice(initialClipId && !requestedClip
          ? "That clip is no longer in these results. Showing the source instead."
          : `Restored ${data.videos.length} clips.`);
        rememberCompilationSnapshot(sourceHref, {
          playlist: data,
          selectedIds: [],
          mode: routeMode,
          query: routeQuery,
          count: routeCount,
          loadedSearchUrl: routeMode === "search" ? source : "",
          sort: routeSort,
          title: nextTitle,
          description: nextDescription,
          postAnalyses: {},
          scrollTop: 0,
        });
        void loadPlaylists(accountId);
        if (routeMode === "search") startSearchPrefetch(source, data.videos.length, routeCount);
      })
      .catch((err) => {
        if (!mountedRef.current || sequence !== routeLoadSequenceRef.current) return;
        setPlaylist(null);
        setPreviewVideo(null);
        setError(err instanceof Error ? err.message : "Could not restore compilation source");
        setNotice("");
      })
      .finally(() => {
        if (mountedRef.current && sequence === routeLoadSequenceRef.current) setLoading(false);
      });
  }, [accountId, initialClipId, initialCount, initialLoaded, initialMode, initialQuery, initialReturnTo, initialSort, loadPlaylists, routeKey]);

  useEffect(() => {
    if (!playlist || !url.trim()) return;
    rememberCurrentSource();
  }, [playlist, rememberCurrentSource, selectedIds]);

  useEffect(() => {
    const candidates = (playlist?.videos || [])
      .filter((video) => {
        const key = String(video.id || video.playUrl || "").trim();
        if (!key || probedMetadataIdsRef.current.has(key)) return false;
        return !durationSeconds(video) || videoViews(video) <= 0 || !(video.cleanPlaybackUrls || []).length;
      })
      .slice(0, 50);
    if (!candidates.length) {
      setMetadataLoading(false);
      return;
    }
    candidates.forEach((video) => probedMetadataIdsRef.current.add(String(video.id || video.playUrl || "").trim()));
    let cancelled = false;
    setMetadataLoading(true);
    void fetch("/api/tiktok/probe-dimensions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ videos: candidates }),
    })
      .then(async (response) => {
        const data = (await response.json().catch(() => ({}))) as {
          results?: Array<Partial<TikTokVideo> & { key?: string; error?: string }>;
        };
        if (!response.ok || !Array.isArray(data.results)) throw new Error("Could not verify clip metadata");
        if (cancelled) return;
        const byId = new Map(data.results.map((result) => [String(result.id || result.key || ""), result]));
        setPlaylist((current) => current ? {
          ...current,
          videos: current.videos.map((video) => {
            const result = byId.get(String(video.id || video.playUrl || ""));
            if (!result) return video;
            return {
              ...video,
              durationSeconds: Number(result.durationSeconds || video.durationSeconds || 0),
              width: Number(result.width || video.width || 0),
              height: Number(result.height || video.height || 0),
              dynamicCover: String(result.dynamicCover || video.dynamicCover || ""),
              author: String(result.author || video.author || ""),
              authorHandle: String(result.authorHandle || video.authorHandle || ""),
              createdAt: Number(result.createdAt || video.createdAt || 0),
              cleanPlaybackUrls: Array.isArray(result.cleanPlaybackUrls) && result.cleanPlaybackUrls.length
                ? result.cleanPlaybackUrls
                : video.cleanPlaybackUrls,
              stats: {
                ...video.stats,
                ...(result.stats || {}),
              },
            };
          }),
        } : current);
      })
      .catch(() => {
        if (!cancelled) setMetadataLoading(false);
      })
      .finally(() => {
        if (!cancelled) setMetadataLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [playlist?.videos]);

  async function loadSource(event: FormEvent) {
    event.preventDefault();
    const sequence = ++routeLoadSequenceRef.current;
    const query = url.trim();
    const requestedCount = clampClipCount(count);
    const source = sourceMode === "search" ? searchTermToTikTokUrl(query) : query;
    if (!source) return;
    setCount(requestedCount);
    setLoading(true);
    setError("");
    setNotice("");
    try {
      const initialCount = sourceMode === "search" ? Math.min(requestedCount, SEARCH_PAGE_SIZE) : requestedCount;
      const data = await fetchTikTokPlaylist(source, initialCount, undefined, { forceNetwork: true });
      if (sequence !== routeLoadSequenceRef.current) return;
      searchPrefetchRef.current = null;
      probedMetadataIdsRef.current.clear();
      setPlaylist(data);
      setLoadedSearchUrl(sourceMode === "search" ? source : "");
      setSort("views");
      setSourceReturnTo("");
      setBackTarget("");
      setSelectedIds(new Set());
      setPreviewVideo(null);
      setPreviewError("");
      setAnalysisError("");
      const nextTitle = `${data.title || data.author || "AutoYT"} compilation`.slice(0, 100);
      const nextDescription = `A curated compilation from ${data.title || data.author || "selected clips"}.`;
      if (!title.trim()) setTitle(nextTitle);
      if (!description.trim()) setDescription(nextDescription);
      setNotice(data.warning || (sourceMode === "search" && data.videos.length < requestedCount
        ? `Loaded ${data.videos.length} of ${requestedCount} clips. Load more when you are ready.`
        : `Loaded ${data.videos.length} clips.`));
      const link = makeCompilationLink({
        mode: sourceMode,
        query,
        count: requestedCount,
        loaded: data.videos.length,
        sort: "views",
        clipId: "",
        returnTo: null,
      });
      const href = buildDeepLinkHref(link);
      rememberCompilationSnapshot(href, {
        playlist: data,
        selectedIds: [],
        mode: sourceMode,
        query,
        count: requestedCount,
        loadedSearchUrl: sourceMode === "search" ? source : "",
        sort: "views",
        title: title.trim() ? title : nextTitle,
        description: description.trim() ? description : nextDescription,
        postAnalyses,
        scrollTop: 0,
      });
      writeCompilationLink(link);
      void loadPlaylists(accountId);
      if (sourceMode === "search") startSearchPrefetch(source, data.videos.length, requestedCount);
    } catch (err) {
      if (sequence === routeLoadSequenceRef.current) setError(err instanceof Error ? err.message : "Could not load clips");
    } finally {
      if (sequence === routeLoadSequenceRef.current) setLoading(false);
    }
  }

  async function loadMoreSearchResults() {
    if (!playlist || !loadedSearchUrl || loadingMore || playlist.videos.length >= count) return;
    const currentCount = playlist.videos.length;
    const nextCount = Math.min(count, currentCount + SEARCH_PAGE_SIZE);
    setLoadingMore(true);
    setError("");
    setNotice("");
    try {
      const prefetch = searchPrefetchRef.current;
      const data = prefetch?.url === loadedSearchUrl && prefetch.count >= nextCount
        ? await prefetch.promise
        : await fetchTikTokPlaylist(loadedSearchUrl, nextCount, undefined, { forceNetwork: true });
      if (searchPrefetchRef.current === prefetch) searchPrefetchRef.current = null;
      const videos = mergeTikTokVideos(playlist.videos, data.videos, nextCount);
      const nextPlaylist = { ...data, videos };
      setPlaylist(nextPlaylist);
      const added = videos.length - currentCount;
      if (added > 0) {
        setNotice(videos.length < count
          ? `Loaded ${videos.length} of ${count} clips.`
          : `Loaded all ${videos.length} clips.`);
      } else {
        setNotice(`No new clips were available yet. ${videos.length} of ${count} are loaded.`);
      }
      startSearchPrefetch(loadedSearchUrl, videos.length);
      rememberCurrentSource({ playlist: nextPlaylist, loadedSearchUrl });
      writeCompilationLink(makeCompilationLink({ loaded: videos.length, clipId: "" }), true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load more clips");
    } finally {
      setLoadingMore(false);
    }
  }

  async function loadChannelVideos(video: TikTokVideo) {
    const profileUrl = channelListingUrl(video);
    if (!profileUrl) {
      setError("No channel handle found for this clip.");
      return;
    }
    setLoading(true);
    setError("");
    setNotice("");
    try {
      const returnHref = sourceReturnTo || rememberCurrentSource() || currentSourceHref();
      const seedVideoUrl = video.playUrl || (video.authorHandle && video.id ? `https://www.tiktok.com/@${video.authorHandle.replace(/^@/, "")}/video/${video.id}` : "");
      const data = await fetchTikTokPlaylist(profileUrl, count, seedVideoUrl, { forceNetwork: true });
      searchPrefetchRef.current = null;
      probedMetadataIdsRef.current.clear();
      setPlaylist(data);
      setLoadedSearchUrl("");
      setSort("views");
      setUrl(profileUrl);
      setSourceMode("url");
      setSourceReturnTo(returnHref);
      setBackTarget(returnHref);
      setSelectedIds(new Set());
      setPreviewVideo(null);
      setPreviewError("");
      setAnalysisError("");
      const nextTitle = `${data.author || data.title || "Creator"} compilation`.slice(0, 100);
      const nextDescription = `A curated compilation from ${data.author || data.title || "this creator"}.`;
      setTitle(nextTitle);
      setDescription(nextDescription);
      setNotice(`Loaded ${data.videos.length} clips from ${data.author || video.author || "creator"}.`);
      const link = makeCompilationLink({
        mode: "url",
        query: profileUrl,
        count,
        loaded: data.videos.length,
        sort: "views",
        clipId: "",
        returnTo: returnHref,
      });
      const href = buildDeepLinkHref(link);
      rememberCompilationSnapshot(href, {
        playlist: data,
        selectedIds: [],
        mode: "url",
        query: profileUrl,
        count: clampClipCount(count),
        loadedSearchUrl: "",
        sort: "views",
        title: nextTitle,
        description: nextDescription,
        postAnalyses,
        scrollTop: 0,
      });
      writeCompilationLink(link);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load channel videos");
    } finally {
      setLoading(false);
    }
  }

  function toggleClip(video: TikTokVideo) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(video.id)) next.delete(video.id);
      else next.add(video.id);
      return next;
    });
  }

  function openPreview(video: TikTokVideo) {
    const parentHref = rememberCurrentSource() || currentSourceHref();
    setBackTarget(parentHref);
    setPreviewVideo(video);
    setPreviewError("");
    setAnalysisError("");
    writeCompilationLink(makeCompilationLink({ clipId: videoRouteId(video), returnTo: parentHref }));
  }

  function changeSort(nextSort: SortMode) {
    setSort(nextSort);
    if (!playlist || !url.trim()) return;
    rememberCurrentSource({ sort: nextSort });
    writeCompilationLink(makeCompilationLink({ sort: nextSort, clipId: "" }), true);
  }

  async function analyzePreviewVideo(video: TikTokVideo) {
    if (analyzingVideoId === video.id) return;
    setAnalyzingVideoId(video.id);
    setAnalysisError("");
    try {
      const result = await identifyTikTokVideoMovie(video);
      setPostAnalyses((prev) => ({ ...prev, [video.id]: { result, analyzedAt: Date.now() } }));
    } catch (err) {
      setAnalysisError(err instanceof Error ? err.message : "Movie analysis failed");
    } finally {
      setAnalyzingVideoId("");
    }
  }

  function selectUntilTarget() {
    const next = new Set<string>();
    let total = 0;
    for (const video of sortedVideos) {
      const seconds = durationSeconds(video) || 60;
      if (Number.isFinite(targetSeconds) && next.size && total + seconds > targetSeconds) continue;
      next.add(video.id);
      total += seconds;
      if (minTargetMinutes > 0 && total >= minTargetMinutes * 60) break;
    }
    setSelectedIds(next);
  }

  async function createCompilation() {
    if (!account) {
      setError("Connect a YouTube channel first.");
      return;
    }
    if (!selectedVideos.length) {
      setError("Select clips before creating a compilation.");
      return;
    }
    setProcessing(true);
    setError("");
    setNotice("");
    setDownloadUrl("");
    setJobMessage("");
    try {
      const response = await fetch("/api/compilations/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId: account?.id || "",
          videos: selectedVideos,
          sourceTitle: playlist?.title || playlist?.author || "",
          title: title.trim(),
          description: description.trim(),
          privacyStatus,
          layout,
          playlistId: playlistMode === "existing" ? targetPlaylistId : "",
          createPlaylistTitle: playlistMode === "create" ? createPlaylistTitle : "",
          minMinutes: minTargetMinutes || "",
          maxMinutes: maxTargetMinutes || "",
          maxClips: selectedVideos.length,
          outputMode: "upload",
          rightsConfirmed,
        }),
      });
      const data = await readApiJson(response, "Could not create compilation");
      if (data.job?.id) {
        setJobMessage(data.job.message || "Compilation queued");
        announceBackgroundProcess();
        await pollCompilationJob(data.job.id);
      } else {
        handleCompilationResult(data.result);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create compilation");
    } finally {
      setProcessing(false);
    }
  }

  function handleCompilationResult(result: any) {
    const uploadedTitle = result?.upload?.title || "Compilation";
    const uploadedUrl = result?.upload?.url || "";
    const measuredLength = Number(result?.totalSeconds || 0) > 0 ? ` (${formatDuration(Number(result.totalSeconds))})` : "";
    setNotice(uploadedUrl ? `${uploadedTitle}${measuredLength} uploaded: ${uploadedUrl}` : `${uploadedTitle}${measuredLength} uploaded.`);
  }

  async function pollCompilationJob(jobId: string) {
    for (let attempt = 0; attempt < 4320; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, attempt < 6 ? 3000 : 5000));
      if (!mountedRef.current) return;
      const response = await fetch(`/api/compilations/jobs/${encodeURIComponent(jobId)}`);
      const data = await readApiJson(response, "Could not load compilation progress");
      const job: CompilationJob | undefined = data.job;
      if (!job) throw new Error("Compilation job not found");
      setJobMessage(job.message || job.status);
      if (job.status === "done") {
        handleCompilationResult(job.result);
        return;
      }
      if (job.status === "error") {
        throw new Error(job.error || job.message || "Compilation failed");
      }
    }
    throw new Error("Compilation is still running. You can return to this page later to check it.");
  }

  if (playlist && previewVideo) {
    return (
      <CompilationPreview
        video={previewVideo}
        selected={selectedIds.has(previewVideo.id)}
        analysis={postAnalyses[previewVideo.id]}
        analyzing={analyzingVideoId === previewVideo.id}
        analysisError={analysisError}
        previewError={previewError}
        onPreviewError={setPreviewError}
        onBack={() => {
          setPreviewVideo(null);
          setPreviewError("");
          setAnalysisError("");
          if (!embedded) navigateBack(backTarget, currentSourceHref());
        }}
        onToggle={() => toggleClip(previewVideo)}
        onAnalyze={() => void analyzePreviewVideo(previewVideo)}
        onOpenChannel={() => void loadChannelVideos(previewVideo)}
      />
    );
  }

  return (
    <div className={cn("relative flex h-full min-h-0 flex-col overflow-hidden bg-[#F9F8F6] text-[#1A1A1A]", !embedded && "workspace-floating-shell")}>
      {/* ── Top bar ── */}
      <header className={cn("workspace-floating-header flex min-h-12 flex-wrap items-stretch gap-2 px-3 py-2 sm:items-center sm:px-4", embedded && "border-b border-[#1A1A1A]/8 bg-white")}>
        {backTarget ? (
          <button type="button" onClick={() => navigateBack(backTarget, "/compile")} className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-lg px-2 text-xs font-black text-[#1A1A1A] transition hover:bg-[#1A1A1A]/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f9dc0b]/70">
            <ArrowLeft className="h-4 w-4" />
            {compilationBackLabel(backTarget)}
          </button>
        ) : null}

        {/* URL/Search toggle */}
        <div className="inline-flex shrink-0 rounded-lg border border-[#1A1A1A]/8 bg-[#F9F8F6] p-0.5">
          <button type="button" onClick={() => setSourceMode("url")} className={cn("min-h-10 rounded-md px-3 text-xs font-black transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f9dc0b]/70", sourceMode === "url" ? "bg-white text-[#1A1A1A] shadow-sm" : "text-[#1A1A1A]/45 hover:text-[#1A1A1A]")} aria-pressed={sourceMode === "url"}>URL</button>
          <button type="button" onClick={() => setSourceMode("search")} className={cn("min-h-10 rounded-md px-3 text-xs font-black transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f9dc0b]/70", sourceMode === "search" ? "bg-white text-[#1A1A1A] shadow-sm" : "text-[#1A1A1A]/45 hover:text-[#1A1A1A]")} aria-pressed={sourceMode === "search"}>Search</button>
        </div>

        {/* URL input — takes remaining space */}
        <form onSubmit={loadSource} className={cn("flex min-w-0 flex-1 flex-wrap items-center gap-2 sm:flex-nowrap", embedded && "basis-[min(100%,34rem)]")}>
          <label className="relative min-w-[min(100%,14rem)] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#1A1A1A]/35" />
            <input
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder={sourceMode === "search" ? "Type a TikTok search term, e.g. anime recap" : "Paste TikTok playlist, channel, search, or collection URL"}
              className="h-11 w-full rounded-lg border border-[#1A1A1A]/10 bg-[#F9F8F6] pl-9 pr-4 text-sm font-semibold outline-none transition focus:border-[#f9dc0b] focus:ring-2 focus:ring-[#f9dc0b]/20"
            />
          </label>
          <label className="relative shrink-0">
            <span className="sr-only">Clip count</span>
            <input
              type="number" min={1} max={5000} value={count}
              onChange={(event) => setCount(Number(event.target.value))}
              className="h-11 w-20 rounded-lg border border-[#1A1A1A]/10 bg-[#F9F8F6] px-3 text-sm font-bold outline-none focus:border-[#f9dc0b] focus:ring-2 focus:ring-[#f9dc0b]/20"
              aria-label="Clip count"
              title="Maximum clips to load"
            />
          </label>
          <button type="submit" disabled={loading || !url.trim()} className="inline-flex h-11 shrink-0 items-center gap-2 rounded-lg bg-[#f9dc0b] px-4 text-xs font-black text-[#1A1A1A] shadow-sm transition hover:bg-[#1A1A1A] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f9dc0b]/70 disabled:opacity-50">
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            {sourceMode === "search" ? "Search" : "Load clips"}
          </button>
        </form>

        {/* Stats pills */}
        <div className="ml-auto grid w-full grid-cols-3 gap-2 sm:flex sm:w-auto sm:shrink-0 sm:items-center">
          <MiniStat label="Selected" value={String(selectedVideos.length)} />
          <MiniStat
            label={unknownSelectedDurations ? "Est. selected" : "Selected length"}
            value={`${unknownSelectedDurations ? "~" : ""}${formatDuration(unknownSelectedDurations ? estimatedTotalSeconds : totalSeconds)}`}
          />
          <MiniStat label="Target" value={targetLabel} />
        </div>
      </header>

      {/* Status bar */}
      {(error || notice || metadataLoading || (jobMessage && processing) || downloadUrl) ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-[#1A1A1A]/8 bg-white px-4 py-2 text-xs font-bold">
          {error ? <span className="rounded-lg bg-[#fff9d6] px-3 py-1.5 text-[#6a5b00]">Request error: {error}</span> : null}
          {notice ? <span className="rounded-lg bg-[#fff9d6] px-3 py-1.5 text-[#6a5b00]">{notice}</span> : null}
          {jobMessage && processing ? <span className="inline-flex items-center gap-2 rounded-lg bg-[#f9dc0b]/15 px-3 py-1.5 text-[#1A1A1A]/75"><Loader2 className="h-3.5 w-3.5 animate-spin" />{jobMessage}</span> : null}
          {metadataLoading ? <span className="inline-flex items-center gap-2 text-[#1A1A1A]/45"><Loader2 className="h-3.5 w-3.5 animate-spin" />Updating views and durations</span> : null}
          {downloadUrl ? <a href={downloadUrl} className="rounded-lg bg-[#1A1A1A] px-3 py-1.5 text-white">Download compilation</a> : null}
        </div>
      ) : null}

      <div className={cn(
        "grid min-h-0 flex-1 grid-cols-1 overflow-y-auto",
        embedded
          ? "min-[1120px]:grid-cols-[minmax(0,1fr)_340px] min-[1120px]:overflow-hidden"
          : "lg:grid-cols-[minmax(0,1fr)_360px] lg:overflow-hidden",
      )}>
        <main ref={resultsScrollRef} className={cn(
          "min-h-0 overflow-visible px-3 py-3 sm:px-4 sm:py-4 md:px-5",
          embedded ? "min-[1120px]:overflow-y-auto" : "lg:overflow-y-auto",
        )}>
          {playlist ? (
            <>
              {/* Source header + controls */}
              <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="min-w-0">
                  <p className="text-[11px] font-bold uppercase tracking-widest text-[#f9dc0b]">{playlist.author || "Source"}</p>
                  <h2 className="truncate text-lg font-black text-[#1A1A1A]">{playlist.title || "Selected source"}</h2>
                </div>
                <div className="flex flex-wrap gap-2">
                  <select value={sort} onChange={(event) => changeSort(event.target.value as SortMode)} className="h-11 rounded-lg border border-[#1A1A1A]/10 bg-white px-3 text-xs font-bold outline-none focus:border-[#f9dc0b] focus:ring-2 focus:ring-[#f9dc0b]/20">
                    <option value="views">Views high to low</option>
                    <option value="newest">Newest first</option>
                    <option value="oldest">Oldest first</option>
                    <option value="length">Longest first</option>
                  </select>
                  <button type="button" onClick={selectUntilTarget} className="inline-flex h-11 items-center gap-2 rounded-lg bg-[#f9dc0b] px-4 text-xs font-bold text-[#1A1A1A] transition hover:bg-[#1A1A1A] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f9dc0b]/70">
                    <Sparkles className="h-4 w-4" />
                    Auto-select
                  </button>
                  <button type="button" onClick={() => setSelectedIds(new Set())} className="inline-flex h-11 items-center rounded-lg border border-[#1A1A1A]/10 bg-white px-4 text-xs font-bold text-[#1A1A1A]/60 transition hover:text-[#1A1A1A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f9dc0b]/70">
                    Clear
                  </button>
                </div>
              </div>
              <div className={cn(
                "grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3",
                embedded ? "min-[1120px]:grid-cols-3 2xl:grid-cols-4" : "lg:grid-cols-4 2xl:grid-cols-5",
              )}>
                {sortedVideos.map((video) => {
                  const selected = selectedIds.has(video.id);
                  return (
                    <StandardVideoCard
                      key={video.id}
                      title={video.title || "Untitled clip"}
                      source={video.authorHandle || video.author || "TikTok"}
                      onSourceClick={(event) => {
                        event.stopPropagation();
                        void loadChannelVideos(video);
                      }}
                      meta={`${compact(videoViews(video))} views / ${compact(video.stats?.commentCount)} comments / ${formatDuration(durationSeconds(video))}`}
                      imageUrl={video.dynamicCover}
                      fallback={<div className="grid h-full w-full place-items-center text-[#f9dc0b]"><Film className="h-8 w-8" /></div>}
                      onOpen={() => openPreview(video)}
                      badge={selected ? "Selected" : formatDuration(durationSeconds(video))}
                      topRight={<label className="grid h-11 w-11 place-items-center rounded-lg bg-black/65 text-white shadow-md ring-1 ring-white/20 backdrop-blur-sm" onClick={(event) => event.stopPropagation()} title="Add to compilation">
                          <input type="checkbox" checked={selected} onChange={() => toggleClip(video)} className="h-4 w-4 accent-[#f9dc0b]" aria-label="Add clip to compilation" />
                        </label>}
                      className={selected ? "ring-2 ring-[#f9dc0b]" : undefined}
                    />
                  );
                })}
              </div>
              {loadedSearchUrl ? (
                <div className="flex flex-col items-center gap-2 pb-4 pt-10">
                  {playlist.videos.length < count ? (
                    <button type="button" onClick={() => void loadMoreSearchResults()} disabled={loadingMore} className="inline-flex h-11 items-center gap-2 rounded-lg bg-[#f9dc0b] px-5 text-xs font-black text-[#1A1A1A] transition hover:bg-[#1A1A1A] hover:text-white disabled:opacity-50">
                      {loadingMore ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                      Load {Math.min(SEARCH_PAGE_SIZE, count - playlist.videos.length)} more
                    </button>
                  ) : null}
                  <p className="text-[11px] font-bold text-[#1A1A1A]/35">{playlist.videos.length} of {count} clips loaded</p>
                </div>
              ) : null}
            </>
          ) : (
            <div className="flex h-full min-h-[340px] flex-col items-center justify-center gap-4 text-center">
              <div className="grid h-14 w-14 place-items-center rounded-2xl bg-[#f9dc0b]/10 text-[#f9dc0b]"><Clock3 className="h-6 w-6" /></div>
              <div>
                <h2 className="font-serif text-lg font-bold text-[#1A1A1A]">Load a source to start selecting clips.</h2>
                <p className="mt-1 text-sm text-[#1A1A1A]/45">Paste a URL or search above.</p>
              </div>
            </div>
          )}
        </main>

        <aside className={cn(
          "order-first min-h-0 overflow-visible border-b border-[#1A1A1A]/8 bg-white px-4 py-4",
          embedded
            ? "min-[1120px]:order-none min-[1120px]:overflow-y-auto min-[1120px]:border-b-0 min-[1120px]:border-l"
            : "lg:order-none lg:overflow-y-auto lg:border-b-0 lg:border-l",
        )}>
          <div className="mb-4 flex gap-5 border-b border-[#1A1A1A]/8">
            <button type="button" onClick={() => setPanelTab("settings")} className={cn("border-b-2 pb-3 text-sm font-bold transition", panelTab === "settings" ? "border-[#f9dc0b] text-[#1A1A1A]" : "border-transparent text-[#1A1A1A]/50 hover:text-[#1A1A1A]")}>Settings</button>
            <button type="button" onClick={() => setPanelTab("upload")} className={cn("border-b-2 pb-3 text-sm font-bold transition", panelTab === "upload" ? "border-[#f9dc0b] text-[#1A1A1A]" : "border-transparent text-[#1A1A1A]/50 hover:text-[#1A1A1A]")}>Upload</button>
          </div>

          {panelTab === "settings" ? (
            <div className="grid gap-4">
              <div className="grid grid-cols-2 gap-2">
                <Field label="Min minutes">
                  <input
                    type="number"
                    min={1}
                    max={240}
                    value={minMinutes}
                    onChange={(event) => setMinMinutes(event.target.value === "" ? "" : Number(event.target.value))}
                    className="input bg-white"
                    placeholder="Min"
                  />
                </Field>
                <Field label="Max minutes">
                  <input
                    type="number"
                    min={1}
                    max={300}
                    value={maxMinutes}
                    onChange={(event) => setMaxMinutes(event.target.value === "" ? "" : Number(event.target.value))}
                    className="input bg-white"
                    placeholder="Max"
                  />
                </Field>
              </div>
              <Field label="Format">
                <select value={layout} onChange={(event) => setLayout(event.target.value as "vertical" | "landscape")} className="input bg-white">
                  <option value="vertical">Vertical 9:16</option>
                  <option value="landscape">Landscape 16:9</option>
                </select>
              </Field>
              <label className="flex items-start gap-3 rounded-lg border border-[#f9dc0b]/70 bg-[#f9dc0b]/15 p-3 text-xs font-bold leading-5 text-[#1A1A1A]/75">
                <input type="checkbox" checked={rightsConfirmed} onChange={(event) => setRightsConfirmed(event.target.checked)} className="mt-1" />
                I have rights or permission to compile and upload these clips.
              </label>
              <button type="button" onClick={createCompilation} disabled={processing || !selectedVideos.length || !rightsConfirmed} className="inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-[#f9dc0b] px-5 text-xs font-black text-[#1A1A1A] shadow-sm transition hover:bg-[#1A1A1A] hover:text-white disabled:opacity-45">
                {processing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                Create and upload
              </button>
            </div>
          ) : (
            <div className="grid gap-4">
              <SectionTitle icon={<Youtube className="h-4 w-4" />} title="Upload details" />
              <Field label="Channel">
                <select value={accountId} onChange={(event) => { setAccountId(event.target.value); void loadPlaylists(event.target.value); }} className="input bg-white">
                  {auth.accounts.map((item) => <option key={item.id} value={item.id}>{item.channelTitle}</option>)}
                </select>
              </Field>
              <Field label="Visibility">
                <select value={privacyStatus} onChange={(event) => setPrivacyStatus(event.target.value)} className="input bg-white">
                  <option value="private">Private</option>
                  <option value="unlisted">Unlisted</option>
                  <option value="public">Public</option>
                </select>
              </Field>
              <Field label="YouTube playlist">
                <select value={playlistMode} onChange={(event) => setPlaylistMode(event.target.value as PlaylistMode)} className="input bg-white">
                  <option value="none">No playlist</option>
                  <option value="existing">Existing playlist</option>
                  <option value="create">Create new playlist</option>
                </select>
              </Field>
              {playlistMode === "existing" ? (
                <Field label="Playlist">
                  <select value={targetPlaylistId} onChange={(event) => setTargetPlaylistId(event.target.value)} className="input bg-white">
                    <option value="">Choose playlist</option>
                    {playlists.map((item) => <option key={item.id} value={item.id}>{item.title}{item.videoCount !== undefined ? ` (${item.videoCount})` : ""}</option>)}
                  </select>
                </Field>
              ) : null}
              {playlistMode === "create" ? (
                <Field label="New playlist name">
                  <input value={createPlaylistTitle} onChange={(event) => setCreatePlaylistTitle(event.target.value)} className="input bg-white" placeholder="Anime Recap Compilations" />
                </Field>
              ) : null}
              <Field label="Title"><input value={title} onChange={(event) => setTitle(event.target.value)} className="input bg-white" /></Field>
              <Field label="Description"><textarea value={description} onChange={(event) => setDescription(event.target.value)} className="input min-h-28 bg-white py-3 leading-6" /></Field>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex h-9 min-w-0 flex-col justify-center rounded-lg bg-[#F9F8F6] px-2 sm:min-w-[84px] sm:px-3">
      <p className="text-[9px] font-bold uppercase tracking-widest text-[#1A1A1A]/35">{label}</p>
      <p className="text-sm font-black leading-tight text-[#1A1A1A]">{value}</p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40">{label}</span>
      {children}
    </label>
  );
}

function SectionTitle({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="grid h-8 w-8 place-items-center rounded-lg bg-[#f9dc0b]/10 text-[#f9dc0b]">{icon}</span>
      <h3 className="text-sm font-black text-[#1A1A1A]">{title}</h3>
    </div>
  );
}

function CompilationPreview({
  video,
  selected,
  analysis,
  analyzing,
  analysisError,
  previewError,
  onPreviewError,
  onBack,
  onToggle,
  onAnalyze,
  onOpenChannel,
}: {
  video: TikTokVideo;
  selected: boolean;
  analysis?: SavedPostAnalysis;
  analyzing: boolean;
  analysisError: string;
  previewError: string;
  onPreviewError: (message: string) => void;
  onBack: () => void;
  onToggle: () => void;
  onAnalyze: () => void;
  onOpenChannel: () => void;
}) {
  const postContent = (
    <div className="grid min-w-0 items-start gap-5 overflow-x-clip lg:grid-cols-[minmax(170px,260px)_minmax(0,1fr)]">
      <div className="relative mx-auto aspect-[9/16] max-h-[72vh] w-full max-w-[260px] overflow-hidden rounded-2xl border border-[#1A1A1A]/10 bg-black shadow-2xl">
        <CleanTikTokVideo video={video} onError={onPreviewError} />
      </div>
      <div className="min-w-0 space-y-5 rounded-2xl border border-[#1A1A1A]/8 bg-[#FDFCFA] p-4">
        <div>
          <button type="button" onClick={onOpenChannel} className="inline-flex items-center gap-2 text-xs font-bold text-[#f9dc0b] underline-offset-2 hover:underline">
            <User className="h-3.5 w-3.5" />
            {video.authorHandle || video.author || "Open creator"}
          </button>
          <h2 className="mt-2 break-words font-serif text-xl font-bold leading-snug text-[#1A1A1A] sm:text-2xl">{video.title || "Untitled clip"}</h2>
          {durationSeconds(video) ? (
            <p className="mt-2 inline-flex w-fit items-center gap-1.5 rounded-full bg-[#1A1A1A]/5 px-3 py-1 text-xs font-bold text-[#1A1A1A]/55">
              <Clock3 className="h-3.5 w-3.5" />
              {formatDuration(durationSeconds(video))}
            </p>
          ) : null}
        </div>
        <div className="grid grid-cols-2 gap-3 border-t border-[#1A1A1A]/5 pt-5 sm:grid-cols-4">
          <StatItem icon={<Heart className="h-5 w-5" />} label="Likes" value={video.stats?.diggCount || 0} />
          <StatItem icon={<MessageCircle className="h-5 w-5" />} label="Comments" value={video.stats?.commentCount || 0} />
          <StatItem icon={<Share2 className="h-5 w-5" />} label="Shares" value={video.stats?.shareCount || 0} />
          <StatItem icon={<Play className="h-5 w-5" />} label="Plays" value={video.stats?.playCount || 0} />
        </div>
      </div>
    </div>
  );

  return (
    <section className="workspace-floating-shell relative flex h-full min-h-0 flex-col overflow-hidden bg-white text-[#1A1A1A]">
      <header className="workspace-floating-header flex min-h-12 flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <button type="button" onClick={onBack} className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-lg px-2 text-[#1A1A1A]/55 transition hover:bg-[#F3F4F6] hover:text-[#1A1A1A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f9dc0b]/70" aria-label="Back to clips">
            <ArrowLeft className="h-4 w-4" />
            <span className="hidden text-xs font-black sm:inline">Back to clips</span>
          </button>
          <Scissors className="h-4 w-4 text-[#1A1A1A]/45" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-[#1A1A1A]/10 bg-white px-3 text-xs font-black text-[#1A1A1A]/65">
            <input type="checkbox" checked={selected} onChange={() => onToggle()} className="h-4 w-4 accent-[#f9dc0b]" />
            Add to compilation
          </label>
          <button type="button" onClick={onAnalyze} disabled={analyzing} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-[#f9dc0b] px-4 text-xs font-black text-[#1A1A1A] transition hover:bg-[#1A1A1A] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f9dc0b]/70 disabled:opacity-60">
            {analyzing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
            {analysis ? "Re-analyze" : "Analyze clip"}
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-5">
        {analysis ? (
          <MovieAnalysisTabs result={analysis.result} savedAt={analysis.analyzedAt} compact postContent={postContent} postLabel="Post" initialTab="post" />
        ) : (
          <LockedAnalysisTabs postContent={postContent} loading={analyzing} error={analysisError || previewError} />
        )}
      </div>
    </section>
  );
}

function CleanTikTokVideo({ video, onError }: { video: TikTokVideo; onError: (message: string) => void }) {
  const cacheKey = video.id || video.playUrl || video.dynamicCover || video.title;
  const [src, setSrc] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let objectUrl = "";
    setLoading(true);
    setSrc("");

    const load = async () => {
      try {
        const data = await processTikTokVideo(video);
        let sourceUrl = data.videoUrl || "";
        if (!sourceUrl && data.base64) {
          const bin = atob(data.base64);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          objectUrl = URL.createObjectURL(new Blob([bytes], { type: data.mimeType || "video/mp4" }));
          sourceUrl = objectUrl;
        }
        if (!sourceUrl) throw new Error("Could not load clean video");
        if (!cancelled) setSrc(sourceUrl);
      } catch (err) {
        if (!cancelled) onError(err instanceof Error ? err.message : "Could not load clean video");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [cacheKey, onError, video]);

  if (loading) {
    return (
      <div className="grid h-full w-full place-items-center bg-[#1A1A1A] text-white">
        <Loader2 className="h-7 w-7 animate-spin" />
      </div>
    );
  }

  if (!src) {
    return video.dynamicCover ? <img src={video.dynamicCover} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" /> : <div className="grid h-full w-full place-items-center bg-[#1A1A1A] text-white"><Film className="h-8 w-8" /></div>;
  }

  return <video src={src} poster={video.dynamicCover || undefined} controls playsInline className="h-full w-full object-cover" />;
}

function LockedAnalysisTabs({ postContent, loading, error }: { postContent: ReactNode; loading: boolean; error: string }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-[#1A1A1A]/8 bg-white shadow-sm">
      <div className="flex gap-2 overflow-x-auto border-b border-[#1A1A1A]/8 px-3 pt-3">
        {["Post", "Movie ID", "SEO", "Script", "Comments"].map((item, index) => (
          <button key={item} type="button" disabled className={cn("shrink-0 border-b-2 px-3 py-3 text-xs font-black", index === 0 ? "border-[#f9dc0b] text-[#1A1A1A]" : "border-transparent text-[#1A1A1A]/35")}>
            {item}
          </button>
        ))}
      </div>
      <div className="space-y-4 p-4">
        {postContent}
        <div className={cn("rounded-2xl border p-4 text-sm font-bold", error ? "border-[#f9dc0b]/35 bg-[#fff9d6] text-[#6a5b00]" : "border-[#f9dc0b]/60 bg-[#f9dc0b]/15 text-[#1A1A1A]/70")}>
          {error ? (
            <span className="inline-flex items-center gap-2"><AlertCircle className="h-4 w-4" />{error}</span>
          ) : loading ? (
            <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />Analyzing this clip</span>
          ) : (
            <span className="inline-flex items-center gap-2"><Zap className="h-4 w-4" />Analyze this clip to unlock the same Movie ID tabs used in TikTok Explorer.</span>
          )}
        </div>
      </div>
    </div>
  );
}

function StatItem({ icon, label, value }: { icon: ReactNode; label: string; value: number }) {
  return (
    <div className="rounded-xl bg-white p-3">
      <div className="text-[#f9dc0b]">{icon}</div>
      <p className="mt-2 text-[10px] font-black uppercase tracking-widest text-[#1A1A1A]/35">{label}</p>
      <p className="mt-1 text-sm font-black text-[#1A1A1A]">{compact(value)}</p>
    </div>
  );
}

function Notice({ title, body, tone = "success" }: { title: string; body: string; tone?: "success" | "error" | "info" }) {
  const isError = tone === "error";
  const isInfo = tone === "info";
  return (
    <div className={cn("flex gap-3 rounded-2xl border p-4 text-sm shadow-sm", isError ? "border-[#f9dc0b]/35 bg-[#fff9d6] text-[#6a5b00]" : isInfo ? "border-[#f9dc0b]/60 bg-[#f9dc0b]/15 text-[#1A1A1A]" : "border-[#f9dc0b]/35 bg-[#fff9d6] text-[#6a5b00]")}>
      <div className="mt-0.5 shrink-0">{isError ? <AlertCircle className="h-4 w-4" /> : isInfo ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}</div>
      <div>
        <p className="font-black">{title}</p>
        <p className="mt-1 font-semibold leading-6 opacity-80">{body}</p>
      </div>
    </div>
  );
}
