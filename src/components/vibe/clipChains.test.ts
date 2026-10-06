import { describe, expect, it } from "vitest";
import { clipChains } from "./Preview";

const clip = (id: string, start: number, inPoint: number, out: number, extra: Record<string, unknown> = {}) => ({ id, assetId: "pic", track: 0, start, in: inPoint, out, fit: "fill", ...extra });

describe("preview clip chains", () => {
  it("lets cuts that continue one file share a single video element", () => {
    // A recap: back-to-back cuts of one picture file, then a gap, then a recoloured cut.
    const project = { clips: [clip("a", 0, 0, 3.2), clip("b", 3.2, 3.2, 6.9), clip("c", 6.9, 6.9, 10), clip("d", 12, 12, 15), clip("e", 15, 15, 18, { grade: { warmth: 0.2 } })] } as any;
    const chains = clipChains(project);
    expect([...chains.entries()]).toEqual([["a", "a"], ["b", "a"], ["c", "a"], ["d", "d"], ["e", "e"]]);
  });

  it("keeps clips apart when they jump in the file or sit on other tracks", () => {
    const project = { clips: [clip("a", 0, 0, 3), clip("b", 3, 40, 43), clip("c", 3, 3, 6, { track: 1 })] } as any;
    const chains = clipChains(project);
    expect(chains.get("b")).toBe("b");
    expect(chains.get("c")).toBe("c");
  });
});
