import { describe, expect, it } from "vitest";
import { buildAgentAnalyticsViz, readAgentUploadMetric } from "./agentAnalyticsViz";
import type { AutomationRun, AutomationUpload } from "../types";

function upload(overrides: Partial<AutomationUpload>): AutomationUpload {
  return {
    id: "upload-1",
    youtubeVideoId: "video-1",
    youtubeUrl: "https://youtube.com/shorts/video-1",
    sourceUrl: "https://tiktok.com/video-1",
    sourceVideoId: "source-1",
    sourceAuthor: "source",
    movieTitle: "Example",
    movieYear: "2026",
    genre: "Action",
    microNiche: "academy battles",
    title: "Example upload",
    status: "scheduled",
    metrics: {},
    createdAt: Date.UTC(2026, 5, 1, 9),
    ...overrides,
  };
}

describe("buildAgentAnalyticsViz", () => {
  it("reads real persisted metrics across agent upload metric shapes", () => {
    const publicStatsUpload = upload({
      metrics: {
        viewCount: 0,
        publicStats: { viewCount: 17_801, likeCount: 942, commentCount: 71 },
      },
    });
    const analyticsTotalsUpload = upload({
      metrics: {
        publicStats: { viewCount: 0, likeCount: 0, commentCount: 0 },
        analytics: { totals: { views: 8_400, likes: 610, comments: 39 } },
      },
    });

    expect(readAgentUploadMetric(publicStatsUpload, "viewCount")).toBe(17_801);
    expect(readAgentUploadMetric(publicStatsUpload, "likeCount")).toBe(942);
    expect(readAgentUploadMetric(analyticsTotalsUpload, "viewCount")).toBe(8_400);
    expect(readAgentUploadMetric(analyticsTotalsUpload, "commentCount")).toBe(39);
  });

  it("builds chronological momentum points and ranked uploads from public metrics", () => {
    const uploads = [
      upload({ id: "later", title: "Later", createdAt: Date.UTC(2026, 5, 2, 9), youtubeVideoId: "youtube-later", metrics: { publicStats: { viewCount: 300, likeCount: 30, commentCount: 9 }, sourceThumbnailUrl: "https://img.example/later.jpg" } }),
      upload({ id: "earlier", title: "Earlier", createdAt: Date.UTC(2026, 5, 1, 9), metrics: { publicStats: { viewCount: 100, likeCount: 20, commentCount: 5 } } }),
    ];

    const result = buildAgentAnalyticsViz(uploads, []);

    expect(result.momentum.map((point) => point.views)).toEqual([100, 300]);
    expect(result.rankedUploads[0]).toMatchObject({
      id: "later",
      views: 300,
      thumbnailUrl: "https://img.example/later.jpg",
      playbackUrl: "https://www.youtube.com/embed/youtube-later?autoplay=1&rel=0",
    });
    expect(result.rankedUploads[1].engagementRate).toBe(25);
  });

  it("creates an in-app TikTok player URL when no YouTube video exists", () => {
    const result = buildAgentAnalyticsViz([
      upload({ youtubeVideoId: "", sourceVideoId: "7613318687973510430", metrics: { thumbnailUrl: "https://img.example/tiktok.jpg" } }),
    ], []);

    expect(result.rankedUploads[0]).toMatchObject({
      thumbnailUrl: "https://img.example/tiktok.jpg",
      playbackUrl: "https://www.tiktok.com/player/v1/7613318687973510430?autoplay=1",
    });
  });

  it("groups release performance by weekday and hour", () => {
    const uploads = [
      upload({ id: "one", scheduleAt: Date.UTC(2026, 5, 1, 9), metrics: { publicStats: { viewCount: 200 } } }),
      upload({ id: "two", scheduleAt: Date.UTC(2026, 5, 1, 9, 30), metrics: { publicStats: { viewCount: 400 } } }),
    ];

    const result = buildAgentAnalyticsViz(uploads, []);
    const mondayNine = result.releaseHeatmap.find((cell) => cell.day === 1 && cell.hour === 12);

    expect(mondayNine).toMatchObject({ uploads: 2, views: 600, averageViews: 300 });
  });

  it("summarizes operational reliability from completed runs", () => {
    const runs: AutomationRun[] = [
      { id: "success", status: "success", message: "ok", startedAt: 1, finishedAt: 2 },
      { id: "failed", status: "failed", message: "bad", startedAt: 3, finishedAt: 5 },
      { id: "running", status: "running", message: "working", startedAt: 6 },
    ];

    const result = buildAgentAnalyticsViz([], runs);

    expect(result.reliability).toEqual({
      success: 1,
      failed: 1,
      running: 1,
      total: 3,
      successRate: 33,
    });
  });
});
