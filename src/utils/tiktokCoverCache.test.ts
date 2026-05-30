import { describe, expect, it } from "vitest";
import {
  freshTikTokCover,
  isExpiredTikTokSignedCoverUrl,
  isLocalTikTokCoverUrl,
  applyCachedTikTokCover,
} from "./tiktokCoverCache.js";

describe("TikTok cover cache helpers", () => {
  it("treats expired TikTok CDN covers as stale but keeps local cached covers fresh", () => {
    const expired = "https://p16-sign.tiktokcdn-us.com/tos-useast5-avt-0068-tx/o.jpg?x-expires=1000&x-signature=abc";
    const local = "/api/tiktok/covers/abc123.jpg";

    expect(isExpiredTikTokSignedCoverUrl(expired, 2_000_000)).toBe(true);
    expect(freshTikTokCover(expired, 2_000_000)).toBe("");
    expect(isLocalTikTokCoverUrl(local)).toBe(true);
    expect(freshTikTokCover(local, 2_000_000)).toBe(local);
  });

  it("replaces a stale TikTok cover with the cached local cover while preserving the source", () => {
    const source = "https://p16-sign.tiktokcdn-us.com/tos-useast5-avt-0068-tx/o.jpg?x-expires=1000&x-signature=abc";
    const cached = "/api/tiktok/covers/vid_123.jpg";

    const video = applyCachedTikTokCover(
      {
        id: "123",
        dynamicCover: source,
      },
      cached,
      2_000_000,
    );

    expect(video.dynamicCover).toBe(cached);
    expect(video.thumbnailSourceUrl).toBe(source);
  });
});
