// AutoYT's customer-facing billing unit.
// Internal ledgers still use provider-cost tokens for compatibility; one credit
// is always represented by 100 of those internal tokens. Internal token balances
// can have remainders, so customer-facing credits may have two decimal places.
export const TOKENS_PER_CREDIT = 100;

export function tokensToCredits(value) {
  const tokens = Number(value) || 0;
  return tokens / TOKENS_PER_CREDIT;
}

export function creditsToTokens(value) {
  return Math.round((Number(value) || 0) * TOKENS_PER_CREDIT);
}

export function usdToCredits(value, tokensPerUsd = 1_000_000) {
  const tokens = (Number(value) || 0) * (Number(tokensPerUsd) || 1_000_000);
  const magnitude = Math.abs(tokens);
  const tolerance = Number.EPSILON * Math.max(1, magnitude) * 4;
  return Math.sign(tokens) * (Math.ceil(magnitude - tolerance) / TOKENS_PER_CREDIT);
}
