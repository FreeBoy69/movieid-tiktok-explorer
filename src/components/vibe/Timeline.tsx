// Multi-track timeline: titles, stacked video tracks, captions, and audio
// lanes. Track headers carry hide, mute, and lock switches; video clips show a
// filmstrip and sound clips a waveform with fade and volume handles. Drag to
// move (a selection moves together), drag edges to trim, drag empty space to
// box-select, right-click for edit commands. Snapping shows a guide, markers
// sit on the ruler, gaps on the base track close in one click.
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import {
  ArrowLeftToLine,
  ArrowRightToLine,
  AudioLines,
  Bookmark,
  BookmarkPlus,
  Captions,
  Copy,
  Eye,
  EyeOff,
  Film,
  FoldHorizontal,
  Image as ImageIcon,
  Keyboard,
  Lock,
  Magnet,
  Pencil,
  Plus,
  Redo2,
  Scissors,
  PanelBottom,
  UnfoldHorizontal,
  ZoomIn,
  ZoomOut,
  Trash2,
  Type,
  Undo2,
  Unlock,
  Volume2,
  VolumeX,
} from "lucide-react";
import {
  assetById,
  baseGaps,
  clipEnd,
  closeGap,
  deleteItems,
  duplicateItems,
  FPS,
  formatTime,
  formatTimecode,
  isLocked,
  itemTrack,
  moveItem,
  moveItems,
  parseTimecode,
  projectDuration,
  removeMarker,
  rippleDeleteItems,
  setTrackState,
  snapTime,
  splitAt,
  toggleMarker,
  trackKey,
  trackState,
  trimToTime,
  updateItem,
  updateMarker,
  type TrackKind,
  type VibeAsset,
  type VibeAudioClip,
  type VibeProject,
} from "../../utils/vibeEdit";
import { ContextMenu, ShortcutsPanel, type MenuEntry } from "./TimelineMenus";
import { useFilmstrip } from "./filmstrip";
import { uploadFiles } from "./Panels";
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
  /** Everything selected, when the drag moves a group. */
  group: string[];
}

