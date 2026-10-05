import { useState, type ReactNode } from "react";
import { AlertTriangle, Download, RotateCw } from "lucide-react";
import { fmt, providerLabel } from "../api";
import { Button, Card, Empty, Guarded, Page, Person, RankBars, Segmented, Toggle, useAdminQuery } from "../ui";
import { CohortGrid, downloadCsv, Funnel, Heatmap, Kpi, KpiRow, labelFormats, LineChart, OTHER, SERIES, ShareBar, StackedBars, useInterval } from "../charts";
import { n, pct, readWindow, saveWindow, useInsights, windowLabel, WINDOWS, type Insights, type WindowValue } from "../insights";
import type { PageProps } from "../AdminApp";

type Overview = {
  signups: Array<{ id: string; email: string; name: string; avatarUrl: string; createdAt: string }>;
  audit: Array<{ adminEmail: string; action: string; targetType: string; targetId: string; createdAt: string }>;
};

const usd0 = (v: number) => `$${Math.round(v).toLocaleString("en-US")}`;
const cents0 = (v: number) => usd0(v / 100);
const compactUsd = (cents: number) => {
  const v = cents / 100;
  return Math.abs(v) >= 10000 ? `$${new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(v)}` : fmt.cents(cents);
};

export function OverviewPage({ navigate }: PageProps) {
  const [days, setDays] = useState<WindowValue>(readWindow);
  const [live, setLive] = useState(false);
  const insights = useInsights(days);
  const overview = useAdminQuery<Overview>("/api/admin/overview");
  useInterval(() => insights.reload(), live ? 60_000 : null);
  const pick = (value: WindowValue) => {
    setDays(value);
    saveWindow(value);
  };
  const exportCsv = () => {
    const d = insights.data;
    if (!d) return;
    downloadCsv(`autoyt-insights-${d.days}d-${d.generatedAt.slice(0, 10)}.csv`, d.series.map((row) => ({ ...row, planUsd: n(row.planCents) / 100, creditUsd: n(row.creditCents) / 100 })));
  };
  return (
    <Page
      title="Overview"
      description={insights.data ? `Revenue, growth and costs over the last ${windowLabel(insights.data.days)}. Updated ${fmt.ago(insights.data.generatedAt).toLowerCase()}.` : "Revenue, growth and costs."}
      actions={
        <div className="adm-toolbar">
          <Segmented label="Time window" value={days} onChange={pick} options={WINDOWS.map((w) => ({ value: w.value, label: w.label }))} />
          <Button size="sm" variant="ghost" onClick={() => void insights.reload()} aria-label="Refresh now"><RotateCw size={14} aria-hidden="true" />Refresh</Button>
          <Button size="sm" variant="ghost" onClick={exportCsv} disabled={!insights.data}><Download size={14} aria-hidden="true" />CSV</Button>
          <Toggle checked={live} onChange={setLive} label="Live" description="Refresh every minute" />
        </div>
      }
    >
      <Guarded query={insights} label="Loading insights">
        {(d) => <Dashboard d={d} navigate={navigate} overview={overview.data} />}
      </Guarded>
    </Page>
  );
}

