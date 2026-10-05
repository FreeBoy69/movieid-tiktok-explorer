import { useState, type MouseEvent, type ReactNode } from "react";
import {
  Activity, AlertTriangle, ArrowRight, ArrowDownRight, ArrowUpRight, BarChart3, CreditCard, LifeBuoy, RotateCw, Server, ShieldCheck, SlidersHorizontal, TrendingUp, Users,
} from "lucide-react";
import { fmt } from "../api";
import { Button, cx, Guarded, Page, Segmented, Toggle, useAdminQuery } from "../ui";
import { labelFormats, TrendArea, useInterval } from "../charts";
import { n, pct, readWindow, saveWindow, useInsights, windowLabel, WINDOWS, type Insights, type WindowValue } from "../insights";
import { compactUsd } from "./RevenuePage";
import type { PageProps } from "../AdminApp";

type Overview = { audit: Array<{ adminEmail: string; action: string; createdAt: string }> };
type Settings = { governance: { aiEnabled: boolean; signupsOpen: boolean; maintenanceMode: boolean; disabledProviders?: string[]; blockedModels?: string[] } };
type Metric = { label: string; value: ReactNode; hint?: ReactNode; delta?: number | null; invert?: boolean; tone?: "bad" | "warn" };

// A summary of every admin section. Each card opens its page; the detail and
// the full charts live there.
export function OverviewPage({ navigate }: PageProps) {
  const [days, setDays] = useState<WindowValue>(readWindow);
  const [live, setLive] = useState(false);
  const insights = useInsights(days);
  const overview = useAdminQuery<Overview>("/api/admin/overview");
  const settings = useAdminQuery<Settings>("/api/admin/settings");
  useInterval(() => {
    insights.reload();
    overview.reload();
  }, live ? 60_000 : null);
  return (
    <Page
      title="Overview"
      description={insights.data ? `Every part of AutoYT at a glance, last ${windowLabel(insights.data.days)}. Open a card for the detail.` : "Every part of AutoYT at a glance."}
      actions={
        <div className="adm-toolbar">
          <Segmented label="Time window" value={days} onChange={(v) => { setDays(v); saveWindow(v); }} options={WINDOWS.map((w) => ({ value: w.value, label: w.label }))} />
          <Button size="sm" variant="ghost" onClick={() => { void insights.reload(); void overview.reload(); }}><RotateCw size={14} aria-hidden="true" />Refresh</Button>
          <Toggle checked={live} onChange={setLive} label="Live" description="Refresh every minute" />
        </div>
      }
    >
      <Guarded query={insights} label="Loading overview">
        {(d) => <Summary d={d} navigate={navigate} audit={overview.data?.audit || null} governance={settings.data?.governance || null} />}
      </Guarded>
    </Page>
  );
}

