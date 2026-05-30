import { parseMovieTitleFromReply, findMovieTitleFromCommentThreads } from "../src/utils/movieCommentHints.js";

const threads = [
  { id: "1", text: "Movie name ?", replies: [{ id: "r1", text: 'movie is called "Salyut 7"', likeCount: 33 }] },
  { id: "2", text: "Movie name", replies: [{ id: "r2", text: "Film Name: GEOSTORM", likeCount: 4 }] },
];

console.log(JSON.stringify({
  salyut: parseMovieTitleFromReply('movie is called "Salyut 7"'),
  geostorm: parseMovieTitleFromReply("Film Name: GEOSTORM"),
  hint: findMovieTitleFromCommentThreads(threads, { videoAuthorUniqueId: "user272358841430" }),
}, null, 2));
