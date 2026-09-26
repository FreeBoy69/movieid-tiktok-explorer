import { describe, expect, it, vi } from "vitest";
import { createLingbasePayments, lingbasePack, lingbasePrice, lingbasePriceFromId, normalizeLingbaseOrder, readLingbaseCheckout, resolveLingbasePacks, verifiedLingbaseIdentity } from "./lingbaseBilling.js";

const env = { LINGCODE_BACKEND_ID: "backend", LINGCODE_ANON_KEY: "public-anon" };
const token = `head.${Buffer.from(JSON.stringify({ sub: "ling-user", email: "USER@example.com" })).toString("base64url")}.sig`;

describe("LingBase billing", () => {
  it("maps only the six approved recurring prices", () => {
    expect(lingbasePrice("creator", "month")).toEqual({ id: "price_f3d82ebb86262d8fe5a0ccb1", cents: 1900 });
    expect(lingbasePriceFromId("price_aa9139723c591ecbc037dd88")).toMatchObject({ kind: "plan", planId: "studio", interval: "year", cents: 204199 });
    expect(lingbasePriceFromId("fake-price")).toBeNull();
  });

  it("quotes credit bundles with the same 40% provider-cost economics", () => {
    expect(lingbasePack("pack_100k")).toMatchObject({ credits: 100000, cents: 2500, creditsTokens: 10000000 });
  });

  it("resolves one-time pack price ids from the LingBase catalog", () => {
    const packs = resolveLingbasePacks([
      { prices: [{ id: "price_pack_25", unit_amount: 2500, currency: "usd", active: true }] },
    ], {});
    expect(packs.find((pack) => pack.id === "pack_100k")).toMatchObject({ priceId: "price_pack_25", available: true });
    expect(packs.find((pack) => pack.id === "pack_40k")?.available).toBe(false);
  });

  it("matches the verified LingCloud email to the AutoYT user", () => {
    expect(verifiedLingbaseIdentity(token, "user@example.com")).toEqual({ id: "ling-user", email: "user@example.com" });
    expect(() => verifiedLingbaseIdentity(token, "other@example.com")).toThrow(/same Google account/);
  });

  it("accepts the documented paid-order shape for plans and packs", () => {
    expect(normalizeLingbaseOrder({ id: "ord_1", price_id: "price_f3d82ebb86262d8fe5a0ccb1", status: "paid", amount_total: 1900, currency: "usd", created_at: "2026-09-26T12:00:00Z" })).toMatchObject({
      id: "ord_1", status: "paid", amountCents: 1900, currency: "USD", price: { kind: "plan", planId: "creator", interval: "month" },
    });
    const packs = resolveLingbasePacks([{ prices: [{ id: "price_pack_10", unit_amount: 1000, currency: "usd", active: true }] }], {});
    expect(normalizeLingbaseOrder({ id: "ord_2", price_id: "price_pack_10", status: "paid", amount_total: 1000, currency: "usd", created_at: "2026-09-26T12:00:00Z" }, packs)).toMatchObject({
      price: { kind: "credits", id: "pack_40k", cents: 1000 },
    });
  });

  it("sends the catalog price ID to LingBase and never a client amount", async () => {
    const fetcher = vi.fn(async (_url, options) => ({ ok: true, json: async () => ({ ok: true, data: { url: "https://checkout.stripe.com/test" } }) }));
    const client = createLingbasePayments(env, fetcher as any);
    await client.checkout(token, "price_f3d82ebb86262d8fe5a0ccb1", "https://autoyt.cc/?billing_return=1", "https://autoyt.cc/?billing_cancel=1");
    const [url, options] = fetcher.mock.calls[0] as any[];
    expect(url).toBe("https://lingcode.dev/api/cloud/be/backend/payments/checkout");
    expect(options.headers.Authorization).toBe(`Bearer ${token}`);
    expect(JSON.parse(options.body)).toEqual({
      price_id: "price_f3d82ebb86262d8fe5a0ccb1",
      success_url: "https://autoyt.cc/?billing_return=1",
      cancel_url: "https://autoyt.cc/?billing_cancel=1",
      return_url: "https://autoyt.cc/?billing_return=1",
      ui_mode: "embedded_page",
    });
  });

  it("reads an embedded Checkout client secret and the publishable key inside it", () => {
    const payload = Buffer.from(JSON.stringify({ apiKey: "pk_test_embedded", uiMode: "embedded_page" })).toString("base64url");
    expect(readLingbaseCheckout({
      client_secret: `cs_test_session_secret_${payload}`,
      id: "cs_test_session",
    })).toMatchObject({ clientSecret: `cs_test_session_secret_${payload}`, publishableKey: "pk_test_embedded", sessionId: "cs_test_session" });
  });
});
