import { describe, expect, it } from "vitest";
import {
  buildDeepLinkHref,
  normalizeInternalAppPath,
  readDeepLinkFromLocation,
  type TikTokDeepLink,
} from "./tiktokRoute";

function parseHref(href: string) {
  const url = new URL(href, "https://autoyt.test");
  return readDeepLinkFromLocation(url.pathname, url.search);
}

function queryFor(href: string): URLSearchParams {
  return new URL(href, "https://autoyt.test").searchParams;
}

describe("TikTok deep links", () => {
  it("opens Explore at the site root and links Explore back to it", () => {
    expect(readDeepLinkFromLocation("/", "")).toMatchObject({ view: "tools" });
    expect(readDeepLinkFromLocation("/tools", "")).toMatchObject({ view: "tools" });
    expect(readDeepLinkFromLocation("/", "?view=automation")).toMatchObject({ view: "automation" });
    expect(buildDeepLinkHref({ view: "tools" })).toBe("/");
    expect(readDeepLinkFromLocation("/studio/apps", "")).toMatchObject({ view: "tools" });
    expect(readDeepLinkFromLocation("/studio/image", "")).toMatchObject({ view: "studio", studioTab: "image" });
  });

  it("keeps digital product projects on a persistent route", () => {
    expect(readDeepLinkFromLocation("/products", "")).toEqual({ view: "products" });
    expect(buildDeepLinkHref({ view: "products" })).toBe("/products");
    expect(readDeepLinkFromLocation("/products/book%20one/reader", "")).toMatchObject({ view: "products", productId: "book one", productTab: "read" });
    expect(buildDeepLinkHref({ view: "products", productId: "book one", productTab: "read" })).toBe("/products/book%20one/reader");
  });

  it("round-trips inner pages for channel videos, studio generations, project scenes, and agent uploads", () => {
    expect(readDeepLinkFromLocation("/channels/video/yt%2F1", "")).toMatchObject({ view: "channels", channelVideoId: "yt/1" });
    expect(buildDeepLinkHref({ view: "channels", channelVideoId: "yt/1" })).toBe("/channels/video/yt%2F1");
    expect(readDeepLinkFromLocation("/studio/image/generations/gen_1", "")).toMatchObject({ view: "studio", studioTab: "image", studioGenerationId: "gen_1" });
    expect(buildDeepLinkHref({ view: "studio", studioTab: "image", studioGenerationId: "gen_1" })).toBe("/studio/image/generations/gen_1");
    expect(readDeepLinkFromLocation("/projects/p1/storyboard/scene/s%2F1", "")).toMatchObject({ view: "projects", projectId: "p1", projectStage: "storyboard", sceneId: "s/1" });
    expect(buildDeepLinkHref({ view: "projects", projectId: "p1", projectStage: "storyboard", sceneId: "s/1" })).toBe("/projects/p1/storyboard/scene/s%2F1");
    expect(readDeepLinkFromLocation("/agent/laura/uploads/up_1", "")).toMatchObject({ view: "automation", slug: "laura", uploadId: "up_1" });
    expect(buildDeepLinkHref({ view: "automation", slug: "laura", uploadId: "up_1" })).toBe("/agent/laura/uploads/up_1");
  });

  it("routes Create Film formats under /film and keeps /drama for series", () => {
    expect(readDeepLinkFromLocation("/film", "")).toEqual({ view: "drama", filmFormat: "hub" });
    expect(readDeepLinkFromLocation("/film/music", "")).toEqual({ view: "drama", filmFormat: "music" });
    expect(readDeepLinkFromLocation("/film/short/s1/ep/e2", "")).toEqual({ view: "drama", filmFormat: "short", seriesId: "s1", episodeId: "e2" });
    expect(buildDeepLinkHref({ view: "drama", filmFormat: "long", seriesId: "s1" })).toBe("/film/long/s1");
    expect(buildDeepLinkHref({ view: "drama", filmFormat: "hub" })).toBe("/film");
    expect(buildDeepLinkHref({ view: "drama", filmFormat: "series", seriesId: "s1" })).toBe("/drama/s1");
    expect(readDeepLinkFromLocation("/drama/s1", "")).toEqual({ view: "drama", seriesId: "s1" });
  });

  it("routes Vibe Edit with an optional project", () => {
    expect(readDeepLinkFromLocation("/vibe-edit", "")).toEqual({ view: "vibe-edit" });
    expect(readDeepLinkFromLocation("/vibe-edit/vp_abc", "")).toEqual({ view: "vibe-edit", projectId: "vp_abc" });
    expect(buildDeepLinkHref({ view: "vibe-edit", projectId: "vp_abc" })).toBe("/vibe-edit/vp_abc");
    expect(buildDeepLinkHref({ view: "vibe-edit" })).toBe("/vibe-edit");
  });

  it("routes the Tools suite at /tools/<id> and sends old Layers Studio links to its first tool", () => {
    expect(readDeepLinkFromLocation("/tools/transcriber", "")).toMatchObject({ view: "tool", toolId: "transcriber" });
    expect(readDeepLinkFromLocation("/tools/not-a-tool", "")).toMatchObject({ view: "tools" });
    expect(readDeepLinkFromLocation("/studio/layers", "")).toMatchObject({ view: "tool", toolId: "background-remover" });
    expect(buildDeepLinkHref({ view: "tool", toolId: "poster-finder" })).toBe("/tools/poster-finder");
    expect(buildDeepLinkHref({ view: "tool" })).toBe("/");
  });

  it("builds canonical saved playlist, channel, and post paths", () => {
    expect(buildDeepLinkHref({ view: "tiktok", tab: "collection", slug: "Anime & Sci-Fi" })).toBe(
      "/tiktok/saved/playlist/Anime%20%26%20Sci-Fi",
    );
    expect(buildDeepLinkHref({ view: "tiktok", tab: "channel", slug: "creator name" })).toBe(
      "/tiktok/saved/channel/creator%20name",
    );
    expect(buildDeepLinkHref({ view: "tiktok", postSlug: "creator/clip 42" })).toBe(
      "/tiktok/post/creator%2Fclip%2042",
    );
    expect(buildDeepLinkHref({ view: "tiktok", section: "saved" })).toBe("/tiktok/saved");
  });

  it("round-trips a saved playlist with presentation state and its full return target", () => {
    const returnTo = "/tiktok/saved?layout=genres";
    const link: TikTokDeepLink = {
      view: "tiktok",
      tab: "collection",
      slug: "anime-recaps",
      tiktokSort: "date-desc",
      tiktokLength: "long",
      tiktokSavedView: "genres",
      returnTo,
    };

    const href = buildDeepLinkHref(link);
    expect(new URL(href, "https://autoyt.test").pathname).toBe("/tiktok/saved/playlist/anime-recaps");
    expect(Object.fromEntries(queryFor(href))).toEqual({
      sort: "date-desc",
      length: "long",
      layout: "genres",
      from: returnTo,
    });
    expect(parseHref(href)).toMatchObject({
      view: "tiktok",
      section: "analyze",
      tab: "collection",
      slug: "anime-recaps",
      tiktokSort: "date-desc",
      tiktokLength: "long",
      tiktokSavedView: "genres",
      returnTo,
    });
  });

  it("round-trips an unsaved channel URL without losing its parent results URL", () => {
    const sourceUrl = "https://www.tiktok.com/@creator";
    const returnTo = "/tiktok?tab=collection&url=https%3A%2F%2Fwww.tiktok.com%2Fcollection%2F123&sort=views-asc";
    const href = buildDeepLinkHref({
      view: "tiktok",
      tab: "channel",
      url: sourceUrl,
      tiktokSort: "views-asc",
      tiktokLength: "short",
      returnTo,
    });

    expect(new URL(href, "https://autoyt.test").pathname).toBe("/tiktok");
    expect(Object.fromEntries(queryFor(href))).toEqual({
      tab: "channel",
      url: sourceUrl,
      sort: "views-asc",
      length: "short",
      from: returnTo,
    });
    expect(parseHref(href)).toMatchObject({
      view: "tiktok",
      section: "analyze",
      tab: "channel",
      url: sourceUrl,
      tiktokSort: "views-asc",
      tiktokLength: "short",
      returnTo,
    });
  });

  it("round-trips a post route back to its channel route", () => {
    const returnTo = "/tiktok/saved/channel/creator?sort=date-asc&length=medium";
    const href = buildDeepLinkHref({
      view: "tiktok",
      postSlug: "creator-clip-42",
      returnTo,
    });

    expect(href).toBe(
      "/tiktok/post/creator-clip-42?from=%2Ftiktok%2Fsaved%2Fchannel%2Fcreator%3Fsort%3Ddate-asc%26length%3Dmedium",
    );
    expect(parseHref(href)).toMatchObject({
      view: "tiktok",
      section: "analyze",
      postSlug: "creator-clip-42",
      returnTo,
    });
  });

  it("omits default presentation values from canonical URLs", () => {
    const href = buildDeepLinkHref({
      view: "tiktok",
      tab: "collection",
      url: "https://www.tiktok.com/collection/123",
      tiktokSort: "views-desc",
      tiktokLength: "all",
      tiktokSavedView: "videos",
    });

    expect(Object.fromEntries(queryFor(href))).toEqual({
      tab: "collection",
      url: "https://www.tiktok.com/collection/123",
    });
  });

  it("ignores unsupported TikTok presentation query values", () => {
    expect(
      readDeepLinkFromLocation(
        "/tiktok",
        "?tab=invalid&sort=popular&length=feature&layout=cards&url=https%3A%2F%2Fwww.tiktok.com%2F%40creator",
      ),
    ).toEqual({
      view: "tiktok",
      section: "analyze",
      tab: undefined,
      url: "https://www.tiktok.com/@creator",
      returnTo: undefined,
      tiktokSort: undefined,
      tiktokLength: undefined,
      tiktokSavedView: undefined,
    });
  });

  it.each([
    ["/playlist/anime-recaps", "/tiktok/saved/playlist/anime-recaps"],
    ["/channel/creator", "/tiktok/saved/channel/creator"],
    ["/post/creator-clip-42", "/tiktok/post/creator-clip-42"],
  ])("reads legacy %s and rebuilds it as %s", (legacyPath, canonicalPath) => {
    expect(buildDeepLinkHref(readDeepLinkFromLocation(legacyPath))).toBe(canonicalPath);
  });
});

