// Insight sections for the Billing, Usage, Users, Support and System pages.
// Each reads the shared /api/admin/insights payload and carries its own
// window control, which is remembered across pages.
import { useState, type ReactNode } from "react";
import { fmt, providerLabel } from "./api";
import { Card, Guarded, RankBars, Segmented } from "./ui";
import { CohortGrid, Funnel, Heatmap, Kpi, KpiRow, labelFormats, LineChart, OTHER, SERIES, ShareBar, StackedBars } from "./charts";
import { n, pct, readWindow, saveWindow, useInsights, windowLabel, WINDOWS, type Insights, type WindowValue } from "./insights";

const usd0 = (v: number) => `$${Math.round(v).toLocaleString("en-US")}`;
const count = (v: number) => fmt.number(Math.round(v));

// A page that already has a window control passes it in; otherwise the section
// shows its own selector.
function InsightFrame({ title, days: fixed, children }: { title: string; days?: string; children: (d: Insights) => ReactNode }) {
  const [own, setDays] = useState<WindowValue>(readWindow);
  const days = fixed || own;
  const query = useInsights(days);
  return (
    <section className="adm-section" aria-label={title}>
      <div className="adm-section-head">
        <h2 className="adm-section-title">{title}{query.data ? ` · last ${windowLabel(query.data.days)}` : ""}</h2>
        {fixed ? null : <Segmented label="Time window" value={own} onChange={(v) => { setDays(v); saveWindow(v); }} options={WINDOWS.map((w) => ({ value: w.value, label: w.label }))} />}
      </div>
      <Guarded query={query} label={`Loading ${title.toLowerCase()}`}>{children}</Guarded>
    </section>
  );
}

export function RevenueInsights() {
  return (
    <InsightFrame title="Revenue">
      {(d) => {
        const r = d.revenue;
        const h = r.history;
        return (
          <>
            <KpiRow>
              <Kpi tone="accent" label="MRR" value={fmt.cents(r.mrrCents)} spark={h.map((x) => x.mrrCents)} hint={`${fmt.number(r.payingAccounts)} paying · ${fmt.number(r.annualAccounts)} annual`}
                info="Active, billed paid plans; annual plans at a twelfth of their price. Manually granted plans are excluded." />
              <Kpi label="ARR" value={fmt.cents(r.arrCents)} hint="MRR × 12" />
              <Kpi label="ARPA" value={fmt.cents(r.arpaCents)} hint="per paying account / month" />
              <Kpi label="Cash collected" value={fmt.cents(r.collectedCents)} delta={fmt.delta(r.collectedCents, r.collectedPrevCents)} hint={`${fmt.number(r.payments)} payments`} />
              <Kpi label="Payment success" value={pct(r.paymentSuccessRate)} hint={`${fmt.number(r.failedPayments)} failed`} />
              <Kpi label="Refunded" value={fmt.cents(r.refundedCents)} hint="this window" />
              <Kpi label="Logo churn" value={pct(r.churnRate, 1)} hint="last full month" />
              <Kpi label="Net revenue retention" value={pct(r.netRetention)} hint="last full month" />
              <Kpi label="Customer LTV" value={r.ltvCents === null ? "—" : fmt.cents(r.ltvCents)} hint="ARPA ÷ monthly churn" />
              <Kpi label="Comped plans" value={fmt.number(r.compedAccounts)} hint={`${fmt.cents(r.compedCents)} / month not billed`} info="Paid plans granted manually, with no payment provider and no paid-through date." />
              <Kpi label="Renewals due" value={fmt.number(r.renewals30d)} hint="in the next 30 days" />
              <Kpi label="Past due" value={fmt.number(r.pastDue)} />
            </KpiRow>
            <div className="adm-grid is-2">
              <Card title="MRR and subscribers, 12 months">
                <LineChart area label="MRR by month" labels={h.map((x) => x.month)} labelFormat={labelFormats.month} format={usd0}
                  series={[{ key: "mrr", label: "MRR", values: h.map((x) => x.mrrCents / 100), color: "var(--a-chart)" }]} />
              </Card>
              <Card title="Cash by month">
                <StackedBars label="Cash collected by month" labels={d.cashMonths.map((m) => m.month)} labelFormat={labelFormats.month} format={usd0}
                  series={[
                    { key: "plan", label: "Plans", values: d.cashMonths.map((m) => n(m.planCents) / 100), color: SERIES[0] },
                    { key: "credits", label: "Credit packs", values: d.cashMonths.map((m) => n(m.creditCents) / 100), color: SERIES[2] },
                    { key: "refunds", label: "Refunds", values: d.cashMonths.map((m) => -n(m.refundedCents) / 100), color: SERIES[1] },
                  ]} />
              </Card>
            </div>
            <div className="adm-grid is-2">
              <Card title="Gross profit by month" action={<span className="adm-muted">cash − AI cost</span>}>
                <LineChart label="Cash, AI cost and gross profit by month" labels={d.cashMonths.map((m) => m.month)} labelFormat={labelFormats.month} format={usd0}
                  series={[
                    { key: "cash", label: "Cash", values: d.cashMonths.map((m) => (n(m.planCents) + n(m.creditCents) - n(m.refundedCents)) / 100) },
                    { key: "cost", label: "AI cost", values: d.cashMonths.map((m) => n(m.cost)), color: SERIES[1] },
                    { key: "profit", label: "Gross profit", values: d.cashMonths.map((m) => (n(m.planCents) + n(m.creditCents) - n(m.refundedCents)) / 100 - n(m.cost)), color: SERIES[2], dashed: true },
                  ]} />
              </Card>
              <Card title="Subscribers gained and lost">
                <StackedBars label="Subscribers gained and lost by month" labels={h.slice(1).map((x) => x.month)} labelFormat={labelFormats.month} format={count}
                  series={[
                    { key: "new", label: "New", values: h.slice(1).map((x) => x.newCount), color: SERIES[0] },
                    { key: "churned", label: "Churned", values: h.slice(1).map((x) => -x.churnedCount), color: SERIES[1] },
                  ]} />
              </Card>
            </div>
            <Card title="Accounts by plan">
              <ShareBar format={fmt.number} items={d.planMix.filter((p) => n(p.accounts) > 0).map((p, i) => ({ key: p.id, label: p.name, value: n(p.accounts), color: SERIES[i] || OTHER }))} />
            </Card>
          </>
        );
      }}
    </InsightFrame>
  );
}

