import { describe, expect, it } from "vitest";
import { buildNicheIndex, classifyNiche } from "./nicheClassifier.js";

const index = buildNicheIndex([
  { id: "sleep-history", macroNiche: "Sleep & Relaxation", subNiche: "History for sleep", seedKeywords: ["history for sleep", "sleep history", "boring history"], acquisitionQueries: ["boring history to fall asleep to"] },
  { id: "space", macroNiche: "Science & Space", subNiche: "Space documentaries", seedKeywords: ["mars", "black hole", "nasa"], acquisitionQueries: [] },
  { id: "manhwa", macroNiche: "Anime, Manga & Manhwa", subNiche: "Manhwa recaps", seedKeywords: ["manhwa recap", "manhwa"], acquisitionQueries: [] },
  { id: "movie", macroNiche: "Film & TV", subNiche: "Movie recaps", seedKeywords: ["movie recap", "movie explained"], acquisitionQueries: [] },
]);

describe("classifyNiche", () => {
  it("matches whole words only", () => {
    expect(classifyNiche(index, { title: "Marshall Mathers' best verses" })).toBeNull();
    expect(classifyNiche(index, { title: "What NASA found on Mars" })?.subNiche).toBe("Space documentaries");
  });

  it("doesn't let the search decide the niche", () => {
    expect(classifyNiche(index, { title: "Top 10 cheap gaming mice", query: "sleep history" })).toBeNull();
    expect(classifyNiche(index, { title: "3 hours of boring history to fall asleep to", query: "sleep" })?.macroNiche).toBe("Sleep & Relaxation");
  });

  it("prefers the more specific phrase", () => {
    expect(classifyNiche(index, { title: "Manhwa recap: he became the strongest", tags: "manhwa recap, movie" })?.subNiche).toBe("Manhwa recaps");
  });

  it("falls back to YouTube's category", () => {
    expect(classifyNiche(index, { title: "Ranked: every boss fight", category: "Gaming" })).toMatchObject({ label: "Gaming", fallback: true });
  });
});
