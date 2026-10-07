import { describe, expect, it } from "vitest";
import { chapterSegments, lookupFilm, onlineSegments, parseReleaseName, runtimeFits, storyBounds, titleFits, visualSegments } from "./filmBounds.js";

describe("film bounds", () => {
  it("reads title and year from release names and signed links", () => {
    expect(parseReleaseName("Spider-Man.Brand.New.Day.2026.REPACK.1080p.AMZN.WEB-DL.Multi.DDP5.1.AV1-4kHdHub.Com.mkv")).toEqual({ title: "Spider-Man Brand New Day", year: 2026 });
    expect(parseReleaseName("https://x.r2.dev/hub/ab12?response-content-disposition=attachment%3B%20filename%3D%22The.Batman.2022.2160p.mkv%22")).toEqual({ title: "The Batman", year: 2022 });
    expect(parseReleaseName("Fall (2022) 1080p.mp4")).toEqual({ title: "Fall", year: 2022 });
    expect(parseReleaseName("")).toBeNull();
  });

  it("takes the opening and credits from TheIntroDB, re-anchoring credits past the end of this release", async () => {
    const fetch = (async (url: string) => ({
      json: async () => (url.includes("theintrodb") ? { intro: [{ start_ms: 60000, end_ms: 128000 }], credits: [{ start_ms: 8918000, end_ms: 9342000 }] } : {}),
    })) as any;
    const found = await onlineSegments({ tmdbId: 634649, imdbId: "tt10872600" }, 9342, { fetch });
    expect(found).toEqual({ introEnd: 128, creditsStart: 8918, sources: ["opening: TheIntroDB", "credits: TheIntroDB"] });
    // The same database times on a release 8 minutes shorter: the credits keep their length, anchored to the end.
    const shorter = await onlineSegments({ tmdbId: 634649 }, 8880, { fetch });
    expect(shorter!.creditsStart).toBe(8880 - 424);
  });

  it("falls back to IntroDB, chapters, the frames, then fixed guards, rejecting times that can't be right", async () => {
    const fetch = (async (url: string) => ({
      json: async () => (url.includes("theintrodb") ? { intro: [], credits: [] } : { intro: null, outro: { start_sec: 6500, end_sec: 7000 } }),
    })) as any;
    const online = await onlineSegments({ tmdbId: 1, imdbId: "tt1" }, 7000, { fetch });
    expect(online!.creditsStart).toBe(6500);
    expect(storyBounds(7000, { online })).toMatchObject({ start: 70, end: 6498, from: { start: "estimate", end: "IntroDB" } });
    const chapters = chapterSegments([{ start: 0, end: 95, title: "Opening Credits" }, { start: 6400, end: 7000, title: "End Credits" }], 7000);
    expect(storyBounds(7000, { chapters })).toMatchObject({ start: 97, end: 6398, from: { start: "chapters", end: "chapters" } });
    // Credits in the first half or an opening an hour long are ignored.
    expect(storyBounds(7000, { online: { introEnd: 3600, creditsStart: 1000, sources: [] } }).from).toEqual({ start: "estimate", end: "estimate" });
  });

  it("finds the opening titles and the credit roll in the frame tags", () => {
    const duration = 3000;
    const shots = Array.from({ length: 1000 }, (_, i) => ({ i, t: 1.5 + i * 3 }));
    const described: Record<string, any> = {};
    for (const shot of shots) {
      described[shot.i] = "x";
      const credits = shot.t > 2700;
      const titles = shot.t < 40;
      described[`tag:${shot.i}`] = { s: credits || titles ? "none" : "medium", a: true, t: credits || titles, k: false };
    }
    const seen = visualSegments({ duration, shotEvery: 3, shots } as any, described);
    expect(seen.introEnd).toBeGreaterThan(38);
    expect(seen.introEnd).toBeLessThan(42);
    expect(seen.creditsStart).toBeGreaterThan(2699);
    expect(seen.creditsStart).toBeLessThan(2705);
  });
});

describe("credits with a post-credits scene", () => {
  it("steps over a short scene after the credits and ignores a stray dark frame in the story", () => {
    const duration = 3000;
    const shots = Array.from({ length: 1000 }, (_, i) => ({ i, t: 1.5 + i * 3 }));
    const described: Record<string, any> = {};
    for (const shot of shots) {
      described[shot.i] = "x";
      const credits = shot.t > 2600 && shot.t < 2900; // credits, then a 100 s post-credits scene
      const stray = Math.abs(shot.t - 2500.5) < 1; // one black frame in the story
      described[`tag:${shot.i}`] = { s: credits ? "none" : "medium", a: true, t: credits, k: stray };
    }
    const seen = visualSegments({ duration, shotEvery: 3, shots } as any, described);
    expect(seen.creditsStart).toBeGreaterThan(2600);
    expect(seen.creditsStart).toBeLessThan(2605);
  });
});

