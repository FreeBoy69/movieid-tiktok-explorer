import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FILM_ASSET, filmRenderRequest, graphicMarkers, keepPinned, onRenderedPicture, storyboardBeat, pictureOffsets, prepareRecapExport, summaryBatches, withFilm } from "./movieRecap.js";

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


describe("recap motion graphics in an edit", () => {
  // The title over the first cut, a name card over the second (Peter at film 95.3 + 0.5), subscribe over the third.
  const graphics = { events: [{ type: "title", start: 0.4, label: "Spider-Man" }, { type: "name", start: 3, label: "Peter Parker" }, { type: "subscribe", start: 5, label: "" }] };
  const withGraphics = { ...project, graphics };
  const filmDoc = () => withFilm(pictureDoc(), withGraphics, proxy, [{}, {}, {}]);

  it("marks where the title, name cards, and subscribe graphic go, once", () => {
    const doc = filmDoc();
    expect(doc.markers.map((m: any) => [m.time, m.label, m.graphic.type, m.graphic.row])).toEqual([[0.4, "Title card", "title", 0], [3, "Name card: Peter Parker", "name", 0], [5, "Subscribe", "subscribe", 0]]);
    // The name card remembers the film second under it: cut1 starts at film 95.3 at timeline 2.5.
    expect(doc.markers[1].graphic.source).toBeCloseTo(95.8, 3);
    expect(doc.source.graphics).toBe(true);
    // Moving the edit onto the film again doesn't bring back a marker the editor deleted.
    const trimmed = { ...doc, markers: doc.markers.filter((m: any) => m.graphic.type !== "subscribe") };
    expect(withFilm(trimmed, withGraphics, proxy).markers.filter((m: any) => m.graphic)).toHaveLength(2);
  });

  it("numbers rows per template in the plan's order, as the worker's batch files do", () => {
    expect(summaryBatches([{ type: "name", start: 9 }, { type: "title", start: 1 }, { type: "name", start: 4 }])).toEqual([{ type: "name", events: [{ start: 9 }, { start: 4 }] }, { type: "title", events: [{ start: 1 }] }]);
    expect(graphicMarkers([], [{ type: "name", events: [{ start: 9 }, { start: 4 }] }], [{ type: "name", label: "A" }, { type: "name", label: "B" }]).map((m: any) => [m.label, m.graphic.row])).toEqual([["Name card: B", 1], ["Name card: A", 0]]);
  });

  it("sends kept graphics at their place in the rendered picture, dropping a name card whose shot changed", () => {
    const doc = filmDoc();
    const request = filmRenderRequest(doc);
    expect(request.graphics).toEqual([
      { type: "title", events: [{ row: 0, start: 0.4 }] },
      { type: "name", events: [{ row: 0, start: request.map[1].offset + 0.5 }] },
      { type: "subscribe", events: [{ row: 0, start: request.map[2] ? request.map[2].offset + 0.2 : 5 }] },
    ].filter((b) => b.type !== "subscribe" || request.map[2]));
    // A different shot under the name card: the card would name someone who isn't there, so it's left out.
    const swapped = { ...doc, clips: doc.clips.map((c: any) => (c.id === "cut1" ? { ...c, in: 2000, out: 2002.3 } : c)) };
    const changed = filmRenderRequest(swapped);
    expect(changed.graphics?.some((b: any) => b.type === "name")).toBe(false);
    expect(changed.name).not.toBe(request.name);
    // A deleted marker leaves its graphic out.
    const noTitle = filmRenderRequest({ ...doc, markers: doc.markers.filter((m: any) => m.graphic.type !== "title") });
    expect(noTitle.graphics?.some((b: any) => b.type === "title")).toBe(false);
  });

  it("gives an edit from before the markers its graphics on export, and hands them to the worker", async () => {
    const doc = withFilm(pictureDoc(), project, proxy, [{}, {}, {}]);
    const older = { ...doc, markers: [], source: { ...doc.source, graphics: undefined } };
    const calls: string[][] = [];
    const run = async (args: string[]) => {
      calls.push(args);
      if (args[0] === "picture-status") return calls.length > 2 ? { state: "done", path: "rcp_film1/edit-2.mp4", duration: 4.8 } : { state: "missing" };
      return { started: true };
    };
    const ready = await prepareRecapExport({ userId: "u1", controller: new AbortController() } as any, older, () => {}, { loadRecap: async () => withGraphics, run, wait: async () => {} });
    const options = JSON.parse(calls[1][calls[1].indexOf("--options") + 1]);
    expect(options.graphics.map((b: any) => b.type)).toEqual(["title", "name"]);
    expect(ready.markers.filter((m: any) => m.graphic)).toHaveLength(3);
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
    const media = fs.mkdtempSync(path.join(os.tmpdir(), "recap-media-"));
    execFileSync(python, ["-c", `import importlib.util,sys;spec=importlib.util.spec_from_file_location("m",${JSON.stringify(script)});m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);m.sweep_old()`], { env: { ...process.env, MOVIE_RECAP_DIR: root, MOVIE_RECAP_MEDIA: media } });
    expect(fs.readdirSync(root).sort()).toEqual(["rcp_edited0001", "rcp_fresh00001"]);
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(media, { recursive: true, force: true });
  });

  it("removes media made from a film once its job is gone and the editing window has passed, never finished recaps", () => {
    let python = "python3";
    try {
      execFileSync(python, ["--version"]);
    } catch {
      return;
    }
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "recap-jobs-"));
    const media = fs.mkdtempSync(path.join(os.tmpdir(), "recap-media-"));
    const day = 86400;
    const file = (folder: string, name: string, ageDays: number) => {
      fs.mkdirSync(path.join(media, folder), { recursive: true });
      const full = path.join(media, folder, name);
      fs.writeFileSync(full, "x");
      const t = Date.now() / 1000 - ageDays * day;
      fs.utimesSync(full, t, t);
    };
    // Job gone, files old: the derived ones go, the finished recap and its picture track stay.
    for (const name of ["film-proxy.mp4", "edit-abc123.mp4", "recut-abc123.mp4", "film-proxy.mp4.part.mp4", "recap-long.mp4", "picture-long.mp4", "narration-long.m4a"]) file("rcp_gone000001", name, 20);
    // Job gone, files recent: kept for the editing window.
    file("rcp_recent0001", "film-proxy.mp4", 3);
    // Job still there: its media stays whatever its age.
    fs.mkdirSync(path.join(root, "rcp_alive00001"));
    file("rcp_alive00001", "film-proxy.mp4", 30);
    const script = path.resolve("scripts/movie_recap.py");
    execFileSync(python, ["-c", `import importlib.util,sys;spec=importlib.util.spec_from_file_location("m",${JSON.stringify(script)});m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);m.sweep_media()`], { env: { ...process.env, MOVIE_RECAP_DIR: root, MOVIE_RECAP_MEDIA: media } });
    expect(fs.readdirSync(path.join(media, "rcp_gone000001")).sort()).toEqual(["narration-long.m4a", "picture-long.mp4", "recap-long.mp4"]);
    expect(fs.readdirSync(path.join(media, "rcp_recent0001"))).toEqual(["film-proxy.mp4"]);
    expect(fs.readdirSync(path.join(media, "rcp_alive00001"))).toEqual(["film-proxy.mp4"]);
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(media, { recursive: true, force: true });
  });

  it("keeps only an edit's graphics rows, at their picture times", () => {
    let python = "python3";
    try {
      execFileSync(python, ["--version"]);
    } catch {
      return;
    }
    const work = fs.mkdtempSync(path.join(os.tmpdir(), "recap-gfx-"));
    const source = path.join(work, "src");
    fs.mkdirSync(source);
    fs.writeFileSync(path.join(source, "name.html"), "<html></html>");
    fs.writeFileSync(path.join(source, "name.json"), JSON.stringify([{ name: "Peter" }, { name: "May" }, { name: "Bruce" }]));
    const script = path.resolve("scripts/movie_recap.py");
    const out = execFileSync(python, ["-c", `import importlib.util,json;spec=importlib.util.spec_from_file_location("m",${JSON.stringify(script)});m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);d,b=m.edit_graphics([{"type":"name","events":[{"row":2,"start":1.5},{"row":0,"start":9}]},{"type":"title","events":[{"row":0,"start":0}]}],${JSON.stringify(source)},${JSON.stringify(work)});print(json.dumps({"dir":d,"batches":b,"rows":json.load(open(d+"/graphics/name.json"))}))`]).toString();
    const result = JSON.parse(out);
    expect(result.batches).toEqual([{ type: "name", events: [{ start: 1.5 }, { start: 9 }] }]);
    expect(result.rows).toEqual([{ name: "Bruce" }, { name: "Peter" }]);
    fs.rmSync(work, { recursive: true, force: true });
  });
});
