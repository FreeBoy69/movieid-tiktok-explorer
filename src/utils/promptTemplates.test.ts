import { beforeEach, describe, expect, it } from "vitest";
import {
  detectAspect,
  fillTemplatePrompt,
  fitsStudio,
  studioDraftFor,
  templatePromptText,
  takePendingTemplate,
  templateOutput,
  templateStudio,
  variableLabel,
  writePendingTemplate,
} from "./promptTemplates";

describe("prompt templates", () => {
  it("map categories to the studio that uses them", () => {
    expect(templateOutput({ categories: ["video", "visualStyle"] })).toBe("video");
    expect(templateStudio({ categories: ["thumbnail"] })).toBe("image");
    expect(templateStudio({ categories: ["music"] })).toBe("audio");
    expect(templateStudio({ categories: ["script", "idea"] })).toBeNull();
    expect(templateOutput({ categories: [] })).toBeNull();
  });

  it("fill blanks from values, then examples", () => {
    const template = {
      id: "t",
      title: "T",
      categories: ["video" as const],
      snippet: "A tired woman slams a door.",
      prompt: "{{a}} {{hook}}.",
      variables: [
        { name: "a", example: "A tired woman" },
        { name: "hook", example: "slams a door" },
      ],
    };
    expect(fillTemplatePrompt(template)).toBe("A tired woman slams a door.");
    expect(fillTemplatePrompt(template, { hook: "  drops   a photo " })).toBe("A tired woman drops a photo.");
    expect(fillTemplatePrompt({ ...template, variables: undefined })).toBe("{{a}} {{hook}}.");
    expect(templatePromptText({ prompt: '{\n  "subject": "traveler"\n}', snippet: "Airport style" })).toBe('{\n  "subject": "traveler"\n}');
    expect(fillTemplatePrompt({ ...template, prompt: undefined, variables: undefined })).toBe("A tired woman slams a door.");
    expect(variableLabel("a")).toBe("Character A");
    expect(variableLabel("wrong_thing")).toBe("Wrong thing");
  });

  it("detect aspect and build studio drafts", () => {
    expect(detectAspect("Vertical 9:16 framing")).toBe("9:16");
    expect(detectAspect("480p, 16:9, 15 seconds")).toBe("16:9");
    expect(detectAspect("a quiet forest")).toBe("");
    expect(detectAspect('{"technical_details":{"aspect_ratio":"4:5"}}')).toBe("4:5");
    expect(studioDraftFor("video", "9:16 dance")).toEqual({ prompt: "9:16 dance", videoTab: "text", aspectRatio: "9:16" });
    expect(studioDraftFor("audio", "lo-fi 16:9")).toEqual({ prompt: "lo-fi 16:9", audioMode: "music" });
    expect(() => studioDraftFor("image", "x".repeat(5000))).toThrow(/too long/);
    expect(fitsStudio("x".repeat(3800))).toBe(true);
    expect(fitsStudio("x".repeat(3801))).toBe(false);
  });

  describe("hand-off", () => {
    beforeEach(() => window.sessionStorage.clear());
    it("is taken once, by its target only", () => {
      writePendingTemplate({ target: "video", title: "T", prompt: "P" });
      expect(takePendingTemplate("image")).toBeNull();
      expect(takePendingTemplate("video")).toMatchObject({ target: "video", prompt: "P" });
      expect(takePendingTemplate("video")).toBeNull();
    });
    it("expires", () => {
      window.sessionStorage.setItem("autoyt-pending-template", JSON.stringify({ target: "video", title: "T", prompt: "P", at: Date.now() - 11 * 60 * 1000 }));
      expect(takePendingTemplate("video")).toBeNull();
    });
  });
});
