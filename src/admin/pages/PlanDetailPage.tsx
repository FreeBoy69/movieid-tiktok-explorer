import { useEffect, useState } from "react";
import { adminFetch, can, fmt } from "../api";
import { toast } from "../../utils/toast";
import {
  BackLink, Badge, BarChart, Button, Card, DataTable, DetailHeader, Empty, ErrorState, Field, Guarded, Loading, Modal, Pager, Person, RankBars, Segmented, Stat, Tabs, Toggle, useAdminQuery,
} from "../ui";
import type { PageProps } from "../AdminApp";
import { previewPrice, type BillingSettings } from "../pricing";

type Plan = { id: string; name: string; description: string; priceCents: number; monthlyTokens: number; features: string[]; isDefault: boolean; active: boolean; sort: number; priceMode: "auto" | "manual"; marginPercent: number | null; createdAt?: string; updatedAt?: string };
type PlanDetail = {
  plan: Plan;
  stats: Record<string, number>;
  series: Array<{ day: string; tokens: number; cost: number }>;
  topUsers: Array<{ id: string; email: string; name: string; avatarUrl: string; tokens: number; cost: number }>;
  changes: Array<{ id: string; userId: string; email: string; name: string; actor: string; note: string; createdAt: string }>;
};
type Subscriber = { id: string; email: string; name: string; avatarUrl: string; userStatus: string; status: string; unlimited: boolean; periodEnd: string; balance: number; lastSeenAt: string | null; periodUsed: number };

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "subscribers", label: "Subscribers" },
  { id: "settings", label: "Settings" },
  { id: "bulk", label: "Bulk actions" },
];
const n = (v: unknown) => Number(v) || 0;

