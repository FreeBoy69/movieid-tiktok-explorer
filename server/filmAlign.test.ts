import { describe, expect, it } from "vitest";
import { alignBeats } from "./filmBounds.js";

// A 30-minute film: the opening at a lake, a mailbox in the middle, the summit at the end.
const analysis = {
  duration: 1800,
  shots: [],
  transcript: [
    { start: 120, text: "Meet me at the lake, Shiloh." },
    { start: 130, text: "The lake is cold." },
    { start: 900, text: "Check the mailbox for the letter." },
    { start: 905, text: "A postal truck." },
    { start: 1600, text: "We made it to the summit, Jax." },
    { start: 1610, text: "The summit bridge is broken." },
  ],
};
const story = { start: 60, end: 1740 };

describe("placing script lines in the film", () => {
  it("moves lines whose stretch lags behind what they describe, keeping film order", () => {
    // The writer's stretches drifted: every line points far too early.
    const beats = [
      { text: "Shiloh waits by the cold lake.", from: 100, to: 160 },
      { text: "Jax opens the mailbox and finds the letter from the postal truck.", from: 300, to: 360 },
      { text: "On the summit, Jax crosses the broken bridge.", from: 600, to: 660 },
    ];
    const placed = alignBeats(beats, analysis, {}, story, { chronological: true });
    expect(placed[0].moved).toBe(false);
    expect(placed[1].centre).toBeGreaterThan(850);
    expect(placed[1].centre).toBeLessThan(950);
    expect(placed[2].centre).toBeGreaterThan(1550);
    expect(placed.map((p) => p.centre)).toEqual([...placed.map((p) => p.centre)].sort((a, b) => a - b));
  });

  it("keeps a Short line where it fits even out of film order", () => {
    const beats = [{ text: "On the summit, Jax crosses the broken bridge.", from: 0, to: 0 }, { text: "Shiloh waits by the cold lake.", from: 0, to: 0 }];
    const placed = alignBeats(beats, analysis, {}, story, { chronological: false });
    expect(placed[0].centre).toBeGreaterThan(1550);
    expect(placed[1].centre).toBeLessThan(200);
  });
});
