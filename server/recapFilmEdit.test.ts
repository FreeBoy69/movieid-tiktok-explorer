import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FILM_ASSET, filmRenderRequest, keepPinned, onRenderedPicture, storyboardBeat, pictureOffsets, prepareRecapExport, withFilm } from "./movieRecap.js";

const project = {
  id: "rcp_film1",
  title: "Spider-Man",
  options: { transforms: { zoomPct: 10 }, formats: ["long"] },
  film: { duration: 8700, shotEvery: 3, sheet: { cols: 4, rows: 3, count: 242 } },
};
const pictureDoc = () => ({
  version: 1, id: "vp_a", name: "Recap", aspect: "16:9", background: "#000",
  source: { kind: "recap", recapId: "rcp_film1", format: "long" },
  assets: [{ id: "recap_picture", kind: "video", name: "Recap cuts", url: "/p", file: "", remote: "rcp_film1/picture-long.mp4", duration: 7.5 }],
  clips: [
    { id: "cut0", assetId: "recap_picture", track: 0, start: 0, in: 0, out: 2.5, match: { film: 299 } },
    { id: "cut1", assetId: "recap_picture", track: 0, start: 2.5, in: 2.5, out: 4.8, match: { film: 95.3 } },
    { id: "cut2", assetId: "recap_picture", track: 0, start: 4.8, in: 4.8, out: 7.5 },
  ],
  audio: [], texts: [], captions: { cues: [], show: true }, createdAt: 1, updatedAt: 1,
});
const proxy = { state: "done", path: "rcp_film1/film-proxy.mp4", duration: 8700, width: 854, height: 356 };

