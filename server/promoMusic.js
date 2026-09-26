// The film's score, synthesized sample by sample: kick, bass, claps, hats, chord pads,
// an arpeggio, risers, and impacts. It costs nothing, and its drops are the same
// seconds the film is told to cut its big moments on.

/** Where the music's moments land, on bar lines. */
export function musicStructure(duration, bpm = 120) {
  const beat = 60 / bpm, bar = beat * 4;
  const round = (t) => Math.round(t * 1000) / 1000;
  const drop = round(duration >= 20 ? bar * 2 : bar);
  const final = round(Math.max(drop + bar, Math.floor((duration - 1.6) / bar) * bar));
  const drop2 = duration >= 24 ? round(final - bar * 3) : null;
  const breakdown = drop2 ? round(drop2 - bar) : null;
  return { bpm, beat: round(beat), bar: round(bar), drop, breakdown, drop2, final, duration };
}

/** A sentence for the film's director describing the same moments. */
export function describeStructure(s) {
  const at = (t) => `${Number(t.toFixed(2))}s`;
  return [
    `The music is ${s.bpm} BPM: one beat every ${at(s.beat)}, one bar every ${at(s.bar)}. Cut on beats.`,
    `0–${at(s.drop)}: intro. A kick hits on each of the first four beats (0, ${at(s.beat)}, ${at(s.beat * 2)}, ${at(s.beat * 3)}): land a word slam or hard cut on each. A riser builds into the drop.`,
    `${at(s.drop)}: THE DROP, a boom and crash. The big reveal (logo, product, or hero statement) lands exactly here.`,
    s.breakdown != null
      ? `${at(s.drop)}–${at(s.breakdown)}: the groove; the densest, fastest part. ${at(s.breakdown)}–${at(s.drop2)}: breakdown, the music drops away: one calm line or statement, then a riser. ${at(s.drop2)}: SECOND DROP, the second big moment (numbers, a montage, the strongest proof). ${at(s.drop2)}–${at(s.final)}: the hardest groove.`
      : `${at(s.drop)}–${at(s.final)}: the groove; the densest, fastest part.`,
    `${at(s.final)}: FINAL HIT. The end card lands exactly here and holds, with a slow drift, to ${at(s.duration)} while the music rings out.`,
  ].join("\n");
}

const SR = 44100;
const noteHz = (m) => 440 * Math.pow(2, (m - 69) / 12);
const CHORDS = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]];
const ROOTS = [45, 41, 48, 43];

