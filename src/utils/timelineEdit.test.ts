import { describe, expect, it } from "vitest";
import { mergeScenes, removeScene, rulerLabel, rulerTicks, snapTime, splitAt, tickStep, timecode, trimBoundary } from "./timelineEdit.js";

const lines = [
  { start: 0, end: 2, text: "One." },
  { start: 2, end: 5, text: "Two." },
  { start: 5, end: 8, text: "Three." },
];
const scenes = [
  { id: "scene-a", start: 0, end: 5, text: "One. Two.", asset: "/a.png", prompt: "a" },
  { id: "scene-b", start: 5, end: 8, text: "Three.", asset: "/b.png", prompt: "b" },
];

describe("timeline formatting", () => {
  it("formats frame-accurate timecode at 30fps", () => {
    expect(timecode(0)).toBe("00:00:00");
    expect(timecode(83.5)).toBe("01:23:15");
    expect(timecode(3661)).toBe("1:01:01:00");
    expect(rulerLabel(65)).toBe("1:05");
  });

  it("spaces labelled ticks at least the minimum gap apart", () => {
    expect(tickStep(100)).toBe(1);
    expect(tickStep(10)).toBe(10);
    const ticks = rulerTicks(0, 2, 100);
    expect(ticks.filter((tick) => tick.major).map((tick) => tick.time)).toEqual([0, 1, 2]);
    expect(ticks).toHaveLength(11);
  });

  it("snaps to the nearest candidate inside the threshold", () => {
    expect(snapTime(4.93, [2, 5, 8], 0.1)).toEqual({ time: 5, snapped: true });
    expect(snapTime(4.5, [2, 5, 8], 0.1)).toEqual({ time: 4.5, snapped: false });
  });
});

describe("scene edits keep the timeline contiguous", () => {
  it("splits at the playhead and clears the right half's image", () => {
    const next = splitAt(scenes, 2, lines);
    expect(next.map((s) => [s.start, s.end])).toEqual([[0, 2], [2, 5], [5, 8]]);
    expect(next[0].text).toBe("One.");
    expect(next[1]).toMatchObject({ text: "Two.", asset: null, prompt: "a" });
    expect(new Set(next.map((s) => s.id)).size).toBe(3);
    expect(() => splitAt(scenes, 5.2, lines)).toThrow();
  });

  it("merges a scene with the next one", () => {
    const next = mergeScenes(scenes, 0, lines);
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({ id: "scene-a", start: 0, end: 8, asset: "/a.png", text: "One. Two. Three." });
  });

  it("moves a cut and keeps both sides at least half a second", () => {
    expect(trimBoundary(scenes, 0, 3, lines).map((s) => [s.start, s.end])).toEqual([[0, 3], [3, 8]]);
    expect(trimBoundary(scenes, 0, 7.9, lines)[0].end).toBe(7.5);
  });

  it("ripple-deletes into the neighbour", () => {
    expect(removeScene(scenes, 1, lines)).toEqual([{ ...scenes[0], end: 8, text: "One. Two. Three." }]);
    expect(removeScene(scenes, 0, lines)[0]).toMatchObject({ id: "scene-b", start: 0, end: 8 });
    expect(() => removeScene([scenes[0]], 0)).toThrow();
  });
});
