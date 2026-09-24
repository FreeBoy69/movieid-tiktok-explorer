import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { streamZip } from "./zipStream.js";

describe("streamZip", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zip-stream-"));
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("writes an archive unzip accepts, with files and in-memory entries intact", async () => {
    const big = crypto.randomBytes(3 * 1024 * 1024 + 7);
    const source = path.join(dir, "clip.mp4");
    fs.writeFileSync(source, big);
    const target = path.join(dir, "bundle.zip");
    const sink = fs.createWriteStream(target);
    await streamZip(sink, [
      { name: "video.mp4", file: source },
      { name: "script.txt", data: "Café scene one\n" },
      { name: "empty.srt", data: "" },
    ]);
    await new Promise((resolve) => sink.end(resolve));
    execFileSync("unzip", ["-tq", target]);
    expect(execFileSync("unzip", ["-Z1", target], { encoding: "utf8" }).trim().split("\n")).toEqual(["video.mp4", "script.txt", "empty.srt"]);
    expect(execFileSync("unzip", ["-p", target, "video.mp4"], { maxBuffer: 8 * 1024 * 1024 }).equals(big)).toBe(true);
    expect(execFileSync("unzip", ["-p", target, "script.txt"], { encoding: "utf8" })).toBe("Café scene one\n");
  });
});
