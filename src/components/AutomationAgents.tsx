import { AgentRemake } from "./AgentRemake";
import { DEFAULT_AGENT_REMAKE, MAX_REMAKE_FACES, normalizeAgentRemake, remakeBlocker } from "../utils/agentRemake.js";
import { loadVoiceProfiles, type VoiceProfile } from "../utils/voiceProfiles";
import { VoicePicker } from "./VoicePicker";
import {
  AlertCircle,
  Activity,
  AudioLines,
  ArrowLeft,
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  BarChart3,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Clipboard,
  Clock3,
  ExternalLink,
  Eye,
  Film,
  Heart,
  Layers3,
  LayoutList,
  ListChecks,
  Loader2,
  Menu,
  MessageCircle,
  MessageSquare,
  Mic,
  MicOff,
  Linkedin,
  Navigation,
  Pencil,
  Play,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RefreshCw,
  Search,
  Scissors,
  Settings2,
  Share2,
  ShieldCheck,
  Sparkles,
  Square,
  Table2,
  TrendingUp,
  Trash2,
  Music2,
  Pin,
  Twitter,
  X,
  Youtube,
  Facebook,
  Ghost,
  Instagram,
  Captions,
  Clapperboard,
  Upload,
  UserRound,
  WandSparkles,
} from "lucide-react";
import { FormEvent, ReactNode, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AuthSessionPayload,
  AgentLearningProfile,
  AutomationAgent,
  AutomationRun,
  AutomationSourceSummary,
  AutomationUpload,
  ConnectedYouTubeAccount,
  MovieResult,
  YouTubePlaylistSummary,
} from "../types";
import { cn } from "../lib/utils";
import { fetchTikTokPlaylist, resolveTikTokSource } from "../services/tiktok";
import { isTikTokUrl } from "../utils/tiktokUrl.js";
import { writeDeepLink } from "../utils/tiktokRoute";
import {
  AGENT_CREATE_STEPS,
  agentCreateFirstIncompleteStep,
  agentCreateStepError,
  agentGettingStartedSteps,
  suggestAgentName,
} from "../utils/agentCreateJourney";
import { announceBackgroundProcess } from "../utils/backgroundProcesses";
import { toast, useErrorToast } from "../utils/toast";
import { connectHref, PlatformGrid, PlatformIcon, socialPlatform } from "./SocialPlatforms";
import { CompilationStudio } from "./CompilationStudio";
import { openBackgroundProcessCenter } from "./BackgroundProcessCenter";
import { agentUploadMedia, buildAgentAnalyticsViz, readAgentUploadMetric } from "../utils/agentAnalyticsViz";
import {
  AgentChatBlocks,
  FormattedChatText,
  PerformanceReportView,
  type AgentChatBlock,
  type AgentPerformanceReport,
} from "./AgentStructuredContent";
import { MovieAnalysisTabs } from "./MovieAnalysisTabs";
import { JuelDock, JuelPanel, onJuelChange, provideJuelContext } from "./JuelPanel";
import { SourcePicker, type SourceOption } from "./SourcePicker";
import { SourcePoolUsage } from "./SourcePoolUsage";
import { scheduleHourFromUtcLabel } from "../utils/automationDecisionPolicy.js";
import "./AutomationAgents.css";
import { type PlaylistMode, PlaylistControl, SCHEDULED_VISIBILITY_OPTIONS, VisibilityControl } from "./YouTubePublishForm";
import { choose, confirm, Dialog } from "./ui/Dialog";
import { EmptyState, Notice as SharedNotice, SearchField, Switch } from "./ui/controls";
import { OrientationPicker } from "./OrientationPicker";
import { BrandLoader } from "./BrandLoader";

const DEFAULT_SETTINGS = {
  maxPostsPerDay: 1,
  scheduleTimes: ["09:00", "18:00"],
  scheduleLeadMinutes: 120,
  timezone: "Africa/Nairobi",
  publishMode: "schedule",
  searchDepth: 120,
  sourcePriority: "views",
  dynamicSourceLearning: true,
  sourceExplorationEnabled: true,
  sourceExplorationChannels: 6,
  sourceUnderperformingViewThreshold: 1000,
  sourceNicheMode: "balanced",
  adaptiveStrategyEnabled: true,
  adaptiveSchedulingEnabled: true,
  adaptiveScheduleOverrideEnabled: false,
  adaptiveMetadataEnabled: true,
  adaptiveRecoveryEnabled: true,
  sourceTags: [],
  movieIdEnabled: true,
  includeSideChannels: true,
  sideChannels: [""],
  microNicheGoal: "Identify repeatable movie recap micro-sub-niches with strong curiosity hooks and low direct competition.",
  genreFocus: "Movie recaps",
  titleStyle: "viral-curiosity",
  postAsShort: true,
  targetVideoLengthSeconds: 150,
  publishTargets: [],
  socialTargets: [],
  madeForKids: false,
  categoryId: "24",
  targetPlaylistMode: "auto",
  targetPlaylistId: "",
  targetPlaylistTitle: "",
  createTargetPlaylist: false,
  autoCreatePlaylists: true,
  avoidMovieRepeats: true,
  performanceCadenceEnabled: true,
  performanceCheckHours: 3,
  stagnationWindowHours: 12,
  minViewDeltaPercent: 5,
  communityManagementEnabled: true,
  aiEngagementRepliesEnabled: true,
  maxCommentRepliesPerCheck: 5,
  commentReplyTone: "warm-curious",
  commentReplyInstructions: "Reply like the channel owner: short, natural, friendly, and designed to keep the conversation going.",
  compilationEnabled: false,
  compilationMinMinutes: 30,
  compilationMaxMinutes: 40,
  compilationMaxClips: 300,
  compilationTitle: "",
  compilationDescription: "",
  compilationLayout: "vertical",
  rightsConfirmed: false,
};

export type AutomationTab = "chat" | "overview" | "analytics" | "report" | "setup" | "voice" | "compile" | "uploads" | "runs";
const JUEL_AGENT_TABS: AutomationTab[] = ["overview", "analytics", "report", "setup", "voice", "compile", "uploads", "runs", "chat"];
type SetupSubTab = "basics" | "source" | "schedule" | "learning" | "comments" | "safety";
type AgentRunOptions = { stayInChat?: boolean; throwOnError?: boolean };

type MonetizationStatus = "ready" | "no_data" | "missing_scope" | "not_connected" | "unsupported" | "error";

type MonetizationMetricRow = Record<string, number | string | null | undefined>;

interface YouTubeMonetizationSnapshot {
  status?: MonetizationStatus;
  state?: MonetizationStatus;
  authorized?: boolean;
  reauthorizationRequired?: boolean;
  reauthorizeUrl?: string;
  currency?: string;
  message?: string;
  period?: {
    days?: number;
    current?: { startDate?: string; endDate?: string };
    previous?: { startDate?: string; endDate?: string };
  };
  current?: MonetizationMetricRow;
  previous?: MonetizationMetricRow;
  changes?: Record<string, number | MonetizationMetricRow | null | undefined>;
  change?: Record<string, number | MonetizationMetricRow | null | undefined>;
  daily?: MonetizationMetricRow[];
  topVideos?: MonetizationMetricRow[];
}

const TABS: Array<{ id: AutomationTab; label: string; icon: ReactNode }> = [
  { id: "chat", label: "Chat", icon: <MessageSquare className="h-4 w-4" /> },
  { id: "overview", label: "Overview", icon: <LayoutList className="h-4 w-4" /> },
  { id: "setup", label: "Setup", icon: <Settings2 className="h-4 w-4" /> },
  { id: "uploads", label: "Uploads", icon: <Table2 className="h-4 w-4" /> },
  { id: "analytics", label: "Analytics", icon: <BarChart3 className="h-4 w-4" /> },
  { id: "report", label: "Report", icon: <TrendingUp className="h-4 w-4" /> },
  { id: "runs", label: "Run log", icon: <Clock3 className="h-4 w-4" /> },
  { id: "voice", label: "Remake", icon: <AudioLines className="h-4 w-4" /> },
  { id: "compile", label: "Compile", icon: <Layers3 className="h-4 w-4" /> },
];
/** Everyday tabs come first in the agent menu; the rest sit below a divider. */
const PRIMARY_TAB_COUNT = 5;

type SetupSectionId = "essentials" | "format" | "sources" | "socials" | "learning" | "comments" | "compilations" | "rights";


/** Maps the legacy setup sub-tab (used by deep links and overview shortcuts) to the section it now lives in. */
const SETUP_SUBTAB_SECTION: Record<SetupSubTab, SetupSectionId> = {
  basics: "essentials",
  source: "sources",
  schedule: "essentials",
  learning: "learning",
  comments: "comments",
  safety: "rights",
};

type AgentTheme = "light" | "dark";

function getAgentTheme(theme: AgentTheme) {
  const isDark = theme === "dark";
  return {
    isDark,
    surface: isDark ? "border-[var(--ui-line-strong)] bg-[var(--ui-panel)]" : "border-[var(--ui-line-strong)] bg-[var(--ui-panel)]",
    surfaceSoft: isDark ? "border-[var(--ui-line)] bg-[var(--ui-bg)]" : "border-[var(--ui-line-strong)] bg-[var(--ui-bg)]",
    highlight: isDark ? "border-[var(--ui-accent)]/35 bg-[var(--ui-accent-soft)]" : "border-[var(--ui-accent)]/40 bg-[var(--ui-accent-soft)]",
    accentPanel: "border-[var(--ui-accent)]/30 bg-[var(--ui-accent)]/12",
    text: isDark ? "text-[var(--ui-text)]" : "text-[var(--ui-text)]",
    muted: isDark ? "text-[var(--ui-text)]/58" : "text-[var(--ui-text)]/65",
    subtle: isDark ? "text-[var(--ui-text)]/42" : "text-[var(--ui-text)]/42",
    textSoft: isDark ? "text-[var(--ui-text)]/82" : "text-[var(--ui-text)]/82",
    divider: isDark ? "border-[var(--ui-line)]" : "border-[var(--ui-line-strong)]",
    tabInactive: isDark ? "text-[var(--ui-text)]/62 hover:text-[var(--ui-text)]" : "text-[var(--ui-text)]/62 hover:text-[var(--ui-text)]",
    tabActive: isDark ? "text-[var(--ui-text)]" : "text-[var(--ui-text)]",
    setupTabActive: isDark ? "bg-[var(--ui-panel)] text-[var(--ui-text)] shadow-sm" : "bg-[var(--ui-panel)] text-[var(--ui-text)] shadow-sm",
    setupTabIdle: isDark ? "text-[var(--ui-text)]/55 hover:bg-[var(--ui-text)]/6 hover:text-[var(--ui-text)]" : "text-[var(--ui-text)]/55 hover:bg-white/80 hover:text-[var(--ui-text)]",
  };
}

function formatDate(value?: number | null): string {
  if (!value) return "Not scheduled";
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Africa/Nairobi" }).format(new Date(value));
}

function agentNextRunLabel(agent?: AutomationAgent | null): string {
  if (!agent) return "Not scheduled";
  if (agent.status !== "active") return "Paused";
  return formatDate(agent.nextRunAt);
}

function normalizePostTimeInput(value: string): string {
  const raw = value.trim().toLowerCase().replace(/\./g, "");
  const match = raw.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!match) return "";
  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  const meridiem = match[3] || "";
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || minute < 0 || minute > 59) return "";
  if (meridiem) {
    if (hour < 1 || hour > 12) return "";
    if (hour === 12) hour = 0;
    if (meridiem === "pm") hour += 12;
  } else if (hour < 0 || hour > 23) {
    return "";
  }
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function cleanScheduleTimes(values: unknown): string[] {
  const next = Array.isArray(values)
    ? values.map((value) => normalizePostTimeInput(String(value || ""))).filter(Boolean)
    : [];
  return next.length ? next : ["09:00"];
}

function compact(value?: number | string | null): string {
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(Number(value || 0));
}

function monetizationNumber(row: MonetizationMetricRow | null | undefined, ...keys: string[]): number {
  for (const key of keys) {
    const raw = row?.[key];
    if (raw === null || raw === undefined || raw === "") continue;
    const value = Number(raw);
    if (Number.isFinite(value)) return value;
  }
  return 0;
}

function monetizationCurrency(value: number, currency = "USD"): string {
  try {
    return new Intl.NumberFormat("en", {
      style: "currency",
      currency: currency || "USD",
      minimumFractionDigits: Math.abs(value) < 100 ? 2 : 0,
      maximumFractionDigits: Math.abs(value) < 100 ? 2 : 0,
    }).format(value);
  } catch {
    return `${currency || "USD"} ${value.toFixed(2)}`;
  }
}

function monetizationChange(snapshot: YouTubeMonetizationSnapshot, key: string): number | null {
  const source = snapshot.changes || snapshot.change;
  const hasReportedChange = Boolean(source && Object.prototype.hasOwnProperty.call(source, key));
  const raw = source?.[key];
  if (hasReportedChange && raw === null) return null;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (raw && typeof raw === "object") {
    for (const field of ["percent", "percentage", "percentChange", "changePercent", "value"]) {
      const candidate = raw[field];
      if (candidate === null || candidate === undefined || candidate === "") continue;
      const value = Number(candidate);
      if (Number.isFinite(value)) return value;
    }
    return null;
  }
  const current = monetizationNumber(snapshot.current, key);
  const previous = monetizationNumber(snapshot.previous, key);
  if (!previous) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

function metric(upload: AutomationUpload | null, key: "viewCount" | "likeCount" | "commentCount"): number {
  return readAgentUploadMetric(upload, key);
}

function normalizeSourceIdentity(value?: string | null): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    const meaningfulQueryKeys = new Set(["collection_id", "collectionid", "keyword", "list", "list_id", "listid", "mix_id", "mixid", "playlist_id", "playlistid", "q", "v"]);
    const meaningfulQuery = Array.from(parsed.searchParams.entries())
      .filter(([key]) => meaningfulQueryKeys.has(key.toLowerCase()))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, queryValue]) => `${key.toLowerCase()}=${queryValue}`)
      .join("&");
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    const path = parsed.pathname.replace(/\/+$/, "").toLowerCase();
    return `${host}${path}${meaningfulQuery ? `?${meaningfulQuery}` : ""}`;
  } catch {
    return raw.split("#")[0].split("?")[0].replace(/\/+$/, "").toLowerCase();
  }
}

/**
 * What a person pasted, as the source URL to save. TikTok links of every shape (phone share
 * text, vm./vt. short links, a video from the channel) resolve server-side to the channel or
 * collection; other links just lose surrounding text and gain https:// when it is missing.
 */
async function resolvePastedSource(raw: string): Promise<string> {
  const text = raw.trim();
  if (isTikTokUrl(text)) return (await resolveTikTokSource(text)).url;
  const link = text.match(/https?:\/\/\S+/i)?.[0] || text;
  return /^https?:\/\//i.test(link) || !/^[a-z0-9.-]+\.[a-z]{2,}(?:\/|$)/i.test(link) ? link : `https://${link}`;
}

function isTikTokSourceUrl(value: string): boolean {
  try {
    const host = new URL(value).hostname.toLowerCase().replace(/^www\./, "");
    return host === "tiktok.com" || host.endsWith(".tiktok.com");
  } catch {
    return false;
  }
}

function sourceIdentityMatches(source: AutomationSourceSummary, sourceKey?: string | null, sourceUrl?: string | null): boolean {
  const wanted = [sourceUrl, sourceKey].map(normalizeSourceIdentity).filter(Boolean);
  const available = [source.key, source.analyzedUrl].map(normalizeSourceIdentity).filter(Boolean);
  return wanted.some((value) => available.includes(value));
}

function findSelectedSource(sources: AutomationSourceSummary[], sourceKey?: string | null, sourceUrl?: string | null): AutomationSourceSummary | null {
  const exactMatch = sources.find((source) => sourceIdentityMatches(source, sourceKey, sourceUrl));
  if (exactMatch) return exactMatch;
  const wantedSlug = normalizeSourceIdentity(sourceKey);
  if (!wantedSlug) return null;
  const slugMatches = sources.filter((source) => normalizeSourceIdentity(source.slug) === wantedSlug);
  return slugMatches.length === 1 ? slugMatches[0] : null;
}

function isTikTokPublishAccount(account?: ConnectedYouTubeAccount | null): boolean {
  return String(account?.platform || "").toLowerCase() === "tiktok";
}

function publishAccountLabel(account: ConnectedYouTubeAccount): string {
  const platform = isTikTokPublishAccount(account) ? "TikTok" : "YouTube";
  const warning = isTikTokPublishAccount(account) && account.zernioConnected === false ? " · needs reconnect" : "";
  return `${account.channelTitle} · ${platform}${warning}`;
}

/** JSON with sorted object keys so two forms with the same values always serialize identically. */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}

/** The editable form state for a saved agent. Used both to load the form and to detect unsaved changes. */
function formFromAgent(agent: AutomationAgent) {
  return {
    id: agent.id,
    youtubeAccountId: agent.youtubeAccountId,
    name: agent.name,
    status: agent.status,
    sourceType: agent.sourceType,
    sourceKey: agent.sourceKey,
    sourceUrl: agent.sourceUrl,
    settings: { ...DEFAULT_SETTINGS, ...(agent.settings || {}) },
  };
}

function formatClipLength(seconds: number): string {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function collectSourceTags(sources: AutomationSourceSummary[]): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const source of sources) {
    for (const raw of [...(source.tags || []), ...(source.autoTags || []), ...(source.allTags || [])]) {
      const tag = String(raw || "").replace(/\s+/g, " ").trim();
      const key = tag.toLowerCase();
      if (!tag || seen.has(key)) continue;
      seen.add(key);
      tags.push(tag);
    }
  }
  return tags.sort((a, b) => a.localeCompare(b));
}

function sourceDisplayName(source: AutomationSourceSummary): string {
  const title = source.title?.trim() || source.slug?.replace(/[-_]+/g, " ") || "Saved collection";
  const platform = source.platform === "youtube" ? "YouTube" : source.platform === "tiktok" ? "TikTok" : "";
  return platform ? `${title} · ${platform} (${source.videoCount})` : `${title} (${source.videoCount})`;
}

function sourcePickerOption(source: AutomationSourceSummary): SourceOption {
  const channel = /\/@[^/]+\/?$|\/channel\/[^/]+\/?$/.test(source.analyzedUrl || "");
  return { value: source.key, label: source.title || source.slug || "Saved source", imageUrl: channel ? (source.profileImageUrl || source.thumb) : source.thumb, kind: channel ? "channel" : "collection" };
}

/** The agent opened by default: the active channel's live agent, then any agent on that channel, then the first active agent. */
function defaultAgentFor(agents: AutomationAgent[], accountId: string): AutomationAgent | null {
  return agents.find((agent) => agent.youtubeAccountId === accountId && agent.status === "active")
    || agents.find((agent) => agent.youtubeAccountId === accountId)
    || agents.find((agent) => agent.status === "active")
    || agents[0]
    || null;
}

async function readApiJson(response: Response, fallback: string): Promise<any> {
  const text = await response.text();
  let data: any = {};
  if (text.trim()) {
    try {
      data = JSON.parse(text);
    } catch {
      const snippet = text.replace(/\s+/g, " ").slice(0, 140);
      throw new Error(`${fallback}. Server returned ${response.status} ${response.statusText || ""}: ${snippet}`);
    }
  }
  if (!response.ok) throw new Error(data.error || fallback);
  return data;
}

async function readAgentChatResponse(response: Response, onProgress: (message: string) => void): Promise<any> {
  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  if (!contentType.includes("application/x-ndjson")) return readApiJson(response, "Agent chat failed");
  if (!response.body) throw new Error("Agent chat returned an empty response.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: any = null;

  const consumeLine = (line: string) => {
    if (!line.trim()) return;
    let event: any;
    try {
      event = JSON.parse(line);
    } catch {
      throw new Error("Agent chat returned an unreadable progress update.");
    }
    if (event.type === "progress" && typeof event.message === "string") onProgress(event.message);
    if (event.type === "result") result = event.data;
    if (event.type === "error") throw new Error(String(event.error || "Agent chat failed"));
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) consumeLine(line);
      if (done) break;
    }
    consumeLine(buffer);
  } catch (error) {
    // Release the socket when a mid-stream error line or malformed chunk aborts parsing.
    await reader.cancel().catch(() => undefined);
    throw error;
  }
  if (!result) throw new Error("Agent chat finished without a response.");
  return result;
}

