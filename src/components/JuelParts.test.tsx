import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { JuelReceipts, receiptSummary, type JuelReceipt } from "./JuelParts";

const receipts: JuelReceipt[] = [
  { method: "GET", route: "GET /api/recaps", path: "/api/recaps", risk: "read", does: "Lists the user's recaps.", ok: true, status: 200, credits: 0, touched: [] },
  { method: "POST", route: "POST /api/recaps", path: "/api/recaps", risk: "paid", does: "Starts a new movie recap.", ok: true, status: 201, credits: 120, touched: ["rcp_9"] },
  { method: "POST", route: "POST /api/recaps/:id/publish", path: "/api/recaps/rcp_9/publish", risk: "publish", does: "Posts the recap.", ok: false, status: 0, credits: 0, refused: "Your token can't publish.", touched: ["rcp_9"] },
  { kind: "page", type: "add_text", does: "Put a title on screen", ok: true, credits: 0 },
];

describe("Juel's receipts", () => {
  it("sums actions, credits that ran, and refusals", () => {
    expect(receiptSummary(receipts)).toBe("4 actions · ≈120 credits · 1 refused");
    expect(receiptSummary([receipts[0]])).toBe("1 action");
    expect(receiptSummary([{ ...receipts[0], ok: false, status: 500 }])).toBe("1 action · 1 failed");
  });

  it("renders a collapsed disclosure that lists each call with its risk, ids, outcome, and cost", () => {
    const { container } = render(<JuelReceipts receipts={receipts} />);
    const details = container.querySelector("details")!;
    expect(details.open).toBe(false);
    expect(screen.getByText("What Juel did")).toBeTruthy();
    expect(screen.getByText("4 actions · ≈120 credits · 1 refused")).toBeTruthy();
    fireEvent.click(container.querySelector("summary")!);
    const rows = container.querySelectorAll("li");
    expect(rows).toHaveLength(4);
    expect(rows[1].textContent).toContain("Paid");
    expect(rows[1].textContent).toContain("Starts a new movie recap.");
    expect(rows[1].textContent).toContain("rcp_9");
    expect(rows[1].textContent).toContain("≈120");
    expect(rows[2].textContent).toContain("Publish");
    expect(rows[2].textContent).toContain("Your token can't publish.");
    expect(rows[3].textContent).toContain("Page");
    expect(screen.getAllByRole("img", { name: /Done|Sent/ })).toHaveLength(3);
  });

  it("shows nothing for a reply without receipts", () => {
    const { container } = render(<JuelReceipts receipts={[]} />);
    expect(container.innerHTML).toBe("");
  });
});
