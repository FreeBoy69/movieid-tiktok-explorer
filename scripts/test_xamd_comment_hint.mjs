import { findMovieTitleFromCommentThreads } from "../src/utils/movieCommentHints.js";

const threads = [
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
];

console.log(JSON.stringify(findMovieTitleFromCommentThreads(threads), null, 2));