export function PlanDetailPage({ admin, route, navigate }: PageProps) {
  const isNew = route.id === "new";
  const tab = isNew ? "settings" : TABS.some((t) => t.id === route.sub) ? route.sub : "overview";
  const query = useAdminQuery<PlanDetail>(isNew ? null : `/api/admin/billing/plans/${encodeURIComponent(route.id)}`);
  const back = <BackLink label="Billing" onClick={() => navigate("/admin/billing")} />;
  const go = (next: string) => navigate(`/admin/billing/${encodeURIComponent(route.id)}${next === "overview" ? "" : `/${next}`}`, { replace: true });

  if (isNew) {
    return (
      <div className="adm-page">
        {back}
        <DetailHeader title="New plan" subtitle="Plans set a monthly token allowance and a price. Payments are manual until Google Pay is connected." />
        <PlanForm initial={{ active: true, features: [], sort: 10 }} isNew canEdit={can(admin, "billing.manage")} onSaved={(id) => navigate(`/admin/billing/${id}`, { replace: true })} />
      </div>
    );
  }
  if (query.error && !query.data) return <div className="adm-page">{back}<ErrorState message={query.error} onRetry={query.reload} /></div>;
  if (!query.data) return <div className="adm-page">{back}<Loading label="Loading plan" /></div>;
  const { plan, stats } = query.data;
  const revenue = n(stats.active) * plan.priceCents;
  return (
    <div className="adm-page">
      {back}
      <DetailHeader
        title={plan.name}
        subtitle={plan.description || "No description"}
        badges={<>
          <Badge tone="neutral">{plan.priceCents ? `${fmt.cents(plan.priceCents)} / month` : "Free"}</Badge>
          <Badge tone="neutral">{`${fmt.tokens(plan.monthlyTokens)} tokens / month`}</Badge>
          {plan.isDefault ? <Badge tone="accent">Default for new users</Badge> : null}
          {plan.active ? null : <Badge tone="bad">Retired</Badge>}
        </>}
        meta={<>Plan id <code>{plan.id}</code>{plan.updatedAt ? ` · last edited ${fmt.ago(plan.updatedAt).toLowerCase()}` : ""}</>}
      />
      <Tabs label="Plan sections" tabs={TABS.map((t) => (t.id === "subscribers" ? { ...t, count: n(stats.subscribers) } : t))} current={tab} onChange={go} />
      {tab === "overview" ? (
        <>
          <div className="adm-stats is-4">
            <Stat label="Accounts" value={fmt.number(stats.subscribers)} hint={`${fmt.number(stats.active)} active · ${fmt.number(stats.pastDue)} past due · ${fmt.number(stats.canceled)} canceled`} />
            <Stat label="Plan revenue (MRR)" value={fmt.cents(revenue)} hint="active accounts × price" />
            <Stat label="AI cost (30d)" value={fmt.usd(stats.cost30d)} hint={`${fmt.number(stats.activeUsers30d)} accounts used AI`} />
            <Stat label="Margin (30d)" value={`${revenue / 100 - n(stats.cost30d) < 0 ? "−" : ""}${fmt.usd(Math.abs(revenue / 100 - n(stats.cost30d)))}`} hint="revenue − AI cost" />
            <Stat label="Tokens used (30d)" value={fmt.tokens(stats.tokens30d)} hint={n(stats.subscribers) ? `${fmt.tokens(n(stats.tokens30d) / n(stats.subscribers))} per account` : undefined} />
            <Stat label="Out of tokens" value={fmt.number(stats.outOfTokens)} hint="blocked until renewal" />
            <Stat label="Unlimited" value={fmt.number(stats.unlimited)} hint="accounts that never get blocked" />
            <Stat label="Moved here (30d)" value={fmt.number(stats.joined30d)} hint="plan changes into this plan" />
          </div>
          <div className="adm-grid is-2-1">
            <Card title="Tokens used by this plan's accounts, last 30 days">
              <BarChart label="Tokens per day" data={query.data.series.map((d) => ({ label: d.day, value: n(d.tokens) }))} format={fmt.tokens} height={160} />
            </Card>
            <Card title="Heaviest accounts (30d)">
              <RankBars format={fmt.tokens} items={query.data.topUsers.map((u) => ({ key: u.id, value: n(u.tokens), label: <button type="button" className="adm-link is-plain" onClick={() => navigate(`/admin/users/${u.id}`)}>{u.name || u.email}</button>, sub: `${fmt.usd(u.cost)} cost` }))} />
            </Card>
          </div>
          <Card title="Recent moves onto this plan" flush>
            <DataTable
              rowKey={(c) => c.id}
              rows={query.data.changes}
              onRowClick={(c) => navigate(`/admin/users/${c.userId}`)}
              empty={<Empty title="Nobody has been moved onto this plan yet" />}
              columns={[
                { key: "who", label: "Account", render: (c) => <Person name={c.name} email={c.email} /> },
                { key: "note", label: "Note", render: (c) => <span className="adm-muted">{c.note}</span> },
                { key: "by", label: "By", render: (c) => c.actor },
                { key: "when", label: "When", render: (c) => <span className="adm-muted">{fmt.dateTime(c.createdAt)}</span> },
              ]}
            />
          </Card>
        </>
      ) : null}
      {tab === "subscribers" ? <SubscribersTab planId={plan.id} navigate={navigate} /> : null}
      {tab === "settings" ? <PlanForm initial={plan} canEdit={can(admin, "billing.manage")} onSaved={() => query.reload()} /> : null}
      {tab === "bulk" ? <BulkTab plan={plan} subscribers={n(stats.subscribers)} canEdit={can(admin, "billing.manage")} onDone={query.reload} /> : null}
    </div>
  );
}

