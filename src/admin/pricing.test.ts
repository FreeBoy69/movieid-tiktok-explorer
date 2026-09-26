import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, planPrice } from "../../server/adminConsole.js";
import { previewPrice } from "./pricing";

describe("admin pricing preview", () => {
  it("matches server net-profit pricing at all rounding modes", () => {
    for (const priceRounding of ["ninety_nine", "whole", "cents"] as const) {
      const billing = { ...DEFAULT_SETTINGS.billing, priceRounding };
      for (const tokens of [0, 1_234_567, 8_000_000, 25_000_000, 80_000_000]) {
        const server = planPrice(tokens, billing);
        const preview = previewPrice(tokens, billing);
        expect(preview.priceCents).toBe(server.priceCents);
        expect(preview.profitCents).toBeCloseTo(server.profitCents, 2);
      }
    }
  });
});
