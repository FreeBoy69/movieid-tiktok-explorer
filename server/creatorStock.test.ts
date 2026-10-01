import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { renderCreatorAssets, renderVariantCount } from "./creatorWorkspace.js";
import { validateCreatorScenes } from "../src/utils/creatorPipeline.js";

const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";
const ffprobe = process.env.FFPROBE_PATH || "ffprobe";
const run = (args: string[]) => spawnSync(ffmpeg, ["-y", ...args], { stdio: "ignore" }).status === 0;
const probe = (file: string) => JSON.parse(spawnSync(ffprobe, ["-v", "error", "-show_streams", "-show_format", "-of", "json", file], { encoding: "utf8" }).stdout);

describe("stock footage in the compositor", () => {
  let dir = "";
  const files = () => ({
    stock: path.join(dir, "stock.mp4"),
    short: path.join(dir, "short.mp4"),
    image: path.join(dir, "image.png"),
    voice: path.join(dir, "voice.wav"),
  });
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "creator-stock-"));
    const f = files();
    expect(run(["-f", "lavfi", "-i", "testsrc2=size=320x180:rate=30", "-t", "4", "-pix_fmt", "yuv420p", f.stock])).toBe(true);
    expect(run(["-f", "lavfi", "-i", "testsrc=size=320x180:rate=30", "-t", "1", "-pix_fmt", "yuv420p", f.short])).toBe(true);
    expect(run(["-f", "lavfi", "-i", "color=c=blue:size=320x180", "-frames:v", "1", f.image])).toBe(true);
    expect(run(["-f", "lavfi", "-i", "anullsrc=r=48000:cl=mono", "-t", "6", "-c:a", "pcm_s16le", f.voice])).toBe(true);
  });
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("renders a second cut with a stock offset, a looped short clip, and fades", async () => {
    const f = files();
    const output = path.join(dir, "cut-2.mp4");
    const scenes = [
      { start: 0, end: 2, path: f.image, clipPath: f.stock, motion: "still", stock: { clipSeconds: 4, loop: false } },
      { start: 2, end: 4, path: f.image, clipPath: f.short, motion: "still", stock: { clipSeconds: 1, loop: true } },
      { start: 4, end: 6, path: f.image, clipPath: null, motion: "push" },
    ];
    const result = await renderCreatorAssets({ scenes, voice: f.voice, output, aspect: "16:9", variant: 1, transition: "fade" });
    expect(result).toMatchObject({ width: 1280, height: 720, audio: true, sceneCount: 3 });
    expect(Math.abs(result.duration - 6)).toBeLessThan(0.5);
    const streams = probe(output).streams;
    expect(streams.find((s: any) => s.codec_type === "video").r_frame_rate).toBe("30/1");
  }, 60_000);

  it("clamps the variant count", () => {
    expect(renderVariantCount({})).toBe(1);
    expect(renderVariantCount({ renderVariants: "2" })).toBe(2);
    expect(renderVariantCount({ renderVariants: 9 })).toBe(3);
    expect(renderVariantCount({ renderVariants: -4 })).toBe(1);
  });
});

describe("stock scenes survive plan edits", () => {
  const original = [
    { id: "scene-a", start: 0, end: 2, text: "a", prompt: "p", asset: "/a.jpg", clip: "/a-stock.mp4", stock: { provider: "pexels", id: "1", credit: "Pexels by Ana" } },
    { id: "scene-b", start: 2, end: 4, text: "b", prompt: "q", asset: "/b.png" },
  ];
  it("keeps the clip, its credit and search terms when the scene is unchanged", () => {
    const edited = original.map((scene) => ({ ...scene, searchTerms: ["harbour town", "fishing boats", "x", "y", "z"] }));
    const result = validateCreatorScenes(edited, original, 4);
    expect(result[0]).toMatchObject({ clip: "/a-stock.mp4", stock: { provider: "pexels", id: "1" } });
    expect(result[0].searchTerms).toEqual(["harbour town", "fishing boats", "x", "y"]);
    expect(result[1].stock).toBeUndefined();
  });
  it("drops the footage with the image when the prompt changes", () => {
    const edited = original.map((scene, i) => (i === 0 ? { ...scene, prompt: "new" } : scene));
    const result = validateCreatorScenes(edited, original, 4);
    expect(result[0].asset).toBeNull();
    expect(result[0].clip).toBeNull();
    expect(result[0].stock).toBeUndefined();
  });
});
