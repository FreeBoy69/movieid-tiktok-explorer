import { describe, expect, it } from "vitest";
import {
  VOICEOVER_SILENCE_FILTER,
  allocateTimedVoiceoverWindows,
  buildAtempoChain,
  buildSourceVoiceProfileDescription,
  buildTimedVoiceoverSegments,
  chooseVoiceCloneSampleWindow,
  planVoiceoverTiming,
  sourceUploadIdFromProfile,
  splitVoiceoverText,
  voiceoverWordCountMatches,
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

  it("keeps rewritten scene word counts within a tight narration band", () => {
    expect(voiceoverWordCountMatches("The orange father pulled her safely from the sea.", "Her orange dad rescued her safely from the ocean.")).toMatchObject({
      target: 9,
      actual: 9,
      matches: true,
    });
    expect(voiceoverWordCountMatches("You are free now.", "At long last, after everything that happened, you are finally completely free now.").matches).toBe(false);
  });

  it("groups transcript sentences into bounded timestamped scene windows", () => {
    const scenes = buildTimedVoiceoverSegments([
      { start: 1, end: 3, text: "Eat the meal." },
      { start: 3.2, end: 6, text: "You have not eaten in two days." },
      { start: 12, end: 14, text: "You are under arrest." },
      { start: 14.2, end: 17, text: "The orange dad saved my life." },
    ], { maxWindowSeconds: 8, sceneGapSeconds: 1.1 });
    expect(scenes).toHaveLength(2);
    expect(scenes[0]).toMatchObject({ start: 1, end: 6, wordCount: 10, sourceSegmentCount: 2 });
    expect(scenes[1]).toMatchObject({ start: 12, end: 17, wordCount: 10, sourceSegmentCount: 2 });
  });

  it("allocates following silence without crossing the next speech onset", () => {
    const windows = allocateTimedVoiceoverWindows([
      { index: 0, start: 1, end: 3, duration: 2, text: "First line." },
      { index: 1, start: 6, end: 8, duration: 2, text: "Second line." },
      { index: 2, start: 9, end: 10, duration: 1, text: "Last line." },
    ], 14, { maxExtensionSeconds: 2.5, nextSceneGuardSeconds: 0.08 });
    expect(windows[0]).toMatchObject({ start: 1, sourceSpeechEnd: 3, end: 5.5, duration: 4.5 });
    expect(windows[1].end).toBeCloseTo(8.92, 5);
    expect(windows[2]).toMatchObject({ sourceSpeechEnd: 10, end: 12.5, duration: 3.5 });
  });

  it("keeps word-timestamped character utterances in separate source windows", () => {
    const scenes = buildTimedVoiceoverSegments([
      {
        start: 1,
        end: 6,
        text: "Eat now. You are under arrest.",
        words: [
          { start: 1, end: 1.3, word: "Eat" },
          { start: 1.31, end: 1.7, word: "now." },
          { start: 4, end: 4.2, word: "You" },
          { start: 4.21, end: 4.5, word: "are" },
          { start: 4.51, end: 4.85, word: "under" },
          { start: 4.86, end: 5.4, word: "arrest." },
        ],
      },
    ], { preserveUtteranceBoundaries: true });
    expect(scenes).toMatchObject([
      { start: 1, end: 1.7, text: "Eat now.", wordCount: 2 },
      { start: 4, end: 5.4, text: "You are under arrest.", wordCount: 4 },
    ]);
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
