import {
  AlertCircle,
  ArrowLeft,
  BarChart3,
  Bot,
  CalendarClock,
  CheckCircle2,
  Clock3,
  ExternalLink,
  Eye,
  Film,
  Heart,
  Layers3,
  LayoutList,
  Loader2,
  MessageCircle,
  MessageSquare,
  Play,
  Plus,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Sparkles,
  Table2,
  Trash2,
  Youtube,
} from "lucide-react";
import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import {
  AuthSessionPayload,
  AutomationAgent,
  AutomationRun,
  AutomationSourceSummary,
  AutomationUpload,
  ConnectedYouTubeAccount,
  YouTubePlaylistSummary,
} from "../types";
import { cn } from "../lib/utils";
import { writeDeepLink } from "../utils/tiktokRoute";

const DEFAULT_SETTINGS = {
  maxPostsPerDay: 1,
  scheduleTimes: ["09:00", "18:00"],
  scheduleLeadMinutes: 120,
  timezone: "Africa/Nairobi",
  publishMode: "schedule",
  searchDepth: 50,
  sourcePriority: "views",
  movieIdEnabled: true,
  includeSideChannels: true,
  sideChannels: [""],
  microNicheGoal: "Identify repeatable movie recap micro-sub-niches with strong curiosity hooks and low direct competition.",
  genreFocus: "Movie recaps",
  titleStyle: "viral-curiosity",
  madeForKids: false,
  categoryId: "24",
  targetPlaylistMode: "auto",
  targetPlaylistId: "",
  targetPlaylistTitle: "",
  createTargetPlaylist: false,
  autoCreatePlaylists: true,
  avoidMovieRepeats: true,
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

type AutomationTab = "overview" | "analytics" | "setup" | "compile" | "uploads" | "runs";
type SetupSubTab = "basics" | "source" | "learning" | "comments" | "safety";

const TABS: Array<{ id: AutomationTab; label: string; icon: ReactNode }> = [
  { id: "overview", label: "Overview", icon: <LayoutList className="h-4 w-4" /> },
  { id: "analytics", label: "Analytics", icon: <BarChart3 className="h-4 w-4" /> },
  { id: "setup", label: "Setup", icon: <Settings2 className="h-4 w-4" /> },
  { id: "compile", label: "Compile", icon: <Layers3 className="h-4 w-4" /> },
  { id: "uploads", label: "Uploads", icon: <Table2 className="h-4 w-4" /> },
  { id: "runs", label: "Run log", icon: <Clock3 className="h-4 w-4" /> },
];

const SETUP_TABS: Array<{ id: SetupSubTab; label: string; icon: ReactNode }> = [
  { id: "basics", label: "Basics", icon: <Bot className="h-4 w-4" /> },
  { id: "source", label: "Source", icon: <Film className="h-4 w-4" /> },
  { id: "learning", label: "Learning", icon: <Sparkles className="h-4 w-4" /> },
  { id: "comments", label: "Comments", icon: <MessageCircle className="h-4 w-4" /> },
  { id: "safety", label: "Safety", icon: <ShieldCheck className="h-4 w-4" /> },
];

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

function timeToMinutes(value: string): number {
  const normalized = normalizePostTimeInput(value);
  if (!normalized) return 0;
  const [hour, minute] = normalized.split(":").map(Number);
  return hour * 60 + minute;
}

function minutesToTime(value: number): string {
  const safe = ((Math.round(value) % 1440) + 1440) % 1440;
  const hour = Math.floor(safe / 60);
  const minute = safe % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function uploadTimeForRelease(releaseTime: string, leadMinutes?: number): string {
  return minutesToTime(timeToMinutes(releaseTime) - Math.max(Number(leadMinutes) || 120, 15));
}

function leadMinutesFromUploadTime(releaseTime: string, uploadTime: string): number {
  const release = timeToMinutes(releaseTime);
  const upload = timeToMinutes(uploadTime);
  const diff = (release - upload + 1440) % 1440;
  return diff || 15;
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
  return Number(upload?.metrics?.publicStats?.[key] || 0);
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

function sourceDisplayName(source: AutomationSourceSummary): string {
  const title = source.title?.trim() || source.slug?.replace(/[-_]+/g, " ") || "Saved collection";
  return `${title} (${source.videoCount})`;
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

export function AutomationAgents({ auth, initialSlug = "" }: { auth: AuthSessionPayload; initialSlug?: string }) {
  const [accounts, setAccounts] = useState<ConnectedYouTubeAccount[]>(auth.accounts || []);
  const [sources, setSources] = useState<AutomationSourceSummary[]>([]);
  const [agents, setAgents] = useState<AutomationAgent[]>([]);
  const [routeAgent, setRouteAgent] = useState<AutomationAgent | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [activeTab, setActiveTab] = useState<AutomationTab>("overview");
  const [setupSubTab, setSetupSubTab] = useState<SetupSubTab>("basics");
  const [creatingNew, setCreatingNew] = useState(initialSlug === "new");
  const [selectedUploadId, setSelectedUploadId] = useState("");
  const [runs, setRuns] = useState<AutomationRun[]>([]);
  const [uploads, setUploads] = useState<AutomationUpload[]>([]);
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
  const selectedUpload = useMemo(() => uploads.find((upload) => upload.id === selectedUploadId) || null, [uploads, selectedUploadId]);
  const activeAccount = useMemo(() => accounts.find((account) => account.id === form.youtubeAccountId) || auth.activeAccount || accounts[0] || null, [accounts, auth.activeAccount, form.youtubeAccountId]);
  const successfulRuns = runs.filter((run) => run.status === "success").length;

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
      return;
    }
    if (initialSlug === "new") {
      setSelectedId("");
      setCreatingNew(true);
      setSelectedUploadId("");
      setRuns([]);
      setUploads([]);
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
        sourceKey: form.sourceType === "custom_url" ? form.sourceKey : source?.key || form.sourceKey,
        sourceUrl: form.sourceType === "custom_url" ? form.sourceUrl : source?.analyzedUrl || form.sourceUrl,
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

  async function runAgent(id: string) {
    setRunning(id);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/automation/agents/${encodeURIComponent(id)}/run`, { method: "POST" });
      const data = await readApiJson(response, "Automation run failed");
      setNotice("Agent processed one candidate and created a YouTube upload.");
      setActiveTab("uploads");
      await loadAll();
      await loadAgentDetail(id);
      if (data.uploadId) setSelectedUploadId(data.uploadId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Automation run failed");
      await loadAgentDetail(id);
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

  if (!auth.activeAccount && !accounts.length) {
    return <Notice title="Connect YouTube first" body="Use the account circle to connect at least one YouTube channel before creating an automation agent." />;
  }

  return (
    <div className="min-w-0 space-y-5 overflow-x-clip">
      <header className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-[#FF0033]/10 text-[#FF0033]">
            <Bot className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-widest text-[#FF0033]">Automation agent</p>
            <h1 className="font-serif text-2xl font-bold tracking-tight text-[#1A1A1A] md:text-3xl">TikTok to YouTube MSN engine</h1>
          </div>
        </div>
        <div className="grid w-full grid-cols-1 gap-2 min-[430px]:grid-cols-2 xl:w-auto">
          <button type="button" onClick={startNewAgent} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-[#1A1A1A]/10 bg-white px-4 py-2 text-xs font-bold text-[#1A1A1A] shadow-sm transition hover:border-[#FF0033]/25 hover:text-[#FF0033]">
            <Plus className="h-4 w-4" />
            New agent
          </button>
          <button type="button" onClick={() => void loadAll()} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-[#1A1A1A]/10 bg-white px-4 py-2 text-xs font-bold text-[#1A1A1A]/60 shadow-sm transition hover:border-[#FF0033]/25 hover:text-[#FF0033]">
            <RefreshCw className="h-4 w-4" />
            Refresh
          </button>
        </div>
      </header>

      {error ? <Notice tone="error" title="Request error" body={error} /> : null}
      {notice ? <Notice tone="success" title="Saved" body={notice} /> : null}

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
        onDelete={deleteAgent}
        onRefreshPlaylists={() => void loadPlaylists(form.youtubeAccountId)}
        onRun={runAgent}
        onBackToAgents={() => {
          setCreatingNew(false);
          setSelectedId("");
          setSelectedUploadId("");
          setActiveTab("overview");
          writeDeepLink({ view: "automation" });
        }}
        onSelect={(agent) => {
          setCreatingNew(false);
          setRouteAgent(agent);
          setSelectedId(agent.id);
          setSelectedUploadId("");
          setActiveTab("overview");
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
        updateSetting={updateSetting}
        onReupload={reuploadUpload}
      />
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
  onDelete,
  onReupload,
  onRefreshPlaylists,
  onRun,
  onBackToAgents,
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
  updateSetting,
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
  onDelete: (id: string) => Promise<void>;
  onReupload: (id: string) => Promise<void>;
  onRefreshPlaylists: () => void;
  onRun: (id: string) => Promise<void>;
  onBackToAgents: () => void;
  onSelect: (agent: AutomationAgent) => void;
  onSetActiveTab: (tab: AutomationTab) => void;
  onSetSetupSubTab: (tab: SetupSubTab) => void;
  onSetup: () => void;
  onUploads: () => void;
  reuploading: string;
  runAgent: (id: string) => Promise<void>;
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
  updateSetting: (key: string, value: unknown) => void;
}) {
  if (loading) {
    return (
      <section className="rounded-2xl border border-[#1A1A1A]/8 bg-white p-5 shadow-sm">
        <div className="flex min-h-24 items-center gap-2 text-sm font-semibold text-[#1A1A1A]/55">
          <Loader2 className="h-4 w-4 animate-spin text-[#FF0033]" />
          Loading agents
        </div>
      </section>
    );
  }

  const showingDraft = creatingNew;
  const visibleTab = selectedAgent ? activeTab : "setup";
  const detailAgent = selectedAgent || null;

  if (showingDraft || detailAgent) {
    return (
      <section className="space-y-4">
        <button type="button" onClick={onBackToAgents} className="inline-flex h-10 items-center gap-2 rounded-xl border border-[#1A1A1A]/10 bg-white px-4 text-xs font-bold text-[#1A1A1A] shadow-sm transition hover:border-[#FF0033]/25 hover:text-[#FF0033]">
          <ArrowLeft className="h-4 w-4" />
          Back to agents
        </button>
        <ExpandedAgentCard
          accounts={accounts}
          activeAccount={activeAccount}
          activeTab={visibleTab}
          agent={detailAgent}
          deleting={deleting}
          form={form}
          onDelete={onDelete}
          onReupload={onReupload}
          onRun={onRun}
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
          updateSetting={updateSetting}
        />
      </section>
    );
  }

  if (detailRequested) {
    return (
      <section className="space-y-4">
        <button type="button" onClick={onBackToAgents} className="inline-flex h-10 items-center gap-2 rounded-xl border border-[#1A1A1A]/10 bg-white px-4 text-xs font-bold text-[#1A1A1A] shadow-sm transition hover:border-[#FF0033]/25 hover:text-[#FF0033]">
          <ArrowLeft className="h-4 w-4" />
          Back to agents
        </button>
        <div className="rounded-2xl border border-[#1A1A1A]/8 bg-white p-6 shadow-sm">
          <div className="flex min-h-32 items-center gap-3 text-sm font-semibold text-[#1A1A1A]/55">
            <Loader2 className="h-4 w-4 animate-spin text-[#FF0033]" />
            Opening agent details
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {agents.map((agent) => <CollapsedAgentCard key={agent.id} agent={agent} onSelect={onSelect} />)}

        {!agents.length ? (
          <EmptyAgentCard />
        ) : null}
      </div>
    </section>
  );
}

function EmptyAgentCard() {
  return (
    <div className="rounded-[1.35rem] border border-dashed border-[#FF0033]/20 bg-white p-6 text-sm font-semibold text-[#1A1A1A]/55 shadow-sm">
      <div className="grid h-12 w-12 place-items-center rounded-2xl bg-[#FF0033]/10 text-[#FF0033]">
        <Bot className="h-5 w-5" />
      </div>
      <p className="mt-4 text-base font-bold text-[#1A1A1A]">No agents yet</p>
      <p className="mt-1 max-w-sm leading-6">Create one to connect a YouTube channel to a TikTok source.</p>
    </div>
  );
}

function sourceKindLabel(type?: string): string {
  if (type === "saved_channel") return "Channel source";
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
    .replace(/^@/, "@")
    .split("?")[0]
    .replace(/\/collection\/?/i, " collection")
    .replace(/\/video\/.*/i, " video")
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
  const isActive = agent.status === "active";
  const uploadCount = Number(agent.uploadCount || 0);
  const postsPerDay = Number(agent.settings?.maxPostsPerDay || 0);
  const cadence = postsPerDay > 1 ? `${postsPerDay}/day` : postsPerDay === 1 ? "1/day" : "Paused";
  const nextRun = agentNextRunLabel(agent);
  const scheduleTimes = (agent.settings?.scheduleTimes || []).slice(0, 2).join(", ") || "No time";
  const latestTitle = agent.lastUpload?.movieTitle || agent.lastUpload?.title || "Waiting for first upload";
  const progress = Math.max(12, Math.min(100, uploadCount ? 48 + uploadCount * 12 : isActive ? 30 : 18));

  return (
    <button
      type="button"
      aria-label={`Open ${agent.name}`}
      onClick={() => onSelect(agent)}
      className="group overflow-hidden rounded-[1.05rem] border border-[#1A1A1A]/8 bg-white text-left shadow-[0_10px_28px_rgba(26,26,26,0.052)] transition duration-200 hover:-translate-y-0.5 hover:border-[#FF0033]/25 hover:shadow-[0_16px_42px_rgba(26,26,26,0.09)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF0033]/35"
    >
      <div className="relative m-2 overflow-hidden rounded-[0.9rem] border border-[#1A1A1A]/8 bg-[#F9F8F6]">
        <div className="absolute inset-0 bg-[linear-gradient(135deg,#fff4ad_0%,#f9f8f6_48%,#ffe5eb_100%)]" />
        <div className="absolute -right-12 top-0 h-full w-24 rotate-12 bg-[#FF0033]/10" />
        <div className="absolute -left-10 bottom-0 h-12 w-36 -rotate-6 bg-[#FFDE32]/45" />
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
                  <span className="grid h-8 w-8 place-items-center rounded-lg bg-[#1A1A1A] text-[11px] font-black text-[#FFDE32] shadow-sm">{agentInitials(agent)}</span>
                )}
                <div className="min-w-0">
                  <p className="truncate text-[10px] font-bold text-[#1A1A1A]/55">{agent.channelTitle || agent.channelHandle || "YouTube channel"}</p>
                  <p className="mt-0.5 truncate text-[9px] font-bold uppercase tracking-widest text-[#FF0033]">{publishModeLabel(agent.settings?.publishMode)}</p>
                </div>
              </div>
            </div>
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#1A1A1A] text-[#FFDE32] shadow-sm transition group-hover:scale-105">
              <ArrowLeft className="h-3 w-3 rotate-180" />
            </span>
          </div>
        </div>
      </div>

      <div className="px-3 pb-3 pt-0.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[9px] font-bold uppercase tracking-widest text-[#1A1A1A]/35">Automation agent</p>
            <h3 className="mt-1 line-clamp-1 text-sm font-black leading-5 text-[#1A1A1A]">{agent.name}</h3>
          </div>
          <span className={cn("mt-0.5 shrink-0 rounded-full px-2 py-1 text-[9px] font-black uppercase tracking-widest", isActive ? "bg-emerald-50 text-emerald-700" : "bg-[#1A1A1A]/5 text-[#1A1A1A]/45")}>
            {isActive ? "Live" : "Paused"}
          </span>
        </div>

        <div className="mt-2 grid grid-cols-3 gap-1">
          <CardStat label="Uploads" value={compact(uploadCount)} />
          <CardStat label="Cadence" value={cadence} />
          <CardStat label="GMT+3" value={scheduleTimes} />
        </div>

        <div className="mt-2 rounded-lg border border-[#1A1A1A]/8 bg-[#F9F8F6] p-2">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-[11px] font-bold text-[#1A1A1A]/60">{sourceShortLabel(agent)}</p>
            <span className="shrink-0 rounded-full bg-white px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-widest text-[#1A1A1A]/40">Source</span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[#1A1A1A]/8">
            <div className="h-full rounded-full bg-[#FF0033]" style={{ width: `${progress}%` }} />
          </div>
        </div>

        <div className="mt-2 grid gap-2 border-t border-[#1A1A1A]/8 pt-2 sm:grid-cols-[minmax(0,1fr)_80px]">
          <div className="min-w-0">
            <p className="text-[9px] font-bold uppercase tracking-widest text-[#1A1A1A]/35">Latest signal</p>
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
  deleting,
  form,
  onDelete,
  onReupload,
  onRun,
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
  updateSetting,
}: {
  accounts: ConnectedYouTubeAccount[];
  activeAccount: ConnectedYouTubeAccount | null;
  activeTab: AutomationTab;
  agent: AutomationAgent | null;
  deleting: string;
  form: any;
  onDelete: (id: string) => Promise<void>;
  onReupload: (id: string) => Promise<void>;
  onRun: (id: string) => Promise<void>;
  onSetActiveTab: (tab: AutomationTab) => void;
  onSetSetupSubTab: (tab: SetupSubTab) => void;
  onSetup: () => void;
  onUploads: () => void;
  reuploading: string;
  runAgent: (id: string) => Promise<void>;
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
  updateSetting: (key: string, value: unknown) => void;
}) {
  const isDraft = !agent;
  const tab = isDraft ? "setup" : activeTab;

  return (
    <article className="md:col-span-2 2xl:col-span-3 overflow-hidden rounded-2xl border border-[#1A1A1A]/8 bg-white shadow-[0_18px_60px_rgba(26,26,26,0.08)]">
      <div className="border-b border-[#1A1A1A]/8 bg-[#FDFCFA] p-4 md:p-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="flex min-w-0 gap-3">
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-[#FFDE32] text-[#1A1A1A] shadow-sm">
              <Bot className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-[11px] font-bold uppercase tracking-widest text-[#FF0033]">{isDraft ? "Draft agent" : "Selected agent"}</p>
                <StatusPill status={agent?.status || "draft"} />
              </div>
              <h3 className="mt-2 line-clamp-2 font-serif text-2xl font-bold leading-tight text-[#1A1A1A]">{agent?.name || form.name || "New automation agent"}</h3>
              <p className="mt-1 truncate text-sm font-semibold text-[#1A1A1A]/50">{agent?.channelTitle || activeAccount?.channelTitle || "Choose a YouTube channel"}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {!isDraft ? (
              <button type="button" onClick={() => void onRun(agent.id)} disabled={!!running || saving} className="inline-flex h-10 items-center gap-2 rounded-xl border border-[#1A1A1A]/10 bg-white px-4 text-xs font-bold text-[#1A1A1A] shadow-sm transition hover:border-[#FF0033]/25 hover:text-[#FF0033] disabled:opacity-50">
                {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                Run candidate
              </button>
            ) : null}
            {!isDraft ? (
              <button type="button" onClick={() => void onDelete(agent.id)} disabled={!!deleting || !!running || saving} className="inline-flex h-10 items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 text-xs font-bold text-red-700 shadow-sm transition hover:border-red-300 hover:bg-red-100 disabled:opacity-50">
                {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                Delete
              </button>
            ) : null}
            <button form="automation-agent-form" type="submit" disabled={saving} className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#FFDE32] px-5 text-xs font-bold text-[#1A1A1A] shadow-sm transition hover:bg-[#FF0033] hover:text-white disabled:opacity-50">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Save
            </button>
          </div>
        </div>

        <div className="mt-5 flex gap-2 overflow-x-auto overscroll-x-contain rounded-xl border border-[#1A1A1A]/8 bg-white p-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {TABS.map((item) => {
            const disabled = isDraft && item.id !== "setup";
            return (
              <button
                key={item.id}
                type="button"
                disabled={disabled}
                onClick={() => onSetActiveTab(item.id)}
                className={cn(
                  "inline-flex h-10 shrink-0 items-center gap-2 rounded-lg px-3 text-xs font-bold transition disabled:cursor-not-allowed disabled:opacity-35",
                  tab === item.id ? "bg-[#1A1A1A] text-white shadow-sm" : "text-[#1A1A1A]/55 hover:bg-[#F9F8F6] hover:text-[#1A1A1A]"
                )}
              >
                {item.icon}
                {item.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="p-4 md:p-5">
        {tab === "overview" ? (
          <OverviewPanel
            account={activeAccount}
            agent={agent}
            uploads={uploads}
            runs={runs}
            successfulRuns={successfulRuns}
            onSetup={onSetup}
            onUploads={onUploads}
          />
        ) : null}
        {tab === "analytics" ? (
          <AnalyticsPanel agent={agent} uploads={uploads} runs={runs} />
        ) : null}
        {tab === "setup" ? (
          <SetupPanel
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
          />
        ) : null}
        {tab === "runs" ? <RunsPanel runs={runs} /> : null}
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
}: {
  account: ConnectedYouTubeAccount | null;
  agent: AutomationAgent | null;
  uploads: AutomationUpload[];
  runs: AutomationRun[];
  successfulRuns: number;
  onSetup: () => void;
  onUploads: () => void;
}) {
  const latestUpload = uploads[0] || null;
  return (
    <div className="space-y-5">
      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(280px,0.6fr)]">
        <div className="rounded-xl border border-[#1A1A1A]/8 bg-[#FDFCFA] p-5">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-[#FF0033]">Current workflow</p>
              <h2 className="mt-2 font-serif text-2xl font-bold text-[#1A1A1A]">{agent?.name || "New automation agent"}</h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-[#1A1A1A]/60">
                Connect a YouTube channel to a TikTok source, let the agent identify the movie, publish with channel-fit metadata, then learn from performance.
              </p>
            </div>
            <span className={cn("inline-flex w-fit rounded-full px-3 py-1 text-[11px] font-bold uppercase", agent?.status === "active" ? "bg-green-50 text-green-700" : "bg-[#1A1A1A]/5 text-[#1A1A1A]/50")}>
              {agent?.status || "draft"}
            </span>
          </div>
          <div className="mt-5 grid gap-3 md:grid-cols-4">
            <MetricTile icon={<Youtube className="h-4 w-4" />} label="Channel" value={account?.channelTitle || agent?.channelTitle || "Not connected"} />
            <MetricTile icon={<Film className="h-4 w-4" />} label="Uploads" value={compact(uploads.length)} />
            <MetricTile icon={<Clock3 className="h-4 w-4" />} label="Next run" value={agentNextRunLabel(agent)} />
            <MetricTile icon={<CheckCircle2 className="h-4 w-4" />} label="Successful runs" value={compact(successfulRuns)} />
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            <button type="button" onClick={onSetup} className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#FFDE32] px-4 text-xs font-bold text-[#1A1A1A] transition hover:bg-[#FF0033] hover:text-white">
              <Settings2 className="h-4 w-4" />
              Edit setup
            </button>
            <button type="button" onClick={onUploads} className="inline-flex h-10 items-center gap-2 rounded-xl border border-[#1A1A1A]/10 bg-white px-4 text-xs font-bold text-[#1A1A1A] transition hover:border-[#FF0033]/25 hover:text-[#FF0033]">
              <Table2 className="h-4 w-4" />
              Review uploads
            </button>
          </div>
        </div>
        <div className="rounded-xl border border-[#1A1A1A]/8 bg-white p-5">
          <p className="text-xs font-bold uppercase tracking-widest text-[#1A1A1A]/35">Latest upload</p>
          {latestUpload ? (
            <div className="mt-4 space-y-3">
              <p className="line-clamp-3 text-sm font-bold leading-6 text-[#1A1A1A]">{latestUpload.title}</p>
              <p className="text-xs font-semibold text-[#FF0033]">{latestUpload.movieTitle} {latestUpload.movieYear}</p>
              <div className="grid grid-cols-3 gap-2">
                <MiniStat label="Views" value={compact(metric(latestUpload, "viewCount"))} />
                <MiniStat label="Likes" value={compact(metric(latestUpload, "likeCount"))} />
                <MiniStat label="Comments" value={compact(metric(latestUpload, "commentCount"))} />
              </div>
            </div>
          ) : (
            <p className="mt-4 rounded-xl border border-dashed border-[#1A1A1A]/12 bg-[#F9F8F6] p-4 text-sm font-semibold leading-6 text-[#1A1A1A]/50">
              Run one candidate to create the first upload record.
            </p>
          )}
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-4">
        <StepTile icon={<Film className="h-4 w-4" />} label="Source" body="Saved playlists, channel feeds, and side-channel discovery." />
        <StepTile icon={<Sparkles className="h-4 w-4" />} label="Analyze" body="Movie ID, genre, hook, and repeatable micro-sub-niche signals." />
        <StepTile icon={<Youtube className="h-4 w-4" />} label="Publish" body="Title, description, scheduling, and channel style matching." />
        <StepTile icon={<MessageCircle className="h-4 w-4" />} label="Respond" body="Movie-name comments are answered during performance checks." />
      </section>

      <section className="rounded-xl border border-[#1A1A1A]/8 bg-[#FDFCFA] p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-bold uppercase tracking-widest text-[#1A1A1A]/35">Recent activity</p>
          <p className="text-[11px] font-semibold text-[#1A1A1A]/35">{runs.length} runs</p>
        </div>
        <div className="mt-3 divide-y divide-[#1A1A1A]/8">
          {runs.slice(0, 5).map((run) => (
            <div key={run.id} className="grid gap-2 py-3 md:grid-cols-[120px_minmax(0,1fr)_160px]">
              <p className="text-xs font-bold capitalize text-[#1A1A1A]">{run.status}</p>
              <p className="text-sm leading-6 text-[#1A1A1A]/60">{run.message}</p>
              <p className="text-xs font-semibold text-[#1A1A1A]/35 md:text-right">{formatDate(run.startedAt)}</p>
            </div>
          ))}
          {!runs.length ? <p className="py-5 text-sm font-semibold text-[#1A1A1A]/45">No runs yet.</p> : null}
        </div>
      </section>
    </div>
  );
}

function AnalyticsPanel({ agent, uploads, runs }: { agent: AutomationAgent | null; uploads: AutomationUpload[]; runs: AutomationRun[] }) {
  const analytics = useMemo(() => buildAgentAnalytics(uploads, runs), [uploads, runs]);
  const topGenre = analytics.genres[0];
  const topMsn = analytics.msns[0];
  const latestUpload = uploads[0] || null;

  return (
    <section className="space-y-5">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MetricTile icon={<Eye className="h-4 w-4" />} label="Total views" value={compact(analytics.totalViews)} />
        <MetricTile icon={<Heart className="h-4 w-4" />} label="Total likes" value={compact(analytics.totalLikes)} />
        <MetricTile icon={<MessageCircle className="h-4 w-4" />} label="Comments" value={compact(analytics.totalComments)} />
        <MetricTile icon={<Sparkles className="h-4 w-4" />} label="Agent replies" value={compact(analytics.totalReplies)} />
      </div>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(280px,0.9fr)]">
        <div className="rounded-xl border border-[#1A1A1A]/8 bg-white p-5">
          <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <SectionTitle title="Performance map" body="Which genres and micro-sub-niches are carrying this agent." />
            <p className="text-xs font-bold uppercase tracking-widest text-[#1A1A1A]/35">{uploads.length} uploads tracked</p>
          </div>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <Leaderboard title="Genres" rows={analytics.genres} empty="No genre performance yet." />
            <Leaderboard title="Micro-sub-niches" rows={analytics.msns} empty="No MSN performance yet." />
          </div>
        </div>

        <div className="rounded-xl border border-[#1A1A1A]/8 bg-[#FDFCFA] p-5">
          <SectionTitle title="Learning snapshot" body="Fast read on what the agent should do more of." />
          <div className="mt-4 space-y-3">
            <InsightRow label="Best genre" value={topGenre ? `${topGenre.label} (${compact(topGenre.views)} views)` : "Waiting for uploads"} />
            <InsightRow label="Best MSN" value={topMsn ? `${topMsn.label} (${compact(topMsn.views)} views)` : "Waiting for uploads"} />
            <InsightRow label="Best source" value={analytics.sources[0] ? `${analytics.sources[0].label} (${compact(analytics.sources[0].views)} views)` : "Waiting for uploads"} />
            <InsightRow label="Last signal" value={latestUpload ? `${latestUpload.movieTitle || latestUpload.title} · ${formatDate(latestUpload.createdAt)}` : "No uploads yet"} />
          </div>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-2">
        <div className="rounded-xl border border-[#1A1A1A]/8 bg-white p-5">
          <SectionTitle title="Community management" body="How many comments the agent has handled and what type of replies it is sending." />
          <div className="mt-5 grid gap-3 md:grid-cols-3">
            <MiniStat label="Movie replies" value={compact(analytics.movieReplies)} />
            <MiniStat label="AI replies" value={compact(analytics.aiReplies)} />
            <MiniStat label="Reply rate" value={analytics.totalComments ? `${Math.round((analytics.totalReplies / analytics.totalComments) * 100)}%` : "0%"} />
          </div>
          <div className="mt-5 space-y-3">
            {analytics.replyUploads.slice(0, 6).map((item) => (
              <div key={item.id} className="rounded-xl border border-[#1A1A1A]/8 bg-[#F9F8F6] p-3">
                <div className="flex items-start justify-between gap-3">
                  <p className="line-clamp-2 text-sm font-bold leading-6 text-[#1A1A1A]">{item.title}</p>
                  <span className="shrink-0 rounded-full bg-[#FFDE32] px-2.5 py-1 text-[10px] font-bold text-[#1A1A1A]">{compact(item.replies)} replies</span>
                </div>
                <p className="mt-1 text-xs font-semibold text-[#1A1A1A]/45">{compact(item.comments)} comments · last reply {formatDate(item.lastReplyAt)}</p>
              </div>
            ))}
            {!analytics.replyUploads.length ? <p className="rounded-xl border border-dashed border-[#1A1A1A]/12 bg-[#F9F8F6] p-4 text-sm font-semibold text-[#1A1A1A]/45">No community replies captured yet.</p> : null}
          </div>
        </div>

        <div className="rounded-xl border border-[#1A1A1A]/8 bg-[#FDFCFA] p-5">
          <SectionTitle title="Momentum watch" body="Recent upload velocity from public stats and analytics snapshots." />
          <div className="mt-5 space-y-3">
            {analytics.momentum.slice(0, 8).map((item) => (
              <div key={item.id} className="grid gap-3 rounded-xl border border-[#1A1A1A]/8 bg-white p-3 md:grid-cols-[minmax(0,1fr)_160px]">
                <div>
                  <p className="line-clamp-1 text-sm font-bold text-[#1A1A1A]">{item.title}</p>
                  <p className="mt-1 text-xs font-semibold text-[#1A1A1A]/45">{item.movie} · {item.genre}</p>
                </div>
                <div className="grid grid-cols-3 gap-2 text-right">
                  <MiniNumber label="Views" value={compact(item.views)} />
                  <MiniNumber label="Likes" value={compact(item.likes)} />
                  <MiniNumber label="Com." value={compact(item.comments)} />
                </div>
              </div>
            ))}
            {!analytics.momentum.length ? <p className="rounded-xl border border-dashed border-[#1A1A1A]/12 bg-white p-4 text-sm font-semibold text-[#1A1A1A]/45">No momentum data yet.</p> : null}
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-[#1A1A1A]/8 bg-white p-5">
        <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <SectionTitle title="Operational health" body="Run success, skips, errors, and whether the agent is learning from enough data." />
          <StatusPill status={agent?.status || "draft"} />
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-4">
          <MiniStat label="Runs" value={compact(runs.length)} />
          <MiniStat label="Success" value={compact(analytics.successRuns)} />
          <MiniStat label="Errors" value={compact(analytics.errorRuns)} />
          <MiniStat label="Upload success" value={runs.length ? `${Math.round((analytics.successRuns / runs.length) * 100)}%` : "0%"} />
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-2">
          <InsightRow label="Duplicate/quality skips" value={analytics.skips.length ? `${analytics.skips.length} recent skip records` : "No recent skip signals"} />
          <InsightRow label="Recommendation" value={analytics.recommendation} />
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

function Leaderboard({ title, rows, empty }: { title: string; rows: any[]; empty: string }) {
  const maxViews = Math.max(...rows.map((row) => row.views), 1);
  return (
    <div className="rounded-xl border border-[#1A1A1A]/8 bg-[#FDFCFA] p-4">
      <p className="text-sm font-bold text-[#1A1A1A]">{title}</p>
      <div className="mt-4 space-y-3">
        {rows.slice(0, 6).map((row) => (
          <div key={row.label}>
            <div className="flex items-center justify-between gap-3">
              <p className="line-clamp-1 text-sm font-semibold text-[#1A1A1A]/70">{row.label}</p>
              <p className="shrink-0 text-xs font-bold text-[#1A1A1A]">{compact(row.views)}</p>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#1A1A1A]/5">
              <div className="h-full rounded-full bg-[#FF0033]" style={{ width: `${Math.max(6, Math.round((row.views / maxViews) * 100))}%` }} />
            </div>
            <p className="mt-1 text-[11px] font-semibold text-[#1A1A1A]/38">{row.uploads} uploads · {compact(row.comments)} comments · {compact(row.replies)} replies</p>
          </div>
        ))}
        {!rows.length ? <p className="rounded-lg border border-dashed border-[#1A1A1A]/12 bg-white p-3 text-sm font-semibold text-[#1A1A1A]/45">{empty}</p> : null}
      </div>
    </div>
  );
}

function InsightRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-xl border border-[#1A1A1A]/8 bg-white p-3">
      <p className="text-[11px] font-bold uppercase tracking-widest text-[#1A1A1A]/35">{label}</p>
      <p className="mt-1 text-sm font-semibold leading-6 text-[#1A1A1A]/70">{value}</p>
    </div>
  );
}

function MiniNumber({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/35">{label}</p>
      <p className="mt-1 text-xs font-bold text-[#1A1A1A]">{value}</p>
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
}: {
  agent: AutomationAgent | null;
  form: any;
  runningCompilation: string;
  saveAgent: (event: FormEvent) => Promise<void>;
  saving: boolean;
  selectedId: string;
  runCompilation: (id: string) => Promise<void>;
  updateSetting: (key: string, value: unknown) => void;
}) {
  const busy = runningCompilation === selectedId;
  return (
    <form id="automation-agent-form" onSubmit={saveAgent} className="space-y-4">
      <section className="rounded-xl border border-[#1A1A1A]/8 bg-[#FDFCFA] p-4 md:p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <SectionTitle title="Create compilation" body="Stitch the agent source into one long-form upload for the connected channel." />
          <label className="inline-flex items-center gap-2 rounded-xl border border-[#1A1A1A]/8 bg-white px-3 py-2 text-xs font-bold text-[#1A1A1A]/65">
            <input type="checkbox" checked={form.settings.compilationEnabled === true} onChange={(event) => updateSetting("compilationEnabled", event.target.checked)} />
            Enable for this agent
          </label>
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <Field label="Min length">
            <input type="number" min={1} max={240} value={form.settings.compilationMinMinutes || 30} onChange={(event) => updateSetting("compilationMinMinutes", Number(event.target.value))} className="input bg-white" />
          </Field>
          <Field label="Max length">
            <input type="number" min={1} max={300} value={form.settings.compilationMaxMinutes || 40} onChange={(event) => updateSetting("compilationMaxMinutes", Number(event.target.value))} className="input bg-white" />
          </Field>
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
        <StepTile icon={<Film className="h-4 w-4" />} label="Select clips" body="Uses the agent source order, including highest views or oldest first." />
        <StepTile icon={<Layers3 className="h-4 w-4" />} label="Stitch with ffmpeg" body="Downloads clips, checks audio, normalizes size, then joins them." />
        <StepTile icon={<Youtube className="h-4 w-4" />} label="Upload long-form" body="Posts to the connected YouTube channel and target playlist settings." />
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#1A1A1A]/8 pt-4">
        <p className="text-xs font-semibold text-[#1A1A1A]/45">Save settings before leaving the page. Run compilation when you want to test the full workflow.</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => selectedId && void runCompilation(selectedId)} disabled={!agent || busy || saving} className="inline-flex h-10 items-center gap-2 rounded-xl border border-[#1A1A1A]/10 bg-white px-4 text-xs font-bold text-[#1A1A1A] shadow-sm transition hover:border-[#FF0033]/25 hover:text-[#FF0033] disabled:opacity-50">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            Run compilation
          </button>
          <button type="submit" disabled={saving} className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#FFDE32] px-5 text-xs font-bold text-[#1A1A1A] shadow-sm transition hover:bg-[#FF0033] hover:text-white disabled:opacity-50">
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
}) {
  const selectedSource = findSelectedSource(sources, form.sourceKey, form.sourceUrl);
  const selectedSourceValue = selectedSource?.key || form.sourceKey || "";
  const hasUnmatchedSavedSource = Boolean(selectedSourceValue && !selectedSource);
  const scheduleTimes = cleanScheduleTimes(form.settings.scheduleTimes);
  const targetPlaylistMode = form.settings.targetPlaylistMode || (form.settings.targetPlaylistId ? "existing" : form.settings.targetPlaylistTitle ? "create" : "auto");

  return (
    <form id="automation-agent-form" onSubmit={saveAgent} className="space-y-5">
      <div className="flex gap-2 overflow-x-auto overscroll-x-contain rounded-xl border border-[#1A1A1A]/8 bg-[#F9F8F6] p-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {SETUP_TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onSetSetupSubTab(item.id)}
            className={cn(
              "inline-flex h-10 shrink-0 items-center gap-2 rounded-lg px-3 text-xs font-bold transition",
              setupSubTab === item.id ? "bg-white text-[#1A1A1A] shadow-sm" : "text-[#1A1A1A]/50 hover:bg-white/70 hover:text-[#1A1A1A]"
            )}
          >
            {item.icon}
            {item.label}
          </button>
        ))}
      </div>

      {setupSubTab === "basics" ? (
      <section className="rounded-xl border border-[#1A1A1A]/8 bg-[#FDFCFA] p-4 md:p-5">
        <SectionTitle title="Agent basics" body="Choose the YouTube channel, TikTok source, and posting posture." />
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
          <Field label="Connect channel">
            <select value={form.youtubeAccountId} onChange={(e) => setForm((prev: any) => ({ ...prev, youtubeAccountId: e.target.value }))} className="input bg-white">
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>{account.channelTitle} ({account.email})</option>
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
        </div>
      </section>
      ) : null}

      {setupSubTab === "source" ? (
      <section className="rounded-xl border border-[#1A1A1A]/8 bg-white p-4 md:p-5">
        <SectionTitle title="Source and cadence" body="Tell the agent where to pull from and when to publish." />
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <Field label="TikTok source">
            <select value={form.sourceType} onChange={(e) => setForm((prev: any) => ({ ...prev, sourceType: e.target.value }))} className="input bg-white">
              <option value="saved_playlist">Saved playlist</option>
              <option value="saved_channel">Saved channel</option>
              <option value="custom_url">Custom URL</option>
            </select>
          </Field>
          {form.sourceType === "custom_url" ? (
            <Field label="Source URL">
              <input value={form.sourceUrl} onChange={(e) => setForm((prev: any) => ({ ...prev, sourceUrl: e.target.value }))} placeholder="https://www.tiktok.com/@channel" className="input bg-white" />
            </Field>
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
              <option value="oldest">Oldest videos first</option>
            </select>
          </Field>
          <Field label="Movie ID">
            <select value={form.settings.movieIdEnabled === false ? "off" : "on"} onChange={(e) => updateSetting("movieIdEnabled", e.target.value === "on")} className="input bg-white">
              <option value="on">Use Movie ID</option>
              <option value="off">Skip Movie ID</option>
            </select>
          </Field>
          <Field label="Posts per day">
            <input type="number" min={1} max={12} value={form.settings.maxPostsPerDay} onChange={(e) => updateSetting("maxPostsPerDay", Number(e.target.value))} className="input bg-white" />
          </Field>
          <div className="md:col-span-2">
            <div className="rounded-xl border border-[#1A1A1A]/8 bg-[#F9F8F6] p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-widest text-[#1A1A1A]/40">Post times (GMT+3)</p>
                  <p className="mt-1 text-xs font-semibold text-[#1A1A1A]/48">Set when YouTube releases the video and when AutoYT uploads it.</p>
                </div>
                <button
                  type="button"
                  onClick={addScheduleTime}
                  disabled={scheduleTimes.length >= 12}
                  className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#1A1A1A]/10 bg-white px-3 text-xs font-bold text-[#1A1A1A] shadow-sm transition hover:border-[#FF0033]/25 hover:text-[#FF0033] disabled:opacity-40"
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
                        className="h-10 w-full min-w-0 rounded-lg border border-[#1A1A1A]/10 bg-[#FDFCFA] px-3 text-sm font-bold text-[#1A1A1A] outline-none transition focus:border-[#FF0033]/40 focus:ring-2 focus:ring-[#FF0033]/10"
                      />
                    </label>
                    <label className="min-w-0">
                      <span className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/35">Upload at</span>
                      <input
                        type="time"
                        value={uploadTimeForRelease(value, form.settings.scheduleLeadMinutes)}
                        onChange={(event) => updateSetting("scheduleLeadMinutes", leadMinutesFromUploadTime(value, event.target.value))}
                        className="h-10 w-full min-w-0 rounded-lg border border-[#1A1A1A]/10 bg-[#FDFCFA] px-3 text-sm font-bold text-[#1A1A1A] outline-none transition focus:border-[#FF0033]/40 focus:ring-2 focus:ring-[#FF0033]/10"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => removeScheduleTime(index)}
                      disabled={scheduleTimes.length <= 1}
                      className="grid h-10 w-10 shrink-0 place-items-center self-end rounded-lg border border-[#1A1A1A]/8 text-[#1A1A1A]/40 transition hover:border-red-200 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-30"
                      aria-label="Remove post time"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <Field label="Genre focus">
            <input value={form.settings.genreFocus} onChange={(e) => updateSetting("genreFocus", e.target.value)} className="input bg-white" />
          </Field>
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
                  className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#1A1A1A]/10 bg-white px-3 text-xs font-bold text-[#1A1A1A] shadow-sm transition hover:border-[#FF0033]/25 hover:text-[#FF0033] disabled:opacity-50"
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
        </div>
      </section>
      ) : null}

      {setupSubTab === "learning" ? (
      <section className="rounded-xl border border-[#1A1A1A]/8 bg-[#FDFCFA] p-4 md:p-5">
        <SectionTitle title="Learning controls" body="Define the MSN target and how performance should be checked." />
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <Field label="Micro-sub-niche goal" wide>
            <textarea value={form.settings.microNicheGoal} onChange={(e) => updateSetting("microNicheGoal", e.target.value)} className="input min-h-24 bg-white py-3 leading-6" />
          </Field>
          <div className="space-y-3 rounded-xl border border-[#1A1A1A]/8 bg-white p-4 md:col-span-2">
            <label className="flex items-start gap-3 text-sm font-semibold text-[#1A1A1A]/65">
              <input type="checkbox" checked={form.settings.includeSideChannels} onChange={(e) => updateSetting("includeSideChannels", e.target.checked)} className="mt-1" />
              Let the agent scan related TikTok channels when the saved source runs out.
            </label>
            {(form.settings.sideChannels || [""]).map((value: string, index: number) => (
              <input key={index} value={value} onChange={(e) => setSideChannel(index, e.target.value)} placeholder="Optional side channel URL" className="input bg-white" />
            ))}
            <button type="button" onClick={() => updateSetting("sideChannels", [...(form.settings.sideChannels || []), ""])} className="text-xs font-bold text-[#FF0033]">Add side channel</button>
          </div>
          <Field label="Check every">
            <input type="number" min={1} max={24} value={form.settings.performanceCheckHours} onChange={(e) => updateSetting("performanceCheckHours", Number(e.target.value))} className="input bg-white" />
          </Field>
          <Field label="Stagnation window">
            <input type="number" min={3} max={168} value={form.settings.stagnationWindowHours} onChange={(e) => updateSetting("stagnationWindowHours", Number(e.target.value))} className="input bg-white" />
          </Field>
          <Field label="Min view delta %">
            <input type="number" min={0} max={100} value={form.settings.minViewDeltaPercent} onChange={(e) => updateSetting("minViewDeltaPercent", Number(e.target.value))} className="input bg-white" />
          </Field>
        </div>
      </section>
      ) : null}

      {setupSubTab === "comments" ? (
      <section className="rounded-xl border border-[#1A1A1A]/8 bg-white p-4 md:p-5">
        <SectionTitle title="Community management" body="Reply to recent comments during performance checks, while keeping movie-name replies as a priority." />
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
          <StepTile icon={<Film className="h-4 w-4" />} label="Movie-name replies" body="Questions asking for the title still get the exact movie name first." />
          <StepTile icon={<MessageCircle className="h-4 w-4" />} label="Engagement replies" body="AI replies to useful recent comments with short, natural responses." />
          <StepTile icon={<ShieldCheck className="h-4 w-4" />} label="Safety filter" body="Spam, abusive, illegal-upload, and low-value comments are skipped." />
        </div>
      </section>
      ) : null}

      {setupSubTab === "safety" ? (
      <section className="space-y-4">
      <label className="flex items-start gap-3 rounded-xl border border-[#FFDE32]/70 bg-[#FFDE32]/25 p-4 text-sm font-semibold leading-6 text-[#1A1A1A]/75">
        <input type="checkbox" checked={form.settings.rightsConfirmed} onChange={(e) => updateSetting("rightsConfirmed", e.target.checked)} className="mt-1" />
        <span><ShieldCheck className="mr-2 inline h-4 w-4 text-[#FF0033]" />I will only run this on clips I own, have permission to reuse, or can lawfully transform for my channel.</span>
      </label>
      <div className="rounded-xl border border-[#1A1A1A]/8 bg-white p-4">
        <SectionTitle title="Publishing guardrail" body="Keep the agent paused until a test candidate is clean, correctly identified, and uploaded in the quality you expect." />
      </div>
      </section>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#1A1A1A]/8 pt-4">
        <p className="text-xs font-semibold text-[#1A1A1A]/45">Active agents run from the server scheduler. Test one candidate before leaving it active.</p>
        <div className="flex flex-wrap gap-2">
          {selectedId ? (
            <button type="button" onClick={() => void runAgent(selectedId)} disabled={!!running || saving} className="inline-flex h-10 items-center gap-2 rounded-xl border border-[#1A1A1A]/10 bg-white px-4 text-xs font-bold text-[#1A1A1A] shadow-sm transition hover:border-[#FF0033]/25 hover:text-[#FF0033] disabled:opacity-50">
              {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              Run next candidate
            </button>
          ) : null}
          <button type="submit" disabled={saving} className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#FFDE32] px-5 text-xs font-bold text-[#1A1A1A] shadow-sm transition hover:bg-[#FF0033] hover:text-white disabled:opacity-50">
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
}: {
  uploads: AutomationUpload[];
  selectedUpload: AutomationUpload | null;
  selectedUploadId: string;
  onSelect: (id: string) => void;
  onBack: () => void;
  onReupload: (id: string) => Promise<void>;
  reuploading: string;
}) {
  if (selectedUploadId && selectedUpload) {
    return <UploadDetail upload={selectedUpload} onBack={onBack} onReupload={onReupload} reuploading={reuploading} />;
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <SectionTitle title="Uploaded posts" body="Review each automated YouTube upload, then open a post for Movie ID, performance, and comment automation context." />
        <p className="text-xs font-semibold text-[#1A1A1A]/40">{uploads.length} uploads</p>
      </div>
      <div className="-mx-4 overflow-x-auto rounded-xl border border-[#1A1A1A]/8 sm:mx-0">
        <table className="min-w-[880px] w-full border-collapse bg-white text-left">
          <thead className="bg-[#F9F8F6] text-[11px] font-bold uppercase tracking-widest text-[#1A1A1A]/35">
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
          <tbody className="divide-y divide-[#1A1A1A]/8">
            {uploads.map((upload) => (
              <tr key={upload.id} onClick={() => onSelect(upload.id)} className="cursor-pointer transition hover:bg-[#FFDE32]/12">
                <td className="max-w-[300px] px-4 py-3">
                  <p className="line-clamp-2 text-sm font-bold leading-6 text-[#1A1A1A]">{upload.title}</p>
                  <p className="mt-1 text-xs font-semibold text-[#1A1A1A]/38">{upload.sourceAuthor || "TikTok source"}</p>
                </td>
                <td className="px-4 py-3 text-sm font-semibold text-[#1A1A1A]/70">{upload.movieTitle || "Unknown"} {upload.movieYear}</td>
                <td className="max-w-[220px] px-4 py-3 text-xs leading-5 text-[#1A1A1A]/55">{upload.microNiche || upload.genre || "Pending"}</td>
                <td className="px-4 py-3 text-right text-sm font-bold text-[#1A1A1A]">{compact(metric(upload, "viewCount"))}</td>
                <td className="px-4 py-3 text-right text-sm font-bold text-[#1A1A1A]">{compact(metric(upload, "commentCount"))}</td>
                <td className="px-4 py-3"><StatusPill status={upload.status} /></td>
                <td className="px-4 py-3 text-xs font-semibold text-[#1A1A1A]/40">{formatDate(upload.scheduleAt || upload.createdAt)}</td>
              </tr>
            ))}
            {!uploads.length ? (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-sm font-semibold text-[#1A1A1A]/45">No uploads yet. Run one candidate from Setup or Overview.</td>
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
}: {
  upload: AutomationUpload;
  onBack: () => void;
  onReupload: (id: string) => Promise<void>;
  reuploading: string;
}) {
  const movie = upload.metrics?.movie || {};
  const analytics = upload.metrics?.analytics || {};
  const totals = analytics?.totals || {};
  const sourceStats = upload.metrics?.sourceStats || {};
  const daily = Array.isArray(analytics?.daily) ? analytics.daily : [];
  const confidence = Number(movie.confidence || 0);
  const tmdb = movie.tmdb || {};

  return (
    <section className="space-y-5">
      <button type="button" onClick={onBack} className="inline-flex h-10 items-center gap-2 rounded-xl border border-[#1A1A1A]/10 bg-white px-4 text-xs font-bold text-[#1A1A1A] transition hover:border-[#FF0033]/25 hover:text-[#FF0033]">
        <ArrowLeft className="h-4 w-4" />
        Back to uploads
      </button>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(280px,0.75fr)]">
        <div className="rounded-xl border border-[#1A1A1A]/8 bg-[#FDFCFA] p-5">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-[#FF0033]">Uploaded post</p>
              <h2 className="mt-2 font-serif text-2xl font-bold leading-tight text-[#1A1A1A]">{upload.title}</h2>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-[#1A1A1A]/60">{upload.description || "No description stored for this upload."}</p>
            </div>
            <StatusPill status={upload.status} />
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            {upload.youtubeUrl ? (
              <a href={upload.youtubeUrl} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#1A1A1A] px-4 text-xs font-bold text-white transition hover:bg-[#FF0033]">
                <Youtube className="h-4 w-4" />
                Open on YouTube
              </a>
            ) : null}
            {upload.sourceUrl ? (
              <a href={upload.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center gap-2 rounded-xl border border-[#1A1A1A]/10 bg-white px-4 text-xs font-bold text-[#1A1A1A] transition hover:border-[#FF0033]/25 hover:text-[#FF0033]">
                <ExternalLink className="h-4 w-4" />
                Source TikTok
              </a>
            ) : null}
            <button type="button" onClick={() => void onReupload(upload.id)} disabled={reuploading === upload.id} className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#FFDE32] px-4 text-xs font-bold text-[#1A1A1A] transition hover:bg-[#FF0033] hover:text-white disabled:opacity-50">
              {reuploading === upload.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Reupload HD test
            </button>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
          <MetricTile icon={<Eye className="h-4 w-4" />} label="Views" value={compact(metric(upload, "viewCount"))} />
          <MetricTile icon={<Heart className="h-4 w-4" />} label="Likes" value={compact(metric(upload, "likeCount"))} />
          <MetricTile icon={<MessageSquare className="h-4 w-4" />} label="Comments" value={compact(metric(upload, "commentCount"))} />
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(280px,360px)]">
        <section className="rounded-xl border border-[#1A1A1A]/8 bg-white p-5">
          <SectionTitle title="Movie ID" body="Identification, evidence, and TMDB context captured before upload." />
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            <InfoRow label="Movie" value={`${upload.movieTitle || movie.title || "Unknown"} ${upload.movieYear || movie.year || ""}`} />
            <InfoRow label="Genre" value={upload.genre || movie.genre || "Pending"} />
            <InfoRow label="Confidence" value={confidence ? percent(confidence) : "Pending"} />
            <InfoRow label="Micro-sub-niche" value={upload.microNiche || "Pending"} />
          </div>
          {movie.summary || tmdb.overview ? <p className="mt-5 rounded-xl bg-[#F9F8F6] p-4 text-sm leading-7 text-[#1A1A1A]/65">{movie.summary || tmdb.overview}</p> : null}
          <div className="mt-5 grid gap-3 md:grid-cols-3">
            <Evidence label="Audio" value={movie.evidence?.audio} />
            <Evidence label="Visual" value={movie.evidence?.visual} />
            <Evidence label="Reasoning" value={movie.evidence?.reasoning} />
          </div>
          {tmdb.tmdbUrl ? (
            <a href={tmdb.tmdbUrl} target="_blank" rel="noreferrer" className="mt-4 inline-flex h-10 items-center gap-2 rounded-xl border border-[#1A1A1A]/10 bg-white px-4 text-xs font-bold text-[#1A1A1A] transition hover:border-[#FF0033]/25 hover:text-[#FF0033]">
              <ExternalLink className="h-4 w-4" />
              Open TMDB
            </a>
          ) : null}
        </section>

        <section className="rounded-xl border border-[#1A1A1A]/8 bg-[#FDFCFA] p-5">
          <SectionTitle title="Source signals" body="Useful context for the agent learning loop." />
          <div className="mt-4 space-y-3">
            <InfoRow label="TikTok author" value={upload.sourceAuthor || "Unknown"} />
            <InfoRow label="Source plays" value={compact(sourceStats.playCount || sourceStats.plays || sourceStats.views)} />
            <InfoRow label="Source likes" value={compact(sourceStats.diggCount || sourceStats.likes)} />
            <InfoRow label="File rename" value={upload.metrics?.fileName || "Pending"} />
          </div>
        </section>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <section className="rounded-xl border border-[#1A1A1A]/8 bg-white p-5">
          <SectionTitle title="Performance" body="Public stats and YouTube Analytics totals captured by the scheduler." />
          <div className="mt-5 grid gap-3 md:grid-cols-3">
            <MiniStat label="Watch minutes" value={compact(totals.estimatedMinutesWatched)} />
            <MiniStat label="Avg duration" value={`${compact(totals.averageViewDuration)}s`} />
            <MiniStat label="Subscribers" value={compact(totals.subscribersGained)} />
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

        <section className="rounded-xl border border-[#1A1A1A]/8 bg-[#FDFCFA] p-5">
          <SectionTitle title="Community management" body="The agent checks recent comments, answers movie-name questions, and can use AI to reply for stronger engagement." />
          <div className="mt-5 space-y-3">
            <Step icon={<MessageCircle className="h-4 w-4" />} label="Trigger" body="Comments asking for the movie name, title, source, sauce, film, show, or series." />
            <Step icon={<Film className="h-4 w-4" />} label="Reply" body={`Movie: ${upload.movieTitle || "Identified title"}${upload.movieYear ? ` (${upload.movieYear})` : ""}`} />
            <Step icon={<Sparkles className="h-4 w-4" />} label="AI engagement" body="When enabled, useful non-movie comments get short contextual replies in the agent's tone." />
            <Step icon={<CalendarClock className="h-4 w-4" />} label="Timing" body="Runs during the same performance checks used for views, likes, and comments." />
          </div>
          <p className="mt-5 rounded-xl border border-[#FFDE32]/70 bg-[#FFDE32]/20 p-4 text-sm font-semibold leading-6 text-[#1A1A1A]/65">
            If a new comment does not show immediately, refresh after the next scheduled check or run a performance check from the server.
          </p>
        </section>
      </div>
    </section>
  );
}

function RunsPanel({ runs }: { runs: AutomationRun[] }) {
  return (
    <section className="space-y-4">
      <SectionTitle title="Run log" body="Every agent scan, upload, duplicate skip, and error appears here." />
      <div className="rounded-xl border border-[#1A1A1A]/8 bg-white">
        <div className="divide-y divide-[#1A1A1A]/8">
          {runs.map((run) => (
            <div key={run.id} className="grid gap-3 p-4 md:grid-cols-[140px_minmax(0,1fr)_180px]">
              <div>
                <StatusPill status={run.status} />
              </div>
              <div>
                <p className="text-sm font-semibold leading-6 text-[#1A1A1A]">{run.message}</p>
                {run.details ? <pre className="mt-2 max-h-36 overflow-auto rounded-lg bg-[#F9F8F6] p-3 text-xs leading-5 text-[#1A1A1A]/55">{JSON.stringify(run.details, null, 2)}</pre> : null}
              </div>
              <div className="text-xs font-semibold text-[#1A1A1A]/40 md:text-right">
                <p>{formatDate(run.startedAt)}</p>
                {run.finishedAt ? <p className="mt-1">Done {formatDate(run.finishedAt)}</p> : null}
              </div>
            </div>
          ))}
          {!runs.length ? <p className="p-8 text-center text-sm font-semibold text-[#1A1A1A]/45">No runs yet.</p> : null}
        </div>
      </div>
    </section>
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
  const color = tone === "success" ? "border-green-100 bg-green-50 text-green-800" : tone === "error" ? "border-red-100 bg-red-50 text-red-800" : "border-amber-100 bg-amber-50 text-amber-900";
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

function SectionTitle({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <h2 className="text-base font-bold text-[#1A1A1A]">{title}</h2>
      <p className="mt-1 max-w-2xl text-sm leading-6 text-[#1A1A1A]/55">{body}</p>
    </div>
  );
}

function MetricTile({ icon, label, value }: { icon: ReactNode; label: string; value: ReactNode }) {
  return (
    <div className="rounded-xl border border-[#1A1A1A]/8 bg-white p-4">
      <div className="flex items-center gap-2 text-[#FF0033]">{icon}<span className="text-[11px] font-bold uppercase tracking-widest text-[#1A1A1A]/35">{label}</span></div>
      <p className="mt-3 truncate text-sm font-bold text-[#1A1A1A]">{value}</p>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-lg bg-[#F9F8F6] p-3">
      <p className="text-[11px] font-bold uppercase tracking-widest text-[#1A1A1A]/35">{label}</p>
      <p className="mt-1 text-sm font-bold text-[#1A1A1A]">{value}</p>
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

function StepTile({ icon, label, body }: { icon: ReactNode; label: string; body: string }) {
  return (
    <div className="rounded-xl border border-[#1A1A1A]/8 bg-white p-4">
      <div className="grid h-9 w-9 place-items-center rounded-lg bg-[#FF0033]/10 text-[#FF0033]">{icon}</div>
      <p className="mt-3 text-sm font-bold text-[#1A1A1A]">{label}</p>
      <p className="mt-1 text-sm leading-6 text-[#1A1A1A]/55">{body}</p>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-xl bg-[#F9F8F6] p-3">
      <p className="text-[11px] font-bold uppercase tracking-widest text-[#1A1A1A]/35">{label}</p>
      <p className="mt-1 text-sm font-semibold leading-6 text-[#1A1A1A]/70">{value || "Pending"}</p>
    </div>
  );
}

function Evidence({ label, value }: { label: string; value?: string }) {
  return (
    <div className="rounded-xl border border-[#1A1A1A]/8 bg-[#FDFCFA] p-4">
      <div className="flex items-center gap-2 text-[#FF0033]">
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
      <div className="mt-0.5 text-[#FF0033]">{icon}</div>
      <p className="text-sm leading-6 text-[#1A1A1A]/60"><span className="font-bold text-[#1A1A1A]">{label}:</span> {body}</p>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const clean = String(status || "pending");
  const label = clean === "hd_test" ? "HD test" : clean;
  const success = ["uploaded", "scheduled", "success", "active", "hd_test"].includes(clean);
  const error = ["error", "failed"].includes(clean);
  return (
    <span className={cn(
      "inline-flex w-fit rounded-full px-2.5 py-1 text-[10px] font-bold uppercase",
      success ? "bg-green-50 text-green-700" : error ? "bg-red-50 text-red-700" : "bg-[#1A1A1A]/5 text-[#1A1A1A]/50"
    )}>
      {label}
    </span>
  );
}
