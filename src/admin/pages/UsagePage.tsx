import { useState } from "react";
import { fmt } from "../api";
import { Badge, BarChart, Card, DataTable, Empty, Guarded, Page, Pager, Person, RankBars, Segmented, Stat, useAdminQuery } from "../ui";
import type { PageProps } from "../AdminApp";
import { UsageDetailPage, usageLink } from "./UsageDetailPage";

type Usage = {
  days: number;
  totals: { tokens: number; cost: number; calls: number; inputTokens: number; outputTokens: number; unattributedCost: number; estimatedShare: number; users: number };
  series: Array<{ day: string; tokens: number; cost: number; calls: number }>;
  byProvider: Array<{ provider: string; tokens: number; cost: number; calls: number }>;
  byModel: Array<{ provider: string; model: string; operation: string; tokens: number; cost: number; calls: number; inputTokens: number; outputTokens: number }>;
  byFeature: Array<{ feature: string; tokens: number; cost: number; calls: number }>;
  topUsers: Array<{ id: string; email: string; name: string; avatarUrl: string; tokens: number; cost: number; calls: number }>;
};
type Event = { id: string; userId: string | null; email: string | null; provider: string; model: string; operation: string; feature: string; inputTokens: number; outputTokens: number; cost: number; costEstimated: boolean; tokens: number; createdAt: string };

export function UsagePage(props: PageProps) {
  return props.route.id ? <UsageDetailPage {...props} /> : <UsageOverview {...props} />;
}

