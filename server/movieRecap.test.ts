import { describe, expect, it } from "vitest";
import { buildRecapPlan, recapVibeProject } from "./movieRecap.js";

const film = 6000;
const analysis = { duration: film, shots: Array.from({ length: 2000 }, (_, i) => ({ i, t: 1.5 + i * 3 })) };
const beats = (n: number, seconds: number) => Array.from({ length: n }, (_, i) => ({ id: `b${i}`, text: "The detective finds the letter and realises her brother lied about that night.", from: i * 90, to: i * 90 + 60, shots: [i * 30 + 2], audio: `a${i}.wav`, seconds }));
const project = {
  id: "rcp_0123456789abcdef01234567",
  title: "Paper Vows",
  options: { formats: ["long", "short"], transforms: { zoom: true, color: true, mirror: false, speed: false }, captions: true },
  script: { title: "Paper Vows", long: { beats: beats(40, 14) }, short: { title: "She signed it anyway", beats: beats(6, 9).map((b, i) => ({ ...b, from: [5000, 100, 900, 2000, 4000, 5400][i] })) } },
} as any;

describe("movie recap plan", () => {
  it("plans legal cuts for both formats and lines narration up end to end", () => {
    const { plan, stats, edit } = buildRecapPlan(project, analysis);
    for (const format of ["long", "short"] as const) {
      const cuts = plan.formats[format].cuts;
      for (const cut of cuts) expect(cut.duration).toBeLessThanOrEqual(4 + 1e-9);
      const sorted = [...cuts].sort((a, b) => a.start - b.start);
      for (let i = 1; i < sorted.length; i++) expect(sorted[i].start - sorted[i - 1].end).toBeGreaterThanOrEqual(1.5 - 1e-9);
      expect(stats[format].shortestGap).toBeGreaterThanOrEqual(1.5);
      // The picture covers exactly the narration plus its pauses.
      const picture = edit[format].cuts.reduce((sum, c) => sum + c.duration, 0);
      const voice = edit[format].beats.reduce((sum, b) => sum + b.seconds + 0.35, 0);
      expect(picture).toBeCloseTo(voice, 2);
    }
    expect(plan.formats.long.audioFiles).toHaveLength(40);
    expect(plan.formats.long.captions[0].start).toBe(0);
  });

  it("lands the render in Vibe Edit with every cut, line, and caption editable", () => {
    const { edit } = buildRecapPlan(project, analysis);
    const doc = recapVibeProject({ ...project, edit }, "short", { file: "gen-a.mp4", url: "/a", duration: 60 }, { file: "gen-b.m4a", url: "/b", duration: 58 });
    expect(doc.id).toMatch(/^vp_[a-z0-9]+$/);
    expect(doc.aspect).toBe("9:16");
    expect(doc.clips).toHaveLength(edit.short.cuts.length);
    expect(doc.clips[1].start).toBeCloseTo(doc.clips[0].out, 3);
    expect(doc.clips.every((c: any) => c.in === c.start)).toBe(true);
    expect(doc.audio).toHaveLength(6);
    expect(doc.captions.cues[0].words.length).toBeGreaterThan(1);
    expect(doc.name).toContain("She signed it anyway");
  });
});
