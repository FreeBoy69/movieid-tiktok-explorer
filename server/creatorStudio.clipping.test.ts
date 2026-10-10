import { describe, expect, it } from "vitest";
import { clipSubtitleFile, normalizeBrandKit, normalizeRequest } from "./creatorStudio.js";

describe("AI clipping settings", () => {
  it("accepts supported framing and captions while falling back safely", () => {
    expect(normalizeRequest({ tab: "clipping", settings: { clipFraming: "blur", clipCaptions: true } }).settings)
      .toMatchObject({ clipFraming: "blur", clipCaptions: true });
    expect(normalizeRequest({ tab: "clipping", settings: { clipFraming: "invalid", clipCaptions: "yes" } }).settings)
      .toMatchObject({ clipFraming: "auto", clipCaptions: false });
  });

  it("accepts a caption style, emoji, trimming, and the brand kit for clipping only", () => {
    expect(normalizeRequest({ tab: "clipping", settings: { clipCaptionStyle: "karaoke", clipEmoji: true, clipTrimFillers: true, clipUseBrandKit: true } }).settings)
      .toMatchObject({ clipCaptionStyle: "karaoke", clipEmoji: true, clipTrimFillers: true, clipUseBrandKit: true });
    expect(normalizeRequest({ tab: "clipping", settings: { clipCaptionStyle: "nope", clipEmoji: "yes" } }).settings)
      .toMatchObject({ clipCaptionStyle: "hormozi", clipEmoji: false, clipTrimFillers: false, clipUseBrandKit: false });
    expect(normalizeRequest({ tab: "image", prompt: "a cat", settings: { clipCaptionStyle: "karaoke" } }).settings.clipCaptionStyle).toBeUndefined();
  });

  it("cleans a brand kit: only studio files of the right kind, known styles and fonts, sane opacity", () => {
    expect(normalizeBrandKit({
      logo: "up-abc-123.png", logoPosition: "bottom-left", logoOpacity: 0.456, primaryColor: "#ffcc00", accentColor: "red",
      captionStyle: "mrbeast", captionFont: "Anton", intro: "up-def-456.mp4", outro: "../etc/passwd",
    })).toEqual({
      logo: "up-abc-123.png", logoPosition: "bottom-left", logoOpacity: 0.46, primaryColor: "#FFCC00", accentColor: "",
      captionStyle: "mrbeast", captionFont: "Anton", intro: "up-def-456.mp4", outro: "",
    });
    expect(normalizeBrandKit({ logo: "up-abc-123.mp4", logoPosition: "middle", logoOpacity: 5, captionStyle: "x", captionFont: "Comic Sans" }))
      .toMatchObject({ logo: "", logoPosition: "top-right", logoOpacity: 1, captionStyle: "", captionFont: "" });
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
