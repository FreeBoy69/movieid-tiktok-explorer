// Multi-track timeline: titles, stacked video tracks, captions, and audio
// lanes. Track headers carry hide, mute, and lock switches; video clips show a
// filmstrip and sound clips a waveform. Drag to move, drag edges to trim,
// snapping with a visible guide, ⌘/Ctrl+scroll zoom.
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import {
  AudioLines,
  Captions,
  Eye,
  EyeOff,
  Film,
  Image as ImageIcon,
  Lock,
  Magnet,
  Maximize2,
  Minus,
  Plus,
  Redo2,
  Scissors,
  PanelBottomClose,
  Trash2,
  Type,
  Undo2,
  Unlock,
  Volume2,
  VolumeX,
} from "lucide-react";
import {
  assetById,
  clipEnd,
  deleteItems,
  FPS,
  formatTime,
  formatTimecode,
  isLocked,
  moveItem,
  projectDuration,
  setTrackState,
  snapTime,
  splitAt,
  trackKey,
  trackState,
  updateItem,
  type TrackKind,
  type VibeAsset,
  type VibeProject,
} from "../../utils/vibeEdit";
import { useFilmstrip } from "./filmstrip";
import { useVibe, vibe } from "./store";

const HEAD_WIDE = 168;
const HEAD_NARROW = 44;
const narrowQuery = "(max-width: 900px)";
const HEIGHT_KEY = "vibe-edit-timeline-height";

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

interface Drag {
  id: string;
  mode: "move" | "trim-start" | "trim-end";
  kind: TrackKind;
  x0: number;
  base: VibeProject;
  start: number;
  end: number;
  inPoint: number;
  moved: boolean;
}

