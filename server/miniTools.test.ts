import { describe, expect, it } from "vitest";
import { buildTextPrompt, normalizeTextResult, thumbnailFilename } from "./miniTools.js";

describe("text tools", () => {
  it("builds prompts only when the task has something to work from", () => {
    expect(() => buildTextPrompt("titles", {})).toThrow(/about/);
    expect(() => buildTextPrompt("description", {})).toThrow(/title/);
    expect(() => buildTextPrompt("hashtags", { topic: " " })).toThrow(/Describe/);
    expect(() => buildTextPrompt("poems", { topic: "x" })).toThrow(/Unknown/);
    const titles = buildTextPrompt("titles", { topic: "budget mics", count: 99, style: "weird" });
    expect(titles.prompt).toContain("exactly 20 titles");
    expect(titles.prompt).toContain("Vary the angle");
    expect(titles.requiredAnyKeys).toEqual(["titles"]);
    const description = buildTextPrompt("description", { title: "Mics", links: "https://a.example\nhttps://b.example", platform: "tiktok" });
    expect(description.prompt).toContain("TikTok");
    expect(description.prompt).toContain("https://b.example");
  });

  it("cleans the model's answer into what the tools render", () => {
    expect(normalizeTextResult("titles", { titles: ["\"Quoted\"", { title: " Spaced ", angle: "BOLD-CLAIM" }, { title: "" }] })).toEqual({
      titles: [{ title: "Quoted", angle: "" }, { title: "Spaced", angle: "bold-claim" }],
    });
    expect(() => normalizeTextResult("titles", { titles: [] })).toThrow(/no titles/);
    const description = normalizeTextResult("description", {
      description: "Hook line.",
      tags: ["#mics", "mics", "budget audio"],
      hashtags: ["mics", "#Mics", "bad tag", "#ok_tag"],
      chapters: [{ time: "0:00", title: "Intro" }, { time: "nope", title: "x" }, { time: "12:30", title: "" }],
    });
    expect(description.tags).toEqual(["mics", "budget audio"]);
    expect(description.hashtags).toEqual(["#mics", "#Mics", "#badtag", "#ok_tag"]);
    expect(description.chapters).toEqual([{ time: "0:00", title: "Intro" }]);
    const hashtags = normalizeTextResult("hashtags", { hashtags: [{ tag: "movie", reach: "BROAD" }, { tag: "#movie", reach: "niche" }, "film recap", { tag: "#filmtok", reach: "weird" }] });
    expect(hashtags.hashtags).toEqual([{ tag: "#movie", reach: "broad" }, { tag: "#filmrecap", reach: "medium" }, { tag: "#filmtok", reach: "medium" }]);
  });

  it("names the downloaded cover after the video without unsafe characters", () => {
    expect(thumbnailFilename("My Video: Part 2/3 — Épisode?", "image/png")).toBe("My Video Part 23 Episode.png");
    expect(thumbnailFilename("", "image/webp")).toBe("thumbnail.webp");
    expect(thumbnailFilename("x".repeat(100), "image/jpeg")).toHaveLength(84);
  });
});
