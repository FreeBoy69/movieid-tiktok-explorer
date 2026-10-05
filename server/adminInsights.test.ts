import { describe, expect, it } from "vitest";
import { deriveInsights, insightsQueries, windowDays } from "./adminInsights.js";

const coverage = [
  // August: a and b subscribe.
  { month: "2026-08", userId: "a", cents: 1900 }, { month: "2026-08", userId: "b", cents: 1900 },
  // September: a upgrades, b leaves, c and d join.
  { month: "2026-09", userId: "a", cents: 4900 }, { month: "2026-09", userId: "c", cents: 1900 }, { month: "2026-09", userId: "d", cents: 14900 / 12 },
  // October (in progress): d leaves, c downgrades to annual creator.
  { month: "2026-10", userId: "a", cents: 4900 }, { month: "2026-10", userId: "c", cents: 1000 },
];

describe("deriveInsights", () => {
  const out = deriveInsights({
    totals: { mrrCents: 5900, payingAccounts: 2, users: 40, collectedCents: 20000, cost: 50, calls: 400, aiUsers: 10, payments: 9, failedPayments: 1 },
    coverage,
    providerSeries: [
      { day: "2026-10-01", provider: "openrouter", cost: "4" }, { day: "2026-10-01", provider: "gemini", cost: "3" },
      { day: "2026-10-01", provider: "runway", cost: "2" }, { day: "2026-10-01", provider: "deepseek", cost: "1" },
      { day: "2026-10-01", provider: "dashscope", cost: "0.5" }, { day: "2026-10-02", provider: "videorouter", cost: "0.25" },
    ],
    heatmap: [{ dow: 1, hour: 9, calls: "7" }],
    series: [{ day: "2026-10-01" }, { day: "2026-10-02" }],
  });

  it("rebuilds MRR history and splits movements into new, expansion, contraction and churn", () => {
    const [aug, sep, oct] = out.revenue.history;
    expect(aug).toMatchObject({ month: "2026-08", mrrCents: 3800, subscribers: 2, new: 0, churned: 0 });
    expect(sep).toMatchObject({ new: 1900 + 1242, newCount: 2, expansion: 3000, churned: 1900, churnedCount: 1, logoChurn: 50 });
    // (3800 + 3000 − 0 − 1900) / 3800
    expect(sep.netRetention).toBe(128.9);
    expect(oct).toMatchObject({ contraction: 900, churned: 1242, churnedCount: 1 });
  });

  it("takes rates from the last full month and derives LTV, ARR, ARPA and quick ratio", () => {
    expect(out.revenue.churnRate).toBe(50);
    expect(out.revenue.netRetention).toBe(128.9);
    expect(out.revenue.arrCents).toBe(5900 * 12);
    expect(out.revenue.arpaCents).toBe(2950);
    expect(out.revenue.ltvCents).toBe(5900);
    // gained (3142 + 3000) ÷ lost (1900 + 900 + 1242)
    expect(out.revenue.quickRatio).toBe(1.52);
    expect(out.revenue.paymentSuccessRate).toBe(90);
    expect(out.revenue.paidConversion).toBe(5);
  });

  it("computes unit economics with nulls instead of divide-by-zero", () => {
    expect(out.economics.marginPct).toBe(75);
    expect(out.economics.costPerActiveUser).toBe(5);
    expect(out.economics.revenuePerCall).toBe(0.5);
    const empty = deriveInsights({ totals: {} });
    expect(empty.economics.marginPct).toBeNull();
    expect(empty.revenue.churnRate).toBeNull();
    expect(empty.revenue.ltvCents).toBeNull();
    expect(empty.revenue.quickRatio).toBeNull();
    expect(empty.growth.stickiness).toBeNull();
    expect(empty.revenue.history).toEqual([]);
  });

  it("keeps the top four providers and folds the rest into Other, aligned to the calendar", () => {
    expect(out.economics.providers).toEqual(["openrouter", "gemini", "runway", "deepseek", "other"]);
    expect(out.economics.providerSeries).toEqual([
      { day: "2026-10-01", values: [4, 3, 2, 1, 0.5] },
      { day: "2026-10-02", values: [0, 0, 0, 0, 0.25] },
    ]);
    expect(out.economics.heatmap[1][9]).toBe(7);
    expect(out.economics.heatmap.flat().reduce((a, b) => a + b)).toBe(7);
  });
});

describe("insightsQueries", () => {
  it("clamps the window and buckets a year by week", () => {
    expect(windowDays("365")).toBe(365);
    expect(windowDays("12; DROP TABLE x")).toBe(30);
    expect(windowDays(5000)).toBe(30);
    expect(insightsQueries(365).bucket).toBe("week");
    expect(insightsQueries(30).bucket).toBe("day");
  });

  it("never touches billing_orders before the payments migration has run", () => {
    const q = insightsQueries(30, { ordersReady: false });
    for (const [key, sql] of Object.entries(q)) if (typeof sql === "string") expect(sql, key).not.toContain("billing_orders");
    expect(insightsQueries(30).coverage).toContain("billing_orders");
  });
});
