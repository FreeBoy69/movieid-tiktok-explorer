import crypto from "node:crypto";
import { creditsToTokens } from "../src/utils/credits.js";

// Fixed quotes: at full use the provider budget is 40% of the pack price.
export const CREDIT_PACKS = Object.freeze([
  { id: "pack_10", priceCents: 1000, credits: 40000 },
  { id: "pack_25", priceCents: 2500, credits: 100000 },
  { id: "pack_50", priceCents: 5000, credits: 200000 },
]);

export function creditPack(id) {
  const pack = CREDIT_PACKS.find((entry) => entry.id === id);
  return pack ? { ...pack, creditsTokens: creditsToTokens(pack.credits) } : null;
}

export function paystackConfigured(env = process.env) {
  return Boolean(String(env.PAYSTACK_SECRET_KEY || "").trim()) && env.PAYSTACK_WEBHOOK_READY === "1";
}

export function validPaystackWebhook(rawBody, signature, secret) {
  if (!rawBody || !signature || !secret) return false;
  const expected = crypto.createHmac("sha512", secret).update(rawBody).digest("hex");
  const supplied = String(signature).trim().toLowerCase();
  return /^[a-f0-9]{128}$/.test(supplied) && crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(supplied, "hex"));
}

export function verifiedPaystackPayment(transaction, order, email) {
  return transaction?.status === "success"
    && String(transaction.reference) === String(order.reference)
    && Number(transaction.amount) === Number(order.amountCents)
    && String(transaction.currency).toUpperCase() === String(order.currency).toUpperCase()
    && String(transaction.customer?.email || "").trim().toLowerCase() === String(email || "").trim().toLowerCase();
}

export function createPaystackClient(env = process.env, fetcher = fetch) {
  const secret = String(env.PAYSTACK_SECRET_KEY || "").trim();
  const base = String(env.PAYSTACK_API_BASE || "https://api.paystack.co").replace(/\/$/, "");
  async function request(path, options = {}) {
    if (!secret) throw Object.assign(new Error("Paystack is not configured yet."), { statusCode: 503 });
    const response = await fetcher(`${base}${path}`, {
      ...options,
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json", ...options.headers },
      signal: AbortSignal.timeout(15000),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.status) throw Object.assign(new Error("Paystack could not process this request. Please try again."), { statusCode: 502 });
    return body.data;
  }
  return {
    initialize: (payload) => request("/transaction/initialize", { method: "POST", body: JSON.stringify(payload) }),
    verify: (reference) => request(`/transaction/verify/${encodeURIComponent(reference)}`),
  };
}