function UsageOverview({ navigate }: PageProps) {
  const [days, setDays] = useState<"7" | "30" | "90">("30");
  const [metric, setMetric] = useState<"tokens" | "cost">("tokens");
  const query = useAdminQuery<Usage>(`/api/admin/usage?days=${days}`);
  const [filter, setFilter] = useState<"" | "unattributed">("");
  const [offset, setOffset] = useState(0);
  const events = useAdminQuery<{ events: Event[] }>(`/api/admin/usage/events?limit=25&offset=${offset}${filter === "unattributed" ? "&unattributed=1" : ""}`);
  const value = metric === "tokens" ? (r: { tokens: number }) => Number(r.tokens) : (r: { cost: number }) => Number(r.cost);
  const format = metric === "tokens" ? fmt.tokens : fmt.usd;

  return (
    <Page
      title="Token usage"
      description="Every paid AI call, what it cost us and what it charged the user."
      actions={<>
        <Segmented label="Measure" value={metric} onChange={setMetric} options={[{ value: "tokens", label: "Tokens" }, { value: "cost", label: "Cost" }]} />
        <Segmented label="Window" value={days} onChange={setDays} options={[{ value: "7", label: "7d" }, { value: "30", label: "30d" }, { value: "90", label: "90d" }]} />
      </>}
    >
      <Guarded query={query} label="Loading usage">
        {(u) => (
          <>
            <div className="adm-stats">
              <Stat label="Tokens charged" value={fmt.tokens(u.totals.tokens)} hint={`${fmt.number(u.totals.calls)} calls · ${fmt.number(u.totals.users)} users`} />
              <Stat label="Provider cost" value={fmt.usd(u.totals.cost)} hint={u.totals.cost ? `${fmt.usd(u.totals.unattributedCost)} from system work` : undefined} />
              <Stat label="Model tokens" value={fmt.tokens(Number(u.totals.inputTokens) + Number(u.totals.outputTokens))} hint={`${fmt.tokens(u.totals.inputTokens)} in · ${fmt.tokens(u.totals.outputTokens)} out`} />
              <Stat label="Estimated cost share" value={`${Math.round(Number(u.totals.estimatedShare) * 100)}%`} hint="calls where the provider sent no price" />
            </div>
            <Card title={metric === "tokens" ? "Tokens charged per day" : "Provider cost per day"}>
              <BarChart label={metric === "tokens" ? "Tokens charged per day" : "Provider cost per day"} data={u.series.map((d) => ({ label: d.day, value: value(d) }))} format={format} />
            </Card>
            <div className="adm-grid is-3">
              <Card title="By provider">
                <RankBars format={format} items={u.byProvider.map((p) => ({ key: p.provider, label: <button type="button" className="adm-link is-plain" onClick={() => navigate(usageLink("provider", p.provider))}>{p.provider}</button>, sub: `${fmt.number(p.calls)} calls`, value: value(p) }))} />
              </Card>
              <Card title="By feature">
                <RankBars format={format} items={u.byFeature.map((f) => ({ key: f.feature || "unknown", label: <button type="button" className="adm-link is-plain" onClick={() => navigate(usageLink("feature", f.feature))}><code>{f.feature || "unknown"}</code></button>, sub: `${fmt.number(f.calls)} calls`, value: value(f) }))} />
              </Card>
              <Card title="By user">
                <RankBars format={format} items={u.topUsers.map((x) => ({ key: x.id, label: <button type="button" className="adm-link is-plain" onClick={() => navigate(`/admin/users/${x.id}/usage`)}>{x.name || x.email}</button>, sub: `${fmt.number(x.calls)} calls`, value: value(x) }))} />
              </Card>
            </div>
            <Card title="Models" flush>
              <DataTable
                rowKey={(m) => `${m.provider}-${m.model}-${m.operation}`}
                rows={u.byModel}
                onRowClick={(m) => navigate(usageLink("model", m.model))}
                empty={<Empty title="No AI calls in this window" />}
                columns={[
                  { key: "model", label: "Model", render: (m) => <span className="adm-list-main"><code>{m.model || "unknown"}</code><small>{m.provider}</small></span> },
                  { key: "op", label: "Type", render: (m) => <Badge tone="neutral">{m.operation}</Badge> },
                  { key: "calls", label: "Calls", align: "right", render: (m) => fmt.number(m.calls) },
                  { key: "io", label: "In / out", align: "right", render: (m) => `${fmt.tokens(m.inputTokens)} / ${fmt.tokens(m.outputTokens)}` },
                  { key: "cost", label: "Cost", align: "right", render: (m) => fmt.usd(m.cost) },
                  { key: "tokens", label: "Charged", align: "right", render: (m) => fmt.tokens(m.tokens) },
                ]}
              />
            </Card>
          </>
        )}
      </Guarded>
      <Card title="Recent calls" flush action={<Segmented label="Filter" value={filter} onChange={(v) => { setFilter(v); setOffset(0); }} options={[{ value: "", label: "All" }, { value: "unattributed", label: "System only" }]} />}>
        <Guarded query={events} label="Loading calls">
          {({ events: rows }) => (
            <>
              <DataTable
                rowKey={(e) => e.id}
                rows={rows}
                onRowClick={(e) => e.userId && navigate(`/admin/users/${e.userId}`)}
                empty={<Empty title="No AI calls recorded yet">Calls appear here as soon as someone generates something.</Empty>}
                columns={[
                  { key: "when", label: "When", render: (e) => <span className="adm-muted">{fmt.dateTime(e.createdAt)}</span> },
                  { key: "who", label: "User", render: (e) => (e.email ? <Person email={e.email} /> : <span className="adm-muted">System</span>) },
                  { key: "what", label: "Feature", render: (e) => <span className="adm-list-main"><code>{e.feature || "—"}</code><small>{e.model}</small></span> },
                  { key: "cost", label: "Cost", align: "right", render: (e) => <span title={e.costEstimated ? "Estimated" : "Reported by provider"}>{fmt.usd(e.cost)}{e.costEstimated ? "*" : ""}</span> },
                  { key: "tokens", label: "Charged", align: "right", render: (e) => fmt.tokens(e.tokens) },
                ]}
              />
              <Pager offset={offset} limit={25} count={rows.length} onChange={setOffset} />
            </>
          )}
        </Guarded>
      </Card>
    </Page>
  );
}
