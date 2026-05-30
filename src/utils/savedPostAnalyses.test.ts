import { describe, expect, it } from "vitest";
import { analysisAutoTags, mergePostAnalyses } from "./savedPostAnalyses";

describe("saved post analyses", () => {
  it("extracts persistent auto tags from official movie databases", () => {
    expect(analysisAutoTags({
      title: "Classless Hero",
      year: "2025",
      genre: "anime",
      mediaType: "anime",
      tmdb: { genres: ["Action", "Fantasy"], releaseDate: "2025-10-01" },
      mal: { genres: ["Fantasy", "Adventure"] },
    } as any)).toEqual(["Action", "Fantasy", "Adventure", "anime", "2025"]);
  });

  it("keeps the newest saved analysis for the same clip slug", () => {
    const older = { clip: { result: { title: "Old" } as any, analyzedAt: 10 } };
    const newer = { clip: { result: { title: "New" } as any, analyzedAt: 20 } };

    expect(mergePostAnalyses(older, newer).clip.result.title).toBe("New");
    expect(mergePostAnalyses(newer, older).clip.result.title).toBe("New");
  });
});
