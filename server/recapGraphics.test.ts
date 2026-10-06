import { describe, expect, it } from "vitest";
import { GRAPHIC_TEMPLATES, graphicsBatches, nameMatch, planRecapGraphics } from "./recapGraphics.js";
import { movieInfo } from "./movieInfo.js";

const lines = [
  "Hi, welcome to Unicorn Recaps. A hero the whole world forgot",
  "This is the 2026 movie Spider-Man: Brand New Day.",
  "Peter Parker wakes up in a tiny apartment and",
  "Detective DeWolfe calls him to a smoking crime scene.",
  "Jean steps out of the shadows.",
  "Yelena Belova waits inside a secluded bathhouse.",
  "The final battle tears the bridge apart.",
  "Thank you for watching. If you enjoyed it,",
  "like and subscribe, and tell us what you thought.",
  "Until next time, take care.",
];
const captions = lines.map((text, i) => ({ start: i * 4, end: i * 4 + 3.8, text }));
const movie = {
  title: "Spider-Man: Brand New Day", year: 2026, genres: ["Science Fiction", "Action"], runtime: 145, rating: 8.1, poster: "https://x/p.jpg",
  characters: [
    { name: "Peter Parker", alias: "Spider-Man" }, { name: "Jean Grey", alias: "" }, { name: "Yelena Belova", alias: "Black Widow" }, { name: "Detective Jean DeWolff", alias: "" },
  ],
};

describe("recap motion graphics", () => {
  it("lands the title card, names, and subscribe moment on the words that call for them", () => {
    const plan = planRecapGraphics({ captions, duration: 40, movie, channelName: "Unicorn Recaps" });
    const byType = (type: string) => plan.events.filter((e) => e.type === type);
    expect(byType("title")).toHaveLength(1);
    expect(byType("title")[0].start).toBe(4);
    expect(byType("title")[0].vars).toMatchObject({ title: "Spider-Man: Brand New Day", meta: "2026  ·  Science Fiction, Action  ·  2h 25m", rating: "★ 8.1", poster: "poster.jpg" });
    const names = byType("name").map((e) => e.vars.name);
    // DeWolfe matches DeWolff; "Jean" alone is shared by two characters, so it introduces nobody.
    expect(names).toEqual(["Peter Parker", "Detective Jean DeWolff", "Yelena Belova"]);
    expect(byType("subscribe")[0].start).toBeCloseTo(31.7, 1);
    expect(plan.watermark).toBe("Unicorn Recaps");
    for (const e of plan.events) for (const o of plan.events) if (e !== o) expect(e.start >= o.end || e.end <= o.start).toBe(true);
  });

  it("matches names spelled by sound, and batches each template's moments", () => {
    expect(nameMatch("dewolfe", "dewolff")).toBe(true);
    expect(nameMatch("ned", "neb")).toBe(false);
    const plan = planRecapGraphics({ captions, duration: 40, movie, channelName: "U" });
    const batches = graphicsBatches(plan);
    expect(batches.map((b) => b.type).sort()).toEqual(["name", "subscribe", "title"]);
    for (const batch of batches) {
      expect(batch.rows).toHaveLength(batch.events.length);
      expect(GRAPHIC_TEMPLATES[batch.type as keyof typeof GRAPHIC_TEMPLATES]).toContain('data-composition-id="root"');
    }
  });

  it("reads characters, poster, and rating from TMDB", async () => {
    const fetch = (async () => ({
      ok: true,
      json: async () => ({ id: 1, title: "Film", release_date: "2026-07-29", runtime: 145, tagline: "T", genres: [{ name: "Action" }], vote_average: 8.128, vote_count: 3646, poster_path: "/p.jpg", imdb_id: "tt1",
        credits: { cast: [{ character: "Peter Parker / Spider-Man", order: 0 }, { character: "Himself", order: 1 }, { character: "May Parker (voice)", order: 2 }] } }),
    })) as any;
    const info = await movieInfo(1, { fetch, env: { TMDB_API_KEY: "k" } as any });
    expect(info).toMatchObject({ title: "Film", year: 2026, rating: 8.1, poster: "https://image.tmdb.org/t/p/w500/p.jpg", imdbId: "tt1" });
    expect(info!.characters).toEqual([{ name: "Peter Parker", alias: "Spider-Man", order: 0 }, { name: "May Parker", alias: "", order: 2 }]);
  });
});