describe("Automation agent deep links", () => {
  it("uses a short persistent path for each agent tab", () => {
    expect(buildDeepLinkHref({ view: "automation", slug: "anime-recaps", automationTab: "setup" })).toBe("/agent/anime-recaps/setup");
    expect(buildDeepLinkHref({ view: "automation", slug: "anime-recaps", automationTab: "overview" })).toBe("/agent/anime-recaps/overview");
    expect(buildDeepLinkHref({ view: "automation", slug: "anime-recaps" })).toBe("/agent/anime-recaps/overview");
    expect(parseHref("/agent/anime-recaps/chat")).toMatchObject({ view: "automation", slug: "anime-recaps", automationTab: "chat" });
  });

  it("keeps legacy automation links readable while rebuilding them canonically", () => {
    const legacy = readDeepLinkFromLocation("/automation/anime-recaps", "?tab=setup");
    expect(legacy).toMatchObject({ view: "automation", slug: "anime-recaps", automationTab: "setup" });
    expect(buildDeepLinkHref(legacy)).toBe("/agent/anime-recaps/setup");
  });
});

describe("Compilation deep links", () => {
  it("round-trips a restorable search, result count, sort, and clip preview", () => {
    const returnTo = "/compile?mode=search&q=movie+recaps&count=100&loaded=40&sort=newest";
    const link: TikTokDeepLink = {
      view: "compile",
      compileMode: "search",
      compileQuery: "anime recap",
      compileCount: 100,
      compileLoaded: 40,
      compileSort: "newest",
      compileClipId: "clip/42",
      returnTo,
    };

    const href = buildDeepLinkHref(link);
    expect(new URL(href, "https://autoyt.test").pathname).toBe("/compile");
    expect(Object.fromEntries(queryFor(href))).toEqual({
      mode: "search",
      q: "anime recap",
      count: "100",
      loaded: "40",
      sort: "newest",
      clip: "clip/42",
      from: returnTo,
    });
    expect(parseHref(href)).toEqual({
      view: "compile",
      compileMode: "search",
      compileQuery: "anime recap",
      compileCount: 100,
      compileLoaded: 40,
      compileSort: "newest",
      compileClipId: "clip/42",
      returnTo,
    });
  });

  it("round-trips a channel URL while preserving the originating search", () => {
    const sourceUrl = "https://www.tiktok.com/@creator";
    const returnTo = "/compile?mode=search&q=anime+recap&count=80&loaded=20";
    const href = buildDeepLinkHref({
      view: "compile",
      compileMode: "url",
      compileQuery: sourceUrl,
      compileCount: 80,
      compileLoaded: 80,
      compileSort: "length",
      returnTo,
    });

    expect(parseHref(href)).toEqual({
      view: "compile",
      compileMode: "url",
      compileQuery: sourceUrl,
      compileCount: 80,
      compileLoaded: 80,
      compileSort: "length",
      compileClipId: undefined,
      returnTo,
    });
  });

  it("omits the default sort and normalizes numeric values", () => {
    const href = buildDeepLinkHref({
      view: "compile",
      compileMode: "search",
      compileQuery: "anime",
      compileCount: 9000,
      compileLoaded: 20.9,
      compileSort: "views",
    });

    expect(Object.fromEntries(queryFor(href))).toEqual({
      mode: "search",
      q: "anime",
      count: "5000",
      loaded: "20",
    });
    expect(parseHref(href)).toMatchObject({ compileCount: 5000, compileLoaded: 20 });
  });

  it("ignores invalid modes, sorts, and non-positive counts", () => {
    expect(readDeepLinkFromLocation("/compile", "?mode=feed&sort=popular&count=0&loaded=-2")).toEqual({
      view: "compile",
      compileMode: undefined,
      compileQuery: undefined,
      compileCount: undefined,
      compileLoaded: undefined,
      compileSort: undefined,
      compileClipId: undefined,
      returnTo: undefined,
    });
  });
});

