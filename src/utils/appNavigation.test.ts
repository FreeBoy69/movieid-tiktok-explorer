import { describe, expect, it } from "vitest";
import { ALL_NAV_ENTRIES, MENU_ONLY_NAV_IDS, PRIMARY_NAV_CHILDREN, PRIMARY_NAV_ENTRIES, TOOL_NAV_GROUPS } from "./appNavigation";

describe("primary navigation", () => {
  it("keeps requested studios and workflows grouped without losing destinations", () => {
    expect(PRIMARY_NAV_ENTRIES.map((entry) => entry.id)).toEqual([
      "image",
      "video",
      "audio",
      "create",
      "drama",
      "marketing",
      "promo",
      "cinema",
      "automation",
    ]);
    expect(PRIMARY_NAV_ENTRIES.map((entry) => entry.label)).toEqual([
      "Image", "Video", "Audio", "Create Video", "Create Drama", "Marketing Studio", "Promo Studio", "Cinema Studio", "Agents",
    ]);
    expect([...MENU_ONLY_NAV_IDS]).toEqual(["image", "video", "audio"]);
    expect(Object.fromEntries(Object.entries(PRIMARY_NAV_CHILDREN).map(([id, entries]) => [id, entries.map((entry) => entry.id)]))).toEqual({
      create: ["styles", "projects"],
      image: ["image", "layers", "ai-influencer"],
      video: ["video", "clipping", "vibe-motion", "motion-control", "body-swap", "lipsync"],
      audio: ["audio", "tts", "voiceover"],
      automation: ["agents", "design-agent", "workflows"],
    });

    const toolIds = TOOL_NAV_GROUPS.flatMap((group) => group.columns.flatMap((column) => column.entries.map((entry) => entry.id)));
    const allIds = [...PRIMARY_NAV_ENTRIES.filter((entry) => !MENU_ONLY_NAV_IDS.has(entry.id)).map((entry) => entry.id), ...Object.values(PRIMARY_NAV_CHILDREN).flatMap((entries) => entries.map((entry) => entry.id)), ...toolIds];
    expect(new Set(allIds).size).toBe(allIds.length);
    expect(allIds.sort()).toEqual(ALL_NAV_ENTRIES.map((entry) => entry.id).sort());
  });
});
