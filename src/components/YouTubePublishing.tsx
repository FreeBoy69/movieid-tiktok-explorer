import { AlertCircle, ArrowLeft, BarChart3, CheckCircle2, ExternalLink, FileVideo, Film, Loader2, MessageCircle, RefreshCw, Send, UploadCloud, X, Youtube } from "lucide-react";
import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { AuthSessionPayload, MovieResult, YouTubeChannelDashboard, YouTubeCommentsResponse, YouTubeDashboardVideo, YouTubePlaylistSummary, YouTubeUploadResult, YouTubeVideoAnalytics } from "../types";
import { cn } from "../lib/utils";

const UPLOAD_SCOPE = "https://www.googleapis.com/auth/youtube.upload";
const ANALYTICS_SCOPE = "https://www.googleapis.com/auth/yt-analytics.readonly";
const COMMENT_SCOPE = "https://www.googleapis.com/auth/youtube.force-ssl";

function compactNumber(value: number | string | null | undefined): string {
  const n = Number(value || 0);
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(Number.isFinite(n) ? n : 0);
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

function hasScope(auth: AuthSessionPayload, scope: string): boolean {
  return String(auth.activeAccount?.scope || "").split(/\s+/).includes(scope);
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

export function YouTubePublishing({ auth, initialVideoId = "" }: { auth: AuthSessionPayload; initialVideoId?: string }) {
  const [dashboard, setDashboard] = useState<YouTubeChannelDashboard | null>(null);
  const [dashboardError, setDashboardError] = useState("");
  const [loadingDashboard, setLoadingDashboard] = useState(false);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [page, setPage] = useState<"videos" | "detail">("videos");
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
  const [videoInput, setVideoInput] = useState("");
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
  const canUpload = !!active && hasScope(auth, UPLOAD_SCOPE);
  const canReadAnalytics = !!active && hasScope(auth, ANALYTICS_SCOPE);
  const canReply = !!active && hasScope(auth, COMMENT_SCOPE);

  const loadDashboard = useCallback(async () => {
    if (!active?.id) {
      setDashboard(null);
      return;
    }
    setLoadingDashboard(true);
    setDashboardError("");
    try {
      const response = await fetch(`/api/youtube/channel/dashboard?accountId=${encodeURIComponent(active.id)}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load recent uploads");
      setDashboard(data as YouTubeChannelDashboard);
    } catch (err) {
      setDashboardError(err instanceof Error ? err.message : "Could not load recent uploads");
    } finally {
      setLoadingDashboard(false);
    }
  }, [active?.id]);

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
    void loadDashboard();
  }, [loadDashboard]);

  useEffect(() => {
    void loadPlaylists();
  }, [loadPlaylists]);

  useEffect(() => {
    if (initialVideoId) {
      setPage("detail");
      void loadAnalytics(initialVideoId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialVideoId, active?.id]);

  useEffect(() => {
    if (page !== "detail" || !analytics?.id || !active?.id || !canReply) return;
    const timer = window.setInterval(() => {
      void loadComments(analytics.id, true);
    }, 15000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, analytics?.id, active?.id, canReply]);

  const selectedFileLabel = useMemo(() => {
    if (!file) return "Choose a video file";
    const mb = file.size / 1024 / 1024;
    return `${file.name} (${mb.toFixed(mb >= 10 ? 0 : 1)} MB)`;
  }, [file]);

  async function loadAnalytics(idOrUrl = videoInput) {
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
      setVideoInput(id);
      setPage("detail");
      await loadComments(id);
    } catch (err) {
      setAnalytics(null);
      setAnalyticsError(err instanceof Error ? err.message : "Could not load post analytics");
    } finally {
      setLoadingAnalytics(false);
    }
  }

  async function loadComments(idOrUrl = videoInput, silent = false) {
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
      await loadComments(comments?.videoId || videoInput);
      window.setTimeout(() => void loadComments(comments?.videoId || videoInput, true), 3000);
      window.setTimeout(() => void loadComments(comments?.videoId || videoInput, true), 10000);
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
      setVideoInput(result.id);
      setUploadModalOpen(false);
      setPage("detail");
      await loadAnalytics(result.id);
      await loadDashboard();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Could not upload video");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-[#FF0033]/10 text-[#FF0033]">
            <BarChart3 className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-widest text-[#FF0033]">Publishing</p>
            <h1 className="font-serif text-2xl font-bold tracking-tight text-[#1A1A1A] md:text-3xl">Post analytics</h1>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="rounded-full border border-[#1A1A1A]/8 bg-white px-3 py-2 text-xs font-bold text-[#1A1A1A]/55 shadow-sm">
            {active?.channelTitle || "No channel connected"}
          </div>
          <button type="button" onClick={() => setUploadModalOpen(true)} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-[#FFDE32] px-4 text-xs font-bold text-[#1A1A1A] shadow-sm transition hover:bg-[#FF0033] hover:text-white">
            <UploadCloud className="h-4 w-4" />
            Upload
          </button>
        </div>
      </header>

      {!active ? (
        <Notice tone="warn" title="Connect YouTube first" body="Use the account circle in the top-right corner to connect a YouTube channel before publishing." />
      ) : !canUpload ? (
        <Notice
          tone="warn"
          title="Reconnect to enable uploads"
          body="This channel was connected before publishing permissions were added. Reconnect Google from the account circle and approve upload/comment access."
          action={<a href="/api/auth/google?mode=connect&next=/publish" className="inline-flex h-9 items-center justify-center rounded-lg bg-[#FFDE32] px-3 text-xs font-bold text-[#1A1A1A] transition hover:bg-[#FF0033] hover:text-white">Reconnect Google</a>}
        />
      ) : null}

      {page === "videos" ? (
        <section className="rounded-xl border border-[#1A1A1A]/8 bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-[#1A1A1A]/8 p-4 md:flex-row md:items-center md:justify-between md:p-5">
            <div>
              <h2 className="text-base font-bold text-[#1A1A1A]">Videos</h2>
              <p className="mt-1 text-xs font-medium text-[#1A1A1A]/45">Your latest channel uploads with key performance fields. Click a row to open analytics and comments.</p>
            </div>
            <button onClick={() => void loadDashboard()} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-[#1A1A1A]/10 bg-[#FDFCFA] px-4 text-xs font-bold text-[#1A1A1A]/60 transition hover:border-[#FF0033]/25 hover:text-[#FF0033]">
              {loadingDashboard ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Refresh
            </button>
          </div>
          {dashboardError ? <p className="m-4 rounded-lg bg-amber-50 px-3 py-2 text-xs font-bold text-amber-900">{dashboardError}</p> : null}
          <VideoTable videos={dashboard?.recentVideos || []} loading={loadingDashboard} onOpen={(videoId) => void loadAnalytics(videoId)} />
        </section>
      ) : (
        <section className="rounded-xl border border-[#1A1A1A]/8 bg-white p-4 shadow-sm md:p-5">
          <button type="button" onClick={() => setPage("videos")} className="mb-4 inline-flex h-9 items-center gap-2 rounded-lg border border-[#1A1A1A]/10 bg-[#FDFCFA] px-3 text-xs font-bold text-[#1A1A1A]/60 transition hover:text-[#FF0033]">
            <ArrowLeft className="h-4 w-4" />
            Videos
          </button>
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-[#1A1A1A]">{analytics?.title || "Video details"}</h2>
              <p className="mt-1 text-xs font-medium text-[#1A1A1A]/45">Analytics and comments refresh automatically while this page is open.</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => void checkUploadedMovie()}
                disabled={!analytics?.url || checkingMovie}
                className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#FFDE32] px-3 text-xs font-bold text-[#1A1A1A] transition hover:bg-[#FF0033] hover:text-white disabled:opacity-45"
              >
                {checkingMovie ? <Loader2 className="h-4 w-4 animate-spin" /> : <Film className="h-4 w-4" />}
                Movie ID
              </button>
              <button onClick={() => analytics?.id && void loadAnalytics(analytics.id)} className="grid h-9 w-9 place-items-center rounded-lg border border-[#1A1A1A]/10 text-[#1A1A1A]/50 transition hover:text-[#FF0033]" aria-label="Refresh analytics">
                {loadingAnalytics ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <div className="flex gap-2">
            <input value={videoInput} onChange={(event) => setVideoInput(event.target.value)} className="h-10 min-w-0 flex-1 rounded-lg border border-[#1A1A1A]/10 bg-[#FDFCFA] px-3 text-sm outline-none transition focus:border-[#FF0033]/45" placeholder="Video ID or YouTube URL" />
            <button type="button" onClick={() => void loadAnalytics()} disabled={!videoInput.trim() || loadingAnalytics} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[#1A1A1A] px-3 text-xs font-bold text-white transition hover:bg-[#FF0033] disabled:opacity-45">
              {loadingAnalytics ? <Loader2 className="h-4 w-4 animate-spin" /> : <BarChart3 className="h-4 w-4" />}
              Check
            </button>
          </div>

          {!canReadAnalytics ? <Notice className="mt-3" tone="warn" title="Analytics permission needed" body="Reconnect Google and approve YouTube Analytics readonly to see owned-channel analytics." /> : null}
          {active && !canReply ? <Notice className="mt-3" tone="warn" title="Comments need permission" body="Reconnect Google and approve YouTube force-ssl to view and reply to comments inside AutoYT." action={<a href="/api/auth/google?mode=connect&next=/publish" className="inline-flex h-9 items-center justify-center rounded-lg bg-[#FFDE32] px-3 text-xs font-bold text-[#1A1A1A] transition hover:bg-[#FF0033] hover:text-white">Reconnect</a>} /> : null}
          {analyticsError ? <Notice className="mt-3" tone="error" title="Analytics failed" body={analyticsError} /> : null}
          {analytics ? <AnalyticsPanel analytics={analytics} /> : null}
          {movieCheckError ? <Notice className="mt-3" tone="error" title="Movie ID failed" body={movieCheckError} /> : null}
          {movieCheck ? <MovieIdentityPanel result={movieCheck} /> : null}
          {analytics ? (
            <CommentsPanel
              comments={comments}
              error={commentsError}
              loading={loadingComments}
              canReply={canReply}
              replyText={replyText}
              replyingTo={replyingTo}
              onReplyTextChange={(id, value) => setReplyText((prev) => ({ ...prev, [id]: value }))}
              onReply={(id) => void replyToComment(id)}
              onRefresh={() => void loadComments(comments?.videoId || analytics.id)}
            />
          ) : null}
        </section>
      )}

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

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-widest text-[#1A1A1A]/40">{label}</span>
      {children}
    </label>
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
    <div className="fixed inset-0 z-[95] flex items-start justify-center overflow-y-auto bg-[#1A1A1A]/35 px-4 py-6 backdrop-blur-sm md:py-10">
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

        <div className="max-h-[calc(100vh-180px)] overflow-y-auto p-5">
          <label className="group grid cursor-pointer place-items-center rounded-xl border border-dashed border-[#FF0033]/35 bg-[#F9F8F6] px-4 py-8 text-center transition hover:bg-[#FF0033]/5">
            <input type="file" accept="video/*" className="sr-only" onChange={(event) => onFileChange(event.target.files?.[0] || null)} />
            <FileVideo className="mb-3 h-8 w-8 text-[#FF0033]" />
            <span className="max-w-full truncate text-sm font-bold text-[#1A1A1A]">{selectedFileLabel}</span>
            <span className="mt-1 text-xs font-medium text-[#1A1A1A]/42">MP4, MOV, WebM, or any YouTube-supported video.</span>
          </label>

          <div className="mt-4 grid gap-3">
            <Field label="Title">
              <input value={title} onChange={(event) => onTitleChange(event.target.value)} maxLength={100} className="h-11 w-full rounded-lg border border-[#1A1A1A]/10 bg-[#FDFCFA] px-3 text-sm font-semibold outline-none transition focus:border-[#FF0033]/45" placeholder="Video title" />
            </Field>
            <Field label="Description">
              <textarea value={description} onChange={(event) => onDescriptionChange(event.target.value)} rows={5} className="w-full resize-none rounded-lg border border-[#1A1A1A]/10 bg-[#FDFCFA] px-3 py-3 text-sm outline-none transition focus:border-[#FF0033]/45" placeholder="Description, links, credits" />
            </Field>
            <Field label="Tags">
              <input value={tags} onChange={(event) => onTagsChange(event.target.value)} className="h-11 w-full rounded-lg border border-[#1A1A1A]/10 bg-[#FDFCFA] px-3 text-sm outline-none transition focus:border-[#FF0033]/45" placeholder="movie recap, sci fi, explained" />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Visibility">
                <select value={privacyStatus} onChange={(event) => onPrivacyStatusChange(event.target.value)} className="h-11 w-full rounded-lg border border-[#1A1A1A]/10 bg-[#FDFCFA] px-3 text-sm font-bold outline-none transition focus:border-[#FF0033]/45">
                  <option value="private">Private</option>
                  <option value="unlisted">Unlisted</option>
                  <option value="public">Public</option>
                </select>
              </Field>
              <label className="flex h-11 items-center gap-2 self-end rounded-lg border border-[#1A1A1A]/10 bg-[#FDFCFA] px-3 text-sm font-bold text-[#1A1A1A]/65">
                <input type="checkbox" checked={madeForKids} onChange={(event) => onMadeForKidsChange(event.target.checked)} className="h-4 w-4 accent-[#FFDE32]" />
                Made for kids
              </label>
            </div>
            <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
              <Field label="Add to playlist">
                <select value={playlistId} onChange={(event) => onPlaylistIdChange(event.target.value)} className="h-11 w-full rounded-lg border border-[#1A1A1A]/10 bg-[#FDFCFA] px-3 text-sm font-bold outline-none transition focus:border-[#FF0033]/45">
                  <option value="">No playlist</option>
                  {playlists.map((playlist) => (
                    <option key={playlist.id} value={playlist.id}>{playlist.title} ({playlist.videoCount || 0})</option>
                  ))}
                </select>
              </Field>
              <button type="button" onClick={onRefreshPlaylists} className="mt-6 inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-[#1A1A1A]/10 bg-white px-3 text-xs font-bold text-[#1A1A1A]/60 transition hover:text-[#FF0033]">
                {loadingPlaylists ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Refresh
              </button>
            </div>
            <Field label="Or create playlist">
              <input value={newPlaylistTitle} onChange={(event) => onNewPlaylistTitleChange(event.target.value)} className="h-11 w-full rounded-lg border border-[#1A1A1A]/10 bg-[#FDFCFA] px-3 text-sm outline-none transition focus:border-[#FF0033]/45" placeholder="New playlist title for this upload" />
            </Field>
          </div>

          {uploadError ? <Notice className="mt-4" tone="error" title="Upload failed" body={uploadError} /> : null}
          {uploadResult ? (
            <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950">
              <div className="flex items-center gap-2 font-bold"><CheckCircle2 className="h-4 w-4" /> Uploaded successfully</div>
              <a href={uploadResult.url} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1.5 text-xs font-bold text-emerald-800 underline">
                Open on YouTube <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
          ) : null}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-[#1A1A1A]/8 bg-[#FDFCFA] px-5 py-4">
          <button type="button" onClick={onClose} className="inline-flex h-10 items-center justify-center rounded-xl border border-[#1A1A1A]/10 bg-white px-4 text-xs font-bold text-[#1A1A1A]/60 transition hover:text-[#1A1A1A]">Cancel</button>
          <button disabled={!canUpload || !file || !title.trim() || uploading} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-[#FFDE32] px-4 text-xs font-bold text-[#1A1A1A] transition hover:bg-[#FF0033] hover:text-white disabled:cursor-not-allowed disabled:opacity-45">
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
            {uploading ? "Uploading" : "Upload"}
          </button>
        </div>
      </form>
    </div>
  );
}

function Notice({ tone, title, body, action, className }: { tone: "warn" | "error"; title: string; body: string; action?: ReactNode; className?: string }) {
  const error = tone === "error";
  return (
    <div className={cn("flex flex-col gap-3 rounded-xl border p-4 text-sm sm:flex-row sm:items-center sm:justify-between", error ? "border-red-100 bg-red-50 text-red-950" : "border-amber-200 bg-amber-50 text-amber-950", className)}>
      <div className="flex gap-3">
        <AlertCircle className={cn("mt-0.5 h-4 w-4 shrink-0", error ? "text-red-600" : "text-amber-700")} />
        <div>
          <p className="font-bold">{title}</p>
          <p className="mt-1 leading-6 opacity-75">{body}</p>
        </div>
      </div>
      {action}
    </div>
  );
}

function AnalyticsPanel({ analytics }: { analytics: YouTubeVideoAnalytics }) {
  const totals = analytics.analytics.totals || {};
  const warning = typeof totals.warning === "string" ? totals.warning : "";
  return (
    <div className="mt-4 overflow-hidden rounded-xl border border-[#1A1A1A]/8 bg-[#F9F8F6]">
      <div className="flex gap-3 border-b border-[#1A1A1A]/8 bg-white p-3">
        <div className="h-16 w-24 overflow-hidden rounded-lg bg-[#1A1A1A]/5">
          {analytics.thumbnailUrl ? <img src={analytics.thumbnailUrl} alt="" className="h-full w-full object-cover" /> : null}
        </div>
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-sm font-bold text-[#1A1A1A]">{analytics.title}</p>
          <a href={analytics.url} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs font-bold text-[#FF0033]">
            Open post <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2 p-3">
        <Stat label="Views" value={compactNumber(totals.views ?? analytics.publicStats.viewCount)} />
        <Stat label="Likes" value={compactNumber(totals.likes ?? analytics.publicStats.likeCount)} />
        <Stat label="Comments" value={compactNumber(totals.comments ?? analytics.publicStats.commentCount)} />
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
        <div className="h-28 w-20 shrink-0 overflow-hidden rounded-lg bg-[#1A1A1A]/5">
          {result.posterUrl ? <img src={result.posterUrl} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" /> : <Film className="m-auto mt-9 h-8 w-8 text-[#FF0033]/35" />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold uppercase tracking-widest text-[#FF0033]">Detected movie</p>
          <h3 className="mt-1 font-serif text-2xl font-bold text-[#1A1A1A]">{result.title || "Unknown title"} {result.year ? <span className="text-[#1A1A1A]/45">({result.year})</span> : null}</h3>
          <p className="mt-2 text-sm leading-6 text-[#1A1A1A]/62">{result.summary || result.tmdb?.overview || result.mal?.synopsis || "Movie ID returned a title match without a summary."}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-[#FF0033]/10 px-2.5 py-1 text-xs font-bold text-[#FF0033]">Confidence {Math.round(Number(result.confidence || 0) * 100)}%</span>
            {result.tmdb?.tmdbUrl ? <a href={result.tmdb.tmdbUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-bold text-[#1A1A1A]/55 transition hover:text-[#FF0033]">TMDB <ExternalLink className="h-3 w-3" /></a> : null}
            {result.mal?.url ? <a href={result.mal.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-bold text-[#1A1A1A]/55 transition hover:text-[#FF0033]">MAL <ExternalLink className="h-3 w-3" /></a> : null}
            {result.imdbUrl ? <a href={result.imdbUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-bold text-[#1A1A1A]/55 transition hover:text-[#FF0033]">IMDb <ExternalLink className="h-3 w-3" /></a> : null}
          </div>
        </div>
      </div>
      <div className="grid gap-2 bg-[#F9F8F6] p-3 md:grid-cols-3">
        <EvidenceBlock label="Audio" value={result.evidence?.audio || "No audio evidence returned."} />
        <EvidenceBlock label="Visual" value={result.evidence?.visual || "No visual evidence returned."} />
        <EvidenceBlock label="Reasoning" value={result.evidence?.reasoning || "No reasoning returned."} />
      </div>
    </div>
  );
}

function EvidenceBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-white px-3 py-3">
      <p className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/35">{label}</p>
      <p className="mt-2 text-xs leading-5 text-[#1A1A1A]/62">{value}</p>
    </div>
  );
}

function CommentsPanel({
  comments,
  error,
  loading,
  canReply,
  replyText,
  replyingTo,
  onReplyTextChange,
  onReply,
  onRefresh,
}: {
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
    <div className="mt-4 overflow-hidden rounded-xl border border-[#1A1A1A]/8 bg-white">
      <div className="flex items-center justify-between border-b border-[#1A1A1A]/8 bg-[#FDFCFA] px-3 py-3">
        <div className="flex items-center gap-2">
          <MessageCircle className="h-4 w-4 text-[#FF0033]" />
          <p className="text-sm font-bold text-[#1A1A1A]">Recent comments</p>
        </div>
        <button type="button" onClick={onRefresh} className="grid h-8 w-8 place-items-center rounded-lg border border-[#1A1A1A]/10 text-[#1A1A1A]/50 transition hover:text-[#FF0033]" aria-label="Refresh comments">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        </button>
      </div>
      {error ? <p className="border-b border-red-100 bg-red-50 px-3 py-2 text-xs font-bold text-red-900">{error}</p> : null}
      <div className="max-h-[520px] space-y-2 overflow-y-auto bg-[#F9F8F6] p-3">
        {loading && !comments ? (
          <p className="rounded-lg bg-white px-3 py-4 text-sm font-semibold text-[#1A1A1A]/45">Loading comments</p>
        ) : comments?.comments?.length ? (
          comments.comments.map((thread) => {
            const parent = thread.topLevelComment;
            return (
              <div key={thread.threadId} className="rounded-xl border border-[#1A1A1A]/8 bg-white p-3">
                <CommentBody comment={parent} />
                {thread.replies.length ? (
                  <div className="mt-3 space-y-2 border-l border-[#1A1A1A]/10 pl-3">
                    {thread.replies.slice(-3).map((reply) => <CommentBody key={reply.id} comment={reply} compact />)}
                  </div>
                ) : null}
                {canReply && thread.canReply ? (
                  <div className="mt-3 flex gap-2">
                    <input
                      value={replyText[parent.id] || ""}
                      onChange={(event) => onReplyTextChange(parent.id, event.target.value)}
                      className="h-10 min-w-0 flex-1 rounded-lg border border-[#1A1A1A]/10 bg-[#FDFCFA] px-3 text-sm outline-none transition focus:border-[#FF0033]/45"
                      placeholder="Reply as your channel"
                    />
                    <button
                      type="button"
                      onClick={() => onReply(parent.id)}
                      disabled={!replyText[parent.id]?.trim() || replyingTo === parent.id}
                      className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[#FFDE32] px-3 text-xs font-bold text-[#1A1A1A] transition hover:bg-[#FF0033] hover:text-white disabled:opacity-45"
                    >
                      {replyingTo === parent.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                      Reply
                    </button>
                  </div>
                ) : (
                  <p className="mt-3 rounded-lg bg-[#F9F8F6] px-3 py-2 text-xs font-semibold text-[#1A1A1A]/45">
                    {canReply ? "Replies are disabled for this thread." : "Reconnect Google to enable replies."}
                  </p>
                )}
              </div>
            );
          })
        ) : (
          <p className="rounded-lg bg-white px-3 py-4 text-sm font-semibold text-[#1A1A1A]/45">No recent comments returned for this video.</p>
        )}
      </div>
    </div>
  );
}

function CommentBody({ comment, compact = false }: { comment: YouTubeCommentsResponse["comments"][number]["topLevelComment"]; compact?: boolean }) {
  return (
    <div className="flex gap-3">
      {comment.authorProfileImageUrl ? (
        <img src={comment.authorProfileImageUrl} alt="" className={cn("rounded-full object-cover", compact ? "h-7 w-7" : "h-9 w-9")} referrerPolicy="no-referrer" />
      ) : (
        <div className={cn("grid rounded-full bg-[#FF0033]/10 text-[#FF0033]", compact ? "h-7 w-7" : "h-9 w-9")}>
          <MessageCircle className="m-auto h-3.5 w-3.5" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate text-xs font-bold text-[#1A1A1A]">{comment.authorDisplayName || "YouTube user"}</p>
          <p className="text-[11px] font-semibold text-[#1A1A1A]/35">{comment.likeCount ? `${compactNumber(comment.likeCount)} likes` : ""}</p>
        </div>
        <p className={cn("mt-1 whitespace-pre-wrap text-sm leading-6 text-[#1A1A1A]/70", compact && "text-xs leading-5")}>{comment.textDisplay}</p>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-white px-3 py-2">
      <p className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/35">{label}</p>
      <p className="mt-1 truncate text-sm font-bold text-[#1A1A1A]">{value}</p>
    </div>
  );
}

function VideoTable({ videos, loading, onOpen }: { videos: YouTubeDashboardVideo[]; loading: boolean; onOpen: (videoId: string) => void }) {
  if (loading && !videos.length) {
    return <p className="m-4 rounded-lg bg-[#F9F8F6] px-3 py-4 text-sm font-semibold text-[#1A1A1A]/45">Loading videos</p>;
  }
  if (!videos.length) {
    return <p className="m-4 rounded-lg bg-[#F9F8F6] px-3 py-4 text-sm font-semibold text-[#1A1A1A]/45">No videos returned yet. Upload a video or refresh after YouTube processes your channel.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[920px] border-collapse text-left">
        <thead className="bg-[#F9F8F6] text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40">
          <tr>
            <th className="px-4 py-3">Video</th>
            <th className="px-3 py-3">Visibility</th>
            <th className="px-3 py-3">Status</th>
            <th className="px-3 py-3">Date</th>
            <th className="px-3 py-3 text-right">Views</th>
            <th className="px-3 py-3 text-right">Comments</th>
            <th className="px-3 py-3 text-right">Likes</th>
            <th className="px-4 py-3 text-right">Duration</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#1A1A1A]/8">
          {videos.map((video) => (
            <tr key={video.id} onClick={() => onOpen(video.id)} className="cursor-pointer bg-white transition hover:bg-[#FFDE32]/10">
              <td className="px-4 py-3">
                <div className="grid grid-cols-[112px_minmax(0,1fr)] items-center gap-3">
                  <div className="relative aspect-video overflow-hidden rounded-lg bg-[#1A1A1A]/5">
                    {video.thumbnailUrl ? <img src={video.thumbnailUrl} alt="" className="h-full w-full object-cover" /> : null}
                    <span className="absolute bottom-1 right-1 rounded bg-[#1A1A1A]/85 px-1.5 py-0.5 text-[10px] font-bold text-white">{formatDuration(video.durationSeconds)}</span>
                  </div>
                  <div className="min-w-0">
                    <p className="line-clamp-2 text-sm font-bold leading-snug text-[#1A1A1A]">{video.title}</p>
                    <p className="mt-1 truncate text-xs font-medium text-[#1A1A1A]/40">{video.id}</p>
                  </div>
                </div>
              </td>
              <td className="px-3 py-3">
                <span className="rounded-full border border-[#1A1A1A]/10 bg-[#FDFCFA] px-2 py-1 text-xs font-bold text-[#1A1A1A]/62">{statusLabel(video.privacyStatus)}</span>
              </td>
              <td className="px-3 py-3 text-xs font-bold text-[#1A1A1A]/55">{statusLabel(video.uploadStatus)}</td>
              <td className="px-3 py-3 text-xs font-semibold text-[#1A1A1A]/50">{formatDate(video.publishedAt)}</td>
              <td className="px-3 py-3 text-right text-sm font-bold text-[#1A1A1A]">{compactNumber(video.viewCount)}</td>
              <td className="px-3 py-3 text-right text-sm font-bold text-[#1A1A1A]">{compactNumber(video.commentCount)}</td>
              <td className="px-3 py-3 text-right text-sm font-bold text-[#1A1A1A]">{compactNumber(video.likeCount)}</td>
              <td className="px-4 py-3 text-right text-xs font-semibold text-[#1A1A1A]/50">{formatDuration(video.durationSeconds)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
