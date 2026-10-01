// Corrects a Whisper transcript against the script that was actually narrated.
// Whisper's word timings are kept; its spelling, casing and punctuation are
// replaced by the script's wherever the two line up. Captions then read like
// the writer intended ("Kubernetes", not "cooper netties") while staying on the
// narrator's clock. Inspired by MoneyPrinterTurbo's subtitle "correct" pass.

const MAX_WORDS = 3000;
const MATCH = 3, SIMILAR = 1, MISMATCH = -2, GAP = -1;

export const normalizeToken = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^\p{L}\p{N}']+/gu, "");

export function scriptTokens(script) {
  return String(script || "")
    // Dialogue speaker labels and stage directions are not spoken.
    .replace(/(^|\s)[A-Z][A-Z0-9_-]{0,30}(\s*\([^)]*\))?:(?=\s)/g, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .split(/\s+/)
    .map((raw) => ({ raw, key: normalizeToken(raw) }))
    .filter((token) => token.key);
}

export function transcriptWords(segments) {
  const words = [];
  (segments || []).forEach((segment, segmentIndex) => {
    const list = Array.isArray(segment.words) && segment.words.length
      ? segment.words.map((w) => ({ text: String(w.word ?? w.text ?? "").trim(), start: Number(w.start), end: Number(w.end) }))
      : String(segment.text || "").trim().split(/\s+/).filter(Boolean).map((text, i, all) => ({
          text,
          start: Number(segment.start) + ((Number(segment.end) - Number(segment.start)) * i) / all.length,
          end: Number(segment.start) + ((Number(segment.end) - Number(segment.start)) * (i + 1)) / all.length,
        }));
    for (const word of list) {
      const key = normalizeToken(word.text);
      if (key) words.push({ ...word, key, segmentIndex });
    }
  });
  return words;
}

// Bounded Levenshtein similarity in [0, 1].
export function similarity(a, b) {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const prev = new Array(b.length + 1), cur = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++)
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    for (let j = 0; j <= b.length; j++) prev[j] = cur[j];
  }
  return 1 - prev[b.length] / Math.max(a.length, b.length);
}

// Global alignment (Needleman-Wunsch) of transcript words to script words.
// Returns pairs [transcriptIndex | -1, scriptIndex | -1] in order.
export function alignWords(spoken, script) {
  const n = spoken.length, m = script.length;
  const width = m + 1;
  const score = new Int32Array((n + 1) * width);
  const move = new Uint8Array((n + 1) * width); // 0 diag, 1 up (skip spoken), 2 left (skip script)
  for (let i = 1; i <= n; i++) { score[i * width] = i * GAP; move[i * width] = 1; }
  for (let j = 1; j <= m; j++) { score[j] = j * GAP; move[j] = 2; }
  for (let i = 1; i <= n; i++) {
    const a = spoken[i - 1].key;
    for (let j = 1; j <= m; j++) {
      const b = script[j - 1].key;
      const pair = a === b ? MATCH : similarity(a, b) >= 0.6 ? SIMILAR : MISMATCH;
      const diag = score[(i - 1) * width + (j - 1)] + pair;
      const up = score[(i - 1) * width + j] + GAP;
      const left = score[i * width + (j - 1)] + GAP;
      const best = Math.max(diag, up, left);
      score[i * width + j] = best;
      move[i * width + j] = best === diag ? 0 : best === up ? 1 : 2;
    }
  }
  const pairs = [];
  let i = n, j = m;
  while (i > 0 || j > 0) {
    const step = i === 0 ? 2 : j === 0 ? 1 : move[i * width + j];
    if (step === 0) pairs.push([i - 1, j - 1]), i--, j--;
    else if (step === 1) pairs.push([i - 1, -1]), i--;
    else pairs.push([-1, j - 1]), j--;
  }
  return pairs.reverse();
}

// Returns { segments, text, matched, applied }. When the transcript and script
// disagree too much (a different take, a free ad-lib), the input is returned
// untouched with applied=false so captions never show text that was not said.
export function correctTranscript(segments, script, { minMatch = 0.55 } = {}) {
  const untouched = { segments, text: (segments || []).map((s) => String(s.text || "").trim()).filter(Boolean).join(" "), matched: 0, applied: false };
  const target = scriptTokens(script);
  const spoken = transcriptWords(segments);
  if (!target.length || !spoken.length || target.length > MAX_WORDS || spoken.length > MAX_WORDS) return untouched;
  const pairs = alignWords(spoken, target);
  let exact = 0;
  const corrected = spoken.map((word) => ({ ...word, text: "", keep: false }));
  let lastSpoken = -1;
  let pendingScript = [];
  let droppedStart = null;
  const flushPending = () => {
    // Script words Whisper never heard ride along with the previous spoken word,
    // unless there is a whole missing sentence, which is dropped instead.
    if (lastSpoken >= 0 && pendingScript.length && pendingScript.length <= 3)
      corrected[lastSpoken].text = `${corrected[lastSpoken].text} ${pendingScript.map((t) => t.raw).join(" ")}`.trim();
    pendingScript = [];
  };
  for (const [si, ti] of pairs) {
    if (si >= 0 && ti >= 0) {
      flushPending();
      if (spoken[si].key === target[ti].key) exact++;
      // "cooper netties" -> "Kubernetes": the dropped half lends its start time.
      else if (droppedStart !== null && Number.isFinite(droppedStart)) corrected[si].start = Math.min(corrected[si].start, droppedStart);
      droppedStart = null;
      corrected[si].text = target[ti].raw;
      corrected[si].keep = true;
      lastSpoken = si;
    } else if (ti >= 0) pendingScript.push(target[ti]);
    else {
      // A spoken word absent from the script (a stumble, a hallucination) is dropped.
      if (droppedStart === null) droppedStart = spoken[si].start;
      lastSpoken = lastSpoken >= 0 ? lastSpoken : si;
    }
  }
  flushPending();
  const matched = exact / spoken.length;
  if (matched < minMatch) return { ...untouched, matched };
  const out = (segments || []).map((segment) => ({ ...segment, words: [], text: "" }));
  for (const word of corrected) {
    if (!word.keep || !word.text) continue;
    const segment = out[word.segmentIndex];
    segment.words.push({ word: word.text, start: word.start, end: word.end });
    segment.text = segment.text ? `${segment.text} ${word.text}` : word.text;
  }
  const result = out.map((segment, index) => {
    const original = segments[index];
    if (!segment.text) return { ...original, text: String(original.text || "").trim(), words: original.words || [] };
    return Array.isArray(original.words) && original.words.length ? segment : { ...segment, words: original.words };
  });
  return { segments: result, text: result.map((s) => s.text).filter(Boolean).join(" "), matched, applied: true };
}
