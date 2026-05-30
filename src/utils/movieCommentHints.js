import { asksForMovieName } from "./commentPolicy.js";

function normalizeCommentText(text) {
  return String(text || "")
    .replace(/https?:\/\/\S+|www\.\S+/gi, " ")
    .replace(/[\u200d\ufe0f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedTitleKey(title) {
  return String(title || "")
    .toLowerCase()
    .replace(/\b(the|a|an)\b/gi, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const STRUCTURED_NAME_REPLY = /^(?:anime|movie|manga|tv show|title|film|show|series)\s+name:\s*(.+?)(?:\s*\((\d{4})\))?\s*$/i;
const INLINE_NAME_REPLY = /\b(?:anime|movie|manga|film|show|series|tv)\s+name:\s*(.+?)(?:\s*\((\d{4})\))?(?:[.!]|$)/i;
const INFORMAL_ITS_REPLY = /^(?:it'?s|its)\s+(.+)$/i;
const CALLED_PATTERN = /\b(?:it(?:'s| is)|its|that(?:'s| is)|this is)\s+called\s+(?:the\s+)?(?:movie\s+|anime\s+|show\s+|film\s+)?(.+?)(?:\s*\((\d{4})\))?(?:[.!?]|$)/i;
const TITLE_IS_PATTERN = /\b(?:title|movie|anime|show|film|series)\s+(?:is|=)\s*(.+?)(?:\s*\((\d{4})\))?(?:[.!?]|$)/i;

function cleanParsedTitle(raw) {
  return String(raw || "")
    .replace(/^[@#]+/, "")
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function looksLikeLowSignalTitle(title) {
  const compact = String(title || "").trim();
  if (!compact || compact.length < 2 || compact.length > 120)
    return true;
  if (/^(idk|dunno|not sure|no idea|unknown|same|this|that|here|link|part \d+|episode \d+)$/i.test(compact))
    return true;
  if (/^(yes|no|maybe|lol|bro|fr|ngl)$/i.test(compact))
    return true;
  if (/^(some people are just evil|bro did him dirty|redo of healer)$/i.test(compact))
    return true;
  if (/^[\p{Emoji_Presentation}\p{Extended_Pictographic}\s]+$/u.test(compact))
    return true;
  return false;
}

export function parseMovieTitleFromReply(text) {
  const compact = normalizeCommentText(text);
  if (!compact || compact.length < 2)
    return null;

  const attempts = [
    { match: compact.match(STRUCTURED_NAME_REPLY), format: "structured_reply", confidence: 0.95 },
    { match: compact.match(INLINE_NAME_REPLY), format: "inline_structured_reply", confidence: 0.92 },
    { match: compact.match(CALLED_PATTERN), format: "called_reply", confidence: 0.84 },
    { match: compact.match(TITLE_IS_PATTERN), format: "title_is_reply", confidence: 0.88 },
    { match: compact.match(INFORMAL_ITS_REPLY), format: "informal_its_reply", confidence: 0.9 },
  ];

  for (const attempt of attempts) {
    const match = attempt.match;
    if (!match)
      continue;
    const title = cleanParsedTitle(match[1]);
    if (looksLikeLowSignalTitle(title))
      continue;
    return {
      title,
      year: String(match[2] || "").match(/\d{4}/)?.[0] || "",
      format: attempt.format,
      confidence: attempt.confidence,
    };
  }

  if (asksForMovieName(compact))
    return null;

  return null;
}

function threadText(thread = {}) {
  return String(thread.text || thread.topLevelComment?.textDisplay || thread.topLevelComment?.textOriginal || thread.topLevelComment?.text || "").trim();
}

function replyText(reply = {}) {
  return String(reply.text || reply.textDisplay || reply.textOriginal || "").trim();
}

function replyAuthor(reply = {}) {
  return String(reply.authorUniqueId || reply.author?.uniqueId || reply.author?.unique_id || "").trim();
}

function replyLikes(reply = {}) {
  return Number(reply.likeCount ?? reply.likes_count ?? reply.likesCount ?? 0) || 0;
}

function threadLikes(thread = {}) {
  return Number(thread.likeCount ?? thread.digg_count ?? thread.diggCount ?? 0) || 0;
}

export function findMovieTitleFromCommentThreads(threads = [], options = {}) {
  const videoAuthor = String(options.videoAuthorUniqueId || options.videoAuthor || "").trim().toLowerCase();
  const minConfidence = Number(options.minConfidence ?? 0.85);
  const candidates = [];

  for (const thread of threads) {
    const topText = threadText(thread);
    const isNameRequest = thread.isNameRequest === true || asksForMovieName(topText);
    if (!isNameRequest)
      continue;

    for (const reply of Array.isArray(thread.replies) ? thread.replies : []) {
      const parsed = parseMovieTitleFromReply(replyText(reply));
      if (!parsed)
        continue;

      let confidence = parsed.confidence;
      const author = replyAuthor(reply).toLowerCase();
      const fromCreator = Boolean(videoAuthor && author && author === videoAuthor);
      if (fromCreator)
        confidence = Math.min(confidence + 0.06, 0.98);
      confidence += Math.min(replyLikes(reply) * 0.004, 0.04);
      confidence += Math.min(threadLikes(thread) * 0.003, 0.04);
      if (/[:：]/.test(parsed.title))
        confidence = Math.min(confidence + 0.02, 0.98);

      candidates.push({
        ...parsed,
        fromCreator,
        replyText: replyText(reply),
        replyId: String(reply.id || "").trim(),
        threadId: String(thread.id || thread.threadId || "").trim(),
        threadLikes: threadLikes(thread),
        confidence: Math.min(confidence, 0.98),
      });
    }
  }

  if (!candidates.length)
    return null;

  const grouped = new Map();
  for (const candidate of candidates) {
    const key = normalizedTitleKey(candidate.title);
    if (!key)
      continue;
    const bucket = grouped.get(key) || {
      title: candidate.title,
      year: candidate.year || "",
      confidence: 0,
      support: 0,
      fromCreator: false,
      replyText: candidate.replyText,
      replyId: candidate.replyId,
      threadId: candidate.threadId,
      threadLikes: 0,
      format: candidate.format,
    };
    bucket.support += 1;
    bucket.confidence = Math.max(bucket.confidence, candidate.confidence);
    bucket.threadLikes = Math.max(bucket.threadLikes || 0, candidate.threadLikes || 0);
    bucket.fromCreator = bucket.fromCreator || candidate.fromCreator;
    if (!bucket.year && candidate.year)
      bucket.year = candidate.year;
    if (candidate.fromCreator)
      bucket.replyText = candidate.replyText;
    grouped.set(key, bucket);
  }

  const ranked = [...grouped.values()]
    .map((item) => ({
      ...item,
      confidence: Math.min(item.confidence + Math.max(item.support - 1, 0) * 0.03, 0.98),
    }))
    .sort((a, b) => {
      if (b.fromCreator !== a.fromCreator)
        return Number(b.fromCreator) - Number(a.fromCreator);
      if (b.confidence !== a.confidence)
        return b.confidence - a.confidence;
      if ((b.threadLikes || 0) !== (a.threadLikes || 0))
        return (b.threadLikes || 0) - (a.threadLikes || 0);
      return b.support - a.support;
    });

  const best = ranked[0];
  if (!best || best.confidence < minConfidence)
    return null;

  return best;
}
