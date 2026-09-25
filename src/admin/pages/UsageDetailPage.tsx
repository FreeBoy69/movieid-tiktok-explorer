import { useEffect, useState } from "react";
import { adminFetch, can, fmt, providerLabel } from "../api";
import { toast } from "../../utils/toast";
import { BackLink, Badge, BarChart, Button, Card, DataTable, DetailHeader, Empty, ErrorState, Guarded, Loading, Pager, Person, RankBars, Segmented, Stat, Toggle, useAdminQuery } from "../ui";
import type { PageProps } from "../AdminApp";

type Row = { tokens: number; cost: number; calls: number };
type Breakdown = {
  dim: string; value: string; days: number;
  totals: { tokens: number; cost: number; calls: number; inputTokens: number; outputTokens: number; users: number; estimatedShare: number; avgCost: number; firstAt: string | null; lastAt: string | null };
  series: Array<{ day: string } & Row>;
  byModel: Array<{ provider: string; model: string } & Row>;
  byFeature: Array<{ feature: string } & Row>;
  byUser: Array<{ id: string; email: string; name: string; avatarUrl: string } & Row>;
  byProvider: Array<{ provider: string } & Row>;
  byOperation: Array<{ operation: string } & Row>;
};
type Settings = { governance: { disabledProviders: string[]; blockedModels: string[] } & Record<string, unknown>; billing: { modelMultipliers: Record<string, number>; tokensPerUsd: number } & Record<string, unknown> };
type Event = { id: string; userId: string | null; email: string | null; model: string; operation: string; feature: string; inputTokens: number; outputTokens: number; cost: number; costEstimated: boolean; tokens: number; createdAt: string };

const LABEL: Record<string, string> = { provider: "Provider", model: "Model", feature: "Feature", operation: "Type" };
const n = (v: unknown) => Number(v) || 0;

