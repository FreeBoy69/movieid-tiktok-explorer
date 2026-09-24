import { useState } from "react";
import { Plus, Wallet } from "lucide-react";
import { adminFetch, can, fmt } from "../api";
import { toast } from "../../utils/toast";
import { Badge, Button, Card, DataTable, Drawer, Empty, Field, Guarded, Page, Pager, Person, Segmented, Stat, Toggle, useAdminQuery } from "../ui";
import type { PageProps } from "../AdminApp";

type Plan = { id: string; name: string; description: string; priceCents: number; monthlyTokens: number; features: string[]; isDefault: boolean; active: boolean; sort: number; subscribers: number };
type Summary = { byPlan: Array<{ id: string; name: string; priceCents: number; subscribers: number; mrrCents: number }>; granted30d: number; unlimitedAccounts: number; outOfTokens: number; pastDue: number };
type BillingSettings = { tokensPerUsd: number; markup: number; inputUsdPer1M: number; outputUsdPer1M: number; flatTokens: Record<string, number>; paymentProvider: string };
type LedgerEntry = { id: string; userId: string; email: string; name: string; kind: string; tokens: number; balanceAfter: number; actor: string; note: string; createdAt: string };

export function BillingPage({ admin, navigate }: PageProps) {
  const summary = useAdminQuery<Summary>("/api/admin/billing/summary");
  const plans = useAdminQuery<{ plans: Plan[] }>("/api/admin/billing/plans");
  const settings = useAdminQuery<{ billing: BillingSettings }>("/api/admin/settings");
  const [editing, setEditing] = useState<Partial<Plan> | null>(null);
  const [kind, setKind] = useState("");
  const [offset, setOffset] = useState(0);
  const ledger = useAdminQuery<{ entries: LedgerEntry[] }>(`/api/admin/billing/ledger?kind=${kind}&offset=${offset}&limit=25`);
  const manage = can(admin, "billing.manage");

  return (
    <Page
      title="Billing"
      description="Plans, token allowances and every change to a balance."
      actions={manage ? <Button variant="primary" onClick={() => setEditing({ active: true, features: [], sort: (plans.data?.plans.length || 0) })}><Plus size={15} aria-hidden="true" /> New plan</Button> : null}
    >
      <div className="adm-banner">
        <Wallet size={17} aria-hidden="true" />
        <span><strong>Payments aren't connected yet.</strong> Plan changes are manual until Google Pay is set up. Change a user's plan from their profile on the Users page.</span>
      </div>
      <Guarded query={summary} label="Loading billing">
        {(s) => {
          const mrr = s.byPlan.reduce((sum, p) => sum + Number(p.mrrCents), 0);
          const paid = s.byPlan.filter((p) => p.priceCents > 0).reduce((sum, p) => sum + Number(p.subscribers), 0);
          return (
            <div className="adm-stats">
              <Stat label="Plan revenue (MRR)" value={fmt.cents(mrr)} hint={`${fmt.number(paid)} paid accounts`} />
              <Stat label="Out of tokens" value={fmt.number(s.outOfTokens)} hint="blocked from AI until renewal" />
              <Stat label="Tokens granted (30d)" value={fmt.tokens(s.granted30d)} hint="by admins" />
              <Stat label="Unlimited accounts" value={fmt.number(s.unlimitedAccounts)} />
            </div>
          );
        }}
      </Guarded>

      <Card title="Plans" flush>
        <Guarded query={plans} label="Loading plans">
          {({ plans: rows }) => (
            <DataTable
              rowKey={(p) => p.id}
              rows={rows}
              onRowClick={manage ? (p) => setEditing(p) : undefined}
              columns={[
                { key: "name", label: "Plan", render: (p) => <span className="adm-list-main"><strong>{p.name}</strong><small>{p.description}</small></span> },
                { key: "price", label: "Price", align: "right", render: (p) => (p.priceCents ? `${fmt.cents(p.priceCents)}/mo` : "Free") },
                { key: "tokens", label: "Tokens / month", align: "right", render: (p) => fmt.tokens(p.monthlyTokens) },
                { key: "subs", label: "Accounts", align: "right", render: (p) => fmt.number(p.subscribers) },
                { key: "state", label: "", render: (p) => <span className="adm-inline">{p.isDefault ? <Badge tone="accent">Default</Badge> : null}{p.active ? null : <Badge tone="neutral">Retired</Badge>}</span> },
              ]}
            />
          )}
        </Guarded>
      </Card>

      <div className="adm-grid is-2-1">
        <Card title="Token ledger" flush action={
          <Segmented label="Entry type" value={kind} onChange={(value) => { setKind(value); setOffset(0); }} options={[
            { value: "", label: "All" }, { value: "grant", label: "Grants" }, { value: "revoke", label: "Removals" }, { value: "plan_change", label: "Plans" }, { value: "allowance_reset", label: "Renewals" },
          ]} />
        }>
          <Guarded query={ledger} label="Loading ledger">
            {({ entries }) => (
              <>
                <DataTable
                  rowKey={(e) => e.id}
                  rows={entries}
                  onRowClick={(e) => navigate(`/admin/users/${e.userId}`)}
                  empty={<Empty title="No ledger entries">Grants, removals, plan changes and renewals show up here.</Empty>}
                  columns={[
                    { key: "user", label: "User", render: (e) => <Person name={e.name} email={e.email} /> },
                    { key: "what", label: "Change", render: (e) => <span className="adm-list-main"><span>{e.note || e.kind.replace(/_/g, " ")}</span><small>{e.actor}</small></span> },
                    { key: "tokens", label: "Tokens", align: "right", render: (e) => <span className={e.tokens < 0 ? "adm-bad-text" : "adm-good-text"}>{e.tokens > 0 ? "+" : ""}{fmt.tokens(e.tokens)}</span> },
                    { key: "when", label: "When", render: (e) => <span className="adm-muted">{fmt.dateTime(e.createdAt)}</span> },
                  ]}
                />
                <Pager offset={offset} limit={25} count={entries.length} onChange={setOffset} />
              </>
            )}
          </Guarded>
        </Card>
        <Guarded query={settings} label="Loading pricing">
          {({ billing }) => <PricingCard initial={billing} canEdit={can(admin, "settings.manage")} onSaved={settings.reload} />}
        </Guarded>
      </div>

      <PlanDrawer plan={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); plans.reload(); summary.reload(); }} />
    </Page>
  );
}

