import { describe, expect, it } from "vitest";
import { scenesFromDetection } from "../../scripts/detect-video-scenes.mjs";

describe("visual scene detection", () => {
  it("uses actual cut times without evenly dividing the video", () => {
    const scenes = scenesFromDetection("lavfi.scd.time=2.4\nlavfi.scd.time=8.1\n", 12);
    expect(scenes.map(scene => [scene.start, scene.end])).toEqual([[0, 2.4], [2.4, 8.1], [8.1, 12]]);
    expect(scenes.map(scene => [scene.sourceStart, scene.sourceEnd])).toEqual([[0, 2.4], [2.4, 8.1], [8.1, 12]]);
  });
  it("keeps an uncut video intact", () => {
    expect(scenesFromDetection("", 7200)).toHaveLength(1);
    expect(scenesFromDetection("", 7200)[0].end).toBe(7200);
  });
  it("removes duplicate, tiny and out-of-range boundaries", () => {
    const scenes = scenesFromDetection("lavfi.scd.time=0\nlavfi.scd.time=3\nlavfi.scd.time=3.1\nlavfi.scd.time=3\nlavfi.scd.time=9.9\nlavfi.scd.time=12\n", 10);
    expect(scenes.map(scene => scene.end)).toEqual([3, 10]);
  });
  it("rejects missing duration instead of inventing clips", () => {
    expect(() => scenesFromDetection("", NaN)).toThrow();
    expect(() => scenesFromDetection("", 0)).toThrow();
  });
});
