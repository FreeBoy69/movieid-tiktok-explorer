// Juel: the one AutoYT agent, from the header anywhere in the app (or ⌘J), and in place of a page's own
// chat (Vibe Edit, automation agents, Creative Studio agents). It knows the page you're on (pages announce
// it), streams what its specialists do, runs paid work straight away with its credit cost shown (a balance
// that can't cover it gets the credits toast), and shows an agent operator's answers and generations inline.
import { FormEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertCircle, ArrowUp, Check, Coins, Copy, History, Loader2, Mic, Pencil, Plus, RotateCcw, Sparkles, Square, Trash2, X } from "lucide-react";
import { readDeepLink } from "../utils/tiktokRoute";
import { toast } from "../utils/toast";
import { FormattedChatText } from "./AgentStructuredContent";
import { AGENT_STARTERS, creditsToast, formatCredits, GenerationResult, type JuelAttachment, type JuelSpend, OperatorAnswer, useVoiceInput } from "./JuelParts";
import "./JuelPanel.css";

type PageAction = { type: string; args: Record<string, unknown> };
type Step = { specialist: string; text: string };
type Message = { role: "user" | "assistant"; content: string; steps?: Step[]; spends?: JuelSpend[]; attachments?: JuelAttachment[]; applied?: number; charged?: number; error?: boolean; stopped?: boolean; at: string };
type Thread = { id: string; title: string; surface?: string; entityId?: string; messages: Message[] };
type ThreadSummary = { id: string; title: string; surface: string; entityId: string; updatedAt: string };
type Live = { text: string; steps: Step[]; spends: JuelSpend[]; attachments: JuelAttachment[] };
/** What a page offers Juel to do on it, in the browser: which specialist uses it, and each action's args,
 *  what it does, its risk, and (for paid ones) a cost spec like "speech" or "image:2" for the quote. */
export type JuelPageTools = { specialist: string; actions: Record<string, { args: string; about: string; risk: "read" | "change" | "paid" | "publish" | "delete"; cost?: string }> };
/** Where the user is. `starters` are the page's quick prompts; `details.persona` picks a Creative Studio persona. */
export type JuelContext = { surface: string; entityId?: string; label?: string; details?: any; clientTools?: JuelPageTools; starters?: Array<{ label: string; prompt: string }>; intro?: { title: string; body: string } };

const SPECIALIST: Record<string, string> = { automation: "Automation", publisher: "Publisher", recap: "Recap", editor: "Editor", producer: "Producer", studio: "Studio", film: "Film", research: "Research", community: "Community", account: "Account", admin: "Admin" };

// The latest page announcement, kept so a panel opened later still starts from it, and a page's live
// context provider (read at the moment a message is sent, so Juel sees the edit as it is now).
let lastContext: JuelContext | null = null;
let contextProvider: (() => JuelContext) | null = null;

/** Announce what the open page shows, so Juel starts from it. Call with null when it closes. */
export function setJuelContext(context: JuelContext | null) {
  lastContext = context;
  window.dispatchEvent(new CustomEvent("juel:context", { detail: context }));
}

/** A page with live state (Vibe Edit) gives Juel a function returning its current context, and handles
 *  "juel:page-actions" events ({ surface, actions }) to run Juel's edits. Returns the unregister function. */
export function provideJuelContext(provider: () => JuelContext) {
  contextProvider = provider;
  setJuelContext(provider());
  return () => {
    if (contextProvider === provider) contextProvider = null;
    setJuelContext(null);
  };
}

const runOnPage = (surface: string, actions: PageAction[]) => window.dispatchEvent(new CustomEvent("juel:page-actions", { detail: { surface, actions } }));

/** Juel finished a turn or ran an action, so what the open page shows may be out of date. Pages that load
 *  their data once pass a reload here. Returns the unsubscribe function. */
export function onJuelChange(reload: () => void) {
  const handler = () => reload();
  window.addEventListener("juel:changed", handler);
  return () => window.removeEventListener("juel:changed", handler);
}
const announceChange = () => window.dispatchEvent(new CustomEvent("juel:changed"));

