import { describe, expect, it } from "vitest";
import {
  assignStockClips,
  generateStockSearchTerms,
  keywordTerms,
  matchesAspect,
  pickRendition,
  searchStockVideos,
  stockFootageCapability,
  stockStartOffset,
  stockTrimSeconds,
  stockCredit,
} from "./stockFootage.js";

const json = (body: unknown, status = 200) =>
  ({ ok: status < 400, status, json: async () => body, headers: new Headers() }) as unknown as Response;

describe("stock footage capability", () => {
  it("is available only with a provider key", () => {
    expect(stockFootageCapability({})).toMatchObject({ available: false, providers: [] });
    expect(stockFootageCapability({ PEXELS_API_KEY: "k", COVERR_API_KEY: "c" })).toMatchObject({ available: true, providers: ["pexels", "coverr"] });
  });
});

describe("rendition selection", () => {
  it("keeps the orientation and picks the smallest file that covers the frame", () => {
    const files = [
      { url: "https://x/a.mp4", width: 640, height: 360 },
      { url: "https://x/b.mp4", width: 1920, height: 1080 },
      { url: "https://x/c.mp4", width: 1280, height: 720 },
      { url: "https://x/d.mp4", width: 720, height: 1280 },
    ];
    expect(pickRendition(files, "16:9")?.url).toBe("https://x/c.mp4");
    expect(pickRendition(files, "9:16")?.url).toBe("https://x/d.mp4");
    expect(pickRendition(files.slice(0, 1), "16:9")?.url).toBe("https://x/a.mp4");
    expect(matchesAspect(1080, 1080, "1:1")).toBe(true);
    expect(matchesAspect(1920, 1080, "9:16")).toBe(false);
  });
});

describe("searchStockVideos", () => {
  const env = { PEXELS_API_KEY: "p", PIXABAY_API_KEY: "x" };
  const pexels = {
    videos: [
      { id: 1, duration: 12, url: "https://www.pexels.com/video/1/", user: { name: "Ana" }, image: "https://i/1.jpg",
        video_files: [{ link: "https://v/1-sd.mp4", width: 640, height: 360, file_type: "video/mp4" }, { link: "https://v/1-hd.mp4", width: 1920, height: 1080, file_type: "video/mp4" }] },
      { id: 2, duration: 3, url: "https://www.pexels.com/video/2/", video_files: [{ link: "https://v/2.mp4", width: 1280, height: 720 }] },
    ],
  };
  const pixabay = {
    hits: [
      { id: 9, duration: 20, pageURL: "https://pixabay.com/videos/9/", user: "Bo", videos: { large: { url: "https://v/9-l.mp4", width: 1920, height: 1080 }, small: { url: "https://v/9-s.mp4", width: 960, height: 540 } } },
      { id: 8, duration: 20, pageURL: "https://pixabay.com/videos/8/", videos: { medium: { url: "https://v/8.mp4", width: 1080, height: 1920 } } },
    ],
  };

  it("merges providers, filters by orientation and minimum length, and records credits", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push(url);
      if (url.startsWith("https://api.pexels.com")) {
        expect((init.headers as Record<string, string>).Authorization).toBe("p");
        expect(url).toContain("orientation=landscape");
        return json(pexels);
      }
      return json(pixabay);
    }) as unknown as typeof fetch;
    const clips = await searchStockVideos("city traffic", { aspect: "16:9", minSeconds: 5, env, fetchImpl });
    expect(clips.map((c) => `${c.provider}:${c.id}`)).toEqual(["pexels:1", "pixabay:9"]);
    expect(clips[0]).toMatchObject({ url: "https://v/1-hd.mp4", author: "Ana", pageUrl: "https://www.pexels.com/video/1/" });
    expect(stockCredit(clips[1])).toBe("Pixabay by Bo (https://pixabay.com/videos/9/)");
    expect(calls).toHaveLength(2);
  });

  it("survives one failing provider and fails when every provider fails", async () => {
    const half = (async (url: string) => (url.includes("pexels") ? json({ error: "nope" }, 500) : json(pixabay))) as unknown as typeof fetch;
    const clips = await searchStockVideos("sky", { aspect: "16:9", env, fetchImpl: half });
    expect(clips.map((c) => c.provider)).toEqual(["pixabay"]);
    const none = (async () => json({}, 429)) as unknown as typeof fetch;
    await expect(searchStockVideos("sky", { aspect: "16:9", env, fetchImpl: none })).rejects.toThrow(/rate limit/);
    await expect(searchStockVideos("sky", { aspect: "16:9", env: {}, fetchImpl: none })).rejects.toThrow(/isn't set up/);
  });
});

describe("search terms", () => {
  it("falls back to keywords from the narration", () => {
    expect(keywordTerms("The ancient lighthouse guided fishermen through the storm", "Lighthouses", 2)).toEqual(["Lighthouses lighthouse", "Lighthouses fishermen"]);
  });

  it("uses the model's terms per scene and keeps keywords for scenes it skipped", async () => {
    const scenes = Array.from({ length: 45 }, (_, i) => ({ text: `Scene ${i} shows a quiet harbour town` }));
    const batches: number[] = [];
    const terms = await generateStockSearchTerms(scenes, {
      subject: "Harbour towns",
      amount: 2,
      ask: async (_system: string, payload: string) => {
        const input = JSON.parse(payload);
        batches.push(input.scenes.length);
        return { scenes: input.scenes.filter((s: any) => s.index !== 3).map((s: any) => ({ index: s.index, terms: [`Harbour ${s.index}!`, "fishing boats"] })) };
      },
    });
    expect(batches.sort((a, b) => b - a)).toEqual([40, 5]);
    expect(terms[0]).toEqual(["harbour 0", "fishing boats"]);
    expect(terms[44]).toEqual(["harbour 44", "fishing boats"]);
    expect(terms[3][0]).toContain("Harbour");
  });
});

describe("assignment and variants", () => {
  const clip = (id: number) => ({ provider: "pexels", id: String(id), url: "", width: 0, height: 0, duration: 10, pageUrl: "", author: "", thumbnail: "" });

  it("avoids reusing a clip until the pool runs out", () => {
    const picks = assignStockClips([[clip(1), clip(2)], [clip(1), clip(2)], [clip(1)], []]);
    expect(picks.map((p) => p?.id ?? null)).toEqual(["1", "2", "1", null]);
  });

  it("shuffles deterministically per seed", () => {
    const pool = [clip(1), clip(2), clip(3), clip(4), clip(5)];
    const a = assignStockClips([pool, pool, pool], { order: "random", seed: 7 }).map((p) => p?.id);
    const b = assignStockClips([pool, pool, pool], { order: "random", seed: 7 }).map((p) => p?.id);
    const c = assignStockClips([pool, pool, pool], { order: "random", seed: 8 }).map((p) => p?.id);
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(3);
    expect(a).not.toEqual(c);
  });

  it("trims enough footage for the variants and offsets each one", () => {
    expect(stockTrimSeconds(4, { maxClipSeconds: 12, variants: 1 })).toBe(4.5);
    expect(stockTrimSeconds(4, { maxClipSeconds: 12, variants: 3 })).toBe(12);
    expect(stockTrimSeconds(20, { maxClipSeconds: 12, variants: 2 })).toBe(20);
    expect(stockStartOffset(12, 4, 0)).toBe(0);
    expect(stockStartOffset(12, 4, 1)).toBe(4);
    expect(stockStartOffset(12, 4, 2)).toBe(8);
    expect(stockStartOffset(4.5, 4, 1)).toBeCloseTo(0.5, 2);
  });
});
