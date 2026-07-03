function cleanText(value = "") {
  return String(value || "")
    .replace(/\s+/g, " ")
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
  const text = cleanText(value).toLowerCase();
  if (!text)
    return true;
  return [
    /\b(this|that)\s+(movie|anime|video|clip|story)\s+(twist|recap|ending)\s+(will|is|was)\b/,
    /\b(will|would)\s+(shock|blow)\s+(you|your mind)\b/,
    /\b(you won't|you will not)\s+believe\s+what\s+happens\s+next\b/,
    /\bwatch\s+(till|until)\s+the\s+end\b/,
    /\bmind[-\s]?blowing\s+(movie|anime|twist|recap)\b/,
    /^movie recap\b/,
    /^anime recap\b/,
  ].some((pattern) => pattern.test(text));
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
  return sentences.find((sentence) => {
    const words = sentence.split(/\s+/).length;
    return words >= 7 && words <= 32 && /[a-z]/i.test(sentence);
  }) || sentences[0] || "";
}

export function transcriptTitleFromContext({ transcript = "", sourceTitle = "", genre = "", isTikTokTarget = false } = {}) {
  const source = cleanText(sourceTitle);
  if (source && !isGenericAutomationTitle(source))
    return trimToSentence(source, isTikTokTarget ? 150 : 95);

  const beat = transcriptFirstStoryBeat(transcript);
  if (beat)
    return trimToSentence(beat.replace(/^imagine\s+/i, "").replace(/^this\s+(movie|anime|clip)\s+/i, ""), isTikTokTarget ? 150 : 95);

  const fallbackGenre = cleanText(genre) || "Faceless recap";
  return isTikTokTarget ? `${fallbackGenre} recap` : `${fallbackGenre} recap`;
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
  const repairedTitle = isGenericAutomationTitle(title)
    ? transcriptTitleFromContext({ transcript, sourceTitle, genre, isTikTokTarget })
    : trimToSentence(title, isTikTokTarget ? 150 : 95);
  const repairedDescription = !description || isGenericAutomationTitle(description)
    ? transcriptDescriptionFromContext({ transcript, summary: sourceSummary, sourceTitle, tags, isTikTokTarget })
    : description.slice(0, isTikTokTarget ? 2200 : 4500);
  return {
    ...data,
    title: repairedTitle,
    description: repairedDescription,
    metadataRepaired: repairedTitle !== title || repairedDescription !== description,
  };
}