/** A stereo 16-bit WAV of the score. */
export function synthScore(structure) {
  const { duration, beat: BEAT, bar: BAR, drop, breakdown, drop2, final } = structure;
  const N = Math.round(SR * duration), L = new Float32Array(N), R = new Float32Array(N);
  let seed = 7;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
  const add = (i, l, r = l) => { if (i >= 0 && i < N) { L[i] += l; R[i] += r; } };
  const grooveEnd = breakdown ?? final;
  const inDrop = (t) => (t >= drop && t < grooveEnd) || (drop2 != null && t >= drop2 && t < final);
  const hard = (t) => (drop2 != null ? t >= drop2 : t >= drop + (final - drop) / 2) && t < final;
  const saw = (f, i) => { const p = (f * i) / SR; return 2 * (p - Math.floor(p + 0.5)); };

  const kicks = [];
  for (let t = 0; t < duration; t += BEAT) if (inDrop(t + 1e-6)) kicks.push(t);
  const duckAt = new Float32Array(N).fill(1);
  for (const k of kicks) for (let i = 0; i < SR * 0.4; i++) {
    const at = Math.round(k * SR) + i;
    if (at < N) duckAt[at] = Math.min(duckAt[at], 0.25 + 0.75 * Math.pow(i / (SR * 0.4), 0.6));
  }

  function kick(t0, amp = 0.9) {
    let ph = 0;
    for (let i = 0; i < SR * 0.45; i++) {
      const t = i / SR;
      ph += (2 * Math.PI * (45 + 110 * Math.exp(-t * 28))) / SR;
      add(Math.round((t0 + t) * SR), Math.sin(ph) * Math.exp(-t * 7) * amp + (t < 0.004 ? rnd() * 0.3 * (1 - t / 0.004) : 0));
    }
  }
  function clap(t0, amp = 0.35) {
    let lp = 0;
    for (let i = 0; i < SR * 0.25; i++) {
      const t = i / SR, n = rnd();
      lp += 0.35 * (n - lp);
      const env = (t < 0.01 ? 1 : 0) + (t > 0.012 && t < 0.022 ? 0.8 : 0) + (t > 0.024 ? Math.exp(-(t - 0.024) * 22) : 0);
      const v = (n - lp) * env * amp;
      add(Math.round((t0 + t) * SR), v * 0.9, v * 1.1);
    }
  }
  function hat(t0, amp = 0.12, len = 0.05) {
    let lp = 0;
    for (let i = 0; i < SR * len; i++) {
      const t = i / SR, n = rnd();
      lp += 0.7 * (n - lp);
      const v = (n - lp) * Math.exp(-t * (6 / len)) * amp;
      add(Math.round((t0 + t) * SR), v * 1.1, v * 0.9);
    }
  }
  function riser(t0, t1, amp = 0.3) {
    let lp = 0, ph = 0;
    for (let i = Math.round(t0 * SR); i < Math.round(t1 * SR); i++) {
      const k = (i / SR - t0) / (t1 - t0), n = rnd();
      lp += (0.02 + k * 0.5) * (n - lp);
      ph += (2 * Math.PI * (200 + k * k * 1800)) / SR;
      const v = (lp * 0.8 + Math.sin(ph) * 0.15) * k * k * amp;
      add(i, v * (1 - k * 0.3), v * (0.7 + k * 0.3));
    }
  }
  function impact(t0, amp = 1) {
    let ph = 0, lp = 0;
    for (let i = 0; i < SR * 2.2; i++) {
      const t = i / SR, n = rnd();
      ph += (2 * Math.PI * (38 + 60 * Math.exp(-t * 9))) / SR;
      lp += 0.5 * (n - lp);
      const v = (Math.sin(ph) * Math.exp(-t * 1.8) * 0.7 + (n - lp * 0.5) * Math.exp(-t * 3.2) * 0.25) * amp;
      add(Math.round((t0 + t) * SR), v, v);
    }
  }

  // Pad, bass, and arpeggio, one sample at a time.
  let padLP = 0, padLP2 = 0, bassLP = 0, arpLP = 0;
  const sendL = new Float32Array(N), sendR = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const t = i / SR, c = Math.floor(t / BAR) % 4, g = inDrop(t) ? duckAt[i] : 1;
    const cutoff = t < drop ? 0.02 + (t / drop) * 0.05 : breakdown != null && t >= breakdown && t < drop2 ? 0.025 + ((t - breakdown) / (drop2 - breakdown)) * 0.05 : t < final ? (hard(t) ? 0.12 : 0.09) : 0.06;
    let pad = 0;
    for (const m of CHORDS[c]) pad += saw(noteHz(m) * 1.003, i) + saw(noteHz(m) * 0.997, i) + 0.5 * saw(noteHz(m + 12), i);
    padLP += cutoff * (pad - padLP);
    padLP2 += cutoff * (padLP - padLP2);
    const padAmp = (t < final ? 0.05 : 0.07 * Math.max(0, 1 - (t - final) / Math.max(0.5, duration - final))) * Math.min(1, t / 0.5);
    const padV = padLP2 * padAmp * g;
    let bassV = 0;
    if (inDrop(t)) {
      const step = Math.floor(t / (BEAT / 2)), local = t - step * (BEAT / 2);
      if (step % 2 === 1 || hard(t)) {
        const f = noteHz(ROOTS[c] - 12 + (step % 4 === 3 && hard(t) ? 12 : 0));
        bassLP += 0.08 * (saw(f, i) + 0.6 * Math.sin((2 * Math.PI * f * i) / SR) - bassLP);
        bassV = bassLP * 0.34 * Math.exp(-local * 5) * g;
      }
    }
    let arpV = 0;
    if (inDrop(t) && t >= drop + (grooveEnd - drop) / 2) {
      const s = Math.floor(t / (BEAT / 4)), local = t - s * (BEAT / 4);
      const notes = CHORDS[c].concat(CHORDS[c][0] + 12), f = noteHz(notes[[0, 1, 2, 3, 2, 1, 3, 2][s % 8]] + 12);
      arpLP += 0.25 * (Math.sign(Math.sin((2 * Math.PI * f * i) / SR)) * 0.5 + saw(f * 2, i) * 0.3 - arpLP);
      arpV = arpLP * Math.exp(-local * 16) * (hard(t) ? 0.09 : 0.05) * g;
    }
    L[i] += padV + bassV + arpV * 0.8;
    R[i] += padV + bassV + arpV * 1.2;
    sendL[i] = sendR[i] = arpV + padV * 0.3;
  }
  const D = Math.round(BEAT * 0.75 * SR);
  for (let i = D; i < N; i++) {
    sendL[i] += sendR[i - D] * 0.45;
    sendR[i] += sendL[i - D] * 0.45;
    L[i] += sendR[i - D] * 0.35;
    R[i] += sendL[i - D] * 0.35;
  }

  for (const k of kicks) kick(k);
  for (let t = 0; t < duration; t += BEAT) {
    if (!inDrop(t + 1e-6)) continue;
    if (Math.round(t / BEAT) % 2 === 1) clap(t);
    hat(t + BEAT / 2, 0.14);
    if (hard(t)) { hat(t + BEAT / 4, 0.06); hat(t + (3 * BEAT) / 4, 0.06); }
  }
  for (let t = 0; t < drop; t += BEAT / 4) hat(t, 0.03 + (t / drop) * 0.06, 0.03);
  for (let b = 0; b < 4 && b * BEAT < drop; b++) kick(b * BEAT, 0.55);
  if (breakdown != null) for (let t = breakdown; t < drop2; t += BEAT / 2) hat(t, 0.05, 0.03);
  riser(Math.max(0, drop - Math.min(2, drop / 2)), drop, 0.35);
  if (breakdown != null) riser(breakdown + (drop2 - breakdown) * 0.2, drop2, 0.4);
  riser(Math.max(drop, final - 1.2), final, 0.22);
  impact(drop);
  if (drop2 != null) impact(drop2);
  impact(final, 1.1);

  let peak = 0;
  for (let i = 0; i < N; i++) {
    const t = i / SR, fade = t > duration - 0.6 ? Math.max(0, (duration - t) / 0.6) : 1;
    L[i] = Math.tanh(L[i] * 1.2) * fade;
    R[i] = Math.tanh(R[i] * 1.2) * fade;
    peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  }
  const gain = peak ? 0.89 / peak : 1;
  const wav = Buffer.alloc(44 + N * 4);
  wav.write("RIFF", 0); wav.writeUInt32LE(36 + N * 4, 4); wav.write("WAVE", 8); wav.write("fmt ", 12);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22); wav.writeUInt32LE(SR, 24);
  wav.writeUInt32LE(SR * 4, 28); wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(N * 4, 40);
  for (let i = 0; i < N; i++) {
    wav.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[i] * gain)) * 32767), 44 + i * 4);
    wav.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[i] * gain)) * 32767), 46 + i * 4);
  }
  return wav;
}
