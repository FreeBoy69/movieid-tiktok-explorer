function cleanText(value = "") {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

export function cleanAutomationTitle(value = "") {
  return cleanText(value)
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/#[a-z0-9_]+/gi, " ")
    .replace(/[|]+\s*(?:tiktok|youtube|shorts|reels|fyp|for you)\b.*$/i, " ")
    .replace(/\s+([,.!?;:])/g, "$1")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\s{2,}/g, " ")
    .trim();
}

function trimToSentence(value = "", limit = 95) {
  const text = cleanText(value);
  if (text.length <= limit)
    return text;
  const clipped = text.slice(0, limit + 1);
  const lastSpace = clipped.lastIndexOf(" ");
  return `${clipped.slice(0, lastSpace > 40 ? lastSpace : limit).trim()}...`;
}

export function isGenericAutomationTitle(value = "") {
  const raw = cleanText(value);
  const text = cleanAutomationTitle(raw).toLowerCase();
  if (!text)
    return true;
  const hashtagCount = (raw.match(/#[a-z0-9_]+/gi) || []).length;
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  if (hashtagCount >= 2 && wordCount <= 2)
    return true;
  return [
    /\b(this|that)\s+(movie|anime|video|clip|story)\s+(twist|recap|ending)\s+(will|is|was)\b/,
    /\b(will|would)\s+(shock|blow)\s+(you|your mind)\b/,
    /\b(you won't|you will not)\s+believe\s+what\s+happens\s+next\b/,
    /\bwatch\s+(till|until)\s+the\s+end\b/,
    /\bmind[-\s]?blowing\s+(movie|anime|twist|recap)\b/,
    /\b(more amazing|facts? that|facts? you|hidden facts?|best movie for you)\b/,
    /\b(this|that)\s+(girl|boy|guy|man|woman|person)\s+never\s+(could|would)\s+have\s+imagined\b/,
    /^part\s*\d+\b/,
    /^movie recap\b/,
    /^anime recap\b/,
  ].some((pattern) => pattern.test(text));
}

function titleWordCount(value = "") {
  return cleanAutomationTitle(value).match(/[a-z0-9][a-z0-9'-]*/gi)?.length || 0;
}

export function isLowQualityAutomationTitle(value = "") {
  const raw = cleanText(value);
  const title = cleanAutomationTitle(raw);
  const hashtagCount = (raw.match(/#[a-z0-9_]+/gi) || []).length;
  if (isGenericAutomationTitle(raw) || !title)
    return true;
  if (titleWordCount(title) < 3 || title.length < 16)
    return true;
  return hashtagCount >= 3 && titleWordCount(title) <= 2;
}

function titleQualityScore(value = "") {
  const raw = cleanText(value);
  const title = cleanAutomationTitle(raw);
  if (isLowQualityAutomationTitle(raw))
    return -100;
  const words = titleWordCount(title);
  let score = 0;
  if (title.length >= 38 && title.length <= 95)
    score += 20;
  else if (title.length >= 26 && title.length <= 110)
    score += 12;
  score += Math.min(words, 16);
  if (/\b\d{1,4}\b/.test(title))
    score += 8;
  if (/\b(when|after|before|but|until|because|reveals?|finds?|becomes?|discovers?|saves?|betrays?|defeats?|awakens?|returns?)\b/i.test(title))
    score += 7;
  if (/\b(anime|movie|video|clip|story)\s+recap\b/i.test(title))
    score -= 4;
  return score;
}

export function transcriptSentences(value = "") {
  return cleanText(value)
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => cleanText(sentence))
    .filter((sentence) => sentence.length >= 20)
    .filter((sentence) => !/^(like|subscribe|follow|part\s+\d+|watch\s+more)\b/i.test(sentence));
}

export function transcriptFirstStoryBeat(value = "") {
  const sentences = transcriptSentences(value);
  const candidates = sentences
    .map((sentence) => cleanText(sentence)
      .replace(/^(?:guys|okay|well|so)\s*,?\s*/i, "")
      .replace(/^in this (?:video|story|clip)[,:]?\s*/i, "")
      .replace(/^here(?:'s| is) the (?:strange|crazy|wild) part[,:]?\s*/i, "")
      .replace(/^(?:and|but|then)\s+/i, ""))
    .filter((sentence) => {
      const words = sentence.split(/\s+/).length;
      return words >= 7 && words <= 32 && /[a-z]/i.test(sentence) && !isLowQualityAutomationTitle(sentence);
    });
  return candidates
    .map((sentence, index) => ({ sentence, score: titleQualityScore(sentence) - index * 0.75 }))
    .sort((a, b) => b.score - a.score)[0]?.sentence || sentences[0] || "";
}

export function transcriptTitleFromContext({ transcript = "", sourceTitle = "", genre = "", isTikTokTarget = false } = {}) {
  const source = cleanAutomationTitle(sourceTitle);
  const beat = cleanAutomationTitle(transcriptFirstStoryBeat(transcript)
    .replace(/^imagine\s+/i, "")
    .replace(/^this\s+(movie|anime|clip)\s+/i, ""));
  const sourceScore = titleQualityScore(source);
  const transcriptScore = titleQualityScore(beat);
  if (sourceScore >= transcriptScore && sourceScore >= 0)
    return trimToSentence(source, isTikTokTarget ? 150 : 95);
  if (beat && transcriptScore >= 0)
    return trimToSentence(beat, isTikTokTarget ? 150 : 95);

  const fallbackGenre = cleanText(genre) || "Faceless recap";
  return isTikTokTarget ? `${fallbackGenre} recap` : `${fallbackGenre} recap`;
}

function resolveAutomationTitle({ title = "", sourceTitle = "", transcript = "", summary = "", genre = "", isTikTokTarget = false } = {}) {
  const limit = isTikTokTarget ? 150 : 95;
  const candidates = [
    { origin: "generated", title: cleanAutomationTitle(title), bonus: 6 },
    { origin: "source", title: cleanAutomationTitle(sourceTitle), bonus: 0 },
    { origin: "transcript", title: cleanAutomationTitle(transcriptFirstStoryBeat(transcript)), bonus: 3 },
    { origin: "summary", title: cleanAutomationTitle(transcriptFirstStoryBeat(summary)), bonus: 1 },
  ]
    .map((candidate) => ({
      ...candidate,
      score: titleQualityScore(candidate.title) + candidate.bonus,
    }))
    .filter((candidate) => candidate.score >= 0)
    .sort((a, b) => b.score - a.score);
  if (candidates[0]) {
    return {
      title: trimToSentence(candidates[0].title, limit),
      origin: candidates[0].origin,
    };
  }
  return {
    title: transcriptTitleFromContext({ transcript, sourceTitle, genre, isTikTokTarget }),
    origin: "niche-fallback",
  };
}

export function transcriptDescriptionFromContext({ transcript = "", summary = "", sourceTitle = "", tags = [], isTikTokTarget = false } = {}) {
  const sentences = transcriptSentences(transcript || summary || sourceTitle).slice(0, 3);
  const body = cleanText(sentences.join(" "));
  const fallback = cleanText(summary || sourceTitle || "A short-form recap built from the clip transcript.");
  const tagText = tags
    .map((tag) => cleanText(tag).replace(/^#/, ""))
    .filter(Boolean)
    .slice(0, 8)
    .map((tag) => `#${tag.replace(/\s+/g, "")}`)
    .join(" ");
  const limit = isTikTokTarget ? 2200 : 4500;
  return cleanText(`${body || fallback}${tagText ? `\n\n${tagText}` : ""}`).slice(0, limit);
}

export function repairAutomationMetadata(data = {}, context = {}) {
  const isTikTokTarget = Boolean(context.isTikTokTarget);
  const tags = Array.isArray(data.tags) ? data.tags : [];
  const transcript = cleanText(context.transcript || data.transcript || "");
  const genre = cleanText(data.genre || context.genre || "");
  const sourceTitle = cleanText(context.sourceTitle || data.sourceTitle || "");
  const sourceSummary = cleanText(context.summary || data.summary || "");
  const title = cleanText(data.title);
  const description = cleanText(data.description);
  const titleResolution = resolveAutomationTitle({
    title,
    sourceTitle,
    transcript,
    summary: sourceSummary,
    genre,
    isTikTokTarget,
  });
  const repairedTitle = titleResolution.title;
  const repairedDescription = !description || isGenericAutomationTitle(description)
    ? transcriptDescriptionFromContext({ transcript, summary: sourceSummary, sourceTitle, tags, isTikTokTarget })
    : description.slice(0, isTikTokTarget ? 2200 : 4500);
  return {
    ...data,
    title: repairedTitle,
    description: repairedDescription,
    metadataTitleOrigin: titleResolution.origin,
    metadataRepaired: repairedTitle !== title || repairedDescription !== description,
  };
}
