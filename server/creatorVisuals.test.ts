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

import { castSheetPrompt } from "./creatorWorkspace.js";
import { shotDirection, validateCreatorScenes } from "../src/utils/creatorPipeline.js";
describe("character-led storyboards", () => {
  it("asks for shot sizes and close character framing only when character-led", async () => {
    const systems: string[] = [];
    const planned = await writeScenePrompts(scenes.slice(0, 2), {
      direction: { text: "" },
      bible: { cast: [{ id: "mara" }] },
      safe: false,
      characterLed: true,
      ask: async (system: string, payload: string) => {
        systems.push(system);
        return { scenes: JSON.parse(payload).scenes.map((s: any) => ({ index: s.index, prompt: "p", castIds: ["mara"], shot: s.index ? "wide" : "close-up" })) };
      },
    });
    expect(systems[0]).toContain("CHARACTER-LED");
    expect(systems[0]).toContain("Never write extreme wide");
    expect(planned[0].shot).toBe("close-up");
    expect(planned[1].shot).toBeUndefined();
    await writeScenePrompts(scenes.slice(0, 1), { direction: { text: "" }, bible: {}, safe: false, ask: async (system: string, payload: string) => {
      expect(system).not.toContain("CHARACTER-LED");
      return reply(payload);
    } });
  });

  it("keeps a valid shot on saved scenes and drops unknown ones", () => {
    const saved = validateCreatorScenes(
      [{ id: "scene-1", start: 0, end: 4, prompt: "a", shot: "close-up" }, { id: "scene-2", start: 4, end: 8, prompt: "b", shot: "aerial" }],
      [], 8,
    );
    expect(saved.map((s: any) => s.shot)).toEqual(["close-up", undefined]);
    expect(shotDirection("long")).toMatch(/head to toe/);
  });

  it("builds a turnaround sheet prompt from the character", () => {
    const prompt = castSheetPrompt({ name: "Mara", role: "archivist", appearance: "short curly hair", outfit: "mustard coat" }, { identity: true });
    expect(prompt).toContain("three-quarter");
    expect(prompt).toContain("Mara, archivist");
    expect(prompt).toContain("IDENTITY REFERENCE");
    expect(prompt).not.toContain("STYLE REFERENCE");
  });
});

import { dialogueSegments, speakerCastId } from "./creatorWorkspace.js";
import { narrationBeats, parseDialogue, looksLikeDialogue, isDialogueProject } from "../src/utils/creatorPipeline.js";
const timedWords = (text: string, start = 0, step = 0.45) =>
  text.split(" ").map((word, i) => ({ start: start + i * step, end: start + i * step + 0.4, word }));
describe("narration beats and dialogue", () => {
  it("cuts scenes at sentences, splits long sentences at clauses, and merges fragments", () => {
    const long = "On the evening of November 8, 1939, the leader stood at a podium inside the crowded beer hall and the crowd roared for him.";
    const segments = [
      { start: 0, end: 12, text: long, words: timedWords(long) },
      { start: 11.8, end: 12.7, text: "Then silence.", words: timedWords("Then silence.", 11.8, 0.4) },
      { start: 13, end: 15, text: "He left early.", words: timedWords("He left early.", 13) },
    ];
    const beats = narrationBeats(segments, 15.5);
    expect(beats.length).toBeGreaterThanOrEqual(3);
    expect(beats[0].start).toBe(0);
    expect(beats.at(-1)!.end).toBe(15.5);
    for (let i = 1; i < beats.length; i++) expect(beats[i].start).toBeCloseTo(beats[i - 1].end);
    // The long sentence breaks at its comma, not mid-phrase.
    expect(beats[0].text.endsWith(",")).toBe(true);
    // "Then silence." is too short alone and joins a neighbour.
    expect(beats.some((beat) => beat.text === "Then silence.")).toBe(false);
  });

  it("never merges across speakers in dialogue", () => {
    const segments = [
      { start: 0, end: 1, text: "No!", speaker: "Apple", words: timedWords("No!") },
      { start: 1.3, end: 3, text: "Yes, it is true.", speaker: "Banana", words: timedWords("Yes, it is true.", 1.3) },
    ];
    const beats = narrationBeats(segments, 3.2, { minSeconds: 1.2 });
    expect(beats.map((beat) => beat.speaker)).toEqual(["Apple", "Banana"]);
  });

  it("parses speakers, directions, and narration lines", () => {
    const lines = parseDialogue("APPLE (nervous): I saw (gasps) the knife!\n(Apple turns)\nBANANA: You overreact.\nThe kitchen went quiet.");
    expect(lines).toEqual([
      { speaker: "Apple", text: "I saw the knife!", direction: "nervous; gasps" },
      { speaker: "Banana", text: "You overreact.", direction: "" },
      { speaker: "Narrator", text: "The kitchen went quiet.", direction: "" },
    ]);
    const drama = "APPLE: One.\nBANANA: Two.\nAPPLE: Three.\nBANANA: Four.";
    expect(looksLikeDialogue(drama)).toBe(true);
    expect(looksLikeDialogue("The ship vanished. Note: nobody knew why.")).toBe(false);
    expect(isDialogueProject({ scriptFormat: "narration" }, drama)).toBe(false);
    expect(isDialogueProject({ scriptFormat: "dialogue" }, "anything")).toBe(true);
  });

  it("times dialogue segments from the audio and attaches words", () => {
    const segments = dialogueSegments(
      [{ speaker: "Apple", text: "Hi", start: 0, end: 1, direction: "" }, { speaker: "Banana", text: "Bye", start: 1.3, end: 2 }],
      [{ words: [{ start: 0.1, end: 0.5, word: "Hi" }, { start: 0.7, end: 0.9, word: "Bye" }] }],
      0.5,
      1.2,
    );
    expect(segments[0]).toMatchObject({ start: 0, end: 0.65, speaker: "Apple" });
    expect(segments[1].words.map((w: any) => w.word)).toEqual(["Bye"]);
  });

  it("maps speakers to cast members by name", () => {
    const cast = [{ id: "c1", name: "Apple the Chef" }, { id: "c2", name: "Banana" }] as any;
    expect(speakerCastId(cast, "Banana")).toBe("c2");
    expect(speakerCastId(cast, "Apple")).toBe("c1");
    expect(speakerCastId(cast, "Narrator")).toBe("");
  });

  it("tells the planner to match each line and to stage dialogue", async () => {
    let system = "";
    await writeScenePrompts([{ start: 0, end: 2, text: "Hi", speaker: "Apple" }], {
      direction: { text: "" },
      bible: {},
      safe: false,
      story: { setting: "a kitchen" },
      ask: async (s: string, payload: string) => {
        system = s;
        expect(JSON.parse(payload).story.setting).toBe("a kitchen");
        expect(JSON.parse(payload).scenes[0].speaker).toBe("Apple");
        return reply(payload);
      },
    });
    expect(system).toContain("MATCH THE LINE");
    expect(system).toContain("DIALOGUE");
  });
});