export function UsageInsights({ days }: { days?: string }) {
  return (
    <InsightFrame title="Spend trends" days={days}>
      {(d) => {
        const e = d.economics;
        return (
          <>
            <KpiRow>
              <Kpi label="AI provider cost" value={fmt.usd(e.cost)} delta={fmt.delta(e.cost, e.costPrev)} invertDelta spark={d.series.map((s) => n(s.cost))} />
              <Kpi label="Credits charged" value={fmt.credits(e.credits)} delta={fmt.delta(e.credits, e.creditsPrev)} spark={d.series.map((s) => n(s.credits))} />
              <Kpi label="Gross margin" value={pct(e.marginPct)} hint="cash vs AI cost" />
              <Kpi label="Cost per active user" value={e.costPerActiveUser === null ? "—" : fmt.usd(e.costPerActiveUser)} />
              <Kpi label="Cost per AI call" value={e.calls ? fmt.usd(e.cost / e.calls) : "—"} hint={`${fmt.tokens(e.calls)} calls`} />
              <Kpi label="Out of credits" value={fmt.number(e.outOfCredits)} hint="accounts at zero" />
            </KpiRow>
            <div className="adm-grid is-2">
              <Card title="Spend by provider">
                <StackedBars label="AI provider spend per period" labels={e.providerSeries.map((p) => p.day)} format={(v) => fmt.usd(v)}
                  series={e.providers.map((p, i) => ({ key: p, label: p === "other" ? "Other" : providerLabel(p), values: e.providerSeries.map((row) => row.values[i]), color: p === "other" ? OTHER : SERIES[i] }))} />
              </Card>
              <Card title="Peak hours" action={<span className="adm-muted">AI calls, UTC</span>}>
                <Heatmap grid={e.heatmap} format={(v) => `${fmt.number(v)} calls`} label="AI calls by weekday and hour" />
              </Card>
            </div>
          </>
        );
      }}
    </InsightFrame>
  );
}

