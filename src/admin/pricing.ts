export type BillingSettings = {
  tokensPerUsd: number; profitMarginPercent: number; priceRounding: "ninety_nine" | "whole" | "cents";
  inputUsdPer1M: number; outputUsdPer1M: number; flatTokens: Record<string, number>;
  modelPrices: Record<string, { inputPer1M: number | null; outputPer1M: number | null; perCall: number | null }>;
  modelMultipliers: Record<string, number>; paymentProvider: string;
};

// Mirrors the server's planPrice() so edits show the amount that will be saved.
export function previewPrice(tokens: number, billing: BillingSettings, margin: number | null = null) {
  const m = margin === null ? billing.profitMarginPercent : margin;
  const costCents = (Math.max(0, tokens) / billing.tokensPerUsd) * 100;
  const raw = costCents * (1 + m / 100);
  let priceCents = 0;
  if (raw > 0) {
    if (billing.priceRounding === "cents") priceCents = Math.ceil(raw - 1e-9);
    else if (billing.priceRounding === "whole") priceCents = Math.ceil(raw / 100 - 1e-9) * 100;
    else {
      priceCents = Math.ceil(raw / 100 - 1e-9) * 100 - 1;
      if (priceCents < raw) priceCents += 100;
    }
  }
  return { costCents, priceCents, profitCents: priceCents - costCents, margin: m };
}
