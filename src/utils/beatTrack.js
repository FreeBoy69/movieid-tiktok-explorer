// Beat tracking for music videos: tempo (BPM), beat times, and bar starts
// from raw mono samples. No dependencies, so it runs anywhere Node does.
//
// Method (Ellis 2007, "Beat Tracking by Dynamic Programming", the approach
// librosa.beat follows): a spectral-flux onset envelope, a global tempo from
// its autocorrelation weighted toward ~120 BPM, then the beat sequence that
// best balances landing on onsets against keeping that tempo. Bars assume 4/4
// with the downbeat on the strongest of the four beat phases.

const HOP = 256;
const FFT_SIZE = 1024;
const MIN_CONFIDENCE = 4.5;

/** In-place iterative radix-2 FFT on separate real/imaginary arrays. */
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len;
    const wr = Math.cos(angle);
    const wi = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

/** Spectral-flux onset strength per hop, plus RMS energy per hop. */
export function onsetEnvelope(samples) {
  const frames = Math.max(0, Math.floor((samples.length - FFT_SIZE) / HOP) + 1);
  const window = new Float32Array(FFT_SIZE).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1)));
  const bins = FFT_SIZE / 2;
  let previous = new Float32Array(bins);
  const onset = new Float32Array(frames);
  const energy = new Float32Array(frames);
  const re = new Float64Array(FFT_SIZE);
  const im = new Float64Array(FFT_SIZE);
  for (let f = 0; f < frames; f++) {
    const offset = f * HOP;
    let power = 0;
    for (let i = 0; i < FFT_SIZE; i++) {
      const x = samples[offset + i] || 0;
      power += x * x;
      re[i] = x * window[i];
      im[i] = 0;
    }
    energy[f] = Math.sqrt(power / FFT_SIZE);
    fft(re, im);
    const current = new Float32Array(bins);
    let flux = 0;
    for (let k = 1; k < bins; k++) {
      // Log magnitude compresses loud sustained notes so attacks stand out.
      current[k] = Math.log1p(100 * Math.hypot(re[k], im[k]));
      const rise = current[k] - previous[k];
      if (rise > 0) flux += rise;
    }
    onset[f] = flux;
    previous = current;
  }
  // Remove the slow trend (a moving mean over ~1 s) and keep only the rises.
  const span = 40;
  const out = new Float32Array(frames);
  let sum = 0;
  for (let f = 0; f < frames; f++) {
    sum += onset[f];
    if (f >= span) sum -= onset[f - span];
    out[f] = Math.max(0, onset[f] - sum / Math.min(f + 1, span));
  }
  const peak = out.reduce((m, v) => Math.max(m, v), 0) || 1;
  for (let f = 0; f < frames; f++) out[f] /= peak;
  return { onset: out, energy, fps: 0 };
}

/** Global tempo in BPM from the onset envelope\'s autocorrelation. */
export function estimateTempo(onset, fps, { min = 60, max = 200, prior = 120 } = {}) {
  const minLag = Math.floor((60 * fps) / max);
  const maxLag = Math.ceil((60 * fps) / min);
  const scores = [];
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    for (let i = lag; i < onset.length; i++) sum += onset[i] * onset[i - lag];
    const bpm = (60 * fps) / lag;
    // Log-Gaussian weighting around the prior keeps half and double tempos in check.
    const weight = Math.exp(-0.5 * (Math.log2(bpm / prior) / 0.9) ** 2);
    scores.push({ lag, value: (sum / (onset.length - lag)) * weight });
  }
  let best = 0;
  for (let i = 1; i < scores.length; i++) if (scores[i].value > scores[best].value) best = i;
  // Parabolic interpolation for a lag between frames.
  const a = scores[best - 1]?.value ?? scores[best].value;
  const b = scores[best].value;
  const c = scores[best + 1]?.value ?? scores[best].value;
  const shift = a - 2 * b + c !== 0 ? (0.5 * (a - c)) / (a - 2 * b + c) : 0;
  const lag = scores[best].lag + Math.max(-0.5, Math.min(0.5, shift));
  return (60 * fps) / lag;
}