export function UsageDetailPage({ admin, route, navigate }: PageProps) {
  const dim = route.id;
  const value = route.sub;
  const [days, setDays] = useState<"7" | "30" | "90">("30");
  const [metric, setMetric] = useState<"tokens" | "cost" | "calls">("cost");
  const query = useAdminQuery<Breakdown>(`/api/admin/usage/breakdown?dim=${encodeURIComponent(dim)}&value=${encodeURIComponent(value)}&days=${days}`);
  const [offset, setOffset] = useState(0);
  const events = useAdminQuery<{ events: Event[] }>(`/api/admin/usage/events?${dim}=${encodeURIComponent(value)}&limit=25&offset=${offset}`);
  const back = <BackLink label="Credit usage" onClick={() => navigate("/admin/usage")} />;
  const open = (d: string, v: string) => navigate(`/admin/usage/${d}/${encodeURIComponent(v || "")}`);
  const pick = (r: Row) => n(r[metric]);
  const format = metric === "tokens" ? fmt.credits : metric === "cost" ? fmt.usd : fmt.number;

  if (!LABEL[dim]) return <div className="adm-page">{back}<ErrorState message="Unknown usage view." /></div>;
  return (
    <div className="adm-page">
      {back}
      <DetailHeader
        title={dim === "provider" ? providerLabel(value) : dim === "feature" || dim === "model" ? <code className="adm-title-code">{value || "unknown"}</code> : value}
        subtitle={`${LABEL[dim]} · every paid AI call that went through it`}
        actions={<>
          <Segmented label="Measure" value={metric} onChange={setMetric} options={[{ value: "cost", label: "Cost" }, { value: "tokens", label: "Credits" }, { value: "calls", label: "Calls" }]} />
          <Segmented label="Window" value={days} onChange={setDays} options={[{ value: "7", label: "7d" }, { value: "30", label: "30d" }, { value: "90", label: "90d" }]} />
        </>}
      />
      {(dim === "provider" || dim === "model") && can(admin, "view") ? <ControlsCard dim={dim} value={value} canEdit={can(admin, "settings.manage")} /> : null}
      <Guarded query={query} label="Loading usage">
        {(u) => (
          <>
            <div className="adm-stats is-4">
              <Stat label="Provider cost" value={fmt.usd(u.totals.cost)} hint={`${fmt.usd(u.totals.avgCost)} per call on average`} />
              <Stat label="Credits charged" value={fmt.credits(u.totals.tokens)} hint={n(u.totals.cost) ? `${fmt.credits(n(u.totals.tokens) / n(u.totals.cost))} credits per $1 of cost` : undefined} />
              <Stat label="Calls" value={fmt.number(u.totals.calls)} hint={`${fmt.number(u.totals.users)} users · ${Math.round(n(u.totals.estimatedShare) * 100)}% priced by estimate`} />
              <Stat label="Last call" value={fmt.ago(u.totals.lastAt)} hint={`${fmt.tokens(u.totals.inputTokens)} in · ${fmt.tokens(u.totals.outputTokens)} out`} />
            </div>
            <Card title={`${metric === "cost" ? "Provider cost" : metric === "tokens" ? "Credits charged" : "Calls"} per day`}>
              <BarChart label="Per day" data={u.series.map((s) => ({ label: s.day, value: pick(s) }))} format={format} />
            </Card>
            <div className="adm-grid is-3">
              {dim !== "model" ? (
                <Card title="By model"><RankBars format={format} items={u.byModel.map((m) => ({ key: `${m.provider}-${m.model}`, value: pick(m), sub: `${fmt.number(m.calls)} calls`, label: <button type="button" className="adm-link is-plain" onClick={() => open("model", m.model)}><code>{m.model || "unknown"}</code></button> }))} /></Card>
              ) : (
                <Card title="By provider"><RankBars format={format} items={u.byProvider.map((p) => ({ key: p.provider, value: pick(p), sub: `${fmt.number(p.calls)} calls`, label: <button type="button" className="adm-link is-plain" onClick={() => open("provider", p.provider)}>{providerLabel(p.provider)}</button> }))} /></Card>
              )}
              {dim !== "feature" ? (
                <Card title="By feature"><RankBars format={format} items={u.byFeature.map((f) => ({ key: f.feature || "unknown", value: pick(f), sub: `${fmt.number(f.calls)} calls`, label: <button type="button" className="adm-link is-plain" onClick={() => open("feature", f.feature)}><code>{f.feature || "unknown"}</code></button> }))} /></Card>
              ) : (
                <Card title="By type"><RankBars format={format} items={u.byOperation.map((o) => ({ key: o.operation, value: pick(o), sub: `${fmt.number(o.calls)} calls`, label: o.operation }))} /></Card>
              )}
              <Card title="By user"><RankBars format={format} items={u.byUser.map((x) => ({ key: x.id, value: pick(x), sub: `${fmt.number(x.calls)} calls`, label: <button type="button" className="adm-link is-plain" onClick={() => navigate(`/admin/users/${x.id}/usage`)}>{x.name || x.email}</button> }))} /></Card>
            </div>
          </>
        )}
      </Guarded>
      <Card title="Calls" flush>
        <Guarded query={events} label="Loading calls">
          {({ events: rows }) => (
            <>
              <DataTable
                rowKey={(e) => e.id}
                rows={rows}
                onRowClick={(e) => e.userId && navigate(`/admin/users/${e.userId}/usage`)}
                empty={<Empty title="No calls recorded" />}
                columns={[
                  { key: "when", label: "When", render: (e) => <span className="adm-muted">{fmt.dateTime(e.createdAt)}</span> },
                  { key: "who", label: "User", render: (e) => (e.email ? <Person email={e.email} /> : <span className="adm-muted">System</span>) },
                  { key: "what", label: "Feature", render: (e) => <span className="adm-list-main"><code>{e.feature || "—"}</code><small>{e.operation} · {e.model}</small></span> },
                  { key: "io", label: "In / out", align: "right", render: (e) => `${fmt.number(e.inputTokens)} / ${fmt.number(e.outputTokens)}` },
                  { key: "cost", label: "Cost", align: "right", render: (e) => <span title={e.costEstimated ? "Estimated" : "Reported by provider"}>{fmt.usd(e.cost)}{e.costEstimated ? "*" : ""}</span> },
                  { key: "tokens", label: "Credits", align: "right", render: (e) => fmt.credits(e.tokens) },
                ]}
              />
              <Pager offset={offset} limit={25} count={rows.length} onChange={setOffset} />
            </>
          )}
        </Guarded>
      </Card>
    </div>
  );
}

