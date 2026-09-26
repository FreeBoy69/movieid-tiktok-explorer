import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BillingOnboarding, TokenSummary } from "./AccountServices";
import { chooseLingbasePlan } from "../utils/lingbasePayments";

vi.mock("../utils/lingbasePayments", () => ({
  chooseLingbasePlan: vi.fn().mockResolvedValue(undefined),
  syncLingbasePayments: vi.fn().mockResolvedValue(null),
  continueLingbaseCheckout: vi.fn(),
  openLingbasePortal: vi.fn(),
}));

const offer = {
  billing: { planId: "pending", planName: "Choose a plan", status: "pending", monthlyTokens: 0, balance: 0, allowanceRemaining: 0, bonusBalance: 0, unlimited: false, periodEnd: "2026-10-26T00:00:00Z", periodUsed: 0 },
  plans: [{ id: "creator", name: "Creator", description: "For creators", priceCents: 1900, annualPriceCents: 20599, monthlyTokens: 8000000, features: ["All creation tools"] }],
  payment: { provider: "lingbase", available: true, testMode: false, packs: [] },
};

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("LingBase billing checkout", () => {
  it("opens paid plans for a new user and passes the chosen plan and period", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => offer }));
    render(<BillingOnboarding theme="dark" email="creator@example.com" />);
    expect(await screen.findByRole("dialog", { name: "Choose a plan" })).toBeTruthy();
    expect(screen.queryByText(/free plan/i)).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Annual" }));
    expect(screen.getByText("$205.99 billed annually")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Choose Creator" }));
    await waitFor(() => expect(chooseLingbasePlan).toHaveBeenCalledWith("creator", "year", "creator@example.com"));
  });

  it("shows credits as tokens divided by 100", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ...offer, billing: { ...offer.billing, planId: "creator", planName: "Creator", status: "active", monthlyTokens: 8000000, balance: 250000 } }) }));
    render(<TokenSummary email="creator@example.com" />);
    expect(await screen.findByText("2.5K credits left")).toBeTruthy();
  });
});
