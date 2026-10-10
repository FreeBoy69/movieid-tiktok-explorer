import { describe, expect, it } from "vitest";
import {
  bookendFilter,
  brandedCaptionStyle,
  cleanEmojiPicks,
  clipCaptionSegments,
  clipFinishFilters,
  clipWords,
  fillerIndexes,
  keptDuration,
  keptSegments,
  remapTime,
  remapWords,
  trimFilter,
  withEmoji,
} from "./clipEdit.js";
import { CAPTION_FONTS, captionChunks, captionsAss, findCaptionStyle } from "../src/utils/captionStyles.js";

const w = (word: string, start: number, end: number) => ({ word, start, end });

describe("filler detection", () => {
  it("always flags hesitations, and like / you know only when set off by commas", () => {
    const words = [w("So,", 0, 0.3), w("um,", 0.3, 0.6), w("I", 0.6, 0.7), w("like", 0.7, 0.9), w("pizza.", 0.9, 1.3), w("It's,", 1.3, 1.6), w("like,", 1.6, 1.8), w("great,", 1.8, 2.1), w("you", 2.1, 2.2), w("know,", 2.2, 2.4), w("really", 2.4, 2.8), w("good.", 2.8, 3)];
    expect([...fillerIndexes(words)].sort((a, b) => a - b)).toEqual([1, 6, 8, 9]);
  });
  it("keeps a meaningful 'you know' and a verb 'like'", () => {
    const words = [w("Do", 0, 0.2), w("you", 0.2, 0.4), w("know", 0.4, 0.6), w("her?", 0.6, 0.9), w("I", 1, 1.1), w("like,", 1.1, 1.3), w("it", 1.3, 1.4)];
    expect(fillerIndexes(words).size).toBe(0);
  });
});

describe("kept segments", () => {
  it("returns the whole clip when there is nothing to cut", () => {
    const words = [w("one", 0.1, 0.5), w("two", 0.6, 1), w("three", 1.2, 1.9)];
    expect(keptSegments(words, 2)).toEqual([{ start: 0, end: 2 }]);
    expect(keptSegments([], 5)).toEqual([{ start: 0, end: 5 }]);
  });
  it("cuts long pauses but keeps a little air around each word", () => {
    const words = [w("hello", 0.1, 0.6), w("there", 2.0, 2.5)];
    expect(keptSegments(words, 2.6)).toEqual([{ start: 0, end: 0.68 }, { start: 1.92, end: 2.6 }]);
  });
  it("cuts filler words even when the gap around them is short", () => {
    const words = [w("This", 0, 0.3), w("is,", 0.3, 0.6), w("uh,", 0.65, 1.0), w("great.", 1.05, 1.5)];
    const spans = keptSegments(words, 1.5);
    expect(spans).toEqual([{ start: 0, end: 0.65 }, { start: 1.0, end: 1.5 }]);
    expect(keptDuration(spans)).toBe(1.15);
  });
  it("drops dead air before the first word and a hesitation at the end", () => {
    const words = [w("Right", 1.5, 1.9), w("now.", 2.0, 2.4), w("Um", 2.6, 2.9)];
    expect(keptSegments(words, 3.5)).toEqual([{ start: 1.42, end: 2.48 }]);
  });
});

