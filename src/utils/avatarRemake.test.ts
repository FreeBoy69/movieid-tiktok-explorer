import { describe, expect, it } from "vitest";
import { normalizeAvatarRemake, timelineNeedsReedit, avatarProviderStatus, avatarScenePlan, avatarRegion } from "./avatarRemake.js";
import { createVoiceoverScene, splitSceneAtTime } from "./voiceoverTimeline.js";

describe("avatarRemake", () => {
  it("keeps split roles even when avatar replacement is enabled", () => {
    const plan = avatarScenePlan([{ start: 0, end: 3, role: "split", replaceAvatar: true, presenterSide: "right", splitAt: 0.6 }], 3);
    expect(plan[0].role).toBe("split");
    expect(avatarRegion(plan[0], 1280, 720)).toEqual({ x: 768, y: 0, width: 512, height: 720 });
  });

  it("rejects unknown layouts, incomplete timing and reordered footage", () => {
    expect(() => avatarScenePlan([{ start: 0, end: 3 }], 3)).toThrow(/identified/);
    expect(() => avatarScenePlan([{ start: 1, end: 3, role: "broll" }], 3)).toThrow(/gap/);
    expect(() => avatarScenePlan([{ start: 0, end: 2, role: "broll" }], 3)).toThrow(/complete/);
    expect(() => avatarScenePlan([{ start: 0, end: 3, role: "broll", sourceStart: "bad" }], 3)).toThrow(/synchronized/);
  });

  it("preserves detected presenter regions through timeline splits", () => {
    const scene = createVoiceoverScene({ start: 0, end: 3, role: "split", presenterSide: "top", splitAt: 0.4, replaceAvatar: true });
    const split = splitSceneAtTime([scene], 1);
    expect(split).toHaveLength(2);
    for (const part of split) expect(part).toMatchObject({ role: "split", presenterSide: "top", splitAt: 0.4, replaceAvatar: true });
    expect(split[0].id).not.toBe(split[1].id);
  });
  it("normalizes layout and provider defaults", () => {
    expect(normalizeAvatarRemake({})).toMatchObject({ layout: "split", provider: "preview" });
    expect(normalizeAvatarRemake({ layout: "full", provider: "heygen", splitRatio: 0.9 }).splitRatio).toBeLessThanOrEqual(0.7);
  });

  it("detects when timeline order needs a re-edit", () => {
    expect(timelineNeedsReedit([{ sourceStart: 0, sourceEnd: 3 }, { sourceStart: 3, sourceEnd: 6 }])).toBe(false);
    expect(timelineNeedsReedit([{ sourceStart: 3, sourceEnd: 6 }, { sourceStart: 0, sourceEnd: 3 }])).toBe(true);
  });

  it("reports preview as always available", () => {
    expect(avatarProviderStatus({}).preview.available).toBe(true);
    expect(avatarProviderStatus({ HEYGEN_API_KEY: "x" }).heygen.available).toBe(true);
    expect(avatarProviderStatus({ WAVESPEED_API_KEY: "y" }).longcat.available).toBe(true);
  });
});