export function AutomationAgents({ auth, initialSlug = "", initialTab, initialUploadId = "", onDetailChange, chatSidebarHost = null, theme = "light" }: { auth: AuthSessionPayload; initialSlug?: string; initialTab?: AutomationTab; initialUploadId?: string; onDetailChange?: (open: boolean) => void; chatSidebarHost?: HTMLElement | null; theme?: "light" | "dark" }) {
  const [accounts, setAccounts] = useState<ConnectedYouTubeAccount[]>(auth.accounts || []);
  const [sources, setSources] = useState<AutomationSourceSummary[]>([]);
  const [agents, setAgents] = useState<AutomationAgent[]>([]);
  const [routeAgent, setRouteAgent] = useState<AutomationAgent | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [activeTab, setActiveTab] = useState<AutomationTab>(initialTab || "overview");
  const [setupSubTab, setSetupSubTab] = useState<SetupSubTab>("basics");
  const [creatingNew, setCreatingNew] = useState(initialSlug === "new");
  const [createStep, setCreateStep] = useState(0);
  const [togglingStatus, setTogglingStatus] = useState("");
  const [selectedUploadId, setSelectedUploadId] = useState(initialUploadId);
  const [runs, setRuns] = useState<AutomationRun[]>([]);
  const [uploads, setUploads] = useState<AutomationUpload[]>([]);
  const [learning, setLearning] = useState<AgentLearningProfile | null>(null);
  const [agentReport, setAgentReport] = useState<AgentPerformanceReport | null>(null);
  const [playlists, setPlaylists] = useState<YouTubePlaylistSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingPlaylists, setLoadingPlaylists] = useState(false);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState<string[]>([]);
  const [stopping, setStopping] = useState<string[]>([]);
  const [runningCompilation, setRunningCompilation] = useState("");
  const [reuploading, setReuploading] = useState("");
  const [deletingUpload, setDeletingUpload] = useState("");
  const [deleting, setDeleting] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  // Errors and confirmations go through the app's one toast system.
  useErrorToast(error, () => setError(""), { title: "Action needs attention" });
  useEffect(() => {
    if (!notice) return;
    toast.success(notice);
    setNotice("");
  }, [notice]);
  const [form, setForm] = useState<any>({
    youtubeAccountId: auth.activeAccount?.id || "",
    name: suggestAgentName(auth.activeAccount?.channelTitle),
    status: "paused",
    sourceType: "saved_playlist",
    sourceKey: "",
    sourceUrl: "",
    settings: DEFAULT_SETTINGS,
  });

  // Agents always open directly: an explicit route wins, then the current
  // selection, then the default agent for the active publish channel.
  const requestedSlug = initialSlug && initialSlug !== "new" ? decodeURIComponent(initialSlug) : "";
  const defaultAgent = useMemo(() => {
    const accountId = auth.activeAccount?.id || accounts[0]?.id || "";
    return defaultAgentFor(agents, accountId);
  }, [accounts, agents, auth.activeAccount?.id]);
  const routeAgentMatch = useMemo(() => {
    if (!requestedSlug) return null;
    const fromList = agents.find((agent) => agent.slug === requestedSlug || agent.id === requestedSlug);
    if (fromList) return fromList;
    return routeAgent && (routeAgent.slug === requestedSlug || routeAgent.id === requestedSlug) ? routeAgent : null;
  }, [agents, requestedSlug, routeAgent]);
  const selectedAgent = useMemo(() => {
    if (creatingNew) return null;
    // An explicit route always wins, so a stale selection can never mask a missing agent.
    if (requestedSlug) return routeAgentMatch;
    const fromList = agents.find((agent) => agent.id === selectedId);
    if (fromList) return fromList;
    if (selectedId && routeAgent?.id === selectedId) return routeAgent;
    return defaultAgent;
  }, [agents, creatingNew, defaultAgent, requestedSlug, routeAgent, routeAgentMatch, selectedId]);
  const agentRouteMissing = Boolean(requestedSlug) && !creatingNew && !selectedAgent && !loading;
  const detailOpen = creatingNew || !!selectedAgent || Boolean(requestedSlug);
  const selectedUpload = useMemo(() => uploads.find((upload) => upload.id === selectedUploadId) || null, [uploads, selectedUploadId]);
  const activeAccount = useMemo(() => accounts.find((account) => account.id === selectedAgent?.youtubeAccountId)
    || accounts.find((account) => account.id === form.youtubeAccountId)
    || auth.activeAccount
    || accounts[0]
    || null, [accounts, auth.activeAccount, form.youtubeAccountId, selectedAgent?.youtubeAccountId]);
  const selectAgentTab = useCallback((tab: AutomationTab) => {
    setActiveTab(tab);
    const currentAgent = selectedAgent || routeAgent || agents.find((item) => item.id === selectedId) || null;
    const slug = currentAgent?.slug || currentAgent?.id || (initialSlug && initialSlug !== "new" ? initialSlug : "");
    writeDeepLink(slug ? { view: "automation", slug, automationTab: tab } : { view: "automation", automationTab: tab });
  }, [agents, initialSlug, routeAgent, selectedAgent, selectedId]);
  const openUploadDetail = useCallback((uploadId: string) => {
    setSelectedUploadId(uploadId);
    const currentAgent = selectedAgent || routeAgent || agents.find((item) => item.id === selectedId) || null;
    const slug = currentAgent?.slug || currentAgent?.id || (initialSlug && initialSlug !== "new" ? initialSlug : "");
    writeDeepLink(slug
      ? { view: "automation", slug, automationTab: "uploads", uploadId: uploadId || undefined }
      : { view: "automation", automationTab: "uploads", uploadId: uploadId || undefined });
  }, [agents, initialSlug, routeAgent, selectedAgent, selectedId]);
  const successfulRuns = runs.filter((run) => run.status === "success").length;
  const selectedIdRef = useRef(selectedId);
  const mountedRef = useRef(true);
  const syncedChatAccountIdRef = useRef("");

  useEffect(() => () => {
    mountedRef.current = false;
  }, []);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    setAccounts(auth.accounts || []);
  }, [auth.accounts]);

  useEffect(() => {
    if (initialTab) setActiveTab(initialTab);
    if (initialUploadId) setSelectedUploadId(initialUploadId);
  }, [initialTab, initialUploadId, initialSlug]);

  const loadPlaylists = useCallback(async (accountId = form.youtubeAccountId) => {
    if (!accountId) {
      setPlaylists([]);
      return;
    }
    setLoadingPlaylists(true);
    try {
      const response = await fetch(`/api/youtube/playlists?accountId=${encodeURIComponent(accountId)}`);
      const data = await readApiJson(response, "Could not load YouTube playlists");
      setPlaylists((data.playlists || []) as YouTubePlaylistSummary[]);
    } catch {
      setPlaylists([]);
    } finally {
      setLoadingPlaylists(false);
    }
  }, [form.youtubeAccountId]);

  const authRef = useRef(auth);
  authRef.current = auth;
  const loadAll = useCallback(async () => {
    const auth = authRef.current;
    setLoading(true);
    setError("");
    try {
      // Independent, so both requests go out at once.
      const [optionsData, agentsData] = await Promise.all([
        fetch("/api/automation/options").then((response) => readApiJson(response, "Could not load automation options")),
        fetch("/api/automation/agents").then((response) => readApiJson(response, "Could not load automation agents")),
      ]);
      const nextAccounts = (optionsData.accounts || auth.accounts || []) as ConnectedYouTubeAccount[];
      const nextSources = (optionsData.sources || []) as AutomationSourceSummary[];
      const nextAgents = (agentsData.agents || []) as AutomationAgent[];
      setAccounts(nextAccounts);
      setSources(nextSources);
      setAgents(nextAgents);
      setForm((prev: any) => ({
        ...prev,
        youtubeAccountId: prev.youtubeAccountId || nextAccounts[0]?.id || "",
        sourceKey: prev.sourceKey || prev.sourceUrl ? prev.sourceKey : nextSources[0]?.key || "",
        sourceUrl: prev.sourceKey || prev.sourceUrl ? prev.sourceUrl : nextSources[0]?.analyzedUrl || "",
      }));
      setSelectedId((prev) => {
        // A draft agent must never resolve to an existing agent.
        if (initialSlug === "new") return "";
        if (!initialSlug) {
          const accountId = auth.activeAccount?.id || nextAccounts[0]?.id || "";
          return defaultAgentFor(nextAgents, accountId)?.id || "";
        }
        const wanted = decodeURIComponent(initialSlug);
        const match = nextAgents.find((agent) => agent.slug === wanted || agent.id === wanted);
        if (match) return match.id;
        return nextAgents.some((agent) => agent.id === prev) ? prev : "";
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Automation unavailable");
    } finally {
      setLoading(false);
    }
  }, [initialSlug]);

  const analyzeSourceUrl = useCallback(async (rawUrl: string) => {
    const url = rawUrl.trim();
    if (!isTikTokSourceUrl(url)) return true;
    // Quick first page so Setup stays interactive; full catalog continues in the background.
    const playlist = await fetchTikTokPlaylist(url, 24);
    if (!playlist.videos.length) throw new Error("TikTok returned no videos for this source");
    try {
      const response = await fetch("/api/saved/tiktok-playlists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rawUrl: url, playlist, analyzedUrl: url }),
      });
      await readApiJson(response, "Could not save TikTok source");
    } catch (error) {
      console.warn("Automatic TikTok source save skipped:", error instanceof Error ? error.message : error);
    }
    void fetch("/api/saved/tiktok-playlists/deep-scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url,
        knownCount: playlist.videos.length,
        seedVideoUrl: playlist.videos[0]?.playUrl || "",
        targetCount: 2000,
      }),
    })
      .then((response) => {
        if (response.ok || response.status === 202) announceBackgroundProcess();
      })
      .catch((error) => {
        console.warn("Background TikTok deep scan skipped:", error instanceof Error ? error.message : error);
      });
    await loadAll();
    return true;
  }, [loadAll]);

  const syncActiveRuns = useCallback(async () => {
    try {
      const response = await fetch("/api/automation/active-runs");
      const data = await readApiJson(response, "Could not load active candidate runs");
      const active = Array.isArray(data.runs) ? data.runs : [];
      setRunning(active.map((run: any) => String(run.agentId || "")).filter(Boolean));
      setStopping(active.filter((run: any) => run.stopping).map((run: any) => String(run.agentId || "")).filter(Boolean));
    } catch {
      // A transient status check should not interrupt an active run request.
    }
  }, []);

  const loadAgentDetail = useCallback(async (id: string, syncSelection = false, options: { silent?: boolean } = {}) => {
    if (!id) {
      setRuns([]);
      setUploads([]);
      setRouteAgent(null);
      setAgentReport(null);
      return;
    }
    try {
      // The report doesn't need the detail first: fetch both at once.
      const reportRequest = fetch(`/api/automation/agents/${encodeURIComponent(id)}/report`)
        .then((reportResponse) => readApiJson(reportResponse, "Could not load agent report"))
        .then((reportData) => reportData.report || null)
        .catch(() => null);
      const response = await fetch(`/api/automation/agents/${encodeURIComponent(id)}`);
      const data = await readApiJson(response, "Could not load agent detail");
      if (data.agent) {
        setRouteAgent(data.agent);
        if (syncSelection) setSelectedId(data.agent.id);
      }
      setRuns(data.runs || []);
      setUploads(data.uploads || []);
      setLearning(data.learning || null);
      setAgentReport(await reportRequest);
    } catch (err) {
      // A deep link that cannot be opened reports itself in the board instead of a toast.
      if (!options.silent) setError(err instanceof Error ? err.message : "Could not load agent detail");
    }
  }, []);

  useEffect(() => {
    void loadAll();
    void syncActiveRuns();
  }, [loadAll, syncActiveRuns]);

  // Juel works from the open agent: it reads the agent, can switch this page's tab or open an upload, and
  // the page reloads when Juel changes something.
  const selectedAgentId = selectedAgent?.id || "";
  const selectedAgentName = selectedAgent?.name || "";
  useEffect(() => {
    if (!selectedAgentId) return;
    const stopContext = provideJuelContext(() => ({
      surface: "automation",
      entityId: selectedAgentId,
      label: `Agent: ${selectedAgentName || "automation"}`,
      details: { tab: activeTab, uploadOpen: selectedUploadId || null },
      clientTools: {
        specialist: "automation",
        actions: {
          open_tab: { args: `{tab: ${JUEL_AGENT_TABS.join("|")}}`, about: "Show a tab of this agent's page", risk: "change" },
          open_upload: { args: "{uploadId}", about: "Open one of this agent's uploads", risk: "change" },
        },
      },
    }));
    const onActions = (event: Event) => {
      const { surface, actions } = (event as CustomEvent<{ surface: string; actions: { type: string; args?: any }[] }>).detail || {};
      if (surface !== "automation") return;
      for (const action of actions || []) {
        if (action.type === "open_tab" && JUEL_AGENT_TABS.includes(action.args?.tab)) selectAgentTab(action.args.tab);
        else if (action.type === "open_upload" && action.args?.uploadId) {
          setActiveTab("uploads");
          openUploadDetail(String(action.args.uploadId));
        }
      }
    };
    window.addEventListener("juel:page-actions", onActions);
    const stopReload = onJuelChange(() => {
      void loadAll();
      void loadAgentDetail(selectedAgentId);
    });
    return () => {
      stopContext();
      stopReload();
      window.removeEventListener("juel:page-actions", onActions);
    };
  }, [activeTab, loadAgentDetail, loadAll, openUploadDetail, selectAgentTab, selectedAgentId, selectedAgentName, selectedUploadId]);

  useEffect(() => {
    const timer = window.setInterval(() => void syncActiveRuns(), 3000);
    return () => window.clearInterval(timer);
  }, [syncActiveRuns]);

  useEffect(() => {
    void loadPlaylists(form.youtubeAccountId);
  }, [form.youtubeAccountId, loadPlaylists]);

  useEffect(() => {
    setSelectedUploadId(initialUploadId || "");
    void loadAgentDetail(selectedId);
  }, [initialUploadId, loadAgentDetail, selectedId]);

  useEffect(() => {
    if (!initialSlug) {
      setSelectedId("");
      setCreatingNew(false);
      setRouteAgent(null);
      setRuns([]);
      setUploads([]);
      setLearning(null);
      setAgentReport(null);
      return;
    }
    if (initialSlug === "new") {
      setSelectedId("");
      setCreatingNew(true);
      setSelectedUploadId("");
      setRuns([]);
      setUploads([]);
      setLearning(null);
      setAgentReport(null);
      setActiveTab("setup");
      setSetupSubTab("basics");
      return;
    }
    if (!initialSlug) return;
    const wanted = decodeURIComponent(initialSlug);
    const bySlug = agents.find((agent) => agent.slug === wanted || agent.id === wanted);
    if (bySlug && bySlug.id !== selectedId) {
      setCreatingNew(false);
      setRouteAgent(bySlug);
      setSelectedId(bySlug.id);
    } else if (!bySlug && wanted !== selectedId && routeAgent?.slug !== wanted && routeAgent?.id !== wanted) {
      setCreatingNew(false);
      void loadAgentDetail(wanted, true, { silent: true });
    }
  }, [agents, initialSlug, loadAgentDetail, routeAgent?.id, routeAgent?.slug, selectedId]);

  useEffect(() => {
    const accountId = auth.activeAccount?.id || accounts[0]?.id || "";
    if (loading || creatingNew || !accountId || !agents.length || syncedChatAccountIdRef.current === accountId) return;
    syncedChatAccountIdRef.current = accountId;
    const requestedSlug = initialSlug && initialSlug !== "new" ? decodeURIComponent(initialSlug) : "";
    const routeMatch = requestedSlug ? agents.find((agent) => agent.slug === requestedSlug || agent.id === requestedSlug) : null;
    const preferred = routeMatch
      || agents.find((agent) => agent.youtubeAccountId === accountId && agent.status === "active")
      || agents.find((agent) => agent.youtubeAccountId === accountId);
    if (!preferred) {
      setRouteAgent(null);
      setSelectedId("");
      setSelectedUploadId("");
      setActiveTab("overview");
      writeDeepLink({ view: "automation" }, true);
      return;
    }
    setCreatingNew(false);
    setRouteAgent(preferred);
    setSelectedId(preferred.id);
    setSelectedUploadId("");
    const requestedTab = initialTab || "overview";
    setActiveTab(requestedTab);
    void loadAgentDetail(preferred.id, true);
    writeDeepLink({ view: "automation", slug: preferred.slug || preferred.id, automationTab: requestedTab }, true);
  }, [agents, auth.activeAccount?.id, creatingNew, initialSlug, initialTab, loadAgentDetail, loading]);

  const lastSyncedFormRef = useRef<ReturnType<typeof formFromAgent> | null>(null);
  useEffect(() => {
    if (!selectedAgent) return;
    const next = formFromAgent(selectedAgent);
    const previous = lastSyncedFormRef.current;
    if (previous && stableStringify(previous) === stableStringify(next)) return;
    // A header activate/pause only changes status; keep in-progress edits in that case.
    const onlyStatusChanged = Boolean(previous && previous.id === next.id && stableStringify({ ...next, status: previous.status }) === stableStringify(previous));
    lastSyncedFormRef.current = next;
    setForm((prev: any) => (onlyStatusChanged && prev?.id === next.id ? { ...prev, status: next.status } : next));
  }, [selectedAgent]);

  useEffect(() => {
    onDetailChange?.(detailOpen);
    return () => onDetailChange?.(false);
  }, [detailOpen, onDetailChange]);

  function updateSetting(key: string, value: unknown) {
    setForm((prev: any) => ({ ...prev, settings: { ...prev.settings, [key]: value } }));
  }

  function setScheduleTime(index: number, value: string) {
    setForm((prev: any) => {
      const current = Array.isArray(prev.settings.scheduleTimes) ? [...prev.settings.scheduleTimes] : ["09:00"];
      current[index] = value;
      return { ...prev, settings: { ...prev.settings, scheduleTimes: current } };
    });
  }

  function addScheduleTime() {
    setForm((prev: any) => {
      const current = Array.isArray(prev.settings.scheduleTimes) ? prev.settings.scheduleTimes : ["09:00"];
      const nextHour = String(Math.min(23, 9 + current.length * 3)).padStart(2, "0");
      return { ...prev, settings: { ...prev.settings, scheduleTimes: [...current, `${nextHour}:00`].slice(0, 12) } };
    });
  }

  function removeScheduleTime(index: number) {
    setForm((prev: any) => {
      const current = Array.isArray(prev.settings.scheduleTimes) ? prev.settings.scheduleTimes : ["09:00"];
      const next = current.filter((_: string, itemIndex: number) => itemIndex !== index);
      return { ...prev, settings: { ...prev.settings, scheduleTimes: next.length ? next : ["09:00"] } };
    });
  }

  function updatePublishTarget(accountId: string, patch: Record<string, unknown>) {
    setForm((prev: any) => {
      const current = Array.isArray(prev.settings.publishTargets) ? prev.settings.publishTargets : [];
      const existing = current.find((item: any) => item.accountId === accountId);
      const next = existing
        ? current.map((item: any) => item.accountId === accountId ? { ...item, ...patch } : item)
        : [...current, { accountId, postsPerDay: 1, intervalHours: 24, ...patch }];
      return { ...prev, settings: { ...prev.settings, publishTargets: next } };
    });
  }

  function removePublishTarget(accountId: string) {
    setForm((prev: any) => ({ ...prev, settings: { ...prev.settings, publishTargets: (prev.settings.publishTargets || []).filter((item: any) => item.accountId !== accountId) } }));
  }

  function startNewAgent() {
    const account = auth.activeAccount || accounts[0] || null;
    setCreatingNew(true);
    setCreateStep(0);
    setSelectedId("");
    setSelectedUploadId("");
    setActiveTab("setup");
    setSetupSubTab("basics");
    writeDeepLink({ view: "automation", slug: "new", automationTab: "setup" });
    setForm({
      youtubeAccountId: account?.id || "",
      name: suggestAgentName(account?.channelTitle, agents.map((agent) => agent.name)),
      status: "paused",
      sourceType: "saved_playlist",
      sourceKey: sources[0]?.key || "",
      sourceUrl: sources[0]?.analyzedUrl || "",
      settings: DEFAULT_SETTINGS,
    });
  }

  async function saveAgent(event: FormEvent) {
    event.preventDefault();
    const wasNew = creatingNew || !form.id;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const source = sources.find((item) => item.key === form.sourceKey) || findSelectedSource(sources, form.sourceKey, form.sourceUrl);
      const payload = {
        ...form,
        sourceKey: form.sourceType === "custom_url" ? form.sourceKey : form.sourceType === "saved_tags" ? "" : source?.key || form.sourceKey,
        sourceUrl: form.sourceType === "custom_url" ? form.sourceUrl : form.sourceType === "saved_tags" ? "" : source?.analyzedUrl || form.sourceUrl,
        settings: {
          ...form.settings,
          scheduleTimes: cleanScheduleTimes(form.settings.scheduleTimes),
        },
      };
      const response = await fetch("/api/automation/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await readApiJson(response, "Could not save automation agent");
      const landingTab: AutomationTab = wasNew ? "overview" : activeTab;
      setNotice(wasNew ? `${data.agent.name || "Agent"} created. Run a test candidate when you are ready.` : "Changes saved.");
      setCreatingNew(false);
      setCreateStep(0);
      setSelectedId(data.agent.id);
      if (data.agent.slug) writeDeepLink({ view: "automation", slug: data.agent.slug, automationTab: landingTab }, true);
      setActiveTab(landingTab);
      if (wasNew) setSetupSubTab("basics");
      await loadAll();
      await loadAgentDetail(data.agent.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save automation agent");
    } finally {
      setSaving(false);
    }
  }

  async function runAgent(id: string, options: AgentRunOptions = {}) {
    if (running.includes(id)) return;
    setRunning((items) => items.includes(id) ? items : [...items, id]);
    setStopping((items) => items.filter((item) => item !== id));
    setError("");
    setNotice("");
    try {
      const request = fetch(`/api/automation/agents/${encodeURIComponent(id)}/run`, { method: "POST" });
      window.setTimeout(announceBackgroundProcess, 400);
      const response = await request;
      const data = await readApiJson(response, "Automation run failed");
      const agent = agents.find((item) => item.id === id);
      const publishAccount = accounts.find((item) => item.id === agent?.youtubeAccountId);
      setNotice(isTikTokPublishAccount(publishAccount)
        ? `${agent?.name || "Agent"} scheduled a TikTok post.`
        : `${agent?.name || "Agent"} created a YouTube upload.`);
      const stillViewingAgent = selectedIdRef.current === id;
      if (!options.stayInChat && stillViewingAgent) selectAgentTab("uploads");
      if (!options.stayInChat) await loadAll();
      if (stillViewingAgent) await loadAgentDetail(id);
      if (stillViewingAgent && data.result?.uploadId) setSelectedUploadId(data.result.uploadId);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Automation run failed";
      const cancelled = /run stopped by user/i.test(message);
      if (cancelled) setNotice(`${agents.find((item) => item.id === id)?.name || "Agent"} run stopped cleanly.`);
      else setError(message);
      if (selectedIdRef.current === id) await loadAgentDetail(id);
      if (options.throwOnError && !cancelled) throw new Error(message);
    } finally {
      setRunning((items) => items.filter((item) => item !== id));
      setStopping((items) => items.filter((item) => item !== id));
    }
  }

  async function stopAgent(id: string) {
    if (!running.includes(id) || stopping.includes(id)) return;
    setStopping((items) => items.includes(id) ? items : [...items, id]);
    setError("");
    try {
      const response = await fetch(`/api/automation/agents/${encodeURIComponent(id)}/stop`, { method: "POST" });
      await readApiJson(response, "Could not stop candidate run");
      announceBackgroundProcess();
      setNotice(`Stopping ${agents.find((item) => item.id === id)?.name || "agent"} after the current safe step.`);
    } catch (err) {
      setStopping((items) => items.filter((item) => item !== id));
      setError(err instanceof Error ? err.message : "Could not stop candidate run");
      await syncActiveRuns();
    }
  }

  async function setAgentStatus(id: string, status: "active" | "paused") {
    const agent = agents.find((item) => item.id === id) || (routeAgent?.id === id ? routeAgent : null);
    if (!agent || togglingStatus) return;
    setTogglingStatus(id);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/automation/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: agent.id,
          youtubeAccountId: agent.youtubeAccountId,
          name: agent.name,
          status,
          sourceType: agent.sourceType,
          sourceKey: agent.sourceKey,
          sourceUrl: agent.sourceUrl,
          settings: agent.settings,
        }),
      });
      const data = await readApiJson(response, "Could not update agent status");
      const saved = data.agent as AutomationAgent;
      setAgents((items) => items.map((item) => (item.id === saved.id ? { ...item, ...saved } : item)));
      setRouteAgent((current) => (current?.id === saved.id ? { ...current, ...saved } : current));
      setNotice(status === "active"
        ? `${saved.name || "Agent"} is active. It will post on its schedule from the server.`
        : `${saved.name || "Agent"} paused. Nothing posts until you activate it again.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update agent status");
    } finally {
      setTogglingStatus("");
    }
  }

  async function runCompilation(id: string) {
    setRunningCompilation(id);
    setError("");
    setNotice("");
    try {
      const compilationSettings = form.settings || {};
      const response = await fetch(`/api/automation/agents/${encodeURIComponent(id)}/run-compilation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          minMinutes: compilationSettings.compilationMinMinutes,
          maxMinutes: compilationSettings.compilationMaxMinutes,
          maxClips: compilationSettings.compilationMaxClips,
          title: compilationSettings.compilationTitle,
          description: compilationSettings.compilationDescription,
          layout: compilationSettings.compilationLayout,
          playlistId: compilationSettings.targetPlaylistMode === "existing" ? compilationSettings.targetPlaylistId : "",
          createPlaylistTitle: compilationSettings.targetPlaylistMode === "create" ? compilationSettings.targetPlaylistTitle : "",
          categoryId: compilationSettings.categoryId,
          madeForKids: compilationSettings.madeForKids === true,
        }),
      });
      const queued = await readApiJson(response, "Compilation run failed");
      const jobId = String(queued.job?.id || "");
      if (!jobId) throw new Error("Compilation worker did not return a job ID.");
      announceBackgroundProcess();
      let data = queued;
      while (data.job?.status === "queued" || data.job?.status === "running") {
        await new Promise((resolve) => window.setTimeout(resolve, 2000));
        if (!mountedRef.current) return;
        const jobResponse = await fetch(`/api/compilations/jobs/${encodeURIComponent(jobId)}`);
        data = await readApiJson(jobResponse, "Could not check compilation progress");
      }
      if (data.job?.status !== "done") throw new Error(data.job?.error || "Compilation run failed");
      setNotice("Compilation Studio engine created and tracked the long-form upload.");
      selectAgentTab("uploads");
      await loadAll();
      await loadAgentDetail(id);
      if (data.job?.result?.uploadId) setSelectedUploadId(data.job.result.uploadId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Compilation run failed");
      await loadAgentDetail(id);
    } finally {
      setRunningCompilation("");
    }
  }

  async function reuploadUpload(id: string) {
    setReuploading(id);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/automation/uploads/${encodeURIComponent(id)}/reupload`, { method: "POST" });
      const data = await readApiJson(response, "HD test reupload failed");
      setNotice("Private HD test reupload created.");
      selectAgentTab("uploads");
      await loadAll();
      await loadAgentDetail(selectedId);
      if (data.result?.uploadId) setSelectedUploadId(data.result.uploadId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "HD test reupload failed");
      await loadAgentDetail(selectedId);
    } finally {
      setReuploading("");
    }
  }

  async function deleteUpload(id: string) {
    const answer = await choose({
      title: "Delete this upload?",
      body: "You can delete the live video on YouTube too, or keep it live and remove only the AutoYT record.",
      options: [
        { value: "record", label: "Keep video live", tone: "default" },
        { value: "both", label: "Delete from YouTube too", tone: "danger" },
      ],
    });
    if (!answer) return;
    const deletePublished = answer === "both";
    setDeletingUpload(id);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/automation/uploads/${encodeURIComponent(id)}?deletePublished=${deletePublished ? "1" : "0"}`, { method: "DELETE" });
      const result = await readApiJson(response, "Could not delete upload");
      setUploads((items) => items.filter((item) => item.id !== id));
      setSelectedUploadId("");
      setNotice(result.publishedPostDeleted ? "Upload deleted from YouTube and AutoYT." : "Upload removed from AutoYT. The published post is still live.");
      await loadAll();
      if (selectedId) await loadAgentDetail(selectedId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete upload");
    } finally {
      setDeletingUpload("");
    }
  }

  const replaceUpload = useCallback((updatedUpload: AutomationUpload) => {
    setUploads((items) => items.map((item) => (item.id === updatedUpload.id ? updatedUpload : item)));
  }, []);

  async function deleteAgent(id: string) {
    const agent = agents.find((item) => item.id === id);
    const label = agent?.name || "this agent";
    if (!(await confirm({ title: `Delete ${label}?`, body: "This removes its automation setup, run log, and upload history from AutoYT.", confirmLabel: "Delete agent", danger: true }))) return;
    setDeleting(id);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/automation/agents/${encodeURIComponent(id)}/delete`, { method: "POST" });
      await readApiJson(response, "Could not delete automation agent");
      // What the old agent chat kept in this browser, and the Juel conversation this agent had open.
      for (const prefix of ["autoyt-agent-chats:", "autoyt-agent-chat:", "autoyt-agent-chat-active:", "autoyt-agent-chat-draft:", "juel:thread:automation:"]) window.localStorage.removeItem(`${prefix}${id}`);
      setNotice("Automation agent deleted.");
      setCreatingNew(false);
      setSelectedId("");
      setSelectedUploadId("");
      setRuns([]);
      setUploads([]);
      setActiveTab("overview");
      writeDeepLink({ view: "automation" }, true);
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete automation agent");
    } finally {
      setDeleting("");
    }
  }

  if (!accounts.length) {
    return (
      <div className="mx-auto max-w-xl p-4 md:p-8">
        <Notice title="Connect a publish channel first" body="An agent needs somewhere to post. Connect a YouTube channel or TikTok account, then come back to create your first agent." />
        <button
          type="button"
          onClick={() => writeDeepLink({ view: "channels" })}
          className="mt-4 inline-flex h-11 items-center gap-2 rounded-xl bg-[var(--ui-accent)] px-5 text-sm font-black text-[var(--ui-accent-ink)] shadow-sm transition hover:bg-[var(--ui-text)] hover:text-[var(--ui-panel)] active:scale-[0.98]"
        >
          <Youtube className="h-4 w-4" />
          Open Channel Management
          <ArrowUpRight className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div className={cn("relative flex h-full min-h-0 flex-col overflow-hidden", !detailOpen && "workspace-floating-shell", theme === "dark" ? "bg-[var(--ui-bg)] text-[var(--ui-text)]" : "bg-[var(--ui-bg)] text-[var(--ui-text)]")}>
      {/* ── Sticky top bar ── */}
      {!detailOpen ? (
      <header className="workspace-floating-header flex min-h-12 flex-wrap items-center gap-2 px-3 py-2 sm:px-4">
        <Bot className="h-4 w-4 text-[var(--ui-accent-text)]" />
        <span className="text-sm font-black text-[var(--ui-text)]">Automation</span>
        <div className="ml-auto flex min-w-0 flex-1 items-center justify-end gap-2 sm:flex-none">
          {agents.length ? (
            <button type="button" onClick={startNewAgent} className="ui-btn is-primary is-sm min-w-0">
              <Plus className="h-4 w-4" />
              <span className="hidden min-[390px]:inline">New agent</span>
            </button>
          ) : null}
          <button type="button" onClick={() => void loadAll()} className="ui-btn is-sm">
            <RefreshCw className="h-3.5 w-3.5" />
            <span className="hidden min-[430px]:inline">Refresh</span>
          </button>
        </div>
      </header>
      ) : null}


      {/* ── Content ── */}
      <div className="min-h-0 flex-1 overflow-hidden">
      <AgentBoard
        accounts={accounts}
        activeAccount={activeAccount}
        activeTab={activeTab}
        chatSidebarHost={chatSidebarHost}
        agents={agents}
        creatingNew={creatingNew}
        createStep={createStep}
        onSetCreateStep={setCreateStep}
        onSetStatus={setAgentStatus}
        togglingStatus={togglingStatus}
        deleting={deleting}
        detailRequested={agentRouteMissing}
        form={form}
        loading={loading}
        loadingPlaylists={loadingPlaylists}
        onCreateAgent={startNewAgent}
        onDelete={deleteAgent}
        onRefreshPlaylists={() => void loadPlaylists(form.youtubeAccountId)}
        onAnalyzeSource={analyzeSourceUrl}
        onRun={runAgent}
        onStop={stopAgent}
        onBackToAgents={() => {
          setCreatingNew(false);
          setSelectedId("");
          setSelectedUploadId("");
          setActiveTab("overview");
          writeDeepLink({ view: "automation" });
        }}
        onRefreshAgent={() => {
          void loadAll();
          if (selectedId) void loadAgentDetail(selectedId);
        }}
        onSelect={(agent) => {
          setCreatingNew(false);
          setRouteAgent(agent);
          setSelectedId(agent.id);
          setSelectedUploadId("");
          setActiveTab("overview");
          setSetupSubTab("basics");
          writeDeepLink({ view: "automation", slug: agent.slug || agent.id, automationTab: "overview" });
        }}
        onSetActiveTab={selectAgentTab}
        onSetSetupSubTab={setSetupSubTab}
        onSetup={() => selectAgentTab("setup")}
        onUploads={() => selectAgentTab("uploads")}
        reuploading={reuploading}
        deletingUpload={deletingUpload}
        runAgent={runAgent}
        runCompilation={runCompilation}
        running={running}
        stopping={stopping}
        runningCompilation={runningCompilation}
        runs={runs}
        saveAgent={saveAgent}
        saving={saving}
        selectedAgent={selectedAgent}
        selectedId={selectedId}
        selectedUpload={selectedUpload}
        selectedUploadId={selectedUploadId}
        setForm={setForm}
        setSelectedUploadId={openUploadDetail}
        setScheduleTime={setScheduleTime}
        addScheduleTime={addScheduleTime}
        removeScheduleTime={removeScheduleTime}
        setupSubTab={setupSubTab}
        playlists={playlists}
        sources={sources}
        successfulRuns={successfulRuns}
        uploads={uploads}
        learning={learning}
        agentReport={agentReport}
        updateSetting={updateSetting}
        updatePublishTarget={updatePublishTarget}
        removePublishTarget={removePublishTarget}
        onReupload={reuploadUpload}
        onDeleteUpload={deleteUpload}
        onUploadChanged={replaceUpload}
        theme={theme}
      />
      </div>
    </div>
  );
}

function AgentBoard({
  accounts,
  activeAccount,
  activeTab,
  chatSidebarHost,
  agents,
  creatingNew,
  createStep,
  onSetCreateStep,
  onSetStatus,
  togglingStatus,
  deleting,
  detailRequested,
  form,
  loading,
  loadingPlaylists,
  onCreateAgent,
  onDelete,
  onDeleteUpload,
  onReupload,
  onRefreshPlaylists,
  onAnalyzeSource,
  onRun,
  onStop,
  onBackToAgents,
  onRefreshAgent,
  onSelect,
  onSetActiveTab,
  onSetSetupSubTab,
  onSetup,
  onUploads,
  reuploading,
  deletingUpload,
  runAgent,
  runCompilation,
  running,
  stopping,
  runningCompilation,
  runs,
  saveAgent,
  saving,
  selectedAgent,
  selectedId,
  selectedUpload,
  selectedUploadId,
  setForm,
  setSelectedUploadId,
  setScheduleTime,
  addScheduleTime,
  removeScheduleTime,
  setupSubTab,
  playlists,
  sources,
  successfulRuns,
  uploads,
  learning,
  agentReport,
  updateSetting,
  updatePublishTarget,
  removePublishTarget,
  onUploadChanged,
  theme,
}: {
  accounts: ConnectedYouTubeAccount[];
  activeAccount: ConnectedYouTubeAccount | null;
  activeTab: AutomationTab;
  chatSidebarHost: HTMLElement | null;
  agents: AutomationAgent[];
  creatingNew: boolean;
  createStep: number;
  onSetCreateStep: (step: number) => void;
  onSetStatus: (id: string, status: "active" | "paused") => Promise<void>;
  togglingStatus: string;
  deleting: string;
  detailRequested: boolean;
  form: any;
  loading: boolean;
  loadingPlaylists: boolean;
  onCreateAgent: () => void;
  onDelete: (id: string) => Promise<void>;
  onDeleteUpload: (id: string) => Promise<void>;
  onReupload: (id: string) => Promise<void>;
  onRefreshPlaylists: () => void;
  onAnalyzeSource: (url: string) => Promise<void | boolean>;
  onRun: (id: string, options?: AgentRunOptions) => Promise<void>;
  onStop: (id: string) => Promise<void>;
  onBackToAgents: () => void;
  onRefreshAgent: () => void;
  onSelect: (agent: AutomationAgent) => void;
  onSetActiveTab: (tab: AutomationTab) => void;
  onSetSetupSubTab: (tab: SetupSubTab) => void;
  onSetup: () => void;
  onUploads: () => void;
  reuploading: string;
  deletingUpload: string;
  runAgent: (id: string, options?: AgentRunOptions) => Promise<void>;
  runCompilation: (id: string) => Promise<void>;
  running: string[];
  stopping: string[];
  runningCompilation: string;
  runs: AutomationRun[];
  saveAgent: (event: FormEvent) => Promise<void>;
  saving: boolean;
  selectedAgent: AutomationAgent | null;
  selectedId: string;
  selectedUpload: AutomationUpload | null;
  selectedUploadId: string;
  setForm: (value: any) => void;
  setSelectedUploadId: (id: string) => void;
  setScheduleTime: (index: number, value: string) => void;
  addScheduleTime: () => void;
  removeScheduleTime: (index: number) => void;
  setupSubTab: SetupSubTab;
  playlists: YouTubePlaylistSummary[];
  sources: AutomationSourceSummary[];
  successfulRuns: number;
  uploads: AutomationUpload[];
  learning: AgentLearningProfile | null;
  agentReport: AgentPerformanceReport | null;
  updateSetting: (key: string, value: unknown) => void;
  updatePublishTarget: (accountId: string, patch: Record<string, unknown>) => void;
  removePublishTarget: (accountId: string) => void;
  onUploadChanged: (upload: AutomationUpload) => void;
  theme: "light" | "dark";
}) {
  if (loading) {
    return <BrandLoader inline label="Loading your agents" theme={theme} />;
  }

  const showingDraft = creatingNew;
  const detailAgent = selectedAgent;
  const visibleTab = detailAgent ? activeTab : "setup";

  if (showingDraft || detailAgent) {
    return (
      <section className="h-full overflow-hidden">
        <ExpandedAgentCard
          key={detailAgent?.id || "draft"}
          accounts={accounts}
          activeAccount={activeAccount}
          activeTab={visibleTab}
          chatSidebarHost={chatSidebarHost}
          agent={detailAgent}
          agents={agents}
          createStep={createStep}
          onSetCreateStep={onSetCreateStep}
          onSetStatus={onSetStatus}
          togglingStatus={togglingStatus}
          deleting={deleting}
          form={form}
          onDelete={onDelete}
          onDeleteUpload={onDeleteUpload}
          onReupload={onReupload}
          onRun={onRun}
          onStop={onStop}
          onRefreshAgent={onRefreshAgent}
          onSetActiveTab={onSetActiveTab}
          onSetSetupSubTab={onSetSetupSubTab}
          onSetup={onSetup}
          onUploads={onUploads}
          reuploading={reuploading}
          deletingUpload={deletingUpload}
          runAgent={runAgent}
          runCompilation={runCompilation}
          running={running}
          stopping={stopping}
          runningCompilation={runningCompilation}
          runs={runs}
          saveAgent={saveAgent}
          saving={saving}
          selectedId={selectedId}
          selectedUpload={selectedUpload}
          selectedUploadId={selectedUploadId}
          setForm={setForm}
          setSelectedUploadId={setSelectedUploadId}
          setScheduleTime={setScheduleTime}
          addScheduleTime={addScheduleTime}
          removeScheduleTime={removeScheduleTime}
          setupSubTab={setupSubTab}
          playlists={playlists}
          loadingPlaylists={loadingPlaylists}
          onRefreshPlaylists={onRefreshPlaylists}
          onAnalyzeSource={onAnalyzeSource}
          sources={sources}
          successfulRuns={successfulRuns}
          uploads={uploads}
          learning={learning}
          agentReport={agentReport}
          updateSetting={updateSetting}
          updatePublishTarget={updatePublishTarget}
          removePublishTarget={removePublishTarget}
          onBackToAgents={onBackToAgents}
          onCreateAgent={onCreateAgent}
          onSelectAgent={onSelect}
          onUploadChanged={onUploadChanged}
          theme={theme}
        />
      </section>
    );
  }

  if (detailRequested) {
    return (
      <section className="grid h-full place-items-center overflow-y-auto p-4 md:p-5">
        <div className="grid w-full max-w-md place-items-center rounded-2xl border border-[var(--ui-line)] bg-[var(--ui-panel)] px-6 py-12 text-center shadow-sm">
          <div className="grid h-14 w-14 place-items-center rounded-2xl bg-[var(--ui-text)]/5 text-[var(--ui-text)]/45">
            <AlertCircle className="h-6 w-6" />
          </div>
          <h2 className="mt-5 font-serif text-xl font-bold tracking-tight text-[var(--ui-text)]">Agent not found</h2>
          <p className="mt-2 max-w-sm text-sm font-semibold leading-6 text-[var(--ui-text)]/55">This link points to an agent that was deleted or belongs to another account.</p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
            <button type="button" onClick={onBackToAgents} className="ui-btn">
              <ArrowLeft className="h-4 w-4" />
              Back to automation
            </button>
            <button type="button" onClick={onCreateAgent} className="ui-btn is-primary">
              <Plus className="h-4 w-4" />
              New agent
            </button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="grid h-full place-items-center overflow-y-auto p-4 md:p-5">
      {agents.length ? (
        <div className="rounded-2xl border border-[var(--ui-line)] bg-[var(--ui-panel)] px-6 py-8 text-center shadow-sm">
          <Loader2 className="mx-auto h-5 w-5 ui-spin text-[var(--ui-accent-text)]" />
          <p className="mt-3 text-sm font-bold text-[var(--ui-text)]/60">Opening your agent workspace</p>
        </div>
      ) : (
        <EmptyAgentCard onCreate={onCreateAgent} />
      )}
    </section>
  );
}

function EmptyAgentCard({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="col-span-full rounded-[1.35rem] border border-dashed border-[var(--ui-line-strong)] bg-[var(--ui-panel)] shadow-sm agent-empty-card">
      <EmptyState
        icon={<Bot className="h-5 w-5" />}
        title="No agents yet"
        body="An agent watches a TikTok or YouTube source, identifies each movie, and republishes clips to your channel on a schedule."
      >
        <button type="button" onClick={onCreate} className="ui-btn is-primary">
          <Plus className="h-4 w-4" />
          Create your first agent
        </button>
      </EmptyState>
    </div>
  );
}

function publishModeLabel(mode?: string): string {
  if (mode === "private") return "Private upload";
  if (mode === "unlisted") return "Unlisted upload";
  if (mode === "schedule") return "Scheduled release";
  return "Manual review";
}

function AgentChannelSwitcher({ agents, agent, onSelect, theme }: { agents: AutomationAgent[]; agent: AutomationAgent; onSelect: (agent: AutomationAgent) => void; theme: "light" | "dark" }) {
  const options = agents.map((item) => ({
    value: item.id,
    label: item.name || item.channelTitle || "Automation agent",
    imageUrl: item.channelThumbnailUrl,
    kind: "channel" as const,
  }));
  return (
    <div className="agent-header-channel-switcher min-w-0 max-w-[min(58vw,15rem)]">
      <SourcePicker
        compact
        theme={theme}
        label="Switch agent"
        ariaLabel="Switch agent"
        sourcesTabLabel="Agents"
        searchLabel="Search agents"
        actionIcon={<ChevronDown size={15} />}
        placeholder="Choose agent"
        value={agent.id}
        options={options}
        onChange={(value) => {
          const next = agents.find((item) => item.id === value);
          if (next) onSelect(next);
        }}
      />
    </div>
  );
}

function ExpandedAgentCard({
  accounts,
  activeAccount,
  activeTab,
  chatSidebarHost,
  agent,
  agents,
  createStep,
  onSetCreateStep,
  onSetStatus,
  togglingStatus,
  deleting,
  form,
  onDelete,
  onDeleteUpload,
  onReupload,
  onRun,
  onStop,
  onRefreshAgent,
  onSetActiveTab,
  onSetSetupSubTab,
  onSetup,
  onUploads,
  reuploading,
  deletingUpload,
  runAgent,
  runCompilation,
  running,
  stopping,
  runningCompilation,
  runs,
  saveAgent,
  saving,
  selectedId,
  selectedUpload,
  selectedUploadId,
  setForm,
  setSelectedUploadId,
  setScheduleTime,
  addScheduleTime,
  removeScheduleTime,
  setupSubTab,
  playlists,
  loadingPlaylists,
  onRefreshPlaylists,
  onAnalyzeSource,
  sources,
  successfulRuns,
  uploads,
  learning,
  agentReport,
  updateSetting,
  updatePublishTarget,
  removePublishTarget,
  onBackToAgents,
  onCreateAgent,
  onSelectAgent,
  onUploadChanged,
  theme,
}: {
  accounts: ConnectedYouTubeAccount[];
  activeAccount: ConnectedYouTubeAccount | null;
  activeTab: AutomationTab;
  chatSidebarHost: HTMLElement | null;
  agent: AutomationAgent | null;
  agents: AutomationAgent[];
  createStep: number;
  onSetCreateStep: (step: number) => void;
  onSetStatus: (id: string, status: "active" | "paused") => Promise<void>;
  togglingStatus: string;
  deleting: string;
  form: any;
  onDelete: (id: string) => Promise<void>;
  onDeleteUpload: (id: string) => Promise<void>;
  onReupload: (id: string) => Promise<void>;
  onRun: (id: string, options?: AgentRunOptions) => Promise<void>;
  onStop: (id: string) => Promise<void>;
  onRefreshAgent: () => void;
  onSetActiveTab: (tab: AutomationTab) => void;
  onSetSetupSubTab: (tab: SetupSubTab) => void;
  onSetup: () => void;
  onUploads: () => void;
  reuploading: string;
  deletingUpload: string;
  runAgent: (id: string, options?: AgentRunOptions) => Promise<void>;
  runCompilation: (id: string) => Promise<void>;
  running: string[];
  stopping: string[];
  runningCompilation: string;
  runs: AutomationRun[];
  saveAgent: (event: FormEvent) => Promise<void>;
  saving: boolean;
  selectedId: string;
  selectedUpload: AutomationUpload | null;
  selectedUploadId: string;
  setForm: (value: any) => void;
  setSelectedUploadId: (id: string) => void;
  setScheduleTime: (index: number, value: string) => void;
  addScheduleTime: () => void;
  removeScheduleTime: (index: number) => void;
  setupSubTab: SetupSubTab;
  playlists: YouTubePlaylistSummary[];
  loadingPlaylists: boolean;
  onRefreshPlaylists: () => void;
  onAnalyzeSource: (url: string) => Promise<void | boolean>;
  sources: AutomationSourceSummary[];
  successfulRuns: number;
  uploads: AutomationUpload[];
  learning: AgentLearningProfile | null;
  agentReport: AgentPerformanceReport | null;
  updateSetting: (key: string, value: unknown) => void;
  updatePublishTarget: (accountId: string, patch: Record<string, unknown>) => void;
  removePublishTarget: (accountId: string) => void;
  onBackToAgents: () => void;
  onCreateAgent: () => void;
  onSelectAgent: (agent: AutomationAgent) => void;
  onUploadChanged: (upload: AutomationUpload) => void;
  theme: "light" | "dark";
}) {
  const isDraft = !agent;
  const tab = isDraft ? "setup" : activeTab;
  const isDark = theme === "dark";
  const [navOpen, setNavOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const currentCreateStep = AGENT_CREATE_STEPS[Math.min(createStep, AGENT_CREATE_STEPS.length - 1)];
  const headerSubline = `Step ${Math.min(createStep + 1, AGENT_CREATE_STEPS.length)} of ${AGENT_CREATE_STEPS.length} · ${currentCreateStep.hint}`;
  const tabCounts: Partial<Record<AutomationTab, number>> = { uploads: uploads.length, runs: runs.length };
  const agentRunning = Boolean(agent && running.includes(agent.id));
  const agentStopping = Boolean(agent && stopping.includes(agent.id));
  const agentActive = agent?.status === "active";
  const statusBusy = Boolean(agent && togglingStatus === agent.id);

  useEffect(() => {
    if (!navOpen) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setNavOpen(false); };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [navOpen]);

  return (
    <article className={cn("workspace-floating-shell relative flex h-full flex-col overflow-hidden", isDark ? "bg-[var(--ui-bg)] text-[var(--ui-text)]" : "bg-[var(--ui-bg)] text-[var(--ui-text)]")}>
      {/* ── Agent detail header ── */}
      <div className="workspace-floating-header relative px-2 py-1.5 md:px-3">
        <div className="flex min-w-0 items-center gap-1.5">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {isDraft ? (
              <button type="button" onClick={onBackToAgents} className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-lg transition active:scale-[0.98]", isDark ? "text-[var(--ui-text)]/70 hover:bg-[var(--ui-text)]/8 hover:text-[var(--ui-text)]" : "text-[var(--ui-text)]/70 hover:bg-[var(--ui-panel)] hover:text-[var(--ui-text)]")} aria-label="Back to agents">
                <ArrowLeft className="h-4 w-4" />
              </button>
            ) : null}
            {agent ? <AgentChannelSwitcher agents={agents} agent={agent} onSelect={onSelectAgent} theme={theme} /> : null}
            {isDraft ? (
              <div className="min-w-0">
                <h3 className={cn("truncate text-sm font-bold leading-tight md:text-base", isDark ? "text-[var(--ui-text)]" : "text-[var(--ui-text)]")}>New agent</h3>
                <p className={cn("mt-0.5 truncate text-[11px] font-semibold", isDark ? "text-[var(--ui-text)]/55" : "text-[var(--ui-text)]/55")}>{headerSubline}</p>
              </div>
            ) : null}
            {!isDraft ? (
              <button
                type="button"
                role="switch"
                aria-checked={agentActive}
                aria-label={agentActive ? "Agent is active. Pause it" : "Agent is paused. Activate it"}
                title={agentActive ? "Pause the agent" : "Activate the agent"}
                disabled={statusBusy || saving || !!deleting}
                onClick={() => agent && void onSetStatus(agent.id, agentActive ? "paused" : "active")}
                className={cn(
                  "inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full border px-2 text-[9px] font-black uppercase tracking-wider transition active:scale-[0.98] disabled:opacity-60",
                  agentActive
                    ? "border-[var(--ui-accent-text)]/20 bg-[var(--ui-accent)] text-[var(--ui-accent-ink)] hover:bg-[var(--ui-accent-hover)]"
                    : isDark ? "border-[var(--ui-line-strong)] bg-[var(--ui-text)]/10 text-[var(--ui-text)]/70 hover:bg-[var(--ui-text)]/16" : "border-[var(--ui-line)] bg-[var(--ui-text)]/6 text-[var(--ui-text)]/60 hover:bg-[var(--ui-text)]/10",
                )}
              >
                {statusBusy ? <Loader2 className="h-3 w-3 ui-spin" /> : <span className={cn("h-1.5 w-1.5 rounded-full", agentActive ? "bg-[var(--ui-text)]" : "bg-current opacity-60")} />}
                {agentActive ? "Active" : "Paused"}
              </button>
            ) : null}
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            {!isDraft ? (
            <button
              type="button"
              onClick={() => setNavOpen((open) => !open)}
              aria-expanded={navOpen}
              aria-label={navOpen ? "Close agent tools" : "Open agent tools"}
              title="Agent tools"
              className={cn(
                "grid h-8 w-8 shrink-0 place-items-center rounded-lg border transition active:scale-[0.98]",
                navOpen
                  ? "border-[var(--ui-accent)] bg-[var(--ui-accent)] text-[var(--ui-accent-ink)]"
                  : isDark ? "border-[var(--ui-line-strong)] text-[var(--ui-text)]/70 hover:bg-[var(--ui-text)]/8" : "border-[var(--ui-line-strong)] text-[var(--ui-text)]/60 hover:bg-[var(--ui-panel)]",
              )}
            >
              <Menu className="h-4 w-4" />
            </button>
            ) : null}
          </div>
        </div>
        {navOpen ? (
          <nav
            className={cn("absolute right-3 top-[calc(100%+0.25rem)] z-30 grid w-56 gap-1 rounded-lg border p-1.5 shadow-[0_18px_45px_rgba(26,26,26,0.18)]", isDark ? "border-[var(--ui-line-strong)] bg-[var(--ui-panel)] text-[var(--ui-text)]" : "border-[var(--ui-line)] bg-[var(--ui-panel)] text-[var(--ui-text)]")}
            aria-label="Agent tools"
          >
            {TABS.map((item, index) => {
              const disabled = isDraft && item.id !== "setup";
              const count = isDraft ? undefined : tabCounts[item.id];
              const active = tab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    onSetActiveTab(item.id);
                    setNavOpen(false);
                  }}
                  className={cn(
                    "flex h-10 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-35",
                    index === PRIMARY_TAB_COUNT && (isDark ? "mt-1 border-t border-[var(--ui-line)] pt-1" : "mt-1 border-t border-[var(--ui-line)] pt-1"),
                    active
                      ? "bg-[var(--ui-accent)] text-[var(--ui-accent-ink)]"
                      : isDark ? "text-[var(--ui-text)]/72 hover:bg-[var(--ui-text)]/8 hover:text-[var(--ui-text)]" : "text-[var(--ui-text)]/70 hover:bg-[var(--ui-text)]/5 hover:text-[var(--ui-text)]",
                  )}
                >
                  {item.icon}
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {typeof count === "number" && count > 0 ? (
                    <span className={cn("rounded-full px-1.5 py-0.5 text-[10px] font-black tabular-nums", active ? "bg-[var(--ui-text)]/10 text-[var(--ui-text)]" : isDark ? "bg-[var(--ui-text)]/10 text-[var(--ui-text)]/60" : "bg-[var(--ui-text)]/6 text-[var(--ui-text)]/55")}>{count}</span>
                  ) : null}
                </button>
              );
            })}
            {!isDraft ? (
              <div className={cn("mt-1 grid gap-1 border-t pt-1", isDark ? "border-[var(--ui-line)]" : "border-[var(--ui-line)]")}>
                <button type="button" onClick={() => { setNavOpen(false); onCreateAgent(); }} className={cn("flex h-10 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-xs font-bold transition", isDark ? "text-[var(--ui-text)]/72 hover:bg-[var(--ui-text)]/8 hover:text-[var(--ui-text)]" : "text-[var(--ui-text)]/70 hover:bg-[var(--ui-text)]/5 hover:text-[var(--ui-text)]")}>
                  <Plus className="h-4 w-4" />
                  <span>New agent</span>
                </button>
                <button type="button" onClick={() => { setNavOpen(false); if (agent) void (agentRunning ? onStop(agent.id) : onRun(agent.id)); }} disabled={saving || agentStopping} className={cn("flex h-10 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-xs font-bold transition disabled:cursor-not-allowed disabled:opacity-45", agentRunning ? (isDark ? "text-red-200 hover:bg-red-500/10" : "text-red-700 hover:bg-red-50") : (isDark ? "text-[var(--ui-text)]/72 hover:bg-[var(--ui-text)]/8 hover:text-[var(--ui-text)]" : "text-[var(--ui-text)]/70 hover:bg-[var(--ui-text)]/5 hover:text-[var(--ui-text)]"))} aria-label={agentRunning ? "Stop candidate run" : "Run candidate"}>
                  {agentStopping ? <Loader2 className="h-4 w-4 ui-spin" /> : agentRunning ? <Square className="h-4 w-4 fill-current" /> : <Play className="h-4 w-4" />}
                  <span>{agentStopping ? "Stopping" : agentRunning ? "Stop candidate run" : "Run candidate"}</span>
                </button>
                <button type="button" onClick={() => { setNavOpen(false); if (agent) void onDelete(agent.id); }} disabled={!!deleting || agentRunning || saving} className={cn("flex h-10 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-xs font-bold transition disabled:cursor-not-allowed disabled:opacity-45", isDark ? "text-red-200 hover:bg-red-500/10" : "text-red-700 hover:bg-red-50")} aria-label="Delete agent">
                  {deleting ? <Loader2 className="h-4 w-4 ui-spin" /> : <Trash2 className="h-4 w-4" />}
                  <span>Delete agent</span>
                </button>
              </div>
            ) : null}
            <div className={cn("mt-1 grid gap-1 border-t pt-1", isDark ? "border-[var(--ui-line)]" : "border-[var(--ui-line)]")}>
              <button
                type="button"
                onClick={() => {
                  setNavOpen(false);
                  onRefreshAgent();
                }}
                className={cn("flex h-10 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-xs font-semibold transition", isDark ? "text-[var(--ui-text)]/72 hover:bg-[var(--ui-text)]/8 hover:text-[var(--ui-text)]" : "text-[var(--ui-text)]/70 hover:bg-[var(--ui-text)]/5 hover:text-[var(--ui-text)]")}
              >
                <RefreshCw className="h-4 w-4" />
                <span>Refresh agent</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  openBackgroundProcessCenter();
                  setNavOpen(false);
                }}
                className={cn("flex h-10 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-xs font-semibold transition md:hidden", isDark ? "text-[var(--ui-text)]/72 hover:bg-[var(--ui-text)]/8 hover:text-[var(--ui-text)]" : "text-[var(--ui-text)]/70 hover:bg-[var(--ui-text)]/5 hover:text-[var(--ui-text)]")}
              >
                <Activity className="h-4 w-4" />
                <span>Background activity</span>
              </button>
            </div>
          </nav>
        ) : null}
      </div>

      <div data-agent-scroll className={cn("relative min-h-0 flex-1", tab === "chat" ? "flex overflow-hidden" : tab === "compile" ? "overflow-hidden pb-24" : "overflow-y-auto p-4 pb-24 md:p-6 md:pb-28")}>
        {tab === "chat" ? (
          // The agent's chat is Juel: it consults this agent's own operator for anything about it.
          <div className="agent-juel">
            <JuelPanel embedded />
          </div>
        ) : null}
        {tab === "overview" ? (
          <OverviewPanel
            agent={agent}
            uploads={uploads}
            runs={runs}
            successfulRuns={successfulRuns}
            onSetup={onSetup}
            onUploads={onUploads}
            onRun={onRun}
            running={agentRunning}
            stopping={agentStopping}
            theme={theme}
          />
        ) : null}
        {tab === "analytics" ? (
          <AnalyticsPanel agent={agent} uploads={uploads} runs={runs} learning={learning} theme={theme} />
        ) : null}
        {tab === "report" ? (
          <section className="space-y-4 pb-8">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[var(--ui-accent-text)]">Agent intelligence</p>
              <h2 className={cn("mt-1 font-serif text-2xl font-bold md:text-3xl", getAgentTheme(theme).text)}>Performance report</h2>
              <p className={cn("mt-1 max-w-2xl text-sm leading-6", getAgentTheme(theme).muted)}>What the last 30 days say about this channel: which source channels earn views, which to throttle, and what the agent recommends next.</p>
            </div>
            <AgentReportPanel report={agentReport} theme={theme} />
          </section>
        ) : null}
        {tab === "setup" && isDraft ? (
          <CreateAgentWizard
            theme={theme}
            accounts={accounts}
            sources={sources}
            form={form}
            saving={saving}
            step={createStep}
            onSetStep={onSetCreateStep}
            setForm={setForm}
            updateSetting={updateSetting}
            setScheduleTime={setScheduleTime}
            addScheduleTime={addScheduleTime}
            removeScheduleTime={removeScheduleTime}
            saveAgent={saveAgent}
            onCancel={onBackToAgents}
            onAnalyzeSource={onAnalyzeSource}
          />
        ) : null}
        {tab === "setup" && !isDraft ? (
          <SetupPanel
            theme={theme}
            agent={agent}
            learning={learning}
            accounts={accounts}
            sources={sources}
            form={form}
            saving={saving}
            selectedId={selectedId}
            running={running}
            setForm={setForm}
            updateSetting={updateSetting}
            updatePublishTarget={updatePublishTarget}
            removePublishTarget={removePublishTarget}
            setScheduleTime={setScheduleTime}
            addScheduleTime={addScheduleTime}
            removeScheduleTime={removeScheduleTime}
            saveAgent={saveAgent}
            runAgent={runAgent}
            setupSubTab={setupSubTab}
            onSetSetupSubTab={onSetSetupSubTab}
            playlists={playlists}
            loadingPlaylists={loadingPlaylists}
            onRefreshPlaylists={onRefreshPlaylists}
            onAnalyzeSource={onAnalyzeSource}
          />
        ) : null}
        {tab === "compile" ? (
          <CompilationStudio
            auth={{
              user: null,
              accounts,
              activeAccount,
              googleConfigured: true,
              dbConfigured: true,
            }}
            embedded
            initialAccountId={agent?.youtubeAccountId || form.youtubeAccountId || activeAccount?.id || ""}
            initialMode="url"
            initialQuery={agent?.sourceUrl || ""}
            initialCount={100}
            initialSort={form.settings?.sourcePriority || "views"}
            routeKey={`agent:${agent?.id || "draft"}:${agent?.sourceUrl || ""}`}
          />
        ) : null}
        {tab === "voice" && agent ? <RemakePanel agent={agent} form={form} updateSetting={updateSetting} saveAgent={saveAgent} saving={saving} accountId={activeAccount?.id} theme={theme} /> : null}
        {tab === "uploads" ? (
          <UploadsPanel
            uploads={uploads}
            selectedUpload={selectedUpload}
            selectedUploadId={selectedUploadId}
            onSelect={setSelectedUploadId}
            onBack={() => setSelectedUploadId("")}
            onReupload={onReupload}
            onDelete={onDeleteUpload}
            reuploading={reuploading}
            deletingUpload={deletingUpload}
            onUploadChanged={onUploadChanged}
            theme={theme}
          />
        ) : null}
        {tab === "runs" ? <RunsPanel runs={runs} theme={theme} /> : null}
      </div>
      {!isDraft && tab !== "chat" ? (
        <div className="agent-chat-global-dock pointer-events-none absolute inset-x-0 bottom-0 z-20 px-3 pb-3 pt-2 md:px-6 md:pb-4">
          <div className="pointer-events-auto mx-auto w-full max-w-4xl">
            <JuelDock onOpen={() => onSetActiveTab("chat")} />
          </div>
        </div>
      ) : null}
    </article>
  );
}

type OverviewPanelProps = {
  agent: AutomationAgent | null;
  uploads: AutomationUpload[];
  runs: AutomationRun[];
  successfulRuns: number;
  onSetup: () => void;
  onUploads: () => void;
  onRun: (id: string, options?: AgentRunOptions) => Promise<void>;
  running: boolean;
  stopping: boolean;
  theme: "light" | "dark";
};

function OverviewPanel({ agent, uploads, runs, successfulRuns, onSetup, onUploads, onRun, running, stopping, theme }: OverviewPanelProps) {
  const tokens = getAgentTheme(theme);
  const latestUpload = uploads[0] || null;
  const latestPreview = useMemo(() => latestUpload ? buildAgentAnalyticsViz([latestUpload], []).rankedUploads[0] : null, [latestUpload]);
  const [previewOpen, setPreviewOpen] = useState(false);
  const settings = agent?.settings;
  const nextRun = agentNextRunLabel(agent);
  const schedule = (settings?.scheduleTimes || []).join(", ") || "Manual";
  const views = uploads.reduce((sum, upload) => sum + metric(upload, "viewCount"), 0);
  const gettingStarted = agentGettingStartedSteps({ uploadCount: uploads.length, status: agent?.status });
  const incomplete = gettingStarted.filter((step) => !step.done);

  return (
    <div className="space-y-5 pb-6">
      <section className={cn("rounded-2xl border p-5 md:p-6", tokens.surface)}>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <OverviewValue theme={theme} label="Next run" value={nextRun} />
          <OverviewValue theme={theme} label="Cadence" value={settings ? `${settings.maxPostsPerDay || 1}/day · ${schedule}` : "Not set"} />
          <OverviewValue theme={theme} label="Uploads" value={compact(uploads.length)} />
          <OverviewValue theme={theme} label="Views" value={compact(views)} />
        </div>

        <div className={cn("mt-5 flex flex-wrap items-center gap-2 border-t pt-5", tokens.divider)}>
          <button type="button" onClick={onSetup} className="ui-btn is-primary is-sm"><Settings2 className="h-3.5 w-3.5" />Edit setup</button>
          <button type="button" onClick={onUploads} className={cn("inline-flex h-9 items-center gap-2 rounded-lg border px-3.5 text-xs font-black transition", theme === "dark" ? "border-white/16 text-white/75 hover:bg-white/8" : "border-[var(--ui-line-strong)] text-[var(--ui-text)]/72 hover:bg-[var(--ui-bg)]")}><Table2 className="h-3.5 w-3.5" />Open uploads</button>
          {!uploads.length && agent ? <button type="button" onClick={() => void onRun(agent.id)} disabled={running || stopping} className={cn("ml-auto inline-flex h-9 items-center gap-2 rounded-lg px-3.5 text-xs font-black transition disabled:opacity-50", theme === "dark" ? "text-white/75 hover:bg-white/8" : "text-[var(--ui-text)]/65 hover:bg-[var(--ui-bg)]")}><Play className="h-3.5 w-3.5" />{stopping ? "Stopping" : running ? "Running" : "Run candidate"}</button> : null}
        </div>
      </section>

      {incomplete.length ? (
        <section className={cn("rounded-2xl border px-5 py-4", theme === "dark" ? "border-[var(--ui-accent)]/22 bg-[var(--ui-accent-soft)]" : "border-[var(--ui-accent)]/70 bg-[var(--ui-accent-soft)]")}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className={cn("text-xs font-black", tokens.text)}>Setup progress</p>
            <span className={cn("text-[11px] font-bold", tokens.muted)}>{gettingStarted.length - incomplete.length}/{gettingStarted.length}</span>
          </div>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
            {gettingStarted.map((step) => <span key={step.id} className={cn("inline-flex items-center gap-1.5 text-xs font-semibold", step.done ? tokens.muted : tokens.text)}>{step.done ? <CheckCircle2 className="h-3.5 w-3.5 text-[var(--ui-accent-text)]" /> : <span className="h-1.5 w-1.5 rounded-full bg-[var(--ui-accent)]" />}{step.label}</span>)}
          </div>
        </section>
      ) : null}

      <section className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)]">
        <section className={cn("overflow-hidden rounded-2xl border", tokens.surface)}>
          <div className="flex items-center justify-between gap-3 border-b px-5 py-4 md:px-6 border-[var(--ui-line)]">
            <h3 className={cn("text-sm font-black", tokens.text)}>Recent activity</h3>
            <span className={cn("text-xs font-semibold", tokens.muted)}>{runs.length} runs · {successfulRuns} successful</span>
          </div>
          {runs.length ? runs.slice(0, 6).map((run) => {
            const success = run.status === "success";
            return <div key={run.id} className={cn("grid gap-3 border-b px-5 py-3 last:border-b-0 sm:grid-cols-[112px_minmax(0,1fr)_132px] sm:items-center md:px-6", tokens.divider)}>
              <span className={cn("inline-flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.14em]", success ? "text-[var(--ui-accent-text)]" : tokens.subtle)}>{success ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Clock3 className="h-3.5 w-3.5" />}{run.status}</span>
              <p className={cn("truncate text-sm font-semibold", tokens.textSoft)}>{run.message}</p>
              <p className={cn("text-xs font-medium sm:text-right", tokens.subtle)}>{formatDate(run.startedAt)}</p>
            </div>;
          }) : <p className={cn("px-5 py-10 text-sm font-semibold", tokens.muted)}>No runs yet.</p>}
        </section>

        <section className={cn("overflow-hidden rounded-2xl border", tokens.surface)}>
          <div className="flex items-center justify-between gap-3 border-b px-5 py-4 border-[var(--ui-line)]">
            <h3 className={cn("text-sm font-black", tokens.text)}>Latest upload</h3>
            {latestUpload ? <span className={cn("text-xs font-semibold", tokens.muted)}>{formatDate(latestUpload.createdAt)}</span> : null}
          </div>
          {latestUpload ? (
            <div className="p-5">
              <button type="button" onClick={() => latestPreview?.playbackUrl && setPreviewOpen(true)} className={cn("group relative grid aspect-video w-full place-items-center overflow-hidden rounded-xl border", theme === "dark" ? "border-white/10 bg-[#0d0f0d]" : "border-[var(--ui-line)] bg-[var(--ui-bg)]")}>
                {latestPreview?.thumbnailUrl ? <img src={latestPreview.thumbnailUrl} alt="" className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.02]" /> : <span className="grid h-12 w-12 place-items-center rounded-full bg-[var(--ui-accent)] text-[var(--ui-accent-ink)]"><Play className="h-5 w-5 fill-current" /></span>}
                {latestPreview?.playbackUrl ? <span className="absolute grid h-10 w-10 place-items-center rounded-full bg-[var(--ui-accent)] text-[var(--ui-accent-ink)] shadow-lg"><Play className="h-4 w-4 fill-current" /></span> : null}
              </button>
              <h4 className={cn("mt-4 line-clamp-2 text-sm font-bold leading-5", tokens.text)}>{latestUpload.title}</h4>
              <div className={cn("mt-4 grid grid-cols-3 divide-x border-t pt-3", tokens.divider)}>
                <AgentMiniStat theme={theme} label="Views" value={compact(metric(latestUpload, "viewCount"))} />
                <AgentMiniStat theme={theme} label="Likes" value={compact(metric(latestUpload, "likeCount"))} />
                <AgentMiniStat theme={theme} label="Comments" value={compact(metric(latestUpload, "commentCount"))} />
              </div>
            </div>
          ) : <p className={cn("px-5 py-10 text-sm font-semibold", tokens.muted)}>Run a candidate to create the first upload.</p>}
        </section>
      </section>
      {previewOpen && latestPreview ? <AgentVideoLightbox item={latestPreview} theme={theme} onClose={() => setPreviewOpen(false)} /> : null}
    </div>
  );
}

function OverviewValue({ theme, label, value }: { theme: "light" | "dark"; label: string; value: ReactNode }) {
  const tokens = getAgentTheme(theme);
  return <div className="min-w-0"><p className={cn("text-[10px] font-black uppercase tracking-[0.14em]", tokens.subtle)}>{label}</p><p className={cn("mt-1 truncate text-sm font-bold", tokens.text)}>{value}</p></div>;
}

function AgentMetricCard({ theme, icon, label, value, highlight = false }: { theme: AgentTheme; icon: ReactNode; label: string; value: ReactNode; highlight?: boolean }) {
  const tokens = getAgentTheme(theme);
  return (
    <div className={cn(
      "min-h-24 rounded-xl border p-4 transition hover:opacity-90",
      tokens.surface,
      highlight && tokens.highlight,
    )}>
      <p className={cn("text-[10px] font-black uppercase tracking-[0.16em]", tokens.subtle)}>{label}</p>
      <div className="mt-3 flex items-center gap-2.5">
        <span className="shrink-0 text-[var(--ui-accent-text)]">{icon}</span>
        <p className={cn("min-w-0 truncate text-lg font-bold leading-tight md:text-xl", tokens.text)}>{value}</p>
      </div>
    </div>
  );
}

function AgentMiniStat({ theme, label, value }: { theme: AgentTheme; label: string; value: ReactNode }) {
  const tokens = getAgentTheme(theme);
  return (
    <div className={cn("p-4 text-center [&+&]:border-l", tokens.divider)}>
      <p className={cn("text-[10px] font-semibold uppercase tracking-[0.14em]", tokens.muted)}>{label}</p>
      <p className={cn("mt-2 text-base font-bold tabular-nums", tokens.text)}>{value}</p>
    </div>
  );
}

function AnalyticsPanel({ agent, uploads, runs, learning, theme = "light" }: { agent: AutomationAgent | null; uploads: AutomationUpload[]; runs: AutomationRun[]; learning: AgentLearningProfile | null; theme?: AgentTheme }) {
  const analytics = useMemo(() => buildAgentAnalytics(uploads, runs), [uploads, runs]);
  const viz = useMemo(() => buildAgentAnalyticsViz(uploads, runs), [uploads, runs]);
  const [preview, setPreview] = useState<any | null>(null);
  const tokens = getAgentTheme(theme);
  const learned = learning?.profile;
  const engagementRate = analytics.totalViews ? ((analytics.totalLikes + analytics.totalComments) / analytics.totalViews) * 100 : 0;
  const replyRate = analytics.totalComments ? (analytics.totalReplies / analytics.totalComments) * 100 : 0;

  return (
    <section className="space-y-4 pb-8">
      <div className={cn("flex flex-col gap-3 border-b pb-4 lg:flex-row lg:items-end lg:justify-between", tokens.divider)}>
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[var(--ui-accent-text)]">Agent intelligence</p>
          <h2 className={cn("mt-1 font-serif text-2xl font-bold md:text-3xl", tokens.text)}>Performance command center</h2>
          <p className={cn("mt-1 max-w-2xl text-sm leading-6", tokens.muted)}>Find the content, timing, and operating patterns moving this channel toward monetization.</p>
        </div>
        <div className={cn("flex w-fit items-center gap-2 rounded-lg border px-3 py-2 text-xs font-bold", tokens.surface)}>
          <Activity className="h-4 w-4 text-[var(--ui-accent-text)]" />
          {viz.reliability.successRate}% run reliability
        </div>
      </div>

      <AgentMonetizationPanel accountId={agent?.youtubeAccountId || ""} agentSlug={agent?.slug || agent?.id || ""} theme={theme} />

      <div className={cn("grid overflow-hidden rounded-xl border sm:grid-cols-2 xl:grid-cols-5", tokens.surface)}>
        <AnalyticsKpi theme={theme} label="Views" value={compact(analytics.totalViews)} detail={`${uploads.length} uploads`} icon={<Eye className="h-4 w-4" />} />
        <AnalyticsKpi theme={theme} label="Engagement" value={`${engagementRate.toFixed(1)}%`} detail="likes + comments per view" icon={<Heart className="h-4 w-4" />} />
        <AnalyticsKpi theme={theme} label="Comments" value={compact(analytics.totalComments)} detail={`${replyRate.toFixed(0)}% replied`} icon={<MessageCircle className="h-4 w-4" />} />
        <AnalyticsKpi theme={theme} label="Success rate" value={`${viz.reliability.successRate}%`} detail={`${viz.reliability.success}/${viz.reliability.total} runs`} icon={<CheckCircle2 className="h-4 w-4" />} />
        <AnalyticsKpi theme={theme} label="Learning confidence" value={`${Math.round(Number(learning?.confidence || 0) * 100)}%`} detail={learned?.samples ? `${learned.samples} signals` : "Collecting signals"} icon={<Sparkles className="h-4 w-4" />} />
      </div>

      <AnalyticsThumbnailStrip rows={viz.rankedUploads} theme={theme} onPreview={setPreview} />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <MomentumChart points={viz.momentum} theme={theme} />
        <aside className={cn("flex min-h-72 flex-col justify-between rounded-xl border p-5", tokens.accentPanel)}>
          <div>
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-[var(--ui-accent-text)]" />
              <p className={cn("text-[10px] font-black uppercase tracking-[0.18em]", tokens.text)}>Next best move</p>
            </div>
            <p className={cn("mt-5 font-serif text-xl font-bold leading-8", tokens.text)}>{learning?.recommendation || analytics.recommendation}</p>
            <p className={cn("mt-3 text-sm leading-6", tokens.muted)}>{learning?.summary || "Recommendations sharpen as the agent captures more performance checks."}</p>
          </div>
          <div className={cn("mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-lg border", tokens.divider, tokens.surface)}>
            <AnalyticsTinyStat theme={theme} label="Best hook" value={learned?.bestHooks?.[0]?.label || "Pending"} />
            <AnalyticsTinyStat theme={theme} label="Best duration" value={learned?.bestDurations?.[0]?.label || "Pending"} />
          </div>
        </aside>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
        <PortfolioChart items={viz.portfolio} theme={theme} />
        <ReleaseHeatmap cells={viz.releaseHeatmap} theme={theme} />
      </div>

      <RankedUploadsTable rows={viz.rankedUploads} theme={theme} onPreview={setPreview} />

      <div className="grid gap-4 lg:grid-cols-3">
        <AnalyticsDistribution title="Genre contribution" rows={analytics.genres} theme={theme} />
        <AnalyticsDistribution title="Micro-niche contribution" rows={analytics.msns} theme={theme} />
        <ReliabilityPanel analytics={analytics} reliability={viz.reliability} agent={agent} theme={theme} />
      </div>
      {preview ? <AgentVideoLightbox item={preview} theme={theme} onClose={() => setPreview(null)} /> : null}
    </section>
  );
}

function AgentMonetizationPanel({
  accountId,
  agentSlug,
  theme,
  onReauthorize,
}: {
  accountId: string;
  agentSlug: string;
  theme: AgentTheme;
  onReauthorize?: (reauthorizeUrl: string) => void;
}) {
  const [snapshot, setSnapshot] = useState<YouTubeMonetizationSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [requestError, setRequestError] = useState("");
  const requestIdRef = useRef(0);
  const tokens = getAgentTheme(theme);
  const reauthorizeNext = agentSlug
    ? `/agent/${encodeURIComponent(agentSlug)}/analytics`
    : `${window.location.pathname}${window.location.search}`;

  const load = useCallback(async (refresh = false) => {
    const requestId = ++requestIdRef.current;
    if (!accountId) {
      setSnapshot({ status: "not_connected", message: "Connect a YouTube channel to add revenue signals to this agent." });
      setRequestError("");
      setLoading(false);
      return;
    }
    setLoading(true);
    setRequestError("");
    try {
      const query = new URLSearchParams({
        accountId,
        days: "28",
        currency: "USD",
        next: reauthorizeNext,
      });
      if (refresh) query.set("refresh", "true");
      const response = await fetch(`/api/youtube/monetization?${query.toString()}`);
      const data = await readApiJson(response, "Could not load channel revenue");
      if (requestId === requestIdRef.current) setSnapshot(data as YouTubeMonetizationSnapshot);
    } catch (error) {
      if (requestId === requestIdRef.current) {
        setSnapshot(null);
        setRequestError(error instanceof Error ? error.message : "Channel revenue is temporarily unavailable.");
      }
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [accountId, reauthorizeNext]);

  useEffect(() => {
    void load();
    return () => {
      requestIdRef.current += 1;
    };
  }, [load]);

  const status = snapshot?.status || snapshot?.state || (requestError ? "error" : "no_data");
  const needsReauthorization = status === "missing_scope" || snapshot?.reauthorizationRequired === true;
  const currency = snapshot?.currency || "USD";
  const current = snapshot?.current || {};
  const daily = (snapshot?.daily || []).slice(-28);
  const topVideos = (snapshot?.topVideos || []).slice(0, 5);
  const revenue = monetizationNumber(current, "estimatedRevenue");
  const revenueChange = snapshot ? monetizationChange(snapshot, "estimatedRevenue") : null;
  const chartMax = Math.max(0, ...daily.map((row) => monetizationNumber(row, "estimatedRevenue")));
  const periodEnd = snapshot?.period?.current?.endDate;
  const periodLabel = periodEnd
    ? `${snapshot?.period?.days || 28} days through ${new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(new Date(`${periodEnd}T12:00:00`))}`
    : "Last 28 days";

  const beginReauthorization = () => {
    const url = snapshot?.reauthorizeUrl || `/api/auth/google?mode=connect&provider=google&reason=monetization&accountId=${encodeURIComponent(accountId)}&next=${encodeURIComponent(reauthorizeNext)}`;
    if (onReauthorize) onReauthorize(url);
    else window.location.assign(url);
  };

  return (
    <section className={cn("overflow-hidden rounded-xl border", tokens.surface)} aria-busy={loading}>
      <div className={cn("flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between md:px-5", tokens.divider)}>
        <div className="flex min-w-0 items-center gap-3">
          <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-lg border", tokens.accentPanel)}>
            <CircleDollarSign className="h-4 w-4 text-[var(--ui-accent-text)]" />
          </span>
          <div className="min-w-0">
            <h3 className={cn("text-sm font-bold", tokens.text)}>Channel revenue</h3>
            <p className={cn("mt-0.5 text-xs", tokens.muted)}>{status === "ready" ? periodLabel : "Live YouTube Analytics context for this agent"}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void load(true)}
          disabled={loading || !accountId}
          className={cn("inline-flex h-9 items-center justify-center gap-2 rounded-lg border px-3 text-xs font-bold transition disabled:cursor-not-allowed disabled:opacity-45", tokens.tabInactive, tokens.divider)}
        >
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "ui-spin")} />
          Refresh revenue
        </button>
      </div>

      {loading && !snapshot ? (
        <div className="grid min-h-36 place-items-center px-5 py-8">
          <div className={cn("flex items-center gap-2 text-sm font-semibold", tokens.muted)}>
            <Loader2 className="h-4 w-4 ui-spin text-[var(--ui-accent-text)]" />
            Reading monetization analytics
          </div>
        </div>
      ) : null}

      {!loading && needsReauthorization ? (
        <div className="flex flex-col gap-4 border-t border-[var(--ui-accent)]/30 bg-[var(--ui-accent)]/10 px-4 py-5 sm:flex-row sm:items-center sm:justify-between md:px-5">
          <div className="max-w-2xl">
            <h4 className={cn("text-sm font-bold", tokens.text)}>{status === "not_connected" ? "Reconnect channel analytics" : "Revenue permission is needed"}</h4>
            <p className={cn("mt-1 text-sm leading-6", tokens.textSoft)}>{snapshot?.message || "Reconnect Google and approve YouTube monetary analytics so this agent can use real earnings signals."}</p>
          </div>
          <button type="button" onClick={beginReauthorization} className="ui-btn is-primary shrink-0">
            <CircleDollarSign className="h-4 w-4" />
            Reconnect Google
          </button>
        </div>
      ) : null}

      {!loading && status === "not_connected" && !needsReauthorization ? (
        <div className={cn("border-t px-4 py-5 md:px-5", tokens.divider)}>
          <h4 className={cn("text-sm font-bold", tokens.text)}>Connect a channel first</h4>
          <p className={cn("mt-1 max-w-2xl text-sm leading-6", tokens.muted)}>{snapshot?.message || "Choose a connected YouTube channel in agent setup before loading revenue."}</p>
        </div>
      ) : null}

      {!loading && status === "unsupported" ? (
        <div className={cn("border-t px-4 py-5 md:px-5", tokens.divider)}>
          <h4 className={cn("text-sm font-bold", tokens.text)}>YouTube revenue is not available for this target</h4>
          <p className={cn("mt-1 max-w-2xl text-sm leading-6", tokens.muted)}>{snapshot?.message || "Monetization analytics currently require a directly connected YouTube channel."}</p>
        </div>
      ) : null}

      {!loading && status === "no_data" ? (
        <div className={cn("border-t px-4 py-5 md:px-5", tokens.divider)}>
          <h4 className={cn("text-sm font-bold", tokens.text)}>Revenue access is connected</h4>
          <p className={cn("mt-1 max-w-2xl text-sm leading-6", tokens.muted)}>{snapshot?.message || "YouTube returned no monetization rows for this period. The agent will use them automatically when earnings data becomes available."}</p>
        </div>
      ) : null}

      {!loading && status === "error" ? (
        <div className={cn("flex flex-col gap-4 border-t px-4 py-5 sm:flex-row sm:items-center sm:justify-between md:px-5", tokens.divider)}>
          <div>
            <h4 className={cn("text-sm font-bold", tokens.text)}>Revenue could not be refreshed</h4>
            <p className={cn("mt-1 max-w-2xl text-sm leading-6", tokens.muted)}>{requestError || snapshot?.message || "YouTube Analytics is temporarily unavailable."}</p>
          </div>
          <button type="button" onClick={() => void load(true)} className={cn("inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg border px-3 text-xs font-bold transition", tokens.divider, tokens.tabInactive)}>
            <RefreshCw className="h-3.5 w-3.5" />
            Try again
          </button>
        </div>
      ) : null}

      {!loading && status === "ready" ? (
        <>
          <dl className={cn("grid border-t sm:grid-cols-2 xl:grid-cols-6", tokens.divider)}>
            <MonetizationMetric theme={theme} label="Estimated revenue" value={monetizationCurrency(revenue, currency)} change={revenueChange} />
            <MonetizationMetric theme={theme} label="Estimated ad revenue" value={monetizationCurrency(monetizationNumber(current, "estimatedAdRevenue"), currency)} />
            <MonetizationMetric theme={theme} label="Revenue / 1K views" value={monetizationCurrency(monetizationNumber(current, "revenuePerThousandViews"), currency)} />
            <MonetizationMetric theme={theme} label="Monetized playbacks" value={compact(monetizationNumber(current, "monetizedPlaybacks"))} />
            <MonetizationMetric theme={theme} label="Playback CPM" value={monetizationCurrency(monetizationNumber(current, "playbackBasedCpm"), currency)} />
            <MonetizationMetric theme={theme} label="Ad impressions" value={compact(monetizationNumber(current, "adImpressions"))} />
          </dl>

          {(daily.length > 1 || topVideos.length > 0) ? (
            <div className={cn("grid border-t xl:grid-cols-[minmax(0,1.4fr)_minmax(280px,0.6fr)]", tokens.divider)}>
              <div className="min-w-0 px-4 py-5 md:px-5">
                <div className="flex items-center justify-between gap-3">
                  <h4 className={cn("text-xs font-bold", tokens.text)}>Daily estimated revenue</h4>
                  <p className={cn("text-[11px] font-semibold tabular-nums", tokens.muted)}>{monetizationCurrency(revenue, currency)} total</p>
                </div>
                {daily.length > 1 && chartMax > 0 ? (
                  <div className="mt-5 flex h-28 items-end gap-1" role="img" aria-label={`Daily estimated revenue for ${periodLabel}`}>
                    {daily.map((row, index) => {
                      const value = monetizationNumber(row, "estimatedRevenue");
                      const day = String(row.day || row.date || `Day ${index + 1}`);
                      return (
                        <span
                          key={`${day}-${index}`}
                          className="min-w-0 flex-1 rounded-t-sm bg-[var(--ui-accent)] transition hover:bg-[#b89f00]"
                          style={{ height: `${Math.max(3, (value / chartMax) * 100)}%` }}
                          title={`${day}: ${monetizationCurrency(value, currency)}`}
                          aria-label={`${day}: ${monetizationCurrency(value, currency)}`}
                        />
                      );
                    })}
                  </div>
                ) : (
                  <p className={cn("mt-4 text-sm leading-6", tokens.muted)}>Daily revenue points will appear after YouTube returns more than one day of data.</p>
                )}
              </div>

              <div className={cn("border-t px-4 py-5 md:px-5 xl:border-l xl:border-t-0", tokens.divider)}>
                <h4 className={cn("text-xs font-bold", tokens.text)}>Top earning videos</h4>
                <div className={cn("mt-3 divide-y", tokens.isDark ? "divide-[var(--ui-line)]" : "divide-[var(--ui-line)]")}>
                  {topVideos.map((video, index) => {
                    const title = String(video.title || video.videoTitle || video.video || `Video ${index + 1}`);
                    return (
                      <div key={`${String(video.videoId || video.id || title)}-${index}`} className="flex items-start justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                        <p className={cn("line-clamp-2 min-w-0 text-xs font-semibold leading-5", tokens.textSoft)}>{title}</p>
                        <p className={cn("shrink-0 text-xs font-bold tabular-nums", tokens.text)}>{monetizationCurrency(monetizationNumber(video, "estimatedRevenue", "revenue"), currency)}</p>
                      </div>
                    );
                  })}
                  {!topVideos.length ? <p className={cn("text-sm leading-6", tokens.muted)}>Video-level earnings are not available for this period.</p> : null}
                </div>
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function MonetizationMetric({ theme, label, value, change }: { theme: AgentTheme; label: string; value: string; change?: number | null }) {
  const tokens = getAgentTheme(theme);
  const hasChange = typeof change === "number" && Number.isFinite(change);
  const positive = Number(change || 0) >= 0;
  return (
    <div className={cn("min-w-0 px-4 py-4 [&+&]:border-t xl:[&+&]:border-l xl:[&+&]:border-t-0 xl:px-5", tokens.divider)}>
      <dt className={cn("text-[10px] font-semibold uppercase tracking-[0.13em]", tokens.muted)}>{label}</dt>
      <dd className={cn("mt-2 truncate text-lg font-bold tabular-nums", tokens.text)}>{value}</dd>
      {hasChange ? (
        <p className={cn("mt-1 flex items-center gap-1 text-[11px] font-bold tabular-nums", positive ? "text-emerald-700" : "text-red-600")}>
          {positive ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
          {Math.abs(Number(change)).toFixed(1)}% vs previous period
        </p>
      ) : null}
    </div>
  );
}

function AgentReportPanel({ report, theme }: { report: AgentPerformanceReport | null; theme: AgentTheme }) {
  const tokens = getAgentTheme(theme);
  if (!report) {
    return (
      <section className={cn("rounded-xl border p-4 md:p-5", tokens.surface)}>
        <AnalyticsPanelHeader title="Agent report" detail="Source quality, cadence health, and channel-level recommendations from recent runs." theme={theme} />
        <AnalyticsEmpty theme={theme} text="The report builds after this agent completes its first uploads and performance checks." />
      </section>
    );
  }
  return <PerformanceReportView report={report} theme={theme} />;
}

function AnalyticsThumbnailStrip({ rows, theme, onPreview }: { rows: any[]; theme: AgentTheme; onPreview: (row: any) => void }) {
  const tokens = getAgentTheme(theme);
  const visualRows = rows.filter((row) => row.thumbnailUrl).slice(0, 6);
  if (!visualRows.length) return null;
  return (
    <section className={cn("rounded-xl border p-3", tokens.surfaceSoft)}>
      <div className="mb-3 flex items-center justify-between gap-3 px-1">
        <div><h3 className={cn("text-sm font-black", tokens.text)}>Top-performing videos</h3><p className={cn("mt-1 text-xs font-semibold", tokens.muted)}>Select a thumbnail to preview the actual upload.</p></div>
        <span className={cn("text-[10px] font-black uppercase tracking-[0.14em]", tokens.subtle)}>{visualRows.length} previews</span>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        {visualRows.map((row) => (
          <button key={row.id} type="button" onClick={() => onPreview(row)} className="group relative aspect-[9/16] min-w-0 overflow-hidden rounded-xl bg-[var(--ui-text)] text-left">
            <img src={row.thumbnailUrl} alt="" className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03] group-hover:opacity-75" />
            <span className="absolute inset-x-0 bottom-0 bg-[var(--ui-text)]/85 p-2 text-white">
              <span className="line-clamp-2 text-[11px] font-bold leading-4">{row.title}</span>
              <span className="mt-1 block text-[9px] font-bold text-[var(--ui-accent-text)]">{compact(row.views)} views</span>
            </span>
            <span className="absolute left-2 top-2 grid h-8 w-8 place-items-center rounded-full bg-[var(--ui-accent)] text-[var(--ui-accent-ink)] shadow-lg transition group-hover:scale-105"><Play className="h-3.5 w-3.5 fill-current" /></span>
          </button>
        ))}
      </div>
    </section>
  );
}

function AnalyticsKpi({ theme, icon, label, value, detail }: { theme: AgentTheme; icon: ReactNode; label: string; value: string; detail: string }) {
  const tokens = getAgentTheme(theme);
  return (
    <div className={cn("min-w-0 p-4 sm:[&+&]:border-l", tokens.divider)}>
      <div className="flex items-center justify-between gap-2">
        <p className={cn("text-[10px] font-black uppercase tracking-[0.16em]", tokens.subtle)}>{label}</p>
        <span className="text-[var(--ui-accent-text)]">{icon}</span>
      </div>
      <p className={cn("mt-3 text-2xl font-black tabular-nums", tokens.text)}>{value}</p>
      <p className={cn("mt-1 text-xs font-semibold", tokens.muted)}>{detail}</p>
    </div>
  );
}

function AnalyticsTinyStat({ theme, label, value }: { theme: AgentTheme; label: string; value: string }) {
  const tokens = getAgentTheme(theme);
  return (
    <div className="min-w-0 p-3">
      <p className={cn("text-[9px] font-black uppercase tracking-[0.14em]", tokens.subtle)}>{label}</p>
      <p className={cn("mt-1 line-clamp-2 text-xs font-bold leading-5", tokens.text)}>{value}</p>
    </div>
  );
}

function AnalyticsPanelHeader({ title, detail, theme }: { title: string; detail: string; theme: AgentTheme }) {
  const tokens = getAgentTheme(theme);
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <h3 className={cn("text-sm font-black", tokens.text)}>{title}</h3>
        <p className={cn("mt-1 text-xs font-semibold leading-5", tokens.muted)}>{detail}</p>
      </div>
      <TrendingUp className="h-4 w-4 shrink-0 text-[var(--ui-accent-text)]" />
    </div>
  );
}

function MomentumChart({ points, theme }: { points: any[]; theme: AgentTheme }) {
  const tokens = getAgentTheme(theme);
  const width = 760;
  const height = 280;
  const padLeft = 56;
  const padRight = 16;
  const padTop = 22;
  const padBottom = 12;
  const shown = points.slice(-24);
  const maxViews = Math.max(...shown.map((point) => point.views), 1);
  const avgViews = shown.length ? shown.reduce((sum, point) => sum + point.views, 0) / shown.length : 0;
  const innerWidth = width - padLeft - padRight;
  const innerHeight = height - padTop - padBottom;
  const slot = shown.length ? innerWidth / shown.length : innerWidth;
  const barWidth = Math.max(6, Math.min(34, slot * 0.62));
  const y = (value: number) => padTop + innerHeight - (value / maxViews) * innerHeight;
  const bestIndex = shown.reduce((best, point, index) => (point.views > shown[best].views ? index : best), 0);
  const gridInk = tokens.isDark ? "rgba(248,245,232,0.12)" : "rgba(26,26,26,0.12)";
  const labelInk = tokens.isDark ? "rgba(248,245,232,0.55)" : "rgba(26,26,26,0.5)";
  return (
    <section className={cn("min-w-0 rounded-xl border p-4 md:p-5", tokens.surface)}>
      <AnalyticsPanelHeader title="Views per upload" detail={`Each bar is one upload, oldest on the left${points.length > shown.length ? ` (last ${shown.length} shown)` : ""}. The dashed line is the agent's average, and the best upload is labeled.`} theme={theme} />
      {shown.length ? (
        <div className="mt-4">
          <svg viewBox={`0 0 ${width} ${height}`} className="w-full overflow-visible" role="img" aria-label="Bar chart of views for each upload">
            {[0, 0.5, 1].map((level) => (
              <g key={level}>
                <line x1={padLeft} x2={width - padRight} y1={y(maxViews * level)} y2={y(maxViews * level)} stroke={gridInk} strokeDasharray={level === 0 ? undefined : "3 6"} />
                <text x={padLeft - 8} y={y(maxViews * level) + 4} textAnchor="end" fontSize="11" fontWeight="600" fill={labelInk}>{level === 0 ? "0" : compact(Math.round(maxViews * level))}</text>
              </g>
            ))}
            {avgViews > 0 ? (
              <g>
                <line x1={padLeft} x2={width - padRight} y1={y(avgViews)} y2={y(avgViews)} stroke={tokens.isDark ? "rgba(248,245,232,0.45)" : "rgba(26,26,26,0.4)"} strokeDasharray="6 4" />
                <text x={width - padRight} y={y(avgViews) - 5} textAnchor="end" fontSize="10" fontWeight="700" fill={labelInk}>avg {compact(Math.round(avgViews))}</text>
              </g>
            ) : null}
            {shown.map((point, index) => {
              const barX = padLeft + index * slot + (slot - barWidth) / 2;
              const barY = y(point.views);
              const barHeight = Math.max(padTop + innerHeight - barY, point.views > 0 ? 3 : 1);
              const isBest = index === bestIndex && point.views > 0;
              return (
                <g key={point.id} className="transition-opacity hover:opacity-70">
                  <rect x={barX} y={padTop + innerHeight - barHeight} width={barWidth} height={barHeight} rx={3} fill="#f9dc0b" opacity={isBest ? 1 : 0.72}>
                    <title>{point.label}: {point.views.toLocaleString()} views, {Number(point.engagement || 0).toLocaleString()} engagements</title>
                  </rect>
                  {isBest ? (
                    <text x={barX + barWidth / 2} y={padTop + innerHeight - barHeight - 6} textAnchor="middle" fontSize="11" fontWeight="800" fill={tokens.isDark ? "#F8F5E8" : "#1A1A1A"}>{compact(point.views)}</text>
                  ) : null}
                </g>
              );
            })}
          </svg>
          <div className={cn("mt-2 flex justify-between border-t pt-3 text-[10px] font-bold uppercase tracking-[0.12em]", tokens.divider, tokens.subtle)}>
            <span>{shown[0]?.label} (oldest)</span><span>peak {compact(maxViews)}</span><span>{shown.at(-1)?.label} (newest)</span>
          </div>
        </div>
      ) : <AnalyticsEmpty theme={theme} text="This chart fills in after the agent's first uploads capture public view counts." />}
    </section>
  );
}

