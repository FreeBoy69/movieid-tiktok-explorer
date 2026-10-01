import { describe, expect, it } from "vitest";
import { ALL_NAV_ENTRIES, currentGroup, isCurrentEntry, MENU_ONLY_NAV_IDS, navEntryFor, PRIMARY_NAV_CHILDREN, PRIMARY_NAV_ENTRIES, TOOL_NAV_GROUPS } from "./appNavigation";
import { TOOL_IDS } from "./tiktokRoute";

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
      image: ["image", "ai-influencer"],
      video: ["video", "explainer", "clipping", "vibe-motion", "motion-control", "body-swap", "lipsync"],
      audio: ["audio", "tts", "voiceover"],
      automation: ["agents", "design-agent", "workflows"],
    });

    const toolIds = TOOL_NAV_GROUPS.flatMap((group) => group.columns.flatMap((column) => column.entries.map((entry) => entry.id)));
    const allIds = [...PRIMARY_NAV_ENTRIES.filter((entry) => !MENU_ONLY_NAV_IDS.has(entry.id)).map((entry) => entry.id), ...Object.values(PRIMARY_NAV_CHILDREN).flatMap((entries) => entries.map((entry) => entry.id)), ...toolIds];
    expect(new Set(allIds).size).toBe(allIds.length);
    expect(allIds.sort()).toEqual(ALL_NAV_ENTRIES.map((entry) => entry.id).sort());
  });

  it("lists every tool in the suite once, under the Tools menu", () => {
    const toolEntries = ALL_NAV_ENTRIES.filter((entry) => entry.target.view === "tool");
    expect(toolEntries.map((entry) => entry.target.toolId).sort()).toEqual([...TOOL_IDS].sort());
    expect(ALL_NAV_ENTRIES.some((entry) => entry.id === "layers")).toBe(false);
    const inToolsMenu = new Set(TOOL_NAV_GROUPS.flatMap((group) => group.columns.flatMap((column) => column.entries.map((entry) => entry.id))));
    for (const entry of toolEntries) expect(inToolsMenu.has(entry.id)).toBe(true);
  });

  it("matches the current tool by id, not just by view", () => {
    const remover = navEntryFor("tool", undefined, "background-remover")!;
    expect(remover.label).toBe("Background Remover");
    expect(isCurrentEntry(remover, "tool", undefined, "background-remover")).toBe(true);
    expect(isCurrentEntry(remover, "tool", undefined, "relight")).toBe(false);
    expect(currentGroup("tool", undefined, "relight")).toBe("image-tools");
    expect(currentGroup("tool", undefined, "title-generator")).toBe("writing");
    expect(currentGroup("tool", undefined, "transcriber")).toBe("tools");
  });
});
