const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_TOP_PERFORMER_LIMIT = 10;
const MINIMUM_LEARNING_SAMPLE = 3;

function cleanInlineText(value = "") {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanDescription(value = "") {
  return String(value || "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[\t ]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function finiteNonNegative(value = 0) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

function round(value, precision = 2) {
  const factor = 10 ** precision;
  return Math.round(Number(value || 0) * factor) / factor;
}

function median(values = []) {
  const sorted = values
    .map((value) => Number(value || 0))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function titleLengthBand(length = 0) {
  if (length <= 40) return "compact";
  if (length <= 65) return "balanced";
  return "detailed";
}

function descriptionLengthBand(length = 0) {
  if (length <= 220) return "concise";
  if (length <= 850) return "standard";
  return "detailed";
}

function titleFraming(title = "") {
  const text = cleanInlineText(title);
  const lower = text.toLowerCase();
  if (/\?$/.test(text)) return "question";
  if (/^how\s+to\b/i.test(text)) return "how-to";
  if (/^(?:#?\d+\b|top\s+\d+\b|\d+\s+(?:ways|reasons|things|facts|tips|rules)\b)/i.test(text)) return "number-led";
  if (/^(?:when|after|before|until|if|while|as)\b/i.test(text)) return "story-turn";
  if (/^(?:why|how|what|where|who|can|does|did|is|are|will|would|should)\b/i.test(text)) return "question";
  if (/\b(?:but|until|after|before|when|instead|finally|then)\b/i.test(lower)) return "story-turn";
  if (/\b(?:secret|truth|hidden|reveal(?:ed|s)?|uncover(?:ed|s)?|exposed|never knew|what happens)\b/i.test(lower)) return "reveal";
  return "direct";
}

function titlePunctuation(title = "") {
  const text = cleanInlineText(title);
  if (text.includes("?")) return "question-mark";
  if (text.includes("!")) return "exclamation";
  if (text.includes(":")) return "colon";
  if (/[—–-]/.test(text)) return "dash";
  return "minimal";
}

function titleWords(title = "") {
  return cleanInlineText(title).match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)?.length || 0;
}

function normalizedTokens(value = "") {
  return cleanInlineText(value)
    .toLowerCase()
    .match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)?.filter((token) => token.length >= 3) || [];
}

function titleOverlap(title = "", line = "") {
  const titleTokens = new Set(normalizedTokens(title));
  const lineTokens = new Set(normalizedTokens(line));
  if (!titleTokens.size || !lineTokens.size) return 0;
  let matches = 0;
  for (const token of titleTokens) {
    if (lineTokens.has(token)) matches += 1;
  }
  return matches / Math.max(1, Math.min(titleTokens.size, lineTokens.size));
}

function descriptionOpening(title = "", description = "") {
  const firstLine = cleanDescription(description).split("\n").find(Boolean) || "";
  if (!firstLine) return "";
  if (/\?$/.test(firstLine) || /^(?:why|how|what|when|where|who|can|does|did|is|are|will|would|should)\b/i.test(firstLine))
    return "question-hook";
  if (titleOverlap(title, firstLine) >= 0.6) return "title-led";
  if (/^(?:watch|discover|learn|see|find out|follow|join)\b/i.test(firstLine)) return "directive-hook";
  return "context-led";
}

function descriptionLayout(description = "") {
  const paragraphs = cleanDescription(description)
    .split(/\n\s*\n/)
    .map((paragraph) => cleanInlineText(paragraph))
    .filter(Boolean);
  return paragraphs.length >= 2 ? "multi-paragraph" : "single-paragraph";
}

function descriptionHashtagLayout(description = "") {
  const text = cleanDescription(description);
  const hashtags = text.match(/#[\p{L}\p{N}_-]+/gu) || [];
  if (!hashtags.length) return "";
  const tail = text.slice(-Math.min(320, text.length));
  return (tail.match(/#[\p{L}\p{N}_-]+/gu) || []).length >= Math.max(1, Math.ceil(hashtags.length / 2))
    ? "end-of-description"
    : "inline";
}

function descriptionEndsWithCta(description = "") {
  const tail = cleanDescription(description).slice(-360);
  return /\b(?:subscribe|follow|like|comment|share|watch next|watch more|join)\b/i.test(tail);
}

function descriptionWords(description = "") {
  return normalizedTokens(description).length;
}

/**
 * Returns only structural metadata features. It intentionally excludes the source wording,
 * so callers can learn a channel style without copying old titles or descriptions.
 */
export function metadataStyleSignatureFor(video = {}) {
  const title = cleanInlineText(video.title || "");
  const description = cleanDescription(video.description || "");
  const firstLine = description.split("\n").find(Boolean) || "";
  return {
    title: {
      characterCount: title.length,
      wordCount: titleWords(title),
      lengthBand: titleLengthBand(title.length),
      framing: titleFraming(title),
      punctuation: titlePunctuation(title),
      usesNumber: /\b\d+\b/.test(title),
    },
    description: {
      characterCount: description.length,
      wordCount: descriptionWords(description),
      lengthBand: description ? descriptionLengthBand(description.length) : "",
      opening: descriptionOpening(title, description),
      layout: description ? descriptionLayout(description) : "",
      hashtagLayout: descriptionHashtagLayout(description),
      endsWithCta: descriptionEndsWithCta(description),
      hasDescription: Boolean(description),
      firstLineCharacterCount: firstLine.length,
    },
  };
}

function publishedAtMs(value, now) {
  const parsed = new Date(value || "").getTime();
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > now + DAY_MS)
    return null;
  return parsed;
}

function normalizeVideo(video = {}, index, now) {
  const title = cleanInlineText(video.title || "");
  if (!title) return null;
  const description = cleanDescription(video.description || "");
  const viewCount = finiteNonNegative(video.viewCount ?? video.views);
  const likeCount = finiteNonNegative(video.likeCount ?? video.likes);
  const commentCount = finiteNonNegative(video.commentCount ?? video.comments);
  const publishedAt = publishedAtMs(video.publishedAt || video.createdAt, now);
  const ageDays = publishedAt ? Math.max(1, (now - publishedAt) / DAY_MS) : 30;
  // A seven-day floor prevents a just-published video from winning solely because its
  // denominator is tiny; the 90-day cap prevents old lifetime views from dominating.
  const matureAgeDays = Math.min(Math.max(ageDays, 7), 90);
  const viewsPerMatureDay = viewCount / matureAgeDays;
  const engagementRate = (likeCount + commentCount) / Math.max(viewCount, 1);
  const engagementMultiplier = 1 + Math.min(0.25, engagementRate) * 1.5;
  const performanceScore = viewsPerMatureDay * engagementMultiplier;
  return {
    id: String(video.id || video.videoId || `video-${index}`),
    title,
    description,
    viewCount,
    likeCount,
    commentCount,
    publishedAt: publishedAt ? new Date(publishedAt).toISOString() : "",
    ageDays: round(ageDays, 1),
    matureAgeDays: round(matureAgeDays, 1),
    viewsPerMatureDay: round(viewsPerMatureDay, 2),
    engagementRate: round(engagementRate, 4),
    performanceScore: round(performanceScore, 2),
    signature: metadataStyleSignatureFor({ title, description }),
  };
}

function priorityDefinition(area, kind, value) {
  const labels = {
    title: {
      length: {
        compact: "Keep titles compact (up to 40 characters).",
        balanced: "Aim for balanced titles (41–65 characters).",
        detailed: "Use detailed but focused titles (66+ characters, within the platform limit).",
      },
      framing: {
        question: "Use a clear question-led hook when the clip genuinely supports it.",
        "how-to": "Lead with a practical how-to framing when the clip teaches a real action.",
        "number-led": "Use a number-led list frame only when the clip naturally has countable points.",
        "story-turn": "Frame the title around the story turn, reversal, or consequence.",
        reveal: "Frame the title around a truthful reveal or payoff.",
        direct: "Use a clear, direct headline instead of a vague teaser.",
      },
      punctuation: {
        "question-mark": "Use a question mark only for a real, answerable hook.",
        exclamation: "Use a single exclamation point sparingly when the claim is supported.",
        colon: "Use a colon to separate the subject from a specific payoff.",
        dash: "Use a dash to set up a concise turn or payoff.",
        minimal: "Keep title punctuation minimal and readable.",
      },
    },
    description: {
      length: {
        concise: "Keep descriptions concise (up to 220 characters).",
        standard: "Use a standard description length (221–850 characters).",
        detailed: "Use a detailed description with useful context (850+ characters).",
      },
      opening: {
        "question-hook": "Open the description with a truthful question hook.",
        "title-led": "Open by extending the title with useful context.",
        "directive-hook": "Open with a clear, relevant action or discovery cue.",
        "context-led": "Open with direct story or topic context.",
      },
      layout: {
        "multi-paragraph": "Use a scannable multi-paragraph description layout.",
        "single-paragraph": "Keep the description as one focused paragraph.",
      },
      hashtags: {
        "end-of-description": "Place a restrained set of relevant hashtags at the end of the description.",
        inline: "Integrate any necessary hashtags naturally rather than leading with them.",
      },
      cta: {
        "end-of-description": "End with a light, relevant viewer call to action.",
      },
    },
  };
  return labels?.[area]?.[kind]?.[value] || "";
}

function featureRowsForSignature(signature = {}, area) {
  if (area === "title") {
    return [
      { kind: "length", value: signature.title?.lengthBand },
      { kind: "framing", value: signature.title?.framing },
      { kind: "punctuation", value: signature.title?.punctuation },
    ].filter((row) => row.value);
  }
  if (!signature.description?.hasDescription) return [];
  const rows = [
    { kind: "length", value: signature.description.lengthBand },
    { kind: "opening", value: signature.description.opening },
    { kind: "layout", value: signature.description.layout },
  ];
  if (signature.description.hashtagLayout)
    rows.push({ kind: "hashtags", value: signature.description.hashtagLayout });
  if (signature.description.endsWithCta)
    rows.push({ kind: "cta", value: "end-of-description" });
  return rows.filter((row) => row.value);
}

function buildPriorities(performers = [], area) {
  const eligible = area === "description"
    ? performers.filter((performer) => performer.signature.description?.hasDescription)
    : performers;
  if (!eligible.length) return [];
  const totalScore = Math.max(1, eligible.reduce((sum, performer) => sum + performer.performanceScore, 0));
  const grouped = new Map();
  for (const performer of eligible) {
    for (const feature of featureRowsForSignature(performer.signature, area)) {
      const key = `${feature.kind}:${feature.value}`;
      const current = grouped.get(key) || {
        kind: feature.kind,
        value: feature.value,
        count: 0,
        weightedScore: 0,
      };
      current.count += 1;
      current.weightedScore += performer.performanceScore;
      grouped.set(key, current);
    }
  }
  const minimumSupport = eligible.length >= 6 ? 3 : 2;
  const minimumShare = eligible.length >= 6 ? 0.5 : 0.67;
  return [...grouped.values()]
    .map((row) => {
      const share = row.count / eligible.length;
      const weightedShare = row.weightedScore / totalScore;
      return {
        id: `${area}.${row.kind}.${row.value}`,
        kind: row.kind,
        value: row.value,
        label: priorityDefinition(area, row.kind, row.value),
        count: row.count,
        share: round(share, 2),
        weightedShare: round(weightedShare, 2),
        consistencyScore: round(share * 0.7 + weightedShare * 0.3, 3),
      };
    })
    .filter((row) => row.label)
    .filter((row) => row.count >= minimumSupport && row.share >= minimumShare)
    .sort((a, b) => b.consistencyScore - a.consistencyScore || b.count - a.count || a.id.localeCompare(b.id))
    .slice(0, area === "description" ? 5 : 3);
}

function confidenceFor(performers = [], priorities = []) {
  if (performers.length < MINIMUM_LEARNING_SAMPLE) return { level: "insufficient", score: 0 };
  const averageConsistency = priorities.length
    ? priorities.reduce((sum, priority) => sum + priority.consistencyScore, 0) / priorities.length
    : 0;
  const score = Math.min(0.95, round(0.25 + performers.length / DEFAULT_TOP_PERFORMER_LIMIT * 0.3 + averageConsistency * 0.5, 2));
  return {
    level: score >= 0.75 ? "high" : score >= 0.55 ? "medium" : "low",
    score,
  };
}

function compactTopPerformer(performer, rank) {
  return {
    rank,
    id: performer.id,
    viewCount: Math.round(performer.viewCount),
    likeCount: Math.round(performer.likeCount),
    commentCount: Math.round(performer.commentCount),
    publishedAt: performer.publishedAt,
    ageDays: performer.ageDays,
    viewsPerMatureDay: performer.viewsPerMatureDay,
    engagementRate: performer.engagementRate,
    performanceScore: performer.performanceScore,
    metadataSignature: performer.signature,
  };
}

/**
 * Builds a compact, evidence-based metadata direction from a channel's best recent videos.
 * The result deliberately exposes structural signatures instead of the original text.
 */
export function buildChannelMetadataStyleProfile(videos = [], options = {}) {
  const now = Number(options.now || Date.now());
  const topLimit = Math.min(Math.max(Number(options.topLimit) || DEFAULT_TOP_PERFORMER_LIMIT, 3), 20);
  const normalized = (Array.isArray(videos) ? videos : [])
    .map((video, index) => normalizeVideo(video, index, now))
    .filter(Boolean);
  const withPerformance = normalized.filter((video) => video.viewCount > 0 || video.likeCount > 0 || video.commentCount > 0);
  const performers = [...withPerformance]
    .sort((a, b) => b.performanceScore - a.performanceScore
      || b.viewsPerMatureDay - a.viewsPerMatureDay
      || b.viewCount - a.viewCount
      || b.engagementRate - a.engagementRate
      || b.publishedAt.localeCompare(a.publishedAt)
      || a.id.localeCompare(b.id))
    .slice(0, topLimit);
  const enoughSamples = performers.length >= MINIMUM_LEARNING_SAMPLE;
  const titlePriorities = enoughSamples ? buildPriorities(performers, "title") : [];
  const descriptionPriorities = enoughSamples ? buildPriorities(performers, "description") : [];
  const priorities = [...titlePriorities, ...descriptionPriorities];
  const confidence = confidenceFor(performers, priorities);
  const hasReliableStyle = enoughSamples && priorities.length > 0;
  const reason = !normalized.length
    ? "No channel videos with usable titles were available for metadata-style learning."
    : !withPerformance.length
      ? "Channel videos do not yet have enough performance data for evidence-based metadata learning."
      : !enoughSamples
        ? "At least 3 channel videos with performance data are needed before metadata-style learning is used."
        : !hasReliableStyle
          ? "The top performers do not yet share a reliable title or description style, so saved preferences remain in control."
          : "Top performers show repeated structural metadata patterns that can guide the next upload.";
  const titleLengths = performers.map((performer) => performer.signature.title.characterCount);
  const descriptionPerformers = performers.filter((performer) => performer.signature.description.hasDescription);
  const descriptionLengths = descriptionPerformers.map((performer) => performer.signature.description.characterCount);
  return {
    version: 1,
    source: "top-performing-channel-videos",
    performanceMethod: "views-per-mature-day with a capped engagement adjustment",
    enabled: enoughSamples,
    apply: hasReliableStyle,
    reason,
    scope: {
      platform: String(options.platform || "youtube"),
      videoKind: String(options.videoKind || "all"),
    },
    scannedVideoCount: Number(options.scannedVideoCount || normalized.length),
    eligibleVideoCount: normalized.length,
    performanceVideoCount: withPerformance.length,
    sampleCount: performers.length,
    confidence,
    title: {
      sampleCount: performers.length,
      medianCharacterCount: Math.round(median(titleLengths)),
      characterRange: titleLengths.length ? { min: Math.min(...titleLengths), max: Math.max(...titleLengths) } : { min: 0, max: 0 },
      priorities: titlePriorities,
    },
    description: {
      sampleCount: descriptionPerformers.length,
      medianCharacterCount: Math.round(median(descriptionLengths)),
      characterRange: descriptionLengths.length ? { min: Math.min(...descriptionLengths), max: Math.max(...descriptionLengths) } : { min: 0, max: 0 },
      priorities: descriptionPriorities,
    },
    topPerformers: performers.map((performer, index) => compactTopPerformer(performer, index + 1)),
    guardrails: [
      "Match only high-confidence structure, never wording, subjects, hashtags, or descriptions from a prior video.",
      "Skip a learned pattern when it conflicts with the actual clip, platform rules, or factual accuracy.",
      "When apply is false, use the saved title-style preference instead of forcing a weak pattern.",
    ],
  };
}