function PortfolioChart({ items, theme }: { items: any[]; theme: AgentTheme }) {
  const tokens = getAgentTheme(theme);
  const width = 560;
  const height = 330;
  const padLeft = 56;
  const padRight = 18;
  const padTop = 20;
  const padBottom = 44;
  const maxViews = Math.max(...items.map((item) => item.views), 1);
  const maxEngagement = Math.max(...items.map((item) => item.engagementRate), 1);
  const x = (engagementRate: number) => padLeft + (engagementRate / maxEngagement) * (width - padLeft - padRight);
  const yv = (views: number) => padTop + (1 - views / maxViews) * (height - padTop - padBottom);
  const median = (values: number[]) => {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  };
  const medianViews = median(items.map((item) => item.views));
  const medianEngagement = median(items.map((item) => item.engagementRate));
  const topIds = new Set(items.slice(0, 3).map((item) => item.id));
  const gridInk = tokens.isDark ? "rgba(248,245,232,0.12)" : "rgba(26,26,26,0.12)";
  const labelInk = tokens.isDark ? "rgba(248,245,232,0.55)" : "rgba(26,26,26,0.5)";
  const quadrantInk = tokens.isDark ? "rgba(248,245,232,0.4)" : "rgba(26,26,26,0.38)";
  const surfaceInk = tokens.isDark ? "#191C18" : "#ffffff";
  return (
    <section className={cn("rounded-xl border p-4 md:p-5", tokens.surface)}>
      <AnalyticsPanelHeader title="Reach vs engagement map" detail="Each dot is one upload. Up means more views, right means viewers interact more. Dots in the top-right are the formats to repeat." theme={theme} />
      {items.length ? (
        <div className="mt-4">
          <svg viewBox={`0 0 ${width} ${height}`} className="w-full overflow-visible" role="img" aria-label="Scatter plot of views versus engagement rate per upload">
            <rect x={padLeft} y={padTop} width={width - padLeft - padRight} height={height - padTop - padBottom} fill="none" stroke={gridInk} rx={8} />
            {items.length >= 4 ? (
              <g>
                <line x1={x(medianEngagement)} x2={x(medianEngagement)} y1={padTop} y2={height - padBottom} stroke={gridInk} strokeDasharray="4 6" />
                <line x1={padLeft} x2={width - padRight} y1={yv(medianViews)} y2={yv(medianViews)} stroke={gridInk} strokeDasharray="4 6" />
                <text x={width - padRight - 6} y={padTop + 14} textAnchor="end" fontSize="10" fontWeight="700" fill={quadrantInk}>Winners — repeat these</text>
                <text x={padLeft + 6} y={padTop + 14} fontSize="10" fontWeight="700" fill={quadrantInk}>Views but weak hooks</text>
                <text x={width - padRight - 6} y={height - padBottom - 8} textAnchor="end" fontSize="10" fontWeight="700" fill={quadrantInk}>Loved by few — grow reach</text>
                <text x={padLeft + 6} y={height - padBottom - 8} fontSize="10" fontWeight="700" fill={quadrantInk}>Low signal</text>
              </g>
            ) : null}
            {items.map((item) => (
              <g key={item.id} className="transition-opacity hover:opacity-70">
                <circle cx={x(item.engagementRate)} cy={yv(item.views)} r={7} fill="#f9dc0b" stroke={surfaceInk} strokeWidth={2}>
                  <title>{item.title}: {compact(item.views)} views · {item.engagementRate}% engagement</title>
                </circle>
                {topIds.has(item.id) ? (
                  <text x={x(item.engagementRate)} y={yv(item.views) - 11} textAnchor="middle" fontSize="10" fontWeight="800" fill={tokens.isDark ? "#F8F5E8" : "#1A1A1A"}>{String(item.title || "").slice(0, 18)}{String(item.title || "").length > 18 ? "…" : ""}</text>
                ) : null}
              </g>
            ))}
            <text x={padLeft - 8} y={padTop + 4} textAnchor="end" fontSize="11" fontWeight="600" fill={labelInk}>{compact(maxViews)}</text>
            <text x={padLeft - 8} y={height - padBottom + 4} textAnchor="end" fontSize="11" fontWeight="600" fill={labelInk}>0</text>
            <text x={padLeft} y={height - padBottom + 18} fontSize="11" fontWeight="600" fill={labelInk}>0%</text>
            <text x={width - padRight} y={height - padBottom + 18} textAnchor="end" fontSize="11" fontWeight="600" fill={labelInk}>{maxEngagement.toFixed(1)}%</text>
            <text x={(padLeft + width - padRight) / 2} y={height - 6} textAnchor="middle" fontSize="10" fontWeight="800" fill={labelInk}>ENGAGEMENT RATE (LIKES + COMMENTS PER VIEW) →</text>
            <text x={14} y={(padTop + height - padBottom) / 2} textAnchor="middle" fontSize="10" fontWeight="800" fill={labelInk} transform={`rotate(-90 14 ${(padTop + height - padBottom) / 2})`}>VIEWS →</text>
          </svg>
        </div>
      ) : <AnalyticsEmpty theme={theme} text="The map fills in once uploads have public view and engagement counts." />}
    </section>
  );
}

