import { useState, FormEvent, ReactNode, useCallback, useEffect, useRef, useMemo, type MouseEvent } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Search,
  Loader2,
  Play,
  Heart,
  Share2,
  MessageCircle,
  User,
  Film,
  Zap,
  Download,
  Bookmark,
  Trash2,
  Library,
  ListVideo,
  RefreshCw,
  ArrowLeft,
  Clock3,
} from "lucide-react";
import { fetchTikTokPlaylist, TikTokVideo, TikTokPlaylist } from "../services/tiktok";
import { cn } from "../lib/utils";
import { MovieAnalysisTabs } from "./MovieAnalysisTabs";
import {
  getSavedPlaylist,
  getSavedPlaylistBySlug,
  getSavedPostBySlug,
  setSavedPlaylist,
  listSavedPlaylistSummaries,
  removeSavedPlaylist,
  normalizePlaylistListUrl,
  slugifySavedPost,
  slugifySavedPlaylistTitle,
  type SavedPlaylistRecord,
  type SavedPlaylistSummary,
} from "../utils/savedTikTokPlaylists";
import {
  canonicalBareTikTokProfileUrl,
  channelListingUrl,
  handleFromTikTokProfileUrl,
  isBareTikTokProfileUrl,
} from "../utils/tiktokListUrl";
import { writeDeepLink, type ListTab as DeepLinkTab, type TikTokSection } from "../utils/tiktokRoute";
import { identifyMovie } from "../services/gemini";
import type { MovieResult } from "../types";

interface TikTokExplorerProps {
  onAnalyzeVideo?: (videoUrl: string) => void;
  initialUrl?: string;
  initialSlug?: string;
  initialPostSlug?: string;
  autoAnalyze?: boolean;
  initialTab?: DeepLinkTab;
  initialSection?: TikTokSection;
  routeKey?: string;
  theme?: "light" | "dark";
}

const VIDEO_COUNT_MIN = 1;
const VIDEO_COUNT_MAX = 5000;
const VIDEO_COUNT_DEFAULT = 100;
const POST_ANALYSIS_STORAGE_KEY = "movieid-explorer:tiktok-post-analyses";
const cleanVideoUrlCache = new Map<string, string>();

type ListTab = "collection" | "channel";
type VideoSortMode = "views-desc" | "views-asc" | "date-desc" | "date-asc";
type VideoLengthFilter = "all" | "short" | "medium" | "long" | "longform16x9" | "unknown";

interface CachedTikTokList {
  playlist: TikTokPlaylist;
  analyzedUrl: string;
}

interface SavedPostAnalysis {
  result: MovieResult;
  analyzedAt: number;
}

function tikTokSeedVideoUrlFromPlaylist(playlist: TikTokPlaylist | null | undefined): string {
  const videos = Array.isArray(playlist?.videos) ? playlist.videos : [];
  for (const video of videos) {
    const playUrl = video.playUrl?.trim();
    if (playUrl && /tiktok\.com\/@[^/]+\/video\/\d+/i.test(playUrl)) return playUrl;
    const handle = (video.authorHandle || video.uploaderId || "").replace(/^@/, "").trim();
    if (handle && video.id) return `https://www.tiktok.com/@${handle}/video/${video.id}`;
  }
  return "";
}

interface ProcessedTikTokVideo {
  mimeType: string;
  videoUrl?: string;
  base64?: string;
  width?: number;
  height?: number;
}

function clampVideoCount(n: number): number {
  if (!Number.isFinite(n)) return VIDEO_COUNT_DEFAULT;
  return Math.min(VIDEO_COUNT_MAX, Math.max(VIDEO_COUNT_MIN, Math.floor(n)));
}

function formatValue(num: number) {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + "M";
  if (num >= 1000) return (num / 1000).toFixed(1) + "K";
  return num.toString();
}

function videoDomKey(v: TikTokVideo, index?: number): string {
  const id = String(v.id ?? "").trim();
  if (id) return id;
  const u = (v.playUrl || "").trim();
  if (u) return `u:${u}`;
  const i = index ?? 0;
  return `i:${i}:${(v.dynamicCover || "").slice(-24)}:${(v.title || "").slice(0, 20)}`;
}

function videoViewCount(video: TikTokVideo): number {
  return Number(video.stats?.playCount || 0) || 0;
}

function videoCreatedAt(video: TikTokVideo): number {
  const raw = video.createdAt;
  return Number.isFinite(Number(raw)) ? Number(raw) : 0;
}

function videoDurationSeconds(video: TikTokVideo): number {
  const row = video as TikTokVideo & {
    duration?: number | string;
    durationMs?: number | string;
    duration_ms?: number | string;
    durationString?: string;
    duration_string?: string;
  };
  const parse = (value: unknown) => {
    if (typeof value === "string") {
      const raw = value.trim();
      if (/^\d{1,2}(?::\d{1,2}){1,2}$/.test(raw)) {
        const parts = raw.split(":").map((part) => Number(part));
        return parts.length === 2 ? parts[0] * 60 + parts[1] : parts[0] * 3600 + parts[1] * 60 + parts[2];
      }
    }
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return n > 10000 ? Math.round(n / 1000) : Math.round(n);
  };
  return parse(row.durationSeconds) || parse(row.duration) || parse(row.durationString) || parse(row.duration_string) || parse(row.durationMs) || parse(row.duration_ms);
}

function videoDimensions(video: TikTokVideo): { width: number; height: number } {
  const row = video as TikTokVideo & {
    videoWidth?: number | string;
    videoHeight?: number | string;
    playWidth?: number | string;
    playHeight?: number | string;
  };
  const parse = (value: unknown) => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
  };
  return {
    width: parse(row.width) || parse(row.videoWidth) || parse(row.playWidth),
    height: parse(row.height) || parse(row.videoHeight) || parse(row.playHeight),
  };
}

function isLongFormLandscape(video: TikTokVideo): boolean {
  const duration = videoDurationSeconds(video);
  if (duration < 180) return false;
  const { width, height } = videoDimensions(video);
  if (!width || !height || width <= height) return false;
  const ratio = width / height;
  return ratio >= 1.7 && ratio <= 1.86;
}

