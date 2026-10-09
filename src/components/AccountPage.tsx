import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import  { BarChart3, Check, Code2, Copy, CreditCard, KeyRound, LifeBuoy, Link2, Loader2, LogOut, Moon, Send, ShieldCheck, Sun, Trash2, UserRound, Users } from "lucide-react";
import type  { AuthSessionPayload } from "../types";
import { writeDeepLink, type AccountSection } from "../utils/tiktokRoute";
import { tokensToCredits } from "../utils/credits";
import { openLingbasePortal } from "../utils/lingbasePayments";
import { purchasesAllowed } from "../native/platform";
import { toast } from "../utils/toast";
import { DeleteAccountDialog, openBilling, SupportDialog, type BillingOffer } from "./AccountServices";
import { PlatformGrid, socialPlatform } from "./SocialPlatforms";
import { useChannels } from "./useChannels";
import { Meter, Segmented } from "./ui/controls";
import "./AccountPage.css";
import { confirm } from "./ui/Dialog";

// Account settings: profile, plan and billing, credit usage, connected channels,
// the Telegram bridge to the agent, API tokens and MCP for developers, and sign-in security, one section per route
// (/account, /account/billing, ...).

type Theme = "light" | "dark";
type Overview = { createdAt: string | null; sessions: number; channels: number };
type History = {
  orders: Array<{ reference: string; kind: "plan" | "credits"; planName: string | null; creditsTokens: number; amountCents: number; currency: string; status: string; createdAt: string; paidAt: string | null }>;
  ledger: Array<{ id: string; kind: string; tokens: number; balanceAfter: number; note: string; createdAt: string }>;
  usage: { byFeature: Array<{ feature: string; tokens: number; events: number }>; daily: Array<{ day: string; tokens: number }> };
};
type TelegramLink = { available: boolean; botUsername: string; linked: { telegramName: string; linkedAt: string } | null };

const SECTIONS: Array<{ id: AccountSection; label: string; icon: ReactNode }> = [
  { id: "profile", label: "Profile", icon: <UserRound size={17} /> },
  { id: "billing", label: "Plan & billing", icon: <CreditCard size={17} /> },
  { id: "usage", label: "Usage", icon: <BarChart3 size={17} /> },
  { id: "channels", label: "Channels", icon: <Users size={17} /> },
  { id: "telegram", label: "Telegram", icon: <Send size={17} /> },
  { id: "developers", label: "Developers", icon: <Code2 size={17} /> },
  { id: "security", label: "Security", icon: <ShieldCheck size={17} /> },
];

const LEDGER_LABEL: Record<string, string> = {
  allowance_reset: "Monthly allowance renewed",
  plan_change: "Plan changed",
  plan_purchase: "Plan payment",
  credit_purchase: "Credit bundle",
  grant: "Credits added by support",
  revoke: "Credits removed by support",
  refund: "Refund",
};

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const credits = (tokens: number) => compact.format(tokensToCredits(tokens));
const day = (value: string | null | undefined) => (value ? new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—");
const money = (cents: number, currency = "USD") => new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "USD", minimumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100);
const featureName = (feature: string) => feature === "other" ? "Other" : feature.replace(/[-_.]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const platformName = (platform = "youtube") => socialPlatform(platform)?.label || platform;

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", credentials: "same-origin", ...init });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data as T;
}

function useLoad<T>(url: string, refreshOn?: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(() => {
    getJson<T>(url).then((next) => { setData(next); setError(""); }).catch((cause) => setError(cause instanceof Error ? cause.message : "Couldn't load this."));
  }, [url]);
  useEffect(() => {
    load();
    if (!refreshOn) return;
    window.addEventListener(refreshOn, load);
    return () => window.removeEventListener(refreshOn, load);
  }, [load, refreshOn]);
  return { data, error, reload: load, setData };
}

