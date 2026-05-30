import { describe, expect, it } from "vitest";

import {
  channelVideoKindMatches,
  normalizeChannelVideoKind,
  shouldContinueChannelVideoBucket,
} from "./channelVideoBuckets.js";

describe("channel video buckets", () => {
  it("splits YouTube shorts from long-form videos at three minutes", () => {
    expect(channelVideoKindMatches({ durationSeconds: 180 }, "shorts")).toBe(true);
    expect(channelVideoKindMatches({ durationSeconds: 181 }, "shorts")).toBe(false);
    expect(channelVideoKindMatches({ durationSeconds: 180 }, "videos")).toBe(false);
    expect(channelVideoKindMatches({ durationSeconds: 181 }, "videos")).toBe(true);
  });

  it("keeps bucket paging until it fills the requested result page", () => {
    expect(shouldContinueChannelVideoBucket({
      kind: "videos",
      resultCount: 3,
      targetCount: 12,
      nextPageToken: "older-page",
      pagesScanned: 1,
      maxPages: 6,
    })).toBe(true);

    expect(shouldContinueChannelVideoBucket({
      kind: "videos",
      resultCount: 12,
      targetCount: 12,
      nextPageToken: "older-page",
      pagesScanned: 2,
      maxPages: 6,
    })).toBe(false);
  });

  it("treats missing or unknown kind as mixed dashboard loading", () => {
    expect(normalizeChannelVideoKind("video")).toBe("all");
    expect(normalizeChannelVideoKind("shorts")).toBe("shorts");
    expect(channelVideoKindMatches({ durationSeconds: 90 }, "all")).toBe(true);
  });
});