interface Marquee {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface Readout {
  x: number;
  y: number;
  text: string;
}

const signed = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(1)}s`;
const decibels = (v: number) => (v <= 0.001 ? "−∞ dB" : `${(20 * Math.log10(v)).toFixed(1)} dB`);

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
  const canvas = useRef<HTMLDivElement>(null);
  const hoverLine = useRef<HTMLDivElement>(null);
  const hoverChip = useRef<HTMLSpanElement>(null);
  const drag = useRef<Drag | null>(null);
  const [scrubbing, setScrubbing] = useState(false);
  const [guide, setGuide] = useState<number | null>(null);
  const [marquee, setMarquee] = useState<Marquee | null>(null);
  const [readout, setReadout] = useState<Readout | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; label: string; items: MenuEntry[] } | null>(null);
  const [shortcuts, setShortcuts] = useState(false);
  const [timecodeDraft, setTimecodeDraft] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);
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
  const markers = project.markers || [];
  const gaps = baseGaps(project);

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

  const importer = useRef<HTMLInputElement>(null);
  const fit = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    vibe.set({ pxPerSec: Math.min(400, Math.max(6, (el.clientWidth - HEAD - 48) / Math.max(1, projectDuration(vibe.get().project)))) });
    el.scrollLeft = 0;
  }, [HEAD]);

  // Z fits the edit, End goes to the end, ? opens the shortcut sheet.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea, select, [contenteditable=true]")) return;
      if (e.key.toLowerCase() === "z" && !e.metaKey && !e.ctrlKey && !e.altKey) fit();
      if (e.key === "End") vibe.seek(projectDuration(vibe.get().project));
      if (e.key === "?") setShortcuts((v) => !v);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fit]);

  const timeAt = (clientX: number) => {
    const el = scroller.current!;
    const box = el.getBoundingClientRect();
    return Math.max(0, (clientX - box.left + el.scrollLeft - HEAD) / pps);
  };

  // ---------- Ruler: scrub, hover time, markers ----------
  const onRulerDown = (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
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

  // The hover line moves by direct style writes so pointer motion never re-renders the clips.
  const showHover = (clientX: number | null) => {
    const line = hoverLine.current;
    const chip = hoverChip.current;
    if (!line || !chip) return;
    if (clientX === null) {
      line.hidden = true;
      chip.hidden = true;
      return;
    }
    const t = timeAt(clientX);
    const left = `${HEAD + t * pps}px`;
    line.hidden = false;
    chip.hidden = false;
    line.style.left = left;
    chip.style.left = left;
    chip.textContent = formatTimecode(t);
  };

  const onMarkerDown = (e: ReactPointerEvent, id: string, time: number) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const x0 = e.clientX;
    let moved = false;
    const move = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientX - x0) < 3) return;
      moved = true;
      const t = Math.max(0, time + (ev.clientX - x0) / pps);
      vibe.commit((p) => updateMarker(p, id, { time: t }), `marker:${id}:${x0}`);
      setReadout({ x: ev.clientX, y: ev.clientY, text: formatTimecode(t) });
    };
    const up = () => {
      if (!moved) vibe.seek(time);
      setReadout(null);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const commitRename = () => {
    if (!renaming) return;
    vibe.commit((p) => updateMarker(p, renaming.id, { label: renaming.value }));
    setRenaming(null);
  };

  const commitTimecode = () => {
    if (timecodeDraft === null) return;
    const t = parseTimecode(timecodeDraft);
    if (t !== null) vibe.seek(t);
    setTimecodeDraft(null);
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

  // ---------- Clips: move, trim, group move ----------
  const onItemDown = (e: ReactPointerEvent, id: string, kind: TrackKind, mode: Drag["mode"], start: number, end: number, inPoint: number) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    let nextSelection = selection;
    if (e.shiftKey || e.metaKey) nextSelection = selected.has(id) ? selection.filter((s) => s !== id) : [...selection, id];
    else if (!selected.has(id)) nextSelection = [id];
    if (nextSelection !== selection) vibe.select(nextSelection);
    if (isLocked(vibe.get().project, id) || !nextSelection.includes(id)) return;
    const group = mode === "move" && nextSelection.length > 1 ? nextSelection : [];
    drag.current = { id, mode, kind, x0: e.clientX, base: vibe.get().project, start, end, inPoint, moved: false, group };
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
      let text = "";
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
        if (d.group.length) {
          next = moveItems(d.base, d.group, s - d.start);
          text = `${d.group.length} items · ${signed(s - d.start)}`;
        } else {
          const row = d.kind === "video" || d.kind === "audio" ? rowAt(ev.clientX, ev.clientY, d.kind) : undefined;
          const targetKey = row !== undefined ? trackKey(d.kind, row) : null;
          next = moveItem(d.base, d.id, s, targetKey && trackState(d.base, targetKey).locked ? undefined : row);
          text = `${formatTime(s, true)} · ${signed(s - d.start)}`;
        }
      } else if (d.mode === "trim-start") {
        let s = snap(Math.min(d.end - 0.1, Math.max(0, d.start + dt)));
        if (d.kind === "video" || d.kind === "audio") {
          const inPoint = Math.max(0, d.inPoint + (s - d.start));
          s = d.start + (inPoint - d.inPoint);
          next = updateItem(d.base, d.id, { start: s, in: inPoint });
        } else next = updateItem(d.base, d.id, { start: s });
        text = `${(d.end - s).toFixed(1)}s long · ${signed(s - d.start)}`;
      } else {
        const e2 = snap(Math.max(d.start + 0.1, d.end + dt));
        if (d.kind === "video" || d.kind === "audio") next = updateItem(d.base, d.id, { out: d.inPoint + (e2 - d.start) });
        else next = updateItem(d.base, d.id, { end: e2 });
        text = `${(e2 - d.start).toFixed(1)}s long · ${signed(e2 - d.end)}`;
      }
      setGuide(snappedAt);
      setReadout({ x: ev.clientX, y: ev.clientY, text });
      vibe.commit(next, `drag:${d.id}:${d.x0}`);
    };
    const up = () => {
      drag.current = null;
      setGuide(null);
      setReadout(null);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // ---------- Sound: fade handles and the volume line ----------
  const onEnvelopeDown = (e: ReactPointerEvent, clip: VibeAudioClip, part: "fade-in" | "fade-out" | "volume") => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    if (!selected.has(clip.id)) vibe.select([clip.id]);
    if (isLocked(vibe.get().project, clip.id)) return;
    const x0 = e.clientX;
    const y0 = e.clientY;
    const area = (e.currentTarget.closest(".ve-env") as HTMLElement).getBoundingClientRect().height || 30;
    const len = clip.out - clip.in;
    const key = `env:${clip.id}:${part}:${x0}`;
    const move = (ev: PointerEvent) => {
      let patch: Partial<VibeAudioClip>;
      let text: string;
      if (part === "volume") {
        const volume = Math.round(Math.min(2, Math.max(0, clip.volume + ((y0 - ev.clientY) / area) * 2)) * 100) / 100;
        patch = { volume };
        text = `${Math.round(volume * 100)}% · ${decibels(volume)}`;
      } else {
        const dx = (ev.clientX - x0) / pps;
        const was = (part === "fade-in" ? clip.fadeIn : clip.fadeOut) || 0;
        const fade = Math.round(Math.min(len / 2, Math.max(0, was + (part === "fade-in" ? dx : -dx))) * 10) / 10;
        patch = part === "fade-in" ? { fadeIn: fade } : { fadeOut: fade };
        text = `Fade ${part === "fade-in" ? "in" : "out"} ${fade.toFixed(1)}s`;
      }
      vibe.commit((p) => updateItem(p, clip.id, patch), key);
      setReadout({ x: ev.clientX, y: ev.clientY, text });
    };
    const up = () => {
      setReadout(null);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const envelope = (c: VibeAudioClip, w: number) => {
    const level = Math.min(2, Math.max(0, c.volume)) / 2;
    const y = (1 - level) * 100;
    const fi = Math.min(w / 2, (c.fadeIn || 0) * pps);
    const fo = Math.min(w / 2, (c.fadeOut || 0) * pps);
    const shade = `M0 0V100L${fi.toFixed(1)} ${y.toFixed(1)}H${(w - fo).toFixed(1)}L${w.toFixed(1)} 100V0Z`;
    return (
      <span className="ve-env" style={{ ["--ve-level" as string]: `${y}%` }}>
        <svg viewBox={`0 0 ${Math.max(1, w)} 100`} preserveAspectRatio="none" aria-hidden="true">
          <path className="ve-env-shade" d={shade} />
          <path className="ve-env-line" d={`M0 100L${fi.toFixed(1)} ${y.toFixed(1)}H${(w - fo).toFixed(1)}L${w.toFixed(1)} 100`} vectorEffect="non-scaling-stroke" />
        </svg>
        {w > 36 ? (
          <>
            <span className="ve-env-volume" onPointerDown={(e) => onEnvelopeDown(e, c, "volume")} title={`Volume ${Math.round(c.volume * 100)}%: drag up or down`} />
            <span className="ve-env-handle" style={{ left: fi }} onPointerDown={(e) => onEnvelopeDown(e, c, "fade-in")} title="Fade in: drag right" />
            <span className="ve-env-handle" style={{ left: w - fo }} onPointerDown={(e) => onEnvelopeDown(e, c, "fade-out")} title="Fade out: drag left" />
          </>
        ) : null}
      </span>
    );
  };

  // ---------- Box select on empty lane space ----------
  const onLanesDown = (e: ReactPointerEvent) => {
    const target = e.target as HTMLElement;
    if (e.button !== 0 || !(target.classList.contains("ve-lane") || target.classList.contains("ve-rows"))) return;
    e.preventDefault();
    const box = canvas.current!.getBoundingClientRect();
    const x0 = e.clientX - box.left;
    const y0 = e.clientY - box.top;
    const additive = e.shiftKey || e.metaKey;
    const before = additive ? vibe.get().selection : [];
    let dragged = false;
    const move = (ev: PointerEvent) => {
      const now = canvas.current!.getBoundingClientRect();
      const x1 = ev.clientX - now.left;
      const y1 = ev.clientY - now.top;
      if (!dragged && Math.hypot(x1 - x0, y1 - y0) < 4) return;
      dragged = true;
      setMarquee({ x0, y0, x1, y1 });
      const left = now.left + Math.min(x0, x1);
      const right = now.left + Math.max(x0, x1);
      const top = now.top + Math.min(y0, y1);
      const bottom = now.top + Math.max(y0, y1);
      const hits = [...canvas.current!.querySelectorAll<HTMLElement>("[data-item-id]")]
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return r.right > left && r.left < right && r.bottom > top && r.top < bottom;
        })
        .map((el) => el.dataset.itemId!);
      vibe.select([...new Set([...before, ...hits])]);
    };
    const up = () => {
      if (!dragged && !additive) vibe.select([]);
      setMarquee(null);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // ---------- Commands shared by the toolbar, menus, and keys ----------
  const ripple = () => vibe.commit((p) => rippleDeleteItems(p, vibe.get().selection));
  const duplicate = () => {
    const { project: next, ids } = duplicateItems(vibe.get().project, vibe.get().selection);
    if (!ids.length) return;
    vibe.commit(next);
    vibe.select(ids);
  };
  const trimTo = (side: "start" | "end") => vibe.commit((p) => trimToTime(p, vibe.get().selection, vibe.get().playhead, side));

  const itemMenu = (e: ReactMouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    const sel = selected.has(id) ? selection : [id];
    if (!selected.has(id)) vibe.select([id]);
    const key = itemTrack(project, id);
    const locked = Boolean(key && trackState(project, key).locked);
    const spans = [...project.clips, ...project.audio].filter((c) => sel.includes(c.id)).map((c) => [c.start, clipEnd(c)]);
    const under = spans.concat(project.texts.filter((t) => sel.includes(t.id)).map((t) => [t.start, t.end])).some(([a, b]) => playhead > a + 0.1 && playhead < b - 0.1);
    setMenu({
      x: e.clientX,
      y: e.clientY,
      label: sel.length > 1 ? `${sel.length} selected items` : "Clip",
      items: [
        { label: "Split at playhead", icon: <Scissors size={14} />, keys: "S", disabled: locked || !under, onSelect: () => vibe.commit((p) => splitAt(p, vibe.get().playhead, sel)) },
        { label: "Trim start to playhead", icon: <ArrowLeftToLine size={14} />, keys: "Q", disabled: locked || !under, onSelect: () => trimTo("start") },
        { label: "Trim end to playhead", icon: <ArrowRightToLine size={14} />, keys: "W", disabled: locked || !under, onSelect: () => trimTo("end") },
        { label: "Duplicate", icon: <Copy size={14} />, keys: "⌘D", onSelect: duplicate },
        "sep",
        { label: locked ? "Unlock track" : "Lock track", icon: locked ? <Unlock size={14} /> : <Lock size={14} />, disabled: !key, onSelect: () => key && vibe.commit((p) => setTrackState(p, key, { locked: !locked })) },
        "sep",
        { label: "Delete and close gap", icon: <FoldHorizontal size={14} />, keys: "⇧⌫", disabled: locked, onSelect: ripple },
        { label: "Delete", icon: <Trash2 size={14} />, keys: "⌫", danger: true, disabled: locked, onSelect: () => vibe.commit((p) => deleteItems(p, sel.filter((x) => !isLocked(p, x)))) },
      ],
    });
  };

  const laneMenu = (e: ReactMouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest("[data-item-id], .ve-row-head")) return;
    e.preventDefault();
    const t = timeAt(e.clientX);
    const lane = target.closest<HTMLElement>("[data-row-kind]");
    const gap = lane?.dataset.rowKind === "video" && lane.dataset.rowIndex === "0" ? gaps.find((g) => t >= g.start && t <= g.end) : undefined;
    setMenu({
      x: e.clientX,
      y: e.clientY,
      label: "Timeline",
      items: [
        { label: `Add marker at ${formatTime(t, true)}`, icon: <BookmarkPlus size={14} />, onSelect: () => vibe.commit((p) => toggleMarker(p, t)) },
        ...(gap ? [{ label: `Close ${(gap.end - gap.start).toFixed(1)}s gap`, icon: <FoldHorizontal size={14} />, onSelect: () => vibe.commit((p) => closeGap(p, t)) }] : []),
        { label: "Move playhead here", icon: <ArrowRightToLine size={14} />, onSelect: () => vibe.seek(t) },
        "sep",
        { label: "Select everything", icon: <Copy size={14} />, keys: "⌘A", onSelect: () => selectAll() },
      ],
    });
  };

  const markerMenu = (e: ReactMouseEvent, id: string, label: string) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({
      x: e.clientX,
      y: e.clientY,
      label: "Marker",
      items: [
        { label: "Rename", icon: <Pencil size={14} />, onSelect: () => setRenaming({ id, value: label }) },
        { label: "Delete marker", icon: <Trash2 size={14} />, danger: true, onSelect: () => vibe.commit((p) => removeMarker(p, id)) },
      ],
    });
  };

  const selectAll = () => {
    const p = vibe.get().project;
    vibe.select([...p.clips, ...p.audio, ...p.texts, ...p.captions.cues].map((i) => i.id).filter((id) => !isLocked(p, id)));
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
        data-item-id={o.id}
        className={`ve-item ve-item-${o.tone}${selected.has(o.id) ? " is-selected" : ""}${o.locked ? " is-locked" : ""}${o.dim ? " is-dim" : ""}${w < 44 ? " is-tiny" : ""}`}
        style={{ left: o.start * pps, width: w > 10 ? w - 2 : w }}
        onPointerDown={(e) => onItemDown(e, o.id, o.kind, "move", o.start, o.end, o.inPoint)}
        onContextMenu={(e) => itemMenu(e, o.id)}
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
  const anyUnlocked = selection.some((id) => !isLocked(project, id));
  // 100% is the zoom that fits the whole edit in view.
  const fitPps = (scroller.current ? scroller.current.clientWidth - HEAD - 48 : 900) / Math.max(1, duration);
  const zoomPct = Math.max(1, Math.round((pps / Math.max(1, fitPps)) * 100));
  const style: CSSProperties = { ...(height ? { height } : {}), ["--ve-head" as string]: `${HEAD}px` };

  // What the middle of the toolbar reports: the selection, or the edit.
  const selSpans = [
    ...project.clips.filter((c) => selected.has(c.id)).map((c) => [c.start, clipEnd(c)]),
    ...project.audio.filter((c) => selected.has(c.id)).map((c) => [c.start, clipEnd(c)]),
    ...project.texts.filter((t) => selected.has(t.id)).map((t) => [t.start, t.end]),
    ...project.captions.cues.filter((c) => selected.has(c.id)).map((c) => [c.start, c.end]),
  ];
  const status = selSpans.length
    ? `${selSpans.length} selected · ${(Math.max(...selSpans.map((s) => s[1])) - Math.min(...selSpans.map((s) => s[0]))).toFixed(1)}s`
    : `${formatTime(duration)} · ${project.clips.length + project.audio.length} ${project.clips.length + project.audio.length === 1 ? "clip" : "clips"}${markers.length ? ` · ${markers.length} ${markers.length === 1 ? "marker" : "markers"}` : ""}`;

  return (
    <section className="ve-timeline" aria-label="Timeline" style={style}>
      <input
        ref={importer}
        type="file"
        multiple
        hidden
        accept="video/*,image/*,audio/*"
        onChange={(e) => {
          const files = [...(e.target.files || [])];
          e.target.value = "";
          if (files.length) void uploadFiles(files);
        }}
      />
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
          <button type="button" className="ve-tool" onClick={duplicate} disabled={!selection.length} aria-label="Duplicate" title="Duplicate (⌘D)">
            <Copy size={16} />
          </button>
          <button type="button" className="ve-tool" onClick={ripple} disabled={!anyUnlocked} aria-label="Delete and close the gap" title="Delete and close the gap (⇧⌫)">
            <FoldHorizontal size={16} />
          </button>
          <button type="button" className="ve-tool" onClick={() => vibe.commit((p) => deleteItems(p, selection.filter((id) => !isLocked(p, id))))} disabled={!anyUnlocked} aria-label="Delete selected" title="Delete (⌫)">
            <Trash2 size={16} />
          </button>
          <span className="ve-tl-sep" />
          <button type="button" className={`ve-tool${snapping ? " is-on" : ""}`} onClick={onToggleSnap} aria-pressed={snapping} aria-label="Snapping" title="Snap to edges, markers, and the playhead">
            <Magnet size={16} />
          </button>
          <button type="button" className="ve-tool" onClick={() => vibe.commit((p) => toggleMarker(p, playhead))} aria-label="Add or remove a marker at the playhead" title="Marker (M)">
            <BookmarkPlus size={16} />
          </button>
        </div>
        <p className="ve-tl-status" aria-live="polite">
          {status}
        </p>
        <div className="ve-tl-group ve-zoom">
          <button type="button" className="ve-tool" onClick={fit} aria-label="Fit the edit" title="Fit the edit (Z)">
            <UnfoldHorizontal size={16} strokeWidth={1.75} />
          </button>
          <button type="button" className="ve-tool" onClick={() => vibe.set({ pxPerSec: Math.max(6, pps / 1.4) })} aria-label="Zoom out" title="Zoom out (⌘ scroll)">
            <ZoomOut size={16} strokeWidth={1.75} />
          </button>
          <input className="ve-zoom-range" type="range" min={Math.log(6)} max={Math.log(400)} step={0.01} value={Math.log(pps)} onChange={(e) => vibe.set({ pxPerSec: Math.round(Math.exp(Number(e.target.value)) * 10) / 10 })} aria-label="Timeline zoom" aria-valuetext={`${zoomPct}%`} />
          <button type="button" className="ve-tool" onClick={() => vibe.set({ pxPerSec: Math.min(400, pps * 1.4) })} aria-label="Zoom in" title="Zoom in (⌘ scroll)">
            <ZoomIn size={16} strokeWidth={1.75} />
          </button>
          <output className="ve-zoom-pct" title="Zoom, where 100% fits the whole edit">{zoomPct}%</output>
          <span className="ve-tl-sep" />
          <button type="button" className={`ve-tool${shortcuts ? " is-on" : ""}`} data-shortcuts-toggle onClick={() => setShortcuts((v) => !v)} aria-expanded={shortcuts} aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)">
            <Keyboard size={16} strokeWidth={1.75} />
          </button>
          {onCollapse ? (
            <button type="button" className="ve-collapse" onClick={onCollapse} aria-label="Hide timeline" title="Hide timeline">
              <PanelBottom size={17} strokeWidth={1.75} />
            </button>
          ) : null}
        </div>
        {shortcuts ? <ShortcutsPanel onClose={() => setShortcuts(false)} /> : null}
      </div>

      <div className="ve-tl-scroll" ref={scroller}>
        <div className="ve-tl-canvas" ref={canvas} style={{ width: width + HEAD, minWidth: "100%" }} onContextMenu={laneMenu}>
          <div className="ve-ruler" onPointerDown={onRulerDown} onPointerMove={(e) => showHover(scrubbing ? null : e.clientX)} onPointerLeave={() => showHover(null)}>
            <div className="ve-ruler-corner" onPointerDown={(e) => e.stopPropagation()}>
              {timecodeDraft !== null ? (
                <input
                  className="ve-timecode-input"
                  autoFocus
                  value={timecodeDraft}
                  onChange={(e) => setTimecodeDraft(e.target.value)}
                  onBlur={commitTimecode}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitTimecode();
                    if (e.key === "Escape") setTimecodeDraft(null);
                  }}
                  aria-label="Go to time"
                  placeholder="1:23 or 00:01:23:12"
                />
              ) : (
                <button type="button" className="ve-timecode" onClick={() => setTimecodeDraft(formatTimecode(playhead))} title={`Playhead, of ${formatTimecode(duration)} total. Click to type a time.`} aria-label={`Playhead at ${formatTimecode(playhead)}. Go to a time`}>
                  {narrow ? formatTime(playhead) : formatTimecode(playhead)}
                </button>
              )}
            </div>
            <div className="ve-ruler-ticks" style={{ left: HEAD, backgroundImage: `repeating-linear-gradient(90deg, var(--ve-tick) 0 1px, transparent 1px ${(step / 5) * pps}px)` }} />
            {majors.map((t) => (
              <span key={t} className="ve-tick" style={{ left: HEAD + t * pps }}>
                {tickLabel(t, step)}
              </span>
            ))}
            {markers.map((m) =>
              renaming?.id === m.id ? (
                <input
                  key={m.id}
                  className="ve-marker-input"
                  style={{ left: HEAD + m.time * pps }}
                  autoFocus
                  value={renaming.value}
                  maxLength={60}
                  placeholder="Marker name"
                  onPointerDown={(e) => e.stopPropagation()}
                  onChange={(e) => setRenaming({ id: m.id, value: e.target.value })}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename();
                    if (e.key === "Escape") setRenaming(null);
                  }}
                  aria-label="Marker name"
                />
              ) : (
                <button
                  key={m.id}
                  type="button"
                  className="ve-marker"
                  style={{ left: HEAD + m.time * pps }}
                  onPointerDown={(e) => onMarkerDown(e, m.id, m.time)}
                  onDoubleClick={() => setRenaming({ id: m.id, value: m.label || "" })}
                  onContextMenu={(e) => markerMenu(e, m.id, m.label || "")}
                  aria-label={`${m.label || "Marker"} at ${formatTime(m.time, true)}`}
                  title={`${m.label || "Marker"} · ${formatTime(m.time, true)}. Drag to move, double-click to name, right-click for more.`}
                >
                  <Bookmark size={11} aria-hidden="true" />
                  {m.label && pps > 12 ? <span>{m.label}</span> : null}
                </button>
              ),
            )}
            <span className="ve-hover-chip" ref={hoverChip} hidden aria-hidden="true" />
            <span className={`ve-ph-head${scrubbing ? " is-active" : ""}`} style={{ left: HEAD + playhead * pps }} />
          </div>

          <div className="ve-rows" onPointerDown={onLanesDown}>
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
                    {track === 0 && !st(key).locked
                      ? gaps.map((g) => {
                          const gw = (g.end - g.start) * pps;
                          return (
                            <span key={`gap-${g.start}`} className="ve-gap" style={{ left: g.start * pps, width: gw }}>
                              {gw > 26 ? (
                                <button type="button" className="ve-gap-close" onPointerDown={(e) => e.stopPropagation()} onClick={() => vibe.commit((p) => closeGap(p, g.start))} aria-label={`Close the ${(g.end - g.start).toFixed(1)} second gap`} title="Close the gap: pull everything after it left">
                                  <FoldHorizontal size={13} aria-hidden="true" />
                                  {gw > 110 ? <span>Close gap</span> : null}
                                </button>
                              ) : null}
                            </span>
                          );
                        })
                      : null}
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
                    {st(key).locked ? null : (
                      <button type="button" className="ve-lane-add" style={{ left: project.clips.filter((c) => c.track === track).reduce((end, c) => Math.max(end, clipEnd(c)), 0) * pps + 10 }} onClick={() => importer.current?.click()} aria-label="Add clips" title="Add videos or photos">
                        <Plus size={15} strokeWidth={1.75} />
                      </button>
                    )}
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
                        const w = (c.out - c.in) * pps;
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
                          body: (
                            <>
                              {a ? <Waveform url={a.url} inPoint={c.in} out={c.out} width={w} /> : null}
                              {st(key).locked ? null : envelope(c, w > 10 ? w - 2 : w)}
                            </>
                          ),
                        });
                      })}
                  </div>
                </div>
              );
            })}
          </div>

          {markers.map((m) => (
            <div key={`line-${m.id}`} className="ve-marker-line" style={{ left: HEAD + m.time * pps }} aria-hidden="true" />
          ))}
          <div className="ve-hover-line" ref={hoverLine} hidden aria-hidden="true" />
          {marquee ? (
            <div
              className="ve-marquee"
              style={{ left: Math.min(marquee.x0, marquee.x1), top: Math.min(marquee.y0, marquee.y1), width: Math.abs(marquee.x1 - marquee.x0), height: Math.abs(marquee.y1 - marquee.y0) }}
              aria-hidden="true"
            />
          ) : null}
          {guide !== null ? <div className="ve-snap-guide" style={{ left: HEAD + guide * pps }} aria-hidden="true" /> : null}
          <div className={`ve-playhead${scrubbing ? " is-scrubbing" : ""}`} style={{ left: HEAD + playhead * pps }} aria-hidden="true" />
        </div>
      </div>
      {readout ? (
        <div className="ve-readout" style={{ left: readout.x, top: readout.y }} aria-hidden="true">
          {readout.text}
        </div>
      ) : null}
      {menu ? <ContextMenu x={menu.x} y={menu.y} label={menu.label} items={menu.items} onClose={() => setMenu(null)} /> : null}
    </section>
  );
}
