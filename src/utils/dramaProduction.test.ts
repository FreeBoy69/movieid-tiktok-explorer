import { describe, expect, it } from "vitest";
import {
  MIN_CLIP_SECONDS,
  characterSheetPrompt,
  clipCostEstimate,
  designVoiceCandidates,
  dramaStyleBlock,
  estimateSceneSeconds,
  isPhotorealStyle,
  locationSheetPrompt,
  modelReferencePrompt,
  normalizeScreenplay,
  refusedForFaces,
  sceneCharacters,
  sceneReferences,
  sceneTrackTimeline,
  seedancePrompt,
  storyboardPrompt,
} from "./dramaProduction.js";

const cast = [
  { id: "lily", name: "Lily Hart", role: "Nurse", appearance: "mid-20s, chestnut hair, freckles", outfit: "cream knit sweater" },
  { id: "adrian", name: "Adrian Cole", role: "CEO", appearance: "early-30s, dark swept-back hair", outfit: "charcoal suit" },
  { id: "sienna", name: "Sienna Blake", role: "Ex", appearance: "black bob, red lips", outfit: "white blazer dress" },
];
const location = { id: "office", name: "Penthouse office", description: "glass walls over the city at night, walnut desk" };
const scene = {
  id: "s1",
  title: "The Contract",
  locationId: "office",
  summary: "Lily signs the contract.",
  beats: [
    { id: "b1", cam: "Wide", move: "Adrian slides a contract across the desk", speaker: "ADRIAN", emotion: "cold", line: "One year. Sign it." },
    { id: "b2", cam: "Close-up", move: "Lily's jaw tightens", speaker: "LILY", emotion: "defiant", line: "And if I say no?" },
    { id: "b3", cam: "Insert", move: "Her trembling hand on the pen", speaker: "", emotion: "", line: "" },
  ],
};

describe("drama sheets", () => {
  it("builds the Bible's 8-shot character sheet with neutral lighting and no scene effects", () => {
    const prompt = characterSheetPrompt(cast[0], dramaStyleBlock("preset:documentary"));
    expect(prompt).toContain("LILY HART");
    expect(prompt).toContain("four close-up shots of the face");
    expect(prompt).toContain("Neutral, clean, even studio lighting");
    expect(prompt).toContain("do not make it look like a 3D render");
  });
  it("does not re-describe the face when a photo is attached", () => {
    const prompt = characterSheetPrompt(cast[0], "anime", { photo: true });
    expect(prompt).toContain("1:1 similarity");
    expect(prompt).not.toContain("freckles");
  });
  it("draws locations empty of people", () => {
    expect(locationSheetPrompt(location, "style")).toContain("Empty of people");
  });
});

describe("screenplay", () => {
  it("keeps valid speakers, clears lines on silent beats, and falls back to a known location", () => {
    const { scenes } = normalizeScreenplay(
      {
        scenes: [
          {
            title: "One",
            locationId: "nowhere",
            beats: [
              { cam: "Wide", move: "Enter", speaker: "narrator", line: "Once upon a time" },
              { cam: "CU", move: "Stare", speaker: "", line: "orphan line" },
              { cam: "CU", move: "Speaks", speaker: "lily", line: "Hello." },
            ],
          },
          { title: "Empty", beats: [] },
        ],
      },
      { speakers: ["LILY", "ADRIAN"], locations: [location] },
    );
    expect(scenes).toHaveLength(1);
    expect(scenes[0].locationId).toBe("office");
    expect(scenes[0].beats.map((beat) => [beat.speaker, beat.line])).toEqual([
      ["", ""],
      ["", ""],
      ["LILY", "Hello."],
    ]);
    expect(new Set(scenes[0].beats.map((beat) => beat.id)).size).toBe(3);
  });
  it("finds who is in a scene from speakers and the action", () => {
    expect(sceneCharacters(scene, cast)).toEqual(["lily", "adrian"]);
  });
  it("budgets a scene from its words and silent beats", () => {
    expect(estimateSceneSeconds(scene)).toBeGreaterThan(3);
    expect(estimateSceneSeconds(scene)).toBeLessThan(8);
  });
});

describe("dialogue track", () => {
  it("lays lines and silent holds on one track and rounds up to a whole-second clip", () => {
    const { timeline, seconds } = sceneTrackTimeline(scene.beats, { b1: 1.8, b2: 1.5 });
    expect(timeline.map((item) => item.beatId)).toEqual(["b1", "b2", "b3"]);
    expect(timeline[0].start).toBeCloseTo(0.4);
    expect(timeline[1].start).toBeCloseTo(0.4 + 1.8 + 0.35);
    expect(timeline[2].silent).toBe(true);
    expect(Number.isInteger(seconds)).toBe(true);
    expect(seconds).toBeGreaterThanOrEqual(Math.ceil(timeline[2].end + 0.6));
  });
  it("never makes a clip shorter than the model minimum", () => {
    expect(sceneTrackTimeline([scene.beats[1]], { b2: 0.5 }).seconds).toBe(MIN_CLIP_SECONDS);
  });
});