// A message asked from elsewhere (the automation page's dock) for the next panel to send: the open one
// takes it at once; one that opens for it takes it on mount.
let pendingAsk = "";
export function askJuel(text: string) {
  pendingAsk = text.trim().slice(0, 4000);
  window.dispatchEvent(new CustomEvent("juel:ask"));
}

/** A one-line "Ask Juel" box for pages whose full Juel is a tab away: sending hands the message over and
 *  opens it (`onOpen` shows the tab with the embedded panel). */
export function JuelDock({ placeholder = "Ask Juel about this agent…", onOpen }: { placeholder?: string; onOpen: () => void }) {
  const [text, setText] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!text.trim()) return;
    askJuel(text);
    setText("");
    onOpen();
  };
  return (
    <form className="juel-dock" onSubmit={submit}>
      <Sparkles size={15} aria-hidden="true" />
      <input value={text} onChange={(event) => setText(event.target.value)} placeholder={placeholder} aria-label="Ask Juel" maxLength={4000} />
      <button type="submit" className="juel-send" disabled={!text.trim()} aria-label="Send to Juel"><ArrowUp size={16} /></button>
    </form>
  );
}

/** The page's context from the route, when the page itself hasn't announced one. */
function routeContext(): JuelContext {
  const link = readDeepLink();
  if (link.view === "vibe-edit" && link.projectId) return { surface: "editor", entityId: link.projectId, label: "Vibe Edit" };
  if (link.projectId && ["create", "maker", "creator"].some((v) => String(link.view).includes(v))) return { surface: "producer", entityId: link.projectId, label: "Create Video" };
  if (link.seriesId) return { surface: "film", entityId: link.seriesId, label: "Create Film" };
  if (link.view === "automation") return { surface: "automation", label: "Automation agents" };
  if (link.toolId === "movie-recap") return { surface: "recap", label: "Movie to Recap" };
  return { surface: String(link.view || "home"), label: String(link.toolId || link.view || "AutoYT") };
}

// The conversation each page had open last, so returning to an agent (or an edit) picks it back up.
const pageKey = (c: JuelContext) => `juel:thread:${c.surface}:${c.entityId || c.details?.persona || ""}`;
const remembered = (c: JuelContext) => {
  try {
    return window.localStorage.getItem(pageKey(c)) || "";
  } catch {
    return "";
  }
};
const remember = (c: JuelContext, id: string) => {
  try {
    if (id) window.localStorage.setItem(pageKey(c), id);
    else window.localStorage.removeItem(pageKey(c));
  } catch {}
};

const DEFAULT_STARTERS = [
  { label: "What can you do here?", prompt: "What can you do for me on this page?" },
  { label: "How are my channels doing?", prompt: "How are my channels and agents doing this week?" },
  { label: "Make a recap", prompt: "Make a movie recap from a film link I'll paste" },
];

export function JuelButton() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "j") {
        event.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <>
      <button type="button" className={`juel-trigger${open ? " is-on" : ""}`} onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label="Ask Juel (⌘J)" title="Ask Juel (⌘J)">
        <Sparkles size={15} aria-hidden="true" />
        <span>Juel</span>
      </button>
      {open ? createPortal(<JuelPanel onClose={() => setOpen(false)} />, document.body) : null}
    </>
  );
}

/** Juel's conversation. The header panel uses it; a page can embed it in place of its own chat, where it
 *  fills its container and has no close button. `headStart` goes at the head's start (a page's collapse). */
