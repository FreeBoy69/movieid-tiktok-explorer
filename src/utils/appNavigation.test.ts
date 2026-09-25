import { describe, expect, it } from "vitest";
import { ALL_NAV_ENTRIES, PRIMARY_NAV_CHILDREN, PRIMARY_NAV_ENTRIES, TOOL_NAV_GROUPS } from "./appNavigation";

describe("primary navigation", () => {
  it("keeps requested studios and workflows grouped without losing destinations", () => {
    expect(PRIMARY_NAV_ENTRIES.map((entry) => entry.id)).toEqual([
      "create",
      "drama",
      "image",
      "video",
      "marketing",
      "cinema",
      "audio",
      "automation",
    ]);
    expect(Object.fromEntries(Object.entries(PRIMARY_NAV_CHILDREN).map(([id, entries]) => [id, entries.map((entry) => entry.id)]))).toEqual({
      create: ["styles", "projects"],
      image: ["layers", "design-agent", "ai-influencer"],
      video: ["clipping", "vibe-motion", "motion-control", "body-swap", "lipsync"],
      audio: ["tts", "voiceover"],
      automation: ["agents", "workflows"],
    });

    const toolIds = TOOL_NAV_GROUPS.flatMap((group) => group.columns.flatMap((column) => column.entries.map((entry) => entry.id)));
    const allIds = [...PRIMARY_NAV_ENTRIES.map((entry) => entry.id), ...Object.values(PRIMARY_NAV_CHILDREN).flatMap((entries) => entries.map((entry) => entry.id)), ...toolIds];
    expect(new Set(allIds).size).toBe(allIds.length);
    expect(allIds.sort()).toEqual(ALL_NAV_ENTRIES.map((entry) => entry.id).sort());
  });
});