// ---------- Waveforms ----------
const peaksCache = new Map<string, Promise<number[]>>();
const PEAKS_PER_SEC = 50;
function peaksFor(url: string): Promise<number[]> {
  if (!peaksCache.has(url)) {
    peaksCache.set(
      url,
      (async () => {
        const buf = await (await fetch(url)).arrayBuffer();
        const ctx = new OfflineAudioContext(1, 1, 8000);
        const audio = await ctx.decodeAudioData(buf);
        const data = audio.getChannelData(0);
        const bins = Math.max(1, Math.ceil(audio.duration * PEAKS_PER_SEC));
        const step = Math.max(1, Math.floor(data.length / bins));
        const out: number[] = [];
        for (let i = 0; i < bins; i++) {
          let peak = 0;
          for (let j = i * step; j < Math.min(data.length, (i + 1) * step); j += 2) peak = Math.max(peak, Math.abs(data[j]));
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
  const slice = peaks.slice(Math.floor(inPoint * PEAKS_PER_SEC), Math.min(peaks.length, Math.ceil(out * PEAKS_PER_SEC)));
  if (!slice.length) return null;
  const max = Math.max(0.05, ...slice);
  const n = Math.max(1, Math.min(slice.length, Math.floor(width / 2.5)));
  // Mirrored around the centre line, like every DAW.
  let d = "";
  for (let i = 0; i < n; i++) {
    const v = Math.max(0.03, slice[Math.floor((i * slice.length) / n)] / max) * 46;
    d += `M${i + 0.5} ${(50 - v).toFixed(1)}V${(50 + v).toFixed(1)}`;
  }
  return (
    <svg className="ve-wave" viewBox={`0 0 ${n} 100`} preserveAspectRatio="none" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

// ---------- Filmstrip ----------
function Strip({ asset, inPoint, width, height, pps }: { asset: VibeAsset; inPoint: number; width: number; height: number; pps: number }) {
  const strip = useFilmstrip(asset.kind === "video" ? asset.url : undefined, asset.duration);
  if (asset.kind === "image") return <span className="ve-strip ve-strip-still" style={{ backgroundImage: `url("${asset.url}")`, backgroundSize: `auto ${height}px` }} />;
  if (!strip) return <span className="ve-strip is-loading" />;
  const tileW = Math.max(24, Math.round(height * strip.aspect));
  const tiles = Math.min(200, Math.ceil(width / tileW));
  return (
    <span className="ve-strip" aria-hidden="true">
      {Array.from({ length: tiles }, (_, i) => {
        const t = inPoint + (i * tileW + tileW / 2) / pps;
        const frame = strip.frames[Math.min(strip.frames.length - 1, Math.max(0, Math.floor(t / strip.step)))];
        return frame ? <img key={i} src={frame} alt="" style={{ left: i * tileW, width: tileW, height }} draggable={false} /> : null;
      })}
    </span>
  );
}

// ---------- Ruler ----------
function rulerStep(pps: number) {
  const steps = [5 / FPS, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
  return steps.find((s) => s * pps >= 72) || 900;
}
function tickLabel(t: number, step: number) {
  if (step < 1) {
    const frames = Math.round((t % 1) * FPS);
    return frames ? `${frames}f` : formatTime(t);
  }
  return formatTime(t);
}

// ---------- Track header ----------
function TrackHead({ label, icon, kind, row, project, narrow }: { label: string; icon: ReactNode; kind: TrackKind; row: number; project: VibeProject; narrow: boolean }) {
  const key = trackKey(kind, row);
  const st = trackState(project, key);
  const toggle = (patch: Parameters<typeof setTrackState>[2]) => vibe.commit((p) => setTrackState(p, key, patch));
  const canHide = kind !== "audio";
  const canMute = kind === "video" || kind === "audio";
  return (
    <div className={`ve-row-head${st.hidden || st.muted ? " is-off" : ""}`}>
      <span className="ve-row-name" title={label}>
        {icon}
        {narrow ? null : <span>{label}</span>}
      </span>
      {narrow ? null : (
        <span className="ve-row-tools">
          {canHide ? (
            <button type="button" className={`ve-mini${st.hidden ? " is-on" : ""}`} onClick={() => toggle({ hidden: !st.hidden })} aria-pressed={Boolean(st.hidden)} aria-label={`${st.hidden ? "Show" : "Hide"} ${label}`} title={st.hidden ? "Show track" : "Hide track"}>
              {st.hidden ? <EyeOff size={13} /> : <Eye size={13} />}
            </button>
          ) : null}
          {canMute ? (
            <button type="button" className={`ve-mini${st.muted ? " is-on" : ""}`} onClick={() => toggle({ muted: !st.muted })} aria-pressed={Boolean(st.muted)} aria-label={`${st.muted ? "Unmute" : "Mute"} ${label}`} title={st.muted ? "Unmute track" : "Mute track"}>
              {st.muted ? <VolumeX size={13} /> : <Volume2 size={13} />}
            </button>
          ) : null}
          <button type="button" className={`ve-mini${st.locked ? " is-on" : ""}`} onClick={() => toggle({ locked: !st.locked })} aria-pressed={Boolean(st.locked)} aria-label={`${st.locked ? "Unlock" : "Lock"} ${label}`} title={st.locked ? "Unlock track" : "Lock track"}>
            {st.locked ? <Lock size={13} /> : <Unlock size={13} />}
          </button>
        </span>
      )}
    </div>
  );
}

export function Timeline({ snapping, onToggleSnap, onCollapse }: { snapping: boolean; onToggleSnap: () => void; onCollapse?: () => void }) {
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
  const [guide, setGuide] = useState<number | null>(null);
  const HEAD = useHeadWidth();
  const narrow = HEAD === HEAD_NARROW;
  const [height, setHeight] = useState(() => {
    try {
      return Number(window.localStorage.getItem(HEIGHT_KEY)) || 0;
    } catch {
      return 0;
    }
  });

  const duration = projectDuration(project);
  const width = Math.max(duration + 8, 20) * pps;
  const videoTracks = Math.max(1, ...project.clips.map((c) => c.track + 1));
  const audioLanes = Math.max(1, ...project.audio.map((c) => c.lane + 1));
  const selected = new Set(selection);
  const step = rulerStep(pps);

  // Keep the playhead in view while playing.
  useEffect(() => {
    const el = scroller.current;
    if (!el || !playing) return;
    const x = playhead * pps;
    if (x > el.scrollLeft + el.clientWidth - HEAD - 40 || x < el.scrollLeft) el.scrollLeft = Math.max(0, x - 40);
  }, [playhead, playing, pps, HEAD]);

  // ⌘/Ctrl + scroll zooms around the pointer.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const box = el.getBoundingClientRect();
      const x = e.clientX - box.left - HEAD;
      const t = (el.scrollLeft + x) / vibe.get().pxPerSec;
      const next = Math.min(400, Math.max(6, vibe.get().pxPerSec * Math.exp(-e.deltaY * 0.004)));
      vibe.set({ pxPerSec: next });
      requestAnimationFrame(() => {
        el.scrollLeft = Math.max(0, t * next - x);
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [HEAD]);

  const fit = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    vibe.set({ pxPerSec: Math.min(400, Math.max(6, (el.clientWidth - HEAD - 48) / Math.max(1, projectDuration(vibe.get().project)))) });
    el.scrollLeft = 0;
  }, [HEAD]);

  // Z fits the edit, like most editors.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea, select, [contenteditable=true]")) return;
      if (e.key.toLowerCase() === "z" && !e.metaKey && !e.ctrlKey && !e.altKey) fit();
      if (e.key === "End") vibe.seek(projectDuration(vibe.get().project));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fit]);

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

  const onResizeDown = (e: ReactPointerEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect().height;
    let last = startH;
    const move = (ev: PointerEvent) => {
      last = Math.min(window.innerHeight * 0.7, Math.max(170, startH + (startY - ev.clientY)));
      setHeight(last);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      try {
        window.localStorage.setItem(HEIGHT_KEY, String(Math.round(last)));
      } catch {
        // Preference only.
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const rowAt = (clientX: number, clientY: number, kind: TrackKind): number | undefined => {
    const hit = document.elementsFromPoint(clientX, clientY).find((el) => (el as HTMLElement).dataset?.rowKind === kind) as HTMLElement | undefined;
    return hit ? Number(hit.dataset.rowIndex) : undefined;
  };

  const onItemDown = (e: ReactPointerEvent, id: string, kind: TrackKind, mode: Drag["mode"], start: number, end: number, inPoint: number) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    if (e.shiftKey || e.metaKey) vibe.select(selected.has(id) ? selection.filter((s) => s !== id) : [...selection, id]);
    else if (!selected.has(id)) vibe.select([id]);
    if (isLocked(vibe.get().project, id)) return;
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
      let snappedAt: number | null = null;
      const snap = (raw: number) => {
        if (!tol) return raw;
        const s = snapTime(d.base, raw, tol, [ph], d.id);
        if (Math.abs(s - raw) > 1e-6) snappedAt = s;
        return s;
      };
      if (d.mode === "move") {
        const len = d.end - d.start;
        const raw = Math.max(0, d.start + dt);
        let s = raw;
        if (tol) {
          const a = snapTime(d.base, raw, tol, [ph], d.id);
          const b = snapTime(d.base, raw + len, tol, [ph], d.id) - len;
          if (Math.abs(a - raw) > 1e-6 && (Math.abs(a - raw) <= Math.abs(b - raw) || Math.abs(b - raw) < 1e-6)) {
            s = a;
            snappedAt = a;
          } else if (Math.abs(b - raw) > 1e-6) {
            s = Math.max(0, b);
            snappedAt = b + len;
          }
        }
        const row = d.kind === "video" || d.kind === "audio" ? rowAt(ev.clientX, ev.clientY, d.kind) : undefined;
        const targetKey = row !== undefined ? trackKey(d.kind, row) : null;
        next = moveItem(d.base, d.id, s, targetKey && trackState(d.base, targetKey).locked ? undefined : row);
      } else if (d.mode === "trim-start") {
        let s = snap(Math.min(d.end - 0.1, Math.max(0, d.start + dt)));
        if (d.kind === "video" || d.kind === "audio") {
          const inPoint = Math.max(0, d.inPoint + (s - d.start));
          s = d.start + (inPoint - d.inPoint);
          next = updateItem(d.base, d.id, { start: s, in: inPoint });
        } else next = updateItem(d.base, d.id, { start: s });
      } else {
        const e2 = snap(Math.max(d.start + 0.1, d.end + dt));
        if (d.kind === "video" || d.kind === "audio") next = updateItem(d.base, d.id, { out: d.inPoint + (e2 - d.start) });
        else next = updateItem(d.base, d.id, { end: e2 });
      }
      setGuide(snappedAt);
      vibe.commit(next, `drag:${d.id}:${d.x0}`);
    };
    const up = () => {
      drag.current = null;
      setGuide(null);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const majors = useMemo(() => {
    const out: number[] = [];
    for (let i = 0; i * step <= width / pps; i++) out.push(Math.round(i * step * 1000) / 1000);
    return out;
  }, [pps, width, step]);

  const item = (o: { id: string; kind: TrackKind; start: number; end: number; inPoint: number; label: string; icon: ReactNode; tone: string; body?: ReactNode; title?: string; locked: boolean; dim: boolean }) => {
    const w = Math.max(4, (o.end - o.start) * pps);
    const len = o.end - o.start;
    return (
      <div
        key={o.id}
        className={`ve-item ve-item-${o.tone}${selected.has(o.id) ? " is-selected" : ""}${o.locked ? " is-locked" : ""}${o.dim ? " is-dim" : ""}${w < 44 ? " is-tiny" : ""}`}
        style={{ left: o.start * pps, width: w > 10 ? w - 2 : w }}
        onPointerDown={(e) => onItemDown(e, o.id, o.kind, "move", o.start, o.end, o.inPoint)}
        title={o.title || `${o.label} · ${formatTime(o.start, true)}–${formatTime(o.end, true)}`}
      >
        {o.body}
        <span className="ve-item-label">
          {o.icon}
          <span className="ve-item-name">{o.label}</span>
          {w > 120 ? <span className="ve-item-dur">{len < 10 ? len.toFixed(1) : Math.round(len)}s</span> : null}
        </span>
        {o.locked ? null : (
          <>
            <span className="ve-trim ve-trim-start" onPointerDown={(e) => onItemDown(e, o.id, o.kind, "trim-start", o.start, o.end, o.inPoint)} />
            <span className="ve-trim ve-trim-end" onPointerDown={(e) => onItemDown(e, o.id, o.kind, "trim-end", o.start, o.end, o.inPoint)} />
          </>
        )}
      </div>
    );
  };

  const canSplit = [...project.clips, ...project.audio].some((c) => playhead > c.start + 0.1 && playhead < clipEnd(c) - 0.1) || project.texts.some((t) => playhead > t.start + 0.1 && playhead < t.end - 0.1);
  const st = (key: string) => trackState(project, key);
  const style: CSSProperties = { ...(height ? { height } : {}), ["--ve-head" as string]: `${HEAD}px` };

  return (
    <section className="ve-timeline" aria-label="Timeline" style={style}>
      <div className="ve-tl-resize" onPointerDown={onResizeDown} role="separator" aria-orientation="horizontal" aria-label="Resize timeline" title="Drag to resize" />
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
          <button type="button" className="ve-tool" onClick={() => vibe.commit((p) => deleteItems(p, selection.filter((id) => !isLocked(p, id))))} disabled={!selection.length} aria-label="Delete selected" title="Delete (⌫)">
            <Trash2 size={16} />
          </button>
          <span className="ve-tl-sep" />
          <button type="button" className={`ve-tool${snapping ? " is-on" : ""}`} onClick={onToggleSnap} aria-pressed={snapping} aria-label="Snapping" title="Snap to edges and playhead">
            <Magnet size={16} />
          </button>
        </div>
        <p className="ve-tl-hint">
          <kbd>Space</kbd> plays · <kbd>S</kbd> splits at the playhead · <kbd>←</kbd> <kbd>→</kbd> step a frame
        </p>
        <div className="ve-tl-group ve-zoom">
          <button type="button" className="ve-tool" onClick={() => vibe.set({ pxPerSec: Math.max(6, pps / 1.4) })} aria-label="Zoom out" title="Zoom out (⌘ scroll)">
            <Minus size={16} />
          </button>
          <input type="range" min={6} max={400} value={pps} onChange={(e) => vibe.set({ pxPerSec: Number(e.target.value) })} aria-label="Timeline zoom" />
          <button type="button" className="ve-tool" onClick={() => vibe.set({ pxPerSec: Math.min(400, pps * 1.4) })} aria-label="Zoom in" title="Zoom in (⌘ scroll)">
            <Plus size={16} />
          </button>
          <button type="button" className="ve-tool" onClick={fit} aria-label="Zoom to fit" title="Fit the edit (Z)">
            <Maximize2 size={15} />
          </button>
          {onCollapse ? (
            <button type="button" className="ve-collapse" onClick={onCollapse} aria-label="Hide timeline" title="Hide timeline">
              <PanelBottomClose size={16} strokeWidth={1.75} />
            </button>
          ) : null}
        </div>
      </div>

      <div className="ve-tl-scroll" ref={scroller}>
        <div className="ve-tl-canvas" style={{ width: width + HEAD, minWidth: "100%" }}>
          <div className="ve-ruler" onPointerDown={onRulerDown}>
            <div className="ve-ruler-corner">
              <span>{formatTime(duration)}</span>
            </div>
            <div className="ve-ruler-ticks" style={{ left: HEAD, backgroundImage: `repeating-linear-gradient(90deg, var(--ve-tick) 0 1px, transparent 1px ${(step / 5) * pps}px)` }} />
            {majors.map((t) => (
              <span key={t} className="ve-tick" style={{ left: HEAD + t * pps }}>
                {tickLabel(t, step)}
              </span>
            ))}
            <span className={`ve-ph-head${scrubbing ? " is-active" : ""}`} style={{ left: HEAD + playhead * pps }} />
          </div>

          <div className="ve-rows" onPointerDown={(e) => (e.target as HTMLElement).classList.contains("ve-lane") && vibe.select([])}>
            <div className="ve-row ve-row-thin">
              <TrackHead label="Titles" icon={<Type size={13} />} kind="text" row={0} project={project} narrow={narrow} />
              <div className={`ve-lane${st("text").locked ? " is-locked" : ""}`} data-row-kind="text" data-row-index={0}>
                {project.texts.map((t) => item({ id: t.id, kind: "text", start: t.start, end: t.end, inPoint: 0, label: t.text || "Title", icon: <Type size={11} />, tone: "text", locked: Boolean(st("text").locked), dim: Boolean(st("text").hidden) }))}
              </div>
            </div>
            {Array.from({ length: videoTracks }, (_, k) => videoTracks - 1 - k).map((track) => {
              const key = trackKey("video", track);
              return (
                <div className="ve-row ve-row-video" key={key}>
                  <TrackHead label={`Video ${track + 1}`} icon={<Film size={13} />} kind="video" row={track} project={project} narrow={narrow} />
                  <div className={`ve-lane${st(key).locked ? " is-locked" : ""}`} data-row-kind="video" data-row-index={track}>
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
                          icon: isImage ? <ImageIcon size={11} /> : <Film size={11} />,
                          tone: isImage ? "image" : "video",
                          locked: Boolean(st(key).locked),
                          dim: Boolean(st(key).hidden),
                          body: a ? <Strip asset={a} inPoint={c.in} width={(c.out - c.in) * pps} height={58} pps={pps} /> : null,
                        });
                      })}
                  </div>
                </div>
              );
            })}
            <div className="ve-row ve-row-thin">
              <TrackHead label="Captions" icon={<Captions size={13} />} kind="cue" row={0} project={project} narrow={narrow} />
              <div className={`ve-lane${st("cue").locked ? " is-locked" : ""}`} data-row-kind="cue" data-row-index={0}>
                {project.captions.cues.map((c) => item({ id: c.id, kind: "cue", start: c.start, end: c.end, inPoint: 0, label: c.text, icon: null, tone: "cue", locked: Boolean(st("cue").locked), dim: Boolean(st("cue").hidden) || !project.captions.show }))}
              </div>
            </div>
            {Array.from({ length: audioLanes }, (_, lane) => {
              const key = trackKey("audio", lane);
              return (
                <div className="ve-row ve-row-audio" key={key}>
                  <TrackHead label={`Audio ${lane + 1}`} icon={<AudioLines size={13} />} kind="audio" row={lane} project={project} narrow={narrow} />
                  <div className={`ve-lane${st(key).locked ? " is-locked" : ""}`} data-row-kind="audio" data-row-index={lane}>
                    {project.audio
                      .filter((c) => c.lane === lane)
                      .map((c) => {
                        const a = assetById(project, c.assetId);
                        return item({
                          id: c.id,
                          kind: "audio",
                          start: c.start,
                          end: clipEnd(c),
                          inPoint: c.in,
                          label: c.name || a?.name || "Audio",
                          icon: <AudioLines size={11} />,
                          tone: a?.origin === "voiceover" ? "voice" : "music",
                          locked: Boolean(st(key).locked),
                          dim: Boolean(st(key).muted),
                          title: c.duck !== undefined ? `${c.name || a?.name}: other sound ducks to ${Math.round(c.duck * 100)}% under this` : undefined,
                          body: a ? <Waveform url={a.url} inPoint={c.in} out={c.out} width={(c.out - c.in) * pps} /> : null,
                        });
                      })}
                  </div>
                </div>
              );
            })}
          </div>

          {guide !== null ? <div className="ve-snap-guide" style={{ left: HEAD + guide * pps }} aria-hidden="true" /> : null}
          <div className={`ve-playhead${scrubbing ? " is-scrubbing" : ""}`} style={{ left: HEAD + playhead * pps }} aria-hidden="true" />
        </div>
      </div>
    </section>
  );
}
