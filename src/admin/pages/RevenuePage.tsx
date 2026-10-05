import { useState } from "react";
import { Download, RotateCw } from "lucide-react";
import { fmt, providerLabel } from "../api";
import { Button, Card, Empty, Guarded, Page, Person, RankBars, Segmented, Toggle } from "../ui";
import { downloadCsv, Kpi, KpiRow, labelFormats, LineChart, OTHER, SERIES, ShareBar, StackedBars, useInterval } from "../charts";
import { n, pct, readWindow, saveWindow, useInsights, windowLabel, WINDOWS, type Insights, type WindowValue } from "../insights";
import type { PageProps } from "../AdminApp";

const usd0 = (v: number) => `$${Math.round(v).toLocaleString("en-US")}`;
const cents0 = (v: number) => usd0(v / 100);
const count = (v: number) => fmt.number(Math.round(v));
export const compactUsd = (cents: number) => {
  const v = cents / 100;
  return Math.abs(v) >= 10000 ? `$${new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(v)}` : fmt.cents(cents);
};

// Revenue analysis: recurring revenue, cash, margin and what it costs to serve.
export function RevenuePage({ navigate }: PageProps) {
  const [days, setDays] = useState<WindowValue>(readWindow);
  const [live, setLive] = useState(false);
  const insights = useInsights(days);
  useInterval(() => insights.reload(), live ? 60_000 : null);
  const exportCsv = () => {
    const d = insights.data;
    if (!d) return;
    downloadCsv(`autoyt-revenue-${d.days}d-${d.generatedAt.slice(0, 10)}.csv`, [
      ...d.revenue.history.map((h) => ({ section: "mrr_by_month", period: h.month, mrrUsd: h.mrrCents / 100, subscribers: h.subscribers, newUsd: h.new / 100, expansionUsd: h.expansion / 100, contractionUsd: h.contraction / 100, churnedUsd: h.churned / 100 })),
      ...d.cashMonths.map((m) => ({ section: "cash_by_month", period: m.month, planUsd: n(m.planCents) / 100, creditUsd: n(m.creditCents) / 100, refundedUsd: n(m.refundedCents) / 100, aiCostUsd: n(m.cost) })),
      ...d.series.map((s) => ({ section: "daily", period: s.day, cashUsd: (n(s.planCents) + n(s.creditCents)) / 100, aiCostUsd: n(s.cost), credits: s.credits, calls: s.calls })),
    ]);
  };
  return (
    <Page
      title="Revenue"
      description={insights.data ? `Recurring revenue, cash and margin over the last ${windowLabel(insights.data.days)}. Updated ${fmt.ago(insights.data.generatedAt).toLowerCase()}.` : "Recurring revenue, cash and margin."}
      actions={
        <div className="adm-toolbar">
          <Segmented label="Time window" value={days} onChange={(v) => { setDays(v); saveWindow(v); }} options={WINDOWS.map((w) => ({ value: w.value, label: w.label }))} />
          <Button size="sm" variant="ghost" onClick={() => void insights.reload()}><RotateCw size={14} aria-hidden="true" />Refresh</Button>
          <Button size="sm" variant="ghost" onClick={exportCsv} disabled={!insights.data}><Download size={14} aria-hidden="true" />CSV</Button>
          <Toggle checked={live} onChange={setLive} label="Live" description="Refresh every minute" />
        </div>
      }
    >
      <Guarded query={insights} label="Loading revenue">
        {(d) => <Revenue d={d} navigate={navigate} />}
      </Guarded>
    </Page>
  );
}

