// Comment threads for the reply agents: who spoke last, what still needs an
// answer, and how often a video's comments should be checked.

const text = (comment) => String(comment?.textOriginal || comment?.textDisplay || "").trim();
const time = (comment) => Date.parse(comment?.publishedAt || comment?.updatedAt || "") || 0;

// Google gives a channel id; Zernio only a name and an @handle URL, so match any of them.
export function isOwnerComment(comment, account = {}) {
  const channelId = String(account.channelId || "").trim();
  const title = String(account.channelTitle || "").trim().toLowerCase();
  const handle = String(account.channelHandle || "").trim().replace(/^@+/, "").toLowerCase();
  const author = String(comment?.authorChannelId || "");
  const url = String(comment?.authorChannelUrl || "");
  const name = String(comment?.authorDisplayName || "").trim().toLowerCase();
  const urlHandle = (url.match(/\/@([^/?#]+)/)?.[1] || "").toLowerCase();
  return Boolean(
    (channelId && (author === channelId || url.includes(channelId))) ||
      (title && name === title) ||
      (handle && (urlHandle === handle || name.replace(/^@+/, "") === handle)),
  );
}

// YouTube reply ids are "<threadId>.<replyId>".
export const threadIdOf = (commentId) => String(commentId || "").split(".")[0];

/**
 * What in this thread still needs the channel's answer:
 * - no owner reply yet: the top-level comment;
 * - owner already replied: the newest viewer reply posted after the owner's last
 *   reply (a follow-up), or nothing if the owner spoke last.
 * `context` is the conversation so far, oldest first, for the reply writer.
 */
export function threadReplyTarget(thread, account = {}) {
  const top = thread?.topLevelComment;
  if (!top?.id || thread.canReply === false) return null;
  const replies = [...(thread.replies || [])].filter((reply) => reply?.id).sort((a, b) => time(a) - time(b));
  const lastOwner = replies.reduce((at, reply, index) => (isOwnerComment(reply, account) ? index : at), -1);
  const context = [top, ...replies].map((comment) => ({
    author: String(comment.authorDisplayName || "Viewer"),
    owner: isOwnerComment(comment, account),
    text: text(comment).slice(0, 400),
  }));
  // On the channel's own top comment, only viewer replies to it need answers.
  if (lastOwner < 0 && !isOwnerComment(top, account)) return { kind: "comment", comment: top, threadId: top.id, context: context.slice(0, 1) };
  const after = replies.slice(lastOwner + 1).filter((reply) => !isOwnerComment(reply, account) && text(reply));
  const follow = after[after.length - 1];
  if (!follow) return null;
  return { kind: "follow_up", comment: follow, threadId: top.id, context: context.slice(-6) };
}

// Replying to a reply posts under the thread; a leading @handle makes it clear who we answer.
export function addressReply(target, reply) {
  const body = String(reply || "").trim();
  if (target?.kind !== "follow_up") return body;
  const handle = String(target.comment?.authorDisplayName || "").trim();
  if (!/^@[\w.-]{2,}$/.test(handle) || body.toLowerCase().startsWith(handle.toLowerCase())) return body;
  return `${handle} ${body}`;
}

// Minutes between comment checks for a video of this age: fast while a video is
// new and comments arrive quickly, slower as it ages, and never after 60 days.
export function commentCheckMinutes(ageHours) {
  const age = Math.max(0, Number(ageHours) || 0);
  if (age < 6) return 5;
  if (age < 24) return 10;
  if (age < 72) return 30;
  if (age < 14 * 24) return 120;
  if (age < 60 * 24) return 720;
  return null;
}

// Newest-first pages can stop once a page reaches comments the last check already saw.
export function reachedCheckedComments(threads, lastCheckedAt, slackMs = 60 * 60 * 1000) {
  const since = Date.parse(lastCheckedAt || "");
  if (!since || !threads?.length) return false;
  const oldest = Math.min(...threads.map((thread) => time(thread.topLevelComment) || Infinity));
  return Number.isFinite(oldest) && oldest < since - slackMs;
}
