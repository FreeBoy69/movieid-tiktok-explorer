import { describe, expect, it } from "vitest";
import { ALL_NAV_ENTRIES, currentGroup, isCurrentEntry, MENU_ONLY_NAV_IDS, navEntryFor, PRIMARY_NAV_CHILDREN, PRIMARY_NAV_ENTRIES, TOOL_NAV_GROUPS } from "./appNavigation";
import { TOOL_IDS } from "./tiktokRoute";

describe("primary navigation", () => {
  it("keeps requested studios and workflows grouped without losing destinations", () => {
    expect(PRIMARY_NAV_ENTRIES.map((entry) => entry.id)).toEqual(["home", "projects", "automation"]);
    expect(PRIMARY_NAV_ENTRIES.map((entry) => entry.label)).toEqual(["Create", "Projects", "Agents"]);
    expect(PRIMARY_NAV_ENTRIES[0].target).toEqual({ view: "tools" });
    expect([...MENU_ONLY_NAV_IDS]).toEqual([]);
    expect(Object.fromEntries(Object.entries(PRIMARY_NAV_CHILDREN).map(([id, entries]) => [id, entries.map((entry) => entry.id)]))).toEqual({
      home: ["image", "video", "audio", "create", "film", "vibe-edit", "marketing", "promo", "cinema"],
      automation: ["agents", "design-agent", "workflows"],
    });

    // Every directory entry is reachable exactly once: as a header link, a header menu item, or in Tools.
    const toolIds = TOOL_NAV_GROUPS.flatMap((group) => group.columns.flatMap((column) => column.entries.map((entry) => entry.id)));
    const allIds = [...PRIMARY_NAV_ENTRIES.filter((entry) => entry.id !== "home").map((entry) => entry.id), ...Object.values(PRIMARY_NAV_CHILDREN).flatMap((entries) => entries.map((entry) => entry.id)), ...toolIds];
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

  it("exposes the user-owned digital product maker in the writing menu", () => {
    const entry = navEntryFor("products");
    expect(entry).toMatchObject({ id: "digital-products", label: "Digital Product Maker", target: { view: "products" } });
    expect(currentGroup("products")).toBe("writing");
  });
});
