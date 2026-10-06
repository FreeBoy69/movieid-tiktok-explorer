import { describe, expect, it } from "vitest";
import { matchScore, normalizeSource, pageLinks, rankResults, searchSource, searchUrls } from "./filmSources.js";

describe("film sources", () => {
  it("keeps a source's {query} slot and searches plain sites the WordPress way", () => {
    const s = normalizeSource({ name: " Hub ", url: "https://hub.example.com/search?q={query}" });
    expect(s).toMatchObject({ name: "Hub", url: "https://hub.example.com/search?q={query}" });
    expect(s.id).toMatch(/^src_/);
    expect(searchUrls(s, "Spider-Man 2026")).toEqual(["https://hub.example.com/search?q=Spider-Man%202026"]);
    expect(searchUrls(normalizeSource({ url: "films.example.org" }), "Fall")).toEqual(["https://films.example.org/?s=Fall", "https://films.example.org/search?q=Fall"]);
    expect(() => normalizeSource({ url: "http://localhost:8080/?s={query}" })).toThrow();
  });

  it("finds the film's links on a result page, best first, skipping navigation", () => {
    const html = `<a href="/tag/action">Action</a><a href="/?s=spider">Search</a>
      <a href="/spider-man-brand-new-day-2026-1080p/" title="Spider-Man: Brand New Day (2026)"><img alt="poster">Spider-Man: Brand New Day (2026) 1080p</a>
      <a href="/spider-man-no-way-home-2021/">Spider-Man: No Way Home (2021)</a>
      <a href="https://other.site/spider-man-brand-new-day">elsewhere</a>`;
    const links = pageLinks(html, "https://hub.example.com/?s=x");
    const ranked = rankResults(links, "Spider-Man Brand New Day 2026", "hub.example.com");
    expect(ranked.map((r) => r.url)).toEqual(["https://hub.example.com/spider-man-brand-new-day-2026-1080p/"]);
    expect(matchScore({ url: "https://h/x", text: "Spider-Man: No Way Home" }, "Spider-Man Brand New Day")).toBe(0);
  });

  it("falls back to the page reader when the site builds results in JavaScript", async () => {
    const calls: string[] = [];
    const fetcher = async (url: string) => {
      calls.push(url);
      if (url.startsWith("https://r.jina.ai/")) return { body: Buffer.from("Results\n[Fall (2022) WEB-DL](https://films.example.org/fall-2022/)\n[Home](https://films.example.org/)") };
      return { body: Buffer.from("<html><div id=app></div></html>") };
    };
    const out = await searchSource(normalizeSource({ name: "Films", url: "https://films.example.org/?s={query}" }), "Fall 2022", { fetcher: fetcher as any });
    expect(out.results[0]).toMatchObject({ url: "https://films.example.org/fall-2022/" });
    expect(calls).toEqual(["https://films.example.org/?s=Fall%202022", "https://r.jina.ai/https://films.example.org/?s=Fall%202022"]);
  });
});
