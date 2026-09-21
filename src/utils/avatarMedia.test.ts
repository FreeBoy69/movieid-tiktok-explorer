import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { publishAvatarMedia, resolveAvatarMedia } from "./avatarMedia.js";

it("limits provider media access to an unguessable expiring token", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "avatar-media-"));
  try {
    const input = path.join(root, "input.mp3");
    fs.writeFileSync(input, "test audio");
    const store = path.join(root, "private");
    const now = Date.now();
    expect(() => publishAvatarMedia(input, store, "http://localhost")).toThrow(/HTTPS/);
    const url = publishAvatarMedia(input, store, "https://example.com", now);
    const token = new URL(url).pathname.split("/").at(-1)!;
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    expect(fs.readFileSync(resolveAvatarMedia(token, store, now)!, "utf8")).toBe("test audio");
    expect(resolveAvatarMedia(token, store, now + 7200001)).toBeNull();
    expect(resolveAvatarMedia("../input", store, now)).toBeNull();
    expect(resolveAvatarMedia("0".repeat(64), store, now)).toBeNull();
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
