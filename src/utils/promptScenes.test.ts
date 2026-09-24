import { describe, expect, it } from "vitest";
import { countScenes, isMultiScene } from "./promptScenes.js";

describe("countScenes", () => {
  it("counts timed segments", () => {
    expect(countScenes("00:00–00:03 — WAKE\n00:03–00:06 — WIPE\n00:06–00:09 — DRAW")).toBe(3);
    expect(countScenes("0-4 seconds: push in. 4-9 seconds: close-up. 9-15 seconds: both faces.")).toBe(3);
    expect(countScenes("0–2s · Cold open\n2–8s · Confrontation\n8–12s · Cliffhanger")).toBe(3);
  });
  it("counts numbered shots, declared counts, and sequence lists", () => {
    expect(countScenes("Shot 1 — Establish. Shot 2 — Close. Shot 4–5 — Escalation. Shot 6 — Black.")).toBe(5);
    expect(countScenes("15 seconds. 7 hard-cut shots in 7 different locations.")).toBe(7);
    expect(countScenes("A detailed, three-shot prompt")).toBe(3);
    expect(countScenes("Rain on a porch.\n\nSequence:\n- She looks down.\n- She takes out earphones.\n- She leans on the post.")).toBe(3);
  });
  it("treats a single continuous description as one scene", () => {
    expect(countScenes("Shot on ARRI Alexa, 4–15 seconds duration, 1080p, slow push-in")).toBe(1);
    expect(countScenes("")).toBe(1);
    expect(isMultiScene("A girl walks along the beach at golden hour.")).toBe(false);
  });
});