export function JuelPanel({ onClose, embedded = false, headStart }: { onClose?: () => void; embedded?: boolean; headStart?: ReactNode }) {
  const [thread, setThread] = useState<Thread | null>(null);
  const [message, setMessage] = useState("");
  const [editFrom, setEditFrom] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  const [live, setLive] = useState<Live | null>(null);
  const [error, setError] = useState("");
  const [announced, setAnnounced] = useState<JuelContext | null>(lastContext);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [copied, setCopied] = useState(-1);
  const bottom = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const stopper = useRef<AbortController | null>(null);
  const context = announced || routeContext();
  const key = pageKey(context);

  useEffect(() => {
    const onContext = (event: Event) => setAnnounced((event as CustomEvent<JuelContext | null>).detail || null);
    window.addEventListener("juel:context", onContext);
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && !historyOpen && onClose?.();
    if (!embedded) {
      window.addEventListener("keydown", onKey);
      field.current?.focus();
    }
    return () => {
      window.removeEventListener("juel:context", onContext);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose, embedded, historyOpen]);

  // The page's last conversation comes back when the page (or the open agent) does. An agent's
  // conversations from before Juel come in first (the server imports them once).
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const id = remembered(context);
    setEditFrom(null);
    setReady(false);
    let active = true;
    const agent = context.surface === "automation" && context.entityId ? context.entityId : "";
    const imported = agent ? fetch(`/api/juel/threads?agent=${encodeURIComponent(agent)}`).catch(() => undefined) : Promise.resolve();
    void imported
      .then(() => (id ? fetch(`/api/juel/threads/${encodeURIComponent(id)}`).then((r) => (r.ok ? r.json() : null)) : null))
      .then((data) => active && setThread(data?.thread || null))
      .catch(() => undefined)
      .finally(() => active && setReady(true));
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [thread?.messages.length, live?.steps.length, live?.attachments.length]);

  const voice = useVoiceInput(
    (text) => setMessage((m) => [m.trim(), text].filter(Boolean).join(" ").slice(0, 4000)),
    (text) => toast.error(text),
  );

  const send = useCallback(async (override?: string, options: { editFrom?: number | null } = {}) => {
    const text = (override ?? message).trim();
    if (!text || sending) return;
    const from = options.editFrom !== undefined ? options.editFrom : editFrom;
    setSending(true);
    setError("");
    setMessage("");
    setEditFrom(null);
    // An edit (or asking again) drops the old tail right away; the server does the same.
    if (from !== null && thread) setThread({ ...thread, messages: thread.messages.slice(0, from) });
    setLive({ text, steps: [], spends: [], attachments: [] });
    // The page's state right now (an edit changes between messages), else what it announced.
    const now = contextProvider?.() || context;
    const controller = new AbortController();
    stopper.current = controller;
    try {
      const response = await fetch("/api/juel/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: text, threadId: thread?.id, context: now, ...(from !== null ? { editFrom: from } : {}) }), signal: controller.signal });
      if (!response.ok || !response.body) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Juel couldn't answer");
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const item = JSON.parse(line);
          if (item.type === "step") setLive((l) => (l ? { ...l, steps: [...l.steps, { specialist: item.specialist, text: item.text }] } : l));
          else if (item.type === "spend") setLive((l) => (l ? { ...l, spends: [...l.spends, item.spend] } : l));
          else if (item.type === "attach") setLive((l) => (l ? { ...l, attachments: [...l.attachments, item.attachment] } : l));
          else if (item.type === "credits") {
            creditsToast(item.message, Number(item.needed) || 0, item.balance ?? null);
            setLive((l) => (l ? { ...l, spends: [...l.spends, { does: item.does, credits: Number(item.needed) || 0, status: "refused" }] } : l));
          } else if (item.type === "page") runOnPage(item.surface, item.actions);
          else if (item.type === "done") {
            setThread(item.thread);
            remember(now, item.thread.id);
            announceChange();
          }
        }
      }
    } catch (err) {
      if (controller.signal.aborted) {
        // Stopped: the server saved what it had; show it on the next load.
        if (thread?.id) void fetch(`/api/juel/threads/${encodeURIComponent(thread.id)}`).then((r) => (r.ok ? r.json() : null)).then((d) => d?.thread && setThread(d.thread)).catch(() => undefined);
      } else {
        setMessage(text);
        setError(err instanceof Error ? err.message : "Juel couldn't answer");
      }
    } finally {
      stopper.current = null;
      setSending(false);
      setLive(null);
    }
  }, [message, sending, thread, context, editFrom]);

  // A message asked from the page's dock: sent once the page's conversation has loaded.
  const [asked, setAsked] = useState(0);
  useEffect(() => {
    const onAsk = () => setAsked((n) => n + 1);
    window.addEventListener("juel:ask", onAsk);
    return () => window.removeEventListener("juel:ask", onAsk);
  }, []);
  useEffect(() => {
    if (!ready || sending || !pendingAsk) return;
    const text = pendingAsk;
    pendingAsk = "";
    void send(text);
  }, [ready, asked, sending, send]);

  const newChat = () => {
    setThread(null);
    setError("");
    setEditFrom(null);
    remember(context, "");
    field.current?.focus();
  };
  const copy = async (text: string, index: number) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(index);
      window.setTimeout(() => setCopied(-1), 1500);
    } catch {
      toast.error("Couldn't copy that");
    }
  };
  const lastAssistant = thread ? thread.messages.map((m) => m.role).lastIndexOf("assistant") : -1;
  const regenerate = () => {
    if (!thread || lastAssistant < 1) return;
    const user = thread.messages[lastAssistant - 1];
    if (user?.role === "user") void send(user.content, { editFrom: lastAssistant - 1 });
  };
  const beginEdit = (index: number) => {
    setEditFrom(index);
    setMessage(thread?.messages[index]?.content || "");
    field.current?.focus();
  };

  const starters = context.starters?.length ? context.starters : context.surface === "automation" && context.entityId ? AGENT_STARTERS : DEFAULT_STARTERS;
  const intro = context.intro || { title: "Ask Juel anything in AutoYT", body: "It works with a team of specialists (recaps, editing, publishing, research, and more), runs what you ask straight away, and shows what each paid step costs in credits." };

  return (
    <aside className={`juel${embedded ? " juel-embedded" : ""}`} role={embedded ? undefined : "dialog"} aria-label="Juel">
      <header className="juel-head">
        {headStart}
        <span className="juel-title"><Sparkles size={16} aria-hidden="true" />Juel</span>
        <span className="juel-where" title="Juel starts from what you have open">{context.label || context.surface}</span>
        <button type="button" className={`juel-icon${historyOpen ? " is-on" : ""}`} onClick={() => setHistoryOpen((o) => !o)} aria-label="Conversations" aria-expanded={historyOpen} title="Conversations"><History size={16} /></button>
        <button type="button" className="juel-icon" onClick={newChat} aria-label="New conversation" title="New conversation"><Plus size={16} /></button>
        {onClose ? <button type="button" className="juel-icon" onClick={onClose} aria-label="Close Juel" title="Close (Esc)"><X size={16} /></button> : null}
      </header>
      {historyOpen ? (
        <Conversations
          context={context}
          current={thread?.id || ""}
          onClose={() => setHistoryOpen(false)}
          onPick={(picked) => {
            setThread(picked);
            remember(context, picked.id);
            setHistoryOpen(false);
          }}
          onDeleted={(id) => thread?.id === id && newChat()}
        />
      ) : null}
      <div className="juel-body">
        {!thread?.messages.length && !live ? (
          <div className="juel-empty">
            <strong>{intro.title}</strong>
            <p>{intro.body}</p>
            <div className="juel-starters">
              {starters.map((s) => (
                <button key={s.label} type="button" className="juel-starter" disabled={sending} onClick={() => void send(s.prompt)}>{s.label}</button>
              ))}
            </div>
          </div>
        ) : null}
        {thread?.messages.map((m, i) => (m.role === "user" ? (
          <div key={i} className={`juel-user-row${editFrom === i ? " is-editing" : ""}`}>
            <button type="button" className="juel-tool" onClick={() => beginEdit(i)} disabled={sending} aria-label="Edit this message" title="Edit"><Pencil size={13} /></button>
            <p className="juel-user">{m.content}</p>
          </div>
        ) : (
          <div key={i} className={`juel-reply${m.error ? " is-error" : ""}`}>
            {m.steps?.length ? <Steps steps={m.steps} /> : null}
            {m.content ? <div className="juel-text"><FormattedChatText content={m.content} theme={document.documentElement.dataset.theme === "light" ? "light" : "dark"} /></div> : null}
            {m.applied ? <p className="juel-applied"><Check size={13} aria-hidden="true" />Made {m.applied} edit{m.applied === 1 ? "" : "s"} on the page</p> : null}
            <Spends spends={m.spends} charged={m.charged} />
            <Attachments items={m.attachments} onAsk={(text) => void send(text)} />
            <div className="juel-tools">
              <button type="button" className="juel-tool" onClick={() => void copy(m.content, i)} aria-label="Copy reply" title="Copy">{copied === i ? <Check size={13} /> : <Copy size={13} />}</button>
              {i === lastAssistant ? <button type="button" className="juel-tool" onClick={regenerate} disabled={sending} aria-label="Ask again" title="Ask again"><RotateCcw size={13} /></button> : null}
            </div>
          </div>
        )))}
        {live ? (
          <>
            <p className="juel-user">{live.text}</p>
            <div className="juel-reply">
              <Steps steps={live.steps} working />
              <Spends spends={live.spends} />
              <Attachments items={live.attachments} onAsk={() => undefined} />
            </div>
          </>
        ) : null}
        {error ? <p className="juel-error" role="alert">{error}</p> : null}
        <div ref={bottom} />
      </div>
      <form className="juel-composer" onSubmit={(event: FormEvent) => { event.preventDefault(); void send(); }}>
        {editFrom !== null ? (
          <p className="juel-editing">
            <Pencil size={12} aria-hidden="true" />Editing an earlier message: sending replaces everything after it
            <button type="button" onClick={() => { setEditFrom(null); setMessage(""); }}>Cancel</button>
          </p>
        ) : null}
        <textarea
          ref={field}
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void send();
            }
          }}
          rows={2}
          maxLength={4000}
          placeholder={voice.state === "recording" ? "Listening… press the mic again when you're done" : voice.state === "transcribing" ? "Transcribing…" : "Ask Juel to find, make, fix, or post something…"}
          aria-label="Message Juel"
        />
        <div className="juel-composer-tools">
          <button
            type="button"
            className={`juel-mic${voice.state === "recording" ? " is-on" : ""}`}
            onClick={voice.toggle}
            disabled={voice.state === "transcribing" || sending}
            aria-label={voice.state === "recording" ? "Stop recording" : "Talk to Juel"}
            title={voice.state === "recording" ? "Stop recording" : "Talk to Juel"}
            style={{ ["--level" as string]: voice.level }}
          >
            {voice.state === "transcribing" ? <Loader2 size={15} className="juel-spin" /> : <Mic size={15} />}
          </button>
          {sending ? (
            <button type="button" className="juel-send is-stop" onClick={() => stopper.current?.abort()} aria-label="Stop" title="Stop"><Square size={13} /></button>
          ) : (
            <button type="submit" className="juel-send" disabled={!message.trim()} aria-label="Send"><ArrowUp size={16} /></button>
          )}
        </div>
      </form>
    </aside>
  );
}

