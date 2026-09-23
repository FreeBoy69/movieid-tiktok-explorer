// Scene timeline: the editor below the storyboard preview. It owns the voiceover
// <audio> the preview follows, plays the soundtrack in step with it, and edits
// scene cuts (split, merge, ripple delete, drag-to-trim) with undo.
import { RefObject, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import {
  AudioLines,
  Captions,
  ChevronFirst,
  ChevronLast,
  Film,
  ImagePlus,
  Keyboard,
  Loader2,
  Magnet,
  Merge,
  MoveHorizontal,
  Music,
  Pause,
  Play,
  Redo2,
  Repeat,
  Scissors,
  SkipBack,
  SkipForward,
  Sparkles,
  SquarePen,
  StepBack,
  StepForward,
  Trash2,
  Undo2,
  Volume2,
  VolumeX,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { TIMELINE_FPS, mergeScenes, removeScene, rulerLabel, rulerTicks, snapTime, splitAt, timecode, trimBoundary } from "../utils/timelineEdit.js";
import "./SceneTimeline.css";

type Scene = { id: string; start: number; end: number; text?: string; asset?: string | null; clip?: string | null; motion?: string; animate?: boolean; error?: string; generating?: boolean };
type Line = { start: number; end: number; text: string };

const MAX_PPS = 320;
const RATES = [0.5, 1, 1.25, 1.5, 2];
const SNAP_PX = 8;
const FRAME = 1 / TIMELINE_FPS;
const SHORTCUTS: Array<[string, string]> = [
  ["Space / K", "Play or pause"],
  ["← / →", "Step one frame"],
  ["Shift + ← / →", "Jump one second"],
  ["↑ / ↓", "Previous or next cut"],
  ["Home / End", "Go to start or end"],
  ["S", "Split at playhead"],
  ["M", "Merge with next scene"],
  ["Delete", "Remove scene (neighbour fills the gap)"],
  ["Enter", "Edit selected scene"],
  ["⌘Z / ⇧⌘Z", "Undo or redo"],
  ["= / -", "Zoom in or out"],
  ["\\", "Zoom to fit"],
  ["N", "Snapping on or off"],
  ["L", "Loop selection"],
  ["Ctrl + scroll", "Zoom at the pointer"],
];

// Peak amplitude per 1/100 s, for drawing waveforms. Null until decoded or if decoding fails.
function usePeaks(src?: string | null) {
  const [peaks, setPeaks] = useState<Float32Array | null>(null);
  useEffect(() => {
    setPeaks(null);
    if (!src) return;
    let cancelled = false;
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    const context = new Ctx();
    fetch(src)
      .then((res) => (res.ok ? res.arrayBuffer() : Promise.reject(new Error(String(res.status)))))
      .then((data) => context.decodeAudioData(data))
      .then((buffer) => {
        if (cancelled) return;
        const channel = buffer.getChannelData(0);
        const size = Math.max(1, Math.floor(buffer.sampleRate / 100));
        const out = new Float32Array(Math.ceil(channel.length / size));
        let max = 0;
        for (let i = 0; i < out.length; i++) {
          let peak = 0;
          const end = Math.min(channel.length, (i + 1) * size);
          for (let j = i * size; j < end; j += 4) peak = Math.max(peak, Math.abs(channel[j]));
          out[i] = peak;
          max = Math.max(max, peak);
        }
        if (max > 0) for (let i = 0; i < out.length; i++) out[i] /= max;
        setPeaks(out);
      })
      .catch(() => {})
      .finally(() => void context.close().catch(() => {}));
    return () => {
      cancelled = true;
    };
  }, [src]);
  return peaks;
}

// Draws only the visible slice of a waveform, so long videos at deep zoom stay cheap.
// The canvas sits at the scroll offset; the track content starts 16px in.
function Wave({ peaks, pps, scrollLeft, width, muted }: { peaks: Float32Array | null; pps: number; scrollLeft: number; width: number; muted?: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const height = 40;
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const dpr = window.devicePixelRatio || 1;
    el.width = Math.max(1, Math.round(width * dpr));
    el.height = Math.round(height * dpr);
    const ctx = el.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = getComputedStyle(el).color;
    const mid = height / 2;
    if (!peaks) {
      ctx.fillRect(0, mid - 0.5, width, 1);
      return;
    }
    for (let x = 0; x < width; x += 2) {
      const from = Math.floor(((scrollLeft + x - 16) / pps) * 100);
      const to = Math.max(from + 1, Math.floor(((scrollLeft + x - 14) / pps) * 100));
      if (from < 0) continue;
      if (from >= peaks.length) break;
      let peak = 0;
      for (let i = from; i < Math.min(to, peaks.length); i++) peak = Math.max(peak, peaks[i]);
      const h = Math.max(1, peak * (height - 6));
      ctx.fillRect(x, mid - h / 2, 1.4, h);
    }
  }, [peaks, pps, scrollLeft, width, muted]);
  return <canvas ref={canvas} className="tl-wave" style={{ left: scrollLeft, width, height }} aria-hidden="true" />;
}

export function SceneTimeline({
  scenes,
  lines,
  duration,
  voiceSrc,
  musicSrc,
  musicVolume = 0.18,
  audioRef,
  selectedId,
  disabled,
  keysEnabled = true,
  onSelect,
  onOpen,
  onChange,
  onError,
}: {
  scenes: Scene[];
  lines: Line[];
  duration: number;
  voiceSrc: string;
  musicSrc?: string | null;
  musicVolume?: number;
  audioRef: RefObject<HTMLAudioElement | null>;
  selectedId: string;
  disabled?: boolean;
  keysEnabled?: boolean;
  onSelect: (id: string) => void;
  onOpen: (id: string) => void;
  onChange: (scenes: Scene[]) => void;
  onError: (message: string) => void;
}) {
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [zoomPps, setZoomPps] = useState<number | null>(null);
  const [viewport, setViewport] = useState(800);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [snap, setSnap] = useState(true);
  const [loop, setLoop] = useState(false);
  const [rate, setRate] = useState(1);
  const [volume, setVolume] = useState(1);
  const [voiceMuted, setVoiceMuted] = useState(false);
  const [musicMuted, setMusicMuted] = useState(false);
  const [past, setPast] = useState<Scene[][]>([]);
  const [future, setFuture] = useState<Scene[][]>([]);
  const [drag, setDrag] = useState<{ index: number; scenes: Scene[]; guide: number | null } | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [keysOpen, setKeysOpen] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const musicRef = useRef<HTMLAudioElement>(null);
  const zoomAnchor = useRef<{ time: number; x: number } | null>(null);
  const voicePeaks = usePeaks(voiceSrc);
  const musicPeaks = usePeaks(musicSrc);

  const total = Math.max(0.1, duration || scenes[scenes.length - 1]?.end || 0.1);
  const fitPps = Math.max(0.02, (viewport - 32) / total);
  const pps = Math.min(MAX_PPS, Math.max(fitPps, zoomPps ?? fitPps));
  const width = Math.ceil(total * pps) + 32;
  const shown = drag?.scenes ?? scenes;
  const selectedIndex = shown.findIndex((scene) => scene.id === selectedId);
  const selected = selectedIndex >= 0 ? shown[selectedIndex] : null;
  const cuts = useMemo(() => [0, ...shown.map((scene) => scene.end)], [shown]);
  const activeLine = lines.findIndex((line) => time >= line.start && time < line.end);
  const missing = scenes.filter((scene) => !scene.asset && !scene.clip).length;

  // Track the scroll viewport's width so "fit" fills it exactly.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setViewport(el.clientWidth));
    observer.observe(el);
    setViewport(el.clientWidth);
    return () => observer.disconnect();
  }, []);

  // Keep the anchored moment under the same pixel after a zoom.
  useLayoutEffect(() => {
    const el = scroller.current;
    const anchor = zoomAnchor.current;
    if (!el || !anchor) return;
    zoomAnchor.current = null;
    el.scrollLeft = Math.max(0, anchor.time * pps + 16 - anchor.x);
    setScrollLeft(el.scrollLeft);
  }, [pps]);

  const zoomTo = useCallback(
    (next: number, anchorTime?: number, anchorX?: number) => {
      const el = scroller.current;
      const at = anchorTime ?? time;
      const x = anchorX ?? (el ? Math.min(el.clientWidth - 40, Math.max(40, at * pps + 16 - el.scrollLeft)) : 0);
      zoomAnchor.current = { time: at, x };
      setZoomPps(Math.min(MAX_PPS, Math.max(fitPps, next)));
    },
    [time, pps, fitPps],
  );

  // Ctrl/⌘ + wheel (and trackpad pinch) zooms at the pointer. Plain wheel is left to the page.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        const rect = el.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const at = (el.scrollLeft + x - 16) / pps;
        zoomTo(pps * Math.exp(-event.deltaY * 0.01), at, x);
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [pps, zoomTo]);

  // Mirror the voiceover element: play state, and its clock every frame while playing.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const sync = () => {
      setPlaying(!audio.paused && !audio.ended);
      setTime(audio.currentTime);
      const music = musicRef.current;
      if (!music) return;
      if (audio.currentTime < (music.duration || Infinity)) music.currentTime = audio.currentTime;
      if (!audio.paused && !audio.ended && audio.currentTime < (music.duration || Infinity)) void music.play().catch(() => {});
      else music.pause();
    };
    const events = ["play", "pause", "ended", "seeked", "loadedmetadata"];
    events.forEach((name) => audio.addEventListener(name, sync));
    sync();
    return () => events.forEach((name) => audio.removeEventListener(name, sync));
  }, [audioRef, voiceSrc]);

  const loopRange = loop ? (selected ? [selected.start, selected.end] : [0, total]) : null;
  const loopRef = useRef(loopRange);
  loopRef.current = loopRange;
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const tick = () => {
      const audio = audioRef.current;
      if (!audio) return;
      let t = audio.currentTime;
      const range = loopRef.current;
      if (range && t >= range[1] - 0.02) {
        audio.currentTime = range[0];
        t = range[0];
      }
      setTime(t);
      const music = musicRef.current;
      if (music && !music.paused && Math.abs(music.currentTime - t) > 0.25) music.currentTime = t;
      const el = scroller.current;
      if (el) {
        const x = t * pps + 16;
        if (x > el.scrollLeft + el.clientWidth - 48 || x < el.scrollLeft) el.scrollLeft = Math.max(0, x - 48);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, pps, audioRef]);

  // Looping the whole video restarts from the top when the narration ends.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onEnded = () => {
      if (loopRef.current) {
        audio.currentTime = loopRef.current[0];
        void audio.play().catch(() => {});
      }
    };
    audio.addEventListener("ended", onEnded);
    return () => audio.removeEventListener("ended", onEnded);
  }, [audioRef]);

  useEffect(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.volume = volume;
      audio.muted = voiceMuted;
      audio.playbackRate = rate;
    }
    const music = musicRef.current;
    if (music) {
      music.volume = Math.min(1, Math.max(0, musicVolume * volume));
      music.muted = musicMuted;
      music.playbackRate = rate;
    }
  }, [volume, voiceMuted, musicMuted, rate, musicVolume, audioRef, voiceSrc, musicSrc]);

  const seek = useCallback(
    (value: number) => {
      const t = Math.min(total, Math.max(0, value));
      setTime(t);
      if (audioRef.current) audioRef.current.currentTime = t;
    },
    [audioRef, total],
  );
  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      if (audio.currentTime >= total - 0.05) audio.currentTime = 0;
      void audio.play().catch(() => {});
    } else audio.pause();
  };
  const prevCut = () => seek([...cuts].reverse().find((cut) => cut < time - 0.05) ?? 0);
  const nextCut = () => seek(cuts.find((cut) => cut > time + 0.05) ?? total);

  const commit = (next: Scene[]) => {
    setPast((items) => [...items.slice(-49), scenes]);
    setFuture([]);
    onChange(next);
  };
  const guarded = (action: () => void) => {
    if (disabled) return onError("Wait for the current generation to finish before editing the timeline.");
    try {
      action();
    } catch (e) {
      onError((e as Error).message);
    }
  };
  const split = () =>
    guarded(() => {
      const next = splitAt(scenes, time, lines);
      commit(next);
      const at = next.findIndex((scene) => scene.start >= time - 0.01);
      if (next[at]) onSelect(next[at].id);
    });
  const merge = () =>
    guarded(() => {
      const index = selectedIndex >= 0 ? selectedIndex : scenes.findIndex((scene) => time < scene.end);
      commit(mergeScenes(scenes, index, lines));
      onSelect(scenes[index].id);
    });
  const remove = () =>
    guarded(() => {
      if (selectedIndex < 0) throw new Error("Select a scene to remove");
      const next = removeScene(scenes, selectedIndex, lines);
      commit(next);
      onSelect(next[Math.max(0, selectedIndex - 1)]?.id || "");
    });
  const undo = () => {
    if (!past.length || disabled) return;
    setFuture((items) => [scenes, ...items]);
    setPast((items) => items.slice(0, -1));
    onChange(past[past.length - 1]);
  };
  const redo = () => {
    if (!future.length || disabled) return;
    setPast((items) => [...items, scenes]);
    setFuture((items) => items.slice(1));
    onChange(future[0]);
  };
  const fit = () => {
    zoomAnchor.current = { time: 0, x: 16 };
    setZoomPps(null);
  };

  const timeAt = (clientX: number) => {
    const el = scroller.current;
    if (!el) return 0;
    return (clientX - el.getBoundingClientRect().left + el.scrollLeft - 16) / pps;
  };
  const snapped = (t: number, exclude?: number) => {
    if (!snap) return { time: t, snapped: false };
    const candidates = [...cuts.filter((_, i) => i !== exclude), ...lines.flatMap((line) => [line.start, line.end]), ...(exclude === undefined ? [] : [time])];
    return snapTime(t, candidates, SNAP_PX / pps);
  };

  // Ruler, empty track space and the playhead handle all scrub.
  const scrub = (event: ReactPointerEvent) => {
    if (event.button !== 0) return;
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture(event.pointerId);
    const move = (clientX: number) => seek(snapped(timeAt(clientX)).time);
    move(event.clientX);
    const onMove = (e: PointerEvent) => move(e.clientX);
    const onUp = () => {
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onUp);
      target.removeEventListener("pointercancel", onUp);
    };
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onUp);
    target.addEventListener("pointercancel", onUp);
  };

  // Dragging the edge between two scenes moves that cut; both neighbours resize.
  const trim = (event: ReactPointerEvent, index: number) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    if (disabled) return onError("Wait for the current generation to finish before editing the timeline.");
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture(event.pointerId);
    const base = scenes;
    let latest = base;
    const onMove = (e: PointerEvent) => {
      const hit = snapped(timeAt(e.clientX), index + 1);
      latest = trimBoundary(base, index, hit.time, lines);
      setDrag({ index, scenes: latest, guide: hit.snapped ? hit.time : null });
    };
    const onUp = () => {
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onUp);
      target.removeEventListener("pointercancel", onUp);
      setDrag(null);
      if (latest !== base) commit(latest);
    };
    setDrag({ index, scenes: base, guide: null });
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onUp);
    target.addEventListener("pointercancel", onUp);
  };

  const keys = useRef<(event: KeyboardEvent) => void>(() => {});
  keys.current = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest?.("input:not([type=range]), textarea, select, [contenteditable=true], [role=dialog]")) return;
    const mod = event.metaKey || event.ctrlKey;
    const key = event.key;
    const handled = () => event.preventDefault();
    if (mod && key.toLowerCase() === "z") return handled(), event.shiftKey ? redo() : undo();
    if (mod && key.toLowerCase() === "y") return handled(), redo();
    if (mod || event.altKey) return;
    if (key === " " || key.toLowerCase() === "k") return handled(), toggle();
    if (key === "ArrowLeft") return handled(), seek(time - (event.shiftKey ? 1 : FRAME));
    if (key === "ArrowRight") return handled(), seek(time + (event.shiftKey ? 1 : FRAME));
    if (key === "ArrowUp") return handled(), prevCut();
    if (key === "ArrowDown") return handled(), nextCut();
    if (key === "Home") return handled(), seek(0);
    if (key === "End") return handled(), seek(total);
    if (key.toLowerCase() === "s") return handled(), split();
    if (key.toLowerCase() === "m") return handled(), merge();
    if (key === "Delete" || key === "Backspace") return handled(), remove();
    if (key === "Enter" && selected) return handled(), onOpen(selected.id);
    if (key === "=" || key === "+") return handled(), zoomTo(pps * 1.5);
    if (key === "-" || key === "_") return handled(), zoomTo(pps / 1.5);
    if (key === "\\") return handled(), fit();
    if (key.toLowerCase() === "n") return handled(), setSnap((on) => !on);
    if (key.toLowerCase() === "l") return handled(), setLoop((on) => !on);
    if (key === "?") return handled(), setKeysOpen((open) => !open);
    if (key === "Escape" && keysOpen) return handled(), setKeysOpen(false);
  };
  useEffect(() => {
    if (!keysEnabled) return;
    const onKey = (event: KeyboardEvent) => keys.current(event);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [keysEnabled]);

  const ticks = useMemo(() => {
    const from = Math.max(0, (scrollLeft - 40) / pps);
    const to = Math.min(total, (scrollLeft + viewport + 40) / pps);
    return rulerTicks(from, to, pps);
  }, [scrollLeft, viewport, pps, total]);

  const clips = useMemo(
    () =>
      shown.map((scene, index) => {
        const left = scene.start * pps + 16;
        const w = Math.max(2, (scene.end - scene.start) * pps);
        const state = scene.error ? "failed" : scene.asset || scene.clip ? "ready" : "missing";
        return (
          <button
            key={scene.id}
            type="button"
            className="tl-clip"
            data-state={state}
            data-narrow={w < 56 ? (w < 26 ? "tiny" : "true") : undefined}
            aria-pressed={scene.id === selectedId}
            aria-label={`Scene ${index + 1}, ${rulerLabel(scene.start)} to ${rulerLabel(scene.end)}${state === "missing" ? ", no image yet" : state === "failed" ? ", failed" : ""}`}
            title={scene.text || `Scene ${index + 1}`}
            style={{ left, width: w, backgroundImage: scene.asset ? `url("${scene.asset}")` : undefined }}
            onClick={() => onSelect(scene.id)}
            onDoubleClick={() => onOpen(scene.id)}
          >
            <span className="tl-clip-label">
              <b>{index + 1}</b>
              {scene.clip ? <Sparkles size={11} aria-label="Animated" /> : null}
            </span>
            {state !== "ready" && (
              <span className="tl-clip-empty">{scene.generating ? <Loader2 size={14} className="animate-spin" /> : <ImagePlus size={14} />}</span>
            )}
            <span className="tl-clip-dur">{(scene.end - scene.start).toFixed(1)}s</span>
          </button>
        );
      }),
    [shown, pps, selectedId, onSelect, onOpen],
  );

  const handles = shown.slice(0, -1).map((scene, index) => (
    <span
      key={`cut-${scene.id}`}
      className="tl-cut"
      data-active={drag?.index === index ? "true" : undefined}
      style={{ left: scene.end * pps + 16 }}
      role="separator"
      aria-label={`Cut between scene ${index + 1} and ${index + 2} at ${timecode(scene.end)}. Drag to trim.`}
      onPointerDown={(event) => trim(event, index)}
    />
  ));

  const captionBlocks = useMemo(
    () =>
      lines.map((line, index) => (
        <span
          key={`${line.start}-${index}`}
          className="tl-line"
          data-active={index === activeLine ? "true" : undefined}
          style={{ left: line.start * pps + 16, width: Math.max(2, (line.end - line.start) * pps - 2) }}
          title={line.text}
        >
          {(line.end - line.start) * pps > 28 ? line.text : null}
        </span>
      )),
    [lines, pps, activeLine],
  );

  const iconBtn = (label: string, icon: ReactNode, onClick: () => void, opts: { pressed?: boolean; disabled?: boolean; kbd?: string } = {}) => (
    <button
      type="button"
      className="tl-btn"
      aria-label={label}
      title={opts.kbd ? `${label} (${opts.kbd})` : label}
      aria-pressed={opts.pressed}
      disabled={opts.disabled}
      onClick={onClick}
    >
      {icon}
    </button>
  );
  const zoomValue = fitPps >= MAX_PPS ? 0 : Math.round((Math.log(pps / fitPps) / Math.log(MAX_PPS / fitPps)) * 100);

  return (
    <section className="tl" aria-label="Video timeline">
      <audio ref={audioRef} src={voiceSrc} preload="auto" />
      {musicSrc ? <audio ref={musicRef} src={musicSrc} preload="auto" /> : null}

      <div className="tl-bar">
        <div className="tl-group" aria-label="Edit">
          {iconBtn("Undo", <Undo2 size={16} />, undo, { disabled: !past.length || disabled, kbd: "⌘Z" })}
          {iconBtn("Redo", <Redo2 size={16} />, redo, { disabled: !future.length || disabled, kbd: "⇧⌘Z" })}
          <span className="tl-sep" />
          {iconBtn("Split at playhead", <Scissors size={16} />, split, { disabled, kbd: "S" })}
          {iconBtn("Merge with next scene", <Merge size={16} />, merge, { disabled: disabled || scenes.length < 2, kbd: "M" })}
          {iconBtn("Remove scene", <Trash2 size={16} />, remove, { disabled: disabled || !selected || scenes.length < 2, kbd: "Delete" })}
          <span className="tl-sep" />
          {iconBtn("Snapping", <Magnet size={16} />, () => setSnap(!snap), { pressed: snap, kbd: "N" })}
          {iconBtn(selected ? "Loop selected scene" : "Loop video", <Repeat size={16} />, () => setLoop(!loop), { pressed: loop, kbd: "L" })}
        </div>

        <div className="tl-transport" aria-label="Transport">
          {iconBtn("Go to start", <ChevronFirst size={16} />, () => seek(0), { kbd: "Home" })}
          {iconBtn("Previous cut", <SkipBack size={16} />, prevCut, { kbd: "↑" })}
          {iconBtn("Back one frame", <StepBack size={16} />, () => seek(time - FRAME), { kbd: "←" })}
          <button type="button" className="tl-play" aria-label={playing ? "Pause" : "Play"} title={`${playing ? "Pause" : "Play"} (Space)`} onClick={toggle}>
            {playing ? <Pause size={18} /> : <Play size={18} />}
          </button>
          {iconBtn("Forward one frame", <StepForward size={16} />, () => seek(time + FRAME), { kbd: "→" })}
          {iconBtn("Next cut", <SkipForward size={16} />, nextCut, { kbd: "↓" })}
          {iconBtn("Go to end", <ChevronLast size={16} />, () => seek(total), { kbd: "End" })}
          <span className="tl-tc" aria-live="off">
            <b>{timecode(time)}</b>
            <span>/ {timecode(total)}</span>
          </span>
        </div>

        <div className="tl-group tl-group-end" aria-label="View">
          <button type="button" className="tl-btn tl-rate" title="Playback speed" aria-label={`Playback speed ${rate}x`} onClick={() => setRate(RATES[(RATES.indexOf(rate) + 1) % RATES.length])}>
            {rate}×
          </button>
          <span className="tl-volume">
            {iconBtn(volume === 0 ? "Unmute" : "Mute", volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />, () => setVolume(volume === 0 ? 1 : 0))}
            <input type="range" aria-label="Preview volume" min={0} max={1} step={0.05} value={volume} onChange={(e) => setVolume(Number(e.target.value))} />
          </span>
          <span className="tl-sep" />
          {iconBtn("Zoom out", <ZoomOut size={16} />, () => zoomTo(pps / 1.5), { disabled: pps <= fitPps + 0.01, kbd: "-" })}
          <input className="tl-zoom" type="range" aria-label="Timeline zoom" min={0} max={100} value={zoomValue} onChange={(e) => zoomTo(fitPps * Math.pow(MAX_PPS / fitPps, Number(e.target.value) / 100))} />
          {iconBtn("Zoom in", <ZoomIn size={16} />, () => zoomTo(pps * 1.5), { disabled: pps >= MAX_PPS, kbd: "=" })}
          {iconBtn("Zoom to fit", <MoveHorizontal size={16} />, fit, { kbd: "\\" })}
          <span className="tl-keys-wrap">
            {iconBtn("Keyboard shortcuts", <Keyboard size={16} />, () => setKeysOpen(!keysOpen), { pressed: keysOpen, kbd: "?" })}
            {keysOpen && (
              <div className="tl-keys" role="dialog" aria-label="Keyboard shortcuts">
                <header>
                  <strong>Shortcuts</strong>
                  <button type="button" className="tl-btn" aria-label="Close shortcuts" onClick={() => setKeysOpen(false)}>
                    <X size={14} />
                  </button>
                </header>
                <dl>
                  {SHORTCUTS.map(([combo, what]) => (
                    <div key={combo}>
                      <dt>{combo}</dt>
                      <dd>{what}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}
          </span>
        </div>
      </div>

      <div className="tl-body">
        <div className="tl-heads">
          <div className="tl-head tl-head-ruler" />
          <div className="tl-head tl-head-video">
            <Film size={14} />
            <span>Video</span>
          </div>
          <div className="tl-head tl-head-captions">
            <Captions size={14} />
            <span>Captions</span>
          </div>
          <div className="tl-head tl-head-audio">
            <AudioLines size={14} />
            <span>Voice</span>
            <button type="button" className="tl-btn tl-mute" aria-pressed={voiceMuted} aria-label={voiceMuted ? "Unmute voiceover" : "Mute voiceover"} onClick={() => setVoiceMuted(!voiceMuted)}>
              {voiceMuted ? <VolumeX size={13} /> : <Volume2 size={13} />}
            </button>
          </div>
          {musicSrc ? (
            <div className="tl-head tl-head-audio">
              <Music size={14} />
              <span>Music</span>
              <button type="button" className="tl-btn tl-mute" aria-pressed={musicMuted} aria-label={musicMuted ? "Unmute music" : "Mute music"} onClick={() => setMusicMuted(!musicMuted)}>
                {musicMuted ? <VolumeX size={13} /> : <Volume2 size={13} />}
              </button>
            </div>
          ) : null}
        </div>

        <div
          className="tl-scroll"
          ref={scroller}
          onScroll={(e) => setScrollLeft((e.currentTarget as HTMLDivElement).scrollLeft)}
          onPointerMove={(e) => setHover(timeAt(e.clientX))}
          onPointerLeave={() => setHover(null)}
        >
          <div className="tl-canvas" style={{ width }}>
            <div className="tl-ruler" onPointerDown={scrub}>
              {ticks.map((tick) => (
                <span key={tick.time} className={tick.major ? "tl-tick is-major" : "tl-tick"} style={{ left: tick.time * pps + 16 }}>
                  {tick.major ? <em>{rulerLabel(tick.time)}</em> : null}
                </span>
              ))}
              {loopRange && <span className="tl-loop" style={{ left: loopRange[0] * pps + 16, width: (loopRange[1] - loopRange[0]) * pps }} />}
            </div>
            <div className="tl-track tl-track-video" onPointerDown={(e) => e.target === e.currentTarget && scrub(e)}>
              {clips}
              {handles}
            </div>
            <div className="tl-track tl-track-captions" onPointerDown={scrub}>
              {captionBlocks}
            </div>
            <div className="tl-track tl-track-audio tl-track-voice" data-muted={voiceMuted ? "true" : undefined} onPointerDown={scrub}>
              <span className="tl-audio-clip" style={{ left: 16, width: total * pps }} />
              <Wave peaks={voicePeaks} pps={pps} scrollLeft={scrollLeft} width={viewport} muted={voiceMuted} />
            </div>
            {musicSrc ? (
              <div className="tl-track tl-track-audio tl-track-music" data-muted={musicMuted ? "true" : undefined} onPointerDown={scrub}>
                <span className="tl-audio-clip" style={{ left: 16, width: total * pps }} />
                <Wave peaks={musicPeaks} pps={pps} scrollLeft={scrollLeft} width={viewport} muted={musicMuted} />
              </div>
            ) : null}
            {hover !== null && hover >= 0 && hover <= total && !drag && <span className="tl-hover" style={{ left: hover * pps + 16 }} data-time={timecode(hover)} />}
            {drag?.guide != null && <span className="tl-guide" style={{ left: drag.guide * pps + 16 }} />}
            <span className="tl-playhead" style={{ left: time * pps + 16 }}>
              <span className="tl-playhead-grip" onPointerDown={scrub} aria-hidden="true" />
            </span>
          </div>
        </div>
      </div>

      <footer className="tl-status">
        {selected ? (
          <>
            <strong>Scene {selectedIndex + 1}</strong>
            <span>
              In <b>{timecode(selected.start)}</b>
            </span>
            <span>
              Out <b>{timecode(selected.end)}</b>
            </span>
            <span>
              <b>{(selected.end - selected.start).toFixed(2)}s</b>
            </span>
            <span>{selected.clip ? "Animated" : selected.animate ? "To animate" : selected.motion === "push" ? "Pan & zoom" : "Still"}</span>
            <button type="button" className="tl-link" onClick={() => onOpen(selected.id)}>
              <SquarePen size={13} />
              Edit scene
            </button>
          </>
        ) : (
          <span>Click a clip to select it. Double-click to edit it. Drag the edge between clips to trim.</span>
        )}
        <span className="tl-status-end">
          {scenes.length} scenes{missing ? ` · ${missing} without images` : ""}
          {snap ? " · Snapping on" : ""}
        </span>
      </footer>
    </section>
  );
}
