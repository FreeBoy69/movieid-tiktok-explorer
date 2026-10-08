// Juel: the one AutoYT agent, from the header anywhere in the app (or ⌘J). It knows the page you're on
// (pages with an open item announce it with a "juel:context" event), streams what its specialists do,
// and shows paid, publish, and delete actions as cards that run only when approved.
import { FormEvent, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowUp, Check, Loader2, Plus, Sparkles, X } from "lucide-react";
import { readDeepLink } from "../utils/tiktokRoute";
import "./JuelPanel.css";

type PageAction = { type: string; args: Record<string, unknown> };
type Card = { id: string; kind?: "page"; specialist: string; method?: string; path?: string; route?: string; pageAction?: PageAction; risk: string; does: string; why: string; status: "pending" | "running" | "done" | "failed" | "declined"; result?: string };
type Step = { specialist: string; text: string };
type Message = { role: "user" | "assistant"; content: string; steps?: Step[]; cards?: string[]; applied?: number; error?: boolean; at: string };
type Thread = { id: string; title: string; messages: Message[]; cards: Record<string, Card> };
/** What a page offers Juel to do on it, in the browser: which specialist uses it, and each action's args,
 *  what it does, and its risk (paid, publish, and delete ones wait for approval). */
export type JuelPageTools = { specialist: string; actions: Record<string, { args: string; about: string; risk: "read" | "change" | "paid" | "publish" | "delete" }> };
export type JuelContext = { surface: string; entityId?: string; label?: string; details?: unknown; clientTools?: JuelPageTools };

const SPECIALIST: Record<string, string> = { automation: "Automation", publisher: "Publisher", recap: "Recap", editor: "Editor", producer: "Producer", studio: "Studio", film: "Film", research: "Research", community: "Community", account: "Account", admin: "Admin" };
const RISK: Record<string, string> = { paid: "Uses credits", publish: "Publishes", delete: "Deletes" };

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

/** Juel's conversation. The header panel uses it; a page can embed it in place of its own chat
 *  (Vibe Edit's assistant card), where it fills its container and has no close button. */
