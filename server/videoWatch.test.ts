import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  WATCH,
  computePacing,
  frameArgs,
  frameBudget,
  heroFrames,
  hookTranscript,
  narrationStats,
  normalizeReport,
  parseSceneTimes,
  pickFrameTimes,
  recapStyleGuidance,
  recapStyleProfile,
  reportBrief,
  reportMarkdown,
  reportPrompt,
  selectExpression,
  styleClipRange,
  watchCatalog,
  watchVideo,
} from "./videoWatch.js";
import { normalizeRequest } from "./creatorStudio.js";
import { recapScriptPrompt } from "./movieRecap.js";

const facts = (extra = {}) => ({
  title: "How I edit",
  url: "https://youtube.com/watch?v=abc",
  question: "",
  duration: 120,
  analysedSeconds: 120,
  width: 1080,
  height: 1920,
  pacing: computePacing([2, 4.5, 7], 120),
  speech: { words: 300, wordsPerMinute: 165, sentenceWords: 11.5 },
  transcriptSource: "platform captions",
  frameCount: 4,
  hookCount: 20,
  ...extra,
});

describe("frames and pacing", () => {
  it("budgets frames by duration like the watch skill", () => {
    expect(frameBudget(0)).toBe(1);
    expect(frameBudget(8)).toBe(12);
    expect(frameBudget(25)).toBe(25);
    expect(frameBudget(45)).toBe(40);
    expect(frameBudget(150)).toBe(60);
    expect(frameBudget(500)).toBe(80);
    expect(frameBudget(3600)).toBe(100);
    expect(frameBudget(3600, 40)).toBe(40);
  });

  it("reads cut times from ffmpeg's metadata print in either form", () => {
    const out = "frame:0    pts:38400   pts_time:3\nlavfi.scene_score=0.70\nframe:1 pts:89600 pts_time=7.04\nframe:2 pts_time:7.04\nframe:3 pts_time:0.01\n";
    expect(parseSceneTimes(out)).toEqual([3, 7.04]);
    expect(parseSceneTimes("")).toEqual([]);
  });

  it("measures shots, cuts per minute, and mean and median shot length", () => {
    const p = computePacing([3, 7, 9.5], 14.5);
    expect(p.shotCount).toBe(4);
    expect(p.shots.map((s) => s.duration)).toEqual([3, 4, 2.5, 5]);
    expect(p.meanShot).toBe(3.63);
    expect(p.medianShot).toBe(3.5);
    expect(p.cutsPerMinute).toBe(16.55);
    expect(computePacing([], 0).shotCount).toBe(0);
    expect(computePacing([], 60)).toMatchObject({ shotCount: 1, medianShot: 60 });
  });

  it("takes a frame per shot, spread when there are too many and padded when too few", () => {
    const many = pickFrameTimes(Array.from({ length: 50 }, (_, i) => i + 1), 60, 10);
    expect(many).toHaveLength(10);
    expect(many.every((f) => f.from === "cut")).toBe(true);
    expect(many[0].t).toBe(0);
    const few = pickFrameTimes([10], 60, 12);
    expect(few).toHaveLength(12);
    expect(few.filter((f) => f.from === "cut").map((f) => f.t)).toEqual([0, 10.15]);
    expect(few.map((f) => f.t)).toEqual([...few.map((f) => f.t)].sort((a, b) => a - b));
  });

  it("builds one ffmpeg call for the shot frames and the 2 fps hook pass", () => {
    expect(selectExpression([0, 3.15])).toBe("eq(selected_n\\,0)*gte(t\\,0.00)+eq(selected_n\\,1)*gte(t\\,3.15)");
    const args = frameArgs({ file: "/tmp/in.mp4", dir: "/tmp/out", times: [0, 3], window: 40.2, hook: true });
    expect(args.slice(args.indexOf("-t"), args.indexOf("-t") + 2)).toEqual(["-t", "41"]);
    const graph = args[args.indexOf("-filter_complex") + 1];
    expect(graph).toContain("split=2");
    expect(graph).toContain(`trim=0:${WATCH.hookSeconds}`);
    expect(graph).toContain(`fps=${WATCH.hookFps}`);
    expect(args).toContain("/tmp/out/frame-%03d.jpg");
    expect(args).toContain("/tmp/out/hook-%02d.jpg");
    expect(frameArgs({ file: "a", dir: "/d", times: [0], window: 10, hook: false })).not.toContain("/d/hook-%02d.jpg");
  });

  it("keeps the hook frame, the longest shot, and a spread as hero frames", () => {
    const frames = [0, 2, 4, 6, 8, 10, 12, 14].map((t) => ({ t, bytes: Buffer.from("x") }));
    const heroes = heroFrames(frames, computePacing([2, 4, 6], 16), 4);
    expect(heroes).toHaveLength(4);
    expect(heroes[0].t).toBe(0);
    expect(heroes.some((f) => f.t === 6)).toBe(true);
  });
});

