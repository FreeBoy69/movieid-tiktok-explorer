import { describe, expect, it } from "vitest";
import {
  agentCreateFirstIncompleteStep,
  agentCreateStepError,
  agentGettingStartedSteps,
  suggestAgentName,
} from "./agentCreateJourney";

const ready = {
  name: "Recaps agent",
  youtubeAccountId: "acc-1",
  sourceType: "saved_playlist",
  sourceKey: "playlist-1",
  sourceUrl: "https://www.tiktok.com/@someone/collection/1",
  settings: { scheduleTimes: ["09:00"], maxPostsPerDay: 1, rightsConfirmed: true, sourceTags: [] },
};

describe("agentCreateStepError", () => {
  it("requires a saved source for saved source types", () => {
    expect(agentCreateStepError("source", { ...ready, sourceKey: "", sourceUrl: "" })).toMatch(/saved sources/i);
    expect(agentCreateStepError("source", ready)).toBe("");
  });

  it("validates pasted URLs", () => {
    expect(agentCreateStepError("source", { ...ready, sourceType: "custom_url", sourceUrl: "" })).toMatch(/paste/i);
    expect(agentCreateStepError("source", { ...ready, sourceType: "custom_url", sourceUrl: "https://example.com/x" })).toMatch(/not a tiktok or youtube/i);
    expect(agentCreateStepError("source", { ...ready, sourceType: "custom_url", sourceUrl: "https://www.youtube.com/@channel/shorts" })).toBe("");
  });

  it("requires a tag for tag sources", () => {
    expect(agentCreateStepError("source", { ...ready, sourceType: "saved_tags", settings: { ...ready.settings, sourceTags: [] } })).toMatch(/tag/i);
    expect(agentCreateStepError("source", { ...ready, sourceType: "saved_tags", settings: { ...ready.settings, sourceTags: ["anime"] } })).toBe("");
  });

  it("requires name, channel, and a release time to publish", () => {
    expect(agentCreateStepError("publish", { ...ready, name: "  " })).toMatch(/name/i);
    expect(agentCreateStepError("publish", { ...ready, youtubeAccountId: "" })).toMatch(/channel/i);
    expect(agentCreateStepError("publish", { ...ready, settings: { ...ready.settings, scheduleTimes: [] } })).toMatch(/release time/i);
    expect(agentCreateStepError("publish", ready)).toBe("");
  });

  it("requires the rights confirmation to finish", () => {
    expect(agentCreateStepError("confirm", { ...ready, settings: { ...ready.settings, rightsConfirmed: false } })).toMatch(/rights/i);
    expect(agentCreateStepError("confirm", ready)).toBe("");
  });
});

describe("agentCreateFirstIncompleteStep", () => {
  it("points at the first step with a problem", () => {
    expect(agentCreateFirstIncompleteStep({ ...ready, sourceKey: "", sourceUrl: "" })).toBe(0);
    expect(agentCreateFirstIncompleteStep({ ...ready, name: "" })).toBe(1);
    expect(agentCreateFirstIncompleteStep({ ...ready, settings: { ...ready.settings, rightsConfirmed: false } })).toBe(2);
    expect(agentCreateFirstIncompleteStep(ready)).toBe(3);
  });
});

describe("suggestAgentName", () => {
  it("derives from the channel and avoids collisions", () => {
    expect(suggestAgentName("Storyframe  Studio")).toBe("Storyframe Studio agent");
    expect(suggestAgentName("", [])).toBe("New agent");
    expect(suggestAgentName("Studio", ["Studio agent", "studio agent 2"])).toBe("Studio agent 3");
  });
});

describe("agentGettingStartedSteps", () => {
  it("marks steps done from uploads and status", () => {
    const fresh = agentGettingStartedSteps({ uploadCount: 0, status: "paused" });
    expect(fresh.map((step) => step.done)).toEqual([false, false, false]);
    const tested = agentGettingStartedSteps({ uploadCount: 2, status: "paused" });
    expect(tested.map((step) => step.done)).toEqual([true, true, false]);
    const live = agentGettingStartedSteps({ uploadCount: 2, status: "active" });
    expect(live.every((step) => step.done)).toBe(true);
  });
});
