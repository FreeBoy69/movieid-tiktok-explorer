import { describe, expect, it } from "vitest";
import { buildRecapPlan, centreShortCuts, checkMatchesVisually, centreVerdict, chronologicalWindows, cutShortlist, keepInOrder, matchClass, rankShotsForCut, writeJson, markSubtitledCuts, matchCutsToFrames, mirrorCloseCuts, recapScriptPrompt, recapVibeProject, scriptShortfall, shortHalfWindow } from "./movieRecap.js";

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

  it("finds a brief action between the sampled frames by looking every second", async () => {
    const lines = [
      { id: "b0", text: "Two climbers rest on a narrow ledge high above the valley floor.", from: 0, to: 200, shots: [30], audio: "a0.wav", seconds: 8 },
      { id: "b1", text: "He snaps and shoves her off the platform into the chasm.", from: 300, to: 420, shots: [110], audio: "a1.wav", seconds: 6 },
      { id: "b2", text: "Alone now, he climbs on toward the summit in silence.", from: 500, to: 700, shots: [180], audio: "a2.wav", seconds: 8 },
    ];
    const shoveProject = { ...project, options: { ...project.options, formats: ["long"] }, script: { title: "Ledge", long: { beats: lines } } } as any;
    const built = buildRecapPlan(shoveProject, analysis);
    const described: Record<number, string> = {};
    analysis.shots.forEach((s) => { described[s.i] = "a man stands on a rock ledge"; });
    // The shove lasts two seconds, at 361-362 s of film: no sampled frame (every 3 s) sits on it.
    const shove = (t: number) => t >= 361 && t <= 362.5;
    const look = async (times: number[]) => ({ frames: times.map((t) => Buffer.from(String(t))) });
    const request: any = async ({ messages }: any) => {
      const frames: any[] = [];
      let n = -1;
      for (const part of messages[0].content) {
        if (part.type === "text" && /^Frame (\d+)/.test(part.text)) n = Number(part.text.match(/^Frame (\d+)/)[1]);
        if (part.type === "image_url") {
          const t = Number(Buffer.from(part.image_url.url.split(",")[1], "base64").toString());
          const said = messages[0].content.find((c: any) => c.text?.startsWith(`Frame ${n},`))?.text || "";
          frames.push({ n, person: true, shows: "a man on a ledge", gore: false, fit: /shoves/.test(said) ? (shove(t) ? 3 : 1) : 2 });
        }
      }
      return { value: { frames } };
    };
    const checked = await checkMatchesVisually(shoveProject, analysis, described, built, {}, { look, request });
    const shoveCuts = checked.plan.formats.long.cuts.filter((c: any) => checked.edit.long.cuts[checked.plan.formats.long.cuts.indexOf(c)]?.beatId === "b1");
    expect(shoveCuts.some((c: any) => c.start <= 362 && c.end >= 361)).toBe(true);
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

  it("asks for a direct opening, the outro, and a word budget", () => {
    // No intro: the narration opens straight on the film's first scene.
    expect(prompt.prompt).not.toContain("Hi, welcome");
    expect(prompt.prompt).toContain("The movie opens with");
    expect(prompt.prompt).toContain("Thank you for watching Unicorn Recaps. This has been our recap of Paper Vows.");
    // At the brisk pace narration plays about 212 words a minute (measured on a finished recap).
    expect(prompt.shortWords).toBe(212);
    expect(prompt.longWords).toBe(2548);
  });

  it("flags a draft that underwrites the Short", () => {
    const words = (n: number) => [{ text: Array(n).fill("word").join(" ") }];
    expect(scriptShortfall({ long: { beats: words(2500) }, short: { beats: words(97) } }, prompt)).toMatch(/The Short has 97 words but needs about 212/);
    expect(scriptShortfall({ long: { beats: words(2500) }, short: { beats: words(200) } }, prompt)).toBe("");
    // A long recap 15% short of its words (about two minutes of a 12-minute recap) gets revised.
    expect(scriptShortfall({ long: { beats: words(2170) }, short: { beats: words(200) } }, prompt)).toMatch(/long recap has 2170 words/);
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

describe("script timestamps and jump cuts", () => {
  it("reads film timestamps the writer copies from the timeline", async () => {
    const { filmSeconds } = await import("./movieRecap.js");
    expect(filmSeconds("57:36")).toBe(3456);
    expect(filmSeconds("1:04:22")).toBe(3862);
    expect(filmSeconds(125)).toBe(125);
    expect(filmSeconds("125")).toBe(125);
    expect(Number.isNaN(filmSeconds("soon"))).toBe(true);
  });

  it("only compares neighbouring cuts that sit near each other in the film", async () => {
    const { jumpPairs, jumpCutIndices } = await import("./movieRecap.js");
    const cuts = [{ start: 10, end: 13.5 }, { start: 16, end: 19.5 }, { start: 400, end: 403 }, { start: 405, end: 408.5 }] as any;
    const pairs = jumpPairs(cuts);
    expect(pairs.map((p: any) => p.index)).toEqual([1, 3]);
    expect(jumpCutIndices(cuts, [20, 90], pairs)).toEqual([1]);
  });
});

describe("frames with no one in them", () => {
  it("fit only when the narration names what they show", async () => {
    const { rateFrames } = await import("./movieRecap.js");
    const request = async () => ({ value: { frames: [
      { n: 0, person: false, shows: "empty cloudy sky", fit: 2 },
      { n: 1, person: false, shows: "storm clouds over the peak", fit: 3 },
      { n: 2, person: false, shows: "a warning sign on the rock", fit: 3 },
      { n: 3, person: true, shows: "two hikers on a trail", fit: 3 },
    ] } });
    const frame = Buffer.from("jpg");
    const fit = await rateFrames([frame, frame, frame, frame], [
      "John leads the group through an opening",
      "Dark storm clouds gather over the mountain",
      "Jax ignores the warning sign",
      "The hikers follow John along the trail",
    ], { request: request as any });
    expect(fit).toEqual([0, 3, 3, 3]);
  });
});

describe("opening teaser and line stretches", () => {
  it("finds the teaser up to the line that names the film", async () => {
    const { teaserLines } = await import("./movieRecap.js");
    expect(teaserLines([{ text: "Hi, welcome to the channel. Two climbers fight to survive." }, { text: "A terrifying secret. This is the 2026 movie Fall 2." }, { text: "In the pouring rain, two men struggle." }] as any)).toEqual([true, true, false]);
    expect(teaserLines([{ text: "Hi, welcome to the channel." }, { text: "In the pouring rain, two men struggle." }] as any)).toEqual([true, false]);
    expect(teaserLines([{ text: "In the pouring rain, two men struggle." }] as any)).toEqual([false]);
  });

  it("gives each line its own stretch, never overlapping the next", async () => {
    const { partitionStory } = await import("./movieRecap.js");
    const spans = partitionStory([100, 200, 200, 200, 400], { start: 60, end: 1000 }, [30, 30, 30, 30, 30]);
    for (let k = 1; k < spans.length; k++) expect(spans[k].from).toBeCloseTo(spans[k - 1].to, 5);
    // Three lines at one spot share it in order, each with the film its cuts need.
    expect(spans[1].to).toBeLessThan(spans[2].to);
    expect(spans[2].to).toBeLessThan(spans[3].to);
    for (const span of spans) expect(span.to - span.from).toBeGreaterThanOrEqual(30 - 1e-6);
    // Room is made around the crowded spot rather than overflowing into the next line.
    expect(spans[3].to).toBeLessThanOrEqual(spans[4].from + 1e-6);
  });

  it("takes the film's name from the script's opening when nothing else names it", async () => {
    const { filmNames } = await import("./movieRecap.js");
    const project = { options: { filmTitle: "" }, source: { kind: "link", name: "mega.nz", url: "https://mega.nz/file/ABC123xy#k" }, script: { long: { beats: [{ text: "Hi, welcome. This is the 2026 movie Fall 2." }] } } } as any;
    expect(filmNames(project)).toEqual([{ title: "Fall 2", year: 2026 }]);
  });
});

describe("title card", () => {
  it("reads the film's title off frames with on-screen text in its opening", async () => {
    const { readScreenTitle } = await import("./movieRecap.js");
    const analysis = { duration: 6000, shots: [{ i: 0, t: 30 }, { i: 1, t: 200 }, { i: 2, t: 2000 }] } as any;
    const described = { 0: "a", "tag:0": { t: false }, 1: "b", "tag:1": { t: true }, 2: "c", "tag:2": { t: true } };
    let asked: number[] = [];
    const look = async (times: number[]) => { asked = times; return { frames: times.map(() => Buffer.from("jpg")), aspect: 16 / 9 }; };
    const request = async () => ({ value: { title: "FALL DEADPOINT" } });
    expect(await readScreenTitle(analysis, described, look, { request: request as any })).toBe("FALL DEADPOINT");
    // Only text frames from the opening are looked at.
    expect(asked).toEqual([200]);
  });

  it("reads the closing credits' title card when the opening shows none", async () => {
    const { readScreenTitle } = await import("./movieRecap.js");
    // Mutiny: studio logos, a cold open, and the title only after "JASON STATHAM" in the end credits.
    const analysis = { duration: 5700, shots: [{ i: 0, t: 12 }, { i: 1, t: 3000 }, { i: 2, t: 5385 }, { i: 3, t: 5391 }, { i: 4, t: 5600 }] } as any;
    const described = { "tag:0": { t: true }, "tag:1": { t: true }, "tag:2": { t: true }, "tag:3": { t: true }, "tag:4": { t: true } };
    const looked: number[][] = [];
    const look = async (times: number[]) => { looked.push(times); return { frames: times.map(() => Buffer.from("jpg")), aspect: 16 / 9 }; };
    const request = async ({ messages }: any) => ({ value: { title: messages[0].content[0].text.includes("the end") ? "MUTINY" : null } });
    expect(await readScreenTitle(analysis, described, look, { request: request as any })).toBe("MUTINY");
    // The opening first, then every text frame of the last fifth; the middle of the film never.
    expect(looked).toEqual([[12], [5385, 5391, 5600]]);
  });
});

describe("opening montage", () => {
  it("plays the recap's best clips from different scenes over an intro, the best first", async () => {
    const { fillTeaserMontage } = await import("./movieRecap.js");
    const project = { script: { long: { beats: [{ id: "b0", teaser: true }, { id: "b1" }, { id: "b2" }, { id: "b3" }] } } } as any;
    const plan = (start: number, duration = 3.5) => ({ start, end: start + duration, duration });
    const built = {
      plan: { formats: { long: { cuts: [plan(10), plan(14), plan(120), plan(900), plan(905), plan(2400)] } } },
      edit: { long: { cuts: [
        { beatId: "b0", start: 10, at: 0, duration: 3.5 }, { beatId: "b0", start: 14, at: 3.5, duration: 3.5 },
        { beatId: "b1", start: 120, at: 7, duration: 3.5, fit: 2 },
        // Later in the recap (a montage doesn't use the minute after the intro).
        { beatId: "b2", start: 900, at: 90, duration: 3.5, fit: 3, jev: 90 }, { beatId: "b2", start: 905, at: 94, duration: 3.5, fit: 3, jev: 80 },
        { beatId: "b3", start: 2400, at: 200, duration: 3.5, fit: 3, jev: 70 },
      ], captions: [] } },
      stats: {},
    } as any;
    const out = fillTeaserMontage(project, built);
    const montage = out.plan.formats.long.cuts.slice(0, 2).map((c: any) => c.start);
    // The two best from different lines, a minute apart, in film order: 900 (b2) and 2400 (b3).
    expect(montage).toEqual([900, 2400]);
    expect(out.edit.long.cuts[0].montage).toBe(true);
  });
});

describe("credits versus text in the story", () => {
  it("keeps cuts off credits but not off news screens or phone posts", async () => {
    const { buildRecapPlan, prepareCutRules } = await import("./movieRecap.js");
    const shots = Array.from({ length: 100 }, (_, i) => ({ i, t: 1.5 + i * 3 }));
    const described: Record<string, any> = {};
    for (const shot of shots) { described[shot.i] = "two women talk on a porch"; described[`tag:${shot.i}`] = { s: "medium", a: true, t: false }; }
    described[10] = "white production credits on a black screen"; described["tag:10"] = { s: "none", t: true };
    described[20] = "a news website headline about two climbers stuck on a tower"; described["tag:20"] = { s: "medium", a: false, t: true };
    const analysis: any = { duration: 300, shotEvery: 3, shots };
    prepareCutRules(analysis, described);
    expect(analysis.avoid.some(([a, b]: number[]) => shots[10].t >= a && shots[10].t <= b)).toBe(true);
    expect(analysis.avoid.some(([a, b]: number[]) => shots[20].t >= a && shots[20].t <= b)).toBe(false);
    expect(typeof buildRecapPlan).toBe("function");
  });
});

describe("character names", () => {
  it("takes name fixes but not rewrites", async () => {
    const { correctNames } = await import("./movieRecap.js");
    const script = { long: { beats: [{ id: "b0", text: "John points a laser at the peak." }, { id: "b1", text: "Jax climbs the rungs carefully." }, { id: "b2", text: "John grins." }] } };
    const request = async () => ({ value: { lines: [
      { id: "long:b0", text: "Jon points a laser at the peak." },
      { id: "long:b1", text: "Jax climbs the rungs carefully." },
      // More than names changed: not taken.
      { id: "long:b2", text: "Jon grins widely as the storm closes in around all of them." },
    ] } });
    const { script: out, changed } = await correctNames(script as any, [{ name: "Jon Platt" }, { name: "Jax Hunter" }] as any, ["long"], { request: request as any });
    expect(changed).toBe(1);
    expect(out.long.beats.map((b: any) => b.text)).toEqual(["Jon points a laser at the peak.", "Jax climbs the rungs carefully.", "John grins."]);
  });
});

describe("intro switch", () => {
  it("writes a teaser that names the film, and an intro mark wins over the old detection", async () => {
    const { writeIntro, teaserLines } = await import("./movieRecap.js");
    let asked = "";
    const request = async ({ messages }: any) => { asked = messages[0].content; return { value: { text: "One wrong step means death. This is the 2026 movie Fall 2: Deadpoint." } }; };
    const text = await writeIntro({ title: "x", film: { title: "Fall 2: Deadpoint", year: 2026 }, options: {}, script: { logline: "A climb.", long: { beats: [{ id: "b0", text: "Jax climbs." }] } } } as any, { request: request as any });
    expect(text).toContain("This is the 2026 movie Fall 2: Deadpoint.");
    expect(asked).toContain("This is the 2026 movie Fall 2: Deadpoint.");
    expect(teaserLines([{ text: "Hi, welcome." }, { text: "The movie opens.", teaser: true }] as any)).toEqual([false, true]);
  });
});

describe("youtube-safe post", () => {
  it("keeps the title, description, and tags within what YouTube accepts", async () => {
    const { youtubeSafeMetadata } = await import("./movieRecap.js");
    const out = youtubeSafeMetadata({ title: "A <very> " + "long ".repeat(40) + "title", description: "Watch <this>\n#Fall2", tags: Array.from({ length: 40 }, (_, i) => `movie recap tag ${i}`) });
    expect(out.title.length).toBeLessThanOrEqual(100);
    expect(out.title).not.toMatch(/[<>]/);
    expect(out.description).toBe("Watch this\n#Fall2");
    const cost = out.tags.reduce((sum, t, i) => sum + t.length + (t.includes(" ") ? 2 : 0) + (i ? 1 : 0), 0);
    expect(cost).toBeLessThanOrEqual(500);
  });
});

describe("opening on the best shots", () => {
  it("times intro cuts to the narration's phrasing", async () => {
    const { phraseCutLengths } = await import("./movieRecap.js");
    const lengths = phraseCutLengths("One wrong step, and she falls. A guide hides a secret, the storm closes in, and nobody is coming. This is the 2026 movie Fall 2.", 11);
    expect(lengths.reduce((s: number, l: number) => s + l, 0)).toBeCloseTo(11, 2);
    for (const l of lengths) { expect(l).toBeGreaterThanOrEqual(1.4 - 1e-6); expect(l).toBeLessThanOrEqual(3.9 + 1e-6); }
    expect(lengths.length).toBeGreaterThanOrEqual(4);
  });

  it("ranks clips as a hook with Jev and opens a recap without an intro on the best", async () => {
    const { rankCaptivating, openOnBest } = await import("./movieRecap.js");
    const analysis = { shots: [{ i: 0, t: 10 }, { i: 1, t: 100 }, { i: 2, t: 200 }] } as any;
    const described = { 0: "two people chat at a table", "tag:0": { s: "medium", a: false }, 1: "a terrified woman screams as the bridge snaps", "tag:1": { s: "close", a: true }, 2: "a mountain at dawn", "tag:2": { s: "wide", a: false } } as any;
    const edit = { cuts: [{ beatId: "b0", start: 8.5, duration: 3 }, { beatId: "b1", start: 98.5, duration: 3.5 }, { beatId: "b2", start: 198.5, duration: 3 }] } as any;
    // Jev puts the screaming close-up first.
    const jev = async (items: any[]) => [...items].sort((a, b) => (b.shows.includes("screams") ? 1 : 0) - (a.shows.includes("screams") ? 1 : 0));
    const order = await rankCaptivating({ script: { long: { beats: [] } }, film: { title: "F" } } as any, analysis, described, edit, { jev: jev as any });
    expect(order[0]).toBe(1);
    const built = { plan: { formats: { long: { cuts: [{ start: 8.5, end: 11.5, duration: 3 }, { start: 98.5, end: 102, duration: 3.5 }, { start: 198.5, end: 201.5, duration: 3 }] } } }, edit: { long: edit }, stats: {} } as any;
    const out = openOnBest({ script: { long: { beats: [{ id: "b0" }] } } } as any, built, order);
    expect(out.plan.formats.long.cuts[0].start).toBeGreaterThanOrEqual(98.5);
    expect(out.plan.formats.long.cuts[0].end).toBeLessThanOrEqual(102);
    expect(out.edit.long.cuts[0].hook).toBe(true);
  });

  it("asks the vision model about borderline jump cuts only", async () => {
    const { confirmJumps } = await import("./movieRecap.js");
    const request = async () => ({ value: { pairs: [{ n: 0, jump: true }, { n: 1, jump: false }] } });
    const jumps = await confirmJumps([[Buffer.from("a"), Buffer.from("b")], [Buffer.from("c"), Buffer.from("d")]], { request: request as any });
    expect([...jumps]).toEqual([0]);
  });
});

describe("name cards", () => {
  it("move to the first clip showing the character, or go", async () => {
    const { placeNameCards } = await import("./movieRecap.js");
    const events = [
      { type: "title", start: 0.4, end: 5.2, vars: { title: "Fall 2" } },
      { type: "name", start: 29, end: 31.9, vars: { name: "Shiloh Hunter" } },
      { type: "name", start: 40, end: 42.9, vars: { name: "Jax Hunter" } },
    ];
    const edit = { cuts: [{ at: 28, duration: 3, start: 280 }, { at: 31, duration: 3, start: 300 }, { at: 39, duration: 3, start: 400 }, { at: 42, duration: 3, start: 420 }] } as any;
    const characters = [{ name: "Shiloh Hunter", photo: "s.jpg" }, { name: "Jax Hunter", photo: "j.jpg" }];
    const look = async (times: number[]) => ({ frames: times.map(() => Buffer.from("f")), aspect: 16 / 9 });
    // Shiloh is never on screen; Jax shows in the second clip after her mention.
    const request = async ({ messages }: any) => ({ value: { frames: messages[0].content[0].text.includes("Jax") ? [1] : [] } });
    const out = await placeNameCards(events as any, edit, characters as any, look, { request: request as any, fetchPhoto: async () => Buffer.from("p") });
    expect(out.map((e: any) => e.vars.name || e.vars.title)).toEqual(["Fall 2", "Jax Hunter"]);
    const jax = out.find((e: any) => e.vars.name === "Jax Hunter");
    expect(jax.start).toBeCloseTo(42.2, 1);
  });
});

describe("intro montage matched to its words", () => {
  it("opens on the top clip, then puts the clip of what's said under each cut", async () => {
    const { fillTeaserMontage } = await import("./movieRecap.js");
    const project = { script: { long: { beats: [{ id: "intro", teaser: true }, { id: "b1" }, { id: "b2" }, { id: "b3" }] } } } as any;
    const p = (start: number) => ({ start, end: start + 3.5, duration: 3.5 });
    const built = {
      plan: { formats: { long: { cuts: [{ start: 0, end: 1.2, duration: 1.2 }, { start: 0, end: 1.2, duration: 1.2 }, p(600), p(1500), p(3000)] } } },
      edit: { long: {
        cuts: [{ beatId: "intro", at: 0, duration: 1.2 }, { beatId: "intro", at: 1.2, duration: 1.2 }, { beatId: "b1", start: 600 }, { beatId: "b2", start: 1500 }, { beatId: "b3", start: 3000 }],
        captions: [{ start: 0, end: 1.2, text: "One wrong step" }, { start: 1.2, end: 2.4, text: "the bridge collapses" }],
      } },
      stats: {},
    } as any;
    // Ranked: the scream first, then a talk, then the bridge.
    const order: any = [2, 3, 4];
    Object.defineProperty(order, "shows", { value: new Map([[2, "a woman screams in terror"], [3, "two people talk at a bar"], [4, "a wooden bridge collapses over a gorge"]]) });
    const out = fillTeaserMontage(project, built, "long", order);
    expect(out.plan.formats.long.cuts.slice(0, 2).map((c: any) => Math.round(c.start))).toEqual([601, 3001]);
  });
});

describe("AI credits", () => {
  it("stops a render with a clear message when the provider is out of credits", async () => {
    const { checkAiCredits } = await import("./movieRecap.js");
    await expect(checkAiCredits({ request: (async () => { throw new Error("AI provider (402): Insufficient credits."); }) as any })).rejects.toThrow(/out of credits/);
    await expect(checkAiCredits({ request: (async () => ({ value: "OK" })) as any })).resolves.toBeUndefined();
    // Another error (a timeout) doesn't stop the render.
    await expect(checkAiCredits({ request: (async () => { throw new Error("timeout"); }) as any })).resolves.toBeUndefined();
  });
});

describe("montage repeats", () => {
  it("doesn't use footage the recap shows in the minute after the intro", async () => {
    const { fillTeaserMontage } = await import("./movieRecap.js");
    const project = { script: { long: { beats: [{ id: "intro", teaser: true }, { id: "b1" }, { id: "b2" }] } } } as any;
    const built = {
      plan: { formats: { long: { cuts: [{ start: 0, end: 1.2, duration: 1.2 }, { start: 113, end: 116.5, duration: 3.5 }, { start: 3000, end: 3003.5, duration: 3.5 }] } } },
      edit: { long: { cuts: [{ beatId: "intro", at: 0, duration: 1.2 }, { beatId: "b1", start: 113, at: 1.2, duration: 3.5 }, { beatId: "b2", start: 3000, at: 200, duration: 3.5 }], captions: [] } },
      stats: {},
    } as any;
    // The man in the rain (113 s) ranks first but is the next line's own shot: the montage takes 3000 s.
    const out = fillTeaserMontage(project, built, "long", [1, 2] as any);
    expect(Math.round(out.plan.formats.long.cuts[0].start)).toBe(3001);
  });
});
