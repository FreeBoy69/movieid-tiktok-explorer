import { describe, expect, it } from "vitest";
import { quickToolsFor, sectionFor, shortLabel } from "./MobileDock";

describe("MobileDock", () => {
  it("picks quick tools for the page and never offers the page itself", () => {
    const image = quickToolsFor("studio", "image").map((e) => e.id);
    expect(image).toEqual(["image-upscaler", "background-remover", "magic-edit", "relight"]);
    const upscaler = quickToolsFor("tool", undefined, "image-upscaler").map((e) => e.id);
    expect(upscaler).not.toContain("image-upscaler");
    expect(upscaler).toHaveLength(4);
    expect(quickToolsFor("tools").map((e) => e.id)).toEqual(["image", "video", "create", "vibe-edit"]);
  });

  it("maps pages to the right section", () => {
    expect(sectionFor("tools")).toBe("create");
    expect(sectionFor("studio", "cinema")).toBe("create");
    expect(sectionFor("projects")).toBe("projects");
    expect(sectionFor("automation")).toBe("agents");
    expect(sectionFor("tool", undefined, "transcriber")).toBe("tools");
  });

  it("gives every quick tool a short label", () => {
    for (const view of ["tools", "create", "studio"] as const) {
      for (const entry of quickToolsFor(view, view === "studio" ? "video" : undefined)) expect(shortLabel(entry).length).toBeLessThanOrEqual(13);
    }
  });
});
