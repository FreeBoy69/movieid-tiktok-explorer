import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TokenSummary } from "./AccountServices";

const offer = {
  billing: { planName: "Free", monthlyTokens: 250000, balance: 250000, allowanceRemaining: 250000, bonusBalance: 0, unlimited: false, periodEnd: "2026-10-26T00:00:00Z", periodUsed: 0 },
  plans: [{ id: "creator", name: "Creator", description: "", priceCents: 1900, monthlyTokens: 8000000 }],
  payment: { available: true, testMode: true, packs: [{ id: "pack_25", priceCents: 2500, credits: 100000 }] },
};

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("billing checkout", () => {
  it("uses server-listed prices and sends only the pack identifier", async () => {
    const fetcher = vi.fn().mockImplementation((url: string) => Promise.resolve(url === "/api/billing/me"
      ? { ok: true, json: async () => offer }
      : { ok: false, json: async () => ({ error: "Try again" }) }));
    vi.stubGlobal("fetch", fetcher);
    render(<TokenSummary />);
    fireEvent.click(await screen.findByRole("button", { name: "Credits & plans" }));
    fireEvent.click(screen.getByRole("tab", { name: "Extra credits" }));
    expect(screen.getByText("100,000 credits")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Buy" }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledWith("/api/billing/checkout", expect.objectContaining({
      method: "POST", body: JSON.stringify({ kind: "credits", packId: "pack_25" }),
    })));
  });
});
