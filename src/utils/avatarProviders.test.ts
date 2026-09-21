import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { composeAvatarRemake } from "./avatarProviders.js";

const workspaces: string[] = [];

afterEach(() => {
  for (const workspace of workspaces.splice(0)) fs.rmSync(workspace, { recursive: true, force: true });
});

describe("avatar scene composition", () => {
  it("replaces only the avatar half for split scenes and preserves b-roll scenes", async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "autoyt-avatar-composition-"));
    workspaces.push(workspace);
    const sourcePath = path.join(workspace, "source.mp4");
    const avatarPath = path.join(workspace, "avatar.mp4");
    const narrationPath = path.join(workspace, "narration.wav");
    const outputPath = path.join(workspace, "output.mp4");
    const runFfmpeg = vi.fn(async (_args: string[], _timeout?: number) => undefined);

    await composeAvatarRemake({
      sourcePath,
      avatarPath,
      narrationPath,
      outputPath,
      layout: "smart",
      aspectRatio: "9:16",
      durationSeconds: 7,
      scenes: [
        { start: 0, end: 2, role: "split", replaceAvatar: true },
        { start: 2, end: 4, role: "broll", replaceAvatar: false },
        { start: 4, end: 7, role: "talking-head", replaceAvatar: true },
      ],
      runFfmpeg,
    });

    expect(runFfmpeg).toHaveBeenCalledTimes(1);
    const splitArgs = runFfmpeg.mock.calls[0][0] as string[];
    expect(splitArgs).toContain(sourcePath);
    expect(splitArgs).toContain(avatarPath);
    const graph = splitArgs[splitArgs.indexOf("-filter_complex") + 1];
    expect(graph).toContain("overlay=x=0:y=640");
    expect(graph).toContain("enable='gte(t,0)*lt(t,2)'");
    expect(graph).toContain("enable='gte(t,4)*lt(t,7)'");
    expect(graph).not.toContain("gte(t,2)");
    expect(graph).not.toContain("vstack");
    expect(graph).toContain("[2:a]");
    expect(splitArgs).toContain(narrationPath);
    expect(splitArgs).toContain(outputPath);
  });
});
