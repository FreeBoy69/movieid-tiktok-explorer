import { useEffect, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import { Download, Loader2, Pause, Play, Volume2, VolumeX } from "lucide-react";
import "./AudioPlayer.css";

const BARS = 72;
const SPEEDS = [1, 1.25, 1.5, 2, 0.75];
// Real waveforms are decoded from the file; skip it for very long audio.
const MAX_WAVEFORM_SECONDS = 20 * 60;

// Only one player sounds at a time across the page.
let activeAudio: HTMLAudioElement | null = null;
export function claimPlayback(audio: HTMLAudioElement) {
  if (activeAudio && activeAudio !== audio && !activeAudio.paused) activeAudio.pause();
  activeAudio = audio;
}

export function formatClock(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const whole = Math.floor(seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const secs = String(whole % 60).padStart(2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${secs}` : `${minutes}:${secs}`;
}

const peaksCache = new Map<string, number[]>();
async function decodePeaks(src: string, signal: AbortSignal) {
  if (peaksCache.has(src)) return peaksCache.get(src)!;
  const response = await fetch(src, { signal });
  if (!response.ok) throw new Error("audio unavailable");
  const Context = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const context = new Context();
  try {
    const buffer = await context.decodeAudioData(await response.arrayBuffer());
    const data = buffer.getChannelData(0);
    const step = Math.max(1, Math.floor(data.length / BARS));
    const peaks: number[] = [];
    for (let bar = 0; bar < BARS; bar++) {
      let peak = 0;
      const start = bar * step;
      // Sampling every 16th value is plenty for a 72-bar overview.
      for (let i = start; i < Math.min(start + step, data.length); i += 16) peak = Math.max(peak, Math.abs(data[i]));
      peaks.push(peak);
    }
    const loudest = Math.max(...peaks, 0.001);
    const normalized = peaks.map((peak) => Math.max(0.08, Math.pow(peak / loudest, 0.8)));
    peaksCache.set(src, normalized);
    return normalized;
  } finally {
    void context.close();
  }
}

export function AudioPlayer({
  src,
  title,
  meta,
  audioRef,
  onTimeUpdate,
  download,
  preload = "metadata",
  compact = false,
  label,
  className = "",
}: {
  src: string;
  title?: ReactNode;
  meta?: ReactNode;
  audioRef?: MutableRefObject<HTMLAudioElement | null>;
  onTimeUpdate?: (seconds: number) => void;
  /** true downloads with the server's name; a string sets the file name. */
  download?: boolean | string;
  preload?: "none" | "metadata" | "auto";
  /** Row-sized player for lists: no title, tools, or decoded waveform. */
  compact?: boolean;
  /** Names the audio for screen readers when there is no visible title. */
  label?: string;
  className?: string;
}) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState("");
  const [peaks, setPeaks] = useState<number[] | null>(() => peaksCache.get(src) || null);

  useEffect(() => {
    setPlaying(false);
    setTime(0);
    setDuration(0);
    setError("");
    setPeaks(peaksCache.get(src) || null);
  }, [src]);

  useEffect(() => {
    if (compact || !duration || duration > MAX_WAVEFORM_SECONDS || peaksCache.has(src)) return;
    const controller = new AbortController();
    decodePeaks(src, controller.signal)
      .then((next) => !controller.signal.aborted && setPeaks(next))
      .catch(() => {});
    return () => controller.abort();
  }, [src, duration, compact]);

  const bind = (element: HTMLAudioElement | null) => {
    audio.current = element;
    if (audioRef) audioRef.current = element;
  };
  const sync = (element: HTMLAudioElement) => {
    if (Number.isFinite(element.duration) && element.duration > 0) setDuration(element.duration);
  };
  async function toggle() {
    const element = audio.current;
    if (!element) return;
    if (!element.paused) return element.pause();
    try {
      setError("");
      claimPlayback(element);
      await element.play();
    } catch (reason) {
      if ((reason as Error)?.name !== "AbortError") setError("This audio can't be played right now.");
    }
  }
  function seek(seconds: number) {
    const element = audio.current;
    if (!element || !duration) return;
    element.currentTime = Math.max(0, Math.min(duration, seconds));
    setTime(element.currentTime);
    onTimeUpdate?.(element.currentTime);
  }
  function cycleSpeed() {
    const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
    setSpeed(next);
    if (audio.current) audio.current.playbackRate = next;
  }
  function toggleMute() {
    const next = !muted;
    setMuted(next);
    if (audio.current) audio.current.muted = next;
  }

  const progress = duration ? Math.min(1, time / duration) : 0;
  // Without a decoded waveform, a flat line reads as a plain progress track.
  const bars = peaks || Array.from({ length: compact ? 48 : BARS }, () => 0.14);
  const downloadName = typeof download === "string" ? download : "";

  return (
    <div className={`mk-audio ${compact ? "is-compact" : ""} ${peaks ? "has-peaks" : ""} ${playing ? "is-playing" : ""} ${error ? "has-error" : ""} ${className}`.trim()}>
      <audio
        ref={bind}
        src={src}
        preload={preload}
        onLoadedMetadata={(e) => sync(e.currentTarget)}
        onDurationChange={(e) => sync(e.currentTarget)}
        onTimeUpdate={(e) => {
          setTime(e.currentTarget.currentTime);
          onTimeUpdate?.(e.currentTarget.currentTime);
        }}
        onPlay={(e) => {
          claimPlayback(e.currentTarget);
          setPlaying(true);
        }}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onWaiting={() => setWaiting(true)}
        onPlaying={() => setWaiting(false)}
        onCanPlay={() => setWaiting(false)}
        onError={() => {
          setWaiting(false);
          setPlaying(false);
          setError("This audio file couldn't be loaded.");
        }}
      />
      <button
        type="button"
        className="mk-audio-play"
        onClick={() => void toggle()}
        aria-label={`${playing ? "Pause" : "Play"}${label ? ` ${label}` : typeof title === "string" ? ` ${title}` : ""}`}
        disabled={Boolean(error) && !duration}
      >
        {waiting && playing ? <Loader2 size={compact ? 15 : 18} className="mk-audio-spin" /> : playing ? <Pause size={compact ? 14 : 18} fill="currentColor" /> : <Play size={compact ? 14 : 18} fill="currentColor" className="mk-audio-play-glyph" />}
      </button>
      <div className="mk-audio-main">
        {!compact && (title || meta) && (
          <div className="mk-audio-head">
            {title && <span className="mk-audio-title">{title}</span>}
            {meta && <span className="mk-audio-meta">{meta}</span>}
          </div>
        )}
        <div className="mk-audio-wave" style={{ ["--mk-audio-progress" as string]: `${progress * 100}%` }}>
          <div className="mk-audio-bars" aria-hidden="true">
            {bars.map((height, index) => (
              <span key={index} style={{ height: `${Math.round(height * 100)}%` }} />
            ))}
          </div>
          <div className="mk-audio-bars is-played" aria-hidden="true">
            {bars.map((height, index) => (
              <span key={index} style={{ height: `${Math.round(height * 100)}%` }} />
            ))}
          </div>
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.1}
            value={Math.min(time, duration || 0)}
            disabled={!duration}
            aria-label="Seek"
            aria-valuetext={`${formatClock(time)} of ${formatClock(duration)}`}
            onChange={(e) => seek(Number(e.target.value))}
          />
        </div>
        {error && <span className="mk-audio-error" role="status">{error}</span>}
      </div>
      <span className="mk-audio-time">
        {formatClock(time)}
        <span> / {duration ? formatClock(duration) : "–:––"}</span>
      </span>
      {!compact && <div className="mk-audio-tools">
        <button type="button" className="mk-audio-tool mk-audio-speed" onClick={cycleSpeed} aria-label={`Playback speed ${speed}×`}>
          {speed}×
        </button>
        <button type="button" className="mk-audio-tool" onClick={toggleMute} aria-label={muted ? "Unmute" : "Mute"} aria-pressed={muted}>
          {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
        </button>
        {download && (
          <a className="mk-audio-tool" href={src} download={downloadName || true} aria-label="Download audio">
            <Download size={16} />
          </a>
        )}
      </div>}
    </div>
  );
}