function formatVideoLength(seconds?: number): string {
  const total = Math.max(0, Math.round(Number(seconds || 0)));
  if (!total) return "";
  const minutes = Math.floor(total / 60);
  const remainder = total % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function filterTikTokVideosByLength(videos: TikTokVideo[], filter: VideoLengthFilter): TikTokVideo[] {
  if (filter === "all") return videos;
  return videos.filter((video) => {
    const duration = videoDurationSeconds(video);
    if (filter === "longform16x9") return isLongFormLandscape(video);
    if (filter === "unknown") return duration <= 0;
    if (duration <= 0) return false;
    if (filter === "short") return duration < 30;
    if (filter === "medium") return duration >= 30 && duration < 60;
    return duration >= 60;
  });
}

function sortTikTokVideos(videos: TikTokVideo[], mode: VideoSortMode): TikTokVideo[] {
  return [...videos].sort((a, b) => {
    if (mode === "views-asc") return videoViewCount(a) - videoViewCount(b) || videoCreatedAt(b) - videoCreatedAt(a);
    if (mode === "date-desc") return videoCreatedAt(b) - videoCreatedAt(a) || videoViewCount(b) - videoViewCount(a);
    if (mode === "date-asc") return videoCreatedAt(a) - videoCreatedAt(b) || videoViewCount(b) - videoViewCount(a);
    return videoViewCount(b) - videoViewCount(a) || videoCreatedAt(b) - videoCreatedAt(a);
  });
}

function readSavedPostAnalyses(): Record<string, SavedPostAnalysis> {
  try {
    const raw = localStorage.getItem(POST_ANALYSIS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, SavedPostAnalysis>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeSavedPostAnalysis(slug: string, analysis: SavedPostAnalysis): void {
  if (!slug) return;
  const all = readSavedPostAnalyses();
  all[slug] = analysis;
  localStorage.setItem(POST_ANALYSIS_STORAGE_KEY, JSON.stringify(all));
}

function cleanTikTokProcessError(message: string): string {
  const raw = String(message || "").trim();
  if (/rebuild it as a video/i.test(raw)) {
    return raw;
  }
  if (/only exposing images|only images are available/i.test(raw)) {
    return "TikTok exposed this recap as photo/slideshow mode and AutoYT could not rebuild it as a video.";
  }
  if (/No clean \d+p TikTok source/i.test(raw)) {
    return raw.split("\n").slice(-1)[0] || "No clean TikTok video source was available for this post.";
  }
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
  const data = (await response.json().catch(() => ({}))) as {
    error?: string;
    details?: string;
    base64?: string;
    videoUrl?: string;
    mimeType?: string;
    width?: number;
    height?: number;
  };
  if (!response.ok) {
    throw new Error(cleanTikTokProcessError(data.details || data.error || "Could not download video"));
  }
  const mimeType = data.mimeType || "video/mp4";
  const width = Number.isFinite(Number(data.width)) ? Math.round(Number(data.width)) : 0;
  const height = Number.isFinite(Number(data.height)) ? Math.round(Number(data.height)) : 0;
  if (data.videoUrl) return { videoUrl: data.videoUrl, mimeType, width, height };
  if (data.base64) return { base64: data.base64, mimeType, width, height };
  throw new Error("Could not download video");
}

async function fetchVideoBlob(video: TikTokVideo): Promise<{ blob: Blob; mimeType: string }> {
  const data = await processTikTokVideo(video);
  const mimeType = data.mimeType || "video/mp4";
  if (data.videoUrl) {
    try {
      const videoResponse = await fetch(data.videoUrl);
      if (!videoResponse.ok) throw new Error("Downloaded video expired before analysis could start.");
      return { blob: await videoResponse.blob(), mimeType };
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

async function downloadTikTokFile(video: TikTokVideo): Promise<void> {
  const data = await processTikTokVideo(video);
  const a = document.createElement("a");
  let objectUrl = "";
  if (data.videoUrl) {
    a.href = data.videoUrl;
  } else if (data.base64) {
    const bin = atob(data.base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    objectUrl = URL.createObjectURL(new Blob([bytes], { type: data.mimeType || "video/mp4" }));
    a.href = objectUrl;
  } else {
    throw new Error("Could not download video");
  }
  a.download = `tiktok_${video.id || Date.now()}.mp4`;
  a.click();
  if (objectUrl) URL.revokeObjectURL(objectUrl);
}

async function tiktokVideoToFile(video: TikTokVideo): Promise<File> {
  const { blob, mimeType } = await fetchVideoBlob(video);
  return new File([blob], `tiktok_${video.id || Date.now()}.mp4`, { type: mimeType });
}

function ThumbnailDownloadButton({
  busy,
  onClick,
  className,
}: {
  busy: boolean;
  onClick: (e: MouseEvent) => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      title={busy ? "Downloading" : "Download video"}
      aria-label="Download video"
      className={cn(
        "inline-flex h-9 min-w-9 items-center justify-center rounded-lg text-white transition-all",
        "bg-[#1A1A1A]/75 shadow-md ring-1 ring-inset ring-white/25 backdrop-blur-sm",
        "hover:bg-[#FF0033] disabled:cursor-wait disabled:opacity-70",
        className,
      )}
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Download className="h-4 w-4" aria-hidden />}
    </button>
  );
}

function TikTokCoverImage({ src, className = "" }: { src?: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  const expired = useMemo(() => {
    if (!src) return false;
    try {
      const parsed = new URL(src);
      const expires = Number(parsed.searchParams.get("x-expires") || 0);
      return expires > 0 && expires * 1000 < Date.now();
    } catch {
      return false;
    }
  }, [src]);
  if (!src || failed || expired) {
    return (
      <div className={cn("grid place-items-center bg-[linear-gradient(145deg,#fff4b8,#f7f6f2_45%,#ffe2e8)] text-[#FF0033]", className)}>
        <Play className="h-8 w-8 fill-current opacity-80" />
      </div>
    );
  }
  return <img src={src} alt="" className={className} referrerPolicy="no-referrer" onError={() => setFailed(true)} />;
}

function CleanTikTokVideo({ video, onError }: { video: TikTokVideo; onError: (message: string) => void }) {
  const cacheKey = videoDomKey(video);
  const [src, setSrc] = useState(() => cleanVideoUrlCache.get(cacheKey) || "");
  const [loading, setLoading] = useState(!cleanVideoUrlCache.has(cacheKey));

  useEffect(() => {
    let cancelled = false;
    const cached = cleanVideoUrlCache.get(cacheKey);
    if (cached) {
      setSrc(cached);
      setLoading(false);
      return;
    }
    setLoading(true);
    const load = async () => {
      try {
        const data = await processTikTokVideo(video);
        let sourceUrl = data.videoUrl || "";
        if (!sourceUrl && data.base64) {
          const bin = atob(data.base64);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          sourceUrl = URL.createObjectURL(new Blob([bytes], { type: data.mimeType || "video/mp4" }));
        }
        if (!sourceUrl) throw new Error("Could not load clean video");
        cleanVideoUrlCache.set(cacheKey, sourceUrl);
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
    };
  }, [cacheKey, onError, video]);

  if (loading) {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black text-white">
        {video.dynamicCover ? (
          <TikTokCoverImage src={video.dynamicCover} className="absolute inset-0 h-full w-full object-cover opacity-35 blur-sm" />
        ) : null}
        <Loader2 className="relative z-10 h-8 w-8 animate-spin" />
        <p className="relative z-10 text-xs font-medium text-white/70">Loading clean video</p>
      </div>
    );
  }

  if (!src) {
    return <TikTokCoverImage src={video.dynamicCover} className="h-full w-full object-cover" />;
  }

  return <video src={src} className="h-full w-full object-contain" controls playsInline preload="metadata" poster={video.dynamicCover || undefined} />;
}

function LockedAnalysisTabs({
  postContent,
  loading,
  error,
}: {
  postContent: ReactNode;
  loading: boolean;
  error: string;
}) {
  const lockedTabs = ["Movie ID", "Transcript", "Story", "Visuals", "Niche", "Evidence", "Details"];
  return (
    <div className="w-full max-w-full overflow-hidden rounded-xl border shadow-sm" style={{ background: "#FDFCFA", borderColor: "rgba(28,26,22,0.08)" }}>
      <div className="border-b p-2" style={{ background: "#F5F4F0", borderColor: "rgba(28,26,22,0.08)" }}>
        <div className="flex gap-1 overflow-x-auto overscroll-x-contain [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <button type="button" className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-[#1C1A16] px-3 py-2 text-xs font-semibold text-white md:px-4">
            <Film className="h-3.5 w-3.5" />
            Post
          </button>
          {lockedTabs.map((label) => (
            <button
              key={label}
              type="button"
              disabled
              title="Analyze this post to unlock"
              className="inline-flex shrink-0 cursor-not-allowed items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold opacity-35 md:px-4"
              style={{ color: "rgba(28,26,22,0.52)" }}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="px-2 pb-1 pt-2 text-xs text-[#1A1A1A]/45">
          Analyze this post to unlock the analysis tabs.
        </p>
      </div>
      <div className="grid gap-5 p-5 md:p-7">
        {postContent}
        {loading && (
          <div className="rounded-xl border border-[#FF0033]/15 bg-[#FF0033]/5 p-5">
            <div className="flex items-center gap-3 text-[#FF0033]">
              <Loader2 className="h-4 w-4 animate-spin" />
              <p className="text-sm font-semibold">Analyzing movie inside this post</p>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-[#1A1A1A]/55">Downloading the clip, identifying the title, then enriching the result with TMDB or MyAnimeList.</p>
          </div>
        )}
        {!loading && (
          <div className="rounded-xl border border-dashed border-[#1A1A1A]/10 bg-[#F9F8F6] p-5">
            <p className="text-sm font-semibold text-[#FF0033]">Analysis tabs are locked</p>
            <p className="mt-2 text-sm leading-relaxed text-[#1A1A1A]/55">Analyze this clip to unlock Movie ID, transcript, story, visuals, niche, evidence, and details.</p>
            {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
          </div>
        )}
      </div>
    </div>
  );
}

export default function TikTokExplorer({
  initialUrl = "",
  initialSlug = "",
  initialPostSlug = "",
  autoAnalyze = false,
  initialTab,
  initialSection = "analyze",
  routeKey = "",
  theme = "light",
}: TikTokExplorerProps) {
  const [mainTab, setMainTab] = useState<"analyze" | "saved">(initialSection === "saved" ? "saved" : "analyze");
  const [url, setUrl] = useState("");
  const [videoCount, setVideoCount] = useState(VIDEO_COUNT_DEFAULT);
  const [loadingTarget, setLoadingTarget] = useState<null | ListTab>(null);
  const [collectionCache, setCollectionCache] = useState<CachedTikTokList | null>(null);
  const [channelCache, setChannelCache] = useState<CachedTikTokList | null>(null);
  const [listTab, setListTab] = useState<ListTab>(initialTab || "collection");
  const [error, setError] = useState<string | null>(null);
  const [selectedVideo, setSelectedVideo] = useState<TikTokVideo | null>(null);
  const [viewMode, setViewMode] = useState<"focused" | "grid">("grid");
  const [saveNotice, setSaveNotice] = useState("");
  const [loadedFromSaved, setLoadedFromSaved] = useState(false);
  const [savedSummaries, setSavedSummaries] = useState<SavedPlaylistSummary[]>([]);
  const [downloadingIds, setDownloadingIds] = useState<Record<string, boolean>>({});
  const [reprocessingKeys, setReprocessingKeys] = useState<Record<string, boolean>>({});
  const [postAnalyses, setPostAnalyses] = useState<Record<string, SavedPostAnalysis>>(() => readSavedPostAnalyses());
  const [analyzingPostSlug, setAnalyzingPostSlug] = useState("");
  const [analysisError, setAnalysisError] = useState("");
  const [videoSortMode, setVideoSortMode] = useState<VideoSortMode>("views-desc");
  const [videoLengthFilter, setVideoLengthFilter] = useState<VideoLengthFilter>("all");
  const [dimensionProbeBusy, setDimensionProbeBusy] = useState(false);
  const [dimensionProbeKey, setDimensionProbeKey] = useState("");

  const playlist = listTab === "collection" ? collectionCache?.playlist ?? null : channelCache?.playlist ?? null;
  const analyzedUrl = listTab === "collection" ? collectionCache?.analyzedUrl ?? "" : channelCache?.analyzedUrl ?? "";
  const filteredVideos = useMemo(() => filterTikTokVideosByLength(playlist?.videos || [], videoLengthFilter), [playlist?.videos, videoLengthFilter]);
  const sortedVideos = useMemo(() => sortTikTokVideos(filteredVideos, videoSortMode), [filteredVideos, videoSortMode]);
  const loading = loadingTarget !== null;
  const selectedPostSlug = selectedVideo ? slugifySavedPost(selectedVideo) : "";
  const selectedPostAnalysis = selectedPostSlug ? postAnalyses[selectedPostSlug] : undefined;
  const selectedPostAnalyzing = !!selectedPostSlug && analyzingPostSlug === selectedPostSlug;
  const channelTabHandle = channelCache || loadingTarget === "channel" ? handleFromTikTokProfileUrl(channelCache?.analyzedUrl || url) : "";

  const patchOpenPlaylistVideos = useCallback((target: ListTab, updater: (videos: TikTokVideo[]) => TikTokVideo[]) => {
    const apply = (prev: CachedTikTokList | null): CachedTikTokList | null => {
      if (!prev) return prev;
      return { ...prev, playlist: { ...prev.playlist, videos: updater(prev.playlist.videos) } };
    };
    if (target === "channel") setChannelCache(apply);
    else setCollectionCache(apply);
  }, []);

  const refreshSaved = useCallback(async () => {
    try {
      setSavedSummaries(await listSavedPlaylistSummaries());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Saved playlist database unavailable");
      setSavedSummaries([]);
    }
  }, []);

  const routeSlugForList = useCallback((tab: ListTab, analyzed: string, playlistTitle?: string) => {
    const profileHandle = analyzed.match(/tiktok\.com\/@([^/?#]+)/i)?.[1] || "";
    const collectionSegment = analyzed.match(/\/(?:collection|collections|playlist|playlists?|mix)\/([^/?#]+)/i)?.[1] || "";
    if (tab === "collection" && collectionSegment) return slugifySavedPlaylistTitle(decodeURIComponent(collectionSegment.replace(/\+/g, " ")).replace(/[-_\s]*\d{8,30}$/g, ""));
    if (tab === "channel" && profileHandle) return slugifySavedPlaylistTitle(profileHandle);
    return slugifySavedPlaylistTitle(playlistTitle || profileHandle || "playlist");
  }, []);

  const focusSavedPost = useCallback((record: SavedPlaylistRecord, videoIndex: number): boolean => {
    if (!record?.playlist?.videos?.[videoIndex]) return false;
    const profileOnly = isBareTikTokProfileUrl(record.analyzedUrl);
    const target: ListTab = profileOnly ? "channel" : "collection";
    setMainTab("analyze");
    setLoadedFromSaved(true);
    setError(null);
    setUrl(record.analyzedUrl);
    setListTab(target);
    setViewMode("focused");
    if (target === "channel") setChannelCache({ playlist: record.playlist, analyzedUrl: record.analyzedUrl });
    else setCollectionCache({ playlist: record.playlist, analyzedUrl: record.analyzedUrl });
    setSelectedVideo(record.playlist.videos[videoIndex] ?? null);
    return true;
  }, []);

  const findLoadedPost = useCallback((postSlug: string): { record: SavedPlaylistRecord; videoIndex: number } | null => {
    const wanted = slugifySavedPlaylistTitle(postSlug);
    const candidates = [collectionCache, channelCache].filter(Boolean) as CachedTikTokList[];
    for (const candidate of candidates) {
      const videoIndex = candidate.playlist.videos.findIndex((video) => slugifySavedPost(video) === wanted);
      if (videoIndex >= 0) {
        return {
          record: {
            playlist: candidate.playlist,
            analyzedUrl: candidate.analyzedUrl,
            savedAt: Date.now(),
          },
          videoIndex,
        };
      }
    }
    return null;
  }, [channelCache, collectionCache]);

  const loadSavedPost = useCallback(async (postSlug: string): Promise<boolean> => {
    const loaded = findLoadedPost(postSlug);
    if (loaded) return focusSavedPost(loaded.record, loaded.videoIndex);
    const found = await getSavedPostBySlug(postSlug);
    if (!found) return false;
    return focusSavedPost(found.record, found.videoIndex);
  }, [findLoadedPost, focusSavedPost]);

  const loadSavedList = useCallback(async (slug: string): Promise<boolean> => {
    const rec = await getSavedPlaylistBySlug(slug);
    if (!rec) return false;
    const profileOnly = isBareTikTokProfileUrl(rec.analyzedUrl);
    const target: ListTab = profileOnly ? "channel" : "collection";
    setMainTab("analyze");
    setLoadedFromSaved(true);
    setError(null);
    setUrl(rec.analyzedUrl);
    setListTab(target);
    setViewMode("grid");
    setSelectedVideo(null);
    if (target === "channel") setChannelCache({ playlist: rec.playlist, analyzedUrl: rec.analyzedUrl });
    else setCollectionCache({ playlist: rec.playlist, analyzedUrl: rec.analyzedUrl });
    return true;
  }, []);

  const openFocusedVideo = useCallback((video: TikTokVideo) => {
    setSelectedVideo(video);
    setViewMode("focused");
    if (loadedFromSaved && analyzedUrl) {
      writeDeepLink({ view: "tiktok", tab: listTab, slug: routeSlugForList(listTab, analyzedUrl, playlist?.title || video.title) }, true);
    } else if (analyzedUrl) {
      writeDeepLink({ view: "tiktok", tab: listTab, url: analyzedUrl }, true);
    }
  }, [analyzedUrl, listTab, loadedFromSaved, playlist?.title, routeSlugForList]);

  useEffect(() => {
    if (!saveNotice) return;
    const t = window.setTimeout(() => setSaveNotice(""), 2800);
    return () => window.clearTimeout(t);
  }, [saveNotice]);

  const setDownloading = useCallback((id: string, on: boolean) => {
    setDownloadingIds((prev) => {
      const next = { ...prev };
      if (on) next[id] = true;
      else delete next[id];
      return next;
    });
  }, []);

  const handleDownload = useCallback(
    async (e: MouseEvent, video: TikTokVideo, index?: number) => {
      e.stopPropagation();
      const dk = videoDomKey(video, index);
      if (downloadingIds[dk]) return;
      setDownloading(dk, true);
      try {
        await downloadTikTokFile(video);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Download failed");
      } finally {
        setDownloading(dk, false);
      }
    },
    [downloadingIds, setDownloading],
  );

  const analyzePostInline = useCallback(async (video: TikTokVideo) => {
    const slug = slugifySavedPost(video);
    if (analyzingPostSlug === slug) return;
    setAnalyzingPostSlug(slug);
    setAnalysisError("");
    try {
      const file = await tiktokVideoToFile(video);
      const result = await identifyMovie(file);
      const saved = { result, analyzedAt: Date.now() };
      writeSavedPostAnalysis(slug, saved);
      setPostAnalyses((prev) => ({ ...prev, [slug]: saved }));
      writeDeepLink({ view: "tiktok", postSlug: slug }, true);
    } catch (err) {
      setAnalysisError(err instanceof Error ? err.message : "Movie analysis failed");
    } finally {
      setAnalyzingPostSlug("");
    }
  }, [analyzingPostSlug]);

  const switchListTab = useCallback(
    (tab: ListTab) => {
      const cache = tab === "collection" ? collectionCache : channelCache;
      if (!cache && loadingTarget !== tab) return;
      setListTab(tab);
      setUrl(cache?.analyzedUrl ?? url);
      setViewMode("grid");
      setSelectedVideo(null);
      if (cache) {
        writeDeepLink({
          view: "tiktok",
          tab,
          slug: routeSlugForList(tab, cache.analyzedUrl, cache.playlist.title),
        });
      }
    },
    [collectionCache, channelCache, loadingTarget, routeSlugForList, url],
  );

  const runTikTokAnalyze = useCallback(
    async (targetUrl: string, options?: { forceNetwork?: boolean; seedVideoUrl?: string }) => {
      const trimmed = targetUrl.trim().split("#")[0].trim();
      if (!trimmed) return;

      const profileOnly = isBareTikTokProfileUrl(trimmed);
      const target: ListTab = profileOnly ? "channel" : "collection";
      const apiUrl = profileOnly ? canonicalBareTikTokProfileUrl(trimmed) || trimmed : trimmed;

      if (!options?.forceNetwork) {
        const saved = (await getSavedPlaylist(apiUrl)) || (await getSavedPlaylist(trimmed));
        if (saved?.playlist?.videos?.length) {
          setMainTab("analyze");
          setLoadedFromSaved(true);
          setError(null);
          setUrl(saved.analyzedUrl);
          setListTab(target);
          setViewMode("grid");
          if (target === "channel") setChannelCache({ playlist: saved.playlist, analyzedUrl: saved.analyzedUrl });
          else setCollectionCache({ playlist: saved.playlist, analyzedUrl: saved.analyzedUrl });
          setSelectedVideo(null);
          writeDeepLink({
            view: "tiktok",
            tab: target,
            slug: routeSlugForList(target, saved.analyzedUrl, saved.playlist.title),
          });
          return;
        }
      }

      setMainTab("analyze");
      setLoadedFromSaved(false);
      setUrl(apiUrl);
      setListTab(target);
      setViewMode("grid");
      setSelectedVideo(null);
      setSaveNotice("");
      setLoadingTarget(target);
      setError(null);
      if (profileOnly) setChannelCache(null);
      else setCollectionCache(null);
      writeDeepLink({ view: "tiktok", tab: target, url: apiUrl });

      try {
        const data = await fetchTikTokPlaylist(apiUrl, clampVideoCount(videoCount), options?.seedVideoUrl);
        const entry: CachedTikTokList = { playlist: data, analyzedUrl: apiUrl };
        if (profileOnly) setChannelCache(entry);
        else setCollectionCache(entry);
        if (data.videos.length > 0) {
          try {
            await setSavedPlaylist(apiUrl, data, apiUrl);
            void refreshSaved();
            writeDeepLink({ view: "tiktok", tab: target, slug: routeSlugForList(target, apiUrl, data.title) }, true);
          } catch {
            // Manual Save surfaces storage errors. Auto-save failure should not block browsing.
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to list TikTok videos");
      } finally {
        setLoadingTarget(null);
      }
    },
    [videoCount, refreshSaved, routeSlugForList],
  );

  const lastRouteKeyRef = useRef("");
  useEffect(() => {
    const u = initialUrl?.trim();
    const slug = initialSlug?.trim();
    const postSlug = initialPostSlug?.trim();
    const key = routeKey || `${initialSection}:${initialTab || ""}:${u}:${slug}:${postSlug}`;
    if (key === lastRouteKeyRef.current) return;
    lastRouteKeyRef.current = key;

    if (initialSection === "saved") {
      setMainTab("saved");
      setLoadedFromSaved(false);
      void refreshSaved();
      return;
    }

    if (initialTab) setListTab(initialTab);
    if (!autoAnalyze || (!u && !slug && !postSlug)) {
      setMainTab("analyze");
      return;
    }
    if (postSlug) {
      void loadSavedPost(postSlug).then((ok) => {
        if (!ok) setError("Saved post link not found in the database. Open the saved playlist or process the original TikTok URL first.");
      }).catch((err) => setError(err instanceof Error ? err.message : "Saved playlist database unavailable"));
      return;
    }
    if (slug) {
      void loadSavedList(slug).then((ok) => {
        if (!ok) {
          if (u) {
            void runTikTokAnalyze(u);
            return;
          }
          setError("Saved playlist link not found in the database. Reprocess the original TikTok URL to recreate it.");
        }
      }).catch((err) => setError(err instanceof Error ? err.message : "Saved playlist database unavailable"));
      return;
    }
    void runTikTokAnalyze(u);
  }, [autoAnalyze, initialUrl, initialSlug, initialPostSlug, initialTab, initialSection, routeKey, loadSavedPost, loadSavedList, refreshSaved, runTikTokAnalyze]);

  useEffect(() => {
    if (mainTab !== "analyze" || videoLengthFilter !== "longform16x9" || !playlist?.videos?.length) return;
    const key = `${listTab}:${analyzedUrl}:${playlist.videos.length}`;
    if (dimensionProbeBusy || dimensionProbeKey === key) return;
    const candidates = playlist.videos
      .map((video, index) => ({ video, index }))
      .filter(({ video }) => videoDurationSeconds(video) >= 180 && !videoDimensions(video).width)
      .slice(0, 50);
    if (!candidates.length) {
      setDimensionProbeKey(key);
      return;
    }

    let cancelled = false;
    setDimensionProbeBusy(true);
    void fetch("/api/tiktok/probe-dimensions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        videos: candidates.map(({ video, index }) => ({
          key: videoDomKey(video, index),
          id: video.id,
          author: video.author,
          authorHandle: video.authorHandle,
          uploaderId: video.uploaderId,
          playUrl: video.playUrl,
          cleanPlaybackUrls: video.cleanPlaybackUrls || [],
          durationSeconds: videoDurationSeconds(video),
          width: videoDimensions(video).width,
          height: videoDimensions(video).height,
        })),
      }),
    })
      .then(async (response) => {
        const data = (await response.json().catch(() => ({}))) as {
          results?: Array<{ key?: string; id?: string; width?: number; height?: number; durationSeconds?: number }>;
        };
        if (!response.ok) throw new Error("Could not check video shape");
        if (cancelled || !Array.isArray(data.results)) return;
        const byKey = new Map<string, { width: number; height: number; durationSeconds: number }>();
        const byId = new Map<string, { width: number; height: number; durationSeconds: number }>();
        data.results.forEach((result) => {
          const width = Math.round(Number(result.width || 0));
          const height = Math.round(Number(result.height || 0));
          const durationSeconds = Math.round(Number(result.durationSeconds || 0));
          if (!width || !height) return;
          const patch = { width, height, durationSeconds };
          if (result.key) byKey.set(String(result.key), patch);
          if (result.id) byId.set(String(result.id), patch);
        });
        if (!byKey.size && !byId.size) return;
        patchOpenPlaylistVideos(listTab, (videos) =>
          videos.map((video, index) => {
            const patch = byKey.get(videoDomKey(video, index)) || byId.get(String(video.id || ""));
            if (!patch) return video;
            return {
              ...video,
              width: patch.width,
              height: patch.height,
              durationSeconds: patch.durationSeconds || video.durationSeconds,
            };
          }),
        );
      })
      .catch(() => {
        // The filter still works for rows that already have dimensions.
      })
      .finally(() => {
        setDimensionProbeKey(key);
        setDimensionProbeBusy(false);
      });

    return () => {
      cancelled = true;
    };
  }, [analyzedUrl, dimensionProbeBusy, dimensionProbeKey, listTab, mainTab, patchOpenPlaylistVideos, playlist?.videos, videoLengthFilter]);

  const openChannel = useCallback(
    async (e: MouseEvent, video: TikTokVideo) => {
      e.stopPropagation();
      const profileUrl = channelListingUrl(video);
      if (!profileUrl) {
        setError("No channel handle for this video.");
        return;
      }
      const seed = video.playUrl?.trim() || (video.authorHandle && video.id ? `https://www.tiktok.com/@${video.authorHandle}/video/${video.id}` : "");
      await runTikTokAnalyze(profileUrl, { seedVideoUrl: seed });
    },
    [runTikTokAnalyze],
  );

  const handleSearch = async (e: FormEvent) => {
    e.preventDefault();
    await runTikTokAnalyze(url, { forceNetwork: true });
  };

  const reprocessPlaylistUrl = useCallback(
    async (rawUrl: string, options?: { syncCurrent?: boolean; seedVideoUrl?: string; fallbackPlaylist?: TikTokPlaylist | null }) => {
      const currentUrl = rawUrl.trim();
      if (!currentUrl) throw new Error("Saved playlist URL is missing");
      const profileOnly = isBareTikTokProfileUrl(currentUrl);
      const target: ListTab = profileOnly ? "channel" : "collection";
      const apiUrl = profileOnly ? canonicalBareTikTokProfileUrl(currentUrl) || currentUrl : currentUrl;
      setLoadingTarget(target);
      setError(null);
      setSaveNotice("");
      try {
        const seedVideoUrl = options?.seedVideoUrl || tikTokSeedVideoUrlFromPlaylist(options?.fallbackPlaylist) || tikTokSeedVideoUrlFromPlaylist(playlist);
        const data = await fetchTikTokPlaylist(apiUrl, VIDEO_COUNT_MAX, seedVideoUrl, { forceNetwork: true });
        if (!data.videos.length) throw new Error("TikTok returned no videos for this playlist");
        const entry: CachedTikTokList = { playlist: data, analyzedUrl: apiUrl };
        const sameAsOpenList = normalizePlaylistListUrl(apiUrl) === normalizePlaylistListUrl(analyzedUrl);
        if (options?.syncCurrent || sameAsOpenList) {
          if (target === "channel") setChannelCache(entry);
          else setCollectionCache(entry);
          setListTab(target);
          setUrl(apiUrl);
          setLoadedFromSaved(true);
          setSelectedVideo(null);
          setViewMode("grid");
          writeDeepLink({ view: "tiktok", tab: target, slug: routeSlugForList(target, apiUrl, data.title) }, true);
        }
        await setSavedPlaylist(apiUrl, data, apiUrl);
        await refreshSaved();
        setSaveNotice(data.stale ? `TikTok refresh failed, kept ${data.videos.length} saved videos from the database` : `Playlist updated with ${data.videos.length} videos`);
        return { data, apiUrl, target };
      } finally {
        setLoadingTarget(null);
      }
    },
    [analyzedUrl, playlist, refreshSaved, routeSlugForList],
  );

  const saveOrUpdatePlaylist = useCallback(async () => {
    if (!playlist || !analyzedUrl.trim()) return;
    const currentUrl = analyzedUrl.trim();

    if (loadedFromSaved) {
      try {
        await reprocessPlaylistUrl(currentUrl, { syncCurrent: true, fallbackPlaylist: playlist });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not update playlist");
      }
      return;
    }

    try {
      await setSavedPlaylist(currentUrl, playlist, currentUrl);
      void refreshSaved();
      writeDeepLink({
        view: "tiktok",
        tab: listTab,
        slug: routeSlugForList(listTab, currentUrl, playlist.title),
      });
      setSaveNotice("Playlist saved");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    }
  }, [playlist, analyzedUrl, loadedFromSaved, listTab, refreshSaved, routeSlugForList, reprocessPlaylistUrl]);

  const openSaved = useCallback(
    async (key: string) => {
      try {
        const rec = await getSavedPlaylist(key);
        if (!rec) {
          void refreshSaved();
          return;
        }
        const profileOnly = isBareTikTokProfileUrl(rec.analyzedUrl);
        const target: ListTab = profileOnly ? "channel" : "collection";
        setMainTab("analyze");
        setLoadedFromSaved(true);
        if (target === "channel") setChannelCache({ playlist: rec.playlist, analyzedUrl: rec.analyzedUrl });
        else setCollectionCache({ playlist: rec.playlist, analyzedUrl: rec.analyzedUrl });
        setListTab(target);
        setUrl(rec.analyzedUrl);
        setError(null);
        setSelectedVideo(null);
        setViewMode("grid");
        writeDeepLink({
          view: "tiktok",
          tab: target,
          slug: routeSlugForList(target, rec.analyzedUrl, rec.playlist.title),
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Saved playlist database unavailable");
      }
    },
    [refreshSaved, routeSlugForList],
  );

  const reprocessSaved = useCallback(
    async (e: MouseEvent, summary: SavedPlaylistSummary) => {
      e.stopPropagation();
      if (reprocessingKeys[summary.key]) return;
      const rawUrl = (summary.analyzedUrl || summary.key).trim();
      if (!rawUrl) return;
      const profileOnly = isBareTikTokProfileUrl(rawUrl);
      const apiUrl = profileOnly ? canonicalBareTikTokProfileUrl(rawUrl) || rawUrl : rawUrl;
      setReprocessingKeys((prev) => ({ ...prev, [summary.key]: true }));
      setError(null);
      try {
        const rec = await getSavedPlaylist(summary.key).catch(() => null);
        await reprocessPlaylistUrl(apiUrl, {
          syncCurrent: normalizePlaylistListUrl(apiUrl) === normalizePlaylistListUrl(analyzedUrl),
          fallbackPlaylist: rec?.playlist || null,
          seedVideoUrl: tikTokSeedVideoUrlFromPlaylist(rec?.playlist),
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to reprocess saved URL");
      } finally {
        setReprocessingKeys((prev) => {
          const next = { ...prev };
          delete next[summary.key];
          return next;
        });
      }
    },
    [analyzedUrl, reprocessPlaylistUrl, reprocessingKeys],
  );

  const deleteSaved = useCallback(
    async (e: MouseEvent, key: string) => {
      e.stopPropagation();
      try {
        await removeSavedPlaylist(key);
        void refreshSaved();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not remove saved playlist");
      }
    },
    [refreshSaved],
  );

  const isDark = theme === "dark";
  const bg = isDark ? "rgba(255,255,255,0.06)" : "#F5F4F0";
  const bgCard = isDark ? "#121722" : "#FDFCFA";
  const border = isDark ? "rgba(255,255,255,0.1)" : "rgba(28,26,22,0.08)";
  const text = isDark ? "#F8FAFC" : "#1C1A16";
  const muted = isDark ? "rgba(248,250,252,0.55)" : "rgba(28,26,22,0.45)";
  const accent = isDark ? "#FFDE32" : "#CF7255";
  const accentBg = isDark ? "rgba(255,222,50,0.12)" : "rgba(207,114,85,0.1)";
  const panelShadow = isDark ? "0 1px 4px rgba(0,0,0,0.3)" : "0 1px 4px rgba(0,0,0,0.05)";
  const activeTabStyle = { background: isDark ? "#FFDE32" : text, color: isDark ? "#1A1A1A" : "#fff" };
  const softSurface = isDark ? "rgba(255,255,255,0.06)" : "rgba(26,26,26,0.05)";
  const focusedSourceName = playlist
    ? listTab === "channel"
      ? channelTabHandle
        ? `@${channelTabHandle}`
        : playlist.author || "channel"
      : playlist.title || "collection"
    : "";
  const focusedBackLabel = playlist
    ? `Back to ${focusedSourceName} (${playlist.videos.length})`
    : "Back to list";
  const playlistActionLabel = loadedFromSaved ? "Update playlist" : "Save playlist";
  const selectedPostContent = selectedVideo ? (
    <div className="grid min-w-0 items-start gap-5 overflow-x-clip lg:grid-cols-[minmax(170px,260px)_minmax(0,1fr)] xl:gap-8">
      <div className="relative mx-auto aspect-[9/16] max-h-[72vh] w-full max-w-[260px] overflow-hidden rounded-2xl border bg-black shadow-2xl" style={{ borderColor: isDark ? "rgba(255,255,255,0.12)" : "#fff" }}>
        <CleanTikTokVideo video={selectedVideo} onError={setError} />
        <div className="absolute right-4 top-4 z-10">
          <ThumbnailDownloadButton busy={!!downloadingIds[videoDomKey(selectedVideo)]} onClick={(e) => handleDownload(e, selectedVideo)} />
        </div>
      </div>

      <div className="min-w-0 space-y-6 rounded-2xl p-3 md:p-5" style={{ background: bgCard, border: `1px solid ${border}`, color: text }}>
        <div className="flex min-w-0 flex-col gap-5">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-[#FF0033]">
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[#FF0033]/10"><User className="h-3 w-3" /></div>
              {channelListingUrl(selectedVideo) ? (
                <button type="button" onClick={(e) => openChannel(e, selectedVideo)} disabled={loading} title="Open channel videos" className="text-left text-xs font-semibold text-[#FF0033] underline-offset-2 hover:underline disabled:opacity-50">
                  {selectedVideo.author} (@{selectedVideo.authorHandle})
                </button>
              ) : (
                <span className="text-xs font-semibold">{selectedVideo.author} (@{selectedVideo.authorHandle})</span>
              )}
            </div>
            <h2 className="break-words font-serif text-xl font-bold leading-snug sm:text-2xl" style={{ color: text }}>{selectedVideo.title}</h2>
            {videoDurationSeconds(selectedVideo) ? <p className="inline-flex w-fit items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold" style={{ background: softSurface, color: muted }}><Clock3 className="h-3.5 w-3.5" />{formatVideoLength(videoDurationSeconds(selectedVideo))}</p> : null}
          </div>

          <button type="button" onClick={() => analyzePostInline(selectedVideo)} disabled={selectedPostAnalyzing} className="group flex min-h-12 w-full items-center justify-center gap-3 rounded-full bg-[#FFDE32] px-6 py-3 text-center text-xs font-bold text-[#1A1A1A] shadow-xl shadow-[#FFDE32]/25 transition-all hover:bg-[#FF0033] hover:text-white sm:w-fit sm:px-8 sm:py-4">
            {selectedPostAnalyzing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4 fill-current group-hover:animate-pulse" />}
            {selectedPostAnalysis ? "Re-analyze" : "Analyze clip"}
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3 border-t pt-5 sm:grid-cols-4" style={{ borderColor: border }}>
          <StatItem icon={<Heart className="h-5 w-5" />} label="Likes" value={selectedVideo.stats?.diggCount || 0} />
          <StatItem icon={<MessageCircle className="h-5 w-5" />} label="Comments" value={selectedVideo.stats?.commentCount || 0} />
          <StatItem icon={<Share2 className="h-5 w-5" />} label="Shares" value={selectedVideo.stats?.shareCount || 0} />
          <StatItem icon={<Play className="h-5 w-5" />} label="Plays" value={selectedVideo.stats?.playCount || 0} />
        </div>
      </div>
    </div>
  ) : null;

  return (
    <div className="space-y-6 pb-12">
      <div className="flex w-full flex-wrap items-center gap-2 rounded-xl p-1.5" style={{ background: bgCard, border: `1px solid ${border}`, boxShadow: panelShadow }}>
        {viewMode === "focused" && playlist ? (
          <>
            <button
              type="button"
              onClick={() => {
                setViewMode("grid");
                setSelectedVideo(null);
                if (playlist && analyzedUrl) writeDeepLink({ view: "tiktok", tab: listTab, slug: routeSlugForList(listTab, analyzedUrl, playlist.title) });
              }}
              className="flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold transition-all"
              style={activeTabStyle}
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span className="max-w-[260px] truncate">{focusedBackLabel}</span>
            </button>
          </>
        ) : (
          <>
            <div className="flex items-center gap-1" style={{ background: bg, borderRadius: 10, padding: "2px" }}>
              <button
                type="button"
                onClick={() => {
                  setMainTab("analyze");
                  setLoadedFromSaved(false);
                  if (playlist && analyzedUrl) {
                    writeDeepLink({ view: "tiktok", tab: listTab, slug: routeSlugForList(listTab, analyzedUrl, playlist.title) });
                  } else {
                    writeDeepLink({ view: "tiktok", section: "analyze" });
                  }
                }}
                className="flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold transition-all"
                style={mainTab === "analyze" ? activeTabStyle : { color: muted }}
              >
                <Search className="h-3.5 w-3.5" />
                Analyze
              </button>
              <button
                type="button"
                onClick={() => { setMainTab("saved"); void refreshSaved(); writeDeepLink({ view: "tiktok", section: "saved" }); }}
                className="flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold transition-all"
                style={mainTab === "saved" ? activeTabStyle : { color: muted }}
              >
                <Library className="h-3.5 w-3.5" />
                Saved
              </button>
            </div>

            {mainTab === "analyze" && (collectionCache || channelCache || loadingTarget) && <div className="h-6 w-px" style={{ background: border }} />}

            {mainTab === "analyze" && (collectionCache || channelCache || loadingTarget) && (
              <div className="flex items-center gap-1" style={{ background: bg, borderRadius: 10, padding: "2px" }}>
                <button
                  type="button"
                  onClick={() => switchListTab("collection")}
                  disabled={!collectionCache && loadingTarget !== "collection"}
                  title="Videos from the analyzed URL"
                  className="flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold transition-all disabled:pointer-events-none disabled:opacity-30"
                  style={listTab === "collection" ? { background: bgCard, color: accent, boxShadow: panelShadow } : { color: muted }}
                >
                  <ListVideo className="h-3.5 w-3.5" />
                  Playlist
                </button>
                <button
                  type="button"
                  onClick={() => switchListTab("channel")}
                  disabled={!channelCache && loadingTarget !== "channel"}
                  title="Creator profile feed"
                  className="flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold transition-all disabled:pointer-events-none disabled:opacity-30"
                  style={listTab === "channel" ? { background: bgCard, color: accent, boxShadow: panelShadow } : { color: muted }}
                >
                  <User className="h-3.5 w-3.5" />
                  Channel
                  {channelTabHandle && <span className="font-mono normal-case tracking-normal opacity-80">@{channelTabHandle}</span>}
                </button>
              </div>
            )}

            <div className="ml-auto flex flex-wrap items-center gap-2">
              {mainTab === "saved" && (
                <span className="rounded-full px-3 py-1 text-xs font-semibold" style={{ background: accentBg, color: accent }}>
                  {savedSummaries.length} saved
                </span>
              )}
              {playlist && mainTab === "analyze" && (
                <button type="button" onClick={saveOrUpdatePlaylist} disabled={loading} className="flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold transition-all disabled:cursor-wait disabled:opacity-60" style={{ background: bg, color: text, border: `1px solid ${border}` }}>
                  {loadedFromSaved && loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" style={{ color: accent }} /> : <Bookmark className="h-3.5 w-3.5" style={{ color: accent }} />}
                  {playlistActionLabel}
                </button>
              )}
              {playlist && mainTab === "analyze" && (
                <label className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold" style={{ background: bg, color: muted, border: `1px solid ${border}` }}>
                  Sort
                  <select
                    value={videoSortMode}
                    onChange={(e) => setVideoSortMode(e.target.value as VideoSortMode)}
                    className="bg-transparent text-xs font-bold outline-none"
                    style={{ color: text }}
                  >
                    <option value="views-desc">Views high to low</option>
                    <option value="views-asc">Views low to high</option>
                    <option value="date-desc">Newest first</option>
                    <option value="date-asc">Oldest first</option>
                  </select>
                </label>
              )}
              {playlist && mainTab === "analyze" && (
                <label className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold" style={{ background: bg, color: muted, border: `1px solid ${border}` }}>
                  <Clock3 className="h-3.5 w-3.5" />
                  Length
                  <select
                    value={videoLengthFilter}
                    onChange={(e) => setVideoLengthFilter(e.target.value as VideoLengthFilter)}
                    className="bg-transparent text-xs font-bold outline-none"
                    style={{ color: text }}
                  >
                    <option value="all">All lengths</option>
                    <option value="short">Under 30s</option>
                    <option value="medium">30s to 1m</option>
                    <option value="long">1m+</option>
                    <option value="longform16x9">Long form 16:9</option>
                    <option value="unknown">Unknown</option>
                  </select>
                  {dimensionProbeBusy && videoLengthFilter === "longform16x9" && <Loader2 className="h-3.5 w-3.5 animate-spin" style={{ color: accent }} />}
                </label>
              )}
              {saveNotice && <span className="text-xs font-semibold" style={{ color: "#16a34a" }}>{saveNotice}</span>}
              {playlist && <span className="rounded-full px-3 py-1 text-xs font-semibold" style={{ background: accentBg, color: accent }}>{sortedVideos.length === playlist.videos.length ? playlist.videos.length : `${sortedVideos.length}/${playlist.videos.length}`} videos</span>}
            </div>
          </>
        )}
      </div>

      {mainTab === "saved" ? (
        <div className="space-y-6">
          <p className="max-w-xl text-sm text-[#1A1A1A]/60">Open a saved list instantly, or reprocess it to fetch fresh videos from TikTok.</p>
          {error && <div className="rounded-xl border border-red-100 bg-white p-4 text-sm text-red-700">{error}</div>}
          {savedSummaries.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[#1A1A1A]/15 bg-white/80 p-12 text-center text-sm text-[#1A1A1A]/45">
              No saved playlists yet. Analyze a URL and save the playlist.
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {savedSummaries.map((s) => (
                <div
                  key={s.key}
                  role="button"
                  tabIndex={0}
                  onClick={() => openSaved(s.key)}
                  onKeyDown={(e) => e.key === "Enter" && openSaved(s.key)}
                  className="group relative flex cursor-pointer gap-4 rounded-xl border border-[#1A1A1A]/5 bg-white p-4 text-left shadow-sm transition-all hover:border-[#FF0033]/40 hover:shadow-md"
                >
                  <div className="relative h-24 w-[4.5rem] shrink-0 overflow-hidden rounded-lg bg-[#1A1A1A]/5">
                    <TikTokCoverImage src={s.thumb} className="h-full w-full object-cover" />
                  </div>
                  <div className="min-w-0 flex-1 py-0.5 pr-16">
                    <p className="line-clamp-2 font-serif text-base font-bold leading-snug text-[#1A1A1A]">{s.title}</p>
                    <p className="mt-1 text-xs font-semibold text-[#FF0033]">{s.videoCount} videos</p>
                    <p className="mt-1 truncate text-xs text-[#1A1A1A]/35">{s.analyzedUrl}</p>
                  </div>
                  <button type="button" onClick={(e) => reprocessSaved(e, s)} disabled={!!reprocessingKeys[s.key]} className="absolute right-12 top-3 rounded-lg p-2 text-[#1A1A1A]/25 transition-colors hover:bg-[#FF0033]/10 hover:text-[#FF0033] disabled:cursor-wait disabled:opacity-40" title={`Update saved playlist with up to ${VIDEO_COUNT_MAX} videos`} aria-label="Update saved playlist">
                    <RefreshCw className={cn("h-4 w-4", reprocessingKeys[s.key] && "animate-spin")} />
                  </button>
                  <button type="button" onClick={(e) => deleteSaved(e, s.key)} className="absolute right-3 top-3 rounded-lg p-2 text-[#1A1A1A]/25 transition-colors hover:bg-red-50 hover:text-red-600" title="Remove save" aria-label="Remove saved playlist">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <>
          {!loadedFromSaved && !collectionCache && !channelCache && !loadingTarget && (
            <div className="space-y-6">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Zap className="h-5 w-5 text-[#FF0033]" />
                  <span className="text-sm font-semibold text-[#FF0033]">TikTok Explorer</span>
                </div>
                <h1 className="font-serif text-2xl font-bold tracking-tight text-[#1A1A1A] sm:text-3xl md:text-4xl">Explore TikTok videos.</h1>
                <p className="max-w-xl text-sm leading-6 text-[#1A1A1A]/60">
                  Paste a TikTok profile, playlist, collection, or video URL. Gemini only runs when you analyze a clip for movie ID.
                </p>
              </div>

              <div className="flex flex-col gap-4">
                <form onSubmit={handleSearch} className="flex w-full max-w-3xl flex-col gap-3 rounded-xl border border-[#1A1A1A]/5 bg-white p-3 shadow-sm lg:flex-row lg:items-stretch">
                  <div className="relative min-h-[3rem] flex-1">
                    <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#1A1A1A]/30" />
                    <input type="text" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.tiktok.com/@user/collection/..." className="h-full w-full rounded-lg bg-transparent py-3 pl-11 pr-4 text-sm font-sans outline-none" />
                  </div>
                  <div className="flex items-center gap-2 rounded-lg border border-[#1A1A1A]/10 bg-[#F9F8F6] px-3 py-2 sm:w-44">
                    <label htmlFor="tiktok-video-count" className="sr-only">Number of videos to load</label>
                    <span className="shrink-0 text-xs font-semibold text-[#1A1A1A]/45">Max</span>
                    <input id="tiktok-video-count" type="number" min={VIDEO_COUNT_MIN} max={VIDEO_COUNT_MAX} value={videoCount} onChange={(e) => setVideoCount(clampVideoCount(Number(e.target.value)))} className="min-w-0 flex-1 bg-transparent font-mono text-sm font-semibold text-[#1A1A1A] outline-none" />
                  </div>
                  <button type="submit" disabled={loading} className="flex shrink-0 items-center justify-center gap-2 rounded-lg bg-[#1A1A1A] px-8 py-3 text-xs font-bold text-white shadow-md shadow-black/10 transition-all hover:bg-[#FF0033] disabled:opacity-50">
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Process URL"}
                  </button>
                </form>
                <p className="max-w-3xl text-sm leading-relaxed text-[#1A1A1A]/45">
                  Default is {VIDEO_COUNT_DEFAULT} videos. You can request up to {VIDEO_COUNT_MAX}, but large lists take longer.
                </p>
              </div>
            </div>
          )}

          {loadingTarget && !playlist && (
            <div className="flex min-h-[260px] flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-[#1A1A1A]/10 bg-white/90 py-16 shadow-sm">
              <Loader2 className="h-10 w-10 animate-spin text-[#FF0033]" aria-hidden />
              <p className="max-w-md text-center text-sm text-[#1A1A1A]/50">Loading {loadingTarget === "channel" ? "channel videos" : "playlist videos"} with TikTok-Api.</p>
            </div>
          )}

          <AnimatePresence mode="sync">
            {error && (
              <motion.div key="tiktok-error-banner" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className="flex gap-4 rounded-xl border border-red-100 bg-white p-6 shadow-sm">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-50 text-red-500"><Film className="h-5 w-5" /></div>
                <div>
                  <h4 className="text-sm font-bold text-red-900">Request error</h4>
                  <p className="text-sm text-red-800/65">{error}</p>
                </div>
              </motion.div>
            )}

            {playlist && (
              <motion.div key={`tiktok-${listTab}-${analyzedUrl || "current"}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-12">
                {viewMode === "focused" ? (
                  selectedVideo ? (
                    <motion.div key={videoDomKey(selectedVideo)} initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }}>
                      {selectedPostAnalysis?.result ? (
                        <MovieAnalysisTabs
                          result={selectedPostAnalysis.result}
                          savedAt={selectedPostAnalysis.analyzedAt}
                          compact
                          postContent={selectedPostContent}
                          postLabel="Post"
                          initialTab="movie"
                        />
                      ) : (
                        <LockedAnalysisTabs
                          postContent={selectedPostContent}
                          loading={selectedPostAnalyzing}
                          error={analysisError}
                        />
                      )}
                    </motion.div>
                  ) : (
                    <div className="flex h-[420px] flex-col items-center justify-center rounded-xl border border-dashed border-[#1A1A1A]/10 bg-white text-[#1A1A1A]/30">
                      <Play className="mb-6 h-14 w-14 opacity-20" />
                      <p className="text-sm">Select a video to analyze</p>
                    </div>
                  )
                ) : (
                  <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                    {sortedVideos.map((video, vi) => (
                      <motion.div key={videoDomKey(video, vi)} layout initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} role="button" tabIndex={0} onClick={() => openFocusedVideo(video)} onKeyDown={(e) => e.key === "Enter" && openFocusedVideo(video)} className="group flex min-w-0 cursor-pointer flex-col overflow-hidden rounded-xl border border-[#1A1A1A]/5 bg-white text-left shadow-sm transition-all duration-300 hover:shadow-xl">
                        <div className="relative aspect-[9/16] overflow-hidden bg-[#1A1A1A]/5">
                          <TikTokCoverImage src={video.dynamicCover} className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105" />
                          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-60 transition-opacity group-hover:opacity-80" />
                          <ThumbnailDownloadButton busy={!!downloadingIds[videoDomKey(video, vi)]} onClick={(e) => handleDownload(e, video, vi)} className="absolute right-2 top-2 z-10" />
                          <div className="absolute bottom-4 left-4 right-4 flex items-center justify-between text-white">
                            <div className="flex items-center gap-1.5 text-xs font-bold text-[#FF0033]/90"><Play className="h-3 w-3 fill-current" />{formatValue(video.stats?.playCount || 0)}</div>
                            <div className="flex items-center gap-2 text-xs font-bold text-white">
                              {videoDurationSeconds(video) ? <span className="rounded bg-black/60 px-1.5 py-0.5 font-mono text-[11px] leading-none">{formatVideoLength(videoDurationSeconds(video))}</span> : null}
                              <span className="flex items-center gap-1.5"><Heart className="h-3 w-3 fill-current" />{formatValue(video.stats?.diggCount || 0)}</span>
                            </div>
                          </div>
                        </div>
                        <div className="flex flex-1 flex-col space-y-3 p-4">
                          {channelListingUrl(video) ? (
                            <button type="button" onClick={(e) => openChannel(e, video)} disabled={loading} title="Open channel videos" className="truncate text-left text-xs font-bold text-[#FF0033] underline-offset-2 hover:underline disabled:opacity-50">
                              {video.author}
                            </button>
                          ) : (
                            <p className="truncate text-xs font-bold text-[#FF0033]">{video.author}</p>
                          )}
                          <h4 className="line-clamp-2 font-serif text-sm font-bold leading-tight text-[#1A1A1A] transition-colors group-hover:text-[#FF0033]">{video.title}</h4>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}
    </div>
  );
}

function StatItem({ icon, label, value }: { icon: ReactNode; label: string; value: number }) {
  return (
    <div className="space-y-1 text-center">
      <div className="mb-1 flex justify-center text-[#1A1A1A]/20">{icon}</div>
      <div className="font-mono text-sm font-bold">{formatValue(value)}</div>
      <div className="text-[9px] font-bold uppercase tracking-widest text-[#1A1A1A]/30">{label}</div>
    </div>
  );
}
