import {
  AlertCircle,
  Activity,
  ArrowLeft,
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  BarChart3,
  Bot,
  CalendarClock,
  CheckCircle2,
  Clipboard,
  Clock3,
  ExternalLink,
  Eye,
  Film,
  Heart,
  History,
  Layers3,
  LayoutList,
  Loader2,
  Menu,
  MessageCircle,
  MessageSquare,
  Mic,
  MicOff,
  Navigation,
  Play,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Square,
  Table2,
  Tags,
  TrendingUp,
  Trash2,
  X,
  Youtube,
} from "lucide-react";
import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { writeDeepLink } from "../utils/tiktokRoute";
import { agentUploadMedia, buildAgentAnalyticsViz, readAgentUploadMetric } from "../utils/agentAnalyticsViz";
import {
  AgentChatBlocks,
  FormattedChatText,
  PerformanceReportView,
  type AgentChatBlock,
  type AgentPerformanceReport,
} from "./AgentStructuredContent";
import { MovieAnalysisTabs } from "./MovieAnalysisTabs";

const DEFAULT_SETTINGS = {
  maxPostsPerDay: 1,
  scheduleTimes: ["09:00", "18:00"],
  scheduleLeadMinutes: 120,
  timezone: "Africa/Nairobi",
  publishMode: "schedule",
  searchDepth: 50,
  sourcePriority: "views",
  dynamicSourceLearning: true,
  sourceExplorationEnabled: true,
  sourceExplorationChannels: 6,
  sourceUnderperformingViewThreshold: 1000,
  sourceNicheMode: "balanced",
  adaptiveStrategyEnabled: true,
  adaptiveSchedulingEnabled: true,
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
  compilationMaxClips: 80,
  compilationTitle: "",
  compilationDescription: "",
  compilationLayout: "vertical",
  rightsConfirmed: false,
};

type AutomationTab = "chat" | "overview" | "analytics" | "report" | "setup" | "compile" | "uploads" | "runs";
type SetupSubTab = "basics" | "source" | "schedule" | "learning" | "comments" | "safety";
type AgentRunOptions = { stayInChat?: boolean; throwOnError?: boolean };

const TABS: Array<{ id: AutomationTab; label: string; icon: ReactNode }> = [
  { id: "chat", label: "Chat", icon: <MessageSquare className="h-4 w-4" /> },
  { id: "overview", label: "Overview", icon: <LayoutList className="h-4 w-4" /> },
  { id: "analytics", label: "Analytics", icon: <BarChart3 className="h-4 w-4" /> },
  { id: "report", label: "Report", icon: <TrendingUp className="h-4 w-4" /> },
  { id: "setup", label: "Setup", icon: <Settings2 className="h-4 w-4" /> },
  { id: "compile", label: "Compile", icon: <Layers3 className="h-4 w-4" /> },
  { id: "uploads", label: "Uploads", icon: <Table2 className="h-4 w-4" /> },
  { id: "runs", label: "Run log", icon: <Clock3 className="h-4 w-4" /> },
];

const SETUP_TABS: Array<{ id: SetupSubTab; label: string; hint: string; icon: ReactNode }> = [
  { id: "basics", label: "Channel", hint: "Name, publish channel, playlists", icon: <Bot className="h-4 w-4" /> },
  { id: "source", label: "Source", hint: "Where clips come from", icon: <Film className="h-4 w-4" /> },
  { id: "schedule", label: "Schedule", hint: "How often and when it posts", icon: <CalendarClock className="h-4 w-4" /> },
  { id: "learning", label: "Learning", hint: "Performance checks and cadence", icon: <Sparkles className="h-4 w-4" /> },
  { id: "comments", label: "Comments", hint: "Automated replies", icon: <MessageCircle className="h-4 w-4" /> },
  { id: "safety", label: "Safety", hint: "Rights confirmation", icon: <ShieldCheck className="h-4 w-4" /> },
];

type AgentTheme = "light" | "dark";

