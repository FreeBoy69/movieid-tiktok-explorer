import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, ArrowLeft, CheckCircle2, Clock3, Film, Heart, Layers3, Loader2, MessageCircle, Play, RefreshCw, Scissors, Search, Share2, Sparkles, User, Youtube, Zap } from "lucide-react";
import { AuthSessionPayload, ConnectedYouTubeAccount, MovieResult, YouTubePlaylistSummary } from "../types";
import { TikTokPlaylist, TikTokVideo, fetchTikTokPlaylist } from "../services/tiktok";
import { cn } from "../lib/utils";
import { channelListingUrl } from "../utils/tiktokListUrl";
import { identifyMovie, identifyMovieFromLink } from "../services/gemini";
import { MovieAnalysisTabs } from "./MovieAnalysisTabs";

type SortMode = "views" | "oldest" | "newest" | "length";
type PlaylistMode = "none" | "existing" | "create";
type SourceMode = "url" | "search";
type CompilePanelTab = "settings" | "upload";
type CompilationJob = {
  id: string;
  status: "queued" | "running" | "done" | "error";
  message?: string;
  result?: any;
  error?: string;
};

interface ProcessedTikTokVideo {
  mimeType: string;
  videoUrl?: string;
  base64?: string;
}

interface SavedPostAnalysis {
  result: MovieResult;
  analyzedAt: number;
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

export function CompilationStudio({ auth }: { auth: AuthSessionPayload }) {
  const [url, setUrl] = useState("");
  const [sourceMode, setSourceMode] = useState<SourceMode>("url");
  const [count, setCount] = useState(100);
  const [playlist, setPlaylist] = useState<TikTokPlaylist | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [previewVideo, setPreviewVideo] = useState<TikTokVideo | null>(null);
  const [postAnalyses, setPostAnalyses] = useState<Record<string, SavedPostAnalysis>>({});
  const [analyzingVideoId, setAnalyzingVideoId] = useState("");
  const [analysisError, setAnalysisError] = useState("");
  const [previewError, setPreviewError] = useState("");
  const [sort, setSort] = useState<SortMode>("views");
  const [loading, setLoading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [downloadUrl, setDownloadUrl] = useState("");
  const [jobMessage, setJobMessage] = useState("");
  const [accountId, setAccountId] = useState(auth.activeAccount?.id || auth.accounts[0]?.id || "");
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

  const account = useMemo<ConnectedYouTubeAccount | null>(() => auth.accounts.find((item) => item.id === accountId) || auth.activeAccount || auth.accounts[0] || null, [accountId, auth.accounts, auth.activeAccount]);
  const sortedVideos = useMemo(() => sortVideos(playlist?.videos || [], sort), [playlist?.videos, sort]);
  const selectedVideos = useMemo(() => sortedVideos.filter((video) => selectedIds.has(video.id)), [selectedIds, sortedVideos]);
  const totalSeconds = useMemo(() => selectedVideos.reduce((sum, video) => sum + durationSeconds(video), 0), [selectedVideos]);
  const minTargetMinutes = typeof minMinutes === "number" && Number.isFinite(minMinutes) ? minMinutes : 0;
  const maxTargetMinutes = typeof maxMinutes === "number" && Number.isFinite(maxMinutes) ? maxMinutes : 0;
  const targetSeconds = maxTargetMinutes > 0 ? maxTargetMinutes * 60 : Number.POSITIVE_INFINITY;
  const targetLabel = minTargetMinutes || maxTargetMinutes ? `${minTargetMinutes || ""}${minTargetMinutes && maxTargetMinutes ? "-" : ""}${maxTargetMinutes || ""}m` : "";

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

  async function loadSource(event: FormEvent) {
    event.preventDefault();
    const source = sourceMode === "search" ? searchTermToTikTokUrl(url) : url.trim();
    if (!source) return;
    setLoading(true);
    setError("");
    setNotice("");
    try {
      const data = await fetchTikTokPlaylist(source, count, undefined, { forceNetwork: true });
      setPlaylist(data);
      setSelectedIds(new Set());
      setPreviewVideo(null);
      setPreviewError("");
      setAnalysisError("");
      if (!title.trim()) setTitle(`${data.title || data.author || "AutoYT"} compilation`.slice(0, 100));
      if (!description.trim()) setDescription(`A curated compilation from ${data.title || data.author || "selected clips"}.`);
      setNotice(`Loaded ${data.videos.length} clips.`);
      void loadPlaylists(accountId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load clips");
    } finally {
      setLoading(false);
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
      const seedVideoUrl = video.playUrl || (video.authorHandle && video.id ? `https://www.tiktok.com/@${video.authorHandle.replace(/^@/, "")}/video/${video.id}` : "");
      const data = await fetchTikTokPlaylist(profileUrl, count, seedVideoUrl, { forceNetwork: true });
      setPlaylist(data);
      setUrl(profileUrl);
      setSourceMode("url");
      setSelectedIds(new Set());
      setPreviewVideo(null);
      setPreviewError("");
      setAnalysisError("");
      if (!title.trim()) setTitle(`${data.author || data.title || "Creator"} compilation`.slice(0, 100));
      if (!description.trim()) setDescription(`A curated compilation from ${data.author || data.title || "this creator"}.`);
      setNotice(`Loaded ${data.videos.length} clips from ${data.author || video.author || "creator"}.`);
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
    setNotice(uploadedUrl ? `${uploadedTitle} uploaded: ${uploadedUrl}` : `${uploadedTitle} uploaded.`);
  }

  async function pollCompilationJob(jobId: string) {
    for (let attempt = 0; attempt < 720; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, attempt < 6 ? 3000 : 5000));
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
    throw new Error("Compilation is still running. Refresh the page and try again in a few minutes.");
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
        }}
        onToggle={() => toggleClip(previewVideo)}
        onAnalyze={() => void analyzePreviewVideo(previewVideo)}
        onOpenChannel={() => void loadChannelVideos(previewVideo)}
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[#F9F8F6] text-[#1A1A1A]">
      {/* ── Top bar ── */}
      <header className="sticky top-0 z-20 flex min-h-12 shrink-0 flex-wrap items-stretch gap-2 border-b border-[#1A1A1A]/8 bg-white px-3 py-2 sm:items-center sm:px-4">
        {/* URL/Search toggle */}
        <div className="inline-flex shrink-0 rounded-lg border border-[#1A1A1A]/8 bg-[#F9F8F6] p-0.5">
          <button type="button" onClick={() => setSourceMode("url")} className={cn("h-8 rounded-md px-3 text-xs font-black transition", sourceMode === "url" ? "bg-white text-[#1A1A1A] shadow-sm" : "text-[#1A1A1A]/45 hover:text-[#1A1A1A]")}>URL</button>
          <button type="button" onClick={() => setSourceMode("search")} className={cn("h-8 rounded-md px-3 text-xs font-black transition", sourceMode === "search" ? "bg-white text-[#1A1A1A] shadow-sm" : "text-[#1A1A1A]/45 hover:text-[#1A1A1A]")}>Search</button>
        </div>

        {/* URL input — takes remaining space */}
        <form onSubmit={loadSource} className="flex min-w-0 flex-1 flex-wrap items-center gap-2 sm:flex-nowrap">
          <label className="relative min-w-[min(100%,14rem)] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#1A1A1A]/35" />
            <input
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder={sourceMode === "search" ? "Type a TikTok search term, e.g. anime recap" : "Paste TikTok playlist, channel, search, or collection URL"}
              className="h-9 w-full rounded-lg border border-[#1A1A1A]/10 bg-[#F9F8F6] pl-9 pr-4 text-sm font-semibold outline-none transition focus:border-[#f9dc0b]/40"
            />
          </label>
          <input
            type="number" min={1} max={5000} value={count}
            onChange={(event) => setCount(Number(event.target.value))}
            className="h-9 w-20 shrink-0 rounded-lg border border-[#1A1A1A]/10 bg-[#F9F8F6] px-3 text-sm font-bold outline-none"
            aria-label="Clip count"
          />
          <button type="submit" disabled={loading || !url.trim()} className="inline-flex h-9 shrink-0 items-center gap-2 rounded-lg bg-[#f9dc0b] px-4 text-xs font-black text-[#1A1A1A] shadow-sm transition hover:bg-[#1A1A1A] hover:text-white disabled:opacity-50">
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            {sourceMode === "search" ? "Search" : "Load clips"}
          </button>
        </form>

        {/* Stats pills */}
        <div className="ml-auto grid w-full grid-cols-3 gap-2 sm:flex sm:w-auto sm:shrink-0 sm:items-center">
          <MiniStat label="Selected" value={String(selectedVideos.length)} />
          <MiniStat label="Length" value={formatDuration(totalSeconds)} />
          <MiniStat label="Target" value={targetLabel} />
        </div>
      </header>

      {/* Status bar */}
      {(error || notice || (jobMessage && processing) || downloadUrl) ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-[#1A1A1A]/8 bg-white px-4 py-2 text-xs font-bold">
          {error ? <span className="rounded-lg bg-[#fff9d6] px-3 py-1.5 text-[#6a5b00]">Request error: {error}</span> : null}
          {notice ? <span className="rounded-lg bg-[#fff9d6] px-3 py-1.5 text-[#6a5b00]">{notice}</span> : null}
          {jobMessage && processing ? <span className="inline-flex items-center gap-2 rounded-lg bg-[#f9dc0b]/15 px-3 py-1.5 text-[#1A1A1A]/75"><Loader2 className="h-3.5 w-3.5 animate-spin" />{jobMessage}</span> : null}
          {downloadUrl ? <a href={downloadUrl} className="rounded-lg bg-[#1A1A1A] px-3 py-1.5 text-white">Download compilation</a> : null}
        </div>
      ) : null}

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px]">
        <main className="min-h-0 overflow-y-auto px-3 py-3 sm:px-4 sm:py-4 md:px-5">
          {playlist ? (
            <>
              {/* Source header + controls */}
              <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="min-w-0">
                  <p className="text-[11px] font-bold uppercase tracking-widest text-[#f9dc0b]">{playlist.author || "Source"}</p>
                  <h2 className="truncate text-lg font-black text-[#1A1A1A]">{playlist.title || "Selected source"}</h2>
                </div>
                <div className="flex flex-wrap gap-2">
                  <select value={sort} onChange={(event) => setSort(event.target.value as SortMode)} className="h-10 rounded-lg border border-[#1A1A1A]/10 bg-white px-3 text-xs font-bold outline-none">
                    <option value="views">Views high to low</option>
                    <option value="newest">Newest first</option>
                    <option value="oldest">Oldest first</option>
                    <option value="length">Longest first</option>
                  </select>
                  <button type="button" onClick={selectUntilTarget} className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#f9dc0b] px-4 text-xs font-bold text-[#1A1A1A] transition hover:bg-[#1A1A1A] hover:text-white">
                    <Sparkles className="h-4 w-4" />
                    Auto-select
                  </button>
                  <button type="button" onClick={() => setSelectedIds(new Set())} className="inline-flex h-10 items-center rounded-lg border border-[#1A1A1A]/10 bg-white px-4 text-xs font-bold text-[#1A1A1A]/60 transition hover:text-[#1A1A1A]">
                    Clear
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
                {sortedVideos.map((video) => {
                  const selected = selectedIds.has(video.id);
                  return (
                    <article key={video.id} role="button" tabIndex={0} onClick={() => setPreviewVideo(video)} onKeyDown={(event) => event.key === "Enter" && setPreviewVideo(video)} className="group min-w-0 cursor-pointer">
                      <div className={cn("relative aspect-[9/16] overflow-hidden rounded-2xl bg-[#1A1A1A]/5 shadow-sm transition duration-200", selected ? "ring-2 ring-[#f9dc0b]" : "ring-1 ring-[#1A1A1A]/8 hover:ring-[#1A1A1A]/20")}>
                        {video.dynamicCover ? <img src={video.dynamicCover} alt="" className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.02]" referrerPolicy="no-referrer" /> : <div className="grid h-full w-full place-items-center text-[#f9dc0b]"><Film className="h-8 w-8" /></div>}
                        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/15 to-black/10" />
                        <label className="absolute left-2 top-2 grid h-8 w-8 place-items-center rounded-lg bg-black/55 text-white backdrop-blur-sm" onClick={(event) => event.stopPropagation()} title="Add to compilation">
                          <input type="checkbox" checked={selected} onChange={() => toggleClip(video)} className="h-4 w-4 accent-[#f9dc0b]" aria-label="Add clip to compilation" />
                        </label>
                        <span className="absolute right-2 top-2 rounded-lg bg-black/70 px-2 py-1 text-[11px] font-black text-white">{formatDuration(durationSeconds(video))}</span>
                        <div className="absolute inset-x-0 bottom-0 p-3 text-white">
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              void loadChannelVideos(video);
                            }}
                            className="mb-1 max-w-full truncate text-left text-[11px] font-black text-[#f9dc0b] underline-offset-2 hover:underline"
                            title="Load this creator's videos"
                          >
                            {video.authorHandle || video.author || "Open creator"}
                          </button>
                          <h3 className="line-clamp-2 text-sm font-black leading-tight">{video.title || "Untitled clip"}</h3>
                          <p className="mt-1 text-[11px] font-bold text-white/75">{compact(videoViews(video))} views - {compact(video.stats?.commentCount)} comments</p>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
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

        <aside className="min-h-0 overflow-y-auto border-t border-[#1A1A1A]/8 bg-white px-4 py-4 lg:border-l lg:border-t-0">
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
    <section className="flex h-full min-h-0 flex-col overflow-hidden border border-[#1A1A1A]/8 bg-white text-[#1A1A1A] shadow-sm">
      <header className="flex min-h-12 flex-col gap-3 border-b border-[#1A1A1A]/8 bg-white px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <button type="button" onClick={onBack} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-[#1A1A1A]/55 transition hover:bg-[#F3F4F6] hover:text-[#1A1A1A]" aria-label="Back to clips">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <Scissors className="h-4 w-4 text-[#1A1A1A]/45" />
          <h1 className="truncate text-sm font-bold">{video.title || "Compilation clip"}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-[#1A1A1A]/10 bg-white px-3 text-xs font-black text-[#1A1A1A]/65">
            <input type="checkbox" checked={selected} onChange={() => onToggle()} className="h-4 w-4 accent-[#f9dc0b]" />
            Add to compilation
          </label>
          <button type="button" onClick={onAnalyze} disabled={analyzing} className="inline-flex min-h-9 items-center gap-2 rounded-lg bg-[#f9dc0b] px-4 text-xs font-black text-[#1A1A1A] transition hover:bg-[#1A1A1A] hover:text-white disabled:opacity-60">
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
