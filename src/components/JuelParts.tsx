// What Juel shows under a reply and the buttons it offers: an automation agent operator's answer (the old
// agent chat's report, cards, live blocks, specialist checks, settings changes, and one-click actions) and
// the generations Juel started, previewed as they finish. Also the credits toast and voice input.
import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, AlertCircle, ArrowUpRight, BarChart3, Bot, CheckCircle2, ChevronDown, Clock3, Coins, Eye, Layers3, Loader2, Navigation, Play, RefreshCw, Settings2, Sparkles, Square, TrendingUp } from "lucide-react";
import { AgentChatBlocks, FormattedChatText, type AgentChatBlock } from "./AgentStructuredContent";
import { AudioPlayer } from "./AudioPlayer";
import { VideoPlayer } from "./VideoPlayer";
import { announceBackgroundProcess } from "../utils/backgroundProcesses";
import { toast } from "../utils/toast";
import { writeDeepLink } from "../utils/tiktokRoute";

export type OperatorAction = {
  type: "navigate" | "internal_tool" | "agent_tab" | "run_candidate" | "stop_candidate" | "run_compilation" | "performance_check" | "refresh_agent" | "creator_stage";
  label: string;
  payload?: { view?: any; tool?: any; tab?: any; section?: any; url?: string; query?: string; projectId?: string; projectStage?: string; mediaAction?: string };
};
type ReportCard = { label: string; value: string; tone?: "good" | "warn" | "neutral" };
export type OperatorAttachment = {
  kind: "operator";
  agentId: string;
  reply: string;
  presentation: { title: string; summary: string; html: string; cards: ReportCard[] } | null;
  cards: ReportCard[];
  blocks: AgentChatBlock[];
  actions: OperatorAction[];
  subagents: Array<{ id: string; name: string; status: "completed" | "failed"; summary: string }>;
  applied: string[];
  unapplied: Array<{ key: string; reason: string }>;
};
export type GenerationAttachment = { kind: "generation"; id: string; tab: string; prompt: string };
export type JuelAttachment = OperatorAttachment | GenerationAttachment;
export type JuelSpend = { specialist?: string; does: string; credits: number; status: "started" | "refused" };

const theme = (): "light" | "dark" => (document.documentElement.dataset.theme === "light" ? "light" : "dark");
export const formatCredits = (n: number) => Math.max(0, Math.round(n)).toLocaleString("en-US");

/** Quick starts for an open automation agent: the old agent chat's shortcuts. */
export const AGENT_STARTERS = [
  { label: "Performance report", prompt: "Give me a performance report with a table", icon: BarChart3 },
  { label: "Channel competitors", prompt: "Run fresh niche discovery and show my channel competitors", icon: Eye },
  { label: "Niche radar", prompt: "Run a fresh niche radar scan and show recent viral competitor videos", icon: TrendingUp },
  { label: "Optimize strategy", prompt: "Review this agent and recommend the single highest-impact optimization", icon: Sparkles },
  { label: "Update schedule", prompt: "Review my publishing schedule and suggest a better cadence based on current performance", icon: Clock3 },
  { label: "Run candidate", prompt: "Run candidate now", icon: Play },
  { label: "Inspect settings", prompt: "Show all current agent settings without changing anything", icon: Settings2 },
  { label: "Background activity", prompt: "Show background processes, progress, and ETA", icon: Activity },
];

// ---------- Credits ----------

/** The low-balance toast: what the task needs against the balance, and a way to get more credits. */
export function creditsToast(message: string, needed: number, balance: number | null) {
  toast.credits(message, {
    meter: { needed, balance },
    action: { label: "Get credits", onClick: () => writeDeepLink({ view: "account", accountSection: "billing" } as any) },
  });
}

type Quote = { credits: number; does: string; short: { balance: number; needed: number; message: string } | null };
export async function quoteCall(method: string, path: string, body?: unknown): Promise<Quote> {
  const response = await fetch("/api/juel/quote", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ method, path, body }) });
  return response.ok ? response.json() : { credits: 0, does: "", short: null };
}