function Summary({ d, navigate, audit, governance }: { d: Insights; navigate: PageProps["navigate"]; audit: Overview["audit"] | null; governance: Settings["governance"] | null }) {
  const r = d.revenue;
  const g = d.growth;
  const e = d.economics;
  const o = d.operations;
  const done = d.series.reduce((s, x) => s + n(x.jobsDone), 0);
  const failed = d.series.reduce((s, x) => s + n(x.jobsFailed), 0);
  const openTickets = n(d.support.byStatus.open) + n(d.support.byStatus.pending);
  const callouts = [
    o.openTickets > 0 && { key: "tickets", bad: false, text: <><strong>{fmt.number(o.openTickets)}</strong> support {o.openTickets === 1 ? "request needs" : "requests need"} a reply</>, to: "/admin/support" },
    o.jobsFailed24h > 0 && { key: "jobs", bad: true, text: <><AlertTriangle size={15} aria-hidden="true" /><strong>{fmt.number(o.jobsFailed24h)}</strong> jobs failed in the last 24 hours</>, to: "/admin/system" },
    r.pastDue > 0 && { key: "pastdue", bad: true, text: <><strong>{fmt.number(r.pastDue)}</strong> {r.pastDue === 1 ? "account is" : "accounts are"} past due</>, to: "/admin/billing" },
    governance?.maintenanceMode && { key: "maint", bad: true, text: <><AlertTriangle size={15} aria-hidden="true" />Maintenance mode is on</>, to: "/admin/governance" },
    governance && !governance.aiEnabled && { key: "ai", bad: true, text: <><AlertTriangle size={15} aria-hidden="true" />AI generation is switched off</>, to: "/admin/governance" },
  ].filter(Boolean) as Array<{ key: string; bad: boolean; text: ReactNode; to: string }>;

  return (
    <>
      {callouts.length ? (
        <div className="adm-callouts">
          {callouts.map((c) => <button key={c.key} type="button" className={cx("adm-callout", c.bad && "is-bad")} onClick={() => navigate(c.to)}>{c.text}</button>)}
        </div>
      ) : null}

      <div className="adm-summary-grid is-wide">
        <SummaryCard to="/admin/revenue" navigate={navigate} icon={<TrendingUp size={16} />} title="Revenue"
          metrics={[
            { label: "MRR", value: compactUsd(r.mrrCents), delta: r.history.length > 1 ? fmt.delta(r.history.at(-1)!.mrrCents, r.history.at(-2)!.mrrCents) : null },
            { label: "ARR", value: compactUsd(r.arrCents) },
            { label: "Cash collected", value: compactUsd(r.collectedCents), delta: fmt.delta(r.collectedCents, r.collectedPrevCents) },
            { label: "Gross margin", value: pct(e.marginPct) },
          ]}>
          <TrendArea label="MRR by month" labels={r.history.map((h) => h.month)} values={r.history.map((h) => h.mrrCents / 100)} labelFormat={labelFormats.month} format={(v) => `$${Math.round(v).toLocaleString("en-US")} MRR`} />
        </SummaryCard>
        <SummaryCard to="/admin/users" navigate={navigate} icon={<Users size={16} />} title="Users"
          metrics={[
            { label: "Total users", value: fmt.number(g.users) },
            { label: "New signups", value: fmt.number(g.newUsers), delta: fmt.delta(g.newUsers, g.newUsersPrev) },
            { label: "Daily / monthly active", value: `${fmt.number(g.dau)} / ${fmt.number(g.mau)}` },
            { label: "Paid conversion", value: pct(r.paidConversion, 1) },
          ]}>
          <TrendArea label="Signups" labels={d.series.map((s) => s.day)} values={d.series.map((s) => n(s.signups))} format={(v) => `${fmt.number(v)} signups`} />
        </SummaryCard>
      </div>

      <div className="adm-summary-grid">
        <SummaryCard to="/admin/billing" navigate={navigate} icon={<CreditCard size={16} />} title="Billing"
          metrics={[
            { label: "Paying accounts", value: fmt.number(r.payingAccounts), hint: `${fmt.number(r.annualAccounts)} annual` },
            { label: "Renewals due", value: fmt.number(r.renewals30d), hint: "next 30 days" },
            { label: "Past due", value: fmt.number(r.pastDue), tone: r.pastDue ? "bad" : undefined },
            { label: "Failed payments", value: fmt.number(r.failedPayments), tone: r.failedPayments ? "warn" : undefined },
          ]} />
        <SummaryCard to="/admin/usage" navigate={navigate} icon={<BarChart3 size={16} />} title="Credit usage"
          metrics={[
            { label: "AI provider cost", value: fmt.usd(e.cost), delta: fmt.delta(e.cost, e.costPrev), invert: true },
            { label: "Credits charged", value: fmt.credits(e.credits), delta: fmt.delta(e.credits, e.creditsPrev) },
            { label: "AI calls", value: fmt.tokens(e.calls) },
            { label: "Out of credits", value: fmt.number(e.outOfCredits), hint: "accounts" },
          ]} />
        <SummaryCard to="/admin/activity" navigate={navigate} icon={<Activity size={16} />} title="Activity"
          metrics={[
            { label: "AI-active users", value: fmt.number(g.aiUsers), delta: fmt.delta(g.aiUsers, g.aiUsersPrev) },
            { label: "Automation uploads", value: fmt.number(o.uploads) },
            { label: "Live agents", value: fmt.number(o.activeAgents) },
            { label: "Jobs finished", value: fmt.number(done) },
          ]} />
        <SummaryCard to="/admin/support" navigate={navigate} icon={<LifeBuoy size={16} />} title="Support"
          metrics={[
            { label: "Open", value: fmt.number(openTickets), tone: openTickets ? "warn" : undefined },
            { label: "No reply yet", value: fmt.number(d.support.unanswered), tone: d.support.unanswered ? "bad" : undefined },
            { label: "First reply", value: d.support.medianFirstReplyHours === null ? "—" : hours(n(d.support.medianFirstReplyHours)), hint: "median" },
            { label: "Opened", value: fmt.number(o.ticketsCreated), hint: "this window" },
          ]} />
        <SummaryCard to="/admin/system" navigate={navigate} icon={<Server size={16} />} title="System"
          metrics={[
            { label: "In queue", value: fmt.number(o.jobsQueued), hint: "waiting or running" },
            { label: "Failed (24h)", value: fmt.number(o.jobsFailed24h), tone: o.jobsFailed24h ? "bad" : undefined },
            { label: "Fail rate", value: done + failed ? `${((failed / (done + failed)) * 100).toFixed(1)}%` : "—", hint: "this window" },
            { label: "Failed jobs", value: fmt.number(failed), hint: "this window" },
          ]} />
        <SummaryCard to="/admin/governance" navigate={navigate} icon={<SlidersHorizontal size={16} />} title="Governance"
          metrics={governance ? [
            { label: "AI generation", value: governance.aiEnabled ? "On" : "Off", tone: governance.aiEnabled ? undefined : "bad" },
            { label: "Signups", value: governance.signupsOpen ? "Open" : "Closed", tone: governance.signupsOpen ? undefined : "warn" },
            { label: "Maintenance", value: governance.maintenanceMode ? "On" : "Off", tone: governance.maintenanceMode ? "bad" : undefined },
            { label: "Blocked", value: fmt.number((governance.disabledProviders?.length || 0) + (governance.blockedModels?.length || 0)), hint: "providers and models" },
          ] : [{ label: "Settings", value: "—", hint: "loading" }]} />
        <SummaryCard to="/admin/team" navigate={navigate} icon={<ShieldCheck size={16} />} title="Team & audit"
          metrics={audit?.length ? [
            { label: "Last admin action", value: <code className="adm-summary-code">{audit[0].action}</code>, hint: `${audit[0].adminEmail} · ${fmt.ago(audit[0].createdAt).toLowerCase()}` },
            { label: "Recent actions", value: fmt.number(audit.length), hint: `since ${fmt.ago(audit.at(-1)!.createdAt).toLowerCase()}` },
          ] : [{ label: "Admin actions", value: audit ? "None yet" : "—" }]} />
      </div>
    </>
  );
}