describe("storyboard and Seedance prompts", () => {
  const refs = sceneReferences(scene, { cast, sheets: { lily: "a", adrian: "b", sienna: "c" }, locationSheet: "loc" });
  it("numbers each reference once: character sheets, then the location, then the grid", () => {
    expect(refs).toEqual({ characters: { lily: 1, adrian: 2 }, location: 3, grid: 4, audio: 1 });
  });
  it("writes a character-locked storyboard with a VOICE line on every panel", () => {
    const prompt = storyboardPrompt(scene, { cast, location, style: "photoreal", refs: { characters: refs.characters, location: refs.location } });
    expect(prompt).toContain("CHARACTER LOCK");
    expect(prompt).toContain("LILY (image 1)");
    expect(prompt).toContain('VOICE: ADRIAN (cold): "One year. Sign it."');
    expect(prompt).toContain("VOICE: (BEAT. NO WORDS.)");
    expect(prompt).toContain("Sheet layout = 9:16");
    expect(prompt).not.toContain("SIENNA");
  });
  it("drives the clip from the dialogue audio with a timeline that covers the whole clip", () => {
    const { timeline, seconds } = sceneTrackTimeline(scene.beats, { b1: 1.8, b2: 1.5 });
    const prompt = seedancePrompt(scene, { cast, location, style: "photoreal", refs, seconds, timeline });
    expect(prompt).toContain("Character LILY: @image1");
    expect(prompt).toContain("Character ADRIAN: @image2");
    expect(prompt).toContain("storyboard grid @image4");
    expect(prompt).toContain("@audio1 as the complete dialogue and audio track");
    expect(prompt).toContain('LILY replies (defiant): "And if I say no?"');
    expect(prompt).toMatch(new RegExp(`-0:0${seconds}: Insert`));
    expect(prompt).toContain("NO MUSIC");
  });
  it("tells the video model that 3D-model references still render as live action", () => {
    const { timeline, seconds } = sceneTrackTimeline(scene.beats, { b1: 1.8, b2: 1.5 });
    const prompt = seedancePrompt(scene, { cast, location, style: "photoreal", refs, seconds, timeline, modelRefs: true });
    expect(prompt).toContain("Character LILY: @image1 - mid-20s, chestnut hair, freckles; wears cream knit sweater");
    expect(prompt).toContain("stylized 3D character-model guides");
    expect(prompt).toContain("never as a 3D render");
  });
  it("renders from descriptions alone, keeping only the location sheet", () => {
    const textRefs = sceneReferences(scene, { cast, sheets: { lily: "a", adrian: "b" }, locationSheet: "loc", textOnly: true });
    expect(textRefs).toEqual({ characters: {}, location: 1, grid: 0, audio: 1 });
    const { timeline, seconds } = sceneTrackTimeline(scene.beats, { b1: 1.8, b2: 1.5 });
    const prompt = seedancePrompt(scene, { cast, location, style: "photoreal", refs: textRefs, seconds, timeline });
    expect(prompt).not.toContain("@image1 -");
    expect(prompt).not.toContain("storyboard grid");
    expect(prompt).toContain("Character ADRIAN: early-30s, dark swept-back hair; wears charcoal suit");
    expect(prompt).toContain("Location Penthouse office: @image1");
    expect(prompt).toContain("look exactly as described above");
    expect(prompt).toContain("@audio1 as the complete dialogue");
  });
});

describe("video-model references", () => {
  it("treats live-action and unknown styles as photoreal", () => {
    expect(isPhotorealStyle("preset:documentary")).toBe(true);
    expect(isPhotorealStyle("preset:mono")).toBe(true);
    expect(isPhotorealStyle("custom:abc")).toBe(true);
    expect(isPhotorealStyle("preset:anime")).toBe(false);
    expect(isPhotorealStyle("preset:clay", [{ id: "preset:clay" }])).toBe(false);
  });
  it("asks for a clearly 3D model that keeps identity and layout", () => {
    expect(modelReferencePrompt("character")).toContain("never as a photograph");
    expect(modelReferencePrompt("character")).toContain("same face shape");
    expect(modelReferencePrompt("storyboard")).toContain("same panel grid");
    expect(modelReferencePrompt("storyboard")).toContain("9:16");
  });
  it("spots face refusals but not unrelated failures", () => {
    expect(refusedForFaces("OpenRouter (400): InputImageSensitiveContentDetected.PrivacyInformation")).toBe(true);
    expect(refusedForFaces("The video model failed this scene: the image may contain a real person")).toBe(true);
    expect(refusedForFaces("OpenRouter (502): upstream interface timeout")).toBe(false);
    expect(refusedForFaces("The video model took too long. Run the scene again.")).toBe(false);
  });
});

describe("voice design", () => {
  it("offers three voices that fit the described gender", () => {
    expect(designVoiceCandidates("a cold British woman in her thirties")).toHaveLength(3);
    expect(designVoiceCandidates("a gruff old man").every((id) => !["sage", "coral", "shimmer", "marin"].includes(id))).toBe(true);
  });
});

describe("clip cost estimate", () => {
  it("estimates from the cheapest provider's per-second rate, not per-token", () => {
    // 10s final at OpenSand's $0.0525/s; the old estimator returned ~$2.31.
    expect(clipCostEstimate(10, "final")).toBe(0.53);
    // 10s draft at Atlas Cloud's $0.027/s; the old estimator returned ~$0.4.
    expect(clipCostEstimate(10, "draft")).toBe(0.27);
  });
  it("scales with duration and treats unknown quality as final", () => {
    expect(clipCostEstimate(5, "final")).toBe(0.26);
    expect(clipCostEstimate(5)).toBe(clipCostEstimate(5, "final"));
  });
});
