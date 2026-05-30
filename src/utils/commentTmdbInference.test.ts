import { describe, expect, it } from "vitest";
import {
  buildCommentCorpus,
  buildTmdbSearchQueries,
  extractDistinctivePhrases,
  rankTmdbCandidates,
  scoreTmdbCandidate,
} from "./commentTmdbInference.js";

describe("commentTmdbInference", () => {
  const victorThreads = [
    {
      text: "How would victor made monsters if monsters existed even before victor came here",
      replies: [{ text: "victor isn't a reliable source", likeCount: 12 }],
    },
    {
      text: "there were no monsters with the man in yellow because it was daytime",
      replies: [{ text: "And he's living among them. I believe she was speaking to Sara.", likeCount: 8 }],
    },
    {
      text: "I think the beginning of the town was Victor creating the story from his fears",
      replies: [],
    },
  ];
  const videoTitle = "Did you notice that in Victor's painting the Man in Yellow is eating";

  it("extracts Victor / Man in Yellow phrases from recap comments", () => {
    const corpus = buildCommentCorpus(victorThreads, videoTitle);
    const phrases = extractDistinctivePhrases(corpus.combined, corpus.title);
    const joined = phrases.map((p) => p.phrase).join("|");
    expect(joined).toMatch(/man in yellow/i);
    expect(joined).toMatch(/victor/i);
  });

  it("ranks From above unrelated titles when comment corpus matches overview terms", () => {
    const corpus = buildCommentCorpus(victorThreads, videoTitle);
    const phrases = extractDistinctivePhrases(corpus.combined, corpus.title);
    const ranked = rankTmdbCandidates([
      {
        id: 90669,
        media_type: "tv",
        name: "From",
        first_air_date: "2022-02-20",
        overview: "Unravelling the mystery of a nightmarish town that traps all who enter. Victor, the Man in Yellow, and Sara struggle against the monsters.",
        popularity: 120,
        vote_count: 900,
      },
      {
        id: 123,
        media_type: "movie",
        title: "Yellow Submarine",
        release_date: "1968-07-17",
        overview: "The Beatles adventure under the sea.",
        popularity: 40,
        vote_count: 500,
      },
    ], corpus, phrases);

    expect(ranked?.title).toBe("From");
    expect(ranked?.year).toBe("2022");
    expect(ranked?.confidence).toBeGreaterThan(0.7);
  });

  it("builds search queries from title and repeated comment terms", () => {
    const corpus = buildCommentCorpus(victorThreads, videoTitle);
    const phrases = extractDistinctivePhrases(corpus.combined, corpus.title);
    const queries = buildTmdbSearchQueries(corpus, phrases);
    expect(queries.some((q) => /man in yellow|victor/i.test(q))).toBe(true);
  });

  it("penalizes ultra-short TMDB titles without enough corpus overlap", () => {
    const corpus = buildCommentCorpus([{ text: "random unrelated chatter about pizza", replies: [] }], "pizza time");
    const weak = scoreTmdbCandidate(
      { title: "It", overview: "clowns and balloons", media_type: "movie", popularity: 10, vote_count: 10 },
      corpus,
      [],
    );
    const strong = scoreTmdbCandidate(
      { title: "Pizza Party Massacre", overview: "pizza restaurant horror", media_type: "movie", popularity: 10, vote_count: 10 },
      corpus,
      [{ phrase: "pizza", weight: 2 }],
    );
    expect(strong).toBeGreaterThan(weak);
  });
});
