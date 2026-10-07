import { describe, expect, it } from "vitest";
import { graphicHtml, graphicsPlanPrompt, normalizeGraphic, normalizeGraphicsPlan } from "./videoGraphics.js";
import { findLook, transitionFilter, VIDEO_LOOKS } from "./videoLooks.js";
import { creatorVibeProject } from "../../server/creatorWorkspace.js";

const scenes = Array.from({ length: 10 }, (_, i) => ({ id: `scene-${i}`, start: i * 4, end: i * 4 + 4, text: `Line ${i}` }));

describe("motion-graphic cards", () => {
  it("keeps only cards it can draw", () => {
    expect(normalizeGraphic({ kind: "year", vars: { year: "1965", label: "x" } })).toMatchObject({ kind: "year" });
    expect(normalizeGraphic({ kind: "year", vars: { year: "long ago" } })).toBeNull();
    expect(normalizeGraphic({ kind: "stat", vars: { value: "$390" } })?.vars.value).toBe("$390");
    expect(normalizeGraphic({ kind: "rank", vars: { rank: 0, title: "x" } })).toBeNull();
    expect(normalizeGraphic({ kind: "bars", vars: { items: [{ label: "a", value: "62%" }, { label: "b", value: 3 }] } })?.vars.items[0].value).toBe(62);
    expect(normalizeGraphic({ kind: "bars", vars: { items: [{ label: "a", value: 1 }] } })).toBeNull();
    expect(normalizeGraphic({ kind: "list", vars: { items: [{ label: "a", value: "b" }, { label: "c", value: "d" }] } })).not.toBeNull();
    expect(normalizeGraphic({ kind: "nope", vars: {} })).toBeNull();
  });

  it("spaces cards out, skips the opener, and keeps every countdown rank", () => {
    const raw = { graphics: [
      { sceneId: "scene-0", kind: "year", vars: { year: "1965" } },
      { sceneId: "scene-2", kind: "stat", vars: { value: "$5" } },
      { sceneId: "scene-3", kind: "stat", vars: { value: "$6" } },
      { sceneId: "scene-5", kind: "rank", vars: { rank: 9, title: "A" } },
      { sceneId: "scene-6", kind: "rank", vars: { rank: 8, title: "B" } },
      { sceneId: "ghost", kind: "year", vars: { year: "1999" } },
    ] };
    expect(normalizeGraphicsPlan(raw, scenes).map((g) => g.sceneId)).toEqual(["scene-2", "scene-5"]);
    expect(normalizeGraphicsPlan(raw, scenes, { format: "top10" }).map((g) => g.sceneId)).toEqual(["scene-2", "scene-5", "scene-6"]);
    expect(graphicsPlanPrompt({ scenes, format: "top10" }).system).toContain("countdown video");
  });

  it("builds a seekable document in the look's palette", () => {
    const html = graphicHtml({ kind: "stat", vars: { value: "$390", label: "a jar", note: "" } }, { width: 1080, height: 1920, duration: 5, look: "paper", background: "bg" });
    expect(html).toContain('id="stage"');
    expect(html).toContain("window.seek=");
    expect(html).toContain(findLook("paper").theme.bg);
    expect(html).toContain('"asset:bg"');
    expect(html).not.toContain("</script><script>alert");
  });

  it("has a filter for every look but natural, and transitions that never touch the first scene's entrance", () => {
    expect(VIDEO_LOOKS.filter((l) => l.id !== "none").every((l) => l.filter)).toBe(true);
    expect(transitionFilter("flash", { seconds: 3, first: true })).toBe("");
    expect(transitionFilter("flash", { seconds: 3 })).toContain("color=white");
    expect(transitionFilter("fade", { seconds: 0.5 })).toBe("");
  });
});

