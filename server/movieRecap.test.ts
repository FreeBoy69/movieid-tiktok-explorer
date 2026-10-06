import { describe, expect, it } from "vitest";
import { buildRecapPlan, centreShortCuts, centreVerdict, chronologicalWindows, cutShortlist, keepInOrder, matchClass, rankShotsForCut, writeJson, markSubtitledCuts, matchCutsToFrames, mirrorCloseCuts, recapScriptPrompt, recapVibeProject, scriptShortfall, shortHalfWindow } from "./movieRecap.js";

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

describe("story bounds in the plan", () => {
  it("keeps every cut between the opening titles and the end credits", () => {
    const bounded = { ...analysis, bounds: { start: 400, end: 5000, from: { start: "TheIntroDB", end: "TheIntroDB" } } };
    const edgy = { ...project, script: { ...project.script, short: { ...project.script.short, beats: project.script.short.beats.map((b: any, i: number) => ({ ...b, from: [5600, 10, 900, 2000, 4000, 5400][i], to: [5900, 200, 960, 2060, 4060, 5900][i] })) } } };
    const { plan } = buildRecapPlan(edgy, bounded);
    for (const format of ["long", "short"] as const)
      for (const cut of plan.formats[format].cuts) {
        expect(cut.start).toBeGreaterThanOrEqual(400);
        expect(cut.end).toBeLessThanOrEqual(5000);
      }
  });
});

