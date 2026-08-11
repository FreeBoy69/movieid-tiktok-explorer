import { describe, expect, it } from "vitest";
import {
  chooseShortsTrimPoint,
  normalizeShortsTargetSeconds,
  shortsTrimRequired,
  shortsTrimWindow,
} from "./shortsTrimPolicy.js";

describe("Shorts trim policy", () => {
  it("uses a plus-or-minus ten-second transcript scoring window", () => {
    const choice = chooseShortsTrimPoint([
      { start: 44, end: 49.4, text: "An early ending outside the window." },
      { start: 56, end: 59.4, text: "But when she opened the" },
      { start: 63, end: 68.4, text: "At last, she defeated the guard and escaped." },
      { start: 68, end: 71.2, text: "A late ending outside the window." },
    ], 188.4, 60);
    expect(choice.cutAtSeconds).toBeCloseTo(68.5, 1);
    expect(choice.cutAtSeconds).toBeGreaterThan(60);
    expect(choice.cutAtSeconds).toBeLessThanOrEqual(70);
    expect(choice.trimWindow).toMatchObject({ targetSeconds: 60, minSeconds: 50, maxSeconds: 70, toleranceSeconds: 10 });
  });

  it("falls back to the exact limit when transcription has no nearby ending", () => {
    expect(chooseShortsTrimPoint([], 200, 60)).toMatchObject({
      cutAtSeconds: 60,
      reason: "duration_limit",
      transcriptScored: false,
    });
  });

  it("prefers a completed story beat over a later dangling sentence", () => {
    const choice = chooseShortsTrimPoint([
      { start: 51, end: 56.8, text: "At last, she defeated the guard and escaped." },
      { start: 56.8, end: 59.5, text: "But when she opened the" },
    ], 100, 60);
    expect(choice.cutAtSeconds).toBeCloseTo(56.9, 1);
    expect(choice.reason).toBe("smart_transcript_score");
    expect(choice.decision.factors).toEqual(expect.arrayContaining(["complete_sentence", "story_resolution"]));
    expect(choice.alternatives[0].factors).toContain("dangling_clause");
  });

  it("penalizes engagement CTAs when a clean narrative ending is available", () => {
    const choice = chooseShortsTrimPoint([
      { start: 52, end: 57.8, text: "The village was finally safe." },
      { start: 57.8, end: 59.7, text: "Follow for part two." },
    ], 100, 60);
    expect(choice.cutAtSeconds).toBeCloseTo(57.9, 1);
    expect(choice.decision.factors).toContain("story_resolution");
    expect(choice.alternatives[0].factors).toContain("call_to_action");
  });

  it("accepts complete sources inside the tolerance and trims above it", () => {
    expect(shortsTrimRequired(77.4, 60)).toBe(true);
    expect(shortsTrimRequired(70.01, 60)).toBe(true);
    expect(shortsTrimRequired(70, 60)).toBe(false);
    expect(shortsTrimRequired(65, 60)).toBe(false);
    expect(shortsTrimRequired(60, 60)).toBe(false);
    expect(shortsTrimRequired(59.9, 60)).toBe(false);
  });

  it("caps the tolerance window at the YouTube Shorts maximum", () => {
    expect(shortsTrimWindow(175)).toEqual({ targetSeconds: 175, toleranceSeconds: 10, minSeconds: 165, maxSeconds: 179 });
  });

  it("keeps supported targets between one minute and 2:59", () => {
    expect(normalizeShortsTargetSeconds(20)).toBe(60);
    expect(normalizeShortsTargetSeconds(90)).toBe(90);
    expect(normalizeShortsTargetSeconds(300)).toBe(179);
  });
});