/** Runs a paid call the user clicked: quoted first, refused with the credits toast when the balance is short. */
async function spendAndRun(method: string, path: string, body?: Record<string, unknown>) {
  const quote = await quoteCall(method, path, body).catch(() => null);
  if (quote?.short) {
    creditsToast(quote.short.message, quote.short.needed, quote.short.balance);
    return null;
  }
  const response = await fetch(path, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const data = await response.json().catch(() => ({}));
  if (response.status === 402) {
    creditsToast(String(data.error || "You're out of credits."), quote?.credits || 0, null);
    return null;
  }
  if (!response.ok) throw new Error(String(data.error || "That didn't work"));
  return { data, credits: quote?.credits || 0 };
}
const withCost = (text: string, credits: number) => (credits ? `${text} · ≈ ${formatCredits(credits)} credits` : text);

// ---------- Operator actions ----------

const PAID_ACTIONS = new Set(["run_candidate", "run_compilation", "creator_stage"]);
const actionCall = (action: OperatorAction, agentId: string) => {
  const agent = `/api/automation/agents/${encodeURIComponent(agentId)}`;
  if (action.type === "run_candidate") return { method: "POST", path: `${agent}/run` };
  if (action.type === "run_compilation") return { method: "POST", path: `${agent}/run-compilation` };
  if (action.type === "creator_stage") return { method: "POST", path: `/api/maker/projects/${encodeURIComponent(String(action.payload?.projectId || ""))}/jobs/${encodeURIComponent(String(action.payload?.projectStage || ""))}`, body: { ...(action.payload?.mediaAction ? { action: action.payload.mediaAction } : {}) } };
  return null;
};
const changed = () => window.dispatchEvent(new CustomEvent("juel:changed"));
const openAgentTab = (tab: string) => window.dispatchEvent(new CustomEvent("juel:page-actions", { detail: { surface: "automation", actions: [{ type: "open_tab", args: { tab } }] } }));

/** Runs one of the operator's buttons, as the old agent chat did. `ask` sends a follow-up message to Juel. */
export async function runOperatorAction(action: OperatorAction, agentId: string, ask: (text: string) => void) {
  const agent = `/api/automation/agents/${encodeURIComponent(agentId)}`;
  if (action.type === "navigate") {
    const view = String(action.payload?.view || "");
    if (view === "tiktok") {
      writeDeepLink({ view: "tiktok", section: action.payload?.section === "saved" ? "saved" : "analyze", tab: action.payload?.tab === "channel" ? "channel" : action.payload?.tab === "collection" ? "collection" : undefined, url: action.payload?.url || undefined } as any, false);
    } else if (["tools", "movie", "youtube", "niches", "feed", "channels", "compile", "automation", "rewriter", "tts", "discover", "projects", "create", "styles", "drama"].includes(view)) {
      writeDeepLink({ view, projectId: action.payload?.projectId, projectStage: action.payload?.projectStage, discoveryQuery: view === "discover" ? action.payload?.query || undefined : undefined } as any, false);
    }
    return;
  }
  if (action.type === "agent_tab") return openAgentTab(String(action.payload?.tab || "overview"));
  if (action.type === "refresh_agent") return changed();
  if (action.type === "internal_tool") {
    const tool = String(action.payload?.tool || "");
    const query = action.payload?.query ? ` for ${action.payload.query}` : "";
    const url = action.payload?.url ? ` ${action.payload.url}` : "";
    return ask(`Run ${tool || action.label} internally${query}${url}`.trim());
  }
  if (action.type === "stop_candidate") {
    const response = await fetch(`${agent}/stop`, { method: "POST" });
    if (!response.ok) throw new Error(String((await response.json().catch(() => ({}))).error || "Could not stop the run"));
    announceBackgroundProcess();
    changed();
    return void toast.success("Stop requested. The run exits after its current safe step, before publishing.");
  }
  if (action.type === "performance_check") {
    const response = await fetch("/api/automation/performance/check", { method: "POST" });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(String(result.error || "Performance refresh failed"));
    changed();
    const n = Number(result.refreshed || 0);
    return void toast.success(`Refreshed ${n} upload${n === 1 ? "" : "s"} from the connected platforms${Number(result.failed || 0) ? `; ${result.failed} could not be refreshed` : ""}.`, { action: { label: "View analytics", onClick: () => openAgentTab("analytics") } });
  }
  if (action.type === "creator_stage") {
    const call = actionCall(action, agentId)!;
    const agentData = await fetch(agent).then((r) => r.json()).catch(() => ({}));
    const done = await spendAndRun("POST", call.path, { ...call.body, confirmed: true, accountId: agentData.agent?.youtubeAccountId });
    if (!done) return;
    announceBackgroundProcess();
    return void toast.success(withCost(`${action.label.replace(/^Approve\s+/i, "")} is queued`, done.credits), { action: { label: "Open project", onClick: () => writeDeepLink({ view: "projects", projectId: action.payload?.projectId, projectStage: action.payload?.projectStage } as any, false) } });
  }
  if (action.type === "run_compilation") {
    const settings = ((await fetch(agent).then((r) => r.json()).catch(() => ({}))).agent?.settings || {}) as Record<string, any>;
    const done = await spendAndRun("POST", `${agent}/run-compilation`, {
      minMinutes: settings.compilationMinMinutes,
      maxMinutes: settings.compilationMaxMinutes,
      maxClips: settings.compilationMaxClips,
      title: settings.compilationTitle,
      description: settings.compilationDescription,
      layout: settings.compilationLayout,
      playlistId: settings.targetPlaylistMode === "existing" ? settings.targetPlaylistId : "",
      createPlaylistTitle: settings.targetPlaylistMode === "create" ? settings.targetPlaylistTitle : "",
      categoryId: settings.categoryId,
      madeForKids: settings.madeForKids === true,
    });
    if (!done) return;
    announceBackgroundProcess();
    changed();
    const jobId = String(done.data.job?.id || "");
    return void toast.success(withCost(`Compilation queued${jobId ? ` as ${jobId.slice(0, 8)}` : ""}; it runs in the background`, done.credits), { action: { label: "Open compilations", onClick: () => openAgentTab("compile") } });
  }
  if (action.type === "run_candidate") {
    const quote = await quoteCall("POST", `${agent}/run`).catch(() => null);
    if (quote?.short) return creditsToast(quote.short.message, quote.short.needed, quote.short.balance);
    // A run takes minutes: it goes on in the background and reports when it ends.
    toast.info(withCost("Run started through the normal automation pipeline", quote?.credits || 0), { action: { label: "Open run log", onClick: () => openAgentTab("runs") } });
    const request = fetch(`${agent}/run`, { method: "POST" });
    window.setTimeout(announceBackgroundProcess, 400);
    const response = await request;
    const data = await response.json().catch(() => ({}));
    changed();
    if (response.status === 402) return creditsToast(String(data.error || "You're out of credits."), quote?.credits || 0, null);
    if (!response.ok) {
      if (/run stopped by user/i.test(String(data.error))) return void toast.success("The run stopped cleanly.");
      throw new Error(String(data.error || "The run failed"));
    }
    return void toast.success("The run finished and its upload is ready.", { action: { label: "Review uploads", onClick: () => openAgentTab("uploads") } });
  }
}

function actionIcon(action: OperatorAction) {
  switch (action.type) {
    case "navigate": return Navigation;
    case "internal_tool": return Sparkles;
    case "run_candidate":
    case "creator_stage": return Play;
    case "stop_candidate": return Square;
    case "run_compilation": return Layers3;
    case "performance_check":
    case "refresh_agent": return RefreshCw;
    default: return ArrowUpRight;
  }
}

// ---------- The operator's answer ----------

/** The report HTML the operator writes, kept to plain structure (no scripts, links, styles, or handlers). */
export function sanitizeReportHtml(input = ""): string {
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
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      const element = child as HTMLElement;
      if (!allowedTags.has(element.tagName)) {
        element.replaceWith(document.createTextNode(element.textContent || ""));
        continue;
      }
      for (const attr of Array.from(element.attributes)) {
        if (attr.name === "class") {
          const safe = attr.value.split(/\s+/).filter((value) => allowedClasses.has(value));
          if (safe.length) element.setAttribute("class", safe.join(" "));
          else element.removeAttribute("class");
        } else element.removeAttribute(attr.name);
      }
      walk(element);
    }
  };
  walk(template.content);
  return template.innerHTML;
}