function Dashboard({ d, navigate, overview }: { d: Insights; navigate: PageProps["navigate"]; overview: Overview | null }) {
  const r = d.revenue;
  const g = d.growth;
  const e = d.economics;
  const o = d.operations;
  const days = d.series.map((s) => s.day);
  const labelFormat = labelFormats.day;
  const cashSeries = d.series.map((s) => (n(s.planCents) + n(s.creditCents)) / 100);
  const costSeries = d.series.map((s) => n(s.cost));
  const history = r.history;
  const callouts = [
    o.openTickets > 0 && { key: "tickets", tone: "", text: <><strong>{fmt.number(o.openTickets)}</strong> support {o.openTickets === 1 ? "request needs" : "requests need"} a reply</>, to: "/admin/support" },
    o.jobsFailed24h > 0 && { key: "jobs", tone: "is-bad", text: <><AlertTriangle size={15} aria-hidden="true" /><strong>{fmt.number(o.jobsFailed24h)}</strong> jobs failed in the last 24 hours</>, to: "/admin/system" },
    r.pastDue > 0 && { key: "pastdue", tone: "is-bad", text: <><strong>{fmt.number(r.pastDue)}</strong> {r.pastDue === 1 ? "account is" : "accounts are"} past due</>, to: "/admin/billing" },
    r.failedPayments > 0 && { key: "failed", tone: "", text: <><strong>{fmt.number(r.failedPayments)}</strong> failed {r.failedPayments === 1 ? "payment" : "payments"} this window</>, to: "/admin/billing" },
    r.renewals30d > 0 && { key: "renewals", tone: "", text: <><strong>{fmt.number(r.renewals30d)}</strong> renewals due in 30 days</>, to: "/admin/billing" },
  ].filter(Boolean) as Array<{ key: string; tone: string; text: ReactNode; to: string }>;

  return (
    <>
      {callouts.length ? (
        <div className="adm-callouts">
          {callouts.map((c) => <button key={c.key} type="button" className={`adm-callout ${c.tone}`} onClick={() => navigate(c.to)}>{c.text}</button>)}
        </div>
      ) : null}

      <section className="adm-section" aria-labelledby="ov-revenue">
        <h2 id="ov-revenue" className="adm-section-title">Revenue</h2>
        <KpiRow>
          <Kpi tone="accent" label="MRR" value={compactUsd(r.mrrCents)} spark={history.map((h) => h.mrrCents)}
            delta={history.length > 1 ? deltaOf(history.at(-1)!.mrrCents, history.at(-2)!.mrrCents) : null}
            hint={`${fmt.number(r.payingAccounts)} paying${r.compedAccounts ? ` · ${fmt.number(r.compedAccounts)} comped` : ""}`}
            info="Monthly recurring revenue: active, billed paid plans. Annual plans count at a twelfth of their price. Manually granted plans are excluded and shown as comped." />
          <Kpi label="ARR" value={compactUsd(r.arrCents)} hint="MRR × 12" info="Annual run rate: current MRR multiplied by twelve." />
          <Kpi label="Cash collected" value={compactUsd(r.collectedCents)} delta={deltaOf(r.collectedCents, r.collectedPrevCents)} spark={cashSeries}
            hint={`${fmt.number(r.payments)} payments${r.refundedCents ? ` · ${fmt.cents(r.refundedCents)} refunded` : ""}`} info="Verified payments in this window, plans and credit packs, before fees and refunds." />
          <Kpi label="ARPA" value={fmt.cents(r.arpaCents)} hint="per paying account / month" info="Average revenue per paying account: MRR divided by paying accounts." />
          <Kpi label="Gross margin" value={pct(e.marginPct)} hint={`${e.grossProfitUsd >= 0 ? "" : "−"}${fmt.usd(Math.abs(e.grossProfitUsd))} after AI cost`}
            info="(Cash collected − AI provider cost) ÷ cash collected, for this window. Excludes payment fees and servers." />
          <Kpi label="Paid conversion" value={pct(r.paidConversion, 1)} hint={`${fmt.number(r.everPaid)} have ever paid`} info="Paying accounts as a share of all users." />
          <Kpi label="Logo churn" value={pct(r.churnRate, 1)} invertDelta hint="last full month" info="Subscribers at the start of last month who had no paid plan coverage at its end." />
          <Kpi label="Net revenue retention" value={pct(r.netRetention)} hint="last full month" info="(Starting MRR + expansion − contraction − churn) ÷ starting MRR, for last month's existing subscribers." />
          <Kpi label="Customer LTV" value={r.ltvCents === null ? "—" : compactUsd(r.ltvCents)} hint={r.ltvCents === null ? "needs a month with churn" : "ARPA ÷ monthly churn"} info="Lifetime value estimate: average revenue per account divided by monthly logo churn." />
          <Kpi label="Quick ratio" value={r.quickRatio === null ? "—" : r.quickRatio.toFixed(2)} hint="gained ÷ lost MRR, 3 mo" info="(New + expansion MRR) ÷ (churned + contraction MRR) over the last three months. Above 4 is strong growth." />
        </KpiRow>
      </section>

      <div className="adm-grid is-2">
        <Card title="MRR, last 12 months" action={<span className="adm-muted">from paid plan orders</span>}>
          <LineChart area label="Monthly recurring revenue by month" labels={history.map((h) => h.month)} labelFormat={labelFormats.month}
            series={[{ key: "mrr", label: "MRR", values: history.map((h) => h.mrrCents / 100), color: "var(--a-chart)" }]} format={usd0} />
        </Card>
        <Card title="MRR movements" action={<span className="adm-muted">gains above, losses below</span>}>
          <StackedBars label="MRR movements by month" labels={history.slice(1).map((h) => h.month)} labelFormat={labelFormats.month} format={usd0}
            series={[
              { key: "new", label: "New", values: history.slice(1).map((h) => h.new / 100), color: SERIES[0] },
              { key: "expansion", label: "Expansion", values: history.slice(1).map((h) => h.expansion / 100), color: SERIES[2] },
              { key: "contraction", label: "Contraction", values: history.slice(1).map((h) => -h.contraction / 100), color: SERIES[3] },
              { key: "churned", label: "Churned", values: history.slice(1).map((h) => -h.churned / 100), color: SERIES[1] },
            ]} />
        </Card>
      </div>

      <div className="adm-grid is-2-1">
        <Card title={`Cash collected vs AI cost · ${windowLabel(d.days)}`}>
          <LineChart label="Cash collected and AI provider cost" labels={days} labelFormat={labelFormat} format={usd0}
            series={[{ key: "cash", label: "Cash collected", values: cashSeries }, { key: "cost", label: "AI provider cost", values: costSeries, color: SERIES[1] }]} />
        </Card>
        <Card title="Revenue by plan">
          <ShareBar format={cents0} items={d.planMix.filter((p) => n(p.mrrCents) > 0).map((p, i) => ({ key: p.id, label: p.name, value: n(p.mrrCents), color: SERIES[i] || OTHER }))} />
          <dl className="adm-minifacts">
            {d.planMix.filter((p) => n(p.accounts) > 0).map((p) => (
              <div key={p.id}><dt>{p.name}</dt><dd>{fmt.number(p.accounts)} accounts{n(p.annual) ? ` · ${fmt.number(p.annual)} annual` : ""}</dd></div>
            ))}
          </dl>
        </Card>
      </div>

      <section className="adm-section" aria-labelledby="ov-growth">
        <h2 id="ov-growth" className="adm-section-title">Growth & engagement</h2>
        <KpiRow>
          <Kpi label="Total users" value={fmt.number(g.users)} spark={d.series.map((s) => n(s.usersTotal))} hint={g.suspended ? `${fmt.number(g.suspended)} suspended` : undefined} />
          <Kpi label="New signups" value={fmt.number(g.newUsers)} delta={deltaOf(g.newUsers, g.newUsersPrev)} spark={d.series.map((s) => n(s.signups))} hint={`vs previous ${windowLabel(d.days)}`} />
          <Kpi label="DAU / WAU / MAU" value={`${fmt.number(g.dau)} / ${fmt.number(g.wau)} / ${fmt.number(g.mau)}`} hint={`stickiness ${pct(g.stickiness)}`} info="Users seen in the last 1, 7 and 30 days. Stickiness is DAU ÷ MAU." />
          <Kpi label="AI-active users" value={fmt.number(g.aiUsers)} delta={deltaOf(g.aiUsers, g.aiUsersPrev)} spark={d.series.map((s) => n(s.active))} hint="made at least one AI call" />
          <Kpi label="Activation (7 days)" value={pct(d.funnel.signedUp ? (d.funnel.activatedIn7d / d.funnel.signedUp) * 100 : null)} hint="new users who used AI in week one" />
          <Kpi label="AI calls" value={fmt.tokens(e.calls)} delta={deltaOf(e.calls, e.callsPrev)} spark={d.series.map((s) => n(s.calls))} hint={`${fmt.credits(e.credits)} credits charged`} />
        </KpiRow>
      </section>

      <div className="adm-grid is-2">
        <Card title="Signups and active users">
          <LineChart label="Signups and AI-active users" labels={days} labelFormat={labelFormat} format={(v) => fmt.number(Math.round(v))}
            series={[{ key: "active", label: "AI-active users", values: d.series.map((s) => n(s.active)) }, { key: "signups", label: "Signups", values: d.series.map((s) => n(s.signups)), color: SERIES[2] }]} />
        </Card>
        <Card title="Total users">
          <LineChart area label="Total users over time" labels={days} labelFormat={labelFormat} format={(v) => fmt.tokens(v)}
            series={[{ key: "total", label: "Users", values: d.series.map((s) => n(s.usersTotal)), color: "var(--a-chart)" }]} />
        </Card>
      </div>

      <div className="adm-grid is-1-2">
        <Card title={`Signup funnel · last ${windowLabel(d.days)}`}>
          <Funnel format={fmt.number} steps={[
            { key: "signup", label: "Signed up", value: n(d.funnel.signedUp) },
            { key: "used", label: "Used an AI tool", value: n(d.funnel.usedAi) },
            { key: "returned", label: "Came back on 3+ days", value: n(d.funnel.returned) },
            { key: "paid", label: "Paid", value: n(d.funnel.paid) },
          ]} />
        </Card>
        <Card title="Weekly retention" action={<span className="adm-muted">share of each signup week using AI</span>}>
          <CohortGrid cohorts={d.cohorts} />
        </Card>
      </div>

      <section className="adm-section" aria-labelledby="ov-cost">
        <h2 id="ov-cost" className="adm-section-title">Unit economics</h2>
        <KpiRow>
          <Kpi label="AI provider cost" value={fmt.usd(e.cost)} delta={deltaOf(e.cost, e.costPrev)} invertDelta spark={costSeries} hint={`last ${windowLabel(d.days)}`} />
          <Kpi label="Cost per active user" value={e.costPerActiveUser === null ? "—" : fmt.usd(e.costPerActiveUser)} hint="AI cost ÷ AI-active users" />
          <Kpi label="Cost per paying account" value={e.costPerPayingAccount === null ? "—" : fmt.usd(e.costPerPayingAccount)} hint={`vs ${fmt.cents(r.arpaCents)} ARPA / month`} />
          <Kpi label="Revenue per AI call" value={e.revenuePerCall === null ? "—" : fmt.usd(e.revenuePerCall)} hint={e.calls ? `cost ${fmt.usd(e.cost / e.calls)} per call` : undefined} />
          <Kpi label="Out of credits" value={fmt.number(e.outOfCredits)} hint={`${fmt.number(e.unlimitedAccounts)} unlimited accounts`} info="Accounts with no allowance and no bonus credits left; each is a likely upgrade or churn." />
          <Kpi label="Credits granted" value={fmt.credits(e.granted)} hint="by admins this window" />
        </KpiRow>
      </section>

      <div className="adm-grid is-2">
        <Card title="AI spend by provider" action={<button type="button" className="adm-link" onClick={() => navigate("/admin/usage")}>Usage detail</button>}>
          <StackedBars label="AI provider spend per period" labels={e.providerSeries.map((p) => p.day)} labelFormat={labelFormat} format={(v) => fmt.usd(v)}
            series={e.providers.map((p, i) => ({ key: p, label: p === "other" ? "Other" : providerLabel(p), values: e.providerSeries.map((row) => row.values[i]), color: p === "other" ? OTHER : SERIES[i] }))} />
        </Card>
        <Card title="When people create" action={<span className="adm-muted">AI calls, UTC</span>}>
          <Heatmap grid={e.heatmap} format={(v) => `${fmt.number(v)} calls`} label="AI calls by weekday and hour" />
        </Card>
      </div>

      <div className="adm-grid is-2">
        <Card title="Top customers by revenue" flush>
          {d.topCustomers.length ? (
            <ul className="adm-list">
              {d.topCustomers.map((c) => (
                <li key={c.id}>
                  <Person name={c.name} email={c.email} avatarUrl={c.avatarUrl} onClick={() => navigate(`/admin/users/${c.id}`)} />
                  <span className="adm-list-figure"><strong>{fmt.cents(c.paidCents)}</strong><small>{fmt.number(c.payments)} payments · {fmt.usd(c.cost)} AI cost</small></span>
                </li>
              ))}
            </ul>
          ) : <Empty title="No payments yet" />}
        </Card>
        <Card title="Costliest features" action={<button type="button" className="adm-link" onClick={() => navigate("/admin/usage")}>All usage</button>}>
          <RankBars format={(v) => fmt.usd(v)} items={d.topFeatures.map((f) => ({ key: f.feature || "unknown", label: <code>{f.feature || "unknown"}</code>, sub: `${fmt.number(f.users)} users · ${fmt.tokens(f.calls)} calls`, value: n(f.cost) }))} />
        </Card>
      </div>

      <section className="adm-section" aria-labelledby="ov-ops">
        <h2 id="ov-ops" className="adm-section-title">Operations</h2>
        <KpiRow>
          <Kpi label="Jobs in queue" value={fmt.number(o.jobsQueued)} hint="waiting or running" />
          <Kpi label="Failed jobs (24h)" value={fmt.number(o.jobsFailed24h)} hint={jobFailRate(d)} />
          <Kpi label="Open tickets" value={fmt.number(o.openTickets)} hint={d.support.unanswered ? `${fmt.number(d.support.unanswered)} with no reply yet` : "all answered"} />
          <Kpi label="First reply" value={d.support.medianFirstReplyHours === null ? "—" : hoursLabel(d.support.medianFirstReplyHours)} hint="median this window" />
          <Kpi label="Live agents" value={fmt.number(o.activeAgents)} spark={d.series.map((s) => n(s.uploads))} hint={`${fmt.number(o.uploads)} uploads this window`} />
        </KpiRow>
      </section>

      <div className="adm-grid is-2">
        <Card title="Jobs finished and failed" action={<button type="button" className="adm-link" onClick={() => navigate("/admin/system")}>System</button>}>
          <StackedBars label="Media and creator jobs per period" labels={days} labelFormat={labelFormat} format={(v) => fmt.number(Math.round(v))}
            series={[{ key: "done", label: "Finished", values: d.series.map((s) => n(s.jobsDone)), color: SERIES[0] }, { key: "failed", label: "Failed", values: d.series.map((s) => n(s.jobsFailed)), color: SERIES[1] }]} />
        </Card>
        <Card title="Support tickets and uploads">
          <LineChart label="Support tickets opened and automation uploads" labels={days} labelFormat={labelFormat} format={(v) => fmt.number(Math.round(v))}
            series={[{ key: "uploads", label: "Automation uploads", values: d.series.map((s) => n(s.uploads)) }, { key: "tickets", label: "Tickets opened", values: d.series.map((s) => n(s.tickets)), color: SERIES[1] }]} />
        </Card>
      </div>

      <div className="adm-grid is-2">
        <Card title="Newest users" action={<button type="button" className="adm-link" onClick={() => navigate("/admin/users")}>All users</button>} flush>
          {overview?.signups.length ? (
            <ul className="adm-list">
              {overview.signups.map((u) => (
                <li key={u.id}>
                  <Person name={u.name} email={u.email} avatarUrl={u.avatarUrl} onClick={() => navigate(`/admin/users/${u.id}`)} />
                  <span className="adm-muted">{fmt.ago(u.createdAt)}</span>
                </li>
              ))}
            </ul>
          ) : <Empty title={overview ? "No users yet" : "Loading"} />}
        </Card>
        <Card title="Recent admin actions" action={<button type="button" className="adm-link" onClick={() => navigate("/admin/team")}>Audit log</button>} flush>
          {overview?.audit.length ? (
            <ul className="adm-list">
              {overview.audit.map((a, index) => (
                <li key={`${a.createdAt}-${index}`}>
                  <span className="adm-list-main"><code>{a.action}</code><small>{a.adminEmail}</small></span>
                  <span className="adm-muted">{fmt.ago(a.createdAt)}</span>
                </li>
              ))}
            </ul>
          ) : <Empty title={overview ? "No admin actions yet" : "Loading"}>{overview ? "Changes you make here show up in this list." : null}</Empty>}
        </Card>
      </div>
    </>
  );
}

export function deltaOf(current: unknown, previous: unknown) {
  return fmt.delta(current, previous);
}
export function hoursLabel(hours: number) {
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min`;
  if (hours < 48) return `${hours.toFixed(1)} h`;
  return `${(hours / 24).toFixed(1)} days`;
}
function jobFailRate(d: Insights) {
  const done = d.series.reduce((s, x) => s + n(x.jobsDone), 0);
  const failed = d.series.reduce((s, x) => s + n(x.jobsFailed), 0);
  return done + failed ? `${((failed / (done + failed)) * 100).toFixed(1)}% fail rate this window` : "no jobs this window";
}
