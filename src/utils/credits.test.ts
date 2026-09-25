import { describe, expect, it } from "vitest";
import { creditsToTokens, tokensToCredits, usdToCredits, TOKENS_PER_CREDIT } from "./credits.js";

describe("customer credit conversion", () => {
  it("keeps the published 100-token credit ratio", () => {
    expect(TOKENS_PER_CREDIT).toBe(100);
    expect(tokensToCredits(0)).toBe(0);
    expect(tokensToCredits(100)).toBe(1);
    expect(tokensToCredits(101)).toBe(2);
    expect(creditsToTokens(12)).toBe(1200);
  });

  it("preserves the sign for ledger adjustments", () => {
    expect(tokensToCredits(-100)).toBe(-1);
    expect(creditsToTokens(-4)).toBe(-400);
  });

  it("converts provider-dollar estimates through the configured token rate", () => {
    expect(usdToCredits(0.01, 1_000_000)).toBe(100);
    expect(usdToCredits(0.0001, 1_000_000)).toBe(1);
  });
});