describe("recap files", () => {
  it("survives many saves of one file at once (parallel steps once failed with ENOENT)", async () => {
    const os = await import("node:os");
    const fs = await import("node:fs/promises");
    const dir = await fs.mkdtemp(`${os.tmpdir()}/recap-race-`);
    const previous = process.env.CREATOR_ASSETS_DIR;
    process.env.CREATOR_ASSETS_DIR = dir;
    try {
      const { writeJson } = await import("./movieRecap.js");
      await Promise.all(Array.from({ length: 50 }, (_, n) => writeJson("race-user", "rcp_racetest000000000000001", "project.json", { n }, { store: false })));
      const files = await fs.readdir(dir, { recursive: true });
      expect(files.filter((name) => String(name).endsWith(".part"))).toEqual([]);
      expect(files.some((name) => String(name).endsWith("project.json"))).toBe(true);
    } finally {
      process.env.CREATOR_ASSETS_DIR = previous;
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe("long recaps run in film order", () => {
  it("never lets a line's stretch start before the line before it", () => {
    const beats = [{ from: 600, to: 700, seconds: 12 }, { from: 400, to: 500, seconds: 12 }, { from: 900, to: 1000, seconds: 12 }] as any;
    const long = chronologicalWindows(beats, 6000, true);
    expect(long[1].from).toBeGreaterThanOrEqual(600 - 1e-9);
    expect(long[1].to).toBeGreaterThan(long[1].from);
    // A Short keeps the writer's stretches as they are.
    expect(chronologicalWindows(beats, 6000, false)[1].from).toBeLessThan(500);
  });

  it("drops matched frames that would jump back to an earlier scene", () => {
    const beats = [{ id: "b0" }, { id: "b1" }, { id: "b2" }] as any;
    const kept = keepInOrder(beats, { b0: [100, 130, 160], b1: [40, 190, 187], b2: [2000, 220] });
    expect(kept).toEqual({ b0: [100, 130, 160], b1: [null, 190, 187], b2: [2000, null] });
  });

  it("plans long-recap cuts that only move forward, even when a match points back", () => {
    const backwards = { ...project, options: { ...project.options, formats: ["long"] } };
    const matches = { long: Object.fromEntries(backwards.script.long.beats.map((b: any, i: number) => [b.id, i === 5 ? [10, 20, 30, 40] : null])) };
    const { plan } = buildRecapPlan(backwards, analysis, matches);
    const starts = plan.formats.long.cuts.map((c: any) => c.start);
    for (let i = 1; i < starts.length; i++) expect(starts[i]).toBeGreaterThan(starts[i - 1]);
  });
});

describe("Jev ranks each cut's frames", () => {
  it("builds a shortlist with the matcher's pick and the best word matches", () => {
    const shots = Array.from({ length: 40 }, (_, i) => ({ i, t: 100 + i * 3 }));
    const described: Record<string, string> = Object.fromEntries(shots.map((s) => [s.i, s.i === 30 ? "Ned waves at the college party" : "a crowded street at night"]));
    const task = { beat: { id: "b0", text: "Peter spots Ned at a college party." }, says: ["spots Ned at a college party"], candidates: shots, cuts: [{}] } as any;
    const list = cutShortlist(task, 0, 106, { duration: 3000, shots } as any, described);
    expect(list.length).toBeLessThanOrEqual(10);
    expect(list.map((s) => s.i)).toContain(2); // the matcher's pick (t = 106)
    expect(list.map((s) => s.i)).toContain(30); // the frame that shows the words
  });

  it("swaps in Jev's best frame, and keeps the matcher's pick on a tie", async () => {
    const shots = Array.from({ length: 30 }, (_, i) => ({ i, t: 1.5 + i * 3 }));
    const described: Record<string, any> = {};
    for (const s of shots) { described[s.i] = s.i === 20 ? "the detective opens the letter" : "a hallway"; described[`tag:${s.i}`] = { s: "medium", a: true }; }
    const one = { ...project, options: { ...project.options, formats: ["long"] }, script: { ...project.script, long: { beats: [{ id: "b0", text: "The detective opens the letter.", from: 0, to: 90, shots: [], seconds: 6, audio: "x" }] } } };
    const first = buildRecapPlan(one, { duration: 90, shots } as any);
    const request = async () => ({ value: { lines: [{ id: "b0", cuts: first.edit.long.cuts.map(() => 5) }] }, model: "t" });
    const favour20 = async (list: any[]) => list.map((s) => ({ ...s, jevScore: s.i === 20 ? 100 : 25 })).sort((a, b) => b.jevScore - a.jevScore);
    const better = await matchCutsToFrames(one, { duration: 90, shots } as any, described, first.edit, { request: request as any, jev: favour20 as any });
    expect(better.long.b0[0]).toBeCloseTo(61.5, 3);
    const tie = async (list: any[]) => list.map((s) => ({ ...s, jevScore: 50 }));
    const kept = await matchCutsToFrames(one, { duration: 90, shots } as any, described, first.edit, { request: request as any, jev: tie as any });
    expect(kept.long.b0[0]).toBeCloseTo(16.5, 3);
  });
});

describe("Jev as a classifier", () => {
  it("flags cuts whose best frame Jev still rates weak, through to Vibe Edit", async () => {
    const shots = Array.from({ length: 30 }, (_, i) => ({ i, t: 1.5 + i * 3 }));
    const described: Record<string, any> = {};
    for (const s of shots) { described[s.i] = "a hallway"; described[`tag:${s.i}`] = { s: "medium", a: true }; }
    const one = { ...project, options: { ...project.options, formats: ["long"] }, script: { ...project.script, long: { beats: [{ id: "b0", text: "The detective opens the letter.", from: 0, to: 90, shots: [], seconds: 6, audio: "x" }] } } };
    const film = { duration: 90, shots } as any;
    const first = buildRecapPlan(one, film);
    const request = async () => ({ value: { lines: [{ id: "b0", cuts: first.edit.long.cuts.map(() => 5) }] }, model: "t" });
    const weak = async (list: any[]) => list.map((s) => ({ ...s, jevScore: 25 }));
    const matches = await matchCutsToFrames(one, film, described, first.edit, { request: request as any, jev: weak as any });
    const { edit, stats } = buildRecapPlan(one, film, matches);
    expect(edit.long.cuts.every((c: any) => c.weak === true && c.jev === 25)).toBe(true);
    expect(stats.long.weak).toBe(edit.long.cuts.length);
    const doc = recapVibeProject({ ...one, edit }, "long", { url: "/p", file: "", duration: 9 }, { url: "/v", file: "v", duration: 9 });
    expect(doc.clips.every((c: any) => c.flagged === true)).toBe(true);
  });
});

describe("best shots for a narration", () => {
  it("ranks and classes nearby footage with Jev, in film order for a long recap", async () => {
    const os = await import("node:os");
    const fs = await import("node:fs/promises");
    const dir = await fs.mkdtemp(`${os.tmpdir()}/recap-shots-`);
    const previous = process.env.CREATOR_ASSETS_DIR;
    process.env.CREATOR_ASSETS_DIR = dir;
    try {
      const shots = Array.from({ length: 200 }, (_, i) => ({ i, t: 1.5 + i * 3 }));
      const described: Record<string, any> = {};
      for (const s of shots) { described[s.i] = s.i === 70 ? "Ned waves at the college party" : `scene ${s.i}`; described[`tag:${s.i}`] = { s: "medium", a: true }; }
      const id = "rcp_shotstest00000000000001";
      await writeJson("u1", id, "analysis.json", { duration: 600, shotEvery: 3, sheet: { cols: 4, rows: 3 }, shots, bounds: { start: 10, end: 580, from: { start: "x", end: "x" } } }, { store: false });
      await writeJson("u1", id, "descriptions.json", described, { store: false });
      const project = {
        id, options: {}, script: { long: { beats: [{ id: "b0", text: "Peter spots Ned at a college party.", from: 180, to: 240 }] } },
        edit: { long: { cuts: [{ at: 0, duration: 3.5, beatId: "b0", start: 150 }, { at: 3.5, duration: 3.5, beatId: "b0", start: 190 }, { at: 7, duration: 3.5, beatId: "b0", start: 260 }], captions: [{ start: 3.5, end: 7, text: "spots Ned at a college party" }] } },
      } as any;
      const request = async () => ({ value: { frames: [{ frame: 60, why: "near" }, { frame: 70, why: "Ned at the party" }] }, model: "t" });
      const jev = async (list: any[]) => list.map((s) => ({ ...s, jevScore: s.i === 70 ? 100 : s.i === 60 ? 50 : 0 })).sort((a, b) => b.jevScore - a.jevScore);
      const result = await rankShotsForCut("u1", project, "long", 1, "", { request: request as any, jev: jev as any });
      expect(result.said).toBe("spots Ned at a college party");
      expect(result.shots[0]).toMatchObject({ n: 70, match: "excellent", score: 100, aiPick: true, sheet: "s005.jpg", col: 2, row: 2 });
      expect(result.shots[1]).toMatchObject({ n: 60, match: "plausible" });
      // Between its neighbours (150 s and 260 s, with a few seconds' slack) and off the footage they use.
      for (const s of result.shots) {
        expect(s.t).toBeGreaterThan(150);
        expect(s.t).toBeLessThan(265);
      }
      expect(matchClass(75)).toBe("strong");
    } finally {
      process.env.CREATOR_ASSETS_DIR = previous;
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe("film names", () => {
  it("prefers the typed title, then the file's own name, and never the share host", async () => {
    const { filmNames } = await import("./movieRecap.js");
    const link = { options: { filmTitle: "" }, source: { kind: "link", name: "mega.nz", url: "https://mega.nz/file/YE0R3TLK#key" } } as any;
    expect(filmNames(link)).toEqual([]);
    expect(filmNames(link, { fileName: "Fall.2.Deadpoint.2026.1080p.mkv" })).toEqual([{ title: "Fall 2 Deadpoint", year: 2026 }]);
    expect(filmNames({ ...link, options: { filmTitle: "Fall 2" } }, { fileName: "Fall.2.Deadpoint.2026.mkv" }).map((n: any) => n.title)).toEqual(["Fall 2", "Fall 2 Deadpoint"]);
  });
});
