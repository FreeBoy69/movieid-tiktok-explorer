import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureFile, openBytes, removeFile, restoreFile, saveFile, sealBytes } from "./assetStore.js";

describe("asset store", () => {
  const objects = new Map<string, Buffer>();
  const realFetch = globalThis.fetch;
  let dir = "";
  beforeEach(() => {
    objects.clear();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "asset-store-"));
    process.env.LINGCODE_GATEWAY_URL = "https://gw.test/be/x";
    process.env.LINGCODE_ANON_KEY = "anon";
    process.env.AUTH_SECRET = "test-secret";
    globalThis.fetch = (async (url: string, init: any = {}) => {
      const u = new URL(url);
      if (u.pathname.endsWith("/storage/upload")) {
        const body = JSON.parse(init.body);
        objects.set(body.path, Buffer.from(body.data_b64, "base64"));
        return new Response(JSON.stringify({ ok: true, data: { path: body.path } }));
      }
      if (u.pathname.endsWith("/storage/remove")) {
        objects.delete(JSON.parse(init.body).path);
        return new Response(JSON.stringify({ ok: true, data: { removed: true } }));
      }
      if (u.pathname.endsWith("/storage/object")) {
        const bytes = objects.get(u.searchParams.get("path") || "");
        return bytes ? new Response(bytes) : new Response("{}", { status: 404 });
      }
      return new Response("{}", { status: 404 });
    }) as any;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("encrypts so stored bytes are unreadable without the key", () => {
    const sealed = sealBytes(Buffer.from("secret narration"), "k1");
    expect(sealed.includes(Buffer.from("secret narration"))).toBe(false);
    expect(openBytes(sealed, "k1").toString()).toBe("secret narration");
    expect(() => openBytes(sealed, "k2")).toThrow();
  });

  it("stores a large file as parts and restores it intact", async () => {
    const file = path.join(dir, "render.mp4");
    const bytes = crypto.randomBytes(20 * 1024 * 1024);
    fs.writeFileSync(file, bytes);
    const manifest = await saveFile("creator/p1/render.mp4", file);
    expect(manifest.parts).toBe(3);
    expect([...objects.keys()].some((key) => key.includes("render"))).toBe(false);
    fs.rmSync(file);
    expect(await restoreFile("creator/p1/render.mp4", file)).toBe(true);
    expect(fs.readFileSync(file).equals(bytes)).toBe(true);
  });

  it("replaces old parts on overwrite and restores missing files on demand", async () => {
    const file = path.join(dir, "voice.wav");
    fs.writeFileSync(file, "one");
    await saveFile("creator/p1/voice.wav", file);
    fs.writeFileSync(file, "two");
    await saveFile("creator/p1/voice.wav", file);
    expect(objects.size).toBe(2);
    fs.rmSync(file);
    expect(await ensureFile("creator/p1/voice.wav", file)).toBe(true);
    expect(fs.readFileSync(file, "utf8")).toBe("two");
    expect(await ensureFile("creator/p1/missing.wav", path.join(dir, "missing.wav"))).toBe(false);
    await removeFile("creator/p1/voice.wav");
    expect(objects.size).toBe(0);
  });
});