export function AccountPage({ auth, theme, section = "profile", onSection, onRefresh, onThemeChange, onLogout }: {
  auth: AuthSessionPayload;
  theme: Theme;
  section?: AccountSection;
  onSection: (section: AccountSection) => void;
  onRefresh: () => Promise<void>;
  onThemeChange: (theme: Theme) => void;
  onLogout: () => void;
}) {
  const user = auth.user;
  const current = SECTIONS.find((item) => item.id === section) || SECTIONS[0];
  return (
    <div className="acp" data-theme={theme}>
      <div className="acp-shell">
        <aside className="acp-nav">
          <div className="acp-me">
            <Avatar src={user?.avatarUrl || ""} name={user?.name || user?.email || ""} size={44} />
            <span>
              <strong>{user?.name || "Your account"}</strong>
              <small>{user?.email}</small>
            </span>
          </div>
          <nav aria-label="Account settings">
            {SECTIONS.map((item) => (
              <button key={item.id} type="button" aria-current={item.id === current.id ? "page" : undefined} onClick={() => onSection(item.id)}>
                {item.icon}
                <span>{item.label}</span>
              </button>
            ))}
          </nav>
        </aside>
        <main className="acp-main">
          <h1 className="acp-title">{current.id === "profile" ? "Account" : current.label}</h1>
          {current.id === "profile" ? <ProfileSection auth={auth} theme={theme} onThemeChange={onThemeChange} onSection={onSection} />
            : current.id === "billing" ? <BillingSection />
              : current.id === "usage" ? <UsageSection />
                : current.id === "channels" ? <ChannelsSection auth={auth} onRefresh={onRefresh} />
                  : current.id === "telegram" ? <TelegramSection />
                    : current.id === "developers" ? <DevelopersSection />
                    : <SecuritySection auth={auth} theme={theme} onLogout={onLogout} />}
        </main>
      </div>
    </div>
  );
}

// ---------- shared pieces ----------
function Avatar({ src, name, size = 36 }: { src: string; name: string; size?: number }) {
  const [broken, setBroken] = useState(false);
  return src && !broken
    ? <img className="acp-avatar" src={src} alt="" width={size} height={size} style={{ width: size, height: size }} referrerPolicy="no-referrer" onError={() => setBroken(true)} />
    : <span className="acp-avatar is-letter" style={{ width: size, height: size, fontSize: size * 0.4 }} aria-hidden="true">{(name || "A").slice(0, 1).toUpperCase()}</span>;
}

