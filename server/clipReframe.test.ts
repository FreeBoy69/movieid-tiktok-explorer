import { describe, expect, it } from "vitest";
import { buildReframeFilter, normalizeFramingAnalysis, pathExpression, smoothPath } from "./clipReframe.js";

const box = (x: number, y = 0.2, w = 0.1, h = 0.2) => ({ x, y, w, h });
const frames = (list: Array<Record<string, unknown>>) => list.map((f, i) => ({ t: i * 1.5, subject: null, faces: [], facecam: null, content: null, ...f }));
const size = { width: 1920, height: 1080, duration: 15, outW: 720, outH: 1280 };
// Evaluates a crop x/y expression at time t (gte, clip and arithmetic only).
const at = (expr: string, t: number) => Function("t", "gte", "clip", `return ${expr};`)(t, (a: number, b: number) => Number(a >= b), (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v)));
const cropAxis = (filter: string, axis: "x" | "y", n = 0) => [...filter.matchAll(new RegExp(`${axis}='([^']*)'`, "g"))][n][1];

describe("AI reframe filter", () => {
  it("falls back to a centre crop on missing or invalid data", () => {
    const centre = "[0:v]crop='min(iw,ih*720/1280)':'min(ih,iw*1280/720)',scale=720:1280,setsar=1[framed]";
    expect(buildReframeFilter(null, size).filter).toBe(centre);
    expect(buildReframeFilter({ layout: "single", frames: [] }, size).filter).toBe(centre);
    expect(buildReframeFilter({ layout: "nonsense", frames: frames([{ subject: box(0.5) }]) }, size).filter).toBe(centre);
    expect(buildReframeFilter({ layout: "single", frames: frames([{ subject: box(0.5) }]) }, { ...size, width: 0 }).filter).toBe(centre);
    expect(buildReframeFilter({ layout: "single", frames: frames([{}, {}]) }, size).layout).toBe("centre");
    expect(buildReframeFilter(null, { outW: 1080, outH: 1080 }).filter).toContain("scale=1080:1080");
  });

  it("follows a single speaker with a crop that stays inside the frame", () => {
    const { filter, label, layout } = buildReframeFilter({ layout: "single", frames: frames([{ subject: box(0.05) }, { subject: box(0.1) }, { subject: box(0.85) }, { subject: box(0.9) }]) }, size);
    expect(label).toBe("[framed]");
    expect(layout).toBe("single");
    expect(filter.startsWith("[0:v]crop=w=606:h=1080:")).toBe(true);
    expect(filter.endsWith("scale=720:1280,setsar=1[framed]")).toBe(true);
    const x = cropAxis(filter, "x");
    for (let t = 0; t <= 4.5; t += 0.25) {
      expect(at(x, t)).toBeGreaterThanOrEqual(0);
      expect(at(x, t)).toBeLessThanOrEqual(1920 - 606);
    }
    // Left speaker first, right speaker at the end (a cut between them).
    expect(at(x, 0)).toBeLessThan(200);
    expect(at(x, 4.5)).toBeGreaterThan(1100);
  });

  it("holds still through small jitter and caps pan speed", () => {
    const jitter = frames([0.45, 0.452, 0.448, 0.451, 0.449].map((x) => ({ subject: box(x) })));
    const { filter } = buildReframeFilter({ layout: "single", frames: jitter }, size);
    expect(cropAxis(filter, "x")).toMatch(/^\d+$/);

    const times = [0, 1.5, 3, 4.5, 6];
    const keys = smoothPath(times, [0, 200, 400, 600, 800], { max: 1314, window: 606, maxSpeed: 100 });
    for (let i = 1; i < keys.length; i++) {
      const speed = Math.abs(keys[i].v - keys[i - 1].v) / (keys[i].t - keys[i - 1].t);
      expect(speed).toBeLessThanOrEqual(100.5);
    }
    const clamped = smoothPath([0, 1.5], [-500, 5000], { max: 1314, window: 606, maxSpeed: 10000 });
    expect(clamped.every((k) => k.v >= 0 && k.v <= 1314)).toBe(true);
  });

  it("writes a flat piecewise-linear expression", () => {
    const expr = pathExpression([{ t: 0, v: 100 }, { t: 2, v: 300 }, { t: 2, v: 900 }, { t: 4, v: 800 }]);
    expect(expr).not.toContain("if(");
    expect(at(expr, 0)).toBe(100);
    expect(at(expr, 1)).toBe(200);
    expect(at(expr, 2.01)).toBeCloseTo(899.5, 0);
    expect(at(expr, 10)).toBe(800);
  });

  it("follows the action subject vertically when the window is shorter than the frame", () => {
    const { filter, layout } = buildReframeFilter({ layout: "action", frames: frames([{ subject: box(0.2, 0.1) }, { subject: box(0.3, 0.6) }]) }, { width: 1080, height: 1920, outW: 1080, outH: 1080 });
    expect(layout).toBe("action");
    expect(filter).toContain("crop=w=1080:h=1080:x='0'");
    const y = cropAxis(filter, "y");
    expect(at(y, 0)).toBeLessThan(at(y, 1.5));
  });

  it("stacks two speakers for split", () => {
    const { filter, layout } = buildReframeFilter({ layout: "split", frames: frames([{ faces: [box(0.7), box(0.15)] }, { faces: [box(0.16), box(0.71)] }]) }, size);
    expect(layout).toBe("split");
    expect(filter).toMatch(/^\[0:v\]split=2\[rfa\]\[rfb\];\[rfa\]crop=.*scale=720:640,setsar=1\[rft\];\[rfb\]crop=.*scale=720:640,setsar=1\[rfm\];\[rft\]\[rfm\]vstack,setsar=1\[framed\]$/);
    // The left face is on top.
    expect(at(cropAxis(filter, "x", 0), 0)).toBeLessThan(at(cropAxis(filter, "x", 1), 0));
  });

  it("falls back to following one face when split only ever sees one", () => {
    expect(buildReframeFilter({ layout: "split", frames: frames([{ faces: [box(0.2)] }, { faces: [box(0.22)] }]) }, size).layout).toBe("single");
  });

  it("puts the facecam over the content for screen and gameplay", () => {
    const facecam = box(0.75, 0.7, 0.2, 0.25);
    const content = { x: 0, y: 0, w: 0.7, h: 1 };
    const game = buildReframeFilter({ layout: "gameplay", frames: frames([{ facecam, content }, { facecam, content }]) }, size);
    expect(game.layout).toBe("gameplay");
    expect(game.filter).toContain("scale=720:512,setsar=1[rft]");
    expect(game.filter).toContain("scale=720:768,setsar=1[rfm]");
    expect(game.filter.endsWith("[rft][rfm]vstack,setsar=1[framed]")).toBe(true);
    const screen = buildReframeFilter({ layout: "screen", frames: frames([{ facecam, content }]) }, size);
    expect(screen.filter).toContain("gblur");
    expect(screen.filter).toContain("crop=1344:1080:0:0");
    expect(buildReframeFilter({ layout: "screen", frames: frames([{ content }]) }, size).layout).toBe("centre");
  });

  it("normalizes model output and drops bad boxes", () => {
    const value = { layout: "bogus", frames: [{ i: 2, subject: { x: 0.9, y: 0.1, w: 0.5, h: 0.2 } }, { i: 1, subject: { x: "a" }, faces: [box(0.1), null, box(0.5), box(0.7)] }] };
    const out = normalizeFramingAnalysis(value, [0, 1.5]);
    expect(out.layout).toBe("single");
    expect(out.frames[0]).toMatchObject({ t: 0, subject: null });
    expect(out.frames[0].faces).toHaveLength(2);
    expect(out.frames[1].subject?.w).toBeCloseTo(0.1);
  });
});
