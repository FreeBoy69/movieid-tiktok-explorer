import { describe, expect, it } from "vitest";
import { downsample, MicTape } from "./micTape";

const block = (value: number, length = 4800) => new Float32Array(length).fill(value);

describe("live mode's mic tape", () => {
  it("starts a recording with the moment before you spoke", () => {
    const tape = new MicTape(48000, 0.6);
    // Two seconds of room noise, then you start talking and the recording starts.
    for (let i = 0; i < 20; i++) tape.push(block(0.01));
    tape.start();
    for (let i = 0; i < 5; i++) tape.push(block(0.5));
    // 0.6 s kept from before, plus the 0.5 s since.
    expect(tape.seconds).toBeCloseTo(1.1, 1);
    const wav = new DataView(tape.wavBytes());
    expect(wav.getUint32(24, true)).toBe(16000);
    expect(wav.byteLength).toBe(44 + tape.seconds * 16000 * 2);
    // The last sample is your voice, at full scale.
    expect(wav.getInt16(wav.byteLength - 2, true)).toBe(Math.round(0.5 * 32767));
  });

  it("goes back to keeping only the pre-roll after a recording", () => {
    const tape = new MicTape(16000, 0.6);
    tape.start();
    for (let i = 0; i < 10; i++) tape.push(block(0.2, 1600));
    tape.stop();
    tape.push(block(0, 1600));
    expect(tape.seconds).toBeLessThanOrEqual(0.7);
  });

  it("averages down to 16 kHz", () => {
    expect(Array.from(downsample(new Float32Array([0, 0.3, 0.6, 0.9, 0.9, 0.9]), 48000)).map((v) => +v.toFixed(2))).toEqual([0.3, 0.9]);
  });
});
