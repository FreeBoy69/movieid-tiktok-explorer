import { describe, expect, it } from "vitest";
import { clipSubtitleFile, normalizeRequest } from "./creatorStudio.js";

describe("AI clipping settings", () => {
  it("accepts supported framing and captions while falling back safely", () => {
    expect(normalizeRequest({ tab: "clipping", settings: { clipFraming: "blur", clipCaptions: true } }).settings)
      .toMatchObject({ clipFraming: "blur", clipCaptions: true });
    expect(normalizeRequest({ tab: "clipping", settings: { clipFraming: "invalid", clipCaptions: "yes" } }).settings)
      .toMatchObject({ clipFraming: "crop", clipCaptions: false });
  });

  it("clips Whisper segments to the selected moment and makes SRT times relative", () => {
    expect(clipSubtitleFile([
      { start: 8, end: 10.5, text: "  First   line " },
      { start: 10.5, end: 13, text: "Second line" },
      { start: 15, end: 17, text: "outside" },
    ], 9, 12)).toBe([
      "1",
      "00:00:00,000 --> 00:00:01,500",
      "First line",
      "",
      "2",
      "00:00:01,500 --> 00:00:03,000",
      "Second line",
      "",
    ].join("\n"));
  });
});