export function JuelPanel({ onClose, embedded = false, headStart }: { onClose?: () => void; embedded?: boolean; headStart?: ReactNode }) {
  const [thread, setThread] = useState<Thread | null>(null);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [live, setLive] = useState<{ text: string; steps: Step[]; cards: Card[] } | null>(null);
  const [error, setError] = useState("");
  const [announced, setAnnounced] = useState<JuelContext | null>(lastContext);
  const [deciding, setDeciding] = useState("");
  const bottom = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const context = announced || routeContext();

  useEffect(() => {
    const onContext = (event: Event) => setAnnounced((event as CustomEvent<JuelContext | null>).detail || null);
    window.addEventListener("juel:context", onContext);
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose?.();
    if (!embedded) {
      window.addEventListener("keydown", onKey);
      field.current?.focus();
    }
    return () => {
      window.removeEventListener("juel:context", onContext);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose, embedded]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [thread?.messages.length, live?.steps.length, live?.cards.length]);

  const send = useCallback(async (event?: FormEvent) => {
    event?.preventDefault();
    const text = message.trim();
    if (!text || sending) return;
    setSending(true);
    setError("");
    setMessage("");
    setLive({ text, steps: [], cards: [] });
    // The page's state right now (an edit changes between messages), else what it announced.
    const now = contextProvider?.() || context;
    try {
      const response = await fetch("/api/juel/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: text, threadId: thread?.id, context: now }) });
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
          else if (item.type === "card") setLive((l) => (l ? { ...l, cards: [...l.cards, item.card] } : l));
          else if (item.type === "page") runOnPage(item.surface, item.actions);
          else if (item.type === "done") setThread(item.thread);
        }
      }
    } catch (err) {
      setMessage(text);
      setError(err instanceof Error ? err.message : "Juel couldn't answer");
    } finally {
      setSending(false);
      setLive(null);
    }
  }, [message, sending, thread?.id, context]);

  const decide = async (card: Card, approve: boolean) => {
    if (!thread) return;
    setDeciding(card.id);
    try {
      const response = await fetch(`/api/juel/threads/${encodeURIComponent(thread.id)}/actions/${encodeURIComponent(card.id)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ approve }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "That didn't run");
      setThread(data.thread);
      // An approved page action runs on the open page now.
      if (approve && card.kind === "page" && card.pageAction) runOnPage(context.surface, [card.pageAction]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't run");
    } finally {
      setDeciding("");
    }
  };

  return (
    <aside className={`juel${embedded ? " juel-embedded" : ""}`} role={embedded ? undefined : "dialog"} aria-label="Juel">
      <header className="juel-head">
        {headStart}
        <span className="juel-title"><Sparkles size={16} aria-hidden="true" />Juel</span>
        <span className="juel-where" title="Juel starts from what you have open">{context.label || context.surface}</span>
        <button type="button" className="juel-icon" onClick={() => { setThread(null); setError(""); }} aria-label="New conversation" title="New conversation"><Plus size={16} /></button>
        {onClose ? <button type="button" className="juel-icon" onClick={onClose} aria-label="Close Juel" title="Close (Esc)"><X size={16} /></button> : null}
      </header>
      <div className="juel-body">
        {!thread?.messages.length && !live ? (
          <div className="juel-empty">
            <strong>Ask Juel anything in AutoYT</strong>
            <p>It works with a team of specialists (recaps, editing, publishing, research, and more) and asks before anything that costs credits, posts, or deletes.</p>
          </div>
        ) : null}
        {thread?.messages.map((m, i) => (m.role === "user" ? (
          <p key={i} className="juel-user">{m.content}</p>
        ) : (
          <div key={i} className={`juel-reply${m.error ? " is-error" : ""}`}>
            {m.steps?.length ? <Steps steps={m.steps} /> : null}
            <p>{m.content}</p>
            {m.applied ? <p className="juel-applied"><Check size={13} aria-hidden="true" />Made {m.applied} edit{m.applied === 1 ? "" : "s"} on the page</p> : null}
            {(m.cards || []).map((id) => thread.cards[id]).filter(Boolean).map((card) => (
              <ActionCard key={card.id} card={card} busy={deciding === card.id} onDecide={(approve) => void decide(card, approve)} />
            ))}
          </div>
        )))}
        {live ? (
          <>
            <p className="juel-user">{live.text}</p>
            <div className="juel-reply">
              <Steps steps={live.steps} working />
              {live.cards.map((card) => <ActionCard key={card.id} card={card} busy onDecide={() => undefined} />)}
            </div>
          </>
        ) : null}
        {error ? <p className="juel-error" role="alert">{error}</p> : null}
        <div ref={bottom} />
      </div>
      <form className="juel-composer" onSubmit={(event) => void send(event)}>
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
          placeholder="Ask Juel to find, make, fix, or post something…"
          aria-label="Message Juel"
        />
        <button type="submit" className="juel-send" disabled={!message.trim() || sending} aria-label="Send">{sending ? <Loader2 size={16} className="juel-spin" /> : <ArrowUp size={16} />}</button>
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

function ActionCard({ card, busy, onDecide }: { card: Card; busy: boolean; onDecide: (approve: boolean) => void }) {
  return (
    <div className="juel-card" data-status={card.status} data-risk={card.risk}>
      <div className="juel-card-head">
        <strong>{card.does}</strong>
        <span>{RISK[card.risk] || card.risk}</span>
      </div>
      {card.why ? <p>{card.why}</p> : null}
      {card.status === "pending" ? (
        <div className="juel-card-actions">
          <button type="button" className="juel-approve" disabled={busy} onClick={() => onDecide(true)}>{busy ? <Loader2 size={14} className="juel-spin" /> : <Check size={14} />}Approve</button>
          <button type="button" className="juel-decline" disabled={busy} onClick={() => onDecide(false)}>Decline</button>
        </div>
      ) : (
        <p className="juel-card-status">{card.status === "running" ? "Running…" : card.status === "done" ? "Done" : card.status === "declined" ? "Declined" : `Failed: ${card.result || "unknown error"}`}</p>
      )}
    </div>
  );
}
