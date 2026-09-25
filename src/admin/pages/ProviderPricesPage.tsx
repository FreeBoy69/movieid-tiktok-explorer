import { useState } from "react";
import { RefreshCw, Plus } from "lucide-react";
import { adminFetch, can, fmt } from "../api";
import { toast } from "../../utils/toast";
import { BackLink, Badge, Button, Card, DataTable, Empty, Field, Guarded, Modal, Page, useAdminQuery } from "../ui";
import type { PageProps } from "../AdminApp";
import type { BillingSettings } from "../pricing";

type Rate = { inputPer1M: number | null; outputPer1M: number | null; perCall: number | null; source?: string; matchedId?: string };
type ModelRow = {
  provider: string; model: string; calls: number; cost: number; reportedCalls: number; lastAt: string | null;
  catalog: ({ id: string } & Rate) | null; override: Rate | null; multiplier: number; effective: Rate | null;
};
type Prices = {
  models: ModelRow[]; catalog: { models: number; loadedAt: string | null; error: string } | null;
  fallback: { inputPer1M: number; outputPer1M: number }; tokensPerUsd: number;
};
type Draft = { model: string; inputPer1M: string; outputPer1M: string; perCall: string };
const emptyDraft: Draft = { model: "", inputPer1M: "", outputPer1M: "", perCall: "" };

export function ProviderPricesPage({ admin, navigate }: PageProps) {
  const prices = useAdminQuery<Prices>("/api/admin/billing/provider-prices");
  const settings = useAdminQuery<{ billing: BillingSettings }>("/api/admin/settings");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const editable = can(admin, "settings.manage");
  const rows = prices.data?.models || [];
  const edit = (row?: ModelRow) => setDraft(row ? {
    model: row.model, inputPer1M: String(row.override?.inputPer1M ?? ""),
    outputPer1M: String(row.override?.outputPer1M ?? ""), perCall: String(row.override?.perCall ?? ""),
  } : { ...emptyDraft });
  const save = async () => {
    if (!draft || !settings.data) return;
    setSaving(true);
    try {
      const model = draft.model.trim();
      const rates = [draft.inputPer1M, draft.outputPer1M, draft.perCall].map((v) => v.trim() === "" ? null : Number(v));
      if (!model || rates.some((v) => v !== null && (!Number.isFinite(v) || v < 0))) throw new Error("Enter a model and nonnegative prices.");
      const modelPrices = { ...settings.data.billing.modelPrices };
      if (rates.every((v) => v === null)) delete modelPrices[model];
      else modelPrices[model] = { inputPer1M: rates[0], outputPer1M: rates[1], perCall: rates[2] };
      await adminFetch("/api/admin/settings/billing", { method: "PUT", body: { ...settings.data.billing, modelPrices } });
      toast.success(rates.every((v) => v === null) ? "Override removed." : "Model price saved.");
      setDraft(null);
      settings.reload();
      prices.reload();
    } catch (error) { toast.error(error); }
    finally { setSaving(false); }
  };
  const refresh = async () => {
    setRefreshing(true);
    try {
      const result = await adminFetch<{ catalog: { models: number; error: string } }>("/api/admin/billing/provider-prices/refresh", { method: "POST" });
      if (result.catalog.error) throw new Error(result.catalog.error);
      toast.success(`Updated ${fmt.number(result.catalog.models)} catalog prices.`);
      prices.reload();
    } catch (error) { toast.error(error); }
    finally { setRefreshing(false); }
  };
  return (
    <Page title="Provider prices" description="Current model rates and overrides used when a provider does not report the cost of a call." actions={editable ? <>
      <Button onClick={refresh} loading={refreshing}><RefreshCw size={15} aria-hidden="true" /> Refresh catalog</Button>
      <Button variant="primary" onClick={() => edit()}><Plus size={15} aria-hidden="true" /> Add override</Button>
    </> : null}>
      <BackLink label="Billing" onClick={() => navigate("/admin/billing")} />
      {prices.data?.catalog ? <p className="adm-help">OpenRouter catalog: {fmt.number(prices.data.catalog.models)} models{prices.data.catalog.loadedAt ? ` · updated ${fmt.dateTime(prices.data.catalog.loadedAt)}` : ""}{prices.data.catalog.error ? ` · ${prices.data.catalog.error}` : ""}. Direct provider prices may differ; reported cost takes priority.</p> : null}
      <Card title="Models used in the last 90 days" flush>
        <Guarded query={prices} label="Loading provider prices">
          {({ models, fallback }) => <DataTable rowKey={(row) => `${row.provider}:${row.model}`} rows={models}
            empty={<Empty title="No metered models yet">Model prices will appear after AI calls. You can add an override now.</Empty>}
            columns={[
              { key: "model", label: "Model", render: (row) => <span className="adm-list-main"><strong>{row.model || "Unknown model"}</strong><small>{row.provider || row.effective?.source || "Custom"}</small></span> },
              { key: "input", label: "Input / 1M", align: "right", render: (row) => fmt.usd(row.effective?.inputPer1M ?? fallback.inputPer1M) },
              { key: "output", label: "Output / 1M", align: "right", render: (row) => fmt.usd(row.effective?.outputPer1M ?? fallback.outputPer1M) },
              { key: "call", label: "Per call", align: "right", render: (row) => row.effective?.perCall == null ? "—" : fmt.usd(row.effective.perCall) },
              { key: "source", label: "Rate source", render: (row) => <Badge tone={row.override ? "accent" : "neutral"}>{row.override ? "Override" : row.catalog ? "Catalog" : "Fallback"}</Badge> },
              { key: "calls", label: "Calls", align: "right", render: (row) => fmt.number(row.calls) },
              { key: "cost", label: "Provider cost", align: "right", render: (row) => fmt.usd(row.cost) },
              { key: "action", label: "", render: (row) => editable ? <Button size="sm" variant="ghost" onClick={() => edit(row)}>Edit</Button> : null },
            ]} />}
        </Guarded>
      </Card>
      <Modal open={draft !== null} onClose={() => setDraft(null)} title="Model price override" actions={<><Button onClick={() => setDraft(null)}>Cancel</Button><Button variant="primary" loading={saving} disabled={!draft?.model.trim() || !settings.data} onClick={save}>Save price</Button></>}>
        {draft ? <div className="adm-form-grid">
          <Field label="Model id">{(id) => <input id={id} className="adm-input" value={draft.model} onChange={(e) => setDraft({ ...draft, model: e.target.value })} />}</Field>
          <div className="adm-form-grid is-2">
            <Field label="Input USD / 1M tokens">{(id) => <input id={id} className="adm-input" type="number" min="0" step="any" value={draft.inputPer1M} onChange={(e) => setDraft({ ...draft, inputPer1M: e.target.value })} />}</Field>
            <Field label="Output USD / 1M tokens">{(id) => <input id={id} className="adm-input" type="number" min="0" step="any" value={draft.outputPer1M} onChange={(e) => setDraft({ ...draft, outputPer1M: e.target.value })} />}</Field>
          </div>
          <Field label="USD per call" hint="For image and video calls without token counts">{(id) => <input id={id} className="adm-input" type="number" min="0" step="any" value={draft.perCall} onChange={(e) => setDraft({ ...draft, perCall: e.target.value })} />}</Field>
          <p className="adm-help">Leave all prices blank and save to remove an override. Reported provider costs always take priority.</p>
        </div> : null}
      </Modal>
    </Page>
  );
}
