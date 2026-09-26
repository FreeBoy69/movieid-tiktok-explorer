import { useEffect, useState } from "react";
import { ArrowRight, Plus, Wallet } from "lucide-react";
import { adminFetch, can, fmt } from "../api";
import { toast } from "../../utils/toast";
import { Badge, Button, Card, DataTable, Empty, Field, Guarded, Page, Pager, Person, Segmented, Stat, useAdminQuery } from "../ui";
import type { PageProps } from "../AdminApp";
import { PlanDetailPage } from "./PlanDetailPage";
import { ProviderPricesPage } from "./ProviderPricesPage";
import { previewPrice, type BillingSettings } from "../pricing";
import { creditsToTokens, tokensToCredits } from "../../utils/credits.js";

export type Economics = { costCents: number; suggestedPriceCents: number; marginPercent: number; profitCents: number; effectiveMarginPercent: number | null };
type Plan = { id: string; name: string; description: string; priceCents: number; monthlyTokens: number; features: string[]; isDefault: boolean; active: boolean; sort: number; subscribers: number; priceMode: "auto" | "manual"; marginPercent: number | null; economics: Economics; usage30d: { providerCostUsd: number; calls: number; estimatedCalls: number } };
type Summary = { byPlan: Array<{ id: string; name: string; priceCents: number; subscribers: number; mrrCents: number }>; collected30dCents: number; payments30d: number; providerCost30dUsd: number; estimatedProviderCost30dUsd: number; granted30d: number; unlimitedAccounts: number; outOfTokens: number; pastDue: number };
type LedgerEntry = { id: string; userId: string; email: string; name: string; kind: string; tokens: number; balanceAfter: number; actor: string; note: string; createdAt: string };
type PaymentOrder = { reference: string; userId: string; email: string; name: string; kind: "plan" | "credits"; planName: string | null; creditsTokens: number; amountCents: number; currency: string; status: string; createdAt: string; paidAt: string | null };

export function BillingPage(props: PageProps) {
  if (props.route.id === "prices") return <ProviderPricesPage {...props} />;
  return props.route.id ? <PlanDetailPage {...props} /> : <BillingOverview {...props} />;
}