describe("transcript", () => {
  const segments = [
    { start: 0.2, end: 3, text: "Stop scrolling.", words: [{ start: 0.2, end: 0.6, word: "Stop" }, { start: 0.6, end: 1.2, word: "scrolling." }] },
    { start: 3, end: 12, text: "This one trick changed how I edit. It is simple. You will see.", words: [{ start: 11, end: 11.5, word: "late" }] },
  ];
  it("gives word timings over the hook when it has them, else lines", () => {
    expect(hookTranscript(segments)).toBe("[0.20s] Stop\n[0.60s] scrolling.");
    expect(hookTranscript([{ start: 1, end: 2, text: "hello" }])).toBe("[1.0s] hello");
  });
  it("measures narration speed and sentence length", () => {
    const stats = narrationStats(segments);
    expect(stats.words).toBe(15);
    expect(stats.wordsPerMinute).toBe(76);
    expect(stats.sentenceWords).toBe(3.8);
    expect(narrationStats([])).toEqual({ words: 0, wordsPerMinute: null, sentenceWords: null });
  });
});

describe("report", () => {
  const raw = {
    answer: "They cut every two seconds.",
    summary: ["Fast cuts", "Yellow captions"],
    keyMoments: [{ t: 999, what: "The end" }, { t: 3, what: "" }],
    hook: { pattern: "contrarian claim", breakdown: [{ t: 0.5, see: "Face close-up", say: "Stop" }] },
    editorialProfile: { fingerprint: "Jump cuts and captions" },
    narration: { person: "first", tense: "present", voice: "energetic male" },
    recreate: {
      tool: "ai clipping",
      template: "not-a-template",
      captionStyle: "hormozi",
      settings: { clipAspect: "9:16", nested: { a: 1 } },
      steps: ["Paste the link"],
      prompt: "Find the punchiest moments",
      alsoUse: [{ tool: "Vibe Edit", for: "music" }, { tool: "Made Up Tool", for: "x" }, { tool: "AI Clipping", for: "dup" }],
    },
  };
  it("checks names against the catalogue and takes the numbers from the measurements", () => {
    const r = normalizeReport(raw, facts({ question: "How fast do they cut?" }));
    expect(r.recreate.tool).toBe("AI Clipping");
    expect(r.recreate.template).toBe("");
    expect(r.recreate.captionStyle).toBe("hormozi");
    expect(r.recreate.settings).toEqual({ clipAspect: "9:16", nested: '{"a":1}' });
    expect(r.recreate.alsoUse).toEqual([{ tool: "Vibe Edit", for: "music" }]);
    expect(r.keyMoments).toEqual([{ t: 120, what: "The end" }]);
    expect(r.editorialProfile).toMatchObject({ fingerprint: "Jump cuts and captions", shots: 4, medianShot: 2.5, wordsPerMinute: 165 });
    expect(r.question).toBe("How fast do they cut?");
    expect(normalizeReport({ recreate: { tool: "Photoshop" } }, facts()).recreate.tool).toBe("Create Video");
  });
  it("renders Markdown with the answer and the recreate plan, and a brief that leads with them", () => {
    const r = normalizeReport(raw, facts({ question: "How fast do they cut?" }));
    const md = reportMarkdown(r);
    expect(md).toContain("## Your question");
    expect(md).toContain("They cut every two seconds.");
    expect(md).toContain("## Make one like it in AutoYT: AI Clipping");
    expect(md).toContain("Caption style: `hormozi`");
    expect(md).toContain("Find the punchiest moments");
    const brief = reportBrief(r);
    expect(brief.startsWith("Answer: They cut every two seconds.")).toBe(true);
    expect(brief).toContain("Make it with AI Clipping");
    expect(brief.length).toBeLessThanOrEqual(2400);
  });
  it("grounds the prompt in the real catalogue and the question", () => {
    const catalog = watchCatalog({ voices: [{ name: "Ava", description: "warm" }] });
    expect(catalog).toContain("stickman-director");
    expect(catalog).toContain("- hormozi: Hormozi");
    expect(catalog).toContain("Ava: warm");
    const prompt = reportPrompt({ facts: facts({ question: "Why does it work?" }), observations: [{ t: 0, kind: "hook", shot: "close-up", subject: "host", text: "", captions: "", look: "" }], notes: [], transcript: "", hook: "", question: "Why does it work?", catalog });
    expect(prompt).toContain("THE CREATOR'S QUESTION");
    expect(prompt).toContain("vertical");
    expect(prompt).toContain("4 shots");
  });
});