function Steps({ steps, working = false }: { steps: Step[]; working?: boolean }) {
  return (
    <ol className="juel-steps">
      {steps.map((step, i) => (
        <li key={i}><b>{SPECIALIST[step.specialist] || step.specialist}</b> {step.text}</li>
      ))}
      {working ? <li className="juel-working"><Loader2 size={13} className="juel-spin" aria-hidden="true" />{steps.length ? "Working" : "Thinking"}</li> : null}
    </ol>
  );
}

/** What the turn spent: each paid step with its estimate, refusals for low credits, and what's been charged. */
function Spends({ spends, charged }: { spends?: JuelSpend[]; charged?: number }) {
  if (!spends?.length && !charged) return null;
  const started = (spends || []).filter((s) => s.status === "started");
  const total = started.reduce((sum, s) => sum + s.credits, 0);
  return (
    <div className="juel-spends">
      {(spends || []).map((s, i) => (
        <p key={i} className={`juel-spend${s.status === "refused" ? " is-refused" : ""}`}>
          {s.status === "refused" ? <AlertCircle size={13} aria-hidden="true" /> : <Coins size={13} aria-hidden="true" />}
          <span className="juel-spend-what">{s.does}</span>
          <span className="juel-spend-cost">{s.status === "refused" ? `needs ≈ ${formatCredits(s.credits)}` : `≈ ${formatCredits(s.credits)}`}</span>
        </p>
      ))}
      {started.length > 1 || charged ? (
        <p className="juel-spend-total">
          {started.length > 1 ? <span>About {formatCredits(total)} credits for this task</span> : <span />}
          {charged ? <span>{formatCredits(charged)} charged so far</span> : null}
        </p>
      ) : null}
    </div>
  );
}