function getAgentTheme(theme: AgentTheme) {
  const isDark = theme === "dark";
  return {
    isDark,
    surface: isDark ? "border-[#F8F5E8]/14 bg-[#191C18]" : "border-[#dadada] bg-white",
    surfaceSoft: isDark ? "border-[#F8F5E8]/10 bg-[#151916]" : "border-[#dadada] bg-[#f9f9f9]",
    highlight: isDark ? "border-[#f9dc0b]/35 bg-[#211F12]" : "border-[#f9dc0b]/40 bg-[#fffdf0]",
    accentPanel: "border-[#f9dc0b]/30 bg-[#f9dc0b]/12",
    text: isDark ? "text-[#F8F5E8]" : "text-[#1A1A1A]",
    muted: isDark ? "text-[#F8F5E8]/58" : "text-[#1A1A1A]/58",
    subtle: isDark ? "text-[#F8F5E8]/42" : "text-[#1A1A1A]/42",
    textSoft: isDark ? "text-[#F8F5E8]/82" : "text-[#1A1A1A]/82",
    divider: isDark ? "border-[#F8F5E8]/10" : "border-[#dadada]",
    tabInactive: isDark ? "text-[#F8F5E8]/62 hover:text-[#F8F5E8]" : "text-[#1A1A1A]/62 hover:text-[#1A1A1A]",
    tabActive: isDark ? "text-[#F8F5E8]" : "text-[#1A1A1A]",
    setupTabActive: isDark ? "bg-[#191C18] text-[#F8F5E8] shadow-sm" : "bg-white text-[#1A1A1A] shadow-sm",
    setupTabIdle: isDark ? "text-[#F8F5E8]/55 hover:bg-[#F8F5E8]/6 hover:text-[#F8F5E8]" : "text-[#1A1A1A]/55 hover:bg-white/80 hover:text-[#1A1A1A]",
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

function percent(value?: number | string | null): string {
  const next = Number(value || 0);
  if (!Number.isFinite(next)) return "0%";
  return `${next.toFixed(next >= 10 ? 0 : 1)}%`;
}

function metric(upload: AutomationUpload | null, key: "viewCount" | "likeCount" | "commentCount"): number {
  return readAgentUploadMetric(upload, key);
}

function normalizeSourceIdentity(value?: string | null): string {
  return String(value || "").trim().split("#")[0].split("?")[0].replace(/\/+$/, "").toLowerCase();
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
  const warning = isTikTokPublishAccount(account) && account.zernioConnected === false ? " · needs Zernio reconnect" : "";
  return `${account.channelTitle} · ${platform}${warning}`;
}

function sourceDisplayName(source: AutomationSourceSummary): string {
  const title = source.title?.trim() || source.slug?.replace(/[-_]+/g, " ") || "Saved collection";
  const platform = source.platform === "youtube" ? "YouTube" : source.platform === "tiktok" ? "TikTok" : "";
  return platform ? `${title} · ${platform} (${source.videoCount})` : `${title} (${source.videoCount})`;
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

export function AutomationAgents({ auth, initialSlug = "", onDetailChange, onChatModeChange, theme = "light" }: { auth: AuthSessionPayload; initialSlug?: string; onDetailChange?: (open: boolean) => void; onChatModeChange?: (open: boolean) => void; theme?: "light" | "dark" }) {
  const [accounts, setAccounts] = useState<ConnectedYouTubeAccount[]>(auth.accounts || []);
  const [sources, setSources] = useState<AutomationSourceSummary[]>([]);
  const [agents, setAgents] = useState<AutomationAgent[]>([]);
  const [routeAgent, setRouteAgent] = useState<AutomationAgent | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [activeTab, setActiveTab] = useState<AutomationTab>("chat");
  const [setupSubTab, setSetupSubTab] = useState<SetupSubTab>("basics");
  const [creatingNew, setCreatingNew] = useState(initialSlug === "new");
  const [selectedUploadId, setSelectedUploadId] = useState("");
  const [runs, setRuns] = useState<AutomationRun[]>([]);
  const [uploads, setUploads] = useState<AutomationUpload[]>([]);
  const [learning, setLearning] = useState<AgentLearningProfile | null>(null);
  const [agentReport, setAgentReport] = useState<AgentPerformanceReport | null>(null);
  const [playlists, setPlaylists] = useState<YouTubePlaylistSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingPlaylists, setLoadingPlaylists] = useState(false);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState("");
  const [runningCompilation, setRunningCompilation] = useState("");
  const [reuploading, setReuploading] = useState("");
  const [deleting, setDeleting] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [form, setForm] = useState<any>({
    youtubeAccountId: auth.activeAccount?.id || "",
    name: "Movie recap MSN agent",
    status: "paused",
    sourceType: "saved_playlist",
    sourceKey: "",
    sourceUrl: "",
    settings: DEFAULT_SETTINGS,
  });

  const selectedAgent = useMemo(() => {
    const fromList = agents.find((agent) => agent.id === selectedId);
    if (fromList) return fromList;
    if (routeAgent && (routeAgent.id === selectedId || routeAgent.slug === initialSlug)) return routeAgent;
    return null;
  }, [agents, initialSlug, routeAgent, selectedId]);
  const detailOpen = creatingNew || !!selectedAgent || Boolean(initialSlug && initialSlug !== "new");
  const chatMode = !creatingNew && Boolean(selectedAgent) && activeTab === "chat";
  const selectedUpload = useMemo(() => uploads.find((upload) => upload.id === selectedUploadId) || null, [uploads, selectedUploadId]);
  const activeAccount = useMemo(() => accounts.find((account) => account.id === form.youtubeAccountId) || auth.activeAccount || accounts[0] || null, [accounts, auth.activeAccount, form.youtubeAccountId]);
  const successfulRuns = runs.filter((run) => run.status === "success").length;

  useEffect(() => {
    if (!error && !notice) return;
    const timeout = window.setTimeout(() => {
      setError("");
      setNotice("");
    }, error ? 8000 : 5000);
    return () => window.clearTimeout(timeout);
  }, [error, notice]);

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

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const optionsResponse = await fetch("/api/automation/options");
      const optionsData = await readApiJson(optionsResponse, "Could not load automation options");
      const agentsResponse = await fetch("/api/automation/agents");
      const agentsData = await readApiJson(agentsResponse, "Could not load automation agents");
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
        if (!initialSlug || initialSlug === "new") return "";
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
  }, [auth.accounts, initialSlug]);

  const loadAgentDetail = useCallback(async (id: string, syncSelection = false) => {
    if (!id) {
      setRuns([]);
      setUploads([]);
      setRouteAgent(null);
      setAgentReport(null);
      return;
    }
    try {
      const response = await fetch(`/api/automation/agents/${encodeURIComponent(id)}`);
      const data = await readApiJson(response, "Could not load agent detail");
      if (data.agent) {
        setRouteAgent(data.agent);
        if (syncSelection) setSelectedId(data.agent.id);
      }
      setRuns(data.runs || []);
      setUploads(data.uploads || []);
      setLearning(data.learning || null);
      try {
        const reportAgentId = data.agent?.id || id;
        const reportResponse = await fetch(`/api/automation/agents/${encodeURIComponent(reportAgentId)}/report`);
        const reportData = await readApiJson(reportResponse, "Could not load agent report");
        setAgentReport(reportData.report || null);
      } catch {
        setAgentReport(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load agent detail");
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    void loadPlaylists(form.youtubeAccountId);
  }, [form.youtubeAccountId, loadPlaylists]);

  useEffect(() => {
    setSelectedUploadId("");
    void loadAgentDetail(selectedId);
  }, [loadAgentDetail, selectedId]);

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
      void loadAgentDetail(wanted, true);
    }
  }, [agents, initialSlug, loadAgentDetail, routeAgent?.id, routeAgent?.slug, selectedId]);

  useEffect(() => {
    if (selectedAgent) {
      setForm({
        id: selectedAgent.id,
        youtubeAccountId: selectedAgent.youtubeAccountId,
        name: selectedAgent.name,
        status: selectedAgent.status,
        sourceType: selectedAgent.sourceType,
        sourceKey: selectedAgent.sourceKey,
        sourceUrl: selectedAgent.sourceUrl,
        settings: { ...DEFAULT_SETTINGS, ...(selectedAgent.settings || {}) },
      });
    }
  }, [selectedAgent]);

  useEffect(() => {
    onDetailChange?.(detailOpen);
    return () => onDetailChange?.(false);
  }, [detailOpen, onDetailChange]);

  useEffect(() => {
    onChatModeChange?.(chatMode);
    return () => onChatModeChange?.(false);
  }, [chatMode, onChatModeChange]);

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

  function setSideChannel(index: number, value: string) {
    const next = [...(form.settings.sideChannels || [])];
    next[index] = value;
    updateSetting("sideChannels", next);
  }

  function startNewAgent() {
    setCreatingNew(true);
    setSelectedId("");
    setSelectedUploadId("");
    setActiveTab("setup");
    setSetupSubTab("basics");
    writeDeepLink({ view: "automation", slug: "new" });
    setForm({
      youtubeAccountId: auth.activeAccount?.id || accounts[0]?.id || "",
      name: "Movie recap MSN agent",
      status: "paused",
      sourceType: "saved_playlist",
      sourceKey: sources[0]?.key || "",
      sourceUrl: sources[0]?.analyzedUrl || "",
      settings: DEFAULT_SETTINGS,
    });
  }

  async function saveAgent(event: FormEvent) {
    event.preventDefault();
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
      setNotice("Automation agent saved.");
      setCreatingNew(false);
      setSelectedId(data.agent.id);
      if (data.agent.slug) writeDeepLink({ view: "automation", slug: data.agent.slug }, true);
      setActiveTab("overview");
      setSetupSubTab("basics");
      await loadAll();
      await loadAgentDetail(data.agent.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save automation agent");
    } finally {
      setSaving(false);
    }
  }

  async function runAgent(id: string, options: AgentRunOptions = {}) {
    setRunning(id);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/automation/agents/${encodeURIComponent(id)}/run`, { method: "POST" });
      const data = await readApiJson(response, "Automation run failed");
      const agent = agents.find((item) => item.id === id);
      const publishAccount = accounts.find((item) => item.id === agent?.youtubeAccountId);
      setNotice(isTikTokPublishAccount(publishAccount)
        ? "Agent processed one candidate and scheduled a TikTok post via Zernio."
        : "Agent processed one candidate and created a YouTube upload.");
      if (!options.stayInChat) setActiveTab("uploads");
      if (!options.stayInChat) await loadAll();
      await loadAgentDetail(id);
      if (data.uploadId) setSelectedUploadId(data.uploadId);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Automation run failed";
      setError(message);
      await loadAgentDetail(id);
      if (options.throwOnError) throw new Error(message);
    } finally {
      setRunning("");
    }
  }

  async function runCompilation(id: string) {
    setRunningCompilation(id);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/automation/agents/${encodeURIComponent(id)}/run-compilation`, { method: "POST" });
      const data = await readApiJson(response, "Compilation run failed");
      setNotice("Agent created a long-form compilation upload.");
      setActiveTab("uploads");
      await loadAll();
      await loadAgentDetail(id);
      if (data.result?.uploadId) setSelectedUploadId(data.result.uploadId);
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
      setActiveTab("uploads");
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

  const replaceUpload = useCallback((updatedUpload: AutomationUpload) => {
    setUploads((items) => items.map((item) => (item.id === updatedUpload.id ? updatedUpload : item)));
  }, []);

  async function deleteAgent(id: string) {
    const agent = agents.find((item) => item.id === id);
    const label = agent?.name || "this agent";
    if (!window.confirm(`Delete ${label}? This removes its automation setup, run log, and upload history from AutoYT.`)) return;
    setDeleting(id);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/automation/agents/${encodeURIComponent(id)}/delete`, { method: "POST" });
      await readApiJson(response, "Could not delete automation agent");
      window.localStorage.removeItem(`${AGENT_CHAT_CONVERSATIONS_PREFIX}${id}`);
      window.localStorage.removeItem(`${AGENT_CHAT_LEGACY_HISTORY_PREFIX}${id}`);
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
    return <Notice title="Connect a publish channel first" body="Connect a YouTube channel or TikTok account from Channel Management before creating an automation agent." />;
  }

  return (
    <div className={cn("relative flex h-full min-h-0 flex-col overflow-hidden", !detailOpen && "workspace-floating-shell", theme === "dark" ? "bg-[#111411] text-[#F8F5E8]" : "bg-[#f9f9f9] text-[#1A1A1A]")}>
      {/* ── Sticky top bar ── */}
      {!detailOpen ? (
      <header className="workspace-floating-header flex min-h-12 flex-wrap items-center gap-2 px-3 py-2 sm:px-4">
        <Bot className="h-4 w-4 text-[#f9dc0b]" />
        <span className="text-sm font-black text-[#1A1A1A]">Automation</span>
        <div className="ml-auto flex min-w-0 flex-1 items-center justify-end gap-2 sm:flex-none">
          <button type="button" onClick={startNewAgent} className="inline-flex h-9 min-w-0 items-center gap-2 rounded-xl bg-[#f9dc0b] px-3 text-xs font-black text-[#1A1A1A] shadow-sm transition hover:bg-[#1A1A1A] hover:text-white sm:px-4">
            <Plus className="h-4 w-4" />
            <span className="hidden min-[390px]:inline">New agent</span>
          </button>
          <button type="button" onClick={() => void loadAll()} className="inline-flex h-9 items-center gap-2 rounded-xl border border-[#1A1A1A]/10 bg-white px-3 text-xs font-bold text-[#1A1A1A]/60 transition hover:border-[#1A1A1A]/25 hover:text-[#1A1A1A]">
            <RefreshCw className="h-3.5 w-3.5" />
            <span className="hidden min-[430px]:inline">Refresh</span>
          </button>
        </div>
      </header>
      ) : null}

      <AgentToastViewport
        error={error}
        notice={notice}
        theme={theme}
        onDismissError={() => setError("")}
        onDismissNotice={() => setNotice("")}
      />

      {/* ── Content ── */}
      <div className="min-h-0 flex-1 overflow-hidden">
      <AgentBoard
        accounts={accounts}
        activeAccount={activeAccount}
        activeTab={activeTab}
        agents={agents}
        creatingNew={creatingNew}
        deleting={deleting}
        detailRequested={Boolean(initialSlug && initialSlug !== "new")}
        form={form}
        loading={loading}
        loadingPlaylists={loadingPlaylists}
        onCreateAgent={startNewAgent}
        onDelete={deleteAgent}
        onRefreshPlaylists={() => void loadPlaylists(form.youtubeAccountId)}
        onRun={runAgent}
        onBackToAgents={() => {
          setCreatingNew(false);
          setSelectedId("");
          setSelectedUploadId("");
          setActiveTab("chat");
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
          setActiveTab("chat");
          setSetupSubTab("basics");
          writeDeepLink({ view: "automation", slug: agent.slug || agent.id });
        }}
        onSetActiveTab={setActiveTab}
        onSetSetupSubTab={setSetupSubTab}
        onSetup={() => setActiveTab("setup")}
        onUploads={() => setActiveTab("uploads")}
        reuploading={reuploading}
        runAgent={runAgent}
        runCompilation={runCompilation}
        running={running}
        runningCompilation={runningCompilation}
        runs={runs}
        saveAgent={saveAgent}
        saving={saving}
        selectedAgent={selectedAgent}
        selectedId={selectedId}
        selectedUpload={selectedUpload}
        selectedUploadId={selectedUploadId}
        setForm={setForm}
        setSelectedUploadId={setSelectedUploadId}
        setScheduleTime={setScheduleTime}
        setSideChannel={setSideChannel}
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
        onReupload={reuploadUpload}
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
  agents,
  creatingNew,
  deleting,
  detailRequested,
  form,
  loading,
  loadingPlaylists,
  onCreateAgent,
  onDelete,
  onReupload,
  onRefreshPlaylists,
  onRun,
  onBackToAgents,
  onRefreshAgent,
  onSelect,
  onSetActiveTab,
  onSetSetupSubTab,
  onSetup,
  onUploads,
  reuploading,
  runAgent,
  runCompilation,
  running,
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
  setSideChannel,
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
  onUploadChanged,
  theme,
}: {
  accounts: ConnectedYouTubeAccount[];
  activeAccount: ConnectedYouTubeAccount | null;
  activeTab: AutomationTab;
  agents: AutomationAgent[];
  creatingNew: boolean;
  deleting: string;
  detailRequested: boolean;
  form: any;
  loading: boolean;
  loadingPlaylists: boolean;
  onCreateAgent: () => void;
  onDelete: (id: string) => Promise<void>;
  onReupload: (id: string) => Promise<void>;
  onRefreshPlaylists: () => void;
  onRun: (id: string, options?: AgentRunOptions) => Promise<void>;
  onBackToAgents: () => void;
  onRefreshAgent: () => void;
  onSelect: (agent: AutomationAgent) => void;
  onSetActiveTab: (tab: AutomationTab) => void;
  onSetSetupSubTab: (tab: SetupSubTab) => void;
  onSetup: () => void;
  onUploads: () => void;
  reuploading: string;
  runAgent: (id: string, options?: AgentRunOptions) => Promise<void>;
  runCompilation: (id: string) => Promise<void>;
  running: string;
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
  setSideChannel: (index: number, value: string) => void;
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
  onUploadChanged: (upload: AutomationUpload) => void;
  theme: "light" | "dark";
}) {
  if (loading) {
    return (
      <section className="h-full overflow-y-auto p-4 md:p-5" aria-busy="true" aria-label="Loading agents">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, index) => (
            <div key={index} className="animate-pulse overflow-hidden rounded-[1.05rem] border border-[#1A1A1A]/8 bg-white shadow-sm" style={{ animationDelay: `${index * 90}ms` }}>
              <div className="m-2 h-28 rounded-[0.9rem] bg-[#F9F8F6]" />
              <div className="space-y-2 px-3 pb-3 pt-1">
                <div className="h-4 w-3/5 rounded-md bg-[#1A1A1A]/8" />
                <div className="grid grid-cols-3 gap-1">
                  <div className="h-11 rounded-lg bg-[#F9F8F6]" />
                  <div className="h-11 rounded-lg bg-[#F9F8F6]" />
                  <div className="h-11 rounded-lg bg-[#F9F8F6]" />
                </div>
                <div className="h-9 rounded-lg bg-[#F9F8F6]" />
              </div>
            </div>
          ))}
        </div>
      </section>
    );
  }

  const showingDraft = creatingNew;
  const visibleTab = selectedAgent ? activeTab : "setup";
  const detailAgent = selectedAgent || null;

  if (showingDraft || detailAgent) {
    return (
      <section className="h-full overflow-hidden">
        <ExpandedAgentCard
          key={detailAgent?.id || "draft"}
          accounts={accounts}
          activeAccount={activeAccount}
          activeTab={visibleTab}
          agent={detailAgent}
          agents={agents}
          deleting={deleting}
          form={form}
          onDelete={onDelete}
          onReupload={onReupload}
          onRun={onRun}
          onRefreshAgent={onRefreshAgent}
          onSetActiveTab={onSetActiveTab}
          onSetSetupSubTab={onSetSetupSubTab}
          onSetup={onSetup}
          onUploads={onUploads}
          reuploading={reuploading}
          runAgent={runAgent}
          runCompilation={runCompilation}
          running={running}
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
          setSideChannel={setSideChannel}
          addScheduleTime={addScheduleTime}
          removeScheduleTime={removeScheduleTime}
          setupSubTab={setupSubTab}
          playlists={playlists}
          loadingPlaylists={loadingPlaylists}
          onRefreshPlaylists={onRefreshPlaylists}
          sources={sources}
          successfulRuns={successfulRuns}
          uploads={uploads}
          learning={learning}
          agentReport={agentReport}
          updateSetting={updateSetting}
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
      <section className="space-y-4 p-4 md:p-5">
        <button type="button" onClick={onBackToAgents} className="inline-flex h-10 items-center gap-2 rounded-xl border border-[#1A1A1A]/10 bg-white px-4 text-xs font-bold text-[#1A1A1A] shadow-sm transition hover:border-[#1A1A1A]/25 hover:text-[#1A1A1A]">
          <ArrowLeft className="h-4 w-4" />
          Back to agents
        </button>
        <div className="rounded-2xl border border-[#1A1A1A]/8 bg-white p-6 shadow-sm">
          <div className="flex min-h-32 items-center gap-3 text-sm font-semibold text-[#1A1A1A]/55">
            <Loader2 className="h-4 w-4 animate-spin text-[#f9dc0b]" />
            Opening agent details
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="h-full overflow-y-auto p-4 md:p-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {agents.map((agent) => <CollapsedAgentCard key={agent.id} agent={agent} onSelect={onSelect} />)}

        {!agents.length ? (
          <EmptyAgentCard onCreate={onCreateAgent} />
        ) : null}
      </div>
    </section>
  );
}

function EmptyAgentCard({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="col-span-full grid place-items-center rounded-[1.35rem] border border-dashed border-[#1A1A1A]/12 bg-white px-6 py-14 text-center shadow-sm">
      <div className="grid h-14 w-14 place-items-center rounded-2xl bg-[#f9dc0b]/15 text-[#8a7500]">
        <Bot className="h-6 w-6" />
      </div>
      <p className="mt-5 font-serif text-xl font-bold tracking-tight text-[#1A1A1A]">No agents yet</p>
      <p className="mt-2 max-w-sm text-sm font-semibold leading-6 text-[#1A1A1A]/55">An agent watches a TikTok or YouTube source, identifies each movie, and republishes clips to your channel on a schedule.</p>
      <button type="button" onClick={onCreate} className="mt-6 inline-flex h-10 items-center gap-2 rounded-xl bg-[#f9dc0b] px-5 text-xs font-black text-[#1A1A1A] shadow-sm transition hover:bg-[#1A1A1A] hover:text-white active:scale-[0.98]">
        <Plus className="h-4 w-4" />
        Create your first agent
      </button>
    </div>
  );
}

function sourceKindLabel(type?: string): string {
  if (type === "saved_channel") return "Channel source";
  if (type === "saved_tags") return "Tagged source";
  if (type === "custom_url") return "Custom source";
  return "Playlist source";
}

function publishModeLabel(mode?: string): string {
  if (mode === "private") return "Private upload";
  if (mode === "unlisted") return "Unlisted upload";
  if (mode === "schedule") return "Scheduled release";
  return "Manual review";
}

function sourceShortLabel(agent: AutomationAgent): string {
  const raw = agent.sourceKey || agent.sourceUrl || sourceKindLabel(agent.sourceType);
  const cleaned = raw
    .replace(/^https?:\/\/(www\.)?tiktok\.com\//i, "")
    .replace(/^https?:\/\/(www\.)?youtube\.com\//i, "")
    .replace(/^@/, "@")
    .split("?")[0]
    .replace(/\/collection\/?/i, " collection")
    .replace(/\/video\/.*/i, " video")
    .replace(/\/shorts\/?/i, " shorts")
    .replace(/[-_]+/g, " ")
    .trim();
  return cleaned || sourceKindLabel(agent.sourceType);
}

function agentInitials(agent: AutomationAgent): string {
  const name = agent.channelTitle || agent.name || "Agent";
  const parts = name.split(/\s+/).filter(Boolean).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase()).join("") || "A";
}

function CollapsedAgentCard({ agent, onSelect }: { agent: AutomationAgent; onSelect: (agent: AutomationAgent) => void }) {
  const uploadCount = Number(agent.uploadCount || 0);
  const postsPerDay = Number(agent.settings?.maxPostsPerDay || 0);
  const cadence = postsPerDay >= 1 ? `${postsPerDay}/day` : "Manual";
  const nextRun = agentNextRunLabel(agent);
  const scheduleTimes = (agent.settings?.scheduleTimes || []).slice(0, 2).join(", ") || "No time";
  const latestTitle = agent.lastUpload?.movieTitle || agent.lastUpload?.title || "Waiting for first upload";

  return (
    <button
      type="button"
      aria-label={`Open ${agent.name}`}
      onClick={() => onSelect(agent)}
      className="group overflow-hidden rounded-[1.05rem] border border-[#1A1A1A]/8 bg-white text-left shadow-[0_10px_28px_rgba(26,26,26,0.052)] transition duration-200 hover:-translate-y-0.5 hover:border-[#1A1A1A]/25 hover:shadow-[0_16px_42px_rgba(26,26,26,0.09)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f9dc0b]/35"
    >
      <div className="relative m-2 overflow-hidden rounded-[0.9rem] border border-[#1A1A1A]/8 bg-[#F9F8F6]">
        <div className="absolute inset-0 bg-[linear-gradient(135deg,#fff4ad_0%,#f9f8f6_48%,#ffe5eb_100%)]" />
        <div className="absolute -right-12 top-0 h-full w-24 rotate-12 bg-[#f9dc0b]/10" />
        <div className="absolute -left-10 bottom-0 h-12 w-36 -rotate-6 bg-[#f9dc0b]/45" />
        <div className="relative flex min-h-24 flex-col justify-between p-2.5">
          <div className="flex items-start justify-between gap-2">
            <span className="rounded-full bg-white/90 px-2 py-0.5 text-[8px] font-bold uppercase tracking-widest text-[#1A1A1A]/60 shadow-sm">{sourceKindLabel(agent.sourceType)}</span>
            <StatusPill status={agent.status} />
          </div>
          <div className="flex items-end justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                {agent.channelThumbnailUrl ? (
                  <img src={agent.channelThumbnailUrl} alt="" className="h-8 w-8 rounded-lg border border-white/75 object-cover shadow-sm" />
                ) : (
                  <span className="grid h-8 w-8 place-items-center rounded-lg bg-[#1A1A1A] text-[11px] font-black text-[#f9dc0b] shadow-sm">{agentInitials(agent)}</span>
                )}
                <div className="min-w-0">
                  <p className="truncate text-[10px] font-bold text-[#1A1A1A]/55">{agent.channelTitle || agent.channelHandle || "YouTube channel"}</p>
                  <p className="mt-0.5 truncate text-[9px] font-bold uppercase tracking-widest text-[#8a7500]">{publishModeLabel(agent.settings?.publishMode)}</p>
                </div>
              </div>
            </div>
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#1A1A1A] text-[#f9dc0b] shadow-sm transition duration-200 group-hover:scale-105 group-hover:bg-[#f9dc0b] group-hover:text-[#1A1A1A]">
              <ArrowUpRight className="h-3.5 w-3.5" />
            </span>
          </div>
        </div>
      </div>

      <div className="px-3 pb-3 pt-1">
        <h3 className="line-clamp-1 font-serif text-base font-bold leading-6 tracking-tight text-[#1A1A1A]">{agent.name}</h3>

        <div className="mt-2 grid grid-cols-3 gap-1">
          <CardStat label="Uploads" value={compact(uploadCount)} />
          <CardStat label="Cadence" value={cadence} />
          <CardStat label="Post times" value={scheduleTimes} />
        </div>

        <div className="mt-2 flex items-center gap-2 rounded-lg border border-[#1A1A1A]/8 bg-[#F9F8F6] px-2.5 py-2">
          <Film className="h-3.5 w-3.5 shrink-0 text-[#8a7500]" />
          <p className="min-w-0 truncate text-[11px] font-bold text-[#1A1A1A]/60">{sourceShortLabel(agent)}</p>
          <span className="ml-auto shrink-0 rounded-full bg-white px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-widest text-[#1A1A1A]/40">Source</span>
        </div>

        <div className="mt-2 grid gap-2 border-t border-[#1A1A1A]/8 pt-2 sm:grid-cols-[minmax(0,1fr)_88px]">
          <div className="min-w-0">
            <p className="text-[9px] font-bold uppercase tracking-widest text-[#1A1A1A]/35">Latest upload</p>
            <p className="mt-0.5 line-clamp-1 text-[11px] font-bold text-[#1A1A1A]/62">{latestTitle}</p>
          </div>
          <div className="text-left sm:text-right">
            <p className="text-[9px] font-bold uppercase tracking-widest text-[#1A1A1A]/35">Next run</p>
            <p className="mt-0.5 truncate text-[11px] font-black text-[#1A1A1A]">{nextRun}</p>
          </div>
        </div>
      </div>
    </button>
  );
}

function ExpandedAgentCard({
  accounts,
  activeAccount,
  activeTab,
  agent,
  agents,
  deleting,
  form,
  onDelete,
  onReupload,
  onRun,
  onRefreshAgent,
  onSetActiveTab,
  onSetSetupSubTab,
  onSetup,
  onUploads,
  reuploading,
  runAgent,
  runCompilation,
  running,
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
  setSideChannel,
  addScheduleTime,
  removeScheduleTime,
  setupSubTab,
  playlists,
  loadingPlaylists,
  onRefreshPlaylists,
  sources,
  successfulRuns,
  uploads,
  learning,
  agentReport,
  updateSetting,
  onBackToAgents,
  onCreateAgent,
  onSelectAgent,
  onUploadChanged,
  theme,
}: {
  accounts: ConnectedYouTubeAccount[];
  activeAccount: ConnectedYouTubeAccount | null;
  activeTab: AutomationTab;
  agent: AutomationAgent | null;
  agents: AutomationAgent[];
  deleting: string;
  form: any;
  onDelete: (id: string) => Promise<void>;
  onReupload: (id: string) => Promise<void>;
  onRun: (id: string, options?: AgentRunOptions) => Promise<void>;
  onRefreshAgent: () => void;
  onSetActiveTab: (tab: AutomationTab) => void;
  onSetSetupSubTab: (tab: SetupSubTab) => void;
  onSetup: () => void;
  onUploads: () => void;
  reuploading: string;
  runAgent: (id: string, options?: AgentRunOptions) => Promise<void>;
  runCompilation: (id: string) => Promise<void>;
  running: string;
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
  setSideChannel: (index: number, value: string) => void;
  addScheduleTime: () => void;
  removeScheduleTime: (index: number) => void;
  setupSubTab: SetupSubTab;
  playlists: YouTubePlaylistSummary[];
  loadingPlaylists: boolean;
  onRefreshPlaylists: () => void;
  sources: AutomationSourceSummary[];
  successfulRuns: number;
  uploads: AutomationUpload[];
  learning: AgentLearningProfile | null;
  agentReport: AgentPerformanceReport | null;
  updateSetting: (key: string, value: unknown) => void;
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
  const channelLabel = agent?.channelTitle || activeAccount?.channelTitle || "No channel connected";
  const headerSubline = isDraft
    ? "Draft agent · configure the setup tabs, then save"
    : `${channelLabel} · ${publishModeLabel(agent?.settings?.publishMode)} · Next run ${agentNextRunLabel(agent)}`;
  const tabCounts: Partial<Record<AutomationTab, number>> = { uploads: uploads.length, runs: runs.length };

  return (
    <article className={cn("workspace-floating-shell relative flex h-full flex-col overflow-hidden", isDark ? "bg-[#111411] text-[#F8F5E8]" : "bg-[#f9f9f9] text-[#1A1A1A]")}>
      {/* ── Agent detail header ── */}
      <div className="workspace-floating-header px-2 py-1.5 md:px-3">
        <div className="flex min-w-0 items-center gap-1.5">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {tab === "chat" ? (
              <button type="button" onClick={() => setHistoryOpen(true)} className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-lg transition lg:hidden", isDark ? "text-[#F8F5E8]/70 hover:bg-[#F8F5E8]/8" : "text-[#1A1A1A]/70 hover:bg-white")} aria-label="Open chat history">
                <History className="h-4 w-4" />
              </button>
            ) : null}
            <button type="button" onClick={onBackToAgents} className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-lg transition active:scale-[0.98]", isDark ? "text-[#F8F5E8]/70 hover:bg-[#F8F5E8]/8 hover:text-[#F8F5E8]" : "text-[#1A1A1A]/70 hover:bg-white hover:text-[#1A1A1A]")} aria-label="Back to agents">
              <ArrowLeft className="h-4 w-4" />
            </button>
            {agent?.channelThumbnailUrl ? (
              <img src={agent.channelThumbnailUrl} alt="" className="hidden h-8 w-8 shrink-0 rounded-lg border border-white/60 object-cover shadow-sm min-[480px]:block" referrerPolicy="no-referrer" />
            ) : (
              <span className="hidden h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#1A1A1A] text-[#f9dc0b] shadow-sm min-[480px]:grid"><Bot className="h-4 w-4" /></span>
            )}
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <h3 className={cn("line-clamp-1 text-sm font-bold leading-tight md:text-base", isDark ? "text-[#F8F5E8]" : "text-[#1A1A1A]")}>{agent?.name || form.name || "New automation agent"}</h3>
                <span className={cn(
                  "hidden h-5 shrink-0 items-center rounded px-2 text-[9px] font-black uppercase sm:inline-flex",
                  (agent?.status || "draft") === "active"
                    ? "bg-[#f9dc0b] text-[#1A1A1A] ring-1 ring-[#6a5b00]/20"
                    : isDark ? "bg-[#F8F5E8]/10 text-[#F8F5E8]/65 ring-1 ring-[#F8F5E8]/15" : "bg-[#1A1A1A]/6 text-[#1A1A1A]/55 ring-1 ring-[#1A1A1A]/10"
                )}>{agent?.status || "draft"}</span>
              </div>
              <p className={cn("mt-0.5 hidden truncate text-[11px] font-semibold lg:block", isDark ? "text-[#F8F5E8]/55" : "text-[#1A1A1A]/55")}>{headerSubline}</p>
            </div>
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            {!isDraft ? (
              <button type="button" onClick={() => void onRun(agent.id)} disabled={!!running || saving} className={cn("inline-flex h-8 w-8 items-center justify-center gap-2 rounded-lg border text-[10px] font-black uppercase transition active:scale-[0.98] disabled:opacity-50 xl:w-auto xl:px-3", isDark ? "border-[#F8F5E8]/25 bg-transparent text-[#F8F5E8] hover:bg-[#F8F5E8]/8" : "border-[#1A1A1A]/22 bg-white/35 text-[#1A1A1A] hover:bg-white/80")} aria-label="Run candidate" title="Run candidate">
                {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                <span className="hidden xl:inline">Run candidate</span>
              </button>
            ) : null}
            {!isDraft ? (
              <button type="button" onClick={() => void onDelete(agent.id)} disabled={!!deleting || !!running || saving} className={cn("grid h-8 w-8 place-items-center rounded-lg border transition active:scale-[0.98] disabled:opacity-50", isDark ? "border-[#F8F5E8]/25 text-[#F8F5E8] hover:bg-[#F8F5E8]/8" : "border-[#1A1A1A]/22 bg-white/35 text-[#1A1A1A] hover:bg-white/80")} aria-label="Delete agent">
                {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              </button>
            ) : null}
            <button form="automation-agent-form" type="submit" disabled={saving} className="inline-flex h-8 w-8 items-center justify-center gap-2 rounded-lg bg-[#f9dc0b] text-[10px] font-black uppercase text-[#1A1A1A] transition hover:opacity-85 active:scale-[0.98] disabled:opacity-50 xl:w-auto xl:px-3.5" aria-label="Save agent" title="Save agent">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              <span className="hidden xl:inline">Save</span>
            </button>
          </div>
        </div>

        <div className="mt-0.5 flex items-center gap-3 overflow-x-auto overscroll-x-contain [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <button
            type="button"
            onClick={() => setNavOpen((open) => !open)}
            aria-expanded={navOpen}
            aria-label={navOpen ? "Hide agent menu" : "Show agent menu"}
            className={cn(
              "grid h-8 w-8 shrink-0 place-items-center rounded-lg border transition active:scale-[0.98]",
              navOpen
                ? "border-[#f9dc0b] bg-[#f9dc0b] text-[#1A1A1A]"
                : isDark ? "border-[#F8F5E8]/20 text-[#F8F5E8]/70 hover:bg-[#F8F5E8]/8" : "border-[#1A1A1A]/15 text-[#1A1A1A]/60 hover:bg-white"
            )}
          >
            <Menu className="h-4 w-4" />
          </button>
          {TABS.filter((item) => navOpen || item.id === "chat" || item.id === tab).map((item) => {
            const disabled = isDraft && item.id !== "setup";
            const tokens = getAgentTheme(theme);
            const count = isDraft ? undefined : tabCounts[item.id];
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
                  "relative inline-flex h-7 shrink-0 items-center gap-1.5 px-0 text-xs font-semibold transition after:absolute after:-bottom-1 after:left-0 after:h-0.5 after:w-full after:origin-left after:bg-[#f9dc0b] after:transition-transform disabled:cursor-not-allowed disabled:opacity-35",
                  tab === item.id
                    ? cn("after:scale-x-100", tokens.tabActive)
                    : cn("after:scale-x-0 hover:after:scale-x-100", tokens.tabInactive)
                )}
              >
                {item.icon}
                {item.label}
                {typeof count === "number" && count > 0 ? (
                  <span className={cn("rounded-full px-1.5 py-0.5 text-[10px] font-black tabular-nums", tab === item.id ? "bg-[#f9dc0b] text-[#1A1A1A]" : tokens.isDark ? "bg-[#F8F5E8]/10 text-[#F8F5E8]/60" : "bg-[#1A1A1A]/6 text-[#1A1A1A]/55")}>{count}</span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      <div className={cn("min-h-0 flex-1", tab === "chat" ? "flex overflow-hidden" : "overflow-y-auto p-4 md:p-6")}>
        {tab === "chat" ? (
          <AgentChatWorkspace
            agent={agent}
            theme={theme}
            historyOpen={historyOpen}
            onOpenHistory={() => setHistoryOpen(true)}
            onCloseHistory={() => setHistoryOpen(false)}
            onAgentUpdated={onRefreshAgent}
            onSetActiveTab={onSetActiveTab}
            onRunAgent={onRun}
          />
        ) : null}
        {tab === "overview" ? (
          <OverviewPanel
            account={activeAccount}
            agent={agent}
            uploads={uploads}
            runs={runs}
            successfulRuns={successfulRuns}
            onSetup={onSetup}
            onUploads={onUploads}
            theme={theme}
          />
        ) : null}
        {tab === "analytics" ? (
          <AnalyticsPanel agent={agent} uploads={uploads} runs={runs} learning={learning} theme={theme} />
        ) : null}
        {tab === "report" ? (
          <section className="space-y-4 pb-8">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#b89f00]">Agent intelligence</p>
              <h2 className={cn("mt-1 font-serif text-2xl font-bold md:text-3xl", getAgentTheme(theme).text)}>Performance report</h2>
              <p className={cn("mt-1 max-w-2xl text-sm leading-6", getAgentTheme(theme).muted)}>What the last 30 days say about this channel: which source channels earn views, which to throttle, and what the agent recommends next.</p>
            </div>
            <AgentReportPanel report={agentReport} theme={theme} />
          </section>
        ) : null}
        {tab === "setup" ? (
          <SetupPanel
            theme={theme}
            accounts={accounts}
            sources={sources}
            form={form}
            saving={saving}
            selectedId={selectedId}
            running={running}
            setForm={setForm}
            updateSetting={updateSetting}
            setScheduleTime={setScheduleTime}
            setSideChannel={setSideChannel}
            addScheduleTime={addScheduleTime}
            removeScheduleTime={removeScheduleTime}
            saveAgent={saveAgent}
            runAgent={runAgent}
            setupSubTab={setupSubTab}
            onSetSetupSubTab={onSetSetupSubTab}
            playlists={playlists}
            loadingPlaylists={loadingPlaylists}
            onRefreshPlaylists={onRefreshPlaylists}
          />
        ) : null}
        {tab === "compile" ? (
          <CompilationAgentPanel
            agent={agent}
            form={form}
            runningCompilation={runningCompilation}
            saveAgent={saveAgent}
            saving={saving}
            selectedId={selectedId}
            runCompilation={runCompilation}
            updateSetting={updateSetting}
            theme={theme}
          />
        ) : null}
        {tab === "uploads" ? (
          <UploadsPanel
            uploads={uploads}
            selectedUpload={selectedUpload}
            selectedUploadId={selectedUploadId}
            onSelect={setSelectedUploadId}
            onBack={() => setSelectedUploadId("")}
            onReupload={onReupload}
            reuploading={reuploading}
            onUploadChanged={onUploadChanged}
            theme={theme}
          />
        ) : null}
        {tab === "runs" ? <RunsPanel runs={runs} theme={theme} /> : null}
      </div>
    </article>
  );
}

function OverviewPanel({
  account,
  agent,
  uploads,
  runs,
  successfulRuns,
  onSetup,
  onUploads,
  theme,
}: {
  account: ConnectedYouTubeAccount | null;
  agent: AutomationAgent | null;
  uploads: AutomationUpload[];
  runs: AutomationRun[];
  successfulRuns: number;
  onSetup: () => void;
  onUploads: () => void;
  theme: "light" | "dark";
}) {
  const latestUpload = uploads[0] || null;
  const latestPreview = useMemo(() => latestUpload ? buildAgentAnalyticsViz([latestUpload], []).rankedUploads[0] : null, [latestUpload]);
  const [previewOpen, setPreviewOpen] = useState(false);
  const tokens = getAgentTheme(theme);
  const { surface, muted, subtle, text, textSoft, divider, isDark } = tokens;
  const settings = agent?.settings;
  const scheduleTimes = (settings?.scheduleTimes || []).join(", ") || "Not set";
  const totalViews = useMemo(() => uploads.reduce((sum, upload) => sum + metric(upload, "viewCount"), 0), [uploads]);
  const healthMessage = agent?.status === "active"
    ? `Your agent is currently healthy and active. Next automated execution is scheduled for ${agentNextRunLabel(agent)}.`
    : "This agent is paused. Turn it active when the source, schedule, and upload settings are ready.";

  return (
    <div className="space-y-6">
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <AgentMetricCard theme={theme} icon={<Eye className="h-5 w-5" />} label="Total views" value={compact(totalViews)} />
        <AgentMetricCard theme={theme} icon={<Film className="h-5 w-5" />} label="Total uploads" value={compact(uploads.length)} />
        <AgentMetricCard theme={theme} icon={<Clock3 className="h-5 w-5" />} label="Next run" value={agentNextRunLabel(agent)} highlight />
        <AgentMetricCard theme={theme} icon={<CheckCircle2 className="h-5 w-5" />} label="Successful runs" value={compact(successfulRuns)} />
      </section>

      <section className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
        <div className="space-y-6">
          <div className={cn("rounded-xl border p-5 md:p-6", surface)}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-black uppercase tracking-[0.18em] text-[#f9dc0b]">How this agent is set up</p>
                <p className={cn("mt-2 max-w-3xl text-sm leading-6", muted)}>The agent pulls clips from its source, identifies each movie, publishes with channel-fit metadata, then learns from performance checks.</p>
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={onSetup} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[#f9dc0b] px-5 text-[11px] font-black uppercase tracking-[0.12em] text-[#1A1A1A] transition hover:opacity-85 active:scale-[0.98]">
                  <Settings2 className="h-4 w-4" />
                  Edit setup
                </button>
                <button type="button" onClick={onUploads} className={cn("inline-flex h-10 items-center justify-center gap-2 rounded-lg border px-5 text-[11px] font-black uppercase tracking-[0.12em] transition active:scale-[0.98]", isDark ? "border-[#F8F5E8]/35 text-[#F8F5E8] hover:bg-[#F8F5E8]/8" : "border-[#1A1A1A]/35 text-[#1A1A1A] hover:bg-white")}>
                  <Table2 className="h-4 w-4" />
                  Uploads
                </button>
              </div>
            </div>
            <div className={cn("mt-5 grid gap-2 border-t pt-4 sm:grid-cols-2 xl:grid-cols-3", divider)}>
              <InfoRow theme={theme} label="Source" value={agent ? `${sourceShortLabel(agent)} · ${sourceKindLabel(agent.sourceType)}` : "Pending setup"} />
              <InfoRow theme={theme} label="Publish channel" value={account?.channelTitle || agent?.channelTitle || "Not connected"} />
              <InfoRow theme={theme} label="Cadence" value={settings ? `${settings.maxPostsPerDay || 1} post${Number(settings.maxPostsPerDay || 1) > 1 ? "s" : ""}/day at ${scheduleTimes}` : "Pending setup"} />
              <InfoRow theme={theme} label="Publish mode" value={`${publishModeLabel(settings?.publishMode)}${settings?.postAsShort === false ? " · long-form" : " · Shorts"}`} />
              <InfoRow theme={theme} label="Movie ID" value={settings?.movieIdEnabled === false ? "Off" : "On"} />
              <InfoRow theme={theme} label="Smart cadence" value={settings?.performanceCadenceEnabled === false ? "Off — full schedule always" : "On — slows down when uploads stall under 1k views"} />
            </div>
          </div>

          <section>
            <div className="mb-3 flex items-center justify-between gap-3 px-2">
              <p className={cn("text-xs font-black uppercase tracking-[0.25em]", subtle)}>Recent activity</p>
              <p className={cn("text-xs font-semibold", subtle)}>{runs.length} runs</p>
            </div>
            <div className={cn("overflow-hidden rounded-xl border", surface)}>
              {runs.slice(0, 5).map((run) => {
                const success = run.status === "success";
                return (
                  <div key={run.id} className={cn("grid gap-3 border-b px-4 py-3 last:border-b-0 md:grid-cols-[120px_minmax(0,1fr)_140px]", divider)}>
                    <div className="flex items-center gap-2.5">
                      <span className={cn("grid h-7 w-7 place-items-center rounded-lg", success ? "bg-[#f9dc0b]/18 text-[#f9dc0b]" : isDark ? "bg-[#F8F5E8]/8 text-[#F8F5E8]/45" : "bg-[#1A1A1A]/5 text-[#1A1A1A]/45")}>
                        {success ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Clock3 className="h-3.5 w-3.5" />}
                      </span>
                      <p className={cn("text-[10px] font-black uppercase tracking-[0.16em]", success ? "text-[#f9dc0b]" : subtle)}>{run.status}</p>
                    </div>
                    <p className={cn("text-sm leading-6", textSoft)}>{run.message}</p>
                    <p className={cn("text-xs font-medium md:text-right", subtle)}>{formatDate(run.startedAt)}</p>
                  </div>
                );
              })}
              {!runs.length ? <p className={cn("px-5 py-8 text-sm font-semibold", muted)}>No runs yet.</p> : null}
            </div>
          </section>
        </div>

        <aside className="space-y-6">
          <div className={cn("overflow-hidden rounded-xl border", surface)}>
            <div className="p-5">
              <p className={cn("text-xs font-black uppercase tracking-[0.2em]", subtle)}>Latest upload</p>
              {latestUpload ? (
                <div className="mt-5 space-y-5">
                  <button type="button" onClick={() => latestPreview?.playbackUrl && setPreviewOpen(true)} className={cn("group relative grid aspect-video w-full place-items-center overflow-hidden rounded-lg border", isDark ? "border-[#F8F5E8]/10 bg-[#0D0F0D]" : "border-[#dadada] bg-[#f3f3f1]")}>
                    {latestPreview?.thumbnailUrl ? (
                      <img src={latestPreview.thumbnailUrl} alt="" className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.02] group-hover:opacity-70" />
                    ) : (
                      <span className="grid h-16 w-16 place-items-center rounded-xl bg-[#f9dc0b] text-[#1A1A1A]"><Play className="h-7 w-7" /></span>
                    )}
                    {latestPreview?.playbackUrl && latestPreview.thumbnailUrl ? <span className="absolute grid h-12 w-12 place-items-center rounded-full bg-[#f9dc0b] text-[#1A1A1A] shadow-xl transition group-hover:scale-105"><Play className="h-5 w-5 fill-current" /></span> : null}
                  </button>
                  <div>
                    <h3 className={cn("text-base font-bold leading-snug", text)}>{latestUpload.title}</h3>
                    <p className="mt-2 text-xs font-black text-[#f9dc0b]">{latestUpload.movieTitle} {latestUpload.movieYear}</p>
                  </div>
                </div>
              ) : (
                <p className={cn("mt-5 rounded-xl border border-dashed p-5 text-sm font-semibold leading-6", isDark ? "border-[#F8F5E8]/14 bg-[#F8F5E8]/5 text-[#F8F5E8]/55" : "border-[#dadada] bg-[#f9f9f9] text-[#1A1A1A]/55")}>Run one candidate to create the first upload record.</p>
              )}
            </div>
            <div className={cn("grid grid-cols-3 border-t", isDark ? "border-[#f9dc0b]/18" : "border-[#dadada]")}>
              <AgentMiniStat theme={theme} label="Views" value={latestUpload ? compact(metric(latestUpload, "viewCount")) : "0"} />
              <AgentMiniStat theme={theme} label="Likes" value={latestUpload ? compact(metric(latestUpload, "likeCount")) : "0"} />
              <AgentMiniStat theme={theme} label="Comments" value={latestUpload ? compact(metric(latestUpload, "commentCount")) : "0"} />
            </div>
          </div>

          <div className="rounded-xl bg-[#f9dc0b] p-5 text-[#1A1A1A]">
            <div className="flex items-center gap-2.5">
              {agent?.status === "active" ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
              <p className="text-[11px] font-black uppercase tracking-[0.14em]">Agent health</p>
            </div>
            <p className="mt-3 text-sm leading-6 text-[#4a4000]">{healthMessage}</p>
          </div>
        </aside>
      </section>
      {previewOpen && latestPreview ? <AgentVideoLightbox item={latestPreview} theme={theme} onClose={() => setPreviewOpen(false)} /> : null}
    </div>
  );
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
        <span className="shrink-0 text-[#f9dc0b]">{icon}</span>
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
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#b89f00]">Agent intelligence</p>
          <h2 className={cn("mt-1 font-serif text-2xl font-bold md:text-3xl", tokens.text)}>Performance command center</h2>
          <p className={cn("mt-1 max-w-2xl text-sm leading-6", tokens.muted)}>Find the content, timing, and operating patterns moving this channel toward monetization.</p>
        </div>
        <div className={cn("flex w-fit items-center gap-2 rounded-lg border px-3 py-2 text-xs font-bold", tokens.surface)}>
          <Activity className="h-4 w-4 text-[#f9dc0b]" />
          {viz.reliability.successRate}% run reliability
        </div>
      </div>

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
              <Sparkles className="h-4 w-4 text-[#b89f00]" />
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
          <button key={row.id} type="button" onClick={() => onPreview(row)} className="group relative aspect-[9/16] min-w-0 overflow-hidden rounded-xl bg-[#1A1A1A] text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f9dc0b]">
            <img src={row.thumbnailUrl} alt="" className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03] group-hover:opacity-75" />
            <span className="absolute inset-x-0 bottom-0 bg-[#1A1A1A]/85 p-2 text-white">
              <span className="line-clamp-2 text-[11px] font-bold leading-4">{row.title}</span>
              <span className="mt-1 block text-[9px] font-bold text-[#f9dc0b]">{compact(row.views)} views</span>
            </span>
            <span className="absolute left-2 top-2 grid h-8 w-8 place-items-center rounded-full bg-[#f9dc0b] text-[#1A1A1A] shadow-lg transition group-hover:scale-105"><Play className="h-3.5 w-3.5 fill-current" /></span>
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
        <span className="text-[#b89f00]">{icon}</span>
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
      <TrendingUp className="h-4 w-4 shrink-0 text-[#b89f00]" />
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
                      <span className="text-xs font-black text-[#b89f00]">{String(index + 1).padStart(2, "0")}</span>
                      <button type="button" onClick={() => onPreview(row)} disabled={!row.playbackUrl} className="group relative h-14 w-11 shrink-0 overflow-hidden rounded-md bg-[#1A1A1A] disabled:cursor-default" aria-label={`Preview ${row.title}`}>
                        {row.thumbnailUrl ? <img src={row.thumbnailUrl} alt="" className="h-full w-full object-cover transition group-hover:opacity-65" /> : <Film className="m-auto h-full w-4 text-[#f9dc0b]" />}
                        {row.playbackUrl ? <span className="absolute inset-0 grid place-items-center opacity-0 transition group-hover:opacity-100"><span className="grid h-6 w-6 place-items-center rounded-full bg-[#f9dc0b] text-[#1A1A1A]"><Play className="h-3 w-3 fill-current" /></span></span> : null}
                      </button>
                      <div><p className={cn("line-clamp-1 text-sm font-bold", tokens.text)}>{row.title}</p><p className={cn("mt-1 text-xs font-semibold", tokens.subtle)}>{row.movie}</p></div>
                    </div>
                  </td>
                  <td className="px-3 py-3"><p className={cn("text-xs font-bold", tokens.textSoft)}>{row.genre}</p><p className={cn("mt-1 text-[10px] font-semibold", tokens.subtle)}>{row.microNiche}</p></td>
                  <td className={cn("px-3 py-3 text-right text-sm font-black tabular-nums", tokens.text)}>{compact(row.views)}</td>
                  <td className={cn("px-3 py-3 text-right text-sm font-bold tabular-nums", tokens.text)}>{row.engagementRate}%</td>
                  <td className={cn("px-3 py-3 text-right text-sm font-bold tabular-nums", tokens.text)}>{compact(row.comments)}</td>
                  <td className="px-5 py-3 text-right"><span className={cn("rounded-full px-2 py-1 text-[9px] font-black uppercase", row.status === "upload_failed" ? "bg-[#f9dc0b]/15 text-[#b89f00]" : "bg-[#f9dc0b] text-[#1A1A1A]")}>{String(row.status || "pending").replace(/_/g, " ")}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <AnalyticsEmpty theme={theme} text="Ranked uploads appear after this agent publishes." />}
    </section>
  );
}

function AgentVideoLightbox({ item, theme, onClose }: { item: any; theme: AgentTheme; onClose: () => void }) {
  const tokens = getAgentTheme(theme);
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[90] grid place-items-center bg-[#111411]/90 p-3 backdrop-blur-sm md:p-8" role="dialog" aria-modal="true" aria-label={`Video preview: ${item.title}`} onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className={cn("flex max-h-[94vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border shadow-2xl", tokens.surface)}>
        <header className={cn("flex shrink-0 items-center gap-3 border-b px-4 py-3", tokens.divider)}>
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[#f9dc0b] text-[#1A1A1A]"><Play className="h-4 w-4 fill-current" /></span>
          <div className="min-w-0 flex-1"><p className={cn("truncate text-sm font-black", tokens.text)}>{item.title}</p><p className={cn("mt-0.5 truncate text-xs font-semibold", tokens.muted)}>{item.movie} · {compact(item.views)} views</p></div>
          {item.externalUrl ? <a href={item.externalUrl} target="_blank" rel="noreferrer" className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-lg border transition hover:bg-[#f9dc0b] hover:text-[#1A1A1A]", tokens.surfaceSoft, tokens.muted)} aria-label="Open original video"><ExternalLink className="h-4 w-4" /></a> : null}
          <button type="button" onClick={onClose} className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-lg border transition hover:bg-[#f9dc0b] hover:text-[#1A1A1A]", tokens.surfaceSoft, tokens.muted)} aria-label="Close preview"><X className="h-4 w-4" /></button>
        </header>
        <div className="min-h-0 flex-1 bg-[#090b09]">
          {item.playbackUrl ? <iframe src={item.playbackUrl} title={item.title} allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen className="aspect-video max-h-[calc(94vh-66px)] w-full border-0 bg-[#090b09]" /> : <div className="grid aspect-video place-items-center text-sm font-bold text-white/60">Preview is unavailable for this upload.</div>}
        </div>
      </section>
    </div>
  );
}

function AnalyticsDistribution({ title, rows, theme }: { title: string; rows: any[]; theme: AgentTheme }) {
  const tokens = getAgentTheme(theme);
  const max = Math.max(...rows.map((row) => row.views), 1);
  return (
    <section className={cn("rounded-xl border p-4", tokens.surfaceSoft)}>
      <h3 className={cn("text-sm font-black", tokens.text)}>{title}</h3>
      <div className="mt-4 space-y-3">
        {rows.slice(0, 5).map((row, index) => <div key={row.label}><div className="flex justify-between gap-3"><span className={cn("line-clamp-1 text-xs font-bold", tokens.textSoft)}>{row.label}</span><span className={cn("text-xs font-black", tokens.text)}>{compact(row.views)}</span></div><div className={cn("mt-2 h-1.5 overflow-hidden rounded-full", tokens.isDark ? "bg-[#F8F5E8]/8" : "bg-[#1A1A1A]/7")}><div className="h-full rounded-full bg-[#f9dc0b]" style={{ width: `${Math.max(5, (row.views / max) * 100)}%`, opacity: 1 - index * 0.1 }} /></div></div>)}
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
      <div className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-[#f9dc0b]/20 bg-[#f9dc0b]/20">
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
  return <div className={cn("mt-4 grid min-h-48 place-items-center rounded-lg border border-dashed p-6 text-center text-sm font-semibold", tokens.surfaceSoft, tokens.muted)}>{text}</div>;
}

function AgentToastViewport({ error, notice, theme, onDismissError, onDismissNotice }: { error: string; notice: string; theme: AgentTheme; onDismissError: () => void; onDismissNotice: () => void }) {
  const tokens = getAgentTheme(theme);
  if (!error && !notice) return null;
  const message = error || notice;
  const dismiss = error ? onDismissError : onDismissNotice;
  return (
    <div className="pointer-events-none fixed bottom-5 right-4 z-[80] w-[min(390px,calc(100vw-2rem))]">
      <div className={cn("pointer-events-auto flex items-start gap-3 rounded-xl border p-4 shadow-2xl", tokens.surface, error ? "border-[#f9dc0b]/55" : "border-[#f9dc0b]/35")}>
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#f9dc0b] text-[#1A1A1A]">{error ? <AlertCircle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}</span>
        <div className="min-w-0 flex-1"><p className={cn("text-sm font-black", tokens.text)}>{error ? "Action needs attention" : "Action complete"}</p><p className={cn("mt-1 text-xs font-semibold leading-5", tokens.muted)}>{message}</p></div>
        <button type="button" onClick={dismiss} className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-md transition hover:bg-[#f9dc0b] hover:text-[#1A1A1A]", tokens.muted)} aria-label="Dismiss notification"><X className="h-4 w-4" /></button>
      </div>
    </div>
  );
}

function LegacyAnalyticsPanel({ agent, uploads, runs, learning, theme = "light" }: { agent: AutomationAgent | null; uploads: AutomationUpload[]; runs: AutomationRun[]; learning: AgentLearningProfile | null; theme?: AgentTheme }) {
  const analytics = useMemo(() => buildAgentAnalytics(uploads, runs), [uploads, runs]);
  const topGenre = analytics.genres[0];
  const topMsn = analytics.msns[0];
  const latestUpload = uploads[0] || null;
  const learned = learning?.profile || null;
  const tokens = getAgentTheme(theme);

  return (
    <section className="space-y-5">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <AgentMetricCard theme={theme} icon={<Eye className="h-4 w-4" />} label="Total views" value={compact(analytics.totalViews)} />
        <AgentMetricCard theme={theme} icon={<Heart className="h-4 w-4" />} label="Total likes" value={compact(analytics.totalLikes)} />
        <AgentMetricCard theme={theme} icon={<MessageCircle className="h-4 w-4" />} label="Comments" value={compact(analytics.totalComments)} />
        <AgentMetricCard theme={theme} icon={<Sparkles className="h-4 w-4" />} label="Agent replies" value={compact(analytics.totalReplies)} highlight />
      </div>

      <section className={cn("rounded-xl border p-5", tokens.accentPanel)}>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <SectionTitle theme={theme} title="Monetization playbook" body={learning?.summary || "The learning profile will fill after performance checks capture enough uploads."} />
          <span className={cn("w-fit rounded-full px-3 py-1 text-[10px] font-black", tokens.surface, tokens.muted)}>
            {Math.round(Number(learning?.confidence || 0) * 100)}% confidence
          </span>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <InsightRow theme={theme} label="Best hook" value={learned?.bestHooks?.[0]?.label || "Waiting for signals"} />
          <InsightRow theme={theme} label="Best duration" value={learned?.bestDurations?.[0]?.label || "Waiting for signals"} />
          <InsightRow theme={theme} label="Best source" value={learned?.bestSources?.[0] ? `${learned.bestSources[0].label} (${compact(learned.bestSources[0].views)})` : "Waiting for signals"} />
          <InsightRow theme={theme} label="Explore rate" value={learned?.exploreRate !== undefined ? `${Math.round(Number(learned.exploreRate) * 100)}%` : "Adaptive"} />
        </div>
        <p className={cn("mt-4 rounded-xl border px-4 py-3 text-sm font-semibold leading-6", tokens.surface, tokens.textSoft)}>{learning?.recommendation || analytics.recommendation}</p>
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(280px,0.9fr)]">
        <div className={cn("rounded-xl border p-5", tokens.surface)}>
          <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <SectionTitle theme={theme} title="Performance map" body="Which genres and micro-sub-niches are carrying this agent." />
            <p className={cn("text-[10px] font-black uppercase tracking-[0.16em]", tokens.subtle)}>{uploads.length} uploads tracked</p>
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <Leaderboard theme={theme} title="Genres" rows={analytics.genres} empty="No genre performance yet." />
            <Leaderboard theme={theme} title="Micro-sub-niches" rows={analytics.msns} empty="No MSN performance yet." />
          </div>
        </div>

        <div className={cn("rounded-xl border p-5", tokens.surfaceSoft)}>
          <SectionTitle theme={theme} title="Learning snapshot" body="Fast read on what the agent should do more of." />
          <div className="mt-4 space-y-3">
            <InsightRow theme={theme} label="Best genre" value={topGenre ? `${topGenre.label} (${compact(topGenre.views)} views)` : "Waiting for uploads"} />
            <InsightRow theme={theme} label="Best MSN" value={topMsn ? `${topMsn.label} (${compact(topMsn.views)} views)` : "Waiting for uploads"} />
            <InsightRow theme={theme} label="Best source" value={analytics.sources[0] ? `${analytics.sources[0].label} (${compact(analytics.sources[0].views)} views)` : "Waiting for uploads"} />
            <InsightRow theme={theme} label="Last signal" value={latestUpload ? `${latestUpload.movieTitle || latestUpload.title} · ${formatDate(latestUpload.createdAt)}` : "No uploads yet"} />
          </div>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-2">
        <div className={cn("rounded-xl border p-5", tokens.surface)}>
          <SectionTitle theme={theme} title="Community management" body="How many comments the agent has handled and what type of replies it is sending." />
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <MiniStat theme={theme} label="Movie replies" value={compact(analytics.movieReplies)} />
            <MiniStat theme={theme} label="AI replies" value={compact(analytics.aiReplies)} />
            <MiniStat theme={theme} label="Reply rate" value={analytics.totalComments ? `${Math.round((analytics.totalReplies / analytics.totalComments) * 100)}%` : "0%"} />
          </div>
          <div className="mt-4 space-y-2.5">
            {analytics.replyUploads.slice(0, 6).map((item) => (
              <div key={item.id} className={cn("rounded-xl border p-3", tokens.surfaceSoft)}>
                <div className="flex items-start justify-between gap-3">
                  <p className={cn("line-clamp-2 text-sm font-bold leading-6", tokens.text)}>{item.title}</p>
                  <span className="shrink-0 rounded-full bg-[#f9dc0b] px-2.5 py-1 text-[10px] font-bold text-[#1A1A1A]">{compact(item.replies)} replies</span>
                </div>
                <p className={cn("mt-1 text-xs font-semibold", tokens.subtle)}>{compact(item.comments)} comments · last reply {formatDate(item.lastReplyAt)}</p>
              </div>
            ))}
            {!analytics.replyUploads.length ? <p className={cn("rounded-xl border border-dashed p-4 text-sm font-semibold", tokens.surfaceSoft, tokens.muted)}>No community replies captured yet.</p> : null}
          </div>
        </div>

        <div className={cn("rounded-xl border p-5", tokens.surfaceSoft)}>
          <SectionTitle theme={theme} title="Momentum watch" body="Recent upload velocity from public stats and analytics snapshots." />
          <div className="mt-4 space-y-2.5">
            {analytics.momentum.slice(0, 8).map((item) => (
              <div key={item.id} className={cn("grid gap-3 rounded-xl border p-3 md:grid-cols-[minmax(0,1fr)_160px]", tokens.surface)}>
                <div>
                  <p className={cn("line-clamp-1 text-sm font-bold", tokens.text)}>{item.title}</p>
                  <p className={cn("mt-1 text-xs font-semibold", tokens.subtle)}>{item.movie} · {item.genre}</p>
                </div>
                <div className="grid grid-cols-3 gap-2 text-right">
                  <MiniNumber theme={theme} label="Views" value={compact(item.views)} />
                  <MiniNumber theme={theme} label="Likes" value={compact(item.likes)} />
                  <MiniNumber theme={theme} label="Com." value={compact(item.comments)} />
                </div>
              </div>
            ))}
            {!analytics.momentum.length ? <p className={cn("rounded-xl border border-dashed p-4 text-sm font-semibold", tokens.surface, tokens.muted)}>No momentum data yet.</p> : null}
          </div>
        </div>
      </section>

      <section className={cn("rounded-xl border p-5", tokens.surface)}>
        <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <SectionTitle theme={theme} title="Operational health" body="Run success, skips, errors, and whether the agent is learning from enough data." />
          <StatusPill status={agent?.status || "draft"} />
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <MiniStat theme={theme} label="Runs" value={compact(runs.length)} />
          <MiniStat theme={theme} label="Success" value={compact(analytics.successRuns)} />
          <MiniStat theme={theme} label="Errors" value={compact(analytics.errorRuns)} />
          <MiniStat theme={theme} label="Upload success" value={runs.length ? `${Math.round((analytics.successRuns / runs.length) * 100)}%` : "0%"} />
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <InsightRow theme={theme} label="Duplicate/quality skips" value={analytics.skips.length ? `${analytics.skips.length} recent skip records` : "No recent skip signals"} />
          <InsightRow theme={theme} label="Recommendation" value={analytics.recommendation} />
        </div>
      </section>
    </section>
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

function Leaderboard({ title, rows, empty, theme = "light" }: { title: string; rows: any[]; empty: string; theme?: AgentTheme }) {
  const maxViews = Math.max(...rows.map((row) => row.views), 1);
  const tokens = getAgentTheme(theme);
  return (
    <div className={cn("rounded-xl border p-4", tokens.surfaceSoft)}>
      <p className={cn("text-sm font-bold", tokens.text)}>{title}</p>
      <div className="mt-3 space-y-3">
        {rows.slice(0, 6).map((row) => (
          <div key={row.label}>
            <div className="flex items-center justify-between gap-3">
              <p className={cn("line-clamp-1 text-sm font-semibold", tokens.textSoft)}>{row.label}</p>
              <p className={cn("shrink-0 text-xs font-bold", tokens.text)}>{compact(row.views)}</p>
            </div>
            <div className={cn("mt-2 h-1.5 overflow-hidden rounded-full", tokens.isDark ? "bg-[#F8F5E8]/10" : "bg-[#1A1A1A]/5")}>
              <div className="h-full rounded-full bg-[#f9dc0b]" style={{ width: `${Math.max(6, Math.round((row.views / maxViews) * 100))}%` }} />
            </div>
            <p className={cn("mt-1 text-[11px] font-semibold", tokens.subtle)}>{row.uploads} uploads · {compact(row.comments)} comments · {compact(row.replies)} replies</p>
          </div>
        ))}
        {!rows.length ? <p className={cn("rounded-lg border border-dashed p-3 text-sm font-semibold", tokens.surface, tokens.muted)}>{empty}</p> : null}
      </div>
    </div>
  );
}

function InsightRow({ label, value, theme = "light" }: { label: string; value: ReactNode; theme?: AgentTheme }) {
  const tokens = getAgentTheme(theme);
  return (
    <div className={cn("rounded-xl border p-3", tokens.surface)}>
      <p className={cn("text-[10px] font-black uppercase tracking-[0.16em]", tokens.subtle)}>{label}</p>
      <p className={cn("mt-1 text-sm font-semibold leading-6", tokens.textSoft)}>{value}</p>
    </div>
  );
}

function MiniNumber({ label, value, theme = "light" }: { label: string; value: ReactNode; theme?: AgentTheme }) {
  const tokens = getAgentTheme(theme);
  return (
    <div>
      <p className={cn("text-[10px] font-bold uppercase tracking-[0.14em]", tokens.subtle)}>{label}</p>
      <p className={cn("mt-1 text-xs font-bold", tokens.text)}>{value}</p>
    </div>
  );
}

function CompilationAgentPanel({
  agent,
  form,
  runningCompilation,
  saveAgent,
  saving,
  selectedId,
  runCompilation,
  updateSetting,
  theme = "light",
}: {
  agent: AutomationAgent | null;
  form: any;
  runningCompilation: string;
  saveAgent: (event: FormEvent) => Promise<void>;
  saving: boolean;
  selectedId: string;
  runCompilation: (id: string) => Promise<void>;
  updateSetting: (key: string, value: unknown) => void;
  theme?: AgentTheme;
}) {
  const busy = runningCompilation === selectedId;
  const tokens = getAgentTheme(theme);
  const minMinutes = Number(form.settings.compilationMinMinutes) || 30;
  const maxMinutes = Number(form.settings.compilationMaxMinutes) || 40;
  const lengthConflict = minMinutes > maxMinutes;
  const compilationOn = form.settings.compilationEnabled === true;
  return (
    <form id="automation-agent-form" onSubmit={saveAgent} className="space-y-4">
      <section className={cn("rounded-xl border p-4 md:p-5", tokens.surfaceSoft)}>
        <SectionTitle theme={theme} title="Create compilation" body="Stitch the agent source into one long-form upload for the connected channel. The agent picks clips by your source priority, downloads them, and keeps stitching until the target length is reached." />
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <ToggleRow
            title="Enable compilations for this agent"
            body="When enabled, you can run a compilation manually from this tab. Clips that fail to download are skipped and replaced with the next candidates automatically."
            checked={compilationOn}
            onChange={(next) => updateSetting("compilationEnabled", next)}
          />
          <Field label="Min length (minutes)">
            <input type="number" min={1} max={240} value={minMinutes} onChange={(event) => updateSetting("compilationMinMinutes", Number(event.target.value))} className="input bg-white" />
          </Field>
          <Field label="Max length (minutes)">
            <input type="number" min={1} max={300} value={maxMinutes} onChange={(event) => updateSetting("compilationMaxMinutes", Number(event.target.value))} className="input bg-white" />
          </Field>
          {lengthConflict ? (
            <p className="md:col-span-2 rounded-xl border border-[#f9dc0b]/40 bg-[#fff9d6] px-4 py-3 text-sm font-semibold text-[#6a5b00]">
              Min length is above max length. Saving will raise the max to {minMinutes} minutes.
            </p>
          ) : null}
          <Field label="Max clips">
            <input type="number" min={1} max={300} value={form.settings.compilationMaxClips || 80} onChange={(event) => updateSetting("compilationMaxClips", Number(event.target.value))} className="input bg-white" />
          </Field>
          <Field label="Format">
            <select value={form.settings.compilationLayout || "vertical"} onChange={(event) => updateSetting("compilationLayout", event.target.value)} className="input bg-white">
              <option value="vertical">Vertical 9:16</option>
              <option value="landscape">Landscape 16:9</option>
            </select>
          </Field>
          <Field label="Compilation title" wide>
            <input value={form.settings.compilationTitle || ""} onChange={(event) => updateSetting("compilationTitle", event.target.value)} placeholder={`${form.name || "AutoYT"} compilation`} className="input bg-white" />
          </Field>
          <Field label="Description" wide>
            <textarea value={form.settings.compilationDescription || ""} onChange={(event) => updateSetting("compilationDescription", event.target.value)} className="input min-h-24 bg-white py-3 leading-6" />
          </Field>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-3">
        <StepTile theme={theme} icon={<Film className="h-4 w-4" />} label="Select clips" body="Uses the agent source order: highest views, newest first, or oldest first." />
        <StepTile theme={theme} icon={<Layers3 className="h-4 w-4" />} label="Stitch with ffmpeg" body="Downloads clips, checks audio, normalizes size, then joins them." />
        <StepTile theme={theme} icon={<Youtube className="h-4 w-4" />} label="Upload long-form" body="Posts to the connected YouTube channel and target playlist settings." />
      </section>

      <div className={cn("flex flex-wrap items-center justify-between gap-3 border-t pt-4", tokens.divider)}>
        <p className={cn("text-xs font-semibold", tokens.subtle)}>
          {!agent
            ? "Save the agent first, then run a compilation from this tab."
            : busy
              ? "Building the compilation. Downloading and stitching clips can take several minutes — the result appears under Uploads."
              : "Save settings before leaving the page. Run compilation when you want to test the full workflow."}
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => selectedId && void runCompilation(selectedId)} disabled={!agent || busy || saving} className={cn("inline-flex h-10 items-center gap-2 rounded-lg border px-4 text-xs font-bold transition active:scale-[0.98] disabled:opacity-50", tokens.surface, tokens.text, "hover:opacity-90")}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            {busy ? "Building compilation" : "Run compilation"}
          </button>
          <button type="submit" disabled={saving} className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#f9dc0b] px-5 text-xs font-bold text-[#1A1A1A] shadow-sm transition hover:bg-[#1A1A1A] hover:text-white disabled:opacity-50">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            Save agent
          </button>
        </div>
      </div>
    </form>
  );
}

function SetupPanel({
  accounts,
  sources,
  form,
  saving,
  selectedId,
  running,
  setForm,
  updateSetting,
  setScheduleTime,
  setSideChannel,
  addScheduleTime,
  removeScheduleTime,
  saveAgent,
  runAgent,
  setupSubTab,
  onSetSetupSubTab,
  playlists,
  loadingPlaylists,
  onRefreshPlaylists,
  theme = "light",
}: {
  accounts: ConnectedYouTubeAccount[];
  sources: AutomationSourceSummary[];
  form: any;
  saving: boolean;
  selectedId: string;
  running: string;
  setForm: (value: any) => void;
  updateSetting: (key: string, value: unknown) => void;
  setScheduleTime: (index: number, value: string) => void;
  setSideChannel: (index: number, value: string) => void;
  addScheduleTime: () => void;
  removeScheduleTime: (index: number) => void;
  saveAgent: (event: FormEvent) => Promise<void>;
  runAgent: (id: string) => Promise<void>;
  setupSubTab: SetupSubTab;
  onSetSetupSubTab: (tab: SetupSubTab) => void;
  playlists: YouTubePlaylistSummary[];
  loadingPlaylists: boolean;
  onRefreshPlaylists: () => void;
  theme?: AgentTheme;
}) {
  const tokens = getAgentTheme(theme);
  const selectedSource = findSelectedSource(sources, form.sourceKey, form.sourceUrl);
  const selectedSourceValue = selectedSource?.key || form.sourceKey || "";
  const hasUnmatchedSavedSource = Boolean(selectedSourceValue && !selectedSource);
  const publishAccount = accounts.find((account) => account.id === form.youtubeAccountId) || null;
  const tiktokPublish = isTikTokPublishAccount(publishAccount);
  const scheduleTimes = cleanScheduleTimes(form.settings.scheduleTimes);
  const targetPlaylistMode = form.settings.targetPlaylistMode || (form.settings.targetPlaylistId ? "existing" : form.settings.targetPlaylistTitle ? "create" : "auto");
  const sourceTagOptions = useMemo(() => {
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
  }, [sources]);
  const selectedSourceTags = Array.isArray(form.settings.sourceTags) ? form.settings.sourceTags : [];
  function toggleSourceTag(tag: string) {
    const active = selectedSourceTags.some((item: string) => item.toLowerCase() === tag.toLowerCase());
    updateSetting("sourceTags", active ? selectedSourceTags.filter((item: string) => item.toLowerCase() !== tag.toLowerCase()) : [...selectedSourceTags, tag]);
  }

  return (
    <form id="automation-agent-form" onSubmit={saveAgent} className="space-y-5">
      <div>
        <div className={cn("flex gap-1.5 overflow-x-auto overscroll-x-contain rounded-xl border p-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden", tokens.surfaceSoft)}>
          {SETUP_TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              title={item.hint}
              onClick={() => onSetSetupSubTab(item.id)}
              className={cn(
                "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-3 text-xs font-bold transition",
                setupSubTab === item.id ? tokens.setupTabActive : tokens.setupTabIdle
              )}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
        <p className={cn("mt-2 px-1 text-xs font-semibold", tokens.subtle)}>{SETUP_TABS.find((item) => item.id === setupSubTab)?.hint}</p>
      </div>

      {setupSubTab === "basics" ? (
      <section className={cn("rounded-xl border p-4 md:p-5", tokens.surfaceSoft)}>
        <SectionTitle theme={theme} title="Channel and publishing" body={tiktokPublish ? "Name the agent, pick the TikTok publish account, and set how posts go live." : "Name the agent, pick the YouTube channel, and set how uploads go live and where they are filed."} />
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <Field label="Agent name">
            <input value={form.name} onChange={(e) => setForm((prev: any) => ({ ...prev, name: e.target.value }))} className="input bg-white" />
          </Field>
          <Field label="Status">
            <select value={form.status} onChange={(e) => setForm((prev: any) => ({ ...prev, status: e.target.value }))} className="input bg-white">
              <option value="paused">Paused</option>
              <option value="active">Active</option>
            </select>
          </Field>
          <Field label="Publish channel">
            <select value={form.youtubeAccountId} onChange={(e) => setForm((prev: any) => ({ ...prev, youtubeAccountId: e.target.value }))} className="input bg-white">
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>{publishAccountLabel(account)}</option>
              ))}
            </select>
          </Field>
          <Field label="Publish mode">
            <select value={form.settings.publishMode} onChange={(e) => updateSetting("publishMode", e.target.value)} className="input bg-white">
              <option value="schedule">Schedule public release</option>
              <option value="private">Upload private</option>
              <option value="unlisted">Upload unlisted</option>
            </select>
          </Field>
          {!tiktokPublish ? (
          <label className="md:col-span-2 flex flex-col gap-3 rounded-xl border border-[#1A1A1A]/8 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
            <span className="min-w-0">
              <span className="block text-sm font-bold text-[#1A1A1A]">Post as YouTube Short</span>
              <span className="mt-1 block text-xs font-semibold leading-5 text-[#1A1A1A]/48">AutoYT trims long source clips to a natural suspense beat between 1 and 3 minutes before upload. Turn this off when the agent is intentionally posting long-form videos.</span>
            </span>
            <span className={cn("relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition", form.settings.postAsShort !== false ? "border-[#f9dc0b] bg-[#f9dc0b]" : "border-[#1A1A1A]/12 bg-[#1A1A1A]/10")}>
              <input type="checkbox" checked={form.settings.postAsShort !== false} onChange={(e) => updateSetting("postAsShort", e.target.checked)} className="sr-only" />
              <span className={cn("block h-5 w-5 rounded-full bg-white shadow transition", form.settings.postAsShort !== false ? "translate-x-5" : "translate-x-1")} />
            </span>
          </label>
          ) : (
          <div className="md:col-span-2 rounded-xl border border-[#f9dc0b]/30 bg-[#fff9d6] px-4 py-3 text-xs font-semibold leading-5 text-[#6a5b00]">
            TikTok publish uses Zernio scheduling. Clips upload as native TikTok videos with caption metadata, not YouTube Shorts trimming or playlists.
          </div>
          )}
          {!tiktokPublish ? (
          <div className="md:col-span-2">
            <div className="rounded-xl border border-[#1A1A1A]/8 bg-[#F9F8F6] p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-widest text-[#1A1A1A]/40">YouTube playlist</p>
                  <p className="mt-1 text-xs font-semibold text-[#1A1A1A]/48">Store uploads in an existing playlist, create one, or let AutoYT choose by niche.</p>
                </div>
                <button
                  type="button"
                  onClick={onRefreshPlaylists}
                  disabled={loadingPlaylists}
                  className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#1A1A1A]/10 bg-white px-3 text-xs font-bold text-[#1A1A1A] shadow-sm transition hover:border-[#1A1A1A]/25 hover:text-[#1A1A1A] disabled:opacity-50"
                >
                  {loadingPlaylists ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                  Refresh
                </button>
              </div>

              <div className="mt-3 grid gap-3 lg:grid-cols-3">
                <Field label="Playlist mode">
                  <select
                    value={targetPlaylistMode}
                    onChange={(event) => {
                      const mode = event.target.value;
                      updateSetting("targetPlaylistMode", mode);
                      if (mode === "none" || mode === "auto") updateSetting("targetPlaylistId", "");
                      if (mode === "none" || mode === "existing") updateSetting("targetPlaylistTitle", "");
                      if (mode === "create") updateSetting("createTargetPlaylist", true);
                    }}
                    className="input bg-white"
                  >
                    <option value="auto">Auto-pick by niche</option>
                    <option value="existing">Existing playlist</option>
                    <option value="create">Create new playlist</option>
                    <option value="none">No playlist</option>
                  </select>
                </Field>

                {targetPlaylistMode === "existing" ? (
                  <Field label="Existing playlist">
                    <select
                      value={form.settings.targetPlaylistId || ""}
                      onChange={(event) => {
                        const playlist = playlists.find((item) => item.id === event.target.value);
                        updateSetting("targetPlaylistId", event.target.value);
                        updateSetting("targetPlaylistTitle", playlist?.title || "");
                      }}
                      className="input bg-white"
                    >
                      <option value="">{loadingPlaylists ? "Loading playlists" : "Choose playlist"}</option>
                      {playlists.map((playlist) => (
                        <option key={playlist.id} value={playlist.id}>{playlist.title}{playlist.videoCount !== undefined ? ` (${playlist.videoCount})` : ""}</option>
                      ))}
                    </select>
                  </Field>
                ) : null}

                {targetPlaylistMode === "create" ? (
                  <Field label="New playlist name">
                    <input value={form.settings.targetPlaylistTitle || ""} onChange={(e) => updateSetting("targetPlaylistTitle", e.target.value)} placeholder="Anime Recaps" className="input bg-white" />
                  </Field>
                ) : null}

                {targetPlaylistMode === "auto" ? (
                  <Field label="Auto fallback">
                    <input value={form.settings.targetPlaylistTitle || ""} onChange={(e) => updateSetting("targetPlaylistTitle", e.target.value)} placeholder="AutoYT Picks" className="input bg-white" />
                  </Field>
                ) : null}

                {targetPlaylistMode === "auto" ? (
                  <label className="flex min-h-[76px] items-start gap-3 rounded-xl border border-[#1A1A1A]/8 bg-white p-3 text-sm font-semibold text-[#1A1A1A]/65">
                    <input type="checkbox" checked={form.settings.autoCreatePlaylists !== false} onChange={(e) => updateSetting("autoCreatePlaylists", e.target.checked)} className="mt-1" />
                    <span>Create missing playlists automatically.</span>
                  </label>
                ) : null}
              </div>

              {targetPlaylistMode === "auto" ? (
                <div className="mt-3 grid gap-2 text-xs font-semibold text-[#1A1A1A]/55 md:grid-cols-3">
                  <span className="rounded-lg bg-white px-3 py-2">Anime, manga, manhwa: Anime Recaps</span>
                  <span className="rounded-lg bg-white px-3 py-2">Finance, investing: Finance Automation</span>
                  <span className="rounded-lg bg-white px-3 py-2">AI, cartoons: AI Cartoons</span>
                </div>
              ) : null}
            </div>
          </div>
          ) : null}
        </div>
      </section>
      ) : null}

      {setupSubTab === "source" ? (
      <section className={cn("rounded-xl border p-4 md:p-5", tokens.surface)}>
        <SectionTitle theme={theme} title="Video source" body="Tell the agent where to pull clips from and in what order to try them." />
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <Field label="Video source">
            <select value={form.sourceType} onChange={(e) => setForm((prev: any) => ({ ...prev, sourceType: e.target.value }))} className="input bg-white">
              <option value="saved_playlist">Saved playlist</option>
              <option value="saved_channel">Saved channel</option>
              <option value="saved_tags">Saved tags</option>
              <option value="custom_url">Custom URL</option>
            </select>
          </Field>
          {form.sourceType === "custom_url" ? (
            <Field label="Source URL">
              <input value={form.sourceUrl} onChange={(e) => setForm((prev: any) => ({ ...prev, sourceUrl: e.target.value }))} placeholder="https://www.tiktok.com/@channel or https://www.youtube.com/@channel/shorts" className="input bg-white" />
            </Field>
          ) : form.sourceType === "saved_tags" ? (
            <div className="md:col-span-2 rounded-xl border border-[#1A1A1A]/8 bg-[#F9F8F6] p-3">
              <div className="flex items-center justify-between gap-3">
                <p className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-[#1A1A1A]/40">
                  <Tags className="h-3.5 w-3.5 text-[#f9dc0b]" />
                  Source tags
                </p>
                <span className="rounded-full bg-white px-2 py-1 text-[10px] font-bold text-[#1A1A1A]/45">{selectedSourceTags.length} selected</span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {sourceTagOptions.length ? sourceTagOptions.map((tag) => {
                  const active = selectedSourceTags.some((item: string) => item.toLowerCase() === tag.toLowerCase());
                  return (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => toggleSourceTag(tag)}
                      className={cn("h-9 rounded-full border px-3 text-xs font-black transition", active ? "border-[#f9dc0b] bg-[#f9dc0b] text-[#1A1A1A]" : "border-[#1A1A1A]/10 bg-white text-[#1A1A1A]/65 hover:border-[#f9dc0b]")}
                    >
                      {tag}
                    </button>
                  );
                }) : (
                  <p className="text-sm font-semibold text-[#1A1A1A]/45">Add tags to saved TikTok collection or channel cards first. Auto tags appear after scans.</p>
                )}
              </div>
            </div>
          ) : (
            <Field label="Saved source">
              <select
                value={selectedSourceValue}
                onChange={(e) => {
                  const source = sources.find((item) => item.key === e.target.value);
                  setForm((prev: any) => ({ ...prev, sourceKey: source?.key || e.target.value, sourceUrl: source?.analyzedUrl || prev.sourceUrl }));
                }}
                className="input bg-white"
              >
                {hasUnmatchedSavedSource ? (
                  <option value={selectedSourceValue}>{form.sourceUrl || form.sourceKey} (missing saved source)</option>
                ) : null}
                {sources.map((source) => (
                  <option key={source.key} value={source.key}>{sourceDisplayName(source)}</option>
                ))}
              </select>
            </Field>
          )}
          <Field label="Search depth">
            <input type="number" min={1} max={5000} value={form.settings.searchDepth} onChange={(e) => updateSetting("searchDepth", Number(e.target.value))} className="input bg-white" />
          </Field>
          <Field label="Upload priority">
            <select value={form.settings.sourcePriority || "views"} onChange={(e) => updateSetting("sourcePriority", e.target.value)} className="input bg-white">
              <option value="views">Highest views first</option>
              <option value="newest">Newest videos first</option>
              <option value="oldest">Oldest videos first</option>
            </select>
          </Field>
          <Field label="Movie ID">
            <select value={form.settings.movieIdEnabled === false ? "off" : "on"} onChange={(e) => updateSetting("movieIdEnabled", e.target.value === "on")} className="input bg-white">
              <option value="on">Use Movie ID</option>
              <option value="off">Skip Movie ID</option>
            </select>
          </Field>
          <Field label="Genre focus">
            <input value={form.settings.genreFocus} onChange={(e) => updateSetting("genreFocus", e.target.value)} className="input bg-white" />
          </Field>
        </div>
      </section>
      ) : null}

      {setupSubTab === "schedule" ? (
      <section className={cn("rounded-xl border p-4 md:p-5", tokens.surface)}>
        <SectionTitle theme={theme} title="Posting schedule" body="Decide how many uploads run per day and the exact public release times." />
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <Field label="Posts per day">
            <input type="number" min={1} max={12} value={form.settings.maxPostsPerDay} onChange={(e) => updateSetting("maxPostsPerDay", Number(e.target.value))} className="input bg-white" />
          </Field>
          <ToggleRow
            title="Reduce uploads when the channel underperforms"
            body="When the last week of uploads all stay under 1k views, the agent stretches this schedule to one upload every 2-3 days until a post breaks through. Turn it off to always post at the full schedule above."
            checked={form.settings.performanceCadenceEnabled !== false}
            onChange={(next) => updateSetting("performanceCadenceEnabled", next)}
          />
          <div className="md:col-span-2">
            <div className="rounded-xl border border-[#1A1A1A]/8 bg-[#F9F8F6] p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-widest text-[#1A1A1A]/40">Post times (GMT+3)</p>
                  <p className="mt-1 text-xs font-semibold text-[#1A1A1A]/48">Set the exact public release time. AutoYT uploads each post at a stable, staggered time 90 to 240 minutes earlier.</p>
                </div>
                <button
                  type="button"
                  onClick={addScheduleTime}
                  disabled={scheduleTimes.length >= 12}
                  className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#1A1A1A]/10 bg-white px-3 text-xs font-bold text-[#1A1A1A] shadow-sm transition hover:border-[#1A1A1A]/25 hover:text-[#1A1A1A] disabled:opacity-40"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add time
                </button>
              </div>
              <div className="mt-3 grid gap-2 lg:grid-cols-2">
                {scheduleTimes.map((value, index) => (
                  <div key={`${index}-${value}`} className="grid gap-2 rounded-xl border border-[#1A1A1A]/8 bg-white p-2 shadow-sm sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_40px]">
                    <label className="min-w-0">
                      <span className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/35">Release at</span>
                      <input
                        type="time"
                        value={value}
                        onChange={(event) => setScheduleTime(index, event.target.value)}
                        className="h-10 w-full min-w-0 rounded-lg border border-[#1A1A1A]/10 bg-[#FDFCFA] px-3 text-sm font-bold text-[#1A1A1A] outline-none transition focus:border-[#f9dc0b]/40 focus:ring-2 focus:ring-[#f9dc0b]/10"
                      />
                    </label>
                    <div className="min-w-0">
                      <span className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/35">Upload window</span>
                      <div className="flex h-10 w-full min-w-0 items-center rounded-lg border border-[#1A1A1A]/8 bg-[#FDFCFA] px-3 text-xs font-bold text-[#1A1A1A]/58">
                        Staggered 90-240 min before
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeScheduleTime(index)}
                      disabled={scheduleTimes.length <= 1}
                      className="grid h-10 w-10 shrink-0 place-items-center self-end rounded-lg border border-[#1A1A1A]/8 text-[#1A1A1A]/40 transition hover:border-[#f9dc0b]/35 hover:bg-[#fff9d6] hover:text-[#b69300] disabled:cursor-not-allowed disabled:opacity-30"
                      aria-label="Remove post time"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>
      ) : null}

      {setupSubTab === "learning" ? (
      <section className={cn("rounded-xl border p-4 md:p-5", tokens.surfaceSoft)}>
        <SectionTitle theme={theme} title="Learning controls" body="Set the niche goal the agent optimizes for and how often it checks upload performance." />
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <Field label="Micro-sub-niche goal" wide>
            <textarea value={form.settings.microNicheGoal} onChange={(e) => updateSetting("microNicheGoal", e.target.value)} className="input min-h-24 bg-white py-3 leading-6" />
          </Field>
          <ToggleRow
            title="Adaptive decision strategy"
            body="Move between learning, exploration, exploitation, and recovery using measured outcomes from this channel."
            checked={form.settings.adaptiveStrategyEnabled !== false}
            onChange={(next) => updateSetting("adaptiveStrategyEnabled", next)}
          />
          <ToggleRow
            title="Learn publishing times"
            body="Test small timing variations while exploring, then prefer release windows that repeatedly perform better without rewriting your saved schedule."
            checked={form.settings.adaptiveSchedulingEnabled !== false}
            onChange={(next) => updateSetting("adaptiveSchedulingEnabled", next)}
          />
          <ToggleRow
            title="Learn hooks and formats"
            body="Guide candidate ranking and metadata with the channel's proven hooks, niches, durations, and formats."
            checked={form.settings.adaptiveMetadataEnabled !== false}
            onChange={(next) => updateSetting("adaptiveMetadataEnabled", next)}
          />
          <ToggleRow
            title="Failure-aware recovery"
            body="Retry media, network, and publishing failures while avoiding pointless retries for authentication or configuration problems."
            checked={form.settings.adaptiveRecoveryEnabled !== false}
            onChange={(next) => updateSetting("adaptiveRecoveryEnabled", next)}
          />
          <ToggleRow
            title="Learn which source channels win"
            body="Promote source channels whose uploads perform well, then reuse them when the destination channel is healthy."
            checked={form.settings.dynamicSourceLearning !== false}
            onChange={(next) => updateSetting("dynamicSourceLearning", next)}
          />
          <ToggleRow
            title="Explore channels when performance is weak"
            body="Treat authors inside a collection as separate channels and rotate niche-compatible sources until performance improves."
            checked={form.settings.sourceExplorationEnabled !== false}
            onChange={(next) => updateSetting("sourceExplorationEnabled", next)}
          />
          <Field label="Channels sampled per run">
            <input type="number" min={2} max={12} value={form.settings.sourceExplorationChannels || 6} onChange={(e) => updateSetting("sourceExplorationChannels", Number(e.target.value))} className="input bg-white" />
          </Field>
          <Field label="Explore below average views">
            <input type="number" min={100} max={100000} value={form.settings.sourceUnderperformingViewThreshold || 1000} onChange={(e) => updateSetting("sourceUnderperformingViewThreshold", Number(e.target.value))} className="input bg-white" />
          </Field>
          <Field label="Source niche matching">
            <select value={form.settings.sourceNicheMode || "balanced"} onChange={(e) => updateSetting("sourceNicheMode", e.target.value)} className="input bg-white">
              <option value="balanced">Balanced</option>
              <option value="strict">Strict niche match</option>
              <option value="off">No niche filtering</option>
            </select>
          </Field>
          <div className="space-y-3 rounded-xl border border-[#1A1A1A]/8 bg-white p-4 md:col-span-2">
            <label className="flex items-start gap-3 text-sm font-semibold text-[#1A1A1A]/65">
              <input type="checkbox" checked={form.settings.includeSideChannels} onChange={(e) => updateSetting("includeSideChannels", e.target.checked)} className="mt-1" />
              Let the agent scan related TikTok channels when the saved source runs out.
            </label>
            {(form.settings.sideChannels || [""]).map((value: string, index: number) => (
              <input key={index} value={value} onChange={(e) => setSideChannel(index, e.target.value)} placeholder="Optional side channel URL" className="input bg-white" />
            ))}
            <button type="button" onClick={() => updateSetting("sideChannels", [...(form.settings.sideChannels || []), ""])} className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#1A1A1A]/10 bg-white px-3 text-xs font-bold text-[#1A1A1A] shadow-sm transition hover:border-[#f9dc0b] hover:text-[#8a7500]">
              <Plus className="h-3.5 w-3.5" />
              Add side channel
            </button>
          </div>
          <Field label="Check performance every (hours)">
            <input type="number" min={1} max={24} value={form.settings.performanceCheckHours} onChange={(e) => updateSetting("performanceCheckHours", Number(e.target.value))} className="input bg-white" />
          </Field>
          <Field label="Call it stagnant after (hours)">
            <input type="number" min={3} max={168} value={form.settings.stagnationWindowHours} onChange={(e) => updateSetting("stagnationWindowHours", Number(e.target.value))} className="input bg-white" />
          </Field>
          <Field label="Min view growth between checks (%)">
            <input type="number" min={0} max={100} value={form.settings.minViewDeltaPercent} onChange={(e) => updateSetting("minViewDeltaPercent", Number(e.target.value))} className="input bg-white" />
          </Field>
        </div>
      </section>
      ) : null}

      {setupSubTab === "comments" ? (
      <section className={cn("rounded-xl border p-4 md:p-5", tokens.surface)}>
        <SectionTitle theme={theme} title="Community management" body="Reply to recent comments during performance checks, while keeping movie-name replies as a priority." />
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="flex items-start gap-3 rounded-xl border border-[#1A1A1A]/8 bg-[#F9F8F6] p-4 text-sm font-semibold text-[#1A1A1A]/65">
            <input type="checkbox" checked={form.settings.communityManagementEnabled} onChange={(e) => updateSetting("communityManagementEnabled", e.target.checked)} className="mt-1" />
            <span>Enable community management for this agent.</span>
          </label>
          <label className="flex items-start gap-3 rounded-xl border border-[#1A1A1A]/8 bg-[#F9F8F6] p-4 text-sm font-semibold text-[#1A1A1A]/65">
            <input type="checkbox" checked={form.settings.aiEngagementRepliesEnabled} onChange={(e) => updateSetting("aiEngagementRepliesEnabled", e.target.checked)} className="mt-1" />
            <span>Use AI for engagement replies beyond movie-name questions.</span>
          </label>
          <Field label="Max replies per check">
            <input type="number" min={1} max={25} value={form.settings.maxCommentRepliesPerCheck} onChange={(e) => updateSetting("maxCommentRepliesPerCheck", Number(e.target.value))} className="input bg-white" />
          </Field>
          <Field label="Reply tone">
            <select value={form.settings.commentReplyTone} onChange={(e) => updateSetting("commentReplyTone", e.target.value)} className="input bg-white">
              <option value="warm-curious">Warm and curious</option>
              <option value="hype-short">Short hype replies</option>
              <option value="calm-helpful">Calm and helpful</option>
              <option value="playful-fan">Playful fan energy</option>
              <option value="mystery-hook">Mystery-hook style</option>
            </select>
          </Field>
          <Field label="Reply instructions" wide>
            <textarea value={form.settings.commentReplyInstructions} onChange={(e) => updateSetting("commentReplyInstructions", e.target.value)} className="input min-h-24 bg-white py-3 leading-6" />
          </Field>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <StepTile theme={theme} icon={<Film className="h-4 w-4" />} label="Movie-name replies" body="Questions asking for the title still get the exact movie name first." />
          <StepTile theme={theme} icon={<MessageCircle className="h-4 w-4" />} label="Engagement replies" body="AI replies to useful recent comments with short, natural responses." />
          <StepTile theme={theme} icon={<ShieldCheck className="h-4 w-4" />} label="Safety filter" body="Spam, abusive, illegal-upload, and low-value comments are skipped." />
        </div>
      </section>
      ) : null}

      {setupSubTab === "safety" ? (
      <section className="space-y-4">
      <label className={cn("flex items-start gap-3 rounded-xl border p-4 text-sm font-semibold leading-6", tokens.accentPanel, tokens.textSoft)}>
        <input type="checkbox" checked={form.settings.rightsConfirmed} onChange={(e) => updateSetting("rightsConfirmed", e.target.checked)} className="mt-1" />
        <span><ShieldCheck className="mr-2 inline h-4 w-4 text-[#f9dc0b]" />I will only run this on clips I own, have permission to reuse, or can lawfully transform for my channel.</span>
      </label>
      <div className={cn("rounded-xl border p-4", tokens.surface)}>
        <SectionTitle theme={theme} title="Publishing guardrail" body="Keep the agent paused until a test candidate is clean, correctly identified, and uploaded in the quality you expect." />
      </div>
      </section>
      ) : null}

      <div className={cn("flex flex-wrap items-center justify-between gap-3 border-t pt-4", tokens.divider)}>
        <p className={cn("text-xs font-semibold", tokens.subtle)}>Active agents run from the server scheduler. Test one candidate before leaving it active.</p>
        <div className="flex flex-wrap gap-2">
          {selectedId ? (
            <button type="button" onClick={() => void runAgent(selectedId)} disabled={!!running || saving} className="inline-flex h-10 items-center gap-2 rounded-xl border border-[#1A1A1A]/10 bg-white px-4 text-xs font-bold text-[#1A1A1A] shadow-sm transition hover:border-[#1A1A1A]/25 hover:text-[#1A1A1A] disabled:opacity-50">
              {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              Run next candidate
            </button>
          ) : null}
          <button type="submit" disabled={saving} className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#f9dc0b] px-5 text-xs font-bold text-[#1A1A1A] shadow-sm transition hover:bg-[#1A1A1A] hover:text-white disabled:opacity-50">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            Save agent
          </button>
        </div>
      </div>
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
  reuploading,
  onUploadChanged,
  theme = "light",
}: {
  uploads: AutomationUpload[];
  selectedUpload: AutomationUpload | null;
  selectedUploadId: string;
  onSelect: (id: string) => void;
  onBack: () => void;
  onReupload: (id: string) => Promise<void>;
  reuploading: string;
  onUploadChanged: (upload: AutomationUpload) => void;
  theme?: AgentTheme;
}) {
  if (selectedUploadId && selectedUpload) {
    return <UploadDetail upload={selectedUpload} onBack={onBack} onReupload={onReupload} reuploading={reuploading} onUploadChanged={onUploadChanged} theme={theme} />;
  }

  const tokens = getAgentTheme(theme);
  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <SectionTitle theme={theme} title="Uploaded posts" body="Review each automated YouTube upload, then open a post for Movie ID, performance, and comment automation context." />
        <p className={cn("text-xs font-semibold", tokens.subtle)}>{uploads.length} uploads</p>
      </div>
      <div className={cn("-mx-4 overflow-x-auto rounded-xl border sm:mx-0", tokens.surface)}>
        <table className={cn("min-w-[880px] w-full border-collapse text-left", tokens.isDark ? "bg-[#191C18]" : "bg-white")}>
          <thead className={cn("text-[10px] font-black uppercase tracking-[0.16em]", tokens.surfaceSoft, tokens.subtle)}>
            <tr>
              <th className="px-4 py-3">Video</th>
              <th className="px-4 py-3">Movie</th>
              <th className="px-4 py-3">MSN</th>
              <th className="px-4 py-3 text-right">Views</th>
              <th className="px-4 py-3 text-right">Comments</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Date</th>
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
                className={cn("cursor-pointer transition focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#f9dc0b]", tokens.isDark ? "hover:bg-[#F8F5E8]/6" : "hover:bg-[#1A1A1A]/5")}
              >
                <td className="max-w-[300px] px-4 py-3">
                  <div className="flex items-center gap-3">
                    <span className={cn("grid h-14 w-10 shrink-0 place-items-center overflow-hidden rounded-md", tokens.isDark ? "bg-[#0D0F0D]" : "bg-[#1A1A1A]/8")}>
                      {agentUploadMedia(upload).thumbnailUrl ? (
                        <img src={agentUploadMedia(upload).thumbnailUrl} alt="" loading="lazy" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
                      ) : (
                        <Film className="h-4 w-4 text-[#f9dc0b]" />
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
              </tr>
            ))}
            {!uploads.length ? (
              <tr>
                <td colSpan={7} className={cn("px-4 py-10 text-center text-sm font-semibold", tokens.muted)}>No uploads yet. Run one candidate from Setup or Overview.</td>
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
  reuploading,
  onUploadChanged,
  theme = "light",
}: {
  upload: AutomationUpload;
  onBack: () => void;
  onReupload: (id: string) => Promise<void>;
  reuploading: string;
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
  const publishedLabel = publishedTikTokUrl ? "Open on TikTok" : isZernioPostUrl ? "Open in Zernio" : "Open on YouTube";
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
              <p className="text-[11px] font-black uppercase tracking-[0.16em] text-[#f9dc0b]">Uploaded post</p>
              <h2 className={cn("mt-2 text-lg font-bold leading-tight", tokens.text)}>{currentUpload.title}</h2>
              <p className={cn("mt-3 max-w-3xl text-sm leading-6", tokens.muted)}>{currentUpload.description || "No description stored for this upload."}</p>
            </div>
            <StatusPill status={currentUpload.status} />
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            {publishedUrl ? (
              <a href={publishedUrl} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#1A1A1A] px-4 text-xs font-bold text-white transition hover:opacity-85">
                {publishedLabel === "Open on YouTube" ? <Youtube className="h-4 w-4" /> : <ExternalLink className="h-4 w-4" />}
                {publishedLabel}
              </a>
            ) : null}
            {currentUpload.sourceUrl ? (
              <a href={currentUpload.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center gap-2 rounded-xl border border-[#1A1A1A]/10 bg-white px-4 text-xs font-bold text-[#1A1A1A] transition hover:border-[#1A1A1A]/25 hover:text-[#1A1A1A]">
                <ExternalLink className="h-4 w-4" />
                Source TikTok
              </a>
            ) : null}
            <button type="button" onClick={() => void onReupload(currentUpload.id)} disabled={reuploading === currentUpload.id} className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#f9dc0b] px-4 text-xs font-bold text-[#1A1A1A] transition hover:bg-[#1A1A1A] hover:text-white disabled:opacity-50">
              {reuploading === currentUpload.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Reupload HD test
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
          <SectionTitle theme={theme} title="Manual Movie ID correction" body="Enter the right title and AutoYT will refresh MAL/TMDB data, update the upload record, and make comment replies use the corrected source." />
          {movieResult.sourceVerification?.verified || movieResult.manualCorrection ? (
            <span className="inline-flex w-fit rounded-full bg-[#fff9d6] px-3 py-1 text-[11px] font-black uppercase tracking-widest text-[#6a5b00]">Verified source</span>
          ) : null}
        </div>
        <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_120px_150px_150px]">
          <input
            value={correctionTitle}
            onChange={(event) => setCorrectionTitle(event.target.value)}
            placeholder="Correct title, e.g. Classless Hero"
            className="h-11 rounded-xl border border-[#1A1A1A]/10 bg-[#FDFCFA] px-4 text-sm font-semibold text-[#1A1A1A] outline-none transition focus:border-[#f9dc0b]"
          />
          <input
            value={correctionYear}
            onChange={(event) => setCorrectionYear(event.target.value)}
            placeholder="Year"
            className="h-11 rounded-xl border border-[#1A1A1A]/10 bg-[#FDFCFA] px-4 text-sm font-semibold text-[#1A1A1A] outline-none transition focus:border-[#f9dc0b]"
          />
          <select
            value={correctionMediaType}
            onChange={(event) => setCorrectionMediaType(event.target.value)}
            className="h-11 rounded-xl border border-[#1A1A1A]/10 bg-[#FDFCFA] px-4 text-sm font-semibold text-[#1A1A1A] outline-none transition focus:border-[#f9dc0b]"
          >
            <option value="auto">Auto</option>
            <option value="anime">Anime</option>
            <option value="manga">Manga / manhwa</option>
            <option value="movie">Movie</option>
            <option value="tv">TV show</option>
          </select>
          <button type="submit" disabled={correcting || !correctionTitle.trim()} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[#f9dc0b] px-4 text-xs font-black text-[#1A1A1A] transition hover:bg-[#1A1A1A] hover:text-white disabled:opacity-50">
            {correcting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
            Correct record
          </button>
        </div>
        {correctionError ? <p className="mt-3 rounded-xl border border-[#f9dc0b]/40 bg-[#fff9d6] px-4 py-3 text-sm font-semibold text-[#6a5b00]">{correctionError}</p> : null}
      </form>

      <div className="grid gap-5 xl:grid-cols-2">
        <section className={cn("rounded-xl border p-5", tokens.surface)}>
          <SectionTitle theme={theme} title="Performance" body="Public stats and YouTube Analytics totals captured by the scheduler." />
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <MiniStat theme={theme} label="Watch minutes" value={compact(totals.estimatedMinutesWatched)} />
            <MiniStat theme={theme} label="Avg duration" value={`${compact(totals.averageViewDuration)}s`} />
            <MiniStat theme={theme} label="Subscribers" value={compact(totals.subscribersGained)} />
          </div>
          <div className="mt-5 rounded-xl border border-[#1A1A1A]/8">
            <div className="grid grid-cols-4 bg-[#F9F8F6] px-3 py-2 text-[11px] font-bold uppercase tracking-widest text-[#1A1A1A]/35">
              <span>Day</span>
              <span className="text-right">Views</span>
              <span className="text-right">Likes</span>
              <span className="text-right">Comments</span>
            </div>
            <div className="divide-y divide-[#1A1A1A]/8">
              {daily.slice(-7).map((day: Record<string, number | string>, index: number) => (
                <div key={`${day.day}-${index}`} className="grid grid-cols-4 px-3 py-2 text-xs font-semibold text-[#1A1A1A]/60">
                  <span>{String(day.day || "Day")}</span>
                  <span className="text-right">{compact(day.views)}</span>
                  <span className="text-right">{compact(day.likes)}</span>
                  <span className="text-right">{compact(day.comments)}</span>
                </div>
              ))}
              {!daily.length ? <p className="px-3 py-4 text-sm font-semibold text-[#1A1A1A]/45">Analytics will appear after the next performance check.</p> : null}
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
                    <summary className={cn("inline-flex cursor-pointer select-none list-none items-center gap-1 text-xs font-bold transition hover:text-[#b89f00] [&::-webkit-details-marker]:hidden", tokens.subtle)}>
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

const AGENT_CHAT_SUGGESTIONS = [
  { label: "Performance report", prompt: "Give me a performance report with a table", icon: BarChart3 },
  { label: "Channel competitors", prompt: "Show my channel competitors", icon: Eye },
  { label: "Breakout videos", prompt: "Show recent competitor videos", icon: TrendingUp },
  { label: "Optimize strategy", prompt: "Review this agent and recommend the single highest-impact optimization", icon: Sparkles },
  { label: "Update schedule", prompt: "Review my publishing schedule and suggest a better cadence based on current performance", icon: Clock3 },
  { label: "Run candidate", prompt: "Run candidate now", icon: Play },
];

type AgentChatAction = {
  type: "navigate" | "internal_tool" | "agent_tab" | "run_candidate" | "refresh_agent";
  label: string;
  payload?: { view?: any; tool?: any; tab?: any; section?: any; url?: string; query?: string };
};

type AgentChatCard = {
  label: string;
  value: string;
  tone?: "good" | "warn" | "neutral";
};

type AgentChatPresentation = {
  mode?: "report";
  title?: string;
  summary?: string;
  html?: string;
  cards?: AgentChatCard[];
};

type AgentChatMessage = {
  role: "user" | "assistant";
  content: string;
  timestamp?: number;
  format?: "text" | "report";
  html?: string;
  cards?: AgentChatCard[];
  presentation?: AgentChatPresentation | null;
  actions?: AgentChatAction[];
  blocks?: AgentChatBlock[];
  applied?: string[];
};

type AgentChatConversation = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: AgentChatMessage[];
};

type AgentSpeechRecognitionAlternative = {
  transcript: string;
};

type AgentSpeechRecognitionResult = {
  isFinal: boolean;
  [index: number]: AgentSpeechRecognitionAlternative;
};

type AgentSpeechRecognitionEvent = Event & {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: AgentSpeechRecognitionResult;
  };
};

type AgentSpeechRecognitionErrorEvent = Event & {
  error?: string;
};

type AgentSpeechRecognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: AgentSpeechRecognitionEvent) => void) | null;
  onerror: ((event: AgentSpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type AgentSpeechRecognitionConstructor = new () => AgentSpeechRecognition;

function getAgentSpeechRecognitionConstructor(): AgentSpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const browserWindow = window as Window & {
    SpeechRecognition?: AgentSpeechRecognitionConstructor;
    webkitSpeechRecognition?: AgentSpeechRecognitionConstructor;
  };
  return browserWindow.SpeechRecognition || browserWindow.webkitSpeechRecognition || null;
}

const AGENT_VOICE_WAVE_IDLE_LEVELS = [
  0.24, 0.39, 0.56, 0.34, 0.7, 0.48, 0.3, 0.62, 0.82, 0.46, 0.29, 0.58, 0.75,
  0.42, 0.25, 0.53, 0.68, 0.36, 0.6, 0.78, 0.44, 0.27, 0.5, 0.7, 0.39, 0.22,
];

function agentVoiceWaveLevels(data: Uint8Array | null, timestamp: number) {
  if (!data) {
    return AGENT_VOICE_WAVE_IDLE_LEVELS.map((level, index) => Math.max(0.16, Math.min(0.92, level + Math.sin(timestamp / 190 + index * 0.75) * 0.16)));
  }
  const chunk = Math.max(1, Math.floor(data.length / AGENT_VOICE_WAVE_IDLE_LEVELS.length));
  return AGENT_VOICE_WAVE_IDLE_LEVELS.map((idleLevel, index) => {
    const start = index * chunk;
    const end = Math.min(data.length, start + chunk);
    let total = 0;
    for (let sample = start; sample < end; sample += 1) total += Math.abs(data[sample] - 128) / 128;
    const amplitude = total / Math.max(1, end - start);
    return Math.max(0.13, Math.min(1, 0.12 + amplitude * 3.2 + idleLevel * 0.18));
  });
}

function AgentVoiceWaveform({ levels, listening, settled, isDark }: { levels: number[]; listening: boolean; settled: boolean; isDark: boolean }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "agent-voice-wave flex h-9 w-full items-center justify-center gap-[3px] overflow-hidden rounded-lg px-2.5",
        listening
          ? isDark ? "bg-[#f9dc0b]/12" : "bg-[#fff6b8]"
          : isDark ? "bg-[#F8F5E8]/6" : "bg-[#1A1A1A]/[0.035]",
        settled && "agent-voice-wave-settled"
      )}
    >
      {levels.map((level, index) => (
        <span
          key={index}
          className={cn("agent-voice-wave-bar block w-[3px] rounded-full", listening ? "bg-[#f0cc00]" : isDark ? "bg-[#F8F5E8]/50" : "bg-[#b89f00]/65")}
          style={{ height: `${Math.round(16 + level * 84)}%`, animationDelay: `${index * 18}ms` }}
        />
      ))}
    </div>
  );
}

const AGENT_CHAT_LEGACY_HISTORY_PREFIX = "autoyt-agent-chat:";
const AGENT_CHAT_CONVERSATIONS_PREFIX = "autoyt-agent-chats:";
const AGENT_CHAT_MAX_CONVERSATIONS = 30;
const AGENT_CHAT_MAX_MESSAGES = 40;

function agentChatConversationId(): string {
  return `chat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function sanitizeAgentChatMessages(input: unknown): AgentChatMessage[] {
  return (Array.isArray(input) ? input : [])
    .filter((message) => message && (message.role === "user" || message.role === "assistant") && typeof message.content === "string")
    .slice(-AGENT_CHAT_MAX_MESSAGES);
}

function agentChatConversationTitle(messages: AgentChatMessage[]): string {
  const firstUser = messages.find((message) => message.role === "user" && message.content.trim());
  if (!firstUser) return "New chat";
  const clean = firstUser.content.trim().replace(/\s+/g, " ");
  return clean.length > 60 ? `${clean.slice(0, 57)}…` : clean;
}

function agentChatTimeLabel(timestamp: number): string {
  const minutes = Math.floor((Date.now() - timestamp) / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

function writeAgentChatConversations(agentId: string, conversations: AgentChatConversation[]) {
  if (!agentId || typeof window === "undefined") return;
  const compact = conversations
    .filter((conversation) => conversation.messages.length)
    .slice(0, AGENT_CHAT_MAX_CONVERSATIONS)
    .map((conversation) => ({ ...conversation, messages: conversation.messages.slice(-AGENT_CHAT_MAX_MESSAGES) }));
  window.localStorage.setItem(`${AGENT_CHAT_CONVERSATIONS_PREFIX}${agentId}`, JSON.stringify(compact));
}

function readAgentChatConversations(agentId: string): AgentChatConversation[] {
  if (!agentId || typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(`${AGENT_CHAT_CONVERSATIONS_PREFIX}${agentId}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((conversation) => conversation && typeof conversation.id === "string" && Array.isArray(conversation.messages))
        .map((conversation) => {
          const messages = sanitizeAgentChatMessages(conversation.messages);
          return {
            id: conversation.id,
            title: typeof conversation.title === "string" && conversation.title.trim() ? conversation.title : agentChatConversationTitle(messages),
            createdAt: Number(conversation.createdAt) || Date.now(),
            updatedAt: Number(conversation.updatedAt) || Number(conversation.createdAt) || Date.now(),
            messages,
          };
        })
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, AGENT_CHAT_MAX_CONVERSATIONS);
    }
  } catch {
    return [];
  }
  // Migrate the legacy single-thread history into the first conversation.
  try {
    const legacyRaw = window.localStorage.getItem(`${AGENT_CHAT_LEGACY_HISTORY_PREFIX}${agentId}`);
    if (!legacyRaw) return [];
    window.localStorage.removeItem(`${AGENT_CHAT_LEGACY_HISTORY_PREFIX}${agentId}`);
    const messages = sanitizeAgentChatMessages(JSON.parse(legacyRaw));
    if (!messages.length) return [];
    const now = Date.now();
    const conversation: AgentChatConversation = {
      id: agentChatConversationId(),
      title: agentChatConversationTitle(messages),
      createdAt: now,
      updatedAt: messages[messages.length - 1]?.timestamp || now,
      messages,
    };
    writeAgentChatConversations(agentId, [conversation]);
    return [conversation];
  } catch {
    return [];
  }
}

function buildAgentChatMemory(agentId: string, excludeConversationId: string): string[] {
  return readAgentChatConversations(agentId)
    .filter((conversation) => conversation.id !== excludeConversationId && conversation.messages.length)
    .slice(0, 5)
    .map((conversation) => {
      const lastUser = [...conversation.messages].reverse().find((message) => message.role === "user" && message.content.trim());
      const lastAssistant = [...conversation.messages].reverse().find((message) => message.role === "assistant" && message.content.trim());
      const parts = [`Conversation "${conversation.title}" (${agentChatTimeLabel(conversation.updatedAt)})`];
      if (lastUser) parts.push(`user asked: ${lastUser.content.trim().replace(/\s+/g, " ").slice(0, 140)}`);
      if (lastAssistant) parts.push(`assistant replied: ${lastAssistant.content.trim().replace(/\s+/g, " ").slice(0, 160)}`);
      return parts.join(" — ");
    });
}

function AgentChatHistorySidebar({ agent, conversations, activeId, theme, mobileOpen, desktopOpen, onClose, onToggleDesktop, onSelect, onNewChat, onDelete }: {
  agent: AutomationAgent | null;
  conversations: AgentChatConversation[];
  activeId: string;
  theme: AgentTheme;
  mobileOpen: boolean;
  desktopOpen: boolean;
  onClose: () => void;
  onToggleDesktop: () => void;
  onSelect: (conversationId: string) => void;
  onNewChat: () => void;
  onDelete: (conversationId: string) => void;
}) {
  const isDark = theme === "dark";
  const [search, setSearch] = useState("");
  const query = search.trim().toLowerCase();
  const visible = conversations.filter((conversation) => conversation.messages.length && (!query
    || conversation.title.toLowerCase().includes(query)
    || conversation.messages.some((message) => message.content.toLowerCase().includes(query))));

  const content = (
    <aside className={cn("flex h-full w-[16rem] shrink-0 flex-col border-r", isDark ? "border-[#F8F5E8]/10 bg-[#151916]" : "border-[#dadada] bg-white")}>
      <div className={cn("flex h-12 items-center justify-between border-b px-3", isDark ? "border-[#F8F5E8]/10" : "border-[#dadada]")}>
        <div className="min-w-0">
          <p className={cn("text-sm font-black", isDark ? "text-[#F8F5E8]" : "text-[#1A1A1A]")}>Chats</p>
          <p className={cn("truncate text-[11px] font-semibold", isDark ? "text-[#F8F5E8]/42" : "text-[#1A1A1A]/42")}>{agent?.name || "No agent selected"}</p>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => { onNewChat(); onClose(); }} disabled={!agent} className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-lg transition disabled:opacity-30", isDark ? "text-[#F8F5E8]/55 hover:bg-[#F8F5E8]/8 hover:text-[#F8F5E8]" : "text-[#1A1A1A]/45 hover:bg-[#1A1A1A]/6 hover:text-[#1A1A1A]")} aria-label="Start a new chat" title="Start a new chat">
            <Plus className="h-4 w-4" />
          </button>
          <button type="button" onClick={onToggleDesktop} className={cn("hidden h-8 w-8 shrink-0 place-items-center rounded-lg transition lg:grid", isDark ? "text-[#F8F5E8]/55 hover:bg-[#F8F5E8]/8 hover:text-[#F8F5E8]" : "text-[#1A1A1A]/45 hover:bg-[#1A1A1A]/6 hover:text-[#1A1A1A]")} aria-label="Collapse chat history" title="Collapse chat history">
            <PanelLeftClose className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className={cn("border-b p-2", isDark ? "border-[#F8F5E8]/10" : "border-[#dadada]")}>
        <label className={cn("flex h-9 items-center gap-2 rounded-lg border px-2.5", isDark ? "border-[#F8F5E8]/10 bg-[#F8F5E8]/5 text-[#F8F5E8]/50" : "border-[#1A1A1A]/8 bg-[#F7F7F5] text-[#1A1A1A]/45")}>
          <Search className="h-3.5 w-3.5 shrink-0" />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search chats" className={cn("min-w-0 flex-1 bg-transparent text-xs font-semibold outline-none", isDark ? "text-[#F8F5E8] placeholder:text-[#F8F5E8]/30" : "text-[#1A1A1A] placeholder:text-[#1A1A1A]/35")} />
          {search ? <button type="button" onClick={() => setSearch("")} className="grid h-6 w-6 place-items-center" aria-label="Clear chat search"><X className="h-3 w-3" /></button> : null}
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {visible.length === 0 ? (
          <p className={cn("px-3 py-4 text-xs font-semibold leading-5", isDark ? "text-[#F8F5E8]/42" : "text-[#1A1A1A]/42")}>{query ? "No matching chats." : "No conversations yet."}</p>
        ) : visible.map((conversation) => {
          const active = conversation.id === activeId;
          const lastMessage = conversation.messages[conversation.messages.length - 1];
          return (
            <div key={conversation.id} className="group relative mb-1">
              <button
                type="button"
                onClick={() => { onSelect(conversation.id); onClose(); }}
                className={cn(
                  "block w-full rounded-lg px-3 py-2.5 pr-9 text-left transition",
                  active ? "bg-[#f9dc0b] text-[#1A1A1A]" : isDark ? "text-[#F8F5E8] hover:bg-[#F8F5E8]/7" : "text-[#1A1A1A] hover:bg-[#1A1A1A]/5",
                )}
              >
                <span className="block truncate text-xs font-black">{conversation.title}</span>
                <span className={cn("mt-0.5 block truncate text-[11px] font-medium", active ? "text-[#1A1A1A]/60" : isDark ? "text-[#F8F5E8]/42" : "text-[#1A1A1A]/42")}>
                  {agentChatTimeLabel(conversation.updatedAt)} · {lastMessage?.content || "No messages"}
                </span>
              </button>
              <button
                type="button"
                onClick={() => onDelete(conversation.id)}
                className={cn(
                  "absolute right-1.5 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-md opacity-0 transition focus-visible:opacity-100 group-hover:opacity-100",
                  active ? "text-[#1A1A1A]/55 hover:bg-[#1A1A1A]/10 hover:text-[#1A1A1A]" : isDark ? "text-[#F8F5E8]/45 hover:bg-[#F8F5E8]/10 hover:text-[#F8F5E8]" : "text-[#1A1A1A]/40 hover:bg-[#1A1A1A]/8 hover:text-[#1A1A1A]",
                )}
                aria-label={`Delete "${conversation.title}"`}
                title="Delete conversation"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </aside>
  );

  return (
    <>
      {desktopOpen ? <div className="hidden h-full lg:block">{content}</div> : null}
      {mobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button type="button" className="absolute inset-0 bg-black/55" onClick={onClose} aria-label="Close chat history" />
          <div className="relative h-full w-[min(17rem,86vw)] shadow-2xl">{content}</div>
        </div>
      ) : null}
    </>
  );
}

function sanitizeAgentChatHtml(input = ""): string {
  if (typeof window === "undefined" || !input.trim()) return "";
  const template = document.createElement("template");
  template.innerHTML = input;
  const allowedTags = new Set(["SECTION", "H2", "H3", "P", "UL", "OL", "LI", "TABLE", "THEAD", "TBODY", "TR", "TH", "TD", "STRONG", "EM", "CODE", "SPAN", "DIV", "ARTICLE"]);
  const allowedClasses = new Set(["agent-report", "metric-grid"]);
  const walk = (node: Node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.COMMENT_NODE) {
        child.remove();
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) {
        continue;
      }
      const element = child as HTMLElement;
      if (!allowedTags.has(element.tagName)) {
        element.replaceWith(document.createTextNode(element.textContent || ""));
        continue;
      }
      for (const attr of Array.from(element.attributes)) {
        if (attr.name === "class") {
          const safeClasses = attr.value.split(/\s+/).filter((value) => allowedClasses.has(value));
          if (safeClasses.length) element.setAttribute("class", safeClasses.join(" "));
          else element.removeAttribute("class");
        } else {
          element.removeAttribute(attr.name);
        }
      }
      walk(element);
    }
  };
  walk(template.content);
  return template.innerHTML;
}

function AgentChatRichHtml({ html, theme }: { html: string; theme: AgentTheme }) {
  const safeHtml = useMemo(() => sanitizeAgentChatHtml(html), [html]);
  if (!safeHtml) return null;
  return (
    <div
      className={cn("agent-chat-canvas mt-4 rounded-lg border p-4 md:p-5", theme === "dark" ? "border-[#F8F5E8]/12 bg-[#0F130F]" : "border-[#1A1A1A]/10 bg-[#FCFBF5]")}
      dangerouslySetInnerHTML={{ __html: safeHtml }}
    />
  );
}

function AgentChatCards({ cards, theme }: { cards?: AgentChatCard[]; theme: AgentTheme }) {
  if (!cards?.length) return null;
  return (
    <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
      {cards.map((card) => (
        <div
          key={`${card.label}-${card.value}`}
          className={cn(
            "rounded-lg border px-3 py-2.5",
            theme === "dark" ? "border-[#F8F5E8]/10 bg-[#F8F5E8]/5" : "border-[#1A1A1A]/8 bg-white",
            card.tone === "warn" && "border-[#f9dc0b]/45 bg-[#f9dc0b]/10",
          )}
        >
          <p className={cn("text-[10px] font-black uppercase tracking-[0.14em]", theme === "dark" ? "text-[#F8F5E8]/42" : "text-[#1A1A1A]/42")}>{card.label}</p>
          <p className={cn("mt-1 text-xl font-black tabular-nums", theme === "dark" ? "text-[#F8F5E8]" : "text-[#1A1A1A]")}>{card.value}</p>
        </div>
      ))}
    </div>
  );
}

function AgentChatWorkspace({ agent, theme, historyOpen, onOpenHistory, onCloseHistory, onAgentUpdated, onSetActiveTab, onRunAgent }: {
  agent: AutomationAgent | null;
  theme: AgentTheme;
  historyOpen: boolean;
  onOpenHistory: () => void;
  onCloseHistory: () => void;
  onAgentUpdated: () => void;
  onSetActiveTab: (tab: AutomationTab) => void;
  onRunAgent: (id: string, options?: AgentRunOptions) => Promise<void>;
}) {
  const agentId = agent?.id || "";
  const [chatState, setChatState] = useState<{ conversations: AgentChatConversation[]; activeId: string }>(() => {
    const conversations = readAgentChatConversations(agentId);
    return { conversations, activeId: conversations[0]?.id || "" };
  });
  const [desktopHistoryOpen, setDesktopHistoryOpen] = useState(true);

  useEffect(() => {
    const conversations = readAgentChatConversations(agentId);
    setChatState({ conversations, activeId: conversations[0]?.id || "" });
  }, [agentId]);

  const activeConversation = chatState.conversations.find((conversation) => conversation.id === chatState.activeId) || null;

  function ensureActiveConversation(): string {
    if (activeConversation) return activeConversation.id;
    const now = Date.now();
    const conversation: AgentChatConversation = { id: agentChatConversationId(), title: "New chat", createdAt: now, updatedAt: now, messages: [] };
    setChatState((prev) => ({ conversations: [conversation, ...prev.conversations], activeId: conversation.id }));
    return conversation.id;
  }

  function updateConversationMessages(conversationId: string, updater: (prev: AgentChatMessage[]) => AgentChatMessage[]) {
    setChatState((prev) => {
      const current = prev.conversations.find((conversation) => conversation.id === conversationId)
        || { id: conversationId, title: "New chat", createdAt: Date.now(), updatedAt: Date.now(), messages: [] };
      const messages = updater(current.messages).slice(-AGENT_CHAT_MAX_MESSAGES);
      const next: AgentChatConversation = {
        ...current,
        messages,
        updatedAt: Date.now(),
        title: current.title === "New chat" ? agentChatConversationTitle(messages) : current.title,
      };
      const conversations = [next, ...prev.conversations.filter((conversation) => conversation.id !== conversationId)];
      writeAgentChatConversations(agentId, conversations);
      return { conversations, activeId: prev.activeId };
    });
  }

  function deleteConversation(conversationId: string) {
    setChatState((prev) => {
      const conversations = prev.conversations.filter((conversation) => conversation.id !== conversationId);
      writeAgentChatConversations(agentId, conversations);
      return { conversations, activeId: prev.activeId === conversationId ? "" : prev.activeId };
    });
  }

  function startNewChat() {
    setChatState((prev) => ({ ...prev, activeId: "" }));
  }

  function toggleHistory() {
    if (typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches) {
      setDesktopHistoryOpen((open) => !open);
    } else {
      onOpenHistory();
    }
  }

  return (
    <>
      <AgentChatHistorySidebar
        agent={agent}
        conversations={chatState.conversations}
        activeId={chatState.activeId}
        theme={theme}
        mobileOpen={historyOpen}
        desktopOpen={desktopHistoryOpen}
        onClose={onCloseHistory}
        onToggleDesktop={() => setDesktopHistoryOpen(false)}
        onSelect={(conversationId) => setChatState((prev) => ({ ...prev, activeId: conversationId }))}
        onNewChat={startNewChat}
        onDelete={deleteConversation}
      />
      <div className="min-w-0 flex-1">
        <AgentChatPanel
          key={agentId || "draft"}
          agent={agent}
          theme={theme}
          conversationId={chatState.activeId}
          messages={activeConversation?.messages || []}
          historyVisible={desktopHistoryOpen}
          onToggleHistory={toggleHistory}
          onNewChat={startNewChat}
          onEnsureConversation={ensureActiveConversation}
          onUpdateMessages={updateConversationMessages}
          onAgentUpdated={onAgentUpdated}
          onSetActiveTab={onSetActiveTab}
          onRunAgent={onRunAgent}
        />
      </div>
    </>
  );
}

function AgentChatPanel({ agent, theme, conversationId, messages, historyVisible, onToggleHistory, onNewChat, onEnsureConversation, onUpdateMessages, onAgentUpdated, onSetActiveTab, onRunAgent }: {
  agent: AutomationAgent | null;
  theme: AgentTheme;
  conversationId: string;
  messages: AgentChatMessage[];
  historyVisible: boolean;
  onToggleHistory: () => void;
  onNewChat: () => void;
  onEnsureConversation: () => string;
  onUpdateMessages: (conversationId: string, updater: (prev: AgentChatMessage[]) => AgentChatMessage[]) => void;
  onAgentUpdated: () => void;
  onSetActiveTab: (tab: AutomationTab) => void;
  onRunAgent: (id: string, options?: AgentRunOptions) => Promise<void>;
}) {
  const tokens = getAgentTheme(theme);
  const isDark = tokens.isDark;
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [progressText, setProgressText] = useState("");
  const [actionBusy, setActionBusy] = useState("");
  const [chatError, setChatError] = useState("");
  const [failedText, setFailedText] = useState("");
  const [copiedMessage, setCopiedMessage] = useState(-1);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [voiceListening, setVoiceListening] = useState(false);
  const [voiceInterim, setVoiceInterim] = useState("");
  const [voiceWaveVisible, setVoiceWaveVisible] = useState(false);
  const [voiceWaveSettled, setVoiceWaveSettled] = useState(false);
  const [voiceWaveLevels, setVoiceWaveLevels] = useState<number[]>(AGENT_VOICE_WAVE_IDLE_LEVELS);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const createdConversationRef = useRef("");
  const requestAbortRef = useRef<AbortController | null>(null);
  const nearBottomRef = useRef(true);
  const recognitionRef = useRef<AgentSpeechRecognition | null>(null);
  const voiceBaseRef = useRef("");
  const voiceTranscriptRef = useRef("");
  const voiceAudioContextRef = useRef<AudioContext | null>(null);
  const voiceAudioSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const voiceAudioStreamRef = useRef<MediaStream | null>(null);
  const voiceAudioAnalyserRef = useRef<AnalyserNode | null>(null);
  const voiceWaveFrameRef = useRef<number | null>(null);
  const voiceWaveLastUpdateRef = useRef(0);
  const voiceWaveSessionRef = useRef(0);

  useEffect(() => {
    if (!nearBottomRef.current) return;
    const frame = requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    });
    return () => cancelAnimationFrame(frame);
  }, [messages.length, busy, progressText]);

  useEffect(() => {
    // Skip the reset when the id change is our own draft conversation being created mid-send.
    if (conversationId && conversationId === createdConversationRef.current) return;
    createdConversationRef.current = "";
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    if (recognition) {
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      try {
        recognition.abort();
      } catch {
        // The browser can already have disposed the recognition instance.
      }
    }
    voiceBaseRef.current = "";
    voiceTranscriptRef.current = "";
    voiceWaveSessionRef.current += 1;
    if (voiceWaveFrameRef.current !== null) cancelAnimationFrame(voiceWaveFrameRef.current);
    voiceWaveFrameRef.current = null;
    voiceAudioSourceRef.current?.disconnect();
    voiceAudioSourceRef.current = null;
    voiceAudioStreamRef.current?.getTracks().forEach((track) => track.stop());
    voiceAudioStreamRef.current = null;
    const voiceAudioContext = voiceAudioContextRef.current;
    voiceAudioContextRef.current = null;
    voiceAudioAnalyserRef.current = null;
    void voiceAudioContext?.close().catch(() => undefined);
    setVoiceListening(false);
    setVoiceInterim("");
    setVoiceWaveVisible(false);
    setVoiceWaveSettled(false);
    setVoiceWaveLevels(AGENT_VOICE_WAVE_IDLE_LEVELS);
    setChatError("");
    setFailedText("");
    setInput("");
    nearBottomRef.current = true;
    setShowScrollButton(false);
  }, [agent?.id, conversationId]);

  useEffect(() => {
    setVoiceSupported(Boolean(getAgentSpeechRecognitionConstructor()));
  }, []);

  useEffect(() => () => {
    requestAbortRef.current?.abort();
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    if (recognition) {
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      try {
        recognition.abort();
      } catch {
        // The browser can already have disposed the recognition instance.
      }
    }
    voiceWaveSessionRef.current += 1;
    if (voiceWaveFrameRef.current !== null) cancelAnimationFrame(voiceWaveFrameRef.current);
    voiceWaveFrameRef.current = null;
    voiceAudioSourceRef.current?.disconnect();
    voiceAudioSourceRef.current = null;
    voiceAudioStreamRef.current?.getTracks().forEach((track) => track.stop());
    voiceAudioStreamRef.current = null;
    const voiceAudioContext = voiceAudioContextRef.current;
    voiceAudioContextRef.current = null;
    voiceAudioAnalyserRef.current = null;
    void voiceAudioContext?.close().catch(() => undefined);
  }, []);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [input]);

  function progressMessagesFor(content: string) {
    const text = content.toLowerCase();
    if (/\b(movie\s*id|identify|rescan|movie name|anime name)\b/.test(text)) {
      return ["Preparing Movie ID internally", "Downloading and reading the clip", "Cross-checking title evidence"];
    }
    if (/\b(youtube radar|radar|competitor|outlier|keyword)\b/.test(text)) {
      return ["Running YouTube Radar inside chat", "Checking recent competitor videos", "Formatting the research table"];
    }
    if (/\b(tiktok|saved collection|collection|source clip|source video)\b/.test(text)) {
      return ["Scanning TikTok source internally", "Reading source clips and metrics", "Building the clip summary"];
    }
    if (/\b(niche library|niche map|micro niche|genre library)\b/.test(text)) {
      return ["Reading Niche Library", "Grouping niche signals", "Preparing the snapshot"];
    }
    if (/\b(feed|insight|channel|upload|automation|compile|rewriter|tts|text to speech)\b/.test(text)) {
      return ["Reading agent data", "Checking connected AutoYT modules", "Preparing the report"];
    }
    return ["Reading agent state", "Checking live settings and performance", "Preparing the response"];
  }

  function clearVoiceWaveform(clearVisual = false) {
    voiceWaveSessionRef.current += 1;
    if (voiceWaveFrameRef.current !== null) cancelAnimationFrame(voiceWaveFrameRef.current);
    voiceWaveFrameRef.current = null;
    voiceWaveLastUpdateRef.current = 0;
    voiceAudioSourceRef.current?.disconnect();
    voiceAudioSourceRef.current = null;
    voiceAudioStreamRef.current?.getTracks().forEach((track) => track.stop());
    voiceAudioStreamRef.current = null;
    const voiceAudioContext = voiceAudioContextRef.current;
    voiceAudioContextRef.current = null;
    voiceAudioAnalyserRef.current = null;
    void voiceAudioContext?.close().catch(() => undefined);
    if (clearVisual) {
      setVoiceWaveVisible(false);
      setVoiceWaveSettled(false);
      setVoiceWaveLevels(AGENT_VOICE_WAVE_IDLE_LEVELS);
    } else {
      setVoiceWaveSettled(true);
    }
  }

  function startVoiceWaveform() {
    const session = voiceWaveSessionRef.current + 1;
    voiceWaveSessionRef.current = session;
    setVoiceWaveVisible(true);
    setVoiceWaveSettled(false);
    setVoiceWaveLevels(AGENT_VOICE_WAVE_IDLE_LEVELS);

    const animate = (timestamp: number) => {
      if (voiceWaveSessionRef.current !== session) return;
      if (timestamp - voiceWaveLastUpdateRef.current >= 42) {
        const analyser = voiceAudioAnalyserRef.current;
        let data: Uint8Array | null = null;
        if (analyser) {
          data = new Uint8Array(analyser.fftSize);
          analyser.getByteTimeDomainData(data);
        }
        setVoiceWaveLevels(agentVoiceWaveLevels(data, timestamp));
        voiceWaveLastUpdateRef.current = timestamp;
      }
      voiceWaveFrameRef.current = requestAnimationFrame(animate);
    };
    voiceWaveFrameRef.current = requestAnimationFrame(animate);

    if (!navigator.mediaDevices?.getUserMedia || typeof AudioContext === "undefined") return;
    void navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    }).then(async (stream) => {
      if (voiceWaveSessionRef.current !== session) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const context = new AudioContext();
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.78;
      const source = context.createMediaStreamSource(stream);
      source.connect(analyser);
      voiceAudioContextRef.current = context;
      voiceAudioSourceRef.current = source;
      voiceAudioStreamRef.current = stream;
      voiceAudioAnalyserRef.current = analyser;
      try {
        await context.resume();
      } catch {
        // The analyser can still render its restrained fallback motion.
      }
    }).catch(() => {
      // Speech recognition can still proceed when the analyser stream is unavailable.
    });
  }

  function stopVoiceInput(clearWaveform = false) {
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    setVoiceListening(false);
    setVoiceInterim("");
    clearVoiceWaveform(clearWaveform);
    if (!recognition) return;
    recognition.onresult = null;
    recognition.onerror = null;
    recognition.onend = null;
    try {
      recognition.stop();
    } catch {
      // The browser may have stopped recognition between the click and this call.
    }
  }

  function toggleVoiceInput() {
    if (voiceListening) {
      stopVoiceInput();
      return;
    }
    const SpeechRecognition = getAgentSpeechRecognitionConstructor();
    if (!SpeechRecognition) {
      setChatError("Voice input is not available in this browser.");
      return;
    }

    const recognition = new SpeechRecognition();
    clearVoiceWaveform(true);
    voiceBaseRef.current = input.trim();
    voiceTranscriptRef.current = "";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = typeof navigator === "undefined" ? "en-US" : navigator.language || "en-US";
    recognition.onresult = (event) => {
      let finalText = "";
      let interimText = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const transcript = result?.[0]?.transcript?.trim() || "";
        if (result?.isFinal) finalText += `${finalText ? " " : ""}${transcript}`;
        else interimText += `${interimText ? " " : ""}${transcript}`;
      }
      if (finalText) {
        voiceTranscriptRef.current = [voiceTranscriptRef.current, finalText].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
      }
      const draft = [voiceBaseRef.current, voiceTranscriptRef.current, interimText]
        .filter(Boolean)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 2000);
      setVoiceInterim(interimText);
      setInput(draft);
    };
    recognition.onerror = (event) => {
      if (recognitionRef.current !== recognition) return;
      recognitionRef.current = null;
      setVoiceListening(false);
      setVoiceInterim("");
      clearVoiceWaveform(event.error === "aborted");
      if (event.error === "aborted") return;
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        setChatError("Microphone access was blocked.");
      } else if (event.error === "no-speech") {
        setChatError("No speech was detected.");
      } else {
        setChatError("Voice input stopped unexpectedly.");
      }
      textareaRef.current?.focus();
    };
    recognition.onend = () => {
      if (recognitionRef.current !== recognition) return;
      recognitionRef.current = null;
      setVoiceListening(false);
      setVoiceInterim("");
      clearVoiceWaveform();
      textareaRef.current?.focus();
    };
    recognitionRef.current = recognition;
    setVoiceListening(true);
    setVoiceInterim("");
    setChatError("");
    startVoiceWaveform();
    try {
      recognition.start();
    } catch {
      recognitionRef.current = null;
      setVoiceListening(false);
      clearVoiceWaveform(true);
      setChatError("Could not start voice input.");
    }
  }

  async function send(text: string) {
    const content = text.trim();
    if (!content || !agent || busy) return;
    stopVoiceInput(true);
    const conversation = onEnsureConversation();
    createdConversationRef.current = conversation;
    const userMessage: AgentChatMessage = { role: "user", content, timestamp: Date.now() };
    const nextMessages: AgentChatMessage[] = [...messages, userMessage];
    onUpdateMessages(conversation, () => nextMessages);
    setInput("");
    setBusy(true);
    setChatError("");
    setFailedText("");
    nearBottomRef.current = true;
    setShowScrollButton(false);
    const controller = new AbortController();
    requestAbortRef.current = controller;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const progressSteps = progressMessagesFor(content);
    setProgressText(progressSteps[0]);
    progressSteps.slice(1).forEach((step, index) => {
      timers.push(setTimeout(() => setProgressText(step), 950 + index * 1200));
    });
    try {
      const response = await fetch(`/api/automation/agents/${encodeURIComponent(agent.id)}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          messages: nextMessages.map(({ role, content: messageContent }) => ({ role, content: messageContent })),
          memory: buildAgentChatMemory(agent.id, conversation),
        }),
      });
      const data = await readApiJson(response, "Agent chat failed");
      const applied = Array.isArray(data.applied) && data.applied.length ? (data.applied as string[]) : undefined;
      const actions = Array.isArray(data.actions) ? (data.actions as AgentChatAction[]) : undefined;
      const cards = Array.isArray(data.cards) ? (data.cards as AgentChatCard[]) : undefined;
      const presentation = data.presentation && typeof data.presentation === "object" ? data.presentation as AgentChatPresentation : null;
      const blocks = Array.isArray(data.blocks) && data.blocks.length ? (data.blocks as AgentChatBlock[]) : undefined;
      onUpdateMessages(conversation, (prev) => [...prev, {
        role: "assistant",
        content: String(data.reply || ""),
        timestamp: Date.now(),
        format: data.format === "report" ? "report" : "text",
        html: typeof data.html === "string" ? data.html : "",
        cards,
        presentation,
        actions,
        blocks,
        applied,
      }]);
      if (data.agent) onAgentUpdated();
    } catch (err) {
      onUpdateMessages(conversation, (prev) => prev.filter((message) => message.timestamp !== userMessage.timestamp));
      setInput((current) => current || content);
      setFailedText(content);
      setChatError(err instanceof DOMException && err.name === "AbortError" ? "Response stopped. Your message is back in the composer." : err instanceof Error ? err.message : "Agent chat failed");
    } finally {
      timers.forEach(clearTimeout);
      setProgressText("");
      setBusy(false);
      if (requestAbortRef.current === controller) requestAbortRef.current = null;
      textareaRef.current?.focus();
    }
  }

  function scrollToLatest() {
    nearBottomRef.current = true;
    setShowScrollButton(false);
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }

  function handleScroll() {
    const element = scrollRef.current;
    if (!element) return;
    const nearBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 120;
    nearBottomRef.current = nearBottom;
    setShowScrollButton(!nearBottom);
  }

  async function copyMessage(content: string, index: number) {
    try {
      if (!navigator.clipboard) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(content);
      setCopiedMessage(index);
      window.setTimeout(() => setCopiedMessage((current) => current === index ? -1 : current), 1600);
    } catch {
      setChatError("Could not copy this response.");
    }
  }

  async function handleAction(action: AgentChatAction) {
    if (!agent || actionBusy) return;
    const key = `${action.type}:${action.label}`;
    setActionBusy(key);
    setChatError("");
    try {
      if (action.type === "navigate") {
        const view = String(action.payload?.view || "");
        if (view === "tiktok") {
          writeDeepLink({
            view: "tiktok",
            section: action.payload?.section === "saved" ? "saved" : "analyze",
            tab: action.payload?.tab === "channel" ? "channel" : action.payload?.tab === "collection" ? "collection" : undefined,
            url: action.payload?.url || undefined,
          }, false);
        } else if (["movie", "youtube", "niches", "feed", "channels", "compile", "automation", "rewriter", "tts"].includes(view)) {
          writeDeepLink({ view: view as any }, false);
        }
      } else if (action.type === "agent_tab") {
        const tab = action.payload?.tab;
        if (tab) onSetActiveTab(tab);
      } else if (action.type === "internal_tool") {
        const tool = String(action.payload?.tool || "");
        const query = action.payload?.query ? ` for ${action.payload.query}` : "";
        const url = action.payload?.url ? ` ${action.payload.url}` : "";
        await send(`Run ${tool || action.label} internally${query}${url}`.trim());
      } else if (action.type === "refresh_agent") {
        onAgentUpdated();
      } else if (action.type === "run_candidate") {
        await onRunAgent(agent.id, { stayInChat: true, throwOnError: true });
        const conversation = onEnsureConversation();
        createdConversationRef.current = conversation;
        onUpdateMessages(conversation, (prev) => [...prev, {
          role: "assistant",
          content: "Candidate run started through the normal automation pipeline. I refreshed the agent so you can review the latest run state.",
          timestamp: Date.now(),
          actions: [{ type: "agent_tab", label: "Open run log", payload: { tab: "runs" } }, { type: "agent_tab", label: "Review uploads", payload: { tab: "uploads" } }],
        }]);
      }
    } catch (err) {
      setChatError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setActionBusy("");
    }
  }

  const composer = (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void send(input);
      }}
      className={cn(
        "overflow-hidden rounded-xl border transition-shadow duration-200 focus-within:border-[#f9dc0b]/70",
        isDark
          ? "border-[#F8F5E8]/12 bg-[#191C18] shadow-[0_10px_36px_rgba(0,0,0,0.45)] focus-within:shadow-[0_10px_40px_rgba(249,220,11,0.08)]"
          : "border-[#1A1A1A]/10 bg-white shadow-[0_10px_36px_rgba(26,26,26,0.1)] focus-within:shadow-[0_12px_40px_rgba(26,26,26,0.14)]"
      )}
    >
      <textarea
        ref={textareaRef}
        value={input}
        onChange={(event) => setInput(event.target.value)}
        disabled={busy}
        maxLength={2000}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            void send(input);
          }
        }}
        rows={1}
        placeholder={messages.length ? `Reply to ${agent?.name || "the agent"}…` : "How can I help with this agent?"}
        className={cn(
          "block max-h-[200px] w-full resize-none bg-transparent px-5 pb-1 pt-4 text-[15px] leading-7 outline-none disabled:cursor-wait disabled:opacity-65",
          isDark ? "text-[#F8F5E8] placeholder:text-[#F8F5E8]/35" : "text-[#1A1A1A] placeholder:text-[#1A1A1A]/38"
        )}
      />
      {voiceWaveVisible ? (
        <div className="px-4 pb-1 pt-1">
          <AgentVoiceWaveform levels={voiceWaveLevels} listening={voiceListening} settled={voiceWaveSettled} isDark={isDark} />
        </div>
      ) : null}
      <div className="flex items-center justify-between gap-3 px-3 pb-3 pt-1">
        <p className={cn("min-w-0 truncate pl-2 text-[11px] font-semibold", tokens.subtle)}>
          {voiceListening ? <><Mic className="mr-1.5 inline h-3 w-3 text-[#b89f00]" />{voiceInterim || "Listening"}</> : input.length > 1600 ? `${input.length}/2000` : <><Sparkles className="mr-1.5 inline h-3 w-3 text-[#b89f00]" />Live workspace context</>}
        </p>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={toggleVoiceInput}
            disabled={busy}
            aria-pressed={voiceListening}
            aria-label={voiceListening ? "Stop voice input" : voiceSupported ? "Start voice input" : "Voice input unavailable"}
            title={voiceListening ? "Stop voice input" : voiceSupported ? "Start voice input" : "Voice input unavailable"}
            className={cn(
              "grid h-9 w-9 shrink-0 place-items-center rounded-lg border transition active:scale-[0.94] disabled:cursor-not-allowed",
              voiceListening
                ? "border-[#f9dc0b] bg-[#f9dc0b] text-[#1A1A1A] shadow-[0_0_0_4px_rgba(249,220,11,0.14)]"
                : isDark
                  ? "border-[#F8F5E8]/15 bg-[#F8F5E8]/8 text-[#F8F5E8] hover:border-[#f9dc0b]/55 hover:text-[#f9dc0b]"
                  : "border-[#1A1A1A]/10 bg-[#F7F7F5] text-[#1A1A1A] hover:border-[#f9dc0b]",
              !voiceSupported && !voiceListening ? "opacity-35" : "",
              busy ? "opacity-35" : ""
            )}
          >
            {voiceListening ? <MicOff className="h-4 w-4 stroke-[2.25]" /> : <Mic className="h-4 w-4 stroke-[2.25]" />}
          </button>
          {busy ? (
            <button type="button" onClick={() => requestAbortRef.current?.abort()} className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-lg border transition active:scale-[0.94]", isDark ? "border-[#F8F5E8]/15 bg-[#F8F5E8]/8 text-[#F8F5E8]" : "border-[#1A1A1A]/10 bg-[#F7F7F5] text-[#1A1A1A]")} aria-label="Stop response" title="Stop response">
              <Square className="h-3.5 w-3.5 fill-current" />
            </button>
          ) : (
            <button type="submit" disabled={!input.trim()} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[#f9dc0b] text-[#1A1A1A] transition duration-150 hover:opacity-85 active:scale-[0.94] disabled:opacity-30" aria-label="Send message" title="Send message">
              <ArrowUp className="h-4 w-4 stroke-[2.5]" />
            </button>
          )}
        </div>
      </div>
    </form>
  );

  const collapsedHistoryControls = !historyVisible ? (
    <div className="absolute left-3 top-2 z-20 hidden items-center gap-1 lg:flex">
      <button type="button" onClick={onToggleHistory} className={cn("grid h-8 w-8 place-items-center rounded-lg border shadow-sm transition", isDark ? "border-[#F8F5E8]/12 bg-[#191C18] text-[#F8F5E8]/70 hover:text-[#F8F5E8]" : "border-[#1A1A1A]/10 bg-white text-[#1A1A1A]/55 hover:text-[#1A1A1A]")} aria-label="Open chat history" title="Open chat history">
        <PanelLeftOpen className="h-4 w-4" />
      </button>
      <button type="button" onClick={onNewChat} className={cn("grid h-8 w-8 place-items-center rounded-lg border shadow-sm transition", isDark ? "border-[#F8F5E8]/12 bg-[#191C18] text-[#F8F5E8]/70 hover:text-[#F8F5E8]" : "border-[#1A1A1A]/10 bg-white text-[#1A1A1A]/55 hover:text-[#1A1A1A]")} aria-label="Start a new chat" title="Start a new chat">
        <Plus className="h-4 w-4" />
      </button>
    </div>
  ) : null;

  const chatErrorNotice = chatError ? (
    <div role="alert" className={cn("flex items-start gap-3 rounded-lg border px-3 py-2.5 text-sm font-semibold", isDark ? "border-[#f9dc0b]/30 bg-[#f9dc0b]/10 text-[#F8F5E8]" : "border-[#f9dc0b]/45 bg-[#fff9d6] text-[#6a5b00]")}>
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <p className="min-w-0 flex-1 leading-5">{chatError}</p>
      {failedText && !busy ? <button type="button" onClick={() => void send(failedText)} className="grid h-7 w-7 shrink-0 place-items-center rounded-md hover:bg-black/5" aria-label="Retry message" title="Retry"><RefreshCw className="h-3.5 w-3.5" /></button> : null}
      <button type="button" onClick={() => { setChatError(""); setFailedText(""); }} className="grid h-7 w-7 shrink-0 place-items-center rounded-md hover:bg-black/5" aria-label="Dismiss error"><X className="h-3.5 w-3.5" /></button>
    </div>
  ) : null;

  if (!agent) {
    return (
      <div className="grid h-full place-items-center p-6">
        <div className={cn("max-w-md rounded-xl border border-dashed p-6 text-center", tokens.surfaceSoft)}>
          <MessageSquare className="mx-auto h-8 w-8 text-[#f9dc0b]" />
          <p className={cn("mt-4 text-sm font-bold", tokens.text)}>Save the agent first</p>
          <p className={cn("mt-2 text-sm leading-6", tokens.muted)}>Once the agent exists, you can manage everything from this chat — ask about performance or change any setting in plain language.</p>
        </div>
      </div>
    );
  }

  if (!messages.length) {
    return (
      <div className="relative flex h-full min-h-0 flex-col overflow-y-auto">
        {collapsedHistoryControls}
        <div className="flex flex-1 flex-col items-center justify-center px-4 py-8">
          <div className="w-full max-w-3xl">
            <div className="mb-6 text-center">
              <span className="mx-auto grid h-10 w-10 place-items-center rounded-lg bg-[#f9dc0b] text-[#1A1A1A] shadow-[0_6px_18px_rgba(249,220,11,0.24)]">
                <Sparkles className="h-4 w-4" />
              </span>
              <h2 className={cn("mt-4 font-serif text-2xl font-bold md:text-3xl", tokens.text)}>
                What should {agent.name} do next?
              </h2>
            </div>
            <div className="mx-auto max-w-2xl">{composer}</div>
            {chatErrorNotice ? <div className="mx-auto mt-3 max-w-2xl">{chatErrorNotice}</div> : null}
            <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {AGENT_CHAT_SUGGESTIONS.map(({ label, prompt, icon: SuggestionIcon }) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => void send(prompt)}
                  className={cn(
                    "flex min-h-11 items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs font-bold transition duration-150 hover:-translate-y-px",
                    isDark
                      ? "border-[#F8F5E8]/14 bg-[#191C18] text-[#F8F5E8]/70 hover:border-[#f9dc0b]/50 hover:text-[#F8F5E8]"
                      : "border-[#1A1A1A]/10 bg-white text-[#1A1A1A]/65 hover:border-[#f9dc0b] hover:text-[#1A1A1A]"
                  )}
                >
                  <SuggestionIcon className="h-3.5 w-3.5 shrink-0 text-[#b89f00]" />
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      {collapsedHistoryControls}
      <div ref={scrollRef} onScroll={handleScroll} className="min-h-0 flex-1 overflow-y-auto">
        <div className={cn("mx-auto w-full max-w-4xl space-y-7 px-4 pb-6 md:px-6", historyVisible ? "pt-8" : "pt-12")}>
          {messages.map((message, index) => (
            <div key={`${message.role}-${index}`} className={cn("flex", message.role === "user" ? "justify-end" : "justify-start")}>
              {message.role === "user" ? (
                <p className={cn(
                  "max-w-[82%] whitespace-pre-wrap rounded-xl rounded-br-md px-4 py-3 text-[15px] leading-7",
                  isDark ? "bg-[#F8F5E8]/10 text-[#F8F5E8]" : "bg-[#1A1A1A]/[0.055] text-[#1A1A1A]"
                )}>{message.content}</p>
              ) : (
                <div className="flex w-full gap-3.5">
                  <span className="mt-1.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#f9dc0b] text-[#1A1A1A] shadow-sm"><Sparkles className="h-3.5 w-3.5" /></span>
                  <div className="group min-w-0 flex-1 pt-1">
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <FormattedChatText content={message.content} theme={theme} />
                      </div>
                      <button
                        type="button"
                        onClick={() => void copyMessage(message.content, index)}
                        className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-lg transition", copiedMessage === index ? "text-[#b89f00] opacity-100" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100", isDark ? "hover:bg-[#F8F5E8]/8 hover:text-[#F8F5E8]" : "hover:bg-[#1A1A1A]/6 hover:text-[#1A1A1A]")}
                        aria-label={copiedMessage === index ? "Response copied" : "Copy response"}
                        title={copiedMessage === index ? "Copied" : "Copy response"}
                      >
                        {copiedMessage === index ? <CheckCircle2 className="h-4 w-4" /> : <Clipboard className="h-4 w-4" />}
                      </button>
                    </div>
                    <AgentChatBlocks blocks={message.blocks} theme={theme} />
                    {!message.blocks?.length ? <AgentChatCards cards={message.presentation?.cards?.length ? message.presentation.cards : message.cards} theme={theme} /> : null}
                    {!message.blocks?.length && (message.presentation?.html || message.html) ? <AgentChatRichHtml html={message.presentation?.html || message.html || ""} theme={theme} /> : null}
                    {message.actions?.length ? (
                      <div className="mt-4 flex flex-wrap gap-2">
                        {message.actions.map((action) => {
                          const key = `${action.type}:${action.label}`;
                          return (
                            <button
                              key={`${action.type}-${action.label}`}
                              type="button"
                              onClick={() => void handleAction(action)}
                              disabled={Boolean(actionBusy)}
                              className={cn(
                                "inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-xs font-black transition hover:-translate-y-px disabled:cursor-wait disabled:opacity-50",
                                action.type === "run_candidate"
                                  ? "border-[#f9dc0b] bg-[#f9dc0b] text-[#1A1A1A]"
                                  : isDark ? "border-[#F8F5E8]/14 bg-[#F8F5E8]/5 text-[#F8F5E8]/75 hover:border-[#f9dc0b]/60 hover:text-[#F8F5E8]" : "border-[#1A1A1A]/10 bg-white text-[#1A1A1A]/70 hover:border-[#f9dc0b] hover:text-[#1A1A1A]"
                              )}
                            >
                              {actionBusy === key ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : action.type === "navigate" ? <Navigation className="h-3.5 w-3.5" /> : action.type === "internal_tool" ? <Sparkles className="h-3.5 w-3.5" /> : action.type === "run_candidate" ? <Play className="h-3.5 w-3.5" /> : <ArrowUpRight className="h-3.5 w-3.5" />}
                              {action.label}
                            </button>
                          );
                        })}
                      </div>
                    ) : null}
                    {message.applied?.length ? (
                      <p className={cn(
                        "mt-3 inline-flex flex-wrap items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[11px] font-bold",
                        isDark ? "border-[#f9dc0b]/30 bg-[#f9dc0b]/10 text-[#f9dc0b]" : "border-[#f9dc0b]/40 bg-[#fffdf0] text-[#8a7500]"
                      )}>
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Saved changes: {message.applied.join(", ")}
                      </p>
                    ) : null}
                  </div>
                </div>
              )}
            </div>
          ))}
          {busy ? (
            <div className="flex items-center gap-3.5" role="status" aria-live="polite">
              <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[#f9dc0b]" />
              <p key={progressText} className={cn("truncate text-xs font-semibold transition-opacity", isDark ? "text-[#F8F5E8]/42" : "text-[#1A1A1A]/42")}>{progressText}</p>
            </div>
          ) : null}
          {chatErrorNotice}
        </div>
      </div>
      {showScrollButton ? (
        <button type="button" onClick={scrollToLatest} className={cn("absolute bottom-24 right-4 z-20 grid h-9 w-9 place-items-center rounded-full border shadow-lg transition hover:-translate-y-px", isDark ? "border-[#F8F5E8]/12 bg-[#191C18] text-[#F8F5E8]" : "border-[#1A1A1A]/10 bg-white text-[#1A1A1A]")} aria-label="Scroll to latest message" title="Latest message">
          <ArrowDown className="h-4 w-4" />
        </button>
      ) : null}
      <div className="relative shrink-0 px-4 pb-4 md:px-0">
        <div className="mx-auto w-full max-w-2xl">
          {composer}
        </div>
      </div>
    </div>
  );
}

function ToggleRow({ title, body, checked, onChange, wide = true }: { title: string; body: string; checked: boolean; onChange: (next: boolean) => void; wide?: boolean }) {
  return (
    <label className={cn("flex flex-col gap-3 rounded-xl border border-[#1A1A1A]/8 bg-white p-4 sm:flex-row sm:items-center sm:justify-between", wide && "md:col-span-2")}>
      <span className="min-w-0">
        <span className="block text-sm font-bold text-[#1A1A1A]">{title}</span>
        <span className="mt-1 block text-xs font-semibold leading-5 text-[#1A1A1A]/48">{body}</span>
      </span>
      <span className={cn("relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition", checked ? "border-[#f9dc0b] bg-[#f9dc0b]" : "border-[#1A1A1A]/12 bg-[#1A1A1A]/10")}>
        <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="sr-only" />
        <span className={cn("block h-5 w-5 rounded-full bg-white shadow transition", checked ? "translate-x-5" : "translate-x-1")} />
      </span>
    </label>
  );
}

function Field({ label, children, wide = false }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <label className={cn("space-y-1.5", wide && "md:col-span-2")}>
      <span className="block text-[11px] font-bold uppercase tracking-widest text-[#1A1A1A]/35">{label}</span>
      {children}
    </label>
  );
}

function Notice({ title, body, tone = "warn" }: { title: string; body: string; tone?: "warn" | "error" | "success" }) {
  const color = tone === "success" ? "border-[#f9dc0b]/18 bg-[#fff9d6] text-[#6a5b00]" : tone === "error" ? "border-[#f9dc0b]/18 bg-[#fff9d6] text-[#6a5b00]" : "border-[#f9dc0b]/18 bg-[#fff9d6] text-[#443b00]";
  return (
    <div className={cn("flex gap-3 rounded-xl border p-4 shadow-sm", color)}>
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <div>
        <p className="text-sm font-bold">{title}</p>
        <p className="mt-1 text-sm leading-6 opacity-75">{body}</p>
      </div>
    </div>
  );
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

function CardStat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg bg-[#F9F8F6] p-2">
      <p className="truncate text-[9px] font-bold uppercase tracking-widest text-[#1A1A1A]/35">{label}</p>
      <p className="mt-1 truncate text-xs font-black text-[#1A1A1A]">{value}</p>
    </div>
  );
}

function StepTile({ icon, label, body, theme = "light" }: { icon: ReactNode; label: string; body: string; theme?: AgentTheme }) {
  const tokens = getAgentTheme(theme);
  return (
    <div className={cn("rounded-xl border p-4", tokens.surface)}>
      <div className="grid h-8 w-8 place-items-center rounded-lg bg-[#f9dc0b]/12 text-[#f9dc0b]">{icon}</div>
      <p className={cn("mt-3 text-sm font-bold", tokens.text)}>{label}</p>
      <p className={cn("mt-1 text-sm leading-6", tokens.muted)}>{body}</p>
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

function Evidence({ label, value }: { label: string; value?: string }) {
  return (
    <div className="rounded-xl border border-[#1A1A1A]/8 bg-[#FDFCFA] p-4">
      <div className="flex items-center gap-2 text-[#f9dc0b]">
        <Layers3 className="h-4 w-4" />
        <p className="text-xs font-bold text-[#1A1A1A]">{label}</p>
      </div>
      <p className="mt-2 text-sm leading-6 text-[#1A1A1A]/55">{value || "No evidence stored yet."}</p>
    </div>
  );
}

function Step({ icon, label, body }: { icon: ReactNode; label: string; body: string }) {
  return (
    <div className="flex gap-3">
      <div className="mt-0.5 text-[#f9dc0b]">{icon}</div>
      <p className="text-sm leading-6 text-[#1A1A1A]/60"><span className="font-bold text-[#1A1A1A]">{label}:</span> {body}</p>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const clean = String(status || "pending");
  const label = clean === "hd_test" ? "HD test" : clean.replace(/_/g, " ");
  const success = ["uploaded", "scheduled", "success", "active", "hd_test"].includes(clean);
  const error = ["error", "failed"].includes(clean);
  return (
    <span className={cn(
      "inline-flex w-fit rounded-full px-2.5 py-1 text-[10px] font-bold uppercase",
      success ? "bg-[#fff9d6] text-[#6a5b00]" : error ? "bg-[#fff9d6] text-[#6a5b00]" : "bg-[#1A1A1A]/5 text-[#1A1A1A]/50"
    )}>
      {label}
    </span>
  );
}
