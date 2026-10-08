import { Loader2, MessageCircle, PlaySquare, RefreshCw, Search, Send, UploadCloud } from "lucide-react";
import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AuthSessionPayload, ChannelStyleProfile, ConnectedYouTubeAccount, CreatorProject, MovieResult, YouTubeChannelDashboard, YouTubeCommentsResponse, YouTubeDashboardVideo, YouTubePlaylistSummary, YouTubeUploadResult, YouTubeVideoAnalytics, YouTubeVideoOptimization } from "../types";
import { cn } from "../lib/utils";
import { toast, useErrorToast } from "../utils/toast";
import { shouldPrefetchChannelVideoPage } from "../utils/channelVideoPaging.js";
import { writeDeepLink } from "../utils/tiktokRoute";
import { confirm } from "./ui/Dialog";
import { EmptyState, Notice as SharedNotice, Segmented } from "./ui/controls";
import { connectHref, PlatformIcon } from "./SocialPlatforms";
import "./uiInherit.css";
import { GOOGLE_READ_CONNECT_URL, InlineStatus, Notice, type YouTubeMonetizationResponse, compactNumber, dateAge, formatDuration, sharpYouTubeThumbnail, uniqueTags } from "./channel/shared";
import { FeedDashboard } from "./channel/FeedDashboard";
import { UploadModal } from "./channel/UploadModal";
import { PostDetailPage } from "./channel/PostDetailPage";
import { ReplyAgentResults } from "./channel/ReplyAgentResults";


const COMMENT_SCOPE = "https://www.googleapis.com/auth/youtube.force-ssl";
const UPLOAD_SCOPE = "https://www.googleapis.com/auth/youtube.upload";
const ANALYTICS_SCOPE = "https://www.googleapis.com/auth/yt-analytics.readonly";
const MONETARY_ANALYTICS_SCOPE = "https://www.googleapis.com/auth/yt-analytics-monetary.readonly";

