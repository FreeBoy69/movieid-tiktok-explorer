// Live per-model prices, so AI calls that don't report their own cost are still
// charged what the provider actually charges us.
//
// OpenRouter publishes every model's per-token and per-request price at
// /api/v1/models (public, no key). Direct-provider model ids ("gemini-3.7-flash",
// "deepseek-v4-flash") are matched to OpenRouter ids by their name after the
// "vendor/" prefix. Admin overrides (billing.modelPrices) always win.

const CATALOG_URL = "https://openrouter.ai/api/v1/models";

const perMillion = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n * 1e6 : null;
};

export function catalogEntry(model) {
  const p = model?.pricing || {};
  return {
    id: String(model?.id || ""),
    inputPer1M: perMillion(p.prompt),
    outputPer1M: perMillion(p.completion),
    perCall: Number(p.request) > 0 ? Number(p.request) : Number(p.image) > 0 ? Number(p.image) : null,
  };
}

// Exact id, then the same id without a ":variant", then a unique "vendor/<model>" match.
export function matchModel(model, entries) {
  const wanted = String(model || "").trim().toLowerCase();
  if (!wanted) return null;
  if (entries.has(wanted)) return entries.get(wanted);
  const base = wanted.split(":")[0];
  if (entries.has(base)) return entries.get(base);
  const name = base.includes("/") ? base.split("/").pop() : base;
  const hits = [...entries.values()].filter((e) => e.id.toLowerCase().split(":")[0].split("/").pop() === name);
  // "google/gemini-3.7-flash" and its ":batch" variant are one model; prefer the plain one.
  const plain = hits.filter((e) => !e.id.includes(":"));
  const unique = plain.length ? plain : hits;
  return unique.length === 1 ? unique[0] : null;
}

export function createPriceCatalog({ fetchImpl = globalThis.fetch, ttlMs = 6 * 3600000 } = {}) {
  const state = { at: 0, entries: new Map(), loading: null, error: "" };
  async function load(force = false) {
    const fresh = Date.now() - state.at < (state.entries.size ? ttlMs : 5 * 60000);
    if (!force && state.at && fresh) return state;
    state.loading ||= (async () => {
      try {
        const response = await fetchImpl(CATALOG_URL, { signal: AbortSignal.timeout(15000) });
        if (!response.ok) throw new Error(`OpenRouter price list returned ${response.status}`);
        const data = await response.json();
        const entries = new Map();
        for (const model of data?.data || []) {
          const entry = catalogEntry(model);
          if (entry.id) entries.set(entry.id.toLowerCase(), entry);
        }
        Object.assign(state, { entries, error: "" });
      } catch (error) {
        state.error = error instanceof Error ? error.message : String(error);
      } finally {
        state.at = Date.now();
        state.loading = null;
      }
    })();
    await state.loading;
    return state;
  }
  return {
    load,
    async lookup(model) {
      await load().catch(() => null);
      return matchModel(model, state.entries);
    },
    status: () => ({ models: state.entries.size, loadedAt: state.at ? new Date(state.at).toISOString() : null, error: state.error }),
  };
}

// The price that applies to one model: admin override, then the live catalog.
export function resolveModelRate(model, overrides = {}, catalogHit = null) {
  const override = overrides?.[model];
  if (override && [override.inputPer1M, override.outputPer1M, override.perCall].some((v) => Number.isFinite(Number(v)) && v !== null && v !== "")) {
    return {
      source: "override", matchedId: catalogHit?.id,
      inputPer1M: num(override.inputPer1M) ?? catalogHit?.inputPer1M ?? null,
      outputPer1M: num(override.outputPer1M) ?? catalogHit?.outputPer1M ?? null,
      perCall: num(override.perCall) ?? catalogHit?.perCall ?? null,
    };
  }
  if (catalogHit) return { source: "openrouter", matchedId: catalogHit.id, inputPer1M: catalogHit.inputPer1M, outputPer1M: catalogHit.outputPer1M, perCall: catalogHit.perCall };
  return null;
}

function num(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
