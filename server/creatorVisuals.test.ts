import { describe, expect, it } from "vitest";
import { writeScenePrompts } from "./creatorWorkspace.js";

const scenes = Array.from({ length: 23 }, (_, i) => ({ start: i * 5, end: i * 5 + 5, text: `Line ${i}` }));
const reply = (payload: string, skip = new Set<number>()) =>
  ({ scenes: JSON.parse(payload).scenes.filter((s: any) => !skip.has(s.index)).map((s: any) => ({ index: s.index, prompt: `Prompt ${s.index}`, castIds: [] })) });

describe("scene prompt batches", () => {
  it("writes long plans in batches of ten and keeps order", async () => {
    const calls: number[] = [];
    const planned = await writeScenePrompts(scenes, {
      direction: { text: "Watercolor" },
      bible: {},
      safe: false,
      ask: async (_system: string, payload: string) => {
        calls.push(JSON.parse(payload).scenes.length);
        return reply(payload);
      },
    });
    expect(calls.sort((a, b) => b - a)).toEqual([10, 10, 3]);
    expect(planned.map((p: any) => p.prompt)).toEqual(scenes.map((_, i) => `Prompt ${i}`));
  });

  it("retries a short batch, then falls back to the narration instead of failing", async () => {
    let attempts = 0;
    const planned = await writeScenePrompts(scenes.slice(0, 4), {
      direction: { text: "Clay" },
      bible: {},
      safe: true,
      ask: async (system: string, payload: string) => {
        attempts++;
        expect(system).toContain("platform-safe");
        return reply(payload, new Set([2]));
      },
    });
    expect(attempts).toBe(2);
    expect(planned[1]).toMatchObject({ prompt: "Prompt 1" });
    expect(planned[2]).toMatchObject({ fallback: true });
    expect(planned[2].prompt).toContain("Line 2");
  });

  it("fails only when no batch produced anything", async () => {
    await expect(
      writeScenePrompts(scenes.slice(0, 3), { direction: { text: "" }, bible: {}, safe: false, ask: async () => { throw new Error("provider down"); } }),
    ).rejects.toThrow("provider down");
  });
});

import { imageWithSafetyRecovery, isSafetyRejection } from "./creatorWorkspace.js";
const refusal = () => Object.assign(new Error("AI provider (400): Your request was rejected by the safety system. safety_violations=[abuse]"), { status: 400 });

describe("image safety recovery", () => {
  it("recognizes provider safety refusals only", () => {
    expect(isSafetyRejection(refusal())).toBe(true);
    expect(isSafetyRejection(new Error("OpenRouter (402): insufficient credits"))).toBe(false);
  });

  it("softens the prompt, then falls back to other models", async () => {
    const tried: string[] = [];
    const result = await imageWithSafetyRecovery("a bloody crime scene", async (text: string, model?: string) => {
      tried.push(`${model || "primary"}:${text}`);
      if (model !== "model-b") throw refusal();
      return "/asset.png";
    }, { rewrite: async () => "police tape outside a quiet house at dawn", models: ["model-a", "model-b"] });
    expect(result).toMatchObject({ asset: "/asset.png", softened: true, model: "model-b" });
    expect(tried).toEqual([
      "primary:a bloody crime scene",
      "primary:police tape outside a quiet house at dawn",
      "model-a:police tape outside a quiet house at dawn",
      "model-b:police tape outside a quiet house at dawn",
    ]);
  });

  it("does not retry unrelated errors and explains a total refusal", async () => {
    await expect(imageWithSafetyRecovery("x", async () => { throw new Error("timeout"); }, { models: ["m"] })).rejects.toThrow("timeout");
    await expect(imageWithSafetyRecovery("x", async () => { throw refusal(); }, { rewrite: async () => "y", models: ["m"] })).rejects.toThrow(/safety filter blocked this scene/);
  });
});
