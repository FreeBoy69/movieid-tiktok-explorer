import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { normalizeRequest } from "./creatorStudio.js";
import {
  assembleExplainer,
  buildTimeline,
  captionCues,
  chapterErrors,
  chapterKey,
  explainerTheme,
  fallbackChapter,
  mixSoundtrack,
  parseChapter,
  parsePlan,
  readWav,
  splitCaption,
  reusableChapters,
  runExplainerFilm,
  runExplainerPlan,
  toSrt,
  TIMING,
} from "./explainerStudio.js";
import { EXPLAINER_MAX_WORDS, estimateScriptSeconds, normalizeExplainerScript, scriptWords } from "../src/utils/explainerPresets.js";
import { canUseVoice, claimVoice, releaseVoice, resetVoiceOwners, visibleVoices } from "./voiceOwners.js";

const script = {
  title: "Acme in two minutes",
  chapters: [
    { id: "c1", title: "Meet Acme", visuals: ["screen1"], lines: [{ text: "This is Acme.", cue: "logo" }, { text: "It plans your week for you.", cue: "home screen" }] },
    { id: "c2", title: "Boards", visuals: ["page1"], lines: [{ text: "Click New board to start.", cue: 'cursor clicks "New board"' }] },
  ],
};

describe("explainer scripts", () => {
  it("keeps only well-formed chapters and lines, within the limits", () => {
    const normalized = normalizeExplainerScript({
      title: "  T  ",
      chapters: [
        { id: "c1", title: "One", visuals: ["screen1", "screen1", "bad id!", "page2"], lines: ["Plain string line.", { text: "  spaced   out  ", cue: "x" }, { text: "" }] },
        { id: "c1", title: "", lines: [{ text: "Duplicate id." }] },
        { title: "Empty", lines: [] },
        ...Array.from({ length: 12 }, (_, i) => ({ title: `Extra ${i}`, lines: [{ text: "Hi." }] })),
      ],
    });
    expect(normalized.title).toBe("T");
    expect(normalized.chapters).toHaveLength(9);
    expect(normalized.chapters[0]).toEqual({ id: "c1", title: "One", visuals: ["screen1", "page2"], lines: [{ text: "Plain string line.", cue: "" }, { text: "spaced out", cue: "x" }] });
    expect(normalized.chapters[1].id).toBe("c2");
    expect(normalized.chapters[1].title).toBe("Chapter 2");
    expect(scriptWords(script)).toBe(14);
    expect(estimateScriptSeconds(script)).toBeGreaterThan(5);
  });

  it("validates plan and film requests", () => {
    const plan = normalizeRequest({ tab: "explainer", prompt: "", settings: { stage: "plan", sourceUrl: "acme.test", template: "how-to", length: 999, uploads: [{ file: "up-a-1.png", label: "Dashboard" }, { file: "up-a-2.mp4" }], recordings: [{ file: "up-a-3.mp4", label: "Demo" }, { file: "up-a-4.png" }] } });
    expect(plan.settings).toMatchObject({ stage: "plan", template: "how-to", length: 60, aspectRatio: "16:9", sourceUrl: "https://acme.test" });
    expect(plan.settings.uploads).toEqual([{ file: "up-a-1.png", label: "Dashboard" }]);
    expect((plan.settings as any).recordings).toEqual([{ file: "up-a-3.mp4", label: "Demo" }]);
    expect(() => normalizeRequest({ tab: "explainer", prompt: "", settings: { stage: "plan" } })).toThrow(/link, screenshots, a screen recording/);

    const film = normalizeRequest({ tab: "explainer", prompt: "", settings: { stage: "film", kitFile: "gen-k-1.json", voiceId: "openrouter:m:Kore", script, aspectRatio: "9:16", captions: false } });
    expect(film.settings).toMatchObject({ stage: "film", kitFile: "gen-k-1.json", voiceId: "openrouter:m:Kore", aspectRatio: "9:16", captions: false, music: true });
    expect((film.settings.script as any).chapters).toHaveLength(2);
    expect(() => normalizeRequest({ tab: "explainer", prompt: "", settings: { stage: "film", kitFile: "../etc.json", voiceId: "v", script } })).toThrow(/Plan the video first/);
    expect(() => normalizeRequest({ tab: "explainer", prompt: "", settings: { stage: "film", kitFile: "gen-k-1.json", script } })).toThrow(/Choose a voice/);
    const long = { chapters: Array.from({ length: 9 }, () => ({ title: "x", lines: Array.from({ length: 8 }, () => ({ text: "word ".repeat(60) })) })) };
    expect(() => normalizeRequest({ tab: "explainer", prompt: "", settings: { stage: "film", kitFile: "gen-k-1.json", voiceId: "v", script: long } })).toThrow(new RegExp(`limit is ${EXPLAINER_MAX_WORDS}`));
  });

  it("reads Opus's plan, dropping visuals that don't exist", () => {
    const reply = "```json\n" + JSON.stringify({ title: "Acme", summary: "s", features: [{ name: "Boards", what: "w" }, { what: "no name" }], chapters: [{ id: "c1", title: "A", visuals: ["screen1", "ghost"], lines: [{ text: "One.", cue: "c" }] }, { id: "c2", title: "B", visuals: [], lines: [{ text: "Two." }] }] }) + "\n```";
    const plan = parsePlan(reply, ["screen1", "logo"]);
    expect(plan?.chapters[0].visuals).toEqual(["screen1"]);
    expect(plan?.features).toEqual([{ name: "Boards", what: "w" }]);
    expect(parsePlan("not json", [])).toBeNull();
    expect(parsePlan(JSON.stringify({ chapters: [{ lines: [{ text: "Only one." }] }] }), [])).toBeNull();
  });
});

