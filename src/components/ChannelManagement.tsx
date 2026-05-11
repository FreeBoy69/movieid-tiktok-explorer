import { AlertCircle, ArrowLeft, BarChart3, CheckCircle2, ExternalLink, FileVideo, Film, Loader2, MessageCircle, PlaySquare, RefreshCw, Send, Sparkles, UploadCloud, Wand2, X, Youtube } from "lucide-react";
import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AuthSessionPayload, ConnectedYouTubeAccount, MovieResult, YouTubeChannelDashboard, YouTubeCommentsResponse, YouTubeDashboardVideo, YouTubePlaylistSummary, YouTubeUploadResult, YouTubeVideoAnalytics } from "../types";
import { cn } from "../lib/utils";

function compactNumber(value: number): string {
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value || 0);
}

function dateAge(value: string): string {
  if (!value) return "unknown";
  const hours = Math.max(1, Math.round((Date.now() - new Date(value).getTime()) / 36e5));
  if (hours < 48) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 60) return `${days}d ago`;
  return `${Math.round(days / 30)}mo ago`;
}

function sharpYouTubeThumbnail(url: string): string {
  if (!url) return "";
  return url
    .replace(/\/default\.jpg(\?|$)/, "/hqdefault.jpg$1")
    .replace(/\/mqdefault\.jpg(\?|$)/, "/hqdefault.jpg$1");
}

const COMMENT_SCOPE = "https://www.googleapis.com/auth/youtube.force-ssl";
const UPLOAD_SCOPE = "https://www.googleapis.com/auth/youtube.upload";
const ANALYTICS_SCOPE = "https://www.googleapis.com/auth/yt-analytics.readonly";

function hasScope(account: ConnectedYouTubeAccount | null | undefined, scope: string): boolean {
  return String(account?.scope || "").split(/\s+/).includes(scope);
}

function plainNumber(value: number | string | null | undefined): string {
  const n = Number(value || 0);
  return new Intl.NumberFormat("en").format(Number.isFinite(n) ? n : 0);
}

