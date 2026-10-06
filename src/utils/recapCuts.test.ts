import { describe, expect, it } from "vitest";
import { cutLengths, planRecapCuts } from "./recapCuts.js";

const film = 2 * 60 * 60;
// A 15-minute recap: 60 beats of 15 s each, in story order across the film.
const beats = Array.from({ length: 60 }, (_, i) => ({ id: `b${i}`, duration: 15, from: 90 + i * 108, to: 90 + (i + 1) * 108 }));

describe("recap cut planner", () => {
  it("keeps every cut between 3 and 4 seconds", () => {
    const { cuts } = planRecapCuts({ beats, filmDuration: film, seed: "x" });
    for (const cut of cuts) {
      expect(cut.duration).toBeGreaterThanOrEqual(3 - 1e-9);
      expect(cut.duration).toBeLessThanOrEqual(4 + 1e-9);
    }
  });

  it("never lets two cuts touch or reuse film, and skips footage between them", () => {
    const { cuts, stats } = planRecapCuts({ beats, filmDuration: film, seed: "y" });
    const sorted = [...cuts].sort((a, b) => a.start - b.start);
    for (let i = 1; i < sorted.length; i++) expect(sorted[i].start - sorted[i - 1].end).toBeGreaterThanOrEqual(1.5 - 1e-9);
    expect(stats.shortestGap).toBeGreaterThanOrEqual(1.5);
  });

  it("fills each beat exactly and lays the timeline end to end", () => {
    const { cuts, stats } = planRecapCuts({ beats, filmDuration: film, seed: "z" });
    for (const beat of beats) {
      const total = cuts.filter((c) => c.beatId === beat.id).reduce((s, c) => s + c.duration, 0);
      expect(total).toBeCloseTo(beat.duration, 2);
    }
    for (let i = 1; i < cuts.length; i++) expect(cuts[i].at).toBeCloseTo(cuts[i - 1].at + cuts[i - 1].duration, 2);
    expect(stats.filmShare).toBeLessThan(0.15);
    expect(stats.averageCut).toBeGreaterThan(3);
  });

  it("follows the story: cuts stay in each beat's stretch and move forward", () => {
    const { cuts } = planRecapCuts({ beats, filmDuration: film, seed: "w" });
    const first = cuts.filter((c) => c.beatId === "b10");
    expect(first[0].start).toBeGreaterThanOrEqual(1170);
    for (let i = 1; i < cuts.length; i++) expect(cuts[i].start).toBeGreaterThan(cuts[i - 1].start);
  });

  it("splits a beat into legal lengths and handles a short beat", () => {
    const lengths = cutLengths(10, {}, () => 0.5);
    expect(lengths.reduce((a, b) => a + b, 0)).toBeCloseTo(10, 5);
    lengths.forEach((l) => { expect(l).toBeGreaterThanOrEqual(3); expect(l).toBeLessThanOrEqual(4); });
    expect(cutLengths(2.2)).toEqual([2.2]);
  });

  it("lets a Short open on a late moment and still never reuse footage", () => {
    const short = [{ id: "hook", duration: 6, from: 6000, to: 6100 }, { id: "setup", duration: 20, from: 0, to: 900 }, { id: "end", duration: 10, from: 6000, to: 6300 }];
    const { cuts } = planRecapCuts({ beats: short, filmDuration: film, seed: "s" });
    expect(cuts.filter((c) => c.beatId === "setup")[0].start).toBeLessThan(900);
    const sorted = [...cuts].sort((a, b) => a.start - b.start);
    for (let i = 1; i < sorted.length; i++) expect(sorted[i].start - sorted[i - 1].end).toBeGreaterThanOrEqual(1.5 - 1e-9);
  });

  it("never cuts from the opening titles or the end credits", () => {
    const { cuts } = planRecapCuts({ beats: [{ id: "end", duration: 30, from: 6900, to: 7200 }, { id: "start", duration: 8, from: 0, to: 60 }], filmDuration: film, seed: "c" });
    for (const cut of cuts) {
      expect(cut.start).toBeGreaterThanOrEqual(72 - 1e-9);
      expect(cut.end).toBeLessThanOrEqual(film - 480 + 1e-9);
    }
  });

  it("is deterministic for a seed", () => {
    expect(planRecapCuts({ beats, filmDuration: film, seed: "same" })).toEqual(planRecapCuts({ beats, filmDuration: film, seed: "same" }));
  });

  it("refuses a recap the film can't supply", () => {
    expect(() => planRecapCuts({ beats: [{ id: "a", duration: 600, from: 0, to: 600 }], filmDuration: 400, seed: "s" })).toThrow(/too short/);
  });
});