describe("timeline remap", () => {
  const spans = [{ start: 0, end: 1 }, { start: 2, end: 3 }];
  it("moves kept times onto the joined timeline and snaps cut times forward", () => {
    expect(remapTime(0.5, spans)).toBe(0.5);
    expect(remapTime(2.5, spans)).toBe(1.5);
    expect(remapTime(1.5, spans)).toBe(1);
    expect(remapTime(9, spans)).toBe(2);
  });
  it("drops cut words and remaps the rest", () => {
    expect(remapWords([w("a", 0.2, 0.6), w("um", 1.2, 1.6), w("b", 2.1, 2.4)], spans)).toEqual([w("a", 0.2, 0.6), w("b", 1.1, 1.4)]);
  });
  it("builds clip-relative caption segments on the trimmed timeline", () => {
    const segments = [{ start: 10, end: 13, text: "a um b", words: [w("a", 10.2, 10.6), w("um", 11.2, 11.6), w("b", 12.1, 12.4)] }];
    expect(clipWords(segments, 10, 13)).toEqual([w("a", 0.2, 0.6), w("um", 1.2, 1.6), w("b", 2.1, 2.4)]);
    const out = clipCaptionSegments(segments, 10, 13, spans);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ text: "a b", start: 0.2, end: 1.4 });
    // Without word timings a segment keeps its text and clip-relative times.
    expect(clipCaptionSegments([{ start: 9, end: 11, text: "plain line" }], 10, 13)).toEqual([{ start: 0, end: 1, text: "plain line" }]);
  });
  it("joins kept spans with trim and concat", () => {
    expect(trimFilter(spans)).toBe("[0:v]trim=start=0.000:end=1.000,setpts=PTS-STARTPTS[v0];[0:a]atrim=start=0.000:end=1.000,asetpts=PTS-STARTPTS[a0];[0:v]trim=start=2.000:end=3.000,setpts=PTS-STARTPTS[v1];[0:a]atrim=start=2.000:end=3.000,asetpts=PTS-STARTPTS[a1];[v0][a0][v1][a1]concat=n=2:v=1:a=1[kv][ka]");
    expect(trimFilter([{ start: 0, end: 1 }], { audio: false })).toBe("[0:v]trim=start=0.000:end=1.000,setpts=PTS-STARTPTS[v0];[v0]concat=n=1:v=1:a=0[kv]");
  });
});

describe("emoji captions", () => {
  it("keeps real emoji for about one chunk in three", () => {
    const picks = cleanEmojiPicks({ emoji: { "0": "🔥", "1": "fire", "2": "❤️", "4": "🚀", "9": "💰", "x": "🧠" } }, 6);
    expect([...picks.entries()]).toEqual([[0, "🔥"], [2, "❤️"]]);
  });
  it("renders a picked emoji after its chunk's last word in the emoji face", () => {
    const style = findCaptionStyle("hormozi")!;
    const chunks = withEmoji(captionChunks([{ start: 0, end: 1, text: "make money", words: [w("make", 0, 0.4), w("money", 0.4, 0.9)] }], 1, style), new Map([[0, "💰"]]));
    const ass = captionsAss(chunks, style, { width: 720, height: 1280 });
    expect(ass).toContain("MONEY{\\r} {\\fnNoto Emoji}💰{\\fnMontserrat}");
  });
});

describe("brand kit", () => {
  it("lays the kit's colours and font over a caption style", () => {
    const style = findCaptionStyle("hormozi")!;
    const branded = brandedCaptionStyle(style, { primaryColor: "#FAFAFA", accentColor: "#FF3366", captionFont: "Anton" }, CAPTION_FONTS);
    expect(branded.colors).toMatchObject({ text: "#FAFAFA", active: "#FF3366", outline: style.colors.outline });
    expect(branded.font).toBe("Anton");
    expect(brandedCaptionStyle(style, { captionFont: "Comic Sans" }, CAPTION_FONTS).font).toBe(style.font);
  });
  it("appends the logo, then captions, after the framed picture", () => {
    expect(clipFinishFilters("framed", { captionFilter: "ass=filename='/tmp/a.ass'", logo: { index: 1, position: "bottom-left", opacity: 0.5 }, width: 720 })).toEqual({
      graph: [
        "[1:v]scale=115:-1,format=rgba,colorchannelmixer=aa=0.50[logo]",
        "[framed][logo]overlay=25:H-h-25:format=auto[branded]",
        "[branded]ass=filename='/tmp/a.ass'[captioned]",
        "[captioned]format=yuv420p[outv]",
      ],
      output: "outv",
    });
    expect(clipFinishFilters("framed").graph).toEqual(["[framed]format=yuv420p[outv]"]);
  });
  it("normalises intro and outro to the clip and fills silence", () => {
    const graph = bookendFilter([{ audio: false, duration: 2 }, { audio: true, duration: 30 }], { width: 720, height: 1280, fps: 30 });
    expect(graph).toContain("[0:v]scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=30,format=yuv420p[bv0]");
    expect(graph).toContain("anullsrc=r=48000:cl=stereo,atrim=duration=2.000[ba0]");
    expect(graph).toContain("[1:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[ba1]");
    expect(graph.endsWith("[bv0][ba0][bv1][ba1]concat=n=2:v=1:a=1[bv][ba]")).toBe(true);
  });
});
