import { describe, expect, it } from "vitest";
import {
  planSourceChannelCandidates,
  sourceChannelIdentity,
  sourceChannelNeedsExploration,
  sourceNicheCompatibility,
} from "./automationSourceStrategy.js";

describe("automation source strategy", () => {
  it("treats authors in one collection as separate channels", () => {
    expect(sourceChannelIdentity({ authorHandle: "@anime.one" })).toBe("anime.one");
    expect(sourceChannelIdentity({ playUrl: "https://www.tiktok.com/@anime.two/video/123" })).toBe("anime.two");
  });

  it("allows animation collections for anime agents but rejects sports", () => {
    const settings = { genreFocus: "Anime recaps", microNicheGoal: "Isekai power fantasy" };
    expect(sourceNicheCompatibility({ sourceCollectionTags: ["animation", "cartoon stories"] }, settings).match).toBe("related");
    expect(sourceNicheCompatibility({ sourceCollectionTags: ["football", "world cup"] }, settings).match).toBe("mismatch");
  });

  it("explores when samples are scarce or average views are weak", () => {
    expect(sourceChannelNeedsExploration({ profile: { samples: 2, totalViews: 5000 } }, {})).toBe(true);
    expect(sourceChannelNeedsExploration({ profile: { samples: 5, totalViews: 2000 } }, { sourceUnderperformingViewThreshold: 1000 })).toBe(true);
    expect(sourceChannelNeedsExploration({ profile: { samples: 5, totalViews: 10000 } }, { sourceUnderperformingViewThreshold: 1000 })).toBe(false);
  });

  it("interleaves niche-compatible channels during exploration", () => {
    const videos = [
      { id: "a1", authorHandle: "anime-a", sourceCollectionTags: ["anime"] },
      { id: "a2", authorHandle: "anime-a", sourceCollectionTags: ["anime"] },
      { id: "b1", authorHandle: "anime-b", sourceCollectionTags: ["animation"] },
      { id: "b2", authorHandle: "anime-b", sourceCollectionTags: ["animation"] },
      { id: "s1", authorHandle: "sports-c", sourceCollectionTags: ["football"] },
    ];
    const plan = planSourceChannelCandidates(videos, {
      seed: "run-1",
      settings: { genreFocus: "Anime", sourceNicheMode: "strict", sourceExplorationChannels: 4 },
      profileData: { profile: { samples: 4, totalViews: 800 } },
    });
    expect(plan.strategy.mode).toBe("explore");
    expect(plan.strategy.selectedChannels).toEqual(expect.arrayContaining(["anime-a", "anime-b"]));
    expect(plan.strategy.selectedChannels).not.toContain("sports-c");
    expect(new Set(plan.videos.slice(0, 2).map((video) => video.authorHandle)).size).toBe(2);
    expect(plan.videos.map((video) => video.id)).not.toContain("s1");
  });

  it("keeps strict niche filtering active when performance is healthy", () => {
    const plan = planSourceChannelCandidates([
      { id: "anime", authorHandle: "anime-a", sourceCollectionTags: ["anime"] },
      { id: "sports", authorHandle: "sports-b", sourceCollectionTags: ["football"] },
    ], {
      settings: { genreFocus: "Anime", sourceNicheMode: "strict" },
      profileData: { profile: { samples: 6, totalViews: 12000 } },
    });
    expect(plan.strategy.mode).toBe("exploit");
    expect(plan.videos.map((video) => video.id)).toEqual(["anime"]);
  });

  it("keeps original ranking when the channel is healthy", () => {
    const videos = [
      { id: "1", authorHandle: "a" },
      { id: "2", authorHandle: "b" },
    ];
    const plan = planSourceChannelCandidates(videos, {
      settings: { sourceExplorationEnabled: true },
      profileData: { profile: { samples: 6, totalViews: 12000 } },
    });
    expect(plan.strategy.mode).toBe("exploit");
    expect(plan.videos).toEqual(videos);
  });
});