function SummaryCard({ to, navigate, icon, title, metrics, children }: { to: string; navigate: PageProps["navigate"]; icon: ReactNode; title: string; metrics: Metric[]; children?: ReactNode }) {
  // A real link, so middle-click and cmd-click still open a new tab.
  const open = (event: MouseEvent) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    navigate(to);
  };
  return (
    <section className="adm-summary">
      <a className="adm-summary-link" href={to} onClick={open} aria-label={`Open ${title}`}>
        <header className="adm-summary-head">
          <span className="adm-summary-icon" aria-hidden="true">{icon}</span>
          <h2>{title}</h2>
          <ArrowRight size={15} className="adm-summary-arrow" aria-hidden="true" />
        </header>
        <dl className="adm-summary-metrics">
          {metrics.map((m) => {
            const has = typeof m.delta === "number" && Number.isFinite(m.delta);
            const up = has && m.delta! >= 0;
            const good = m.invert ? !up : up;
            return (
              <div key={m.label} className={cx(m.tone && `is-${m.tone}`)}>
                <dt>{m.label}</dt>
                <dd>
                  <strong>{m.value}</strong>
                  {has ? (
                    <span className={cx("adm-delta", good ? "is-good" : "is-bad")}>
                      {up ? <ArrowUpRight size={12} aria-hidden="true" /> : <ArrowDownRight size={12} aria-hidden="true" />}
                      {Math.abs(m.delta!) >= 1000 ? ">999" : Math.abs(m.delta!).toFixed(0)}%
                    </span>
                  ) : null}
                  {m.hint ? <small>{m.hint}</small> : null}
                </dd>
              </div>
            );
          })}
        </dl>
      </a>
      {children ? <div className="adm-summary-chart">{children}</div> : null}
    </section>
  );
}

function hours(h: number) {
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  if (h < 48) return `${h.toFixed(1)} h`;
  return `${(h / 24).toFixed(1)} days`;
}
