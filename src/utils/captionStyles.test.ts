import { describe, expect, it } from "vitest";
import {
  CAPTION_FONTS,
  CAPTION_SOURCES,
  CAPTION_STYLES,
  assColor,
  captionBurnFilter,
  captionChunks,
  captionsAss,
  encodeAssFont,
  findCaptionStyle,
  normalizeCaptionStyle,
} from "./captionStyles.js";

const words = (text: string, start = 0, step = 0.4) =>
  text.split(" ").map((word, i) => ({ word, start: start + i * step, end: start + i * step + step * 0.85 }));

describe("caption style catalog", () => {
  it("has unique ids, known fonts and credited sources", () => {
    const ids = CAPTION_STYLES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    const sources = new Set(CAPTION_SOURCES.map((s) => s.id));
    for (const style of CAPTION_STYLES) {
      expect(CAPTION_FONTS[style.font as keyof typeof CAPTION_FONTS]).toBeTruthy();
      expect(sources.has(style.source)).toBe(true);
      expect(style.maxWords).toBeGreaterThanOrEqual(1);
    }
    expect(findCaptionStyle("signal")?.colors.active).toBe("#FFE600");
    expect(normalizeCaptionStyle("mrbeast")).toBe("mrbeast");
    expect(normalizeCaptionStyle("nope")).toBe("none");
  });
});

describe("chunking", () => {
  it("groups words by the style's size and breaks on sentence ends and pauses", () => {
    const segments = [
      { start: 0, end: 2.4, text: "Most AI video tools generate random clips.", words: words("Most AI video tools generate random clips.") },
      { start: 4, end: 5.6, text: "This one directs first", words: words("This one directs first", 4) },
    ];
    const chunks = captionChunks(segments, 6, findCaptionStyle("signal"));
    expect(chunks.map((c) => c.words.map((w) => w.text).join(" "))).toEqual(["Most AI video", "tools generate", "random clips.", "This one directs", "first"]);
    // A chunk holds until the next one starts, but never more than 1.2 s past its last word.
    expect(chunks[0].end).toBeCloseTo(chunks[1].start, 5);
    expect(chunks[2].end).toBeCloseTo(chunks[2].words.at(-1)!.end + 1.2, 5);
    expect(chunks.at(-1)!.end).toBeLessThanOrEqual(6);
  });

  it("spreads words evenly when a segment has no word timings", () => {
    const chunks = captionChunks([{ start: 0, end: 2, text: "one two three four" }], 2, findCaptionStyle("one-word"));
    expect(chunks).toHaveLength(4);
    expect(chunks[1].start).toBeCloseTo(0.5, 5);
  });
});

describe("ASS output", () => {
  const dims = { width: 1080, height: 1920 };
  const segments = [{ start: 0, end: 1.2, text: "Hello big world", words: words("Hello big world") }];

  it("converts colours and escapes narration", () => {
    expect(assColor("#FFE600")).toBe("&H0000E6FF");
    expect(assColor("#000000", 0.5)).toBe("&H80000000");
    const ass = captionsAss(captionChunks([{ start: 0, end: 1, text: "a {\\b1}b" }], 1, findCaptionStyle("podcast")), findCaptionStyle("podcast"), dims);
    expect(ass).not.toMatch(/\{\\b1\}/);
  });

  it("writes one event per spoken word with the active word tagged", () => {
    const style = findCaptionStyle("signal");
    const ass = captionsAss(captionChunks(segments, 1.2, style), style, dims);
    const events = ass.split("\n").filter((l) => l.startsWith("Dialogue:"));
    expect(events).toHaveLength(3);
    expect(events[0]).toContain("{\\c&H00E6FF&}HELLO{\\r} BIG WORLD");
    expect(events[2]).toContain("HELLO BIG {\\c&H00E6FF&}WORLD{\\r}");
    expect(ass).toContain("Style: Caption,Montserrat,");
    expect(ass).toContain(`\\pos(540,${Math.round(1920 * 0.6)})`);
  });

  it("writes karaoke wipes, pop scaling, pills and plain bands", () => {
    const karaoke = captionsAss(captionChunks(segments, 1.2, findCaptionStyle("karaoke")), findCaptionStyle("karaoke"), dims);
    expect(karaoke.split("\n").filter((l) => l.startsWith("Dialogue:"))).toHaveLength(1);
    expect(karaoke).toMatch(/\{\\kf40\}HELLO \{\\kf40\}BIG \{\\kf\d+\}WORLD/);
    const beast = captionsAss(captionChunks(segments, 1.2, findCaptionStyle("mrbeast")), findCaptionStyle("mrbeast"), dims);
    expect(beast).toContain("\\fscx112\\fscy112");
    expect(beast).toContain("Style: Caption,Bebas Neue,");
    const pill = captionsAss(captionChunks(segments, 1.2, findCaptionStyle("pill")), findCaptionStyle("pill"), dims);
    expect(pill).toMatch(/\\bord\d+\\3c&HED3A7C&/);
    const podcast = captionsAss(captionChunks(segments, 1.2, findCaptionStyle("podcast")), findCaptionStyle("podcast"), dims);
    expect(podcast.split("\n").filter((l) => l.startsWith("Dialogue:"))).toHaveLength(1);
    expect(podcast).toMatch(/,3,\d+,0,5,/); // opaque box border style
  });

  it("embeds fonts in the uuencoded [Fonts] section", () => {
    expect(encodeAssFont(Buffer.from([0, 0, 0]))).toBe("!!!!");
    expect(encodeAssFont(Buffer.from([255, 255, 255]))).toBe("````");
    expect(encodeAssFont(Buffer.from([1]))).toBe("!1");
    expect(encodeAssFont(Buffer.alloc(61)).split("\n").map((l) => l.length)).toEqual([80, 2]);
    const style = findCaptionStyle("classic");
    const ass = captionsAss(captionChunks(segments, 1.2, style), style, dims, { fonts: [{ file: "Anton.ttf", bytes: Buffer.from([1, 2, 3, 4]) }] });
    expect(ass).toContain("[Fonts]\nfontname: Anton.ttf\n!1)$\"!");
    expect(ass.indexOf("[Fonts]")).toBeLessThan(ass.indexOf("[V4+ Styles]"));
  });

  it("escapes the burn filter path", () => {
    expect(captionBurnFilter("/tmp/a:b/it's.ass")).toBe("ass=filename='/tmp/a\\:b/it'\\''s.ass'");
  });
});
