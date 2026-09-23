// Playback for Create Video: a scene played with its narration (storyboard cards
// and the scene popup), the soundtrack mixed under the narration, and quick
// previews of royalty-free tracks.
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type CSSProperties } from "react";
import { Loader2, Pause, Play } from "lucide-react";
import { sceneTransform } from "./StoryboardPreview";
import "./ScenePlayback.css";

type Scene = { id: string; start: number; end: number; motion?: string; clip?: string | null };

const clock = (seconds: number) => {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/**
 * One narration player shared by every scene: playing a scene seeks the
 * voiceover to its start and stops at its end. Only one scene plays at a time.
 */
export function useScenePlayback(voiceSrc?: string | null) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const range = useRef<{ id: string; start: number; end: number } | null>(null);
  const frame = useRef(0);
  const [playing, setPlaying] = useState("");
  const [loading, setLoading] = useState("");
  const [time, setTime] = useState(0);

  const stop = useCallback(() => {
    cancelAnimationFrame(frame.current);
    audio.current?.pause();
    range.current = null;
    setPlaying("");
    setLoading("");
  }, []);

  useEffect(() => {
    stop();
    audio.current = voiceSrc ? new Audio(voiceSrc) : null;
    if (audio.current) audio.current.preload = "metadata";
    return () => {
      stop();
      audio.current = null;
    };
  }, [voiceSrc, stop]);

  const play = useCallback(
    (scene: Scene) => {
      const el = audio.current;
      if (!el) return;
      cancelAnimationFrame(frame.current);
      range.current = { id: scene.id, start: scene.start, end: scene.end };
      setLoading(scene.id);
      setPlaying(scene.id);
      setTime(scene.start);
      el.currentTime = scene.start;
      void el
        .play()
        .then(() => {
          setLoading("");
          const tick = () => {
            const current = range.current;
            if (!current || !audio.current) return;
            const t = audio.current.currentTime;
            setTime(t);
            if (t >= current.end - 0.03 || audio.current.ended) return stop();
            frame.current = requestAnimationFrame(tick);
          };
          frame.current = requestAnimationFrame(tick);
        })
        .catch(() => stop());
    },
    [stop],
  );
  const toggle = useCallback((scene: Scene) => (range.current?.id === scene.id ? stop() : play(scene)), [play, stop]);

  return { available: Boolean(voiceSrc), playing, loading, time, toggle, stop };
}
export type ScenePlayback = ReturnType<typeof useScenePlayback>;

/** Pan-and-zoom transform (or none) for a scene while it plays. */
export function playbackStyle(playback: ScenePlayback, scene: Scene, index: number): CSSProperties | undefined {
  if (playback.playing !== scene.id || scene.clip || scene.motion !== "push") return undefined;
  return { ...sceneTransform(scene, index, playback.time), transition: "none" };
}

/** Keeps an animated clip in step with the narration while its scene plays. */
export function useClipSync(video: HTMLVideoElement | null, playback: ScenePlayback, scene: Scene) {
  const active = playback.playing === scene.id;
  useEffect(() => {
    if (!video) return;
    if (!active) {
      video.loop = true;
      return;
    }
    video.loop = false;
    const offset = Math.max(0, playback.time - scene.start);
    if (Math.abs(video.currentTime - offset) > 0.3) video.currentTime = Math.min(offset, Math.max(0, (video.duration || offset) - 0.05));
    if (video.paused) void video.play().catch(() => {});
  }, [video, active, playback.time, scene.start]);
}

/** An animated scene clip: loops on its own, follows the narration while its scene plays. */
export function SyncedClip({ src, playback, scene, label }: { src: string; playback: ScenePlayback; scene: Scene; label?: string }) {
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  useClipSync(video, playback, scene);
  return <video key={src} ref={setVideo} src={src} muted loop autoPlay playsInline aria-label={label} />;
}

export function ScenePlayButton({ playback, scene, index, size = "md" }: { playback: ScenePlayback; scene: Scene; index: number; size?: "md" | "lg" }) {
  if (!playback.available) return null;
  const on = playback.playing === scene.id;
  const progress = on ? Math.min(1, Math.max(0, (playback.time - scene.start) / Math.max(0.1, scene.end - scene.start))) : 0;
  return (
    <>
      <button
        type="button"
        className="spb-play"
        data-size={size}
        data-on={on || undefined}
        aria-label={on ? `Stop scene ${index + 1}` : `Play scene ${index + 1} with narration`}
        title={on ? "Stop" : "Play with narration"}
        onClick={(event) => {
          event.stopPropagation();
          playback.toggle(scene);
        }}
      >
        {playback.loading === scene.id ? <Loader2 size={size === "lg" ? 22 : 16} className="animate-spin" /> : on ? <Pause size={size === "lg" ? 22 : 16} /> : <Play size={size === "lg" ? 22 : 16} />}
      </button>
      {on ? (
        <span className="spb-progress" aria-hidden="true">
          <span style={{ transform: `scaleX(${progress})` }} />
        </span>
      ) : null}
    </>
  );
}

