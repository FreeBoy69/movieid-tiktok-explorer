import { describe, expect, it } from "vitest";
import { savedTikTokGenreScanKey } from "./savedTikTokPlaylists";

describe("saved TikTok genre scan sources", () => {
  it("allows saved channel feeds and playlists to reuse the saved source key", () => {
    expect(savedTikTokGenreScanKey(true, "https://www.tiktok.com/@iceberg.anime?lang=en")).toBe("https://www.tiktok.com/@iceberg.anime");
    expect(savedTikTokGenreScanKey(true, "https://www.tiktok.com/@iceberg.anime/collection/recaps-123?lang=en")).toBe("https://www.tiktok.com/@iceberg.anime/collection/recaps-123");
  });

  it("keeps unsaved TikTok sources out of persisted genre scans", () => {
    expect(savedTikTokGenreScanKey(false, "https://www.tiktok.com/@iceberg.anime")).toBe("");
    expect(savedTikTokGenreScanKey(true, "")).toBe("");
  });
});