function Panel({ title, description, action, children }: { title: string; description?: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="acp-panel">
      <header>
        <div>
          <h2>{title}</h2>
          {description ? <p>{description}</p> : null}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

function Rows({ children }: { children: ReactNode }) {
  return <dl className="acp-rows">{children}</dl>;
}
function Row({ label, children }: { label: string; children: ReactNode }) {
  return <div><dt>{label}</dt><dd>{children}</dd></div>;
}

function Pending({ error, onRetry }: { error: string; onRetry: () => void }) {
  return error
    ? <p className="acp-note is-error" role="alert">{error} <button type="button" className="acp-link" onClick={onRetry}>Try again</button></p>
    : <p className="acp-note"><Loader2 size={15} className="ui-spin" aria-hidden="true" /> Loading</p>;
}

function CreditMeter({ value, max, low }: { value: number; max: number; low?: boolean }) {
  return <Meter className="acp-meter" value={max > 0 ? value / max : 1} low={low} label="Credits left this period" />;
}

// ---------- profile ----------
function ProfileSection({ auth, theme, onThemeChange, onSection }: { auth: AuthSessionPayload; theme: Theme; onThemeChange: (theme: Theme) => void; onSection: (section: AccountSection) => void }) {
  const overview = useLoad<Overview>("/api/account/overview");
  const billing = useLoad<BillingOffer>("/api/billing/me", "autoyt-billing-changed");
  const user = auth.user;
  const plan = billing.data?.billing;
  return (
    <>
      <Panel title="Profile" description="Your name and photo come from the Google account you sign in with. Change them in Google and they update here the next time you sign in.">
        <div className="acp-profile">
          <Avatar src={user?.avatarUrl || ""} name={user?.name || ""} size={72} />
          <Rows>
            <Row label="Name">{user?.name || "—"}</Row>
            <Row label="Email">{user?.email || "—"}</Row>
            <Row label="Member since">{overview.data ? day(overview.data.createdAt) : "…"}</Row>
          </Rows>
        </div>
      </Panel>
      <Panel title="Appearance">
        <Segmented
          label="Theme"
          className="acp-theme"
          value={theme === "light" ? "light" : "dark"}
          onChange={(next) => onThemeChange(next)}
          options={[
            { value: "light", label: "Light", icon: <Sun size={16} aria-hidden="true" /> },
            { value: "dark", label: "Dark", icon: <Moon size={16} aria-hidden="true" /> },
          ]}
        />
      </Panel>
      <div className="acp-grid">
        <button type="button" className="acp-tile" onClick={() => onSection("billing")}>
          <span className="acp-tile-label">Plan</span>
          <strong>{plan ? (plan.planId === "pending" ? "No plan yet" : plan.planName) : "…"}</strong>
          <small>{plan ? (plan.unlimited ? "Unlimited credits" : `${credits(Math.max(0, plan.balance))} credits left`) : ""}</small>
        </button>
        <button type="button" className="acp-tile" onClick={() => onSection("channels")}>
          <span className="acp-tile-label">Channels</span>
          <strong>{(auth.accounts || []).length || "None"}</strong>
          <small>{auth.activeAccount ? `Active: ${auth.activeAccount.channelTitle}` : "Connect one to publish"}</small>
        </button>
        <button type="button" className="acp-tile" onClick={() => onSection("security")}>
          <span className="acp-tile-label">Signed in on</span>
          <strong>{overview.data ? `${overview.data.sessions} ${overview.data.sessions === 1 ? "device" : "devices"}` : "…"}</strong>
          <small>Google sign-in</small>
        </button>
      </div>
    </>
  );
}

// ---------- billing ----------
function BillingSection() {
  const offer = useLoad<BillingOffer>("/api/billing/me", "autoyt-billing-changed");
  const history = useLoad<History>("/api/billing/history", "autoyt-billing-changed");
  const [portalBusy, setPortalBusy] = useState(false);
  const canBuy = purchasesAllowed();
  if (!offer.data) return <Pending error={offer.error} onRetry={offer.reload} />;
  const billing = offer.data.billing;
  const hasPlan = billing.status === "active" && billing.planId !== "pending";
  const total = Math.max(1, billing.monthlyTokens + Math.max(0, billing.bonusBalance));
  const left = Math.max(0, billing.balance);
  const low = !billing.unlimited && left / total < 0.1;
  const openPortal = async () => {
    setPortalBusy(true);
    try {
      await openLingbasePortal();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "The billing portal isn't available right now.");
    } finally {
      setPortalBusy(false);
    }
  };
  return (
    <>
      <Panel
        title={hasPlan ? `${billing.planName} plan` : "No plan yet"}
        description={hasPlan
          ? billing.unlimited ? "Your plan has unlimited credits." : `Your allowance of ${credits(billing.monthlyTokens)} credits renews on ${day(billing.periodEnd)}.`
          : "Pick a plan to start creating. Every plan includes the full workspace."}
        action={hasPlan ? <span className={`acp-status is-${billing.status}`}>{billing.status === "active" ? "Active" : billing.status.replace(/_/g, " ")}</span> : null}
      >
        {billing.unlimited ? null : (
          <div className="acp-balance">
            <div className="acp-balance-head">
              <strong className={low ? "is-low" : undefined}>{credits(left)}</strong>
              <span>credits left</span>
            </div>
            <CreditMeter value={left} max={total} low={low} />
            <Rows>
              <Row label="Monthly allowance left">{credits(Math.max(0, billing.allowanceRemaining))}</Row>
              <Row label="Bonus credits">{credits(Math.max(0, billing.bonusBalance))}</Row>
              <Row label="Used this period">{credits(Math.max(0, billing.periodUsed))}</Row>
            </Rows>
          </div>
        )}
        {canBuy ? (
          <div className="acp-actions">
            <button type="button" className="ui-btn is-primary" onClick={() => openBilling("plans")}>{hasPlan ? "Change plan" : "Choose a plan"}</button>
            {hasPlan && !billing.unlimited ? <button type="button" className="ui-btn" onClick={() => openBilling("packs")}>Buy credits</button> : null}
            {hasPlan ? <button type="button" className="ui-btn is-ghost" disabled={portalBusy} onClick={() => void openPortal()}>{portalBusy ? <Loader2 size={15} className="ui-spin" aria-hidden="true" /> : null}Manage subscription</button> : null}
          </div>
        ) : <p className="acp-note">Manage your plan on autoyt.cc in a browser.</p>}
      </Panel>
      <Panel title="Payments" description="Charges go through Stripe. Invoices and payment methods are in Manage subscription.">
        {!history.data ? <Pending error={history.error} onRetry={history.reload} /> : history.data.orders.length ? (
          <div className="acp-table-wrap">
            <table className="acp-table">
              <thead><tr><th scope="col">Date</th><th scope="col">Item</th><th scope="col" className="is-num">Amount</th><th scope="col">Status</th></tr></thead>
              <tbody>
                {history.data.orders.map((order) => (
                  <tr key={order.reference}>
                    <td>{day(order.paidAt || order.createdAt)}</td>
                    <td>{order.kind === "plan" ? `${order.planName || "Plan"} plan` : `${credits(order.creditsTokens)} credit bundle`}</td>
                    <td className="is-num">{money(order.amountCents, order.currency)}</td>
                    <td><span className={`acp-status is-${order.status}`}>{order.status === "paid" ? "Paid" : order.status === "pending" ? "Pending" : order.status === "refunded" ? "Refunded" : "Failed"}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="acp-note">No payments yet.</p>}
      </Panel>
    </>
  );
}

// ---------- usage ----------
function UsageSection() {
  const history = useLoad<History>("/api/billing/history", "autoyt-billing-changed");
  const series = useMemo(() => {
    const byDay = new Map((history.data?.usage.daily || []).map((row) => [row.day, row.tokens]));
    const days: Array<{ day: string; tokens: number }> = [];
    for (let i = 29; i >= 0; i--) {
      const date = new Date(Date.now() - i * 86400000);
      const key = date.toISOString().slice(0, 10);
      days.push({ day: key, tokens: byDay.get(key) || 0 });
    }
    return days;
  }, [history.data]);
  if (!history.data) return <Pending error={history.error} onRetry={history.reload} />;
  const total = series.reduce((sum, row) => sum + row.tokens, 0);
  const features = history.data.usage.byFeature;
  const top = Math.max(1, ...features.map((row) => row.tokens));
  return (
    <>
      <Panel title="Last 30 days" description={total ? `${credits(total)} credits used across ${features.reduce((sum, row) => sum + row.events, 0).toLocaleString()} AI calls.` : "No credits used in the last 30 days."}>
        <DailyBars series={series} />
      </Panel>
      <Panel title="By feature">
        {features.length ? (
          <ol className="acp-rank">
            {features.map((row) => (
              <li key={row.feature} title={`${featureName(row.feature)}: ${credits(row.tokens)} credits, ${row.events.toLocaleString()} calls`}>
                <span className="acp-rank-label">{featureName(row.feature)}</span>
                <span className="acp-rank-bar"><span style={{ width: `${(row.tokens / top) * 100}%` }} /></span>
                <span className="acp-rank-value">{credits(row.tokens)}</span>
              </li>
            ))}
          </ol>
        ) : <p className="acp-note">Nothing to show yet.</p>}
      </Panel>
      <Panel title="Credit activity" description="Renewals, purchases and changes to your balance.">
        {history.data.ledger.length ? (
          <div className="acp-table-wrap">
            <table className="acp-table">
              <thead><tr><th scope="col">Date</th><th scope="col">What</th><th scope="col" className="is-num">Credits</th><th scope="col" className="is-num">Balance after</th></tr></thead>
              <tbody>
                {history.data.ledger.map((row) => (
                  <tr key={row.id}>
                    <td>{day(row.createdAt)}</td>
                    <td>{LEDGER_LABEL[row.kind] || featureName(row.kind)}{row.note && !LEDGER_LABEL[row.kind] ? <small>{row.note}</small> : null}</td>
                    <td className={`is-num ${row.tokens < 0 ? "is-neg" : ""}`}>{row.tokens > 0 ? "+" : ""}{credits(row.tokens)}</td>
                    <td className="is-num">{credits(row.balanceAfter)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="acp-note">No balance changes yet.</p>}
      </Panel>
    </>
  );
}

function DailyBars({ series }: { series: Array<{ day: string; tokens: number }> }) {
  const [hover, setHover] = useState(-1);
  const max = Math.max(1, ...series.map((row) => row.tokens));
  const label = (key: string) => new Date(`${key}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const active = hover >= 0 ? series[hover] : null;
  return (
    <figure className="acp-bars">
      <div className="acp-bars-readout" aria-live="polite">
        {active ? <><strong>{credits(active.tokens)}</strong> credits on {label(active.day)}</> : <>Daily credits · peak <strong>{credits(max === 1 && !series.some((row) => row.tokens) ? 0 : max)}</strong></>}
      </div>
      <div className="acp-bars-plot" role="img" aria-label={`Credits used per day for the last 30 days, peak ${credits(max)}`} onMouseLeave={() => setHover(-1)}>
        {series.map((row, index) => (
          <span key={row.day} className={`acp-bar${index === hover ? " is-hover" : ""}`} onMouseEnter={() => setHover(index)}>
            <span style={{ height: row.tokens ? `${Math.max(3, (row.tokens / max) * 100)}%` : 0 }} />
          </span>
        ))}
      </div>
      <figcaption className="acp-bars-axis"><span>{label(series[0].day)}</span><span>Today</span></figcaption>
      <table className="acp-sr">
        <caption>Credits used per day</caption>
        <tbody>{series.filter((row) => row.tokens).map((row) => <tr key={row.day}><th scope="row">{label(row.day)}</th><td>{credits(row.tokens)}</td></tr>)}</tbody>
      </table>
    </figure>
  );
}

// ---------- channels ----------
function ChannelsSection({ auth, onRefresh }: { auth: AuthSessionPayload; onRefresh: () => Promise<void> }) {
  const accounts = auth.accounts || [];
  const { busy, select, disconnect } = useChannels(onRefresh);
  return (
    <>
      <Panel title="Connected channels" description="The active channel is where agents and the publish tools post by default.">
        {accounts.length ? (
          <ul className="acp-list">
            {accounts.map((account) => {
              const active = auth.activeAccount?.id === account.id;
              return (
                <li key={account.id}>
                  <Avatar src={account.thumbnailUrl || ""} name={account.channelTitle} size={40} />
                  <span className="acp-list-main">
                    <strong>{account.channelTitle}{active ? <span className="ui-badge is-accent acp-chip">Active</span> : null}</strong>
                    <small>{platformName(account.platform)}{account.channelHandle ? ` · ${account.channelHandle}` : ""}</small>
                  </span>
                  <span className="acp-list-actions">
                    {!active ? <button type="button" className="ui-btn is-sm" disabled={Boolean(busy)} onClick={() => void select(account)}>{busy === `select:${account.id}` ? <Loader2 size={14} className="ui-spin" aria-hidden="true" /> : null}Make active</button> : null}
                    <button type="button" className="ui-btn is-sm is-ghost" disabled={Boolean(busy)} onClick={() => void disconnect(account)} aria-label={`Disconnect ${account.channelTitle}`}>{busy === `remove:${account.id}` ? <Loader2 size={14} className="ui-spin" aria-hidden="true" /> : null}Disconnect</button>
                  </span>
                </li>
              );
            })}
          </ul>
        ) : <p className="acp-note">No channels yet. Connect one below to publish.</p>}
      </Panel>
      <Panel title="Connect a channel" description="Facebook connects a Page, and Instagram needs a Business or Creator account.">
        <PlatformGrid connectNext="/account/channels" label="Connect a channel" />
      </Panel>
    </>
  );
}

// ---------- telegram ----------
function TelegramSection() {
  const status = useLoad<TelegramLink>("/api/account/telegram");
  const [busy, setBusy] = useState("");
  useEffect(() => {
    // Linking finishes in Telegram; check again when the person comes back to this tab.
    const onFocus = () => status.reload();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [status.reload]);
  const link = async () => {
    setBusy("link");
    const tab = window.open("", "_blank");
    try {
      const { url } = await getJson<{ url: string }>("/api/account/telegram/link", { method: "POST" });
      if (tab) tab.location.href = url;
      else window.location.href = url;
      toast.success("Press Start in Telegram to finish linking.");
    } catch (cause) {
      tab?.close();
      toast.error(cause instanceof Error ? cause.message : "Couldn't start linking.");
    } finally {
      setBusy("");
    }
  };
  const unlink = async () => {
    if (!(await confirm({ title: "Unlink Telegram?", body: "Messages from that chat will stop reaching your agent.", confirmLabel: "Unlink", danger: true }))) return;
    setBusy("unlink");
    try {
      status.setData(await getJson<TelegramLink>("/api/account/telegram", { method: "DELETE" }));
      toast.success("Telegram unlinked.");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Couldn't unlink Telegram.");
    } finally {
      setBusy("");
    }
  };
  if (!status.data) return <Pending error={status.error} onRetry={status.reload} />;
  const data = status.data;
  return (
    <>
      <Panel
        title="Talk to your agent from Telegram"
        description="Message Juel, your AutoYT agent, from Telegram: make videos, images and recaps, edit, research, check your channels, or run your automation agents. Send voice notes, pictures, videos and audio files too. Replies show up in Juel's chat here."
        action={data.linked ? <span className="acp-status is-active">Linked</span> : null}
      >
        {!data.available ? (
          <p className="acp-note">Telegram isn't switched on for AutoYT yet. Check back soon.</p>
        ) : data.linked ? (
          <>
            <Rows>
              <Row label="Telegram">{data.linked.telegramName || "Linked chat"}</Row>
              <Row label="Bot"><a className="acp-link" href={`https://t.me/${data.botUsername}`} target="_blank" rel="noreferrer">@{data.botUsername}</a></Row>
              <Row label="Linked">{day(data.linked.linkedAt)}</Row>
            </Rows>
            <div className="acp-actions">
              <a className="ui-btn is-primary" href={`https://t.me/${data.botUsername}`} target="_blank" rel="noreferrer"><Send size={15} aria-hidden="true" />Open Telegram</a>
              <button type="button" className="ui-btn is-ghost" disabled={Boolean(busy)} onClick={() => void unlink()}>{busy === "unlink" ? <Loader2 size={15} className="ui-spin" aria-hidden="true" /> : null}Unlink</button>
            </div>
          </>
        ) : (
          <>
            <ol className="acp-steps">
              <li>Press <strong>Link Telegram</strong>. Telegram opens with the AutoYT bot.</li>
              <li>Press <strong>Start</strong> in Telegram. The link works for 15 minutes.</li>
              <li>Message the bot. It answers as your agent.</li>
            </ol>
            <div className="acp-actions">
              <button type="button" className="ui-btn is-primary" disabled={Boolean(busy)} onClick={() => void link()}>{busy === "link" ? <Loader2 size={15} className="ui-spin" aria-hidden="true" /> : <Link2 size={15} aria-hidden="true" />}Link Telegram</button>
            </div>
          </>
        )}
      </Panel>
      {data.available ? (
        <Panel title="Commands">
          <Rows>
            <Row label="/agents">Switch which agent you're talking to</Row>
            <Row label="/new">Start a fresh conversation</Row>
            <Row label="/stop">Cancel a reply that's still running</Row>
          </Rows>
        </Panel>
      ) : null}
    </>
  );
}

// ---------- developers: API tokens, MCP, and the REST API ----------
type ApiToken = { id: string; name: string; scope: TokenScope; prefix: string; createdAt: string; lastUsedAt: string | null };
type TokenScope = "read" | "create" | "full";
const SCOPES: Array<{ value: TokenScope; label: string; hint: string }> = [
  { value: "read", label: "Read only", hint: "Look things up: recaps, agents, analytics, projects. Can't change anything or spend credits." },
  { value: "create", label: "Create", hint: "Also change things and spend credits (recaps, renders, generations). Can't publish or delete." },
  { value: "full", label: "Full", hint: "Everything you can do, including posting to your channels and deleting." },
];
const scopeLabel = (scope: TokenScope) => SCOPES.find((s) => s.value === scope)?.label || scope;

function CodeBlock({ label, code }: { label: string; code: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy that.");
    }
  };
  return (
    <figure className="acp-code">
      <figcaption>
        <span>{label}</span>
        <button type="button" className="acp-link" onClick={() => void copy()}>{copied ? <><Check size={13} aria-hidden="true" />Copied</> : <><Copy size={13} aria-hidden="true" />Copy</>}</button>
      </figcaption>
      <pre><code>{code}</code></pre>
    </figure>
  );
}

function DocsLink({ page, children }: { page: string; children: ReactNode }) {
  return <a className="acp-link" href={`/docs/${page}`} onClick={(event) => { if (event.metaKey || event.ctrlKey) return; event.preventDefault(); writeDeepLink({ view: "docs", docsPage: page }); }}>{children}</a>;
}

function DevelopersSection() {
  const list = useLoad<{ tokens: ApiToken[] }>("/api/account/tokens");
  const [name, setName] = useState("");
  const [scope, setScope] = useState<TokenScope>("create");
  const [busy, setBusy] = useState("");
  const [fresh, setFresh] = useState<{ token: string; name: string } | null>(null);
  const origin = window.location.origin;
  const token = fresh?.token || "YOUR_TOKEN";
  const create = async () => {
    setBusy("create");
    try {
      const made = await getJson<ApiToken & { token: string }>("/api/account/tokens", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim() || "API token", scope }) });
      setFresh({ token: made.token, name: made.name });
      setName("");
      list.reload();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Couldn't create the token.");
    } finally {
      setBusy("");
    }
  };
  const revoke = async (item: ApiToken) => {
    if (!(await confirm({ title: `Revoke "${item.name}"?`, body: "Anything using this token (an AI agent, a script) stops working right away.", confirmLabel: "Revoke", danger: true }))) return;
    setBusy(item.id);
    try {
      await getJson(`/api/account/tokens/${encodeURIComponent(item.id)}`, { method: "DELETE" });
      list.setData((current) => (current ? { tokens: current.tokens.filter((t) => t.id !== item.id) } : current));
      toast.success("Token revoked.");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Couldn't revoke the token.");
    } finally {
      setBusy("");
    }
  };
  return (
    <>
      <Panel title="Personal access tokens" description="A token lets an AI agent (Claude, Codex, and others) or your own scripts use AutoYT as you, within the scope you pick. Paid work spends your credits, and nothing runs that your balance can't cover.">
        <div className="acp-token-form">
          <label className="acp-field">
            <span>Name</span>
            <input className="ui-input" value={name} onChange={(event) => setName(event.target.value)} placeholder="Claude Code on my laptop" maxLength={60} />
          </label>
          <div className="acp-field">
            <span>Scope</span>
            <Segmented<TokenScope> label="Token scope" value={scope} options={SCOPES.map((s) => ({ value: s.value, label: s.label }))} onChange={setScope} />
            <small>{SCOPES.find((s) => s.value === scope)?.hint}</small>
          </div>
          <div className="acp-actions">
            <button type="button" className="ui-btn is-primary" disabled={Boolean(busy)} onClick={() => void create()}>{busy === "create" ? <Loader2 size={15} className="ui-spin" aria-hidden="true" /> : <KeyRound size={15} aria-hidden="true" />}Create token</button>
          </div>
        </div>
        {fresh ? (
          <div className="acp-token-new" role="status">
            <strong>Copy "{fresh.name}" now. It won't be shown again.</strong>
            <CodeBlock label="Token" code={fresh.token} />
          </div>
        ) : null}
        {!list.data ? <Pending error={list.error} onRetry={list.reload} /> : list.data.tokens.length ? (
          <ul className="acp-tokens">
            {list.data.tokens.map((item) => (
              <li key={item.id}>
                <span className="acp-token-name"><strong>{item.name}</strong><code>{item.prefix}</code></span>
                <span className="acp-token-meta">{scopeLabel(item.scope)} · created {day(item.createdAt)} · {item.lastUsedAt ? `last used ${day(item.lastUsedAt)}` : "never used"}</span>
                <button type="button" className="ui-btn is-sm is-ghost" disabled={busy === item.id} onClick={() => void revoke(item)}>{busy === item.id ? <Loader2 size={14} className="ui-spin" aria-hidden="true" /> : null}Revoke</button>
              </li>
            ))}
          </ul>
        ) : <p className="acp-note">No tokens yet.</p>}
      </Panel>
      <Panel title="Connect an AI agent (MCP)" description={<>AutoYT is an MCP server at <code>{origin}/mcp</code>. Agents get Juel (hand it a task in plain words) and the whole API: find, describe, and call any route, quote credits, and check your balance. <DocsLink page="mcp">MCP docs</DocsLink></>}>
        <CodeBlock label="Claude Code" code={`claude mcp add --transport http autoyt ${origin}/mcp --header "Authorization: Bearer ${token}"`} />
        <CodeBlock label="Codex (~/.codex/config.toml, with AUTOYT_TOKEN set in your shell)" code={`[mcp_servers.autoyt]\nurl = "${origin}/mcp"\nbearer_token_env_var = "AUTOYT_TOKEN"`} />
        <CodeBlock label="Other MCP clients (JSON config)" code={JSON.stringify({ mcpServers: { autoyt: { type: "http", url: `${origin}/mcp`, headers: { Authorization: `Bearer ${token}` } } } }, null, 2)} />
      </Panel>
      <Panel title="REST API" description={<>Every route works with the token as a Bearer header. The full list, with what each one does, its risk, and whether it spends credits, is in the <DocsLink page="api-reference">API reference</DocsLink> (also as <a className="acp-link" href="/api/openapi.json" target="_blank" rel="noreferrer">openapi.json</a>).</>}>
        <CodeBlock label="List your recaps" code={`curl -H "Authorization: Bearer ${token}" ${origin}/api/recaps`} />
        <Rows>
          <Row label="401">The token is missing, wrong, or revoked</Row>
          <Row label="402">Not enough credits; the reply says what it needed</Row>
          <Row label="403">Outside the token's scope, or an admin route</Row>
          <Row label="429">Over 300 requests a minute</Row>
        </Rows>
        <p className="acp-note">Paid calls return an X-AutoYT-Credits-Estimate header with their quote.</p>
      </Panel>
    </>
  );
}

// ---------- security ----------
function SecuritySection({ auth, theme, onLogout }: { auth: AuthSessionPayload; theme: Theme; onLogout: () => void }) {
  const overview = useLoad<Overview>("/api/account/overview");
  const [busy, setBusy] = useState(false);
  const [supportOpen, setSupportOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const others = Math.max(0, (overview.data?.sessions || 1) - 1);
  const signOutOthers = async () => {
    setBusy(true);
    try {
      const { signedOut } = await getJson<{ signedOut: number }>("/api/account/sessions/revoke-others", { method: "POST" });
      toast.success(signedOut ? `Signed out of ${signedOut} other ${signedOut === 1 ? "device" : "devices"}.` : "No other devices were signed in.");
      overview.reload();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Couldn't sign out other devices.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Panel title="Sign-in" description="You sign in with Google, so your password and two-step verification are managed in your Google account.">
        <Rows>
          <Row label="Google account">{auth.user?.email}</Row>
          <Row label="Signed in on">{overview.data ? `${overview.data.sessions} ${overview.data.sessions === 1 ? "device" : "devices"}` : "…"}</Row>
        </Rows>
        <div className="acp-actions">
          <button type="button" className="ui-btn" disabled={busy || !others} onClick={() => void signOutOthers()}>{busy ? <Loader2 size={15} className="ui-spin" aria-hidden="true" /> : null}Sign out of other devices</button>
          <button type="button" className="ui-btn is-ghost" onClick={onLogout}><LogOut size={15} aria-hidden="true" />Log out</button>
        </div>
        <p className="acp-note">A linked Telegram chat counts as a device and reconnects by itself.</p>
      </Panel>
      <Panel title="Help">
        <div className="acp-actions">
          <button type="button" className="ui-btn" onClick={() => setSupportOpen(true)}><LifeBuoy size={15} aria-hidden="true" />Help & support</button>
        </div>
      </Panel>
      <Panel title="Delete account" description="Deletes your account, projects, agents and connected channels for good. This can't be undone.">
        <div className="acp-actions">
          <button type="button" className="ui-btn is-danger" onClick={() => setDeleteOpen(true)}><Trash2 size={15} aria-hidden="true" />Delete account</button>
        </div>
      </Panel>
      <SupportDialog open={supportOpen} onClose={() => setSupportOpen(false)} theme={theme} />
      <DeleteAccountDialog open={deleteOpen} onClose={() => setDeleteOpen(false)} theme={theme} />
    </>
  );
}

export default AccountPage;