function BillingOverview({ admin, navigate }: PageProps) {
  const summary = useAdminQuery<Summary>("/api/admin/billing/summary");
  const plans = useAdminQuery<{ plans: Plan[] }>("/api/admin/billing/plans");
  const settings = useAdminQuery<{ billing: BillingSettings }>("/api/admin/settings");
  const [kind, setKind] = useState("");
  const [offset, setOffset] = useState(0);
  const ledger = useAdminQuery<{ entries: LedgerEntry[] }>(`/api/admin/billing/ledger?kind=${kind}&offset=${offset}&limit=25`);
  const [paymentStatus, setPaymentStatus] = useState("");
  const [paymentOffset, setPaymentOffset] = useState(0);
  const orders = useAdminQuery<{ orders: PaymentOrder[] }>(`/api/admin/billing/orders?status=${paymentStatus}&offset=${paymentOffset}&limit=25`);
  const manage = can(admin, "billing.manage");

  return (
    <Page
      title="Billing"
      description="Plans, credit allowances, and provider spend."
      actions={<>
        <Button onClick={() => navigate("/admin/billing/prices")}>Provider prices <ArrowRight size={15} aria-hidden="true" /></Button>
        {manage ? <Button variant="primary" onClick={() => navigate("/admin/billing/new")}><Plus size={15} aria-hidden="true" /> New plan</Button> : null}
      </>}
    >
      <div className="adm-banner">
        <Wallet size={17} aria-hidden="true" />
        <span><strong>Paystack checkout.</strong> USD card payments and credit packs activate after the merchant key and webhook are configured. Paid plans require a new payment each month.</span>
      </div>

      <Guarded query={settings} label="Loading pricing">
        {({ billing }) => <PricingModel initial={billing} canEdit={can(admin, "settings.manage")} onSaved={() => { settings.reload(); plans.reload(); summary.reload(); }} />}
      </Guarded>

      <Guarded query={summary} label="Loading billing">
        {(s) => {
          const mrr = s.byPlan.reduce((sum, p) => sum + Number(p.mrrCents), 0);
          const paid = s.byPlan.filter((p) => p.priceCents > 0).reduce((sum, p) => sum + Number(p.subscribers), 0);
          const spend = Number(s.providerCost30dUsd) || 0;
          const difference = (Number(s.collected30dCents) || 0) / 100 - spend;
          return (
            <div className="adm-stats is-4">
              <Stat label="Verified charges · 30d" value={fmt.cents(s.collected30dCents)} hint={`${fmt.number(s.payments30d)} Paystack payments · before refunds and fees`} />
              <Stat label="AI provider spend · 30d" value={fmt.usd(spend)} hint={Number(s.estimatedProviderCost30dUsd) ? `${fmt.usd(s.estimatedProviderCost30dUsd)} estimated` : "Provider-reported costs"} />
              <Stat label="Difference · 30d" value={`${difference < 0 ? "−" : ""}${fmt.usd(Math.abs(difference))}`} hint="Before payment fees, servers, and refunds" />
              <Stat label="Listed monthly plan value" value={fmt.cents(mrr)} hint={`${fmt.number(paid)} paid-plan accounts`} />
            </div>
          );
        }}
      </Guarded>

      <Card title="Plan economics" flush>
        <Guarded query={plans} label="Loading plans">
          {({ plans: rows }) => (
            <DataTable
              rowKey={(p) => p.id}
              rows={rows}
              onRowClick={(p) => navigate(`/admin/billing/${p.id}`)}
              columns={[
                { key: "name", label: "Plan", render: (p) => <span className="adm-list-main"><strong className="adm-inline">{p.name}{p.isDefault ? <Badge tone="accent">Default</Badge> : null}{p.active ? null : <Badge tone="neutral">Retired</Badge>}</strong><small>{p.description}</small></span> },
                { key: "tokens", label: "Credits / month", align: "right", render: (p) => fmt.credits(p.monthlyTokens) },
                { key: "cost", label: "Full use cost", align: "right", render: (p) => <span title="Modeled provider cost if every included credit is used">{fmt.usd(p.economics.costCents / 100)}</span> },
                { key: "spent", label: "Spent · 30d", align: "right", render: (p) => <span title={`${p.usage30d.calls} calls; ${p.usage30d.estimatedCalls} costs estimated`}>{fmt.usd(Number(p.usage30d.providerCostUsd) || 0)}{Number(p.usage30d.estimatedCalls) ? "*" : ""}</span> },
                { key: "price", label: "Price", align: "right", render: (p) => <span className="adm-list-main is-right"><strong>{p.priceCents ? `${fmt.cents(p.priceCents)}/mo` : "Free"}</strong><small>{p.priceMode === "auto" ? `auto · ${p.economics.marginPercent}% margin` : "set by hand"}</small></span> },
                { key: "floor", label: "Target floor", align: "right", render: (p) => p.priceCents ? <span title="Full allowance cost divided by 0.4: 50% target gross margin and 10% reserve for other variable costs">{fmt.cents(Math.ceil(p.economics.costCents / 0.4))}/mo</span> : "—" },
                { key: "subs", label: "Accounts", align: "right", render: (p) => fmt.number(p.subscribers) },
              ]}
            />
          )}
        </Guarded>
        <p className="adm-help adm-plan-note">Target floor assumes full credit use, a 50% margin goal, and 10% of revenue for other variable costs. Spend uses each account’s current plan; * includes estimated provider costs. No prices change automatically.</p>
      </Card>

      <Card title="Payments" flush action={<Segmented label="Payment status" value={paymentStatus} onChange={(value) => { setPaymentStatus(value); setPaymentOffset(0); }} options={[{ value: "", label: "All" }, { value: "paid", label: "Paid" }, { value: "pending", label: "Pending" }]} />}>
        <Guarded query={orders} label="Loading payments">
          {({ orders: rows }) => <>
            <DataTable rowKey={(order) => order.reference} rows={rows} onRowClick={(order) => navigate(`/admin/users/${order.userId}`)} empty={<Empty title="No payments yet">Verified Paystack transactions appear here.</Empty>} columns={[
              { key: "buyer", label: "Customer", render: (order) => <Person name={order.name} email={order.email} /> },
              { key: "item", label: "Purchase", render: (order) => order.kind === "plan" ? `${order.planName || "Plan"} · one month` : `${fmt.credits(order.creditsTokens)} credits` },
              { key: "amount", label: "Amount", align: "right", render: (order) => `${fmt.cents(order.amountCents)} ${order.currency}` },
              { key: "status", label: "Status", render: (order) => <Badge tone={order.status === "paid" ? "good" : "neutral"}>{order.status}</Badge> },
              { key: "date", label: "Date", render: (order) => <span className="adm-muted">{fmt.dateTime(order.paidAt || order.createdAt)}</span> },
            ]} />
            <Pager offset={paymentOffset} limit={25} count={rows.length} onChange={setPaymentOffset} />
          </>}
        </Guarded>
      </Card>

      <Card title="Credit ledger" flush action={
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
                  { key: "tokens", label: "Credits", align: "right", render: (e) => <span className={e.tokens < 0 ? "adm-bad-text" : "adm-good-text"}>{e.tokens > 0 ? "+" : ""}{fmt.credits(e.tokens)}</span> },
                  { key: "when", label: "When", render: (e) => <span className="adm-muted">{fmt.dateTime(e.createdAt)}</span> },
                ]}
              />
              <Pager offset={offset} limit={25} count={entries.length} onChange={setOffset} />
            </>
          )}
        </Guarded>
      </Card>
    </Page>
  );
}

