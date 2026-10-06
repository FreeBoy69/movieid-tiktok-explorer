import { describe, expect, it } from "vitest";
import { analyzeBeats, rescaleBeats } from "./beatTrack.js";

const RATE = 11025;
/** A drum-like track: a kick on every beat, louder on each bar\'s first beat, with a quiet pad under it. */
function clickTrack(bpm: number, seconds: number, offset = 0.3) {
  const out = new Float32Array(Math.round(seconds * RATE));
  for (let i = 0; i < out.length; i++) out[i] = 0.02 * Math.sin((2 * Math.PI * 220 * i) / RATE);
  const period = 60 / bpm;
  for (let k = 0; offset + k * period < seconds; k++) {
    const start = Math.round((offset + k * period) * RATE);
    const gain = k % 4 === 0 ? 1 : 0.55;
    for (let j = 0; j < 0.06 * RATE && start + j < out.length; j++) {
      const env = Math.exp(-j / (0.012 * RATE));
      out[start + j] += gain * env * (Math.sin((2 * Math.PI * 80 * j) / RATE) + 0.5 * (Math.random() * 2 - 1));
    }
  }
  return out;
}

describe("beat tracking", () => {
  for (const bpm of [90, 120, 140]) {
    it(`finds ${bpm} BPM and beats on the clicks`, () => {
      const result = analyzeBeats(clickTrack(bpm, 30), RATE);
      expect(Math.abs(result.bpm - bpm)).toBeLessThan(2.5);
      const period = 60 / bpm;
      // Every detected beat sits within 60 ms of a click.
      const offBy = result.beats.slice(2, -2).map((t) => {
        const k = Math.round((t - 0.3) / period);
        return Math.abs(t - (0.3 + k * period));
      });
      expect(Math.max(...offBy)).toBeLessThan(0.04);
      expect(result.beats.length).toBeGreaterThan((30 / period) * 0.9);
    });
  }

  it("puts bar starts on the accented beats", () => {
    const bpm = 120;
    const result = analyzeBeats(clickTrack(bpm, 24), RATE);
    const period = 60 / bpm;
    const accented = result.bars.slice(1, -1).filter((t) => Math.round((t - 0.3) / period) % 4 === 0).length;
    expect(accented / Math.max(1, result.bars.length - 2)).toBeGreaterThan(0.8);
    expect(result.energy.every((e) => e >= 0 && e <= 1)).toBe(true);
  });

  it("finds no beat in a pad or in noise", () => {
    const pad = new Float32Array(RATE * 20).map((_, i) => 0.3 * Math.sin((2 * Math.PI * 220 * i) / RATE) * (1 + 0.3 * Math.sin((2 * Math.PI * 0.2 * i) / RATE)));
    const noise = new Float32Array(RATE * 20).map(() => Math.random() * 0.3 - 0.15);
    expect(analyzeBeats(pad, RATE).bpm).toBe(0);
    expect(analyzeBeats(noise, RATE).bpm).toBe(0);
  });

  it("halves and doubles a tempo", () => {
    const info = { bpm: 140, beats: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4], bars: [0, 2, 4], energy: [] };
    expect(rescaleBeats(info, 0.5)).toMatchObject({ bpm: 70, beats: [0, 1, 2, 3, 4] });
    expect(rescaleBeats(info, 2).beats).toHaveLength(17);
    expect(rescaleBeats(info, 2).bpm).toBe(280);
  });
});

describe("beat tracking speed", () => {
  it("reads a ten-minute song in a few seconds", () => {
    const started = Date.now();
    const result = analyzeBeats(clickTrack(128, 600), RATE);
    expect(Math.abs(result.bpm - 128)).toBeLessThan(2.5);
    expect(Date.now() - started).toBeLessThan(15000);
  }, 30000);
});
