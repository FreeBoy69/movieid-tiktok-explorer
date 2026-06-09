import { describe, expect, it } from "vitest";
import { buildAgentAnalyticsViz } from "./agentAnalyticsViz";
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
  it("builds chronological momentum points and ranked uploads from public metrics", () => {
    const uploads = [
      upload({ id: "later", title: "Later", createdAt: Date.UTC(2026, 5, 2, 9), metrics: { viewCount: 300, likeCount: 30, commentCount: 9 } }),
      upload({ id: "earlier", title: "Earlier", createdAt: Date.UTC(2026, 5, 1, 9), metrics: { viewCount: 100, likeCount: 20, commentCount: 5 } }),
    ];

    const result = buildAgentAnalyticsViz(uploads, []);

    expect(result.momentum.map((point) => point.views)).toEqual([100, 300]);
    expect(result.rankedUploads[0]).toMatchObject({ id: "later", views: 300 });
    expect(result.rankedUploads[1].engagementRate).toBe(25);
  });

  it("groups release performance by weekday and hour", () => {
    const uploads = [
      upload({ id: "one", scheduleAt: Date.UTC(2026, 5, 1, 9), metrics: { viewCount: 200 } }),
      upload({ id: "two", scheduleAt: Date.UTC(2026, 5, 1, 9, 30), metrics: { viewCount: 400 } }),
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