describe("Create Video to Vibe Edit", () => {
  it("lays scenes, narration, music, and captions on the timeline", () => {
    const project = {
      id: "p1",
      title: "Old backyards",
      metadata: { settings: { aspect: "16:9", soundtrackVolume: 0.2 } },
      outputs: {
        title: { current: "10 Old Backyard Features" },
        voiceover: { asset: "/v.wav", duration: 8, segments: [{ start: 0, end: 4, text: "one two three four five six seven" }, { start: 4, end: 8, text: "eight nine", words: [{ word: "eight", start: 4, end: 5 }, { word: "nine", start: 5, end: 6 }] }] },
        soundtrack: { asset: "/m.mp3", duration: 30 },
        visualPlan: { scenes: [{ id: "scene-a", start: 0, end: 5, asset: "/a.png", clip: "/a.mp4", stock: { clipSeconds: 3 } }, { id: "scene-b", start: 5, end: 8, asset: "/b.png" }] },
      },
    };
    const media = new Map([
      ["scene-a", { picture: { file: "gen-a.png", url: "/a" }, clip: { file: "gen-a.mp4", url: "/ac" } }],
      ["scene-b", { picture: { file: "gen-b.png", url: "/b" }, clip: null }],
    ]);
    const doc = creatorVibeProject(project, { media, narration: { file: "gen-v.wav", url: "/v" }, music: { file: "gen-m.mp3", url: "/m" } });
    expect(doc.clips.map((c) => [c.start, c.out])).toEqual([[0, 3], [3, 2], [5, 3]]);
    expect(doc.audio.find((a) => a.id === "bed")).toMatchObject({ volume: 0.2, out: 8 });
    expect(doc.captions.cues.map((c) => c.text)).toEqual(["one two three four five six", "seven", "eight nine"]);
    expect(doc.captions.cues[2].words[1]).toMatchObject({ w: "nine", t0: 5, t1: 6 });
  });
});

describe("motion overlays", async () => {
  const { cueTime, normalizeOverlay, normalizeOverlayPlan, overlayBatches, overlayTemplate } = await import("./videoOverlays.js");
  const { validateCreatorScenes } = await import("./creatorPipeline.js");
  const words = [{ word: "In", start: 4.1 }, { word: "1965,", start: 4.3 }, { word: "Max", start: 5.0 }, { word: "Huber", start: 5.3 }];
  const plan = [{ id: "scene-0", start: 0, end: 4, text: "a" }, { id: "scene-1", start: 4, end: 8, text: "In 1965, Max Huber" }, { id: "scene-2", start: 8, end: 12, text: "b", graphic: { kind: "year" } }];

  it("times an overlay to the word that cues it", () => {
    expect(cueTime("Max Huber", plan[1], words)).toBeCloseTo(4.85, 2);
    expect(cueTime("nowhere", plan[1], words)).toBeCloseTo(4.4, 2);
  });

  it("cleans overlays and keeps them apart and off data cards", () => {
    expect(normalizeOverlay({ kind: "stamp", vars: { value: "no digits" } })).toBeNull();
    expect(normalizeOverlay({ kind: "progress", vars: { rank: 12, total: 10 } })).toBeNull();
    const raw = { overlays: [
      { sceneId: "scene-1", kind: "lower-third", cue: "Max Huber", vars: { title: "Max Huber", subtitle: "Physicist" } },
      { sceneId: "scene-1", kind: "stamp", cue: "1965", vars: { value: "1965" } },
      { sceneId: "scene-2", kind: "keyword", cue: "b", vars: { text: "Kelp" } },
      { sceneId: "scene-1", kind: "progress", cue: "In", vars: { rank: 7, total: 10, title: "x" } },
    ] };
    const out = normalizeOverlayPlan(raw, plan, words, { total: 12 });
    expect(out.map((o) => o.kind)).toEqual(["stamp"]);
    expect(normalizeOverlayPlan(raw, plan, words, { total: 12, format: "top10" }).map((o) => o.kind)).toEqual(["progress", "stamp"]);
    expect(overlayBatches(out)[0].rows[0].value).toBe("1965");
  });

  it("builds a HyperFrames composition with declared variables and a registered timeline", () => {
    const html = overlayTemplate("lower-third", { width: 1080, height: 1920, look: "paper" });
    expect(html).toContain("data-composition-variables=");
    expect(html).toContain('window.__timelines["root"]=tl');
    expect(html).toContain('data-width="1080"');
  });

  it("lets an edit remove overlays but never add one", () => {
    const original = [{ id: "scene-a", start: 0, end: 2, text: "a", prompt: "p", asset: "/a.png", overlays: [{ id: "ov-1" }, { id: "ov-2" }] }];
    const removed = validateCreatorScenes([{ ...original[0], overlays: [{ id: "ov-2" }, { id: "ov-forged", asset: "/x" }] }], original, 2);
    expect(removed[0].overlays).toEqual([{ id: "ov-2" }]);
    const untouched = validateCreatorScenes([{ ...original[0], overlays: undefined }], original, 2);
    expect(untouched[0].overlays).toHaveLength(2);
  });
});
