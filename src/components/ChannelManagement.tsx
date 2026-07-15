import { AlertCircle, ArrowLeft, BarChart3, CheckCircle2, ChevronLeft, ChevronRight, ExternalLink, FileVideo, Film, Loader2, MessageCircle, PlaySquare, RefreshCw, Search, Send, Sparkles, Trophy, UploadCloud, Users, Wand2, X, Youtube } from "lucide-react";
import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AuthSessionPayload, ChannelStyleProfile, ConnectedYouTubeAccount, CreatorProject, FeedInsight, MovieResult, YouTubeChannelDashboard, YouTubeCommentsResponse, YouTubeDashboardVideo, YouTubePlaylistSummary, YouTubeUploadResult, YouTubeVideoAnalytics, YouTubeVideoOptimization } from "../types";
import { cn } from "../lib/utils";
import { shouldPrefetchChannelVideoPage } from "../utils/channelVideoPaging.js";
import { StandardChannelCard, StandardVideoCard } from "./StandardCards";

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
const GOOGLE_READ_CONNECT_URL = "/api/auth/google?mode=connect&provider=google&next=/channels";

function hasScope(account: ConnectedYouTubeAccount | null | undefined, scope: string): boolean {
  if (account?.platform === "tiktok") return true;
  if (account?.zernioConnected && scope === "https://www.googleapis.com/auth/youtube.force-ssl") return true;
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

function medianMetric(values: number[]): number {
  const sorted = values.filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function videoAgeHours(value: string): number {
  const time = value ? new Date(value).getTime() : 0;
  if (!Number.isFinite(time) || !time) return 24;
  return Math.max(1, (Date.now() - time) / 36e5);
}

function buildOwnedOutlierSignals(videos: YouTubeDashboardVideo[]) {
  const baselineViews = Math.max(1, medianMetric(videos.map((video) => video.viewCount)));
  const baselineVph = Math.max(1, medianMetric(videos.map((video) => Math.round(video.viewCount / videoAgeHours(video.publishedAt)))));
  return videos.map((video) => {
    const ageHours = videoAgeHours(video.publishedAt);
    const viewsPerHour = Math.round(video.viewCount / ageHours);
    const viewMultiple = video.viewCount / baselineViews;
    const velocityMultiple = viewsPerHour / baselineVph;
    const engagementRate = video.viewCount ? (video.likeCount + video.commentCount * 2) / video.viewCount : 0;
    const points = Math.round(Math.min(100, Math.max(viewMultiple, velocityMultiple) * 35 + Math.min(25, engagementRate * 1000)));
    return {
      video,
      points,
      viewsPerHour,
      viewMultiple,
      velocityMultiple,
      badge: `${points} pts`,
    };
  }).sort((a, b) => b.points - a.points || b.viewsPerHour - a.viewsPerHour || b.video.viewCount - a.video.viewCount);
}

function feedKeywords(text: string): string[] {
  return Array.from(new Set(String(text || "")
    .toLowerCase()
    .replace(/&amp;/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 3 && !["video", "official", "shorts", "youtube", "with", "from", "that", "this", "your", "what", "when", "where", "into", "then", "they", "their"].includes(word))))
    .slice(0, 12);
}

function keywordLabel(value: string): string {
  return value.split(/\s+/).map((word) => word.slice(0, 1).toUpperCase() + word.slice(1)).join(" ");
}

function cleanMetadataTag(value: string): string {
  return String(value || "")
    .replace(/^\s*\d+\s+/, "")
    .replace(/^#+/, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
}

function uniqueTags(values: string[]): string[] {
  const seen = new Set<string>();
  return values
    .map(cleanMetadataTag)
    .filter(Boolean)
    .filter((tag) => {
      const key = tag.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 30);
}

function buildTagSuggestions(video: YouTubeDashboardVideo, growth: YouTubeChannelDashboard["growthInsights"] | null, index = 0) {
  const nicheWords = [
    growth?.playbook.bestNiche,
    growth?.playbook.bestHook,
    growth?.playbook.monetizationFocus,
    ...(growth?.niches || []).slice(0, 5).flatMap((niche) => [niche.microNiche, niche.subNiche, niche.macroNiche]),
  ].filter(Boolean).join(" ");
  const currentTags = Array.isArray(video.tags) ? video.tags.join(" ") : "";
  const words = feedKeywords(`${video.title} ${video.description || ""} ${currentTags} ${nicheWords}`);
  const fallback = ["story explained", "faceless content", "youtube shorts", "high retention", "recap", "viral story", "character reveal", "plot twist"];
  return uniqueTags(words.length ? words : fallback).slice(0, 12).map((tag, tagIndex) => ({
    label: keywordLabel(tag),
    score: Math.max(23, 82 - index * 4 - tagIndex * 3),
  }));
}

function buildAchievementFeed(dashboard: YouTubeChannelDashboard, growth: YouTubeChannelDashboard["growthInsights"] | null) {
  const isTikTok = dashboard.account?.platform === "tiktok";
  const label = isTikTok ? "Followers" : "Subscribers";
  const subscriberThresholds = [100, 250, 500, 600, 650, 700, 750, 1000, 2500, 5000];
  const viewThresholds = [10000, 25000, 50000, 60000, 65000, 70000, 75000, 100000, 250000];
  const subs = subscriberThresholds.filter((value) => dashboard.stats.subscriberCount >= value).slice(-4).map((value) => `Milestone Unlocked - ${plainNumber(value)} ${label}!`);
  const views = viewThresholds.filter((value) => dashboard.stats.viewCount >= value).slice(-4).map((value) => `Milestone Unlocked - ${plainNumber(value)} Views!`);
  const promoted = (growth?.niches || []).filter((niche) => niche.status === "promoted").slice(0, 2).map((niche) => `Niche Promoted - ${niche.microNiche}`);
  return [...subs, ...views, ...promoted].slice(-7).reverse();
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
  onDetailChange,
}: {
  auth: AuthSessionPayload;
  onAuthRefresh: () => Promise<void>;
  onOpenVideo?: (videoId: string) => void;
  initialTab?: "feed" | "optimize";
  theme?: "light" | "dark";
  onDetailChange?: (open: boolean) => void;
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
  const [movieCheck, setMovieCheck] = useState<MovieResult | null>(null);
  const [movieCheckError, setMovieCheckError] = useState("");
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
  const selectedDetailTabs = useMemo(() => ["Overview", "Title", "SEO", "Script/Hook", "Visual Plan", "Thumbnail", "Publishing Plan", "Performance", "Comments"], []);
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
    if (workspaceTab !== "comments") void loadDashboard();
  }, [loadDashboard, workspaceTab]);

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
      setMetadataNotice(err instanceof Error ? err.message : "Could not publish video metadata");
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
      setProjectNotice(err instanceof Error ? err.message : "Could not save creator project");
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
      setProjectNotice(err instanceof Error ? err.message : "Could not generate this project stage");
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
      setProjectNotice(err instanceof Error ? err.message : "Could not archive project");
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
      setProjectNotice(err instanceof Error ? err.message : "Could not copy style");
    } finally {
      setStyleBusy("");
    }
  }

  function openVideoPage(video: YouTubeDashboardVideo) {
    setSelectedVideo(video);
    setDetailTab("Overview");
    setProjectNotice("");
    setActiveProject(null);
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
          <FeedDashboard
            dashboard={dashboard}
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
            uploadError={uploadError}
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
    <div className={cn("min-w-0 overflow-x-clip", selectedVideo ? "h-full min-h-0" : "space-y-5", isDark && !selectedVideo && "-m-4 bg-[#070A12] p-4 text-white sm:-m-5 sm:p-5 md:-m-8 md:p-8 lg:-m-10 lg:p-10 xl:-m-14 xl:p-14")}>
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
          optimization={optimization}
          optimizationError={optimizationError}
          loadingOptimization={loadingOptimization}
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
              body="Existing videos and titles work through Zernio. Connect Google read access only if you want YouTube comments, analytics, and private videos in AutoYT."
              action={<a href={GOOGLE_READ_CONNECT_URL} className="inline-flex h-9 items-center justify-center rounded-lg bg-[#f9dc0b] px-3 text-xs font-bold text-[#1A1A1A] transition hover:bg-[#1A1A1A] hover:text-white">Connect Google (optional)</a>}
            />
          ) : null}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex max-w-full gap-6 overflow-x-auto overscroll-x-contain [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {!isTikTok && (
                <button type="button" onClick={() => setWorkspaceTab("videos")} className={cn("border-b-2 pb-2 text-sm font-black", workspaceTab === "videos" ? "border-[#f9dc0b]" : "border-transparent", workspaceTab === "videos" ? isDark ? "text-white" : "text-[#1A1A1A]" : isDark ? "text-white/40" : "text-[#1A1A1A]/40")}>Videos</button>
              )}
              <button type="button" onClick={() => setWorkspaceTab("shorts")} className={cn("border-b-2 pb-2 text-sm font-black", workspaceTab === "shorts" ? "border-[#f9dc0b]" : "border-transparent", workspaceTab === "shorts" ? isDark ? "text-white" : "text-[#1A1A1A]" : isDark ? "text-white/40" : "text-[#1A1A1A]/40")}>
                {isTikTok ? "TikTok Videos" : "Shorts"}
              </button>
              <button type="button" onClick={() => setWorkspaceTab("comments")} className={cn("border-b-2 pb-2 text-sm font-black", workspaceTab === "comments" ? "border-[#f9dc0b]" : "border-transparent", workspaceTab === "comments" ? isDark ? "text-white" : "text-[#1A1A1A]" : isDark ? "text-white/40" : "text-[#1A1A1A]/40")}>
                {isTikTok ? "Comments" : "Comment Agent"}
              </button>
            </div>
            <div className="flex items-center gap-2">
              <p className={cn("text-xs font-bold", isDark ? "text-white/45" : "text-[#1A1A1A]/45")}>
                {workspaceTab === "videos"
                  ? `${longVideos.length} long-form videos`
                  : workspaceTab === "shorts"
                    ? isTikTok
                      ? `${shorts.length} clips`
                      : `${shorts.length} shorts`
                    : "Reply assistant"}
              </p>
              <button type="button" onClick={() => setUploadModalOpen(true)} className="inline-flex min-h-9 items-center justify-center gap-2 rounded-xl bg-[#f9dc0b] px-3 py-2 text-xs font-bold text-[#1A1A1A] shadow-sm transition hover:bg-[#1A1A1A] hover:text-white">
                <UploadCloud className="h-4 w-4" />
                Upload
              </button>
            </div>
          </div>
          {workspaceTab !== "comments" ? (
            <div className={cn("grid grid-cols-[repeat(auto-fit,minmax(min(100%,16rem),1fr))] gap-4", workspaceTab === "shorts" ? "lg:grid-cols-4 xl:grid-cols-5" : "xl:grid-cols-3")}>
              {visibleVideos.map((video) => <OptimizeCard key={video.id} video={video} onClick={() => openVideoPage(video)} />)}
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
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-[#f9dc0b]/10 text-[#f9dc0b]">
              <MessageCircle className="h-4 w-4" />
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-[#f9dc0b]">Comment reply agent</p>
              <h2 className={cn("mt-1 text-lg font-bold", isDark ? "text-white" : "text-[#1A1A1A]")}>Reply across older channel videos</h2>
              <p className={cn("mt-1 text-sm leading-6", isDark ? "text-white/55" : "text-[#1A1A1A]/55")}>Scan recent uploads from the selected channel, skip unsafe or already-handled comments, and draft or post short engagement replies.</p>
            </div>
          </div>

          {!canReply && active ? (
            <div className="mt-4 rounded-xl border border-[#f9dc0b]/35 bg-[#fff9d6] p-4 text-sm font-semibold leading-6 text-[#443b00]">
              Comment permission is missing. Reconnect Google and approve YouTube comment access to use this agent.
              <a href={GOOGLE_READ_CONNECT_URL} className="ml-2 underline">Reconnect</a>
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
            <button type="button" disabled={!active || !canReply || agentRunning} onClick={() => void runReplyAgent()} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-[#f9dc0b] px-4 py-2 text-xs font-bold text-[#1A1A1A] transition hover:bg-[#1A1A1A] hover:text-white disabled:cursor-not-allowed disabled:opacity-50">
              {agentRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : dryRun ? <Sparkles className="h-4 w-4" /> : <Send className="h-4 w-4" />}
              {dryRun ? "Preview replies" : "Post replies"}
            </button>
          </div>

          {agentError ? <div className="mt-4 rounded-lg border border-[#f9dc0b]/35 bg-[#fff9d6] px-3 py-3 text-sm font-semibold text-[#6a5b00]">{agentError}</div> : null}
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
          postAsShort={postAsShort}
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
    <div className="flex items-center gap-2 rounded-2xl border border-[#f9dc0b]/35 bg-[#f9dc0b]/16 px-4 py-3 text-sm font-bold text-[#1A1A1A]/70">
      <Loader2 className="h-4 w-4 animate-spin text-[#f9dc0b]" />
      {message}
    </div>
  );
}

function InlineError({ message }: { message: string }) {
  return (
    <div className="rounded-2xl border border-[#f9dc0b]/35 bg-[#fff9d6] px-4 py-3 text-sm font-bold text-[#6a5b00]">
      {message}
    </div>
  );
}

function ConnectChannelCard() {
  return (
    <div className="rounded-2xl border border-dashed border-[#1A1A1A]/12 bg-white p-6 shadow-sm">
      <div className="grid h-11 w-11 place-items-center rounded-2xl bg-[#f9dc0b]/10 text-[#f9dc0b]">
        <Youtube className="h-5 w-5" />
      </div>
      <h2 className="mt-4 font-serif text-2xl font-bold text-[#1A1A1A]">Connect a YouTube channel</h2>
      <p className="mt-2 max-w-lg text-sm font-medium leading-6 text-[#1A1A1A]/55">Use the centered channel selector to add or switch channels. Your feed, optimize tabs, and comment agent will load after a channel is connected.</p>
      <a href="/api/auth/google?mode=connect&next=/channels" className="mt-5 inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[#f9dc0b] px-5 text-sm font-black text-[#1A1A1A] transition hover:bg-[#1A1A1A] hover:text-white">
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
  optimization,
  optimizationError,
  loadingOptimization,
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
  projects,
  activeProject,
  styles,
  projectBusy,
  projectNotice,
  metadataBusy,
  metadataNotice,
  onCreateProject,
  onGenerateProjectStage,
  onArchiveProject,
  onSelectProject,
  onPublishMetadata,
  isDark,
  isTikTok = false,
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
  optimization: YouTubeVideoOptimization | null;
  optimizationError: string;
  loadingOptimization: boolean;
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
  projects: CreatorProject[];
  activeProject: CreatorProject | null;
  styles: ChannelStyleProfile[];
  projectBusy: boolean;
  projectNotice: string;
  metadataBusy: string;
  metadataNotice: string;
  onCreateProject: () => void;
  onGenerateProjectStage: (stage: string) => void;
  onArchiveProject: () => void;
  onSelectProject: (project: CreatorProject) => void;
  onPublishMetadata: (input: { title?: string; description?: string; tags?: string[]; appendTags?: boolean }, label: string) => void;
  isDark: boolean;
  isTikTok?: boolean;
}) {
  const isShort = (video.durationSeconds || 0) <= 180;
  const analyticsReady = Boolean(analytics?.analytics && (analytics.title !== "TikTok post" || video.title));
  const displayTitle = analyticsReady ? analytics!.title : video.title;
  const displayViews = analyticsReady ? (analytics?.publicStats.viewCount ?? video.viewCount) : video.viewCount;
  const displayLikes = analyticsReady ? (analytics?.publicStats.likeCount ?? video.likeCount) : video.likeCount;
  const displayComments = analyticsReady ? (analytics?.publicStats.commentCount ?? video.commentCount) : video.commentCount;
  const displayDuration = analyticsReady ? (analytics?.durationSeconds ?? video.durationSeconds) : video.durationSeconds;
  const titleScoreValue = Math.max(58, Math.min(99, Math.round(42 + video.title.length / 2)));
  const thumbnailScore = Math.min(99, titleScoreValue + 3);
  return (
    <section className={cn("flex h-full min-h-0 flex-col overflow-hidden border shadow-sm", isDark ? "border-white/10 bg-[#151923] text-white" : "border-[#1A1A1A]/8 bg-white text-[#1A1A1A]")}>
      <div className={cn("flex flex-col gap-3 border-b px-3 py-3 lg:flex-row lg:items-center lg:justify-between", isDark ? "border-white/10 bg-[#151923]" : "border-[#1A1A1A]/8 bg-white")}>
        <div className="flex min-w-0 items-center gap-2">
          <button type="button" onClick={onBack} className={cn("inline-flex min-h-10 shrink-0 items-center gap-2 rounded-xl border px-3 text-xs font-black", isDark ? "border-white/10 text-white/65 hover:bg-white/8" : "border-[#1A1A1A]/10 bg-white text-[#1A1A1A]/60 hover:text-[#1A1A1A]")}>
            <ArrowLeft className="h-4 w-4" />
            <span className="hidden sm:inline">Videos</span>
          </button>
          <p className="hidden max-w-[220px] truncate text-sm font-bold sm:block">{displayTitle}</p>
          <div className="flex min-w-0 gap-4 overflow-x-auto overscroll-x-contain [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {tabs.map((tab) => (
              <button key={tab} type="button" onClick={() => onTabChange(tab)} className={cn("shrink-0 border-b-2 px-0.5 py-2 text-sm font-black", activeTab === tab ? "border-[#f9dc0b]" : "border-transparent", activeTab === tab ? isDark ? "text-white" : "text-[#1A1A1A]" : isDark ? "text-white/42" : "text-[#1A1A1A]/42")}>
                {tab}{tab === "Title" ? ` ${titleScoreValue}` : tab === "Thumbnail" ? ` ${thumbnailScore}` : tab === "Review" ? " 85" : ""}
              </button>
            ))}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button type="button" onClick={onCreateProject} disabled={projectBusy} className={cn("inline-flex min-h-10 items-center gap-2 rounded-xl px-3 text-xs font-black transition disabled:opacity-45", activeProject ? "bg-[#f9dc0b] text-[#1A1A1A]" : "bg-[#f9dc0b] text-[#1A1A1A] hover:bg-[#1A1A1A] hover:text-white")}>
            {projectBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {activeProject ? "Project saved" : "Save project"}
          </button>
          <button type="button" onClick={onCheckMovie} disabled={!analytics?.url || checkingMovie} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-[#f9dc0b] px-3 text-xs font-black text-[#1A1A1A] transition hover:bg-[#1A1A1A] hover:text-white disabled:opacity-45">
            {checkingMovie ? <Loader2 className="h-4 w-4 animate-spin" /> : <Film className="h-4 w-4" />}
            Movie ID
          </button>
          <button type="button" onClick={onUpload} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-[#1A1A1A] px-3 text-xs font-black text-white transition hover:bg-[#1A1A1A]">
            <UploadCloud className="h-4 w-4" />
            Upload
          </button>
          <button type="button" onClick={onRefresh} className={cn("grid h-10 w-10 place-items-center rounded-xl border", isDark ? "border-white/10 text-white/55 hover:text-white" : "border-[#1A1A1A]/10 text-[#1A1A1A]/50 hover:text-[#1A1A1A]")} aria-label="Refresh analytics">
            {loadingAnalytics ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className={cn("grid gap-4 border-b p-4 lg:grid-cols-[minmax(130px,190px)_minmax(0,1fr)] lg:items-center", isDark ? "border-white/10 bg-white/5" : "border-[#1A1A1A]/8 bg-[#FDFCFA]")}>
          <div className={cn("relative mx-auto w-full max-w-[170px] overflow-hidden rounded-2xl bg-[#111827] lg:mx-0", isShort ? "aspect-[9/16] max-h-[260px]" : "aspect-video lg:max-w-[190px]")}>
            <VideoThumb video={video} />
            <span className="absolute bottom-3 right-3 rounded-lg bg-black/75 px-2 py-1 text-xs font-black text-white">{formatDuration(video.durationSeconds)}</span>
          </div>
          <div className="min-w-0">
            <p className="text-xs font-black uppercase tracking-widest text-[#f9dc0b]">{isShort ? "Short" : "Video"} post page</p>
            <h1 className="mt-2 max-w-4xl text-xl font-black leading-tight md:text-2xl">{displayTitle}</h1>
            <div className={cn("mt-3 grid gap-2 sm:grid-cols-4", isDark ? "text-white" : "text-[#1A1A1A]")}>
              <Mini label="Views" value={compactNumber(displayViews)} />
              <Mini label="Likes" value={compactNumber(displayLikes)} />
              <Mini label="Comments" value={compactNumber(displayComments)} />
              <Mini label="Duration" value={formatDuration(displayDuration)} />
            </div>
          </div>
        </div>

        <div className="p-4 md:p-5">
        <ProjectCommandBar
          project={activeProject}
          projects={projects}
          styles={styles}
          notice={projectNotice}
          busy={projectBusy}
          activeTab={activeTab}
          onGenerate={onGenerateProjectStage}
          onArchive={onArchiveProject}
          onSelect={onSelectProject}
          isDark={isDark}
        />
        {!canReadAnalytics ? <Notice className="mb-3" tone="warn" title="Google read access needed" body="Connect Google read access to load existing videos, comments, and YouTube analytics. Zernio will still handle publishing." action={<a href={GOOGLE_READ_CONNECT_URL} className="inline-flex h-9 items-center justify-center rounded-lg bg-[#f9dc0b] px-3 text-xs font-bold text-[#1A1A1A] transition hover:bg-[#1A1A1A] hover:text-white">Connect Google</a>} /> : null}
        {analyticsError ? <Notice className="mb-3" tone="error" title="Analytics failed" body={analyticsError} /> : null}
        {activeTab === "Overview" ? (
          <>
            {metadataNotice ? <Notice className="mb-3" tone={metadataNotice.toLowerCase().includes("could not") ? "error" : "warn"} title="YouTube metadata" body={metadataNotice} /> : null}
            {analytics ? <AnalyticsPanel analytics={analytics} isTikTok={isTikTok} /> : loadingAnalytics ? <InlineStatus message="Loading post analytics" /> : null}
            {analytics?.url ? <a href={analytics.url} target="_blank" rel="noreferrer" className={cn("mt-4 inline-flex min-h-10 items-center gap-2 rounded-xl border px-4 text-xs font-black", isDark ? "border-white/10 text-white/60 hover:text-white" : "border-[#1A1A1A]/10 text-[#1A1A1A]/60 hover:text-[#1A1A1A]")}>Open on YouTube <ExternalLink className="h-4 w-4" /></a> : null}
            {movieCheckError ? <Notice className="mt-3" tone="error" title="Movie ID failed" body={movieCheckError} /> : null}
            {movieCheck ? <MovieIdentityPanel result={movieCheck} /> : null}
          </>
        ) : activeTab === "Title" ? (
          <TitleOptimizationPanel video={video} optimization={optimization} loading={loadingOptimization} error={optimizationError} fallbackScore={titleScoreValue} publishing={metadataBusy === `${video.id}:Title`} onPublishTitle={(title) => onPublishMetadata({ title }, "Title")} />
        ) : activeTab === "Thumbnail" ? (
          <div className="grid gap-4 md:grid-cols-3">{["Current", "High contrast", "Curiosity hook"].map((item, index) => <button key={item} type="button" className="rounded-2xl bg-[#F3F4F8] p-3 text-left text-[#111827]"><ThumbPreview video={video} /><p className="mt-3 text-sm font-black">{item}</p><p className="text-xs font-bold text-[#111827]/45">Score {thumbnailScore - index * 4}</p></button>)}</div>
        ) : activeTab === "SEO" ? (
          <SeoOptimizationPanel video={video} optimization={optimization} loading={loadingOptimization} error={optimizationError} publishing={metadataBusy} onPublishDescription={(description) => onPublishMetadata({ description }, "Description")} onPublishTags={(tags) => onPublishMetadata({ tags: uniqueTags([...(optimization?.current?.tags || video.tags || []), ...tags]) }, "Tags")} />
        ) : activeTab === "Script/Hook" ? (
          <ProjectStagePanel project={activeProject} stage="script" fallbackTitle={video.title} onGenerate={() => onGenerateProjectStage("script")} busy={projectBusy} />
        ) : activeTab === "Visual Plan" ? (
          <ProjectStagePanel project={activeProject} stage="visualPlan" fallbackTitle={video.title} onGenerate={() => onGenerateProjectStage("visualPlan")} busy={projectBusy} />
        ) : activeTab === "Review" ? (
          <ReviewPanel video={video} />
        ) : activeTab === "Preview" ? (
          <div className="grid gap-5 md:grid-cols-[minmax(0,420px)_minmax(0,1fr)]"><ThumbPreview video={video} /><div><p className="text-xl font-black">{video.title}</p><p className={cn("mt-2 text-sm font-semibold", isDark ? "text-white/45" : "text-[#111827]/45")}>{compactNumber(video.viewCount)} views - {dateAge(video.publishedAt)}</p></div></div>
        ) : activeTab === "Publishing Plan" ? (
          <ProjectStagePanel project={activeProject} stage="publishingPlan" fallbackTitle={video.title} onGenerate={() => onGenerateProjectStage("publishingPlan")} busy={projectBusy} />
        ) : activeTab === "Performance" ? (
          analytics ? <AnalyticsPanel analytics={analytics} isTikTok={isTikTok} /> : <InlineStatus message="Loading performance" />
        ) : (
          <>
            {!canReply ? <Notice className="mb-3" tone="warn" title="Comments need Google access" body="Connect Google read access and approve YouTube force-ssl to view and reply to comments inside AutoYT." action={<a href={GOOGLE_READ_CONNECT_URL} className="inline-flex h-9 items-center justify-center rounded-lg bg-[#f9dc0b] px-3 text-xs font-bold text-[#1A1A1A] transition hover:bg-[#1A1A1A] hover:text-white">Connect Google</a>} /> : null}
            <CommentsPanel comments={comments} error={commentsError} loading={loadingComments} canReply={canReply} replyText={replyText} replyingTo={replyingTo} onReplyTextChange={onReplyTextChange} onReply={onReply} onRefresh={onRefreshComments} />
          </>
        )}
        </div>
      </div>
    </section>
  );
}

function ProjectCommandBar({
  project,
  projects,
  styles,
  notice,
  busy,
  activeTab,
  onGenerate,
  onArchive,
  onSelect,
  isDark,
}: {
  project: CreatorProject | null;
  projects: CreatorProject[];
  styles: ChannelStyleProfile[];
  notice: string;
  busy: boolean;
  activeTab: string;
  onGenerate: (stage: string) => void;
  onArchive: () => void;
  onSelect: (project: CreatorProject) => void;
  isDark: boolean;
}) {
  const stage = tabToProjectStage(activeTab);
  return (
    <div className={cn("mb-4 rounded-2xl border p-3", isDark ? "border-white/10 bg-white/5" : "border-[#1A1A1A]/8 bg-[#FDFCFA]")}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-black uppercase tracking-widest text-[#f9dc0b]">Creator project</p>
          <p className={cn("mt-1 truncate text-sm font-black", isDark ? "text-white" : "text-[#1A1A1A]")}>{project?.title || "Save this video as a reusable project to keep title, SEO, script, visuals, thumbnail, and publishing notes together."}</p>
          <p className={cn("mt-1 text-xs font-semibold", isDark ? "text-white/45" : "text-[#1A1A1A]/45")}>{styles.length ? `${styles.length} copied styles available` : "Copy a competitor style from Feed Research to guide future projects."}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {projects.length > 1 ? (
            <select value={project?.id || ""} onChange={(event) => {
              const picked = projects.find((item) => item.id === event.target.value);
              if (picked) onSelect(picked);
            }} className={cn("h-10 rounded-xl border px-3 text-xs font-bold outline-none", isDark ? "border-white/10 bg-[#151923] text-white" : "border-[#1A1A1A]/10 bg-white text-[#1A1A1A]")}>
              {projects.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
            </select>
          ) : null}
          {stage ? (
            <button type="button" onClick={() => onGenerate(stage)} disabled={!project || busy} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-[#f9dc0b] px-3 text-xs font-black text-[#1A1A1A] transition hover:bg-[#1A1A1A] hover:text-white disabled:opacity-45">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
              Generate tab
            </button>
          ) : null}
          <button type="button" onClick={onArchive} disabled={!project || busy} className={cn("inline-flex min-h-10 items-center gap-2 rounded-xl border px-3 text-xs font-black transition disabled:opacity-45", isDark ? "border-white/10 text-white/60 hover:text-white" : "border-[#1A1A1A]/10 bg-white text-[#1A1A1A]/55 hover:text-[#1A1A1A]")}>
            Archive
          </button>
        </div>
      </div>
      {notice ? <p className={cn("mt-3 rounded-xl px-3 py-2 text-xs font-bold", notice.toLowerCase().includes("could not") ? "bg-[#fff9d6] text-[#6a5b00]" : "bg-[#fff9d6] text-[#6a5b00]")}>{notice}</p> : null}
    </div>
  );
}

function tabToProjectStage(tab: string): string {
  if (tab === "Title") return "title";
  if (tab === "SEO") return "seo";
  if (tab === "Script/Hook") return "script";
  if (tab === "Visual Plan") return "visualPlan";
  if (tab === "Thumbnail") return "thumbnail";
  if (tab === "Publishing Plan") return "publishingPlan";
  return "";
}

function ProjectStagePanel({ project, stage, fallbackTitle, onGenerate, busy }: { project: CreatorProject | null; stage: string; fallbackTitle: string; onGenerate: () => void; busy: boolean }) {
  const output = project?.outputs?.[stage];
  return (
    <div className="space-y-4 text-[#111827]">
      {!project ? (
        <Notice tone="warn" title="Save a creator project first" body="Project tabs persist only after this video is saved as a creator project." />
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-[#F3F4F8] p-4">
        <div>
          <p className="text-xs font-black uppercase tracking-widest text-[#f9dc0b]">{stage.replace(/([A-Z])/g, " $1").trim()}</p>
          <h3 className="mt-1 text-lg font-black">{project?.title || fallbackTitle}</h3>
        </div>
        <button type="button" onClick={onGenerate} disabled={!project || busy} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-[#f9dc0b] px-4 text-xs font-black text-[#1A1A1A] transition hover:bg-[#1A1A1A] hover:text-white disabled:opacity-45">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
          Generate
        </button>
      </div>
      {output ? (
        <div className="grid gap-4 md:grid-cols-2">
          {Object.entries(output).map(([key, value]) => (
            <div key={key} className="rounded-2xl bg-[#F3F4F8] p-4">
              <p className="text-xs font-black uppercase tracking-widest text-[#111827]/40">{key.replace(/([A-Z])/g, " $1")}</p>
              <ProjectValue value={value} />
            </div>
          ))}
        </div>
      ) : (
        <p className="rounded-2xl border border-dashed border-[#1A1A1A]/12 bg-[#F9F8F6] p-5 text-sm font-semibold text-[#111827]/55">No saved output for this tab yet.</p>
      )}
    </div>
  );
}

function ProjectValue({ value }: { value: any }) {
  if (Array.isArray(value)) {
    return <div className="mt-3 space-y-2">{value.map((item, index) => <p key={index} className="rounded-xl bg-white px-3 py-2 text-sm font-bold leading-6 text-[#111827]/68">{typeof item === "string" ? item : JSON.stringify(item)}</p>)}</div>;
  }
  if (value && typeof value === "object") {
    return <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap rounded-xl bg-white p-3 text-xs font-semibold leading-5 text-[#111827]/65">{JSON.stringify(value, null, 2)}</pre>;
  }
  return <p className="mt-3 whitespace-pre-wrap text-sm font-semibold leading-7 text-[#111827]/65">{String(value || "")}</p>;
}

function UploadModal({
  canUpload,
  file,
  selectedFileLabel,
  title,
  description,
  tags,
  privacyStatus,
  postAsShort,
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
  onPostAsShortChange,
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
  postAsShort: boolean;
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
  onPostAsShortChange: (value: boolean) => void;
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
          <button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-lg border border-[#1A1A1A]/10 text-[#1A1A1A]/55 transition hover:text-[#1A1A1A]" aria-label="Close upload modal">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="max-h-[calc(100dvh-150px)] overflow-y-auto p-4 sm:p-5">
          <label className="group grid cursor-pointer place-items-center rounded-xl border border-dashed border-[#f9dc0b]/35 bg-[#F9F8F6] px-4 py-8 text-center transition hover:bg-[#1A1A1A]/5">
            <input type="file" accept="video/*" className="sr-only" onChange={(event) => onFileChange(event.target.files?.[0] || null)} />
            <FileVideo className="mb-3 h-8 w-8 text-[#f9dc0b]" />
            <span className="max-w-full truncate text-sm font-bold text-[#1A1A1A]">{selectedFileLabel}</span>
            <span className="mt-1 text-xs font-medium text-[#1A1A1A]/42">MP4, MOV, WebM, or any YouTube-supported video.</span>
          </label>
          <div className="mt-4 grid gap-3">
            <Field label="Title"><input value={title} onChange={(event) => onTitleChange(event.target.value)} maxLength={100} className="h-11 w-full rounded-lg border border-[#1A1A1A]/10 bg-[#FDFCFA] px-3 text-sm font-semibold outline-none transition focus:border-[#f9dc0b]/45" placeholder="Video title" /></Field>
            <Field label="Description"><textarea value={description} onChange={(event) => onDescriptionChange(event.target.value)} rows={5} className="w-full resize-none rounded-lg border border-[#1A1A1A]/10 bg-[#FDFCFA] px-3 py-3 text-sm outline-none transition focus:border-[#f9dc0b]/45" placeholder="Description, links, credits" /></Field>
            <Field label="Tags"><input value={tags} onChange={(event) => onTagsChange(event.target.value)} className="h-11 w-full rounded-lg border border-[#1A1A1A]/10 bg-[#FDFCFA] px-3 text-sm outline-none transition focus:border-[#f9dc0b]/45" placeholder="movie recap, sci fi, explained" /></Field>
            <label className="flex flex-col gap-3 rounded-xl border border-[#1A1A1A]/10 bg-[#FDFCFA] p-3 sm:flex-row sm:items-center sm:justify-between">
              <span>
                <span className="block text-sm font-bold text-[#1A1A1A]">Post as YouTube Short</span>
                <span className="mt-1 block text-xs font-semibold leading-5 text-[#1A1A1A]/48">Trim long clips to a natural 1-3 minute story beat before upload. Turn off for long-form.</span>
              </span>
              <span className={cn("relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition", postAsShort ? "border-[#f9dc0b] bg-[#f9dc0b]" : "border-[#1A1A1A]/12 bg-[#1A1A1A]/10")}>
                <input type="checkbox" checked={postAsShort} onChange={(event) => onPostAsShortChange(event.target.checked)} className="sr-only" />
                <span className={cn("block h-5 w-5 rounded-full bg-white shadow transition", postAsShort ? "translate-x-5" : "translate-x-1")} />
              </span>
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Visibility"><select value={privacyStatus} onChange={(event) => onPrivacyStatusChange(event.target.value)} className="h-11 w-full rounded-lg border border-[#1A1A1A]/10 bg-[#FDFCFA] px-3 text-sm font-bold outline-none transition focus:border-[#f9dc0b]/45"><option value="private">Private</option><option value="unlisted">Unlisted</option><option value="public">Public</option></select></Field>
              <label className="flex h-11 items-center gap-2 self-end rounded-lg border border-[#1A1A1A]/10 bg-[#FDFCFA] px-3 text-sm font-bold text-[#1A1A1A]/65"><input type="checkbox" checked={madeForKids} onChange={(event) => onMadeForKidsChange(event.target.checked)} className="h-4 w-4 accent-[#f9dc0b]" />Made for kids</label>
            </div>
            <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
              <Field label="Add to playlist"><select value={playlistId} onChange={(event) => onPlaylistIdChange(event.target.value)} className="h-11 w-full rounded-lg border border-[#1A1A1A]/10 bg-[#FDFCFA] px-3 text-sm font-bold outline-none transition focus:border-[#f9dc0b]/45"><option value="">No playlist</option>{playlists.map((playlist) => <option key={playlist.id} value={playlist.id}>{playlist.title} ({playlist.videoCount || 0})</option>)}</select></Field>
              <button type="button" onClick={onRefreshPlaylists} className="mt-6 inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-[#1A1A1A]/10 bg-white px-3 text-xs font-bold text-[#1A1A1A]/60 transition hover:text-[#1A1A1A]">{loadingPlaylists ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}Refresh</button>
            </div>
            <Field label="Or create playlist"><input value={newPlaylistTitle} onChange={(event) => onNewPlaylistTitleChange(event.target.value)} className="h-11 w-full rounded-lg border border-[#1A1A1A]/10 bg-[#FDFCFA] px-3 text-sm outline-none transition focus:border-[#f9dc0b]/45" placeholder="New playlist title for this upload" /></Field>
          </div>
          {uploadError ? <Notice className="mt-4" tone="error" title="Upload failed" body={uploadError} /> : null}
          {uploadResult ? <div className="mt-4 rounded-xl border border-[#f9dc0b]/35 bg-[#fff9d6] p-4 text-sm text-[#2d2700]"><div className="flex items-center gap-2 font-bold"><CheckCircle2 className="h-4 w-4" /> Uploaded successfully</div><a href={uploadResult.url} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1.5 text-xs font-bold text-[#6a5b00] underline">Open on YouTube <ExternalLink className="h-3.5 w-3.5" /></a></div> : null}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-[#1A1A1A]/8 bg-[#FDFCFA] px-5 py-4">
          <button type="button" onClick={onClose} className="inline-flex h-10 items-center justify-center rounded-xl border border-[#1A1A1A]/10 bg-white px-4 text-xs font-bold text-[#1A1A1A]/60 transition hover:text-[#1A1A1A]">Cancel</button>
          <button disabled={!canUpload || !file || !title.trim() || uploading} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-[#f9dc0b] px-4 text-xs font-bold text-[#1A1A1A] transition hover:bg-[#1A1A1A] hover:text-white disabled:cursor-not-allowed disabled:opacity-45">{uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}{uploading ? "Uploading" : "Upload"}</button>
        </div>
      </form>
    </div>
  );
}

function Notice({ tone, title, body, action, className }: { tone: "warn" | "error"; title: string; body: string; action?: ReactNode; className?: string }) {
  const error = tone === "error";
  return (
    <div className={cn("flex flex-col gap-3 rounded-xl border p-4 text-sm sm:flex-row sm:items-center sm:justify-between", error ? "border-[#f9dc0b]/18 bg-[#fff9d6] text-[#2d2700]" : "border-[#f9dc0b]/35 bg-[#fff9d6] text-[#2d2700]", className)}>
      <div className="flex gap-3"><AlertCircle className={cn("mt-0.5 h-4 w-4 shrink-0", error ? "text-[#b69300]" : "text-[#6a5b00]")} /><div><p className="font-bold">{title}</p><p className="mt-1 leading-6 opacity-75">{body}</p></div></div>
      {action}
    </div>
  );
}

function AnalyticsPanel({ analytics, isTikTok = false }: { analytics: YouTubeVideoAnalytics; isTikTok?: boolean }) {
  const totals = analytics.analytics?.totals || {};
  const warning = typeof totals.warning === "string" ? totals.warning : "";
  return (
    <div className="overflow-hidden rounded-xl border border-[#1A1A1A]/8 bg-[#F9F8F6]">
      <div className="flex gap-3 border-b border-[#1A1A1A]/8 bg-white p-3">
        <div className="h-16 w-24 overflow-hidden rounded-lg bg-[#1A1A1A]/5">{analytics.thumbnailUrl ? <img src={analytics.thumbnailUrl} alt="" className="h-full w-full object-cover" /> : null}</div>
        <div className="min-w-0 flex-1"><p className="line-clamp-2 text-sm font-bold text-[#1A1A1A]">{analytics.title}</p><a href={analytics.url} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs font-bold text-[#f9dc0b]">Open post <ExternalLink className="h-3 w-3" /></a></div>
      </div>
      <div className={cn("grid gap-2 p-3", isTikTok ? "grid-cols-3" : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-6")}>
        <Stat label="Views" value={compactNumber(Number(totals.views ?? analytics.publicStats?.viewCount ?? 0))} />
        <Stat label="Likes" value={compactNumber(Number(totals.likes ?? analytics.publicStats?.likeCount ?? 0))} />
        <Stat label="Comments" value={compactNumber(Number(totals.comments ?? analytics.publicStats?.commentCount ?? 0))} />
        {!isTikTok ? (
          <>
            <Stat label="Watch min" value={plainNumber(totals.estimatedMinutesWatched)} />
            <Stat label="Avg view" value={`${plainNumber(totals.averageViewDuration)}s`} />
            <Stat label="Subs gained" value={plainNumber(totals.subscribersGained)} />
          </>
        ) : null}
      </div>
      {warning ? <p className="border-t border-[#1A1A1A]/8 px-3 py-2 text-xs font-semibold leading-5 text-[#6a5b00]">{warning}</p> : null}
    </div>
  );
}

function MovieIdentityPanel({ result }: { result: MovieResult }) {
  return (
    <div className="mt-4 overflow-hidden rounded-xl border border-[#1A1A1A]/8 bg-white">
      <div className="flex flex-col gap-4 border-b border-[#1A1A1A]/8 bg-[#FDFCFA] p-4 md:flex-row md:items-start">
        <div className="h-28 w-20 shrink-0 overflow-hidden rounded-lg bg-[#1A1A1A]/5">{result.posterUrl ? <img src={result.posterUrl} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" /> : <Film className="m-auto mt-9 h-8 w-8 text-[#f9dc0b]/35" />}</div>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold uppercase tracking-widest text-[#f9dc0b]">Detected movie</p>
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
        <div className="flex items-center gap-2"><MessageCircle className="h-4 w-4 text-[#f9dc0b]" /><p className="text-sm font-bold text-[#1A1A1A]">Recent comments</p></div>
        <button type="button" onClick={onRefresh} className="grid h-8 w-8 place-items-center rounded-lg border border-[#1A1A1A]/10 text-[#1A1A1A]/50 transition hover:text-[#1A1A1A]" aria-label="Refresh comments">{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}</button>
      </div>
      {error ? <p className="border-b border-[#f9dc0b]/18 bg-[#fff9d6] px-3 py-2 text-xs font-bold text-[#443b00]">{error}</p> : null}
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
                    <input value={replyText[parent.id] || ""} onChange={(event) => onReplyTextChange(parent.id, event.target.value)} className="h-10 min-w-0 flex-1 rounded-lg border border-[#1A1A1A]/10 bg-[#FDFCFA] px-3 text-sm outline-none transition focus:border-[#f9dc0b]/45" placeholder="Reply as your channel" />
                    <button type="button" onClick={() => onReply(parent.id)} disabled={!replyText[parent.id]?.trim() || replyingTo === parent.id} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[#f9dc0b] px-3 text-xs font-bold text-[#1A1A1A] transition hover:bg-[#1A1A1A] hover:text-white disabled:opacity-45">{replyingTo === parent.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}Reply</button>
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
      {comment.authorProfileImageUrl ? <img src={comment.authorProfileImageUrl} alt="" className={cn("rounded-full object-cover", compact ? "h-7 w-7" : "h-9 w-9")} referrerPolicy="no-referrer" /> : <div className={cn("grid rounded-full bg-[#f9dc0b]/10 text-[#f9dc0b]", compact ? "h-7 w-7" : "h-9 w-9")}><MessageCircle className="m-auto h-3.5 w-3.5" /></div>}
      <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="truncate text-xs font-bold text-[#1A1A1A]">{comment.authorDisplayName || "YouTube user"}</p><p className="text-[11px] font-semibold text-[#1A1A1A]/35">{comment.likeCount ? `${compactNumber(comment.likeCount)} likes` : ""}</p></div><p className={cn("mt-1 whitespace-pre-wrap text-sm leading-6 text-[#1A1A1A]/70", compact && "text-xs leading-5")}>{comment.textDisplay}</p></div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg bg-white px-3 py-2"><p className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/35">{label}</p><p className="mt-1 truncate text-sm font-bold text-[#1A1A1A]">{value}</p></div>;
}

function FeedDashboard({ dashboard, onOpenVideo, onCopyStyle, onPublishTags, styleBusy, metadataBusy, metadataNotice, isDark }: { dashboard: YouTubeChannelDashboard; onOpenVideo: (video: YouTubeDashboardVideo) => void; onCopyStyle: (competitor: any) => void; onPublishTags: (video: YouTubeDashboardVideo, tags: string[]) => void; styleBusy: string; metadataBusy: string; metadataNotice: string; isDark: boolean }) {
  const [activeTab, setActiveTab] = useState<"All" | "Optimization" | "Research" | "Analytics" | "Achievements">("All");
  const videos = dashboard.recentVideos || [];
  const growth = dashboard.growthInsights || null;
  const persistedInsights = (dashboard.feedInsights || []).filter((insight) => activeTab === "All" || insight.type === activeTab);
  const trackedChannels = persistedInsights.filter((i) => i.type === "Research" && i.actionPayload?.competitor);
  const otherInsights = persistedInsights.filter((i) => !(i.type === "Research" && i.actionPayload?.competitor));
  const outlierSignals = buildOwnedOutlierSignals(videos);
  const outliers = outlierSignals.slice(0, 3);
  const topVideo = outliers[0]?.video || videos[0];
  const youtubeCompetitors = growth?.youtubeCompetitors || [];
  const competitorOutliers = youtubeCompetitors
    .flatMap((competitor) => (competitor.recentVideos || []).map((video) => ({ competitor, video })))
    .sort((a, b) => b.video.viewsPerHour - a.video.viewsPerHour || b.video.viewCount - a.video.viewCount);
  const sourceCandidates = growth?.sourceCandidates || growth?.competitors || [];
  const candidateVideos = growth?.candidateVideos || growth?.competitorVideos || [];
  const tagCards = videos.slice(0, 3).map((video, index) => ({ video, tags: buildTagSuggestions(video, growth, index) }));
  const achievements = buildAchievementFeed(dashboard, growth);
  const topKeyword = growth?.playbook.bestNiche || feedKeywords(videos.map((video) => video.title).join(" ")).slice(0, 2).join(" ") || "story video";
  const growthSignalParts = {
    niches: growth?.niches.length || 0,
    youtubeCompetitors: youtubeCompetitors.length,
    candidates: sourceCandidates.length,
    clips: candidateVideos.length,
  };
  const isTikTokPlatform = dashboard.account.platform === "tiktok";
  const showOptimization = activeTab === "All" || activeTab === "Optimization";
  const showResearch = activeTab === "All" || activeTab === "Research";
  const showAnalytics = activeTab === "Analytics";
  const showAchievements = activeTab === "Achievements";
  const showAnalyticsInsightGrid = activeTab === "Analytics" && persistedInsights.some((insight) => insight.type === "Analytics");
  const showAll = activeTab === "All";
  const showYouTubeCompetitorResearch = showResearch && (!isTikTokPlatform || youtubeCompetitors.length > 0);
  const showTikTokSources = showResearch && (isTikTokPlatform || sourceCandidates.length > 0 || candidateVideos.length > 0);
  const growthSignalSummary = growth
    ? isTikTokPlatform
      ? `${growthSignalParts.niches} niche signals, ${growthSignalParts.candidates} TikTok candidates, ${growthSignalParts.clips} candidate clips`
      : `${growthSignalParts.niches} niche signals, ${growthSignalParts.youtubeCompetitors} YouTube competitors, ${growthSignalParts.candidates} TikTok candidates, ${growthSignalParts.clips} candidate clips`
    : "Learning insights will appear after agent checks";

  return (
    <div className={cn("mx-auto max-w-3xl space-y-6 pb-12", isDark ? "text-white" : "text-[#111827]")}>
      <div className="grid gap-4 md:grid-cols-2">
        <FeedStat label={isTikTokPlatform ? "Followers" : "Subscribers"} value={compactNumber(dashboard.stats.subscriberCount)} hint={`${compactNumber(Math.max(0, dashboard.stats.subscriberCount - 50))} target`} isDark={isDark} />
        <FeedStat label="Views" value={compactNumber(dashboard.stats.viewCount)} hint={`${compactNumber(dashboard.stats.recentViews)} recent`} isDark={isDark} />
      </div>

      <div className={cn("rounded-2xl px-5 py-4 text-sm font-black", isDark ? "bg-[#4a4100] text-white" : "bg-[#fff6bf] text-[#1A1A1A]")}>
        <div className="flex flex-wrap items-center justify-center gap-3 text-center">
          <span className="inline-flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-[#f9dc0b]" />Learning map</span>
          {growth ? (
            <span className={cn("font-bold", isDark ? "text-white/72" : "text-[#1A1A1A]/72")}>
              {growthSignalSummary}
            </span>
          ) : (
            <span className={cn("font-bold", isDark ? "text-white/72" : "text-[#1A1A1A]/72")}>Learning insights will appear after agent checks</span>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {[
          { label: "All", icon: Sparkles },
          { label: "Optimization", icon: Wand2 },
          { label: "Research", icon: Search },
          { label: "Analytics", icon: BarChart3 },
          { label: "Achievements", icon: Trophy },
        ].map(({ label, icon: Icon }) => (
          <button key={label} onClick={() => setActiveTab(label as typeof activeTab)} className={cn("inline-flex min-h-10 items-center gap-2 rounded-full px-4 py-2 text-sm font-black transition", activeTab === label ? "bg-[#f9dc0b] text-[#1A1A1A]" : isDark ? "bg-white/8 text-white/85 hover:bg-white/12" : "bg-white text-[#1A1A1A]/75 shadow-sm hover:text-[#1A1A1A]")}>
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      {metadataNotice ? <Notice tone={metadataNotice.toLowerCase().includes("could not") ? "error" : "warn"} title="YouTube metadata" body={metadataNotice} /> : null}

      {showAll ? (
        <FeedInsightCard icon={<Trophy className="h-4 w-4" />} title={achievements[0] || "Keep building your channel signal"} meta="new insight" isDark={isDark} />
      ) : null}

      {trackedChannels.length ? (
        <FeedSection title="Tracked Channels" meta={`${trackedChannels.length} active monitors`} isDark={isDark}>
          <HorizontalCarousel isDark={isDark}>
            {trackedChannels.map((insight) => (
              <div key={insight.id} className="shrink-0 snap-start basis-[82%] sm:basis-[calc((100%-1rem)/2)] lg:basis-[calc((100%-2rem)/3)]">
                <PersistedInsightCard
                  insight={insight}
                  videos={videos}
                  onOpenVideo={onOpenVideo}
                  onCopyStyle={onCopyStyle}
                  styleBusy={styleBusy}
                  isDark={isDark}
                />
              </div>
            ))}
          </HorizontalCarousel>
        </FeedSection>
      ) : null}

      {otherInsights.length ? (
        <FeedSection title="Saved Growth Insights" meta={`${otherInsights.length} live signals`} isDark={isDark}>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {otherInsights.slice(0, activeTab === "All" ? 5 : 12).map((insight) => (
              <PersistedInsightCard
                key={insight.id}
                insight={insight}
                videos={videos}
                onOpenVideo={onOpenVideo}
                onCopyStyle={onCopyStyle}
                styleBusy={styleBusy}
                isDark={isDark}
              />
            ))}
          </div>
        </FeedSection>
      ) : null}

      {growth && showOptimization ? (
        <section className={cn("rounded-2xl p-5 shadow-sm", isDark ? "bg-[#151923]" : "bg-white")}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-black uppercase tracking-widest text-[#f9dc0b]">Monetization playbook</p>
              <h2 className="mt-1 text-xl font-black">{growth.playbook.bestNiche || "Find a repeatable winner"}</h2>
              <p className={cn("mt-2 text-sm font-semibold leading-6", isDark ? "text-white/55" : "text-[#1A1A1A]/55")}>{growth.playbook.monetizationFocus}</p>
            </div>
            <BarChart3 className="h-5 w-5 shrink-0 text-[#f9dc0b]" />
          </div>
          <div className="mt-4 grid gap-2">
            {growth.playbook.actions.slice(0, 4).map((action) => (
              <p key={action} className={cn("rounded-xl px-3 py-2 text-sm font-bold leading-6", isDark ? "bg-white/7 text-white/78" : "bg-[#F4F5F8] text-[#1A1A1A]/72")}>{action}</p>
            ))}
          </div>
        </section>
      ) : null}

      {showOptimization ? (
        <FeedSection title="Add Missing Tags" meta={`${tagCards.length} videos`} isDark={isDark}>
          <div className="space-y-4">
            {tagCards.map(({ video, tags }) => (
              <OptimizationTagCard
                key={video.id}
                video={video}
                tags={tags}
                onOpen={() => onOpenVideo(video)}
                onPublishTags={(publishedTags) => onPublishTags(video, publishedTags)}
                publishing={metadataBusy === `${video.id}:Tags`}
                isDark={isDark}
              />
            ))}
          </div>
        </FeedSection>
      ) : null}

      {showYouTubeCompetitorResearch && youtubeCompetitors.length ? (
        <FeedSection title="YouTube Competitor Channels" meta={`${youtubeCompetitors.length} direct YouTube matches`} isDark={isDark}>
          <HorizontalCarousel isDark={isDark}>
            {youtubeCompetitors.map((competitor) => (
              <div key={competitor.id} className="shrink-0 snap-start basis-[48%] sm:basis-[calc((100%-2rem)/3)] lg:basis-[calc((100%-3rem)/4)]">
                <SuggestedCompetitorCard
                  competitor={competitor}
                  onCopyStyle={() => onCopyStyle(competitor)}
                  busy={styleBusy === (competitor.channelId || competitor.url || competitor.title)}
                  isDark={isDark}
                />
              </div>
            ))}
          </HorizontalCarousel>
        </FeedSection>
      ) : showYouTubeCompetitorResearch ? (
        <FeedSection title="YouTube Competitor Channels" meta="direct YouTube search" isDark={isDark}>
          <div className={cn("rounded-2xl border border-dashed p-5 text-sm font-semibold leading-6", isDark ? "border-white/10 bg-[#151923] text-white/55" : "border-[#1A1A1A]/10 bg-white text-[#1A1A1A]/55")}>
            No YouTube competitor channels returned yet. AutoYT searches YouTube from this channel's niche, titles, and learned micro-niches; results appear here once YouTube returns matching same-niche channels.
          </div>
        </FeedSection>
      ) : null}

      {showResearch && competitorOutliers.length ? (
        <FeedSection title="Recent Competitor Videos" meta={`${competitorOutliers.length} direct from YouTube`} isDark={isDark}>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {competitorOutliers.slice(0, 6).map((item) => <YouTubeOutlierCard key={`${item.competitor.id}-${item.video.id}`} item={item} isDark={isDark} />)}
          </div>
        </FeedSection>
      ) : showResearch ? (
        <FeedSection title={isTikTokPlatform ? "Owned TikTok Outlier Signals" : "Owned YouTube Outlier Signals"} meta={`${outliers.length} public-metric leaders`} isDark={isDark}>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {outliers.map((signal) => <FeedVideoCard key={signal.video.id} video={signal.video} multiplier={signal.badge} onClick={() => onOpenVideo(signal.video)} />)}
          </div>
        </FeedSection>
      ) : null}

      {showAnalytics ? <div className={cn("rounded-2xl p-5 shadow-sm", isDark ? "bg-[#151923]" : "bg-white")}>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-black">Trending Keyword</p>
            <p className={cn("mt-1 text-xs font-bold", isDark ? "text-white/45" : "text-[#1A1A1A]/42")}>story video · {compactNumber(Math.max(1, dashboard.stats.recentViews))} VPH</p>
          </div>
          <BarChart3 className="h-5 w-5 text-[#f9dc0b]" />
        </div>
        <TrendGraph />
      </div> : null}

      {showResearch && competitorOutliers.length ? (
        <FeedSection title={`Trending Keyword: ${keywordLabel(topKeyword)}`} meta={`${compactNumber(Math.max(...competitorOutliers.map((item) => item.video.viewsPerHour), 1))} VPH`} isDark={isDark}>
          <TrendGraph />
        </FeedSection>
      ) : null}

      {showAnalytics && outlierSignals.length ? (
        <FeedSection title="Channel Outlier Videos" meta={`${outlierSignals.length} public-metric signals`} isDark={isDark}>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {outlierSignals.slice(0, 9).map((signal) => <AnalyticsOutlierVideoCard key={signal.video.id} signal={signal} onOpen={() => onOpenVideo(signal.video)} isDark={isDark} />)}
          </div>
        </FeedSection>
      ) : null}

      {showResearch && competitorOutliers.length > 6 ? (
        <FeedSection title="More YouTube Outlier Videos" meta="same niche competitors" isDark={isDark}>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {competitorOutliers.slice(6, 12).map((item) => <YouTubeOutlierCard key={`${item.competitor.id}-${item.video.id}`} item={item} isDark={isDark} />)}
          </div>
        </FeedSection>
      ) : null}

      {activeTab === "Research" && youtubeCompetitors.length ? (
        <FeedSection title="Competitor Channel Details" meta={`${youtubeCompetitors.length} same-niche YouTube channels`} isDark={isDark}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {youtubeCompetitors.slice(0, 8).map((competitor) => <YouTubeCompetitorCard key={competitor.id} competitor={competitor} isDark={isDark} />)}
          </div>
        </FeedSection>
      ) : null}

      {showTikTokSources && sourceCandidates.length ? (
        <FeedSection title="TikTok Source Candidates" meta={`${sourceCandidates.length} candidate channels`} isDark={isDark}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {sourceCandidates.slice(0, 6).map((competitor) => <CompetitorChannelCard key={competitor.id} competitor={competitor} isDark={isDark} />)}
          </div>
        </FeedSection>
      ) : null}

      {showTikTokSources && candidateVideos.length ? (
        <FeedSection title="Candidate Clips" meta={`${candidateVideos.length} ranked TikTok clips`} isDark={isDark}>
          <div className="grid gap-4 sm:grid-cols-3">
            {candidateVideos.slice(0, 6).map((video) => <CompetitorVideoCard key={`${video.competitorId}-${video.url}`} video={video} />)}
          </div>
        </FeedSection>
      ) : null}

      {activeTab === "Analytics" && !outlierSignals.length ? (
        <>
          <FeedInsightCard icon={<Trophy className="h-4 w-4" />} title={achievements[0] || "No urgent analytics alerts"} meta="latest channel signal" isDark={isDark} />
          <div className={cn("py-10 text-center text-lg font-black", isDark ? "text-white/55" : "text-[#1A1A1A]/45")}>
            <CheckCircle2 className="mx-auto mb-3 h-6 w-6" />
            You're all caught up!
          </div>
        </>
      ) : null}

      {showAchievements ? (
        <FeedSection title={`${achievements.length} Achievements`} meta="current channel milestones" isDark={isDark}>
          <div className="space-y-4">
            {achievements.map((achievement, index) => <FeedInsightCard key={`${achievement}-${index}`} icon={<Trophy className="h-4 w-4" />} title={achievement} meta={index === 0 ? "current" : `${index + 1} signals ago`} isDark={isDark} />)}
            {!achievements.length ? <AchievementTile label="Owned library" value={`${dashboard.stats.videoCount} videos`} isDark={isDark} /> : null}
          </div>
        </FeedSection>
      ) : null}

      {showAnalytics ? <div className={cn("rounded-2xl p-5 shadow-sm", isDark ? "bg-[#151923]" : "bg-white")}>
        <div className="flex items-center gap-3">
          <MessageCircle className="h-5 w-5 text-[#f9dc0b]" />
          <div>
            <p className="text-sm font-black">Unanswered Comments</p>
            <p className={cn("text-xs font-bold", isDark ? "text-white/45" : "text-[#1A1A1A]/42")}>Recent comments worth replying to</p>
          </div>
        </div>
        <div className={cn("mt-4 grid gap-3 rounded-2xl p-4", isDark ? "bg-white/6" : "bg-[#F4F5F8]")}>
          <p className="text-sm font-semibold">Run the comment agent to answer high-context comments with concise, useful replies.</p>
          <button className="h-10 rounded-xl bg-[#f9dc0b] px-4 text-sm font-black text-[#1A1A1A]">Open comment agent</button>
        </div>
      </div> : null}
    </div>
  );
}

function FeedStat({ label, value, hint, isDark }: { label: string; value: string; hint: string; isDark: boolean }) {
  return (
    <div className={cn("rounded-3xl p-6 text-center shadow-sm", isDark ? "bg-[#151923]" : "bg-white")}>
      <p className={cn("text-xs font-black uppercase tracking-widest", isDark ? "text-white/42" : "text-[#1A1A1A]/38")}>{label}</p>
      <p className="mt-2 text-3xl font-black tracking-tight sm:text-5xl">{value}</p>
      <div className={cn("mt-5 h-2 rounded-full", isDark ? "bg-white/8" : "bg-[#EDF0F5]")}>
        <div className="h-full w-[72%] rounded-full bg-[#f9dc0b]" />
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

function FeedInsightCard({ icon, title, meta, isDark }: { icon: ReactNode; title: string; meta: string; isDark: boolean }) {
  return (
    <div className={cn("flex min-h-24 items-center gap-4 rounded-2xl p-5 shadow-sm", isDark ? "bg-[#151923] text-white" : "bg-white text-[#111827]")}>
      <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#f9dc0b]/12 text-[#f9dc0b]">{icon}</div>
      <div>
        <p className="text-lg font-black leading-6">{title}</p>
        <p className={cn("mt-1 text-sm font-semibold", isDark ? "text-white/48" : "text-[#1A1A1A]/45")}>{meta}</p>
      </div>
    </div>
  );
}

function PersistedInsightCard({ insight, videos, onOpenVideo, onCopyStyle, styleBusy, isDark }: { insight: FeedInsight; videos: YouTubeDashboardVideo[]; onOpenVideo: (video: YouTubeDashboardVideo) => void; onCopyStyle: (competitor: any) => void; styleBusy: string; isDark: boolean }) {
  const payload = insight.actionPayload || {};
  const video = payload.videoId ? videos.find((item) => item.id === payload.videoId) : null;
  const competitor = payload.competitor;
  const busy = !!competitor && styleBusy === (competitor.channelId || competitor.url || competitor.title);
  if (insight.type === "Analytics" && video) {
    const match = String(insight.body || "").match(/about\s+([0-9.]+x)/i);
    const viewsPerHour = String(insight.body || "").match(/at\s+([^,]+?)\s+views\/hour/i)?.[1] || "";
    return (
      <AnalyticsOutlierVideoCard
        signal={{
          video,
          badge: match?.[1] || `${Math.round(Number(insight.priority || 0))} pts`,
          points: Number(insight.priority || 0),
          viewsPerHour: 0,
          viewMultiple: 0,
          velocityMultiple: 0,
          hint: viewsPerHour ? `${viewsPerHour} views/hour` : insight.body,
        }}
        onOpen={() => onOpenVideo(video)}
        isDark={isDark}
      />
    );
  }
  if (insight.type === "Research" && competitor) {
    return (
      <div className={cn("flex flex-col rounded-2xl p-4 text-center shadow-sm transition hover:-translate-y-0.5", isDark ? "bg-[#151923] text-white" : "bg-white text-[#111827]")}>
        <div className="mx-auto h-16 w-16 shrink-0 overflow-hidden rounded-2xl bg-[#111827]">
          {competitor.thumbnailUrl ? <img src={competitor.thumbnailUrl} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" loading="lazy" /> : <Youtube className="m-auto mt-5 h-6 w-6 text-[#f9dc0b]" />}
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
          <span className="rounded-full bg-[#f9dc0b]/10 px-2.5 py-1 text-[10px] font-black text-[#f9dc0b]">{insight.type}</span>
          <span className={cn("text-[10px] font-bold", isDark ? "text-white/45" : "text-[#1A1A1A]/45")}>{insight.priority ? `${Math.round(insight.priority)} priority` : "live signal"}</span>
        </div>
        <p className="mt-2 text-sm font-black line-clamp-1" title={insight.title}>{insight.title}</p>
        <p className={cn("mt-1 flex-1 text-[11px] font-semibold leading-5 text-left line-clamp-3", isDark ? "text-white/55" : "text-[#1A1A1A]/55")} title={insight.body}>{insight.body}</p>
        <div className="mt-4 grid grid-cols-2 gap-2">
          {video ? (
            <button type="button" onClick={() => onOpenVideo(video)} className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-full bg-[#f9dc0b] text-[11px] font-black text-[#1A1A1A] hover:bg-[#1A1A1A] hover:text-white">
              <PlaySquare className="h-3 w-3 shrink-0" />
              <span className="truncate">{insight.actionLabel || "Open"}</span>
            </button>
          ) : (
            <a href={competitor.url || "#"} target="_blank" rel="noreferrer" className="inline-flex h-9 w-full items-center justify-center rounded-full bg-[#f9dc0b] text-[11px] font-black text-[#1A1A1A] hover:bg-[#1A1A1A] hover:text-white">Track</a>
          )}
          <button type="button" onClick={() => onCopyStyle(competitor)} disabled={busy} className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-full bg-[#f9dc0b] text-[11px] font-black text-[#1A1A1A] transition hover:bg-[#1A1A1A] hover:text-white disabled:opacity-45">
            {busy ? <Loader2 className="h-3 w-3 shrink-0 animate-spin" /> : <Wand2 className="h-3 w-3 shrink-0" />}
            <span className="truncate">Copy</span>
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className={cn("col-span-full rounded-2xl p-4 shadow-sm", isDark ? "bg-[#151923] text-white" : "bg-white text-[#111827]")}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-[#f9dc0b]/10 px-2.5 py-1 text-[11px] font-black text-[#f9dc0b]">{insight.type}</span>
            <span className={cn("text-[11px] font-bold", isDark ? "text-white/38" : "text-[#1A1A1A]/38")}>{insight.priority ? `${Math.round(insight.priority)} priority` : "live signal"}</span>
          </div>
          <p className="mt-2 text-base font-black leading-6">{insight.title}</p>
          <p className={cn("mt-1 text-sm font-semibold leading-6", isDark ? "text-white/55" : "text-[#1A1A1A]/55")}>{insight.body}</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {video ? (
            <button type="button" onClick={() => onOpenVideo(video)} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-[#f9dc0b] px-3 text-xs font-black text-[#1A1A1A]">
              <PlaySquare className="h-4 w-4" />
              {insight.actionLabel || "Open"}
            </button>
          ) : null}
          {competitor ? (
            <button type="button" onClick={() => onCopyStyle(competitor)} disabled={busy} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-[#f9dc0b] px-3 text-xs font-black text-[#1A1A1A] transition hover:bg-[#1A1A1A] hover:text-white disabled:opacity-45">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
              Copy style
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function AnalyticsOutlierVideoCard({ signal, onOpen, isDark }: { signal: ReturnType<typeof buildOwnedOutlierSignals>[number] & { hint?: string }; onOpen: () => void; isDark: boolean }) {
  const video = signal.video;
  const thumbnailUrl = sharpYouTubeThumbnail(video.thumbnailUrl);
  return (
    <StandardVideoCard
      title={video.title}
      source="Channel analytics"
      meta={`${compactNumber(video.viewCount)} views / ${signal.hint || `${compactNumber(signal.viewsPerHour)} views/hour`}`}
      imageUrl={thumbnailUrl}
      badge={signal.badge}
      topRight={<span className="rounded-full bg-[#f9dc0b] px-2.5 py-1 text-xs font-black text-[#1A1A1A]">Analytics</span>}
      onOpen={onOpen}
      theme={isDark ? "dark" : "light"}
    />
  );
}

function TagScoreChip({ tag }: { tag: { label: string; score: number } }) {
  return (
    <span className="inline-flex items-center overflow-hidden rounded-xl bg-[#f9dc0b]/10 text-xs font-black text-[#f9dc0b]">
      <span className="bg-[#fff1a3] px-2.5 py-2 text-[#1A1A1A]">{tag.score}</span>
      <span className="px-2.5 py-2">{tag.label}</span>
    </span>
  );
}

function OptimizationTagCard({ video, tags, onOpen, onPublishTags, publishing, isDark }: { video: YouTubeDashboardVideo; tags: Array<{ label: string; score: number }>; onOpen: () => void; onPublishTags: (tags: string[]) => void; publishing: boolean; isDark: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const thumbnailUrl = sharpYouTubeThumbnail(video.thumbnailUrl);
  const visibleTags = expanded ? tags : tags.slice(0, 5);
  const publishableTags = uniqueTags(visibleTags.map((tag) => tag.label));
  return (
    <div className={cn("rounded-2xl p-4 shadow-sm", isDark ? "bg-[#151923] text-white" : "bg-white text-[#111827]")}>
      <div className="grid gap-4 sm:grid-cols-[160px_1fr]">
        <button type="button" onClick={onOpen} className="group relative aspect-video overflow-hidden rounded-xl bg-[#111827]">
          {thumbnailUrl ? <img src={thumbnailUrl} alt="" className="h-full w-full object-cover transition duration-300 group-hover:scale-105" referrerPolicy="no-referrer" loading="lazy" /> : <PlaySquare className="m-auto mt-10 h-8 w-8 text-[#f9dc0b]" />}
        </button>
        <div className="min-w-0">
          <p className="line-clamp-2 text-base font-black">{video.title}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {visibleTags.map((tag) => <TagScoreChip key={`${video.id}-${tag.label}`} tag={tag} />)}
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <button type="button" onClick={() => tags.length > 5 ? setExpanded((value) => !value) : onOpen()} className={cn("h-10 rounded-full text-sm font-black", isDark ? "bg-white/8 text-white hover:bg-white/12" : "bg-[#F4F5F8] text-[#1A1A1A] hover:bg-[#E8ECF3]")}>{expanded ? "Show fewer" : "Show more"}</button>
            <button type="button" onClick={() => onPublishTags(publishableTags)} disabled={publishing || !publishableTags.length} className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-[#f9dc0b] text-sm font-black text-[#1A1A1A] hover:bg-[#1A1A1A] hover:text-white disabled:opacity-50">
              {publishing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Publish tags
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SuggestedCompetitorCard({ competitor, onCopyStyle, busy, isDark }: { competitor: NonNullable<YouTubeChannelDashboard["growthInsights"]>["youtubeCompetitors"][number]; onCopyStyle: () => void; busy: boolean; isDark: boolean }) {
  return (
    <StandardChannelCard
      title={competitor.title}
      url={competitor.url}
      thumbnailUrl={competitor.thumbnailUrl}
      handle={competitor.handle}
      platform="youtube"
      description={competitor.reason}
      theme={isDark ? "dark" : "light"}
      metrics={[
        { label: "subscribers", value: compactNumber(competitor.subscriberCount), accent: true },
        { label: "VPH", value: compactNumber(competitor.bestViewsPerHour) },
      ]}
      topRight={
        <button type="button" onClick={onCopyStyle} disabled={busy} className="grid h-8 w-8 place-items-center rounded-lg bg-[#f9dc0b] text-[#1A1A1A] transition hover:opacity-85 active:scale-[0.96] disabled:opacity-45" title="Copy channel style" aria-label={`Copy ${competitor.title} channel style`}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
        </button>
      }
    />
  );
}

function YouTubeOutlierCard({ item, isDark }: { item: { competitor: NonNullable<YouTubeChannelDashboard["growthInsights"]>["youtubeCompetitors"][number]; video: NonNullable<YouTubeChannelDashboard["growthInsights"]>["youtubeCompetitors"][number]["recentVideos"][number] }; isDark: boolean }) {
  const multiple = Math.max(1, Math.round((item.video.viewsPerHour / Math.max(1, item.competitor.bestViewsPerHour / 3)) * 10) / 10);
  return (
    <StandardVideoCard
      title={item.video.title}
      source={item.competitor.title}
      meta={`${compactNumber(item.video.viewCount)} views / ${dateAge(item.video.publishedAt)}`}
      imageUrl={item.video.thumbnailUrl}
      href={item.video.url || item.competitor.url}
      badge={`${multiple}x`}
      theme={isDark ? "dark" : "light"}
    />
  );
}

function HorizontalCarousel({ children, isDark }: { children: ReactNode; isDark: boolean }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const scroll = (direction: "left" | "right") => {
    if (scrollRef.current) {
      const { current } = scrollRef;
      const scrollAmount = direction === "left" ? -current.offsetWidth / 1.5 : current.offsetWidth / 1.5;
      current.scrollBy({ left: scrollAmount, behavior: "smooth" });
    }
  };
  return (
    <div className="relative group">
      <button onClick={() => scroll("left")} className={cn("absolute left-0 top-1/2 z-10 -translate-y-1/2 -translate-x-3 h-9 w-9 grid place-items-center rounded-full border shadow-md opacity-0 transition-opacity group-hover:opacity-100", isDark ? "bg-[#151923] border-white/10 text-white hover:bg-white/10" : "bg-white border-[#1A1A1A]/10 text-[#1A1A1A] hover:bg-[#F4F5F8]")} aria-label="Scroll left"><ChevronLeft className="h-4 w-4" /></button>
      <div ref={scrollRef} className="flex gap-4 overflow-x-auto snap-x snap-mandatory pb-4 pt-1 px-1 -mx-1" style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}>
        {children}
      </div>
      <button onClick={() => scroll("right")} className={cn("absolute right-0 top-1/2 z-10 -translate-y-1/2 translate-x-3 h-9 w-9 grid place-items-center rounded-full border shadow-md opacity-0 transition-opacity group-hover:opacity-100", isDark ? "bg-[#151923] border-white/10 text-white hover:bg-white/10" : "bg-white border-[#1A1A1A]/10 text-[#1A1A1A] hover:bg-[#F4F5F8]")} aria-label="Scroll right"><ChevronRight className="h-4 w-4" /></button>
    </div>
  );
}

function FeedVideoCard({ video, multiplier, onClick }: { video: YouTubeDashboardVideo; multiplier: string; onClick: () => void }) {
  const thumbnailUrl = sharpYouTubeThumbnail(video.thumbnailUrl);
  return (
    <StandardVideoCard title={video.title} meta={`${compactNumber(video.viewCount)} views / ${dateAge(video.publishedAt)}`} imageUrl={thumbnailUrl} badge={multiplier} onOpen={onClick} />
  );
}

function YouTubeCompetitorCard({ competitor, isDark }: { competitor: NonNullable<YouTubeChannelDashboard["growthInsights"]>["youtubeCompetitors"][number]; isDark: boolean }) {
  const best = competitor.recentVideos?.[0];
  return (
    <StandardChannelCard
      title={competitor.title || "YouTube competitor"}
      url={competitor.url}
      thumbnailUrl={competitor.thumbnailUrl}
      handle={competitor.handle}
      platform="youtube"
      description={competitor.reason || "Same-niche YouTube channel getting recent traction."}
      theme={isDark ? "dark" : "light"}
      metrics={[
        { label: "subscribers", value: compactNumber(competitor.subscriberCount), accent: true },
        { label: "best views", value: compactNumber(competitor.bestVideoViews) },
        { label: "VPH", value: compactNumber(competitor.bestViewsPerHour) },
        ...(best ? [{ label: "top clip", value: compactNumber(best.viewCount) }] : []),
      ]}
    />
  );
}

function CompetitorChannelCard({ competitor, isDark }: { competitor: NonNullable<YouTubeChannelDashboard["growthInsights"]>["competitors"][number]; isDark: boolean }) {
  const score = Number(competitor.metrics?.score || competitor.metrics?.views || 0);
  const uploads = Number(competitor.metrics?.uploads || 0);
  return (
    <StandardChannelCard
      title={competitor.title || competitor.handle || "Similar channel"}
      url={competitor.url}
      handle={competitor.handle}
      platform={/youtube\.com/i.test(competitor.url || "") ? "youtube" : "tiktok"}
      description={competitor.reason || "Posting content similar to this channel's strongest learned patterns."}
      theme={isDark ? "dark" : "light"}
      metrics={[
        ...(competitor.niche ? [{ label: "", value: competitor.niche }] : []),
        ...(score ? [{ label: "learned views", value: compactNumber(score), accent: true }] : []),
        ...(uploads ? [{ label: "uploads", value: String(uploads) }] : []),
      ]}
    />
  );
}

function CompetitorVideoCard({ video }: { video: NonNullable<YouTubeChannelDashboard["growthInsights"]>["competitorVideos"][number] }) {
  return (
    <StandardVideoCard
      title={video.title}
      source={video.competitorTitle}
      description={video.hookPattern}
      meta={`${compactNumber(video.views)} views`}
      imageUrl={video.thumbnailUrl}
      href={video.url}
      badge={`${compactNumber(video.velocity)} VPH`}
    />
  );
}

function AchievementTile({ label, value, isDark }: { label: string; value: string; isDark: boolean }) {
  return (
    <div className={cn("rounded-2xl p-4 shadow-sm", isDark ? "bg-[#151923]" : "bg-white")}>
      <CheckCircle2 className="h-5 w-5 text-[#f9dc0b]" />
      <p className={cn("mt-3 text-xs font-black uppercase tracking-widest", isDark ? "text-white/38" : "text-[#1A1A1A]/35")}>{label}</p>
      <p className="mt-1 text-lg font-black">{value}</p>
    </div>
  );
}

function TrendGraph() {
  return (
    <svg viewBox="0 0 520 150" className="mt-5 h-36 w-full overflow-visible">
      <defs>
        <linearGradient id="trendFill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#f9dc0b" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#f9dc0b" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d="M0 125 L25 110 L52 118 L78 72 L105 96 L132 86 L158 117 L185 108 L212 121 L238 55 L265 92 L292 73 L318 118 L345 114 L372 103 L398 122 L425 62 L452 97 L478 111 L505 76 L520 88 L520 150 L0 150 Z" fill="url(#trendFill)" />
      <path d="M0 125 L25 110 L52 118 L78 72 L105 96 L132 86 L158 117 L185 108 L212 121 L238 55 L265 92 L292 73 L318 118 L345 114 L372 103 L398 122 L425 62 L452 97 L478 111 L505 76 L520 88" fill="none" stroke="#f9dc0b" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
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
          <p className="text-xs font-bold uppercase tracking-widest text-[#f9dc0b]">{result.dryRun ? "Preview results" : "Posted replies"}</p>
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
            <div className="mt-3 rounded-lg bg-[#f9dc0b]/25 p-3 text-sm font-bold leading-6 text-[#1A1A1A]">
              {item.replyType === "movie_name" ? <span className="mb-1 block text-[10px] font-black uppercase tracking-widest text-[#f9dc0b]">Movie ID reply</span> : null}
              {item.replyType === "ai_engagement_movie_context" ? <span className="mb-1 block text-[10px] font-black uppercase tracking-widest text-[#f9dc0b]">Movie-aware reply</span> : null}
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
      <div className="mb-1.5 flex items-center gap-1.5 text-[#f9dc0b]">
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
    <button type="button" onClick={() => onOpenVideo?.(video)} className="grid grid-cols-[96px_minmax(0,1fr)] gap-3 rounded-lg border border-[#1A1A1A]/8 bg-[#FDFCFA] p-2 text-left transition hover:border-[#1A1A1A]/25">
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

function OptimizeCard({ video, onClick }: { video: YouTubeDashboardVideo; onClick: () => void }) {
  const score = Math.max(58, Math.min(99, Math.round(42 + video.title.length / 2 + (video.viewCount > 1000 ? 10 : 0))));
  const thumbnailUrl = sharpYouTubeThumbnail(video.thumbnailUrl);
  return (
    <button type="button" onClick={onClick} className="group text-left">
      <div className="relative aspect-[9/16] overflow-hidden rounded-2xl bg-[#111827]">
        {thumbnailUrl ? <img src={thumbnailUrl} alt="" className="h-full w-full object-cover transition duration-300 group-hover:scale-105" referrerPolicy="no-referrer" loading="lazy" /> : <div className="grid h-full w-full place-items-center bg-[#f9dc0b]/10 text-[#f9dc0b]"><PlaySquare className="h-8 w-8" /></div>}
        <span className="absolute right-3 top-3 rounded-lg bg-black/75 px-2 py-1 text-[11px] font-black text-white">{formatDuration(video.durationSeconds)}</span>
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/65 to-transparent p-3 text-white">
          <span className="rounded-lg bg-white px-2 py-1 text-xs font-black text-[#6a5b00]">Title {score}</span>
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
            <button key={item} type="button" onClick={() => setTab(item)} className={cn("shrink-0 border-b-2 py-4 text-sm font-black", tab === item ? isDark ? "border-[#f9dc0b] text-white" : "border-[#f9dc0b] text-[#111827]" : isDark ? "border-transparent text-white/45" : "border-transparent text-[#111827]/45")}>
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
                  <button className="mt-4 inline-flex h-10 items-center gap-2 rounded-full bg-[#f9dc0b] px-5 text-sm font-black text-[#1A1A1A]"><Wand2 className="h-4 w-4" />Generate with Nano Banana 2</button>
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
                  <div className="flex flex-wrap gap-2">{["recap", "story explained", "anime", "movie ending", "viral shorts", "character reveal"].map((tag, index) => <span key={tag} className="rounded-xl bg-[#F3F4F8] px-3 py-2 text-sm font-black text-[#6a5b00]">{70 - index * 3} {tag} +</span>)}</div>
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
  return thumbnailUrl ? <img src={thumbnailUrl} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" loading="lazy" /> : <div className="grid h-full place-items-center bg-[#f9dc0b]/10"><PlaySquare className="h-8 w-8 text-[#f9dc0b]" /></div>;
}

function ScorePanel({ label, value }: { label: string; value: number }) {
  return <div className="rounded-2xl bg-[#F3F4F8] p-4"><div className="flex items-center justify-between"><p className="text-sm font-black">{label}</p><span className="rounded-xl bg-[#fff1a3] px-3 py-1 text-sm font-black text-[#6a5b00]">{value}</span></div><div className="mt-4 h-2 rounded-full bg-white"><div className="h-full rounded-full bg-[#f9dc0b]" style={{ width: `${value}%` }} /></div></div>;
}

function TitleOptimizationPanel({ video, optimization, loading, error, fallbackScore, publishing, onPublishTitle }: { video: YouTubeDashboardVideo; optimization: YouTubeVideoOptimization | null; loading: boolean; error: string; fallbackScore: number; publishing: boolean; onPublishTitle: (title: string) => void }) {
  const ideas = optimization?.titleIdeas?.length ? optimization.titleIdeas : [
    { title: video.title, score: fallbackScore, reason: "Current title" },
  ];
  const [selectedTitle, setSelectedTitle] = useState(ideas[0]?.title || video.title);
  useEffect(() => {
    setSelectedTitle(ideas[0]?.title || video.title);
  }, [video.id, optimization?.generatedAt]);
  return (
    <div className="space-y-5 text-[#111827]">
      {loading ? <InlineStatus message="Loading viral title suggestions" /> : null}
      {error ? <Notice tone="error" title="Optimization failed" body={error} /> : null}
      <ScorePanel label="Title score" value={optimization?.titleScore || fallbackScore} />
      <div className="rounded-2xl bg-[#F3F4F8] p-5">
        <p className="text-xs font-black uppercase tracking-widest text-[#111827]/42">Current title</p>
        <p className="mt-3 text-lg font-black">{optimization?.current?.title || video.title}</p>
        <p className="mt-6 text-xs font-bold text-[#111827]/45">{(optimization?.current?.title || video.title).length} of 100</p>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {ideas.slice(0, 3).map((idea) => (
          <button type="button" key={idea.title} onClick={() => setSelectedTitle(idea.title)} className={cn("rounded-2xl border p-3 text-left transition", selectedTitle === idea.title ? "border-[#f9dc0b] bg-[#fff9d6]" : "border-transparent bg-[#F3F4F8] hover:border-[#f9dc0b]/35")}>
            <ThumbPreview video={video} />
            <p className="mt-3 text-sm font-black leading-6">{idea.title}</p>
            <p className="mt-2 text-xs font-bold text-[#6a5b00]">Score {Math.round(Number(idea.score || 0)) || 78}</p>
            <p className="mt-2 text-xs font-semibold leading-5 text-[#111827]/55">{idea.reason}</p>
          </button>
        ))}
      </div>
      <div className="flex flex-col gap-3 rounded-2xl bg-[#F3F4F8] p-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="min-w-0 text-sm font-black leading-6">{selectedTitle}</p>
        <button type="button" onClick={() => onPublishTitle(selectedTitle)} disabled={publishing || !selectedTitle.trim()} className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-[#f9dc0b] px-4 text-xs font-black text-[#1A1A1A] transition hover:bg-[#1A1A1A] hover:text-white disabled:opacity-45">
          {publishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          Publish title
        </button>
      </div>
      {optimization?.taxonomy ? (
        <div className="grid gap-3 md:grid-cols-4">
          <Mini label="Niche" value={optimization.taxonomy.primary || "Learning"} />
          <Mini label="Sub-niche" value={optimization.taxonomy.subNiche || "Unknown"} />
          <Mini label="Micro" value={optimization.taxonomy.microSubNiche || optimization.learnedContext.bestNiche || "Unknown"} />
          <Mini label="Hook" value={(optimization.taxonomy.hookPattern || optimization.learnedContext.bestHook || "curiosity").replace(/-/g, " ")} />
        </div>
      ) : null}
    </div>
  );
}

function SeoOptimizationPanel({ video, optimization, loading, error, publishing, onPublishDescription, onPublishTags }: { video: YouTubeDashboardVideo; optimization: YouTubeVideoOptimization | null; loading: boolean; error: string; publishing: string; onPublishDescription: (description: string) => void; onPublishTags: (tags: string[]) => void }) {
  const [expanded, setExpanded] = useState(false);
  const description = optimization?.description || "";
  const tagScores = (optimization?.tags?.length ? optimization.tags : buildTagSuggestions(video, null).map((tag) => tag.label)).map((tag, index) => ({
    label: keywordLabel(cleanMetadataTag(tag).toLowerCase()),
    score: Math.max(52, 82 - index * 3),
  }));
  const visibleTags = expanded ? tagScores : tagScores.slice(0, 8);
  const publishableTags = uniqueTags(visibleTags.map((tag) => tag.label));
  return (
    <div className="space-y-5 text-[#111827]">
      {loading ? <InlineStatus message="Loading SEO and monetization suggestions" /> : null}
      {error ? <Notice tone="error" title="Optimization failed" body={error} /> : null}
      <div className="rounded-2xl bg-[#F3F4F8] p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm font-black">Optimized description</p>
          <button type="button" onClick={() => onPublishDescription(description)} disabled={publishing === `${video.id}:Description` || !description.trim()} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-[#f9dc0b] px-4 text-xs font-black text-[#1A1A1A] transition hover:bg-[#1A1A1A] hover:text-white disabled:opacity-45">
            {publishing === `${video.id}:Description` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Publish description
          </button>
        </div>
        <p className="mt-3 whitespace-pre-wrap text-sm font-semibold leading-7 text-[#111827]/70">{optimization?.description || "Suggestions will appear after the optimization check finishes."}</p>
      </div>
      <div>
        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-black">Tags for niche, search, and common misspellings</p>
            <p className="mt-1 text-xs font-semibold text-[#111827]/50">Scores are guidance only. AutoYT publishes only the tag text.</p>
          </div>
          <button type="button" onClick={() => onPublishTags(publishableTags)} disabled={publishing === `${video.id}:Tags` || !publishableTags.length} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-[#f9dc0b] px-4 text-xs font-black text-[#1A1A1A] transition hover:bg-[#1A1A1A] hover:text-white disabled:opacity-45">
            {publishing === `${video.id}:Tags` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Publish tags
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          {visibleTags.map((tag) => <TagScoreChip key={`${tag.label}-${tag.score}`} tag={tag} />)}
        </div>
        {tagScores.length > 8 ? <button type="button" onClick={() => setExpanded((value) => !value)} className="mt-3 h-10 rounded-full bg-[#F4F5F8] px-5 text-sm font-black text-[#1A1A1A] hover:bg-[#E8ECF3]">{expanded ? "Show fewer tags" : "Show more tags"}</button> : null}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl bg-[#F3F4F8] p-4">
          <p className="font-black">Action cards</p>
          <div className="mt-3 space-y-2">
            {(optimization?.actionCards || []).map((item) => <p key={item} className="rounded-xl bg-white px-3 py-2 text-sm font-bold leading-6 text-[#111827]/68">{item}</p>)}
            {!optimization?.actionCards?.length ? <p className="text-sm font-semibold text-[#111827]/55">Run more performance checks to unlock channel-specific actions.</p> : null}
          </div>
        </div>
        <div className="rounded-2xl bg-[#F3F4F8] p-4">
          <p className="font-black">Monetization notes</p>
          <div className="mt-3 space-y-2">
            {(optimization?.monetizationNotes || []).map((item) => <p key={item} className="rounded-xl bg-white px-3 py-2 text-sm font-bold leading-6 text-[#111827]/68">{item}</p>)}
            {!optimization?.monetizationNotes?.length ? <p className="text-sm font-semibold text-[#111827]/55">Recommendations will become sharper as this channel builds a performance history.</p> : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function SuggestionGrid({ video }: { video: YouTubeDashboardVideo }) {
  return <div className="grid gap-4 md:grid-cols-3">{["These Clips Are Going Viral", "The Story Everyone Missed", "This Ending Changed Everything"].map((title) => <div key={title} className="rounded-2xl bg-[#F3F4F8] p-3"><ThumbPreview video={video} /><p className="mt-3 text-sm font-black">{title}</p><p className="mt-1 text-xs font-bold text-[#6a5b00]">Score {Math.round(78 + title.length / 3)}</p></div>)}</div>;
}

function ReviewPanel({ video }: { video: YouTubeDashboardVideo }) {
  return <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_280px]"><ThumbPreview video={video} /><div className="space-y-3"><ReviewNote title="The Hook" body="The first seconds need a sharp curiosity promise and a clear reason to keep watching." /><ReviewNote title="Pacing" body="Shorts need fast transitions. Long videos need clearer chapters and topic continuity." /><ReviewNote title="Packaging" body="Title and thumbnail should agree on one emotional promise." /></div></div>;
}

function ReviewNote({ title, body }: { title: string; body: string }) {
  return <div className="rounded-2xl bg-[#F3F4F8] p-4"><p className="font-black">{title}</p><p className="mt-2 text-sm font-semibold leading-6 text-[#111827]/58">{body}</p></div>;
}

function FeedbackLine({ text, good = false }: { text: string; good?: boolean }) {
  return <div className="rounded-2xl bg-[#F3F4F8] px-4 py-3 text-sm font-bold text-[#111827]/65"><span className={cn("mr-2 inline-block h-2 w-2 rounded-full", good ? "bg-[#f9dc0b]" : "bg-[#fff1a3]")} />{text}</div>;
}
