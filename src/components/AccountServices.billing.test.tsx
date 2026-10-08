import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BillingOnboarding, TokenSummary } from "./AccountServices";
import { chooseLingbasePlan } from "../utils/lingbasePayments";
import { loadStripe } from "@stripe/stripe-js";

vi.mock("@stripe/stripe-js", () => ({
  loadStripe: vi.fn(async () => ({
    createEmbeddedCheckoutPage: vi.fn(async () => ({
      mount: (node: HTMLElement) => { node.textContent = "Card form"; },
      destroy: vi.fn(),
    })),
  })),
}));

vi.mock("../utils/lingbasePayments", () => ({
  chooseLingbasePlan: vi.fn().mockResolvedValue({
    sessionId: "cs_test",
    clientSecret: "cs_test_secret_value",
    publishableKey: "pk_test_123",
    stripeAccount: "acct_test",
  }),
  chooseLingbasePack: vi.fn(),
  syncLingbasePayments: vi.fn().mockResolvedValue(null),
  continueLingbaseCheckout: vi.fn(),
  openLingbasePortal: vi.fn(),
  startLingbaseCheckout: vi.fn(),
}));

const offer = {
  billing: { planId: "pending", planName: "Choose a plan", status: "pending", monthlyTokens: 0, balance: 0, allowanceRemaining: 0, bonusBalance: 0, unlimited: false, periodEnd: "2026-10-26T00:00:00Z", periodUsed: 0 },
  plans: [{ id: "creator", name: "Creator", description: "For creators", priceCents: 1900, annualPriceCents: 20599, monthlyTokens: 8000000, features: ["All creation tools"] }],
  payment: { provider: "lingbase", available: true, testMode: false, packs: [], packsRequirePlan: true },
};

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("LingBase billing checkout", () => {
  it("opens paid plans and mounts Stripe on the connected account", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => offer }));
    render(<BillingOnboarding theme="dark" email="creator@example.com" />);
    expect(await screen.findByRole("dialog", { name: "Credits and plans" })).toBeTruthy();
    expect(screen.queryByText(/free plan/i)).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: /Annual/i }));
    expect(screen.getByText("$205.99 billed annually")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Continue with Creator" }));
    await waitFor(() => expect(chooseLingbasePlan).toHaveBeenCalledWith("creator", "year", "creator@example.com"));
    expect(await screen.findByRole("dialog", { name: "Secure checkout" })).toBeTruthy();
    await waitFor(() => expect(loadStripe).toHaveBeenCalledWith("pk_test_123", { stripeAccount: "acct_test" }));
    expect(await screen.findByText("Card form")).toBeTruthy();
    expect(screen.queryByTitle("Secure card payment")).toBeNull();
  });

  it("shows credits as tokens divided by 100", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ...offer, billing: { ...offer.billing, planId: "creator", planName: "Creator", status: "active", monthlyTokens: 8000000, balance: 250000 } }) }));
    render(<TokenSummary email="creator@example.com" />);
    expect(await screen.findByText("2.5K credits left")).toBeTruthy();
  });
});
