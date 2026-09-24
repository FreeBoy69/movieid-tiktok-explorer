import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, Info, LifeBuoy, Loader2, Megaphone, Plus, TriangleAlert, X } from "lucide-react";
import { toast } from "../utils/toast";
import "./AccountServices.css";

// User-facing pieces of billing, governance and support: the token balance in the
// account menu, the Help & support dialog, the site-wide notice banner, and the
// toast shown when the server blocks an AI call.

type Theme = "light" | "dark";
type Billing = { planName: string; monthlyTokens: number; balance: number; allowanceRemaining: number; bonusBalance: number; unlimited: boolean; periodEnd: string; periodUsed: number };
type Ticket = { id: string; subject: string; category: string; status: string; lastMessageAt: string; lastAuthor?: string };
type Thread = Ticket & { messages: Array<{ id: string; authorType: "user" | "admin"; body: string; createdAt: string }> };

// "pending" means support replied and is waiting on the user.
const STATUS_LABEL: Record<string, string> = { open: "Open", pending: "Replied", resolved: "Resolved", closed: "Closed" };
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

// ---------- blocked-call notices ----------
const BLOCK_CODES = new Set(["insufficient_tokens", "account_suspended", "ai_paused", "provider_paused", "maintenance"]);
let installed = false;
export function installUsageNotices() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const original = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const response = await original(...args);
    if ([402, 403, 503].includes(response.status)) {
      const url = typeof args[0] === "string" ? args[0] : args[0] instanceof URL ? args[0].href : args[0].url;
      if (/\/api\//.test(url) && !/\/api\/admin\//.test(url)) {
        response.clone().json().then((data) => {
          if (!BLOCK_CODES.has(data?.code)) return;
          const title = data.code === "insufficient_tokens" ? "Out of tokens" : data.code === "account_suspended" ? "Account suspended" : "Paused";
          toast.error(data.error, {
            title,
            action: data.code === "insufficient_tokens" || data.code === "account_suspended"
              ? { label: "Contact support", onClick: () => window.dispatchEvent(new CustomEvent("autoyt-open-support")) }
              : undefined,
          });
          if (data.code === "insufficient_tokens") window.dispatchEvent(new CustomEvent("autoyt-billing-changed"));
        }).catch(() => {});
      }
    }
    return response;
  };
}

// ---------- token balance ----------
export function TokenSummary() {
  const [billing, setBilling] = useState<Billing | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    fetch("/api/billing/me", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => alive && setBilling(data.billing))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, []);
  if (failed) return null;
  if (!billing) {
    return (
      <div className="as-tokens" aria-busy="true">
        <span className="as-tokens-row"><span>Tokens</span><Loader2 size={13} className="as-spin" aria-hidden="true" /></span>
        <span className="as-meter" />
      </div>
    );
  }
  const total = Math.max(1, billing.monthlyTokens + Math.max(0, billing.bonusBalance));
  const left = Math.max(0, billing.balance);
  const pct = billing.unlimited ? 100 : Math.min(100, (left / total) * 100);
  const low = !billing.unlimited && pct < 10;
  return (
    <div className="as-tokens">
      <span className="as-tokens-row">
        <span>{billing.planName} plan</span>
        <strong className={low ? "is-low" : undefined}>{billing.unlimited ? "Unlimited" : `${compact.format(left)} tokens left`}</strong>
      </span>
      <span className="as-meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} aria-label="Tokens left this period">
        <span className={low ? "is-low" : undefined} style={{ width: `${pct}%` }} />
      </span>
      {!billing.unlimited ? <small>Allowance renews {new Date(billing.periodEnd).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</small> : null}
    </div>
  );
}

// ---------- site notice ----------
export function SiteNotice({ theme }: { theme: Theme }) {
  const [notice, setNotice] = useState<{ announcement: { tone: string; text: string } | null; maintenance: { message: string } | null } | null>(null);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return window.sessionStorage.getItem("autoyt-notice-dismissed") || "";
    } catch {
      return "";
    }
  });
  useEffect(() => {
    let alive = true;
    const load = () => fetch("/api/app/notice", { cache: "no-store" }).then((r) => r.json()).then((data) => alive && setNotice(data)).catch(() => {});
    void load();
    const timer = window.setInterval(load, 5 * 60 * 1000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);
  if (notice?.maintenance) {
    return (
      <div className="as-notice is-warning" data-theme={theme} role="status">
        <TriangleAlert size={15} aria-hidden="true" />
        <span>{notice.maintenance.message}</span>
      </div>
    );
  }
  const a = notice?.announcement;
  if (!a || dismissed === a.text) return null;
  return (
    <div className={`as-notice is-${a.tone}`} data-theme={theme} role="status">
      {a.tone === "warning" ? <TriangleAlert size={15} aria-hidden="true" /> : a.tone === "success" ? <Megaphone size={15} aria-hidden="true" /> : <Info size={15} aria-hidden="true" />}
      <span>{a.text}</span>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => {
          setDismissed(a.text);
          try {
            window.sessionStorage.setItem("autoyt-notice-dismissed", a.text);
          } catch {}
        }}
      >
        <X size={14} />
      </button>
    </div>
  );
}

