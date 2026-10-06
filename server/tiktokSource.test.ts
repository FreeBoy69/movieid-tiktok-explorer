import { describe, expect, it } from "vitest";
import { resolveTikTokSource } from "./tiktokSource.js";

// A fake fetch: redirects for short links, oEmbed answers for videos.
function fakeFetch(redirects: Record<string, string>, authors: Record<string, string> = {}) {
  return async (url: string) => {
    const target = redirects[url];
    if (target) return new Response(null, { status: 302, headers: { location: target } });
    const oembed = url.match(/oembed\?url=.*video%2F(\d+)/);
    if (oembed) {
      const handle = authors[oembed[1]];
      return handle ? Response.json({ author_url: `https://www.tiktok.com/@${handle}` }) : new Response("", { status: 404 });
    }
    return new Response("", { status: 200 });
  };
}

describe("resolveTikTokSource", () => {
  it("keeps profile links and strips share tracking", async () => {
    const r = await resolveTikTokSource("https://www.tiktok.com/@khaby.lame?_t=ZM-8tE&_r=1", { fetcher: fakeFetch({}) as any });
    expect(r).toMatchObject({ url: "https://www.tiktok.com/@khaby.lame", handle: "khaby.lame", kind: "profile" });
  });

  it("accepts share text, a bare @handle, and a link without https", async () => {
    const f = fakeFetch({}) as any;
    expect((await resolveTikTokSource("Check out Khaby's profile on TikTok! https://www.tiktok.com/@khaby.lame?_t=1", { fetcher: f })).handle).toBe("khaby.lame");
    expect((await resolveTikTokSource("@khaby.lame", { fetcher: f })).url).toBe("https://www.tiktok.com/@khaby.lame");
    expect((await resolveTikTokSource("tiktok.com/@khaby.lame", { fetcher: f })).url).toBe("https://www.tiktok.com/@khaby.lame");
    expect((await resolveTikTokSource("m.tiktok.com/@khaby.lame/", { fetcher: f })).url).toBe("https://www.tiktok.com/@khaby.lame");
  });

  it("turns a video link into its channel", async () => {
    const r = await resolveTikTokSource("https://www.tiktok.com/@moviebuff/video/7454336365745032454?is_from_webapp=1", { fetcher: fakeFetch({}) as any });
    expect(r.url).toBe("https://www.tiktok.com/@moviebuff");
  });

  it("follows a phone short link whose redirect has an empty handle, then asks oEmbed", async () => {
    const f = fakeFetch(
      { "https://vm.tiktok.com/ZMkS5e1pX/": "https://www.tiktok.com/@/video/7454336365745032454?_r=1&share_item_id=7454336365745032454" },
      { "7454336365745032454": "moviebuff" },
    ) as any;
    expect(await resolveTikTokSource("https://vm.tiktok.com/ZMkS5e1pX/", { fetcher: f })).toMatchObject({ url: "https://www.tiktok.com/@moviebuff", kind: "profile" });
  });

  it("follows /t/ and h5 profile shares", async () => {
    const f = fakeFetch({
      "https://www.tiktok.com/t/ZT2abc/": "https://www.tiktok.com/@therock?_r=1",
      "https://m.tiktok.com/h5/share/usr/6745191554350760966.html": "https://www.tiktok.com/@therock?_r=1",
    }) as any;
    expect((await resolveTikTokSource("https://www.tiktok.com/t/ZT2abc/", { fetcher: f })).handle).toBe("therock");
    expect((await resolveTikTokSource("https://m.tiktok.com/h5/share/usr/6745191554350760966.html", { fetcher: f })).handle).toBe("therock");
  });

  it("falls back to the downloader when oEmbed has no answer", async () => {
    const f = fakeFetch({ "https://vm.tiktok.com/ZMx/": "https://www.tiktok.com/@/video/7454336365745032454" }) as any;
    const r = await resolveTikTokSource("https://vm.tiktok.com/ZMx/", { fetcher: f, authorFallback: async () => "@moviebuff" });
    expect(r.url).toBe("https://www.tiktok.com/@moviebuff");
  });

  it("keeps collections as collections", async () => {
    const r = await resolveTikTokSource("https://www.tiktok.com/@moviebuff/collection/Recaps-7300000000000000000", { fetcher: fakeFetch({}) as any });
    expect(r.kind).toBe("collection");
  });

  it("explains what went wrong", async () => {
    await expect(resolveTikTokSource("https://youtube.com/@x", { fetcher: fakeFetch({}) as any })).rejects.toThrow(/isn't a TikTok link/);
    await expect(resolveTikTokSource("https://vm.tiktok.com/dead/", { fetcher: fakeFetch({ "https://vm.tiktok.com/dead/": "https://www.tiktok.com/?_r=1" }) as any })).rejects.toThrow(/short link/);
  });
});
