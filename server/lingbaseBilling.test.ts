import { describe, expect, it, vi } from "vitest";
import { createLingbasePayments, lingbasePrice, lingbasePriceFromId, normalizeLingbaseOrder, verifiedLingbaseIdentity } from "./lingbaseBilling.js";

const env = { LINGCODE_BACKEND_ID: "backend", LINGCODE_ANON_KEY: "public-anon" };
const token = `head.${Buffer.from(JSON.stringify({ sub: "ling-user", email: "USER@example.com" })).toString("base64url")}.sig`;

describe("LingBase billing", () => {
  it("maps only the six approved recurring prices", () => {
    expect(lingbasePrice("creator", "month")).toEqual({ id: "price_f3d82ebb86262d8fe5a0ccb1", cents: 1900 });
    expect(lingbasePriceFromId("price_aa9139723c591ecbc037dd88")).toMatchObject({ planId: "studio", interval: "year", cents: 204199 });
    expect(lingbasePriceFromId("fake-price")).toBeNull();
  });

  it("matches the verified LingCloud email to the AutoYT user", () => {
    expect(verifiedLingbaseIdentity(token, "user@example.com")).toEqual({ id: "ling-user", email: "user@example.com" });
    expect(() => verifiedLingbaseIdentity(token, "other@example.com")).toThrow(/same Google account/);
  });

  it("accepts the documented paid-order shape", () => {
    expect(normalizeLingbaseOrder({ id: "ord_1", price_id: "price_f3d82ebb86262d8fe5a0ccb1", status: "paid", amount_total: 1900, currency: "usd", created_at: "2026-09-26T12:00:00Z" })).toMatchObject({
      id: "ord_1", status: "paid", amountCents: 1900, currency: "USD", price: { planId: "creator", interval: "month" },
    });
  });

  it("sends the catalog price ID to LingBase and never a client amount", async () => {
    const fetcher = vi.fn(async (_url, options) => ({ ok: true, json: async () => ({ ok: true, data: { url: "https://checkout.stripe.com/test" } }) }));
    const client = createLingbasePayments(env, fetcher as any);
    await client.checkout(token, "price_f3d82ebb86262d8fe5a0ccb1", "https://autoyt.cc/?billing_return=1", "https://autoyt.cc/?billing_cancel=1");
    const [url, options] = fetcher.mock.calls[0] as any[];
    expect(url).toBe("https://lingcode.dev/api/cloud/be/backend/payments/checkout");
    expect(options.headers.Authorization).toBe(`Bearer ${token}`);
    expect(JSON.parse(options.body)).toEqual({ price_id: "price_f3d82ebb86262d8fe5a0ccb1", success_url: "https://autoyt.cc/?billing_return=1", cancel_url: "https://autoyt.cc/?billing_cancel=1" });
  });
});
