import { describe, expect, it } from "vitest";
import { fillsWidth, sceneAt, sceneTransform } from "./StoryboardPreview";

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

  it("moves stills the way the render's zoompan does, alternating by scene", () => {
    const scene = { start: 10, end: 14 };
    expect(sceneTransform(scene, 0, 10)).toEqual({ transform: "scale(1)", transformOrigin: "50% 50%" });
    expect(sceneTransform(scene, 0, 14).transform).toBe("scale(1.2)");
    expect(sceneTransform(scene, 1, 12)).toEqual({ transform: "scale(1.16)", transformOrigin: "50% 50%" });
    expect(sceneTransform(scene, 3, 11).transformOrigin).toBe("75% 50%");
  });

  it("letterboxes every ratio inside the fixed 16:9 stage", () => {
    expect(fillsWidth(16, 9)).toBe(true);
    expect(fillsWidth(21, 9)).toBe(true);
    expect(fillsWidth(4, 3)).toBe(false);
    expect(fillsWidth(1, 1)).toBe(false);
    expect(fillsWidth(9, 16)).toBe(false);
  });
});
