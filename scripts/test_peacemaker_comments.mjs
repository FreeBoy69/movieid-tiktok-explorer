import { parseMovieTitleFromReply, findMovieTitleFromCommentThreads } from "../src/utils/movieCommentHints.js";

const threads = [
  {
    id: "1",
    text: "his majesty",
    replies: [{ id: "r1", text: "it's not a movie it's a series peacemaker", authorUniqueId: "user", likeCount: 2 }],
  },
  {
    id: "2",
    text: "broverload",
    replies: [{ id: "r2", text: "and this is just one scene from the end of season 2", likeCount: 0 }],
  },
];

console.log(JSON.stringify({
  parsedReply: parseMovieTitleFromReply("it's not a movie it's a series peacemaker"),
  selectedHint: findMovieTitleFromCommentThreads(threads, { videoAuthorUniqueId: "user272358841430" }),
}, null, 2));
