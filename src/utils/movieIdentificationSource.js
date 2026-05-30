export function resolveMovieIdentificationSource(result = {}, pipelineSource = "") {
  const hint = result.commentHint || {};
  const hintSource = String(hint.source || "").trim();
  const hintFormat = String(hint.format || "").trim();
  const reasoning = String(result.evidence?.reasoning || "").trim();

  if (hintFormat === "comment_corpus_tmdb" || hintSource === "comment_corpus_tmdb" || /\bcomment corpus\b/i.test(reasoning)) {
    return "comment-corpus";
  }
  if (
    hintSource === "comment_reply"
    || hintFormat
    || pipelineSource === "tiktok-comments"
    || /\btiktok comment reply\b/i.test(reasoning)
  ) {
    return "comment-reply";
  }
  if (pipelineSource === "movie-cache") {
    return "cache";
  }
  if (/^tiktok-comments$/i.test(pipelineSource)) {
    return "comment-reply";
  }
  if (pipelineSource && !/^movie-cache$/i.test(pipelineSource)) {
    return "ai-video";
  }
  if (result.sourceVerification?.provider && hint.replyText) {
    return "comment-reply";
  }
  return pipelineSource === "movie-cache" ? "cache" : "ai-video";
}

export function movieIdentificationSourceMeta(source = "") {
  switch (source) {
    case "comment-reply":
      return {
        label: "Comment agent",
        detail: "Title matched from a TikTok comment reply",
        tone: "comment",
      };
    case "comment-corpus":
      return {
        label: "Comment + database",
        detail: "Inferred from TikTok comment corpus and TMDB/MAL",
        tone: "corpus",
      };
    case "cache":
      return {
        label: "Cached result",
        detail: "Reused from a previous Movie ID lookup",
        tone: "cache",
      };
    case "ai-video":
    default:
      return {
        label: "AI video scan",
        detail: "Gemini analyzed the downloaded clip",
        tone: "ai",
      };
  }
}

export function attachMovieIdentificationSource(result = {}, pipelineSource = "") {
  if (!result || typeof result !== "object" || !String(result.title || "").trim()) {
    return result;
  }
  const identificationSource = resolveMovieIdentificationSource(result, pipelineSource);
  const meta = movieIdentificationSourceMeta(identificationSource);
  return {
    ...result,
    identificationSource,
    identificationSourceLabel: meta.label,
    identificationSourceDetail: meta.detail,
  };
}

export function getMovieIdentificationSourceDisplay(result = {}, pipelineSource = "") {
  if (result?.identificationSourceLabel) {
    return {
      source: result.identificationSource || resolveMovieIdentificationSource(result, pipelineSource),
      label: result.identificationSourceLabel,
      detail: result.identificationSourceDetail || movieIdentificationSourceMeta(result.identificationSource).detail,
    };
  }
  const source = resolveMovieIdentificationSource(result, pipelineSource);
  const meta = movieIdentificationSourceMeta(source);
  return { source, label: meta.label, detail: meta.detail };
}
