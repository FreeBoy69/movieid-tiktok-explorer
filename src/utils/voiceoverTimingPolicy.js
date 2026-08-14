const DEFAULT_TTS_CHUNK_CHARS = 1000;

export const VOICEOVER_SILENCE_FILTER = [
  "silenceremove=start_periods=1",
  "start_duration=0.06",
  "start_threshold=-48dB",
  "start_silence=0.035",
  "stop_periods=-1",
  "stop_duration=0.28",
  "stop_threshold=-48dB",
  "stop_silence=0.12",
  "detection=rms",
  "window=0.02",
].join(":") + ",areverse,silenceremove=start_periods=1:start_duration=0.05:start_threshold=-48dB:start_silence=0.035:detection=rms:window=0.02,areverse";

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(Number(value) || 0, minimum), maximum);
}

export function voiceoverWordCount(text) {
  return (String(text || "").match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) || []).length;
}

export function voiceoverWordCountBounds(textOrCount, tolerance = 0.1) {
  const target = typeof textOrCount === "number" ? Math.max(0, Math.round(textOrCount)) : voiceoverWordCount(textOrCount);
  const spread = Math.max(1, Math.ceil(target * clamp(tolerance, 0.03, 0.25)));
  return { target, minimum: Math.max(0, target - spread), maximum: target + spread };
}

export function voiceoverWordCountMatches(sourceText, rewrittenText, tolerance = 0.1) {
  const bounds = voiceoverWordCountBounds(sourceText, tolerance);
  const actual = voiceoverWordCount(rewrittenText);
  return { ...bounds, actual, matches: actual >= bounds.minimum && actual <= bounds.maximum };
}

function normalizeTranscriptWord(word) {
  const start = Math.max(0, Number(word?.start) || 0);
  const end = Math.max(start, Number(word?.end) || start);
  const text = String(word?.word || word?.text || "").replace(/\s+/g, " ").trim();
  return text && end > start ? { start, end, text } : null;
}

