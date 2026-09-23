// Storyboard preview: plays the voiceover and shows each scene the way the render
// will: cropped to fill the frame, hard cuts, and the same push-in zoom as FFmpeg's
// zoompan (1.2% per second up to 1.15x, anchored top-left).
import { type KeyboardEvent, RefObject, useCallback, useEffect, useRef, useState } from "react";
import { Captions, ChevronLeft, ChevronRight, ImagePlus, Loader2, Maximize2, Pause, Play, Scissors, Volume2, VolumeX } from "lucide-react";
import "./StoryboardPreview.css";

type Scene = { id: string; start: number; end: number; text?: string; prompt?: string; asset?: string | null; clip?: string | null; motion?: string; generating?: boolean; error?: string };
type Line = { start: number; end: number; text: string };

const clock = (seconds: number) => {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
export const sceneAt = (scenes: Scene[], time: number) =>
  Math.max(0, scenes.findIndex((scene, index) => time < scene.end || index === scenes.length - 1));
export const pushScale = (elapsed: number) => Math.min(1.15, 1 + 0.012 * Math.max(0, elapsed));

export function StoryboardPreview({
  scenes,
  lines,
  audioSrc,
  duration,
  aspect,
  audioRef,
  selectedId,
  generating,
  onSelect,
  onTime,
  onSplit,
}: {
  scenes: Scene[];
  lines: Line[];
  audioSrc?: string;
  duration: number;
  aspect: string;
  audioRef: RefObject<HTMLAudioElement | null>;
  selectedId: string;
  generating: boolean;
  onSelect: (id: string) => void;
  onTime: (time: number) => void;
  onSplit: () => void;
}) {
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [captions, setCaptions] = useState(true);
  const [audioError, setAudioError] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const clipRef = useRef<HTMLVideoElement>(null);
  const lastReported = useRef(0);
  const lastScene = useRef("");
  const [w, h] = aspect.split(":").map(Number);
  const total = duration || scenes.at(-1)?.end || 0;
  const index = sceneAt(scenes, time);
  const scene = scenes[index];
  const line = lines.find((item) => time >= item.start && time < item.end);

  const seek = useCallback((next: number) => {
    const t = Math.min(Math.max(0, next), total);
    setTime(t);
    if (audioRef.current) audioRef.current.currentTime = t;
    onTime(t);
  }, [audioRef, onTime, total]);

  // When a scene is picked elsewhere and we're paused, show it.
  useEffect(() => {
    if (playing || !selectedId) return;
    const picked = scenes.find((item) => item.id === selectedId);
    if (picked && (time < picked.start || time >= picked.end)) seek(picked.start);
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  // A frame loop reads the audio clock so zoom and cuts stay smooth without
  // re-rendering the whole editor; the parent hears about time a few times a second.
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const tick = () => {
      const t = audioRef.current?.currentTime ?? 0;
      setTime(t);
      if (Math.abs(t - lastReported.current) > 0.25) {
        lastReported.current = t;
        onTime(t);
      }
      const current = scenes[sceneAt(scenes, t)];
      if (current && current.id !== lastScene.current) {
        lastScene.current = current.id;
        onSelect(current.id);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, scenes, audioRef, onTime, onSelect]);

  // Animated scenes play their clip in step with the narration.
  useEffect(() => {
    const video = clipRef.current;
    if (!video || !scene?.clip) return;
    const offset = Math.max(0, time - scene.start);
    if (Math.abs(video.currentTime - offset) > 0.3) video.currentTime = Math.min(offset, Math.max(0, (video.duration || offset) - 0.05));
    if (playing && video.paused) void video.play().catch(() => {});
    if (!playing && !video.paused) video.pause();
  }, [scene?.id, scene?.clip, playing, time]);

  const toggle = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
      setPlaying(false);
      onTime(audio.currentTime);
      return;
    }
    if (audio.ended || audio.currentTime >= total - 0.05) audio.currentTime = 0;
    try {
      await audio.play();
      setPlaying(true);
    } catch {
      setAudioError(true);
    }
  };
  const step = (delta: number) => {
    const target = scenes[Math.min(scenes.length - 1, Math.max(0, index + delta))];
    if (!target) return;
    seek(target.start);
    onSelect(target.id);
  };
  const onKey = (event: KeyboardEvent) => {
    if ((event.target as HTMLElement).closest("input, textarea, select")) return;
    if (event.key === " " || event.key === "k") {
      event.preventDefault();
      void toggle();
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      step(1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      step(-1);
    }
  };

  const zoom = scene?.motion === "push" && !scene.clip ? pushScale(time - scene.start) : 1;
  return (
    <section className="sbp" aria-label="Video preview" onKeyDown={onKey}>
      <div className="sbp-stage" ref={stage} onDoubleClick={() => void stage.current?.requestFullscreen?.().catch(() => {})}>
        <div className="sbp-frame" style={{ aspectRatio: `${w} / ${h}`, ...(w >= h ? { width: "100%" } : { height: "100%" }) }}>
          {scene?.clip ? (
            <video key={scene.id} ref={clipRef} className="sbp-media" src={scene.clip} muted playsInline preload="auto" />
          ) : scene?.asset ? (
            <img key={scene.id} className="sbp-media" src={scene.asset} alt={`Scene ${index + 1}`} style={{ transform: `scale(${zoom})` }} />
          ) : scene ? (
            <div className="sbp-empty">
              {generating && scene.generating ? <Loader2 size={22} className="animate-spin" /> : <ImagePlus size={22} />}
              <strong>Scene {index + 1}</strong>
              <span>{scene.error ? "Image failed. Regenerate it from the editor." : "No image yet"}</span>
            </div>
          ) : null}
          {captions && line?.text ? <p className="sbp-caption">{line.text}</p> : null}
          <span className="sbp-badge">
            {index + 1} / {scenes.length}
          </span>
        </div>
        {!playing && (
          <button type="button" className="sbp-bigplay" onClick={() => void toggle()} aria-label="Play preview" disabled={!audioSrc}>
            <Play size={22} />
          </button>
        )}
      </div>

      <div className="sbp-scrub">
        <div className="sbp-marks" aria-hidden="true">
          {scenes.map((item, i) => (
            <span
              key={item.id}
              style={{ left: `${(item.start / Math.max(total, 0.01)) * 100}%`, width: `${((item.end - item.start) / Math.max(total, 0.01)) * 100}%` }}
              data-state={item.error ? "failed" : item.asset || item.clip ? "ready" : "missing"}
              data-current={i === index || undefined}
            />
          ))}
        </div>
        <input
          type="range"
          aria-label="Preview position"
          min={0}
          max={total || 1}
          step={0.05}
          value={time}
          onChange={(event) => {
            const t = Number(event.target.value);
            seek(t);
            const target = scenes[sceneAt(scenes, t)];
            if (target) onSelect(target.id);
          }}
        />
      </div>

      <div className="sbp-controls">
        <button type="button" className="sbp-btn" onClick={() => step(-1)} aria-label="Previous scene" disabled={index === 0}>
          <ChevronLeft size={16} />
        </button>
        <button type="button" className="sbp-btn is-main" onClick={() => void toggle()} aria-label={playing ? "Pause preview" : "Play preview"} disabled={!audioSrc}>
          {playing ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <button type="button" className="sbp-btn" onClick={() => step(1)} aria-label="Next scene" disabled={index >= scenes.length - 1}>
          <ChevronRight size={16} />
        </button>
        <span className="sbp-time">
          {clock(time)} / {clock(total)}
        </span>
        <span className="sbp-spacer" />
        <button type="button" className="sbp-btn" aria-pressed={captions} onClick={() => setCaptions(!captions)} aria-label="Show narration captions" title="Narration captions">
          <Captions size={16} />
        </button>
        <button
          type="button"
          className="sbp-btn"
          aria-pressed={muted}
          onClick={() => {
            if (audioRef.current) audioRef.current.muted = !muted;
            setMuted(!muted);
          }}
          aria-label={muted ? "Unmute" : "Mute"}
        >
          {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
        </button>
        <button type="button" className="sbp-btn" onClick={onSplit} aria-label="Split scene at playhead" title="Split the scene here">
          <Scissors size={16} />
        </button>
        <button type="button" className="sbp-btn" onClick={() => void stage.current?.requestFullscreen?.().catch(() => {})} aria-label="Full screen">
          <Maximize2 size={16} />
        </button>
      </div>
      {audioError && <p className="sbp-note">The voiceover couldn't play. Regenerate the voiceover, then try again.</p>}
      <audio
        ref={audioRef as RefObject<HTMLAudioElement>}
        src={audioSrc}
        preload="auto"
        onEnded={() => {
          setPlaying(false);
          onTime(total);
        }}
        onPause={() => setPlaying(false)}
        onError={() => setAudioError(Boolean(audioSrc))}
      />
    </section>
  );
}