describe("the narration clock", () => {
  it("lays chapters and lines on the spoken durations", () => {
    const timeline = buildTimeline(script.chapters, [[1, 2], [1.5]]);
    const [a, b] = timeline.chapters;
    expect(a.lines[0]).toMatchObject({ start: TIMING.firstLead, end: TIMING.firstLead + 1 });
    expect(a.lines[1].start).toBeCloseTo(TIMING.firstLead + 1 + TIMING.gap);
    expect(a.end).toBeCloseTo(a.lines[1].end + TIMING.tail);
    expect(b.start).toBe(a.end);
    expect(b.lines[0].start).toBeCloseTo(b.start + TIMING.lead);
    expect(timeline.duration).toBeCloseTo(b.lines[0].end + TIMING.tail + TIMING.hold);
    expect(b.duration).toBeCloseTo(b.end - b.start);
  });

  it("splits captions into readable phrases inside each line's window", () => {
    const timeline = buildTimeline([{ id: "c1", title: "t", visuals: [], lines: [{ text: "This first sentence is long enough to need two caption phrases on screen.", cue: "" }] }], [[4]]);
    const cues = captionCues(timeline, 30);
    expect(cues.length).toBeGreaterThan(1);
    expect(cues.every((cue) => cue.text.length <= 30 || !cue.text.includes(" "))).toBe(true);
    expect(cues[0].start).toBeCloseTo(timeline.chapters[0].lines[0].start);
    expect(cues.at(-1)!.end).toBeCloseTo(timeline.chapters[0].lines[0].end);
    expect(toSrt(cues.slice(0, 1))).toMatch(/^1\n00:00:00,800 --> 00:00:0\d,\d{3}\nThis first/);
  });

  it("never leaves a caption orphan", () => {
    const pieces = splitCaption("To add something new, click New board in the sidebar.", 30);
    expect(pieces).toEqual(["To add something new,", "click New board", "in the sidebar."]);
    expect(splitCaption("Short line.", 30)).toEqual(["Short line."]);
    expect(splitCaption("Supercalifragilisticexpialidocious-and-more words here", 10)[0]).toBe("Supercalifragilisticexpialidocious-and-more");
    for (const text of ["This is Acme, where your whole week lives on one board.", "Pick a template, name it, and share the link with your whole team in one click."])
      for (const max of [26, 34, 44]) {
        const parts = splitCaption(text, max);
        expect(parts.join(" ")).toBe(text);
        expect(parts.every((part) => part.length <= max)).toBe(true);
        expect(parts.every((part) => part.length >= Math.min(12, text.length))).toBe(true);
      }
  });

  it("mixes the voice over a bed that stays under it", () => {
    const samples = new Int16Array(44100).map((_, i) => Math.round(Math.sin(i / 10) * 12000));
    const wav = mixSoundtrack({ duration: 3, speech: [{ start: 1, samples }], music: true });
    const read = readWav(wav);
    expect(read.channels).toBe(2);
    expect(read.rate).toBe(44100);
    expect(read.seconds).toBeCloseTo(3, 2);
    const at = (t: number) => Math.abs(read.samples[Math.round(t * 44100) * 2]);
    const peak = (from: number, to: number) => {
      let p = 0;
      for (let i = Math.round(from * 44100); i < Math.round(to * 44100); i++) p = Math.max(p, Math.abs(read.samples[i * 2]));
      return p;
    };
    expect(peak(1.1, 1.9)).toBeGreaterThan(peak(2.3, 2.9) * 5);
    expect(at(0)).toBeLessThan(200);
    const silent = readWav(mixSoundtrack({ duration: 1, speech: [], music: false }));
    expect(Math.max(...Array.from(silent.samples.slice(0, 2000)).map(Math.abs))).toBe(0);
  });
});