function PricingCard({ initial, canEdit, onSaved }: { initial: BillingSettings; canEdit: boolean; onSaved: () => void }) {
  const [draft, setDraft] = useState(initial);
  const [saving, setSaving] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const num = (key: keyof BillingSettings) => ({
    value: String(draft[key]),
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => setDraft({ ...draft, [key]: event.target.value }),
  });
  const save = async () => {
    setSaving(true);
    try {
      await adminFetch("/api/admin/settings/billing", { method: "PUT", body: { ...draft, tokensPerUsd: Number(draft.tokensPerUsd), markup: Number(draft.markup), inputUsdPer1M: Number(draft.inputUsdPer1M), outputUsdPer1M: Number(draft.outputUsdPer1M) } });
      toast.success("Pricing saved. New AI calls use it right away.");
      onSaved();
    } catch (error) {
      toast.error(error);
    } finally {
      setSaving(false);
    }
  };
  const perDollar = Number(draft.tokensPerUsd) * Number(draft.markup);
  return (
    <Card title="Token pricing" action={canEdit ? <Button size="sm" variant="primary" disabled={!dirty} loading={saving} onClick={save}>Save</Button> : null}>
      <p className="adm-help">Each AI call is charged its real provider cost × tokens per dollar × markup. Right now $1 of provider cost costs a user <strong>{fmt.tokens(perDollar)}</strong> tokens.</p>
      <fieldset className="adm-form-grid is-2" disabled={!canEdit}>
        <Field label="Tokens per $1">{(id) => <input id={id} className="adm-input" inputMode="numeric" {...num("tokensPerUsd")} />}</Field>
        <Field label="Markup">{(id) => <input id={id} className="adm-input" inputMode="decimal" {...num("markup")} />}</Field>
        <Field label="Input $ per 1M" hint="When a provider reports tokens but no cost">{(id) => <input id={id} className="adm-input" inputMode="decimal" {...num("inputUsdPer1M")} />}</Field>
        <Field label="Output $ per 1M">{(id) => <input id={id} className="adm-input" inputMode="decimal" {...num("outputUsdPer1M")} />}</Field>
      </fieldset>
      <details className="adm-details">
        <summary>Flat rates when a provider reports nothing</summary>
        <fieldset className="adm-form-grid is-2" disabled={!canEdit}>
          {Object.entries(draft.flatTokens).map(([op, value]) => (
            <Field key={op} label={`${op[0].toUpperCase()}${op.slice(1)} (tokens each)`}>
              {(id) => <input id={id} className="adm-input" inputMode="numeric" value={String(value)} onChange={(event) => setDraft({ ...draft, flatTokens: { ...draft.flatTokens, [op]: Number(event.target.value.replace(/\D/g, "")) } })} />}
            </Field>
          ))}
        </fieldset>
      </details>
    </Card>
  );
}

