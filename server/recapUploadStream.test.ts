import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// An in-memory stand-in for the backend's object storage (upload, object, remove).
function fakeStorage() {
  const objects = new Map<string, Buffer>();
  const fetchImpl = vi.fn(async (url: string, init: any = {}) => {
    const route = new URL(url).pathname.replace(/^.*\/be\/test/, "");
    if (route === "/storage/upload") {
      const body = JSON.parse(init.body);
      objects.set(body.path, Buffer.from(body.data_b64, "base64"));
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    if (route === "/storage/remove") {
      objects.delete(JSON.parse(init.body).path);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    if (route === "/storage/object") {
      const name = new URL(url).searchParams.get("path") || "";
      return objects.has(name) ? new Response(objects.get(name)) : new Response("", { status: 404 });
    }
    return new Response("{}", { status: 404 });
  });
  return { objects, fetchImpl };
}

describe("streamed uploads", () => {
  let storage: ReturnType<typeof fakeStorage>;
  beforeEach(() => {
    storage = fakeStorage();
    vi.stubGlobal("fetch", storage.fetchImpl);
    vi.stubEnv("LINGCODE_GATEWAY_URL", "https://store.test/be/test");
    vi.stubEnv("LINGCODE_ANON_KEY", "anon");
    vi.stubEnv("AUTH_SECRET", "secret");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("stores a stream in parts and reads any range back", async () => {
    const { saveStream, readStoredRange, storedSize } = await import("./assetStore.js");
    // 20 MB across three 8 MB parts, sent in odd-sized chunks.
    const file = Buffer.alloc(20 * 1024 * 1024);
    for (let i = 0; i < file.length; i += 4096) file.writeUInt32LE(i, i);
    const chunks = [];
    for (let i = 0; i < file.length; i += 777_777) chunks.push(file.subarray(i, i + 777_777));
    const manifest = await saveStream("recaps/u/rcp/source.mp4", Readable.from(chunks));
    expect(manifest).toMatchObject({ bytes: file.length, parts: 3 });
    expect(await storedSize("recaps/u/rcp/source.mp4")).toBe(file.length);
    const read = async (start: number, end: number) => {
      const out = [];
      for await (const part of readStoredRange("recaps/u/rcp/source.mp4", start, end)) out.push(part);
      return Buffer.concat(out);
    };
    expect((await read(0, Infinity)).equals(file)).toBe(true);
    // A range that crosses a part boundary.
    const at = 8 * 1024 * 1024 - 10;
    expect((await read(at, at + 99)).equals(file.subarray(at, at + 100))).toBe(true);
    // Nothing in storage is readable without the key.
    expect([...storage.objects.values()].some((bytes) => bytes.includes(file.subarray(4096, 4200)))).toBe(false);
  });

  it("refuses a stream over the limit and removes what it stored", async () => {
    const { saveStream } = await import("./assetStore.js");
    const big = Readable.from([Buffer.alloc(9 * 1024 * 1024), Buffer.alloc(2 * 1024 * 1024)]);
    await expect(saveStream("recaps/u/rcp/source.mp4", big, { maxBytes: 10 * 1024 * 1024 })).rejects.toMatchObject({ statusCode: 413 });
    expect(storage.objects.size).toBe(0);
  });
});

describe("signed upload links", () => {
  beforeEach(() => vi.stubEnv("AUTH_SECRET", "secret"));
  afterEach(() => vi.unstubAllEnvs());

  it("lets the media worker fetch one upload for a limited time", async () => {
    const { signedSourceUrl, readSourceToken } = await import("./movieRecap.js");
    const url = signedSourceUrl("usr_1", "rcp_0123456789abcdef01234567", "source.mp4", { base: "https://autoyt.cc", now: 1_000_000 });
    const token = url.split("/api/recaps/source/")[1].split("/")[0];
    expect(readSourceToken(token, 1_000_000)).toMatchObject({ i: "rcp_0123456789abcdef01234567", f: "source.mp4" });
    expect(readSourceToken(token, 1_000_000 + 13 * 3600 * 1000)).toBeNull();
    // A changed token isn't accepted.
    const [body, mac] = token.split(".");
    expect(readSourceToken(`${body.slice(0, -2)}xx.${mac}`, 1_000_000)).toBeNull();
  });
});
