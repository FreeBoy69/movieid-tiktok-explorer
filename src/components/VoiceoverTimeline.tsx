import { useEffect, useRef, useState } from "react";
import { Film, Mic, Music2, Pause, Play, Scissors, Columns2, Maximize2, Undo2, Redo2, UserRound } from "lucide-react";
import { formatTimelineClock, moveScene, sceneAtTime, sceneDuration, splitSceneAtTime, timelineDuration } from "../utils/voiceoverTimeline.js";
import "./VoiceoverTimeline.css";

type Scene = { id: string; start: number; end: number; label?: string; sourceStart?: number; sourceEnd?: number };
type Props = {
  scenes: Scene[]; playhead: number; playing: boolean; selectedId: string; disabled?: boolean;
  avatarActive?: boolean; thumbnailUrl?: string; narrationLabel?: string; musicLabel?: string;
  onScenesChange: (scenes: Scene[]) => void; onSelect: (id: string) => void;
  onSeek: (time: number) => void; onTogglePlay: () => void;
  onOpenMusic: () => void; onOpenAvatar: () => void; onOpenNarration: () => void;
};

export function VoiceoverTimeline({ scenes, playhead, playing, selectedId, disabled, avatarActive,
  thumbnailUrl, narrationLabel, musicLabel, onScenesChange, onSelect, onSeek, onTogglePlay,
  onOpenMusic, onOpenAvatar, onOpenNarration }: Props) {
  const [zoom, setZoom] = useState(1);
  const [viewportWidth, setViewportWidth] = useState(600);
  const [past, setPast] = useState<Scene[][]>([]);
  const [future, setFuture] = useState<Scene[][]>([]);
  const [dragId, setDragId] = useState("");
  const stripRef = useRef<HTMLDivElement>(null);
  const duration = timelineDuration(scenes);
  const trackWidth = Math.max(1, viewportWidth - 24) * zoom;
  const pxPerSecond = trackWidth / Math.max(duration, 1);
  const active = sceneAtTime(scenes, playhead);
  const canSplit = !!active && playhead > active.start + .08 && playhead < active.end - .08;
  const selected = scenes.find(scene => scene.id === selectedId);
  const rawStep = 72 / pxPerSecond;
  const step = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600].find(n => n >= rawStep) || 7200;
  const markers = Array.from({ length: Math.min(200, Math.floor(duration / step) + 1) }, (_, i) => i * step);

  useEffect(() => {
    const element = stripRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setViewportWidth(element.clientWidth));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  function edit(next: Scene[]) {
    if (disabled || next === scenes) return;
    setPast(items => [...items.slice(-29), scenes]); setFuture([]);
    onScenesChange(next);
  }
  function undo() {
    const previous = past.at(-1);
    if (!previous || disabled) return;
    setFuture(items => [scenes, ...items]); setPast(items => items.slice(0, -1)); onScenesChange(previous);
  }
  function redo() {
    const next = future[0];
    if (!next || disabled) return;
    setPast(items => [...items, scenes]); setFuture(items => items.slice(1)); onScenesChange(next);
  }
  function timeAt(clientX: number) {
    const el = stripRef.current;
    return el ? Math.max(0, Math.min(duration, (clientX - el.getBoundingClientRect().left + el.scrollLeft - 12) / pxPerSecond)) : 0;
  }
  function split() { if (canSplit && !disabled) edit(splitSceneAtTime(scenes, playhead)); }
  function fit() { setZoom(1); stripRef.current?.scrollTo({ left: 0 }); }

  return <section className="studio-timeline" aria-label="Timeline">
    <header className="st-toolbar">
      <div className="st-transport">
        <button className="st-icon st-play" onClick={onTogglePlay} aria-label={playing ? "Pause timeline" : "Play timeline"} title={playing ? "Pause" : "Play"} disabled={!scenes.length}>{playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}</button>
        <span className="st-clock"><strong>{formatTimelineClock(playhead)}</strong><span>/ {formatTimelineClock(duration)}</span></span>
      </div>
      <div className="st-edit-tools">
        <button className="st-command" onClick={split} disabled={disabled || !canSplit} title="Split the scene at the playhead"><Scissors size={15} />Split scene</button>
        <button className="st-icon" onClick={undo} disabled={disabled || !past.length} aria-label="Undo scene edit" title="Undo scene edit"><Undo2 size={16} /></button>
        <button className="st-icon" onClick={redo} disabled={disabled || !future.length} aria-label="Redo scene edit" title="Redo scene edit"><Redo2 size={16} /></button>
      </div>
      <div className="st-library-tools">
        <button className="st-command" onClick={onOpenAvatar} disabled={disabled}><Columns2 size={15} />Split screen</button>
        <button className="st-command" onClick={onOpenMusic} disabled={disabled}><Music2 size={15} />Audio library</button>
      </div>
      <div className="st-zoom"><button className="st-icon" onClick={fit} title="Fit timeline to width" aria-label="Fit timeline to width"><Maximize2 size={15} /></button><input type="range" min="1" max="8" step="0.25" value={zoom} onChange={e => setZoom(Number(e.target.value))} aria-label="Timeline zoom" /><output>{Math.round(zoom * 100)}%</output></div>
    </header>
    <div className="st-body">
      <div className="st-track-heads">
        <div className="st-ruler-head">Tracks</div>
        <div className="st-track-head st-video-head"><Film size={15} /><span>Video</span><small>{scenes.length}</small></div>
        <button className="st-track-head" onClick={onOpenNarration} disabled={disabled}><Mic size={15} /><span>Narration</span></button>
        <button className="st-track-head" onClick={onOpenMusic} disabled={disabled}><Music2 size={15} /><span>Music</span></button>
        {avatarActive && <button className="st-track-head" onClick={onOpenAvatar} disabled={disabled}><UserRound size={15} /><span>Avatar</span></button>}
      </div>
      <div className="st-lanes" ref={stripRef}>
        <div className="st-scroll" style={{ width: trackWidth + 24 }}>
          <div className="st-ruler" role="slider" aria-label="Timeline playhead" aria-valuemin={0} aria-valuemax={duration} aria-valuenow={Math.min(duration, playhead)} aria-valuetext={formatTimelineClock(playhead)} tabIndex={0}
            onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); onSeek(timeAt(e.clientX)); }}
            onPointerMove={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) onSeek(timeAt(e.clientX)); }}
            onPointerUp={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); }}
            onKeyDown={e => { if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) { e.preventDefault(); onSeek(e.key === "Home" ? 0 : e.key === "End" ? duration : Math.min(duration, Math.max(0, playhead + (e.key === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? 5 : .1)))); } }}>
            {markers.filter(mark => trackWidth - mark * pxPerSecond >= 48).map(mark => <span key={mark} style={{ left: 12 + mark * pxPerSecond }}>{formatTimelineClock(mark)}</span>)}
          </div>
          <div className="st-lane st-video-lane">
            {scenes.map((scene, index) => <button key={scene.id} className={`st-scene ${sceneDuration(scene) * pxPerSecond < 105 ? "is-compact" : ""} ${scene.id === selectedId ? "is-selected" : ""} ${dragId === scene.id ? "is-dragging" : ""}`} style={{ left: 12 + scene.start * pxPerSecond, width: Math.max(1, sceneDuration(scene) * pxPerSecond - 2) }}
              aria-label={`Select ${scene.label || `Scene ${index + 1}`}`} aria-pressed={scene.id === selectedId} title={`${scene.label || `Scene ${index + 1}`} · ${formatTimelineClock(sceneDuration(scene))}`} draggable={!disabled}
              onDragStart={() => setDragId(scene.id)} onDragEnd={() => setDragId("")} onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); const from = scenes.findIndex(s => s.id === dragId); if (from >= 0 && from !== index) edit(moveScene(scenes, from, index)); setDragId(""); }}
              onClick={e => { onSelect(scene.id); onSeek(e.detail === 0 ? scene.start : timeAt(e.clientX)); }}>
              {thumbnailUrl ? <img src={thumbnailUrl} alt="" loading="lazy" /> : <Film size={19} />}
              <span><strong>{sceneDuration(scene) * pxPerSecond < 105 ? index + 1 : scene.label || `Scene ${index + 1}`}</strong><small>{formatTimelineClock(sceneDuration(scene))}</small></span>
            </button>)}
            {!scenes.length && <span className="st-empty">No video loaded</span>}
          </div>
          <div className="st-lane"><button className={`st-audio-clip ${narrationLabel ? "has-audio" : ""}`} style={{ width: trackWidth }} onClick={onOpenNarration} disabled={disabled}><Mic size={14} /><span>{narrationLabel || "Add narration"}</span></button></div>
          <div className="st-lane"><button className={`st-audio-clip st-music-clip ${musicLabel ? "has-audio" : ""}`} style={{ width: trackWidth }} onClick={onOpenMusic} disabled={disabled}><Music2 size={14} /><span>{musicLabel || "Choose music"}</span></button></div>
          {avatarActive && <div className="st-lane"><button className="st-audio-clip st-avatar-clip" style={{ width: trackWidth }} onClick={onOpenAvatar} disabled={disabled}><UserRound size={14} /><span>Avatar layout</span></button></div>}
          {!!scenes.length && <div className="st-playhead" style={{ left: 12 + Math.min(playhead, duration) * pxPerSecond }} aria-hidden="true" />}
        </div>
      </div>
    </div>
    <footer className="st-status"><span>{scenes.length} {scenes.length === 1 ? "scene" : "scenes"}{selected ? ` · ${selected.label}` : ""}</span><span>{selected ? `${formatTimelineClock(selected.start)} - ${formatTimelineClock(selected.end)}` : formatTimelineClock(duration)}</span></footer>
  </section>;
}