export function ProfitCell({ economics, priceCents }: { economics: Economics; priceCents: number }) {
  if (!priceCents) return <span className="adm-list-main is-right"><span className="adm-bad-text">−{fmt.usd(economics.costCents / 100)}</span><small>free plan cost</small></span>;
  const loss = economics.profitCents < 0;
  return (
    <span className="adm-list-main is-right">
      <strong className={loss ? "adm-bad-text" : "adm-good-text"}>{loss ? "−" : "+"}{fmt.usd(Math.abs(economics.profitCents) / 100)}</strong>
      <small>{economics.effectiveMarginPercent === null ? "—" : `${economics.effectiveMarginPercent}% over cost`}</small>
    </span>
  );
}

const ROUNDING: Array<{ value: BillingSettings["priceRounding"]; label: string }> = [
  { value: "ninety_nine", label: "$12.99" },
  { value: "whole", label: "$13" },
  { value: "cents", label: "Exact" },
];

// The pricing model in one card: credit value, margin, rounding, and a worked example.
function PricingModel({ initial, canEdit, onSaved }: { initial: BillingSettings; canEdit: boolean; onSaved: () => void }) {
  const [draft, setDraft] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [example, setExample] = useState(8000000);
  useEffect(() => setDraft(initial), [initial]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const valid = Number(draft.tokensPerUsd) >= 1000 && Number(draft.profitMarginPercent) >= 0;
  const preview = previewPrice(example, { ...draft, tokensPerUsd: Number(draft.tokensPerUsd) || 1, profitMarginPercent: Number(draft.profitMarginPercent) || 0 });
  const save = async () => {
    setSaving(true);
    try {
      const result = await adminFetch<{ repriced: Array<{ id: string; from: number; to: number }> }>("/api/admin/settings/billing", {
        method: "PUT",
        body: { ...draft, tokensPerUsd: Number(draft.tokensPerUsd), profitMarginPercent: Number(draft.profitMarginPercent), inputUsdPer1M: Number(draft.inputUsdPer1M), outputUsdPer1M: Number(draft.outputUsdPer1M) },
      });
      toast.success(result.repriced?.length ? `Saved. ${result.repriced.length} auto-priced plan${result.repriced.length === 1 ? "" : "s"} repriced.` : "Saved. New AI calls use it right away.");
      onSaved();
    } catch (error) {
      toast.error(error);
    } finally {
      setSaving(false);
    }
  };
  const perToken = 1 / (Number(draft.tokensPerUsd) || 1);
  return (
    <Card title="How prices work" action={canEdit ? <Button variant="primary" disabled={!dirty || !valid} loading={saving} onClick={save}>Save pricing</Button> : null}>
      <div className="adm-pricing">
        <ol className="adm-formula">
          <li>
            <span className="adm-formula-step">1</span>
            <div>
              <strong>Every AI call is charged at its real provider cost.</strong>
              <p>Every 100 internal tokens = 1 customer credit. Cheap models use few credits, expensive ones many.</p>
            </div>
          </li>
          <li>
            <span className="adm-formula-step">2</span>
            <div>
              <strong>A plan's price is the provider cost of its credits, plus profit.</strong>
              <p>Because credits are measured from provider cost, the margin holds whichever providers a customer uses.</p>
            </div>
          </li>
        </ol>
        <fieldset className="adm-form-grid is-3" disabled={!canEdit}>
          <Field label="Internal tokens per $1 of provider cost" hint={`1 credit = 100 tokens · 1 token = $${perToken.toPrecision(2)}`}>
            {(id) => <input id={id} className="adm-input" inputMode="numeric" value={String(draft.tokensPerUsd)} onChange={(e) => setDraft({ ...draft, tokensPerUsd: Number(e.target.value.replace(/\D/g, "")) })} />}
          </Field>
          <Field label="Profit margin" hint="Added on top of provider cost">
            {(id) => (
              <div className="adm-suffix">
                <input id={id} className="adm-input" inputMode="decimal" value={String(draft.profitMarginPercent)} onChange={(e) => setDraft({ ...draft, profitMarginPercent: Number(e.target.value.replace(/[^\d.]/g, "")) })} />
                <span>%</span>
              </div>
            )}
          </Field>
          <Field label="Round prices up to">
            {() => <Segmented label="Rounding" value={draft.priceRounding} onChange={(v) => setDraft({ ...draft, priceRounding: v })} options={ROUNDING} />}
          </Field>
        </fieldset>
        <div className="adm-example">
          <span className="adm-muted">Example: a plan with</span>
          <select className="adm-select adm-select-sm" value={example} onChange={(e) => setExample(Number(e.target.value))} aria-label="Example allowance">
            {[1000000, 5000000, 8000000, 25000000, 80000000].map((t) => <option key={t} value={t}>{fmt.credits(t)} credits</option>)}
          </select>
          <span className="adm-example-math">
            <span><small>provider cost</small>{fmt.usd(preview.costCents / 100)}</span>
            <b>+</b>
            <span><small>{preview.margin}% profit</small>{fmt.usd((preview.costCents * preview.margin) / 10000)}</span>
            <b>→</b>
            <span className="is-total"><small>price</small>{fmt.cents(preview.priceCents)}/mo</span>
            <span className="adm-good-text"><small>you keep</small>{fmt.usd(preview.profitCents / 100)}</span>
          </span>
        </div>
        <details className="adm-details">
          <summary>Fallback prices when a model's price is unknown</summary>
          <fieldset className="adm-form-grid is-2" disabled={!canEdit}>
            <Field label="Input $ per 1M tokens">{(id) => <input id={id} className="adm-input" inputMode="decimal" value={String(draft.inputUsdPer1M)} onChange={(e) => setDraft({ ...draft, inputUsdPer1M: Number(e.target.value.replace(/[^\d.]/g, "")) })} />}</Field>
            <Field label="Output $ per 1M tokens">{(id) => <input id={id} className="adm-input" inputMode="decimal" value={String(draft.outputUsdPer1M)} onChange={(e) => setDraft({ ...draft, outputUsdPer1M: Number(e.target.value.replace(/[^\d.]/g, "")) })} />}</Field>
            {Object.entries(draft.flatTokens).map(([op, value]) => (
              <Field key={op} label={`${op[0].toUpperCase()}${op.slice(1)}, per item (credits)`} hint={`= ${fmt.usd(value / (Number(draft.tokensPerUsd) || 1))} provider cost`}>
                {(id) => <input id={id} className="adm-input" inputMode="numeric" value={String(tokensToCredits(value))} onChange={(e) => setDraft({ ...draft, flatTokens: { ...draft.flatTokens, [op]: creditsToTokens(Number(e.target.value.replace(/\D/g, ""))) } })} />}
              </Field>
            ))}
          </fieldset>
        </details>
      </div>
    </Card>
  );
}