function PlanDrawer({ plan, onClose, onSaved }: { plan: Partial<Plan> | null; onClose: () => void; onSaved: () => void }) {
  const [draft, setDraft] = useState<Partial<Plan> & { featuresText?: string }>({});
  const [saving, setSaving] = useState(false);
  const [lastPlan, setLastPlan] = useState<Partial<Plan> | null>(null);
  if (plan !== lastPlan) {
    setLastPlan(plan);
    setDraft(plan ? { ...plan, featuresText: (plan.features || []).join("\n") } : {});
  }
  const isNew = !plan?.id;
  const save = async () => {
    setSaving(true);
    try {
      await adminFetch("/api/admin/billing/plans", {
        method: "POST",
        body: { ...draft, features: String(draft.featuresText || "").split("\n"), priceCents: Math.round(Number(draft.priceCents) || 0), monthlyTokens: Number(draft.monthlyTokens) || 0 },
      });
      toast.success(isNew ? "Plan created." : "Plan saved.");
      onSaved();
    } catch (error) {
      toast.error(error);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Drawer
      open={Boolean(plan)}
      onClose={onClose}
      title={isNew ? "New plan" : `Edit ${plan?.name}`}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={saving} disabled={!draft.id || !draft.name} onClick={save}>{isNew ? "Create plan" : "Save plan"}</Button></>}
    >
      <div className="adm-form-grid">
        <Field label="Plan id" hint={isNew ? "Lowercase, no spaces. Can't be changed later." : undefined}>
          {(id) => <input id={id} className="adm-input" value={draft.id || ""} disabled={!isNew} onChange={(event) => setDraft({ ...draft, id: event.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "") })} placeholder="e.g. creator" />}
        </Field>
        <Field label="Name">{(id) => <input id={id} className="adm-input" value={draft.name || ""} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />}</Field>
        <Field label="Description">{(id) => <input id={id} className="adm-input" value={draft.description || ""} onChange={(event) => setDraft({ ...draft, description: event.target.value })} />}</Field>
        <div className="adm-form-grid is-2">
          <Field label="Price per month (USD)">
            {(id) => <input id={id} className="adm-input" inputMode="decimal" value={draft.priceCents === undefined ? "" : String(Number(draft.priceCents) / 100)} onChange={(event) => setDraft({ ...draft, priceCents: Math.round(Number(event.target.value.replace(/[^\d.]/g, "")) * 100) })} />}
          </Field>
          <Field label="Tokens per month" hint={draft.monthlyTokens ? fmt.tokens(draft.monthlyTokens) : undefined}>
            {(id) => <input id={id} className="adm-input" inputMode="numeric" value={draft.monthlyTokens === undefined ? "" : String(draft.monthlyTokens)} onChange={(event) => setDraft({ ...draft, monthlyTokens: Number(event.target.value.replace(/\D/g, "")) })} />}
          </Field>
        </div>
        <Field label="Features" hint="One per line. Shown to users when they compare plans.">
          {(id) => <textarea id={id} className="adm-input" rows={4} value={draft.featuresText || ""} onChange={(event) => setDraft({ ...draft, featuresText: event.target.value })} />}
        </Field>
        <Field label="Sort order">{(id) => <input id={id} className="adm-input" inputMode="numeric" value={String(draft.sort ?? 0)} onChange={(event) => setDraft({ ...draft, sort: Number(event.target.value.replace(/\D/g, "")) })} />}</Field>
        <Toggle label="Default for new users" description="Every new sign-up starts on this plan." checked={Boolean(draft.isDefault)} onChange={(value) => setDraft({ ...draft, isDefault: value })} />
        <Toggle label="Available" description="Retired plans keep their current accounts but can't be picked." checked={draft.active !== false} onChange={(value) => setDraft({ ...draft, active: value })} />
      </div>
    </Drawer>
  );
}
