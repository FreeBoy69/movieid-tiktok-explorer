/** Live mode's recorder. MediaRecorder only starts once you're already talking (the loudness check needs
 *  ~120 ms, and a phone's recorder takes a moment more to start), so the first word was cut: Gemini then
 *  heard "I" or "No." for "Hi". This one listens all the time and keeps the last PREROLL seconds, so a
 *  turn's recording starts just before you did. It records 16 kHz WAV, which every hearing route reads. */

const RATE = 16000;
export const PREROLL = 0.6;

/** Mic samples in blocks, kept on the audio thread until there are enough to be worth a message. */
const MIC_WORKLET = `
class JuelMic extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(2048); this.n = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) for (let i = 0; i < ch.length; i++) {
      this.buf[this.n++] = ch[i];
      if (this.n === this.buf.length) { this.port.postMessage(this.buf.slice()); this.n = 0; }
    }
    return true;
  }
}
registerProcessor("juel-mic", JuelMic);
`;

/** The tape itself, without the browser: samples in at `rate`, a 16 kHz WAV out. */
export class MicTape {
  private blocks: Float32Array[] = [];
  private length = 0;
  recording = false;
  private rate: number;
  private preroll: number;
  constructor(rate: number, preroll = PREROLL) {
    this.rate = rate;
    this.preroll = preroll;
  }
  push(block: Float32Array) {
    const sample = downsample(block, this.rate);
    this.blocks.push(sample);
    this.length += sample.length;
    if (this.recording) return;
    // Not recording: only the last `preroll` seconds are kept.
    const keep = Math.round(this.preroll * RATE);
    while (this.blocks.length > 1 && this.length - this.blocks[0].length >= keep) this.length -= this.blocks.shift()!.length;
  }
  start() {
    this.recording = true;
  }
  stop() {
    this.recording = false;
  }
  /** Everything recorded since start, pre-roll included. */
  wav(): Blob {
    return new Blob([this.wavBytes()], { type: "audio/wav" });
  }
  wavBytes(): ArrayBuffer {
    const pcm = new Int16Array(this.length);
    let at = 0;
    for (const block of this.blocks) {
      for (let i = 0; i < block.length; i++) pcm[at + i] = Math.max(-32768, Math.min(32767, Math.round(block[i] * 32767)));
      at += block.length;
    }
    const bytes = new Uint8Array(44 + pcm.length * 2);
    bytes.set(new Uint8Array(wavHeader(pcm.length * 2)));
    bytes.set(new Uint8Array(pcm.buffer), 44);
    return bytes.buffer;
  }
  get seconds() {
    return this.length / RATE;
  }
}

/** To 16 kHz by averaging each output sample's span of input (a crude low-pass, fine for speech). */
export function downsample(input: Float32Array, rate: number): Float32Array {
  if (rate === RATE) return input.slice();
  const ratio = rate / RATE;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const from = Math.floor(i * ratio);
    const to = Math.max(from + 1, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let k = from; k < to; k++) sum += input[k];
    out[i] = sum / (to - from);
  }
  return out;
}

export function wavHeader(bytes: number): ArrayBuffer {
  const view = new DataView(new ArrayBuffer(44));
  const text = (at: number, value: string) => [...value].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, 36 + bytes, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, RATE, true);
  view.setUint32(28, RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, bytes, true);
  return view.buffer;
}

/** A MediaRecorder stand-in on the tape (the parts live mode uses), or null where the browser has no
 *  AudioWorklet (live mode then keeps MediaRecorder). `prerollMs` is how much of the recording came before
 *  start(). */
export async function micRecorder(context: AudioContext, source: AudioNode): Promise<(MediaRecorder & { prerollMs: number }) | null> {
  if (!context.audioWorklet) return null;
  const url = URL.createObjectURL(new Blob([MIC_WORKLET], { type: "application/javascript" }));
  let node: AudioWorkletNode;
  try {
    await context.audioWorklet.addModule(url);
    node = new AudioWorkletNode(context, "juel-mic", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
  // Wired to the output through a silent gain: some browsers don't run a node that leads nowhere.
  const mute = context.createGain();
  mute.gain.value = 0;
  source.connect(node);
  node.connect(mute).connect(context.destination);
  const tape = new MicTape(context.sampleRate);
  node.port.onmessage = ({ data }) => tape.push(data as Float32Array);
  const recorder = {
    mimeType: "audio/wav",
    prerollMs: PREROLL * 1000,
    get state() {
      return tape.recording ? "recording" : "inactive";
    },
    ondataavailable: null as ((event: { data: Blob }) => void) | null,
    onstop: null as (() => void) | null,
    start() {
      tape.start();
    },
    requestData() {
      recorder.ondataavailable?.({ data: tape.wav() });
    },
    stop() {
      if (!tape.recording) return;
      const data = tape.wav();
      tape.stop();
      recorder.ondataavailable?.({ data });
      recorder.onstop?.();
    },
  };
  return recorder as unknown as MediaRecorder & { prerollMs: number };
}
