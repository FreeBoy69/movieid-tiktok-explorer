import { describe, expect, it } from "vitest";
import { buildChannelMetadataStyleProfile, metadataStyleSignatureFor } from "./channelMetadataStylePolicy.js";

const NOW = Date.parse("2026-08-19T00:00:00.000Z");

function video(id: string, viewCount: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    title: `A focused story title for ${id}`,
    description: "A concise explanation of the clip.",
    viewCount,
    likeCount: Math.round(viewCount * 0.05),
    commentCount: Math.round(viewCount * 0.01),
    publishedAt: "2026-07-20T00:00:00.000Z",
    ...overrides,
  };
}

describe("channel metadata style policy", () => {
  it("selects the top ten performance-backed videos and keeps source wording out of the profile", () => {
    const videos = Array.from({ length: 12 }, (_, index) => video(
      `video-${index + 1}`,
      (12 - index) * 1_000,
      { title: `Private wording that must not leak ${index + 1}`, description: `Description wording that must not leak ${index + 1}` },
    ));
    videos.push(video("invalid", 99_999, { title: "" }));

    const profile = buildChannelMetadataStyleProfile(videos, { now: NOW, platform: "youtube", videoKind: "shorts" });

    expect(profile.sampleCount).toBe(10);
    expect(profile.topPerformers.map((performer) => performer.id)).toEqual([
      "video-1", "video-2", "video-3", "video-4", "video-5",
      "video-6", "video-7", "video-8", "video-9", "video-10",
    ]);
    expect(profile.topPerformers.some((performer) => performer.id === "video-11")).toBe(false);
    expect(profile.scope).toEqual({ platform: "youtube", videoKind: "shorts" });
    expect(JSON.stringify(profile)).not.toContain("Private wording that must not leak");
    expect(JSON.stringify(profile)).not.toContain("Description wording that must not leak");
  });

  it("ranks by mature view velocity so old lifetime totals do not dominate newer winners", () => {
    const oldHit = video("old-hit", 100_000, {
      publishedAt: "2026-01-01T00:00:00.000Z",
      title: "Old title with a large lifetime total",
    });
    const recentWinner = video("recent-winner", 25_000, {
      publishedAt: "2026-08-12T00:00:00.000Z",
      title: "Recent title with stronger daily performance",
    });
    const supporting = [
      video("support-1", 20_000),
      video("support-2", 19_000),
      video("support-3", 18_000),
    ];

    const profile = buildChannelMetadataStyleProfile([oldHit, recentWinner, ...supporting], { now: NOW });

    expect(profile.topPerformers[0].id).toBe("recent-winner");
    expect(profile.topPerformers.find((performer) => performer.id === "recent-winner")?.viewsPerMatureDay)
      .toBeGreaterThan(profile.topPerformers.find((performer) => performer.id === "old-hit")?.viewsPerMatureDay || 0);
  });

  it("prioritizes repeated title and description structure across the top performers", () => {
    const repeated = Array.from({ length: 7 }, (_, index) => video(`winner-${index + 1}`, 20_000 - index * 700, {
      title: `When the Hero Faces a Betrayal Before the Final Battle ${index + 1}`,
      description: "The story context that makes this turn matter.\n\nFollow for more story breakdowns.\n\n#story #recap",
    }));
    const different = [
      video("other-1", 14_000, { title: "A Clear Hero Recap", description: "A direct recap of the scene." }),
      video("other-2", 13_000, { title: "The Final Battle Explained", description: "A direct recap of the scene." }),
      video("other-3", 12_000, { title: "Hero Returns Home", description: "A direct recap of the scene." }),
    ];

    const profile = buildChannelMetadataStyleProfile([...repeated, ...different], { now: NOW });
    const titlePriorityIds = profile.title.priorities.map((priority) => priority.id);
    const descriptionPriorityIds = profile.description.priorities.map((priority) => priority.id);

    expect(profile.enabled).toBe(true);
    expect(profile.apply).toBe(true);
    expect(profile.confidence.level).not.toBe("insufficient");
    expect(titlePriorityIds).toContain("title.framing.story-turn");
    expect(descriptionPriorityIds).toContain("description.layout.multi-paragraph");
    expect(descriptionPriorityIds).toContain("description.cta.end-of-description");
    expect(profile.title.priorities.find((priority) => priority.id === "title.framing.story-turn")).toMatchObject({
      count: 7,
      share: 0.7,
    });
  });

  it("does not let a one-off viral all-caps headline become a learned template", () => {
    const repeated = Array.from({ length: 9 }, (_, index) => video(`repeat-${index + 1}`, 12_000 - index * 400, {
      title: `After the Setback, the Hero Finds a New Way Forward ${index + 1}`,
      description: "The key context behind this moment.\n\nFollow for more story breakdowns.",
    }));
    const anomaly = video("anomaly", 200_000, {
      title: "THIS IS THE CRAZIEST SECRET EVER!!!",
      description: "THIS IS THE CRAZIEST SECRET EVER!!!",
    });

    const profile = buildChannelMetadataStyleProfile([...repeated, anomaly], { now: NOW });
    const titlePriorityIds = profile.title.priorities.map((priority) => priority.id);

    expect(titlePriorityIds).toContain("title.framing.story-turn");
    expect(titlePriorityIds).not.toContain("title.punctuation.exclamation");
    expect(profile.topPerformers[0].id).toBe("anomaly");
  });

  it("fails closed until there are at least three performance-backed videos", () => {
    const profile = buildChannelMetadataStyleProfile([
      video("one", 5_000),
      video("two", 4_000),
    ], { now: NOW });

    expect(profile.enabled).toBe(false);
    expect(profile.apply).toBe(false);
    expect(profile.confidence).toEqual({ level: "insufficient", score: 0 });
    expect(profile.title.priorities).toEqual([]);
    expect(profile.description.priorities).toEqual([]);
    expect(profile.reason).toContain("At least 3");
  });

  it("creates a structural signature without retaining title or description text", () => {
    const signature = metadataStyleSignatureFor({
      title: "Why Did the Hero Leave?",
      description: "The answer changes the whole story.\n\n#story #recap",
    });

    expect(signature).toMatchObject({
      title: { framing: "question", punctuation: "question-mark" },
      description: { layout: "multi-paragraph", hashtagLayout: "end-of-description", hasDescription: true },
    });
    expect(JSON.stringify(signature)).not.toContain("Hero Leave");
    expect(JSON.stringify(signature)).not.toContain("whole story");
  });
});
