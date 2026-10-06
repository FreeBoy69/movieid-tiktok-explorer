import { describe, expect, it } from "vitest";
import { isVideoPageLink, youtubeThumbnailUrls, youtubeVideoId } from "./linkThumbnails.js";

describe("link thumbnails", () => {
  it("reads the video ID from every YouTube link shape", () => {
    for (const link of [
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s",
      "youtube.com/watch?v=dQw4w9WgXcQ",
      "https://m.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://youtu.be/dQw4w9WgXcQ?si=abc",
      "https://www.youtube.com/shorts/dQw4w9WgXcQ",
      "https://www.youtube.com/embed/dQw4w9WgXcQ",
      "https://www.youtube.com/live/dQw4w9WgXcQ?feature=share",
    ]) expect(youtubeVideoId(link)).toBe("dQw4w9WgXcQ");
    expect(youtubeVideoId("https://www.youtube.com/@channel")).toBe("");
    expect(youtubeVideoId("https://example.com/watch?v=dQw4w9WgXcQ")).toBe("");
  });

  it("lists thumbnails largest first", () => {
    expect(youtubeThumbnailUrls("https://youtu.be/dQw4w9WgXcQ")).toEqual([
      "https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg",
      "https://i.ytimg.com/vi/dQw4w9WgXcQ/sddefault.jpg",
      "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
    ]);
    expect(youtubeThumbnailUrls("https://example.com/a.png")).toEqual([]);
  });

  it("recognises other video sites", () => {
    expect(isVideoPageLink("https://www.tiktok.com/@a/video/123")).toBe(true);
    expect(isVideoPageLink("https://vimeo.com/76979871")).toBe(true);
    expect(isVideoPageLink("https://example.com/photo.jpg")).toBe(false);
  });
});
