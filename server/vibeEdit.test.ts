import { describe, expect, it } from "vitest";
import { buildRenderArgs, duckWindows, overlayConcatList, renderDuration } from "./vibeEditRender.js";
import { layoutLines, parseWav, projectSummary, trimSilence, wavFromPcm } from "./vibeEdit.js";

const base = {
  version: 1,
  id: "vp_test",
  name: "Test",
  aspect: "9:16",
  background: "#101010",
  assets: [
    { id: "v", kind: "video", name: "v", url: "/api/studio/files/up-v.mp4", file: "up-v.mp4", duration: 8 },
    { id: "i", kind: "image", name: "i", url: "/api/studio/files/up-i.png", file: "up-i.png" },
    { id: "m", kind: "audio", name: "m", url: "/api/studio/files/up-m.mp3", file: "up-m.mp3", duration: 60 },
    { id: "vo", kind: "audio", name: "vo", url: "/api/studio/files/gen-vo.wav", file: "gen-vo.wav", duration: 4 },
  ],
  clips: [
    { id: "c1", assetId: "v", track: 0, start: 0, in: 2, out: 8 },
    { id: "c2", assetId: "i", track: 1, start: 1, in: 0, out: 3, fit: "fill" },
  ],
  audio: [
    { id: "a1", assetId: "m", lane: 0, start: 0, in: 0, out: 6, volume: 0.3, fadeOut: 2 },
    { id: "a2", assetId: "vo", lane: 1, start: 1, in: 0, out: 4, volume: 1, duck: 0.4, preset: "studio" },
  ],
  texts: [],
  captions: { cues: [], show: true, style: "clean", wordHighlight: true },
  createdAt: 0,
  updatedAt: 0,
};

const paths = { v: "/tmp/v.mp4", i: "/tmp/i.png", m: "/tmp/m.mp3", vo: "/tmp/vo.wav" } as Record<string, string>;

describe("vibe edit render", () => {
  it("lays every clip, sound, and overlay into one ffmpeg graph", () => {
    const { args, duration, width, height } = buildRenderArgs({ project: base, pathOf: (a: { id: string }) => paths[a.id], audible: ["v"], overlayList: "/tmp/ov.txt", output: "/tmp/out.mp4" });
    expect([width, height, duration]).toEqual([1080, 1920, 6]);
    const graph = args[args.indexOf("-filter_complex") + 1];
    // Video trimmed at input, image looped for its length.
    expect(args.join(" ")).toContain("-ss 2 -t 6 -i /tmp/v.mp4");
    expect(args.join(" ")).toContain("-loop 1 -framerate 30 -t 3 -i /tmp/i.png");
    expect(args.join(" ")).toContain("-f concat -safe 0 -i /tmp/ov.txt");
    // Track 1 composites over track 0 during its window, cropped to fill.
    expect(graph).toContain("force_original_aspect_ratio=increase,crop=1080:1920");
    expect(graph).toContain("overlay=eof_action=pass:enable='between(t,1,3.999)'");
    // Inputs: video 0, image 1, overlay list 2, music 3, voiceover 4.
    // The clip's own sound and the music duck under the voiceover; the voiceover does not.
    expect(graph).toMatch(/\[0:a\][^;]*volume=0\.4:enable='between\(t,1,5\)'/);
    expect(graph).toMatch(/\[3:a\][^;]*afade=t=out:st=4:d=2[^;]*volume=0\.4:enable/);
    expect(graph).toMatch(/\[4:a\][^;]*acompressor[^;]*adelay=1000:all=1\[a2\]/);
    expect(graph).toContain("amix=inputs=3:normalize=0");
    expect(args.at(-1)).toBe("/tmp/out.mp4");
  });

  it("skips the audio of silent videos and renders silence when nothing sounds", () => {
    const project = { ...base, audio: [] };
    const { args } = buildRenderArgs({ project, pathOf: (a: { id: string }) => paths[a.id], audible: [], output: "/o.mp4" });
    const graph = args[args.indexOf("-filter_complex") + 1];
    expect(graph).not.toContain("[0:a]");
    expect(graph).toContain("anullsrc");
  });

  it("finds ducking windows and the full duration", () => {
    expect(duckWindows(base)).toEqual([{ id: "a2", from: 1, to: 5, gain: 0.4 }]);
    expect(renderDuration({ ...base, texts: [{ id: "t", text: "x", start: 0, end: 9 }] })).toBe(9);
  });

  it("writes overlay frames as a concat list with blanks in the gaps", () => {
    const list = overlayConcatList([{ t0: 1, t1: 2, file: "/w/a.png" }, { t0: 2, t1: 3.5, file: "/w/b.png" }], "/w/blank.png", 5);
    expect(list.split("\n").filter(Boolean)).toEqual([
      "ffconcat version 1.0",
      "file '/w/blank.png'", "duration 1",
      "file '/w/a.png'", "duration 1",
      "file '/w/b.png'", "duration 1.5",
      "file '/w/blank.png'", "duration 1.5",
      "file '/w/blank.png'",
    ]);
  });
});

describe("vibe edit voiceover assembly", () => {
  it("places timed lines at their cues and pushes back lines that would overlap", () => {
    const layout = layoutLines([{ id: "a", at: 2 }, { id: "b", at: 3 }, { id: "c", at: 10 }], [1.5, 2, 1]);
    expect(layout.map((l) => [l.id, l.start, l.offset])).toEqual([["a", 2, 0], ["b", 3.5, 1.5], ["c", 10, 8]]);
  });

  it("spaces untimed script lines with a gap", () => {
    const layout = layoutLines([{ id: "a" }, { id: "b" }], [1, 1], 0.5);
    expect(layout.map((l) => l.start)).toEqual([0, 1.5]);
  });

  it("round-trips 16-bit WAV and folds stereo to mono", () => {
    const pcm = new Int16Array([0, 1000, -1000, 32767]);
    const parsed = parseWav(wavFromPcm(pcm, 22050));
    expect(parsed?.rate).toBe(22050);
    expect([...(parsed?.samples || [])]).toEqual([0, 1000, -1000, 32767]);
    const stereo = wavFromPcm(new Int16Array([100, 300, -200, -400]), 8000);
    stereo.writeUInt16LE(2, 22);
    expect([...(parseWav(stereo)?.samples || [])]).toEqual([200, -300]);
    expect(parseWav(Buffer.from("not a wav file at all, nope, really not"))).toBeNull();
  });

  it("trims silence at both ends but keeps a little padding", () => {
    const rate = 1000;
    const samples = new Int16Array(1000);
    samples.fill(5000, 400, 600);
    const trimmed = trimSilence(samples, rate);
    expect(trimmed.length).toBe(200 + 2 * 40);
  });

  it("summarizes a project for the edit list", () => {
    expect(projectSummary(base)).toMatchObject({ id: "vp_test", name: "Test", duration: 6, clips: 2, cover: { kind: "video" } });
  });
});
