// Multi-track timeline: titles, stacked video tracks, captions, and audio
// lanes, with a scrubbing ruler, drag-to-move, edge trims, and snapping.
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { AudioLines, Captions, Film, Image as ImageIcon, Magnet, Minus, Pause, Play, Plus, Redo2, Scissors, Trash2, Type, Undo2 } from "lucide-react";
import {
  assetById,
  clipEnd,
  deleteItems,
  formatTime,
  moveItem,
  projectDuration,
  snapTime,
  splitAt,
  updateItem,
  type VibeProject,
} from "../../utils/vibeEdit";
import { useVibe, vibe } from "./store";

const ROW = 44;
const HEAD_WIDE = 92;
const HEAD_NARROW = 34;
const narrowQuery = "(max-width: 900px)";

function useHeadWidth() {
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && window.matchMedia(narrowQuery).matches);
  useEffect(() => {
    const mq = window.matchMedia(narrowQuery);
    const on = () => setNarrow(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return narrow ? HEAD_NARROW : HEAD_WIDE;
}
type RowKind = "text" | "video" | "cue" | "audio";

interface Drag {
  id: string;
  mode: "move" | "trim-start" | "trim-end";
  kind: RowKind;
  x0: number;
  base: VibeProject;
  start: number;
  end: number;
  inPoint: number;
  moved: boolean;
}

// Waveform peaks per audio URL, decoded once.
const peaksCache = new Map<string, Promise<number[]>>();
function peaksFor(url: string): Promise<number[]> {
  if (!peaksCache.has(url)) {
    peaksCache.set(
      url,
      (async () => {
        const buf = await (await fetch(url)).arrayBuffer();
        const ctx = new OfflineAudioContext(1, 1, 8000);
        const audio = await ctx.decodeAudioData(buf);
        const data = audio.getChannelData(0);
        const perSec = 40;
        const bins = Math.max(1, Math.ceil(audio.duration * perSec));
        const step = Math.max(1, Math.floor(data.length / bins));
        const out: number[] = [];
        for (let i = 0; i < bins; i++) {
          let peak = 0;
          for (let j = i * step; j < Math.min(data.length, (i + 1) * step); j += 4) peak = Math.max(peak, Math.abs(data[j]));
          out.push(peak);
        }
        return out;
      })().catch(() => []),
    );
  }
  return peaksCache.get(url)!;
}

function Waveform({ url, inPoint, out, width }: { url: string; inPoint: number; out: number; width: number }) {
  const [peaks, setPeaks] = useState<number[]>([]);
  useEffect(() => {
    let live = true;
    void peaksFor(url).then((p) => live && setPeaks(p));
    return () => {
      live = false;
    };
  }, [url]);
  if (!peaks.length || width < 8) return null;
  const from = Math.floor(inPoint * 40);
  const to = Math.min(peaks.length, Math.ceil(out * 40));
  const slice = peaks.slice(from, to);
  const max = Math.max(0.05, ...slice);
  const n = Math.min(slice.length, Math.floor(width / 2));
  const bars = Array.from({ length: n }, (_, i) => slice[Math.floor((i * slice.length) / n)] / max);
  return (
    <svg className="ve-wave" viewBox={`0 0 ${n} 100`} preserveAspectRatio="none" aria-hidden="true">
      {bars.map((v, i) => (
        <rect key={i} x={i + 0.15} width={0.7} y={50 - v * 46} height={Math.max(2, v * 92)} />
      ))}
    </svg>
  );
}

function rulerStep(pps: number) {
  const steps = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
  return steps.find((s) => s * pps >= 64) || 600;
}

export function Timeline({ snapping, onToggleSnap }: { snapping: boolean; onToggleSnap: () => void }) {
  const project = useVibe((s) => s.project);
  const playhead = useVibe((s) => s.playhead);
  const playing = useVibe((s) => s.playing);
  const selection = useVibe((s) => s.selection);
  const pps = useVibe((s) => s.pxPerSec);
  const canUndo = useVibe((s) => s.past.length > 0);
  const canRedo = useVibe((s) => s.future.length > 0);
  const scroller = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const [scrubbing, setScrubbing] = useState(false);
  const HEAD = useHeadWidth();

  const duration = projectDuration(project);
  const width = Math.max(duration + 10, 30) * pps;
  const videoTracks = Math.max(1, ...project.clips.map((c) => c.track + 1));
  const audioLanes = Math.max(1, ...project.audio.map((c) => c.lane + 1));
  const selected = new Set(selection);

  // Keep the playhead in view while playing.
  useEffect(() => {
    const el = scroller.current;
    if (!el || !playing) return;
    const x = HEAD + playhead * pps;
    if (x > el.scrollLeft + el.clientWidth - 40) el.scrollLeft = x - HEAD - 40;
  }, [playhead, playing, pps, HEAD]);

  const timeAt = (clientX: number) => {
    const el = scroller.current!;
    const box = el.getBoundingClientRect();
    return Math.max(0, (clientX - box.left + el.scrollLeft - HEAD) / pps);
  };

  const onRulerDown = (e: ReactPointerEvent) => {
    e.preventDefault();
    vibe.play(false);
    vibe.seek(timeAt(e.clientX));
    setScrubbing(true);
    const move = (ev: PointerEvent) => vibe.seek(timeAt(ev.clientX));
    const up = () => {
      setScrubbing(false);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const rowAt = (clientX: number, clientY: number, kind: RowKind): number | undefined => {
    const hit = document.elementsFromPoint(clientX, clientY).find((el) => (el as HTMLElement).dataset?.rowKind === kind) as HTMLElement | undefined;
    return hit ? Number(hit.dataset.rowIndex) : undefined;
  };

  const onItemDown = (e: ReactPointerEvent, id: string, kind: RowKind, mode: Drag["mode"], start: number, end: number, inPoint: number) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    if (e.shiftKey || e.metaKey) vibe.select(selected.has(id) ? selection.filter((s) => s !== id) : [...selection, id]);
    else if (!selected.has(id)) vibe.select([id]);
    drag.current = { id, mode, kind, x0: e.clientX, base: vibe.get().project, start, end, inPoint, moved: false };
    const move = (ev: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      const dt = (ev.clientX - d.x0) / pps;
      if (!d.moved && Math.abs(ev.clientX - d.x0) < 3) return;
      d.moved = true;
      const tol = snapping ? 8 / pps : 0;
      const ph = vibe.get().playhead;
      let next = d.base;
      if (d.mode === "move") {
        let s = Math.max(0, d.start + dt);
        if (tol) {
          const len = d.end - d.start;
          const a = snapTime(d.base, s, tol, [ph], d.id);
          const b = snapTime(d.base, s + len, tol, [ph], d.id) - len;
          s = Math.abs(a - s) <= Math.abs(b - s) ? a : Math.max(0, b);
        }
        const row = d.kind === "video" || d.kind === "audio" ? rowAt(ev.clientX, ev.clientY, d.kind) : undefined;
        next = moveItem(d.base, d.id, s, row);
      } else if (d.mode === "trim-start") {
        let s = Math.min(d.end - 0.1, Math.max(0, d.start + dt));
        if (tol) s = snapTime(d.base, s, tol, [ph], d.id);
        if (d.kind === "video" || d.kind === "audio") {
          const inPoint = Math.max(0, d.inPoint + (s - d.start));
          s = d.start + (inPoint - d.inPoint);
          next = updateItem(d.base, d.id, { start: s, in: inPoint });
        } else next = updateItem(d.base, d.id, { start: s });
      } else {
        let e2 = Math.max(d.start + 0.1, d.end + dt);
        if (tol) e2 = snapTime(d.base, e2, tol, [ph], d.id);
        if (d.kind === "video" || d.kind === "audio") next = updateItem(d.base, d.id, { out: d.inPoint + (e2 - d.start) });
        else next = updateItem(d.base, d.id, { end: e2 });
      }
      vibe.commit(next, `drag:${d.id}:${d.x0}`);
    };
    const up = () => {
      drag.current = null;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const ticks = useMemo(() => {
    const step = rulerStep(pps);
    const out: number[] = [];
    for (let t = 0; t <= width / pps; t += step) out.push(t);
    return out;
  }, [pps, width]);

  const item = (opts: { id: string; kind: RowKind; start: number; end: number; inPoint: number; label: string; icon: React.ReactNode; tone: string; extra?: React.ReactNode; title?: string }) => {
    const { id, kind, start, end, inPoint, label, icon, tone, extra, title } = opts;
    const w = Math.max(6, (end - start) * pps);
    return (
      <div
        key={id}
        className={`ve-item ve-item-${tone}${selected.has(id) ? " is-selected" : ""}`}
        style={{ left: start * pps, width: w }}
        onPointerDown={(e) => onItemDown(e, id, kind, "move", start, end, inPoint)}
        title={title || label}
        aria-label={`${label}, ${formatTime(start, true)} to ${formatTime(end, true)}`}
      >
        <span className="ve-trim ve-trim-start" onPointerDown={(e) => onItemDown(e, id, kind, "trim-start", start, end, inPoint)} />
        {extra}
        <span className="ve-item-label">
          {icon}
          <span>{label}</span>
        </span>
        <span className="ve-trim ve-trim-end" onPointerDown={(e) => onItemDown(e, id, kind, "trim-end", start, end, inPoint)} />
      </div>
    );
  };

  const head = (label: string, icon: React.ReactNode) => (
    <div className="ve-row-head">
      {icon}
      <span>{label}</span>
    </div>
  );

  const canSplit = [...project.clips, ...project.audio].some((c) => playhead > c.start + 0.1 && playhead < clipEnd(c) - 0.1) || project.texts.some((t) => playhead > t.start + 0.1 && playhead < t.end - 0.1);

  return (
    <section className="ve-timeline" aria-label="Timeline">
      <div className="ve-tl-bar">
        <div className="ve-tl-group">
          <button type="button" className="ve-tool" onClick={() => vibe.undo()} disabled={!canUndo} aria-label="Undo" title="Undo (⌘Z)">
            <Undo2 size={16} />
          </button>
          <button type="button" className="ve-tool" onClick={() => vibe.redo()} disabled={!canRedo} aria-label="Redo" title="Redo (⇧⌘Z)">
            <Redo2 size={16} />
          </button>
          <span className="ve-tl-sep" />
          <button type="button" className="ve-tool" onClick={() => vibe.commit((p) => splitAt(p, playhead, selection.length ? selection : undefined))} disabled={!canSplit} aria-label="Split at playhead" title="Split (S)">
            <Scissors size={16} />
          </button>
          <button type="button" className="ve-tool" onClick={() => vibe.commit((p) => deleteItems(p, selection))} disabled={!selection.length} aria-label="Delete selected" title="Delete (⌫)">
            <Trash2 size={16} />
          </button>
          <button type="button" className={`ve-tool${snapping ? " is-on" : ""}`} onClick={onToggleSnap} aria-pressed={snapping} aria-label="Snapping" title="Snap to edges">
            <Magnet size={16} />
          </button>
        </div>
        <div className="ve-tl-transport">
          <button type="button" className="ve-play" onClick={() => vibe.play()} aria-label={playing ? "Pause" : "Play"} title="Play/pause (Space)" disabled={duration <= 0}>
            {playing ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}
          </button>
          <span className="ve-time">
            {formatTime(playhead, true)} <span>/ {formatTime(duration, true)}</span>
          </span>
        </div>
        <div className="ve-tl-group ve-zoom">
          <button type="button" className="ve-tool" onClick={() => vibe.set({ pxPerSec: Math.max(8, pps / 1.4) })} aria-label="Zoom out">
            <Minus size={16} />
          </button>
          <input type="range" min={8} max={240} value={pps} onChange={(e) => vibe.set({ pxPerSec: Number(e.target.value) })} aria-label="Timeline zoom" />
          <button type="button" className="ve-tool" onClick={() => vibe.set({ pxPerSec: Math.min(240, pps * 1.4) })} aria-label="Zoom in">
            <Plus size={16} />
          </button>
        </div>
      </div>

      <div className="ve-tl-scroll" ref={scroller} onPointerDown={(e) => e.target === e.currentTarget && vibe.select([])}>
        <div className="ve-tl-canvas" style={{ width: width + HEAD }}>
          <div className="ve-ruler" onPointerDown={onRulerDown} style={{ paddingLeft: HEAD }}>
            <div className="ve-ruler-corner" />
            {ticks.map((t) => (
              <span key={t} className="ve-tick" style={{ left: HEAD + t * pps }}>
                {formatTime(t)}
              </span>
            ))}
          </div>

          <div className="ve-rows" onPointerDown={(e) => (e.target as HTMLElement).classList.contains("ve-lane") && vibe.select([])}>
            <div className="ve-row ve-row-thin">
              {head("Titles", <Type size={13} />)}
              <div className="ve-lane" data-row-kind="text" data-row-index={0}>
                {project.texts.map((t) => item({ id: t.id, kind: "text", start: t.start, end: t.end, inPoint: 0, label: t.text || "Title", icon: <Type size={12} />, tone: "text" }))}
              </div>
            </div>
            {Array.from({ length: videoTracks }, (_, k) => videoTracks - 1 - k).map((track) => (
              <div className="ve-row" key={`v${track}`}>
                {head(track === 0 ? "Video" : `Video ${track + 1}`, <Film size={13} />)}
                <div className="ve-lane" data-row-kind="video" data-row-index={track}>
                  {project.clips
                    .filter((c) => c.track === track)
                    .map((c) => {
                      const a = assetById(project, c.assetId);
                      const isImage = a?.kind === "image";
                      return item({
                        id: c.id,
                        kind: "video",
                        start: c.start,
                        end: clipEnd(c),
                        inPoint: c.in,
                        label: a?.name || "Clip",
                        icon: isImage ? <ImageIcon size={12} /> : <Film size={12} />,
                        tone: isImage ? "image" : "video",
                        extra: a && (isImage || a.kind === "video") ? <span className="ve-thumb" style={isImage ? { backgroundImage: `url("${a.url}")` } : undefined} /> : null,
                      });
                    })}
                </div>
              </div>
            ))}
            <div className="ve-row ve-row-thin">
              {head("Captions", <Captions size={13} />)}
              <div className="ve-lane" data-row-kind="cue" data-row-index={0}>
                {project.captions.cues.map((c) => item({ id: c.id, kind: "cue", start: c.start, end: c.end, inPoint: 0, label: c.text, icon: null, tone: "cue" }))}
              </div>
            </div>
            {Array.from({ length: audioLanes }, (_, lane) => (
              <div className="ve-row" key={`a${lane}`}>
                {head(lane === 0 ? "Audio" : `Audio ${lane + 1}`, <AudioLines size={13} />)}
                <div className="ve-lane" data-row-kind="audio" data-row-index={lane}>
                  {project.audio
                    .filter((c) => c.lane === lane)
                    .map((c) => {
                      const a = assetById(project, c.assetId);
                      const tone = a?.origin === "voiceover" ? "voice" : "music";
                      return item({
                        id: c.id,
                        kind: "audio",
                        start: c.start,
                        end: clipEnd(c),
                        inPoint: c.in,
                        label: c.name || a?.name || "Audio",
                        icon: <AudioLines size={12} />,
                        tone,
                        title: c.duck !== undefined ? `${c.name || a?.name}: music ducks to ${Math.round(c.duck * 100)}% under this` : undefined,
                        extra: a ? <Waveform url={a.url} inPoint={c.in} out={c.out} width={(c.out - c.in) * pps} /> : null,
                      });
                    })}
                </div>
              </div>
            ))}
          </div>

          <div className={`ve-playhead${scrubbing ? " is-scrubbing" : ""}`} style={{ left: HEAD + playhead * pps }} aria-hidden="true" />
        </div>
      </div>
    </section>
  );
}

export const TIMELINE_ROW = ROW;
