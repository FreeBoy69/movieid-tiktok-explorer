import { describe, expect, it } from "vitest";
import { cachedDiscovery, clearDiscoveryCache, enrichDiscoveryChannels, hasChannelDetails, youtubeLinkTarget } from "./nicheDiscovery.js";
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

  it("judges faceless from the thumbnails when a vision model is available", async () => {
    let request: any = null;
    const vision = async (body: any) => {
      request = body;
      return { value: { channels: [{ id: "UCnew", faceless: false, confidence: 90, reason: "Host on camera in every thumbnail" }] } };
    };
    const videos = await enrichDiscoveryChannels([{ id: "b", channelId: "UCnew", channelTitle: "Night Tales" }], {
      youtube: fakeYouTube([]),
      faceless: () => ({ score: 50, hits: ["story"] }),
      vision,
    });
    const images = request.messages[0].content.filter((part: any) => part.type === "image_url");
    expect(images.map((part: any) => part.image_url.url)).toContain("https://i.ytimg.com/vi/a/mqdefault.jpg");
    const [channel] = rankDiscoveryChannels(videos, {});
    expect(channel).toMatchObject({ facelessScore: 4, facelessSource: "thumbnails", facelessReason: "Host on camera in every thumbnail" });
  });

  it("keeps search hits when the Data API isn't available", async () => {
    const hits = [{ id: "x", channelId: "UC1" }];
    expect(await enrichDiscoveryChannels(hits, {})).toEqual(hits);
  });

  it("keeps Topic channels out of fallback hits and shows channels past the limit as their hits", async () => {
    const youtube = async (path: string, params: any) => {
      if (path === "channels") return { items: [] };
      return { items: [] };
    };
    const calls: string[] = [];
    const counted = async (path: string, params: any) => { calls.push(path); return youtube(path, params); };
    const hits = [
      { id: "t1", channelId: "UCtopic", channelTitle: "Some Artist - Topic" },
      { id: "h1", channelId: "UCa", channelTitle: "A" },
      { id: "h2", channelId: "UCb", channelTitle: "B" },
    ];
    const out = await enrichDiscoveryChannels(hits, { youtube: counted, limit: 1 });
    // No channel came back, so no upload playlists were fetched; the hits stand in, past the limit too.
    expect(calls).toEqual(["channels"]);
    expect(out.map((v: any) => v.id).sort()).toEqual(["h1", "h2"]);
  });

  it("scores faceless thresholds honestly: titles alone start under the line, a 0-confidence verdict stays unsure", async () => {
    const titlesOnly = await enrichDiscoveryChannels([{ id: "b", channelId: "UCnew", channelTitle: "Night Tales" }], { youtube: fakeYouTube([]), faceless: () => ({ score: 0, hits: [] }) });
    expect(titlesOnly[0].facelessScore).toBeLessThan(50);
    const unsure = await enrichDiscoveryChannels([{ id: "b", channelId: "UCzero", channelTitle: "Zero" }], {
      youtube: async (path: string, params: any) => {
        const data: any = await fakeYouTube([])(path, params);
        if (path === "channels") data.items[0].id = "UCzero";
        return data;
      },
      vision: async () => ({ value: { channels: [{ id: "UCzero", faceless: false, confidence: 0, reason: "can't tell" }] } }),
    });
    expect(unsure[0].facelessScore).toBe(49);
  });
});

describe("cachedDiscovery", () => {
  it("shares one load between identical requests, and never keeps a failure", async () => {
    clearDiscoveryCache();
    let loads = 0;
    const load = async () => { loads += 1; await new Promise((r) => setTimeout(r, 5)); return { n: loads }; };
    const [a, b] = await Promise.all([cachedDiscovery("k1", load), cachedDiscovery("k1", load)]);
    expect(loads).toBe(1);
    expect(a).toBe(b);
    await expect(cachedDiscovery("k2", async () => { throw new Error("down"); })).rejects.toThrow("down");
    expect(await cachedDiscovery("k2", async () => "up")).toBe("up");
  });

  it("keeps a partial result only for minutes", async () => {
    clearDiscoveryCache();
    const realNow = Date.now;
    const start = realNow();
    try {
      Date.now = () => start;
      await cachedDiscovery("partial", async () => ({ ok: false }), { complete: (v: any) => v.ok });
      await cachedDiscovery("whole", async () => ({ ok: true }), { complete: (v: any) => v.ok });
      Date.now = () => start + 10 * 60 * 1000;
      expect(await cachedDiscovery("partial", async () => ({ ok: true, fresh: true }), { complete: (v: any) => v.ok })).toEqual({ ok: true, fresh: true });
      expect(await cachedDiscovery("whole", async () => ({ ok: true, fresh: true }), { complete: (v: any) => v.ok })).toEqual({ ok: true });
    } finally {
      Date.now = realNow;
    }
  });

  it("tells channel details from raw hits", () => {
    expect(hasChannelDetails([{ id: "x", channelId: "UC1" }])).toBe(false);
    expect(hasChannelDetails([{ id: "x", channelId: "UC1", channelVideoCount: 0 }])).toBe(true);
  });
});

describe("youtubeLinkTarget", () => {
  it("reads every kind of pasted YouTube link", () => {
    expect(youtubeLinkTarget("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10")).toEqual({ videoId: "dQw4w9WgXcQ" });
    expect(youtubeLinkTarget("https://youtu.be/dQw4w9WgXcQ")).toEqual({ videoId: "dQw4w9WgXcQ" });
    expect(youtubeLinkTarget("youtube.com/shorts/dQw4w9WgXcQ")).toEqual({ videoId: "dQw4w9WgXcQ" });
    expect(youtubeLinkTarget("https://m.youtube.com/channel/UCabc123")).toEqual({ channelId: "UCabc123" });
    expect(youtubeLinkTarget("https://www.youtube.com/@NightTales/videos")).toEqual({ handle: "NightTales" });
    expect(youtubeLinkTarget("https://www.youtube.com/c/NightTales")).toEqual({ handle: "NightTales" });
    expect(youtubeLinkTarget("https://www.youtube.com/user/nighttales")).toEqual({ user: "nighttales" });
    expect(youtubeLinkTarget("https://www.youtube.com/NightTales")).toEqual({ handle: "NightTales" });
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