function ReleaseHeatmap({ cells, theme }: { cells: any[]; theme: AgentTheme }) {
  const tokens = getAgentTheme(theme);
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const hours = [0, 4, 8, 12, 16, 20];
  const bucket = (day: number, hour: number) => cells.filter((cell) => cell.day === day && cell.hour >= hour && cell.hour < hour + 4);
  const value = (day: number, hour: number) => bucket(day, hour).reduce((sum, cell) => sum + cell.views, 0);
  const uploadsIn = (day: number, hour: number) => bucket(day, hour).reduce((sum, cell) => sum + cell.uploads, 0);
  const max = Math.max(...days.flatMap((_, day) => hours.map((hour) => value(day, hour))), 1);
  const best = days.flatMap((day, dayIndex) => hours.map((hour) => ({ day, hour, views: value(dayIndex, hour) }))).reduce((top, cell) => (cell.views > top.views ? cell : top), { day: "", hour: 0, views: 0 });
  return (
    <section className={cn("rounded-xl border p-4 md:p-5", tokens.surfaceSoft)}>
      <AnalyticsPanelHeader title="Views by release time" detail="Total views earned by uploads released in each 4-hour window (GMT+3). Darker cells earned more views." theme={theme} />
      <div className="mt-5 overflow-x-auto">
        <div className="grid min-w-[390px] grid-cols-[38px_repeat(6,minmax(38px,1fr))] gap-2">
          <span />
          {hours.map((hour) => <span key={hour} className={cn("text-center text-[9px] font-bold", tokens.subtle)}>{String(hour).padStart(2, "0")}–{String(hour + 4).padStart(2, "0")}</span>)}
          {days.map((day, dayIndex) => [
            <span key={`${day}-label`} className={cn("self-center text-[9px] font-black uppercase", tokens.subtle)}>{day}</span>,
            ...hours.map((hour) => {
              const views = value(dayIndex, hour);
              const uploads = uploadsIn(dayIndex, hour);
              const opacity = views ? 0.18 + (views / max) * 0.82 : 0.04;
              return <div key={`${day}-${hour}`} className={cn("aspect-square rounded-md border", tokens.divider)} style={{ backgroundColor: `rgb(249 220 11 / ${opacity})` }} title={uploads ? `${day} ${hour}:00-${hour + 4}:00 · ${uploads} upload${uploads > 1 ? "s" : ""} · ${views.toLocaleString()} views` : `${day} ${hour}:00-${hour + 4}:00 · no releases yet`} />;
            }),
          ])}
        </div>
      </div>
      <div className={cn("mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-3 text-[10px] font-bold", tokens.divider, tokens.subtle)}>
        <span className="inline-flex items-center gap-1.5">
          Fewer views
          {[0.08, 0.3, 0.55, 0.8, 1].map((step) => (
            <span key={step} className={cn("h-3 w-3 rounded-sm border", tokens.divider)} style={{ backgroundColor: `rgb(249 220 11 / ${step})` }} />
          ))}
          More views
        </span>
        <span>{best.views > 0 ? `Best window so far: ${best.day} ${String(best.hour).padStart(2, "0")}:00–${String(best.hour + 4).padStart(2, "0")}:00 · ${compact(best.views)} views` : "Waiting for the first releases"}</span>
      </div>
    </section>
  );
}

