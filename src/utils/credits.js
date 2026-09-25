// AutoYT's customer-facing billing unit.
// Internal ledgers still use provider-cost tokens for compatibility; one credit
// is always represented by 100 of those internal tokens.
export const TOKENS_PER_CREDIT = 100;

export function tokensToCredits(value) {
  const tokens = Number(value) || 0;
  if (!tokens) return 0;
  const sign = tokens < 0 ? -1 : 1;
  return sign * Math.ceil(Math.abs(tokens) / TOKENS_PER_CREDIT);
}

export function creditsToTokens(value) {
  return Math.round(Number(value) || 0) * TOKENS_PER_CREDIT;
}

export function usdToCredits(value, tokensPerUsd = 1_000_000) {
  return tokensToCredits((Number(value) || 0) * (Number(tokensPerUsd) || 1_000_000));
}

