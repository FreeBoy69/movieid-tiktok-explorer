import { describe, expect, it } from "vitest";
import {
  buildYouTubeRadarSearchQueries,
  calculateYouTubeRadarScores,
  rankYouTubeRadarVideos,
  youtubeRadarRelevanceScore,
} from "./youtubeRadarPolicy.js";

describe("youtubeRadarPolicy", () => {
  it("expands a niche into focused search angles", () => {
    expect(buildYouTubeRadarSearchQueries("psychological sports anime", { duration: "short" })).toEqual([
      "psychological sports anime",
      "psychological sports anime recap",
      "psychological sports anime explained",
      "psychological sports anime story",
    ]);
  });

  it("rewards title-level niche matches", () => {
    const close = youtubeRadarRelevanceScore({
      title: "The darkest psychological sports anime explained",
      description: "",
      tags: ["anime recap"],
      channelTitle: "Recap Lab",
    }, "psychological sports anime");
    const distant = youtubeRadarRelevanceScore({
      title: "Daily celebrity news",
      description: "Trending entertainment updates",
      channelTitle: "News Daily",
    }, "psychological sports anime");
    expect(close).toBeGreaterThan(90);
    expect(distant).toBe(0);
  });

  it("ranks a fresh niche breakout over an older raw-view leader", () => {
    const fresh = calculateYouTubeRadarScores({
      viewCount: 180000,
      subscriberCount: 24000,
      viewsPerHour: 6200,
      likeCount: 14000,
      commentCount: 800,
      ageHours: 24,
      relevanceScore: 100,
      facelessScore: 80,
    });
    const old = calculateYouTubeRadarScores({
      viewCount: 2_000_000,
      subscriberCount: 2_500_000,
      viewsPerHour: 180,
      likeCount: 40000,
      commentCount: 1200,
      ageHours: 24 * 25,
      relevanceScore: 45,
      facelessScore: 70,
    });
    const ranked = rankYouTubeRadarVideos([
      { id: "old", ...old },
      { id: "fresh", ...fresh },
    ]);
    expect(ranked[0].id).toBe("fresh");
    expect(fresh.discoveryScore).toBeGreaterThan(old.discoveryScore);
  });
});
