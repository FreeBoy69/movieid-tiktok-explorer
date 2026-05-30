import { describe, expect, it } from "vitest";
import {
  genreMembershipFromStoryResult,
  genreMembershipFromMovieResult,
  groupSavedPlaylistGenreMemberships,
  mergeSavedPlaylistGenreMemberships,
  officialGenresFromMovieResult,
  pendingSavedPlaylistGenreVideos,
  savedPlaylistGenreScanSummary,
} from "./savedPlaylistGenres.js";

const video = {
  id: "7613318687973510430",
  title: "The cyclist broke his limits",
  playUrl: "https://www.tiktok.com/@anime/video/7613318687973510430",
  dynamicCover: "https://cdn.example/thumb.jpg",
  stats: { playCount: 1200 },
};

describe("saved playlist official genres", () => {
  it("extracts unique official TMDB and MAL genres", () => {
    expect(officialGenresFromMovieResult({
      title: "Yowamushi Pedal",
      tmdb: { genres: ["Animation", "Drama", "Animation"] },
      mal: { genres: ["Sports", "Drama"] },
    })).toEqual(["Animation", "Drama", "Sports"]);
  });

  it("creates verified multi-genre memberships from enriched Movie ID results", () => {
    const membership = genreMembershipFromMovieResult(video, {
      title: "Yowamushi Pedal",
      year: "2013",
      confidence: 0.98,
      sourceVerification: { verified: true },
      mal: { id: 18179, title: "Yowamushi Pedal", genres: ["Sports", "Drama"] },
    });

    expect(membership.status).toBe("verified");
    expect(membership.genres).toEqual(["Sports", "Drama"]);
    expect(membership.title).toBe("Yowamushi Pedal");
    expect(membership.source).toBe("mal");
  });

  it("keeps clips without official genres in needs review", () => {
    const membership = genreMembershipFromMovieResult(video, {
      title: "Possible recap source",
      confidence: 0.61,
      sourceVerification: { verified: false },
    });

    expect(membership.status).toBe("needs_review");
    expect(membership.genres).toEqual([]);
    expect(membership.reason).toBe("official_genres_missing");
  });

  it("creates inferred story-genre memberships from transcript classification", () => {
    const membership = genreMembershipFromStoryResult(video, {
      genres: ["Sports", "Drama", "Sports"],
      summary: "A weak cyclist trains through rivalry pressure and a mountain climb.",
      storySignals: ["training arc", "rivalry"],
      confidence: 0.84,
    });

    expect(membership.status).toBe("inferred");
    expect(membership.source).toBe("story_ai");
    expect(membership.genres).toEqual(["Sports", "Drama"]);
    expect(membership.reason).toBe("transcript_story_genres");
    expect(membership.storySummary).toContain("cyclist");
  });

  it("groups one clip into every official genre and keeps review clips separate", () => {
    const groups = groupSavedPlaylistGenreMemberships([
      genreMembershipFromMovieResult(video, {
        title: "Yowamushi Pedal",
        confidence: 0.98,
        sourceVerification: { verified: true },
        mal: { id: 18179, title: "Yowamushi Pedal", genres: ["Sports", "Drama"] },
      }),
      genreMembershipFromStoryResult({ id: "story", title: "Escaping the mansion" }, {
        genres: ["Thriller"],
        summary: "A servant uncovers a dangerous family secret.",
        confidence: 0.78,
      }),
      {
        videoKey: "missing",
        status: "needs_review",
        genres: [],
        title: "",
        video: { id: "missing", title: "Unknown recap" },
      },
    ]);

    expect(groups.map((group) => [group.genre, group.count])).toEqual([
      ["Drama", 1],
      ["Sports", 1],
      ["Thriller", 1],
      ["Needs Review", 1],
    ]);
  });

  it("keeps existing scan memberships and queues only pending videos for the next batch", () => {
    const otherVideo = { id: "next-video", title: "Next recap" };
    const merged = mergeSavedPlaylistGenreMemberships(
      [genreMembershipFromMovieResult(video, {
        title: "Yowamushi Pedal",
        confidence: 0.98,
        sourceVerification: { verified: true },
        mal: { id: 18179, title: "Yowamushi Pedal", genres: ["Sports"] },
      })],
      [{ videoKey: "needs-review", video: { id: "needs-review" }, status: "needs_review", genres: [] }],
    );

    expect(pendingSavedPlaylistGenreVideos([video, otherVideo], merged, 1)).toEqual([otherVideo]);
    expect(savedPlaylistGenreScanSummary([video, otherVideo], merged)).toMatchObject({
      total: 2,
      scanned: 1,
      verified: 1,
      inferred: 0,
      needsReview: 0,
      pending: 1,
    });
  });
});
