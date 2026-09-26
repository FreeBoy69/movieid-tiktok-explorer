import { creditsToTokens } from "../src/utils/credits.js";

const DEFAULT_BACKEND_ID = "32f0868d386a15ec19705ef0";

export const LINGBASE_PRICES = Object.freeze({
  creator: { month: { id: "price_f3d82ebb86262d8fe5a0ccb1", cents: 1900 }, year: { id: "price_dc2a28f70877b56703c1e94c", cents: 20599 } },
  pro: { month: { id: "price_ab4fc8d4becb806f310ae583", cents: 5900 }, year: { id: "price_0cbb5761b12aa720138125eb", cents: 63799 } },
  studio: { month: { id: "price_36917dfd6504be90b4acd5ca", cents: 18900 }, year: { id: "price_aa9139723c591ecbc037dd88", cents: 204199 } },
});

// One-time credit bundles. Price IDs are filled from the live LingBase catalog by
// matching USD amount (and optional env overrides). Amounts keep the same unit
// economics as the original packs: at full use, provider cost is 40% of price.
export const LINGBASE_PACKS = Object.freeze([
  { id: "pack_40k", name: "Starter", credits: 40000, cents: 1000, blurb: "Top up for a few more clips" },
  { id: "pack_100k", name: "Standard", credits: 100000, cents: 2500, blurb: "Most popular top-up" },
  { id: "pack_200k", name: "Studio", credits: 200000, cents: 5000, blurb: "For a heavy production week" },
]);

export function lingbasePrice(planId, interval) {
  return LINGBASE_PRICES[planId]?.[interval] || null;
}

export function lingbasePack(packId) {
  const pack = LINGBASE_PACKS.find((entry) => entry.id === packId);
  return pack ? { ...pack, creditsTokens: creditsToTokens(pack.credits) } : null;
}

export function lingbasePriceFromId(priceId) {
  for (const [planId, intervals] of Object.entries(LINGBASE_PRICES)) {
    for (const [interval, price] of Object.entries(intervals)) {
      if (price.id === priceId) return { kind: "plan", planId, interval, ...price };
    }
  }
  return null;
}

export function lingbasePackFromId(priceId, packs = LINGBASE_PACKS) {
  const pack = packs.find((entry) => entry.priceId === priceId);
  return pack ? { kind: "credits", ...pack, creditsTokens: creditsToTokens(pack.credits) } : null;
}

export function lingbaseConfigured(env = process.env) {
  return Boolean(String(env.LINGCODE_ANON_KEY || "").trim() && String(env.LINGCODE_BACKEND_ID || DEFAULT_BACKEND_ID).trim());
}

export function lingbaseConfig(env = process.env) {
  const backendId = String(env.LINGCODE_BACKEND_ID || DEFAULT_BACKEND_ID).trim();
  const url = String(env.LINGCODE_GATEWAY_URL || `https://lingcode.dev/api/cloud/be/${backendId}`).replace(/\/+$/, "");
  if (new URL(url).protocol !== "https:") throw new Error("LingBase must use HTTPS.");
  return { url, anonKey: String(env.LINGCODE_ANON_KEY || "").trim(), prices: LINGBASE_PRICES, packs: LINGBASE_PACKS };
}

/** Attach live Stripe price ids from the LingBase catalog (and env overrides). */
export function resolveLingbasePacks(catalog = [], env = process.env) {
  const oneTime = [];
  for (const product of Array.isArray(catalog) ? catalog : []) {
    for (const price of product.prices || []) {
      if (!price?.active || String(price.currency || "").toLowerCase() !== "usd") continue;
      if (price.interval) continue;
      oneTime.push({ id: String(price.id), cents: Number(price.unit_amount) });
    }
  }
  return LINGBASE_PACKS.map((pack) => {
    const envKey = `LINGBASE_PACK_${pack.id.replace(/^pack_/, "").toUpperCase()}_PRICE_ID`;
    const fromEnv = String(env[envKey] || "").trim();
    const fromCatalog = oneTime.find((price) => price.cents === pack.cents)?.id || "";
    const priceId = fromEnv || fromCatalog || "";
    return { ...pack, priceId, creditsTokens: creditsToTokens(pack.credits), available: Boolean(priceId) };
  });
}

function claims(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3 || !parts[1]) throw new Error("Connect your LingCloud account first.");
  try { return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")); }
  catch { throw new Error("The LingCloud session is invalid."); }
}

export function verifiedLingbaseIdentity(token, email) {
  // Call only after LingBase accepted this JWT on an authenticated endpoint.
  const user = claims(token);
  if (!user.sub || String(user.email || "").trim().toLowerCase() !== String(email || "").trim().toLowerCase()) {
    throw Object.assign(new Error("Use the same Google account for AutoYT and LingCloud payments."), { statusCode: 403 });
  }
  return { id: String(user.sub), email: String(user.email).toLowerCase() };
}

export function normalizeLingbaseOrder(order, packs = LINGBASE_PACKS) {
  const priceId = order.price_id || order.priceId || order.price?.id || order.items?.[0]?.price_id || order.line_items?.[0]?.price?.id;
  const id = String(priceId || "");
  const plan = lingbasePriceFromId(id);
  const pack = plan ? null : lingbasePackFromId(id, packs);
  return {
    id: String(order.id || ""),
    price: plan || pack,
    status: String(order.status || "").toLowerCase(),
    amountCents: Number(order.amount_total ?? order.amount_cents ?? order.amount ?? 0),
    currency: String(order.currency || "").toUpperCase(),
    createdAt: String(order.created_at || order.createdAt || ""),
  };
}

export function createLingbasePayments(env = process.env, fetchImpl = fetch) {
  const { url, anonKey } = lingbaseConfig(env);
  async function request(route, { token, body } = {}) {
    const response = await fetchImpl(`${url}/payments/${route}`, {
      method: body ? "POST" : "GET",
      headers: { Authorization: `Bearer ${token || anonKey}`, "X-LingCode-Key": anonKey, "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(15000),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) {
      const error = new Error(String(payload.message || payload.error || "LingBase payments are unavailable."));
      error.statusCode = response.status >= 400 && response.status < 500 ? response.status : 502;
      throw error;
    }
    return payload.data ?? payload;
  }
  return {
    catalog: () => request("catalog"),
    orders: async (token) => {
      const value = await request("orders", { token });
      return Array.isArray(value) ? value : value.orders || [];
    },
    subscriptions: async (token) => {
      const value = await request("subscriptions", { token });
      return Array.isArray(value) ? value : value.subscriptions || [];
    },
    checkout: (token, priceId, successUrl, cancelUrl) => request("checkout", { token, body: { price_id: priceId, success_url: successUrl, cancel_url: cancelUrl } }),
    portal: (token, returnUrl) => request("portal", { token, body: { return_url: returnUrl } }),
  };
}