function SubscribersTab({ planId, navigate }: { planId: string; navigate: PageProps["navigate"] }) {
  const [filter, setFilter] = useState<"" | "out" | "unlimited">("");
  const [status, setStatus] = useState<"" | "active" | "past_due" | "canceled">("");
  const [offset, setOffset] = useState(0);
  const query = useAdminQuery<{ subscribers: Subscriber[] }>(`/api/admin/billing/plans/${encodeURIComponent(planId)}/subscribers?filter=${filter}&status=${status}&offset=${offset}&limit=50`);
  return (
    <>
      <div className="adm-toolbar">
        <Segmented label="Show" value={filter} onChange={(v) => { setFilter(v); setOffset(0); }} options={[{ value: "", label: "Everyone" }, { value: "out", label: "Out of tokens" }, { value: "unlimited", label: "Unlimited" }]} />
        <Segmented label="Billing status" value={status} onChange={(v) => { setStatus(v); setOffset(0); }} options={[{ value: "", label: "Any status" }, { value: "active", label: "Active" }, { value: "past_due", label: "Past due" }, { value: "canceled", label: "Canceled" }]} />
      </div>
      <Card flush>
        <Guarded query={query} label="Loading accounts">
          {({ subscribers }) => (
            <>
              <DataTable
                rowKey={(s) => s.id}
                rows={subscribers}
                onRowClick={(s) => navigate(`/admin/users/${s.id}`)}
                empty={<Empty title="No accounts match" />}
                columns={[
                  { key: "who", label: "Account", render: (s) => <Person name={s.name} email={s.email} avatarUrl={s.avatarUrl} /> },
                  { key: "status", label: "Billing", render: (s) => <span className="adm-inline"><Badge>{s.status}</Badge>{s.userStatus === "suspended" ? <Badge>suspended</Badge> : null}</span> },
                  { key: "balance", label: "Balance", align: "right", render: (s) => (s.unlimited ? "∞" : <span className={n(s.balance) <= 0 ? "adm-bad-text" : undefined}>{fmt.tokens(s.balance)}</span>) },
                  { key: "used", label: "Used this period", align: "right", render: (s) => fmt.tokens(s.periodUsed) },
                  { key: "renews", label: "Renews", render: (s) => <span className="adm-muted">{fmt.date(s.periodEnd)}</span> },
                  { key: "seen", label: "Last active", render: (s) => <span className="adm-muted">{fmt.ago(s.lastSeenAt)}</span> },
                ]}
              />
              <Pager offset={offset} limit={50} count={subscribers.length} onChange={setOffset} />
            </>
          )}
        </Guarded>
      </Card>
    </>
  );
}

