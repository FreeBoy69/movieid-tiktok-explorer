import { execFileSync } from "child_process";
import http from "http";
import zlib from "zlib";
import fs from "fs";
import os from "os";
import path from "path";
import express from "express";
import { describe, expect, it } from "vitest";
import { compressJson, loadPackedAssets, packedAssetsMiddleware, pickEncoding, readPack } from "./builtAssets.js";

function packOf(files: Record<string, string>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pack-"));
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);
  // The same command the bundle script runs.
  execFileSync("tar", ["--format=ustar", "-cf", path.join(dir, "assets.pack"), ...Object.keys(files)], { cwd: dir });
  for (const name of Object.keys(files)) fs.rmSync(path.join(dir, name));
  return dir;
}

async function serve(dir: string) {
  const app = express();
  const entries = loadPackedAssets(dir)!;
  app.use("/assets", packedAssetsMiddleware(entries));
  app.use("/assets", (_req, res) => res.status(404).send("Not found"));
  const server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  const port = (server.address() as { port: number }).port;
  return { url: `http://127.0.0.1:${port}`, close: () => server.close() };
}

describe("packed front-end assets", () => {
  it("reads every file back from a ustar pack", () => {
    const dir = packOf({ "index-AbC12_-x.js": "console.log(1)", "VibeEdit-ZzkuV-1k.css": ".a{color:red}" });
    const files = readPack(fs.readFileSync(path.join(dir, "assets.pack")));
    expect([...files.keys()].sort()).toEqual(["VibeEdit-ZzkuV-1k.css", "index-AbC12_-x.js"]);
    expect(files.get("index-AbC12_-x.js")!.toString()).toBe("console.log(1)");
  });

  it("sends scripts and styles Brotli- or gzip-compressed when the browser takes it", async () => {
    const big = `export const data = ${JSON.stringify(Array.from({ length: 400 }, (_, i) => ({ id: i, label: "repeated label text" })))};`;
    const { url, close } = await serve(packOf({ "index-Big12345.js": big }));
    const raw = (encoding: string) =>
      new Promise<{ headers: http.IncomingHttpHeaders; body: Buffer; status: number }>((resolve, reject) => {
        http.get(`${url}/assets/index-Big12345.js`, { headers: encoding ? { "accept-encoding": encoding } : {} }, (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => resolve({ headers: res.headers, body: Buffer.concat(chunks), status: res.statusCode || 0 }));
        }).on("error", reject);
      });
    try {
      const br = await raw("gzip, deflate, br");
      expect(br.headers["content-encoding"]).toBe("br");
      expect(br.headers.vary).toMatch(/Accept-Encoding/);
      expect(br.body.length).toBeLessThan(big.length / 4);
      expect(zlib.brotliDecompressSync(br.body).toString()).toBe(big);
      const gz = await raw("gzip");
      expect(gz.headers["content-encoding"]).toBe("gzip");
      expect(zlib.gunzipSync(gz.body).toString()).toBe(big);
      expect(gz.headers.etag).not.toBe(br.headers.etag);
      const plain = await raw("");
      expect(plain.headers["content-encoding"]).toBeUndefined();
      expect(plain.body.toString()).toBe(big);
    } finally {
      close();
    }
  });

  it("compresses large JSON answers and leaves small ones plain", async () => {
    const app = express();
    app.use(compressJson());
    const rows = Array.from({ length: 600 }, (_, i) => ({ id: i, title: "a channel title" }));
    app.get("/big", (_req, res) => res.status(201).json({ rows }));
    app.get("/small", (_req, res) => res.json({ ok: true }));
    const server = app.listen(0);
    await new Promise((r) => server.once("listening", r));
    const port = (server.address() as { port: number }).port;
    const get = (p: string) => new Promise<{ headers: http.IncomingHttpHeaders; body: Buffer; status: number }>((resolve, reject) => {
      http.get(`http://127.0.0.1:${port}${p}`, { headers: { "accept-encoding": "gzip, br" } }, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve({ headers: res.headers, body: Buffer.concat(chunks), status: res.statusCode || 0 }));
      }).on("error", reject);
    });
    try {
      const big = await get("/big");
      expect(big.status).toBe(201);
      expect(big.headers["content-encoding"]).toBe("br");
      expect(big.headers["content-type"]).toMatch(/application\/json/);
      expect(JSON.parse(zlib.brotliDecompressSync(big.body).toString())).toEqual({ rows });
      const small = await get("/small");
      expect(small.headers["content-encoding"]).toBeUndefined();
      expect(JSON.parse(small.body.toString())).toEqual({ ok: true });
    } finally {
      server.close();
    }
  });

  it("leaves tiny files and already-compressed types alone", () => {
    expect(pickEncoding("br", "a.js", 200)).toBe("");
    expect(pickEncoding("br", "a.woff2", 50000)).toBe("");
    expect(pickEncoding("gzip, br", "a.css", 50000)).toBe("br");
    expect(pickEncoding("gzip", "a.css", 50000)).toBe("gzip");
  });

  it("serves the previous build's files behind this one's, and lists only this build's", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pack-"));
    fs.mkdirSync(path.join(dir, "previous"));
    fs.writeFileSync(path.join(dir, "index-new.js"), "new()");
    fs.writeFileSync(path.join(dir, "Shared-same.js"), "current copy");
    fs.writeFileSync(path.join(dir, "previous", "index-old.js"), "old()");
    fs.writeFileSync(path.join(dir, "previous", "Shared-same.js"), "stale copy");
    execFileSync("tar", ["--format=ustar", "-cf", path.join(dir, "assets.pack"), "index-new.js", "Shared-same.js", "previous/index-old.js", "previous/Shared-same.js"], { cwd: dir });
    const { url, close } = await serve(dir);
    try {
      const text = async (name: string) => { const r = await fetch(`${url}/assets/${name}`); return [r.status, await r.text()] as const; };
      // A tab from before the deploy still gets its script, by its old name.
      expect(await text("index-old.js")).toEqual([200, "old()"]);
      expect(await text("index-new.js")).toEqual([200, "new()"]);
      // This build's copy wins over the kept one.
      expect(await text("Shared-same.js")).toEqual([200, "current copy"]);
      const list = await fetch(`${url}/assets/.list`);
      expect(list.headers.get("cache-control")).toBe("no-store");
      expect((await list.text()).split("\n")).toEqual(["Shared-same.js", "index-new.js"]);
    } finally {
      close();
    }
  });

  it("is absent for a plain local build", () => {
    expect(loadPackedAssets(fs.mkdtempSync(path.join(os.tmpdir(), "nopack-")))).toBeNull();
  });

  it("serves packed files with types, immutable caching, ETags, and 304s; misses fall through", async () => {
    const { url, close } = await serve(packOf({ "index-AbC12_-x.js": "console.log(1)", "page-QwErTy12.css": "body{}" }));
    try {
      const js = await fetch(`${url}/assets/index-AbC12_-x.js`);
      expect(js.status).toBe(200);
      expect(js.headers.get("content-type")).toMatch(/javascript/);
      expect(js.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
      expect(await js.text()).toBe("console.log(1)");
      const css = await fetch(`${url}/assets/page-QwErTy12.css`);
      expect(css.headers.get("content-type")).toMatch(/css/);
      const again = await fetch(`${url}/assets/index-AbC12_-x.js`, { headers: { "if-none-match": js.headers.get("etag")! } });
      expect(again.status).toBe(304);
      expect((await fetch(`${url}/assets/gone-12345678.js`)).status).toBe(404);
    } finally {
      close();
    }
  });

  it("reads a pack split into parts", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "split-pack-"));
    fs.writeFileSync(path.join(dir, "a.js"), "a");
    fs.mkdirSync(path.join(dir, "previous"));
    fs.writeFileSync(path.join(dir, "previous", "b.js"), "b");
    execFileSync("tar", ["--format=ustar", "-cf", path.join(dir, "assets.pack"), "a.js"], { cwd: dir });
    execFileSync("tar", ["--format=ustar", "-cf", path.join(dir, "assets.1.pack"), "previous/b.js"], { cwd: dir });
    const entries = loadPackedAssets(dir)!;
    expect(entries.get("a.js")?.previous).toBe(false);
    expect(entries.get("b.js")?.previous).toBe(true);
  });
});
