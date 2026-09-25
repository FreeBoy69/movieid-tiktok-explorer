import { describe, expect, it } from "vitest";
import { creditEstimateLabel, fallbackCreditEstimate, providerCreditEstimate, type StudioPricing } from "./studioPricing";

const pricing: StudioPricing = { tokensPerUsd: 750_000, flatTokens: { image: 60_000, video: 750_000 } };

describe("studio credit estimates", () => {
  it("uses the account's configured conversion rate for provider prices", () => {
    expect(providerCreditEstimate(0.14 * 5, pricing)).toBe(5_250);
    expect(creditEstimateLabel(providerCreditEstimate(0.14 * 5, pricing))).toBe("≈ 5,250 credits");
  });

  it("uses billing fallback tokens for unpriced operations", () => {
    expect(fallbackCreditEstimate("image", pricing, 2)).toBe(1_200);
    expect(fallbackCreditEstimate("music", pricing)).toBeNull();
  });

  it("does not invent a price before billing data is available", () => {
    expect(providerCreditEstimate(0.5, null)).toBeNull();
    expect(fallbackCreditEstimate("video", null)).toBeNull();
    expect(creditEstimateLabel(null)).toBe("");
  });
});
