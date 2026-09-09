import { useMemo, useRef, useState } from "react";
import { Pause, Play, Scissors, ZoomIn, ZoomOut } from "lucide-react";
import {
  formatTimelineClock,
  moveScene,
  sceneAtTime,
  sceneDuration,
  splitSceneAtTime,
  timelineDuration,
} from "../utils/voiceoverTimeline.js";

type Scene = {
  id: string;
  start: number;
  end: number;
  label?: string;
  sourceStart?: number;
  sourceEnd?: number;
};

type Props = {
  scenes: Scene[];
  playhead: number;
  playing: boolean;
  selectedId: string;
  disabled?: boolean;
  avatarLabel?: string;
  avatarActive?: boolean;
  onScenesChange: (scenes: Scene[]) => void;
  onSelect: (id: string) => void;
  onSeek: (time: number) => void;
  onTogglePlay: () => void;
};

export function VoiceoverTimeline({
  scenes,
  playhead,
  playing,
  selectedId,
  disabled,
  avatarLabel = "Reserved for remake",
  avatarActive = false,
  onScenesChange,
  onSelect,
  onSeek,
  onTogglePlay,
}: Props) {
  const [zoom, setZoom] = useState(100);
  const [showTiming, setShowTiming] = useState(true);
  const [dragId, setDragId] = useState("");
  const stripRef = useRef<HTMLDivElement>(null);
  const duration = Math.max(timelineDuration(scenes), 0.1);
  const pxPerSecond = (2.4 * zoom) / 100;
  const active = sceneAtTime(scenes, playhead);

  const markers = useMemo(() => {
    const step = duration > 60 ? 10 : duration > 20 ? 5 : 2;
    const items: number[] = [];
    for (let t = 0; t <= duration + 0.01; t += step) items.push(Number(t.toFixed(2)));
    return items;
  }, [duration]);

  function seekFromClientX(clientX: number) {
    const el = stripRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, clientX - rect.left + el.scrollLeft));
    onSeek(Math.max(0, Math.min(duration, x / pxPerSecond)));
  }

  function onDragStart(id: string) {
    if (disabled) return;
    setDragId(id);
  }

  function onDrop(targetId: string) {
    if (!dragId || dragId === targetId || disabled) {
      setDragId("");
      return;
    }
    const from = scenes.findIndex((scene) => scene.id === dragId);
    const to = scenes.findIndex((scene) => scene.id === targetId);
    if (from >= 0 && to >= 0) onScenesChange(moveScene(scenes, from, to));
    setDragId("");
  }

  return (
    <section className="voice-timeline" aria-label="Scene timeline">
      <div className="voice-timeline-bar">
        <button type="button" className="voice-timeline-ghost" onClick={() => setShowTiming((value) => !value)}>
          {showTiming ? "Hide timing" : "Show timing"}
        </button>
        <div className="voice-timeline-transport">
          <button type="button" className="voice-timeline-play" onClick={onTogglePlay} aria-label={playing ? "Pause" : "Play"} disabled={!scenes.length}>
            {playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
          </button>
          <span className="voice-timeline-clock" aria-live="polite">
            {formatTimelineClock(playhead)} / {formatTimelineClock(duration)}
          </span>
        </div>
        <div className="voice-timeline-tools">
          <button
            type="button"
            className="voice-timeline-ghost"
            disabled={disabled || !scenes.length}
            onClick={() => onScenesChange(splitSceneAtTime(scenes, playhead))}
            title="Split scene at playhead"
          >
            <Scissors size={15} />
            Split
          </button>
          <label className="voice-timeline-zoom">
            <ZoomOut size={14} aria-hidden="true" />
            <input
              type="range"
              min={60}
              max={180}
              step={10}
              value={zoom}
              aria-label="Timeline zoom"
              onChange={(e) => setZoom(Number(e.target.value))}
            />
            <ZoomIn size={14} aria-hidden="true" />
            <span>{zoom}%</span>
          </label>
        </div>
      </div>

      <div
        className="voice-timeline-strip"
        ref={stripRef}
        onClick={(e) => seekFromClientX(e.clientX)}
        role="slider"
        aria-label="Timeline playhead"
        aria-valuemin={0}
        aria-valuemax={duration}
        aria-valuenow={playhead}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") onSeek(Math.min(duration, playhead + 0.5));
          if (e.key === "ArrowLeft") onSeek(Math.max(0, playhead - 0.5));
        }}
      >
        {showTiming ? (
          <div className="voice-timeline-ruler" style={{ width: duration * pxPerSecond }}>
            {markers.map((mark) => (
              <span key={mark} style={{ left: mark * pxPerSecond }}>
                {mark.toFixed(mark % 1 ? 1 : 0)}
              </span>
            ))}
          </div>
        ) : null}

        <div className="voice-timeline-scenes" style={{ width: Math.max(duration * pxPerSecond, 240) }}>
          {scenes.length ? scenes.map((scene, index) => {
            const width = Math.max(72, sceneDuration(scene) * pxPerSecond);
            const selected = scene.id === selectedId || scene.id === active?.id;
            return (
              <button
                type="button"
                key={scene.id}
                className={`voice-timeline-scene ${selected ? "is-selected" : ""} ${dragId === scene.id ? "is-dragging" : ""}`}
                style={{ width }}
                draggable={!disabled}
                onDragStart={() => onDragStart(scene.id)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onDrop(scene.id);
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect(scene.id);
                  onSeek(scene.start + 0.01);
                }}
                aria-pressed={selected}
                title="Drag to reorder freely. Agent uniqueness stays adjacent-only."
              >
                <strong>{scene.label || `Scene ${index + 1}`}</strong>
                <span>{sceneDuration(scene).toFixed(1)}s</span>
              </button>
            );
          }) : (
            <div className="voice-timeline-empty">Analyze a video to build scenes on this timeline.</div>
          )}
          <div className="voice-timeline-playhead" style={{ left: playhead * pxPerSecond }} aria-hidden="true" />
        </div>

        <div className="voice-timeline-tracks" style={{ width: Math.max(duration * pxPerSecond, 240) }}>
          <div className="voice-timeline-track is-captions" title="Captions track">
            <span className="voice-timeline-track-label">Aa</span>
            <div className="voice-timeline-track-bar" style={{ width: `${Math.min(100, (duration ? playhead / duration : 0) * 100 + 18)}%` }} />
          </div>
          <div className="voice-timeline-track is-audio" title="Narration / soundtrack">
            <span className="voice-timeline-track-label">Audio</span>
            <div className="voice-timeline-track-bar is-wave" style={{ width: "100%" }} />
          </div>
          <div className={`voice-timeline-track is-avatar ${avatarActive ? "is-active" : ""}`} title="Avatar remake track">
            <span className="voice-timeline-track-label">Avatar</span>
            <div className="voice-timeline-track-bar is-muted">{avatarLabel}</div>
          </div>
        </div>
      </div>
      <p className="voice-timeline-hint">Manual edit: drag scenes freely. Agent uniqueness mode may only swap adjacent scenes.</p>
    </section>
  );
}
