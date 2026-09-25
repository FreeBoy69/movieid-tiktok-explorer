import { useEffect, useState, type ReactNode } from "react";
import { ArrowLeft, Check, Copy, ExternalLink } from "lucide-react";
import { adminFetch, can, fmt } from "../api";
import { toast } from "../../utils/toast";
import {
  Avatar, Badge, BarChart, Button, Card, cx, DataTable, Empty, ErrorState, Field, Guarded, Loading, Modal, Pager, RankBars, Segmented, Stat, Toggle, useAdminQuery,
} from "../ui";
import { ActivityFeed } from "./ActivityPage";
import type { PageProps } from "../AdminApp";

type Plan = { id: string; name: string; priceCents: number; monthlyTokens: number; active: boolean };
type Billing = {
  planId: string; planName: string; priceCents: number; monthlyTokens: number; allowanceRemaining: number; bonusBalance: number; balance: number;
  unlimited: boolean; status: string; periodStart: string; periodEnd: string; periodUsed: number; notes: string; paymentProvider: string;
};
type Detail = {
  user: { id: string; email: string; name: string; avatarUrl: string; status: string; statusReason: string; createdAt: string; lastSeenAt: string | null };
  billing: Billing | null;
  counts: Record<string, number | string | null>;
  channels: Array<{ id: string; platform: string; title: string; handle: string; thumbnailUrl: string; connectedAt: string }>;
  usageByDay: Array<{ day: string; tokens: number }>;
  usageByFeature: Array<{ feature: string; operation: string; tokens: number; calls: number }>;
  ledger: Array<{ id: string; kind: string; tokens: number; balanceAfter: number; actor: string; note: string; createdAt: string }>;
  tickets: Array<{ id: string; subject: string; status: string; priority: string; lastMessageAt: string }>;
  agents: Array<{ id: string; name: string; status: string; lastRunAt: string | null; nextRunAt: string | null }>;
};

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "usage", label: "Usage" },
  { id: "billing", label: "Billing" },
  { id: "content", label: "Content" },
  { id: "automation", label: "Automation" },
  { id: "activity", label: "Activity" },
  { id: "support", label: "Support" },
  { id: "security", label: "Security" },
  { id: "log", label: "Admin log" },
];
const n = (value: unknown) => Number(value) || 0;

export function UserDetailPage({ admin, route, navigate }: PageProps) {
  const userId = route.id;
  const tab = TABS.some((t) => t.id === route.sub) ? route.sub : "overview";
  const query = useAdminQuery<Detail>(`/api/admin/users/${encodeURIComponent(userId)}`);
  const plans = useAdminQuery<{ plans: Plan[] }>("/api/admin/billing/plans");
  const [modal, setModal] = useState<"" | "tokens" | "plan" | "suspend">("");
  const go = (next: string) => navigate(`/admin/users/${encodeURIComponent(userId)}${next === "overview" ? "" : `/${next}`}`, { replace: true });

  if (query.error && !query.data) return <div className="adm-page"><BackLink navigate={navigate} /><ErrorState message={query.error} onRetry={query.reload} /></div>;
  if (!query.data) return <div className="adm-page"><BackLink navigate={navigate} /><Loading label="Loading user" /></div>;
  const d = query.data;
  const b = d.billing;
  const tabProps = { d, admin, navigate, reload: query.reload, plans: plans.data?.plans || [], userId, go, openModal: setModal };

  return (
    <div className="adm-page">
      <BackLink navigate={navigate} />
      <header className="adm-user-head">
        <Avatar src={d.user.avatarUrl} name={d.user.name || d.user.email} size={64} />
        <div className="adm-user-id">
          <h1>{d.user.name || d.user.email}</h1>
          <p>{d.user.email}</p>
          <div className="adm-inline">
            <Badge>{d.user.status}</Badge>
            {b ? <Badge tone="neutral">{`${b.planName} plan`}</Badge> : null}
            {b?.unlimited ? <Badge tone="accent">Unlimited credits</Badge> : null}
            {b && !b.unlimited && b.balance <= 0 ? <Badge tone="bad">Out of credits</Badge> : null}
            {n(d.counts.openTickets) ? <Badge tone="accent">{`${n(d.counts.openTickets)} open request${n(d.counts.openTickets) === 1 ? "" : "s"}`}</Badge> : null}
          </div>
          <p className="adm-user-meta">
            Joined {fmt.date(d.user.createdAt)} · Last active {fmt.ago(d.user.lastSeenAt).toLowerCase()} · Last AI call {fmt.ago(d.counts.lastAiAt).toLowerCase()} · <CopyId id={d.user.id} />
          </p>
        </div>
        <div className="adm-user-actions">
          {can(admin, "billing.manage") ? <Button variant="primary" onClick={() => setModal("tokens")}>Give credits</Button> : null}
          {can(admin, "billing.manage") ? <Button onClick={() => setModal("plan")}>Change plan</Button> : null}
          {can(admin, "users.manage") ? (
            d.user.status === "suspended"
              ? <RestoreButton userId={userId} onDone={query.reload} />
              : <Button variant="danger" onClick={() => setModal("suspend")}>Suspend</Button>
          ) : null}
        </div>
      </header>
      {d.user.status === "suspended" ? <div className="adm-banner is-bad"><strong>Suspended.</strong> {d.user.statusReason || "No reason recorded."}</div> : null}

      <nav className="adm-tabs" aria-label="User sections">
        {TABS.map((t) => (
          <button key={t.id} type="button" className={cx(tab === t.id && "is-on")} aria-current={tab === t.id ? "page" : undefined} onClick={() => go(t.id)}>
            {t.label}
            {t.id === "support" && n(d.counts.openTickets) ? <span className="adm-seg-count">{n(d.counts.openTickets)}</span> : null}
          </button>
        ))}
      </nav>

      {tab === "overview" ? <OverviewTab {...tabProps} /> : null}
      {tab === "usage" ? <UsageTab {...tabProps} /> : null}
      {tab === "billing" ? <BillingTab {...tabProps} /> : null}
      {tab === "content" ? <ContentTab {...tabProps} /> : null}
      {tab === "automation" ? <AutomationTab {...tabProps} /> : null}
      {tab === "activity" ? <ActivityTab {...tabProps} /> : null}
      {tab === "support" ? <SupportTab {...tabProps} /> : null}
      {tab === "security" ? <SecurityTab {...tabProps} /> : null}
      {tab === "log" ? <LogTab {...tabProps} /> : null}

      <TokensModal open={modal === "tokens"} onClose={() => setModal("")} userId={userId} name={d.user.name || d.user.email} onDone={query.reload} />
      <PlanModal open={modal === "plan"} onClose={() => setModal("")} userId={userId} billing={b} plans={plans.data?.plans || []} onDone={query.reload} />
      <SuspendModal open={modal === "suspend"} onClose={() => setModal("")} userId={userId} name={d.user.name || d.user.email} onDone={query.reload} />
    </div>
  );
}

