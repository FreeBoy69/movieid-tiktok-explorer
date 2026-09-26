// Provider-cost tokens are the cost basis. Payment fees are a reserve, not a
// promise about the fee a particular card or country will incur.
export const DEFAULT_FEE_RESERVE = Object.freeze({ percent: 5, fixedCents: 50 });

export function paymentEconomics(costCents, priceCents, fee = DEFAULT_FEE_RESERVE) {
  const cost = Math.max(0, Number(costCents) || 0);
  const price = Math.max(0, Number(priceCents) || 0);
  const paymentFeeCents = price > 0 ? Math.ceil(price * fee.percent / 100 + fee.fixedCents) : 0;
  return {
    costCents: cost,
    priceCents: price,
    paymentFeeCents,
    netProfitCents: Math.round((price - paymentFeeCents - cost) * 100) / 100,
  };
}

export function minimumPriceForNetMarkup(costCents, markupPercent = 100, fee = DEFAULT_FEE_RESERVE) {
  const cost = Math.max(0, Number(costCents) || 0);
  if (!cost) return 0;
  const feeRate = Math.min(0.99, Math.max(0, Number(fee.percent) || 0) / 100);
  const fixed = Math.max(0, Number(fee.fixedCents) || 0);
  const targetProfit = cost * Math.max(0, Number(markupPercent) || 0) / 100;
  let price = Math.ceil((cost + targetProfit + fixed) / (1 - feeRate));
  while (paymentEconomics(cost, price, fee).netProfitCents < targetProfit) price += 1;
  return price;
}

export function minimumAnnualPrice(monthlyCostCents, markupPercent = 100, fee = DEFAULT_FEE_RESERVE) {
  // One annual card charge funds twelve monthly allowances, not one allowance.
  return minimumPriceForNetMarkup(monthlyCostCents * 12, markupPercent, fee);
}