describe("return target safety", () => {
  it("preserves same-origin paths, query strings, and hashes", () => {
    expect(normalizeInternalAppPath(" /compile?mode=search&q=anime#clips ")).toBe(
      "/compile?mode=search&q=anime#clips",
    );
    expect(normalizeInternalAppPath("/tiktok/saved/playlist/anime?layout=genres")).toBe(
      "/tiktok/saved/playlist/anime?layout=genres",
    );
  });

  it.each([
    "",
    "relative/path",
    "https://evil.example/path",
    "//evil.example/path",
    "/\\evil.example/path",
  ])("rejects unsafe return target %j", (target) => {
    expect(normalizeInternalAppPath(target)).toBeUndefined();
    const href = buildDeepLinkHref({ view: "tiktok", postSlug: "clip", returnTo: target });
    expect(queryFor(href).has("from")).toBe(false);
  });

  it("drops an unsafe encoded from value while parsing", () => {
    const search = `?from=${encodeURIComponent("https://evil.example/steal")}`;
    expect(readDeepLinkFromLocation("/tiktok/post/clip", search).returnTo).toBeUndefined();
    expect(readDeepLinkFromLocation("/compile", search).returnTo).toBeUndefined();
  });
});

describe("account settings routes", () => {
  it("round-trips each account section and ignores unknown ones", () => {
    expect(readDeepLinkFromLocation("/account", "")).toEqual({ view: "account" });
    expect(buildDeepLinkHref({ view: "account" })).toBe("/account");
    expect(buildDeepLinkHref({ view: "account", accountSection: "profile" })).toBe("/account");
    for (const section of ["billing", "usage", "channels", "telegram", "security"] as const) {
      const href = buildDeepLinkHref({ view: "account", accountSection: section });
      expect(href).toBe(`/account/${section}`);
      expect(parseHref(href)).toEqual({ view: "account", accountSection: section });
    }
    expect(readDeepLinkFromLocation("/account/nope", "")).toEqual({ view: "account" });
  });
});