type TabProps = {
  d: Detail; admin: PageProps["admin"]; navigate: PageProps["navigate"]; reload: () => void; plans: Plan[]; userId: string;
  go: (tab: string) => void; openModal: (modal: "" | "tokens" | "plan" | "suspend") => void;
};

function BackLink({ navigate }: { navigate: PageProps["navigate"] }) {
  return <button type="button" className="adm-back" onClick={() => navigate("/admin/users")}><ArrowLeft size={15} aria-hidden="true" /> All users</button>;
}

function CopyId({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button type="button" className="adm-copy" onClick={() => { void navigator.clipboard?.writeText(id); setCopied(true); window.setTimeout(() => setCopied(false), 1500); }} title="Copy user id">
      <code>{id}</code>{copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
    </button>
  );
}

// ---------- Overview ----------
function OverviewTab({ d, admin, navigate, go, userId, reload }: TabProps) {
  const b = d.billing;
  const c = d.counts;
  const margin = (b?.priceCents || 0) / 100 - n(c.cost30d);
  const allowance = b ? Math.max(1, b.monthlyTokens) : 1;
  return (
    <>
      <div className="adm-stats is-4">
        <Stat label="Credits left" value={b?.unlimited ? "Unlimited" : fmt.credits(b?.balance)} hint={b ? `${fmt.credits(b.allowanceRemaining)} allowance + ${fmt.credits(b.bonusBalance)} bonus` : undefined} />
        <Stat label="Used this period" value={fmt.credits(b?.periodUsed)} hint={b ? `${Math.round((n(b.periodUsed) / allowance) * 100)}% of ${fmt.credits(b.monthlyTokens)} · renews ${fmt.date(b.periodEnd)}` : undefined} />
        <Stat label="AI cost (30d)" value={fmt.usd(c.cost30d)} hint={`${fmt.number(c.calls30d)} calls · ${fmt.usd(c.costAllTime)} all time`} />
        <Stat label="Margin (30d)" value={`${margin < 0 ? "−" : ""}${fmt.usd(Math.abs(margin))}`} hint={`${fmt.cents(b?.priceCents)} plan − AI cost`} />
        <Stat label="Uploads" value={fmt.number(c.uploads)} hint={`${fmt.number(c.uploads30d)} in the last 30 days`} />
        <Stat label="Views on uploads" value={fmt.tokens(c.views)} hint={`${fmt.tokens(c.likes)} likes`} />
        <Stat label="Projects" value={fmt.number(c.projects)} hint={`${fmt.number(c.jobs)} jobs · ${fmt.number(c.failedJobs7d)} failed this week`} />
        <Stat label="Automation" value={`${fmt.number(c.activeAgents)} live`} hint={`of ${fmt.number(c.agents)} agents`} />
      </div>
      <div className="adm-grid is-2-1">
        <Card title="Credits per day, last 30 days" action={<button type="button" className="adm-link" onClick={() => go("usage")}>Full usage</button>}>
          <BarChart label="Credits per day" data={d.usageByDay.map((x) => ({ label: x.day, value: n(x.tokens) }))} format={fmt.credits} height={160} />
        </Card>
        <Card title="Profile">
          <dl className="adm-facts is-1">
            <Fact label="Plan">{b ? `${b.planName}${b.priceCents ? ` · ${fmt.cents(b.priceCents)}/mo` : ""}` : "—"}</Fact>
            <Fact label="Billing status">{b ? <Badge>{b.status}</Badge> : "—"}</Fact>
            <Fact label="Signed-in devices">{fmt.number(c.sessions)}</Fact>
            <Fact label="Channels">{fmt.number(d.channels.length)}</Fact>
            <Fact label="Channel styles">{fmt.number(c.styles)}</Fact>
            <Fact label="Saved TikTok playlists">{fmt.number(c.playlists)}</Fact>
            <Fact label="Tracked competitors">{fmt.number(c.competitors)}</Fact>
            <Fact label="Admin actions on this user">{fmt.number(c.adminActions)}</Fact>
          </dl>
        </Card>
      </div>
      <div className="adm-grid is-2">
        <Card title="Where their credits go (30d)">
          <RankBars format={fmt.credits} items={d.usageByFeature.map((f) => ({ key: `${f.feature}-${f.operation}`, label: <code>{f.feature || "unknown"}</code>, sub: `${f.operation} · ${fmt.number(f.calls)} calls`, value: n(f.tokens) }))} />
        </Card>
        <Card title="Connected channels" flush>
          {d.channels.length ? (
            <ul className="adm-list is-dense">
              {d.channels.map((ch) => (
                <li key={ch.id}>
                  <span className="adm-person">
                    <Avatar src={ch.thumbnailUrl} name={ch.title} size={30} />
                    <span className="adm-person-text"><strong>{ch.title}</strong><small>{ch.platform}{ch.handle ? ` · ${ch.handle}` : ""}</small></span>
                  </span>
                  <span className="adm-muted">{fmt.date(ch.connectedAt)}</span>
                </li>
              ))}
            </ul>
          ) : <Empty title="No channels connected" />}
        </Card>
      </div>
      <NotesCard userId={userId} initial={b?.notes || ""} canEdit={can(admin, "billing.manage")} onSaved={reload} />
      <div>
        <div className="adm-section-head"><h2>Recent activity</h2><button type="button" className="adm-link" onClick={() => go("activity")}>All activity</button></div>
        <ActivityFeed admin={admin} navigate={navigate} userId={userId} type="" limit={8} compact />
      </div>
    </>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return <div><dt>{label}</dt><dd>{children}</dd></div>;
}

function NotesCard({ userId, initial, canEdit, onSaved }: { userId: string; initial: string; canEdit: boolean; onSaved: () => void }) {
  const [notes, setNotes] = useState(initial);
  const [saving, setSaving] = useState(false);
  useEffect(() => setNotes(initial), [initial]);
  const save = async () => {
    setSaving(true);
    try {
      await adminFetch(`/api/admin/users/${userId}/billing`, { method: "POST", body: { notes } });
      toast.success("Notes saved.");
      onSaved();
    } catch (error) {
      toast.error(error);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Card title="Admin notes" action={canEdit ? <Button size="sm" variant="primary" disabled={notes === initial} loading={saving} onClick={save}>Save</Button> : null}>
      <textarea className="adm-input" rows={3} value={notes} disabled={!canEdit} onChange={(event) => setNotes(event.target.value)} placeholder="Only admins see these notes. e.g. Partner channel, agreed to 100k free credits until December." aria-label="Admin notes" />
    </Card>
  );
}

// ---------- Usage ----------
type UserUsage = {
  totals: { tokens: number; cost: number; calls: number; inputTokens: number; outputTokens: number; estimatedShare: number; activeDays: number };
  allTime: { tokens: number; cost: number; calls: number; firstAt: string | null; lastAt: string | null };
  series: Array<{ day: string; tokens: number; cost: number; calls: number }>;
  byProvider: Array<{ provider: string; tokens: number; cost: number; calls: number }>;
  byModel: Array<{ provider: string; model: string; tokens: number; cost: number; calls: number; inputTokens: number; outputTokens: number }>;
  byOperation: Array<{ operation: string; tokens: number; cost: number; calls: number }>;
  byFeature: Array<{ feature: string; tokens: number; cost: number; calls: number }>;
};
type UsageEvent = { id: string; provider: string; model: string; operation: string; feature: string; inputTokens: number; outputTokens: number; cost: number; costEstimated: boolean; tokens: number; createdAt: string };

function UsageTab({ userId }: TabProps) {
  const [days, setDays] = useState<"7" | "30" | "90">("30");
  const [metric, setMetric] = useState<"tokens" | "cost" | "calls">("tokens");
  const query = useAdminQuery<UserUsage>(`/api/admin/users/${userId}/usage?days=${days}`);
  const [offset, setOffset] = useState(0);
  const events = useAdminQuery<{ events: UsageEvent[] }>(`/api/admin/usage/events?userId=${encodeURIComponent(userId)}&limit=25&offset=${offset}`);
  const value = (row: { tokens: number; cost: number; calls: number }) => n(row[metric]);
  const format = metric === "tokens" ? fmt.credits : metric === "cost" ? fmt.usd : fmt.number;
  return (
    <>
      <div className="adm-toolbar">
        <Segmented label="Measure" value={metric} onChange={setMetric} options={[{ value: "tokens", label: "Credits" }, { value: "cost", label: "Cost" }, { value: "calls", label: "Calls" }]} />
        <Segmented label="Window" value={days} onChange={setDays} options={[{ value: "7", label: "7d" }, { value: "30", label: "30d" }, { value: "90", label: "90d" }]} />
      </div>
      <Guarded query={query} label="Loading usage">
        {(u) => {
          const peak = u.series.reduce((best, s) => (n(s.tokens) > n(best?.tokens) ? s : best), u.series[0]);
          const perActiveDay = n(u.totals.activeDays) ? n(u.totals.tokens) / n(u.totals.activeDays) : 0;
          return (
            <>
              <div className="adm-stats">
                <Stat label="Credits charged" value={fmt.credits(u.totals.tokens)} hint={`${fmt.credits(u.allTime.tokens)} all time`} />
                <Stat label="AI cost" value={fmt.usd(u.totals.cost)} hint={`${fmt.usd(u.allTime.cost)} all time`} />
                <Stat label="AI calls" value={fmt.number(u.totals.calls)} hint={`${fmt.number(u.totals.activeDays)} active days`} />
                <Stat label="Per active day" value={fmt.credits(perActiveDay)} hint={peak && n(peak.tokens) ? `peak ${fmt.credits(peak.tokens)} on ${fmt.date(peak.day)}` : "no usage yet"} />
                <Stat label="Model tokens" value={fmt.tokens(n(u.totals.inputTokens) + n(u.totals.outputTokens))} hint={`${fmt.tokens(u.totals.inputTokens)} in · ${fmt.tokens(u.totals.outputTokens)} out`} />
                <Stat label="First / last AI call" value={fmt.ago(u.allTime.lastAt)} hint={u.allTime.firstAt ? `first on ${fmt.date(u.allTime.firstAt)}` : "never"} />
              </div>
              <Card title={`${metric === "tokens" ? "Credits charged" : metric === "cost" ? "AI cost" : "AI calls"} per day`}>
                <BarChart label="Usage per day" data={u.series.map((s) => ({ label: s.day, value: value(s) }))} format={format} />
              </Card>
              <div className="adm-grid is-3">
                <Card title="By type"><RankBars format={format} items={u.byOperation.map((o) => ({ key: o.operation, label: o.operation, sub: `${fmt.number(o.calls)} calls`, value: value(o) }))} /></Card>
                <Card title="By provider"><RankBars format={format} items={u.byProvider.map((p) => ({ key: p.provider, label: p.provider, sub: `${fmt.number(p.calls)} calls`, value: value(p) }))} /></Card>
                <Card title="By feature"><RankBars format={format} items={u.byFeature.map((f) => ({ key: f.feature || "unknown", label: <code>{f.feature || "unknown"}</code>, sub: `${fmt.number(f.calls)} calls`, value: value(f) }))} /></Card>
              </div>
              <Card title="Models" flush>
                <DataTable
                  rowKey={(m) => `${m.provider}-${m.model}`}
                  rows={u.byModel}
                  empty={<Empty title="No AI calls in this window" />}
                  columns={[
                    { key: "model", label: "Model", render: (m) => <span className="adm-list-main"><code>{m.model || "unknown"}</code><small>{m.provider}</small></span> },
                    { key: "calls", label: "Calls", align: "right", render: (m) => fmt.number(m.calls) },
                    { key: "io", label: "In / out", align: "right", render: (m) => `${fmt.tokens(m.inputTokens)} / ${fmt.tokens(m.outputTokens)}` },
                    { key: "cost", label: "Cost", align: "right", render: (m) => fmt.usd(m.cost) },
                    { key: "tokens", label: "Charged", align: "right", render: (m) => fmt.credits(m.tokens) },
                  ]}
                />
              </Card>
            </>
          );
        }}
      </Guarded>
      <Card title="Every AI call" flush>
        <Guarded query={events} label="Loading calls">
          {({ events: rows }) => (
            <>
              <DataTable
                rowKey={(e) => e.id}
                rows={rows}
                empty={<Empty title="No AI calls recorded yet" />}
                columns={[
                  { key: "when", label: "When", render: (e) => <span className="adm-muted">{fmt.dateTime(e.createdAt)}</span> },
                  { key: "feature", label: "Feature", render: (e) => <span className="adm-list-main"><code>{e.feature || "—"}</code><small>{e.operation} · {e.model}</small></span> },
                  { key: "io", label: "In / out", align: "right", render: (e) => `${fmt.number(e.inputTokens)} / ${fmt.number(e.outputTokens)}` },
                  { key: "cost", label: "Cost", align: "right", render: (e) => <span title={e.costEstimated ? "Estimated" : "Reported by provider"}>{fmt.usd(e.cost)}{e.costEstimated ? "*" : ""}</span> },
                    { key: "tokens", label: "Charged", align: "right", render: (e) => fmt.credits(e.tokens) },
                ]}
              />
              <Pager offset={offset} limit={25} count={rows.length} onChange={setOffset} />
            </>
          )}
        </Guarded>
      </Card>
    </>
  );
}

// ---------- Billing ----------
type LedgerEntry = { id: string; kind: string; tokens: number; balanceAfter: number; actor: string; note: string; createdAt: string };

function BillingTab({ d, admin, userId, reload, openModal }: TabProps) {
  const b = d.billing;
  const [offset, setOffset] = useState(0);
  const ledger = useAdminQuery<{ entries: LedgerEntry[] }>(`/api/admin/billing/ledger?userId=${encodeURIComponent(userId)}&limit=25&offset=${offset}`);
  const [busy, setBusy] = useState("");
  const manage = can(admin, "billing.manage");
  const update = async (key: string, body: Record<string, unknown>, message: string) => {
    setBusy(key);
    try {
      await adminFetch(`/api/admin/users/${userId}/billing`, { method: "POST", body });
      toast.success(message);
      reload();
    } catch (error) {
      toast.error(error);
    } finally {
      setBusy("");
    }
  };
  if (!b) return <Empty title="No billing account yet">It's created the first time this user makes an AI call.</Empty>;
  const allowancePct = Math.min(100, (n(b.allowanceRemaining) / Math.max(1, b.monthlyTokens)) * 100);
  return (
    <>
      <div className="adm-grid is-2">
        <Card title="Plan" action={manage ? <Button size="sm" onClick={() => openModal("plan")}>Change plan</Button> : null}>
          <div className="adm-plan-line">
            <strong>{b.planName}</strong>
            <span>{b.priceCents ? `${fmt.cents(b.priceCents)} / month` : "Free"}</span>
          </div>
          <dl className="adm-facts">
            <Fact label="Monthly allowance">{fmt.credits(b.monthlyTokens)} credits</Fact>
            <Fact label="Current period">{fmt.date(b.periodStart)} – {fmt.date(b.periodEnd)}</Fact>
            <Fact label="Payment">{b.paymentProvider === "manual" ? "Manual (no card on file)" : b.paymentProvider}</Fact>
            <Fact label="Used this period">{fmt.credits(b.periodUsed)} credits</Fact>
          </dl>
          <div className="adm-field">
            <label htmlFor="billing-status">Billing status</label>
            <select id="billing-status" className="adm-select" value={b.status} disabled={!manage || busy === "status"} onChange={(event) => update("status", { status: event.target.value }, "Billing status updated.")}>
              <option value="active">Active</option>
              <option value="past_due">Past due</option>
              <option value="canceled">Canceled</option>
            </select>
          </div>
        </Card>
        <Card title="Balance" action={manage ? <Button size="sm" variant="primary" onClick={() => openModal("tokens")}>Give or remove credits</Button> : null}>
          <div className="adm-plan-line">
            <strong>{b.unlimited ? "Unlimited" : `${fmt.credits(b.balance)} credits`}</strong>
            <span>left to spend</span>
          </div>
          <div className="adm-meter-row">
            <span>Monthly allowance</span>
            <strong>{fmt.credits(b.allowanceRemaining)} of {fmt.credits(b.monthlyTokens)}</strong>
          </div>
          <div className="adm-meter"><span style={{ width: `${allowancePct}%` }} /></div>
          <div className="adm-meter-row">
            <span>Bonus credits (never expire)</span>
            <strong className={b.bonusBalance < 0 ? "adm-bad-text" : undefined}>{fmt.credits(b.bonusBalance)}</strong>
          </div>
          <Toggle
            label="Unlimited credits"
            description="Usage is still recorded, but this account is never blocked."
            checked={b.unlimited}
            disabled={!manage || busy === "unlimited"}
            onChange={(value) => void update("unlimited", { unlimited: value }, value ? "Unlimited credits on." : "Unlimited credits off.")}
          />
        </Card>
      </div>
      <Card title="Credit ledger" flush>
        <Guarded query={ledger} label="Loading ledger">
          {({ entries }) => (
            <>
              <DataTable
                rowKey={(e) => e.id}
                rows={entries}
                empty={<Empty title="No ledger entries yet">Grants, removals, plan changes and monthly renewals appear here.</Empty>}
                columns={[
                  { key: "when", label: "When", render: (e) => <span className="adm-muted">{fmt.dateTime(e.createdAt)}</span> },
                  { key: "what", label: "Change", render: (e) => <span className="adm-list-main"><span>{e.note || e.kind.replace(/_/g, " ")}</span><small>{e.kind.replace(/_/g, " ")}</small></span> },
                  { key: "who", label: "By", render: (e) => <span className="adm-muted">{e.actor}</span> },
                  { key: "tokens", label: "Credits", align: "right", render: (e) => <span className={e.tokens < 0 ? "adm-bad-text" : "adm-good-text"}>{e.tokens > 0 ? "+" : ""}{fmt.credits(e.tokens)}</span> },
                  { key: "after", label: "Balance after", align: "right", render: (e) => fmt.credits(e.balanceAfter) },
                ]}
              />
              <Pager offset={offset} limit={25} count={entries.length} onChange={setOffset} />
            </>
          )}
        </Guarded>
      </Card>
    </>
  );
}

// ---------- Content ----------
type Content = {
  projects: Array<{ id: string; title: string; stage: string; status: string; sourceType: string; archivedAt: string | null; createdAt: string; updatedAt: string }>;
  stageJobs: Array<{ id: string; stage: string; status: string; progress: number; error: string; message: string; createdAt: string; updatedAt: string; projectTitle: string | null }>;
  mediaJobs: Array<{ id: string; kind: string; status: string; attempts: number; error: string; message: string; createdAt: string; finishedAt: string | null }>;
  agents: Array<{ id: string; name: string; status: string; sourceType: string; sourceUrl: string; lastRunAt: string | null; nextRunAt: string | null; createdAt: string; channel: string | null; uploads: number; views: number; lastRunStatus: string | null; lastRunMessage: string | null; failures7d: number }>;
  uploads: Array<{ id: string; title: string; url: string; status: string; genre: string; createdAt: string; scheduleAt: string | null; agent: string | null; via: string; views: number; likes: number; comments: number }>;
  uploadsByDay: Array<{ day: string; uploads: number }>;
  styles: Array<{ id: string; name: string; niche: string; subNiche: string; status: string; sourceUrl: string; createdAt: string }>;
  playlists: Array<{ id: string; slug: string; url: string; savedAt: string; videos: number }>;
  competitors: Array<{ id: string; title: string; url: string; niche: string; score: number; lastCheckedAt: string | null }>;
  research: Array<{ id: string; name: string; updatedAt: string }>;
  chats: { chats: number; messages: number; lastAt: string | null };
  recentUploadStats: { views: number; likes: number; comments: number };
};

function useContent(userId: string) {
  return useAdminQuery<Content>(`/api/admin/users/${userId}/content`);
}

function ContentTab({ userId, admin, navigate }: TabProps) {
  const query = useContent(userId);
  const [cancelling, setCancelling] = useState("");
  const cancel = async (id: string) => {
    setCancelling(id);
    try {
      await adminFetch(`/api/admin/jobs/${id}/cancel`, { method: "POST", body: {} });
      toast.success("Job cancelled.");
      query.reload();
    } catch (error) {
      toast.error(error);
    } finally {
      setCancelling("");
    }
  };
  return (
    <Guarded query={query} label="Loading content">
      {(c) => (
        <>
          <div className="adm-stats">
            <Stat label="Projects" value={fmt.number(c.projects.length)} hint={`${fmt.number(c.projects.filter((p) => !p.archivedAt).length)} not archived`} />
            <Stat label="Creator jobs" value={fmt.number(c.stageJobs.length)} hint={`${fmt.number(c.stageJobs.filter((j) => j.status === "failed").length)} failed · latest 50`} />
            <Stat label="Media jobs" value={fmt.number(c.mediaJobs.length)} hint={`${fmt.number(c.mediaJobs.filter((j) => j.status === "failed").length)} failed · latest 50`} />
            <Stat label="Research" value={fmt.number(c.playlists.length + c.competitors.length + c.research.length)} hint={`${c.playlists.length} playlists · ${c.competitors.length} competitors · ${c.research.length} collections`} />
          </div>
          <Card title="Projects" flush>
            <DataTable
              rowKey={(p) => p.id}
              rows={c.projects}
              onRowClick={(p) => navigate(`/admin/activity/project/${p.id}`)}
              empty={<Empty title="No projects yet" />}
              columns={[
                { key: "title", label: "Project", render: (p) => <span className="adm-list-main"><strong>{p.title || "Untitled"}</strong><small>{p.sourceType.replace(/_/g, " ")}</small></span> },
                { key: "stage", label: "Stage", render: (p) => p.stage },
                { key: "status", label: "Status", render: (p) => <Badge>{p.archivedAt ? "archived" : p.status}</Badge> },
                { key: "created", label: "Created", render: (p) => <span className="adm-muted">{fmt.date(p.createdAt)}</span> },
                { key: "updated", label: "Last edit", render: (p) => <span className="adm-muted">{fmt.ago(p.updatedAt)}</span> },
              ]}
            />
          </Card>
          <Card title="Creator jobs" flush>
            <DataTable
              rowKey={(j) => j.id}
              rows={c.stageJobs}
              onRowClick={(j) => navigate(`/admin/activity/job/${j.id}`)}
              empty={<Empty title="No creator jobs yet" />}
              columns={[
                { key: "stage", label: "Stage", render: (j) => <span className="adm-list-main"><strong>{j.stage}</strong><small>{j.projectTitle || "—"}</small></span> },
                { key: "status", label: "Status", render: (j) => <Badge>{j.status}</Badge> },
                { key: "detail", label: "Detail", render: (j) => <span className={j.error ? "adm-error-text adm-clip" : "adm-muted adm-clip"}>{j.error || j.message || "—"}</span> },
                { key: "when", label: "Started", render: (j) => <span className="adm-muted">{fmt.dateTime(j.createdAt)}</span> },
              ]}
            />
          </Card>
          <Card title="Media jobs" flush>
            <DataTable
              rowKey={(j) => j.id}
              rows={c.mediaJobs}
              onRowClick={(j) => navigate(`/admin/activity/media/${j.id}`)}
              empty={<Empty title="No media jobs yet" />}
              columns={[
                { key: "kind", label: "Job", render: (j) => j.kind },
                { key: "status", label: "Status", render: (j) => <Badge>{j.status}</Badge> },
                { key: "detail", label: "Detail", render: (j) => <span className={j.error ? "adm-error-text adm-clip" : "adm-muted adm-clip"}>{j.error || j.message || "—"}</span> },
                { key: "tries", label: "Tries", align: "right", render: (j) => fmt.number(j.attempts) },
                { key: "when", label: "Started", render: (j) => <span className="adm-muted">{fmt.dateTime(j.createdAt)}</span> },
                { key: "x", label: "", align: "right", render: (j) => (["queued", "running"].includes(j.status) && can(admin, "users.manage") ? <Button size="sm" variant="ghost" loading={cancelling === j.id} onClick={() => cancel(j.id)}>Cancel</Button> : null) },
              ]}
            />
          </Card>
          <div className="adm-grid is-2">
            <Card title="Channel styles" flush>
              <SimpleList empty="No channel styles" rows={c.styles.map((s) => ({ key: s.id, title: s.name || "Untitled style", sub: [s.niche, s.subNiche].filter(Boolean).join(" · "), side: <Badge>{s.status}</Badge> }))} />
            </Card>
            <Card title="Saved TikTok playlists" flush>
              <SimpleList empty="No saved playlists" rows={c.playlists.map((p) => ({ key: p.id, title: p.slug, sub: `${fmt.number(p.videos)} videos · saved ${fmt.date(p.savedAt)}`, href: p.url }))} />
            </Card>
            <Card title="Tracked competitors" flush>
              <SimpleList empty="No tracked competitors" rows={c.competitors.map((p) => ({ key: p.id, title: p.title, sub: `${p.niche || "—"} · score ${Math.round(n(p.score))}`, href: p.url }))} />
            </Card>
            <Card title="Research collections" flush>
              <SimpleList empty="No research collections" rows={c.research.map((r) => ({ key: r.id, title: r.name, sub: `updated ${fmt.ago(r.updatedAt).toLowerCase()}` }))} />
            </Card>
          </div>
        </>
      )}
    </Guarded>
  );
}

function SimpleList({ rows, empty }: { rows: Array<{ key: string; title: string; sub?: string; side?: ReactNode; href?: string }>; empty: string }) {
  if (!rows.length) return <Empty title={empty} />;
  return (
    <ul className="adm-list is-dense">
      {rows.map((r) => (
        <li key={r.key}>
          <span className="adm-list-main"><span>{r.title}</span>{r.sub ? <small>{r.sub}</small> : null}</span>
          {r.href ? <a className="adm-icon-btn" href={r.href} target="_blank" rel="noreferrer" aria-label={`Open ${r.title}`}><ExternalLink size={15} /></a> : r.side || <span />}
        </li>
      ))}
    </ul>
  );
}

// ---------- Automation ----------
function AutomationTab({ userId, admin, reload, navigate }: TabProps) {
  const query = useContent(userId);
  const [busy, setBusy] = useState("");
  const pause = async (agentId = "") => {
    setBusy(agentId || "all");
    try {
      const result = await adminFetch<{ paused: number }>(`/api/admin/users/${userId}/agents/pause`, { method: "POST", body: agentId ? { agentId } : {} });
      toast.success(agentId ? "Agent paused." : `${result.paused} agents paused.`);
      query.reload();
      reload();
    } catch (error) {
      toast.error(error);
    } finally {
      setBusy("");
    }
  };
  const manage = can(admin, "users.manage");
  return (
    <Guarded query={query} label="Loading automation">
      {(c) => {
        const live = c.agents.filter((a) => a.status === "active").length;
        return (
          <>
            <div className="adm-stats">
              <Stat label="Agents" value={`${fmt.number(live)} live`} hint={`of ${fmt.number(c.agents.length)} · ${fmt.number(c.agents.reduce((s, a) => s + n(a.failures7d), 0))} failed runs this week`} />
              <Stat label="Uploads (30d)" value={fmt.number(c.uploadsByDay.reduce((s, d) => s + n(d.uploads), 0))} hint={`${fmt.number(c.agents.reduce((s, a) => s + n(a.uploads), 0))} all time`} />
              <Stat label="Views (latest 60)" value={fmt.tokens(c.recentUploadStats.views)} hint={`${fmt.tokens(c.recentUploadStats.likes)} likes · ${fmt.tokens(c.recentUploadStats.comments)} comments`} />
              <Stat label="Agent chats" value={fmt.number(c.chats.chats)} hint={`${fmt.number(c.chats.messages)} messages · last ${fmt.ago(c.chats.lastAt).toLowerCase()}`} />
            </div>
            <Card title="Uploads per day, last 30 days">
              <BarChart label="Uploads per day" data={c.uploadsByDay.map((d) => ({ label: d.day, value: n(d.uploads) }))} format={fmt.number} height={140} />
            </Card>
            <Card title="Agents" flush action={manage && live ? <Button size="sm" loading={busy === "all"} onClick={() => pause()}>Pause all</Button> : null}>
              <DataTable
                rowKey={(a) => a.id}
                rows={c.agents}
                empty={<Empty title="No automation agents" />}
                columns={[
                  { key: "name", label: "Agent", render: (a) => <span className="adm-list-main"><strong>{a.name}</strong><small>{a.channel || "No channel"} · {a.sourceType.replace(/_/g, " ")}</small></span> },
                  { key: "status", label: "Status", render: (a) => <Badge>{a.status}</Badge> },
                  { key: "last", label: "Last run", render: (a) => <span className="adm-list-main"><span className="adm-inline">{a.lastRunStatus ? <Badge>{a.lastRunStatus}</Badge> : null}<span className="adm-muted">{fmt.ago(a.lastRunAt)}</span></span>{a.lastRunMessage ? <small className="adm-clip">{a.lastRunMessage}</small> : null}</span> },
                  { key: "next", label: "Next run", render: (a) => <span className="adm-muted">{a.status === "active" && a.nextRunAt ? fmt.dateTime(a.nextRunAt) : "—"}</span> },
                  { key: "uploads", label: "Uploads", align: "right", render: (a) => fmt.number(a.uploads) },
                  { key: "views", label: "Views", align: "right", render: (a) => fmt.tokens(a.views) },
                  { key: "x", label: "", align: "right", render: (a) => (manage && a.status === "active" ? <Button size="sm" variant="ghost" loading={busy === a.id} onClick={() => pause(a.id)}>Pause</Button> : null) },
                ]}
              />
            </Card>
            <Card title="Latest uploads" flush>
              <DataTable
                rowKey={(u) => u.id}
                rows={c.uploads}
                onRowClick={(u) => navigate(`/admin/activity/upload/${u.id}`)}
                empty={<Empty title="No uploads yet" />}
                columns={[
                  { key: "title", label: "Video", render: (u) => <span className="adm-list-main"><span className="adm-clip">{u.title || "Untitled"}</span><small>{u.agent || "—"}{u.genre ? ` · ${u.genre}` : ""}</small></span> },
                  { key: "status", label: "Status", render: (u) => <Badge>{u.status}</Badge> },
                  { key: "views", label: "Views", align: "right", render: (u) => fmt.number(u.views) },
                  { key: "likes", label: "Likes", align: "right", render: (u) => fmt.number(u.likes) },
                  { key: "comments", label: "Comments", align: "right", render: (u) => fmt.number(u.comments) },
                  { key: "when", label: "Uploaded", render: (u) => <span className="adm-muted">{fmt.dateTime(u.createdAt)}</span> },
                  { key: "link", label: "", align: "right", render: (u) => (/^https:\/\//.test(u.url) ? <a className="adm-icon-btn" href={u.url} target="_blank" rel="noreferrer" aria-label="Open video"><ExternalLink size={15} /></a> : null) },
                ]}
              />
            </Card>
          </>
        );
      }}
    </Guarded>
  );
}

// ---------- Activity, support, security, log ----------
function ActivityTab({ admin, navigate, userId }: TabProps) {
  const [type, setType] = useState("");
  return <ActivityFeed admin={admin} navigate={navigate} userId={userId} type={type} onType={setType} />;
}

function SupportTab({ d, navigate }: TabProps) {
  return (
    <Card title="Support requests" flush>
      {d.tickets.length ? (
        <DataTable
          rowKey={(t) => t.id}
          rows={d.tickets}
          onRowClick={(t) => navigate(`/admin/support/${t.id}`)}
          columns={[
            { key: "subject", label: "Subject", render: (t) => <strong>{t.subject}</strong> },
            { key: "status", label: "Status", render: (t) => <Badge>{t.status}</Badge> },
            { key: "priority", label: "Priority", render: (t) => <Badge>{t.priority}</Badge> },
            { key: "last", label: "Last message", render: (t) => <span className="adm-muted">{fmt.ago(t.lastMessageAt)}</span> },
          ]}
        />
      ) : <Empty title="No support requests">They haven't contacted support.</Empty>}
    </Card>
  );
}

type Session = { id: string; createdAt: string; updatedAt: string; expiresAt: string; active: boolean };
function SecurityTab({ d, admin, userId, reload, openModal }: TabProps) {
  const sessions = useAdminQuery<{ sessions: Session[] }>(`/api/admin/users/${userId}/sessions`);
  const [busy, setBusy] = useState("");
  const manage = can(admin, "users.manage");
  const revoke = async (sessionId = "") => {
    setBusy(sessionId || "all");
    try {
      await adminFetch(sessionId ? `/api/admin/users/${userId}/sessions/${sessionId}/revoke` : `/api/admin/users/${userId}/sessions/revoke`, { method: "POST", body: {} });
      toast.success(sessionId ? "Device signed out." : "Signed out everywhere.");
      sessions.reload();
      reload();
    } catch (error) {
      toast.error(error);
    } finally {
      setBusy("");
    }
  };
  return (
    <>
      <Card title="Account access">
        <dl className="adm-facts">
          <Fact label="Status"><Badge>{d.user.status}</Badge></Fact>
          <Fact label="Reason">{d.user.statusReason || "—"}</Fact>
          <Fact label="Joined">{fmt.dateTime(d.user.createdAt)}</Fact>
          <Fact label="Last active">{fmt.dateTime(d.user.lastSeenAt)}</Fact>
        </dl>
        {manage ? (
          <div className="adm-actions-row adm-mt">
            {d.user.status === "suspended" ? <RestoreButton userId={userId} onDone={reload} /> : <Button variant="danger" onClick={() => openModal("suspend")}>Suspend account</Button>}
          </div>
        ) : null}
      </Card>
      <Card title="Signed-in devices" flush action={manage ? <Button size="sm" loading={busy === "all"} onClick={() => revoke()}>Sign out everywhere</Button> : null}>
        <Guarded query={sessions} label="Loading devices">
          {({ sessions: rows }) => (
            <DataTable
              rowKey={(s) => s.id}
              rows={rows}
              empty={<Empty title="Not signed in anywhere" />}
              columns={[
                { key: "id", label: "Session", render: (s) => <code>{s.id.slice(0, 12)}…</code> },
                { key: "created", label: "Signed in", render: (s) => fmt.dateTime(s.createdAt) },
                { key: "seen", label: "Last used", render: (s) => <span className="adm-muted">{fmt.ago(s.updatedAt)}</span> },
                { key: "expires", label: "Expires", render: (s) => (s.active ? fmt.date(s.expiresAt) : <Badge tone="neutral">Expired</Badge>) },
                { key: "x", label: "", align: "right", render: (s) => (manage && s.active ? <Button size="sm" variant="ghost" loading={busy === s.id} onClick={() => revoke(s.id)}>Sign out</Button> : null) },
              ]}
            />
          )}
        </Guarded>
      </Card>
    </>
  );
}

type AuditEntry = { id: string; adminEmail: string; action: string; detail: Record<string, unknown>; createdAt: string };
function LogTab({ userId }: TabProps) {
  const [offset, setOffset] = useState(0);
  const audit = useAdminQuery<{ entries: AuditEntry[] }>(`/api/admin/audit?targetId=${encodeURIComponent(userId)}&limit=30&offset=${offset}`);
  return (
    <Card title="What admins changed on this account" flush>
      <Guarded query={audit} label="Loading log">
        {({ entries }) => (
          <>
            <DataTable
              rowKey={(e) => e.id}
              rows={entries}
              empty={<Empty title="No admin has changed this account" />}
              columns={[
                { key: "when", label: "When", render: (e) => <span className="adm-muted">{fmt.dateTime(e.createdAt)}</span> },
                { key: "who", label: "Admin", render: (e) => e.adminEmail },
                { key: "action", label: "Action", render: (e) => <code>{e.action}</code> },
                { key: "detail", label: "Detail", render: (e) => <span className="adm-audit-detail">{Object.entries(e.detail || {}).filter(([k]) => k !== "email").map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`).join(" · ") || "—"}</span> },
              ]}
            />
            <Pager offset={offset} limit={30} count={entries.length} onChange={setOffset} />
          </>
        )}
      </Guarded>
    </Card>
  );
}

// ---------- actions ----------
function RestoreButton({ userId, onDone }: { userId: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button variant="primary" loading={busy} onClick={async () => {
      setBusy(true);
      try {
        await adminFetch(`/api/admin/users/${userId}/status`, { method: "POST", body: { status: "active" } });
        toast.success("Account restored.");
        onDone();
      } catch (error) {
        toast.error(error);
      } finally {
        setBusy(false);
      }
    }}>Restore account</Button>
  );
}

export function TokensModal({ open, onClose, userId, name, onDone }: { open: boolean; onClose: () => void; userId: string; name: string; onDone: () => void }) {
  const [mode, setMode] = useState<"give" | "remove">("give");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setAmount(""); setNote(""); setMode("give"); } }, [open]);
  const credits = Number(amount) || 0;
  const submit = async () => {
    setBusy(true);
    try {
      await adminFetch(`/api/admin/users/${userId}/tokens`, { method: "POST", body: { credits: mode === "give" ? credits : -credits, note } });
      toast.success(mode === "give" ? `${fmt.number(credits)} credits added.` : `${fmt.number(credits)} credits removed.`);
      onDone();
      onClose();
    } catch (error) {
      toast.error(error);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title={`Credits for ${name}`} actions={<>
      <Button onClick={onClose}>Cancel</Button>
      <Button variant={mode === "give" ? "primary" : "danger"} disabled={!credits || !note.trim()} loading={busy} onClick={submit}>{mode === "give" ? "Add credits" : "Remove credits"}</Button>
    </>}>
      <Segmented label="Direction" value={mode} onChange={setMode} options={[{ value: "give", label: "Give" }, { value: "remove", label: "Remove" }]} />
      <Field label="Amount" hint={credits ? `${fmt.number(credits)} credits. Bonus credits don't expire.` : "Bonus credits don't expire."}>
        {(id) => <input id={id} className="adm-input" inputMode="numeric" value={amount} onChange={(event) => setAmount(event.target.value.replace(/\D/g, ""))} placeholder="500" autoFocus />}
      </Field>
      <div className="adm-chips">
        {[1000, 5000, 10000, 50000].map((v) => <button key={v} type="button" className="adm-chip" onClick={() => setAmount(String(v))}>{fmt.number(v)}</button>)}
      </div>
      <Field label="Reason" hint="Shown in the credit ledger.">
        {(id) => <input id={id} className="adm-input" value={note} onChange={(event) => setNote(event.target.value)} placeholder="e.g. Refund for a failed export" />}
      </Field>
    </Modal>
  );
}

function PlanModal({ open, onClose, userId, billing, plans, onDone }: { open: boolean; onClose: () => void; userId: string; billing: Billing | null; plans: Plan[]; onDone: () => void }) {
  const [planId, setPlanId] = useState("");
  const [reset, setReset] = useState(true);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setPlanId(billing?.planId || ""); setReset(true); } }, [open, billing?.planId]);
  const submit = async () => {
    setBusy(true);
    try {
      await adminFetch(`/api/admin/users/${userId}/plan`, { method: "POST", body: { planId, resetAllowance: reset } });
      toast.success("Plan changed.");
      onDone();
      onClose();
    } catch (error) {
      toast.error(error);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title="Change plan" actions={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!planId || planId === billing?.planId} loading={busy} onClick={submit}>Change plan</Button></>}>
      <div className="adm-plan-pick" role="radiogroup" aria-label="Plan">
        {plans.filter((p) => p.active || p.id === billing?.planId).map((p) => (
          <button key={p.id} type="button" role="radio" aria-checked={planId === p.id} className={cx(planId === p.id && "is-on")} onClick={() => setPlanId(p.id)}>
            <strong>{p.name}{p.id === billing?.planId ? " (current)" : ""}</strong>
            <span>{p.priceCents ? `${fmt.cents(p.priceCents)}/mo` : "Free"} · {fmt.credits(p.monthlyTokens)} credits</span>
          </button>
        ))}
      </div>
      <Toggle label="Start a fresh period now" description="Refills the allowance to the new plan and restarts the monthly cycle today." checked={reset} onChange={setReset} />
    </Modal>
  );
}

function SuspendModal({ open, onClose, userId, name, onDone }: { open: boolean; onClose: () => void; userId: string; name: string; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setReason(""); }, [open]);
  const submit = async () => {
    setBusy(true);
    try {
      await adminFetch(`/api/admin/users/${userId}/status`, { method: "POST", body: { status: "suspended", reason } });
      toast.success("Account suspended.");
      onDone();
      onClose();
    } catch (error) {
      toast.error(error);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title={`Suspend ${name}?`} actions={<><Button onClick={onClose}>Cancel</Button><Button variant="danger" disabled={!reason.trim()} loading={busy} onClick={submit}>Suspend</Button></>}>
      <p>They're signed out on every device and can't use AutoYT until you restore the account. Their running AI jobs stop at the next call.</p>
      <Field label="Reason" hint="Recorded in the admin log.">
        {(id) => <textarea id={id} className="adm-input" rows={3} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="e.g. Repeated uploads of copyrighted films" />}
      </Field>
    </Modal>
  );
}
