// Recording a voice sample in the browser, shared by every clone screen: the
// microphone take is re-encoded as 24 kHz mono WAV (what every voice engine
// reads), with a live timer and an input level for a meter.
import { useCallback, useEffect, useRef, useState } from "react";

export const VOICE_PASSAGE =
  "I'm recording my voice so it can narrate my videos. When I explain something, I like to keep it simple: what it is, why it matters, and how to use it. First you open the page, then you pick what you need, and in a few clicks it's done. That's really all there is to it.";
export const MIN_RECORD_SECONDS = 12;
export const MAX_RECORD_SECONDS = 90;

export type VoiceRecording = { blob: Blob; url: string; seconds: number };

/** Decodes whatever the browser recorded and re-encodes it as 24 kHz mono 16-bit WAV. */
export async function toWav(blob: Blob): Promise<Blob> {
  const Context = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const context = new Context();
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer());
    const rate = 24000;
    const offline = new OfflineAudioContext(1, Math.max(1, Math.ceil(decoded.duration * rate)), rate);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    const samples = (await offline.startRendering()).getChannelData(0);
    const view = new DataView(new ArrayBuffer(44 + samples.length * 2));
    const text = (offset: number, value: string) => [...value].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));
    text(0, "RIFF");
    view.setUint32(4, 36 + samples.length * 2, true);
    text(8, "WAVE");
    text(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, rate, true);
    view.setUint32(28, rate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    text(36, "data");
    view.setUint32(40, samples.length * 2, true);
    for (let i = 0; i < samples.length; i++) view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 0x7fff, true);
    return new Blob([view], { type: "audio/wav" });
  } finally {
    void context.close();
  }
}

const recorderType = () =>
  typeof MediaRecorder === "undefined" ? "" : ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"].find((type) => MediaRecorder.isTypeSupported(type)) || "";
export const canRecord = () => typeof MediaRecorder !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);
export const clockOf = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

/**
 * `live` is the elapsed seconds while recording, else null. Attach `meter` to
 * an element to get its `--level` (0 to 1) set every frame from the mic input.
 */
export function useVoiceRecorder({ min = MIN_RECORD_SECONDS, max = MAX_RECORD_SECONDS } = {}) {
  const [recording, setRecording] = useState<VoiceRecording | null>(null);
  const [live, setLive] = useState<number | null>(null);
  const [error, setError] = useState("");
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef(0);
  const frame = useRef(0);
  const meterEl = useRef<HTMLElement | null>(null);
  const audio = useRef<AudioContext | null>(null);

  const teardown = useCallback(() => {
    window.clearInterval(timer.current);
    cancelAnimationFrame(frame.current);
    stream.current?.getTracks().forEach((track) => track.stop());
    void audio.current?.close().catch(() => undefined);
    audio.current = null;
    meterEl.current?.style.setProperty("--level", "0");
  }, []);
  useEffect(() => () => {
    if (recorder.current?.state === "recording") recorder.current.stop();
    teardown();
  }, [teardown]);
  useEffect(() => () => void (recording && URL.revokeObjectURL(recording.url)), [recording]);

  const start = useCallback(async () => {
    setError("");
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
      stream.current = media;
      // Input level for the meter: RMS of the analyser's waveform, every frame.
      try {
        const Context = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const context = new Context();
        audio.current = context;
        const analyser = context.createAnalyser();
        analyser.fftSize = 1024;
        context.createMediaStreamSource(media).connect(analyser);
        const data = new Float32Array(analyser.fftSize);
        const tick = () => {
          analyser.getFloatTimeDomainData(data);
          let sum = 0;
          for (const x of data) sum += x * x;
          meterEl.current?.style.setProperty("--level", Math.min(1, Math.sqrt(sum / data.length) * 5).toFixed(3));
          frame.current = requestAnimationFrame(tick);
        };
        tick();
      } catch {
        // The meter is a nicety; recording works without it.
      }
      const type = recorderType();
      const next = new MediaRecorder(media, type ? { mimeType: type } : undefined);
      const chunks: Blob[] = [];
      const started = Date.now();
      next.ondataavailable = (event) => event.data.size && chunks.push(event.data);
      next.onstop = async () => {
        teardown();
        setLive(null);
        const seconds = (Date.now() - started) / 1000;
        if (seconds < min) return setError(`Record at least ${min} seconds. Reading the whole passage takes about 20.`);
        try {
          const wav = await toWav(new Blob(chunks, { type: next.mimeType || type || "audio/webm" }));
          setRecording({ blob: wav, url: URL.createObjectURL(wav), seconds });
        } catch {
          setError("Couldn't read that recording. Try again, or upload a file instead.");
        }
      };
      recorder.current = next;
      next.start(250);
      setRecording(null);
      setLive(0);
      timer.current = window.setInterval(() => {
        const seconds = (Date.now() - started) / 1000;
        setLive(seconds);
        if (seconds >= max && next.state === "recording") next.stop();
      }, 250);
    } catch {
      teardown();
      setError("The microphone isn't available. Allow microphone access in your browser, or upload a recording instead.");
    }
  }, [max, min, teardown]);
  const stop = useCallback(() => {
    if (recorder.current?.state === "recording") recorder.current.stop();
  }, []);
  const reset = useCallback(() => {
    setRecording(null);
    setError("");
  }, []);
  const meter = useCallback((element: HTMLElement | null) => {
    meterEl.current = element;
  }, []);

  return { recording, live, error, setError, start, stop, reset, meter };
}
