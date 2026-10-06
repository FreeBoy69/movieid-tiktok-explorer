import { describe, expect, it } from "vitest";
import { buildRecapPlan, centreShortCuts, centreVerdict, markSubtitledCuts, matchCutsToFrames, mirrorCloseCuts, recapScriptPrompt, recapVibeProject, scriptShortfall, shortHalfWindow } from "./movieRecap.js";

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
      const voice = edit[format].beats.reduce((sum, b) => sum + b.seconds + 0.12, 0);
      expect(picture).toBeCloseTo(voice, 2);
    }
    expect(plan.formats.long.audioFiles).toHaveLength(40);
    expect(plan.formats.long.captions[0].start).toBe(0);
  });

  it("matches every cut to the frame that shows its words, then re-plans around them", async () => {
    const first = buildRecapPlan(project, analysis);
    const described: Record<number, string> = {};
    analysis.shots.forEach((s) => { described[s.i] = s.i % 2 ? "a woman reads a letter by the window" : "a man walks down a corridor"; });
    let asked = "";
    const request: any = async ({ messages }: any) => {
      asked = messages[0].content;
      const lines = [...asked.matchAll(/LINE (\S+):[\s\S]*?FRAMES:\n((?:  #.*\n?)+)/g)].map((m) => {
        const frames = [...m[2].matchAll(/#(\d+)/g)].map((f) => Number(f[1])).filter((n) => n % 2);
        const cuts = (first.edit.long.cuts.filter((c: any) => c.beatId === m[1]));
        return { id: m[1], cuts: cuts.map((_: any, k: number) => frames[Math.min(frames.length - 1, k * 3)]) };
      });
      return { value: { lines }, model: "stub" };
    };
    const matches = await matchCutsToFrames({ ...project, options: { ...project.options, formats: ["long"] } }, analysis, described, first.edit, { request });
    expect(asked).toContain("says:");
    expect(Object.keys(matches.long).length).toBeGreaterThan(30);
    const { plan } = buildRecapPlan(project, analysis, matches);
    // Every matched cut is centred on a "woman reads a letter" frame (odd shots, t = 1.5 + 3i).
    const centred = plan.formats.long.cuts.filter((c: any) => { const mid = (c.start + c.end) / 2; return Math.abs(((mid - 1.5) / 3) % 2 - 1) < 0.05; });
    expect(centred.length / plan.formats.long.cuts.length).toBeGreaterThan(0.6);
    const sorted = [...plan.formats.long.cuts].sort((a: any, b: any) => a.start - b.start);
    for (let i = 1; i < sorted.length; i++) expect(sorted[i].start - sorted[i - 1].end).toBeGreaterThanOrEqual(1.5 - 1e-9);
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

describe("movie recap script", () => {
  const options = { ...project.options, longMinutes: 12, shortSeconds: 60, tone: "dramatic", filmTitle: "Paper Vows", channelName: "Unicorn Recaps" };
  const prompt = recapScriptPrompt({ ...project, options }, { duration: film, shotEvery: 3, shots: [], transcript: [] }, {});

  it("asks for the house opening, outro, and a word budget", () => {
    expect(prompt.prompt).toContain("Hi, welcome to Unicorn Recaps.");
    expect(prompt.prompt).toContain("Thank you for watching Unicorn Recaps. This has been our recap of Paper Vows.");
    expect(prompt.shortWords).toBe(200);
    expect(prompt.longWords).toBe(2220);
  });

  it("flags a draft that underwrites the Short", () => {
    const words = (n: number) => [{ text: Array(n).fill("word").join(" ") }];
    expect(scriptShortfall({ long: { beats: words(2200) }, short: { beats: words(97) } }, prompt)).toMatch(/The Short has 97 words but needs about 200/);
    expect(scriptShortfall({ long: { beats: words(2200) }, short: { beats: words(190) } }, prompt)).toBe("");
  });
});

describe("short centring check", () => {
  const half = shortHalfWindow(16 / 9, true);

  it("centres a character the crop can reach and rejects one at the edge or missing", () => {
    expect(half).toBeGreaterThan(0.19);
    expect(half).toBeLessThan(0.22);
    expect(centreVerdict(0.5, 0.6, half)).toMatchObject({ ok: true, x0: 0.5, x1: 0.6 });
    expect(centreVerdict(0.18, 0.2, half).ok).toBe(true); // clamped, but within slack
    expect(centreVerdict(0.04, 0.05, half)).toMatchObject({ ok: false, reason: "edge" });
    expect(centreVerdict(null as any, undefined as any, half)).toMatchObject({ ok: false, reason: "no-character" });
    expect(centreVerdict(null as any, 0.55, half)).toMatchObject({ ok: true, x0: 0.55, x1: 0.55 });
  });

  it("swaps cuts whose character can't be centred, then crops every cut on the character", async () => {
    const described: Record<string, any> = {};
    for (const shot of analysis.shots) { described[shot.i] = "the detective reads the letter"; described[`tag:${shot.i}`] = { s: "medium", a: true, t: false, k: false, g: false, e: false }; }
    const built = buildRecapPlan(project, analysis);
    const total = built.plan.formats.short.cuts.length;
    let looks = 0;
    let bad = new Set<number>();
    const look = async (times: number[]) => {
      looks++;
      // First look: the first cut has its character at the far left edge; afterwards everything is centrable.
      bad = looks === 1 ? new Set([0, 1]) : new Set();
      return { frames: times.map(() => Buffer.from("jpg")), aspect: 16 / 9 };
    };
    const request = async ({ messages }: any) => {
      const shown = messages[0].content.filter((part: any) => part.type === "text" && /^Frame \d+:$/.test(part.text)).map((part: any) => Number(part.text.match(/\d+/)[0]));
      return { value: { frames: shown.map((n: number) => ({ n, x: bad.has(n) ? 3 : 45 })) }, model: "test" };
    };
    const result = await centreShortCuts(project, analysis, described, built, {}, { look, request: request as any });
    expect(looks).toBe(2);
    expect(result.check).toEqual({ cuts: total, centred: total, replaced: 1 });
    expect(result.stats.short.centred).toBe(total);
    for (const cut of result.plan.formats.short.cuts) expect(cut).toMatchObject({ x0: 0.45, x1: 0.45 });
    expect(result.plan.formats.long).toEqual(built.plan.formats.long);
  });
});

describe("mirroring close cuts", () => {
  it("mirrors a cut that follows the previous one closely in the film, never two in a row", () => {
    const cuts = mirrorCloseCuts([
      { start: 100, end: 103, duration: 3 },
      { start: 105, end: 108, duration: 3 },
      { start: 110, end: 113, duration: 3 },
      { start: 115, end: 118, duration: 3 },
      { start: 400, end: 403, duration: 3 },
    ]);
    expect(cuts.map((cut: any) => Boolean(cut.flip))).toEqual([false, true, false, true, false]);
  });
});

describe("film subtitles", () => {
  const plan = { formats: { long: { cuts: [{ start: 100, end: 103.5, duration: 3.5 }, { start: 400, end: 403, duration: 3 }, { start: 900, end: 903, duration: 3 }] } } };
  const shots = Array.from({ length: 400 }, (_, i) => ({ i, t: 1.5 + i * 3 }));

  it("blurs only cuts near a subtitled frame when subtitles are occasional", () => {
    const described: Record<string, any> = {};
    for (const shot of shots) { described[shot.i] = "x"; described[`tag:${shot.i}`] = { s: "medium", a: true, u: shot.i === 133 }; } // t = 400.5
    const marked = markSubtitledCuts(plan, { duration: 1200, shots, transcript: [{ start: 101, end: 104, text: "hi" }] } as any, described);
    expect(marked.formats.long.cuts.map((cut: any) => Boolean(cut.subs))).toEqual([false, true, false]);
  });

  it("blurs every cut over dialogue in a subtitled film", () => {
    const described: Record<string, any> = {};
    for (const shot of shots) { described[shot.i] = "x"; described[`tag:${shot.i}`] = { s: "medium", a: true, u: shot.i % 3 === 0 && shot.i > 200 }; }
    const marked = markSubtitledCuts(plan, { duration: 1200, shots, transcript: [{ start: 101, end: 104, text: "hi" }] } as any, described);
    expect(marked.formats.long.cuts.map((cut: any) => Boolean(cut.subs))).toEqual([true, false, true]);
  });

  it("leaves a film without subtitles alone", () => {
    expect(markSubtitledCuts(plan, { duration: 1200, shots, transcript: [] } as any, {})).toBe(plan);
  });
});
