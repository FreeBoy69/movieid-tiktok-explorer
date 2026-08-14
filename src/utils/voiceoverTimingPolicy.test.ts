import { describe, expect, it } from "vitest";
import {
  VOICEOVER_SILENCE_FILTER,
  buildAtempoChain,
  buildSourceVoiceProfileDescription,
  chooseVoiceCloneSampleWindow,
  planVoiceoverTiming,
  sourceUploadIdFromProfile,
  splitVoiceoverText,
} from "./voiceoverTimingPolicy.js";

describe("voiceover timing policy", () => {
  it("chunks long narration without losing or truncating words", () => {
    const text = Array.from({ length: 90 }, (_, index) => `Sentence ${index + 1} has enough narration words to exercise the voice generator.`).join(" ");
    const chunks = splitVoiceoverText(text, 480);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 480)).toBe(true);
    expect(chunks.join(" ")).toBe(text);
  });

  it("keeps default voice generation chunks small enough for reliable cloned speech", () => {
    const text = Array.from({ length: 45 }, (_, index) => `Sentence ${index + 1} carries the rewritten narration forward naturally.`).join(" ");
    const chunks = splitVoiceoverText(text);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 1000)).toBe(true);
    expect(chunks.join(" ")).toBe(text);
  });

  it("selects the speech-dense window instead of the silent intro", () => {
    const window = chooseVoiceCloneSampleWindow([
      { start: 12, end: 14, text: "A sparse opening line." },
      { start: 30, end: 38, text: "This continuous narration contains a clear and useful voice reference sample." },
      { start: 38.2, end: 46, text: "It continues without dead air so the cloned voice can preserve the source speaker." },
      { start: 46.2, end: 53, text: "A third dense line makes this the strongest source window." },
    ], { mediaDuration: 60, maxSeconds: 30, minSeconds: 8 });
    expect(window).not.toBeNull();
    expect(window!.start).toBeGreaterThan(29);
    expect(window!.speechRatio).toBeGreaterThan(0.85);
  });

  it("caps tempo changes and pads a shorter narration to the video", () => {
    const plan = planVoiceoverTiming(43, 60, { startPaddingSeconds: 1, endPaddingSeconds: 0.1 });
    expect(plan.tempo).toBe(0.9);
    expect(plan.trailingPadSeconds).toBeGreaterThan(10);
    expect(plan.finalDurationSeconds).toBeCloseTo(60, 5);
    expect(plan.fits).toBe(true);
  });

  it("flags narration that cannot fit without excessive speed-up", () => {
    const plan = planVoiceoverTiming(95, 60, { maximumTempo: 1.3 });
    expect(plan.tempo).toBe(1.3);
    expect(plan.overflowSeconds).toBeGreaterThan(10);
    expect(plan.fits).toBe(false);
  });

  it("builds safe multi-stage tempo chains", () => {
    expect(buildAtempoChain(4.5)).toEqual(["atempo=2", "atempo=2", "atempo=1.125"]);
    expect(buildAtempoChain(0.25)).toEqual(["atempo=0.5", "atempo=0.5"]);
  });

  it("keeps a source-upload binding on cloned profiles", () => {
    const description = buildSourceVoiceProfileDescription("upload_123");
    expect(sourceUploadIdFromProfile({ description })).toBe("upload_123");
  });

  it("configures both boundary and long internal silence trimming", () => {
    expect(VOICEOVER_SILENCE_FILTER).toContain("start_periods=1");
    expect(VOICEOVER_SILENCE_FILTER).toContain("stop_periods=-1");
    expect(VOICEOVER_SILENCE_FILTER).toContain("stop_silence=0.12");
    expect(VOICEOVER_SILENCE_FILTER).toContain("areverse");
  });
});
