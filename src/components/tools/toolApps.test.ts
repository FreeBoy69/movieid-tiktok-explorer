import { describe, expect, it } from "vitest";
import { TOOLS, TOOL_LIST } from "./toolApps";
import { TOOL_IDS } from "../../utils/tiktokRoute";

describe("tool registry", () => {
  it("defines every routed tool with the copy its page needs", () => {
    expect(Object.keys(TOOLS).sort()).toEqual([...TOOL_IDS].sort());
    for (const tool of TOOL_LIST) {
      expect(tool.tagline.length).toBeGreaterThan(20);
      expect(tool.action).toBeTruthy();
      expect(tool.heading).toBeTruthy();
      expect(tool.body.length).toBeGreaterThan(40);
      if (tool.kind === "text") expect(tool.task).toBeTruthy();
      if (tool.operations) expect(new Set(tool.operations.map((o) => o.value)).size).toBe(tool.operations.length);
    }
  });
});