/** Beat frames by dynamic programming over the onset envelope at a fixed tempo. */
export function trackBeats(onset, fps, bpm, tightness = 100) {
  const period = (60 * fps) / bpm;
  const n = onset.length;
  const score = new Float64Array(n);
  const back = new Int32Array(n).fill(-1);
  const from = Math.round(period / 2);
  const to = Math.round(period * 2);
  for (let t = 0; t < n; t++) {
    let best = 0;
    let bestPrev = -1;
    for (let prev = t - to; prev <= t - from; prev++) {
      if (prev < 0) continue;
      const penalty = -tightness * Math.log((t - prev) / period) ** 2;
      const value = score[prev] + penalty;
      if (bestPrev < 0 || value > best) {
        best = value;
        bestPrev = prev;
      }
    }
    score[t] = onset[t] + (bestPrev >= 0 ? best : 0);
    back[t] = bestPrev;
  }
  // Start the backtrace from the strongest score within the last beat period.
  let end = n - 1;
  for (let t = Math.max(0, n - Math.round(period)); t < n; t++) if (score[t] > score[end]) end = t;
  const beats = [];
  for (let t = end; t >= 0; t = back[t]) {
    beats.push(t);
    if (back[t] < 0) break;
  }
  return beats.reverse();
}

const round = (n) => Math.round(n * 1000) / 1000;

/**
 * Tempo, beats, and bars for a mono signal at `sampleRate`. Beats and bar
 * starts are in seconds; `energy` is each bar\'s loudness from 0 to 1.
 */
export function analyzeBeats(samples, sampleRate) {
  const { onset, energy } = onsetEnvelope(samples);
  const fps = sampleRate / HOP;
  const duration = samples.length / sampleRate;
  if (onset.length < fps * 4) return { bpm: 0, beats: [], bars: [], energy: [], duration: round(duration) };
  const bpm = estimateTempo(onset, fps);
  const frames = trackBeats(onset, fps, bpm);
  // How much stronger onsets are on the tracked beats than on average. Songs
  // with a beat score 7-15; pads, speech, and noise stay under 4, where any
  // "tempo" found is noise, so they get no grid at all.
  const mean = onset.reduce((sum, v) => sum + v, 0) / onset.length || 1;
  const confidence = frames.reduce((sum, f) => sum + onset[f], 0) / Math.max(1, frames.length) / mean;
  if (confidence < MIN_CONFIDENCE) return { bpm: 0, beats: [], bars: [], energy: [], duration: round(duration), confidence: round(confidence) };
  // A frame hears an attack once it enters the window, and its flux peaks a
  // hop before the attack does: stamp it at the window centre plus one hop.
  const beats = frames.map((f) => round((f * HOP + FFT_SIZE / 2 + HOP) / sampleRate));
  // The downbeat is the beat phase (of four) with the strongest onsets.
  let phase = 0;
  let strongest = -1;
  for (let p = 0; p < 4; p++) {
    let sum = 0;
    for (let i = p; i < frames.length; i += 4) sum += onset[frames[i]] + energy[frames[i]];
    if (sum > strongest) {
      strongest = sum;
      phase = p;
    }
  }
  const bars = beats.filter((_, i) => i >= phase && (i - phase) % 4 === 0);
  const barEnergy = bars.map((start, i) => {
    const a = Math.floor((start * sampleRate) / HOP);
    const b = Math.floor(((bars[i + 1] ?? duration) * sampleRate) / HOP);
    let sum = 0;
    for (let f = a; f < Math.min(b, energy.length); f++) sum += energy[f];
    return sum / Math.max(1, Math.min(b, energy.length) - a);
  });
  const loudest = Math.max(1e-9, ...barEnergy);
  return {
    bpm: Math.round(bpm * 10) / 10,
    beats,
    bars,
    energy: barEnergy.map((value) => Math.round((value / loudest) * 100) / 100),
    duration: round(duration),
    confidence: round(confidence),
  };
}

/** Halve or double a detected tempo when the detector picked the wrong octave. */
export function rescaleBeats(beatInfo, factor) {
  const beats = beatInfo?.beats || [];
  if (!beats.length || (factor !== 0.5 && factor !== 2)) return beatInfo;
  const next = factor === 0.5
    ? beats.filter((_, i) => i % 2 === 0)
    : beats.flatMap((t, i) => (i < beats.length - 1 ? [t, round((t + beats[i + 1]) / 2)] : [t]));
  const barSet = new Set((beatInfo.bars || []).map((t) => t));
  const firstBar = next.findIndex((t) => barSet.has(t));
  const start = firstBar >= 0 ? firstBar % 4 : 0;
  return {
    ...beatInfo,
    bpm: Math.round(beatInfo.bpm * factor * 10) / 10,
    beats: next,
    bars: next.filter((_, i) => i >= start && (i - start) % 4 === 0),
    energy: [],
  };
}
