export function normalizeShortsTargetSeconds(value, fallback = 150) {
  return Math.min(179, Math.max(60, Number(value) || fallback));
}

export const SHORTS_TRIM_TOLERANCE_SECONDS = 10;

export function shortsTrimWindow(targetSeconds, toleranceSeconds = SHORTS_TRIM_TOLERANCE_SECONDS) {
  const target = normalizeShortsTargetSeconds(targetSeconds);
  const tolerance = Math.min(30, Math.max(0, Number(toleranceSeconds) || 0));
  return {
    targetSeconds: target,
    toleranceSeconds: tolerance,
    minSeconds: Math.max(1, target - tolerance),
    maxSeconds: Math.min(179, target + tolerance),
  };
}

export function shortsTrimRequired(durationSeconds, targetSeconds, toleranceSeconds = SHORTS_TRIM_TOLERANCE_SECONDS) {
  const duration = Number(durationSeconds) || 0;
  return duration <= 0 || duration > shortsTrimWindow(targetSeconds, toleranceSeconds).maxSeconds;
}

function cleanSegments(value) {
  return (Array.isArray(value) ? value : []).map((segment) => ({
    start: Math.max(0, Number(segment?.start) || 0),
    end: Math.max(0, Number(segment?.end) || 0),
    text: String(segment?.text || "").replace(/\s+/g, " ").trim(),
  })).filter((segment) => segment.text && segment.end > segment.start);
}

function transcriptEndingScore(segment, contextText, targetSeconds) {
  const end = Number(segment?.end) || 0;
  const text = String(segment?.text || "");
  const context = String(contextText || "").toLowerCase();
  const secondsFromTarget = end - targetSeconds;
  const distanceFromTarget = Math.abs(secondsFromTarget);
  const breakdown = {
    proximity: Math.max(0, Math.round(100 - distanceFromTarget * 6)),
    sentenceBoundary: /[.!?]\s*$/.test(text) ? 24 : /[,;:]\s*$/.test(text) ? 4 : -18,
    storyResolution: /\b(finally|at last|revealed|realized|discovered|escaped|defeated|won|lost|saved|survived|returned|decided|accepted|completed|finished|ended|victory|safe)\b/i.test(context) ? 18 : 0,
    suspenseBeat: /\?\s*$/.test(text) || /\b(secret|truth|real identity|too late|never expected|was not over|only beginning)\b/i.test(text) ? 8 : 0,
    danglingClause: /\b(and|but|because|when|while|although|however|before|until|if|then|to|the|a|an|his|her|their|with|without|from|into|of|for|as)\s*[,;:]?\s*$/i.test(text) ? -34 : 0,
    callToAction: /\b(part\s*\d+|follow for|follow to|subscribe|like and follow|comment below|what happens next)\b/i.test(context) ? -55 : 0,
  };
  const score = Object.values(breakdown).reduce((sum, value) => sum + value, 0);
  const factors = [];
  if (breakdown.sentenceBoundary > 0) factors.push("complete_sentence");
  if (breakdown.storyResolution > 0) factors.push("story_resolution");
  if (breakdown.suspenseBeat > 0) factors.push("suspense_beat");
  if (breakdown.danglingClause < 0) factors.push("dangling_clause");
  if (breakdown.callToAction < 0) factors.push("call_to_action");
  return { score, breakdown, factors, secondsFromTarget, distanceFromTarget };
}

export function chooseShortsTrimPoint(segments, durationSeconds, targetLengthSeconds = 150, toleranceSeconds = SHORTS_TRIM_TOLERANCE_SECONDS) {
  const trimWindow = shortsTrimWindow(targetLengthSeconds, toleranceSeconds);
  const knownDuration = Number(durationSeconds) || 0;
  const durationLimit = knownDuration > 0 ? Math.min(179, Math.max(1, knownDuration - 0.1)) : trimWindow.maxSeconds;
  const allowedMaxSeconds = Math.min(trimWindow.maxSeconds, durationLimit);
  const allowedMinSeconds = Math.min(allowedMaxSeconds, trimWindow.minSeconds);
  const transcriptSegments = cleanSegments(segments);
  const candidates = transcriptSegments.map((segment, index) => ({ segment, index }))
    .filter(({ segment }) => segment.end >= allowedMinSeconds && segment.end <= allowedMaxSeconds);
  const scored = candidates.map(({ segment, index }) => {
    const previous = transcriptSegments.slice(Math.max(0, index - 3), index).map((item) => item.text).join(" ");
    const contextText = `${previous} ${segment.text}`.trim();
    const evaluation = transcriptEndingScore(segment, contextText, trimWindow.targetSeconds);
    return {
      cutAtSeconds: Math.min(allowedMaxSeconds, segment.end + 0.1),
      score: evaluation.score,
      reason: "smart_transcript_score",
      context: contextText.slice(-500),
      decision: {
        ending: segment.text.slice(-240),
        secondsFromTarget: Math.round(evaluation.secondsFromTarget * 100) / 100,
        distanceFromTarget: Math.round(evaluation.distanceFromTarget * 100) / 100,
        factors: evaluation.factors,
        breakdown: evaluation.breakdown,
      },
    };
  }).sort((left, right) => right.score - left.score || right.cutAtSeconds - left.cutAtSeconds);
  if (scored.length) {
    const [best, ...rest] = scored;
    return {
      ...best,
      transcriptScored: true,
      trimWindow: { ...trimWindow, minSeconds: allowedMinSeconds, maxSeconds: allowedMaxSeconds },
      alternatives: rest.slice(0, 3).map((item) => ({
        cutAtSeconds: item.cutAtSeconds,
        score: item.score,
        ending: item.decision.ending,
        factors: item.decision.factors,
      })),
    };
  }
  const fallbackCut = Math.max(allowedMinSeconds, Math.min(trimWindow.targetSeconds, allowedMaxSeconds));
  return {
    cutAtSeconds: fallbackCut,
    score: 0,
    reason: "duration_limit",
    context: "",
    transcriptScored: false,
    trimWindow: { ...trimWindow, minSeconds: allowedMinSeconds, maxSeconds: allowedMaxSeconds },
    decision: null,
    alternatives: [],
  };
}
