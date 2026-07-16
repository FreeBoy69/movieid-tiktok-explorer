import { useState, FormEvent, ReactNode, useCallback, useEffect, useRef, useMemo, type MouseEvent } from "react";
import { flushSync } from "react-dom";
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
  Layers3,
  Tags,
  X,
  Check,
  Youtube,
} from "lucide-react";
import { fetchTikTokPlaylist, TikTokVideo, TikTokPlaylist } from "../services/tiktok";
import { cn } from "../lib/utils";
import { MovieAnalysisTabs, type MainTab } from "./MovieAnalysisTabs";
import {
  getSavedPlaylist,
  getSavedPlaylistBySlug,
  getSavedPostBySlug,
  setSavedPlaylist,
  listSavedPlaylistSummaries,
  removeSavedPlaylist,
  getSavedPlaylistGenreScan,
  scanSavedPlaylistGenres,
  scanSavedPlaylistMovies,
  addSavedPlaylistAutoTags,
  normalizePlaylistListUrl,
  savedTikTokGenreScanKey,
  slugifySavedPost,
  slugifySavedPlaylistTitle,
  type SavedPlaylistGenreGroup,
  type SavedPlaylistGenreScan,
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
import { identifyMovie, identifyMovieFromLink } from "../services/gemini";
import type { MovieResult } from "../types";
import {
  analysisAutoTags,
  listSavedPostAnalyses,
  mergePostAnalyses,
  readLocalSavedPostAnalyses,
  saveSavedPostAnalysis,
  writeLocalSavedPostAnalysis,
  type SavedPostAnalysis,
} from "../utils/savedPostAnalyses";
import { getMovieIdentificationSourceDisplay } from "../utils/movieIdentificationSource.js";
import { StandardPlaylistCard, StandardVideoCard } from "./StandardCards";

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
  auth?: any;
}

const VIDEO_COUNT_MIN = 1;
const VIDEO_COUNT_MAX = 5000;
const VIDEO_COUNT_DEFAULT = 100;
const cleanVideoUrlCache = new Map<string, string>();

type ListTab = "collection" | "channel";
type SavedCollectionView = "videos" | "genres";
type VideoSortMode = "views-desc" | "views-asc" | "date-desc" | "date-asc";
type VideoLengthFilter = "all" | "short" | "medium" | "long" | "longform16x9" | "unknown";

interface CachedTikTokList {
  playlist: TikTokPlaylist;
  analyzedUrl: string;
}

function cleanSavedTag(value: string): string {
  return value.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 48);
}

function mergeSavedTags(...groups: Array<string[] | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of groups.flatMap((group) => group || [])) {
    const tag = cleanSavedTag(String(raw || ""));
    const key = tag.toLowerCase();
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
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

async function identifyTikTokVideoMovie(video: TikTokVideo, options: { skipCache?: boolean } = {}): Promise<MovieResult> {
  const url = String(video.playUrl || "").trim();
  if (/tiktok\.com/i.test(url)) {
    try {
      return await identifyMovieFromLink(url, video.cleanPlaybackUrls || [], { skipCache: options.skipCache === true });
    } catch (err) {
      console.warn("TikTok link Movie ID failed, falling back to uploaded clip:", err instanceof Error ? err.message : err);
    }
  }
  const file = await tiktokVideoToFile(video);
  return identifyMovie(file);
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
        "hover:bg-[#1A1A1A] disabled:cursor-wait disabled:opacity-70",
        className,
      )}
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Download className="h-4 w-4" aria-hidden />}
    </button>
  );
}

function isExpiredSignedCoverUrl(value: string): boolean {
  try {
    const parsed = new URL(value, window.location.origin);
    const expires = Number(parsed.searchParams.get("x-expires") || 0);
    return expires > 0 && expires * 1000 < Date.now();
  } catch {
    return false;
  }
}

function tiktokVideoCoverCandidates(video?: TikTokVideo | null): string[] {
  if (!video) return [];
  const seen = new Set<string>();
  return [video.dynamicCover, video.thumbnailUrl, video.thumbnailSourceUrl]
    .map((value) => String(value || "").trim())
    .filter((value) => {
      if (!value || seen.has(value) || isExpiredSignedCoverUrl(value)) return false;
      seen.add(value);
      return true;
    });
}

function TikTokCoverImage({ src, fallbacks, className = "" }: { src?: string; fallbacks?: string[]; className?: string }) {
  const candidates = useMemo(() => {
    const seen = new Set<string>();
    return [src, ...(fallbacks || [])]
      .map((value) => String(value || "").trim())
      .filter((value) => {
        if (!value || seen.has(value) || isExpiredSignedCoverUrl(value)) return false;
        seen.add(value);
        return true;
      });
  }, [src, fallbacks]);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => setAttempt(0), [candidates]);
  const current = candidates[attempt] || "";
  if (!current) {
    return (
      <div className={cn("grid place-items-center bg-[linear-gradient(145deg,#fff4b8,#f7f6f2_45%,#ffe2e8)] text-[#f9dc0b]", className)}>
        <Play className="h-8 w-8 fill-current opacity-80" />
      </div>
    );
  }
  return <img src={current} alt="" loading="lazy" decoding="async" className={className} referrerPolicy="no-referrer" onError={() => setAttempt((prev) => prev + 1)} />;
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
    return <TikTokCoverImage src={video.dynamicCover} fallbacks={tiktokVideoCoverCandidates(video)} className="h-full w-full object-cover" />;
  }

  return <video src={src} className="h-full w-full object-contain" controls playsInline preload="metadata" poster={video.dynamicCover || undefined} />;
}