function formatDate(value: string): string {
  if (!value) return "Not published";
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

function formatDuration(seconds: number): string {
  const n = Math.max(0, Math.round(seconds || 0));
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  const s = n % 60;
  if (h) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function statusLabel(value?: string): string {
  if (!value) return "Unknown";
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}

function videoIdFromUrl(value: string): string {
  const raw = value.trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (url.hostname.includes("youtu.be")) return url.pathname.split("/").filter(Boolean)[0] || "";
    return url.searchParams.get("v") || url.pathname.split("/").filter(Boolean).pop() || raw;
  } catch {
    return raw;
  }
}

export function ChannelManagement({
  auth,
  initialTab = "optimize",
  theme = "light",
}: {
  auth: AuthSessionPayload;
  onAuthRefresh: () => Promise<void>;
  onOpenVideo?: (videoId: string) => void;
  initialTab?: "feed" | "optimize";
  theme?: "light" | "dark";
}) {
  const [dashboard, setDashboard] = useState<YouTubeChannelDashboard | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [agentRunning, setAgentRunning] = useState(false);
  const [agentError, setAgentError] = useState("");
  const [agentResult, setAgentResult] = useState<any>(null);
  const [dryRun, setDryRun] = useState(true);
  const [identifyMovies, setIdentifyMovies] = useState(true);
  const [maxVideos, setMaxVideos] = useState(12);
  const [maxReplies, setMaxReplies] = useState(8);
  const [sort, setSort] = useState("comments");
  const [tone, setTone] = useState("warm-insightful");
  const [instructions, setInstructions] = useState("Reply like the channel owner: brief, natural, useful, and insightful. Do not ask questions.");
  const [workspaceTab, setWorkspaceTab] = useState<"videos" | "shorts" | "comments">("shorts");
  const [selectedVideo, setSelectedVideo] = useState<YouTubeDashboardVideo | null>(null);
  const [detailTab, setDetailTab] = useState("Overview");
  const [nextPageToken, setNextPageToken] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const [privacyStatus, setPrivacyStatus] = useState("private");
  const [madeForKids, setMadeForKids] = useState(false);
  const [playlists, setPlaylists] = useState<YouTubePlaylistSummary[]>([]);
  const [loadingPlaylists, setLoadingPlaylists] = useState(false);
  const [playlistId, setPlaylistId] = useState("");
  const [newPlaylistTitle, setNewPlaylistTitle] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [uploadResult, setUploadResult] = useState<YouTubeUploadResult | null>(null);
  const [analytics, setAnalytics] = useState<YouTubeVideoAnalytics | null>(null);
  const [analyticsError, setAnalyticsError] = useState("");
  const [loadingAnalytics, setLoadingAnalytics] = useState(false);
  const [comments, setComments] = useState<YouTubeCommentsResponse | null>(null);
  const [commentsError, setCommentsError] = useState("");
  const [loadingComments, setLoadingComments] = useState(false);
  const [replyText, setReplyText] = useState<Record<string, string>>({});
  const [replyingTo, setReplyingTo] = useState("");
  const [movieCheck, setMovieCheck] = useState<MovieResult | null>(null);
  const [movieCheckError, setMovieCheckError] = useState("");
  const [checkingMovie, setCheckingMovie] = useState(false);
  const active = auth.activeAccount;
  const canReply = hasScope(active, COMMENT_SCOPE);
  const canUpload = hasScope(active, UPLOAD_SCOPE);
  const canReadAnalytics = hasScope(active, ANALYTICS_SCOPE);
  const isFeed = initialTab === "feed";
  const isDark = theme === "dark";
  const recentVideos = useMemo(() => dashboard?.recentVideos || [], [dashboard?.recentVideos]);
  const longVideos = useMemo(() => recentVideos.filter((video) => (video.durationSeconds || 0) > 180), [recentVideos]);
  const shorts = useMemo(() => recentVideos.filter((video) => (video.durationSeconds || 0) <= 180), [recentVideos]);
  const visibleVideos = workspaceTab === "videos" ? longVideos : shorts;
  const selectedIsShort = (selectedVideo?.durationSeconds || 0) <= 180;
  const selectedDetailTabs = useMemo(() => ["Overview", "Title", ...(selectedIsShort ? [] : ["Thumbnail"]), "SEO", "Review", "Preview", "Performance", "Comments"], [selectedIsShort]);
  const selectedFileLabel = useMemo(() => {
    if (!file) return "Choose a video file";
    const mb = file.size / 1024 / 1024;
    return `${file.name} (${mb.toFixed(mb >= 10 ? 0 : 1)} MB)`;
  }, [file]);

  const loadDashboard = useCallback(async () => {
    if (!active?.id) {
      setDashboard(null);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/youtube/channel/dashboard?accountId=${encodeURIComponent(active.id)}`);
      const data = await response.json();
      if (!response.ok) throw new Error((data as { error?: string }).error || "Could not load YouTube analytics");
      setDashboard(data as YouTubeChannelDashboard);
      setNextPageToken((data as YouTubeChannelDashboard).nextPageToken || "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load YouTube analytics");
    } finally {
      setLoading(false);
    }
  }, [active?.id]);

  const loadMoreVideos = useCallback(async () => {
    if (!active?.id || !nextPageToken || loadingMore) return;
    setLoadingMore(true);
    try {
      const response = await fetch(`/api/youtube/channel/dashboard?accountId=${encodeURIComponent(active.id)}&pageToken=${encodeURIComponent(nextPageToken)}`);
      const data = (await response.json()) as YouTubeChannelDashboard & { error?: string };
      if (!response.ok) throw new Error(data.error || "Could not load more videos");
      setDashboard((current) => {
        if (!current) return data;
        const byId = new Map(current.recentVideos.map((video) => [video.id, video]));
        data.recentVideos.forEach((video) => byId.set(video.id, video));
        return {
          ...current,
          stats: {
            ...current.stats,
            recentVideoCount: byId.size,
          },
          recentVideos: Array.from(byId.values()),
          nextPageToken: data.nextPageToken || "",
        };
      });
      setNextPageToken(data.nextPageToken || "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load more videos");
    } finally {
      setLoadingMore(false);
    }
  }, [active?.id, loadingMore, nextPageToken]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  useEffect(() => {
    const node = loadMoreRef.current;
    if (!node || !nextPageToken || workspaceTab === "comments" || selectedVideo) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void loadMoreVideos();
    }, { rootMargin: "800px 0px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [loadMoreVideos, nextPageToken, selectedVideo, workspaceTab]);

  const loadPlaylists = useCallback(async () => {
    if (!active?.id) {
      setPlaylists([]);
      return;
    }
    setLoadingPlaylists(true);
    try {
      const response = await fetch(`/api/youtube/playlists?accountId=${encodeURIComponent(active.id)}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not load playlists");
      setPlaylists(Array.isArray(data.playlists) ? data.playlists : []);
    } catch {
      setPlaylists([]);
    } finally {
      setLoadingPlaylists(false);
    }
  }, [active?.id]);

  useEffect(() => {
    void loadPlaylists();
  }, [loadPlaylists]);

  async function loadComments(idOrUrl: string, silent = false) {
    const id = videoIdFromUrl(idOrUrl);
    if (!id || !active?.id) return;
    if (!silent) setLoadingComments(true);
    setCommentsError("");
    try {
      const response = await fetch(`/api/youtube/videos/${encodeURIComponent(id)}/comments?accountId=${encodeURIComponent(active.id)}&maxResults=20`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load recent comments");
      setComments(data as YouTubeCommentsResponse);
    } catch (err) {
      setComments(null);
      setCommentsError(err instanceof Error ? err.message : "Could not load recent comments");
    } finally {
      if (!silent) setLoadingComments(false);
    }
  }

  async function loadAnalytics(idOrUrl: string) {
    const id = videoIdFromUrl(idOrUrl);
    if (!id || !active?.id) return;
    setLoadingAnalytics(true);
    setAnalyticsError("");
    setMovieCheck(null);
    setMovieCheckError("");
    setComments(null);
    setCommentsError("");
    try {
      const response = await fetch(`/api/youtube/videos/${encodeURIComponent(id)}/analytics?accountId=${encodeURIComponent(active.id)}&days=28`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load post analytics");
      setAnalytics(data as YouTubeVideoAnalytics);
      await loadComments(id);
    } catch (err) {
      setAnalytics(null);
      setAnalyticsError(err instanceof Error ? err.message : "Could not load post analytics");
    } finally {
      setLoadingAnalytics(false);
    }
  }

  function openVideoPage(video: YouTubeDashboardVideo) {
    setSelectedVideo(video);
    setDetailTab("Overview");
    void loadAnalytics(video.id);
  }

  useEffect(() => {
    if (!selectedVideo?.id || !active?.id || !canReply) return;
    const timer = window.setInterval(() => {
      void loadComments(selectedVideo.id, true);
    }, 15000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedVideo?.id, active?.id, canReply]);

  async function replyToComment(parentId: string) {
    if (!active?.id) return;
    const text = (replyText[parentId] || "").trim();
    if (!text) return;
    setReplyingTo(parentId);
    setCommentsError("");
    try {
      const response = await fetch(`/api/youtube/comments/${encodeURIComponent(parentId)}/reply?accountId=${encodeURIComponent(active.id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not reply to comment");
      setReplyText((prev) => ({ ...prev, [parentId]: "" }));
      await loadComments(comments?.videoId || selectedVideo?.id || "");
      window.setTimeout(() => void loadComments(comments?.videoId || selectedVideo?.id || "", true), 3000);
      window.setTimeout(() => void loadComments(comments?.videoId || selectedVideo?.id || "", true), 10000);
    } catch (err) {
      setCommentsError(err instanceof Error ? err.message : "Could not reply to comment");
    } finally {
      setReplyingTo("");
    }
  }

  async function checkUploadedMovie() {
    if (!analytics?.url) return;
    setCheckingMovie(true);
    setMovieCheckError("");
    try {
      const response = await fetch("/api/movie/identify-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: analytics.url }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.details || data.error || "Could not identify movie");
      setMovieCheck(data.result as MovieResult);
    } catch (err) {
      setMovieCheck(null);
      setMovieCheckError(err instanceof Error ? err.message : "Could not identify movie");
    } finally {
      setCheckingMovie(false);
    }
  }

  async function uploadVideo(event: FormEvent) {
    event.preventDefault();
    if (!file || !active?.id || !title.trim()) return;
    setUploading(true);
    setUploadError("");
    setUploadResult(null);
    try {
      const params = new URLSearchParams({
        accountId: active.id,
        title: title.trim(),
        description,
        tags,
        privacyStatus,
        madeForKids: String(madeForKids),
      });
      if (playlistId) params.set("playlistId", playlistId);
      if (newPlaylistTitle.trim()) params.set("createPlaylistTitle", newPlaylistTitle.trim());
      const response = await fetch(`/api/youtube/videos/upload?${params.toString()}`, {
        method: "POST",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not upload video");
      const result = data.video as YouTubeUploadResult;
      setUploadResult(result);
      setUploadModalOpen(false);
      await loadDashboard();
      const uploadedVideo: YouTubeDashboardVideo = {
        id: result.id,
        url: result.url,
        title: result.title,
        thumbnailUrl: "",
        publishedAt: new Date().toISOString(),
        privacyStatus: result.privacyStatus,
        uploadStatus: "uploaded",
        viewCount: 0,
        likeCount: 0,
        commentCount: 0,
        durationSeconds: 0,
      };
      openVideoPage(uploadedVideo);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Could not upload video");
    } finally {
      setUploading(false);
    }
  }

  async function runReplyAgent() {
    if (!active?.id) return;
    setAgentRunning(true);
    setAgentError("");
    setAgentResult(null);
    try {
      const response = await fetch(`/api/youtube/channel/comment-agent/run?accountId=${encodeURIComponent(active.id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dryRun,
          maxVideos,
          maxCommentsPerVideo: 10,
          maxReplies,
          sort,
          tone,
          instructions,
          identifyMovies,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Comment reply agent failed");
      setAgentResult(data);
      if (!dryRun) void loadDashboard();
    } catch (err) {
      setAgentError(err instanceof Error ? err.message : "Comment reply agent failed");
    } finally {
      setAgentRunning(false);
    }
  }

  if (isFeed) {
    return (
      <div className={cn("min-w-0 space-y-6 overflow-x-clip", isDark && "-m-4 bg-[#070A12] p-4 text-white sm:-m-5 sm:p-5 md:-m-8 md:p-8 lg:-m-10 lg:p-10 xl:-m-14 xl:p-14")}>
        {loading ? <InlineStatus message="Loading feed" /> : null}
        {error ? <InlineError message={error} /> : null}
        {dashboard ? (
          <FeedDashboard dashboard={dashboard} onOpenVideo={openVideoPage} isDark={isDark} />
        ) : !loading && !error ? (
          <ConnectChannelCard />
        ) : null}
        {uploadModalOpen ? (
          <UploadModal
            canUpload={canUpload}
            selectedFileLabel={selectedFileLabel}
            file={file}
            title={title}
            description={description}
            tags={tags}
            privacyStatus={privacyStatus}
            madeForKids={madeForKids}
            playlists={playlists}
            playlistId={playlistId}
            newPlaylistTitle={newPlaylistTitle}
            loadingPlaylists={loadingPlaylists}
            uploading={uploading}
            uploadError={uploadError}
            uploadResult={uploadResult}
            onClose={() => setUploadModalOpen(false)}
            onFileChange={setFile}
            onTitleChange={setTitle}
            onDescriptionChange={setDescription}
            onTagsChange={setTags}
            onPrivacyStatusChange={setPrivacyStatus}
            onMadeForKidsChange={setMadeForKids}
            onPlaylistIdChange={setPlaylistId}
            onNewPlaylistTitleChange={setNewPlaylistTitle}
            onRefreshPlaylists={() => void loadPlaylists()}
            onSubmit={uploadVideo}
          />
        ) : null}
      </div>
    );
  }

  return (
    <div className={cn("min-w-0 space-y-5 overflow-x-clip", isDark && "-m-4 bg-[#070A12] p-4 text-white sm:-m-5 sm:p-5 md:-m-8 md:p-8 lg:-m-10 lg:p-10 xl:-m-14 xl:p-14")}>
      {loading ? <InlineStatus message="Loading channel analytics" /> : null}
      {error ? <InlineError message={error} /> : null}

      {dashboard && selectedVideo ? (
        <PostDetailPage
          video={selectedVideo}
          tabs={selectedDetailTabs}
          activeTab={detailTab}
          onTabChange={setDetailTab}
          onBack={() => {
            setSelectedVideo(null);
            setAnalytics(null);
            setComments(null);
          }}
          onRefresh={() => void loadAnalytics(selectedVideo.id)}
          onUpload={() => setUploadModalOpen(true)}
          loadingAnalytics={loadingAnalytics}
          analytics={analytics}
          analyticsError={analyticsError}
          canReadAnalytics={canReadAnalytics}
          canReply={canReply}
          comments={comments}
          commentsError={commentsError}
          loadingComments={loadingComments}
          replyText={replyText}
          replyingTo={replyingTo}
          onReplyTextChange={(id, value) => setReplyText((prev) => ({ ...prev, [id]: value }))}
          onReply={(id) => void replyToComment(id)}
          onRefreshComments={() => void loadComments(comments?.videoId || selectedVideo.id)}
          movieCheck={movieCheck}
          movieCheckError={movieCheckError}
          checkingMovie={checkingMovie}
          onCheckMovie={() => void checkUploadedMovie()}
          isDark={isDark}
        />
      ) : dashboard ? (
        <section className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex max-w-full gap-6 overflow-x-auto overscroll-x-contain [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <button type="button" onClick={() => setWorkspaceTab("videos")} className={cn("border-b-2 pb-2 text-sm font-black", workspaceTab === "videos" ? "border-[#2E7BFF]" : "border-transparent", workspaceTab === "videos" ? isDark ? "text-white" : "text-[#1A1A1A]" : isDark ? "text-white/40" : "text-[#1A1A1A]/40")}>Videos</button>
              <button type="button" onClick={() => setWorkspaceTab("shorts")} className={cn("border-b-2 pb-2 text-sm font-black", workspaceTab === "shorts" ? "border-[#2E7BFF]" : "border-transparent", workspaceTab === "shorts" ? isDark ? "text-white" : "text-[#1A1A1A]" : isDark ? "text-white/40" : "text-[#1A1A1A]/40")}>Shorts</button>
              <button type="button" onClick={() => setWorkspaceTab("comments")} className={cn("border-b-2 pb-2 text-sm font-black", workspaceTab === "comments" ? "border-[#2E7BFF]" : "border-transparent", workspaceTab === "comments" ? isDark ? "text-white" : "text-[#1A1A1A]" : isDark ? "text-white/40" : "text-[#1A1A1A]/40")}>Comment Agent</button>
            </div>
            <div className="flex items-center gap-2">
              <p className={cn("text-xs font-bold", isDark ? "text-white/45" : "text-[#1A1A1A]/45")}>{workspaceTab === "videos" ? `${longVideos.length} long-form videos` : workspaceTab === "shorts" ? `${shorts.length} shorts` : "Reply assistant"}</p>
              <button type="button" onClick={() => setUploadModalOpen(true)} className="inline-flex min-h-9 items-center justify-center gap-2 rounded-xl bg-[#FFDE32] px-3 py-2 text-xs font-bold text-[#1A1A1A] shadow-sm transition hover:bg-[#FF0033] hover:text-white">
                <UploadCloud className="h-4 w-4" />
                Upload
              </button>
            </div>
          </div>
          {workspaceTab !== "comments" ? (
            <div className={cn("grid grid-cols-[repeat(auto-fit,minmax(min(100%,16rem),1fr))] gap-4", workspaceTab === "shorts" ? "lg:grid-cols-4 xl:grid-cols-5" : "xl:grid-cols-3")}>
              {visibleVideos.map((video) => <OptimizeCard key={video.id} video={video} mode={workspaceTab} onClick={() => openVideoPage(video)} />)}
              {!visibleVideos.length ? <p className={cn("rounded-xl border border-dashed p-5 text-sm font-semibold", isDark ? "border-white/10 bg-white/6 text-white/45" : "border-[#1A1A1A]/10 bg-[#F9F8F6] text-[#1A1A1A]/45")}>No {workspaceTab} found for this channel yet.</p> : null}
              <div ref={loadMoreRef} className="col-span-full min-h-1" />
              {loadingMore ? <p className={cn("col-span-full rounded-xl border p-4 text-center text-sm font-bold", isDark ? "border-white/10 bg-white/6 text-white/55" : "border-[#1A1A1A]/8 bg-white text-[#1A1A1A]/55")}>Loading more videos</p> : null}
              {!nextPageToken && visibleVideos.length ? <p className={cn("col-span-full py-2 text-center text-xs font-bold", isDark ? "text-white/35" : "text-[#1A1A1A]/35")}>All channel videos loaded.</p> : null}
            </div>
          ) : null}
        </section>
      ) : !loading && !error ? (
        <ConnectChannelCard />
      ) : null}

      {!isFeed && workspaceTab === "comments" ? (
      <section className="grid gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(280px,1.05fr)]">
        <div className={cn("rounded-xl border p-4 shadow-sm md:p-5", isDark ? "border-white/10 bg-[#151923]" : "border-[#1A1A1A]/8 bg-white")}>
          <div className="flex items-start gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-[#FF0033]/10 text-[#FF0033]">
              <MessageCircle className="h-4 w-4" />
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-[#FF0033]">Comment reply agent</p>
              <h2 className={cn("mt-1 text-lg font-bold", isDark ? "text-white" : "text-[#1A1A1A]")}>Reply across older channel videos</h2>
              <p className={cn("mt-1 text-sm leading-6", isDark ? "text-white/55" : "text-[#1A1A1A]/55")}>Scan recent uploads from the selected channel, skip unsafe or already-handled comments, and draft or post short engagement replies.</p>
            </div>
          </div>

          {!canReply && active ? (
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold leading-6 text-amber-900">
              Comment permission is missing. Reconnect Google and approve YouTube comment access to use this agent.
              <a href="/api/auth/google?mode=connect&next=/channels" className="ml-2 underline">Reconnect</a>
            </div>
          ) : null}

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <Field label="Scan videos">
              <input type="number" min={1} max={50} value={maxVideos} onChange={(e) => setMaxVideos(Number(e.target.value))} className="input bg-white" />
            </Field>
            <Field label="Max replies">
              <input type="number" min={1} max={50} value={maxReplies} onChange={(e) => setMaxReplies(Number(e.target.value))} className="input bg-white" />
            </Field>
            <Field label="Priority">
              <select value={sort} onChange={(e) => setSort(e.target.value)} className="input bg-white">
                <option value="comments">Most comments</option>
                <option value="views">Most views</option>
                <option value="recent">Newest videos</option>
                <option value="oldest">Oldest in latest 50</option>
              </select>
            </Field>
            <Field label="Tone">
              <select value={tone} onChange={(e) => setTone(e.target.value)} className="input bg-white">
                <option value="warm-curious">Warm curious</option>
                <option value="playful">Playful</option>
                <option value="calm-helpful">Calm helpful</option>
                <option value="creator-casual">Creator casual</option>
              </select>
            </Field>
            <Field label="Instructions" wide>
              <textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} className="input min-h-24 bg-white py-3 leading-6" />
            </Field>
          </div>

          <div className={cn("mt-4 flex flex-col gap-3 rounded-xl border p-3 sm:flex-row sm:items-center sm:justify-between", isDark ? "border-white/10 bg-white/6" : "border-[#1A1A1A]/8 bg-[#F9F8F6]")}>
            <div className="space-y-2">
              <label className={cn("flex items-center gap-2 text-sm font-bold", isDark ? "text-white/65" : "text-[#1A1A1A]/65")}>
                <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} />
                Preview only
              </label>
              <label className={cn("flex items-center gap-2 text-sm font-bold", isDark ? "text-white/65" : "text-[#1A1A1A]/65")}>
                <input type="checkbox" checked={identifyMovies} onChange={(e) => setIdentifyMovies(e.target.checked)} />
                Use Movie ID context in replies
              </label>
            </div>
            <button type="button" disabled={!active || !canReply || agentRunning} onClick={() => void runReplyAgent()} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-[#FFDE32] px-4 py-2 text-xs font-bold text-[#1A1A1A] transition hover:bg-[#FF0033] hover:text-white disabled:cursor-not-allowed disabled:opacity-50">
              {agentRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : dryRun ? <Sparkles className="h-4 w-4" /> : <Send className="h-4 w-4" />}
              {dryRun ? "Preview replies" : "Post replies"}
            </button>
          </div>

          {agentError ? <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-3 text-sm font-semibold text-red-800">{agentError}</div> : null}
        </div>

        <ReplyAgentResults result={agentResult} />
      </section>
      ) : null}
      {uploadModalOpen ? (
        <UploadModal
          canUpload={canUpload}
          selectedFileLabel={selectedFileLabel}
          file={file}
          title={title}
          description={description}
          tags={tags}
          privacyStatus={privacyStatus}
          madeForKids={madeForKids}
          playlists={playlists}
          playlistId={playlistId}
          newPlaylistTitle={newPlaylistTitle}
          loadingPlaylists={loadingPlaylists}
          uploading={uploading}
          uploadError={uploadError}
          uploadResult={uploadResult}
          onClose={() => setUploadModalOpen(false)}
          onFileChange={setFile}
          onTitleChange={setTitle}
          onDescriptionChange={setDescription}
          onTagsChange={setTags}
          onPrivacyStatusChange={setPrivacyStatus}
          onMadeForKidsChange={setMadeForKids}
          onPlaylistIdChange={setPlaylistId}
          onNewPlaylistTitleChange={setNewPlaylistTitle}
          onRefreshPlaylists={() => void loadPlaylists()}
          onSubmit={uploadVideo}
        />
      ) : null}
    </div>
  );
}

function Field({ label, children, wide = false }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <label className={cn("space-y-1.5", wide && "sm:col-span-2")}>
      <span className="text-[11px] font-bold uppercase tracking-widest text-[#1A1A1A]/35">{label}</span>
      {children}
    </label>
  );
}

function InlineStatus({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2 rounded-2xl border border-[#FFDE32]/35 bg-[#FFDE32]/16 px-4 py-3 text-sm font-bold text-[#1A1A1A]/70">
      <Loader2 className="h-4 w-4 animate-spin text-[#FF0033]" />
      {message}
    </div>
  );
}

function InlineError({ message }: { message: string }) {
  return (
    <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-800">
      {message}
    </div>
  );
}

function ConnectChannelCard() {
  return (
    <div className="rounded-2xl border border-dashed border-[#1A1A1A]/12 bg-white p-6 shadow-sm">
      <div className="grid h-11 w-11 place-items-center rounded-2xl bg-[#FF0033]/10 text-[#FF0033]">
        <Youtube className="h-5 w-5" />
      </div>
      <h2 className="mt-4 font-serif text-2xl font-bold text-[#1A1A1A]">Connect a YouTube channel</h2>
      <p className="mt-2 max-w-lg text-sm font-medium leading-6 text-[#1A1A1A]/55">Use the centered channel selector to add or switch channels. Your feed, optimize tabs, and comment agent will load after a channel is connected.</p>
      <a href="/api/auth/google?mode=connect&next=/channels" className="mt-5 inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[#FFDE32] px-5 text-sm font-black text-[#1A1A1A] transition hover:bg-[#FF0033] hover:text-white">
        <Youtube className="h-4 w-4" />
        Add YouTube channel
      </a>
    </div>
  );
}

function PostDetailPage({
  video,
  tabs,
  activeTab,
  onTabChange,
  onBack,
  onRefresh,
  onUpload,
  loadingAnalytics,
  analytics,
  analyticsError,
  canReadAnalytics,
  canReply,
  comments,
  commentsError,
  loadingComments,
  replyText,
  replyingTo,
  onReplyTextChange,
  onReply,
  onRefreshComments,
  movieCheck,
  movieCheckError,
  checkingMovie,
  onCheckMovie,
  isDark,
}: {
  video: YouTubeDashboardVideo;
  tabs: string[];
  activeTab: string;
  onTabChange: (tab: string) => void;
  onBack: () => void;
  onRefresh: () => void;
  onUpload: () => void;
  loadingAnalytics: boolean;
  analytics: YouTubeVideoAnalytics | null;
  analyticsError: string;
  canReadAnalytics: boolean;
  canReply: boolean;
  comments: YouTubeCommentsResponse | null;
  commentsError: string;
  loadingComments: boolean;
  replyText: Record<string, string>;
  replyingTo: string;
  onReplyTextChange: (id: string, value: string) => void;
  onReply: (id: string) => void;
  onRefreshComments: () => void;
  movieCheck: MovieResult | null;
  movieCheckError: string;
  checkingMovie: boolean;
  onCheckMovie: () => void;
  isDark: boolean;
}) {
  const isShort = (video.durationSeconds || 0) <= 180;
  const titleScoreValue = Math.max(58, Math.min(99, Math.round(42 + video.title.length / 2)));
  const thumbnailScore = Math.min(99, titleScoreValue + 3);
  return (
    <section className={cn("overflow-hidden rounded-2xl border shadow-sm", isDark ? "border-white/10 bg-[#151923] text-white" : "border-[#1A1A1A]/8 bg-white text-[#1A1A1A]")}>
      <div className={cn("flex flex-col gap-3 border-b px-3 py-3 lg:flex-row lg:items-center lg:justify-between", isDark ? "border-white/10 bg-white/5" : "border-[#1A1A1A]/8 bg-[#FDFCFA]")}>
        <div className="flex min-w-0 items-center gap-2">
          <button type="button" onClick={onBack} className={cn("inline-flex min-h-10 shrink-0 items-center gap-2 rounded-xl border px-3 text-xs font-black", isDark ? "border-white/10 text-white/65 hover:bg-white/8" : "border-[#1A1A1A]/10 bg-white text-[#1A1A1A]/60 hover:text-[#FF0033]")}>
            <ArrowLeft className="h-4 w-4" />
            <span className="hidden sm:inline">Videos</span>
          </button>
          <div className="flex min-w-0 gap-4 overflow-x-auto overscroll-x-contain [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {tabs.map((tab) => (
              <button key={tab} type="button" onClick={() => onTabChange(tab)} className={cn("shrink-0 border-b-2 px-0.5 py-2 text-sm font-black", activeTab === tab ? "border-[#2E7BFF]" : "border-transparent", activeTab === tab ? isDark ? "text-white" : "text-[#1A1A1A]" : isDark ? "text-white/42" : "text-[#1A1A1A]/42")}>
                {tab}{tab === "Title" ? ` ${titleScoreValue}` : tab === "Thumbnail" ? ` ${thumbnailScore}` : tab === "Review" ? " 85" : ""}
              </button>
            ))}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button type="button" onClick={onCheckMovie} disabled={!analytics?.url || checkingMovie} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-[#FFDE32] px-3 text-xs font-black text-[#1A1A1A] transition hover:bg-[#FF0033] hover:text-white disabled:opacity-45">
            {checkingMovie ? <Loader2 className="h-4 w-4 animate-spin" /> : <Film className="h-4 w-4" />}
            Movie ID
          </button>
          <button type="button" onClick={onUpload} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-[#1A1A1A] px-3 text-xs font-black text-white transition hover:bg-[#FF0033]">
            <UploadCloud className="h-4 w-4" />
            Upload
          </button>
          <button type="button" onClick={onRefresh} className={cn("grid h-10 w-10 place-items-center rounded-xl border", isDark ? "border-white/10 text-white/55 hover:text-white" : "border-[#1A1A1A]/10 text-[#1A1A1A]/50 hover:text-[#FF0033]")} aria-label="Refresh analytics">
            {loadingAnalytics ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </button>
        </div>
      </div>

      <div className={cn("grid gap-4 border-b p-4 lg:grid-cols-[minmax(150px,220px)_minmax(0,1fr)] lg:items-center", isDark ? "border-white/10 bg-white/5" : "border-[#1A1A1A]/8 bg-[#FDFCFA]")}>
        <div className={cn("relative mx-auto w-full max-w-[190px] overflow-hidden rounded-2xl bg-[#111827] lg:mx-0", isShort ? "aspect-[9/16] max-h-[300px]" : "aspect-video lg:max-w-[220px]")}>
          <VideoThumb video={video} />
          <span className="absolute bottom-3 right-3 rounded-lg bg-black/75 px-2 py-1 text-xs font-black text-white">{formatDuration(video.durationSeconds)}</span>
        </div>
        <div className="min-w-0">
          <p className="text-xs font-black uppercase tracking-widest text-[#FF0033]">{isShort ? "Short" : "Video"} post page</p>
          <h1 className="mt-2 max-w-4xl text-xl font-black leading-tight md:text-2xl">{analytics?.title || video.title}</h1>
          <div className={cn("mt-3 grid gap-2 sm:grid-cols-4", isDark ? "text-white" : "text-[#1A1A1A]")}>
            <Mini label="Views" value={compactNumber(analytics?.publicStats.viewCount ?? video.viewCount)} />
            <Mini label="Likes" value={compactNumber(analytics?.publicStats.likeCount ?? video.likeCount)} />
            <Mini label="Comments" value={compactNumber(analytics?.publicStats.commentCount ?? video.commentCount)} />
            <Mini label="Duration" value={formatDuration(analytics?.durationSeconds ?? video.durationSeconds)} />
          </div>
        </div>
      </div>

      <div className="p-4 md:p-5">
        {!canReadAnalytics ? <Notice className="mb-3" tone="warn" title="Analytics permission needed" body="Reconnect Google and approve YouTube Analytics readonly to see owned-channel analytics." /> : null}
        {analyticsError ? <Notice className="mb-3" tone="error" title="Analytics failed" body={analyticsError} /> : null}
        {activeTab === "Overview" ? (
          <>
            {analytics ? <AnalyticsPanel analytics={analytics} /> : loadingAnalytics ? <InlineStatus message="Loading post analytics" /> : null}
            {analytics?.url ? <a href={analytics.url} target="_blank" rel="noreferrer" className={cn("mt-4 inline-flex min-h-10 items-center gap-2 rounded-xl border px-4 text-xs font-black", isDark ? "border-white/10 text-white/60 hover:text-white" : "border-[#1A1A1A]/10 text-[#1A1A1A]/60 hover:text-[#FF0033]")}>Open on YouTube <ExternalLink className="h-4 w-4" /></a> : null}
            {movieCheckError ? <Notice className="mt-3" tone="error" title="Movie ID failed" body={movieCheckError} /> : null}
            {movieCheck ? <MovieIdentityPanel result={movieCheck} /> : null}
          </>
        ) : activeTab === "Title" ? (
          <div className="space-y-5"><ScorePanel label="Title score" value={titleScoreValue} /><div className="rounded-2xl bg-[#F3F4F8] p-5 text-[#111827]"><p className="text-lg font-black">{video.title}</p><p className="mt-8 text-xs font-bold text-[#111827]/45">{video.title.length} of 100</p></div><SuggestionGrid video={video} /></div>
        ) : activeTab === "Thumbnail" ? (
          <div className="grid gap-4 md:grid-cols-3">{["Current", "High contrast", "Curiosity hook"].map((item, index) => <button key={item} type="button" className="rounded-2xl bg-[#F3F4F8] p-3 text-left text-[#111827]"><ThumbPreview video={video} /><p className="mt-3 text-sm font-black">{item}</p><p className="text-xs font-bold text-[#111827]/45">Score {thumbnailScore - index * 4}</p></button>)}</div>
        ) : activeTab === "SEO" ? (
          <div className="space-y-5 text-[#111827]"><div className="rounded-2xl bg-[#F3F4F8] p-5"><p className="text-sm font-black">Description</p><p className="mt-3 text-sm font-semibold leading-7 text-[#111827]/70">Add a keyword-rich description that names the promise, audience, and related search terms without stuffing.</p></div><div className="flex flex-wrap gap-2">{["recap", "story explained", "movie ending", "viral shorts", "character reveal"].map((tag, index) => <span key={tag} className="rounded-xl bg-[#F3F4F8] px-3 py-2 text-sm font-black text-emerald-700">{70 - index * 3} {tag} +</span>)}</div></div>
        ) : activeTab === "Review" ? (
          <ReviewPanel video={video} />
        ) : activeTab === "Preview" ? (
          <div className="grid gap-5 md:grid-cols-[minmax(0,420px)_minmax(0,1fr)]"><ThumbPreview video={video} /><div><p className="text-xl font-black">{video.title}</p><p className={cn("mt-2 text-sm font-semibold", isDark ? "text-white/45" : "text-[#111827]/45")}>{compactNumber(video.viewCount)} views - {dateAge(video.publishedAt)}</p></div></div>
        ) : activeTab === "Performance" ? (
          analytics ? <AnalyticsPanel analytics={analytics} /> : <InlineStatus message="Loading performance" />
        ) : (
          <>
            {!canReply ? <Notice className="mb-3" tone="warn" title="Comments need permission" body="Reconnect Google and approve YouTube force-ssl to view and reply to comments inside AutoYT." /> : null}
            <CommentsPanel comments={comments} error={commentsError} loading={loadingComments} canReply={canReply} replyText={replyText} replyingTo={replyingTo} onReplyTextChange={onReplyTextChange} onReply={onReply} onRefresh={onRefreshComments} />
          </>
        )}
      </div>
    </section>
  );
}

function UploadModal({
  canUpload,
  file,
  selectedFileLabel,
  title,
  description,
  tags,
  privacyStatus,
  madeForKids,
  playlists,
  playlistId,
  newPlaylistTitle,
  loadingPlaylists,
  uploading,
  uploadError,
  uploadResult,
  onClose,
  onFileChange,
  onTitleChange,
  onDescriptionChange,
  onTagsChange,
  onPrivacyStatusChange,
  onMadeForKidsChange,
  onPlaylistIdChange,
  onNewPlaylistTitleChange,
  onRefreshPlaylists,
  onSubmit,
}: {
  canUpload: boolean;
  file: File | null;
  selectedFileLabel: string;
  title: string;
  description: string;
  tags: string;
  privacyStatus: string;
  madeForKids: boolean;
  playlists: YouTubePlaylistSummary[];
  playlistId: string;
  newPlaylistTitle: string;
  loadingPlaylists: boolean;
  uploading: boolean;
  uploadError: string;
  uploadResult: YouTubeUploadResult | null;
  onClose: () => void;
  onFileChange: (file: File | null) => void;
  onTitleChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onTagsChange: (value: string) => void;
  onPrivacyStatusChange: (value: string) => void;
  onMadeForKidsChange: (value: boolean) => void;
  onPlaylistIdChange: (value: string) => void;
  onNewPlaylistTitleChange: (value: string) => void;
  onRefreshPlaylists: () => void;
  onSubmit: (event: FormEvent) => void;
}) {
  return (
    <div className="fixed inset-0 z-[95] flex items-start justify-center overflow-y-auto bg-[#1A1A1A]/35 px-3 py-4 backdrop-blur-sm sm:px-4 md:py-10">
      <button type="button" className="absolute inset-0 cursor-default" aria-label="Close upload modal" onClick={onClose} />
      <form onSubmit={onSubmit} className="relative w-full max-w-2xl overflow-hidden rounded-2xl border border-[#1A1A1A]/10 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-[#1A1A1A]/8 bg-[#FDFCFA] px-5 py-4">
          <div>
            <h2 className="text-base font-bold text-[#1A1A1A]">Upload video</h2>
            <p className="mt-1 text-xs font-medium text-[#1A1A1A]/45">Choose file, details, visibility, then publish to the selected channel.</p>
          </div>
          <button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-lg border border-[#1A1A1A]/10 text-[#1A1A1A]/55 transition hover:text-[#FF0033]" aria-label="Close upload modal">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="max-h-[calc(100dvh-150px)] overflow-y-auto p-4 sm:p-5">
          <label className="group grid cursor-pointer place-items-center rounded-xl border border-dashed border-[#FF0033]/35 bg-[#F9F8F6] px-4 py-8 text-center transition hover:bg-[#FF0033]/5">
            <input type="file" accept="video/*" className="sr-only" onChange={(event) => onFileChange(event.target.files?.[0] || null)} />
            <FileVideo className="mb-3 h-8 w-8 text-[#FF0033]" />
            <span className="max-w-full truncate text-sm font-bold text-[#1A1A1A]">{selectedFileLabel}</span>
            <span className="mt-1 text-xs font-medium text-[#1A1A1A]/42">MP4, MOV, WebM, or any YouTube-supported video.</span>
          </label>
          <div className="mt-4 grid gap-3">
            <Field label="Title"><input value={title} onChange={(event) => onTitleChange(event.target.value)} maxLength={100} className="h-11 w-full rounded-lg border border-[#1A1A1A]/10 bg-[#FDFCFA] px-3 text-sm font-semibold outline-none transition focus:border-[#FF0033]/45" placeholder="Video title" /></Field>
            <Field label="Description"><textarea value={description} onChange={(event) => onDescriptionChange(event.target.value)} rows={5} className="w-full resize-none rounded-lg border border-[#1A1A1A]/10 bg-[#FDFCFA] px-3 py-3 text-sm outline-none transition focus:border-[#FF0033]/45" placeholder="Description, links, credits" /></Field>
            <Field label="Tags"><input value={tags} onChange={(event) => onTagsChange(event.target.value)} className="h-11 w-full rounded-lg border border-[#1A1A1A]/10 bg-[#FDFCFA] px-3 text-sm outline-none transition focus:border-[#FF0033]/45" placeholder="movie recap, sci fi, explained" /></Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Visibility"><select value={privacyStatus} onChange={(event) => onPrivacyStatusChange(event.target.value)} className="h-11 w-full rounded-lg border border-[#1A1A1A]/10 bg-[#FDFCFA] px-3 text-sm font-bold outline-none transition focus:border-[#FF0033]/45"><option value="private">Private</option><option value="unlisted">Unlisted</option><option value="public">Public</option></select></Field>
              <label className="flex h-11 items-center gap-2 self-end rounded-lg border border-[#1A1A1A]/10 bg-[#FDFCFA] px-3 text-sm font-bold text-[#1A1A1A]/65"><input type="checkbox" checked={madeForKids} onChange={(event) => onMadeForKidsChange(event.target.checked)} className="h-4 w-4 accent-[#FFDE32]" />Made for kids</label>
            </div>
            <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
              <Field label="Add to playlist"><select value={playlistId} onChange={(event) => onPlaylistIdChange(event.target.value)} className="h-11 w-full rounded-lg border border-[#1A1A1A]/10 bg-[#FDFCFA] px-3 text-sm font-bold outline-none transition focus:border-[#FF0033]/45"><option value="">No playlist</option>{playlists.map((playlist) => <option key={playlist.id} value={playlist.id}>{playlist.title} ({playlist.videoCount || 0})</option>)}</select></Field>
              <button type="button" onClick={onRefreshPlaylists} className="mt-6 inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-[#1A1A1A]/10 bg-white px-3 text-xs font-bold text-[#1A1A1A]/60 transition hover:text-[#FF0033]">{loadingPlaylists ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}Refresh</button>
            </div>
            <Field label="Or create playlist"><input value={newPlaylistTitle} onChange={(event) => onNewPlaylistTitleChange(event.target.value)} className="h-11 w-full rounded-lg border border-[#1A1A1A]/10 bg-[#FDFCFA] px-3 text-sm outline-none transition focus:border-[#FF0033]/45" placeholder="New playlist title for this upload" /></Field>
          </div>
          {uploadError ? <Notice className="mt-4" tone="error" title="Upload failed" body={uploadError} /> : null}
          {uploadResult ? <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950"><div className="flex items-center gap-2 font-bold"><CheckCircle2 className="h-4 w-4" /> Uploaded successfully</div><a href={uploadResult.url} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1.5 text-xs font-bold text-emerald-800 underline">Open on YouTube <ExternalLink className="h-3.5 w-3.5" /></a></div> : null}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-[#1A1A1A]/8 bg-[#FDFCFA] px-5 py-4">
          <button type="button" onClick={onClose} className="inline-flex h-10 items-center justify-center rounded-xl border border-[#1A1A1A]/10 bg-white px-4 text-xs font-bold text-[#1A1A1A]/60 transition hover:text-[#1A1A1A]">Cancel</button>
          <button disabled={!canUpload || !file || !title.trim() || uploading} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-[#FFDE32] px-4 text-xs font-bold text-[#1A1A1A] transition hover:bg-[#FF0033] hover:text-white disabled:cursor-not-allowed disabled:opacity-45">{uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}{uploading ? "Uploading" : "Upload"}</button>
        </div>
      </form>
    </div>
  );
}

function Notice({ tone, title, body, action, className }: { tone: "warn" | "error"; title: string; body: string; action?: ReactNode; className?: string }) {
  const error = tone === "error";
  return (
    <div className={cn("flex flex-col gap-3 rounded-xl border p-4 text-sm sm:flex-row sm:items-center sm:justify-between", error ? "border-red-100 bg-red-50 text-red-950" : "border-amber-200 bg-amber-50 text-amber-950", className)}>
      <div className="flex gap-3"><AlertCircle className={cn("mt-0.5 h-4 w-4 shrink-0", error ? "text-red-600" : "text-amber-700")} /><div><p className="font-bold">{title}</p><p className="mt-1 leading-6 opacity-75">{body}</p></div></div>
      {action}
    </div>
  );
}

function AnalyticsPanel({ analytics }: { analytics: YouTubeVideoAnalytics }) {
  const totals = analytics.analytics.totals || {};
  const warning = typeof totals.warning === "string" ? totals.warning : "";
  return (
    <div className="overflow-hidden rounded-xl border border-[#1A1A1A]/8 bg-[#F9F8F6]">
      <div className="flex gap-3 border-b border-[#1A1A1A]/8 bg-white p-3">
        <div className="h-16 w-24 overflow-hidden rounded-lg bg-[#1A1A1A]/5">{analytics.thumbnailUrl ? <img src={analytics.thumbnailUrl} alt="" className="h-full w-full object-cover" /> : null}</div>
        <div className="min-w-0 flex-1"><p className="line-clamp-2 text-sm font-bold text-[#1A1A1A]">{analytics.title}</p><a href={analytics.url} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs font-bold text-[#FF0033]">Open post <ExternalLink className="h-3 w-3" /></a></div>
      </div>
      <div className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Views" value={compactNumber(Number(totals.views ?? analytics.publicStats.viewCount))} />
        <Stat label="Likes" value={compactNumber(Number(totals.likes ?? analytics.publicStats.likeCount))} />
        <Stat label="Comments" value={compactNumber(Number(totals.comments ?? analytics.publicStats.commentCount))} />
        <Stat label="Watch min" value={plainNumber(totals.estimatedMinutesWatched)} />
        <Stat label="Avg view" value={`${plainNumber(totals.averageViewDuration)}s`} />
        <Stat label="Subs gained" value={plainNumber(totals.subscribersGained)} />
      </div>
      {warning ? <p className="border-t border-[#1A1A1A]/8 px-3 py-2 text-xs font-semibold leading-5 text-amber-800">{warning}</p> : null}
    </div>
  );
}

function MovieIdentityPanel({ result }: { result: MovieResult }) {
  return (
    <div className="mt-4 overflow-hidden rounded-xl border border-[#1A1A1A]/8 bg-white">
      <div className="flex flex-col gap-4 border-b border-[#1A1A1A]/8 bg-[#FDFCFA] p-4 md:flex-row md:items-start">
        <div className="h-28 w-20 shrink-0 overflow-hidden rounded-lg bg-[#1A1A1A]/5">{result.posterUrl ? <img src={result.posterUrl} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" /> : <Film className="m-auto mt-9 h-8 w-8 text-[#FF0033]/35" />}</div>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold uppercase tracking-widest text-[#FF0033]">Detected movie</p>
          <h3 className="mt-1 font-serif text-2xl font-bold text-[#1A1A1A]">{result.title || "Unknown title"} {result.year ? <span className="text-[#1A1A1A]/45">({result.year})</span> : null}</h3>
          <p className="mt-2 text-sm leading-6 text-[#1A1A1A]/62">{result.summary || result.tmdb?.overview || result.mal?.synopsis || "Movie ID returned a title match without a summary."}</p>
        </div>
      </div>
    </div>
  );
}

function CommentsPanel({ comments, error, loading, canReply, replyText, replyingTo, onReplyTextChange, onReply, onRefresh }: {
  comments: YouTubeCommentsResponse | null;
  error: string;
  loading: boolean;
  canReply: boolean;
  replyText: Record<string, string>;
  replyingTo: string;
  onReplyTextChange: (id: string, value: string) => void;
  onReply: (id: string) => void;
  onRefresh: () => void;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-[#1A1A1A]/8 bg-white">
      <div className="flex items-center justify-between border-b border-[#1A1A1A]/8 bg-[#FDFCFA] px-3 py-3">
        <div className="flex items-center gap-2"><MessageCircle className="h-4 w-4 text-[#FF0033]" /><p className="text-sm font-bold text-[#1A1A1A]">Recent comments</p></div>
        <button type="button" onClick={onRefresh} className="grid h-8 w-8 place-items-center rounded-lg border border-[#1A1A1A]/10 text-[#1A1A1A]/50 transition hover:text-[#FF0033]" aria-label="Refresh comments">{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}</button>
      </div>
      {error ? <p className="border-b border-red-100 bg-red-50 px-3 py-2 text-xs font-bold text-red-900">{error}</p> : null}
      <div className="max-h-[620px] space-y-2 overflow-y-auto bg-[#F9F8F6] p-3">
        {loading && !comments ? (
          <p className="rounded-lg bg-white px-3 py-4 text-sm font-semibold text-[#1A1A1A]/45">Loading comments</p>
        ) : comments?.comments?.length ? (
          comments.comments.map((thread) => {
            const parent = thread.topLevelComment;
            return (
              <div key={thread.threadId} className="rounded-xl border border-[#1A1A1A]/8 bg-white p-3">
                <CommentBody comment={parent} />
                {thread.replies.length ? <div className="mt-3 space-y-2 border-l border-[#1A1A1A]/10 pl-3">{thread.replies.slice(-3).map((reply) => <CommentBody key={reply.id} comment={reply} compact />)}</div> : null}
                {canReply && thread.canReply ? (
                  <div className="mt-3 flex gap-2">
                    <input value={replyText[parent.id] || ""} onChange={(event) => onReplyTextChange(parent.id, event.target.value)} className="h-10 min-w-0 flex-1 rounded-lg border border-[#1A1A1A]/10 bg-[#FDFCFA] px-3 text-sm outline-none transition focus:border-[#FF0033]/45" placeholder="Reply as your channel" />
                    <button type="button" onClick={() => onReply(parent.id)} disabled={!replyText[parent.id]?.trim() || replyingTo === parent.id} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[#FFDE32] px-3 text-xs font-bold text-[#1A1A1A] transition hover:bg-[#FF0033] hover:text-white disabled:opacity-45">{replyingTo === parent.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}Reply</button>
                  </div>
                ) : <p className="mt-3 rounded-lg bg-[#F9F8F6] px-3 py-2 text-xs font-semibold text-[#1A1A1A]/45">{canReply ? "Replies are disabled for this thread." : "Reconnect Google to enable replies."}</p>}
              </div>
            );
          })
        ) : <p className="rounded-lg bg-white px-3 py-4 text-sm font-semibold text-[#1A1A1A]/45">No recent comments returned for this video.</p>}
      </div>
    </div>
  );
}

function CommentBody({ comment, compact = false }: { comment: YouTubeCommentsResponse["comments"][number]["topLevelComment"]; compact?: boolean }) {
  return (
    <div className="flex gap-3">
      {comment.authorProfileImageUrl ? <img src={comment.authorProfileImageUrl} alt="" className={cn("rounded-full object-cover", compact ? "h-7 w-7" : "h-9 w-9")} referrerPolicy="no-referrer" /> : <div className={cn("grid rounded-full bg-[#FF0033]/10 text-[#FF0033]", compact ? "h-7 w-7" : "h-9 w-9")}><MessageCircle className="m-auto h-3.5 w-3.5" /></div>}
      <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="truncate text-xs font-bold text-[#1A1A1A]">{comment.authorDisplayName || "YouTube user"}</p><p className="text-[11px] font-semibold text-[#1A1A1A]/35">{comment.likeCount ? `${compactNumber(comment.likeCount)} likes` : ""}</p></div><p className={cn("mt-1 whitespace-pre-wrap text-sm leading-6 text-[#1A1A1A]/70", compact && "text-xs leading-5")}>{comment.textDisplay}</p></div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg bg-white px-3 py-2"><p className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/35">{label}</p><p className="mt-1 truncate text-sm font-bold text-[#1A1A1A]">{value}</p></div>;
}

function FeedDashboard({ dashboard, onOpenVideo, isDark }: { dashboard: YouTubeChannelDashboard; onOpenVideo: (video: YouTubeDashboardVideo) => void; isDark: boolean }) {
  const videos = dashboard.recentVideos || [];
  const growth = dashboard.growthInsights || null;
  const outliers = [...videos].sort((a, b) => b.viewCount - a.viewCount).slice(0, 3);
  const patterns = videos.slice(3, 6);
  const topVideo = outliers[0] || videos[0];
  const competitorVideos = growth?.competitorVideos || [];

  return (
    <div className={cn("mx-auto max-w-3xl space-y-6 pb-12", isDark ? "text-white" : "text-[#111827]")}>
      <div className="grid gap-4 md:grid-cols-2">
        <FeedStat label="Subscribers" value={compactNumber(dashboard.stats.subscriberCount)} hint={`${compactNumber(Math.max(0, dashboard.stats.subscriberCount - 50))} target`} isDark={isDark} />
        <FeedStat label="Views" value={compactNumber(dashboard.stats.viewCount)} hint={`${compactNumber(dashboard.stats.recentViews)} recent`} isDark={isDark} />
      </div>

      <div className={cn("rounded-2xl px-5 py-4 text-center text-sm font-black", isDark ? "bg-[#102A5C] text-white" : "bg-[#EAF2FF] text-[#1F5FE8]")}>
        <span className="mr-2 inline-block h-2.5 w-2.5 rounded-full bg-[#2E7BFF]" />
        {growth ? `${growth.niches.length + growth.competitorVideos.length} growth signals for this channel` : "Learning insights will appear after agent checks"}
      </div>

      {growth ? (
        <section className={cn("rounded-2xl p-5 shadow-sm", isDark ? "bg-[#151923]" : "bg-white")}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-black uppercase tracking-widest text-[#2E7BFF]">Monetization playbook</p>
              <h2 className="mt-1 text-xl font-black">{growth.playbook.bestNiche || "Find a repeatable winner"}</h2>
              <p className={cn("mt-2 text-sm font-semibold leading-6", isDark ? "text-white/55" : "text-[#1A1A1A]/55")}>{growth.playbook.monetizationFocus}</p>
            </div>
            <BarChart3 className="h-5 w-5 shrink-0 text-[#2E7BFF]" />
          </div>
          <div className="mt-4 grid gap-2">
            {growth.playbook.actions.slice(0, 4).map((action) => (
              <p key={action} className={cn("rounded-xl px-3 py-2 text-sm font-bold leading-6", isDark ? "bg-white/7 text-white/78" : "bg-[#F4F5F8] text-[#1A1A1A]/72")}>{action}</p>
            ))}
          </div>
        </section>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {["All", "Optimization", "Research", "Analytics", "Achievements"].map((item, index) => (
          <button key={item} className={cn("rounded-full px-4 py-2 text-sm font-black transition", index === 0 ? "bg-[#2E7BFF] text-white" : isDark ? "bg-white/8 text-white/85 hover:bg-white/12" : "bg-white text-[#1A1A1A]/75 shadow-sm hover:text-[#1A1A1A]")}>{item}</button>
        ))}
      </div>

      <FeedSection title="Niche Outliers" meta="1h ago" isDark={isDark}>
        <div className="grid gap-4 sm:grid-cols-3">
          {outliers.map((video, index) => <FeedVideoCard key={video.id} video={video} multiplier={index === 0 ? "8.7x" : index === 1 ? "21x" : "2x"} onClick={() => onOpenVideo(video)} />)}
        </div>
      </FeedSection>

      <div className={cn("rounded-2xl p-5 shadow-sm", isDark ? "bg-[#151923]" : "bg-white")}>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-black">Trending Keyword</p>
            <p className={cn("mt-1 text-xs font-bold", isDark ? "text-white/45" : "text-[#1A1A1A]/42")}>story video · {compactNumber(Math.max(1, dashboard.stats.recentViews))} VPH</p>
          </div>
          <BarChart3 className="h-5 w-5 text-[#2E7BFF]" />
        </div>
        <TrendGraph />
      </div>

      <FeedSection title="Outlier Pattern: Repeatable story hooks" meta="1d ago" isDark={isDark}>
        <div className="grid gap-4 sm:grid-cols-3">
          {patterns.map((video, index) => <FeedVideoCard key={video.id} video={video} multiplier={`${index + 3}x`} onClick={() => onOpenVideo(video)} />)}
          {!patterns.length && topVideo ? <FeedVideoCard video={topVideo} multiplier="3x" onClick={() => onOpenVideo(topVideo)} /> : null}
        </div>
      </FeedSection>

      {competitorVideos.length ? (
        <FeedSection title="Competitor/source feed" meta={`${competitorVideos.length} clips`} isDark={isDark}>
          <div className="grid gap-4 sm:grid-cols-3">
            {competitorVideos.slice(0, 6).map((video) => <CompetitorVideoCard key={`${video.competitorId}-${video.url}`} video={video} />)}
          </div>
        </FeedSection>
      ) : null}

      <div className={cn("rounded-2xl p-5 shadow-sm", isDark ? "bg-[#151923]" : "bg-white")}>
        <div className="flex items-center gap-3">
          <MessageCircle className="h-5 w-5 text-[#FF0033]" />
          <div>
            <p className="text-sm font-black">Unanswered Comments</p>
            <p className={cn("text-xs font-bold", isDark ? "text-white/45" : "text-[#1A1A1A]/42")}>Recent comments worth replying to</p>
          </div>
        </div>
        <div className={cn("mt-4 grid gap-3 rounded-2xl p-4", isDark ? "bg-white/6" : "bg-[#F4F5F8]")}>
          <p className="text-sm font-semibold">Run the comment agent to answer high-context comments with concise, useful replies.</p>
          <button className="h-10 rounded-xl bg-[#2E7BFF] px-4 text-sm font-black text-white">Open comment agent</button>
        </div>
      </div>
    </div>
  );
}

function FeedStat({ label, value, hint, isDark }: { label: string; value: string; hint: string; isDark: boolean }) {
  return (
    <div className={cn("rounded-3xl p-6 text-center shadow-sm", isDark ? "bg-[#151923]" : "bg-white")}>
      <p className={cn("text-xs font-black uppercase tracking-widest", isDark ? "text-white/42" : "text-[#1A1A1A]/38")}>{label}</p>
      <p className="mt-2 text-5xl font-black tracking-tight">{value}</p>
      <div className={cn("mt-5 h-2 rounded-full", isDark ? "bg-white/8" : "bg-[#EDF0F5]")}>
        <div className="h-full w-[72%] rounded-full bg-[#2E7BFF]" />
      </div>
      <p className={cn("mt-2 text-xs font-bold", isDark ? "text-white/35" : "text-[#1A1A1A]/35")}>{hint}</p>
    </div>
  );
}

function FeedSection({ title, meta, children, isDark }: { title: string; meta: string; children: ReactNode; isDark: boolean }) {
  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-black">{title} <span className={cn("text-sm font-bold", isDark ? "text-white/35" : "text-[#1A1A1A]/35")}>· {meta}</span></h2>
        <button className={cn("grid h-8 w-8 place-items-center rounded-full", isDark ? "bg-white/8 text-white/45" : "bg-white text-[#1A1A1A]/45")}>×</button>
      </div>
      {children}
    </section>
  );
}

function FeedVideoCard({ video, multiplier, onClick }: { video: YouTubeDashboardVideo; multiplier: string; onClick: () => void }) {
  const thumbnailUrl = sharpYouTubeThumbnail(video.thumbnailUrl);
  return (
    <button type="button" onClick={onClick} className="group text-left">
      <div className="relative aspect-[9/12] overflow-hidden rounded-2xl bg-[#111827] shadow-sm">
        {thumbnailUrl ? <img src={thumbnailUrl} alt="" className="h-full w-full object-cover transition duration-300 group-hover:scale-105" referrerPolicy="no-referrer" loading="lazy" /> : <div className="grid h-full place-items-center bg-[#FF0033]/10"><PlaySquare className="h-8 w-8 text-[#FF0033]" /></div>}
        <span className="absolute left-3 top-3 rounded-full bg-[#6B4DFF] px-2.5 py-1 text-xs font-black text-white">{multiplier}</span>
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/70 to-transparent p-3 text-white">
          <p className="line-clamp-2 text-sm font-black">{video.title}</p>
          <p className="mt-1 text-[11px] font-semibold text-white/62">{compactNumber(video.viewCount)} views · {dateAge(video.publishedAt)}</p>
        </div>
      </div>
    </button>
  );
}

function CompetitorVideoCard({ video }: { video: NonNullable<YouTubeChannelDashboard["growthInsights"]>["competitorVideos"][number] }) {
  return (
    <a href={video.url || "#"} target="_blank" rel="noreferrer" className="group text-left">
      <div className="relative aspect-[9/12] overflow-hidden rounded-2xl bg-[#111827] shadow-sm">
        {video.thumbnailUrl ? <img src={video.thumbnailUrl} alt="" className="h-full w-full object-cover transition duration-300 group-hover:scale-105" referrerPolicy="no-referrer" loading="lazy" /> : <div className="grid h-full place-items-center bg-[#FF0033]/10"><PlaySquare className="h-8 w-8 text-[#FF0033]" /></div>}
        <span className="absolute left-3 top-3 rounded-full bg-[#FF0033] px-2.5 py-1 text-xs font-black text-white">{compactNumber(video.velocity)} VPH</span>
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/70 to-transparent p-3 text-white">
          <p className="line-clamp-2 text-sm font-black">{video.title}</p>
          <p className="mt-1 text-[11px] font-semibold text-white/62">{video.competitorTitle} · {compactNumber(video.views)} views</p>
          <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-white/48">{video.hookPattern}</p>
        </div>
      </div>
    </a>
  );
}

function TrendGraph() {
  return (
    <svg viewBox="0 0 520 150" className="mt-5 h-36 w-full overflow-visible">
      <defs>
        <linearGradient id="trendFill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#2E7BFF" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#2E7BFF" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d="M0 125 L25 110 L52 118 L78 72 L105 96 L132 86 L158 117 L185 108 L212 121 L238 55 L265 92 L292 73 L318 118 L345 114 L372 103 L398 122 L425 62 L452 97 L478 111 L505 76 L520 88 L520 150 L0 150 Z" fill="url(#trendFill)" />
      <path d="M0 125 L25 110 L52 118 L78 72 L105 96 L132 86 L158 117 L185 108 L212 121 L238 55 L265 92 L292 73 L318 118 L345 114 L372 103 L398 122 L425 62 L452 97 L478 111 L505 76 L520 88" fill="none" stroke="#2E7BFF" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ReplyAgentResults({ result }: { result: any }) {
  if (!result) {
    return (
      <div className="rounded-xl border border-dashed border-[#1A1A1A]/12 bg-white p-5 shadow-sm">
        <p className="text-sm font-bold text-[#1A1A1A]">No scan yet</p>
        <p className="mt-2 text-sm leading-6 text-[#1A1A1A]/55">Run a preview to see which comments the agent would answer before posting.</p>
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-[#1A1A1A]/8 bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-[#1A1A1A]/8 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-[#FF0033]">{result.dryRun ? "Preview results" : "Posted replies"}</p>
          <h3 className="mt-1 text-lg font-bold text-[#1A1A1A]">{result.replied?.length || 0} replies {result.dryRun ? "ready" : "sent"}</h3>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center">
          <Mini label="Videos" value={String(result.scanned?.length || 0)} />
          <Mini label="Skipped" value={String(result.skipped?.length || 0)} />
          <Mini label="Stored" value={compactNumber(result.stats?.totalReplies || 0)} />
        </div>
      </div>
      <div className="max-h-[560px] space-y-3 overflow-y-auto bg-[#F9F8F6] p-3">
        {result.replied?.length ? result.replied.map((item: any) => (
          <div key={`${item.videoId}-${item.commentId}`} className="rounded-xl border border-[#1A1A1A]/8 bg-white p-3">
            <p className="line-clamp-1 text-xs font-bold text-[#1A1A1A]/45">{item.videoTitle}</p>
            <p className="mt-2 text-sm font-semibold leading-6 text-[#1A1A1A]/70">{item.comment}</p>
            <div className="mt-3 rounded-lg bg-[#FFDE32]/25 p-3 text-sm font-bold leading-6 text-[#1A1A1A]">
              {item.replyType === "movie_name" ? <span className="mb-1 block text-[10px] font-black uppercase tracking-widest text-[#FF0033]">Movie ID reply</span> : null}
              {item.replyType === "ai_engagement_movie_context" ? <span className="mb-1 block text-[10px] font-black uppercase tracking-widest text-[#FF0033]">Movie-aware reply</span> : null}
              {item.replyText}
            </div>
          </div>
        )) : (
          <p className="rounded-lg bg-white p-4 text-sm font-semibold text-[#1A1A1A]/45">No suitable comments found in this scan.</p>
        )}
      </div>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-[#F9F8F6] px-3 py-2">
      <p className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/35">{label}</p>
      <p className="mt-0.5 text-sm font-black text-[#1A1A1A]">{value}</p>
    </div>
  );
}

function Metric({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[#1A1A1A]/8 bg-[#F9F8F6] px-3 py-2.5">
      <div className="mb-1.5 flex items-center gap-1.5 text-[#FF0033]">
        {icon}
        <span className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/35">{label}</span>
      </div>
      <p className="truncate text-base font-bold text-[#1A1A1A]">{value}</p>
    </div>
  );
}

function RecentUpload({ video, onOpenVideo }: { video: YouTubeDashboardVideo; onOpenVideo?: (video: YouTubeDashboardVideo) => void }) {
  const thumbnailUrl = sharpYouTubeThumbnail(video.thumbnailUrl);
  return (
    <button type="button" onClick={() => onOpenVideo?.(video)} className="grid grid-cols-[96px_minmax(0,1fr)] gap-3 rounded-lg border border-[#1A1A1A]/8 bg-[#FDFCFA] p-2 text-left transition hover:border-[#FF0033]/25">
      <div className="aspect-video overflow-hidden rounded-md bg-[#1A1A1A]/5">
        {thumbnailUrl ? <img src={thumbnailUrl} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" loading="lazy" /> : null}
      </div>
      <div className="min-w-0">
        <p className="line-clamp-2 text-xs font-bold leading-snug text-[#1A1A1A]">{video.title}</p>
        <p className="mt-1 text-[11px] font-semibold text-[#1A1A1A]/42">{compactNumber(video.viewCount)} views - {dateAge(video.publishedAt)}</p>
      </div>
    </button>
  );
}

function OptimizeCard({ video, mode, onClick }: { video: YouTubeDashboardVideo; mode: "videos" | "shorts"; onClick: () => void }) {
  const score = Math.max(58, Math.min(99, Math.round(42 + video.title.length / 2 + (video.viewCount > 1000 ? 10 : 0))));
  const thumbnailUrl = sharpYouTubeThumbnail(video.thumbnailUrl);
  return (
    <button type="button" onClick={onClick} className="group text-left">
      <div className={cn("relative overflow-hidden rounded-2xl bg-[#111827]", mode === "shorts" ? "aspect-[9/16]" : "aspect-video")}>
        {thumbnailUrl ? <img src={thumbnailUrl} alt="" className="h-full w-full object-cover transition duration-300 group-hover:scale-105" referrerPolicy="no-referrer" loading="lazy" /> : <div className="grid h-full w-full place-items-center bg-[#FF0033]/10 text-[#FF0033]"><PlaySquare className="h-8 w-8" /></div>}
        <span className="absolute right-3 top-3 rounded-lg bg-black/75 px-2 py-1 text-[11px] font-black text-white">{formatDuration(video.durationSeconds)}</span>
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/65 to-transparent p-3 text-white">
          <span className="rounded-lg bg-white px-2 py-1 text-xs font-black text-emerald-700">Title {score}</span>
          <p className="mt-3 line-clamp-2 text-sm font-black">{video.title}</p>
          <p className="mt-1 text-xs font-semibold text-white/60">{compactNumber(video.viewCount)} views - {dateAge(video.publishedAt)}</p>
        </div>
      </div>
    </button>
  );
}

function VideoOptimizeModal({ video, onClose, isDark = false }: { video: YouTubeDashboardVideo; onClose: () => void; isDark?: boolean }) {
  const isShort = (video.durationSeconds || 0) <= 180;
  const tabs = ["Title", ...(isShort ? [] : ["Thumbnail"]), "SEO", "Review", "Preview", "Performance"];
  const [tab, setTab] = useState(tabs[0]);
  const titleScoreValue = Math.max(58, Math.min(99, Math.round(42 + video.title.length / 2)));
  const thumbnailScore = Math.min(99, titleScoreValue + 3);

  return (
    <div className={cn("fixed inset-0 z-[100] p-4 backdrop-blur-md", isDark ? "bg-black/55" : "bg-[#111827]/35")}>
      <div className={cn("mx-auto flex max-h-[92vh] max-w-5xl flex-col overflow-hidden rounded-[1.7rem] shadow-2xl", isDark ? "bg-[#151923] text-white" : "bg-white text-[#111827]")}>
        <div className={cn("flex items-center justify-between border-b px-5 py-4", isDark ? "border-white/10" : "border-[#111827]/8")}>
          <button type="button" onClick={onClose} className={cn("grid h-9 w-9 place-items-center rounded-full", isDark ? "text-white/45 hover:bg-white/8 hover:text-white" : "text-[#111827]/45 hover:bg-[#F3F4F8] hover:text-[#111827]")}><X className="h-4 w-4" /></button>
          <h2 className="text-lg font-black">Optimize Video</h2>
          <button type="button" className={cn("rounded-xl px-4 py-2 text-sm font-black", isDark ? "text-white/45 hover:bg-white/8" : "text-[#111827]/45 hover:bg-[#F3F4F8]")}>Save Changes</button>
        </div>
        <div className={cn("flex gap-7 overflow-x-auto border-b px-6", isDark ? "border-white/10" : "border-[#111827]/8")}>
          {tabs.map((item) => (
            <button key={item} type="button" onClick={() => setTab(item)} className={cn("shrink-0 border-b-2 py-4 text-sm font-black", tab === item ? isDark ? "border-[#2E7BFF] text-white" : "border-[#2E7BFF] text-[#111827]" : isDark ? "border-transparent text-white/45" : "border-transparent text-[#111827]/45")}>
              {item}{item === "Title" ? ` ${titleScoreValue}` : item === "Thumbnail" ? ` ${thumbnailScore}` : item === "Review" ? " 85" : ""}
            </button>
          ))}
        </div>
        <div className="grid min-h-0 flex-1 overflow-y-auto md:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0 p-6">
            {tab === "Title" ? (
              <div className="space-y-5">
                <ScorePanel label="Title score" value={titleScoreValue} />
                <div className="rounded-2xl bg-[#F3F4F8] p-5">
                  <p className="text-lg font-black">{video.title}</p>
                  <p className="mt-8 text-xs font-bold text-[#111827]/45">{video.title.length} of 100</p>
                </div>
                <SuggestionGrid video={video} />
              </div>
            ) : tab === "Thumbnail" ? (
              <div className="space-y-5">
                <div className="grid gap-4 md:grid-cols-3">
                  {["Current", "Nano Banana 2", "High contrast"].map((item, index) => (
                    <button key={item} type="button" className="rounded-2xl bg-[#F3F4F8] p-3 text-left">
                      <ThumbPreview video={video} />
                      <p className="mt-3 text-sm font-black">{item}</p>
                      <p className="text-xs font-bold text-[#111827]/45">Score {thumbnailScore - index * 4}</p>
                    </button>
                  ))}
                </div>
                <div className="rounded-3xl bg-[#F3F4F8] p-5">
                  <textarea placeholder="Describe your thumbnail idea..." className="min-h-24 w-full resize-none bg-transparent text-sm font-semibold outline-none" />
                  <button className="mt-4 inline-flex h-10 items-center gap-2 rounded-full bg-[#2E7BFF] px-5 text-sm font-black text-white"><Wand2 className="h-4 w-4" />Generate with Nano Banana 2</button>
                </div>
              </div>
            ) : tab === "SEO" ? (
              <div className="space-y-5">
                <div className="rounded-2xl bg-[#F3F4F8] p-5">
                  <p className="text-sm font-black">Description</p>
                  <p className="mt-3 text-sm font-semibold leading-7 text-[#111827]/70">Add a keyword-rich description that names the promise, audience, and related search terms without stuffing.</p>
                </div>
                <div>
                  <p className="mb-3 text-sm font-black">Suggestions</p>
                  <div className="flex flex-wrap gap-2">{["recap", "story explained", "anime", "movie ending", "viral shorts", "character reveal"].map((tag, index) => <span key={tag} className="rounded-xl bg-[#F3F4F8] px-3 py-2 text-sm font-black text-emerald-700">{70 - index * 3} {tag} +</span>)}</div>
                </div>
              </div>
            ) : tab === "Review" ? (
              <ReviewPanel video={video} />
            ) : tab === "Preview" ? (
              <div className="grid gap-5 md:grid-cols-2">
                <ThumbPreview video={video} />
                <div><p className="text-xl font-black">{video.title}</p><p className="mt-2 text-sm font-semibold text-[#111827]/45">{compactNumber(video.viewCount)} views - {dateAge(video.publishedAt)}</p></div>
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-3"><Mini label="Views" value={compactNumber(video.viewCount)} /><Mini label="Likes" value={compactNumber(video.likeCount)} /><Mini label="Comments" value={compactNumber(video.commentCount)} /></div>
            )}
          </div>
          <aside className={cn("border-l p-5", isDark ? "border-white/10" : "border-[#111827]/8")}>
            <ThumbPreview video={video} />
            <p className="mt-4 text-sm font-black">{video.title}</p>
            <p className="mt-1 text-xs font-semibold text-[#111827]/45">{dateAge(video.publishedAt)} - {compactNumber(video.viewCount)} views</p>
            <div className="mt-5 space-y-3">
              <FeedbackLine text="Clear title hook" good />
              <FeedbackLine text={isShort ? "Shorts packaging is separated" : "Thumbnail generation available"} good />
              <FeedbackLine text="Tags can be improved" />
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

function ThumbPreview({ video }: { video: YouTubeDashboardVideo }) {
  const thumbnailUrl = sharpYouTubeThumbnail(video.thumbnailUrl);
  return <div className="aspect-video overflow-hidden rounded-2xl bg-[#111827]/5">{thumbnailUrl ? <img src={thumbnailUrl} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" loading="lazy" /> : <div className="grid h-full place-items-center"><PlaySquare className="h-8 w-8 text-[#111827]/25" /></div>}</div>;
}

function VideoThumb({ video }: { video: YouTubeDashboardVideo }) {
  const thumbnailUrl = sharpYouTubeThumbnail(video.thumbnailUrl);
  return thumbnailUrl ? <img src={thumbnailUrl} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" loading="lazy" /> : <div className="grid h-full place-items-center bg-[#FF0033]/10"><PlaySquare className="h-8 w-8 text-[#FF0033]" /></div>;
}

function ScorePanel({ label, value }: { label: string; value: number }) {
  return <div className="rounded-2xl bg-[#F3F4F8] p-4"><div className="flex items-center justify-between"><p className="text-sm font-black">{label}</p><span className="rounded-xl bg-emerald-100 px-3 py-1 text-sm font-black text-emerald-700">{value}</span></div><div className="mt-4 h-2 rounded-full bg-white"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${value}%` }} /></div></div>;
}

function SuggestionGrid({ video }: { video: YouTubeDashboardVideo }) {
  return <div className="grid gap-4 md:grid-cols-3">{["These Clips Are Going Viral", "The Story Everyone Missed", "This Ending Changed Everything"].map((title) => <div key={title} className="rounded-2xl bg-[#F3F4F8] p-3"><ThumbPreview video={video} /><p className="mt-3 text-sm font-black">{title}</p><p className="mt-1 text-xs font-bold text-emerald-700">Score {Math.round(78 + title.length / 3)}</p></div>)}</div>;
}

function ReviewPanel({ video }: { video: YouTubeDashboardVideo }) {
  return <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_280px]"><ThumbPreview video={video} /><div className="space-y-3"><ReviewNote title="The Hook" body="The first seconds need a sharp curiosity promise and a clear reason to keep watching." /><ReviewNote title="Pacing" body="Shorts need fast transitions. Long videos need clearer chapters and topic continuity." /><ReviewNote title="Packaging" body="Title and thumbnail should agree on one emotional promise." /></div></div>;
}

function ReviewNote({ title, body }: { title: string; body: string }) {
  return <div className="rounded-2xl bg-[#F3F4F8] p-4"><p className="font-black">{title}</p><p className="mt-2 text-sm font-semibold leading-6 text-[#111827]/58">{body}</p></div>;
}

function FeedbackLine({ text, good = false }: { text: string; good?: boolean }) {
  return <div className="rounded-2xl bg-[#F3F4F8] px-4 py-3 text-sm font-bold text-[#111827]/65"><span className={cn("mr-2 inline-block h-2 w-2 rounded-full", good ? "bg-emerald-500" : "bg-[#FFDE32]")} />{text}</div>;
}