describe("recap edits on the film", () => {
  it("moves every cut that knows its film time onto the film, with its look, muted", () => {
    const doc = withFilm(pictureDoc(), project, proxy, [{ flip: false }, { flip: true, bw: true }, {}]);
    const film = doc.assets.find((a: any) => a.id === FILM_ASSET);
    expect(film).toMatchObject({ kind: "video", url: "/api/recaps/rcp_film1/media/film-proxy.mp4", remote: "rcp_film1/film-proxy.mp4", duration: 8700, width: 854, height: 356 });
    expect(film.film.sheets).toEqual({ base: "/api/recaps/rcp_film1/sheets/", every: 3, cols: 4, rows: 3 });
    // In/out are film seconds, so a trim reaches more of the film; the timeline place and length don't change.
    expect(doc.clips[0]).toMatchObject({ assetId: FILM_ASSET, start: 0, in: 299, out: 301.5, muted: true, look: { seed: 0 } });
    expect(doc.clips[1]).toMatchObject({ assetId: FILM_ASSET, start: 2.5, in: 95.3, out: 97.6, look: { flip: true, bw: true, seed: 1 } });
    // A cut without a film time stays on the cut picture.
    expect(doc.clips[2].assetId).toBe("recap_picture");
    expect(doc.source).toMatchObject({ kind: "recap", film: true, zoom: 1.1 });
  });

  it("asks the worker for the film clips in timeline order, and puts each back where it sits in the picture", () => {
    const doc = withFilm(pictureDoc(), project, proxy, [{}, { flip: true }]);
    doc.clips.push({ id: "c9", assetId: FILM_ASSET, track: 1, start: 1, in: 500, out: 501.2, muted: true });
    const request = filmRenderRequest(doc);
    expect(request.cuts).toEqual([{ start: 299, end: 301.5, seed: 0 }, { start: 95.3, end: 97.6, flip: true, seed: 1 }, { start: 500, end: 501.2 }]);
    expect(request.map.map((m: any) => m.id)).toEqual(["cut0", "cut1", "c9"]);
    expect(request.map.map((m: any) => m.offset)).toEqual(pictureOffsets([2.5, 2.3, 1.2]));
    // The same edit renders under the same name, so exporting it again reuses the render.
    expect(filmRenderRequest(doc).name).toBe(request.name);
    expect(request.name).toMatch(/^edit-[a-f0-9]{16}$/);
    const done = onRenderedPicture(doc, request, { remote: "rcp_film1/x.mp4", url: "/x", duration: 6 });
    const moved = done.clips.find((c: any) => c.id === "cut1");
    expect(moved).toMatchObject({ assetId: "recap_edit_picture", start: 2.5, in: request.map[1].offset });
    expect(moved.look).toBeUndefined();
    expect(done.clips.find((c: any) => c.id === "c9")).toMatchObject({ track: 1, start: 1 });
  });

  it("exports a film edit by cutting it from the original film first, reusing an earlier render", async () => {
    const doc = withFilm(pictureDoc(), project, proxy);
    const calls: string[][] = [];
    let polls = 0;
    const run = async (args: string[]) => {
      calls.push(args);
      if (args[0] === "picture-status") return polls++ === 0 ? { state: "missing" } : polls < 3 ? { state: "running", progress: 0.5 } : { state: "done", path: "rcp_film1/edit-1.mp4", duration: 4.8 };
      if (args[0] === "start-picture") return { started: true };
      return {};
    };
    const job = { userId: "u1", controller: new AbortController() } as any;
    const steps: number[] = [];
    const ready = await prepareRecapExport(job, doc, (v: number) => steps.push(v), { loadRecap: async () => project, run, wait: async () => {} });
    expect(calls.map((c) => c[0])).toEqual(["picture-status", "start-picture", "picture-status", "picture-status"]);
    expect(JSON.parse(calls[1][calls[1].indexOf("--options") + 1]).cuts).toHaveLength(2);
    expect(ready.assets.some((a: any) => a.id === "recap_edit_picture" && a.remote === "rcp_film1/edit-1.mp4")).toBe(true);
    expect(ready.clips.filter((c: any) => c.assetId === FILM_ASSET)).toHaveLength(0);
    expect(steps.at(-1)).toBe(1);
    // Rendered before: reused straight away.
    const again: string[] = [];
    await prepareRecapExport(job, doc, () => {}, { loadRecap: async () => project, run: async (args: string[]) => { again.push(args[0]); return { state: "done", path: "rcp_film1/edit-1.mp4", duration: 4.8 }; }, wait: async () => {} });
    expect(again).toEqual(["picture-status"]);
  });

  it("exports from the editing copy, with a warning, when the original film is gone", async () => {
    const doc = withFilm(pictureDoc(), project, proxy);
    const job = { userId: "u1", controller: new AbortController() } as any;
    const run = async (args: string[]) => {
      if (args[0] === "picture-status") return { state: "missing" };
      throw new Error("The film is no longer on the media worker.");
    };
    const ready = await prepareRecapExport(job, doc, () => {}, { loadRecap: async () => project, run, wait: async () => {} });
    expect(ready).toBe(doc);
    expect(job.warning).toMatch(/editing copy/);
  });

  it("leaves edits that aren't on a film alone", async () => {
    const doc = pictureDoc();
    expect(await prepareRecapExport({ userId: "u", controller: new AbortController() } as any, doc, () => {}, { loadRecap: async () => { throw new Error("no"); } })).toBe(doc);
  });

  it("saves a stretch resized on the storyboard as pinned, and leaves untouched lines unpinned", () => {
    const prior = { id: "a", text: "Peter tinkers", from: 95, to: 142, shots: [31], placed: true };
    expect(storyboardBeat({ id: "a", text: "Peter tinkers", from: 95, to: 118 }, prior, 8700)).toMatchObject({ from: 95, to: 118, pinned: true, shots: [31] });
    expect(storyboardBeat({ id: "a", text: "Peter tinkers again", from: 95, to: 142 }, prior, 8700)).toEqual({ id: "a", text: "Peter tinkers again", from: 95, to: 142, shots: [31], placed: true });
    expect(storyboardBeat({ id: "a", text: "x", from: 95, to: 96 }, prior, 8700)).toMatchObject({ to: 98 });
    expect((storyboardBeat({ id: "a", text: "x", from: 100, to: 120, pinned: false }, { ...prior, pinned: true }, 8700) as any).pinned).toBeUndefined();
  });

  it("keeps the stretches set by hand on the storyboard when the lines are placed again", () => {
    const before = { long: { beats: [{ id: "a", text: "x", from: 95, to: 120, pinned: true }, { id: "b", text: "y", from: 120, to: 160 }] } };
    const placed = { long: { beats: [{ id: "a", text: "x", from: 90, to: 140, placed: true }, { id: "b", text: "y", from: 140, to: 190, placed: true }] } };
    const kept = keepPinned(before, placed);
    expect(kept.long.beats[0]).toMatchObject({ from: 95, to: 120, pinned: true });
    expect(kept.long.beats[1]).toMatchObject({ from: 140, to: 190 });
  });
});

describe("the worker keeps an edited recap's film longer", () => {
  it("sweeps idle jobs after 4 days, edited ones after 14", () => {
    let python = "python3";
    try {
      execFileSync(python, ["--version"]);
    } catch {
      return; // no Python here: the worker's own check runs where it does
    }
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "recap-sweep-"));
    const day = 86400;
    const make = (name: string, ageDays: number, editing = false) => {
      const dir = path.join(root, name);
      fs.mkdirSync(dir);
      if (editing) fs.writeFileSync(path.join(dir, "editing"), "1");
      const t = Date.now() / 1000 - ageDays * day;
      fs.utimesSync(dir, t, t);
    };
    make("rcp_idle00001", 5);
    make("rcp_edited0001", 5, true);
    make("rcp_edited0002", 15, true);
    make("rcp_fresh00001", 1);
    const script = path.resolve("scripts/movie_recap.py");
    execFileSync(python, ["-c", `import importlib.util,sys;spec=importlib.util.spec_from_file_location("m",${JSON.stringify(script)});m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);m.sweep_old()`], { env: { ...process.env, MOVIE_RECAP_DIR: root } });
    expect(fs.readdirSync(root).sort()).toEqual(["rcp_edited0001", "rcp_fresh00001"]);
    fs.rmSync(root, { recursive: true, force: true });
  });
});
