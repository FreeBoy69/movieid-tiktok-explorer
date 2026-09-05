import { describe, expect, it } from "vitest";
import {
  canonicalTikTokPostUrl,
  canonicalTikTokProfileUrl,
  extractTikTokVideoId,
  isTikTokUrl,
  normalizeTikTokInputUrl,
  parseTikTokUrl,
} from "./tiktokUrl.js";

describe("TikTok URL support", () => {
  it.each([
    ["https://www.tiktok.com/@creator/video/7450011223344556677?lang=en&is_from_webapp=1", "video", "7450011223344556677", "creator", "https://www.tiktok.com/@creator/video/7450011223344556677"],
    ["https://m.tiktok.com/@creator/video/7450011223344556677", "video", "7450011223344556677", "creator", "https://www.tiktok.com/@creator/video/7450011223344556677"],
    ["https://www.tiktok.com/@creator/photo/7450011223344556677?sender_device=pc", "photo", "7450011223344556677", "creator", "https://www.tiktok.com/@creator/photo/7450011223344556677"],
    ["https://www.tiktok.com/embed/v2/7450011223344556677", "video", "7450011223344556677", "", "https://www.tiktok.com/video/7450011223344556677"],
    ["https://www.tiktok.com/player/v1/7450011223344556677", "video", "7450011223344556677", "", "https://www.tiktok.com/video/7450011223344556677"],
    ["https://m.tiktok.com/v/7450011223344556677.html", "video", "7450011223344556677", "", "https://www.tiktok.com/video/7450011223344556677"],
    ["https://www.tiktok.com/share/video/7450011223344556677", "video", "7450011223344556677", "", "https://www.tiktok.com/video/7450011223344556677"],
    ["https://www.tiktok.com/aweme/v1/aweme/detail/?aweme_id=7450011223344556677", "video", "7450011223344556677", "", "https://www.tiktok.com/video/7450011223344556677"],
  ])("normalizes supported post form %s", (input, kind, id, handle, canonical) => {
    const parsed = parseTikTokUrl(input);

    expect(parsed).toMatchObject({ valid: true, kind, id, handle, url: canonical });
    expect(extractTikTokVideoId(input)).toBe(id);
    expect(canonicalTikTokPostUrl(input)).toBe(canonical);
  });

  it("recognizes all official short/share host and path variants without fabricating an ID", () => {
    for (const input of [
      "https://vm.tiktok.com/ZMabcdef/",
      "https://vt.tiktok.com/ZMabcdef/",
      "https://www.tiktok.com/t/ZMabcdef/",
      "https://m.tiktok.com/h5/share/usr/123.html",
    ]) {
      const parsed = parseTikTokUrl(input);
      expect(parsed).toMatchObject({ valid: true, kind: "short", id: "", isShortLink: true });
      expect(isTikTokUrl(input)).toBe(true);
      expect(normalizeTikTokInputUrl(input)).toBeTruthy();
    }
  });

  it("normalizes profiles, searches and collection URLs while preserving only useful parameters", () => {
    expect(canonicalTikTokProfileUrl("@creator.name")).toBe("https://www.tiktok.com/@creator.name");
    expect(normalizeTikTokInputUrl("tiktok.com/@creator.name/?lang=en")).toBe("https://www.tiktok.com/@creator.name");
    expect(normalizeTikTokInputUrl("https://www.tiktok.com/search?q=anime%20recaps&lang=en"))
      .toBe("https://www.tiktok.com/search?q=anime%20recaps");
    expect(normalizeTikTokInputUrl("https://www.tiktok.com/@creator/collection/Best-7450011223344556677?lang=en&mix_id=7450011223344556677"))
      .toBe("https://www.tiktok.com/@creator/collection/Best-7450011223344556677?mix_id=7450011223344556677");
  });

  it("accepts a TikTok URL pasted inside share text and rejects lookalike domains", () => {
    expect(normalizeTikTokInputUrl("Check this out: https://www.tiktok.com/@creator/video/7450011223344556677!"))
      .toBe("https://www.tiktok.com/@creator/video/7450011223344556677");
    expect(isTikTokUrl("https://not-tiktok.com/@creator/video/7450011223344556677")).toBe(false);
    expect(isTikTokUrl("https://tiktok.com.evil.example/@creator/video/7450011223344556677")).toBe(false);
  });
});
