import { describe, expect, it } from "vitest";
import { fillsWidth, pushScale, sceneAt } from "./StoryboardPreview";

const scenes = [
  { id: "a", start: 0, end: 4.5 },
  { id: "b", start: 4.5, end: 9 },
  { id: "c", start: 9, end: 12 },
];

describe("storyboard preview timing", () => {
  it("shows the scene that covers the playhead, with hard cuts at boundaries", () => {
    expect(sceneAt(scenes, 0)).toBe(0);
    expect(sceneAt(scenes, 4.49)).toBe(0);
    expect(sceneAt(scenes, 4.5)).toBe(1);
    expect(sceneAt(scenes, 11.99)).toBe(2);
    expect(sceneAt(scenes, 99)).toBe(2);
    expect(sceneAt([], 3)).toBe(0);
  });

  it("matches the render's zoompan: +0.0004 per frame at 30fps, capped at 1.15", () => {
    expect(pushScale(0)).toBe(1);
    expect(pushScale(5)).toBeCloseTo(1 + 0.0004 * 30 * 5, 6);
    expect(pushScale(60)).toBe(1.15);
    expect(pushScale(-1)).toBe(1);
  });

  it("letterboxes every ratio inside the fixed 16:9 stage", () => {
    expect(fillsWidth(16, 9)).toBe(true);
    expect(fillsWidth(21, 9)).toBe(true);
    expect(fillsWidth(4, 3)).toBe(false);
    expect(fillsWidth(1, 1)).toBe(false);
    expect(fillsWidth(9, 16)).toBe(false);
  });
});
