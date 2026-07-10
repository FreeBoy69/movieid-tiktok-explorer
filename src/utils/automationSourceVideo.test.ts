import { describe, expect, it } from "vitest";
import {
  automationSourceKeyForVideo,
  automationVideoPlatform,
  automationVideoSourceUrl,
  isDirectChannelSourceUrl,
  normalizeAutomationSourceVideo,
  repairLegacyFakeTikTokYouTubeUrl,
} from "./automationSourceVideo.js";

describe("automationSourceVideo", () => {
  it("repairs legacy fake TikTok URLs that contain YouTube ids", () => {
    expect(repairLegacyFakeTikTokYouTubeUrl("https://www.tiktok.com/video/qSlLGG9mHB0"))
      .toBe("https://www.youtube.com/watch?v=qSlLGG9mHB0");
  });

  it("detects YouTube platform from saved channel url", () => {
    const video = normalizeAutomationSourceVideo(
      { id: "qSlLGG9mHB0", playUrl: "https://www.tiktok.com/video/qSlLGG9mHB0", title: "Short" },
      "https://www.youtube.com/@anime_dragons_den/shorts",
    );
    expect(video.sourcePlatform).toBe("youtube");
    expect(video.playUrl).toBe("https://www.youtube.com/watch?v=qSlLGG9mHB0");
  });

  it("keeps TikTok platform for numeric ids", () => {
    const video = normalizeAutomationSourceVideo(
      { id: "7636970555379289358", playUrl: "https://www.tiktok.com/@creator/video/7636970555379289358" },
      "https://www.tiktok.com/@creator",
    );
    expect(automationVideoPlatform(video)).toBe("tiktok");
    expect(automationVideoSourceUrl(video)).toContain("tiktok.com");
  });

  it("builds platform-specific source keys", () => {
    expect(automationSourceKeyForVideo({ id: "7636970555379289358" }, "https://www.tiktok.com/@creator"))
      .toBe("tiktok:7636970555379289358");
    expect(automationSourceKeyForVideo({ id: "qSlLGG9mHB0" }, "https://www.youtube.com/@channel/shorts"))
      .toBe("youtube:qSlLGG9mHB0");
  });

  it("distinguishes direct channel sources from collections and videos", () => {
    expect(isDirectChannelSourceUrl("https://www.tiktok.com/@blue.cut.movies")).toBe(true);
    expect(isDirectChannelSourceUrl("https://www.youtube.com/@anime_dragons_den")).toBe(true);
    expect(isDirectChannelSourceUrl("https://www.tiktok.com/@creator/video/7636970555379289358")).toBe(false);
    expect(isDirectChannelSourceUrl("https://www.youtube.com/playlist?list=PL123")).toBe(false);
  });
});