function PlanForm({ initial, isNew, canEdit, onSaved }: { initial: Partial<Plan>; isNew?: boolean; canEdit: boolean; onSaved: (id: string) => void }) {
  const [draft, setDraft] = useState<Partial<Plan> & { featuresText: string }>({ ...initial, featuresText: (initial.features || []).join("\n") });
  const [saving, setSaving] = useState(false);
  const settings = useAdminQuery<{ billing: BillingSettings }>("/api/admin/settings");
  useEffect(() => setDraft({ ...initial, featuresText: (initial.features || []).join("\n") }), [initial]);
  const priceMode = draft.priceMode || "auto";
  const autoPrice = settings.data ? previewPrice(n(draft.monthlyTokens), settings.data.billing, draft.marginPercent ?? null) : null;
  const displayedPrice = priceMode === "auto" ? autoPrice?.priceCents : n(draft.priceCents);
  const save = async () => {
    setSaving(true);
    try {
      await adminFetch("/api/admin/billing/plans", {
        method: "POST",
        body: { ...draft, priceMode, marginPercent: draft.marginPercent ?? null, features: draft.featuresText.split("\n"), priceCents: Math.round(n(draft.priceCents)), monthlyTokens: n(draft.monthlyTokens) },
      });
      toast.success(isNew ? "Plan created." : "Plan saved. New limits apply from each account's next renewal.");
      onSaved(String(draft.id));
    } catch (error) {
      toast.error(error);
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="adm-grid is-2-1">
      <Card title="Plan settings" action={canEdit ? <Button variant="primary" loading={saving} disabled={!draft.id || !draft.name || (priceMode === "auto" && !settings.data)} onClick={save}>{isNew ? "Create plan" : "Save changes"}</Button> : null}>
        <fieldset className="adm-form-grid" disabled={!canEdit}>
          <div className="adm-form-grid is-2">
            <Field label="Plan id" hint={isNew ? "Lowercase, no spaces. Can't be changed later." : "Can't be changed."}>
              {(id) => <input id={id} className="adm-input" value={draft.id || ""} disabled={!isNew} onChange={(e) => setDraft({ ...draft, id: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "") })} placeholder="e.g. creator" />}
            </Field>
            <Field label="Name">{(id) => <input id={id} className="adm-input" value={draft.name || ""} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />}</Field>
          </div>
          <Field label="Description">{(id) => <input id={id} className="adm-input" value={draft.description || ""} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />}</Field>
          <Field label="Pricing mode">
            {() => <Segmented label="Pricing mode" value={priceMode} onChange={(value) => setDraft({ ...draft, priceMode: value })} options={[{ value: "auto", label: "Automatic" }, { value: "manual", label: "Manual" }]} />}
          </Field>
          <div className="adm-form-grid is-2">
            {priceMode === "manual" ? <Field label="Price per month (USD)">
              {(id) => <input id={id} className="adm-input" inputMode="decimal" value={draft.priceCents === undefined ? "" : String(n(draft.priceCents) / 100)} onChange={(e) => setDraft({ ...draft, priceCents: Math.round(Number(e.target.value.replace(/[^\d.]/g, "")) * 100) })} />}
            </Field> : <Field label="Profit margin" hint="Leave blank to use the global margin">
              {(id) => <input id={id} className="adm-input" inputMode="decimal" placeholder={settings.data ? `${settings.data.billing.profitMarginPercent}% global` : "Loading pricing"} value={draft.marginPercent ?? ""} onChange={(e) => setDraft({ ...draft, marginPercent: e.target.value === "" ? null : Math.min(1000, Number(e.target.value.replace(/[^\d.]/g, ""))) })} />}
            </Field>}
            <Field label="Tokens per month" hint={draft.monthlyTokens ? fmt.tokens(draft.monthlyTokens) : undefined}>
              {(id) => <input id={id} className="adm-input" inputMode="numeric" value={draft.monthlyTokens === undefined ? "" : String(draft.monthlyTokens)} onChange={(e) => setDraft({ ...draft, monthlyTokens: Number(e.target.value.replace(/\D/g, "")) })} />}
            </Field>
          </div>
          <Field label="Features" hint="One per line. Shown to users when they compare plans.">
            {(id) => <textarea id={id} className="adm-input" rows={5} value={draft.featuresText} onChange={(e) => setDraft({ ...draft, featuresText: e.target.value })} />}
          </Field>
          <Field label="Sort order" hint="Lower numbers show first.">{(id) => <input id={id} className="adm-input" inputMode="numeric" value={String(draft.sort ?? 0)} onChange={(e) => setDraft({ ...draft, sort: Number(e.target.value.replace(/\D/g, "")) })} />}</Field>
          <Toggle label="Default for new users" description="Every new sign-up starts on this plan. Only one plan can be the default." checked={Boolean(draft.isDefault)} onChange={(v) => setDraft({ ...draft, isDefault: v })} />
          <Toggle label="Available" description="Retired plans keep their current accounts but can't be picked for anyone else." checked={draft.active !== false} onChange={(v) => setDraft({ ...draft, active: v })} />
        </fieldset>
      </Card>
      <Card title="What users get">
        <div className="adm-plan-preview">
          <strong>{draft.name || "Plan name"}</strong>
          <span className="adm-plan-price">{displayedPrice === undefined ? "Loading" : displayedPrice ? fmt.cents(displayedPrice) : "Free"}<small>{displayedPrice ? " / month" : ""}</small></span>
          {priceMode === "auto" && autoPrice ? <p className="adm-help">{fmt.usd(autoPrice.costCents / 100)} provider cost + {autoPrice.margin}% margin, rounded up</p> : null}
          <p>{draft.description || "Description"}</p>
          <ul>
            <li>{fmt.tokens(draft.monthlyTokens)} tokens every month</li>
            {draft.featuresText.split("\n").filter((f) => f.trim()).map((f) => <li key={f}>{f}</li>)}
          </ul>
        </div>
      </Card>
    </div>
  );
}

