import { describe, expect, it } from "vitest";
import { moveAt, sceneMove, zoompanFilter } from "./sceneMotion.js";

describe("scene pan and zoom", () => {
  it("rotates moves so neighbouring scenes never repeat a direction", () => {
    expect([0, 1, 2, 3, 4].map(sceneMove)).toEqual(["in", "right", "out", "left", "in"]);
    expect(sceneMove(-1)).toBe("left");
  });

  it("travels the full move across the scene", () => {
    expect(moveAt("in", 0).scale).toBe(1);
    expect(moveAt("in", 1).scale).toBeCloseTo(1.2);
    expect(moveAt("out", 0).scale).toBeCloseTo(1.2);
    expect(moveAt("right", 0)).toMatchObject({ x: 0 });
    expect(moveAt("right", 1)).toMatchObject({ x: 1 });
    expect(moveAt("left", 0.25)).toMatchObject({ x: 0.75 });
    expect(moveAt("in", 7).scale).toBeCloseTo(1.2);
  });

  it("builds the matching zoompan filter", () => {
    const filter = zoompanFilter("in", 120, [1280, 720]);
    expect(filter).toContain("z='1+0.2*min(on/119,1)'");
    expect(filter).toContain("d=120:s=1280x720:fps=30");
    expect(zoompanFilter("left", 90, [720, 1280])).toContain("x='(iw-iw/zoom)*(1-min(on/89,1))'");
  });
});
