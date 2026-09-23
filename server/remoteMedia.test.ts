import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { adaptForWorker, analyzeCall, remoteProgram, canTake, requiredCapability } from "./remoteMedia.js";

describe("remote media calls", () => {
  it("sends only YouTube downloads to a YouTube-capable worker", () => {
    expect(requiredCapability("yt-dlp", ["-o", "a.mp4", "https://www.youtube.com/watch?v=abc"])).toBe("youtube");
    expect(requiredCapability("yt-dlp", ["https://youtu.be/abc"])).toBe("youtube");
    expect(requiredCapability("yt-dlp", ["https://www.tiktok.com/@a/video/1"])).toBe("");
    expect(requiredCapability("yt-dlp", ["https://youtube.com.evil.test/x"])).toBe("");
    expect(requiredCapability("ffmpeg", ["-i", "https://www.youtube.com/watch?v=abc"])).toBe("");
    expect(canTake({ requires: "youtube" }, new Set())).toBe(false);
    expect(canTake({ requires: "youtube" }, new Set(["youtube"]))).toBe(true);
    expect(canTake({ requires: "" }, new Set())).toBe(true);
  });
  it("maps program paths to the worker's program names", () => {
    expect(remoteProgram("/usr/bin/ffmpeg")).toBe("ffmpeg");
    expect(remoteProgram("python3.11")).toBe("python3");
    expect(remoteProgram("node")).toBe("");
  });

  it("rewrites calls the media image can't run as given", () => {
    expect(adaptForWorker("python3", ["-m", "yt_dlp", "--version"])).toEqual(["yt-dlp", ["--version"]]);
    const [zip, zipArgs] = adaptForWorker("zip", ["-q", "-r", "/tmp/out.zip", "."]);
    expect(zip).toBe("python3");
    expect(zipArgs.slice(2)).toEqual(["-q", "-r", "/tmp/out.zip", "."]);
    const [py, pyArgs] = adaptForWorker("python3", ["/app/scripts/transcribe.py", "/tmp/a.wav"]);
    expect(py).toBe("python3");
    expect(pyArgs[0]).toBe("-c");
    expect(pyArgs.slice(2)).toEqual(["/app/scripts/transcribe.py", "/tmp/a.wav"]);
    expect(adaptForWorker("ffmpeg", ["-i", "x"])).toEqual(["ffmpeg", ["-i", "x"]]);
  });

  it("sorts paths into inputs and watched output directories", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rm-analyze-"));
    fs.writeFileSync(path.join(dir, "a.wav"), "a");
    fs.writeFileSync(path.join(dir, "b.wav"), "b");
    fs.writeFileSync(path.join(dir, "list.txt"), "file 'a.wav'\nfile 'b.wav'\n");
    fs.writeFileSync(path.join(dir, "subs.ass"), "s");
    const out = path.join(dir, "render", "out.mp4");
    const result = analyzeCall(
      "ffmpeg",
      ["-y", "-f", "concat", "-safe", "0", "-i", "list.txt", "-vf", `subtitles=${path.join(dir, "subs.ass")}:force_style=x`, out],
      dir,
    );
    expect(result.inputs.sort()).toEqual([path.join(dir, "a.wav"), path.join(dir, "b.wav"), path.join(dir, "list.txt"), path.join(dir, "subs.ass")].sort());
    expect(result.watch).toContain(path.join(dir, "render"));
    expect(result.watch).toContain(dir);
  });
});
