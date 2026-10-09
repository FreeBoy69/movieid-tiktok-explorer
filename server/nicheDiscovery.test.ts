import { describe, expect, it } from "vitest";
import { enrichDiscoveryChannels } from "./nicheDiscovery.js";
import { rankDiscoveryChannels } from "../src/utils/creatorPipeline.js";

const day = 86400000;
const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * day).toISOString();

function fakeYouTube(calls: string[]) {
  return async (path: string, params: any) => {
    calls.push(path);
    if (path === "channels")
      return {
        items: [
          {
            id: "UCnew",
            snippet: { title: "Night Tales", customUrl: "@nighttales", publishedAt: iso(400), thumbnails: { high: { url: "avatar.jpg" } } },
            statistics: { subscriberCount: "20000", videoCount: "3" },
            contentDetails: { relatedPlaylists: { uploads: "UUnew" } },
          },
        ],
      };
    if (path === "playlistItems") return { items: ["a", "b", "c"].map((videoId) => ({ contentDetails: { videoId } })) };
    if (path === "videos")
      return {
        items: params.id.split(",").map((id: string, i: number) => ({
          id,
          snippet: { title: `Scary story ${id}`, publishedAt: iso(10 + i * 20), defaultAudioLanguage: "en-US", thumbnails: { high: { url: `${id}.jpg` } } },
          statistics: { viewCount: String([9000, 120000, 15000][i]) },
          contentDetails: { duration: "PT42M" },
        })),
      };
    return { items: [] };
  };
}

describe("enrichDiscoveryChannels", () => {
  it("judges a channel on its latest uploads, not the search hit", async () => {
    const calls: string[] = [];
    const videos = await enrichDiscoveryChannels(
      [{ id: "b", channelId: "UCnew", channelTitle: "Night Tales", niche: "Horror", discoveryScore: 70 }],
      { youtube: fakeYouTube(calls), faceless: (title: string) => ({ score: 50, hits: /story/i.test(title) ? ["story"] : [] }) },
    );
    expect(calls).not.toContain("search");
    expect(videos).toHaveLength(3);
    const [channel] = rankDiscoveryChannels(videos, {});
    expect(channel).toMatchObject({ title: "Night Tales", handle: "@nighttales", thumbnailUrl: "avatar.jpg", medianViews: 15000, subscribers: 20000, videoCount: 3, language: "en", niche: "Horror" });
    expect(channel.bestVideo.id).toBe("b");
    expect(channel.recentVideo.id).toBe("a");
    // Every upload was fetched, so the oldest one is the first upload (50 days ago), not the
    // channel's creation date 400 days ago.
    expect(Math.round((Date.now() - channel.createdAt) / day)).toBe(50);
    expect(channel.facelessScore).toBeGreaterThanOrEqual(50);
  });

  it("keeps search hits when the Data API isn't available", async () => {
    const hits = [{ id: "x", channelId: "UC1" }];
    expect(await enrichDiscoveryChannels(hits, {})).toBe(hits);
  });
});

describe("rankDiscoveryChannels filters", () => {
  const video = (channelId: string, extra: any = {}) => ({ id: `${channelId}-v`, channelId, channelTitle: channelId, viewCount: 10000, publishedAt: iso(5), ...extra });

  it("excludes niches by whole word", () => {
    const ranked = rankDiscoveryChannels([video("Clean Car TV"), video("Cleaning Stories"), video("tvOS tips")], { excludeTerms: "clean, tv" });
    expect(ranked.map((c: any) => c.title).sort()).toEqual(["Cleaning Stories", "tvOS tips"]);
  });

  it("keeps channels with an unknown language and matches language prefixes", () => {
    const ranked = rankDiscoveryChannels([video("A", { language: "en-GB" }), video("B"), video("C", { language: "hi" })], { language: "en" });
    expect(ranked.map((c: any) => c.title).sort()).toEqual(["A", "B"]);
  });

  it("filters to likely monetized channels and sorts consistency by uploads a month", () => {
    const videos = [
      video("Busy", { channelMonetized: "likely", publishedAt: iso(1) }),
      { ...video("Busy", { channelMonetized: "likely" }), id: "busy-2", publishedAt: iso(15) },
      video("Slow", { channelMonetized: "likely", publishedAt: iso(1) }),
      { ...video("Slow", { channelMonetized: "likely" }), id: "slow-2", publishedAt: iso(90) },
      video("Small", { channelMonetized: "unlikely" }),
    ];
    expect(rankDiscoveryChannels(videos, { monetized: true, sort: "consistency" }).map((c: any) => c.title)).toEqual(["Busy", "Slow"]);
  });
});
