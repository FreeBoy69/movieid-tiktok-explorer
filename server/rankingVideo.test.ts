import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  RANKING,
  applyPicks,
  buildTimeline,
  checkTimes,
  cleanLabel,
  cleanLine,
  conceptPrompt,
  duckWindows,
  firstEmoji,
  formatGuide,
  keepRegion,
  licensedSource,
  makeRankingVideo,
  normalizeCheck,
  normalizeConcept,
  normalizeScript,
  overlayStates,
  parseClock,
  parseCropDetect,
  parseFont,
  pickClips,
  rankColor,
  rankingSettings,
  rankListSvg,
  reactionSegments,
  renderArgs,
  shortlist,
  sourcesList,
  sourcesMarkdown,
  textOutline,
  tiktokCandidate,
  titleBandSvg,
  topicNiche,
  youtubeCandidate,
} from "./rankingVideo.js";
import { normalizeRequest } from "./creatorStudio.js";

const check = (extra = {}) => normalizeCheck({ fit: 8, quality: 7, sees: "A toddler falls into a ball pit", window: { start: 2, end: 5.5 }, cuts: [{ start: 2, end: 5.5 }], boxes: [], label: "Ball Pit Dive", emoji: "🤸", line: "He did not see that coming", ...extra }, { duration: 30 });
const candidate = (id, score = {}, extra = {}) => ({ id, platform: "youtube", url: `https://www.youtube.com/watch?v=${id.slice(-11)}`, title: "clip", uploader: "Someone", duration: 30, width: 1280, height: 720, audio: true, check: { ...check(score), crop: { x: 0, y: 0, w: 1280, h: 720 } }, ...extra });

describe("ranking video settings", () => {
  it("defaults to a five-entry countdown in English with captions and no music", () => {
    expect(rankingSettings({})).toMatchObject({ template: "countdown", count: 5, language: "English", captions: true, captionStyle: "hormozi", music: false });
    expect(rankingSettings({ count: 40 }).count).toBe(10);
    expect(rankingSettings({ count: 1 }).count).toBe(3);
    expect(rankingSettings({ captionStyle: "nope" }).captionStyle).toBe("hormozi");
  });

  it("makes the reaction loop one clip over music with a reaction prompt", () => {
    const s = rankingSettings({ template: "reaction-loop", count: 7 });
    expect(s).toMatchObject({ template: "reaction-loop", count: 1, music: true });
    expect(s.reactionPrompt).toMatch(/laughing/);
  });

  it("keeps only well-formed swaps", () => {
    const s = rankingSettings({ planId: "job-abc-123", picks: { 2: "youtube:abcdefghijk", 3: "tiktok:7300000000000000000", 9: "../etc/passwd", x: "youtube:abc" } });
    expect(s.planId).toBe("job-abc-123");
    expect(s.picks).toEqual({ 2: "youtube:abcdefghijk", 3: "tiktok:7300000000000000000" });
    expect(rankingSettings({ planId: "bad id" }).planId).toBeUndefined();
  });

  it("is a studio app: an empty topic is allowed, a swap needs its plan", () => {
    const request = normalizeRequest({ tab: "ranking", prompt: "", settings: { count: 4, voiceId: "openrouter:x:Puck" } });
    expect(request.settings).toMatchObject({ template: "countdown", count: 4, voiceId: "openrouter:x:Puck" });
    expect(() => normalizeRequest({ tab: "ranking", settings: { picks: { 1: "youtube:abcdefghijk" } } })).toThrow(/finished ranking video/);
  });
});