export type MixPreviewHandle = { playFrom: (start: number) => void };

/**
 * The soundtrack under the narration, at the project's music level. The render
 * ducks music under speech; this preview plays it at the set level throughout.
 */
export const MixPreview = forwardRef<MixPreviewHandle, { voice?: string | null; music?: string | null; volume: number; duration: number }>(function MixPreview(
  { voice, music, volume, duration },
  ref,
) {
  const voiceEl = useRef<HTMLAudioElement>(null);
  const musicEl = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [muteVoice, setMuteVoice] = useState(false);
  const total = Math.max(0.1, duration || voiceEl.current?.duration || musicEl.current?.duration || 0.1);
  const lead = () => voiceEl.current || musicEl.current;

  useEffect(() => {
    if (musicEl.current) musicEl.current.volume = Math.min(1, Math.max(0, volume));
  }, [volume, music]);
  useEffect(() => {
    if (voiceEl.current) voiceEl.current.muted = muteVoice;
  }, [muteVoice, voice]);
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const tick = () => {
      const t = lead()?.currentTime || 0;
      setTime(t);
      const m = musicEl.current;
      if (m && voiceEl.current && Math.abs(m.currentTime - t) > 0.25 && t < (m.duration || Infinity)) m.currentTime = t;
      if (t >= total - 0.05) return pause();
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, total]);
  const seek = (t: number) => {
    const at = Math.min(total, Math.max(0, t));
    setTime(at);
    for (const el of [voiceEl.current, musicEl.current]) if (el) el.currentTime = Math.min(at, el.duration || at);
  };
  const start = () => {
    for (const el of [voiceEl.current, musicEl.current]) if (el) void el.play().catch(() => {});
    setPlaying(true);
  };
  function pause() {
    for (const el of [voiceEl.current, musicEl.current]) el?.pause();
    setPlaying(false);
  }
  useImperativeHandle(ref, () => ({
    playFrom: (at: number) => {
      seek(at);
      start();
    },
  }));

  if (!music) return null;
  return (
    <div className="spb-mix" aria-label="Soundtrack preview">
      {voice ? <audio ref={voiceEl} src={voice} preload="metadata" /> : null}
      <audio ref={musicEl} src={music} preload="metadata" />
      <button type="button" className="spb-mix-play" aria-label={playing ? "Pause preview" : "Play soundtrack with narration"} onClick={() => (playing ? pause() : start())}>
        {playing ? <Pause size={18} /> : <Play size={18} />}
      </button>
      <div className="spb-mix-main">
        <div className="spb-mix-label">
          <strong>{voice ? "Preview with narration" : "Preview soundtrack"}</strong>
          <span>
            {clock(time)} / {clock(total)}
          </span>
        </div>
        <input type="range" aria-label="Preview position" min={0} max={total} step={0.1} value={Math.min(time, total)} onChange={(e) => seek(Number(e.target.value))} />
      </div>
      {voice ? (
        <label className="spb-mix-toggle">
          <input type="checkbox" checked={!muteVoice} onChange={(e) => setMuteVoice(!e.target.checked)} />
          Narration
        </label>
      ) : null}
    </div>
  );
});

/** Play/stop for one royalty-free search result; starting one stops the others. */
let trackAudio: HTMLAudioElement | null = null;
let trackStop: (() => void) | null = null;
export function TrackPreviewButton({ url, title }: { url: string; title: string }) {
  const [state, setState] = useState<"" | "loading" | "playing">("");
  const stopThis = useRef(() => setState(""));
  // Leaving the list stops whatever this row was playing.
  useEffect(
    () => () => {
      if (trackStop === stopThis.current) {
        trackAudio?.pause();
        trackStop = null;
      }
    },
    [],
  );
  const toggle = () => {
    if (state) {
      trackAudio?.pause();
      trackStop = null;
      return setState("");
    }
    trackAudio?.pause();
    trackStop?.();
    trackAudio = new Audio(url);
    trackStop = stopThis.current;
    setState("loading");
    trackAudio.onended = () => setState("");
    void trackAudio
      .play()
      .then(() => setState("playing"))
      .catch(() => setState(""));
  };
  return (
    <button type="button" className="spb-track" aria-label={state ? `Stop ${title}` : `Preview ${title}`} title={state ? "Stop" : "Preview"} onClick={toggle}>
      {state === "loading" ? <Loader2 size={15} className="animate-spin" /> : state === "playing" ? <Pause size={15} /> : <Play size={15} />}
    </button>
  );
}
