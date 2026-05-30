import { describe, expect, it } from "vitest";
import {
  capUnverifiedMovieIdResult,
  databaseSummaryCandidate,
  databaseSummaryCandidates,
  movieIdResultMayBeCached,
  verifiedMovieIdResult,
} from "./movieIdVerification.js";

describe("Movie ID database verification", () => {
  it("uses MAL synopsis data when an anime result has MAL enrichment", () => {
    expect(databaseSummaryCandidate({
      title: "Hero Without a Class",
      mal: {
        id: 1,
        englishTitle: "Hero Without a Class",
        synopsis: "A classless hero trains beyond the skills bestowed by the goddess.",
        type: "anime",
      },
    })).toMatchObject({
      provider: "mal",
      id: "1",
      title: "Hero Without a Class",
      summary: "A classless hero trains beyond the skills bestowed by the goddess.",
    });
  });

  it("uses TMDB overview data for TV and movie candidates", () => {
    expect(databaseSummaryCandidate({
      title: "The Housemaid",
      tmdb: {
        id: 2,
        title: "The Housemaid",
        overview: "A housemaid becomes trapped in secrets and power.",
        mediaType: "movie",
      },
    })).toMatchObject({
      provider: "tmdb",
      id: "2",
      title: "The Housemaid",
      summary: "A housemaid becomes trapped in secrets and power.",
    });
  });

  it("keeps unique MAL and TMDB summary candidates for cross-checking corrected titles", () => {
    expect(databaseSummaryCandidates([
      {
        title: "Wrong Anime Guess",
        mal: {
          id: 10,
          englishTitle: "Wrong Anime Guess",
          synopsis: "A demon lord tries to hide in school.",
          type: "anime",
        },
      },
      {
        title: "Hero Without a Class: Who Even Needs Skills?!",
        tmdb: {
          id: 236565,
          title: "Hero Without a Class: Who Even Needs Skills?!",
          overview: "Arel trains after receiving no class or skills.",
          mediaType: "tv",
        },
      },
      {
        title: "Hero Without a Class: Who Even Needs Skills?!",
        tmdb: {
          id: 236565,
          title: "Hero Without a Class: Who Even Needs Skills?!",
          overview: "A duplicate TMDB result should not create another candidate.",
          mediaType: "tv",
        },
      },
      { title: "Summary Missing" },
    ])).toMatchObject([
      { provider: "mal", id: "10", title: "Wrong Anime Guess" },
      { provider: "tmdb", id: "236565", title: "Hero Without a Class: Who Even Needs Skills?!" },
    ]);
  });

  it("marks a synopsis-corroborated result trusted for downstream title use", () => {
    const result = verifiedMovieIdResult(
      { title: "Hero Without a Class", confidence: 0.98 },
      { provider: "tmdb", id: "236565", title: "Hero Without a Class", summary: "A classless hero story." },
      { verified: true, confidence: 0.93, reason: "Transcript and synopsis agree." },
    );

    expect(result.confidence).toBe(0.93);
    expect(result.sourceVerification).toMatchObject({
      verified: true,
      provider: "tmdb",
      databaseId: "236565",
    });
  });

  it("caps unverified title confidence before cache and comments use it", () => {
    const result = capUnverifiedMovieIdResult(
      { title: "Confident Wrong Guess", confidence: 0.98 },
      "database_summary_mismatch",
    );

    expect(result.confidence).toBeLessThan(0.85);
    expect(result.sourceVerification).toMatchObject({
      verified: false,
      status: "database_summary_mismatch",
    });
  });

  it("keeps failed database cross-checks out of persistent Movie ID cache", () => {
    expect(movieIdResultMayBeCached({
      title: "Wrong Guess",
      sourceVerification: { verified: false },
    })).toBe(false);
    expect(movieIdResultMayBeCached({
      title: "Corrected Manually",
      manualCorrection: true,
      sourceVerification: { verified: false },
    })).toBe(true);
    expect(movieIdResultMayBeCached({
      title: "Database Verified",
      sourceVerification: { verified: true },
    })).toBe(true);
  });
});
