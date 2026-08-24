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
