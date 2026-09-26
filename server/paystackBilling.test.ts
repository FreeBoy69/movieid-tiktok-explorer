import crypto from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { creditPack, createPaystackClient, paystackConfigured, validPaystackWebhook, verifiedPaystackPayment } from "./paystackBilling.js";

describe("Paystack billing safety", () => {
  it("quotes fixed credit packs from the server", () => {
    expect(creditPack("pack_25")).toMatchObject({ priceCents: 2500, credits: 100000, creditsTokens: 10000000 });
    expect(creditPack("unknown")).toBeNull();
  });

  it("checks the signed raw webhook body", () => {
    const body = Buffer.from('{"event":"charge.success"}');
    const key = "test_secret";
    const signature = crypto.createHmac("sha512", key).update(body).digest("hex");
    expect(validPaystackWebhook(body, signature, key)).toBe(true);
    expect(validPaystackWebhook(Buffer.from('{"event":"charge.failed"}'), signature, key)).toBe(false);
    expect(validPaystackWebhook(body, "bad", key)).toBe(false);
  });

  it("refuses a mismatched reference, price, currency, or customer", () => {
    const order = { reference: "ayt_1", amountCents: 2500, currency: "USD" };
    const paid = { status: "success", reference: "ayt_1", amount: 2500, currency: "USD", customer: { email: "buyer@example.com" } };
    expect(verifiedPaystackPayment(paid, order, "buyer@example.com")).toBe(true);
    expect(verifiedPaystackPayment({ ...paid, reference: "other" }, order, "buyer@example.com")).toBe(false);
    expect(verifiedPaystackPayment({ ...paid, amount: 10 }, order, "buyer@example.com")).toBe(false);
    expect(verifiedPaystackPayment({ ...paid, currency: "KES" }, order, "buyer@example.com")).toBe(false);
    expect(verifiedPaystackPayment(paid, order, "other@example.com")).toBe(false);
  });

  it("uses the server secret for provider calls and hides upstream errors", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: true, data: { status: "success" } }) });
    const client = createPaystackClient({ PAYSTACK_SECRET_KEY: "test_secret" }, fetcher);
    await client.verify("ayt_123");
    expect(fetcher).toHaveBeenCalledWith("https://api.paystack.co/transaction/verify/ayt_123", expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer test_secret" }) }));
    expect(paystackConfigured({ PAYSTACK_SECRET_KEY: "sk_test_123" })).toBe(false);
    expect(paystackConfigured({ PAYSTACK_SECRET_KEY: "sk_test_123", PAYSTACK_WEBHOOK_READY: "1" })).toBe(true);
    await expect(createPaystackClient({}, fetcher).verify("x")).rejects.toMatchObject({ statusCode: 503 });
  });
});