// ---------- support ----------
export function SupportDialog({ open, onClose, theme }: { open: boolean; onClose: () => void; theme: Theme }) {
  const [view, setView] = useState<"list" | "new" | string>("list");
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [thread, setThread] = useState<Thread | null>(null);
  const [form, setForm] = useState({ subject: "", category: "general", body: "" });
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const loadTickets = useCallback(async () => {
    setError("");
    try {
      const response = await fetch("/api/support/tickets", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Couldn't load your requests.");
      setTickets(data.tickets);
      if (!data.tickets.length) setView("new");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load your requests.");
      setTickets([]);
    }
  }, []);
  useEffect(() => {
    if (!open) return;
    setView("list");
    setTickets(null);
    void loadTickets();
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, loadTickets, onClose]);
  useEffect(() => {
    if (!open || view === "list" || view === "new") return;
    setThread(null);
    fetch(`/api/support/tickets/${encodeURIComponent(view)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => setThread(data.ticket || null))
      .catch(() => setError("Couldn't open this request."));
  }, [open, view]);

  const post = async (url: string, body: unknown) => {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Couldn't send that. Try again.");
      return data.ticket as Thread;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send that. Try again.");
      return null;
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;
  const isThread = view !== "list" && view !== "new";
  return createPortal(
    <div className="as-overlay" data-theme={theme} onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="as-dialog" role="dialog" aria-modal="true" aria-labelledby="as-support-title">
        <header className="as-dialog-head">
          {view !== "list" && (tickets?.length || isThread) ? (
            <button type="button" className="as-icon" onClick={() => setView("list")} aria-label="Back to your requests"><ArrowLeft size={17} /></button>
          ) : <LifeBuoy size={18} className="as-head-icon" aria-hidden="true" />}
          <h2 id="as-support-title">{view === "new" ? "New request" : isThread ? thread?.subject || "Request" : "Help & support"}</h2>
          <button type="button" className="as-icon" onClick={onClose} aria-label="Close"><X size={17} /></button>
        </header>
        <div className="as-dialog-body">
          {error ? <p className="as-error" role="alert">{error}</p> : null}
          {view === "list" ? (
            tickets === null ? <p className="as-muted as-center"><Loader2 size={16} className="as-spin" aria-hidden="true" /> Loading…</p> : (
              <>
                <button type="button" className="as-new" onClick={() => setView("new")}><Plus size={16} aria-hidden="true" /> New request</button>
                <ul className="as-tickets">
                  {tickets.map((t) => (
                    <li key={t.id}>
                      <button type="button" onClick={() => setView(t.id)}>
                        <span>
                          <strong>{t.subject}</strong>
                          <small>{t.lastAuthor === "admin" ? "Support replied" : "Waiting for support"} · {new Date(t.lastMessageAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</small>
                        </span>
                        <span className={`as-status is-${t.status}`}>{STATUS_LABEL[t.status] || t.status}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )
          ) : view === "new" ? (
            <form
              className="as-form"
              onSubmit={async (event) => {
                event.preventDefault();
                const ticket = await post("/api/support/tickets", form);
                if (ticket) {
                  toast.success("Request sent. We'll reply here and you'll see it in Help & support.");
                  setForm({ subject: "", category: "general", body: "" });
                  await loadTickets();
                  setView(ticket.id);
                }
              }}
            >
              <label>Topic
                <select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}>
                  <option value="general">General question</option>
                  <option value="billing">Billing and tokens</option>
                  <option value="bug">Something's broken</option>
                  <option value="account">My account</option>
                  <option value="feature">Feature idea</option>
                </select>
              </label>
              <label>Subject
                <input value={form.subject} maxLength={160} onChange={(event) => setForm({ ...form, subject: event.target.value })} placeholder="e.g. My video export stopped at 85%" required />
              </label>
              <label>What happened?
                <textarea rows={5} value={form.body} maxLength={8000} onChange={(event) => setForm({ ...form, body: event.target.value })} placeholder="What you were doing, what you expected, and what you saw instead." required />
              </label>
              <button type="submit" className="as-primary" disabled={busy || !form.subject.trim() || !form.body.trim()}>{busy ? <Loader2 size={15} className="as-spin" aria-hidden="true" /> : null} Send request</button>
            </form>
          ) : !thread ? <p className="as-muted as-center"><Loader2 size={16} className="as-spin" aria-hidden="true" /> Loading…</p> : (
            <>
              <ol className="as-thread">
                {thread.messages.map((m) => (
                  <li key={m.id} className={`is-${m.authorType}`}>
                    <small>{m.authorType === "admin" ? "AutoYT support" : "You"} · {new Date(m.createdAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</small>
                    <p>{m.body}</p>
                  </li>
                ))}
              </ol>
              <form
                className="as-form"
                onSubmit={async (event) => {
                  event.preventDefault();
                  const ticket = await post(`/api/support/tickets/${thread.id}/messages`, { body: reply });
                  if (ticket) {
                    setThread(ticket);
                    setReply("");
                  }
                }}
              >
                <textarea rows={3} value={reply} onChange={(event) => setReply(event.target.value)} placeholder="Add a reply" aria-label="Reply" />
                <button type="submit" className="as-primary" disabled={busy || !reply.trim()}>{busy ? <Loader2 size={15} className="as-spin" aria-hidden="true" /> : null} Send</button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