export function GrowthInsights() {
  return (
    <InsightFrame title="Growth">
      {(d) => {
        const g = d.growth;
        const days = d.series.map((s) => s.day);
        return (
          <>
            <KpiRow>
              <Kpi label="Total users" value={fmt.number(g.users)} spark={d.series.map((s) => n(s.usersTotal))} />
              <Kpi label="New signups" value={fmt.number(g.newUsers)} delta={fmt.delta(g.newUsers, g.newUsersPrev)} spark={d.series.map((s) => n(s.signups))} />
              <Kpi label="Daily active" value={fmt.number(g.dau)} hint={`${fmt.number(g.wau)} weekly · ${fmt.number(g.mau)} monthly`} />
              <Kpi label="Stickiness" value={pct(g.stickiness)} hint="DAU ÷ MAU" />
              <Kpi label="Paid conversion" value={pct(d.revenue.paidConversion, 1)} hint={`${fmt.number(d.revenue.payingAccounts)} paying`} />
              <Kpi label="Suspended" value={fmt.number(g.suspended)} />
            </KpiRow>
            <div className="adm-grid is-2">
              <Card title="Signups and active users">
                <LineChart label="Signups and AI-active users" labels={days} format={count}
                  series={[{ key: "active", label: "AI-active users", values: d.series.map((s) => n(s.active)) }, { key: "signups", label: "Signups", values: d.series.map((s) => n(s.signups)), color: SERIES[2] }]} />
              </Card>
              <Card title={`Signup funnel`}>
                <Funnel format={fmt.number} steps={[
                  { key: "signup", label: "Signed up", value: n(d.funnel.signedUp) },
                  { key: "used", label: "Used an AI tool", value: n(d.funnel.usedAi) },
                  { key: "returned", label: "Came back on 3+ days", value: n(d.funnel.returned) },
                  { key: "paid", label: "Paid", value: n(d.funnel.paid) },
                ]} />
              </Card>
            </div>
            <Card title="Weekly retention" action={<span className="adm-muted">share of each signup week using AI</span>}>
              <CohortGrid cohorts={d.cohorts} />
            </Card>
          </>
        );
      }}
    </InsightFrame>
  );
}

export function SupportInsights() {
  return (
    <InsightFrame title="Support trends">
      {(d) => {
        const s = d.support;
        const open = n(s.byStatus.open) + n(s.byStatus.pending);
        return (
          <div className="adm-grid is-2-1">
            <Card title="Tickets opened">
              <LineChart area label="Support tickets opened" labels={d.series.map((x) => x.day)} format={count}
                series={[{ key: "tickets", label: "Tickets opened", values: d.series.map((x) => n(x.tickets)), color: "var(--a-chart)" }]} />
            </Card>
            <div className="adm-stack">
              <KpiRow tight>
                <Kpi label="Open" value={fmt.number(open)} hint={s.unanswered ? `${fmt.number(s.unanswered)} unanswered` : "all answered"} />
                <Kpi label="First reply" value={s.medianFirstReplyHours === null ? "—" : `${n(s.medianFirstReplyHours).toFixed(1)} h`} hint="median" />
              </KpiRow>
              <Card title="By category">
                <RankBars format={fmt.number} items={s.byCategory.map((c) => ({ key: c.category, label: c.category, value: n(c.n) }))} />
              </Card>
            </div>
          </div>
        );
      }}
    </InsightFrame>
  );
}

export function SystemInsights() {
  return (
    <InsightFrame title="Job throughput">
      {(d) => {
        const done = d.series.reduce((s, x) => s + n(x.jobsDone), 0);
        const failed = d.series.reduce((s, x) => s + n(x.jobsFailed), 0);
        return (
          <div className="adm-grid is-2-1">
            <Card title="Jobs finished and failed">
              <StackedBars label="Jobs finished and failed per period" labels={d.series.map((x) => x.day)} format={count}
                series={[{ key: "done", label: "Finished", values: d.series.map((x) => n(x.jobsDone)), color: SERIES[0] }, { key: "failed", label: "Failed", values: d.series.map((x) => n(x.jobsFailed)), color: SERIES[1] }]} />
            </Card>
            <KpiRow tight>
              <Kpi label="Finished" value={fmt.number(done)} />
              <Kpi label="Failed" value={fmt.number(failed)} hint={done + failed ? `${((failed / (done + failed)) * 100).toFixed(1)}% fail rate` : undefined} />
              <Kpi label="In queue now" value={fmt.number(d.operations.jobsQueued)} />
              <Kpi label="Uploads" value={fmt.number(d.operations.uploads)} hint={`${fmt.number(d.operations.activeAgents)} live agents`} />
            </KpiRow>
          </div>
        );
      }}
    </InsightFrame>
  );
}