function transcriptUtterances(segment, options = {}) {
  const segmentStart = Math.max(0, Number(segment?.start) || 0);
  const segmentEnd = Math.max(segmentStart, Number(segment?.end) || segmentStart);
  const segmentText = String(segment?.text || "").replace(/\s+/g, " ").trim();
  if (!segmentText || segmentEnd <= segmentStart) return [];
  const words = (Array.isArray(segment?.words) ? segment.words : [])
    .map(normalizeTranscriptWord)
    .filter(Boolean)
    .sort((left, right) => left.start - right.start);
  const maxUtteranceSeconds = clamp(options.maxUtteranceSeconds || 10, 2, 18);
  const maxUtteranceWords = Math.round(clamp(options.maxUtteranceWords || 24, 3, 40));
  const pauseBoundarySeconds = clamp(options.pauseBoundarySeconds || 0.72, 0.35, 2);
  if (words.length) {
    const utterances = [];
    let current = [];
    const push = () => {
      if (!current.length) return;
      utterances.push({
        start: current[0].start,
        end: current.at(-1).end,
        text: current.map((word) => word.text).join(" ").replace(/\s+([,.;!?])/g, "$1").trim(),
      });
      current = [];
    };
    for (const word of words) {
      const previous = current.at(-1);
      const pause = previous ? Math.max(0, word.start - previous.end) : 0;
      if (current.length && (pause >= pauseBoundarySeconds || word.end - current[0].start > maxUtteranceSeconds || current.length >= maxUtteranceWords)) push();
      current.push(word);
      if (/[.!?][\"'’”)]*$/.test(word.text)) push();
    }
    push();
    return utterances;
  }
  const sentences = segmentText.split(/(?<=[.!?])\s+/).map((part) => part.trim()).filter(Boolean);
  if (sentences.length <= 1) return [{ start: segmentStart, end: segmentEnd, text: segmentText }];
  const totalWords = Math.max(voiceoverWordCount(segmentText), sentences.length);
  let cursor = segmentStart;
  return sentences.map((text, index) => {
    const remaining = segmentEnd - cursor;
    const end = index === sentences.length - 1
      ? segmentEnd
      : Math.min(segmentEnd, cursor + (segmentEnd - segmentStart) * (voiceoverWordCount(text) / totalWords));
    const utterance = { start: cursor, end: Math.max(cursor + Math.min(0.1, remaining), end), text };
    cursor = utterance.end;
    return utterance;
  }).filter((utterance) => utterance.end > utterance.start);
}

export function buildTimedVoiceoverSegments(segments, options = {}) {
  const normalized = (Array.isArray(segments) ? segments : [])
    .flatMap((segment) => transcriptUtterances(segment, options))
    .filter((segment) => segment.text && segment.end > segment.start)
    .sort((left, right) => left.start - right.start);
  if (!normalized.length) return [];
  const maxWindowSeconds = clamp(options.maxWindowSeconds || 14, 4, 24);
  const maxWords = Math.round(clamp(options.maxWords || 32, 8, 60));
  const sceneGapSeconds = clamp(options.sceneGapSeconds || 1.15, 0.35, 4);
  const result = [];
  let current = null;
  const pushCurrent = () => {
    if (!current) return;
    const text = current.parts.map((part) => part.text).join(" ").replace(/\s+/g, " ").trim();
    result.push({
      index: result.length,
      start: current.start,
      end: current.end,
      duration: current.end - current.start,
      text,
      wordCount: voiceoverWordCount(text),
      sourceSegmentCount: current.parts.length,
    });
    current = null;
  };
  if (options.preserveUtteranceBoundaries === true) {
    return normalized.map((segment, index) => ({
      index,
      start: segment.start,
      end: segment.end,
      duration: segment.end - segment.start,
      text: segment.text,
      wordCount: voiceoverWordCount(segment.text),
      sourceSegmentCount: 1,
    }));
  }
  for (const segment of normalized) {
    if (!current) {
      current = { start: segment.start, end: segment.end, parts: [segment] };
      continue;
    }
    const gap = Math.max(0, segment.start - current.end);
    const proposedDuration = segment.end - current.start;
    const proposedWords = voiceoverWordCount(current.parts.map((part) => part.text).join(" ")) + voiceoverWordCount(segment.text);
    if (gap >= sceneGapSeconds || proposedDuration > maxWindowSeconds || proposedWords > maxWords) {
      pushCurrent();
      current = { start: segment.start, end: segment.end, parts: [segment] };
    }
    else {
      current.end = Math.max(current.end, segment.end);
      current.parts.push(segment);
    }
  }
  pushCurrent();
  return result;
}

export function allocateTimedVoiceoverWindows(scenes, sourceDuration, options = {}) {
  const normalized = (Array.isArray(scenes) ? scenes : []).map((scene) => ({ ...scene }));
  const mediaEnd = Math.max(Number(sourceDuration) || 0, normalized.at(-1)?.end || 0);
  const maxExtensionSeconds = clamp(options.maxExtensionSeconds ?? 2.5, 0, 5);
  const nextSceneGuardSeconds = clamp(options.nextSceneGuardSeconds ?? 0.08, 0.02, 0.5);
  return normalized.map((scene, index) => {
    const sourceSpeechEnd = Math.max(Number(scene.end) || 0, Number(scene.start) || 0);
    const nextStart = Number(normalized[index + 1]?.start);
    const hardEnd = Number.isFinite(nextStart)
      ? Math.max(sourceSpeechEnd, nextStart - nextSceneGuardSeconds)
      : mediaEnd;
    const end = Math.min(hardEnd, sourceSpeechEnd + maxExtensionSeconds, mediaEnd);
    return {
      ...scene,
      sourceSpeechEnd,
      end,
      duration: Math.max(0, end - (Number(scene.start) || 0)),
    };
  });
}

function hardSplitText(text, maxChars) {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean);
  const chunks = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxChars && current) {
      chunks.push(current);
      current = word;
    }
    else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

export function splitVoiceoverText(text, maxChars = DEFAULT_TTS_CHUNK_CHARS) {
  const limit = clamp(maxChars, 240, 4800);
  const paragraphs = String(text || "")
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const units = paragraphs.flatMap((paragraph) => paragraph
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean));
  const chunks = [];
  let current = "";
  for (const unit of units) {
    if (unit.length > limit) {
      if (current) {
        chunks.push(current);
        current = "";
      }
      chunks.push(...hardSplitText(unit, limit));
      continue;
    }
    const candidate = current ? `${current} ${unit}` : unit;
    if (candidate.length > limit && current) {
      chunks.push(current);
      current = unit;
    }
    else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

export function chooseVoiceCloneSampleWindow(segments, options = {}) {
  const normalized = (Array.isArray(segments) ? segments : [])
    .map((segment) => ({
      start: Math.max(0, Number(segment?.start) || 0),
      end: Math.max(0, Number(segment?.end) || 0),
      text: String(segment?.text || "").replace(/\s+/g, " ").trim(),
    }))
    .filter((segment) => segment.text && segment.end > segment.start)
    .sort((a, b) => a.start - b.start);
  if (!normalized.length) return null;
  const maxSeconds = clamp(options.maxSeconds || 30, 5, 45);
  const minSeconds = clamp(options.minSeconds || 8, 3, maxSeconds);
  const mediaDuration = Math.max(Number(options.mediaDuration) || 0, normalized.at(-1).end);
  let best = null;
  for (let first = 0; first < normalized.length; first += 1) {
    let speechSeconds = 0;
    let characterCount = 0;
    for (let last = first; last < normalized.length; last += 1) {
      const start = Math.max(0, normalized[first].start - 0.12);
      const end = Math.min(mediaDuration, normalized[last].end + 0.12);
      const duration = end - start;
      if (duration > maxSeconds) break;
      speechSeconds += normalized[last].end - normalized[last].start;
      characterCount += normalized[last].text.length;
      if (duration < minSeconds) continue;
      const speechRatio = speechSeconds / Math.max(duration, 0.001);
      const score = speechRatio * 100 + Math.min(characterCount, 600) / 30 + Math.min(duration, 22) / 10;
      if (!best || score > best.score) {
        best = {
          start,
          end,
          duration,
          speechSeconds,
          speechRatio,
          characterCount,
          score,
          text: normalized.slice(first, last + 1).map((segment) => segment.text).join(" "),
        };
      }
    }
  }
  if (best) return best;
  const first = normalized[0];
  return {
    start: Math.max(0, first.start - 0.12),
    end: Math.min(mediaDuration, Math.max(first.end + 0.12, first.start + minSeconds)),
    duration: Math.min(maxSeconds, Math.max(minSeconds, first.end - first.start + 0.24)),
    speechSeconds: first.end - first.start,
    speechRatio: (first.end - first.start) / Math.max(minSeconds, first.end - first.start + 0.24),
    characterCount: first.text.length,
    score: 0,
    text: first.text,
  };
}

export function buildAtempoChain(factor) {
  let remaining = Math.max(Number(factor) || 1, 0.01);
  const filters = [];
  while (remaining > 2) {
    filters.push("atempo=2");
    remaining /= 2;
  }
  while (remaining < 0.5) {
    filters.push("atempo=0.5");
    remaining /= 0.5;
  }
  if (Math.abs(remaining - 1) > 0.0005 || !filters.length) {
    filters.push(`atempo=${remaining.toFixed(6).replace(/0+$/, "").replace(/\.$/, "")}`);
  }
  return filters;
}

export function planVoiceoverTiming(voiceDuration, videoDuration, options = {}) {
  const voiceSeconds = Math.max(Number(voiceDuration) || 0, 0);
  const videoSeconds = Math.max(Number(videoDuration) || 0, 0);
  const startPaddingSeconds = clamp(options.startPaddingSeconds || 0, 0, Math.max(videoSeconds - 0.1, 0));
  const endPaddingSeconds = clamp(options.endPaddingSeconds ?? 0.08, 0, Math.max(videoSeconds - startPaddingSeconds, 0));
  const targetSpeechSeconds = Math.max(videoSeconds - startPaddingSeconds - endPaddingSeconds, 0.1);
  const requiredTempo = voiceSeconds / targetSpeechSeconds;
  const minimumTempo = clamp(options.minimumTempo || 0.9, 0.5, 1);
  const maximumTempo = clamp(options.maximumTempo || 1.3, 1, 2);
  const tempo = clamp(requiredTempo || 1, minimumTempo, maximumTempo);
  const fittedSpeechSeconds = voiceSeconds / Math.max(tempo, 0.001);
  const overflowSeconds = Math.max(0, fittedSpeechSeconds - targetSpeechSeconds);
  const trailingPadSeconds = Math.max(0, targetSpeechSeconds - fittedSpeechSeconds) + endPaddingSeconds;
  const finalDurationSeconds = startPaddingSeconds + Math.min(fittedSpeechSeconds, targetSpeechSeconds) + trailingPadSeconds;
  return {
    voiceDurationSeconds: voiceSeconds,
    videoDurationSeconds: videoSeconds,
    targetSpeechSeconds,
    startPaddingSeconds,
    endPaddingSeconds,
    requiredTempo,
    tempo,
    fittedSpeechSeconds,
    trailingPadSeconds,
    overflowSeconds,
    finalDurationSeconds,
    spokenCoverage: fittedSpeechSeconds / Math.max(targetSpeechSeconds, 0.001),
    fits: videoSeconds > 0 && voiceSeconds > 0 && overflowSeconds <= 0.08,
  };
}

export function buildSourceVoiceProfileDescription(uploadId) {
  const safeId = String(uploadId || "").replace(/[\]\r\n]/g, "").trim().slice(0, 160);
  return `Created from an authorized AutoYT upload [autoyt-source:${safeId}]`;
}

export function sourceUploadIdFromProfile(profile) {
  const description = String(profile?.description || "");
  return description.match(/\[autoyt-source:([^\]]+)\]/i)?.[1]?.trim() || "";
}