function BulkTab({ plan, subscribers, canEdit, onDone }: { plan: Plan; subscribers: number; canEdit: boolean; onDone: () => void }) {
  const plans = useAdminQuery<{ plans: Plan[] }>("/api/admin/billing/plans");
  const [grant, setGrant] = useState({ tokens: "", note: "" });
  const [move, setMove] = useState({ toPlanId: "", note: "" });
  const [confirm, setConfirm] = useState<"" | "grant" | "move">("");
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const body = confirm === "grant" ? { action: "grant", tokens: Number(grant.tokens), note: grant.note } : { action: "move", toPlanId: move.toPlanId, note: move.note };
      const result = await adminFetch<{ affected: number }>(`/api/admin/billing/plans/${plan.id}/bulk`, { method: "POST", body });
      toast.success(`Done. ${fmt.number(result.affected)} accounts updated.`);
      setConfirm("");
      setGrant({ tokens: "", note: "" });
      setMove({ toPlanId: "", note: "" });
      onDone();
    } catch (error) {
      toast.error(error);
    } finally {
      setBusy(false);
    }
  };
  const target = plans.data?.plans.find((p) => p.id === move.toPlanId);
  if (!canEdit) return <Card><p className="adm-help">Only admins with billing access can run bulk actions.</p></Card>;
  return (
    <>
      <div className="adm-grid is-2">
        <Card title={`Give tokens to all ${fmt.number(subscribers)} accounts`}>
          <p className="adm-help">Adds bonus tokens to every account on {plan.name}. Use a negative number to remove. Each account gets its own ledger entry.</p>
          <div className="adm-form-grid">
            <Field label="Tokens per account">{(id) => <input id={id} className="adm-input" inputMode="numeric" value={grant.tokens} onChange={(e) => setGrant({ ...grant, tokens: e.target.value.replace(/[^\d-]/g, "") })} placeholder="250000" />}</Field>
            <Field label="Reason">{(id) => <input id={id} className="adm-input" value={grant.note} onChange={(e) => setGrant({ ...grant, note: e.target.value })} placeholder="e.g. Sorry for Tuesday's outage" />}</Field>
            <Button variant="primary" disabled={!Number(grant.tokens) || !grant.note.trim() || !subscribers} onClick={() => setConfirm("grant")}>Review and apply</Button>
          </div>
        </Card>
        <Card title="Move everyone to another plan">
          <p className="adm-help">Moves every account on {plan.name} and starts a fresh period with the new plan's allowance. Useful before retiring a plan.</p>
          <div className="adm-form-grid">
            <Field label="Move to">
              {(id) => (
                <select id={id} className="adm-select" value={move.toPlanId} onChange={(e) => setMove({ ...move, toPlanId: e.target.value })}>
                  <option value="">Choose a plan</option>
                  {(plans.data?.plans || []).filter((p) => p.id !== plan.id).map((p) => <option key={p.id} value={p.id}>{p.name} · {fmt.tokens(p.monthlyTokens)}/mo{p.active ? "" : " (retired)"}</option>)}
                </select>
              )}
            </Field>
            <Field label="Reason">{(id) => <input id={id} className="adm-input" value={move.note} onChange={(e) => setMove({ ...move, note: e.target.value })} placeholder="e.g. Retiring the Studio plan" />}</Field>
            <Button variant="danger" disabled={!move.toPlanId || !move.note.trim() || !subscribers} onClick={() => setConfirm("move")}>Review and move</Button>
          </div>
        </Card>
      </div>
      <Modal
        open={Boolean(confirm)}
        onClose={() => setConfirm("")}
        title="This changes many accounts at once"
        actions={<><Button onClick={() => setConfirm("")}>Cancel</Button><Button variant={confirm === "move" ? "danger" : "primary"} loading={busy} onClick={run}>Apply to {fmt.number(subscribers)} accounts</Button></>}
      >
        {confirm === "grant"
          ? <p>Every account on {plan.name} gets {Number(grant.tokens) > 0 ? "+" : ""}{fmt.number(grant.tokens)} bonus tokens, recorded as "{grant.note}".</p>
          : <p>Every account on {plan.name} moves to {target?.name}, and their allowance resets to {fmt.tokens(target?.monthlyTokens)} tokens today. Bonus tokens are kept.</p>}
      </Modal>
    </>
  );
}
