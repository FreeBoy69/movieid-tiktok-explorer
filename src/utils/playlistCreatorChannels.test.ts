import { describe, expect, it } from "vitest";
import { playlistCreatorChannels } from "./automationSourceVideo.js";

describe("playlistCreatorChannels", () => {
  const v = (fields: Record<string, string>) => fields;

  it("ranks a collection's creators by how many of its videos they made", () => {
    const channels = playlistCreatorChannels([
      v({ authorHandle: "chef.max", playUrl: "https://www.tiktok.com/@chef.max/video/1" }),
      v({ authorHandle: "streeteats", playUrl: "https://www.tiktok.com/@streeteats/video/2" }),
      v({ authorHandle: "chef.max", playUrl: "https://www.tiktok.com/@chef.max/video/3" }),
      v({ playUrl: "https://www.tiktok.com/@nohandle/video/4" }),
      v({ authorHandle: "user", playUrl: "https://www.tiktok.com/video/5" }),
    ]);
    expect(channels).toEqual([
      { url: "https://www.tiktok.com/@chef.max", handle: "chef.max", count: 2 },
      { url: "https://www.tiktok.com/@nohandle", handle: "nohandle", count: 1 },
      { url: "https://www.tiktok.com/@streeteats", handle: "streeteats", count: 1 },
    ]);
  });

  it("skips channels already in the pool and respects the limit", () => {
    const videos = ["a", "b", "c", "d"].map((h) => v({ authorHandle: h }));
    const channels = playlistCreatorChannels(videos, { exclude: ["https://www.tiktok.com/@B?_t=x", "tiktok.com/@c"], limit: 1 });
    expect(channels.map((c) => c.handle)).toEqual(["a"]);
  });

  it("uses the uploader channel for YouTube playlists", () => {
    const channels = playlistCreatorChannels([
      v({ uploaderUrl: "https://www.youtube.com/@AnimeMovieExplainer", playUrl: "https://www.youtube.com/watch?v=abcdefghijk" }),
      v({ uploaderUrl: "https://www.youtube.com/@AnimeMovieExplainer/", playUrl: "https://www.youtube.com/watch?v=bbcdefghijk" }),
    ]);
    expect(channels).toEqual([{ url: "https://www.youtube.com/@AnimeMovieExplainer", handle: "/@animemovieexplainer", count: 2 }]);
  });
});
