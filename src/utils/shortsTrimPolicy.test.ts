import { describe, expect, it } from "vitest";
import {
  chooseShortsTrimPoint,
  normalizeShortsTargetSeconds,
  shortsTrimRequired,
} from "./shortsTrimPolicy.js";

describe("Shorts trim policy", () => {
  it("treats the selected duration as a hard maximum", () => {
    const choice = chooseShortsTrimPoint([
      { start: 54, end: 58.4, text: "He finally escaped." },
      { start: 74, end: 78.6, text: "A later ending that must not be selected." },
      { start: 129, end: 133.9, text: "An even later climax." },
    ], 188.4, 60);
    expect(choice.cutAtSeconds).toBeLessThanOrEqual(60);
    expect(choice.cutAtSeconds).toBeGreaterThanOrEqual(58.4);
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

  it("trims any source longer than the target, not only sources over three minutes", () => {
    expect(shortsTrimRequired(77.4, 60)).toBe(true);
    expect(shortsTrimRequired(60, 60)).toBe(false);
    expect(shortsTrimRequired(59.9, 60)).toBe(false);
  });

  it("keeps supported targets between one minute and 2:59", () => {
    expect(normalizeShortsTargetSeconds(20)).toBe(60);
    expect(normalizeShortsTargetSeconds(90)).toBe(90);
    expect(normalizeShortsTargetSeconds(300)).toBe(179);
  });
});
