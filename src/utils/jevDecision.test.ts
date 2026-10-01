import { describe, expect, it, vi } from "vitest";
import { recommendAutomationRecovery, rerankWithJev, triageDramaPreflight } from "./jevDecision.js";

describe("Jev decision integrations", () => {
  it("reorders only the supplied shortlist and annotates confident scores", async () => {
    const items = [{ id: "a", title: "A" }, { id: "b", title: "B" }, { id: "c", title: "C" }];
    const decision = vi.fn(async () => ({ answers: {
      item_0: { score: 1, confidence: 0.9 },
      item_1: { score: 3.7, confidence: 0.9 },
      item_2: { score: 2.5, confidence: 0.8 },
    } }));
    const result = await rerankWithJev(items, { rubric: "Rank fit", describe: (item: any) => ({ title: item.title }), decision });
    expect(result.map((item: any) => item.id)).toEqual(["b", "c", "a"]);
    expect(result[0]).toMatchObject({ jevScore: 93, jevConfidence: 90 });
    expect(decision).toHaveBeenCalledTimes(1);
  });

  it("keeps the deterministic order when Jev is uncertain or unavailable", async () => {
    const items = [{ id: "a" }, { id: "b" }];
    const uncertain = await rerankWithJev(items, { rubric: "Rank fit", decision: async () => ({ answers: {
      item_0: { score: 0, confidence: 0.4 }, item_1: { score: 4, confidence: 0.4 },
    } }) });
    expect(uncertain).toBe(items);
    const unavailable = await rerankWithJev(items, { rubric: "Rank fit", decision: async () => { throw new Error("offline"); } });
    expect(unavailable).toBe(items);
  });

  it("returns a bounded recovery recommendation and leaves ready drama preflights alone", async () => {
    const advice = await recommendAutomationRecovery("Temporary timeout", async () => ({ answers: { recovery: { choice: "fallback", confidence: 0.88 } } }));
    expect(advice).toEqual({ action: "fallback", confidence: 0.88 });
    const decision = vi.fn();
    expect(await triageDramaPreflight({ status: "ready" }, decision)).toBeNull();
    expect(decision).not.toHaveBeenCalled();
  });

  it("adds only an advisory next step for blocked drama preflights", async () => {
    const advice = await triageDramaPreflight({ status: "blocked", score: 50, checks: [{ id: "clips", label: "Scene clips", status: "blocked", detail: "Render clips" }] }, async () => ({ answers: { next_step: { choice: "prepare_assets", confidence: 0.91 } } }));
    expect(advice).toEqual({ action: "prepare_assets", confidence: 0.91 });
  });
});
