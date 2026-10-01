import { describe, expect, it } from "vitest";
import { findCollisions, findOverflow, yielder, type Box } from "./designFit";

const box = (id: string, left: number, top: number, right: number, bottom: number, fontSize = 20): Box => ({ id, left, top, right, bottom, fontSize });

describe("design text fitting", () => {
  it("finds a wrapped headline running into the line below it", () => {
    const headline = box("headline", 80, 140, 1000, 470, 150);
    const subhead = box("subhead", 80, 455, 900, 500, 34);
    const price = box("price", 80, 1300, 600, 1400, 50);
    const hits = findCollisions([headline, subhead, price]);
    expect(hits).toHaveLength(1);
    expect(hits[0].slice(0, 2).map((b) => (b as Box).id)).toEqual(["headline", "subhead"]);
  });

  it("ignores boxes that only touch or graze", () => {
    expect(findCollisions([box("a", 0, 0, 100, 50), box("b", 0, 50, 100, 100)])).toEqual([]);
    expect(findCollisions([box("a", 0, 0, 100, 50), box("b", 0, 47, 100, 100)])).toEqual([]);
    expect(findCollisions([box("a", 0, 0, 1000, 400), box("b", 990, 390, 1100, 500)])).toEqual([]);
  });

  it("shrinks the larger type first, then the smaller once the larger is at its floor", () => {
    const a = box("headline", 0, 0, 10, 10, 150);
    const b = box("subhead", 0, 0, 10, 10, 34);
    expect(yielder(a, b, new Map())?.id).toBe("headline");
    expect(yielder(a, b, new Map([["headline", 150]]))?.id).toBe("subhead");
    expect(yielder(a, b, new Map([["headline", 150], ["subhead", 34]]))).toBeNull();
  });

  it("flags text spilling off the canvas", () => {
    expect(findOverflow([box("ok", 10, 10, 1190, 1590), box("wide", 10, 10, 1260, 80)], 1200, 1600).map((b) => b.id)).toEqual(["wide"]);
  });
});
