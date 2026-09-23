import { describe, expect, it } from "vitest";
import { cinemaPrompt, modelKind, normalizeImageModels, normalizeRequest, normalizeVideoModels, STUDIO_TABS } from "./creatorStudio.js";
import { STUDIO_TABS as ROUTE_TABS } from "../src/utils/tiktokRoute";

describe("creator studio", () => {
  it("serves every app the page links to", () => {
    expect(ROUTE_TABS.filter((tab) => tab !== "apps").sort()).toEqual([...STUDIO_TABS].sort());
  });

  it("sorts the video catalog into generators, avatars, edits, upscalers, and motion models", () => {
    const catalog = normalizeVideoModels([
      { id: "alibaba/wan-3.0", name: "Alibaba: Wan 3.0", supported_durations: [5, 2, 10], supported_frame_images: ["first_frame"], generate_audio: true, pricing_skus: { duration_seconds_720p: "0.14" } },
      { id: "bytedance/seedance-2.0-fast", name: "Seedance 2.0 Fast", supported_durations: [4, 5] },
      { id: "heygen/avatar-iv", name: "HeyGen: Avatar IV", description: "lip-synced talking head", supported_durations: null },
      { id: "black-forest-labs/flux-video-edit", name: "FLUX Video Edit", pricing_skus: { cents_per_second_output: "3" } },
      { id: "black-forest-labs/flux-video-upscale", name: "FLUX Video Upscale", description: "video upscaling model" },
    ]);
    expect(catalog.video.map((m) => m.id)).toEqual(["alibaba/wan-3.0", "bytedance/seedance-2.0-fast"]);
    expect(catalog.video[0]).toMatchObject({ name: "Wan 3.0", durations: [2, 5, 10], audio: true, pricePerSecond: 0.14 });
    expect(catalog.avatar.map((m) => m.id)).toEqual(["heygen/avatar-iv"]);
    expect(catalog.edit[0]).toMatchObject({ id: "black-forest-labs/flux-video-edit", pricePerSecond: 0.03 });
    expect(catalog.upscale.map((m) => m.id)).toEqual(["black-forest-labs/flux-video-upscale"]);
    expect(catalog.motion.map((m) => m.id)).toEqual(["bytedance/seedance-2.0-fast"]);
  });

  it("drops SVG-only image models and caps parameters", () => {
    const models = normalizeImageModels([
      { id: "recraft/recraft-v4-vector", supported_parameters: {} },
      { id: "openrouter/auto", supported_parameters: {} },
      { id: "openai/gpt-image-2", name: "OpenAI: GPT Image 2", supported_parameters: { n: { max: 10 }, input_references: { max: 16 }, aspect_ratio: { values: ["1:1", "16:9"] } } },
    ]);
    expect(models).toHaveLength(1);
    expect(models[0]).toMatchObject({ name: "GPT Image 2", provider: "openai", maxImages: 4, maxReferences: 8, aspectRatios: ["1:1", "16:9"] });
  });

  it("builds the cinema prompt from the camera rig and rejects unknown gear", () => {
    const prompt = cinemaPrompt("A rainy neon alley", { camera: "Classic 16mm Film", lens: "Classic Anamorphic", focalLength: 35, aperture: "f/1.4" });
    expect(prompt).toContain("A rainy neon alley, shot on a classic 16mm film camera");
    expect(prompt).toContain("classic anamorphic lens at 35mm (natural cinematic perspective)");
    expect(prompt).toContain("shallow depth of field");
    expect(() => cinemaPrompt("x", { camera: "Nope", lens: "Classic Anamorphic", focalLength: 35, aperture: "f/1.4" })).toThrow(/camera/);
  });

  it("routes each app to the right model list", () => {
    expect(modelKind("layers")).toBe("image");
    expect(modelKind("lipsync")).toBe("avatar");
    expect(modelKind("motion-control")).toBe("motion");
    expect(modelKind("body-swap")).toBe("edit");
    expect(modelKind("video", { mode: "upscale" })).toBe("upscale");
    expect(modelKind("marketing")).toBe("video");
    expect(modelKind("clipping")).toBe("");
    expect(modelKind("vibe-motion")).toBe("");
  });

  it("validates requests and strips unsafe file references", () => {
    expect(() => normalizeRequest({ tab: "agents", prompt: "x" })).toThrow(/Unknown/);
    expect(() => normalizeRequest({ tab: "image", prompt: " " })).toThrow(/Describe/);
    const request = normalizeRequest({
      tab: "layers",
      prompt: "",
      settings: { image: "up-abc-1.png", references: ["../../etc/passwd", "gen-x-1.jpg"], operation: "decompose", sourceVideo: "up-x.exe" },
    });
    expect(request.settings).toMatchObject({ image: "up-abc-1.png", references: ["gen-x-1.jpg"], operation: "decompose" });
    expect(request.settings.sourceVideo).toBeUndefined();
    expect(normalizeRequest({ tab: "video", prompt: "", settings: { firstFrame: "up-a-1.png" } }).settings.firstFrame).toBe("up-a-1.png");
    expect(normalizeRequest({ tab: "clipping", settings: { sourceUrl: "https://youtu.be/abc", count: 99 } }).settings.count).toBe(6);
  });
});
