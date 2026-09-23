// Storyboard preview: follows the storyboard timeline's voiceover player and shows
// each scene the way the render will: cropped to fill the frame, hard cuts, and
// the same push-in zoom as FFmpeg's zoompan (1.2% per second up to 1.15x,
// anchored top-left). It has no clock of its own; the timeline drives it.
import { RefObject, useEffect, useRef, useState } from "react";
import { Captions, ImagePlus, Loader2, Maximize2, Pause, Play } from "lucide-react";
import "./StoryboardPreview.css";

type Scene = { id: string; start: number; end: number; asset?: string | null; clip?: string | null; motion?: string; generating?: boolean; error?: string };
type Line = { start: number; end: number; text: string };

export const sceneAt = (scenes: Array<{ end: number }>, time: number) =>
  Math.max(0, scenes.findIndex((scene, index) => time < scene.end || index === scenes.length - 1));
export const pushScale = (elapsed: number) => Math.min(1.15, 1 + 0.012 * Math.max(0, elapsed));

export function StoryboardPreview({
  scenes,
  lines,
  aspect,
  audioRef,
  time: externalTime,
  generating,
  onSceneChange,
}: {
  scenes: Scene[];
  lines: Line[];
  aspect: string;
  audioRef: RefObject<HTMLAudioElement | null>;
  time: number;
  generating: boolean;
  onSceneChange: (id: string) => void;
}) {
  const [time, setTime] = useState(externalTime);
  const [playing, setPlaying] = useState(false);
  const [captions, setCaptions] = useState(true);
  const stage = useRef<HTMLDivElement>(null);
  const clipRef = useRef<HTMLVideoElement>(null);
  const lastScene = useRef("");
  const [w, h] = aspect.split(":").map(Number);
  const index = sceneAt(scenes, time);
  const scene = scenes[index];
  const line = lines.find((item) => time >= item.start && time < item.end);

  // Seeks from the timeline (scene buttons, scrubber) arrive through the shared playhead.
  useEffect(() => {
    if (!playing) setTime(externalTime);
  }, [externalTime, playing]);

  // Mirror the timeline's audio element: its play state, and its clock every frame while playing.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const sync = () => {
      setPlaying(!audio.paused && !audio.ended);
      setTime(audio.currentTime);
    };
    const events = ["play", "pause", "ended", "seeked", "loadedmetadata"];
    events.forEach((name) => audio.addEventListener(name, sync));
    sync();
    return () => events.forEach((name) => audio.removeEventListener(name, sync));
  }, [audioRef]);
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const tick = () => {
      const t = audioRef.current?.currentTime ?? 0;
      setTime(t);
      const current = scenes[sceneAt(scenes, t)];
      if (current && current.id !== lastScene.current) {
        lastScene.current = current.id;
        onSceneChange(current.id);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, scenes, audioRef, onSceneChange]);

  // Animated scenes play their clip in step with the narration.
  useEffect(() => {
    const video = clipRef.current;
    if (!video || !scene?.clip) return;
    const offset = Math.max(0, time - scene.start);
    if (Math.abs(video.currentTime - offset) > 0.3) video.currentTime = Math.min(offset, Math.max(0, (video.duration || offset) - 0.05));
    if (playing && video.paused) void video.play().catch(() => {});
    if (!playing && !video.paused) video.pause();
  }, [scene?.id, scene?.clip, playing, time]);

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) void audio.play().catch(() => {});
    else audio.pause();
  };
  const fullscreen = () => void stage.current?.requestFullscreen?.().catch(() => {});
  const zoom = scene?.motion === "push" && !scene.clip ? pushScale(time - scene.start) : 1;

  return (
    <section className="sbp" aria-label="Video preview">
      <div className="sbp-stage" ref={stage} onDoubleClick={fullscreen}>
        <div className="sbp-frame" style={{ aspectRatio: `${w} / ${h}`, ...(w >= h ? { width: "100%" } : { height: "100%" }) }}>
          {scene?.clip ? (
            <video key={scene.id} ref={clipRef} className="sbp-media" src={scene.clip} muted playsInline preload="auto" />
          ) : scene?.asset ? (
            <img key={scene.id} className="sbp-media" src={scene.asset} alt={`Scene ${index + 1}`} style={{ transform: `scale(${zoom})` }} />
          ) : scene ? (
            <div className="sbp-empty">
              {generating && scene.generating ? <Loader2 size={22} className="animate-spin" /> : <ImagePlus size={22} />}
              <strong>Scene {index + 1}</strong>
              <span>{scene.error ? "Image failed. Regenerate it from the scene editor." : "No image yet"}</span>
            </div>
          ) : null}
          {captions && line?.text ? <p className="sbp-caption">{line.text}</p> : null}
        </div>
        <span className="sbp-badge">
          Scene {index + 1} / {scenes.length} · {aspect}
        </span>
        <div className="sbp-tools">
          <button type="button" className="sbp-tool" aria-pressed={captions} onClick={() => setCaptions(!captions)} aria-label="Narration captions" title="Narration captions">
            <Captions size={16} />
          </button>
          <button type="button" className="sbp-tool" onClick={fullscreen} aria-label="Full screen" title="Full screen">
            <Maximize2 size={16} />
          </button>
        </div>
        <button type="button" className={playing ? "sbp-bigplay is-playing" : "sbp-bigplay"} onClick={toggle} aria-label={playing ? "Pause preview" : "Play preview"}>
          {playing ? <Pause size={22} /> : <Play size={22} />}
        </button>
      </div>
    </section>
  );
}