describe("recap style reference", () => {
  const report = normalizeReport({ hook: { pattern: "in medias res" }, narration: { person: "third", tense: "present", voice: "deep male" }, visualStyle: { captions: "white two-word captions" }, audio: { music: "tense strings" }, recreate: {} }, facts({ pacing: computePacing([2.5, 5, 7.5, 10], 12.5) }));
  const profile = recapStyleProfile(report);
  it("profiles hook, narration, rhythm, cut pace, captions, and music", () => {
    expect(profile).toMatchObject({ hook: "in medias res", sentenceWords: 11.5, wordsPerMinute: 165, medianShot: 2.5, captions: "white two-word captions", music: "tense strings" });
  });
  it("keeps the cut range inside the house 2-4 s", () => {
    expect(styleClipRange(profile)).toEqual({ minClip: 2, maxClip: 3.25 });
    expect(styleClipRange({ medianShot: 12, cutsPerMinute: 5 })).toEqual({ minClip: 2.75, maxClip: 4 });
    expect(styleClipRange({ medianShot: 0.4, cutsPerMinute: 100 })).toEqual({ minClip: 2, maxClip: 3.25 });
    expect(styleClipRange(null)).toBeNull();
  });
  it("is guidance under the house rules: the recap still has no intro", () => {
    const text = recapStyleGuidance(profile);
    expect(text).toContain("every house rule above and below wins");
    expect(text).toContain("no introduction");
    const project = { options: { formats: ["long"], longMinutes: 10, shortSeconds: 60, tone: "dramatic", pace: "brisk", language: "", filmTitle: "", channelName: "" } };
    const analysis = { duration: 6000, shotEvery: 5, shots: [{ i: 0, t: 300 }], transcript: [] };
    const plain = recapScriptPrompt(project, analysis, { 0: "a man runs" }).prompt;
    const styled = recapScriptPrompt(project, analysis, { 0: "a man runs" }, profile).prompt;
    expect(plain).not.toContain("STYLE REFERENCE");
    expect(styled).toContain("STYLE REFERENCE");
    expect(styled).toContain("No introduction: no welcome");
    expect(styled.indexOf("STYLE REFERENCE")).toBeGreaterThan(styled.indexOf("House style for every recap"));
  });
});

