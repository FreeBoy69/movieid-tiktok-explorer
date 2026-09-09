import { describe, expect, it } from "vitest";
import { normalizeAvatarRemake, timelineNeedsReedit, avatarProviderStatus } from "./avatarRemake.js";

describe("avatarRemake", () => {
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
