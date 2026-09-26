export type BillingSettings = {
  tokensPerUsd: number; profitMarginPercent: number; priceRounding: "ninety_nine" | "whole" | "cents";
  paymentFeePercent: number; paymentFixedFeeCents: number;
  inputUsdPer1M: number; outputUsdPer1M: number; flatTokens: Record<string, number>;
  modelPrices: Record<string, { inputPer1M: number | null; outputPer1M: number | null; perCall: number | null }>;
  modelMultipliers: Record<string, number>; paymentProvider: string;
};

// Mirrors the server's planPrice() so edits show the amount that will be saved.
export function previewPrice(tokens: number, billing: BillingSettings, margin: number | null = null) {
  const m = margin === null ? billing.profitMarginPercent : margin;
  const costCents = (Math.max(0, tokens) / billing.tokensPerUsd) * 100;
  const rate = Math.min(0.99, Math.max(0, Number(billing.paymentFeePercent ?? 5) / 100));
  const fixed = Math.max(0, Number(billing.paymentFixedFeeCents ?? 50));
  const raw = costCents ? Math.ceil((costCents * (1 + m / 100) + fixed) / (1 - rate)) : 0;
  let priceCents = 0;
  if (raw > 0) {
    if (billing.priceRounding === "cents") priceCents = Math.ceil(raw - 1e-9);
    else if (billing.priceRounding === "whole") priceCents = Math.ceil(raw / 100 - 1e-9) * 100;
    else {
      priceCents = Math.ceil(raw / 100 - 1e-9) * 100 - 1;
      if (priceCents < raw) priceCents += 100;
    }
  }
  const paymentFeeCents = priceCents ? Math.ceil(priceCents * rate + fixed) : 0;
  return { costCents, priceCents, paymentFeeCents, profitCents: priceCents - paymentFeeCents - costCents, margin: m };
}

export function creditsToInternalTokens(credits: number) {
  return Math.max(0, Math.round(Number(credits) || 0) * 100);
}
