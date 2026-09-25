import { describe, expect, it } from "vitest";
import { ALL_NAV_ENTRIES, PRIMARY_NAV_ENTRIES, TOOL_NAV_GROUPS } from "./appNavigation";

describe("primary navigation", () => {
  it("keeps the main creation paths visible and every other destination in Tools", () => {
    expect(PRIMARY_NAV_ENTRIES.map((entry) => entry.id)).toEqual([
      "create",
      "drama",
      "image",
      "video",
      "cinema",
      "automation",
    ]);

    const toolIds = TOOL_NAV_GROUPS.flatMap((group) => group.columns.flatMap((column) => column.entries.map((entry) => entry.id)));
    const allIds = [...PRIMARY_NAV_ENTRIES.map((entry) => entry.id), ...toolIds];
    expect(new Set(allIds).size).toBe(allIds.length);
    expect(allIds.sort()).toEqual(ALL_NAV_ENTRIES.map((entry) => entry.id).sort());
  });
});
