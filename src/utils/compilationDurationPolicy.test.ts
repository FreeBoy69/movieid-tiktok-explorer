import { describe, expect, it } from "vitest";
import {
  compilationNearTargetToleranceSeconds,
  compilationDurationMeetsTarget,
  compilationRemainingSeconds,
  compilationTargetSeconds,
} from "./compilationDurationPolicy.js";

describe("compilation duration policy", () => {
  it("uses the minimum as the exact build target when a range is configured", () => {
    expect(compilationTargetSeconds(2 * 60 * 60, 3 * 60 * 60)).toBe(2 * 60 * 60);
  });

  it("supports a two-hour maximum-only target", () => {
    expect(compilationTargetSeconds(0, 2 * 60 * 60)).toBe(2 * 60 * 60);
    expect(compilationRemainingSeconds(90 * 60, 2 * 60 * 60)).toBe(30 * 60);
  });

  it("allows only a small muxing tolerance", () => {
    expect(compilationDurationMeetsTarget(7190, 7200)).toBe(true);
    expect(compilationDurationMeetsTarget(7189, 7200)).toBe(false);
  });

  it("allows a bounded near-target window when verified source media runs short", () => {
    expect(compilationNearTargetToleranceSeconds(60 * 60)).toBe(60);
    expect(compilationDurationMeetsTarget(59 * 60, 60 * 60, compilationNearTargetToleranceSeconds(60 * 60))).toBe(true);
    expect(compilationDurationMeetsTarget(58 * 60 + 59, 60 * 60, compilationNearTargetToleranceSeconds(60 * 60))).toBe(false);
  });

  it("rejects an impossible duration range", () => {
    expect(() => compilationTargetSeconds(120, 60)).toThrow(/minimum length/i);
  });
});
