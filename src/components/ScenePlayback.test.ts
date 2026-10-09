import { describe, expect, it } from "vitest";
import { sceneTransform } from "./ScenePlayback";

describe("storyboard scene playback", () => {
  it("moves stills the way the render's zoompan does, alternating by scene", () => {
    const scene = { start: 10, end: 14 };
    expect(sceneTransform(scene, 0, 10)).toEqual({ transform: "scale(1)", transformOrigin: "50% 50%" });
    expect(sceneTransform(scene, 0, 14).transform).toBe("scale(1.2)");
    expect(sceneTransform(scene, 1, 12)).toEqual({ transform: "scale(1.16)", transformOrigin: "50% 50%" });
    expect(sceneTransform(scene, 3, 11).transformOrigin).toBe("75% 50%");
  });
});
