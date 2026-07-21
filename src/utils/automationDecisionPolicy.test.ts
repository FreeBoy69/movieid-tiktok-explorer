import { describe, expect, it } from "vitest";
import {
  applyAutomationDecisionSettings,
  automationDecisionCandidateAdjustment,
  buildAutomationDecisionPolicy,
  classifyAutomationFailure,
} from "./automationDecisionPolicy.js";

const learning = {
  profile: {
    samples: 8,
    totalViews: 16000,
    bestHooks: [
      { label: "underdog-reveal", uploads: 4, views: 12000, score: 12000 },
      { label: "mystery-reveal", uploads: 2, views: 3000, score: 3000 },
    ],
    bestMicroNiches: [{ label: "anime comeback", uploads: 4, views: 12000, score: 12000 }],
    bestDurations: [{ label: "31-60s", uploads: 4, views: 12000, score: 12000 }],
    bestFormats: [{ label: "short recap", uploads: 4, views: 12000, score: 12000 }],
    bestHours: [{ label: "15", uploads: 3, views: 9000, score: 9000 }],
  },
};

describe("automation decision policy", () => {
  it("learns first, explores weak performance, and exploits healthy performance", () => {
    expect(buildAutomationDecisionPolicy({ learning: { profile: { samples: 2, totalViews: 400 } } }).phase).toBe("learn");
    expect(buildAutomationDecisionPolicy({ learning: { profile: { samples: 6, totalViews: 1200 } } }).phase).toBe("explore");
    expect(buildAutomationDecisionPolicy({ learning }).phase).toBe("exploit");
  });

  it("selects proven content and timing patterns in exploit mode", () => {
    const policy = buildAutomationDecisionPolicy({
      settings: { maxPostsPerDay: 1, scheduleTimes: ["09:30"], adaptiveSchedulingEnabled: true },
      learning,
      seed: "run-1",
    });
    expect(policy.preferredHook).toBe("underdog-reveal");
    expect(policy.preferredNiche).toBe("anime comeback");
    expect(policy.preferredDuration).toBe("31-60s");
    expect(policy.preferredScheduleTimes).toEqual(["18:30"]);
    expect((applyAutomationDecisionSettings({ scheduleTimes: ["09:30"] }, policy) as { scheduleTimes?: string[] }).scheduleTimes).toEqual(["18:30"]);
  });

  it("runs bounded timing experiments while performance is weak", () => {
    const policy = buildAutomationDecisionPolicy({
      settings: { maxPostsPerDay: 2, scheduleTimes: ["09:00", "18:00"], adaptiveSchedulingEnabled: true },
      learning: { profile: { ...learning.profile, totalViews: 800 } },
      seed: "timing-test",
    });
    expect(policy.phase).toBe("explore");
    expect(policy.preferredScheduleTimes).toHaveLength(2);
    expect(policy.preferredScheduleTimes).not.toEqual(["09:00", "18:00"]);
    for (const time of policy.preferredScheduleTimes) {
      const hour = Number(time.split(":")[0]);
      expect(hour).toBeGreaterThanOrEqual(6);
      expect(hour).toBeLessThanOrEqual(23);
    }
  });

  it("classifies terminal and retryable failures", () => {
    expect(classifyAutomationFailure("OAuth refresh token expired")).toMatchObject({ category: "authentication", retryable: false });
    expect(classifyAutomationFailure("Downloaded video has no audio stream")).toMatchObject({ category: "media", retryable: true });
    expect(classifyAutomationFailure("No source videos found for this agent")).toMatchObject({ category: "source_exhausted", retryable: false });
    expect(classifyAutomationFailure("No fresh candidate passed duplicate checks")).toMatchObject({ category: "source_exhausted", retryable: false });
  });

  it("enters recovery mode after repeated failures", () => {
    const policy = buildAutomationDecisionPolicy({
      learning,
      report: { latestRuns: [
        { status: "running", message: "Scanning" },
        { status: "error", message: "Upload timed out" },
        { status: "error", message: "Upload timed out" },
        { status: "success", message: "Uploaded" },
      ] },
    });
    expect(policy.phase).toBe("recover");
    expect(policy.recovery).toMatchObject({ failureStreak: 2, category: "publishing", retryable: true });
  });

  it("does not stay in recovery after a later successful run", () => {
    const policy = buildAutomationDecisionPolicy({
      learning,
      report: { latestRuns: [
        { status: "success", message: "Uploaded" },
        { status: "error", message: "OAuth refresh token expired" },
      ] },
    });
    expect(policy.phase).toBe("exploit");
    expect(policy.recovery.category).toBe("none");
  });

  it("respects the recovery opt-out", () => {
    const policy = buildAutomationDecisionPolicy({
      settings: { adaptiveRecoveryEnabled: false },
      learning,
      report: { latestRuns: [{ status: "error", message: "OAuth refresh token expired" }] },
    });
    expect(policy.phase).toBe("exploit");
    expect(policy.recovery.retryable).toBe(true);
  });

  it("uses learned patterns and controlled exploration in candidate scoring", () => {
    const policy = buildAutomationDecisionPolicy({ learning, seed: "run-2" });
    const matched = automationDecisionCandidateAdjustment({ id: "a", title: "anime comeback" }, policy, {
      hookPattern: "underdog-reveal",
      durationBucket: "31-60s",
    });
    const unmatched = automationDecisionCandidateAdjustment({ id: "b", title: "generic clip" }, policy, {
      hookPattern: "curiosity-recap",
      durationBucket: "0-30s",
    });
    expect(matched).toBeGreaterThan(unmatched);
  });
});
