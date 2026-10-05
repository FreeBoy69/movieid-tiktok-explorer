import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterAll, describe, expect, it } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-stems-"));
process.env.CREATOR_STUDIO_DIR = dir;
const { configureCreatorStudio, normalizeRequest, runStems } = await import("./creatorStudio.js");
const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";
const tone = (file: string, freq: number) =>
  spawnSync(ffmpeg, ["-y", "-f", "lavfi", "-i", `sine=frequency=${freq}:duration=2`, file], { stdio: "ignore" }).status === 0;

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("Vocal Remover", () => {
  it("needs a video or a link", () => {
    expect(() => normalizeRequest({ tab: "vocal-remover", settings: {} })).toThrow(/Add the video to split/);
    expect(normalizeRequest({ tab: "vocal-remover", settings: { sourceUrl: "https://youtu.be/abc" } }).settings).toMatchObject({ sourceUrl: "https://youtu.be/abc" });
  });

  it("downloads the link, separates it, and returns the voice and the music as two MP3s", async () => {
    const calls: string[] = [];
    configureCreatorStudio({
      downloadVideo: async (url: string, target: string) => {
        calls.push(`download ${url}`);
        expect(tone(target.replace(/\.mp4$/, ".m4a"), 300)).toBe(true);
      },
      separateStems: async (source: string, workspace: string) => {
        calls.push(`split ${path.basename(source)}`);
        const vocals = path.join(workspace, "vocals.wav");
        const accompaniment = path.join(workspace, "no_vocals.wav");
        expect(tone(vocals, 220) && tone(accompaniment, 440)).toBe(true);
        return { vocals, accompaniment, engine: "Test engine" };
      },
    });
    const reports: string[] = [];
    const result = await runStems("usr_1", { id: "job-stems-1", settings: { sourceUrl: "https://youtu.be/abc" } }, new AbortController().signal, async (m: string) => { reports.push(m); });
    expect(calls).toEqual(["download https://youtu.be/abc", "split source.m4a"]);
    expect(result.engine).toBe("Test engine");
    expect((result.outputs as unknown as Array<{ title: string; type: string }>).map((o) => [o.title, o.type])).toEqual([["Voice only", "audio/mpeg"], ["Music and effects", "audio/mpeg"]]);
    expect(reports).toEqual(["Downloading the video", "Separating the voice from the music", "Saving the tracks"]);
    // The scratch folder is cleaned up; only the two outputs remain.
    const files = fs.readdirSync(dir, { recursive: true }).map(String);
    expect(files.filter((f) => f.endsWith(".mp3"))).toHaveLength(2);
    expect(files.some((f) => f.includes("work-job-stems-1"))).toBe(false);
  }, 30_000);

  it("refuses a link that isn't https", async () => {
    await expect(runStems("usr_1", { id: "job-stems-2", settings: { sourceUrl: "http://example.com/v" } }, new AbortController().signal, async () => {})).rejects.toThrow(/https video link/);
  });
});
