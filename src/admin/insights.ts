// Shape of /api/admin/insights and a hook shared by the dashboard pages.
import { useAdminQuery } from "./ui";

export type InsightDay = {
  day: string; credits: number; cost: number; calls: number; active: number; signups: number;
  planCents: number; creditCents: number; jobsDone: number; jobsFailed: number; tickets: number; uploads: number; usersTotal: number;
};
export type MrrPoint = {
  month: string; mrrCents: number; subscribers: number; new: number; expansion: number; contraction: number; churned: number;
  newCount: number; churnedCount: number; logoChurn: number | null; netRetention: number | null;
};
export type Insights = {
  days: number;
  bucket: "day" | "week";
  generatedAt: string;
  revenue: {
    mrrCents: number; arrCents: number; payingAccounts: number; annualAccounts: number; arpaCents: number; compedAccounts: number; compedCents: number;
    collectedCents: number; collectedPrevCents: number; refundedCents: number; payments: number; failedPayments: number; paymentSuccessRate: number | null;
    pastDue: number; renewals30d: number; churnRate: number | null; netRetention: number | null; ltvCents: number | null; quickRatio: number | null;
    paidConversion: number | null; everPaid: number; history: MrrPoint[];
  };
  growth: { users: number; newUsers: number; newUsersPrev: number; suspended: number; dau: number; wau: number; mau: number; stickiness: number | null; aiUsers: number; aiUsersPrev: number };
  economics: {
    cost: number; costPrev: number; credits: number; creditsPrev: number; calls: number; callsPrev: number; granted: number; marginPct: number | null; grossProfitUsd: number;
    costPerActiveUser: number | null; costPerPayingAccount: number | null; revenuePerCall: number | null; outOfCredits: number; unlimitedAccounts: number;
    providers: string[]; providerSeries: Array<{ day: string; values: number[] }>; heatmap: number[][];
  };
  operations: { openTickets: number; ticketsCreated: number; activeAgents: number; uploads: number; jobsQueued: number; jobsFailed24h: number };
  series: InsightDay[];
  cashMonths: Array<{ month: string; planCents: number; creditCents: number; refundedCents: number; cost: number }>;
  planMix: Array<{ id: string; name: string; priceCents: number; accounts: number; paying: number; annual: number; mrrCents: number }>;
  funnel: { signedUp: number; usedAi: number; returned: number; paid: number; activatedIn7d: number };
  cohorts: Array<{ week: string; size: number; active: Record<string, number> }>;
  topFeatures: Array<{ feature: string; cost: number; credits: number; calls: number; users: number }>;
  topCustomers: Array<{ id: string; email: string; name: string; avatarUrl: string; paidCents: number; payments: number; lastPaidAt: string; cost: number }>;
  support: { byStatus: Record<string, number>; byCategory: Array<{ category: string; n: number }>; medianFirstReplyHours: number | null; unanswered: number };
};

export const WINDOWS = [
  { value: "7", label: "7d" },
  { value: "30", label: "30d" },
  { value: "90", label: "90d" },
  { value: "365", label: "12m" },
] as const;
export type WindowValue = (typeof WINDOWS)[number]["value"];

export const readWindow = (): WindowValue => {
  try {
    const saved = window.localStorage.getItem("autoyt-admin-window");
    return (WINDOWS.find((w) => w.value === saved)?.value || "30") as WindowValue;
  } catch {
    return "30";
  }
};
export const saveWindow = (value: WindowValue) => {
  try {
    window.localStorage.setItem("autoyt-admin-window", value);
  } catch {}
};

export const useInsights = (days: string) => useAdminQuery<Insights>(`/api/admin/insights?days=${days}`);

export const windowLabel = (days: number) => (days === 365 ? "12 months" : `${days} days`);
export const pct = (value: number | null | undefined, places = 0) => (value === null || value === undefined || !Number.isFinite(value) ? "—" : `${value.toFixed(places)}%`);
export const n = (value: unknown) => Number(value) || 0;