function Revenue({ d, navigate }: { d: Insights; navigate: PageProps["navigate"] }) {
  const r = d.revenue;
  const e = d.economics;
  const h = r.history;
  const days = d.series.map((s) => s.day);
  const cashSeries = d.series.map((s) => (n(s.planCents) + n(s.creditCents)) / 100);
  const costSeries = d.series.map((s) => n(s.cost));
  const net = (m: Insights["cashMonths"][number]) => (n(m.planCents) + n(m.creditCents) - n(m.refundedCents)) / 100;
  return (
    <>
      <section className="adm-section" aria-labelledby="rev-recurring">
        <h2 id="rev-recurring" className="adm-section-title">Recurring revenue</h2>
        <KpiRow>
          <Kpi tone="accent" label="MRR" value={compactUsd(r.mrrCents)} spark={h.map((x) => x.mrrCents)}
            delta={h.length > 1 ? fmt.delta(h.at(-1)!.mrrCents, h.at(-2)!.mrrCents) : null}
            hint={`${fmt.number(r.payingAccounts)} paying${r.compedAccounts ? ` · ${fmt.number(r.compedAccounts)} comped` : ""}`}
            info="Monthly recurring revenue: active, billed paid plans. Annual plans count at a twelfth of their price. Manually granted plans are excluded and shown as comped." />
          <Kpi label="ARR" value={compactUsd(r.arrCents)} hint="MRR × 12" info="Annual run rate: current MRR multiplied by twelve." />
          <Kpi label="ARPA" value={fmt.cents(r.arpaCents)} hint="per paying account / month" info="Average revenue per paying account: MRR divided by paying accounts." />
          <Kpi label="Paid conversion" value={pct(r.paidConversion, 1)} hint={`${fmt.number(r.everPaid)} have ever paid`} info="Paying accounts as a share of all users." />
          <Kpi label="Annual plans" value={fmt.number(r.annualAccounts)} hint={`of ${fmt.number(r.payingAccounts)} paying`} />
          <Kpi label="Logo churn" value={pct(r.churnRate, 1)} hint="last full month" info="Subscribers at the start of last month who had no paid plan coverage at its end." />
          <Kpi label="Net revenue retention" value={pct(r.netRetention)} hint="last full month" info="(Starting MRR + expansion − contraction − churn) ÷ starting MRR, for last month's existing subscribers." />
          <Kpi label="Customer LTV" value={r.ltvCents === null ? "—" : compactUsd(r.ltvCents)} hint={r.ltvCents === null ? "needs a month with churn" : "ARPA ÷ monthly churn"} info="Lifetime value estimate: average revenue per account divided by monthly logo churn." />
          <Kpi label="Quick ratio" value={r.quickRatio === null ? "—" : r.quickRatio.toFixed(2)} hint="gained ÷ lost MRR, 3 mo" info="(New + expansion MRR) ÷ (churned + contraction MRR) over the last three months. Above 4 is strong growth." />
          <Kpi label="Comped plans" value={fmt.number(r.compedAccounts)} hint={`${fmt.cents(r.compedCents)} / month not billed`} info="Paid plans granted manually, with no payment provider and no paid-through date." />
        </KpiRow>
      </section>

      <div className="adm-grid is-2">
        <Card title="MRR, last 12 months" action={<span className="adm-muted">from paid plan orders</span>}>
          <LineChart area label="Monthly recurring revenue by month" labels={h.map((x) => x.month)} labelFormat={labelFormats.month}
            series={[{ key: "mrr", label: "MRR", values: h.map((x) => x.mrrCents / 100), color: "var(--a-chart)" }]} format={usd0} />
        </Card>
        <Card title="MRR movements" action={<span className="adm-muted">gains above, losses below</span>}>
          <StackedBars label="MRR movements by month" labels={h.slice(1).map((x) => x.month)} labelFormat={labelFormats.month} format={usd0}
            series={[
              { key: "new", label: "New", values: h.slice(1).map((x) => x.new / 100), color: SERIES[0] },
              { key: "expansion", label: "Expansion", values: h.slice(1).map((x) => x.expansion / 100), color: SERIES[2] },
              { key: "contraction", label: "Contraction", values: h.slice(1).map((x) => -x.contraction / 100), color: SERIES[3] },
              { key: "churned", label: "Churned", values: h.slice(1).map((x) => -x.churned / 100), color: SERIES[1] },
            ]} />
        </Card>
      </div>

      <div className="adm-grid is-2">
        <Card title="Subscribers gained and lost">
          <StackedBars label="Subscribers gained and lost by month" labels={h.slice(1).map((x) => x.month)} labelFormat={labelFormats.month} format={count}
            series={[
              { key: "new", label: "New", values: h.slice(1).map((x) => x.newCount), color: SERIES[0] },
              { key: "churned", label: "Churned", values: h.slice(1).map((x) => -x.churnedCount), color: SERIES[1] },
            ]} />
        </Card>
        <Card title="Revenue by plan">
          <ShareBar format={cents0} items={d.planMix.filter((p) => n(p.mrrCents) > 0).map((p, i) => ({ key: p.id, label: p.name, value: n(p.mrrCents), color: SERIES[i] || OTHER }))} />
          <dl className="adm-minifacts">
            {d.planMix.filter((p) => n(p.accounts) > 0).map((p) => (
              <div key={p.id}><dt>{p.name}</dt><dd>{fmt.number(p.accounts)} accounts{n(p.paying) ? ` · ${fmt.number(p.paying)} paying` : ""}{n(p.annual) ? ` · ${fmt.number(p.annual)} annual` : ""}</dd></div>
            ))}
          </dl>
        </Card>
      </div>

      <section className="adm-section" aria-labelledby="rev-cash">
        <h2 id="rev-cash" className="adm-section-title">Cash · last {windowLabel(d.days)}</h2>
        <KpiRow>
          <Kpi label="Cash collected" value={compactUsd(r.collectedCents)} delta={fmt.delta(r.collectedCents, r.collectedPrevCents)} spark={cashSeries}
            hint={`${fmt.number(r.payments)} payments`} info="Verified payments in this window, plans and credit packs, before fees and refunds." />
          <Kpi label="Refunded" value={fmt.cents(r.refundedCents)} hint="this window" />
          <Kpi label="Payment success" value={pct(r.paymentSuccessRate)} hint={`${fmt.number(r.failedPayments)} failed`} />
          <Kpi label="Renewals due" value={fmt.number(r.renewals30d)} hint="in the next 30 days" />
          <Kpi label="Past due" value={fmt.number(r.pastDue)} hint="accounts" />
        </KpiRow>
      </section>

      <div className="adm-grid is-2">
        <Card title="Cash collected vs AI cost">
          <LineChart label="Cash collected and AI provider cost" labels={days} format={usd0}
            series={[{ key: "cash", label: "Cash collected", values: cashSeries }, { key: "cost", label: "AI provider cost", values: costSeries, color: SERIES[1] }]} />
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

      <section className="adm-section" aria-labelledby="rev-margin">
        <h2 id="rev-margin" className="adm-section-title">Margin and cost to serve</h2>
        <KpiRow>
          <Kpi label="Gross margin" value={pct(e.marginPct)} hint={`${e.grossProfitUsd >= 0 ? "" : "−"}${fmt.usd(Math.abs(e.grossProfitUsd))} after AI cost`}
            info="(Cash collected − AI provider cost) ÷ cash collected, for this window. Excludes payment fees and servers." />
          <Kpi label="AI provider cost" value={fmt.usd(e.cost)} delta={fmt.delta(e.cost, e.costPrev)} invertDelta spark={costSeries} />
          <Kpi label="Cost per paying account" value={e.costPerPayingAccount === null ? "—" : fmt.usd(e.costPerPayingAccount)} hint={`vs ${fmt.cents(r.arpaCents)} ARPA / month`} />
          <Kpi label="Cost per active user" value={e.costPerActiveUser === null ? "—" : fmt.usd(e.costPerActiveUser)} hint="AI cost ÷ AI-active users" />
          <Kpi label="Revenue per AI call" value={e.revenuePerCall === null ? "—" : fmt.usd(e.revenuePerCall)} hint={e.calls ? `cost ${fmt.usd(e.cost / e.calls)} per call` : undefined} />
          <Kpi label="Out of credits" value={fmt.number(e.outOfCredits)} hint="likely upgrades" info="Accounts with no allowance and no bonus credits left." />
        </KpiRow>
      </section>

      <div className="adm-grid is-2">
        <Card title="Gross profit by month" action={<span className="adm-muted">cash − AI cost</span>}>
          <LineChart label="Cash, AI cost and gross profit by month" labels={d.cashMonths.map((m) => m.month)} labelFormat={labelFormats.month} format={usd0}
            series={[
              { key: "cash", label: "Net cash", values: d.cashMonths.map(net) },
              { key: "cost", label: "AI cost", values: d.cashMonths.map((m) => n(m.cost)), color: SERIES[1] },
              { key: "profit", label: "Gross profit", values: d.cashMonths.map((m) => net(m) - n(m.cost)), color: SERIES[2], dashed: true },
            ]} />
        </Card>
        <Card title="AI spend by provider" action={<button type="button" className="adm-link" onClick={() => navigate("/admin/usage")}>Credit usage</button>}>
          <StackedBars label="AI provider spend per period" labels={e.providerSeries.map((p) => p.day)} format={(v) => fmt.usd(v)}
            series={e.providers.map((p, i) => ({ key: p, label: p === "other" ? "Other" : providerLabel(p), values: e.providerSeries.map((row) => row.values[i]), color: p === "other" ? OTHER : SERIES[i] }))} />
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
    </>
  );
}
