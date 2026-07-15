import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AgentChatBlocks, FormattedChatText, type AgentChatBlock } from "./AgentStructuredContent";

const report = {
  generatedAt: "2026-07-15T10:00:00.000Z",
  windowDays: 30,
  uploads30d: 12,
  views30d: 42800,
  avgViews30d: 3567,
  bestViews30d: 18400,
  uploadsAbove1k: 8,
  uploadsAbove10k: 2,
  recentSuccess7d: 5,
  recentFailures7d: 1,
  topSources: [{ author: "@cinemalab", uploads: 5, views: 26000, avgViews: 5200, promoted: true }],
  weakSources: [{ author: "@slowcuts", uploads: 3, bestViews: 420 }],
  recommendations: ["Use the strongest source before broad collection picks."],
};

describe("AgentChatBlocks", () => {
  it("renders report, linked channel cards, video cards, and an audio player", () => {
    const blocks: AgentChatBlock[] = [
      { type: "report", report },
      {
        type: "channels",
        items: [{
          id: "channel-1",
          title: "Cinema Lab",
          url: "https://www.youtube.com/@cinemalab",
          platform: "youtube",
          subscriberCount: 42000,
          bestViewsPerHour: 850,
          description: "A close match for movie recap hooks.",
        }],
      },
      {
        type: "videos",
        items: [{
          id: "video-1",
          title: "The ending nobody expected",
          url: "https://www.youtube.com/watch?v=video-1",
          source: "Cinema Lab",
          views: 98000,
          viewsPerHour: 1200,
        }],
      },
      {
        type: "audio",
        audio: {
          id: "audio-1",
          title: "Generated speech",
          voiceName: "Prime",
          text: "The truth was hidden in plain sight.",
          audioUrl: "/api/voicebox/audio/audio-1",
        },
      },
    ];

    render(<AgentChatBlocks blocks={blocks} />);

    expect(screen.getByText("Last 30 days")).toBeInTheDocument();
    expect(screen.getByText("42.8K")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Cinema Lab/i })).toHaveAttribute("href", "https://www.youtube.com/@cinemalab");
    expect(screen.getByRole("link", { name: "Open The ending nobody expected" })).toHaveAttribute("href", "https://www.youtube.com/watch?v=video-1");
    expect(screen.getByRole("button", { name: "Play audio" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Download audio" })).toHaveAttribute("href", "/api/voicebox/audio/audio-1");
  });

  it("formats headings, bullets, numbering, and emphasis without HTML injection", () => {
    render(<FormattedChatText content={"## Summary\n- Strong **retention**\n1. Keep the current cadence"} />);

    expect(screen.getByRole("heading", { name: "Summary" })).toBeInTheDocument();
    expect(screen.getByText("retention").tagName).toBe("STRONG");
    expect(screen.getByText("Keep the current cadence")).toBeInTheDocument();
  });
});
