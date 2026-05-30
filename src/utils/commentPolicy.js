const QUICK_EMOJI = "👀";

function normalizeCommentText(text) {
  return String(text || "")
    .replace(/https?:\/\/\S+|www\.\S+/gi, " ")
    .replace(/[\u200d\ufe0f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function asksForMovieName(text) {
  const normalized = String(text || "").toLowerCase();
  const wordsOnly = normalized
    .replace(/[^\p{L}\p{N}?]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return /\b(anime|movie|film|show|series|episode|sauce|source)\s+(name|title)\s*(please|pls|plz)?\s*\?*\s*$/i.test(normalized)
    || /\b(anime|movie|film|show|series)\s*(please|pls|plz)?\s*\?+\s*$/i.test(normalized)
    || /\b(anime|movie|film|show|series)\s+(please|pls|plz)\s*$/i.test(normalized)
    || /\b(name|title|sauce|source)\s*(please|pls|plz)?\s*\?*\s*$/i.test(normalized)
    || /\b(name|title|sauce|source)\s+(please|pls|plz)\b/i.test(wordsOnly)
    || /\b(please|pls|plz)\s+(name|title|sauce|source)\b/i.test(wordsOnly)
    || /\b(anime|movie|film|show|series)\s+(name|title|please|pls|plz)\b/i.test(wordsOnly)
    || /\b(what|which|whats|what's|wht|wat)\b.{0,45}\b(anime|movie|film|show|series|episode|title|name|sauce|source)\b/i.test(normalized)
    || /\b(anime|movie|film|show|series)\b.{0,35}\b(name|title|please|pls|plz)\b/i.test(normalized);
}

export function contentReferenceLabel(context = {}) {
  const haystack = [
    context.mediaType,
    context.genre,
    context.microNiche,
    context.title,
    context.summary,
  ].filter(Boolean).join(" ").toLowerCase();
  if (/\b(anime|ova|ona|donghua)\b/.test(haystack))
    return "Anime";
  if (/\b(manga|manhwa|manhua|webtoon|comic|light novel)\b/.test(haystack))
    return "Manga";
  if (/\b(tv|series|show|episode|season)\b/.test(haystack))
    return "TV show";
  if (/\b(film|movie)\b/.test(haystack))
    return "Movie";
  return "Title";
}

export function contentNameReply(context = {}) {
  const title = String(context.title || context.movieTitle || "").trim();
  if (!title)
    return "";
  const year = String(context.year || context.movieYear || "").match(/\d{4}/)?.[0] || "";
  return `${contentReferenceLabel(context)} name: ${title}${year ? ` (${year})` : ""}`;
}

export function sourceTitleSafeForPublicReply(context = {}) {
  const result = context.result || context.movie || context;
  const title = String(result.title || context.title || context.movieTitle || "").trim();
  const confidence = Number(result.confidence ?? context.confidence ?? 0);
  if (!title || !Number.isFinite(confidence) || confidence < 0.85)
    return false;
  // Backup vision is valuable for internal recovery, but title replies are public.
  // Keep those silent unless the primary Movie ID path has confirmed the title.
  if (result.qwenFallback?.used === true)
    return false;
  return result.manualCorrection === true || result.sourceVerification?.verified === true;
}

function normalizedSourceTitle(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\b(the|a|an)\b/gi, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function sourceTitleVerifiedForPublicReply(uploadResult = {}, verificationResult = {}) {
  if (!sourceTitleSafeForPublicReply(uploadResult) || !sourceTitleSafeForPublicReply(verificationResult))
    return false;
  const uploadTitle = normalizedSourceTitle(uploadResult.title || uploadResult.movieTitle || "");
  const verifiedTitle = normalizedSourceTitle(verificationResult.title || verificationResult.movieTitle || "");
  return Boolean(uploadTitle && verifiedTitle && uploadTitle === verifiedTitle);
}

export function classifyCommentReply(text) {
  const compact = normalizeCommentText(text);
  const lower = compact.toLowerCase();
  const tokens = compact.match(/[\p{L}\p{N}]{2,}/gu) || [];
  const lettersAndNumbers = compact.match(/[\p{L}\p{N}]/gu) || [];
  const specificStoryCue = /\b(ending|scene|character|episode|season|part|story|plot|twist|betray|betrayed|fight|power|ability|death|survive|villain|hero|brother|sister|father|mother|deserved|should have|could have|theory|explain)\b/i;

  if (!compact || compact.length < 2) {
    return { action: "skip", useAi: false, reason: "empty" };
  }
  if (/(^|\s)(http|telegram|whatsapp|crypto|forex|investment|giveaway|subscribe to my|check my channel)(\s|$)/i.test(lower)) {
    return { action: "skip", useAi: false, reason: "spam_or_promo" };
  }
  if (asksForMovieName(compact)) {
    return { action: "name_request", useAi: false, reason: "asks_for_source_name" };
  }
  if (/^\d{1,4}$/.test(compact) || /^[^\p{L}\p{N}]*[\p{Emoji_Presentation}][^\p{L}\p{N}]*$/u.test(compact)) {
    return { action: "quick_reply", reply: QUICK_EMOJI, useAi: false, reason: "numeric_or_emoji_reaction" };
  }
  if (lettersAndNumbers.length < 4 || tokens.length === 0) {
    return { action: "skip", useAi: false, reason: "too_little_context" };
  }
  if (/^(lol|lmao|haha|wow|bro|ok|yes|no|nice|cool|fire|first|w|goat)$/i.test(lower)) {
    return { action: "quick_reply", reply: QUICK_EMOJI, useAi: false, reason: "short_reaction" };
  }
  if (/\b(great|good|nice|amazing|awesome|love|loved|fire|best|cool|dope|beautiful|perfect)\b.{0,30}\b(video|edit|clip|recap|one|story)?\b/i.test(lower)
    && !/\b(why|how|what|which|who|where|when|ending|scene|character|episode|season|part|brother|sister|father|mother|villain|hero|betray|fight|death|power|ability)\b/i.test(lower)) {
    return { action: "quick_reply", reply: "Thanks for watching", useAi: false, reason: "generic_praise" };
  }
  if (tokens.length <= 2 && !/[?]/.test(compact)) {
    return { action: "quick_reply", reply: QUICK_EMOJI, useAi: false, reason: "short_low_context_reaction" };
  }
  if (/[?]/.test(compact) && !specificStoryCue.test(lower)) {
    return { action: "skip", useAi: false, reason: "low_context_question" };
  }
  if (specificStoryCue.test(lower)) {
    return { action: "ai_context", useAi: true, reason: "specific_video_or_story_context" };
  }
  return { action: "skip", useAi: false, reason: "no_specific_video_context" };
}
