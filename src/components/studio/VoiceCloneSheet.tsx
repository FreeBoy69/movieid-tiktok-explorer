// Clone a voice without leaving the page: record a short read in the browser
// (converted to WAV here) or upload a clean recording. The voice is private to
// the person who clones it (server/voiceOwners.js).
import { type FormEvent, useEffect, useRef, useState } from "react";
import { Loader2, Mic, Square, Upload, X } from "lucide-react";
import { isVoiceReady, loadVoiceProfiles } from "../../utils/voiceProfiles";
import { readJson } from "./studioShared";

const PASSAGE =
  "I'm recording my voice so it can narrate my videos. When I explain something, I like to keep it simple: what it is, why it matters, and how to use it. First you open the page, then you pick what you need, and in a few clicks it's done. That's really all there is to it.";
const MIN_SECONDS = 12;
const MAX_SECONDS = 90;
const MAX_UPLOAD_MB = 20;

type Recording = { blob: Blob; url: string; seconds: number };

// Decodes whatever the browser recorded and re-encodes it as 24 kHz mono 16-bit WAV, which every voice engine reads.
async function toWav(blob: Blob): Promise<Blob> {
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
const toBase64 = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(new Error("Couldn't read the recording"));
    reader.readAsDataURL(blob);
  });
const recorderType = () =>
  typeof MediaRecorder === "undefined" ? "" : ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"].find((type) => MediaRecorder.isTypeSupported(type)) || "";
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