describe("the film document", () => {
  const kit = { assets: { screen1: "data:image/jpeg;base64,AA==", logo: "data:image/svg+xml;base64,AA==" }, brief: { site: { url: "https://www.acme.test/" }, assets: [], fonts: [{ family: "Inter" }], colors: { accents: ["#e11d48"], neutrals: ["#fafafa", "#0a0a0a"], named: [] } }, vision: [] };

  it("takes a readable theme from the brand", () => {
    const theme = explainerTheme(kit.brief);
    expect(theme.accent).toBe("#e11d48");
    expect(theme.ink).toBe("#0a0a0a");
    expect(theme.font).toMatch(/^"Inter"/);
    expect(explainerTheme({}).accent).toBe("#2f5bea");
  });

  it("parses a chapter reply and renumbers it", () => {
    const reply = "Here you go:\n```html\n<style>#ch-2 .a{color:red}</style>\n<script>\nEX.chapter(7, function (root, C) { return function (t) {}; });\n</script>\n```";
    expect(parseChapter(reply, 2)).toEqual({ style: "#ch-2 .a{color:red}", script: "EX.chapter(2, function (root, C) { return function (t) {}; });" });
    expect(parseChapter("<script>window.seek=1</script>", 1)).toBeNull();
    // A half-applied edit leaves merge markers behind; that script would never run, so it is refused.
    expect(parseChapter("<script>EX.chapter(1, function (root, C) {\n=======\n return function (t) {}; });</script>", 1)).toBeNull();
  });

  it("assembles chapters with keys a later run can reuse", () => {
    const timeline = buildTimeline(script.chapters, [[1, 2], [1.5]]);
    const theme = explainerTheme(kit.brief);
    const blocks = timeline.chapters.map((chapter) => ({ n: chapter.n, key: chapterKey({ chapter, width: 1920, height: 1080, captions: true, theme }), code: fallbackChapter(chapter, { width: 1920, height: 1080, kit, captions: true }) }));
    const html = assembleExplainer({ width: 1920, height: 1080, theme, captions: true, timeline: { ...timeline, title: "A </script> title" }, cues: captionCues(timeline), blocks });
    expect(html).toMatch(/^<!doctype html>/);
    expect(html).not.toMatch(/<\/script> title/);
    expect(html).toContain('url: "acme.test"');
    const reuse = reusableChapters(html);
    expect([...reuse.keys()]).toEqual(blocks.map((block) => block.key));
    expect(reuse.get(blocks[1].key)?.code.script).toContain("EX.chapter(2,");
    const moved = buildTimeline(script.chapters, [[1, 2.5], [1.5]]);
    expect(chapterKey({ chapter: moved.chapters[0], width: 1920, height: 1080, captions: true, theme })).not.toBe(blocks[0].key);
    expect(chapterKey({ chapter: moved.chapters[1], width: 1920, height: 1080, captions: true, theme })).toBe(blocks[1].key);
  });

  it("attributes inspection errors to chapters", () => {
    const timeline = buildTimeline(script.chapters, [[1, 2], [1.5]]);
    const errors = chapterErrors(["Chapter 2: boom", `seek(${timeline.chapters[0].start + 0.5}) depends on earlier seek calls`, "JavaScript error somewhere"], timeline);
    expect(errors.get(2)).toEqual(["Chapter 2: boom"]);
    expect(errors.get(1)?.[0]).toMatch(/depends on earlier/);
    expect(errors.size).toBe(2);
  });
});