function Attachments({ items, onAsk }: { items?: JuelAttachment[]; onAsk: (text: string) => void }) {
  if (!items?.length) return null;
  const generations = items.filter((a) => a.kind === "generation");
  return (
    <>
      {items.map((a, i) => (a.kind === "operator" ? <OperatorAnswer key={`op-${i}`} answer={a} onAsk={onAsk} /> : null))}
      {generations.length ? (
        <div className="juel-gens">
          {generations.map((a) => (a.kind === "generation" ? <GenerationResult key={a.id} item={a} /> : null))}
        </div>
      ) : null}
    </>
  );
}

/** Saved conversations: this page's (the open agent, edit, or film) first, then the rest. Delete has undo. */
function Conversations({ context, current, onClose, onPick, onDeleted }: { context: JuelContext; current: string; onClose: () => void; onPick: (thread: Thread) => void; onDeleted: (id: string) => void }) {
  const [threads, setThreads] = useState<ThreadSummary[] | null>(null);
  const [opening, setOpening] = useState("");
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    fetch("/api/juel/threads").then((r) => (r.ok ? r.json() : { threads: [] })).then((d) => setThreads(d.threads || [])).catch(() => setThreads([]));
    panel.current?.focus();
  }, []);
  const here = (t: ThreadSummary) => (context.entityId ? t.entityId === context.entityId : t.surface === context.surface);
  const groups = useMemo(() => {
    const list = threads || [];
    return [
      { title: "On this page", items: list.filter(here) },
      { title: "Everything else", items: list.filter((t) => !here(t)) },
    ].filter((g) => g.items.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threads, context.entityId, context.surface]);
  const open = async (id: string) => {
    setOpening(id);
    try {
      const data = await fetch(`/api/juel/threads/${encodeURIComponent(id)}`).then((r) => r.json());
      if (data.thread) onPick(data.thread);
    } finally {
      setOpening("");
    }
  };
  const remove = (t: ThreadSummary) => {
    setThreads((list) => (list || []).filter((x) => x.id !== t.id));
    onDeleted(t.id);
    // Deleting waits a few seconds, so Undo can bring it back.
    let undone = false;
    const timer = window.setTimeout(() => !undone && void fetch(`/api/juel/threads/${encodeURIComponent(t.id)}`, { method: "DELETE" }), 6000);
    toast.info(`Deleted "${t.title}"`, {
      duration: 6000,
      action: {
        label: "Undo",
        onClick: () => {
          undone = true;
          window.clearTimeout(timer);
          setThreads((list) => [t, ...(list || [])].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))));
        },
      },
    });
  };
  return (
    <div className="juel-history" ref={panel} tabIndex={-1} onKeyDown={(event) => event.key === "Escape" && (event.stopPropagation(), onClose())}>
      {threads === null ? <p className="juel-history-empty"><Loader2 size={14} className="juel-spin" aria-hidden="true" />Loading</p> : null}
      {threads?.length === 0 ? <p className="juel-history-empty">No conversations yet.</p> : null}
      {groups.map((g) => (
        <section key={g.title}>
          <h4>{g.title}</h4>
          <ul>
            {g.items.map((t) => (
              <li key={t.id} className={t.id === current ? "is-current" : undefined}>
                <button type="button" className="juel-history-open" onClick={() => void open(t.id)}>
                  {opening === t.id ? <Loader2 size={13} className="juel-spin" aria-hidden="true" /> : null}
                  <span>{t.title || "Untitled"}</span>
                  <time dateTime={t.updatedAt}>{ago(t.updatedAt)}</time>
                </button>
                <button type="button" className="juel-tool" onClick={() => remove(t)} aria-label={`Delete "${t.title}"`} title="Delete"><Trash2 size={13} /></button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function ago(iso: string) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
