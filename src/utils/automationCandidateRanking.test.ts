import { describe, expect, it } from "vitest";
import { rankAutomationCandidatesByEvidence, scoreAutomationCandidate } from "./automationCandidateRanking.js";

describe("automation candidate evidence ranking", () => {
  it("prioritizes channel-proven sources over large TikTok view counts", () => {
    const proven = { id: "proven", authorHandle: "james.jaan7", title: "football rivalry", viewCount: 100 };
    const viral = { id: "viral", authorHandle: "unknown", title: "football rivalry", viewCount: 10_000_000 };
    const ranked = rankAutomationCandidatesByEvidence([viral, proven], { profile: { bestSources: [{ label: "james.jaan7", uploads: 3, views: 9000 }] } });
    expect(ranked[0].id).toBe("proven");
  });

  it("uses fresh YouTube velocity but ignores signals older than 30 days", () => {
    const candidate = { title: "Salah transfer controversy", authorHandle: "source" };
    const now = Date.UTC(2026, 8, 2);
    const fresh = scoreAutomationCandidate(candidate, { now, youtubeSignals: [{ title: "Salah transfer controversy shocks fans", velocity: 5000, publishedAt: "2026-08-30T12:00:00Z" }] });
    const stale = scoreAutomationCandidate(candidate, { now, youtubeSignals: [{ title: "Salah transfer controversy shocks fans", velocity: 5000, publishedAt: "2026-07-01T12:00:00Z" }] });
    expect(fresh.score).toBeGreaterThan(stale.score + 20);
  });

  it("caps source-platform popularity as a tie-breaker", () => {
    expect(scoreAutomationCandidate({ title: "topic", viewCount: 100_000_000 }).platformTieBreaker).toBeLessThanOrEqual(5);
  });
});
