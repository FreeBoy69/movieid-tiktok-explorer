// Juel: the one AutoYT agent, from the header anywhere in the app (or ⌘J), and in place of a page's own
// chat (Vibe Edit, automation agents, Creative Studio agents). It knows the page you're on (pages announce
// it), streams what its specialists do, runs paid work straight away with its credit cost shown (a balance
// that can't cover it gets the credits toast), and shows an agent operator's answers and generations inline.
import { FormEvent, type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import gsap from "gsap";
import { AlertCircle, ArrowDown, ArrowUp, ArrowUpRight, Check, ChevronRight, Coins, Copy, History, Loader2, MapPin, Mic, PanelLeftClose, PanelLeftOpen, Pencil, Plus, RotateCcw, Search, Sparkles, Square, Trash2, X } from "lucide-react";
import { readDeepLink } from "../utils/tiktokRoute";
import { toast } from "../utils/toast";
import { FormattedChatText } from "./AgentStructuredContent";
import { AGENT_STARTERS, creditsToast, formatCredits, GenerationResult, type JuelAttachment, JuelReport, type JuelSpend, MediaResult, OperatorAnswer, useVoiceInput } from "./JuelParts";
import "./JuelPanel.css";

type PageAction = { type: string; args: Record<string, unknown> };
type Step = { specialist: string; text: string };
type Message = { role: "user" | "assistant"; content: string; steps?: Step[]; spends?: JuelSpend[]; attachments?: JuelAttachment[]; applied?: number; charged?: number; error?: boolean; stopped?: boolean; at: string };
type Thread = { id: string; title: string; surface?: string; entityId?: string; messages: Message[] };
type ThreadSummary = { id: string; title: string; surface: string; entityId: string; updatedAt: string };
type Live = { text: string; reply: string; steps: Step[]; spends: JuelSpend[]; attachments: JuelAttachment[]; startedAt: number };
/** What a page offers Juel to do on it, in the browser: which specialist uses it, and each action's args,
 *  what it does, its risk, and (for paid ones) a cost spec like "speech" or "image:2" for the quote. */
export type JuelPageTools = { specialist: string; actions: Record<string, { args: string; about: string; risk: "read" | "change" | "paid" | "publish" | "delete"; cost?: string }> };
/** Where the user is. `starters` are the page's quick prompts; `details.persona` picks a Creative Studio persona. */
export type JuelContext = { surface: string; entityId?: string; label?: string; details?: any; clientTools?: JuelPageTools; starters?: Array<{ label: string; prompt: string }>; intro?: { title: string; body: string } };

// Motion: the panel rises into place and its parts follow; it sinks away on close. Reduced motion only fades.
const calm = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
// A long, even deceleration (no snap at the start); the panel moves on the GPU and is never scaled, so its
// text doesn't re-render each frame.
const RISE = "power3.out";
const GPU = { force3D: true, willChange: "transform, opacity" };
const DONE = "transform,opacity,visibility,willChange";

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

/** Juel's conversation. The header panel uses it; a page can embed it in place of its own chat, where it
 *  fills its container and has no close button. `headStart` goes at the head's start (a page's collapse). */
export function JuelPanel({ onClose, embedded = false, headStart, leaving = false, onLeft, sidebar = false }: { onClose?: () => void; embedded?: boolean; headStart?: ReactNode; leaving?: boolean; onLeft?: () => void; /** Conversations as a sidebar beside the chat (wide screens), instead of the head's dropdown. */ sidebar?: boolean }) {
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
  const body = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  const following = useRef(true);
  const field = useRef<HTMLTextAreaElement>(null);
  const stopper = useRef<AbortController | null>(null);
  const context = announced || routeContext();
  const key = pageKey(context);
  const root = useRef<HTMLElement>(null);
  const liveBubble = useRef<HTMLParagraphElement>(null);

  // The floating panel slides up into place, then its head and composer settle in after it.
  useLayoutEffect(() => {
    const el = root.current;
    if (!el || embedded) return;
    const ctx = gsap.context(() => {
      if (calm()) {
        gsap.from(el, { autoAlpha: 0, duration: 0.18, ease: "none", clearProps: "opacity,visibility" });
        return;
      }
      gsap.timeline({ defaults: { ease: RISE } })
        .from(el, { ...GPU, y: 36, duration: 0.85, clearProps: DONE })
        .from(el, { autoAlpha: 0, duration: 0.4, ease: "power1.out" }, 0)
        .from(el.querySelectorAll(".juel-head > *"), { ...GPU, y: 6, autoAlpha: 0, duration: 0.7, stagger: 0.04, clearProps: DONE }, 0.14)
        .from(el.querySelector(".juel-composer"), { ...GPU, y: 14, autoAlpha: 0, duration: 0.8, clearProps: DONE }, 0.2);
    }, el);
    return () => ctx.revert();
  }, [embedded]);

  // Closing sinks it; opening again before it's gone brings it straight back.
  const wasLeaving = useRef(false);
  useEffect(() => {
    const el = root.current;
    if (!el || embedded) return;
    if (leaving) {
      wasLeaving.current = true;
      gsap.killTweensOf(el);
      gsap.to(el, calm() ? { autoAlpha: 0, duration: 0.12, onComplete: onLeft } : { ...GPU, y: 24, autoAlpha: 0, duration: 0.34, ease: "power2.inOut", onComplete: onLeft });
    } else if (wasLeaving.current) {
      wasLeaving.current = false;
      gsap.killTweensOf(el);
      gsap.to(el, { ...GPU, y: 0, autoAlpha: 1, duration: 0.6, ease: RISE, clearProps: DONE });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaving, embedded]);

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

  // The empty state's invitation and quick prompts rise in one after another once it's known to be empty.
  const empty = ready && !thread?.messages.length && !live;
  useLayoutEffect(() => {
    const el = root.current?.querySelector(".juel-empty");
    if (!empty || !el || calm()) return;
    const tween = gsap.from(el.querySelectorAll(":scope > *:not(.juel-starters), .juel-starter"), { ...GPU, y: 10, autoAlpha: 0, duration: 0.8, ease: RISE, stagger: 0.05, delay: embedded ? 0 : 0.18, clearProps: DONE });
    return () => {
      tween.revert();
    };
  }, [empty, key, embedded]);

  // The send button pops awake when there's something to send.
  const sendButton = useRef<HTMLButtonElement>(null);
  const canSend = Boolean(message.trim());
  useEffect(() => {
    if (!canSend || !sendButton.current || calm()) return;
    gsap.fromTo(sendButton.current, { scale: 0.86 }, { scale: 1, duration: 0.5, ease: "back.out(2)", clearProps: "transform" });
  }, [canSend]);

  // A sent message lifts out of the composer into the conversation.
  useLayoutEffect(() => {
    const el = liveBubble.current;
    if (!el || calm()) return;
    const tween = gsap.from(el, { ...GPU, y: 18, autoAlpha: 0, duration: 0.65, ease: RISE, clearProps: DONE });
    return () => {
      tween.kill();
    };
  }, [live?.startedAt]);

  // Follow new output only while the reader is at the bottom; scrolling up to read stops it.
  useEffect(() => {
    if (following.current) bottom.current?.scrollIntoView({ block: "end" });
  }, [thread?.messages.length, live?.steps.length, live?.attachments.length, live?.reply]);
  const onScroll = () => {
    const el = body.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    following.current = near;
    setAtBottom(near);
  };
  const toBottom = () => {
    following.current = true;
    body.current?.scrollTo({ top: body.current.scrollHeight, behavior: "smooth" });
  };
  // The message box grows with what's typed, up to about eight lines.
  useEffect(() => {
    const el = field.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [message]);

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
    setLive({ text, reply: "", steps: [], spends: [], attachments: [], startedAt: Date.now() });
    following.current = true;
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
          if (item.type === "reply") setLive((l) => (l ? { ...l, reply: String(item.text || "") } : l));
          else if (item.type === "step") setLive((l) => (l ? { ...l, steps: [...l.steps, { specialist: item.specialist, text: item.text }] } : l));
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

  const panel = (
    <aside ref={root} className={`juel${embedded ? " juel-embedded" : ""}${sidebar ? " has-side" : ""}`} role={embedded ? undefined : "dialog"} aria-label="Juel">
      <header className="juel-head">
        {headStart}
        <span className="juel-title"><span className="juel-mark" aria-hidden="true"><Sparkles size={13} /></span>Juel</span>
        <span className="juel-thread-title" title={thread?.title || undefined}>{thread?.messages.length ? thread.title || "Conversation" : "New conversation"}</span>
        <button type="button" className={`juel-icon juel-history-btn${historyOpen ? " is-on" : ""}`} onClick={() => setHistoryOpen((o) => !o)} aria-label="Conversations" aria-expanded={historyOpen} title="Conversations"><History size={16} /></button>
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
      <div className="juel-body" ref={body} onScroll={onScroll}>
        <div className="juel-thread">
          {!thread?.messages.length && !live ? (
            <div className="juel-empty" data-ready={ready ? undefined : "false"}>
              <span className="juel-empty-mark" aria-hidden="true"><Sparkles size={20} /></span>
              <h2>{intro.title}</h2>
              <p>{intro.body}</p>
              <div className="juel-starters">
                {starters.map((s) => (
                  <button key={s.label} type="button" className="juel-starter" disabled={sending} onClick={() => void send(s.prompt)}>
                    <span>{s.label}</span>
                    <ArrowUpRight size={14} aria-hidden="true" />
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {thread?.messages.map((m, i) => (m.role === "user" ? (
            <div key={i} className={`juel-user-row${editFrom === i ? " is-editing" : ""}`}>
              <p className="juel-user">{m.content}</p>
              <div className="juel-tools">
                <button type="button" className="juel-tool" onClick={() => beginEdit(i)} disabled={sending} aria-label="Edit this message" title="Edit"><Pencil size={13} /></button>
              </div>
            </div>
          ) : (
            <div key={i} className={`juel-reply${m.error ? " is-error" : ""}${i === thread.messages.length - 1 ? " is-new" : ""}`}>
              {m.steps?.length ? <Activity steps={m.steps} /> : null}
              {m.content ? <div className="juel-text"><FormattedChatText content={m.content} theme={document.documentElement.dataset.theme === "light" ? "light" : "dark"} /></div> : null}
              {m.applied ? <p className="juel-applied"><Check size={13} aria-hidden="true" />Made {m.applied} edit{m.applied === 1 ? "" : "s"} on the page</p> : null}
              <Attachments items={m.attachments} onAsk={(text) => void send(text)} />
              <div className="juel-foot">
                <div className="juel-tools">
                  <button type="button" className="juel-tool" onClick={() => void copy(m.content, i)} aria-label="Copy reply" title="Copy">{copied === i ? <Check size={14} /> : <Copy size={14} />}</button>
                  {i === lastAssistant ? <button type="button" className="juel-tool" onClick={regenerate} disabled={sending} aria-label="Ask again" title="Ask again"><RotateCcw size={14} /></button> : null}
                </div>
                <Spends spends={m.spends} charged={m.charged} />
              </div>
            </div>
          )))}
          {live ? (
            <>
              <div className="juel-user-row"><p ref={liveBubble} className="juel-user">{live.text}</p></div>
              <div className="juel-reply is-live">
                <Activity steps={live.steps} working={!live.reply} startedAt={live.startedAt} />
                {live.reply ? <div className="juel-text is-streaming"><FormattedChatText content={live.reply} theme={document.documentElement.dataset.theme === "light" ? "light" : "dark"} /></div> : null}
                <Attachments items={live.attachments} onAsk={() => undefined} />
                {live.spends.length ? <div className="juel-foot"><Spends spends={live.spends} /></div> : null}
              </div>
            </>
          ) : null}
          {error ? <p className="juel-error" role="alert"><AlertCircle size={14} aria-hidden="true" />{error}</p> : null}
          <div ref={bottom} className="juel-bottom" />
        </div>
      </div>
      {!atBottom ? <button type="button" className="juel-jump" onClick={toBottom} aria-label="Jump to the latest message"><ArrowDown size={16} /></button> : null}
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
          rows={1}
          maxLength={4000}
          placeholder={voice.state === "recording" ? "Listening… press the mic again when you're done" : voice.state === "transcribing" ? "Transcribing…" : "Ask Juel to find, make, fix, or post something…"}
          aria-label="Message Juel"
        />
        <div className="juel-composer-tools">
          <span className="juel-where" title="Juel starts from what you have open"><MapPin size={12} aria-hidden="true" /><span>{context.label || context.surface}</span></span>
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
            <button ref={sendButton} type="submit" className="juel-send" disabled={!canSend} aria-label="Send"><ArrowUp size={16} /></button>
          )}
        </div>
      </form>
    </aside>
  );
  if (!sidebar) return panel;
  return (
    <div className="juel-split">
      <JuelSidebar
        context={context}
        current={thread?.id || ""}
        refresh={`${thread?.id || ""}:${thread?.messages.length || 0}`}
        onPick={(picked) => {
          setThread(picked);
          remember(context, picked.id);
          setHistoryOpen(false);
        }}
        onNew={newChat}
        onDeleted={(id) => thread?.id === id && newChat()}
      />
      {panel}
    </div>
  );
}

/** What Juel's specialists did. While it works: each step, the latest one live. After: one line
 *  ("Worked through 3 steps · Automation, Studio") that opens to the steps. */
function Activity({ steps, working = false, startedAt }: { steps: Step[]; working?: boolean; startedAt?: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!working) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [working]);
  const who = [...new Set(steps.map((s) => SPECIALIST[s.specialist] || s.specialist))];
  if (working) {
    const latest = steps[steps.length - 1];
    const seconds = startedAt ? Math.max(0, Math.floor((now - startedAt) / 1000)) : 0;
    return (
      <div className="juel-activity is-working" aria-live="polite">
        {steps.length > 1 ? (
          <ol className="juel-steps">
            {steps.slice(0, -1).map((step, i) => (
              <li key={i}><b>{SPECIALIST[step.specialist] || step.specialist}</b>{step.text}</li>
            ))}
          </ol>
        ) : null}
        <p className="juel-now">
          <span className="juel-pulse" aria-hidden="true" />
          <span className="juel-shimmer">{latest ? <><b>{SPECIALIST[latest.specialist] || latest.specialist}</b>{latest.text}</> : "Thinking"}</span>
          {seconds >= 3 ? <span className="juel-elapsed">{seconds}s</span> : null}
        </p>
      </div>
    );
  }
  if (!steps.length) return null;
  return (
    <details className="juel-activity">
      <summary>
        <ChevronRight size={14} className="juel-chev" aria-hidden="true" />
        <span>Worked through {steps.length} step{steps.length === 1 ? "" : "s"}</span>
        {who.length ? <span className="juel-who">{who.join(", ")}</span> : null}
      </summary>
      <ol className="juel-steps">
        {steps.map((step, i) => (
          <li key={i}><b>{SPECIALIST[step.specialist] || step.specialist}</b>{step.text}</li>
        ))}
      </ol>
    </details>
  );
}

/** What the turn spent: each paid step with its estimate, refusals for low credits, and what's been charged. */
function Spends({ spends, charged }: { spends?: JuelSpend[]; charged?: number }) {
  if (!spends?.length && !charged) return null;
  const started = (spends || []).filter((s) => s.status === "started");
  const refused = (spends || []).filter((s) => s.status === "refused");
  const total = started.reduce((sum, s) => sum + s.credits, 0);
  const label = [started.length ? `≈ ${formatCredits(total)} credits` : "", charged ? `${formatCredits(charged)} charged` : ""].filter(Boolean).join(" · ");
  return (
    <div className="juel-spends">
      {refused.map((s, i) => (
        <p key={i} className="juel-spend is-refused">
          <AlertCircle size={13} aria-hidden="true" />
          <span className="juel-spend-what">{s.does}</span>
          <span className="juel-spend-cost">needs ≈ {formatCredits(s.credits)}</span>
        </p>
      ))}
      {label ? (
        <details className="juel-spend-sum">
          <summary title="What this task costs in credits"><Coins size={13} aria-hidden="true" />{label}</summary>
          {started.length ? (
            <div className="juel-spend-list">
              {started.map((s, i) => (
                <p key={i} className="juel-spend">
                  <span className="juel-spend-what">{s.does}</span>
                  <span className="juel-spend-cost">≈ {formatCredits(s.credits)}</span>
                </p>
              ))}
            </div>
          ) : null}
        </details>
      ) : null}
    </div>
  );
}

function Attachments({ items, onAsk }: { items?: JuelAttachment[]; onAsk: (text: string) => void }) {
  if (!items?.length) return null;
  const generations = items.filter((a) => a.kind === "generation");
  return (
    <>
      {items.map((a, i) => (a.kind === "operator" ? <OperatorAnswer key={`op-${i}`} answer={a} onAsk={onAsk} /> : a.kind === "report" ? <JuelReport key={`rp-${i}`} report={a} /> : a.kind === "media" ? <MediaResult key={`md-${i}`} media={a} /> : null))}
      {generations.length ? (
        <div className="juel-gens">
          {generations.map((a) => (a.kind === "generation" ? <GenerationResult key={a.id} item={a} /> : null))}
        </div>
      ) : null}
    </>
  );
}

/** Saved conversations: this page's (the open agent, edit, or film) first, then the rest. Delete has undo. */
/** The saved conversations, split into this page's and the rest, with open and a delete that Undo can
 *  take back. Shared by the history dropdown and the sidebar. `refresh` reloads the list when it changes. */
function useConversations(context: JuelContext, refresh: unknown = 0) {
  const [threads, setThreads] = useState<ThreadSummary[] | null>(null);
  const [opening, setOpening] = useState("");
  useEffect(() => {
    let live = true;
    fetch("/api/juel/threads").then((r) => (r.ok ? r.json() : { threads: [] })).then((d) => live && setThreads(d.threads || [])).catch(() => live && setThreads((t) => t || []));
    return () => {
      live = false;
    };
  }, [refresh]);
  const here = (t: ThreadSummary) => (context.entityId ? t.entityId === context.entityId : t.surface === context.surface);
  const groups = useMemo(() => {
    const list = threads || [];
    return [
      { title: context.entityId ? "This agent" : "On this page", items: list.filter(here) },
      { title: "Everything else", items: list.filter((t) => !here(t)) },
    ].filter((g) => g.items.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threads, context.entityId, context.surface]);
  const open = async (id: string, onPick: (thread: Thread) => void) => {
    setOpening(id);
    try {
      const data = await fetch(`/api/juel/threads/${encodeURIComponent(id)}`).then((r) => r.json());
      if (data.thread) onPick(data.thread);
    } finally {
      setOpening("");
    }
  };
  const remove = (t: ThreadSummary, onDeleted: (id: string) => void) => {
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
  return { threads, groups, opening, open, remove };
}

const SIDE_OPEN_KEY = "juel-side-open";
const readSideOpen = () => {
  try {
    return window.localStorage.getItem(SIDE_OPEN_KEY) !== "0";
  } catch {
    return true;
  }
};

/** Conversations as a sidebar beside the chat (an agent's Chat tab), in Vibe Edit's sidebar language:
 *  a slim icon column, or open, a card with search, a new-chat row, and the conversations. */
function JuelSidebar({ context, current, refresh, onPick, onNew, onDeleted }: { context: JuelContext; current: string; refresh: unknown; onPick: (thread: Thread) => void; onNew: () => void; onDeleted: (id: string) => void }) {
  const [open, setOpen] = useState(readSideOpen);
  const [query, setQuery] = useState("");
  const search = useRef<HTMLInputElement>(null);
  const wantSearch = useRef(false);
  const list = useConversations(context, refresh);
  const toggle = () =>
    setOpen((o) => {
      try {
        window.localStorage.setItem(SIDE_OPEN_KEY, o ? "0" : "1");
      } catch {}
      return !o;
    });
  useEffect(() => {
    if (open && wantSearch.current) {
      wantSearch.current = false;
      search.current?.focus();
    }
  }, [open]);
  const q = query.trim().toLowerCase();
  const groups = list.groups.map((g) => ({ ...g, items: q ? g.items.filter((t) => (t.title || "").toLowerCase().includes(q)) : g.items })).filter((g) => g.items.length);
  return (
    <nav className={`juel-side${open ? " is-open" : ""}`} aria-label="Conversations">
      <div className="juel-side-head">
        <button type="button" className="juel-side-btn" onClick={toggle} aria-expanded={open} aria-label={open ? "Collapse conversations" : "Expand conversations"} title={open ? "Collapse" : "Conversations"}>
          {open ? <PanelLeftClose size={18} strokeWidth={1.75} /> : <PanelLeftOpen size={18} strokeWidth={1.75} />}
        </button>
        {open ? <strong>Chats</strong> : null}
      </div>
      {open ? (
        <label className="juel-side-search">
          <Search size={15} aria-hidden="true" />
          <input ref={search} value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => event.key === "Escape" && setQuery("")} placeholder="Search chats" aria-label="Search chats" />
        </label>
      ) : (
        <button type="button" className="juel-side-btn" aria-label="Search chats" title="Search chats" onClick={() => { wantSearch.current = true; toggle(); }}>
          <Search size={18} strokeWidth={1.75} />
        </button>
      )}
      <button type="button" className="juel-side-btn juel-side-row" onClick={onNew} aria-label="New chat" title="New chat">
        <Plus size={18} strokeWidth={1.75} />
        <span>New chat</span>
      </button>
      {open ? (
        <div className="juel-side-list">
          {list.threads === null ? <p className="juel-side-empty"><Loader2 size={14} className="juel-spin" aria-hidden="true" />Loading</p> : null}
          {list.threads?.length === 0 ? <p className="juel-side-empty">Your chats show up here.</p> : null}
          {list.threads?.length && !groups.length ? <p className="juel-side-empty">No chat is called “{query.trim()}”.</p> : null}
          {groups.map((g) => (
            <section key={g.title}>
              <h4>{g.title}</h4>
              <ul>
                {g.items.map((t) => (
                  <li key={t.id} className={t.id === current ? "is-current" : undefined}>
                    <button type="button" className="juel-side-item" aria-current={t.id === current ? "true" : undefined} onClick={() => void list.open(t.id, onPick)} title={t.title || "Untitled"}>
                      {list.opening === t.id ? <Loader2 size={13} className="juel-spin" aria-hidden="true" /> : null}
                      <span>{t.title || "Untitled"}</span>
                      <time dateTime={t.updatedAt}>{ago(t.updatedAt)}</time>
                    </button>
                    <button type="button" className="juel-side-delete" onClick={() => list.remove(t, onDeleted)} aria-label={`Delete "${t.title}"`} title="Delete"><Trash2 size={13} /></button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : null}
    </nav>
  );
}

function Conversations({ context, current, onClose, onPick, onDeleted }: { context: JuelContext; current: string; onClose: () => void; onPick: (thread: Thread) => void; onDeleted: (id: string) => void }) {
  const panel = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!panel.current || calm()) return;
    const tween = gsap.from(panel.current, { ...GPU, y: -8, autoAlpha: 0, duration: 0.45, ease: RISE, clearProps: DONE });
    return () => {
      tween.kill();
    };
  }, []);
  useEffect(() => {
    panel.current?.focus();
  }, []);
  const { threads, groups, opening, open: openThread, remove: removeThread } = useConversations(context);
  const open = (id: string) => openThread(id, onPick);
  const remove = (t: ThreadSummary) => removeThread(t, onDeleted);
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
