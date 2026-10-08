import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import express from "express";
import { describe, expect, it } from "vitest";
import { loadPackedAssets, packedAssetsMiddleware, readPack } from "./builtAssets.js";

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
});
