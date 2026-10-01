import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { renderCreatorAssets, styledCaptions } from "./creatorWorkspace.js";
import { findCaptionStyle } from "../src/utils/captionStyles.js";

const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";
const hasLibass = () => /\bass\b/.test(spawnSync(ffmpeg, ["-hide_banner", "-filters"], { encoding: "utf8" }).stdout || "");

const project = {
  metadata: { settings: { aspect: "9:16" } },
  outputs: {
    voiceover: {
      duration: 3,
      segments: [{ start: 0, end: 2.4, text: "Ship it faster today", words: [
        { word: "Ship", start: 0, end: 0.4 }, { word: "it", start: 0.45, end: 0.7 }, { word: "faster", start: 0.8, end: 1.4 }, { word: "today", start: 1.5, end: 2.4 },
      ] }],
    },
  },
};
const scenes = [{ start: 0, end: 3, text: "Ship it faster today" }];

describe("styled captions for a render", () => {
  it("chunks the voiceover in the style's rhythm and embeds the shipped font", async () => {
    const ass = await styledCaptions(project as any, scenes, findCaptionStyle("signal")!);
    expect(ass).toContain("PlayResX: 720");
    expect(ass).toContain("PlayResY: 1280");
    expect(ass).toContain("[Fonts]\nfontname: Montserrat.ttf\n");
    expect(ass.length).toBeGreaterThan(400_000); // the ExtraBold face rides along
    const events = ass.split("\n").filter((l) => l.startsWith("Dialogue:"));
    expect(events).toHaveLength(4);
    expect(events[0]).toMatch(/SHIP\{\\r\} IT FASTER$/);
  });

  it("still renders when a font file is missing", async () => {
    const ass = await styledCaptions(project as any, scenes, findCaptionStyle("classic")!, { readFont: async () => null });
    expect(ass).not.toContain("[Fonts]");
    expect(ass).toContain("Style: Caption,Anton,");
  });

  it.skipIf(!hasLibass())("burns the captions into the joined video", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "creator-captions-"));
    try {
      const image = path.join(dir, "image.png"), voice = path.join(dir, "voice.wav"), output = path.join(dir, "out.mp4"), ass = path.join(dir, "captions.ass");
      spawnSync(ffmpeg, ["-y", "-f", "lavfi", "-i", "color=c=gray:size=180x320", "-frames:v", "1", image], { stdio: "ignore" });
      spawnSync(ffmpeg, ["-y", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=mono", "-t", "3", "-c:a", "pcm_s16le", voice], { stdio: "ignore" });
      fs.writeFileSync(ass, await styledCaptions(project as any, scenes, findCaptionStyle("signal")!));
      const result = await renderCreatorAssets({ scenes: [{ start: 0, end: 3, path: image, clipPath: null, motion: "still" }], voice, soundtrack: null, captions: null, output, aspect: "9:16", burnCaptions: ass, signal: undefined });
      expect(result).toMatchObject({ width: 720, height: 1280, audio: true });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