describe("watchVideo", () => {
  it("measures, transcribes from captions first, watches in batches, and writes the report", async () => {
    const calls: string[][] = [];
    const command = async (program: string, args: string[]) => {
      calls.push([program, ...args]);
      if (program.includes("ffprobe")) return JSON.stringify({ format: { duration: "62" }, streams: [{ codec_type: "video", width: 1280, height: 720 }, { codec_type: "audio" }] });
      if (args.includes("null")) return "frame:0 pts_time:4.0\nframe:1 pts_time:9.5\nframe:2 pts_time:30\n";
      const frames = args.find((a) => a.endsWith("frame-%03d.jpg"))!;
      const dir = path.dirname(frames);
      const count = (args[args.indexOf("-filter_complex") + 1].match(/selected_n/g) || []).length;
      for (let i = 1; i <= count; i++) await fs.writeFile(path.join(dir, `frame-${String(i).padStart(3, "0")}.jpg`), "jpg");
      if (args.some((a) => a.endsWith("hook-%02d.jpg"))) for (let i = 1; i <= 20; i++) await fs.writeFile(path.join(dir, `hook-${String(i).padStart(2, "0")}.jpg`), "jpg");
      return "";
    };
    const requests: any[] = [];
    const request = async (options: any) => {
      requests.push(options);
      if (options.kind === "vision") {
        const images = options.messages[0].content.filter((p: any) => p.type === "image_url").length;
        return { value: { frames: Array.from({ length: images }, () => ({ shot: "close-up", subject: "host", text: "", captions: "yellow word", look: "warm" })), notes: "talking head" } };
      }
      const value = { summary: ["A talking head"], recreate: { tool: "Create Video", captionStyle: "signal", prompt: "Make it" } };
      options.validate(value);
      return { value };
    };
    let transcribed = false;
    const statuses: string[] = [];
    const result = await watchVideo({
      file: "/tmp/source.mp4",
      url: "https://youtube.com/watch?v=abc",
      question: "What's the hook?",
      command: command as any,
      request: request as any,
      captions: async () => ({ title: "Captioned", segments: [{ start: 0.5, end: 4, text: "Here is the hook." }] }),
      transcribe: async () => { transcribed = true; return { segments: [] }; },
      onStatus: (s: string) => { statuses.push(s); },
    });
    expect(transcribed).toBe(false);
    expect(calls.filter(([p]) => p.includes("ffmpeg"))).toHaveLength(2);
    const vision = requests.filter((r) => r.kind === "vision");
    // 20 hook frames in one call, then 60 shot frames in batches of at most 24.
    expect(vision).toHaveLength(4);
    expect(vision.every((r) => r.messages[0].content.filter((p: any) => p.type === "image_url").length <= WATCH.imagesPerCall)).toBe(true);
    expect(requests.at(-1).kind).toBe("text");
    expect(requests.at(-1).messages[0].content).toContain("Here is the hook.");
    expect(result.report.source).toMatchObject({ title: "Captioned", transcript: "platform captions", frames: 60, hookFrames: 20 });
    expect(result.report.editorialProfile.shots).toBe(4);
    expect(result.report.recreate.captionStyle).toBe("signal");
    expect(result.markdown).toContain("# Captioned");
    expect(result.heroes.length).toBeGreaterThan(0);
    expect(statuses).toContain("Writing the breakdown");
  });

  it("falls back to Whisper when there are no captions, and survives a failed frame batch", async () => {
    const command = async (program: string, args: string[]) => {
      if (program.includes("ffprobe")) return JSON.stringify({ format: { duration: "20" }, streams: [{ codec_type: "video", width: 720, height: 1280 }, { codec_type: "audio" }] });
      if (args.includes("null")) return "";
      const dir = path.dirname(args.find((a) => a.endsWith("frame-%03d.jpg"))!);
      for (let i = 1; i <= 20; i++) await fs.writeFile(path.join(dir, `frame-${String(i).padStart(3, "0")}.jpg`), "jpg");
      return "";
    };
    let batch = 0;
    const request = async (options: any) => {
      if (options.kind === "vision") {
        batch += 1;
        if (batch === 1) return { value: { frames: [], notes: "" } };
        throw new Error("boom");
      }
      return { value: { summary: [], recreate: {} } };
    };
    const result = await watchVideo({ file: "/tmp/s.mp4", command: command as any, request: request as any, transcribe: async () => ({ segments: [{ start: 0, end: 2, text: "hi there" }] }) });
    expect(result.report.source.transcript).toBe("Whisper");
    expect(result.report.source.hookFrames).toBe(0);
  });
});

describe("studio request", () => {
  it("takes a link or an upload and the question", () => {
    const req = normalizeRequest({ tab: "watch", prompt: "how do I make this?", settings: { sourceUrl: "youtube.com/watch?v=abc" } });
    expect(req.settings).toMatchObject({ sourceUrl: "https://youtube.com/watch?v=abc", watchFrames: true });
    expect(req.prompt).toBe("how do I make this?");
    expect(() => normalizeRequest({ tab: "watch", settings: {} })).toThrow(/link/);
    expect(() => normalizeRequest({ tab: "watch", settings: { sourceUrl: "http://example.com/v.mp4" } })).toThrow(/https/);
  });
});
