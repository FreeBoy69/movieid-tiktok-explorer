import { describe, expect, it } from "vitest";
import { audioChains, clipChains } from "./Preview";

const clip = (id: string, start: number, inPoint: number, out: number, extra: Record<string, unknown> = {}) => ({ id, assetId: "pic", track: 0, start, in: inPoint, out, fit: "fill", ...extra });
const line = (id: string, start: number, seconds: number, extra: Record<string, unknown> = {}) => ({ id, assetId: "voice", lane: 1, start, in: start, out: start + seconds, volume: 1, ...extra });

describe("preview media chains", () => {
  it("lets cuts that keep one file in step share a single video element", () => {
    // A recap: back-to-back cuts of one picture file, a short gap, then a recoloured cut.
    const project = { clips: [clip("a", 0, 0, 3.2), clip("b", 3.2, 3.2, 6.9), clip("c", 6.9, 6.9, 10), clip("d", 10.5, 10.5, 15), clip("e", 15, 15, 18, { grade: { warmth: 0.2 } })] } as any;
    expect([...clipChains(project).entries()]).toEqual([["a", "a"], ["b", "a"], ["c", "a"], ["d", "a"], ["e", "e"]]);
  });

  it("keeps clips apart when they jump in the file, leave a long gap, or sit on other tracks", () => {
    const project = { clips: [clip("a", 0, 0, 3), clip("b", 3, 40, 43), clip("c", 3, 3, 6, { track: 1 }), clip("d", 8, 8, 9)] } as any;
    const chains = clipChains(project);
    expect(chains.get("b")).toBe("b");
    expect(chains.get("c")).toBe("c");
    expect(chains.get("d")).toBe("d");
  });

  it("plays narration lines with short pauses between them from one audio element", () => {
    // Recap narration: lines of one file with 0.12 s pauses, and a music bed that restarts the file.
    const project = { audio: [line("l0", 0, 4), line("l1", 4.12, 5), line("l2", 9.24, 3), { ...line("m0", 0, 30), assetId: "music", lane: 2, in: 0 }, { ...line("m1", 30, 30), assetId: "music", lane: 2, in: 0, out: 30 }] } as any;
    const chains = audioChains(project);
    expect([chains.get("l0"), chains.get("l1"), chains.get("l2")]).toEqual(["l0", "l0", "l0"]);
    expect(chains.get("m1")).toBe("m1");
  });

  it("keeps one narration element across long pauses between lines", () => {
    const project = { audio: [line("l0", 0, 4), line("l1", 9, 5), line("l2", 40, 3)] } as any;
    const chains = audioChains(project);
    expect([chains.get("l0"), chains.get("l1"), chains.get("l2")]).toEqual(["l0", "l0", "l0"]);
  });
});

import { recapSource } from "../../utils/vibeEdit";
describe("recap edits", () => {
  it("finds the recap an edit came from, even when the edit predates the recorded link", () => {
    expect(recapSource({ source: { kind: "recap", recapId: "rcp_a", format: "short" }, assets: [] } as any)).toEqual({ kind: "recap", recapId: "rcp_a", format: "short" });
    expect(recapSource({ assets: [{ id: "recap_picture", url: "/api/recaps/rcp_45a11f13c5dcf2281fef7547/media/picture-long.mp4" }] } as any)).toEqual({ kind: "recap", recapId: "rcp_45a11f13c5dcf2281fef7547", format: "long" });
    expect(recapSource({ assets: [{ id: "x", url: "/api/studio/files/up-1.mp4" }] } as any)).toBeNull();
  });
});