describe("naming the film", () => {
  it("never takes a file host or a share id for a title", () => {
    expect(parseReleaseName("mega.nz")).toBeNull();
    expect(parseReleaseName("https://mega.nz/file/YE0R3TLK#lneE5omfr_7YCcNmJoMeUSnw3Tz5CpxV5Tu3UJepuQ0")).toBeNull();
    expect(parseReleaseName("pixeldrain.com")).toBeNull();
    expect(parseReleaseName("Fall.2.Deadpoint.2026.1080p.WEB-DL.mkv")).toEqual({ title: "Fall 2 Deadpoint", year: 2026 });
    expect(parseReleaseName("Se7en 1995")).toEqual({ title: "Se7en", year: 1995 });
  });

  it("only accepts a TMDB title that carries the name", () => {
    expect(titleFits("mega", "Mega Cyclone")).toBe(false);
    expect(titleFits("Fall 2", "Fall 2: Deadpoint")).toBe(true);
    expect(titleFits("Fall", "The Fall Guy")).toBe(false);
    expect(titleFits("Spider-Man Brand New Day", "Spider-Man: Brand New Day")).toBe(true);
    expect(runtimeFits(98, 5872)).toBe(true);
    expect(runtimeFits(150, 5872)).toBe(false);
    expect(runtimeFits(null, 5872)).toBe(true);
  });

  it("skips TMDB hits whose name or runtime doesn't fit", async () => {
    const films: Record<string, any> = { 105485: { title: "Mega Cyclone", runtime: 90, release_date: "2011-12-29" }, 1101412: { title: "Fall 2: Deadpoint", runtime: 98, release_date: "2026-09-01", imdb_id: "tt1" }, 985939: { title: "Fall", runtime: 107, release_date: "2022-08-11" } };
    const search: Record<string, any[]> = { mega: [{ id: 105485, title: "Mega Cyclone" }], "fall 2": [{ id: 1101412, title: "Fall 2: Deadpoint" }], fall: [{ id: 985939, title: "Fall" }] };
    const fetch = async (url: URL) => {
      const u = new URL(String(url));
      const body = u.pathname.endsWith("search/movie") ? { results: search[u.searchParams.get("query")!.toLowerCase()] || [] } : films[u.pathname.split("/").pop()!];
      return new Response(JSON.stringify(body));
    };
    const env = { TMDB_API_KEY: "k" } as any;
    expect(await lookupFilm({ title: "mega", year: null }, { fetch: fetch as any, env })).toBeNull();
    expect((await lookupFilm({ title: "Fall 2", year: null }, { fetch: fetch as any, env, duration: 5872 }))?.tmdbId).toBe(1101412);
    // The first Fall runs 107 minutes, too long for a 70-minute file.
    expect(await lookupFilm({ title: "Fall", year: null }, { fetch: fetch as any, env, duration: 4200 })).toBeNull();
  });
});

describe("opening credits and film identity", () => {
  it("runs the opening to the last title card when credits play over the first scene", () => {
    // Shots every 3 s; title cards between story shots up to 2:10, then story only.
    const shots = Array.from({ length: 200 }, (_, i) => ({ i, t: 1.5 + i * 3 }));
    const described: Record<string, any> = {};
    for (const shot of shots) {
      described[shot.i] = "frame";
      const credit = shot.t > 20 && shot.t < 131 && shot.i % 4 === 0;
      described[`tag:${shot.i}`] = { s: "medium", a: true, t: credit, u: false, k: false, g: false, e: false };
    }
    const { introEnd } = visualSegments({ duration: 6000, shotEvery: 3, shots } as any, described);
    expect(introEnd).toBeGreaterThan(121.5);
    expect(introEnd).toBeLessThan(130);
  });

  it("hears a film's characters only as names, not as everyday words", async () => {
    const { charactersHeard } = await import("./filmBounds.js");
    const lines = Array.from({ length: 100 }, (_, i) => ({ start: i, text: i % 10 === 0 ? `Did you see what Shiloh did, Jax?` : `We will climb it, and it will be fine. Then Bob said ${["Go", "Stop", "Run", "Hold", "Wait"][i % 5]} now.` }));
    expect(charactersHeard(["jax", "hunter", "shiloh"], lines)).toBe(true);
    // Mega Cyclone's people: "will" is said all the time, but never as a name.
    expect(charactersHeard(["jason", "will", "andrea", "megan"], lines)).toBe(false);
  });
});
