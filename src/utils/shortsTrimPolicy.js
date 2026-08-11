export function normalizeShortsTargetSeconds(value, fallback = 150) {
  return Math.min(179, Math.max(60, Number(value) || fallback));
}

export function shortsTrimRequired(durationSeconds, targetSeconds) {
  const duration = Number(durationSeconds) || 0;
  return duration <= 0 || duration > normalizeShortsTargetSeconds(targetSeconds);
}

function cleanSegments(value) {
  return (Array.isArray(value) ? value : []).map((segment) => ({
    start: Math.max(0, Number(segment?.start) || 0),
    end: Math.max(0, Number(segment?.end) || 0),
    text: String(segment?.text || "").replace(/\s+/g, " ").trim(),
  })).filter((segment) => segment.text && segment.end > segment.start);
}

function naturalEndingScore(segment, contextText, targetSeconds) {
  const end = Number(segment?.end) || 0;
  const text = String(segment?.text || "");
  const context = String(contextText || "").toLowerCase();
  let score = 80 - Math.max(0, targetSeconds - end) * 4;
  if (/[.!?]\s*$/.test(text)) score += 18;
  if (/\b(finally|revealed|escaped|won|lost|saved|survived|returned|decided|prepared)\b/i.test(context)) score += 8;
  if (/\b(part\s*\d+|follow for|subscribe|like and follow|what happens next)\b/i.test(context)) score -= 18;
  return score;
}

export function chooseShortsTrimPoint(segments, durationSeconds, targetLengthSeconds = 150) {
  const requestedTarget = normalizeShortsTargetSeconds(targetLengthSeconds);
  const knownDuration = Number(durationSeconds) || 0;
  const durationLimit = knownDuration > 0 ? Math.min(179, Math.max(1, knownDuration - 0.1)) : requestedTarget;
  const hardLimitSeconds = Math.min(requestedTarget, durationLimit);
  const naturalWindowSeconds = Math.min(12, Math.max(6, hardLimitSeconds * 0.2));
  const earliestNaturalCut = Math.max(1, hardLimitSeconds - naturalWindowSeconds);
  const candidates = cleanSegments(segments).filter((segment) => segment.end >= earliestNaturalCut && segment.end <= hardLimitSeconds);
  let best = null;
  candidates.forEach((segment, index) => {
    const previous = candidates.slice(Math.max(0, index - 3), index).map((item) => item.text).join(" ");
    const contextText = `${previous} ${segment.text}`.trim();
    const score = naturalEndingScore(segment, contextText, hardLimitSeconds);
    if (!best || score > best.score) {
      best = {
        cutAtSeconds: Math.min(hardLimitSeconds, segment.end + 0.1),
        score,
        reason: "transcript_arc_before_limit",
        context: contextText.slice(-500),
      };
    }
  });
  if (best) return best;
  return {
    cutAtSeconds: hardLimitSeconds,
    score: 0,
    reason: "duration_limit",
    context: "",
  };
}
