import { describe, expect, it } from "vitest";
import { minimumAnnualPrice, minimumPriceForNetMarkup, paymentEconomics } from "./billingPricing.js";

describe("payment-aware pricing", () => {
  it("preserves net profit after the reserved percentage and fixed card fee", () => {
    const price = minimumPriceForNetMarkup(1000);
    expect(price).toBe(2158);
    expect(paymentEconomics(1000, price).netProfitCents).toBeGreaterThanOrEqual(1000);
    expect(paymentEconomics(1000, price - 1).netProfitCents).toBeLessThan(1000);
  });

  it("funds all twelve allowances from an annual purchase", () => {
    const annual = minimumAnnualPrice(800);
    expect(paymentEconomics(9600, annual).netProfitCents).toBeGreaterThanOrEqual(9600);
  });

  it("charges no fee or minimum for a zero-cost internal plan", () => {
    expect(minimumPriceForNetMarkup(0)).toBe(0);
    expect(paymentEconomics(0, 0).paymentFeeCents).toBe(0);
  });
});
