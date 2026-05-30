import { describe, expect, it } from "vitest";
import { findMovieTitleFromCommentThreads, parseMovieTitleFromReply } from "./movieCommentHints.js";

describe("movieCommentHints", () => {
  it("parses structured movie-name replies like the comment agent uses", () => {
    expect(parseMovieTitleFromReply("Anime name: Yowamushi Pedal (2013)")).toEqual({
      title: "Yowamushi Pedal",
      year: "2013",
      format: "structured_reply",
      confidence: 0.95,
    });
    expect(parseMovieTitleFromReply("Movie name: Interstellar (2014)")).toMatchObject({
      title: "Interstellar",
      year: "2014",
    });
  });

  it("parses casual title replies on name-request threads", () => {
    expect(parseMovieTitleFromReply("It's called Solo Leveling (2018)")).toMatchObject({
      title: "Solo Leveling",
      year: "2018",
      format: "called_reply",
    });
    expect(parseMovieTitleFromReply("The anime is Demon Slayer")).toMatchObject({
      title: "Demon Slayer",
      format: "title_is_reply",
    });
    expect(parseMovieTitleFromReply("Its Xam'd: Lost Memories")).toMatchObject({
      title: "Xam'd: Lost Memories",
      format: "informal_its_reply",
      confidence: 0.9,
    });
  });

  it("prefers substantive Its-replies on stronger name-request threads", () => {
    const result = findMovieTitleFromCommentThreads([
      {
        id: "1",
        text: "movie name please",
        likeCount: 4,
        replies: [{ id: "r1", text: "Its Xam'd: Lost Memories", likeCount: 2 }],
      },
      {
        id: "2",
        text: "Anime name plz",
        likeCount: 0,
        replies: [{ id: "r2", text: "Redo of healer", likeCount: 0 }],
      },
    ]);
    expect(result).toMatchObject({
      title: "Xam'd: Lost Memories",
      format: "informal_its_reply",
    });
  });

  it("ignores low-signal or question replies", () => {
    expect(parseMovieTitleFromReply("movie name please?")).toBeNull();
    expect(parseMovieTitleFromReply("idk bro")).toBeNull();
    expect(parseMovieTitleFromReply("same")).toBeNull();
  });

  it("finds the best reply on name-request threads and boosts creator answers", () => {
    const result = findMovieTitleFromCommentThreads([
      {
        id: "1",
        text: "what anime is this?",
        replies: [
          { id: "r1", text: "maybe demon slayer", likeCount: 2 },
          { id: "r2", text: "Anime name: Demon Slayer (2019)", authorUniqueId: "creator", likeCount: 40 },
        ],
      },
    ], { videoAuthorUniqueId: "creator" });

    expect(result).toMatchObject({
      title: "Demon Slayer",
      year: "2019",
      fromCreator: true,
    });
    expect(result?.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it("requires enough confidence before returning a comment hint", () => {
    const result = findMovieTitleFromCommentThreads([
      {
        id: "1",
        text: "movie name?",
        replies: [{ id: "r1", text: "maybe idk", likeCount: 0 }],
      },
    ]);
    expect(result).toBeNull();
  });
});