export function OperatorAnswer({ answer, onAsk }: { answer: OperatorAttachment; onAsk: (text: string) => void }) {
  const look = theme();
  const html = useMemo(() => sanitizeReportHtml(answer.presentation?.html || ""), [answer.presentation?.html]);
  const cards = answer.presentation?.cards?.length ? answer.presentation.cards : answer.cards;
  const [busy, setBusy] = useState("");
  // Paid buttons show what they cost before they're pressed.
  const [costs, setCosts] = useState<Record<string, number>>({});
  useEffect(() => {
    let live = true;
    for (const action of answer.actions.filter((a) => PAID_ACTIONS.has(a.type))) {
      const call = actionCall(action, answer.agentId);
      if (call) void quoteCall(call.method, call.path, call.body).then((q) => live && q.credits && setCosts((c) => ({ ...c, [action.label]: q.credits }))).catch(() => undefined);
    }
    return () => {
      live = false;
    };
  }, [answer.actions, answer.agentId]);
  const press = async (action: OperatorAction) => {
    if (busy) return;
    setBusy(action.label);
    try {
      await runOperatorAction(action, answer.agentId, onAsk);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "That didn't work");
    } finally {
      setBusy("");
    }
  };
  return (
    <section className="juel-operator" aria-label="The agent's answer">
      <p className="juel-operator-head"><Bot size={14} aria-hidden="true" />From the agent</p>
      {answer.subagents.length ? (
        <details className="juel-checks">
          <summary>
            {answer.subagents.length} specialist check{answer.subagents.length === 1 ? "" : "s"}
            {answer.subagents.some((s) => s.status === "failed") ? <span className="is-warn"> · {answer.subagents.filter((s) => s.status === "failed").length} needs review</span> : null}
            <ChevronDown size={13} aria-hidden="true" />
          </summary>
          <ul>
            {answer.subagents.map((s) => (
              <li key={s.id}>
                {s.status === "completed" ? <CheckCircle2 size={13} aria-hidden="true" /> : <AlertCircle size={13} className="is-warn" aria-hidden="true" />}
                <span><b>{s.name}</b> {s.summary}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {answer.presentation?.title ? <h3 className="juel-report-title">{answer.presentation.title}</h3> : null}
      {answer.reply ? <div className="juel-operator-text"><FormattedChatText content={answer.reply} theme={look} /></div> : null}
      {answer.blocks.length ? <AgentChatBlocks blocks={answer.blocks} theme={look} /> : null}
      {!answer.blocks.length && cards.length ? (
        <div className="juel-metrics">
          {cards.map((card, i) => (
            <div key={`${i}-${card.label}`} className="juel-metric" data-tone={card.tone || "neutral"}>
              <span>{card.label}</span>
              <b>{card.value}</b>
            </div>
          ))}
        </div>
      ) : null}
      {!answer.blocks.length && html ? <div className="juel-report" dangerouslySetInnerHTML={{ __html: html }} /> : null}
      {answer.applied.length ? <p className="juel-applied"><CheckCircle2 size={13} aria-hidden="true" />Updated {answer.applied.join(", ")}</p> : null}
      {answer.unapplied.length ? <p className="juel-unapplied">Not applied: {answer.unapplied.map((u) => `${u.key} (${u.reason})`).join("; ")}</p> : null}
      {answer.actions.length ? (
        <div className="juel-actions">
          {answer.actions.map((action, i) => {
            const Icon = actionIcon(action);
            return (
              <button key={`${i}-${action.label}`} type="button" className="juel-action" disabled={Boolean(busy)} onClick={() => void press(action)}>
                {busy === action.label ? <Loader2 size={13} className="juel-spin" aria-hidden="true" /> : <Icon size={13} aria-hidden="true" />}
                {action.label}
                {costs[action.label] ? <span className="juel-cost"><Coins size={11} aria-hidden="true" />{formatCredits(costs[action.label])}</span> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

// ---------- Generations ----------

type Generation = { id: string; tab: string; prompt: string; status: string; message?: string; error?: string; outputs: Array<{ file: string; url: string; type: string }> };

/** A generation Juel started, shown as it runs and when it's done (the old Creative Agents' results). */
export function GenerationResult({ item }: { item: GenerationAttachment }) {
  const [generation, setGeneration] = useState<Generation | null>(null);
  const [zoom, setZoom] = useState("");
  useEffect(() => {
    let live = true;
    let timer = 0;
    const load = async () => {
      const data = await fetch(`/api/studio/generations${item.tab ? `?tab=${encodeURIComponent(item.tab)}` : ""}`, { cache: "no-store" }).then((r) => r.json()).catch(() => null);
      const found: Generation | undefined = (data?.generations || []).find((g: Generation) => g.id === item.id);
      if (!live) return;
      if (found) setGeneration(found);
      if (!found || found.status === "queued" || found.status === "running") timer = window.setTimeout(load, 4000);
    };
    void load();
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [item.id, item.tab]);
  const output = generation?.outputs?.[0];
  const pending = !generation || generation.status === "queued" || generation.status === "running";
  return (
    <figure className="juel-gen">
      {generation?.status === "done" && output ? (
        output.type.startsWith("image") ? (
          <div className="juel-gen-images">
            {generation.outputs.map((o) => (
              <button key={o.file} type="button" onClick={() => setZoom(o.url)} aria-label="Open full size"><img src={o.url} alt={item.prompt.slice(0, 100)} loading="lazy" /></button>
            ))}
          </div>
        ) : output.type.startsWith("video") ? (
          <VideoPlayer className="juel-gen-video" src={output.url} label="Generated video" />
        ) : (
          <AudioPlayer src={output.url} title="Generated audio" download />
        )
      ) : (
        <p className="juel-gen-status">
          {pending ? <Loader2 size={14} className="juel-spin" aria-hidden="true" /> : <AlertCircle size={14} aria-hidden="true" />}
          {pending ? `${generation?.message || "Generating"}…` : generation?.error || "That generation failed"}
        </p>
      )}
      {item.prompt ? <figcaption>{item.prompt}</figcaption> : null}
      {zoom ? (
        <div className="juel-zoom" role="dialog" aria-label="Full size" onClick={() => setZoom("")}>
          <img src={zoom} alt={item.prompt.slice(0, 100)} />
        </div>
      ) : null}
    </figure>
  );
}

// ---------- Voice input ----------

/** Hold-to-talk free: press the mic, speak, press again; the audio is transcribed and handed to `onText`. */
export function useVoiceInput(onText: (text: string) => void, onError: (message: string) => void) {
  const [state, setState] = useState<"idle" | "recording" | "transcribing">("idle");
  const [level, setLevel] = useState(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const frame = useRef(0);
  const audio = useRef<AudioContext | null>(null);
  const release = () => {
    cancelAnimationFrame(frame.current);
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    void audio.current?.close().catch(() => undefined);
    audio.current = null;
    setLevel(0);
  };
  useEffect(() => () => {
    recorder.current?.state === "recording" && recorder.current.stop();
    release();
  }, []);
  const start = async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") return onError("This browser can't record audio.");
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      stream.current = media;
      if (typeof AudioContext !== "undefined") {
        const context = new AudioContext();
        const analyser = context.createAnalyser();
        analyser.fftSize = 256;
        context.createMediaStreamSource(media).connect(analyser);
        audio.current = context;
        const data = new Uint8Array(analyser.frequencyBinCount);
        const tick = () => {
          analyser.getByteTimeDomainData(data);
          let peak = 0;
          for (const v of data) peak = Math.max(peak, Math.abs(v - 128));
          setLevel(Math.min(1, peak / 64));
          frame.current = requestAnimationFrame(tick);
        };
        tick();
      }
      const chunks: Blob[] = [];
      const rec = new MediaRecorder(media);
      rec.ondataavailable = (event) => event.data.size && chunks.push(event.data);
      rec.onstop = async () => {
        release();
        const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
        if (!blob.size) return setState("idle");
        setState("transcribing");
        try {
          const response = await fetch("/api/automation/agents/chat/transcribe", { method: "POST", headers: { "Content-Type": blob.type || "application/octet-stream" }, body: blob, signal: AbortSignal.timeout(90000) });
          const data = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(String(data.error || "Voice transcription failed"));
          const text = String(data.text || "").replace(/\s+/g, " ").trim();
          if (!text) throw new Error("No speech was detected. Try again a little closer to the microphone.");
          onText(text);
        } catch (error) {
          onError(error instanceof DOMException && error.name === "TimeoutError" ? "Transcription took too long. Try a shorter voice note." : error instanceof Error ? error.message : "Voice transcription failed");
        } finally {
          setState("idle");
        }
      };
      recorder.current = rec;
      rec.start();
      setState("recording");
    } catch {
      release();
      onError("Microphone access was blocked. Allow it in the browser to talk to Juel.");
    }
  };
  const stop = () => recorder.current?.state === "recording" && recorder.current.stop();
  return { state, level, toggle: () => (state === "recording" ? stop() : state === "idle" ? void start() : undefined) };
}
