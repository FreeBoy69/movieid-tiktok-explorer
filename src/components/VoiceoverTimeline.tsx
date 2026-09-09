import { useMemo, useRef, useState } from "react";
import {
  Film,
  Lock,
  Mic,
  Music2,
  Pause,
  Play,
  Scissors,
  Settings2,
  Type,
  UserRound,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
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
  avatarActive?: boolean;
  onScenesChange: (scenes: Scene[]) => void;
  onSelect: (id: string) => void;
  onSeek: (time: number) => void;
  onTogglePlay: () => void;
};

function waveBars(count: number, seed: number) {
  const bars: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const n = Math.sin((i + 1) * 0.55 + seed) * 0.35 + Math.sin((i + 1) * 1.7 + seed * 0.4) * 0.25 + 0.4;
    bars.push(Math.max(0.12, Math.min(1, Math.abs(n))));
  }
  return bars;
}

export function VoiceoverTimeline({
  scenes,
  playhead,
  playing,
  selectedId,
  disabled,
  avatarActive = false,
  onScenesChange,
  onSelect,
  onSeek,
  onTogglePlay,
}: Props) {
  const [zoom, setZoom] = useState(100);
  const [dragId, setDragId] = useState("");
  const stripRef = useRef<HTMLDivElement>(null);
  const duration = Math.max(timelineDuration(scenes), 0.1);
  const pxPerSecond = (48 * zoom) / 100;
  const trackWidth = Math.max(duration * pxPerSecond, 320);
  const active = sceneAtTime(scenes, playhead);
  const waves = useMemo(() => waveBars(Math.max(48, Math.floor(trackWidth / 4)), scenes.length || 1), [trackWidth, scenes.length]);

  const markers = useMemo(() => {
    const step = duration > 120 ? 30 : duration > 60 ? 10 : duration > 20 ? 5 : 2;
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
    <section className="nle" aria-label="Timeline">
      <header className="nle-toolbar">
        <div className="nle-toolbar-left">
          <button type="button" className="nle-icon-btn is-accent" onClick={onTogglePlay} aria-label={playing ? "Pause" : "Play"} disabled={!scenes.length}>
            {playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
          </button>
          <span className="nle-clock" aria-live="polite">{formatTimelineClock(playhead)} / {formatTimelineClock(duration)}</span>
          <span className="nle-toolbar-sep" aria-hidden="true" />
          <button
            type="button"
            className="nle-icon-btn"
            disabled={disabled || !scenes.length}
            onClick={() => onScenesChange(splitSceneAtTime(scenes, playhead))}
            aria-label="Split at playhead"
            title="Split"
          >
            <Scissors size={15} />
          </button>
          <button type="button" className="nle-icon-btn" disabled aria-label="Voiceover" title="Voiceover">
            <Mic size={15} />
          </button>
        </div>
        <div className="nle-toolbar-right">
          <label className="nle-zoom">
            <ZoomOut size={14} aria-hidden="true" />
            <input
              type="range"
              min={40}
              max={220}
              step={10}
              value={zoom}
              aria-label="Zoom"
              onChange={(e) => setZoom(Number(e.target.value))}
            />
            <ZoomIn size={14} aria-hidden="true" />
          </label>
        </div>
      </header>

      <div className="nle-body">
        <aside className="nle-gutters" aria-hidden="true">
          <div className="nle-gutter is-ruler" />
          <div className="nle-gutter is-captions">
            <Type size={14} strokeWidth={2} />
            <Lock size={12} strokeWidth={2} />
            <Settings2 size={12} strokeWidth={2} />
          </div>
          <div className="nle-gutter is-video">
            <Film size={14} strokeWidth={2} />
            <Lock size={12} strokeWidth={2} />
            <Settings2 size={12} strokeWidth={2} />
          </div>
          <div className="nle-gutter is-audio">
            <Music2 size={14} strokeWidth={2} />
            <Lock size={12} strokeWidth={2} />
            <Settings2 size={12} strokeWidth={2} />
          </div>
          {avatarActive ? (
            <div className="nle-gutter is-avatar">
              <UserRound size={14} strokeWidth={2} />
              <Lock size={12} strokeWidth={2} />
              <Settings2 size={12} strokeWidth={2} />
            </div>
          ) : null}
        </aside>

        <div
          className="nle-lanes"
          ref={stripRef}
          onClick={(e) => seekFromClientX(e.clientX)}
          role="slider"
          aria-label="Playhead"
          aria-valuemin={0}
          aria-valuemax={duration}
          aria-valuenow={playhead}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") onSeek(Math.min(duration, playhead + 0.5));
            if (e.key === "ArrowLeft") onSeek(Math.max(0, playhead - 0.5));
          }}
        >
          <div className="nle-scroll" style={{ width: trackWidth }}>
            <div className="nle-ruler">
              {markers.map((mark) => (
                <span key={mark} style={{ left: mark * pxPerSecond }}>
                  {formatTimelineClock(mark).replace(/^00:/, "").replace(/^0/, "") || "0"}
                </span>
              ))}
            </div>

            <div className="nle-lane is-captions">
              {scenes.length ? scenes.map((scene, index) => {
                const width = Math.max(28, sceneDuration(scene) * pxPerSecond - 2);
                const selected = scene.id === selectedId || scene.id === active?.id;
                return (
                  <button
                    type="button"
                    key={`cap-${scene.id}`}
                    className={`nle-clip is-caption ${selected ? "is-selected" : ""}`}
                    style={{ left: scene.start * pxPerSecond, width }}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelect(scene.id);
                      onSeek(scene.start + 0.01);
                    }}
                    aria-label={scene.label || `Caption ${index + 1}`}
                  >
                    <Type size={11} strokeWidth={2.5} />
                    <em>{scene.label || `S${index + 1}`}</em>
                  </button>
                );
              }) : <div className="nle-lane-idle" />}
            </div>

            <div className="nle-lane is-video">
              {scenes.length ? scenes.map((scene, index) => {
                const width = Math.max(40, sceneDuration(scene) * pxPerSecond - 2);
                const selected = scene.id === selectedId || scene.id === active?.id;
                return (
                  <button
                    type="button"
                    key={scene.id}
                    className={`nle-clip is-video ${selected ? "is-selected" : ""} ${dragId === scene.id ? "is-dragging" : ""}`}
                    style={{ left: scene.start * pxPerSecond, width }}
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
                    aria-label={scene.label || `Scene ${index + 1}`}
                  >
                    <span className="nle-filmstrip" aria-hidden="true" />
                    {selected ? (
                      <>
                        <i className="nle-handle is-left" aria-hidden="true" />
                        <i className="nle-handle is-right" aria-hidden="true" />
                      </>
                    ) : null}
                  </button>
                );
              }) : <div className="nle-lane-idle" />}
            </div>

            <div className="nle-lane is-audio">
              <div className="nle-wave" aria-hidden="true">
                {waves.map((h, i) => <i key={i} style={{ height: `${h * 100}%` }} />)}
              </div>
            </div>

            {avatarActive ? (
              <div className="nle-lane is-avatar">
                <div className="nle-clip is-avatar-bar" style={{ width: "100%" }} aria-hidden="true">
                  <UserRound size={12} strokeWidth={2} />
                </div>
              </div>
            ) : null}

            <div className="nle-playhead" style={{ left: playhead * pxPerSecond }} aria-hidden="true" />
          </div>
        </div>
      </div>
    </section>
  );
}