export function VoiceCloneSheet({ onClose, onCreated }: { onClose: () => void; onCreated: (voiceId: string) => void }) {
  const [online, setOnline] = useState<boolean | null>(null);
  const [name, setName] = useState("");
  const [mode, setMode] = useState<"record" | "upload">(typeof MediaRecorder === "undefined" ? "upload" : "record");
  const [recording, setRecording] = useState<Recording | null>(null);
  const [live, setLive] = useState<number | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [consent, setConsent] = useState(false);
  const [denoise, setDenoise] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef(0);
  const close = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    close.current?.focus();
    let cancelled = false;
    fetch("/api/voicebox/status", { cache: "no-store" })
      .then((response) => !cancelled && setOnline(response.ok))
      .catch(() => !cancelled && setOnline(false));
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      cancelled = true;
      document.body.style.overflow = overflow;
    };
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && !busy && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose]);
  useEffect(
    () => () => {
      window.clearInterval(timer.current);
      stream.current?.getTracks().forEach((track) => track.stop());
      if (recorder.current?.state === "recording") recorder.current.stop();
    },
    [],
  );
  useEffect(() => () => void (recording && URL.revokeObjectURL(recording.url)), [recording]);

  async function startRecording() {
    setError("");
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
      stream.current = media;
      const type = recorderType();
      const next = new MediaRecorder(media, type ? { mimeType: type } : undefined);
      const chunks: Blob[] = [];
      const started = Date.now();
      next.ondataavailable = (event) => event.data.size && chunks.push(event.data);
      next.onstop = async () => {
        window.clearInterval(timer.current);
        media.getTracks().forEach((track) => track.stop());
        setLive(null);
        const seconds = (Date.now() - started) / 1000;
        if (seconds < MIN_SECONDS) return setError(`Record at least ${MIN_SECONDS} seconds. Reading the whole passage takes about 20.`);
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
        if (seconds >= MAX_SECONDS && next.state === "recording") next.stop();
      }, 250);
    } catch {
      setError("The microphone isn't available. Allow microphone access in your browser, or upload a recording instead.");
    }
  }
  const stopRecording = () => recorder.current?.state === "recording" && recorder.current.stop();

  function pickFile(next: File | null) {
    setError("");
    if (!next) return setFile(null);
    if (!next.type.startsWith("audio/")) return setError("Choose an audio file: WAV, MP3, M4A, or OGG.");
    if (next.size > MAX_UPLOAD_MB * 1024 * 1024) return setError(`Audio files can be up to ${MAX_UPLOAD_MB} MB.`);
    setFile(next);
    if (!name.trim()) setName(next.name.replace(/\.[^.]+$/, "").slice(0, 60));
  }

  const sample: Blob | null = mode === "record" ? recording?.blob || null : file;
  const ready = Boolean(online && name.trim() && sample && consent && !busy && live === null);
  const missing = online === false ? "" : !name.trim() ? "Name the voice" : !sample ? (mode === "record" ? "Record the passage" : "Choose a recording") : !consent ? "Confirm you have permission" : "";

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready || !sample) return;
    setError("");
    let created = "";
    try {
      setBusy("Creating the voice…");
      const profile = await readJson(
        await fetch("/api/voicebox/profiles", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim().slice(0, 100), language: "en", voiceType: "cloned", defaultEngine: "qwen" }) }),
        "Couldn't create the voice",
      );
      created = String(profile.profile?.id || "");
      if (!created) throw new Error("Couldn't create the voice");
      setBusy("Learning your voice…");
      await readJson(
        await fetch(`/api/voicebox/profiles/${encodeURIComponent(created)}/samples`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ audioBase64: await toBase64(sample), filename: file && mode === "upload" ? file.name : "voice-sample.wav", mimeType: sample.type || "audio/wav", removeNoise: denoise }),
        }),
        "The voice sample didn't upload",
      );
      const { profiles } = await loadVoiceProfiles();
      if (!isVoiceReady(profiles.find((voice) => voice.id === created))) throw new Error("The sample wasn't accepted. Use a clear 15–60 second recording with one speaker and try again.");
      onCreated(created);
    } catch (err) {
      if (created) void fetch(`/api/voicebox/profiles/${encodeURIComponent(created)}`, { method: "DELETE" }).catch(() => undefined);
      setError(err instanceof Error ? err.message : "Voice cloning failed");
      setBusy("");
    }
  }

  return (
    <div className="mks-modal" onClick={() => !busy && onClose()}>
      <form className="mks-sheet exs-clone" role="dialog" aria-modal="true" aria-labelledby="exs-clone-title" onClick={(event) => event.stopPropagation()} onSubmit={(event) => void submit(event)}>
        <button ref={close} type="button" className="mks-close" aria-label="Close" onClick={onClose} disabled={Boolean(busy)}><X className="h-4 w-4" /></button>
        <h2 id="exs-clone-title" className="prs-sheet-title">Clone a voice</h2>
        <p className="prs-sheet-sub">Read the passage below for about 20 seconds, or upload a clean recording of one speaker. Only you can see and use voices you clone.</p>
        {online === false ? <p className="exs-note is-warn" role="status">Voice cloning is offline right now. You can still narrate with a built-in voice and clone yours later.</p> : null}

        <label className="exs-field">
          <span>Voice name</span>
          <input value={name} onChange={(event) => setName(event.target.value)} maxLength={60} placeholder="e.g. Maya, founder" autoComplete="off" />
        </label>

        <div className="mks-tabs exs-clone-tabs" role="tablist" aria-label="How to add your voice">
          <button type="button" role="tab" aria-selected={mode === "record"} onClick={() => setMode("record")} disabled={typeof MediaRecorder === "undefined"}><Mic className="h-3.5 w-3.5" />Record</button>
          <button type="button" role="tab" aria-selected={mode === "upload"} onClick={() => setMode("upload")}><Upload className="h-3.5 w-3.5" />Upload</button>
        </div>

        {mode === "record" ? (
          <div className="exs-record">
            <p className="exs-passage">{PASSAGE}</p>
            <div className="exs-record-row">
              {live !== null ? (
                <button type="button" className="exs-rec is-live" onClick={stopRecording}>
                  <Square className="h-4 w-4" aria-hidden="true" />
                  Stop
                  <span className="prs-num" aria-live="off">{clock(live)}</span>
                </button>
              ) : (
                <button type="button" className="exs-rec" onClick={() => void startRecording()} disabled={Boolean(busy) || online === false}>
                  <Mic className="h-4 w-4" aria-hidden="true" />
                  {recording ? "Record again" : "Start recording"}
                </button>
              )}
              {recording && live === null ? <audio src={recording.url} controls aria-label="Your recording" /> : null}
            </div>
            {live !== null ? <p className="exs-note" role="status">Recording. Read the passage at your normal pace, then press Stop.</p> : null}
          </div>
        ) : (
          <label className="exs-drop">
            <Upload className="h-4 w-4" aria-hidden="true" />
            <span>{file ? file.name : "Choose an audio file (WAV, MP3, M4A), 15–60 seconds of one speaker"}</span>
            <input type="file" accept="audio/*" onChange={(event) => pickFile(event.target.files?.[0] || null)} />
          </label>
        )}

        <label className="exs-check">
          <input type="checkbox" checked={denoise} onChange={(event) => setDenoise(event.target.checked)} />
          <span>Clean up background noise</span>
        </label>
        <label className="exs-check">
          <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
          <span>This is my voice, or I have the speaker's permission to clone it.</span>
        </label>

        {error ? <p className="mks-error" role="alert">{error}</p> : null}
        <div className="exs-sheet-actions">
          <button type="button" className="exs-ghost" onClick={onClose} disabled={Boolean(busy)}>Cancel</button>
          <button type="submit" className="exs-primary" disabled={!ready} title={missing || undefined}>
            {busy ? <><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />{busy}</> : "Clone voice"}
          </button>
        </div>
      </form>
    </div>
  );
}