describe("the jobs", () => {
  const wav = (seconds: number) => {
    const n = Math.round(seconds * 24000);
    const buf = Buffer.alloc(44 + n * 2);
    buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write("WAVE", 8); buf.write("fmt ", 12);
    buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(24000, 24);
    buf.writeUInt32LE(48000, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write("data", 36); buf.writeUInt32LE(n * 2, 40);
    for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin(i / 8) * 9000), 44 + i * 2);
    return buf;
  };

  it("plans from uploads and notes alone, and writes the kit", async () => {
    const png = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
    const written: Array<{ ext: string; bytes: Buffer }> = [];
    const result = await runExplainerPlan(
      { prompt: "Acme plans your week. Boards and a calendar.", settings: { stage: "plan", template: "feature-tour", length: 60, uploads: [{ file: "up-1.png", label: "Dashboard" }] } },
      {
        fetcher: async () => { throw new Error("offline"); },
        readUpload: async () => ({ mime: "image/png", bytes: png }),
        writeOutput: async (bytes: Buffer, ext: string) => { written.push({ ext, bytes }); return { file: `gen-x-${written.length}.${ext}`, url: "", type: "" }; },
        report: async () => {},
        complete: async (messages: any[]) => {
          expect(JSON.stringify(messages)).toContain("upload1");
          return { choices: [{ message: { content: JSON.stringify({ title: "Acme", features: [{ name: "Boards", what: "Plan" }], chapters: [{ id: "c1", title: "Hi", visuals: ["upload1"], lines: [{ text: "This is Acme.", cue: "dashboard" }] }, { id: "c2", title: "Bye", visuals: [], lines: [{ text: "Try it today." }] }] }) } }] };
        },
      },
      undefined,
    );
    expect(result.plan.chapters.map((c: any) => c.title)).toEqual(["Hi", "Bye"]);
    expect(result.plan.assets).toEqual([{ id: "upload1", label: "User upload: Dashboard" }]);
    expect(result.kit.file).toMatch(/\.json$/);
    const kit = JSON.parse(written[0].bytes.toString("utf8"));
    expect(kit.assets.upload1).toMatch(/^data:image\/png/);
    expect(result.steps.every((step: any) => step.status === "done")).toBe(true);
  });

  it("refuses a narration longer than three minutes", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ex-test-"));
    try {
      const outputs: string[] = [];
      const run = runExplainerFilm(
        { prompt: "", settings: { stage: "film", kitFile: "gen-k.json", voiceId: "openrouter:m:Kore", script, aspectRatio: "16:9" } },
        {
          readJson: async () => ({ assets: {}, brief: { assets: [], fonts: [] }, fontCss: "" }),
          readSource: async () => "",
          speak: async () => ({ audio: wav(1), extension: "wav" }),
          // Stands in for ffmpeg: 100 seconds per line, far over the limit even sped up.
          command: async (_cmd: string, args: string[]) => { await fs.writeFile(args.at(-1)!, wav(100)); return ""; },
          writeOutput: async (_bytes: Buffer, ext: string) => { outputs.push(ext); return { file: `gen-y.${ext}` }; },
          report: async () => {},
        },
        undefined,
      );
      await expect(run).rejects.toThrow(/runs \d+ seconds/);
      expect(outputs).toEqual([]);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe("voice ownership", () => {
  const dir = path.join(os.tmpdir(), `voice-owners-${process.pid}`);
  afterEach(async () => {
    delete process.env.CREATOR_ASSETS_DIR;
    resetVoiceOwners();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("keeps a cloned voice to the person who cloned it, and leaves older voices shared", async () => {
    process.env.CREATOR_ASSETS_DIR = dir;
    resetVoiceOwners();
    await claimVoice("v-founder", "user-a");
    expect(await canUseVoice("v-founder", "user-a")).toBe(true);
    expect(await canUseVoice("v-founder", "user-b")).toBe(false);
    expect(await canUseVoice("v-legacy", "user-b")).toBe(true);
    const profiles = [{ id: "v-founder", name: "Founder" }, { id: "v-legacy", name: "Old" }];
    expect((await visibleVoices(profiles, "user-b")).map((p) => p.id)).toEqual(["v-legacy"]);
    expect(await visibleVoices(profiles, "user-a")).toEqual([{ id: "v-founder", name: "Founder", owned: true }, { id: "v-legacy", name: "Old" }]);
    // It survives a restart.
    resetVoiceOwners();
    expect(await canUseVoice("v-founder", "user-b")).toBe(false);
    await releaseVoice("v-founder");
    expect(await canUseVoice("v-founder", "user-b")).toBe(true);
  });
});