function hasScope(account: ConnectedYouTubeAccount | null | undefined, scope: string): boolean {
  if (account?.platform === "tiktok") return true;
  if (account?.zernioConnected && scope === "https://www.googleapis.com/auth/youtube.force-ssl") return true;
  return String(account?.scope || "").split(/\s+/).includes(scope);
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
  initialVideoId,
  theme = "light",
  onDetailChange,
}: {
  auth: AuthSessionPayload;
  onAuthRefresh: () => Promise<void>;
  onOpenVideo?: (videoId: string) => void;
  initialTab?: "feed" | "optimize";
  initialVideoId?: string;
  theme?: "light" | "dark";
  onDetailChange?: (open: boolean) => void;
}) {
  const [dashboard, setDashboard] = useState<YouTubeChannelDashboard | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [monetization, setMonetization] = useState<YouTubeMonetizationResponse | null>(null);
  const [monetizationLoading, setMonetizationLoading] = useState(false);
  const [monetizationError, setMonetizationError] = useState("");
  const monetizationRequestRef = useRef(0);
  const [agentRunning, setAgentRunning] = useState(false);
  const [agentError, setAgentError] = useState("");
  const [agentResult, setAgentResult] = useState<any>(null);
  const [dryRun, setDryRun] = useState(true);
  const [identifyMovies, setIdentifyMovies] = useState(true);
  const [maxVideos, setMaxVideos] = useState(12);
  const [maxReplies, setMaxReplies] = useState(8);
  const [sort, setSort] = useState("recent");
  // Review mode: each draft's edited text, whether it is selected, and how posting went.
  const [drafts, setDrafts] = useState<Record<string, { text: string; include: boolean; status?: "posting" | "posted" | "failed"; error?: string }>>({});
  const [posting, setPosting] = useState(false);
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
  const [postAsShort, setPostAsShort] = useState(true);
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
  const [optimization, setOptimization] = useState<YouTubeVideoOptimization | null>(null);
  const [optimizationError, setOptimizationError] = useState("");
  const [loadingOptimization, setLoadingOptimization] = useState(false);
  const [styles, setStyles] = useState<ChannelStyleProfile[]>([]);
  const [projects, setProjects] = useState<CreatorProject[]>([]);
  const [activeProject, setActiveProject] = useState<CreatorProject | null>(null);
  const [projectBusy, setProjectBusy] = useState(false);
  const [projectNotice, setProjectNotice] = useState("");

  const active = auth.activeAccount;
  const isTikTok = active?.platform === "tiktok";
  const canReply = hasScope(active, COMMENT_SCOPE);
  const canUpload = hasScope(active, UPLOAD_SCOPE);
  const canReadAnalytics = hasScope(active, ANALYTICS_SCOPE);
  const canReadRevenue = hasScope(active, MONETARY_ANALYTICS_SCOPE);
  const canManageYouTube = !isTikTok && active?.googleConnected === true && hasScope(active, COMMENT_SCOPE);
  const isFeed = initialTab === "feed";
  const isDark = theme === "dark";

  const [metadataBusy, setMetadataBusy] = useState("");
  const [metadataNotice, setMetadataNotice] = useState("");
  const [styleBusy, setStyleBusy] = useState("");
  const [comments, setComments] = useState<YouTubeCommentsResponse | null>(null);
  const [commentsError, setCommentsError] = useState("");
  const [loadingComments, setLoadingComments] = useState(false);
  const [replyText, setReplyText] = useState<Record<string, string>>({});
  const [replyingTo, setReplyingTo] = useState("");
  const [newCommentText, setNewCommentText] = useState("");
  const [commentActionBusy, setCommentActionBusy] = useState("");
  const [platformActionBusy, setPlatformActionBusy] = useState("");
  const [platformActionNotice, setPlatformActionNotice] = useState("");
  const [movieCheck, setMovieCheck] = useState<MovieResult | null>(null);
  const [movieCheckError, setMovieCheckError] = useState("");
  const deepLinkPageRequests = useRef(new Set<string>());
  // `error` also gates the empty state and video prefetching, so it is not cleared here.
  useErrorToast(dashboard ? error : "");
  useErrorToast(agentError, () => setAgentError(""), { title: "Reply agent failed" });
  useErrorToast(uploadError, () => setUploadError(""), { title: "Upload failed" });
  useErrorToast(analyticsError, () => setAnalyticsError(""), { title: "Analytics failed" });
  useErrorToast(optimizationError, () => setOptimizationError(""), { title: "Optimization failed" });
  useErrorToast(commentsError, () => setCommentsError(""));
  useErrorToast(movieCheckError, () => setMovieCheckError(""), { title: "Movie ID failed" });
  const [checkingMovie, setCheckingMovie] = useState(false);

  useEffect(() => {
    onDetailChange?.(Boolean(selectedVideo));
    return () => onDetailChange?.(false);
  }, [onDetailChange, selectedVideo]);

  useEffect(() => {
    if (active?.platform === "tiktok" && workspaceTab === "videos") {
      setWorkspaceTab("shorts");
    }
  }, [active?.id, active?.platform, workspaceTab]);
  const recentVideos = useMemo(() => dashboard?.recentVideos || [], [dashboard?.recentVideos]);
  const longVideos = useMemo(() => recentVideos.filter((video) => (video.durationSeconds || 0) > 180), [recentVideos]);
  const shorts = useMemo(() => recentVideos.filter((video) => (video.durationSeconds || 0) <= 180), [recentVideos]);
  const visibleVideos = workspaceTab === "videos" ? longVideos : shorts;
  const selectedDetailTabs = useMemo(() => isTikTok
    ? ["Overview", "Title", "SEO", "Script/Hook", "Visual Plan", "Publishing Plan", "Performance", "Comments"]
    : ["Overview", "Title", "SEO", "Script/Hook", "Visual Plan", "Thumbnail", "Captions", "Publishing Plan", "Performance", "Comments"], [isTikTok]);
  const selectedFileLabel = useMemo(() => {
    if (!file) return "Choose a video file";
    const mb = file.size / 1024 / 1024;
    return `${file.name} (${mb.toFixed(mb >= 10 ? 0 : 1)} MB)`;
  }, [file]);

  const dashboardVideoKind = workspaceTab === "videos" ? "videos" : "shorts";

  const loadDashboard = useCallback(async () => {
    if (!active?.id) {
      setDashboard(null);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/youtube/channel/dashboard?accountId=${encodeURIComponent(active.id)}&videoKind=${dashboardVideoKind}&pageSize=24&insights=${isFeed ? "1" : "0"}`);
      const data = await response.json();
      if (!response.ok) throw new Error((data as { error?: string }).error || "Could not load YouTube analytics");
      setDashboard(data as YouTubeChannelDashboard);
      setNextPageToken((data as YouTubeChannelDashboard).nextPageToken || "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load YouTube analytics");
    } finally {
      setLoading(false);
    }
  }, [active?.id, dashboardVideoKind, isFeed]);

  const loadMonetization = useCallback(async () => {
    const requestId = ++monetizationRequestRef.current;
    if (!isFeed || !active?.id || active.platform === "tiktok") {
      setMonetization(null);
      setMonetizationError("");
      setMonetizationLoading(false);
      return;
    }
    setMonetizationLoading(true);
    setMonetizationError("");
    try {
      const response = await fetch(`/api/youtube/monetization?accountId=${encodeURIComponent(active.id)}&days=28&currency=USD`);
      const data = (await response.json()) as YouTubeMonetizationResponse;
      const state = data.state || data.status;
      if (!response.ok && !state) throw new Error(data.error || data.message || "Could not load monetization analytics");
      if (requestId !== monetizationRequestRef.current) return;
      setMonetization({ ...data, state });
    } catch (err) {
      if (requestId !== monetizationRequestRef.current) return;
      setMonetization(null);
      setMonetizationError(err instanceof Error ? err.message : "Could not load monetization analytics");
    } finally {
      if (requestId === monetizationRequestRef.current) setMonetizationLoading(false);
    }
  }, [active?.id, active?.platform, isFeed]);

  const loadMoreVideos = useCallback(async () => {
    if (!active?.id || !nextPageToken || loadingMore) return;
    setLoadingMore(true);
    try {
      const response = await fetch(`/api/youtube/channel/dashboard?accountId=${encodeURIComponent(active.id)}&videoKind=${dashboardVideoKind}&pageSize=24&insights=${isFeed ? "1" : "0"}&pageToken=${encodeURIComponent(nextPageToken)}`);
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
  }, [active?.id, dashboardVideoKind, isFeed, loadingMore, nextPageToken]);

  useEffect(() => {
    if (!initialVideoId || selectedVideo?.id === initialVideoId || !dashboard || loading || loadingMore || error) return;
    if (dashboard.recentVideos.some((video) => video.id === initialVideoId)) {
      const video = dashboard.recentVideos.find((item) => item.id === initialVideoId);
      if (video) openVideoPage(video);
      return;
    }
    if (nextPageToken) {
      const requestKey = `${active?.id || ""}:${dashboardVideoKind}:${nextPageToken}`;
      if (deepLinkPageRequests.current.has(requestKey)) return;
      deepLinkPageRequests.current.add(requestKey);
      void loadMoreVideos();
      return;
    }
    writeDeepLink({ view: isFeed ? "feed" : "channels" }, true);
  }, [active?.id, dashboard, dashboardVideoKind, error, initialVideoId, isFeed, loadMoreVideos, loading, loadingMore, nextPageToken, selectedVideo?.id]);

  useEffect(() => {
    if (workspaceTab !== "comments") void loadDashboard();
  }, [loadDashboard, workspaceTab]);

  useEffect(() => {
    void loadMonetization();
  }, [loadMonetization]);

  useEffect(() => {
    const node = loadMoreRef.current;
    if (!node || !nextPageToken || workspaceTab === "comments" || selectedVideo) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void loadMoreVideos();
    }, { rootMargin: "800px 0px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [loadMoreVideos, nextPageToken, selectedVideo, workspaceTab]);

  useEffect(() => {
    if (!shouldPrefetchChannelVideoPage({
      workspaceTab,
      longVideoCount: longVideos.length,
      nextPageToken,
      loadingMore,
      error,
    }) || selectedVideo) return;
    void loadMoreVideos();
  }, [error, loadMoreVideos, loadingMore, longVideos.length, nextPageToken, selectedVideo, workspaceTab]);

  const loadPlaylists = useCallback(async () => {
    if (!active?.id || active.platform === "tiktok") {
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

  const loadStyles = useCallback(async () => {
    if (!active?.id) {
      setStyles([]);
      return;
    }
    try {
      const response = await fetch(`/api/channel-styles?accountId=${encodeURIComponent(active.id)}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not load copied styles");
      setStyles(Array.isArray(data.styles) ? data.styles : []);
    } catch {
      setStyles([]);
    }
  }, [active?.id]);

  useEffect(() => {
    void loadStyles();
  }, [loadStyles]);

  async function loadComments(idOrUrl: string, silent = false) {
    const id = videoIdFromUrl(idOrUrl);
    if (!id || !active?.id) return;
    if (!silent) setLoadingComments(true);
    setCommentsError("");
    try {
      const response = await fetch(`/api/youtube/videos/${encodeURIComponent(id)}/comments?accountId=${encodeURIComponent(active.id)}&maxResults=50&maxReplies=250`);
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

  async function loadOptimization(idOrUrl: string) {
    const id = videoIdFromUrl(idOrUrl);
    if (!id || !active?.id) return;
    setLoadingOptimization(true);
    setOptimizationError("");
    try {
      const response = await fetch(`/api/youtube/videos/${encodeURIComponent(id)}/optimization?accountId=${encodeURIComponent(active.id)}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load optimization suggestions");
      setOptimization(data.optimization as YouTubeVideoOptimization);
    } catch (err) {
      setOptimization(null);
      setOptimizationError(err instanceof Error ? err.message : "Could not load optimization suggestions");
    } finally {
      setLoadingOptimization(false);
    }
  }

  async function publishVideoMetadata(video: YouTubeDashboardVideo, input: { title?: string; description?: string; tags?: string[]; appendTags?: boolean }, label = "Metadata") {
    const id = videoIdFromUrl(video.id || video.url);
    if (!id || !active?.id) return false;
    const busyKey = `${id}:${label}`;
    setMetadataBusy(busyKey);
    setMetadataNotice("");
    try {
      const response = await fetch(`/api/youtube/videos/${encodeURIComponent(id)}/metadata?accountId=${encodeURIComponent(active.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...input,
          tags: input.tags ? uniqueTags(input.tags) : undefined,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not publish video metadata");
      const snippet = data.video?.snippet || {};
      const nextTitle = snippet.title || input.title || video.title;
      const nextDescription = snippet.description ?? input.description ?? video.description ?? "";
      const nextTags = Array.isArray(snippet.tags) ? snippet.tags : input.tags ? uniqueTags(input.tags) : video.tags || [];
      const patchVideo = (item: YouTubeDashboardVideo): YouTubeDashboardVideo => item.id === id ? { ...item, title: nextTitle, description: nextDescription, tags: nextTags } : item;
      setDashboard((current) => current ? { ...current, recentVideos: current.recentVideos.map(patchVideo) } : current);
      setSelectedVideo((current) => current && current.id === id ? patchVideo(current) : current);
      setOptimization((current) => current ? {
        ...current,
        current: {
          title: nextTitle,
          description: nextDescription,
          tags: nextTags,
        },
      } : current);
      setMetadataNotice(`${label} published to YouTube.`);
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not publish video metadata", { title: "YouTube metadata" });
      return false;
    } finally {
      setMetadataBusy("");
    }
  }

  async function loadProjectsForVideo(video: YouTubeDashboardVideo) {
    if (!active?.id || !video.id) return;
    try {
      const response = await fetch(`/api/creator-projects?accountId=${encodeURIComponent(active.id)}&sourceType=channel_video&sourceId=${encodeURIComponent(video.id)}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not load creator projects");
      const nextProjects = Array.isArray(data.projects) ? data.projects as CreatorProject[] : [];
      setProjects(nextProjects);
      setActiveProject(nextProjects[0] || null);
    } catch {
      setProjects([]);
      setActiveProject(null);
    }
  }

  async function createProjectForVideo(video: YouTubeDashboardVideo, opt: YouTubeVideoOptimization | null = optimization) {
    if (!active?.id || !video.id) return null;
    setProjectBusy(true);
    setProjectNotice("");
    try {
      const response = await fetch("/api/creator-projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId: active.id,
          sourceType: "channel_video",
          sourceId: video.id,
          title: video.title,
          video,
          optimization: opt,
          createdFrom: "channel-management",
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not create creator project");
      const project = data.project as CreatorProject;
      setActiveProject(project);
      setProjects((current) => [project, ...current.filter((item) => item.id !== project.id)]);
      setProjectNotice("Creator project saved.");
      return project;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save creator project");
      return null;
    } finally {
      setProjectBusy(false);
    }
  }

  async function generateProjectStage(stage: string) {
    if (!activeProject?.id) return;
    setProjectBusy(true);
    setProjectNotice("");
    try {
      const response = await fetch(`/api/creator-projects/${encodeURIComponent(activeProject.id)}/generate/${encodeURIComponent(stage)}`, { method: "POST" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not generate this project stage");
      const project = data.project as CreatorProject;
      setActiveProject(project);
      setProjects((current) => current.map((item) => item.id === project.id ? project : item));
      setProjectNotice(`${stage.replace(/([A-Z])/g, " $1").trim()} updated.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not generate this project stage");
    } finally {
      setProjectBusy(false);
    }
  }

  async function archiveActiveProject() {
    if (!activeProject?.id) return;
    setProjectBusy(true);
    try {
      const response = await fetch(`/api/creator-projects/${encodeURIComponent(activeProject.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "archived" }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not archive project");
      const project = data.project as CreatorProject;
      setActiveProject(project);
      setProjects((current) => current.map((item) => item.id === project.id ? project : item));
      setProjectNotice("Project archived.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not archive project");
    } finally {
      setProjectBusy(false);
    }
  }

  async function copyStyleFromCompetitor(competitor: any) {
    if (!active?.id || !competitor) return;
    const key = competitor.channelId || competitor.url || competitor.title || "style";
    setStyleBusy(key);
    try {
      const response = await fetch("/api/channel-styles/copy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId: active.id,
          sourceChannelId: competitor.channelId,
          sourceUrl: competitor.url,
          handle: competitor.handle,
          title: competitor.title,
          niche: competitor.niche,
          subNiche: competitor.subNiche,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not copy style");
      setStyles((current) => [data.style as ChannelStyleProfile, ...current.filter((item) => item.id !== data.style.id)]);
      setProjectNotice(`Copied style: ${data.style.name}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not copy style");
    } finally {
      setStyleBusy("");
    }
  }

  function openVideoPage(video: YouTubeDashboardVideo) {
    setSelectedVideo(video);
    setDetailTab("Overview");
    setProjectNotice("");
    setActiveProject(null);
    writeDeepLink({ view: isFeed ? "feed" : "channels", channelVideoId: video.id });
    void loadAnalytics(video.id);
    void loadOptimization(video.id);
    void loadProjectsForVideo(video);
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
      const replyVideoId = comments?.videoId || selectedVideo?.id || "";
      const response = await fetch(`/api/youtube/comments/${encodeURIComponent(parentId)}/reply?accountId=${encodeURIComponent(active.id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, videoId: replyVideoId }),
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

  async function postTopLevelComment() {
    if (!active?.id || !selectedVideo?.id || !newCommentText.trim()) return;
    setCommentActionBusy("post");
    setCommentsError("");
    try {
      const response = await fetch(`/api/youtube/videos/${encodeURIComponent(selectedVideo.id)}/comments?accountId=${encodeURIComponent(active.id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: newCommentText.trim() }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not post YouTube comment");
      setNewCommentText("");
      await loadComments(selectedVideo.id);
    } catch (err) {
      setCommentsError(err instanceof Error ? err.message : "Could not post YouTube comment");
    } finally {
      setCommentActionBusy("");
    }
  }

  async function updateComment(commentId: string, text: string) {
    if (!active?.id || !selectedVideo?.id || !text.trim()) return;
    setCommentActionBusy(`edit:${commentId}`);
    setCommentsError("");
    try {
      const response = await fetch(`/api/youtube/comments/${encodeURIComponent(commentId)}?accountId=${encodeURIComponent(active.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text.trim() }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not update YouTube comment");
      await loadComments(selectedVideo.id);
    } catch (err) {
      setCommentsError(err instanceof Error ? err.message : "Could not update YouTube comment");
    } finally {
      setCommentActionBusy("");
    }
  }

  async function deleteComment(commentId: string) {
    if (!active?.id || !selectedVideo?.id) return;
    if (!(await confirm({ title: "Delete this comment?", body: "It is deleted from YouTube permanently.", confirmLabel: "Delete comment", danger: true }))) return;
    setCommentActionBusy(`delete:${commentId}`);
    setCommentsError("");
    try {
      const response = await fetch(`/api/youtube/comments/${encodeURIComponent(commentId)}?accountId=${encodeURIComponent(active.id)}`, { method: "DELETE" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not delete YouTube comment");
      await loadComments(selectedVideo.id);
    } catch (err) {
      setCommentsError(err instanceof Error ? err.message : "Could not delete YouTube comment");
    } finally {
      setCommentActionBusy("");
    }
  }

  async function moderateComment(commentId: string, moderationStatus: "heldForReview" | "published" | "rejected") {
    if (!active?.id || !selectedVideo?.id) return;
    const action = moderationStatus === "heldForReview" ? "hold" : moderationStatus === "rejected" ? "remove" : "publish";
    if (moderationStatus === "rejected" && !(await confirm({ title: "Remove this comment from YouTube?", body: "Viewers will no longer see it.", confirmLabel: "Remove comment", danger: true }))) return;
    setCommentActionBusy(`${action}:${commentId}`);
    setCommentsError("");
    try {
      const response = await fetch(`/api/youtube/comments/${encodeURIComponent(commentId)}/moderation?accountId=${encodeURIComponent(active.id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ moderationStatus }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not moderate YouTube comment");
      await loadComments(selectedVideo.id);
    } catch (err) {
      setCommentsError(err instanceof Error ? err.message : "Could not moderate YouTube comment");
    } finally {
      setCommentActionBusy("");
    }
  }

  async function uploadCustomThumbnail(video: YouTubeDashboardVideo, image: File) {
    if (!active?.id || !video.id) return;
    setPlatformActionBusy("thumbnail");
    setPlatformActionNotice("");
    try {
      const response = await fetch(`/api/youtube/videos/${encodeURIComponent(video.id)}/thumbnail?accountId=${encodeURIComponent(active.id)}`, {
        method: "POST",
        headers: { "Content-Type": image.type || "application/octet-stream" },
        body: image,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not set custom thumbnail");
      const thumbnailUrl = String(data.thumbnail?.url || video.thumbnailUrl || "");
      const patchVideo = (item: YouTubeDashboardVideo): YouTubeDashboardVideo => item.id === video.id ? { ...item, thumbnailUrl } : item;
      setDashboard((current) => current ? { ...current, recentVideos: current.recentVideos.map(patchVideo) } : current);
      setSelectedVideo((current) => current && current.id === video.id ? patchVideo(current) : current);
      setPlatformActionNotice("Custom thumbnail published to YouTube.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not set custom thumbnail", { title: "YouTube update" });
    } finally {
      setPlatformActionBusy("");
    }
  }

  async function deleteLiveVideo(video: YouTubeDashboardVideo) {
    if (!active?.id || !video.id) return;
    if (!(await confirm({ title: `Delete "${video.title}"?`, body: "The video is deleted from YouTube permanently. This can't be undone.", confirmLabel: "Delete video", danger: true }))) return;
    setPlatformActionBusy("delete-video");
    setPlatformActionNotice("");
    try {
      const response = await fetch(`/api/youtube/videos/${encodeURIComponent(video.id)}?accountId=${encodeURIComponent(active.id)}`, { method: "DELETE" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not delete YouTube video");
      setDashboard((current) => current ? { ...current, recentVideos: current.recentVideos.filter((item) => item.id !== video.id) } : current);
      setSelectedVideo(null);
      setAnalytics(null);
      setComments(null);
      setPlatformActionNotice("Video deleted from YouTube and removed from AutoYT.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete YouTube video", { title: "YouTube update" });
    } finally {
      setPlatformActionBusy("");
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
        postAsShort: String(postAsShort),
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
      setDrafts(Object.fromEntries((data.replied || []).map((item: any) => [item.commentId, { text: item.replyText, include: true, status: item.dryRun ? undefined : "posted" }])));
      if (!dryRun) {
        void loadDashboard();
        if (data.replied?.length) toast.success(`Posted ${data.replied.length} ${data.replied.length === 1 ? "reply" : "replies"}`);
      }
    } catch (err) {
      setAgentError(err instanceof Error ? err.message : "Comment reply agent failed");
    } finally {
      setAgentRunning(false);
    }
  }

  async function postDrafts() {
    if (!active?.id || !agentResult) return;
    const chosen = (agentResult.replied || []).filter((item: any) => drafts[item.commentId]?.include && drafts[item.commentId]?.status !== "posted" && drafts[item.commentId]?.text.trim());
    if (!chosen.length) return;
    setPosting(true);
    setDrafts((current) => ({ ...current, ...Object.fromEntries(chosen.map((item: any) => [item.commentId, { ...current[item.commentId], status: "posting" as const, error: "" }])) }));
    try {
      const response = await fetch(`/api/youtube/channel/comment-agent/post?accountId=${encodeURIComponent(active.id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: chosen.map((item: any) => ({ ...item, replyText: drafts[item.commentId].text.trim() })) }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Posting replies failed");
      const byId = new Map((data.results || []).map((result: any) => [result.commentId, result]));
      setDrafts((current) => ({
        ...current,
        ...Object.fromEntries(chosen.map((item: any) => {
          const result: any = byId.get(item.commentId);
          return [item.commentId, { ...current[item.commentId], status: result?.ok ? ("posted" as const) : ("failed" as const), error: result?.ok ? "" : result?.error || "Reply failed" }];
        })),
      }));
      const ok = (data.results || []).filter((result: any) => result.ok).length;
      const failed = (data.results || []).length - ok;
      if (ok) toast.success(`Posted ${ok} ${ok === 1 ? "reply" : "replies"}`);
      if (failed) toast.error(`${failed} ${failed === 1 ? "reply" : "replies"} could not be posted`, { title: "Comment agent" });
      void loadDashboard();
    } catch (err) {
      setDrafts((current) => ({ ...current, ...Object.fromEntries(chosen.map((item: any) => [item.commentId, { ...current[item.commentId], status: undefined }])) }));
      toast.error(err instanceof Error ? err.message : "Posting replies failed", { title: "Comment agent" });
    } finally {
      setPosting(false);
    }
  }

  if (isFeed) {
    return (
      <div className={cn("min-w-0 space-y-6 overflow-x-clip", isDark && "-m-4 p-4 text-white sm:-m-5 sm:p-5 md:-m-8 md:p-8 lg:-m-10 lg:p-10 xl:-m-14 xl:p-14")}>
        {loading ? <InlineStatus message="Loading feed" /> : null}
        {error && !dashboard ? <InlineError message={error} /> : null}
        {dashboard ? (
          <FeedDashboard
            dashboard={dashboard}
            monetization={monetization}
            monetizationLoading={monetizationLoading}
            monetizationError={monetizationError}
            onRetryMonetization={() => void loadMonetization()}
            onReauthorizeMonetization={(reauthorizeUrl) => {
              const fallbackUrl = `/api/auth/google?mode=connect&provider=google&reauthorize=monetization&accountId=${encodeURIComponent(active?.id || "")}&next=/feed`;
              window.location.assign(reauthorizeUrl || fallbackUrl);
            }}
            onOpenVideo={openVideoPage}
            onCopyStyle={copyStyleFromCompetitor}
            onPublishTags={(video, tags) => void publishVideoMetadata(video, { tags, appendTags: true }, "Tags")}
            styleBusy={styleBusy}
            metadataBusy={metadataBusy}
            metadataNotice={metadataNotice}
            isDark={isDark}
          />
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
            postAsShort={postAsShort}
            madeForKids={madeForKids}
            playlists={playlists}
            playlistId={playlistId}
            newPlaylistTitle={newPlaylistTitle}
            loadingPlaylists={loadingPlaylists}
            uploading={uploading}
            uploadResult={uploadResult}
            onClose={() => setUploadModalOpen(false)}
            onFileChange={setFile}
            onTitleChange={setTitle}
            onDescriptionChange={setDescription}
            onTagsChange={setTags}
            onPrivacyStatusChange={setPrivacyStatus}
            onPostAsShortChange={setPostAsShort}
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
    <div className={cn("min-w-0 overflow-x-clip", selectedVideo ? "h-full min-h-0" : "space-y-5", isDark && !selectedVideo && "-m-4 p-4 text-white sm:-m-5 sm:p-5 md:-m-8 md:p-8 lg:-m-10 lg:p-10 xl:-m-14 xl:p-14")}>
      {loading ? <InlineStatus message="Loading channel analytics" /> : null}
      {error && !dashboard ? <InlineError message={error} /> : null}

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
            writeDeepLink({ view: isFeed ? "feed" : "channels" });
          }}
          onRefresh={() => void loadAnalytics(selectedVideo.id)}
          onUpload={() => setUploadModalOpen(true)}
          loadingAnalytics={loadingAnalytics}
          analytics={analytics}
          optimization={optimization}
          loadingOptimization={loadingOptimization}
          canReadAnalytics={canReadAnalytics}
          canReadRevenue={canReadRevenue}
          canReply={canReply}
          canManageYouTube={canManageYouTube}
          accountId={active?.id || ""}
          channelId={active?.channelId || ""}
          comments={comments}
          loadingComments={loadingComments}
          replyText={replyText}
          replyingTo={replyingTo}
          onReplyTextChange={(id, value) => setReplyText((prev) => ({ ...prev, [id]: value }))}
          onReply={(id) => void replyToComment(id)}
          onRefreshComments={() => void loadComments(comments?.videoId || selectedVideo.id)}
          newCommentText={newCommentText}
          commentActionBusy={commentActionBusy}
          onNewCommentTextChange={setNewCommentText}
          onPostComment={() => void postTopLevelComment()}
          onUpdateComment={(id, text) => void updateComment(id, text)}
          onDeleteComment={(id) => void deleteComment(id)}
          onModerateComment={(id, status) => void moderateComment(id, status)}
          onUploadThumbnail={(file) => void uploadCustomThumbnail(selectedVideo, file)}
          onDeleteVideo={() => void deleteLiveVideo(selectedVideo)}
          platformActionBusy={platformActionBusy}
          platformActionNotice={platformActionNotice}
          movieCheck={movieCheck}
          checkingMovie={checkingMovie}
          onCheckMovie={() => void checkUploadedMovie()}
          projects={projects}
          activeProject={activeProject}
          styles={styles}
          projectBusy={projectBusy}
          projectNotice={projectNotice}
          metadataBusy={metadataBusy}
          metadataNotice={metadataNotice}
          onCreateProject={() => selectedVideo ? void createProjectForVideo(selectedVideo) : undefined}
          onGenerateProjectStage={(stage) => void generateProjectStage(stage)}
          onArchiveProject={() => void archiveActiveProject()}
          onSelectProject={setActiveProject}
          onPublishMetadata={(input, label) => void publishVideoMetadata(selectedVideo, input, label)}
          isDark={isDark}
          isTikTok={isTikTok}
        />
      ) : dashboard ? (
        <section className="space-y-5">
          {!isTikTok && !canReadAnalytics && active?.zernioConnected ? (
            <Notice
              tone="warn"
              title="YouTube comments and analytics need Google"
              body="Existing videos and titles already work. Connect Google read access only if you want YouTube comments, analytics, and private videos in AutoYT."
              action={<a href={GOOGLE_READ_CONNECT_URL} className="ui-btn is-primary is-sm">Connect Google (optional)</a>}
            />
          ) : null}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex max-w-full gap-6 overflow-x-auto overscroll-x-contain [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {!isTikTok && (
                <button type="button" onClick={() => setWorkspaceTab("videos")} className={cn("border-b-2 pb-2 text-sm font-black", workspaceTab === "videos" ? "border-[var(--ui-accent)]" : "border-transparent", workspaceTab === "videos" ? isDark ? "text-white" : "text-[var(--ui-text)]" : isDark ? "text-white/40" : "text-[var(--ui-text)]/40")}>Videos</button>
              )}
              <button type="button" onClick={() => setWorkspaceTab("shorts")} className={cn("border-b-2 pb-2 text-sm font-black", workspaceTab === "shorts" ? "border-[var(--ui-accent)]" : "border-transparent", workspaceTab === "shorts" ? isDark ? "text-white" : "text-[var(--ui-text)]" : isDark ? "text-white/40" : "text-[var(--ui-text)]/40")}>
                {isTikTok ? "TikTok Videos" : "Shorts"}
              </button>
              <button type="button" onClick={() => setWorkspaceTab("comments")} className={cn("border-b-2 pb-2 text-sm font-black", workspaceTab === "comments" ? "border-[var(--ui-accent)]" : "border-transparent", workspaceTab === "comments" ? isDark ? "text-white" : "text-[var(--ui-text)]" : isDark ? "text-white/40" : "text-[var(--ui-text)]/40")}>
                {isTikTok ? "Comments" : "Comment Agent"}
              </button>
            </div>
            <div className="flex items-center gap-2">
              <p className={cn("text-xs font-bold", isDark ? "text-white/45" : "text-[var(--ui-text)]/45")}>
                {workspaceTab === "videos"
                  ? `${longVideos.length} long-form videos`
                  : workspaceTab === "shorts"
                    ? isTikTok
                      ? `${shorts.length} clips`
                      : `${shorts.length} shorts`
                    : "Reply assistant"}
              </p>
              <button type="button" onClick={() => setUploadModalOpen(true)} className="ui-btn is-primary is-sm">
                <UploadCloud className="h-4 w-4" />
                Upload
              </button>
            </div>
          </div>
          {workspaceTab !== "comments" ? (
            <div className={cn("grid grid-cols-[repeat(auto-fit,minmax(min(100%,16rem),1fr))] gap-4", workspaceTab === "shorts" ? "lg:grid-cols-4 xl:grid-cols-5" : "xl:grid-cols-3")}>
              {visibleVideos.map((video) => <OptimizeCard key={video.id} video={video} onClick={() => openVideoPage(video)} />)}
              {!visibleVideos.length ? <p className={cn("rounded-xl border border-dashed p-5 text-sm font-semibold", isDark ? "border-white/10 bg-white/6 text-white/45" : "border-[var(--ui-line)] bg-[var(--ui-bg)] text-[var(--ui-text)]/45")}>No {workspaceTab} found for this channel yet.</p> : null}
              <div ref={loadMoreRef} className="col-span-full min-h-1" />
              {loadingMore ? <p className={cn("col-span-full rounded-xl border p-4 text-center text-sm font-bold", isDark ? "border-white/10 bg-white/6 text-white/55" : "border-[var(--ui-line)] bg-[var(--ui-panel)] text-[var(--ui-text)]/55")}>Loading more videos</p> : null}
              {!nextPageToken && visibleVideos.length ? <p className={cn("col-span-full py-2 text-center text-xs font-bold", isDark ? "text-white/35" : "text-[var(--ui-text)]/35")}>All channel videos loaded.</p> : null}
            </div>
          ) : null}
        </section>
      ) : !loading && !error ? (
        <ConnectChannelCard />
      ) : null}

      {!isFeed && workspaceTab === "comments" ? (
      <section className="grid items-start gap-4 xl:grid-cols-[380px_minmax(0,1fr)]">
        <div className={cn("rounded-2xl border p-4 md:p-5 xl:sticky xl:top-4", isDark ? "border-white/10 bg-[var(--ui-panel)]" : "border-[var(--ui-line)] bg-[var(--ui-panel)] shadow-sm")}>
          <div className="flex items-start gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[var(--ui-accent)] text-[var(--ui-accent-ink)]">
              <MessageCircle className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className={cn("text-[11px] font-black uppercase tracking-widest", isDark ? "text-[var(--ui-accent-text)]" : "text-[var(--ui-accent-text)]")}>Comment agent</p>
              <h2 className={cn("mt-0.5 text-lg font-extrabold tracking-tight", isDark ? "text-white" : "text-[var(--ui-text)]")}>Answer comments and follow-ups</h2>
              <p className={cn("mt-1 text-sm leading-6", isDark ? "text-white/55" : "text-[var(--ui-text)]/58")}>Finds new comments and viewers replying to you, drafts replies in your voice, and posts the ones you approve.</p>
            </div>
          </div>

          <p className={cn("mt-4 flex gap-2 rounded-xl px-3 py-2.5 text-xs font-semibold leading-5", isDark ? "bg-white/[0.05] text-white/60" : "bg-[var(--ui-bg)] text-[var(--ui-text)]/60")}>
            <RefreshCw className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Automation uploads are answered on their own: new videos every 5 minutes, slowing as they age.
              {active?.zernioConnected ? " Replies don't use your YouTube API quota." : ""}
            </span>
          </p>

          {!canReply && active ? (
            <div className="mt-4 rounded-xl border border-[var(--ui-accent)]/35 bg-[var(--ui-accent-soft)] p-4 text-sm font-semibold leading-6 text-[var(--ui-accent-text)]">
              Comment permission is missing. Reconnect Google and approve YouTube comment access to use this agent.
              <a href={GOOGLE_READ_CONNECT_URL} className="ml-2 underline">Reconnect</a>
            </div>
          ) : null}

          <div className={cn("ui-inherit mt-4", isDark ? "text-white" : "text-[var(--ui-text)]")}>
            <Segmented
              block
              label="Posting mode"
              value={dryRun ? "review" : "post"}
              onChange={(next) => setDryRun(next === "review")}
              options={[{ value: "review", label: "Review first" }, { value: "post", label: "Post right away" }]}
            />
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3">
            <AgentField isDark={isDark} label="Videos to scan">
              <input type="number" min={1} max={50} value={maxVideos} onChange={(e) => setMaxVideos(Number(e.target.value))} className={agentInput(isDark)} />
            </AgentField>
            <AgentField isDark={isDark} label="Most replies">
              <input type="number" min={1} max={50} value={maxReplies} onChange={(e) => setMaxReplies(Number(e.target.value))} className={agentInput(isDark)} />
            </AgentField>
            <AgentField isDark={isDark} label="Start with">
              <select value={sort} onChange={(e) => setSort(e.target.value)} className={agentInput(isDark)}>
                <option value="recent">Newest videos</option>
                <option value="comments">Most comments</option>
                <option value="views">Most views</option>
                <option value="oldest">Oldest of the latest 50</option>
              </select>
            </AgentField>
            <AgentField isDark={isDark} label="Tone">
              <select value={tone} onChange={(e) => setTone(e.target.value)} className={agentInput(isDark)}>
                <option value="warm-curious">Warm and curious</option>
                <option value="playful">Playful</option>
                <option value="calm-helpful">Calm and helpful</option>
                <option value="creator-casual">Creator casual</option>
              </select>
            </AgentField>
            <AgentField isDark={isDark} label="Reply style" wide>
              <textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} rows={3} className={cn(agentInput(isDark), "h-auto min-h-20 py-2.5 leading-6")} />
            </AgentField>
          </div>

          <label className={cn("mt-3 flex items-center gap-2 text-sm font-semibold", isDark ? "text-white/65" : "text-[var(--ui-text)]/65")}>
            <input type="checkbox" checked={identifyMovies} onChange={(e) => setIdentifyMovies(e.target.checked)} className="ui-check" />
            Answer "what movie is this?" with Movie ID
          </label>

          <button
            type="button"
            disabled={!active || !canReply || agentRunning}
            onClick={() => void runReplyAgent()}
            className="ui-btn is-primary mt-4 w-full"
          >
            {agentRunning ? <Loader2 className="h-4 w-4 ui-spin" /> : dryRun ? <Search className="h-4 w-4" /> : <Send className="h-4 w-4" />}
            {agentRunning ? "Reading comments…" : dryRun ? "Find comments to answer" : "Find and post replies"}
          </button>
        </div>

        <ReplyAgentResults
          result={agentResult}
          running={agentRunning}
          isDark={isDark}
          drafts={drafts}
          posting={posting}
          onDraft={(id, patch) => setDrafts((current) => ({ ...current, [id]: { ...current[id], ...patch } }))}
          onPost={() => void postDrafts()}
        />
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
          postAsShort={postAsShort}
          madeForKids={madeForKids}
          playlists={playlists}
          playlistId={playlistId}
          newPlaylistTitle={newPlaylistTitle}
          loadingPlaylists={loadingPlaylists}
          uploading={uploading}
          uploadResult={uploadResult}
          onClose={() => setUploadModalOpen(false)}
          onFileChange={setFile}
          onTitleChange={setTitle}
          onDescriptionChange={setDescription}
          onTagsChange={setTags}
          onPrivacyStatusChange={setPrivacyStatus}
          onPostAsShortChange={setPostAsShort}
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

function InlineError({ message }: { message: string }) {
  return (
    <div className="ui-inherit">
      <SharedNotice tone="error">{message}</SharedNotice>
    </div>
  );
}

// Channel tools read YouTube data, so this connects a YouTube channel.
function ConnectChannelCard() {
  return (
    <div className="ui-inherit rounded-2xl border border-dashed border-[var(--ui-line-strong)] bg-[var(--ui-panel)] text-[var(--ui-text)] shadow-sm">
      <EmptyState
        icon={<PlatformIcon id="youtube" size={44} />}
        title="Connect a YouTube channel"
        body="Your feed, optimize tabs, and comment agent load once a channel is connected."
      >
        <a href={connectHref("youtube")} className="ui-btn is-primary">
          Add YouTube channel
        </a>
      </EmptyState>
    </div>
  );
}

function agentInput(isDark: boolean) {
  return cn(
    "h-10 w-full rounded-xl border px-3 text-sm font-semibold outline-none transition",
    isDark ? "border-white/10 bg-white/[0.04] text-white" : "border-[var(--ui-line)] bg-[var(--ui-bg)] text-[var(--ui-text)]",
  );
}

function AgentField({ label, wide, isDark, children }: { label: string; wide?: boolean; isDark: boolean; children: ReactNode }) {
  return (
    <label className={cn("grid gap-1.5", wide && "col-span-2")}>
      <span className={cn("text-[11px] font-bold uppercase tracking-widest", isDark ? "text-white/40" : "text-[var(--ui-text)]/45")}>{label}</span>
      {children}
    </label>
  );
}

function OptimizeCard({ video, onClick }: { video: YouTubeDashboardVideo; onClick: () => void }) {
  const score = Math.max(58, Math.min(99, Math.round(42 + video.title.length / 2 + (video.viewCount > 1000 ? 10 : 0))));
  const thumbnailUrl = sharpYouTubeThumbnail(video.thumbnailUrl);
  return (
    <button type="button" onClick={onClick} className="group text-left">
      <div className="relative aspect-[9/16] overflow-hidden rounded-2xl bg-[var(--ui-text)]">
        {thumbnailUrl ? <img src={thumbnailUrl} alt="" className="h-full w-full object-cover transition duration-300 group-hover:scale-105" referrerPolicy="no-referrer" loading="lazy" /> : <div className="grid h-full w-full place-items-center bg-[var(--ui-accent)]/10 text-[var(--ui-accent-text)]"><PlaySquare className="h-8 w-8" /></div>}
        <span className="absolute right-3 top-3 rounded-lg bg-black/75 px-2 py-1 text-[11px] font-black text-white">{formatDuration(video.durationSeconds)}</span>
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/65 to-transparent p-3 text-white">
          <span className="rounded-lg bg-[var(--ui-panel)] px-2 py-1 text-xs font-black text-[var(--ui-accent-text)]">Title {score}</span>
          <p className="mt-3 line-clamp-2 text-sm font-black">{video.title}</p>
          <p className="mt-1 text-xs font-semibold text-white/60">{compactNumber(video.viewCount)} views - {dateAge(video.publishedAt)}</p>
        </div>
      </div>
    </button>
  );
}