function LockedAnalysisTabs({
  postContent,
  loading,
  error,
  hideTabs = false,
}: {
  postContent: ReactNode;
  loading: boolean;
  error: string;
  hideTabs?: boolean;
}) {
  const lockedTabs = ["Movie ID", "Transcript", "Story", "Visuals", "Niche", "Evidence", "Details"];
  if (hideTabs) {
    return (
      <div className="p-4 md:p-6">
        {postContent}
        {loading ? (
          <div className="mt-6 flex items-center gap-3 rounded-xl border border-[#f9dc0b]/30 bg-[#f9dc0b]/10 px-5 py-4 text-sm font-semibold text-[#6a5b00]">
            <Loader2 className="h-4 w-4 animate-spin" />
            Analyzing clip… fetching comments, then Movie ID.
          </div>
        ) : (
          <div className="mt-6 rounded-xl border border-dashed border-[#1A1A1A]/15 px-5 py-4 text-sm text-[#1A1A1A]/55">
            {error || "Hit Analyze clip to unlock Movie ID, Transcript, Story, Visuals, Niche, Evidence, and Details."}
          </div>
        )}
      </div>
    );
  }

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
          <div className="rounded-xl border border-[#f9dc0b]/15 bg-[#f9dc0b]/5 p-5">
            <div className="flex items-center gap-3 text-[#f9dc0b]">
              <Loader2 className="h-4 w-4 animate-spin" />
              <p className="text-sm font-semibold">Analyzing movie inside this post</p>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-[#1A1A1A]/55">Fetching TikTok comments first, matching against TMDB, then falling back to Gemini if needed.</p>
          </div>
        )}
        {!loading && (
          <div className="rounded-xl border border-dashed border-[#1A1A1A]/10 bg-[#F9F8F6] p-5">
            <p className="text-sm font-semibold text-[#f9dc0b]">Analysis tabs are locked</p>
            <p className="mt-2 text-sm leading-relaxed text-[#1A1A1A]/55">Analyze this clip to unlock Movie ID, transcript, story, visuals, niche, evidence, and details.</p>
            {error && <p className="mt-3 text-sm text-[#6a5b00]">{error}</p>}
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
  auth,
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
  const [postAnalyses, setPostAnalyses] = useState<Record<string, SavedPostAnalysis>>(() => readLocalSavedPostAnalyses());
  const [analyzingPostSlug, setAnalyzingPostSlug] = useState("");
  const analyzePostInlineRef = useRef<(video: TikTokVideo) => Promise<void>>(async () => {});
  const [analysisError, setAnalysisError] = useState("");
  const [videoSortMode, setVideoSortMode] = useState<VideoSortMode>("views-desc");
  const [videoLengthFilter, setVideoLengthFilter] = useState<VideoLengthFilter>("all");
  const [dimensionProbeBusy, setDimensionProbeBusy] = useState(false);
  const [dimensionProbeKey, setDimensionProbeKey] = useState("");
  const [savedCollectionView, setSavedCollectionView] = useState<SavedCollectionView>("videos");
  const [genreScan, setGenreScan] = useState<SavedPlaylistGenreScan | null>(null);
  const [genreScanBusy, setGenreScanBusy] = useState(false);
  const [genreScanLoading, setGenreScanLoading] = useState(false);
  const [activeGenre, setActiveGenre] = useState("");
  const [activeVideoTags, setActiveVideoTags] = useState<string[]>([]);

  // Batch scan states
  const [batchAnalysisRunning, setBatchAnalysisRunning] = useState(false);
  const [currentScanningSlug, setCurrentScanningSlug] = useState("");
  const [batchScanProgress, setBatchScanProgress] = useState<{ done: number; total: number; phase?: "comments" | "identify" } | null>(null);
  const cancelBatchAnalysisRef = useRef(false);

  // Movie ID modal & YouTube upload state
  const [activeMovieIdModalVideo, setActiveMovieIdModalVideo] = useState<TikTokVideo | null>(null);
  const [activeDetailTab, setActiveDetailTab] = useState<MainTab>("post");
  const [isUploadingToYoutube, setIsUploadingToYoutube] = useState(false);
  const [uploadProgressMessage, setUploadProgressMessage] = useState("");
  const [youtubeUploadForm, setYoutubeUploadForm] = useState({
    title: "",
    description: "",
    tags: "",
    postAsShort: true,
    privacyStatus: "private",
    madeForKids: false,
    playlistId: "",
    newPlaylistTitle: "",
  });
  const [youtubeUploadError, setYoutubeUploadError] = useState("");
  const [youtubeUploadResult, setYoutubeUploadResult] = useState<any>(null);
  const [youtubePlaylists, setYoutubePlaylists] = useState<any[]>([]);
  const [loadingYoutubePlaylists, setLoadingYoutubePlaylists] = useState(false);

  const playlist = listTab === "collection" ? collectionCache?.playlist ?? null : channelCache?.playlist ?? null;
  const analyzedUrl = listTab === "collection" ? collectionCache?.analyzedUrl ?? "" : channelCache?.analyzedUrl ?? "";
  const filteredVideos = useMemo(() => filterTikTokVideosByLength(playlist?.videos || [], videoLengthFilter), [playlist?.videos, videoLengthFilter]);
  const sortedVideos = useMemo(() => sortTikTokVideos(filteredVideos, videoSortMode), [filteredVideos, videoSortMode]);
  const loading = loadingTarget !== null;
  const selectedPostSlug = selectedVideo ? slugifySavedPost(selectedVideo) : "";
  const selectedPostAnalysis = selectedPostSlug ? postAnalyses[selectedPostSlug] : undefined;
  const selectedPostAnalyzing = !!selectedPostSlug && analyzingPostSlug === selectedPostSlug;
  const channelTabHandle = channelCache || loadingTarget === "channel" ? handleFromTikTokProfileUrl(channelCache?.analyzedUrl || url) : "";
  const currentSavedCollectionKey = savedTikTokGenreScanKey(loadedFromSaved, analyzedUrl);
  const postAnalysisPlaylistKey = normalizePlaylistListUrl(analyzedUrl || currentSavedCollectionKey || url);

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

  useEffect(() => {
    if (!postAnalysisPlaylistKey) return;
    let cancelled = false;
    listSavedPostAnalyses(postAnalysisPlaylistKey)
      .then((remote) => {
        if (cancelled) return;
        setPostAnalyses((prev) => mergePostAnalyses(prev, remote));
        for (const [slug, analysis] of Object.entries(remote)) {
          writeLocalSavedPostAnalysis(slug, analysis);
        }
      })
      .catch(() => {
        // Offline or signed-out users still get the local analysis cache.
      });
    return () => {
      cancelled = true;
    };
  }, [postAnalysisPlaylistKey]);

  const refreshGenreScan = useCallback(async () => {
    if (!currentSavedCollectionKey) {
      setGenreScan(null);
      return null;
    }
    setGenreScanLoading(true);
    try {
      const scan = await getSavedPlaylistGenreScan(currentSavedCollectionKey);
      setGenreScan(scan);
      return scan;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Saved genre scan unavailable");
      return null;
    } finally {
      setGenreScanLoading(false);
    }
  }, [currentSavedCollectionKey]);

  const scanGenreCollection = useCallback(async () => {
    if (!currentSavedCollectionKey || !playlist?.videos?.length || genreScanBusy) return;
    setGenreScanBusy(true);
    setError(null);
    try {
      const maxBatches = Math.max(1, Math.ceil(playlist.videos.length / 4) + 1);
      let next = genreScan;
      for (let batch = 0; batch < maxBatches; batch += 1) {
        next = await scanSavedPlaylistGenres(currentSavedCollectionKey, 4);
        setGenreScan(next);
        if (!next?.summary.pending) break;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not scan collection genres");
    } finally {
      setGenreScanBusy(false);
    }
  }, [currentSavedCollectionKey, genreScan, genreScanBusy, playlist?.videos.length]);

  useEffect(() => {
    if (savedCollectionView !== "genres" || !currentSavedCollectionKey) return;
    void refreshGenreScan();
  }, [currentSavedCollectionKey, refreshGenreScan, savedCollectionView]);

  useEffect(() => {
    const groups = genreScan?.groups || [];
    if (!groups.length) {
      setActiveGenre("");
      return;
    }
    if (!groups.some((group) => group.genre === activeGenre)) setActiveGenre(groups[0].genre);
  }, [activeGenre, genreScan?.groups]);

  useEffect(() => {
    setActiveVideoTags([]);
  }, [currentSavedCollectionKey, listTab]);

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
    setSavedCollectionView("videos");
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
    setSavedCollectionView("videos");
    setSelectedVideo(null);
    if (target === "channel") setChannelCache({ playlist: rec.playlist, analyzedUrl: rec.analyzedUrl });
    else setCollectionCache({ playlist: rec.playlist, analyzedUrl: rec.analyzedUrl });
    return true;
  }, []);

  const openFocusedVideo = useCallback((video: TikTokVideo) => {
    setSelectedVideo(video);
    setViewMode("focused");
    setSavedCollectionView("videos");

    const slug = slugifySavedPost(video);
    if (postAnalyses[slug]) {
      setActiveDetailTab("movie");
    } else {
      setActiveDetailTab("post");
      void analyzePostInlineRef.current(video);
    }

    if (loadedFromSaved && analyzedUrl) {
      writeDeepLink({ view: "tiktok", tab: listTab, slug: routeSlugForList(listTab, analyzedUrl, playlist?.title || video.title) }, true);
    } else if (analyzedUrl) {
      writeDeepLink({ view: "tiktok", tab: listTab, url: analyzedUrl }, true);
    }
  }, [analyzedUrl, listTab, loadedFromSaved, playlist?.title, routeSlugForList, postAnalyses]);

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

  const addTagsFromAnalysis = useCallback(async (result: MovieResult) => {
    const key = normalizePlaylistListUrl(analyzedUrl || currentSavedCollectionKey);
    if (!key) return;

    const summary = savedSummaries.find(
      (s) => normalizePlaylistListUrl(s.key) === key || normalizePlaylistListUrl(s.analyzedUrl) === key
    );
    if (!summary) return;

    const newTags = analysisAutoTags(result);

    if (newTags.length === 0) return;

    try {
      const updated = await addSavedPlaylistAutoTags(summary.key, newTags);
      if (updated) {
        setSavedSummaries((prev) => prev.map((item) => (item.key === updated.key ? updated : item)));
      }
    } catch (err) {
      console.error("Failed to auto-update playlist auto tags from analysis:", err);
    }
  }, [analyzedUrl, currentSavedCollectionKey, savedSummaries]);

  const persistPostAnalysis = useCallback(async (slug: string, video: TikTokVideo, result: MovieResult) => {
    const saved: SavedPostAnalysis = {
      result,
      analyzedAt: Date.now(),
      video,
      playlistKey: postAnalysisPlaylistKey,
    };
    writeLocalSavedPostAnalysis(slug, saved);
    setPostAnalyses((prev) => ({ ...prev, [slug]: saved }));
    try {
      const remote = await saveSavedPostAnalysis(slug, saved);
      if (remote) {
        setPostAnalyses((prev) => ({ ...prev, [slug]: remote }));
        writeLocalSavedPostAnalysis(slug, remote);
      }
    } catch (err) {
      console.warn("Saved post analysis database write skipped:", err instanceof Error ? err.message : err);
    }
    await addTagsFromAnalysis(result);
    return saved;
  }, [addTagsFromAnalysis, postAnalysisPlaylistKey]);

  const analyzePostInline = useCallback(async (video: TikTokVideo) => {
    const slug = slugifySavedPost(video);
    if (analyzingPostSlug === slug) return;
    setAnalyzingPostSlug(slug);
    setAnalysisError("");
    try {
      const result = await identifyTikTokVideoMovie(video, { skipCache: !!postAnalyses[slug]?.result });
      await persistPostAnalysis(slug, video, result);
      setActiveDetailTab("movie");
      writeDeepLink({ view: "tiktok", postSlug: slug }, true);
    } catch (err) {
      setAnalysisError(err instanceof Error ? err.message : "Movie analysis failed");
    } finally {
      setAnalyzingPostSlug("");
    }
  }, [analyzingPostSlug, persistPostAnalysis]);

  useEffect(() => {
    analyzePostInlineRef.current = analyzePostInline;
  }, [analyzePostInline]);

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
          setSavedCollectionView("videos");
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
      setSavedCollectionView("videos");
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
        setSavedCollectionView("videos");
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
  const accent = "#f9dc0b";
  const accentBg = isDark ? "rgba(249,220,11,0.14)" : "rgba(249,220,11,0.18)";
  const panelShadow = isDark ? "0 1px 4px rgba(0,0,0,0.3)" : "0 1px 4px rgba(0,0,0,0.05)";
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
  const activeGenreGroup = useMemo<SavedPlaylistGenreGroup | null>(() => {
    const groups = genreScan?.groups || [];
    return groups.find((group) => group.genre === activeGenre) || groups[0] || null;
  }, [activeGenre, genreScan?.groups]);
  const orderedGenreGroups = useMemo<SavedPlaylistGenreGroup[]>(() => {
    const groups = genreScan?.groups || [];
    const review = groups.find((group) => group.genre === "Needs Review");
    const rest = groups.filter((group) => group.genre !== "Needs Review");
    return review ? [review, ...rest] : rest;
  }, [genreScan?.groups]);
  const currentSavedSummary = useMemo(() => {
    const key = normalizePlaylistListUrl(analyzedUrl || currentSavedCollectionKey);
    return savedSummaries.find((summary) => normalizePlaylistListUrl(summary.key) === key || normalizePlaylistListUrl(summary.analyzedUrl) === key) || null;
  }, [analyzedUrl, currentSavedCollectionKey, savedSummaries]);
  const genreMembershipByVideoKey = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const membership of genreScan?.memberships || []) {
      const tags = mergeSavedTags(
        membership.genres,
        membership.storySignals,
        [membership.title, membership.year || "", membership.source || ""],
      );
      if (!tags.length) continue;
      map.set(String(membership.videoKey || membership.video?.id || membership.video?.playUrl || ""), tags);
    }
    return map;
  }, [genreScan?.memberships]);
  const currentFilterTags = useMemo(() => {
    return mergeSavedTags(currentSavedSummary?.allTags, currentSavedSummary?.tags, currentSavedSummary?.autoTags, orderedGenreGroups.map((group) => group.genre));
  }, [currentSavedSummary, orderedGenreGroups]);
  const visibleVideos = useMemo(() => {
    if (!activeVideoTags.length) return sortedVideos;
    const wanted = activeVideoTags.map((tag) => tag.toLowerCase());
    return sortedVideos.filter((video) => {
      const text = `${video.title || ""} ${video.author || ""} ${video.authorHandle || ""} ${(video as any).description || ""}`.toLowerCase();
      const videoKey = String(video.id || video.playUrl || (video as any).url || "");
      const genreTags = genreMembershipByVideoKey.get(videoKey) || [];
      return wanted.some((tag) => text.includes(tag) || genreTags.some((item) => item.toLowerCase() === tag));
    });
  }, [activeVideoTags, genreMembershipByVideoKey, sortedVideos]);

  const startBatchAnalysis = useCallback(async () => {
    if (batchAnalysisRunning || !visibleVideos.length) return;
    setBatchAnalysisRunning(true);
    cancelBatchAnalysisRef.current = false;
    setError(null);
    setBatchScanProgress(null);

    try {
      if (loadedFromSaved && currentSavedCollectionKey) {
        let localAnalyses = { ...postAnalyses };
        const pendingVideos = visibleVideos.filter((video) => !localAnalyses[slugifySavedPost(video)]?.result);

        setBatchScanProgress({
          done: visibleVideos.length - pendingVideos.length,
          total: visibleVideos.length,
          phase: "identify",
        });

        for (const video of pendingVideos) {
          if (cancelBatchAnalysisRef.current) break;

          const slug = slugifySavedPost(video);
          flushSync(() => setCurrentScanningSlug(slug));

          const scan = await scanSavedPlaylistMovies(currentSavedCollectionKey, {
            batchSize: 1,
            slug,
            skipMovieCache: true,
            geminiFallback: true,
          });
          if (scan?.analyses) {
            localAnalyses = mergePostAnalyses(localAnalyses, scan.analyses);
            setPostAnalyses((prev) => mergePostAnalyses(prev, scan.analyses));
            for (const [savedSlug, analysis] of Object.entries(scan.analyses)) {
              if (analysis?.result) writeLocalSavedPostAnalysis(savedSlug, analysis);
            }
          }

          const analyzedCount = visibleVideos.filter((item) => localAnalyses[slugifySavedPost(item)]?.result).length;
          setBatchScanProgress({ done: analyzedCount, total: visibleVideos.length, phase: "identify" });
        }
        return;
      }

      const pendingCount = visibleVideos.filter((video) => !postAnalyses[slugifySavedPost(video)]?.result).length;
      setBatchScanProgress({ done: 0, total: pendingCount });
      let completed = 0;

      for (let i = 0; i < visibleVideos.length; i++) {
        if (cancelBatchAnalysisRef.current) {
          break;
        }
        const video = visibleVideos[i];
        const slug = slugifySavedPost(video);

        if (postAnalyses[slug]) {
          continue;
        }

        flushSync(() => setCurrentScanningSlug(slug));

        try {
          const result = await identifyTikTokVideoMovie(video);
          await persistPostAnalysis(slug, video, result);
          completed += 1;
          setBatchScanProgress({ done: completed, total: pendingCount });
        } catch (err) {
          console.error(`Batch analysis failed for video ${video.id || i}:`, err);
        }
      }
    } finally {
      setBatchAnalysisRunning(false);
      setCurrentScanningSlug("");
      setBatchScanProgress(null);
      cancelBatchAnalysisRef.current = false;
    }
  }, [batchAnalysisRunning, visibleVideos, postAnalyses, persistPostAnalysis, loadedFromSaved, currentSavedCollectionKey]);

  const stopBatchAnalysis = useCallback(() => {
    cancelBatchAnalysisRef.current = true;
    setBatchAnalysisRunning(false);
  }, []);
  const topTabClass = (active: boolean) => cn(
    "inline-flex h-12 shrink-0 items-center gap-2 border-b-2 px-1 text-sm font-black transition",
    active ? "border-[#f9dc0b]" : "border-transparent",
    active
      ? isDark ? "text-white" : "text-[#1A1A1A]"
      : isDark ? "text-white/40 hover:text-white/75" : "text-[#1A1A1A]/40 hover:text-[#1A1A1A]/75",
  );
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
            <div className="flex items-center gap-2 text-[#f9dc0b]">
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[#f9dc0b]/10"><User className="h-3 w-3" /></div>
              {channelListingUrl(selectedVideo) ? (
                <button type="button" onClick={(e) => openChannel(e, selectedVideo)} disabled={loading} title="Open channel videos" className="text-left text-xs font-semibold text-[#f9dc0b] underline-offset-2 hover:underline disabled:opacity-50">
                  {selectedVideo.author} (@{selectedVideo.authorHandle})
                </button>
              ) : (
                <span className="text-xs font-semibold">{selectedVideo.author} (@{selectedVideo.authorHandle})</span>
              )}
            </div>
            <h2 className="break-words font-serif text-xl font-bold leading-snug sm:text-2xl" style={{ color: text }}>{selectedVideo.title}</h2>
            {videoDurationSeconds(selectedVideo) ? <p className="inline-flex w-fit items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold" style={{ background: softSurface, color: muted }}><Clock3 className="h-3.5 w-3.5" />{formatVideoLength(videoDurationSeconds(selectedVideo))}</p> : null}
          </div>

          <button type="button" onClick={() => analyzePostInline(selectedVideo)} disabled={selectedPostAnalyzing} className="group flex min-h-12 w-full items-center justify-center gap-3 rounded-full bg-[#f9dc0b] px-6 py-3 text-center text-xs font-bold text-[#1A1A1A] shadow-xl shadow-[#f9dc0b]/25 transition-all hover:bg-[#1A1A1A] hover:text-white sm:w-fit sm:px-8 sm:py-4">
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

  if (viewMode === "focused" && playlist && selectedVideo) {
    const detailTabs: { id: MainTab; label: string }[] = [
      { id: "post", label: "Post" },
      { id: "movie", label: "Movie ID" },
      { id: "transcript", label: "Transcript" },
      { id: "story", label: "Story" },
      { id: "visuals", label: "Visuals" },
      { id: "niche", label: "Niche" },
      { id: "evidence", label: "Evidence" },
      { id: "details", label: "Details" },
    ];
    const hasAnalysis = !!selectedPostAnalysis?.result;
    return (
      <section className="workspace-floating-shell relative flex h-full min-h-0 flex-col overflow-hidden" style={{ background: bgCard, color: text }}>
        {/* ── Top bar ── */}
        <header className="workspace-floating-header flex min-h-12 items-center gap-2 px-4">
          {/* Back button */}
          <button
            type="button"
            onClick={() => {
              setViewMode("grid");
              setSavedCollectionView("videos");
              setSelectedVideo(null);
              if (playlist && analyzedUrl) writeDeepLink({ view: "tiktok", tab: listTab, slug: routeSlugForList(listTab, analyzedUrl, playlist.title) });
            }}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg transition"
            style={{ color: muted }}
            aria-label="Back to videos"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>

          {/* Divider */}
          {/* Analysis tabs inline */}
          <nav className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {detailTabs.map((tab) => {
              const isActive = activeDetailTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  disabled={!hasAnalysis && tab.id !== "post" && selectedPostAnalyzing}
                  onClick={() => {
                    if (!hasAnalysis && tab.id !== "post") {
                      void analyzePostInline(selectedVideo);
                      return;
                    }
                    setActiveDetailTab(tab.id);
                  }}
                  className={cn(
                    "inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold transition",
                    isActive
                      ? isDark ? "bg-white/10 text-white" : "bg-[#1C1A16] text-white"
                      : hasAnalysis || tab.id === "post"
                        ? isDark ? "text-white/60 hover:bg-white/8 hover:text-white" : "text-[#1A1A1A]/50 hover:bg-[#1A1A1A]/5 hover:text-[#1A1A1A]"
                        : "cursor-not-allowed opacity-30",
                  )}
                >
                  {tab.id === "post" && <Film className="h-3 w-3" />}
                  {tab.label}
                </button>
              );
            })}
          </nav>

          {/* Right actions */}
          <div className="flex shrink-0 items-center gap-2">
            {videoDurationSeconds(selectedVideo) ? (
              <span className="hidden rounded-lg px-3 py-1.5 text-xs font-bold sm:inline-flex" style={{ background: softSurface, color: muted }}>
                {formatVideoLength(videoDurationSeconds(selectedVideo))}
              </span>
            ) : null}
            <button
              type="button"
              onClick={() => analyzePostInline(selectedVideo)}
              disabled={selectedPostAnalyzing}
              className="inline-flex min-h-9 items-center gap-2 rounded-lg bg-[#f9dc0b] px-4 text-xs font-black text-[#1A1A1A] transition hover:bg-[#1A1A1A] hover:text-white disabled:opacity-60"
            >
              {selectedPostAnalyzing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
              {selectedPostAnalysis ? "Re-analyze" : "Analyze clip"}
            </button>
          </div>
        </header>

        {/* ── Content area — full width/height ── */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {selectedPostAnalysis?.result ? (
            <MovieAnalysisTabs
              result={selectedPostAnalysis.result}
              savedAt={selectedPostAnalysis.analyzedAt}
              compact
              hideTabs
              postContent={selectedPostContent}
              postLabel="Post"
              activeTab={activeDetailTab}
              onTabChange={setActiveDetailTab}
              onUploadToYoutube={() => {
                setActiveMovieIdModalVideo(selectedVideo);
                if (selectedPostAnalysis?.result) {
                  setYoutubeUploadForm({
                    title: `${selectedPostAnalysis.result.title || "Movie"} (${selectedPostAnalysis.result.year || ""}) Recap`.slice(0, 100),
                    description: selectedPostAnalysis.result.videoAnalysis?.framework?.scriptStandards?.finalScript || selectedPostAnalysis.result.summary || "",
                    tags: mergeSavedTags(selectedPostAnalysis.result.tmdb?.genres, selectedPostAnalysis.result.mal?.genres, [selectedPostAnalysis.result.year]).join(", "),
                    postAsShort: true,
                    privacyStatus: "private",
                    madeForKids: false,
                    playlistId: "",
                    newPlaylistTitle: "",
                  });
                  setYoutubeUploadError("");
                  setYoutubeUploadResult(null);
                }
              }}
            />
          ) : (
            <div className="p-4 md:p-6">
              {/* Post content (video + meta) */}
              {selectedPostContent}
              {/* Locked/loading state */}
              {selectedPostAnalyzing ? (
                <div className="mt-6 flex items-center gap-3 rounded-xl border px-5 py-4 text-sm font-semibold" style={{ borderColor: `${accent}30`, background: `${accent}0d`, color: accent }}>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Analyzing clip… fetching comments, then Movie ID.
                </div>
              ) : (
                <div className="mt-6 rounded-xl border border-dashed px-5 py-4 text-sm" style={{ borderColor: border, color: muted }}>
                  {analysisError || "Hit Analyze clip to unlock Movie ID, Transcript, Story, Visuals, Niche, Evidence, and Details."}
                </div>
              )}
            </div>
          )}
        </div>
      </section>
    );
  }

  return (
    <div className="workspace-floating-shell relative flex h-full min-h-0 flex-col overflow-hidden" style={{ background: bgCard, color: text }}>
      {/* ── Top bar: row 1 is navigation, row 2 is the list toolbar ── */}
      <header className="workspace-floating-header shrink-0">
        <div className="flex min-h-12 items-center gap-2 overflow-x-auto overscroll-x-contain px-3 sm:px-4 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {viewMode === "focused" && playlist ? (
          <button
            type="button"
            onClick={() => {
              setViewMode("grid");
              setSelectedVideo(null);
              if (playlist && analyzedUrl) writeDeepLink({ view: "tiktok", tab: listTab, slug: routeSlugForList(listTab, analyzedUrl, playlist.title) });
            }}
            className={topTabClass(true)}
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span className="max-w-[46vw] truncate xl:max-w-[360px]">{focusedBackLabel}</span>
          </button>
        ) : (
          <>
            {loadedFromSaved && playlist ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setMainTab("saved");
                    setLoadedFromSaved(false);
                    setViewMode("grid");
                    setSelectedVideo(null);
                    setSavedCollectionView("videos");
                    void refreshSaved();
                    writeDeepLink({ view: "tiktok", section: "saved" });
                  }}
                  className={topTabClass(false)}
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  Saved collections
                </button>
                {viewMode === "grid" && currentSavedCollectionKey && (
                  <nav className="flex min-w-0 shrink-0 gap-5 overflow-x-auto overscroll-x-contain border-l pl-5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" aria-label="Saved source organization" style={{ borderColor: border }}>
                    <button type="button" onClick={() => setSavedCollectionView("videos")} className={topTabClass(savedCollectionView === "videos")}>
                      <ListVideo className="h-3.5 w-3.5" />
                      Videos
                    </button>
                    <button type="button" onClick={() => setSavedCollectionView("genres")} className={topTabClass(savedCollectionView === "genres")}>
                      <Layers3 className="h-3.5 w-3.5" />
                      Genres
                    </button>
                  </nav>
                )}
              </>
            ) : (
              <nav className="flex min-w-0 shrink-0 gap-5 overflow-x-auto overscroll-x-contain [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" aria-label="TikTok Explorer views">
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
                  className={topTabClass(mainTab === "analyze")}
                >
                  <Search className="h-3.5 w-3.5" />
                  Analyze
                </button>
                <button
                  type="button"
                  onClick={() => { setMainTab("saved"); void refreshSaved(); writeDeepLink({ view: "tiktok", section: "saved" }); }}
                  className={topTabClass(mainTab === "saved")}
                >
                  <Library className="h-3.5 w-3.5" />
                  Saved
                </button>
              </nav>
            )}

            {mainTab === "analyze" && (collectionCache || channelCache || loadingTarget) && (
              <nav className="flex min-w-0 shrink-0 gap-5 overflow-x-auto overscroll-x-contain border-l pl-5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" aria-label="Loaded TikTok source" style={{ borderColor: border }}>
                <button
                  type="button"
                  onClick={() => switchListTab("collection")}
                  disabled={!collectionCache && loadingTarget !== "collection"}
                  className={cn(topTabClass(listTab === "collection"), "disabled:pointer-events-none disabled:opacity-30")}
                >
                  <ListVideo className="h-3.5 w-3.5" />
                  Playlist
                </button>
                <button
                  type="button"
                  onClick={() => switchListTab("channel")}
                  disabled={!channelCache && loadingTarget !== "channel"}
                  className={cn(topTabClass(listTab === "channel"), "disabled:pointer-events-none disabled:opacity-30")}
                >
                  <User className="h-3.5 w-3.5" />
                  Channel
                  {channelTabHandle && <span className="font-mono normal-case tracking-normal opacity-80">@{channelTabHandle}</span>}
                </button>
              </nav>
            )}

            {/* Row 1 right side: where you are — source name and video count */}
            <div className="ml-auto flex min-w-0 shrink-0 items-center gap-2 py-2">
              {mainTab === "saved" && !(loadedFromSaved && playlist) && (
                <span className="shrink-0 rounded-full px-3 py-1 text-xs font-semibold" style={{ background: accentBg, color: accent }}>
                  {savedSummaries.length} saved
                </span>
              )}
              {playlist && (loadedFromSaved || mainTab === "analyze") && (
                <>
                  {focusedSourceName ? <span className="hidden max-w-[260px] truncate text-sm font-black lg:block" style={{ color: text }}>{focusedSourceName}</span> : null}
                  <span className="shrink-0 rounded-full px-3 py-1 text-xs font-semibold" style={{ background: accentBg, color: accent }}>
                    {visibleVideos.length === playlist.videos.length ? playlist.videos.length : `${visibleVideos.length}/${playlist.videos.length}`} videos
                  </span>
                </>
              )}
            </div>
          </>
        )}
        </div>

        {/* Row 2: list toolbar — actions on the left, view filters on the right */}
        {viewMode === "grid" && playlist && mainTab === "analyze" && !(savedCollectionView === "genres" && currentSavedCollectionKey) ? (
          <div className="flex min-h-11 items-center gap-2 overflow-x-auto overscroll-x-contain px-3 py-1.5 sm:px-4 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <button
              type="button"
              onClick={batchAnalysisRunning ? stopBatchAnalysis : startBatchAnalysis}
              className="flex h-9 shrink-0 items-center gap-2 rounded-lg px-4 text-xs font-semibold transition-all disabled:opacity-60"
              style={{
                background: batchAnalysisRunning ? "rgba(239, 68, 68, 0.15)" : accent,
                color: batchAnalysisRunning ? "#ef4444" : "#1A1A1A",
                border: batchAnalysisRunning ? "1px solid rgba(239, 68, 68, 0.3)" : `1px solid ${border}`
              }}
            >
              {batchAnalysisRunning ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" style={{ color: "#ef4444" }} />
              ) : (
                <Zap className="h-3.5 w-3.5" style={{ color: "#1A1A1A" }} />
              )}
              {batchAnalysisRunning ? "Stop scanning" : loadedFromSaved ? "Scan all videos" : "Analyze all clips"}
            </button>
            {batchAnalysisRunning && batchScanProgress ? (
              <span className="shrink-0 rounded-full px-3 py-1 text-xs font-semibold" style={{ background: accentBg, color: accent }}>
                {batchScanProgress.phase === "comments"
                  ? `Syncing comments ${batchScanProgress.done}/${batchScanProgress.total}`
                  : `Identifying ${Math.min(batchScanProgress.done + 1, batchScanProgress.total)}/${batchScanProgress.total}`}
              </span>
            ) : null}
            <button type="button" onClick={saveOrUpdatePlaylist} disabled={loading} className="flex h-9 shrink-0 items-center gap-2 rounded-lg px-4 text-xs font-semibold transition-all disabled:cursor-wait disabled:opacity-60" style={{ background: bg, color: text, border: `1px solid ${border}` }}>
              {loadedFromSaved && loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" style={{ color: accent }} /> : <Bookmark className="h-3.5 w-3.5" style={{ color: accent }} />}
              {playlistActionLabel}
            </button>
            {saveNotice && <span className="shrink-0 text-xs font-semibold" style={{ color: "#16a34a" }}>{saveNotice}</span>}
            <div className="ml-auto flex shrink-0 items-center gap-2">
              <label className="flex h-9 shrink-0 items-center gap-2 rounded-lg px-3 text-xs font-semibold" style={{ background: bg, color: muted, border: `1px solid ${border}` }}>
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
              <label className="flex h-9 shrink-0 items-center gap-2 rounded-lg px-3 text-xs font-semibold" style={{ background: bg, color: muted, border: `1px solid ${border}` }}>
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
            </div>
          </div>
        ) : null}
      </header>

      {/* ── Scrollable content area ── */}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-4 sm:py-4 md:px-6">
      {mainTab === "saved" ? (
        <div className="space-y-6">
          {error && <div className="rounded-xl border border-[#f9dc0b]/18 bg-white p-4 text-sm text-[#6a5b00]">{error}</div>}
          {savedSummaries.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[#1A1A1A]/15 bg-white/80 p-12 text-center text-sm text-[#1A1A1A]/45">
              No saved playlists yet. Analyze a URL and save the playlist.
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
              {savedSummaries.map((s) => (
                <StandardPlaylistCard
                  key={s.key}
                  title={s.title}
                  kind={isBareTikTokProfileUrl(s.analyzedUrl) ? "channel" : "playlist"}
                  meta={`${s.videoCount} videos`}
                  media={<TikTokCoverImage src={s.thumb} className="h-full w-full object-cover transition duration-500 group-hover:scale-105" />}
                  onOpen={() => openSaved(s.key)}
                  theme={isDark ? "dark" : "light"}
                  topRight={<div className="flex items-center gap-1.5">
                    <button type="button" onClick={(e) => reprocessSaved(e, s)} disabled={!!reprocessingKeys[s.key]} className="grid h-8 w-8 place-items-center rounded-lg border border-white/15 bg-black/50 text-white shadow-sm backdrop-blur-md transition hover:bg-white hover:text-[#1A1A1A] disabled:cursor-wait disabled:opacity-45" title={`Update saved playlist with up to ${VIDEO_COUNT_MAX} videos`} aria-label="Update saved playlist">
                      <RefreshCw className={cn("h-3.5 w-3.5", reprocessingKeys[s.key] && "animate-spin")} />
                    </button>
                    <button type="button" onClick={(e) => deleteSaved(e, s.key)} className="grid h-8 w-8 place-items-center rounded-lg border border-white/15 bg-black/50 text-white shadow-sm backdrop-blur-md transition hover:bg-[#f9dc0b] hover:text-[#1A1A1A]" title="Remove save" aria-label="Remove saved playlist">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>}
                />
              ))}
            </div>
          )}
        </div>
      ) : (
        <>
        {/* Empty state — search bar is in header */}
          {!loadedFromSaved && !collectionCache && !channelCache && !loadingTarget && (
            <div className="flex h-full flex-col items-center justify-center gap-6 py-10 text-center sm:gap-8 sm:py-20">
              <div className="grid h-16 w-16 place-items-center rounded-2xl" style={{ background: "#f9dc0b20" }}>
                <Zap className="h-7 w-7 text-[#f9dc0b]" />
              </div>
              <form onSubmit={handleSearch} className="w-full max-w-3xl rounded-xl border p-2 shadow-sm" style={{ borderColor: border, background: isDark ? "rgba(255,255,255,0.04)" : "#FAFAFB" }}>
                <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_150px]">
                  <label className="relative min-w-0">
                    <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: muted }} />
                    <input
                      type="text"
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      placeholder="Paste a TikTok profile, playlist, or collection URL"
                      className="h-12 w-full rounded-lg border bg-transparent pl-11 pr-4 text-sm font-semibold outline-none transition"
                      style={{ borderColor: isDark ? "rgba(255,255,255,0.08)" : "transparent", color: text, background: isDark ? "rgba(255,255,255,0.035)" : "#FFFFFF" }}
                    />
                  </label>
                  <button
                    type="submit"
                    disabled={loading || !url.trim()}
                    className="inline-flex h-12 items-center justify-center gap-2 rounded-lg px-4 text-sm font-black transition disabled:opacity-50"
                    style={{ background: "#f9dc0b", color: "#1A1A1A" }}
                  >
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                    Search
                  </button>
                </div>
              </form>
              <div>
                <h1 className="font-serif text-xl font-bold" style={{ color: text }}>Explore TikTok videos</h1>
                <p className="mt-2 max-w-sm text-sm" style={{ color: muted }}>Paste a profile, playlist, collection, or video URL. Gemini runs only when you analyze a clip for Movie ID.</p>
              </div>
            </div>
          )}

          {loadingTarget && !playlist && (
            <div className="flex min-h-[260px] flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-[#1A1A1A]/10 bg-white/90 py-16 shadow-sm">
              <Loader2 className="h-10 w-10 animate-spin text-[#f9dc0b]" aria-hidden />
              <p className="max-w-md text-center text-sm text-[#1A1A1A]/50">Loading {loadingTarget === "channel" ? "channel videos" : "playlist videos"} with TikTok-Api.</p>
            </div>
          )}

          <AnimatePresence mode="sync">
            {error && (
              <motion.div key="tiktok-error-banner" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className="flex gap-4 rounded-xl border border-[#f9dc0b]/18 bg-white p-6 shadow-sm">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#fff9d6] text-[#f9dc0b]"><Film className="h-5 w-5" /></div>
                <div>
                  <h4 className="text-sm font-bold text-[#443b00]">Request error</h4>
                  <p className="text-sm text-[#6a5b00]/65">{error}</p>
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
                          hideTabs
                          postContent={selectedPostContent}
                          postLabel="Post"
                          initialTab="movie"
                        />
                      ) : (
                        <LockedAnalysisTabs
                          postContent={selectedPostContent}
                          loading={selectedPostAnalyzing}
                          error={analysisError}
                          hideTabs
                        />
                      )}
                    </motion.div>
                  ) : (
                    <div className="flex h-[420px] flex-col items-center justify-center rounded-xl border border-dashed border-[#1A1A1A]/10 bg-white text-[#1A1A1A]/30">
                      <Play className="mb-6 h-14 w-14 opacity-20" />
                      <p className="text-sm">Select a video to analyze</p>
                    </div>
                  )
                ) : savedCollectionView === "genres" && currentSavedCollectionKey ? (
                  <section className="space-y-5">
                    <div className="flex flex-col gap-3 border-b pb-4 sm:flex-row sm:items-end sm:justify-between" style={{ borderColor: border }}>
                      <div>
                        <div className="flex flex-wrap items-center gap-2 text-xs font-semibold" style={{ color: muted }}>
                          <Tags className="h-3.5 w-3.5" style={{ color: accent }} />
                          Fast transcript story genres
                          {genreScan?.summary ? (
                            <span className="rounded-full px-2 py-0.5 font-mono" style={{ background: softSurface, color: text }}>
                              {genreScan.summary.scanned}/{genreScan.summary.total} scanned
                            </span>
                          ) : null}
                        </div>
                        <h2 className="mt-2 font-serif text-xl font-bold" style={{ color: text }}>
                          Story genre subcollections
                        </h2>
                        <p className="mt-1 max-w-2xl text-sm" style={{ color: muted }}>
                          Pending clips are grouped from their narration transcript. Trusted Movie ID clips keep official TMDB or MAL genres when those are already available.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={scanGenreCollection}
                        disabled={genreScanBusy || genreScanLoading || !playlist.videos.length}
                        className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-lg px-4 text-sm font-black transition disabled:cursor-wait disabled:opacity-55"
                        style={{ background: accent, color: "#1A1A1A" }}
                      >
                        {genreScanBusy || genreScanLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                        {genreScan?.summary.pending ? `Analyze ${genreScan.summary.pending} pending` : genreScan?.summary.scanned ? "Refresh pending" : "Analyze story genres"}
                      </button>
                    </div>
                    {genreScan?.summary ? (
                      <div className="grid gap-2 text-xs font-semibold sm:grid-cols-5">
                        {[
                          ["Official", genreScan.summary.verified, ""],
                          ["Story grouped", genreScan.summary.inferred, ""],
                          ["Needs review", genreScan.summary.needsReview, "Needs Review"],
                          ["Pending", genreScan.summary.pending, ""],
                          ["Genres", genreScan.groups.filter((group) => group.genre !== "Needs Review").length, ""],
                        ].map(([label, value, targetGenre]) => (
                          <button
                            key={String(label)}
                            type="button"
                            disabled={!targetGenre || !Number(value)}
                            onClick={() => targetGenre && setActiveGenre(String(targetGenre))}
                            className={cn(
                              "rounded-lg border px-3 py-2 text-left transition disabled:cursor-default",
                              targetGenre && Number(value) ? "hover:-translate-y-0.5 hover:shadow-sm" : "",
                            )}
                            style={activeGenre === targetGenre
                              ? { background: accent, borderColor: accent, color: "#1A1A1A" }
                              : { background: bg, borderColor: border }}
                          >
                            <p style={{ color: muted }}>{label}</p>
                            <p className="mt-1 font-mono text-sm" style={{ color: text }}>{value}</p>
                          </button>
                        ))}
                      </div>
                    ) : null}
                    {genreScan?.groups?.length ? (
                      <>
                        <div className="flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                          {orderedGenreGroups.map((group) => (
                            <button
                              key={group.genre}
                              type="button"
                              onClick={() => setActiveGenre(group.genre)}
                              className="inline-flex h-9 shrink-0 items-center gap-2 rounded-full border px-3 text-xs font-bold transition"
                              style={activeGenreGroup?.genre === group.genre
                                ? { borderColor: accent, background: accent, color: "#1A1A1A" }
                                : { borderColor: border, background: bg, color: text }}
                            >
                              {group.genre}
                              <span className="rounded-full px-1.5 py-0.5 font-mono text-[10px]" style={{ background: activeGenreGroup?.genre === group.genre ? "rgba(26,26,26,0.12)" : softSurface }}>
                                {group.count}
                              </span>
                            </button>
                          ))}
                        </div>
                        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,10rem),1fr))] gap-3 sm:gap-5">
                          {(activeGenreGroup?.items || []).map((membership, gi) => {
                            const video = membership.video;
                            return (
                              <motion.div
                                key={`${membership.videoKey}-${activeGenreGroup?.genre || "genre"}`}
                                layout
                                initial={{ opacity: 0, scale: 0.98 }}
                                animate={{ opacity: 1, scale: 1 }}
                                className="min-w-0"
                              >
                                <StandardVideoCard
                                  title={video.title || membership.title || "Saved clip"}
                                  source={video.author || membership.title || "TikTok"}
                                  description={membership.status === "inferred" ? membership.storySummary || "Grouped from narration transcript" : membership.status === "needs_review" ? "Needs transcript or Movie ID review" : ""}
                                  meta={`${formatValue(video.stats?.playCount || 0)} views${videoDurationSeconds(video) ? ` / ${formatVideoLength(videoDurationSeconds(video))}` : ""}`}
                                  media={<TikTokCoverImage src={video.dynamicCover} fallbacks={tiktokVideoCoverCandidates(video)} className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105" />}
                                  onOpen={() => openFocusedVideo(video)}
                                  badge={videoDurationSeconds(video) ? formatVideoLength(videoDurationSeconds(video)) : "TikTok"}
                                  topRight={<ThumbnailDownloadButton busy={!!downloadingIds[videoDomKey(video, gi)]} onClick={(e) => handleDownload(e, video, gi)} />}
                                  contentTop={<div className="flex flex-wrap gap-1">{(membership.genres || []).slice(0, 2).map((genre) => <span key={genre} className="rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-black">{genre}</span>)}</div>}
                                  theme={isDark ? "dark" : "light"}
                                />
                              </motion.div>
                            );
                          })}
                        </div>
                      </>
                    ) : (
                      <div className="flex min-h-[320px] flex-col items-center justify-center rounded-xl border border-dashed px-6 py-14 text-center" style={{ borderColor: border, background: bg }}>
                        <Layers3 className="h-9 w-9" style={{ color: accent }} />
                        <p className="mt-4 text-sm font-bold" style={{ color: text }}>No story genre subcollections yet</p>
                        <p className="mt-2 max-w-md text-sm" style={{ color: muted }}>
                          Analyze this saved source to group narration transcripts into story genres. Clips with trusted Movie ID metadata keep official TMDB or MAL genres too.
                        </p>
                      </div>
                    )}
                  </section>
                ) : (
                  <div className="space-y-4">
                    {currentFilterTags.length ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="inline-flex h-8 items-center gap-1 rounded-full px-2 text-[11px] font-black uppercase tracking-widest" style={{ color: muted }}>
                          <Tags className="h-3.5 w-3.5" />
                          Tags
                        </span>
                        {currentFilterTags.slice(0, 28).map((tag) => {
                          const active = activeVideoTags.some((item) => item.toLowerCase() === tag.toLowerCase());
                          return (
                            <button
                              key={tag}
                              type="button"
                              onClick={() => setActiveVideoTags((prev) => active ? prev.filter((item) => item.toLowerCase() !== tag.toLowerCase()) : [...prev, tag])}
                              className="inline-flex h-8 items-center rounded-full border px-3 text-xs font-black transition"
                              style={active ? { borderColor: accent, background: accent, color: "#1A1A1A" } : { borderColor: border, background: bg, color: text }}
                            >
                              {tag}
                            </button>
                          );
                        })}
                        {activeVideoTags.length ? (
                          <button type="button" onClick={() => setActiveVideoTags([])} className="h-8 rounded-full px-3 text-xs font-black" style={{ color: muted }}>
                            Clear
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                    <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,10rem),1fr))] gap-3 sm:gap-5">
                    {visibleVideos.map((video, vi) => {
                      const slug = slugifySavedPost(video);
                      const isProcessed = !!postAnalyses[slug];
                      const isScanning = analyzingPostSlug === slug || currentScanningSlug === slug;
                      const sourceDisplay = isProcessed && postAnalyses[slug]?.result
                        ? getMovieIdentificationSourceDisplay(postAnalyses[slug].result)
                        : null;

                      const handleCardClick = () => {
                        openFocusedVideo(video);
                      };

                      return (
                        <motion.div key={videoDomKey(video, vi)} layout initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: isScanning ? 1.02 : 1 }} className="min-w-0">
                          <StandardVideoCard
                            title={video.title || "Untitled TikTok"}
                            source={video.author || "TikTok"}
                            onSourceClick={channelListingUrl(video) ? (e) => openChannel(e, video) : undefined}
                            meta={`${formatValue(video.stats?.playCount || 0)} views / ${formatValue(video.stats?.diggCount || 0)} likes${videoDurationSeconds(video) ? ` / ${formatVideoLength(videoDurationSeconds(video))}` : ""}`}
                            media={<TikTokCoverImage src={video.dynamicCover} fallbacks={tiktokVideoCoverCandidates(video)} className={cn("h-full w-full object-cover transition-transform duration-700", isScanning ? "scale-105 blur-[1px]" : "group-hover:scale-105")} />}
                            onOpen={handleCardClick}
                            badge={!isProcessed && videoDurationSeconds(video) ? formatVideoLength(videoDurationSeconds(video)) : undefined}
                            topLeft={isProcessed && !isScanning ? <div className="flex max-w-full flex-col gap-1">
                              <span className="flex h-7 w-fit max-w-full items-center gap-1.5 rounded-lg bg-[#16a34a] px-2.5 py-1 text-[11px] font-black text-white shadow-md ring-1 ring-white/20"><Check className="h-3.5 w-3.5 shrink-0 stroke-[3.5]" /><span className="truncate tracking-wide">PROCESSED</span></span>
                              {sourceDisplay ? <span className="w-fit max-w-full rounded-lg bg-black/75 px-2 py-1 text-[10px] font-black uppercase tracking-wide text-white ring-1 ring-white/15">{sourceDisplay.label}</span> : null}
                            </div> : undefined}
                            topRight={<ThumbnailDownloadButton busy={!!downloadingIds[videoDomKey(video, vi)]} onClick={(e) => handleDownload(e, video, vi)} />}
                            overlay={isScanning ? <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex h-full w-full flex-col items-center justify-center bg-black/70 p-3 text-center text-white backdrop-blur-xs">
                              <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: "linear" }}><Loader2 className="mb-2 h-8 w-8 text-[#f9dc0b]" /></motion.div>
                              <span className="text-xs font-black uppercase tracking-wider text-[#f9dc0b]">Scanning clip...</span>
                              <span className="mt-1 text-[10px] leading-normal text-white/70">{batchScanProgress?.phase === "comments" ? "Fetching comments locally and pushing to VPS" : "Comment Movie ID on VPS, then AI fallback if needed"}</span>
                            </motion.div> : undefined}
                            theme={isDark ? "dark" : "light"}
                            className={isScanning ? "ring-2 ring-[#f9dc0b] ring-offset-2" : undefined}
                          />
                        </motion.div>
                      );
                    })}
                    </div>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}
      </div>
      <AnimatePresence>
        {activeMovieIdModalVideo && (() => {
          const slug = slugifySavedPost(activeMovieIdModalVideo);
          const analysis = postAnalyses[slug];
          if (!analysis?.result) return null;

          return (
            <motion.div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3 backdrop-blur-sm sm:p-4 overflow-y-auto"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => {
                if (!isUploadingToYoutube) {
                  setActiveMovieIdModalVideo(null);
                  setYoutubeUploadResult(null);
                  setYoutubeUploadError("");
                }
              }}
            >
              <motion.div
                className="relative w-full max-w-5xl rounded-2xl border bg-white shadow-2xl overflow-hidden flex flex-col max-h-[92dvh]"
                style={{ borderColor: "rgba(28,26,22,0.12)" }}
                initial={{ y: 24, scale: 0.98 }}
                animate={{ y: 0, scale: 1 }}
                exit={{ y: 24, scale: 0.98 }}
                onClick={(event) => event.stopPropagation()}
              >
                {/* Modal Header */}
                <div className="flex items-center justify-between border-b border-[#1A1A1A]/8 bg-[#FDFCFA] px-5 py-4 shrink-0">
                  <div>
                    <span className="text-[10px] font-black uppercase tracking-widest text-[#f9dc0b]">Movie ID details</span>
                    <h3 className="text-lg font-black leading-tight text-[#1A1A1A] mt-0.5">{analysis.result.title || "Identified Title"}</h3>
                  </div>
                  <button
                    type="button"
                    disabled={isUploadingToYoutube}
                    onClick={() => {
                      setActiveMovieIdModalVideo(null);
                      setYoutubeUploadResult(null);
                      setYoutubeUploadError("");
                    }}
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-[#1A1A1A]/10 text-[#1A1A1A]/55 hover:bg-[#F9F8F6] disabled:opacity-40"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                {/* Modal Content */}
                <div className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
                  {youtubeUploadResult ? (
                    <div className="mx-auto max-w-xl rounded-2xl border border-[#16a34a]/30 bg-green-50/50 p-6 text-center shadow-sm">
                      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-100 text-green-600 mb-4">
                        <Check className="h-6 w-6 stroke-[3]" />
                      </div>
                      <h4 className="text-lg font-black text-green-950">Uploaded successfully!</h4>
                      <p className="mt-2 text-sm text-green-800/80 leading-relaxed font-semibold">Your video is now live or private on your connected YouTube channel.</p>

                      <div className="mt-4 p-3 bg-white rounded-xl border border-green-100 text-left font-serif text-sm font-bold text-green-900 leading-snug">
                        {youtubeUploadResult.title}
                      </div>

                      <div className="mt-6 flex flex-wrap justify-center gap-3">
                        <a
                          href={youtubeUploadResult.url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-[#FF0000] px-5 text-xs font-black text-white hover:bg-[#CC0000] transition-colors"
                        >
                          <Youtube className="h-4.5 w-4.5" />
                          View on YouTube
                        </a>
                        <button
                          type="button"
                          onClick={() => setYoutubeUploadResult(null)}
                          className="inline-flex h-10 items-center justify-center rounded-xl border border-[#1A1A1A]/10 bg-white px-5 text-xs font-black text-[#1A1A1A]/70 hover:bg-[#F9F8F6] transition-all"
                        >
                          Upload Again
                        </button>
                      </div>
                    </div>
                  ) : isUploadingToYoutube ? (
                    <div className="mx-auto max-w-md py-12 text-center">
                      <Loader2 className="mx-auto h-12 w-12 animate-spin text-[#f9dc0b] mb-4" />
                      <h4 className="text-base font-black text-[#1A1A1A]">{uploadProgressMessage}</h4>
                      <p className="mt-2 text-xs font-medium text-[#1A1A1A]/45">Please keep this tab open. We are fetching the video and publishing it to YouTube.</p>
                    </div>
                  ) : (
                    <div className="grid gap-6 lg:grid-cols-[2fr_1.3fr] items-start">
                      {/* Left: Movie Analysis details */}
                      <div className="min-w-0">
                        <MovieAnalysisTabs
                          result={analysis.result}
                          savedAt={analysis.analyzedAt}
                          compact
                          hideTabs={false}
                          onUploadToYoutube={async () => {
                            if (auth?.activeAccount?.id) {
                              setLoadingYoutubePlaylists(true);
                              try {
                                const response = await fetch(`/api/youtube/playlists?accountId=${encodeURIComponent(auth.activeAccount.id)}`);
                                const data = await response.json();
                                setYoutubePlaylists(data.playlists || []);
                              } catch (err) {
                                console.error("Could not load playlists:", err);
                              } finally {
                                setLoadingYoutubePlaylists(false);
                              }
                            }
                            const uploadEl = document.getElementById("youtube-upload-panel");
                            if (uploadEl) {
                              uploadEl.scrollIntoView({ behavior: "smooth" });
                            }
                          }}
                        />
                      </div>

                      {/* Right: Direct YouTube Upload Form */}
                      <div id="youtube-upload-panel" className="rounded-xl border p-5 bg-[#F9F8F6] space-y-4" style={{ borderColor: "rgba(28,26,22,0.08)" }}>
                        <div>
                          <p className="text-[9px] font-black uppercase tracking-widest text-[#FF0000]">YouTube direct publishing</p>
                          <h4 className="text-base font-black text-[#1A1A1A] mt-0.5">Publish to channel</h4>

                          {auth?.activeAccount ? (
                            <div className="mt-3 flex items-center gap-2.5 rounded-lg border border-[#FF0000]/25 bg-red-50/50 p-2.5">
                              {auth.activeAccount.thumbnailUrl ? (
                                  <img src={auth.activeAccount.thumbnailUrl} alt="" className="h-8 w-8 rounded-full object-cover ring-1 ring-red-100" referrerPolicy="no-referrer" />
                              ) : (
                                <span className="grid h-8 w-8 place-items-center rounded-full bg-[#FF0000] text-white">
                                  <Youtube className="h-4.5 w-4.5" />
                                </span>
                              )}
                              <div className="min-w-0">
                                <p className="truncate text-xs font-black text-red-950">{auth.activeAccount.channelTitle}</p>
                                <p className="text-[10px] font-semibold text-red-900/60">Currently selected channel</p>
                              </div>
                            </div>
                          ) : (
                            <div className="mt-3 rounded-lg bg-red-50/70 border border-dashed border-[#FF0000]/25 p-3 text-center text-xs font-semibold text-red-950">
                              No connected YouTube channel. Connect a channel in Channel Management.
                            </div>
                          )}
                        </div>

                        <div className="space-y-3.5">
                          <label className="block space-y-1.5">
                            <span className="text-[10px] font-black uppercase tracking-widest text-[#1A1A1A]/40">Video Title</span>
                            <input
                              value={youtubeUploadForm.title}
                              onChange={(e) => setYoutubeUploadForm((prev) => ({ ...prev, title: e.target.value.slice(0, 100) }))}
                              maxLength={100}
                              className="h-10 w-full rounded-lg border border-[#1A1A1A]/10 bg-white px-3 text-xs font-bold outline-none focus:border-[#FF0000]/50"
                              placeholder="Title (required)"
                            />
                          </label>

                          <label className="block space-y-1.5">
                            <span className="text-[10px] font-black uppercase tracking-widest text-[#1A1A1A]/40">Description</span>
                            <textarea
                              value={youtubeUploadForm.description}
                              onChange={(e) => setYoutubeUploadForm((prev) => ({ ...prev, description: e.target.value }))}
                              rows={4}
                              className="w-full resize-none rounded-lg border border-[#1A1A1A]/10 bg-white px-3 py-2 text-xs font-semibold outline-none focus:border-[#FF0000]/50 leading-relaxed"
                              placeholder="Description details"
                            />
                          </label>

                          <label className="block space-y-1.5">
                            <span className="text-[10px] font-black uppercase tracking-widest text-[#1A1A1A]/40">Tags</span>
                            <input
                              value={youtubeUploadForm.tags}
                              onChange={(e) => setYoutubeUploadForm((prev) => ({ ...prev, tags: e.target.value }))}
                              className="h-10 w-full rounded-lg border border-[#1A1A1A]/10 bg-white px-3 text-xs font-semibold outline-none focus:border-[#FF0000]/50"
                              placeholder="comma-separated tags"
                            />
                          </label>

                          <label className="flex items-center justify-between rounded-lg border border-[#1A1A1A]/8 bg-white p-2.5 cursor-pointer hover:bg-white/70">
                            <span className="min-w-0">
                              <span className="block text-xs font-black text-[#1A1A1A]">Upload as Short</span>
                              <span className="text-[9px] font-semibold text-[#1A1A1A]/40 leading-none font-sans">Format as vertical YouTube Short</span>
                            </span>
                            <span className={cn("relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-all", youtubeUploadForm.postAsShort ? "border-[#FF0000] bg-[#FF0000]" : "border-[#1A1A1A]/12 bg-[#1A1A1A]/10")}>
                              <input
                                type="checkbox"
                                checked={youtubeUploadForm.postAsShort}
                                onChange={(e) => setYoutubeUploadForm((prev) => ({ ...prev, postAsShort: e.target.checked }))}
                                className="sr-only"
                              />
                              <span className={cn("block h-4 w-4 rounded-full bg-white shadow transition-transform", youtubeUploadForm.postAsShort ? "translate-x-5.5" : "translate-x-1")} />
                            </span>
                          </label>

                          <div className="grid gap-2.5 sm:grid-cols-2">
                            <label className="block space-y-1.5">
                              <span className="text-[10px] font-black uppercase tracking-widest text-[#1A1A1A]/40">Visibility</span>
                              <select
                                value={youtubeUploadForm.privacyStatus}
                                onChange={(e) => setYoutubeUploadForm((prev) => ({ ...prev, privacyStatus: e.target.value }))}
                                className="h-10 w-full rounded-lg border border-[#1A1A1A]/10 bg-white px-3 text-xs font-bold outline-none"
                              >
                                <option value="private">Private</option>
                                <option value="unlisted">Unlisted</option>
                                <option value="public">Public</option>
                              </select>
                            </label>

                            <label className="flex h-10 items-center gap-2 self-end rounded-lg border border-[#1A1A1A]/10 bg-white px-3 text-xs font-bold text-[#1A1A1A]/60 hover:bg-white/60 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={youtubeUploadForm.madeForKids}
                                onChange={(e) => setYoutubeUploadForm((prev) => ({ ...prev, madeForKids: e.target.checked }))}
                                className="h-3.5 w-3.5 accent-[#FF0000]"
                              />
                              Made for kids
                            </label>
                          </div>

                          <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                            <label className="block space-y-1.5 min-w-0">
                              <span className="text-[10px] font-black uppercase tracking-widest text-[#1A1A1A]/40">Add to Playlist</span>
                              <select
                                value={youtubeUploadForm.playlistId}
                                onChange={(e) => setYoutubeUploadForm((prev) => ({ ...prev, playlistId: e.target.value }))}
                                className="h-10 w-full truncate rounded-lg border border-[#1A1A1A]/10 bg-white px-3 text-xs font-bold outline-none"
                              >
                                <option value="">No playlist</option>
                                {youtubePlaylists.map((pl) => (
                                  <option key={pl.id} value={pl.id}>{pl.title} ({pl.videoCount || 0})</option>
                                ))}
                              </select>
                            </label>
                            <button
                              type="button"
                              onClick={async () => {
                                if (!auth?.activeAccount?.id) return;
                                setLoadingYoutubePlaylists(true);
                                try {
                                  const response = await fetch(`/api/youtube/playlists?accountId=${encodeURIComponent(auth.activeAccount.id)}`);
                                  const data = await response.json();
                                  setYoutubePlaylists(data.playlists || []);
                                } catch (err) {
                                  console.error(err);
                                } finally {
                                  setLoadingYoutubePlaylists(false);
                                }
                              }}
                              className="mt-[19px] inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border border-[#1A1A1A]/10 bg-white px-3 text-xs font-bold text-[#1A1A1A]/60 hover:text-[#1A1A1A]"
                            >
                              {loadingYoutubePlaylists ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                              Refresh
                            </button>
                          </div>

                          <label className="block space-y-1.5">
                            <span className="text-[10px] font-black uppercase tracking-widest text-[#1A1A1A]/40">Or Create Playlist</span>
                            <input
                              value={youtubeUploadForm.newPlaylistTitle}
                              onChange={(e) => setYoutubeUploadForm((prev) => ({ ...prev, newPlaylistTitle: e.target.value }))}
                              className="h-10 w-full rounded-lg border border-[#1A1A1A]/10 bg-white px-3 text-xs font-semibold outline-none"
                              placeholder="New playlist title"
                            />
                          </label>
                        </div>

                        {youtubeUploadError && (
                          <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-bold text-red-950">
                            {youtubeUploadError}
                          </div>
                        )}

                        <button
                          type="button"
                          disabled={!auth?.activeAccount || !youtubeUploadForm.title.trim() || isUploadingToYoutube}
                          onClick={async () => {
                            if (!auth?.activeAccount?.id || !youtubeUploadForm.title.trim()) return;
                            setIsUploadingToYoutube(true);
                            setYoutubeUploadError("");
                            setYoutubeUploadResult(null);

                            setUploadProgressMessage("Downloading TikTok clip locally...");
                            try {
                              const file = await tiktokVideoToFile(activeMovieIdModalVideo);

                              setUploadProgressMessage("Uploading video directly to YouTube...");

                              const params = new URLSearchParams({
                                accountId: auth.activeAccount.id,
                                title: youtubeUploadForm.title.trim(),
                                description: youtubeUploadForm.description,
                                tags: youtubeUploadForm.tags,
                                privacyStatus: youtubeUploadForm.privacyStatus,
                                postAsShort: String(youtubeUploadForm.postAsShort),
                                madeForKids: String(youtubeUploadForm.madeForKids),
                                postSlug: slug,
                                playlistKey: postAnalysisPlaylistKey,
                                sourceUrl: activeMovieIdModalVideo.playUrl || (activeMovieIdModalVideo as any).url || "",
                                sourceVideoId: String(activeMovieIdModalVideo.id || ""),
                                sourceAuthor: activeMovieIdModalVideo.authorHandle || activeMovieIdModalVideo.author || "",
                                sourceTitle: activeMovieIdModalVideo.title || "",
                              });
                              if (youtubeUploadForm.playlistId) {
                                params.set("playlistId", youtubeUploadForm.playlistId);
                              }
                              if (youtubeUploadForm.newPlaylistTitle.trim()) {
                                params.set("createPlaylistTitle", youtubeUploadForm.newPlaylistTitle.trim());
                              }

                              const response = await fetch(`/api/youtube/videos/upload?${params.toString()}`, {
                                method: "POST",
                                headers: { "Content-Type": file.type || "application/octet-stream" },
                                body: file,
                              });
                              const data = await response.json();
                              if (!response.ok) {
                                throw new Error(data.error || "Direct YouTube upload request failed.");
                              }

                              setYoutubeUploadResult(data.video);
                            } catch (err) {
                              setYoutubeUploadError(err instanceof Error ? err.message : "YouTube upload failed");
                            } finally {
                              setIsUploadingToYoutube(false);
                              setUploadProgressMessage("");
                            }
                          }}
                          className="w-full inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[#FF0000] text-sm font-black text-white hover:bg-[#CC0000] disabled:cursor-not-allowed disabled:opacity-45 shadow-md"
                        >
                          <Youtube className="h-4.5 w-4.5" />
                          Publish to YouTube
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </motion.div>
            </motion.div>
          );
        })()}
      </AnimatePresence>
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
