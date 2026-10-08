import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CREATE_TABS, CREATE_TEMPLATES, promptWithStyle, templatesFor } from "./createTemplates";

describe("Create page templates", () => {
  it("gives every template a unique key, a known tab, and a way to run", () => {
    const keys = CREATE_TEMPLATES.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
    const tabs = new Set(CREATE_TABS.map((t) => t.id));
    for (const t of CREATE_TEMPLATES) {
      expect(tabs.has(t.tab), t.key).toBe(true);
      if (t.kind === "style") expect(t.styleText, t.key).toBeTruthy();
      else expect(t.target && t.pending && t.studio, t.key).toBeTruthy();
    }
    for (const tab of CREATE_TABS.filter((t) => t.id !== "all")) expect(templatesFor(tab.id).length, tab.id).toBeGreaterThan(0);
  });

  it("only points at preview stills that ship in public/", () => {
    const missing = CREATE_TEMPLATES.filter((t) => t.image && !existsSync(join(process.cwd(), "public", t.image))).map((t) => t.image);
    expect(missing).toEqual([]);
  });

  it("interleaves the tabs on All and adds a style's words after the prompt", () => {
    const all = templatesFor("all");
    expect(all).toHaveLength(CREATE_TEMPLATES.length);
    expect(new Set(all.slice(0, CREATE_TABS.length - 1).map((t) => t.tab)).size).toBe(CREATE_TABS.length - 1);
    const style = CREATE_TEMPLATES.find((t) => t.kind === "style")!;
    expect(promptWithStyle("  a fox  ", style)).toBe(`a fox. ${style.styleText}`);
    expect(promptWithStyle("", style)).toBe(style.styleText);
    expect(promptWithStyle("a fox", null)).toBe("a fox");
  });
});
