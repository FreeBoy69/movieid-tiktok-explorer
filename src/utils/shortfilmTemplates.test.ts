import { describe, expect, it } from "vitest";
import {
  SHORTFILM_TEMPLATES,
  beatForScene,
  beatRoleForScene,
  fillTemplate,
  findShortfilmTemplate,
  listShortfilmTemplates,
  sceneAnimationPrompt,
  shortfilmSettings,
  shotDirectionRules,
} from "./shortfilmTemplates.js";
import { ART_STYLE_PRESETS } from "./creatorPipeline.js";

describe("shortfilm templates", () => {
  it("have unique ids, beats, and only real art style presets", () => {
    const ids = SHORTFILM_TEMPLATES.map((template) => template.id);
    expect(new Set(ids).size).toBe(ids.length);
    const presets = new Set(ART_STYLE_PRESETS.map((style) => style.id));
    for (const template of SHORTFILM_TEMPLATES) {
      expect(template.beats.length).toBeGreaterThanOrEqual(3);
      expect(template.thumbnailPrompt).toBeTruthy();
      if (template.artStyleId) expect(presets.has(template.artStyleId)).toBe(true);
      // Every {{slot}} used in the template is a declared variable.
      const declared = new Set(template.variables.map((item) => item.name));
      const used = JSON.stringify(template).match(/\{\{(\w+)\}\}/g) || [];
      for (const slot of used) expect(declared.has(slot.slice(2, -2))).toBe(true);
    }
  });

  it("lists templates with thumbnails", () => {
    expect(listShortfilmTemplates()[0]).toEqual({
      id: "micro-drama",
      name: "Vertical micro-drama",
      genre: "Drama",
      tagline: expect.any(String),
      thumbnail: "/assets/templates/micro-drama.webp",
    });
  });

  it("fills slots from values, then examples", () => {
    const template = findShortfilmTemplate("micro-drama");
    expect(fillTemplate("A {{hook}} B {{cliff}}", template, { hook: "  a door  slams " })).toBe(
      "A a door slams B he slides her a photo and she freezes",
    );
  });

  it("opens on the first beat, closes on the last, and spreads the middle", () => {
    const template = findShortfilmTemplate("movie-trailer")!;
    const roles = Array.from({ length: 12 }, (_, i) => beatForScene(template, i, 12)!.role);
    expect(roles[0]).toBe("establish");
    expect(roles[11]).toBe("close");
    expect(new Set(roles.slice(1, 11))).toEqual(new Set(["character", "inciting", "escalate"]));
    // Middle beats never go backwards.
    const order = template.beats.map((beat) => beat.role);
    const positions = roles.map((role) => order.indexOf(role));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(beatForScene(template, 0, 1)!.role).toBe("establish");
  });

  it("maps drama roles by scene position", () => {
    expect(Array.from({ length: 10 }, (_, i) => beatRoleForScene(i, 10))).toEqual([
      "hook", "setup", "setup", "confrontation", "confrontation", "turn", "payoff", "payoff", "payoff", "cliffhanger",
    ]);
    expect(beatRoleForScene(0, 1)).toBe("hook");
    expect(beatRoleForScene(1, 2)).toBe("cliffhanger");
    expect(Array.from({ length: 3 }, (_, i) => beatRoleForScene(i, 3))).toEqual(["hook", "turn", "cliffhanger"]);
  });

  it("builds settings, storyboard rules, and animation direction", () => {
    expect(shortfilmSettings("found-footage-horror")).toEqual({
      shotTemplateId: "found-footage-horror",
      aspect: "16:9",
      scriptFormat: "narration",
      fixedCamera: true,
    });
    expect(shortfilmSettings("nope")).toEqual({});
    const rules = shotDirectionRules("micro-drama", { hook: "she throws her badge on the table" });
    expect(rules).toContain("she throws her badge on the table");
    expect(rules).not.toMatch(/\{\{/);
    expect(shotDirectionRules("")).toBe("");
    expect(sceneAnimationPrompt("micro-drama", 0, 5)).toMatch(/^Punch-in single/);
    expect(sceneAnimationPrompt("micro-drama", 4, 5)).toMatch(/^Hold on the frozen reaction/);
    expect(sceneAnimationPrompt(undefined as any, 0, 5)).toBe("");
  });
});