// Pause a provider, turn a model off, or charge a model differently.
function ControlsCard({ dim, value, canEdit }: { dim: string; value: string; canEdit: boolean }) {
  const settings = useAdminQuery<Settings>("/api/admin/settings");
  const [multiplier, setMultiplier] = useState("1");
  const [busy, setBusy] = useState("");
  useEffect(() => {
    if (settings.data) setMultiplier(String(settings.data.billing.modelMultipliers?.[value] ?? 1));
  }, [settings.data, value]);
  if (!settings.data) return settings.error ? null : <Card><Loading label="Loading controls" /></Card>;
  const { governance, billing } = settings.data;
  const save = async (key: "governance" | "billing", body: Record<string, unknown>, message: string) => {
    setBusy(key);
    try {
      await adminFetch(`/api/admin/settings/${key}`, { method: "PUT", body });
      toast.success(message);
      settings.reload();
    } catch (error) {
      toast.error(error);
    } finally {
      setBusy("");
    }
  };
  const current = Number(billing.modelMultipliers?.[value] ?? 1);
  return (
    <Card title="Controls">
      {dim === "provider" ? (
        <Toggle
          label={`Allow calls to ${value}`}
          description="Off blocks new calls to this provider for everyone. Features with a fallback switch to the next provider."
          checked={!governance.disabledProviders.includes(value)}
          disabled={!canEdit || busy === "governance"}
          onChange={(on) => save("governance", { ...governance, disabledProviders: on ? governance.disabledProviders.filter((p) => p !== value) : [...governance.disabledProviders, value] }, on ? `${value} is back on.` : `${value} is paused.`)}
        />
      ) : (
        <>
          <Toggle
            label="Allow this model"
            description="Off blocks new calls to this exact model. Features that have a fallback model use it instead."
            checked={!governance.blockedModels.includes(value)}
            disabled={!canEdit || busy === "governance"}
            onChange={(on) => save("governance", { ...governance, blockedModels: on ? governance.blockedModels.filter((m) => m !== value) : [...governance.blockedModels, value] }, on ? "Model turned back on." : "Model turned off.")}
          />
          <div className="adm-toggle-row">
            <span>
              <label htmlFor="model-multiplier">Price multiplier</label>
              <small>Charges this model at {Number(multiplier) || 0}× its provider-cost token rate. Plan prices carry the profit margin.</small>
            </span>
            <div className="adm-inline">
              <input id="model-multiplier" className="adm-input adm-input-sm" inputMode="decimal" value={multiplier} disabled={!canEdit} onChange={(e) => setMultiplier(e.target.value.replace(/[^\d.]/g, ""))} />
              <Button size="sm" variant="primary" disabled={!canEdit || Number(multiplier) === current || multiplier === ""} loading={busy === "billing"}
                onClick={() => {
                  const next = { ...billing.modelMultipliers };
                  if (Number(multiplier) === 1) delete next[value];
                  else next[value] = Number(multiplier);
                  void save("billing", { ...billing, modelMultipliers: next }, "Price multiplier saved.");
                }}>Save</Button>
            </div>
          </div>
          {current !== 1 ? <p className="adm-help"><Badge tone="accent">{`${current}× price`}</Badge> is active for this model.</p> : null}
        </>
      )}
    </Card>
  );
}

export const usageLink = (dim: string, value: string) => `/admin/usage/${dim}/${encodeURIComponent(value || "")}`;
