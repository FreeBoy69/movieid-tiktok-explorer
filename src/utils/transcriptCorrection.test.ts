import { describe, expect, it } from "vitest";
import { alignWords, correctTranscript, scriptTokens, similarity } from "./transcriptCorrection.js";

const words = (text: string, start = 0) =>
  text.split(" ").map((word, i) => ({ word, start: start + i * 0.4, end: start + i * 0.4 + 0.35 }));

describe("transcript correction", () => {
  it("replaces misheard words with the script's spelling and keeps Whisper's timing", () => {
    const script = "Kubernetes schedules pods across the cluster. Then it watches them.";
    const segments = [
      { start: 0, end: 2.4, text: "cooper netties schedules pods across the cluster", words: words("cooper netties schedules pods across the cluster") },
      { start: 2.4, end: 3.6, text: "then it watches them", words: words("then it watches them", 2.4) },
    ];
    const result = correctTranscript(segments, script);
    expect(result.applied).toBe(true);
    expect(result.segments[0].text).toBe("Kubernetes schedules pods across the cluster.");
    expect(result.segments[1].text).toBe("Then it watches them.");
    expect(result.segments[0].words[0]).toMatchObject({ word: "Kubernetes", start: 0 });
    expect(result.segments[0].words.at(-1)).toMatchObject({ word: "cluster.", end: segments[0].words.at(-1)!.end });
    expect(result.segments[1].start).toBe(2.4);
  });

  it("carries a short missed word along with its neighbour and drops stray words", () => {
    const script = "We ship on Friday, every single week.";
    const segments = [{ start: 0, end: 3, text: "we um ship on friday every week", words: words("we um ship on friday every week") }];
    const result = correctTranscript(segments, script);
    expect(result.applied).toBe(true);
    expect(result.segments[0].text).toBe("We ship on Friday, every single week.");
    expect(result.segments[0].words.map((w: any) => w.word)).not.toContain("um");
  });

  it("leaves a transcript alone when it does not match the script", () => {
    const segments = [{ start: 0, end: 3, text: "completely different take about cats", words: words("completely different take about cats") }];
    const result = correctTranscript(segments, "Quarterly revenue grew twelve percent on strong demand.");
    expect(result.applied).toBe(false);
    expect(result.segments).toBe(segments);
  });

  it("ignores dialogue speaker labels and stage directions in the script", () => {
    expect(scriptTokens("APPLE (whispering): Hello there. [beat] BANANA: Hi.").map((t) => t.raw)).toEqual(["Hello", "there.", "Hi."]);
  });

  it("aligns with gaps on both sides", () => {
    const a = ["the", "cat", "sat"].map((key) => ({ key }));
    const b = ["the", "big", "cat", "sat"].map((key) => ({ key }));
    expect(alignWords(a, b)).toEqual([[0, 0], [-1, 1], [1, 2], [2, 3]]);
    expect(similarity("kubernetes", "kubernetis")).toBeGreaterThan(0.8);
  });
});
