import { describe, expect, it } from "vitest";
import { buildSubtitleCues, normalizeSubtitleSettings, subtitleRegion, subtitlesAss, subtitlesSrt, subtitleVideoFilter } from "./voiceoverSubtitles.js";

describe("updated voiceover subtitles", () => {
  it("uses final spoken word times and preserves silence gaps", () => {
    const cues = buildSubtitleCues([{ words: [{ start: 1.2, end: 1.5, word: "A" }, { start: 1.5, end: 2, word: "rewrite." }, { start: 4, end: 4.5, word: "Next." }] }], 5);
    expect(cues).toEqual([{ start: 1.2, end: 2, text: "A rewrite." }, { start: 4, end: 4.5, text: "Next." }]);
    expect(subtitlesSrt(cues)).toContain("00:00:01,200 --> 00:00:02,000");
  });
  it("bounds invalid settings and handles both orientations without cropping", () => {
    const settings = normalizeSubtitleSettings({ y: 999, height: -4, font: "evil,override", color: "red;movie=x" });
    expect(settings).toMatchObject({ y: 94, height: 6, font: "Arial", color: "#ffffff" });
    for (const dimensions of [{ width: 1920, height: 1080 }, { width: 720, height: 1280 }]) {
      const region = subtitleRegion(dimensions, settings);
      expect(region.y + region.bandHeight).toBeLessThanOrEqual(dimensions.height);
      expect(region.width).toBe(dimensions.width);
      expect(region.fontSize * 1.5).toBeLessThanOrEqual(region.bandHeight + .01);
    }
  });
  it("escapes narration control sequences rather than treating them as ASS styling", () => {
    const ass = subtitlesAss([{ start: 0, end: 1, text: "Hello {\\pos(0,0)} world" }], { width: 1280, height: 720 }, {});
    expect(ass).not.toContain("{\\pos(0,0)}");
    expect(ass).toContain("PlayResX: 1280");
    expect(ass).toContain("\\an5\\pos(640,");
  });
  it("only obscures the selected region and burns captions after coverage", () => {
    const filter = subtitleVideoFilter({ width: 720, height: 1280 }, { treatment: "blur", y: 70, height: 10 }, "/tmp/subtitles.ass");
    expect(filter).toContain("crop=iw:128:0:896");
    expect(filter).toContain("overlay=0:896");
    expect(filter).toContain("[covered]ass=");
  });
  it("splits long speech into readable cues and rejects invalid times", () => {
    const words = Array.from({ length: 20 }, (_, i) => ({ start: i * .4, end: (i + 1) * .4, word: "updated" }));
    const cues = buildSubtitleCues([{ words }], 8, 40);
    expect(cues.length).toBeGreaterThan(3);
    expect(cues.every((cue) => cue.text.length <= 40 && cue.end - cue.start <= 3.5)).toBe(true);
    expect(buildSubtitleCues([{ words: [{ start: NaN, end: 2, word: "bad" }] }], 3)).toEqual([]);
  });
});
