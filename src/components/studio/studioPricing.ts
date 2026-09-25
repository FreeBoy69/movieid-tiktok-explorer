import { useEffect, useState } from "react";
import { tokensToCredits, usdToCredits } from "../../utils/credits.js";

export type StudioPricing = { tokensPerUsd: number; flatTokens: Record<string, number> };
export const CREDIT_ESTIMATE_TITLE = "Estimated credits. Final charge may vary with provider usage.";

export function useStudioPricing(): StudioPricing | null {
  const [pricing, setPricing] = useState<StudioPricing | null>(null);
  useEffect(() => {
    let active = true;
    const load = async () => {
      const response = await fetch("/api/billing/me", { cache: "no-store" });
      if (!response.ok) return;
      const data = await response.json();
      const tokensPerUsd = Number(data?.pricing?.tokensPerUsd);
      if (active && Number.isFinite(tokensPerUsd) && tokensPerUsd > 0) {
        setPricing({ tokensPerUsd, flatTokens: data.pricing.flatTokens || {} });
      }
    };
    void load().catch(() => {});
    window.addEventListener("autoyt-billing-changed", load);
    return () => {
      active = false;
      window.removeEventListener("autoyt-billing-changed", load);
    };
  }, []);
  return pricing;
}

export function providerCreditEstimate(usd: number | null | undefined, pricing: StudioPricing | null) {
  return pricing && Number.isFinite(usd) && Number(usd) > 0 ? usdToCredits(Number(usd), pricing.tokensPerUsd) : null;
}

export function fallbackCreditEstimate(operation: string, pricing: StudioPricing | null, units = 1) {
  const tokens = Number(pricing?.flatTokens?.[operation]);
  return pricing && Number.isFinite(tokens) && tokens > 0 && units > 0 ? tokensToCredits(tokens * units) : null;
}

export function creditEstimateLabel(credits: number | null) {
  return credits === null ? "" : `≈ ${credits.toLocaleString("en-US")} credits`;
}