describe("ranking video concept", () => {
  it("grounds the plan in the countdown format and the niche", () => {
    const guide = formatGuide([{ id: "ranked-countdown", name: "Ranked countdown (Top N)", summary: "N items ranked.", hookTemplates: ["Number one shouldn't exist."], titlePatterns: ["Top [N] [Things]"], retentionTips: ["Tease #1."] }]);
    expect(guide).toMatch(/Ranked countdown/);
    expect(guide).toMatch(/shouldn't exist/);
    expect(formatGuide([])).toBe("");
    const prompt = conceptPrompt({ topic: "funniest baby moments", count: 5, language: "Spanish", template: "countdown", format: guide, niche: { macroNiche: "Entertainment", subNiche: "Funny kids" } });
    expect(prompt).toMatch(/#5 to #1/);
    expect(prompt).toMatch(/Spanish/);
    expect(prompt).toMatch(/Funny kids/);
    expect(conceptPrompt({ topic: "", count: 5, language: "English", template: "countdown" })).toMatch(/NO TOPIC GIVEN/);
    expect(conceptPrompt({ topic: "fails", count: 1, language: "English", template: "reaction-loop" })).toMatch(/exactly 1 entry/);
  });

  it("classifies a topic with the niche library", () => {
    const library = [{ id: "kids", macroNiche: "Family", subNiche: "Funny kids", seedKeywords: ["toddler fails", "funny babies"] }];
    expect(topicNiche(library, "funniest toddler fails")).toMatchObject({ subNiche: "Funny kids" });
    expect(topicNiche(library, "")).toBeNull();
  });

  it("cleans the plan: two title lines, real coloured words, N entries with queries", () => {
    const concept = normalizeConcept({
      topic: "toddler fails",
      title: { lines: ["top 5 funniest", "toddler fails"], red: "fails", yellow: "nothing" },
      hook: "Number one should not have happened at all, honestly, no way",
      entries: [{ queries: ["toddler slips #funny", ""], moment: "slips", label: "Slip and slide wow" }, { query: "baby cake smash" }, { moment: "no queries" }],
    }, { count: 5 });
    expect(concept.title).toEqual({ lines: ["TOP 5 FUNNIEST", "TODDLER FAILS"], red: "FAILS", yellow: "FUNNIEST" });
    expect(concept.hook.split(" ").length).toBeLessThanOrEqual(12);
    expect(concept.entries).toEqual([
      { queries: ["toddler slips funny"], moment: "slips", label: "Slip and slide" },
      { queries: ["baby cake smash"], moment: "", label: "" },
    ]);
    expect(() => normalizeConcept({ entries: [] })).toThrow(/without any clips/);
  });
});

describe("ranking video search", () => {
  it("reads both platforms' results as candidates with source and uploader", () => {
    expect(youtubeCandidate({ id: "abcdefghijk", title: "Kid falls", channel: "Funny Kids", duration: "0:45" })).toMatchObject({ id: "youtube:abcdefghijk", platform: "youtube", url: "https://www.youtube.com/watch?v=abcdefghijk", uploader: "Funny Kids", duration: 45 });
    expect(youtubeCandidate({ id: "short" })).toBeNull();
    expect(tiktokCandidate({ id: "7300000000000000001", title: "lol", author: "Maya", authorHandle: "maya", playUrl: "https://www.tiktok.com/@maya/video/7300000000000000001", durationSeconds: 12 })).toMatchObject({ id: "tiktok:7300000000000000001", platform: "tiktok", uploader: "Maya (@maya)", duration: 12 });
    expect(parseClock("1:02:03")).toBe(3723);
    expect(parseClock("x")).toBeNull();
  });

  it("skips agency and licensed uploads by their metadata", () => {
    for (const c of [{ uploader: "ViralHog" }, { title: "Toddler falls (Jukin Media)" }, { description: "For licensing contact licensing@x.com" }, { uploader: "Newsflare" }, { title: "Storyful clip" }, { description: "© 2024 Caters News" }]) expect(licensedSource(c)).toBe(true);
    expect(licensedSource({ uploader: "Funny Kids", title: "Toddler falls" })).toBe(false);
  });

  it("de-duplicates, drops long and taken clips, prefers short ones, and mixes platforms", () => {
    const yt = (id, duration, extra = {}) => ({ id: `youtube:${id}`, platform: "youtube", duration, ...extra });
    const tt = (id, duration) => ({ id: `tiktok:${id}`, platform: "tiktok", duration });
    const list = shortlist([yt("a", 200), yt("b", 30), yt("b", 30), yt("c", 600), yt("d", 20, { uploader: "ViralHog" }), yt("e", 40), tt("1", 15), tt("2", 2), yt("f", 50)], { taken: new Set(["youtube:e"]) });
    expect(list.map((c) => c.id)).toEqual(["youtube:b", "tiktok:1", "youtube:f", "youtube:a"]);
  });
});

describe("ranking video check", () => {
  it("spreads six frames over the first 90 seconds", () => {
    expect(checkTimes(12)).toEqual([1, 3, 5, 7, 9, 11]);
    expect(Math.max(...checkTimes(600))).toBeLessThan(90);
  });

  it("cleans the vision answer into a 4-8 s window with cuts inside it and a score", () => {
    const c = normalizeCheck({ fit: 9, quality: 6, window: { start: 10, end: 30 }, cuts: [{ start: 26, end: 28 }, { start: 27, end: 30 }, { start: 1, end: 2 }], boxes: [{ kind: "captions", x: 0.1, y: 0.8, w: 0.8, h: 0.1 }, { x: 2, y: 0, w: 0, h: 0 }], label: "Big 🤣 Splash Zone Wow", emoji: "💦 yes", line: "one two three four five six seven eight nine ten eleven twelve thirteen", branding: false }, { duration: 40 });
    expect(c.window).toEqual({ start: 22, end: 30 });
    expect(c.cuts).toEqual([{ start: 26, end: 28 }]);
    expect(c.boxes).toHaveLength(1);
    expect(c.score).toBe(7.95);
    expect(c.usable).toBe(true);
    expect(c.label).toBe("Big Splash Zone");
    expect(c.emoji).toBe("💦");
    expect(c.line.split(" ")).toHaveLength(12);
    expect(normalizeCheck({ fit: 9, quality: 9, branding: true }, { duration: 10 }).usable).toBe(false);
    expect(normalizeCheck({ fit: 3, quality: 9 }, { duration: 10 }).usable).toBe(false);
    expect(normalizeCheck({ fit: 8, quality: 8, window: { start: 0, end: 1 } }, { duration: 2 }).window).toEqual({ start: 0, end: 2 });
  });

  it("finds the reaction loop's payoff inside its window", () => {
    const c = normalizeCheck({ fit: 8, quality: 8, window: { start: 4, end: 9 }, payoff: 20 }, { duration: 20, loop: true });
    expect(c.payoff).toBe(8.4);
    expect(reactionSegments({ check: c }, { duration: 5 }).map((s) => s.kind)).toEqual(["setup", "reaction", "payoff", "reaction"]);
  });

  it("crops off black bars and burned-in captions or watermarks, but never too much", () => {
    expect(parseCropDetect("lavfi.cropdetect.w=640\nlavfi.cropdetect.w=360\nlavfi.cropdetect.h=360\nlavfi.cropdetect.x=140\nlavfi.cropdetect.y=0", { width: 640, height: 360 })).toEqual({ x: 140, y: 0, w: 360, h: 360 });
    expect(parseCropDetect("lavfi.cropdetect.w=640\nlavfi.cropdetect.h=360\nlavfi.cropdetect.x=0\nlavfi.cropdetect.y=0", { width: 640, height: 360 })).toBeNull();
    expect(parseCropDetect("", { width: 640, height: 360 })).toBeNull();
    // A full-frame intro doesn't hide the bars most of the clip has.
    const frame = (w: number, x: number) => `lavfi.cropdetect.x1=${x}\nlavfi.cropdetect.w=${w}\nlavfi.cropdetect.h=360\nlavfi.cropdetect.x=${x}\nlavfi.cropdetect.y=0\n`;
    expect(parseCropDetect(frame(640, 0).repeat(2) + frame(204, 218).repeat(9), { width: 640, height: 360 })).toEqual({ x: 218, y: 0, w: 204, h: 360 });
    // A video that switches between full-frame and boxed footage: only the chosen window counts.
    const timed = (t: number, w: number, x: number) => `frame:0 pts:0 pts_time:${t}\n${frame(w, x)}`;
    const mixed = [0, 0.5, 1, 1.5, 2, 2.5].map((t) => timed(t, 640, 0)).join("") + [5, 5.5, 6].map((t) => timed(t, 204, 218)).join("");
    expect(parseCropDetect(mixed, { width: 640, height: 360 })).toBeNull();
    expect(parseCropDetect(mixed, { width: 640, height: 360 }, { start: 4.5, end: 12.5 })).toEqual({ x: 218, y: 0, w: 204, h: 360 });
    const size = { width: 1000, height: 1000 };
    // Captions low in the frame trim the bottom; a watermark high trims the top.
    expect(keepRegion([{ x: 0.1, y: 0.8, w: 0.8, h: 0.1 }, { x: 0.05, y: 0.02, w: 0.2, h: 0.06 }], size)).toEqual({ x: 0, y: 80, w: 1000, h: 720 });
    // A caption in the middle would cost too much: it stays.
    expect(keepRegion([{ x: 0.1, y: 0.45, w: 0.8, h: 0.1 }], size)).toEqual({ x: 0, y: 0, w: 1000, h: 1000 });
    // Inside a pillarboxed picture, boxes on the bars are ignored and the bars go.
    expect(keepRegion([{ x: 0.02, y: 0.9, w: 0.1, h: 0.05 }], { width: 640, height: 360 }, { x: 140, y: 0, w: 360, h: 360 })).toEqual({ x: 140, y: 0, w: 360, h: 360 });
  });

  it("picks the best unused clip per entry, ranks the strongest #1, and keeps runners-up", () => {
    const entries = [{ label: "A" }, { label: "B" }, { label: "C" }, { label: "D" }];
    const checked = [
      [candidate("youtube:aaaaaaaaaaa", { fit: 6, quality: 6 }), candidate("youtube:bbbbbbbbbbb", { fit: 9, quality: 9 })],
      [candidate("youtube:bbbbbbbbbbb", { fit: 9, quality: 9 })],
      [candidate("youtube:ccccccccccc", { fit: 7, quality: 7 }), candidate("youtube:ddddddddddd", { fit: 2, quality: 9 })],
      [],
    ];
    const picked = pickClips(entries, checked);
    expect(picked.map((p) => [p.rank, p.entry.label || "(spare)", p.chosen.id])).toEqual([
      [1, "B", "youtube:bbbbbbbbbbb"],
      [2, "C", "youtube:ccccccccccc"],
      [3, "A", "youtube:aaaaaaaaaaa"],
    ]);
    expect(picked.every((p) => p.runnersUp.every((r) => !picked.some((q) => q.chosen.id === r.id)))).toBe(true);
    expect(() => pickClips(entries, [[], [], [candidate("youtube:ccccccccccc")], []])).toThrow(/Not enough usable clips.*"A", "B", "D"/);
  });

  it("lends a spare clip to an entry whose own search found nothing", () => {
    const picked = pickClips([{ label: "A" }, { label: "B" }, { label: "C" }], [[candidate("youtube:aaaaaaaaaaa"), candidate("youtube:bbbbbbbbbbb"), candidate("youtube:ccccccccccc")], [], []]);
    expect(picked).toHaveLength(3);
    expect(new Set(picked.map((p) => p.chosen.id)).size).toBe(3);
  });
});

describe("ranking video script and timeline", () => {
  const picked = [1, 2, 3].map((rank) => ({ rank, entry: { label: "Idea", moment: "" }, chosen: candidate(`youtube:aaaaaaaaaa${rank}`) }));

  it("writes labels from the clips and falls back to each clip's own check", () => {
    const script = normalizeScript({ hook: "Number one broke the internet, seriously, watch this to the end", entries: [{ rank: 2, line: "Number two: the face says it all 😂", label: "Pasta 🍝 Mustache Kid Wow", emoji: "🍝" }] }, picked);
    expect(script.hook.split(" ").length).toBeLessThanOrEqual(9);
    expect(script.entries[1]).toEqual({ rank: 2, line: "Number two: the face says it all", label: "Pasta Mustache Kid", emoji: "🍝" });
    expect(script.entries[0]).toMatchObject({ rank: 1, label: "Ball Pit Dive", emoji: "🤸" });
    expect(script.entries[0].line).toMatch(/^Number 1:/);
    expect(cleanLabel("“Big” 🎂 cake fail now")).toBe("Big cake fail");
    expect(cleanLine("a b c", 2)).toBe("a b");
    expect(firstEmoji("ok 👍🏽 then")).toBe("👍");
  });

  it("counts down with hard cuts, lets each clip play on after its line, holds #1, and loops back", () => {
    const t = buildTimeline([
      { rank: 1, cuts: [{ start: 10, end: 13.5 }], duration: 20, lineSeconds: 2 },
      { rank: 2, cuts: [{ start: 1, end: 2 }, { start: 3, end: 5 }], duration: 6, lineSeconds: 4 },
      { rank: 3, cuts: [{ start: 5, end: 8.5 }], duration: 30, lineSeconds: 2 },
    ], { hookSeconds: 1.8 });
    expect(t.rows.map((r) => r.rank)).toEqual([3, 2, 1]);
    // Three entries share out the run-on so the video lands in 20-30 s.
    expect(t.duration).toBeGreaterThanOrEqual(20);
    expect(t.duration).toBeLessThanOrEqual(30);
    // After each line the clip keeps playing with its own sound (the 6 s #2 source runs out sooner).
    for (const row of t.rows) {
      const line = t.voice.find((v) => v.kind === "line" && v.rank === row.rank)!;
      expect(row.to - (line.at + line.seconds)).toBeGreaterThanOrEqual(row.rank === 2 ? 0.5 : 1.5);
    }
    // #2's short source is stretched from both ends: its first cut starts at 0.
    expect(t.segments.filter((s) => s.rank === 2)[0].start).toBe(0);
    expect(t.segments.find((s) => s.rank === 1)).toMatchObject({ hold: RANKING.hold });
    expect(t.segments.at(-1)).toMatchObject({ tail: true, muted: true, rank: 3 });
    expect(t.voice[0]).toMatchObject({ kind: "hook", at: 0.1 });
    expect(t.voice[1].at).toBe(2.05);
    // Lines never overlap.
    for (let i = 1; i < t.voice.length; i++) expect(t.voice[i].at).toBeGreaterThanOrEqual(t.voice[i - 1].at + t.voice[i - 1].seconds);
    expect(t.duration).toBeCloseTo(t.segments.reduce((sum, s) => sum + s.length + (s.hold || 0), 0), 3);
    const states = overlayStates(t.rows, t.duration);
    expect(states.map((s) => s.shown)).toEqual([[3], [3, 2], [3, 2, 1], [3]]);
    expect(states.at(-1).t1).toBe(t.duration);
    expect(duckWindows([{ at: 1, seconds: 2 }])).toEqual([{ from: 0.92, to: 3.12 }]);
  });

  it("keeps a five-entry countdown near 30 s, trimming long windows from the front so the payoff stays", () => {
    const t = buildTimeline([1, 2, 3, 4, 5].map((rank) => ({ rank, cuts: [{ start: 10, end: 18 }], duration: 60, lineSeconds: 2.5 })), { hookSeconds: 1.8 });
    expect(t.duration).toBeLessThanOrEqual(30);
    expect(t.duration).toBeGreaterThanOrEqual(20);
    // Every trimmed window still ends on its payoff at 18 s.
    for (const rank of [2, 3, 4]) expect(t.segments.filter((s) => s.rank === rank && !s.tail).map((s) => s.start + s.length).at(-1)).toBeCloseTo(18, 2);
  });

  it("lists every source to credit", () => {
    const sources = sourcesList(picked.map((p) => ({ rank: p.rank, label: "Dive", chosen: p.chosen })));
    expect(sources[0]).toMatchObject({ rank: 1, url: "https://www.youtube.com/watch?v=aaaaaaaaaa1", uploader: "Someone", used: [{ start: 2, end: 5.5 }] });
    expect(sourcesMarkdown("TOP 3", sources)).toMatch(/#1 Dive: Someone on YouTube — https:\/\/www\.youtube\.com\/watch\?v=aaaaaaaaaa1 \(used 0:02\.0–0:05\.5\)/);
  });

  it("swaps a runner-up in with its own label and line", () => {
    const runner = candidate("youtube:zzzzzzzzzzz", { label: "Couch Flip", emoji: "🛋", line: "The couch wins again" });
    const plan = { entries: [{ rank: 1, label: "Dive", emoji: "🤸", line: "x", chosen: candidate("youtube:aaaaaaaaaaa"), runnersUp: [runner] }] };
    const swapped = applyPicks(plan, { 1: "youtube:zzzzzzzzzzz" });
    expect(swapped.entries[0]).toMatchObject({ label: "Couch Flip", emoji: "🛋", line: "Number 1: The couch wins again" });
    expect(swapped.entries[0].chosen.id).toBe("youtube:zzzzzzzzzzz");
    expect(swapped.entries[0].runnersUp[0].id).toBe("youtube:aaaaaaaaaaa");
    expect(applyPicks(plan, { 1: "youtube:unknown0000" }).entries[0].chosen.id).toBe("youtube:aaaaaaaaaaa");
  });
});

describe("ranking video overlays and render", () => {
  it("draws the caption fonts' own outlines, emoji from the emoji face", async () => {
    const fonts = [parseFont(await fs.readFile("public/fonts/captions/Anton.ttf")), parseFont(await fs.readFile("public/fonts/captions/NotoEmoji.ttf"))];
    expect(fonts[0].glyph("A".codePointAt(0))).toBeGreaterThan(0);
    expect(fonts[0].glyph("😂".codePointAt(0))).toBe(0);
    expect(fonts[1].glyph("😂".codePointAt(0))).toBeGreaterThan(0);
    const word = textOutline(fonts, "FAILS 😂", { size: 80, x: 10, baseline: 100 });
    expect(word.width).toBeGreaterThan(150);
    expect(word.d).toMatch(/^M[\d.]+ [\d.]+/);
    const band = titleBandSvg(fonts, { lines: ["TOP 5 FUNNIEST", "TODDLER FAILS"], red: "FAILS", yellow: "FUNNIEST" });
    expect(band).toMatch(/fill="#FF3B30"/);
    expect(band).toMatch(/fill="#FFD60A"/);
    const rows = [1, 2, 3, 4, 5].map((rank) => ({ rank, label: `Label ${rank}`, emoji: "😂" }));
    const list = rankListSvg(fonts, rows, [5, 4]);
    // Five numbers (#1 yellow, #2 orange, #3 red, #4-5 white), two labels with their backing.
    expect((list.match(/<path/g) || []).length).toBe(7);
    expect((list.match(/<rect/g) || []).length).toBe(2);
    expect([1, 2, 3, 4, 5].map(rankColor)).toEqual(["#FFD60A", "#FF8A00", "#FF3B30", "#FFFFFF", "#FFFFFF"]);
  });

  it("renders the clips over a blurred fill with the overlays, ducking the clip audio under the narration", () => {
    const args = renderArgs({
      segments: [
        { file: "/w/a.mp4", start: 2, length: 3, crop: { x: 0, y: 0, w: 1280, h: 600 }, audio: true },
        { file: "/w/b.mp4", start: 1, length: 3.5, crop: { x: 0, y: 0, w: 720, h: 1280 }, audio: false, hold: 0.8 },
        { file: "/w/a.mp4", start: 2, length: 0.3, crop: { x: 0, y: 0, w: 1280, h: 600 }, audio: true, muted: true },
      ],
      voice: [{ file: "/w/hook.wav", at: 0.1 }, { file: "/w/1.wav", at: 2 }],
      ducks: [{ from: 0, to: 1.5 }],
      overlayList: "/w/overlays.ffconcat",
      captionFilter: "ass=filename='/w/c.ass'",
      duration: 7.6,
      output: "/w/out.mp4",
    });
    const graph = args[args.indexOf("-filter_complex") + 1];
    expect(graph).toMatch(/\[0:v\]crop=1280:600:0:0,fps=30/);
    expect(graph).toMatch(/boxblur/);
    expect(graph).toMatch(/tpad=stop_mode=clone:stop_duration=0\.8/);
    expect(graph).toMatch(/loudnorm=I=-16/);
    expect(graph).toMatch(/concat=n=3:v=1:a=1/);
    expect(graph).toMatch(/\[cv\]\[ovl\]overlay/);
    expect(graph).toMatch(/ass=filename='\/w\/c\.ass',format=yuv420p/);
    expect(graph).toMatch(/volume=0\.25:enable='between\(t,0,1\.5\)'/);
    expect(graph).toMatch(/adelay=2000:all=1/);
    expect(graph).toMatch(/amix=inputs=3/);
    expect(args).toContain("/w/overlays.ffconcat");
    expect(args.at(-1)).toBe("/w/out.mp4");
  });
});

describe("makeRankingVideo", () => {
  // A fake media toolchain and AI: files appear where ffmpeg would write them.
  const fakes = (dir: string) => {
    const calls: string[] = [];
    const command = async (program: string, args: string[]) => {
      calls.push(`${path.basename(program)} ${args.join(" ")}`);
      if (/ffprobe/.test(program)) return JSON.stringify({ format: { duration: /voice/.test(args.at(-1) || "") ? "1.5" : "20" }, streams: [{ codec_type: "video", width: 1280, height: 720 }, { codec_type: "audio" }] });
      // Every clip is a 9:16 phone video boxed into 16:9 (the bar check runs alongside the frame grab).
      if (args.some((a) => a.includes("cropdetect"))) return [1, 2, 3, 4, 5, 6, 7].map((t) => `frame:${t} pts:${t} pts_time:${t / 2}\nlavfi.cropdetect.w=404\nlavfi.cropdetect.h=720\nlavfi.cropdetect.x=438\nlavfi.cropdetect.y=0\n`).join("");
      const pattern = args.find((a) => /frame-%03d\.jpg$/.test(a));
      if (pattern) for (let i = 1; i <= 6; i++) await fs.writeFile(pattern.replace("%03d", String(i).padStart(3, "0")), "jpg");
      const out = args.at(-1) || "";
      if (/\.(mp4|wav)$/.test(out)) await fs.writeFile(out, "media");
      return "";
    };
    const prompts: string[] = [];
    const request = async ({ messages }: { messages: Array<{ content: unknown }> }) => {
      const text = typeof messages[0].content === "string" ? messages[0].content : (messages[0].content as Array<{ text?: string }>)[0].text || "";
      prompts.push(text);
      if (/You plan viral/.test(text)) return { value: { topic: "toddler fails", title: { lines: ["TOP 3 FUNNIEST", "TODDLER FAILS"], red: "FAILS", yellow: "FUNNIEST" }, hook: "Number one is unreal", entries: [{ queries: ["toddler slips"], moment: "slips" }, { queries: ["baby cake"], moment: "cake" }, { queries: ["toddler door"], moment: "door" }] } };
      if (/You check a real video clip/.test(text)) return { value: { fit: 8, quality: /clip-c/.test(text) ? 9 : 7, window: { start: 3, end: 6.5 }, cuts: [{ start: 3, end: 6.5 }], boxes: [{ kind: "watermark", x: 0.8, y: 0.9, w: 0.15, h: 0.05 }], label: "Clip Label", emoji: "😂", line: "What a moment" } };
      return { value: { hook: "Number one is unreal", entries: [1, 2, 3].map((rank) => ({ rank, line: `Number ${rank}: wow`, label: `Pick ${rank}`, emoji: "😂" })) } };
    };
    const search = (prefix: string) => async (query: string) => [0, 1].map((i) => ({ id: `${prefix}${query.replace(/\W/g, "").slice(0, 8)}${i}`.padEnd(11, "x").slice(0, 11), title: `clip-${query.includes("door") ? "c" : "a"}`, channel: "Kid Clips", duration: "0:30" }));
    return { calls, prompts, command, request, search };
  };

  it("plans, searches, checks, narrates, and renders; a swap only renders again", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ranking-test-"));
    try {
      const f = fakes(dir);
      const downloads: string[] = [];
      const statuses: string[] = [];
      const options = {
        topic: "funniest toddler fails",
        settings: rankingSettings({ count: 3, captions: false }),
        dir,
        download: async (url: string, file: string) => { downloads.push(url); await fs.writeFile(file, "video"); },
        searchYouTube: f.search("y"),
        searchTikTok: async () => [{ id: "7300000000000000001", title: "tt", author: "Maya", authorHandle: "maya", durationSeconds: 20 }],
        speak: async () => ({ audio: Buffer.from("RIFF"), extension: "wav" }),
        voiceId: "openrouter:x:Puck",
        command: f.command,
        request: f.request,
        formatLibrary: [],
        nicheLibrary: [],
        onStatus: (m: string) => void statuses.push(m),
      };
      const made = await makeRankingVideo(options);
      expect(statuses).toEqual(expect.arrayContaining(["Planning the countdown", "Finding clips for #3", "Writing the narration", "Recording the narration", "Rendering"]));
      expect(statuses.some((s) => /^Checking \d+ clips$/.test(s))).toBe(true);
      expect(made.plan.entries.map((e: { rank: number }) => e.rank)).toEqual([1, 2, 3]);
      expect(made.plan.entries[0].label).toBe("Pick 1");
      // The bars come off; the watermark sits on a bar, so it goes with them.
      expect(made.plan.entries[0].chosen.check.crop).toEqual({ x: 438, y: 0, w: 404, h: 720 });
      expect(made.plan.entries.some((e: { runnersUp: unknown[] }) => e.runnersUp.length)).toBe(true);
      expect(made.sources).toHaveLength(3);
      expect(made.markdown).toMatch(/Kid Clips on YouTube/);
      const render = f.calls.find((c) => c.includes("overlays.ffconcat"));
      expect(render).toBeTruthy();
      expect(await fs.readdir(dir)).toEqual(expect.arrayContaining(["overlay-0.png", "overlay-3.png"]));
      // Every vision call keeps reasoning low.
      expect(f.prompts.filter((p) => /You check a real video clip/.test(p)).length).toBeGreaterThanOrEqual(6);

      // Swap #2 for its runner-up: no planning, searching, or checking again.
      const entry = made.plan.entries.find((e: { runnersUp: unknown[] }) => e.runnersUp.length);
      const runner = entry.runnersUp[0];
      const before = f.prompts.length;
      downloads.length = 0;
      const swapped = await makeRankingVideo({ ...options, plan: made.plan, picks: { [entry.rank]: runner.id } });
      expect(f.prompts.length).toBe(before);
      expect(downloads).toHaveLength(3);
      expect(swapped.plan.entries.find((e: { rank: number }) => e.rank === entry.rank).chosen.id).toBe(runner.id);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("fails clearly when too few entries have a usable clip", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ranking-test-"));
    try {
      const f = fakes(dir);
      await expect(makeRankingVideo({
        topic: "x", settings: rankingSettings({ count: 3 }), dir,
        download: async () => { throw new Error("blocked"); },
        searchYouTube: f.search("y"), searchTikTok: null,
        speak: async () => ({ audio: Buffer.from(""), extension: "wav" }),
        command: f.command, request: f.request, formatLibrary: [], nicheLibrary: [],
      })).rejects.toThrow(/Not enough usable clips/);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
