import { describe, expect, it } from "vitest";

import { shouldPrefetchChannelVideoPage } from "./channelVideoPaging.js";

describe("shouldPrefetchChannelVideoPage", () => {
  it("keeps looking for long videos when the loaded page only contains shorts", () => {
    expect(shouldPrefetchChannelVideoPage({
      workspaceTab: "videos",
      longVideoCount: 0,
      nextPageToken: "next-page",
      loadingMore: false,
      error: "",
    })).toBe(true);
  });

  it("stops prefetching once a long video is available", () => {
    expect(shouldPrefetchChannelVideoPage({
      workspaceTab: "videos",
      longVideoCount: 1,
      nextPageToken: "next-page",
      loadingMore: false,
      error: "",
    })).toBe(false);
  });
});
