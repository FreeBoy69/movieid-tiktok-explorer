import { describe, expect, it } from "vitest";
import {
  buildInitialScenes,
  moveScene,
  normalizeSceneOrder,
  splitSceneAtTime,
  swapAdjacentScenes,
  timelineDuration,
} from "../utils/voiceoverTimeline.js";

describe("voiceoverTimeline", () => {
  it("builds sequential scenes covering the duration", () => {
    const scenes = buildInitialScenes(10, { sceneCount: 4 });
    expect(scenes).toHaveLength(4);
    expect(timelineDuration(scenes)).toBeCloseTo(10, 2);
    expect(scenes[0].start).toBe(0);
    expect(scenes.at(-1)?.end).toBeCloseTo(10, 2);
  });

  it("lets humans move a scene to any index", () => {
    const scenes = buildInitialScenes(9, { sceneCount: 3 });
    const moved = moveScene(scenes, 0, 2);
    expect(moved.map((scene) => scene.sourceStart)).toEqual([
      scenes[1].sourceStart,
      scenes[2].sourceStart,
      scenes[0].sourceStart,
    ]);
    expect(moved[0].start).toBe(0);
    expect(timelineDuration(moved)).toBeCloseTo(9, 2);
  });

  it("only allows adjacent swaps for agent nudges", () => {
    const scenes = buildInitialScenes(6, { sceneCount: 3 });
    expect(swapAdjacentScenes(scenes, 0, 1)?.map((scene) => scene.sourceStart)).toEqual([
      scenes[1].sourceStart,
      scenes[0].sourceStart,
      scenes[2].sourceStart,
    ]);
    expect(swapAdjacentScenes(scenes, 0, 2)).toBeNull();
  });

  it("splits a scene at the playhead", () => {
    const scenes = buildInitialScenes(8, { sceneCount: 1 });
    const split = splitSceneAtTime(scenes, 3);
    expect(split).toHaveLength(2);
    expect(split[0].end).toBeCloseTo(3, 2);
    expect(split[1].start).toBeCloseTo(3, 2);
    expect(normalizeSceneOrder(split)).toHaveLength(2);
  });
});