function RankedUploadsTable({ rows, theme, onPreview }: { rows: any[]; theme: AgentTheme; onPreview: (row: any) => void }) {
  const tokens = getAgentTheme(theme);
  return (
    <section className={cn("overflow-hidden rounded-xl border", tokens.surface)}>
      <div className="p-4 md:p-5"><AnalyticsPanelHeader title="Ranked upload performance" detail="Public outcomes sorted by views, with engagement and niche context." theme={theme} /></div>
      {rows.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-left">
            <thead className={cn("border-y text-[9px] font-black uppercase tracking-[0.14em]", tokens.divider, tokens.surfaceSoft, tokens.subtle)}>
              <tr><th className="px-5 py-3">Upload</th><th className="px-3 py-3">Genre / MSN</th><th className="px-3 py-3 text-right">Views</th><th className="px-3 py-3 text-right">Engagement</th><th className="px-3 py-3 text-right">Comments</th><th className="px-5 py-3 text-right">Status</th></tr>
            </thead>
            <tbody>
              {rows.slice(0, 10).map((row, index) => (
                <tr key={row.id} className={cn("border-b last:border-0", tokens.divider)}>
                  <td className="max-w-sm px-5 py-3">
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-black text-[var(--ui-accent-text)]">{String(index + 1).padStart(2, "0")}</span>
                      <button type="button" onClick={() => onPreview(row)} disabled={!row.playbackUrl} className="group relative h-14 w-11 shrink-0 overflow-hidden rounded-md bg-[var(--ui-text)] disabled:cursor-default" aria-label={`Preview ${row.title}`}>
                        {row.thumbnailUrl ? <img src={row.thumbnailUrl} alt="" className="h-full w-full object-cover transition group-hover:opacity-65" /> : <Film className="m-auto h-full w-4 text-[var(--ui-accent-text)]" />}
                        {row.playbackUrl ? <span className="absolute inset-0 grid place-items-center opacity-0 transition group-hover:opacity-100"><span className="grid h-6 w-6 place-items-center rounded-full bg-[var(--ui-accent)] text-[var(--ui-accent-ink)]"><Play className="h-3 w-3 fill-current" /></span></span> : null}
                      </button>
                      <div><p className={cn("line-clamp-1 text-sm font-bold", tokens.text)}>{row.title}</p><p className={cn("mt-1 text-xs font-semibold", tokens.subtle)}>{row.movie}</p></div>
                    </div>
                  </td>
                  <td className="px-3 py-3"><p className={cn("text-xs font-bold", tokens.textSoft)}>{row.genre}</p><p className={cn("mt-1 text-[10px] font-semibold", tokens.subtle)}>{row.microNiche}</p></td>
                  <td className={cn("px-3 py-3 text-right text-sm font-black tabular-nums", tokens.text)}>{compact(row.views)}</td>
                  <td className={cn("px-3 py-3 text-right text-sm font-bold tabular-nums", tokens.text)}>{row.engagementRate}%</td>
                  <td className={cn("px-3 py-3 text-right text-sm font-bold tabular-nums", tokens.text)}>{compact(row.comments)}</td>
                  <td className="px-5 py-3 text-right"><span className={cn("rounded-full px-2 py-1 text-[9px] font-black uppercase", row.status === "upload_failed" ? "bg-[var(--ui-accent)]/15 text-[var(--ui-accent-text)]" : "bg-[var(--ui-accent)] text-[var(--ui-accent-ink)]")}>{String(row.status || "pending").replace(/_/g, " ")}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <AnalyticsEmpty theme={theme} text="Ranked uploads appear after this agent publishes." />}
    </section>
  );
}

function AgentVideoLightbox({ item, onClose }: { item: any; theme?: AgentTheme; onClose: () => void }) {
  return (
    <Dialog
      title={item.title}
      description={`${item.movie} · ${compact(item.views)} views`}
      size="xl"
      onClose={onClose}
      footer={item.externalUrl ? <a href={item.externalUrl} target="_blank" rel="noreferrer" className="ui-btn"><ExternalLink className="h-4 w-4" />Open original</a> : undefined}
    >
      {item.playbackUrl ? (
        <iframe src={item.playbackUrl} title={item.title} allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen className="aspect-video max-h-[70dvh] w-full rounded-lg border-0 bg-[#090b09] border-[var(--ui-line)]" />
      ) : (
        <EmptyState compact icon={<Play className="h-5 w-5" />} title="Preview unavailable" body="This upload can't be played here." />
      )}
    </Dialog>
  );
}

function AnalyticsDistribution({ title, rows, theme }: { title: string; rows: any[]; theme: AgentTheme }) {
  const tokens = getAgentTheme(theme);
  const max = Math.max(...rows.map((row) => row.views), 1);
  return (
    <section className={cn("rounded-xl border p-4", tokens.surfaceSoft)}>
      <h3 className={cn("text-sm font-black", tokens.text)}>{title}</h3>
      <div className="mt-4 space-y-3">
        {rows.slice(0, 5).map((row, index) => <div key={row.label}><div className="flex justify-between gap-3"><span className={cn("line-clamp-1 text-xs font-bold", tokens.textSoft)}>{row.label}</span><span className={cn("text-xs font-black", tokens.text)}>{compact(row.views)}</span></div><div className={cn("mt-2 h-1.5 overflow-hidden rounded-full", tokens.isDark ? "bg-[var(--ui-text)]/8" : "bg-[var(--ui-text)]/7")}><div className="h-full rounded-full bg-[var(--ui-accent)]" style={{ width: `${Math.max(5, (row.views / max) * 100)}%`, opacity: 1 - index * 0.1 }} /></div></div>)}
        {!rows.length ? <p className={cn("text-sm font-semibold", tokens.muted)}>No contribution data yet.</p> : null}
      </div>
    </section>
  );
}

function ReliabilityPanel({ analytics, reliability, agent, theme }: { analytics: any; reliability: any; agent: AutomationAgent | null; theme: AgentTheme }) {
  const tokens = getAgentTheme(theme);
  return (
    <section className={cn("rounded-xl border p-4", tokens.surface)}>
      <div className="flex items-start justify-between gap-3"><div><h3 className={cn("text-sm font-black", tokens.text)}>Operational quality</h3><p className={cn("mt-1 text-xs font-semibold", tokens.muted)}>Run and community health.</p></div><StatusPill status={agent?.status || "draft"} /></div>
      <div className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-[var(--ui-accent)]/20 bg-[var(--ui-accent)]/20">
        <AnalyticsTinyStat theme={theme} label="Successful runs" value={`${reliability.success}/${reliability.total}`} />
        <AnalyticsTinyStat theme={theme} label="Failed runs" value={String(reliability.failed)} />
        <AnalyticsTinyStat theme={theme} label="Agent replies" value={compact(analytics.totalReplies)} />
        <AnalyticsTinyStat theme={theme} label="Quality skips" value={compact(analytics.skips.length)} />
      </div>
    </section>
  );
}

function AnalyticsEmpty({ theme, text }: { theme: AgentTheme; text: string }) {
  const tokens = getAgentTheme(theme);
  return (
    <div className={cn("mt-4 rounded-lg border border-dashed", tokens.surfaceSoft)}>
      <EmptyState compact icon={<BarChart3 className="h-5 w-5" />} title="No data yet" body={text} />
    </div>
  );
}

function buildAgentAnalytics(uploads: AutomationUpload[], runs: AutomationRun[]) {
  const bucket = (label: string, upload: AutomationUpload, map: Map<string, any>) => {
    const key = label.trim() || "Unknown";
    const current = map.get(key) || { label: key, uploads: 0, views: 0, likes: 0, comments: 0, replies: 0 };
    current.uploads += 1;
    current.views += metric(upload, "viewCount");
    current.likes += metric(upload, "likeCount");
    current.comments += metric(upload, "commentCount");
    current.replies += Number(upload.commentReplyStats?.total || 0);
    map.set(key, current);
  };
  const genreMap = new Map<string, any>();
  const msnMap = new Map<string, any>();
  const sourceMap = new Map<string, any>();
  let totalViews = 0;
  let totalLikes = 0;
  let totalComments = 0;
  let totalReplies = 0;
  let movieReplies = 0;
  let aiReplies = 0;

  uploads.forEach((upload) => {
    totalViews += metric(upload, "viewCount");
    totalLikes += metric(upload, "likeCount");
    totalComments += metric(upload, "commentCount");
    totalReplies += Number(upload.commentReplyStats?.total || 0);
    movieReplies += Number(upload.commentReplyStats?.movieName || 0);
    aiReplies += Number(upload.commentReplyStats?.aiEngagement || 0);
    bucket(upload.genre || "Unknown genre", upload, genreMap);
    bucket(upload.microNiche || "Unknown MSN", upload, msnMap);
    bucket(upload.sourceAuthor || "Unknown source", upload, sourceMap);
  });

  const sortRows = (map: Map<string, any>) => [...map.values()].sort((a, b) => b.views - a.views || b.replies - a.replies || b.uploads - a.uploads);
  const successRuns = runs.filter((run) => run.status === "success").length;
  const errorRuns = runs.filter((run) => ["error", "failed"].includes(String(run.status).toLowerCase())).length;
  const skips = runs.flatMap((run) => {
    const details: any = run.details || {};
    return Array.isArray(details.skippedLowQuality) ? details.skippedLowQuality : [];
  });
  const replyUploads = uploads
    .map((upload) => ({
      id: upload.id,
      title: upload.title,
      comments: metric(upload, "commentCount"),
      replies: Number(upload.commentReplyStats?.total || 0),
      lastReplyAt: upload.commentReplyStats?.lastReplyAt || null,
    }))
    .filter((item) => item.replies > 0)
    .sort((a, b) => b.replies - a.replies || Number(b.lastReplyAt || 0) - Number(a.lastReplyAt || 0));
  const momentum = uploads
    .map((upload) => ({
      id: upload.id,
      title: upload.title,
      movie: `${upload.movieTitle || "Unknown"} ${upload.movieYear || ""}`.trim(),
      genre: upload.genre || "Unknown",
      views: metric(upload, "viewCount"),
      likes: metric(upload, "likeCount"),
      comments: metric(upload, "commentCount"),
      createdAt: upload.createdAt,
    }))
    .sort((a, b) => b.views - a.views || b.createdAt - a.createdAt);
  const genres = sortRows(genreMap);
  const msns = sortRows(msnMap);
  const recommendation = !uploads.length
    ? "Run a few candidates before judging this agent."
    : genres[0] && msns[0]
      ? `Prioritize ${genres[0].label} clips inside "${msns[0].label}" until the next performance check proves otherwise.`
      : "Keep collecting uploads until a clear genre or MSN winner appears.";

  return {
    totalViews,
    totalLikes,
    totalComments,
    totalReplies,
    movieReplies,
    aiReplies,
    genres,
    msns,
    sources: sortRows(sourceMap),
    successRuns,
    errorRuns,
    skips,
    replyUploads,
    momentum,
    recommendation,
  };
}

function CreateAgentWizard({
  accounts,
  sources,
  form,
  saving,
  step,
  onSetStep,
  setForm,
  updateSetting,
  setScheduleTime,
  addScheduleTime,
  removeScheduleTime,
  saveAgent,
  onCancel,
  onAnalyzeSource,
  theme = "light",
}: {
  accounts: ConnectedYouTubeAccount[];
  sources: AutomationSourceSummary[];
  form: any;
  saving: boolean;
  step: number;
  onSetStep: (step: number) => void;
  setForm: (value: any) => void;
  updateSetting: (key: string, value: unknown) => void;
  setScheduleTime: (index: number, value: string) => void;
  addScheduleTime: () => void;
  removeScheduleTime: (index: number) => void;
  saveAgent: (event: FormEvent) => Promise<void>;
  onCancel: () => void;
  onAnalyzeSource: (url: string) => Promise<void | boolean>;
  theme?: AgentTheme;
}) {
  const tokens = getAgentTheme(theme);
  const [stepError, setStepError] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const lastIndex = AGENT_CREATE_STEPS.length - 1;
  const current = AGENT_CREATE_STEPS[Math.min(step, lastIndex)];
  const firstIncomplete = agentCreateFirstIncompleteStep(form);
  const sourceTagOptions = useMemo(() => collectSourceTags(sources), [sources]);
  const selectedSourceTags: string[] = Array.isArray(form.settings.sourceTags) ? form.settings.sourceTags : [];
  const selectedSource = findSelectedSource(sources, form.sourceKey, form.sourceUrl);
  const publishAccount = accounts.find((account) => account.id === form.youtubeAccountId) || null;
  const tiktokPublish = isTikTokPublishAccount(publishAccount);
  const scheduleTimes = cleanScheduleTimes(form.settings.scheduleTimes);
  const sourceMode: "saved" | "url" | "tags" = form.sourceType === "custom_url" ? "url" : form.sourceType === "saved_tags" ? "tags" : "saved";
  const postsPerDay = Number(form.settings.maxPostsPerDay || 1);

  useEffect(() => {
    setStepError("");
    scrollRef.current?.closest("[data-agent-scroll]")?.scrollTo({ top: 0 });
  }, [step]);

  function goTo(nextStep: number) {
    onSetStep(Math.max(0, Math.min(lastIndex, nextStep)));
  }

  function chooseSavedSource(key: string) {
    const source = sources.find((item) => item.key === key);
    setForm((prev: any) => ({ ...prev, sourceType: "saved_playlist", sourceKey: source?.key || key, sourceUrl: source?.analyzedUrl || source?.key || "" }));
    setStepError("");
  }

  function toggleTag(tag: string) {
    const active = selectedSourceTags.some((item) => item.toLowerCase() === tag.toLowerCase());
    const nextTags = active ? selectedSourceTags.filter((item) => item.toLowerCase() !== tag.toLowerCase()) : [...selectedSourceTags, tag];
    setForm((prev: any) => ({ ...prev, sourceType: "saved_tags", sourceKey: "", sourceUrl: "", settings: { ...prev.settings, sourceTags: nextTags } }));
    setStepError("");
  }

  async function submitSourceUrl(raw: string) {
    const url = await resolvePastedSource(raw);
    setForm((prev: any) => ({ ...prev, sourceType: "custom_url", sourceKey: "", sourceUrl: url }));
    setStepError("");
    return onAnalyzeSource(url);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const problem = agentCreateStepError(current.id, form);
    if (problem) {
      setStepError(problem);
      return;
    }
    if (step < lastIndex) {
      goTo(step + 1);
      return;
    }
    const earlier = agentCreateFirstIncompleteStep(form);
    if (earlier < lastIndex) {
      goTo(earlier);
      return;
    }
    await saveAgent(event);
  }

  const sourceSummary = sourceMode === "url"
    ? form.sourceUrl || "No URL yet"
    : sourceMode === "tags"
      ? selectedSourceTags.length ? selectedSourceTags.join(", ") : "No tags yet"
      : selectedSource ? sourceDisplayName(selectedSource) : form.sourceKey || "No source yet";

  return (
    <form id="automation-agent-form" onSubmit={handleSubmit} noValidate className="mx-auto flex min-h-full w-full max-w-3xl flex-col" aria-labelledby="agent-create-heading">
      <div ref={scrollRef} className="flex-1 space-y-5 pb-6">
        <ol className={cn("grid grid-cols-3 gap-2 rounded-xl border p-1.5", tokens.surfaceSoft)} aria-label="Creation steps">
          {AGENT_CREATE_STEPS.map((item, index) => {
            const done = index < step;
            const isCurrent = index === step;
            const reachable = index <= Math.max(step, firstIncomplete);
            return (
              <li key={item.id}>
                <button
                  type="button"
                  disabled={!reachable}
                  aria-current={isCurrent ? "step" : undefined}
                  onClick={() => goTo(index)}
                  className={cn(
                    "flex h-11 w-full items-center justify-center gap-2 rounded-lg px-2 text-xs font-bold transition disabled:cursor-not-allowed disabled:opacity-45",
                    isCurrent ? (tokens.isDark ? "bg-[var(--ui-text)]/12 text-[var(--ui-text)] ring-1 ring-[#F8F5E8]/15" : tokens.setupTabActive) : tokens.setupTabIdle,
                  )}
                >
                  <span className={cn("grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-black", done ? "bg-[var(--ui-accent)] text-[var(--ui-accent-ink)]" : isCurrent ? "bg-[var(--ui-text)] text-[var(--ui-accent)]" : tokens.isDark ? "bg-[var(--ui-text)]/12 text-[var(--ui-text)]/70" : "bg-[var(--ui-text)]/8 text-[var(--ui-text)]/60")} aria-hidden="true">
                    {done ? <CheckCircle2 className="h-3.5 w-3.5" /> : index + 1}
                  </span>
                  <span className="truncate">{item.label}</span>
                </button>
              </li>
            );
          })}
        </ol>

        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[var(--ui-accent-text)]">Step {step + 1} of {AGENT_CREATE_STEPS.length}</p>
          <h2 id="agent-create-heading" className={cn("mt-1 font-serif text-2xl font-bold tracking-tight md:text-3xl", tokens.text)}>
            {current.id === "source" ? "Where should clips come from?" : current.id === "publish" ? "Where and when should it post?" : "Ready to create this agent?"}
          </h2>
          <p className={cn("mt-1 max-w-xl text-sm leading-6", tokens.muted)}>
            {current.id === "source"
              ? "Pick one source. The agent ranks its videos, identifies each movie, and turns the best ones into uploads."
              : current.id === "publish"
                ? "Choose the channel and the daily rhythm. Everything else has sensible defaults you can tune later in Setup."
                : "Check the summary. The agent starts paused so you can run one test before it posts on its own."}
          </p>
        </div>

        {current.id === "source" ? (
          <section className={cn("space-y-4 rounded-xl border p-4 md:p-5", tokens.surface)}>
            <Field label="Source">
              <SourcePicker
                value={selectedSource?.key || form.sourceKey || ""}
                onChange={chooseSavedSource}
                options={sources.map(sourcePickerOption)}
                theme={theme}
                label="Source"
                placeholder="Choose a saved source"
                urlValue={form.sourceUrl}
                onUrlChange={(value) => setForm((prev: any) => ({ ...prev, sourceType: "custom_url", sourceKey: "", sourceUrl: value }))}
                onUrlSubmit={submitSourceUrl}
                tags={sourceTagOptions}
                selectedTags={selectedSourceTags}
                onToggleTag={toggleTag}
              />
            </Field>

            <Field label="Niche (optional)">
              <input value={form.settings.genreFocus || ""} onChange={(event) => updateSetting("genreFocus", event.target.value)} placeholder="Movie recaps" className="ui-input" />
            </Field>
            <p className={cn("text-xs leading-5", tokens.subtle)}>You can add more sources to the pool later from Setup.</p>
          </section>
        ) : null}

        {current.id === "publish" ? (
          <section className={cn("space-y-4 rounded-xl border p-4 md:p-5", tokens.surface)}>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Agent name">
                <input value={form.name} onChange={(event) => { const value = event.target.value; setForm((prev: any) => ({ ...prev, name: value })); if (stepError) setStepError(""); }} className="ui-input" autoFocus />
              </Field>
              <Field label="Publish channel">
                <SourcePicker theme={theme} label="Publish channel" value={form.youtubeAccountId} onChange={value => setForm((prev: any) => ({ ...prev, youtubeAccountId: value }))} options={accounts.map(account => ({ value: account.id, label: account.channelTitle, imageUrl: account.thumbnailUrl }))} />
              </Field>
              <VisibilityControl theme={theme} label="How posts go live" value={form.settings.publishMode} onChange={(value) => updateSetting("publishMode", value)} options={SCHEDULED_VISIBILITY_OPTIONS} />
              <Field label="Posts per day">
                <input type="number" min={1} max={12} value={postsPerDay} onChange={(event) => updateSetting("maxPostsPerDay", Math.max(1, Math.min(12, Number(event.target.value) || 1)))} className="ui-input" />
              </Field>
            </div>

            <ReleaseTimesEditor times={scheduleTimes} onSet={setScheduleTime} onAdd={addScheduleTime} onRemove={removeScheduleTime} onChanged={() => { if (stepError) setStepError(""); }} theme={theme} />

            {!tiktokPublish ? (
              <ToggleRow
                title="Post as YouTube Shorts"
                body="Trims each clip to a complete thought near your target length. Turn off for long-form uploads."
                checked={form.settings.postAsShort !== false}
                onChange={(next) => updateSetting("postAsShort", next)}
              />
            ) : (
              <div className="rounded-xl border border-[var(--ui-accent)]/30 bg-[var(--ui-accent-soft)] px-4 py-3 text-xs font-semibold leading-5 text-[var(--ui-accent-text)]">
                TikTok posts are scheduled as native TikTok videos.
              </div>
            )}
          </section>
        ) : null}

        {current.id === "confirm" ? (
          <section className="space-y-4">
            <dl className={cn("grid gap-px overflow-hidden rounded-xl border", tokens.divider, tokens.isDark ? "bg-[var(--ui-text)]/10" : "bg-[var(--ui-text)]/8")}>
              {[
                { label: "Name", value: form.name || "Untitled agent", step: 1 },
                { label: "Source", value: sourceSummary, step: 0 },
                { label: "Publishes to", value: publishAccount ? publishAccountLabel(publishAccount) : "No channel", step: 1 },
                { label: "Schedule", value: `${postsPerDay} per day at ${scheduleTimes.join(", ") || "no time"} · ${publishModeLabel(form.settings.publishMode)}`, step: 1 },
              ].map((row) => (
                <div key={row.label} className={cn("grid gap-1 px-4 py-3 sm:grid-cols-[120px_minmax(0,1fr)_auto] sm:items-center", tokens.surface)}>
                  <dt className={cn("text-[11px] font-bold uppercase tracking-widest", tokens.subtle)}>{row.label}</dt>
                  <dd className={cn("min-w-0 truncate text-sm font-semibold", tokens.textSoft)}>{row.value}</dd>
                  <button type="button" onClick={() => goTo(row.step)} className={cn("justify-self-start text-xs font-bold underline-offset-2 hover:underline sm:justify-self-end", tokens.muted)}>Edit</button>
                </div>
              ))}
            </dl>

            <label className={cn("flex cursor-pointer items-start gap-3 rounded-xl border p-4 text-sm font-semibold leading-6", form.settings.rightsConfirmed ? tokens.accentPanel : tokens.surface, tokens.textSoft)}>
              <input type="checkbox" checked={form.settings.rightsConfirmed === true} onChange={(event) => { updateSetting("rightsConfirmed", event.target.checked); if (stepError) setStepError(""); }} className="ui-check mt-1 shrink-0" />
              <span><ShieldCheck className="mr-2 inline h-4 w-4 text-[var(--ui-accent-text)]" />I will only run this on clips I own, have permission to reuse, or can lawfully transform for my channel.</span>
            </label>

            <div className={cn("flex gap-3 rounded-xl border p-4", tokens.surfaceSoft)}>
              <ListChecks className="mt-0.5 h-4 w-4 shrink-0 text-[var(--ui-accent-text)]" />
              <p className={cn("text-sm leading-6", tokens.muted)}>After creating, run one test candidate and check the upload. Then activate the agent and it posts on schedule from the server.</p>
            </div>
          </section>
        ) : null}
      </div>

      <div className={cn("sticky bottom-0 -mx-4 mt-auto border-t px-4 py-3 backdrop-blur md:-mx-6 md:px-6", tokens.divider, tokens.isDark ? "bg-[var(--ui-bg)]/92" : "bg-[var(--ui-bg)]/92")}>
        {stepError ? (
          <SharedNotice tone="error" className="mb-3">{stepError}</SharedNotice>
        ) : null}
        <div className="flex items-center justify-between gap-3">
          <button type="button" onClick={() => (step === 0 ? onCancel() : goTo(step - 1))} disabled={saving} className={cn("inline-flex h-11 items-center gap-2 rounded-xl border px-4 text-xs font-bold transition active:scale-[0.98] disabled:opacity-50", tokens.surface, tokens.text)}>
            <ChevronLeft className="h-4 w-4" />
            {step === 0 ? "Cancel" : "Back"}
          </button>
          <button type="submit" disabled={saving} className="ui-btn is-primary">
            {saving ? <Loader2 className="h-4 w-4 ui-spin" /> : step === lastIndex ? <CheckCircle2 className="h-4 w-4" /> : null}
            {saving ? "Creating" : step === lastIndex ? "Create agent" : "Continue"}
            {step < lastIndex && !saving ? <ChevronRight className="h-4 w-4" /> : null}
          </button>
        </div>
      </div>
    </form>
  );
}

function ReleaseTimesEditor({ times, onSet, onAdd, onRemove, onChanged, theme }: { times: string[]; onSet: (index: number, value: string) => void; onAdd: () => void; onRemove: (index: number) => void; onChanged?: () => void; theme: AgentTheme }) {
  const tokens = getAgentTheme(theme);
  return (
    <div className={cn("rounded-xl border p-3", tokens.surfaceSoft)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className={cn("text-[11px] font-bold uppercase tracking-widest", tokens.subtle)}>Release times (GMT+3)</p>
          <p className={cn("mt-1 text-xs font-semibold", tokens.muted)}>Uploads happen 90 to 240 minutes earlier so they are ready on time.</p>
        </div>
        <button type="button" onClick={onAdd} disabled={times.length >= 12} className={cn("inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-xs font-bold transition disabled:opacity-40", tokens.surface, tokens.text)}>
          <Plus className="h-3.5 w-3.5" />
          Add time
        </button>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {times.map((value, index) => (
          <div key={`${index}-${value}`} className={cn("flex items-center gap-1 rounded-lg border p-1", tokens.surface)}>
            <input
              type="time"
              value={value}
              aria-label={`Release time ${index + 1}`}
              onChange={(event) => { onSet(index, event.target.value); onChanged?.(); }}
              className={cn("h-9 w-28 rounded-md bg-transparent px-2 text-sm font-bold outline-none", tokens.text)}
            />
            <button type="button" onClick={() => onRemove(index)} disabled={times.length <= 1} aria-label={`Remove release time ${index + 1}`} className={cn("grid h-9 w-9 place-items-center rounded-md transition hover:bg-[var(--ui-accent-soft)] hover:text-[var(--ui-accent-text)] disabled:cursor-not-allowed disabled:opacity-30", tokens.subtle)}>
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function SetupSection({ id, icon, title, summary, open, onToggle, theme, children }: { id: string; icon: ReactNode; title: string; summary: string; open: boolean; onToggle: () => void; theme: AgentTheme; children: ReactNode }) {
  const tokens = getAgentTheme(theme);
  return (
    <section id={`setup-${id}`} data-open={open} className={cn("agent-setup-section scroll-mt-4 overflow-hidden rounded-[18px] border transition-[background-color,border-color,box-shadow] duration-200", open ? cn(tokens.surface, "shadow-[0_8px_24px_rgba(26,26,26,0.06)]") : cn(tokens.surfaceSoft, tokens.divider))}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={`setup-${id}-body`}
        onClick={onToggle}
        className={cn("agent-setup-section-trigger group flex min-h-[76px] w-full items-center gap-3 px-4 py-3.5 text-left transition focus-visible:-outline-offset-2 md:px-5", tokens.isDark ? "hover:bg-[var(--ui-text)]/5" : "hover:bg-white/80")}
      >
        <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-xl transition-colors", open ? "bg-[var(--ui-accent)] text-[var(--ui-accent-ink)]" : tokens.isDark ? "bg-[var(--ui-text)]/10 text-[var(--ui-text)]/75 group-hover:bg-[var(--ui-text)]/15" : "bg-[var(--ui-text)]/6 text-[var(--ui-text)]/70 group-hover:bg-[var(--ui-text)]/10")}>{icon}</span>
        <span className="min-w-0 flex-1">
          <span className={cn("block text-[13px] font-black tracking-[-0.01em]", tokens.text)}>{title}</span>
          <span className={cn("mt-1 block truncate text-[11px] font-semibold", tokens.muted)}>{summary}</span>
        </span>
        <span className={cn("agent-setup-section-chevron grid h-8 w-8 shrink-0 place-items-center rounded-full transition-colors", open ? "bg-[var(--ui-accent)]/20 text-[var(--ui-accent-text)]" : tokens.isDark ? "bg-[var(--ui-text)]/8 text-[var(--ui-text)]/55 group-hover:bg-[var(--ui-text)]/14" : "bg-[var(--ui-text)]/5 text-[var(--ui-text)]/45 group-hover:bg-[var(--ui-text)]/10")}>
          <ChevronDown className={cn("h-4 w-4 transition-transform duration-200", open && "rotate-180")} aria-hidden="true" />
        </span>
      </button>
      {open ? (
        <div id={`setup-${id}-body`} className="agent-setup-section-body px-4 pb-5 pt-1 md:px-5">
          <div className="agent-setup-section-body-inner">{children}</div>
        </div>
      ) : null}
    </section>
  );
}


type RemakeSectionId = "remake-auto" | "remake-voice" | "remake-avatar" | "remake-captions" | "remake-rights" | "remake-now";
type RemakeSettings = ReturnType<typeof normalizeAgentRemake>;
type AvatarProviders = Record<string, { available: boolean; label: string }>;
const AVATAR_LAYOUT_OPTIONS = [
  { value: "split", label: "Split screen", hint: "Avatar beside the original footage" },
  { value: "full", label: "Full frame", hint: "Avatar fills the frame while it talks" },
  { value: "smart", label: "Smart", hint: "Replaces the presenter only in talking-head scenes" },
];

// The agent's Remake tab: auto-remake settings in Setup-style sections, plus
// the hands-on workspace for remaking one video now.
export function RemakePanel({ agent, form, updateSetting, saveAgent, saving, accountId, theme = "light" }: {
  agent: AutomationAgent;
  form: any;
  updateSetting: (key: string, value: unknown) => void;
  saveAgent: (event: FormEvent) => Promise<void>;
  saving: boolean;
  accountId?: string;
  theme?: AgentTheme;
}) {
  const tokens = getAgentTheme(theme);
  const remake: RemakeSettings = normalizeAgentRemake(form?.settings?.remake || DEFAULT_AGENT_REMAKE);
  const [open, setOpen] = useState<Set<RemakeSectionId>>(() => new Set<RemakeSectionId>(["remake-auto"]));
  const [voices, setVoices] = useState<VoiceProfile[]>([]);
  const [styles, setStyles] = useState<Array<{ id: string; name: string }>>([]);
  const [providers, setProviders] = useState<AvatarProviders>({});
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    void loadVoiceProfiles(controller.signal).then(({ profiles }) => setVoices(profiles)).catch(() => {});
    void fetch("/api/automation/voice/narration-styles", { signal: controller.signal }).then((r) => r.json()).then((d) => setStyles(Array.isArray(d?.styles) ? d.styles : [])).catch(() => {});
    void fetch("/api/automation/voice/status", { signal: controller.signal }).then((r) => r.json()).then((d) => setProviders(d?.avatarProviders || {})).catch(() => {});
    return () => controller.abort();
  }, []);
  const set = (patch: Partial<RemakeSettings>) => updateSetting("remake", { ...remake, ...patch });
  const setAvatar = (patch: Partial<RemakeSettings["avatar"]>) => set({ avatar: { ...remake.avatar, ...patch } });
  const toggle = (id: RemakeSectionId) => setOpen((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  const blocker = remakeBlocker(remake, providers);
  const voice = voices.find((v) => v.id === remake.profileId);

  async function addFaces(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    setError("");
    try {
      const added = [];
      for (const file of [...files].slice(0, MAX_REMAKE_FACES - remake.avatar.faces.length)) {
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
          reader.onerror = () => reject(new Error("Could not read that photo."));
          reader.readAsDataURL(file);
        });
        const response = await fetch(`/api/automation/agents/${encodeURIComponent(agent.id)}/remake/faces`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ base64, name: file.name }) });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "Could not upload that photo.");
        added.push(data.face);
      }
      setAvatar({ faces: [...remake.avatar.faces, ...added].slice(0, MAX_REMAKE_FACES), enabled: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not upload that photo.");
    } finally {
      setUploading(false);
    }
  }
  function removeFace(id: string, ext: string) {
    setAvatar({ faces: remake.avatar.faces.filter((face) => face.id !== id) });
    void fetch(`/api/automation/agents/${encodeURIComponent(agent.id)}/remake/faces/${encodeURIComponent(id)}?ext=${encodeURIComponent(ext)}`, { method: "DELETE" });
  }

  const autoSummary = remake.enabled ? (blocker ? `On · needs attention: ${blocker}` : `On · every video is remade before it posts`) : "Off · videos post as they are";
  const voiceSummary = remake.profileId ? `${voice?.name || "Chosen voice"}${remake.rewrite ? " · rewritten script" : " · original words"}${remake.keepBackground ? " · keeps music" : ""}` : "No voice chosen";
  const avatarSummary = remake.avatar.enabled ? `On · ${remake.avatar.faces.length} ${remake.avatar.faces.length === 1 ? "avatar" : "avatars"} · ${AVATAR_LAYOUT_OPTIONS.find((o) => o.value === remake.avatar.layout)?.label}` : "Off · the original footage stays";
  const rightsSummary = remake.rightsConfirmed && remake.voiceConsentConfirmed ? "Confirmed" : "Needs confirmation";
  const selectClass = "ui-select";

  return (
    // Not a <form>: the embedded editor has its own buttons and import form.
    <div className="agent-remake-panel grid gap-3 px-4 py-5 md:px-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className={cn("text-lg font-black tracking-[-0.01em]", tokens.text)}>Remake</h2>
          <p className={cn("mt-1 text-sm", tokens.muted)}>Re-voice every video this agent posts, and swap an avatar in when you want one.</p>
        </div>
        <button type="button" disabled={saving} onClick={() => void saveAgent({ preventDefault() {} } as FormEvent)} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-[var(--ui-accent)] px-4 text-sm font-black text-[var(--ui-accent-ink)] disabled:opacity-60">
          {saving ? <Loader2 className="h-4 w-4 ui-spin" /> : <CheckCircle2 className="h-4 w-4" />}Save remake settings
        </button>
      </div>
      {error ? <SharedNotice tone="error">{error}</SharedNotice> : null}

      <SetupSection id="remake-auto" icon={<WandSparkles className="h-4 w-4" />} title="Auto-remake" summary={autoSummary} open={open.has("remake-auto")} onToggle={() => toggle("remake-auto")} theme={theme}>
        <div className="grid gap-4 md:grid-cols-2">
          <ToggleRow title="Remake every video before it posts" body="Each run re-voices the video it picked, then posts the remake instead of the original." checked={remake.enabled} onChange={(enabled) => set({ enabled })} />
          <Field label="If a remake fails">
            <select value={remake.onFailure} onChange={(e) => set({ onFailure: e.target.value as RemakeSettings["onFailure"] })} className={selectClass}>
              <option value="skip">Skip it and post nothing</option>
              <option value="original">Post the original video instead</option>
            </select>
          </Field>
        </div>
        {remake.enabled && blocker ? <p className="mt-3 rounded-xl bg-[var(--ui-accent-soft)] px-3 py-2 text-sm font-semibold text-[var(--ui-accent-text)]" role="status">{blocker}</p> : null}
      </SetupSection>

      <SetupSection id="remake-voice" icon={<Mic className="h-4 w-4" />} title="Voice" summary={voiceSummary} open={open.has("remake-voice")} onToggle={() => toggle("remake-voice")} theme={theme}>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Narrator voice">
            <VoicePicker voices={voices} value={remake.profileId} onChange={(profileId) => set({ profileId })} />
          </Field>
          <Field label="Narration style">
            <select value={remake.narrationStyleId} onChange={(e) => set({ narrationStyleId: e.target.value })} className={selectClass}>
              <option value="">Match the original video</option>
              {styles.map((style) => <option key={style.id} value={style.id}>{style.name}</option>)}
            </select>
          </Field>
          <ToggleRow title="Rewrite the narration" body="Write new words scene by scene with the same meaning and timing. Off reads the original script in the new voice." checked={remake.rewrite} onChange={(rewrite) => set({ rewrite })} />
          <ToggleRow title="Keep the background music" body="Remove only the old voice and keep the music and effects under the new one." checked={remake.keepBackground} onChange={(keepBackground) => set({ keepBackground })} />
          {remake.keepBackground ? (
            <Field label={`Background volume · ${Math.round(remake.backgroundVolume * 100)}%`}>
              <input type="range" min={0} max={1} step={0.05} value={remake.backgroundVolume} onChange={(e) => set({ backgroundVolume: Number(e.target.value) })} className="ui-range" style={{ ["--fill" as string]: `${remake.backgroundVolume * 100}%` }} />
            </Field>
          ) : null}
        </div>
      </SetupSection>

      <SetupSection id="remake-avatar" icon={<UserRound className="h-4 w-4" />} title="Avatar mode" summary={avatarSummary} open={open.has("remake-avatar")} onToggle={() => toggle("remake-avatar")} theme={theme}>
        <div className="grid gap-4">
          <ToggleRow title="Swap in an avatar" body="After the new voiceover, an avatar speaks it on screen. With several avatars, each new video uses the next one." checked={remake.avatar.enabled} onChange={(enabled) => setAvatar({ enabled })} />
          {remake.avatar.enabled ? (
            <>
              <div>
                <p className={cn("mb-2 text-[11px] font-black uppercase tracking-[0.14em]", tokens.subtle)}>Avatars · {remake.avatar.faces.length} of {MAX_REMAKE_FACES}</p>
                <div className="flex flex-wrap gap-3">
                  {remake.avatar.faces.map((face, index) => (
                    <figure key={face.id} className={cn("relative m-0 w-24 overflow-hidden rounded-xl border", tokens.divider)}>
                      <img src={`/api/automation/agents/${encodeURIComponent(agent.id)}/remake/faces/${encodeURIComponent(face.id)}?ext=${encodeURIComponent(face.ext)}`} alt={face.name} className="aspect-square w-full object-cover" />
                      <figcaption className={cn("truncate px-2 py-1 text-[11px] font-semibold", tokens.muted)}>{index + 1}. {face.name}</figcaption>
                      <button type="button" onClick={() => removeFace(face.id, face.ext)} aria-label={`Remove ${face.name}`} className="absolute right-1 top-1 grid h-7 w-7 place-items-center rounded-full bg-black/60 text-white"><Trash2 className="h-3.5 w-3.5" /></button>
                    </figure>
                  ))}
                  {remake.avatar.faces.length < MAX_REMAKE_FACES ? (
                    <label className={cn("grid w-24 cursor-pointer place-items-center gap-1 rounded-xl border border-dashed p-3 text-center text-[11px] font-semibold", tokens.divider, tokens.muted)}>
                      {uploading ? <Loader2 className="h-5 w-5 ui-spin" /> : <Upload className="h-5 w-5" />}
                      {uploading ? "Uploading" : "Add photo"}
                      <input type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only" disabled={uploading} onChange={(e) => { void addFaces(e.target.files); e.currentTarget.value = ""; }} />
                    </label>
                  ) : null}
                </div>
                <p className={cn("mt-2 text-xs", tokens.muted)}>Use clear, front-facing photos of people who agreed to be used.</p>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Layout">
                  <select value={remake.avatar.layout} onChange={(e) => setAvatar({ layout: e.target.value as RemakeSettings["avatar"]["layout"] })} className={selectClass}>
                    {AVATAR_LAYOUT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                  <small className={cn("mt-1 block text-xs", tokens.muted)}>{AVATAR_LAYOUT_OPTIONS.find((option) => option.value === remake.avatar.layout)?.hint}</small>
                </Field>
                <Field label="Avatar engine">
                  <select value={remake.avatar.provider} onChange={(e) => setAvatar({ provider: e.target.value as RemakeSettings["avatar"]["provider"] })} className={selectClass}>
                    {Object.entries(providers).length
                      ? Object.entries(providers).map(([id, p]) => <option key={id} value={id} disabled={!p.available}>{p.label}{p.available ? "" : " · not set up"}</option>)
                      : <option value={remake.avatar.provider}>{remake.avatar.provider}</option>}
                  </select>
                </Field>
              </div>
            </>
          ) : null}
        </div>
      </SetupSection>

      <SetupSection id="remake-captions" icon={<Captions className="h-4 w-4" />} title="Captions" summary={remake.captions ? "Burned in on the remake" : "Off"} open={open.has("remake-captions")} onToggle={() => toggle("remake-captions")} theme={theme}>
        <ToggleRow title="Burn captions onto the remake" body="Captions follow the new narration, styled after the original video's captions." checked={remake.captions} onChange={(captions) => set({ captions })} />
      </SetupSection>

      <SetupSection id="remake-rights" icon={<ShieldCheck className="h-4 w-4" />} title="Rights and consent" summary={rightsSummary} open={open.has("remake-rights")} onToggle={() => toggle("remake-rights")} theme={theme}>
        <div className="grid gap-4 md:grid-cols-2">
          <ToggleRow title="I can edit these videos" body="I own the videos this agent posts or have permission to edit and republish them." checked={remake.rightsConfirmed} onChange={(rightsConfirmed) => set({ rightsConfirmed })} />
          <ToggleRow title="I can use this voice and these faces" body="I own the voice and avatars, or the people in them agreed to this use." checked={remake.voiceConsentConfirmed} onChange={(voiceConsentConfirmed) => set({ voiceConsentConfirmed })} />
        </div>
      </SetupSection>

      <SetupSection id="remake-now" icon={<Clapperboard className="h-4 w-4" />} title="Remake one video now" summary="Open the editor and remake a single upload by hand" open={open.has("remake-now")} onToggle={() => toggle("remake-now")} theme={theme}>
        <AgentRemake agentId={agent.id} theme={theme} accountId={accountId} />
      </SetupSection>
    </div>
  );
}

function SetupPanel({
  agent,
  learning = null,
  accounts,
  sources,
  form,
  saving,
  selectedId,
  running,
  setForm,
  updateSetting,
  updatePublishTarget,
  removePublishTarget,
  setScheduleTime,
  addScheduleTime,
  removeScheduleTime,
  saveAgent,
  runAgent,
  setupSubTab,
  onSetSetupSubTab,
  playlists,
  loadingPlaylists,
  onRefreshPlaylists,
  onAnalyzeSource,
  theme = "light",
}: {
  agent: AutomationAgent | null;
  learning?: AgentLearningProfile | null;
  accounts: ConnectedYouTubeAccount[];
  sources: AutomationSourceSummary[];
  form: any;
  saving: boolean;
  selectedId: string;
  running: string[];
  setForm: (value: any) => void;
  updateSetting: (key: string, value: unknown) => void;
  updatePublishTarget: (accountId: string, patch: Record<string, unknown>) => void;
  removePublishTarget: (accountId: string) => void;
  setScheduleTime: (index: number, value: string) => void;
  addScheduleTime: () => void;
  removeScheduleTime: (index: number) => void;
  saveAgent: (event: FormEvent) => Promise<void>;
  runAgent: (id: string) => Promise<void>;
  setupSubTab: SetupSubTab;
  onSetSetupSubTab: (tab: SetupSubTab) => void;
  playlists: YouTubePlaylistSummary[];
  loadingPlaylists: boolean;
  onRefreshPlaylists: () => void;
  onAnalyzeSource: (url: string) => Promise<void | boolean>;
  theme?: AgentTheme;
}) {
  const tokens = getAgentTheme(theme);
  const initialSection = SETUP_SUBTAB_SECTION[setupSubTab] || "essentials";
  const [openSections, setOpenSections] = useState<Set<SetupSectionId>>(() => new Set([initialSection]));
  const [openDestination, setOpenDestination] = useState<string | null>(null);
  const dirty = useMemo(() => (agent ? stableStringify(form) !== stableStringify(formFromAgent(agent)) : false), [agent, form]);
  useEffect(() => {
    if (initialSection === "essentials") return;
    setOpenSections((prev) => new Set([...prev, initialSection]));
    window.requestAnimationFrame(() => document.getElementById(`setup-${initialSection}`)?.scrollIntoView({ block: "start", behavior: "smooth" }));
  }, [initialSection]);
  useEffect(() => {
    if (!openDestination) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenDestination(null);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [openDestination]);

  function toggleSection(id: SetupSectionId) {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function jumpToSection(id: SetupSectionId) {
    if (id !== "essentials" && id !== "rights") setOpenSections((prev) => new Set([...prev, id]));
    window.requestAnimationFrame(() => document.getElementById(`setup-${id}`)?.scrollIntoView({ block: "start", behavior: "smooth" }));
  }
  function discardChanges() {
    if (agent) setForm(formFromAgent(agent));
  }
  const selectedSource = findSelectedSource(sources, form.sourceKey, form.sourceUrl);
  const selectedSourceValue = selectedSource?.key || form.sourceKey || "";
  const hasUnmatchedSavedSource = Boolean(selectedSourceValue && !selectedSource);
  const publishAccount = accounts.find((account) => account.id === form.youtubeAccountId) || null;
  const agentRunning = Boolean(selectedId && running.includes(selectedId));
  const tiktokPublish = isTikTokPublishAccount(publishAccount);
  const scheduleTimes = cleanScheduleTimes(form.settings.scheduleTimes);
  const targetPlaylistMode = form.settings.targetPlaylistMode || (form.settings.targetPlaylistId ? "existing" : form.settings.targetPlaylistTitle ? "create" : "auto");
  const sourceTagOptions = useMemo(() => collectSourceTags(sources), [sources]);
  const selectedSourceTags = Array.isArray(form.settings.sourceTags) ? form.settings.sourceTags : [];
  const [additionalSourceDraft, setAdditionalSourceDraft] = useState("");
  const [additionalSourceError, setAdditionalSourceError] = useState("");
  const primarySourceIdentity = form.sourceType === "saved_tags"
    ? ""
    : normalizeSourceIdentity(form.sourceUrl || form.sourceKey);
  const additionalSourceEntries = useMemo(() => {
    const seen = new Set<string>();
    return (Array.isArray(form.settings.sideChannels) ? form.settings.sideChannels : [])
      .map((value: unknown, index: number) => ({ url: String(value || "").trim(), index }))
      .filter((entry: { url: string; index: number }) => {
        const identity = normalizeSourceIdentity(entry.url);
        if (!identity || identity === primarySourceIdentity || seen.has(identity)) return false;
        seen.add(identity);
        return true;
      });
  }, [form.settings.sideChannels, primarySourceIdentity]);
  const additionalSourceIdentities = useMemo(
    () => new Set(additionalSourceEntries.map((entry: { url: string }) => normalizeSourceIdentity(entry.url))),
    [additionalSourceEntries],
  );

  function cleanAdditionalSources(values: unknown): string[] {
    const seen = new Set<string>();
    return (Array.isArray(values) ? values : [])
      .map((value) => String(value || "").trim())
      .filter((value) => {
        const identity = normalizeSourceIdentity(value);
        if (!identity || identity === primarySourceIdentity || seen.has(identity)) return false;
        seen.add(identity);
        return true;
      })
      .slice(0, 12);
  }

  function addAdditionalSource(rawValue: string): boolean {
    const url = rawValue.trim();
    if (!url) return false;
    let supported = false;
    try {
      const host = new URL(url).hostname.toLowerCase();
      supported = host === "youtu.be" || host.endsWith(".youtu.be") || host === "youtube.com" || host.endsWith(".youtube.com") || host === "tiktok.com" || host.endsWith(".tiktok.com");
    } catch {
      supported = false;
    }
    if (!supported) {
      setAdditionalSourceError("Use a full TikTok or YouTube channel, playlist, or collection URL.");
      return false;
    }
    const identity = normalizeSourceIdentity(url);
    if (identity === primarySourceIdentity) {
      setAdditionalSourceError("That is already the primary source.");
      return false;
    }
    const current = cleanAdditionalSources(form.settings.sideChannels);
    if (current.some((value) => normalizeSourceIdentity(value) === identity)) {
      setAdditionalSourceError("That source is already in the pool.");
      return false;
    }
    if (current.length >= 12) {
      setAdditionalSourceError("A source pool can contain up to 12 additional sources.");
      return false;
    }
    updateSetting("sideChannels", [...current, url]);
    updateSetting("includeSideChannels", true);
    setAdditionalSourceDraft("");
    setAdditionalSourceError("");
    return true;
  }

  function removeAdditionalSource(url: string) {
    const identity = normalizeSourceIdentity(url);
    const next = cleanAdditionalSources(form.settings.sideChannels).filter((value) => normalizeSourceIdentity(value) !== identity);
    updateSetting("sideChannels", next);
    updateSetting("includeSideChannels", next.length > 0);
    setAdditionalSourceError("");
  }

  async function submitAdditionalSource(raw: string) {
    let url: string;
    try {
      url = await resolvePastedSource(raw);
    } catch (error) {
      setAdditionalSourceError(error instanceof Error ? error.message : "Couldn't read that link");
      return false;
    }
    if (!addAdditionalSource(url)) return false;
    try {
      await onAnalyzeSource(url);
      return true;
    } catch (error) {
      setAdditionalSourceError(error instanceof Error ? error.message : "Could not analyze this source");
      return false;
    }
  }

  function removePrimaryFromAdditionalSources(primaryUrl: string, values: unknown): string[] {
    const primaryIdentity = normalizeSourceIdentity(primaryUrl);
    const seen = new Set<string>();
    return (Array.isArray(values) ? values : [])
      .map((value) => String(value || "").trim())
      .filter((value) => {
        const identity = normalizeSourceIdentity(value);
        if (!identity || identity === primaryIdentity || seen.has(identity)) return false;
        seen.add(identity);
        return true;
      })
      .slice(0, 12);
  }

  function toggleSourceTag(tag: string) {
    const active = selectedSourceTags.some((item: string) => item.toLowerCase() === tag.toLowerCase());
    const nextTags = active ? selectedSourceTags.filter((item: string) => item.toLowerCase() !== tag.toLowerCase()) : [...selectedSourceTags, tag];
    setForm((prev: any) => ({ ...prev, sourceType: "saved_tags", sourceKey: "", sourceUrl: "", settings: { ...prev.settings, sourceTags: nextTags } }));
  }

  function toggleSocialTarget(platform: string, accountId: string) {
    setForm((prev: any) => {
      const current = Array.isArray(prev.settings.socialTargets) ? prev.settings.socialTargets : [];
      const exists = current.some((item: any) => item.platform === platform && item.accountId === accountId);
      const next = exists
        ? current.filter((item: any) => !(item.platform === platform && item.accountId === accountId))
        : [...current, { platform, accountId, enabled: true }];
      return { ...prev, settings: { ...prev.settings, socialTargets: next } };
    });
  }

  function toggleYoutubeTarget(accountId: string) {
    if (accountId === form.youtubeAccountId) return;
    setForm((prev: any) => {
      const current = Array.isArray(prev.settings.publishTargets) ? prev.settings.publishTargets : [];
      const exists = current.some((item: any) => item.accountId === accountId);
      const next = exists
        ? current.filter((item: any) => item.accountId !== accountId)
        : [...current, { accountId, postsPerDay: 1, intervalHours: 24 }];
      return { ...prev, settings: { ...prev.settings, publishTargets: next } };
    });
  }

  const postAsShort = form.settings.postAsShort !== false;
  const socialTargets: any[] = Array.isArray(form.settings.socialTargets) ? form.settings.socialTargets : [];
  const youtubeTargets: any[] = Array.isArray(form.settings.publishTargets) ? form.settings.publishTargets : [];
  const rightsConfirmed = form.settings.rightsConfirmed === true;
  const communityOn = form.settings.communityManagementEnabled === true;
  const formatSummary = postAsShort ? `Shorts · ${formatClipLength(form.settings.targetVideoLengthSeconds || 150)} · ${targetPlaylistMode === "none" ? "No playlist" : "Playlist on"}` : "Long-form · Playlist settings";
  const sourcesSummary = `${additionalSourceEntries.length + 1} source${additionalSourceEntries.length ? "s" : ""} · ${form.settings.sourcePriority === "newest" ? "Newest" : form.settings.sourcePriority === "oldest" ? "Oldest" : "Top views"}`;
  const essentialsSummary = "Required setup";
  const socialTargetCount = socialTargets.filter((target) => target?.enabled !== false).length + youtubeTargets.length + 1;
  const socialSummary = `${socialTargetCount} active`;
  const openedDestination = (openDestination && socialPlatform(openDestination)) || null;
  const destinationCount = (id: string) => {
    const connected = accounts.filter((account) => String(account.platform || "youtube").toLowerCase() === id);
    return id === "youtube"
      ? connected.filter((account) => account.id === form.youtubeAccountId || youtubeTargets.some((target) => target.accountId === account.id)).length
      : connected.filter((account) => socialTargets.some((target) => target.platform === id && target.accountId === account.id && target.enabled !== false)).length;
  };
  const learningSummary = `${form.settings.adaptiveStrategyEnabled !== false ? "Adaptive" : "Fixed"} · ${form.settings.performanceCheckHours || 3}h checks`;
  const learnedHours = Array.isArray(learning?.profile?.bestHours) ? learning.profile.bestHours.filter((row: any) => Number(row?.uploads || 0) > 0).slice(0, 3) : [];
  const learningConfidence = Math.round(Number(learning?.confidence || 0) * 100);
  const commentsSummary = communityOn ? `On · ${form.settings.maxCommentRepliesPerCheck || 5} max` : "Off";
  const compileOn = form.settings.compilationEnabled === true;
  const compileSchedule = form.settings.compilationSchedule || { enabled: false, days: ["sun"], time: "18:00" };
  const compileSummary = !compileOn ? "Off" : compileSchedule.enabled ? `Every ${compileSchedule.days.map((d) => d[0].toUpperCase() + d.slice(1)).join(", ")} at ${compileSchedule.time}` : "On · run by hand";
  const setCompileSchedule = (patch: Partial<typeof compileSchedule>) => updateSetting("compilationSchedule", { ...compileSchedule, ...patch });
  const navItems: Array<{ id: SetupSectionId; label: string; state: string }> = [
    { id: "essentials", label: "Essentials", state: "Required" },
    ...(!tiktokPublish ? [{ id: "format" as const, label: "Format & playlist", state: postAsShort ? "Shorts" : "Long-form" }] : []),
    { id: "sources", label: "Source pool", state: `${additionalSourceEntries.length + 1} source${additionalSourceEntries.length ? "s" : ""}` },
    { id: "socials", label: "Social publishing", state: socialSummary },
    { id: "learning", label: "Learning", state: form.settings.adaptiveStrategyEnabled !== false ? "Adaptive" : "Fixed" },
    { id: "comments", label: "Comment replies", state: communityOn ? "On" : "Off" },
    { id: "rights", label: "Rights", state: rightsConfirmed ? "Confirmed" : "Needed" },
  ];
  const eyebrow = cn("text-[11px] font-bold uppercase tracking-widest", tokens.subtle);

  function updatePrimarySourceUrl(value: string) {
    setForm((prev: any) => ({
      ...prev,
      sourceType: "custom_url",
      sourceKey: "",
      sourceUrl: value,
      settings: { ...prev.settings, sideChannels: removePrimaryFromAdditionalSources(value, prev.settings.sideChannels) },
    }));
  }

  async function submitPrimarySourceUrl(raw: string) {
    const url = await resolvePastedSource(raw);
    updatePrimarySourceUrl(url);
    return onAnalyzeSource(url);
  }

  return (
    <form id="automation-agent-form" onSubmit={saveAgent} className="mx-auto w-full max-w-5xl">
      <nav className={cn("agent-setup-index mb-4 flex items-center gap-2 overflow-x-auto rounded-2xl p-1.5", tokens.isDark ? "bg-[var(--ui-text)]/6" : "bg-[var(--ui-text)]/5")} aria-label="Setup sections">
        <Navigation className={cn("ml-2 h-3.5 w-3.5 shrink-0", tokens.subtle)} aria-hidden="true" />
        <div className="flex min-w-max items-center gap-1.5">
          {navItems.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => jumpToSection(item.id)}
              className={cn("agent-setup-index-button group inline-flex min-h-8 items-center gap-1.5 rounded-xl px-2.5 text-left transition", openSections.has(item.id) ? tokens.isDark ? "bg-[var(--ui-text)]/10 shadow-sm" : "bg-[var(--ui-panel)] shadow-sm" : "", tokens.isDark ? "hover:bg-[var(--ui-text)]/10" : "hover:bg-[var(--ui-panel)]")}
            >
              <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", item.id === "rights" && !rightsConfirmed ? "bg-[#b69300]" : openSections.has(item.id) ? "bg-[var(--ui-accent)]" : tokens.isDark ? "bg-[var(--ui-text)]/30 group-hover:bg-[var(--ui-text)]/60" : "bg-[var(--ui-text)]/20 group-hover:bg-[var(--ui-text)]/45")} aria-hidden="true" />
              <span className={cn("text-[11px] font-black", tokens.text)}>{item.label}</span>
              <span className={cn("text-[10px] font-semibold", item.id === "rights" && !rightsConfirmed ? "text-[var(--ui-accent-text)]" : tokens.subtle)}>{item.state}</span>
            </button>
          ))}
        </div>
      </nav>

      <div className="space-y-3">
          <SetupSection id="essentials" icon={<Bot className="h-4 w-4" />} title="Essentials" summary={essentialsSummary} open={openSections.has("essentials")} onToggle={() => toggleSection("essentials")} theme={theme}>
            <div className="agent-essentials-stack">
              <div className="agent-essentials-top-grid">
                <section className="agent-essentials-group">
                  <h3 className={cn("text-sm font-black", tokens.text)}>Agent</h3>
                  <div className="mt-3 grid max-w-sm gap-3">
                    <Field label="Name">
                      <input value={form.name} onChange={(event) => { const value = event.target.value; setForm((prev: any) => ({ ...prev, name: value })); }} className="ui-input" placeholder="Agent name" />
                    </Field>
                    <Field label="Channel">
                      <SourcePicker theme={theme} label="Publish channel" value={form.youtubeAccountId} onChange={value => setForm((prev: any) => ({ ...prev, youtubeAccountId: value }))} options={accounts.map(account => ({ value: account.id, label: account.channelTitle, imageUrl: account.thumbnailUrl }))} />
                    </Field>
                  </div>
                </section>

                <section className="agent-essentials-group">
                  <h3 className={cn("text-sm font-black", tokens.text)}>Primary source</h3>
                  <div className="mt-3 max-w-lg">
                    <Field label="Source">
                      <SourcePicker
                        value={selectedSourceValue}
                        label="Primary source"
                        placeholder="Choose a saved source"
                        theme={theme}
                        onChange={(value) => {
                          const source = sources.find((item) => item.key === value);
                          const sourceUrl = source?.analyzedUrl || source?.key || "";
                          setForm((prev: any) => ({
                            ...prev,
                            sourceType: "saved_playlist",
                            sourceKey: source?.key || value,
                            sourceUrl,
                            settings: { ...prev.settings, sideChannels: removePrimaryFromAdditionalSources(sourceUrl, prev.settings.sideChannels) },
                          }));
                        }}
                        options={[...(hasUnmatchedSavedSource ? [{ value: selectedSourceValue, label: form.sourceUrl || form.sourceKey }] : []), ...sources.map(sourcePickerOption)]}
                        urlValue={form.sourceUrl}
                        onUrlChange={updatePrimarySourceUrl}
                        onUrlSubmit={submitPrimarySourceUrl}
                        tags={sourceTagOptions}
                        selectedTags={selectedSourceTags}
                        onToggleTag={toggleSourceTag}
                      />
                    </Field>
                  </div>
                </section>
              </div>

              <section className={cn("agent-essentials-group agent-essentials-group-divided", tokens.divider)}>
                <div className="agent-essentials-group-heading">
                  <h3 className={cn("text-sm font-black", tokens.text)}>Schedule</h3>
                  <span className={cn("text-xs font-semibold", tokens.muted)}>{form.settings.maxPostsPerDay || 1} per day</span>
                </div>
                <div className="agent-essentials-schedule-grid mt-3">
                  <div className="agent-essentials-schedule-fields">
                    <Field label="Posts per day">
                      <input type="number" min={1} max={12} value={form.settings.maxPostsPerDay} onChange={(e) => updateSetting("maxPostsPerDay", Math.max(1, Math.min(12, Number(e.target.value) || 1)))} className="ui-input" />
                    </Field>
                    <VisibilityControl theme={theme} label="How posts go live" value={form.settings.publishMode} onChange={(value) => updateSetting("publishMode", value)} options={SCHEDULED_VISIBILITY_OPTIONS} />
                  </div>
                  <ReleaseTimesEditor times={scheduleTimes} onSet={setScheduleTime} onAdd={addScheduleTime} onRemove={removeScheduleTime} theme={theme} />
                </div>
                {!tiktokPublish ? (
                  <div className="mt-4">
                    <ToggleRow
                      title="Post as YouTube Shorts"
                      body="Trims each clip to a complete thought near your target length. Turn off for long-form uploads."
                      checked={postAsShort}
                      onChange={(next) => updateSetting("postAsShort", next)}
                    />
                  </div>
                ) : (
                  <div className="mt-4 rounded-xl border border-[var(--ui-accent)]/30 bg-[var(--ui-accent-soft)] px-4 py-3 text-xs font-semibold leading-5 text-[var(--ui-accent-text)]">
                    TikTok posts are scheduled as native TikTok videos, so Shorts trimming and playlists do not apply.
                  </div>
                )}
              </section>
            </div>
          </SetupSection>

          {!tiktokPublish ? (
            <SetupSection id="format" icon={<Scissors className="h-4 w-4" />} title="Format and playlist" summary={formatSummary} open={openSections.has("format")} onToggle={() => toggleSection("format")} theme={theme}>
              {postAsShort ? (
                <DurationTrimControl
                  value={Number(form.settings.targetVideoLengthSeconds || 150)}
                  onChange={(value) => updateSetting("targetVideoLengthSeconds", value)}
                  theme={theme}
                />
              ) : (
                <p className={cn("rounded-xl border border-dashed px-4 py-3 text-sm", tokens.divider, tokens.muted)}>Shorts trimming is off, so clips upload at their full length.</p>
              )}
              <div className={cn("mt-4 rounded-xl border p-3", tokens.surfaceSoft)}>
                <PlaylistControl
                  theme={theme}
                  modes={["auto", "existing", "create", "none"]}
                  mode={targetPlaylistMode as PlaylistMode}
                  onModeChange={(mode) => {
                    updateSetting("targetPlaylistMode", mode);
                    if (mode === "none" || mode === "auto") updateSetting("targetPlaylistId", "");
                    if (mode === "none" || mode === "existing") updateSetting("targetPlaylistTitle", "");
                    if (mode === "create") updateSetting("createTargetPlaylist", true);
                    if (mode === "existing" && !playlists.length) onRefreshPlaylists();
                  }}
                  playlists={playlists}
                  playlistId={form.settings.targetPlaylistId || ""}
                  onPlaylistIdChange={(id, playlist) => {
                    updateSetting("targetPlaylistId", id);
                    updateSetting("targetPlaylistTitle", playlist?.title || "");
                  }}
                  newTitle={form.settings.targetPlaylistTitle || ""}
                  onNewTitleChange={(value) => updateSetting("targetPlaylistTitle", value)}
                  newTitlePlaceholder={targetPlaylistMode === "auto" ? "AutoYT Picks" : "Anime Recaps"}
                  loading={loadingPlaylists}
                  onRefresh={onRefreshPlaylists}
                >
                  {targetPlaylistMode === "auto" ? (
                    <ToggleRow
                      title="Create missing playlists automatically"
                      body="Niche playlists such as Anime Recaps, Finance Automation, or AI Cartoons are created the first time they are needed."
                      checked={form.settings.autoCreatePlaylists !== false}
                      onChange={(next) => updateSetting("autoCreatePlaylists", next)}
                    />
                  ) : null}
                </PlaylistControl>
              </div>
            </SetupSection>
          ) : null}

          <SetupSection id="sources" icon={<Layers3 className="h-4 w-4" />} title="Source pool" summary={sourcesSummary} open={openSections.has("sources")} onToggle={() => toggleSection("sources")} theme={theme}>
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <p className={eyebrow}>Additional sources</p>
              </div>
              <span className={cn("text-xs font-bold", tokens.subtle)}>{additionalSourceEntries.length} / 12</span>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <SourcePicker
                value=""
                onChange={addAdditionalSource}
                label="Add source"
                placeholder="Add source"
                theme={theme}
                disabled={additionalSourceEntries.length >= 12}
                options={sources.filter((source) => Boolean(source.analyzedUrl)).map((source) => {
                  const identity = normalizeSourceIdentity(source.analyzedUrl);
                  const unavailable = identity === primarySourceIdentity || additionalSourceIdentities.has(identity);
                  return { ...sourcePickerOption(source), value: source.analyzedUrl, disabled: unavailable };
                })}
                urlValue={additionalSourceDraft}
                onUrlChange={(value) => { setAdditionalSourceDraft(value); if (additionalSourceError) setAdditionalSourceError(""); }}
                onUrlSubmit={submitAdditionalSource}
                urlError={additionalSourceError}
              />
            </div>
            <SourcePoolUsage agentId={agent?.id} dark={tokens.isDark} active={openSections.has("sources")}
              revision={`${agent?.sourceUrl}:${agent?.sourceKey}:${agent?.lastRunAt || 0}:${JSON.stringify(agent?.settings || {})}:${agentRunning}`}
              tagged={form.sourceType === "saved_tags"} onRemove={removeAdditionalSource}
              sources={[
                ...(form.sourceType !== "saved_tags" && (form.sourceUrl || form.sourceKey) ? [{ url: form.sourceUrl || form.sourceKey, title: selectedSource?.title || form.sourceUrl || form.sourceKey, imageUrl: selectedSource?.profileImageUrl || selectedSource?.thumb, primary: true }] : []),
                ...additionalSourceEntries.map((entry: { url: string }) => { const source = findSelectedSource(sources, "", entry.url); return { url: entry.url, title: source?.title || entry.url, imageUrl: source?.profileImageUrl || source?.thumb }; }),
              ]} />

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <Field label="Rank candidates by">
                <select value={form.settings.sourcePriority || "views"} onChange={(e) => updateSetting("sourcePriority", e.target.value)} className="ui-select">
                  <option value="views">Most views</option>
                  <option value="newest">Newest video</option>
                  <option value="oldest">Oldest video</option>
                </select>
              </Field>
              <Field label="Movie identification">
                <select value={form.settings.movieIdEnabled === false ? "off" : "on"} onChange={(e) => updateSetting("movieIdEnabled", e.target.value === "on")} className="ui-select">
                  <option value="on">Identify the movie in each clip</option>
                  <option value="off">Skip movie identification</option>
                </select>
              </Field>
              <Field label="Niche">
                <input value={form.settings.genreFocus} onChange={(e) => updateSetting("genreFocus", e.target.value)} placeholder="Movie recaps" className="ui-input" />
              </Field>
              <Field label="Source niche matching">
                <select value={form.settings.sourceNicheMode || "balanced"} onChange={(e) => updateSetting("sourceNicheMode", e.target.value)} className="ui-select">
                  <option value="balanced">Balanced</option>
                  <option value="strict">Strict niche match</option>
                  <option value="off">No niche filtering</option>
                </select>
              </Field>
              <ToggleRow
                title="Learn which source channels win"
                body="Promote proven source channels. In playlist pools, a used channel stays locked until its latest candidate reaches 10,000 views."
                checked={form.settings.dynamicSourceLearning !== false}
                onChange={(next) => updateSetting("dynamicSourceLearning", next)}
              />
              <ToggleRow
                title="Explore new channels when performance is weak"
                body="Rotate authors inside a collection using the cached source pool — no full TikTok re-scrape every run."
                checked={form.settings.sourceExplorationEnabled !== false}
                onChange={(next) => updateSetting("sourceExplorationEnabled", next)}
              />
              {form.settings.sourceExplorationEnabled !== false ? (
                <>
                  <Field label="Channels sampled per run">
                    <input type="number" min={2} max={12} value={form.settings.sourceExplorationChannels || 6} onChange={(e) => updateSetting("sourceExplorationChannels", Number(e.target.value))} className="ui-input" />
                  </Field>
                  <Field label="Explore when average views fall below">
                    <input type="number" min={100} max={100000} value={form.settings.sourceUnderperformingViewThreshold || 1000} onChange={(e) => updateSetting("sourceUnderperformingViewThreshold", Number(e.target.value))} className="ui-input" />
                  </Field>
                </>
              ) : null}
            </div>
          </SetupSection>

          <SetupSection id="socials" icon={<Share2 className="h-4 w-4" />} title="Publish destinations" summary={socialSummary} open={openSections.has("socials")} onToggle={() => toggleSection("socials")} theme={theme}>
            <PlatformGrid
              layout="row"
              label="Publish destinations"
              className={tokens.text}
              onSelect={(id) => setOpenDestination(id)}
              selected={(id) => destinationCount(id) > 0}
              note={(id) => (destinationCount(id) ? `${destinationCount(id)} on` : null)}
            />
            {openedDestination ? (
              <Dialog
                title={`Publish to ${openedDestination.label}`}
                description="Choose which accounts this agent posts to."
                size="sm"
                onClose={() => setOpenDestination(null)}
                footer={
                  <>
                    <a href={connectHref(openedDestination.id)} className="ui-btn"><Plus className="h-4 w-4" />Add {openedDestination.label}</a>
                    <button type="button" className="ui-btn is-primary" onClick={() => setOpenDestination(null)}>Done</button>
                  </>
                }
              >
                {(() => {
                  const connected = accounts.filter((account) => String(account.platform || "youtube").toLowerCase() === openedDestination.id);
                  if (!connected.length) return <EmptyState compact icon={<PlatformIcon id={openedDestination.id} size={40} />} title={`No ${openedDestination.label} account yet`} body="Connect one to publish there." />;
                  return (
                    <div className="grid gap-2">
                      {connected.map((account) => {
                        const isPrimary = openedDestination.id === "youtube" && account.id === form.youtubeAccountId;
                        const active = isPrimary || (openedDestination.id === "youtube"
                          ? youtubeTargets.some((target) => target.accountId === account.id)
                          : socialTargets.some((target) => target.platform === openedDestination.id && target.accountId === account.id && target.enabled !== false));
                        return (
                          <Switch
                            key={account.id}
                            checked={active}
                            disabled={isPrimary}
                            onChange={() => (openedDestination.id === "youtube" ? toggleYoutubeTarget(account.id) : toggleSocialTarget(openedDestination.id, account.id))}
                            label={
                              <span className="flex min-w-0 items-center gap-3">
                                {account.thumbnailUrl ? <img src={account.thumbnailUrl} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover" referrerPolicy="no-referrer" /> : <PlatformIcon id={openedDestination.id} size={32} />}
                                <span className="truncate">{account.channelTitle || account.channelHandle || openedDestination.label}</span>
                              </span>
                            }
                            description={isPrimary ? "Primary channel for this agent" : undefined}
                          />
                        );
                      })}
                    </div>
                  );
                })()}
              </Dialog>
            ) : null}
          </SetupSection>

          <SetupSection id="learning" icon={<Sparkles className="h-4 w-4" />} title="Learning and cadence" summary={learningSummary} open={openSections.has("learning")} onToggle={() => toggleSection("learning")} theme={theme}>
            {(learning?.summary || learnedHours.length > 0) ? (
              <div className={cn("rounded-xl border px-3 py-3 text-sm", tokens.surfaceSoft)}>
                <p className={cn("text-[11px] font-black uppercase tracking-[0.14em]", tokens.subtle)}>Live signals · {learningConfidence}% confidence</p>
                <p className={cn("mt-1 leading-6", tokens.text)}>{learning?.recommendation || learning?.summary}</p>
                {learnedHours.length ? (
                  <p className={cn("mt-2 text-xs font-semibold", tokens.muted)}>
                    Strongest hours (schedule clock): {learnedHours.map((row: any) => {
                      const hour = scheduleHourFromUtcLabel(row.label);
                      return `${String(hour ?? (Number(row.label) || 0)).padStart(2, "0")}:00 (${Number(row.views || 0).toLocaleString()} views)`;
                    }).join(" · ")}
                  </p>
                ) : null}
              </div>
            ) : (
              <p className={cn("text-sm leading-6", tokens.muted)}>Run a few candidates and performance checks — this panel fills with what the channel is teaching the agent.</p>
            )}
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="What this channel should become" wide>
                <textarea value={form.settings.microNicheGoal} onChange={(e) => updateSetting("microNicheGoal", e.target.value)} placeholder="Example: tense thriller recaps with twist endings for a 25 to 40 audience" className="ui-textarea min-h-24 py-3 leading-6" />
              </Field>
              <ToggleRow
                title="Adaptive decision strategy"
                body="Switch between learn, explore, exploit, and recover from measured outcomes."
                checked={form.settings.adaptiveStrategyEnabled !== false}
                onChange={(next) => updateSetting("adaptiveStrategyEnabled", next)}
              />
              <ToggleRow
                title="Smart cadence"
                body={`Slow posting to every 2–3 days when recent uploads stall under ${Number(form.settings.sourceUnderperformingViewThreshold || 1000).toLocaleString()} views.`}
                checked={form.settings.performanceCadenceEnabled !== false}
                onChange={(next) => updateSetting("performanceCadenceEnabled", next)}
              />
              {form.settings.adaptiveStrategyEnabled !== false ? (
                <>
                  <ToggleRow
                    title="Learn publishing times"
                    body="Prefer stronger release windows on upcoming posts. Your saved schedule stays as the baseline in Setup."
                    checked={form.settings.adaptiveSchedulingEnabled !== false}
                    onChange={(next) => updateSetting("adaptiveSchedulingEnabled", next)}
                  />
                  {form.settings.adaptiveSchedulingEnabled !== false ? (
                    <ToggleRow
                      title="Rewrite saved schedule from learning"
                      body="After enough evidence, replace the saved release times with the strongest learned windows."
                      checked={form.settings.adaptiveScheduleOverrideEnabled === true}
                      onChange={(next) => updateSetting("adaptiveScheduleOverrideEnabled", next)}
                    />
                  ) : null}
                  <ToggleRow
                    title="Learn hooks and formats"
                    body="Rank candidates and steer titles using proven hooks, niches, durations, and formats."
                    checked={form.settings.adaptiveMetadataEnabled !== false}
                    onChange={(next) => updateSetting("adaptiveMetadataEnabled", next)}
                  />
                  <ToggleRow
                    title="Skip non-retryable failures"
                    body="Hold runs after auth, config, or exhausted-source failures. Leave off to retry everything."
                    checked={form.settings.adaptiveRecoveryEnabled !== false}
                    onChange={(next) => updateSetting("adaptiveRecoveryEnabled", next)}
                  />
                </>
              ) : null}
              <Field label="Check performance every (hours)">
                <input type="number" min={1} max={24} value={form.settings.performanceCheckHours} onChange={(e) => updateSetting("performanceCheckHours", Number(e.target.value))} className="ui-input" />
              </Field>
              <Field label="Call an upload stagnant after (hours)">
                <input type="number" min={3} max={168} value={form.settings.stagnationWindowHours} onChange={(e) => updateSetting("stagnationWindowHours", Number(e.target.value))} className="ui-input" disabled={form.settings.performanceCadenceEnabled === false} />
              </Field>
              <Field label="Minimum view growth between checks (%)">
                <input type="number" min={0} max={100} value={form.settings.minViewDeltaPercent} onChange={(e) => updateSetting("minViewDeltaPercent", Number(e.target.value))} className="ui-input" disabled={form.settings.performanceCadenceEnabled === false} />
              </Field>
            </div>
          </SetupSection>

          <SetupSection id="comments" icon={<MessageCircle className="h-4 w-4" />} title="Comment replies" summary={commentsSummary} open={openSections.has("comments")} onToggle={() => toggleSection("comments")} theme={theme}>
            <div className="grid gap-4 md:grid-cols-2">
              <ToggleRow
                title="Reply to comments automatically"
                body="New uploads are checked every 5 minutes, slowing as they age, and viewers who reply back get an answer too. Title questions always get the exact movie name. Spam, abusive, and low-value comments are skipped."
                checked={communityOn}
                onChange={(next) => updateSetting("communityManagementEnabled", next)}
              />
              {communityOn ? (
                <>
                  <ToggleRow
                    title="Use AI for engagement replies"
                    body="Short, natural replies to useful comments beyond movie-name questions."
                    checked={form.settings.aiEngagementRepliesEnabled === true}
                    onChange={(next) => updateSetting("aiEngagementRepliesEnabled", next)}
                  />
                  <Field label="Max replies per check">
                    <input type="number" min={1} max={25} value={form.settings.maxCommentRepliesPerCheck} onChange={(e) => updateSetting("maxCommentRepliesPerCheck", Number(e.target.value))} className="ui-input" />
                  </Field>
                  <Field label="Reply tone">
                    <select value={form.settings.commentReplyTone} onChange={(e) => updateSetting("commentReplyTone", e.target.value)} className="ui-select">
                      <option value="warm-curious">Warm and curious</option>
                      <option value="hype-short">Short hype replies</option>
                      <option value="calm-helpful">Calm and helpful</option>
                      <option value="playful-fan">Playful fan energy</option>
                      <option value="mystery-hook">Mystery-hook style</option>
                    </select>
                  </Field>
                  <Field label="Reply instructions" wide>
                    <textarea value={form.settings.commentReplyInstructions} onChange={(e) => updateSetting("commentReplyInstructions", e.target.value)} placeholder="Example: never reveal the ending, keep replies under 20 words" className="ui-textarea min-h-24 py-3 leading-6" />
                  </Field>
                </>
              ) : null}
            </div>
          </SetupSection>

          <SetupSection id="compilations" icon={<Film className="h-4 w-4" />} title="Compilations" summary={compileSummary} open={openSections.has("compilations")} onToggle={() => toggleSection("compilations")} theme={theme}>
            <div className="grid gap-4 md:grid-cols-2">
              <ToggleRow
                title="Build long-form compilations"
                body="Strings this agent's uploads into one long video and posts it to the same channel."
                checked={compileOn}
                onChange={(next) => updateSetting("compilationEnabled", next)}
              />
              {compileOn ? (
                <>
                  <Field label="Length (minutes)">
                    <div className="flex items-center gap-2">
                      <input type="number" min={1} max={240} value={form.settings.compilationMinMinutes ?? 30} onChange={(e) => updateSetting("compilationMinMinutes", Number(e.target.value))} className="ui-input" aria-label="Shortest length in minutes" />
                      <span className={cn("text-xs font-bold", tokens.subtle)}>to</span>
                      <input type="number" min={1} max={300} value={form.settings.compilationMaxMinutes ?? 40} onChange={(e) => updateSetting("compilationMaxMinutes", Number(e.target.value))} className="ui-input" aria-label="Longest length in minutes" />
                    </div>
                  </Field>
                  <Field label="Layout">
                    <OrientationPicker value={form.settings.compilationLayout || "vertical"} onChange={(layout) => updateSetting("compilationLayout", layout)} />
                  </Field>
                  <ToggleRow
                    title="Build them on a schedule"
                    body="Queues a compilation on the chosen days at this time, in the agent's timezone. A slot missed by more than six hours waits for the next one."
                    checked={compileSchedule.enabled}
                    onChange={(next) => setCompileSchedule({ enabled: next })}
                  />
                  {compileSchedule.enabled ? (
                    <Field label="Days and time" wide>
                      <div className="flex flex-wrap items-center gap-2">
                        {(["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const).map((day) => {
                          const on = compileSchedule.days.includes(day);
                          return (
                            <button
                              key={day}
                              type="button"
                              aria-pressed={on}
                              onClick={() => setCompileSchedule({ days: on ? (compileSchedule.days.length > 1 ? compileSchedule.days.filter((d) => d !== day) : compileSchedule.days) : [...compileSchedule.days, day] })}
                              className={cn("h-9 min-w-11 rounded-xl border px-3 text-xs font-bold capitalize transition", on ? "border-[var(--ui-accent)] bg-[var(--ui-accent)] text-[var(--ui-accent-ink)]" : cn(tokens.surface, tokens.text))}
                            >
                              {day}
                            </button>
                          );
                        })}
                        <input type="time" value={compileSchedule.time} onChange={(e) => e.target.value && setCompileSchedule({ time: e.target.value })} className="ui-input w-32" aria-label="Compilation time" />
                      </div>
                    </Field>
                  ) : null}
                </>
              ) : null}
            </div>
          </SetupSection>

          <section id="setup-rights" className={cn("scroll-mt-4 rounded-2xl border p-4 md:p-5", rightsConfirmed ? tokens.surface : tokens.highlight)}>
            <label className="flex cursor-pointer items-start gap-3">
              <input type="checkbox" checked={rightsConfirmed} onChange={(e) => updateSetting("rightsConfirmed", e.target.checked)} className="ui-check mt-1 shrink-0" />
              <span className="min-w-0">
                <span className={cn("block text-sm font-bold leading-6", tokens.text)}><ShieldCheck className="mr-2 inline h-4 w-4 text-[var(--ui-accent-text)]" />I will only run this on clips I own, have permission to reuse, or can lawfully transform for my channel.</span>
                <span className={cn("mt-1 block text-xs font-semibold", rightsConfirmed ? tokens.subtle : "text-[var(--ui-accent-text)]")}>{rightsConfirmed ? "Confirmed. The agent can save and run." : "Required before the agent can save or run."}</span>
              </span>
            </label>
          </section>
        </div>

      {dirty ? (
        <div className="sticky bottom-0 z-10 -mx-4 mt-6 px-4 pb-4 md:-mx-6 md:px-6">
          <div className={cn("flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-4 py-3 shadow-[0_18px_45px_rgba(26,26,26,0.16)] backdrop-blur", tokens.isDark ? "border-[var(--ui-accent)]/40 bg-[var(--ui-accent-soft)]/95" : "border-[var(--ui-accent)] bg-[var(--ui-accent-soft)]/95")} role="status">
            <p className={cn("inline-flex items-center gap-2 text-sm font-bold", tokens.text)}>
              <span className="h-2 w-2 rounded-full bg-[var(--ui-accent)] ring-4 ring-[var(--ui-accent)]/25" aria-hidden="true" />
              Unsaved changes
            </p>
            <div className="flex gap-2">
              <button type="button" onClick={discardChanges} disabled={saving} className={cn("inline-flex h-10 items-center gap-2 rounded-xl border px-4 text-xs font-bold transition active:scale-[0.98] disabled:opacity-50", tokens.surface, tokens.text)}>
                Discard
              </button>
              <button type="submit" disabled={saving} className="ui-btn is-primary">
                {saving ? <Loader2 className="h-4 w-4 ui-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                {saving ? "Saving" : "Save changes"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </form>
  );
}

function UploadsPanel({
  uploads,
  selectedUpload,
  selectedUploadId,
  onSelect,
  onBack,
  onReupload,
  onDelete,
  reuploading,
  deletingUpload,
  onUploadChanged,
  theme = "light",
}: {
  uploads: AutomationUpload[];
  selectedUpload: AutomationUpload | null;
  selectedUploadId: string;
  onSelect: (id: string) => void;
  onBack: () => void;
  onReupload: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  reuploading: string;
  deletingUpload: string;
  onUploadChanged: (upload: AutomationUpload) => void;
  theme?: AgentTheme;
}) {
  if (selectedUploadId && selectedUpload) {
    return <UploadDetail upload={selectedUpload} onBack={onBack} onReupload={onReupload} onDelete={onDelete} reuploading={reuploading} deletingUpload={deletingUpload} onUploadChanged={onUploadChanged} theme={theme} />;
  }

  const tokens = getAgentTheme(theme);
  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <SectionTitle theme={theme} title="Uploaded posts" body="Review each automated YouTube upload, then open a post for Movie ID, performance, and comment automation context." />
        <p className={cn("text-xs font-semibold", tokens.subtle)}>{uploads.length} uploads</p>
      </div>
      <div className={cn("-mx-4 overflow-x-auto rounded-xl border sm:mx-0", tokens.surface)}>
        <table className={cn("min-w-[880px] w-full border-collapse text-left", tokens.isDark ? "bg-[var(--ui-panel)]" : "bg-[var(--ui-panel)]")}>
          <thead className={cn("text-[10px] font-black uppercase tracking-[0.16em]", tokens.surfaceSoft, tokens.subtle)}>
            <tr>
              <th className="px-4 py-3">Video</th>
              <th className="px-4 py-3">Movie</th>
              <th className="px-4 py-3">MSN</th>
              <th className="px-4 py-3 text-right">Views</th>
              <th className="px-4 py-3 text-right">Comments</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Date</th>
              <th className="w-14 px-4 py-3 text-right"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody className={cn("divide-y", tokens.divider)}>
            {uploads.map((upload) => (
              <tr
                key={upload.id}
                tabIndex={0}
                onClick={() => onSelect(upload.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelect(upload.id);
                  }
                }}
                aria-label={`Open upload ${upload.title}`}
                className={cn("cursor-pointer transition focus-visible:-outline-offset-2", tokens.isDark ? "hover:bg-[var(--ui-text)]/6" : "hover:bg-[var(--ui-text)]/5")}
              >
                <td className="max-w-[300px] px-4 py-3">
                  <div className="flex items-center gap-3">
                    <span className={cn("grid h-14 w-10 shrink-0 place-items-center overflow-hidden rounded-md", tokens.isDark ? "bg-[#0D0F0D]" : "bg-[var(--ui-text)]/8")}>
                      {agentUploadMedia(upload).thumbnailUrl ? (
                        <img src={agentUploadMedia(upload).thumbnailUrl} alt="" loading="lazy" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
                      ) : (
                        <Film className="h-4 w-4 text-[var(--ui-accent-text)]" />
                      )}
                    </span>
                    <div className="min-w-0">
                      <p className={cn("line-clamp-2 text-sm font-bold leading-6", tokens.text)}>{upload.title}</p>
                      <p className={cn("mt-1 text-xs font-semibold", tokens.subtle)}>{upload.sourceAuthor || "TikTok source"}</p>
                    </div>
                  </div>
                </td>
                <td className={cn("px-4 py-3 text-sm font-semibold", tokens.textSoft)}>{upload.movieTitle || "Unknown"} {upload.movieYear}</td>
                <td className={cn("max-w-[220px] px-4 py-3 text-xs leading-5", tokens.muted)}>{upload.microNiche || upload.genre || "Pending"}</td>
                <td className={cn("px-4 py-3 text-right text-sm font-bold", tokens.text)}>{compact(metric(upload, "viewCount"))}</td>
                <td className={cn("px-4 py-3 text-right text-sm font-bold", tokens.text)}>{compact(metric(upload, "commentCount"))}</td>
                <td className="px-4 py-3"><StatusPill status={upload.status} /></td>
                <td className={cn("px-4 py-3 text-xs font-semibold", tokens.subtle)}>{formatDate(upload.scheduleAt || upload.createdAt)}</td>
                <td className="px-4 py-3 text-right">
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      void onDelete(upload.id);
                    }}
                    disabled={deletingUpload === upload.id}
                    className={cn("grid h-8 w-8 place-items-center rounded-lg transition disabled:opacity-50", tokens.isDark ? "text-[var(--ui-text)]/45 hover:bg-red-500/10 hover:text-red-300" : "text-[var(--ui-text)]/40 hover:bg-red-50 hover:text-red-700")}
                    aria-label={`Delete ${upload.title} from AutoYT`}
                    title="Delete from AutoYT"
                  >
                    {deletingUpload === upload.id ? <Loader2 className="h-4 w-4 ui-spin" /> : <Trash2 className="h-4 w-4" />}
                  </button>
                </td>
              </tr>
            ))}
            {!uploads.length ? (
              <tr>
                <td colSpan={8} className={cn("px-4 py-10 text-center text-sm font-semibold", tokens.muted)}>No uploads yet. Run one candidate from Setup or Overview.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function UploadDetail({
  upload,
  onBack,
  onReupload,
  onDelete,
  reuploading,
  deletingUpload,
  onUploadChanged,
  theme = "light",
}: {
  upload: AutomationUpload;
  onBack: () => void;
  onReupload: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  reuploading: string;
  deletingUpload: string;
  onUploadChanged: (upload: AutomationUpload) => void;
  theme?: AgentTheme;
}) {
  const tokens = getAgentTheme(theme);
  const [currentUpload, setCurrentUpload] = useState(upload);
  const [correctionTitle, setCorrectionTitle] = useState(upload.movieTitle || (upload.metrics?.movie?.title as string) || "");
  const [correctionYear, setCorrectionYear] = useState(upload.movieYear || (upload.metrics?.movie?.year as string) || "");
  const [correctionMediaType, setCorrectionMediaType] = useState("auto");
  const [correcting, setCorrecting] = useState(false);
  const [correctionError, setCorrectionError] = useState("");
  useErrorToast(correctionError, () => setCorrectionError(""), { title: "Correction failed" });

  useEffect(() => {
    setCurrentUpload(upload);
    setCorrectionTitle(upload.movieTitle || (upload.metrics?.movie?.title as string) || "");
    setCorrectionYear(upload.movieYear || (upload.metrics?.movie?.year as string) || "");
    setCorrectionError("");
  }, [upload]);

  const movieResult = uploadToMovieResult(currentUpload);
  const publishedTikTokUrl = String(currentUpload.metrics?.tiktokUrl || "").trim();
  const isZernioPostUrl = /zernio\.com\/posts/i.test(currentUpload.youtubeUrl || "");
  const publishedUrl = publishedTikTokUrl || currentUpload.youtubeUrl || "";
  const publishedLabel = publishedTikTokUrl ? "Open on TikTok" : isZernioPostUrl ? "Open post" : "Open on YouTube";
  const sourceStats = currentUpload.metrics?.sourceStats || {};
  const analytics = currentUpload.metrics?.analytics || {};
  const totals = analytics?.totals || {};
  const daily = Array.isArray(analytics?.daily) ? analytics.daily : [];

  async function correctMovieId(event: FormEvent) {
    event.preventDefault();
    const title = correctionTitle.trim();
    if (!title) {
      setCorrectionError("Enter the corrected title first.");
      return;
    }
    setCorrecting(true);
    setCorrectionError("");
    try {
      const response = await fetch(`/api/automation/uploads/${encodeURIComponent(currentUpload.id)}/movie-id/correct`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          year: correctionYear.trim(),
          mediaType: correctionMediaType,
        }),
      });
      const data = await readApiJson(response, "Movie ID correction failed");
      if (data.upload) {
        setCurrentUpload(data.upload);
        onUploadChanged(data.upload);
        setCorrectionTitle(data.upload.movieTitle || data.result?.title || title);
        setCorrectionYear(data.upload.movieYear || data.result?.year || correctionYear.trim());
      }
    } catch (err) {
      setCorrectionError(err instanceof Error ? err.message : "Movie ID correction failed");
    } finally {
      setCorrecting(false);
    }
  }

  const postContent = (
    <div className="space-y-5">
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(260px,0.75fr)]">
        <section className={cn("rounded-xl border p-5", tokens.surfaceSoft)}>
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.16em] text-[var(--ui-accent-text)]">Uploaded post</p>
              <h2 className={cn("mt-2 text-lg font-bold leading-tight", tokens.text)}>{currentUpload.title}</h2>
              <p className={cn("mt-3 max-w-3xl text-sm leading-6", tokens.muted)}>{currentUpload.description || "No description stored for this upload."}</p>
            </div>
            <StatusPill status={currentUpload.status} />
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            {publishedUrl ? (
              <a href={publishedUrl} target="_blank" rel="noreferrer" className="ui-btn is-ink">
                {publishedLabel === "Open on YouTube" ? <Youtube className="h-4 w-4" /> : <ExternalLink className="h-4 w-4" />}
                {publishedLabel}
              </a>
            ) : null}
            {currentUpload.sourceUrl ? (
              <a href={currentUpload.sourceUrl} target="_blank" rel="noreferrer" className="ui-btn">
                <ExternalLink className="h-4 w-4" />
                Source TikTok
              </a>
            ) : null}
            <button type="button" onClick={() => void onReupload(currentUpload.id)} disabled={reuploading === currentUpload.id} className="ui-btn is-primary">
              {reuploading === currentUpload.id ? <Loader2 className="h-4 w-4 ui-spin" /> : <RefreshCw className="h-4 w-4" />}
              Reupload HD test
            </button>
            <button type="button" onClick={() => void onDelete(currentUpload.id)} disabled={deletingUpload === currentUpload.id} className={cn("inline-flex h-10 items-center gap-2 rounded-xl border px-4 text-xs font-bold transition disabled:opacity-50", tokens.isDark ? "border-red-300/25 text-red-200 hover:bg-red-500/10" : "border-red-200 bg-[var(--ui-panel)] text-red-700 hover:bg-red-50")}>
              {deletingUpload === currentUpload.id ? <Loader2 className="h-4 w-4 ui-spin" /> : <Trash2 className="h-4 w-4" />}
              Delete from AutoYT
            </button>
          </div>
        </section>

        <section className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
          <MetricTile theme={theme} icon={<Eye className="h-4 w-4" />} label="Views" value={compact(metric(currentUpload, "viewCount"))} />
          <MetricTile theme={theme} icon={<Heart className="h-4 w-4" />} label="Likes" value={compact(metric(currentUpload, "likeCount"))} />
          <MetricTile theme={theme} icon={<MessageSquare className="h-4 w-4" />} label="Comments" value={compact(metric(currentUpload, "commentCount"))} />
        </section>
      </div>

      <form onSubmit={correctMovieId} className={cn("rounded-xl border p-5", tokens.surface)}>
        <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <SectionTitle theme={theme} title="Manual Movie ID correction" body="Enter the right title and AutoYT will refresh the movie details, update the upload record, and make comment replies use the corrected source." />
          {movieResult.sourceVerification?.verified || movieResult.manualCorrection ? (
            <span className="inline-flex w-fit rounded-full bg-[var(--ui-accent-soft)] px-3 py-1 text-[11px] font-black uppercase tracking-widest text-[var(--ui-accent-text)]">Verified source</span>
          ) : null}
        </div>
        <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_120px_150px_150px]">
          <input
            value={correctionTitle}
            onChange={(event) => setCorrectionTitle(event.target.value)}
            placeholder="Correct title, e.g. Classless Hero"
            className="h-11 rounded-xl border border-[var(--ui-line)] bg-[var(--ui-panel)] px-4 text-sm font-semibold text-[var(--ui-text)] outline-none transition"
          />
          <input
            value={correctionYear}
            onChange={(event) => setCorrectionYear(event.target.value)}
            placeholder="Year"
            className="h-11 rounded-xl border border-[var(--ui-line)] bg-[var(--ui-panel)] px-4 text-sm font-semibold text-[var(--ui-text)] outline-none transition"
          />
          <select
            value={correctionMediaType}
            onChange={(event) => setCorrectionMediaType(event.target.value)}
            className="h-11 rounded-xl border border-[var(--ui-line)] bg-[var(--ui-panel)] px-4 text-sm font-semibold text-[var(--ui-text)] outline-none transition"
          >
            <option value="auto">Auto</option>
            <option value="anime">Anime</option>
            <option value="manga">Manga / manhwa</option>
            <option value="movie">Movie</option>
            <option value="tv">TV show</option>
          </select>
          <button type="submit" disabled={correcting || !correctionTitle.trim()} className="ui-btn is-primary">
            {correcting ? <Loader2 className="h-4 w-4 ui-spin" /> : <ShieldCheck className="h-4 w-4" />}
            Correct record
          </button>
        </div>
      </form>

      <div className="grid gap-5 xl:grid-cols-2">
        <section className={cn("rounded-xl border p-5", tokens.surface)}>
          <SectionTitle theme={theme} title="Performance" body="Public stats and YouTube Analytics totals captured by the scheduler." />
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <MiniStat theme={theme} label="Watch minutes" value={compact(totals.estimatedMinutesWatched)} />
            <MiniStat theme={theme} label="Avg duration" value={`${compact(totals.averageViewDuration)}s`} />
            <MiniStat theme={theme} label="Subscribers" value={compact(totals.subscribersGained)} />
          </div>
          <div className="mt-5 rounded-xl border border-[var(--ui-line)]">
            <div className="grid grid-cols-4 bg-[var(--ui-bg)] px-3 py-2 text-[11px] font-bold uppercase tracking-widest text-[var(--ui-text)]/35">
              <span>Day</span>
              <span className="text-right">Views</span>
              <span className="text-right">Likes</span>
              <span className="text-right">Comments</span>
            </div>
            <div className="divide-y divide-[var(--ui-line)]">
              {daily.slice(-7).map((day: Record<string, number | string>, index: number) => (
                <div key={`${day.day}-${index}`} className="grid grid-cols-4 px-3 py-2 text-xs font-semibold text-[var(--ui-text)]/60">
                  <span>{String(day.day || "Day")}</span>
                  <span className="text-right">{compact(day.views)}</span>
                  <span className="text-right">{compact(day.likes)}</span>
                  <span className="text-right">{compact(day.comments)}</span>
                </div>
              ))}
              {!daily.length ? <p className="px-3 py-4 text-sm font-semibold text-[var(--ui-text)]/45">Analytics will appear after the next performance check.</p> : null}
            </div>
          </div>
        </section>

        <section className={cn("rounded-xl border p-5", tokens.surfaceSoft)}>
          <SectionTitle theme={theme} title="Source signals" body="Useful context for the agent learning loop." />
          <div className="mt-4 space-y-3">
            <InfoRow theme={theme} label="TikTok author" value={currentUpload.sourceAuthor || "Unknown"} />
            <InfoRow theme={theme} label="Source plays" value={compact(sourceStats.playCount || sourceStats.plays || sourceStats.views)} />
            <InfoRow theme={theme} label="Source likes" value={compact(sourceStats.diggCount || sourceStats.likes)} />
            <InfoRow theme={theme} label="File rename" value={currentUpload.metrics?.fileName || "Pending"} />
          </div>
        </section>
      </div>
    </div>
  );

  return (
    <section className="space-y-5">
      <button type="button" onClick={onBack} className={cn("inline-flex h-10 items-center gap-2 rounded-lg border px-4 text-xs font-bold transition active:scale-[0.98]", tokens.surface, tokens.text)}>
        <ArrowLeft className="h-4 w-4" />
        Back to uploads
      </button>

      <MovieAnalysisTabs result={movieResult} savedAt={currentUpload.createdAt} compact postContent={postContent} postLabel="Post" initialTab="post" />
    </section>
  );
}

function uploadToMovieResult(upload: AutomationUpload): MovieResult & { genre?: string; manualCorrection?: boolean; sourceVerification?: Record<string, unknown> } {
  const movie = (upload.metrics?.movie || {}) as Partial<MovieResult> & { manualCorrection?: boolean; sourceVerification?: Record<string, unknown> };
  const tmdbSummary = movie.tmdb?.overview || "";
  const malSummary = movie.mal?.synopsis || "";
  const title = String(movie.title || upload.movieTitle || "Unknown title");
  const year = String(movie.year || upload.movieYear || "");
  return {
    ...movie,
    title,
    year,
    director: movie.director || movie.tmdb?.director || "",
    mediaType: movie.mediaType || (movie.mal?.type ? "anime" : movie.tmdb?.mediaType) || upload.genre || "",
    confidence: Number(movie.confidence || 0),
    genre: (movie as any).genre || upload.genre || movie.mal?.genres?.[0] || movie.tmdb?.genres?.[0] || "",
    summary: movie.summary || tmdbSummary || malSummary || upload.description || "No overview available yet.",
    posterUrl: movie.posterUrl || movie.mal?.imageUrl || movie.tmdb?.backdropUrl || "",
    evidence: movie.evidence || {
      audio: upload.metrics?.transcriptExcerpt || upload.metrics?.sourceTitle || "",
      visual: upload.metrics?.sourceIdentity?.title || upload.title || "",
      reasoning: "Captured during automation upload.",
    },
    transcript: movie.transcript || {
      excerpt: upload.metrics?.transcriptExcerpt || "",
      fullText: upload.metrics?.transcript || upload.metrics?.localTranscript || "",
    },
    contentNiche: movie.contentNiche || {
      primary: upload.genre || "",
      secondary: upload.microNiche ? [upload.microNiche] : [],
      rationale: upload.metrics?.taxonomy?.rationale || "",
    },
    tmdb: movie.tmdb,
    mal: movie.mal,
    manualCorrection: movie.manualCorrection,
    sourceVerification: movie.sourceVerification,
  };
}

function RunsPanel({ runs, theme = "light" }: { runs: AutomationRun[]; theme?: AgentTheme }) {
  const tokens = getAgentTheme(theme);
  return (
    <section className="space-y-4">
      <SectionTitle theme={theme} title="Run log" body="Every agent scan, upload, duplicate skip, and error appears here." />
      <div className={cn("overflow-hidden rounded-xl border", tokens.surface)}>
        <div className={cn("divide-y", tokens.divider)}>
          {runs.map((run) => (
            <div key={run.id} className="grid gap-3 p-4 md:grid-cols-[120px_minmax(0,1fr)_160px]">
              <div>
                <StatusPill status={run.status} />
              </div>
              <div className="min-w-0">
                <p className={cn("text-sm font-semibold leading-6", tokens.text)}>{run.message}</p>
                {run.details ? (
                  <details className="group mt-1.5">
                    <summary className={cn("inline-flex cursor-pointer select-none list-none items-center gap-1 text-xs font-bold transition hover:text-[var(--ui-accent-text)] [&::-webkit-details-marker]:hidden", tokens.subtle)}>
                      <ArrowUpRight className="h-3 w-3 rotate-45 transition-transform group-open:rotate-[135deg]" />
                      Run details
                    </summary>
                    <pre className={cn("mt-2 max-h-48 overflow-auto rounded-lg p-3 text-xs leading-5", tokens.surfaceSoft, tokens.muted)}>{JSON.stringify(run.details, null, 2)}</pre>
                  </details>
                ) : null}
              </div>
              <div className={cn("text-xs font-semibold md:text-right", tokens.subtle)}>
                <p>{formatDate(run.startedAt)}</p>
                {run.finishedAt ? <p className="mt-1">Done {formatDate(run.finishedAt)}</p> : null}
              </div>
            </div>
          ))}
          {!runs.length ? <p className={cn("p-8 text-center text-sm font-semibold", tokens.muted)}>No runs yet.</p> : null}
        </div>
      </div>
    </section>
  );
}

function ToggleRow({ title, body, checked, onChange, wide = true }: { title: string; body: string; checked: boolean; onChange: (next: boolean) => void; wide?: boolean }) {
  return <Switch className={cn("agent-switch", wide && "md:col-span-2")} label={title} description={body} checked={checked} onChange={onChange} />;
}

function DurationTrimControl({ value, onChange, theme }: { value: number; onChange: (value: number) => void; theme: AgentTheme }) {
  const tokens = getAgentTheme(theme);
  const duration = Math.min(Math.max(Math.round(value || 150), 60), 179);
  const progress = ((duration - 60) / 119) * 100;
  const label = `${Math.floor(duration / 60)}:${String(duration % 60).padStart(2, "0")}`;
  const windowStart = Math.max(1, duration - 10);
  const windowEnd = Math.min(179, duration + 10);
  const formatDuration = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  const presets = [60, 90, 120, 150, 175];

  return (
    <div className={cn("overflow-hidden rounded-xl border", tokens.surface)}>
      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[var(--ui-accent)] text-[var(--ui-accent-ink)]"><Scissors className="h-4 w-4" /></span>
          <div className="min-w-0">
            <p className={cn("text-sm font-bold", tokens.text)}>Shorts duration target</p>
            <p className={cn("mt-0.5 text-xs font-semibold", tokens.muted)}>Transcript-scored window {formatDuration(windowStart)}–{formatDuration(windowEnd)} for complete sentences and strong story beats.</p>
          </div>
        </div>
        <output className={cn("shrink-0 text-2xl font-black tabular-nums", tokens.text)} aria-live="polite">{label}</output>
      </div>
      <div className={cn("border-t px-4 pb-4 pt-3", tokens.divider, tokens.surfaceSoft)}>
        <input
          type="range"
          min={60}
          max={179}
          step={1}
          value={duration}
          onChange={(event) => onChange(Number(event.target.value))}
          className="ui-range"
          style={{ ["--fill" as string]: `${progress}%` }}
          aria-label="Target video duration in seconds"
        />
        <div className={cn("flex justify-between text-[10px] font-bold tabular-nums", tokens.subtle)}><span>1:00</span><span>2:59 maximum</span></div>
        <div className="mt-3 grid grid-cols-5 gap-1.5" role="group" aria-label="Duration presets">
          {presets.map((preset) => {
            const active = Math.abs(duration - preset) < 3;
            return (
              <button key={preset} type="button" onClick={() => onChange(preset)} className={cn("h-8 rounded-lg text-[11px] font-bold tabular-nums transition", active ? "bg-[var(--ui-accent)] text-[var(--ui-accent-ink)]" : tokens.isDark ? "bg-[var(--ui-text)]/8 text-[var(--ui-text)]/65 hover:bg-[var(--ui-text)]/14" : "bg-[var(--ui-panel)] text-[var(--ui-text)]/55 hover:text-[var(--ui-text)]")}>
                {Math.floor(preset / 60)}:{String(preset % 60).padStart(2, "0")}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children, wide = false }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <label className={cn("space-y-1.5", wide && "md:col-span-2")}>
      <span className="agent-field-label block text-[11px] font-bold uppercase tracking-widest text-[var(--ui-text-muted)]">{label}</span>
      {children}
    </label>
  );
}

function Notice({ title, body, tone = "warn" }: { title: string; body: string; tone?: "warn" | "error" | "success" }) {
  return <SharedNotice tone={tone === "warn" ? "warning" : tone} title={title}>{body}</SharedNotice>;
}

function SectionTitle({ title, body, theme = "light" }: { title: string; body: string; theme?: AgentTheme }) {
  const tokens = getAgentTheme(theme);
  return (
    <div>
      <h2 className={cn("text-sm font-bold", tokens.text)}>{title}</h2>
      <p className={cn("mt-1 max-w-2xl text-sm leading-6", tokens.muted)}>{body}</p>
    </div>
  );
}

function MetricTile({ icon, label, value, theme = "light" }: { icon: ReactNode; label: string; value: ReactNode; theme?: AgentTheme }) {
  return <AgentMetricCard theme={theme} icon={icon} label={label} value={value} />;
}

function MiniStat({ label, value, theme = "light" }: { label: string; value: ReactNode; theme?: AgentTheme }) {
  const tokens = getAgentTheme(theme);
  return (
    <div className={cn("rounded-lg border p-3", tokens.surfaceSoft)}>
      <p className={cn("text-[10px] font-black uppercase tracking-[0.16em]", tokens.subtle)}>{label}</p>
      <p className={cn("mt-1 text-sm font-bold", tokens.text)}>{value}</p>
    </div>
  );
}

function InfoRow({ label, value, theme = "light" }: { label: string; value: ReactNode; theme?: AgentTheme }) {
  const tokens = getAgentTheme(theme);
  return (
    <div className={cn("rounded-xl border p-3", tokens.surfaceSoft)}>
      <p className={cn("text-[10px] font-black uppercase tracking-[0.16em]", tokens.subtle)}>{label}</p>
      <p className={cn("mt-1 text-sm font-semibold leading-6", tokens.textSoft)}>{value || "Pending"}</p>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const clean = String(status || "pending");
  const label = clean === "hd_test" ? "HD test" : clean.replace(/_/g, " ");
  const success = ["uploaded", "scheduled", "success", "active", "hd_test"].includes(clean);
  const error = ["error", "failed"].includes(clean);
  const cancelled = clean === "cancelled";
  return (
    <span className={cn(
      "inline-flex w-fit rounded-full px-2.5 py-1 text-[10px] font-bold uppercase",
      success ? "bg-[var(--ui-accent-soft)] text-[var(--ui-accent-text)]" : error ? "bg-[var(--ui-accent-soft)] text-[var(--ui-accent-text)]" : cancelled ? "bg-[var(--ui-text)]/8 text-[var(--ui-text)]/60" : "bg-[var(--ui-text)]/5 text-[var(--ui-text)]/50"
    )}>
      {label}
    </span>
  );
}
