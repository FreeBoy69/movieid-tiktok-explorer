import { describe, expect, it } from "vitest";
import { brollMoments, findFillers, findRetakes, findSilences, gradeFilter, mergeRanges, punchInCuts, rippleRanges, speechCuts } from "./vibeAutoEdit";
import { emptyProject, type VibeProject, type VibeWord } from "./vibeEdit";

const say = (text: string, from = 0, per = 0.4): VibeWord[] => text.split(" ").map((w, i) => ({ w, t0: from + i * per, t1: from + i * per + per * 0.8 }));

function talkingHead(seconds = 20): VibeProject {
  const p = emptyProject();
  return {
    ...p,
    assets: [{ id: "v", kind: "video", name: "take", url: "/v.mp4", duration: 60 }, { id: "m", kind: "audio", name: "bed", url: "/m.mp3", duration: 60, origin: "music" }],
    clips: [{ id: "c1", assetId: "v", track: 0, start: 0, in: 5, out: 5 + seconds }],
    audio: [{ id: "a1", assetId: "m", lane: 0, start: 0, in: 0, out: seconds, volume: 0.2 }],
    texts: [{ id: "t1", text: "Hook", start: 0, end: 3, x: 0.5, y: 0.2, size: 80, color: "#fff" }],
    captions: { ...p.captions, cues: [{ id: "q1", start: 4, end: 9, text: "one two three", words: [{ w: "one", t0: 4, t1: 4.5 }, { w: "two", t0: 6, t1: 6.5 }, { w: "three", t0: 8, t1: 8.5 }] }] },
  };
}

describe("finding what to cut", () => {
  it("cuts pauses past the threshold and keeps a breath either side", () => {
    const words = [...say("so here is the thing"), ...say("you need this", 4)];
    const silences = findSilences(words, { minSilence: 0.5, pad: 0.1, start: 0, end: 8 });
    expect(silences).toHaveLength(2);
    expect(silences[0][0]).toBeCloseTo(2.02, 2);
    expect(silences[0][1]).toBeCloseTo(3.9, 2);
    expect(silences[1][0]).toBeCloseTo(5.22, 2);
  });

  it("removes filler words without eating the words around them", () => {
    const words = say("so um I think uh yes");
    const fillers = findFillers(words);
    expect(fillers).toHaveLength(2);
    expect(fillers[0][0]).toBeGreaterThanOrEqual(words[0].t1);
    expect(fillers[0][1]).toBeLessThanOrEqual(words[2].t0);
  });

  it("drops the abandoned first try of a retaken line", () => {
    const words = say("so today I want so today I want to show you this");
    expect(findRetakes(words)).toEqual([[words[0].t0, words[4].t0]]);
    expect(findRetakes(say("we went to the store and then we went home"))).toEqual([]);
  });

  it("merges the cuts and totals the time saved", () => {
    expect(mergeRanges([[3, 4], [1, 2], [2.02, 2.5]])).toEqual([[1, 2.5], [3, 4]]);
    const cuts = speechCuts([...say("um so today I want so today I want to"), ...say("go", 8)], {}, { start: 0, end: 9 });
    expect(cuts.fillers).toHaveLength(1);
    expect(cuts.retakes).toHaveLength(1);
    expect(cuts.silences.length).toBeGreaterThan(0);
    expect(cuts.seconds).toBeGreaterThan(3);
  });
});

describe("cutting the timeline", () => {
  it("splits clips, closes the gap, and keeps everything in sync", () => {
    const next = rippleRanges(talkingHead(), [[5, 7]]);
    const pieces = next.clips.sort((a, b) => a.start - b.start);
    expect(pieces).toHaveLength(2);
    expect(pieces[0]).toMatchObject({ start: 0, in: 5, out: 10 });
    expect(pieces[1]).toMatchObject({ start: 5, in: 12, out: 25 });
    // The music bed plays straight through the cut, two seconds shorter.
    expect(next.audio).toHaveLength(1);
    expect(next.audio[0]).toMatchObject({ start: 0, in: 0, out: 18 });
    expect(next.texts[0]).toMatchObject({ start: 0, end: 3 });
    const cue = next.captions.cues[0];
    expect(cue.words?.map((w) => w.w)).toEqual(["one", "three"]);
    expect(cue.words?.[1].t0).toBeCloseTo(6, 3);
    expect(cue.text).toBe("one three");
  });

  it("removes many spans and stays consistent", () => {
    const next = rippleRanges(talkingHead(), [[1, 2], [10, 12], [15, 16]]);
    const total = next.clips.reduce((s, c) => s + (c.out - c.in), 0);
    expect(total).toBeCloseTo(16, 3);
    const sorted = next.clips.sort((a, b) => a.start - b.start);
    for (let i = 1; i < sorted.length; i++) expect(sorted[i].start).toBeCloseTo(sorted[i - 1].start + (sorted[i - 1].out - sorted[i - 1].in), 3);
  });

  it("punches in on every other piece of a jump-cut take", () => {
    const cut = rippleRanges(talkingHead(), [[3, 4], [8, 9], [12, 13]]);
    const { project, count } = punchInCuts(cut);
    const zooms = project.clips.sort((a, b) => a.start - b.start).map((c) => c.zoom);
    expect(zooms).toEqual([1, 1.12, 1, 1.12]);
    expect(count).toBe(2);
    expect(punchInCuts(talkingHead()).count).toBe(0);
  });
});

describe("look and b-roll", () => {
  it("writes the grade as a CSS filter", () => {
    expect(gradeFilter({ contrast: 1.12, saturation: 1.22, brightness: 0.02 })).toBe("brightness(1.02) contrast(1.12) saturate(1.22)");
    expect(gradeFilter(undefined)).toBe("");
  });

  it("spreads b-roll over spoken moments after the hook", () => {
    const cues = Array.from({ length: 10 }, (_, i) => ({ id: `q${i}`, start: i * 3, end: i * 3 + 2.6, text: "a few spoken words here" }));
    const moments = brollMoments(cues, { count: 3 });
    expect(moments).toHaveLength(3);
    expect(moments[0].start).toBeGreaterThanOrEqual(2.5);
    expect(new Set(moments.map((m) => m.start)).size).toBe(3);
  });
});
