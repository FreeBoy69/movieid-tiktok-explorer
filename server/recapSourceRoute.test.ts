import crypto from "node:crypto";
import express from "express";
import { createServer } from "node:http";
import { Readable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

describe("the upload link the media worker downloads from", () => {
  const objects = new Map<string, Buffer>();
  const realFetch = globalThis.fetch;
  let base = "";
  let server: ReturnType<typeof createServer>;
  const file = Buffer.alloc(9 * 1024 * 1024 + 123);
  for (let i = 0; i < file.length; i += 4096) file.writeUInt32LE(i, i);

  beforeAll(async () => {
    vi.stubEnv("LINGCODE_GATEWAY_URL", "https://store.test/be/test");
    vi.stubEnv("LINGCODE_ANON_KEY", "anon");
    vi.stubEnv("AUTH_SECRET", "secret");
    // Storage calls go to an in-memory store; requests to the local server go through.
    vi.stubGlobal("fetch", async (url: string, init: any = {}) => {
      if (!String(url).startsWith("https://store.test")) return realFetch(url, init);
      const parsed = new URL(url);
      const route = parsed.pathname.replace("/be/test", "");
      if (route === "/storage/upload") {
        const body = JSON.parse(init.body);
        objects.set(body.path, Buffer.from(body.data_b64, "base64"));
        return new Response('{"ok":true}');
      }
      const name = parsed.searchParams.get("path") || "";
      return objects.has(name) ? new Response(objects.get(name)) : new Response("", { status: 404 });
    });
    const { saveStream } = await import("./assetStore.js");
    const { registerMovieRecap, configureMovieRecap } = await import("./movieRecap.js");
    // Stored where an upload by user "u" goes: recaps/<sha256(user id), 24 hex>/<recap>/source.mp4.
    const userKey = crypto.createHash("sha256").update("u").digest("hex").slice(0, 24);
    await saveStream(`recaps/${userKey}/rcp_0123456789abcdef01234567/source.mp4`, Readable.from([file]));
    configureMovieRecap({ session: async () => null });
    const app = express();
    registerMovieRecap(app);
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    base = `http://127.0.0.1:${(server.address() as any).port}`;
  });
  afterAll(() => {
    server?.close();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("serves HEAD, ranges and the whole file, and refuses a forged link", async () => {
    const { signedSourceUrl } = await import("./movieRecap.js");
    const url = signedSourceUrl("u", "rcp_0123456789abcdef01234567", "source.mp4", { base });

    const head = await fetch(url, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.headers.get("content-length")).toBe(String(file.length));
    expect(head.headers.get("accept-ranges")).toBe("bytes");

    const at = 8 * 1024 * 1024 - 5;
    const part = await fetch(url, { headers: { Range: `bytes=${at}-${at + 9}` } });
    expect(part.status).toBe(206);
    expect(Buffer.from(await part.arrayBuffer()).equals(file.subarray(at, at + 10))).toBe(true);

    const whole = await fetch(url);
    expect(Buffer.from(await whole.arrayBuffer()).equals(file)).toBe(true);

    const forged = url.replace(/source\/([^.]+)\./, (_m, token) => `source/${token.slice(0, -1)}A.`);
    expect((await fetch(forged)).status).toBe(403);
  });
});
