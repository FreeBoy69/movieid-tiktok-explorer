// Multi-track timeline: titles, stacked video tracks, captions, and audio
// lanes. Track headers carry hide, mute, and lock switches; video clips show a
// filmstrip and sound clips a waveform with fade and volume handles. Drag to
// move (a selection moves together), drag edges to trim, drag empty space to
// box-select, right-click for edit commands. Snapping shows a guide, markers
// sit on the ruler, gaps on the base track close in one click. Modes borrowed
// from the big editors: a magnetic main track (CapCut), skimming (Final Cut),
// track heights (Premiere, Resolve), color labels (Premiere), and an overview
// strip for long edits (Resolve).
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
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
  ScanLine,
  Scissors,
  PanelBottom,
  UnfoldHorizontal,
  Trash2,
  Type,
  Undo2,
  Unlock,
  Volume2,
  VolumeX,
  SlidersHorizontal,
} from "lucide-react";
import {
  assetById,
  baseGaps,
  CLIP_LABELS,
  compactTracks,
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
  projectDuration,
  removeMarker,
  rippleDeleteItems,
  rippleTrim,
  setLabel,
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
import { gestureKey, useVibe, vibe } from "./store";

const HEAD_WIDE = 168;
const HEAD_NARROW = 44;
const narrowQuery = "(max-width: 900px)";
const HEIGHT_KEY = "vibe-edit-timeline-height";
/** The tallest the timeline may be in a window this tall: the preview and the
 * header keep at least 360px, so a height saved on a big screen never squeezes
 * the picture away on a smaller one. */
const maxTimelineHeight = (windowH: number) => Math.max(170, windowH - 360);

function useWindowHeight() {
  const [h, setH] = useState(() => (typeof window === "undefined" ? 900 : window.innerHeight));
  useEffect(() => {
    const on = () => setH(window.innerHeight);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return h;
}
const DENSITY_KEY = "vibe-edit-track-size";
const SKIM_KEY = "vibe-edit-skimming";

type Density = "compact" | "standard" | "large";
const DENSITIES: { id: Density; name: string; video: number }[] = [
  { id: "compact", name: "Compact tracks", video: 44 },
  { id: "standard", name: "Standard tracks", video: 64 },
  { id: "large", name: "Large tracks", video: 96 },
];

function usePref<T extends string>(key: string, fallback: T, allowed: readonly T[]): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const v = window.localStorage.getItem(key) as T | null;
      return v && allowed.includes(v) ? v : fallback;
    } catch {
      return fallback;
    }
  });
  const set = (v: T) => {
    setValue(v);
    try {
      window.localStorage.setItem(key, v);
    } catch {
      // Preference only.
    }
  };
  return [value, set];
}

const labelColor = (id?: string) => CLIP_LABELS.find((l) => l.id === id)?.color;

/** Keep the names of clips that straddle the left edge in view (CapCut,
 * Premiere). Touches only those clips' labels, never the whole timeline. */
const pinned = new WeakMap<HTMLElement, Set<HTMLElement>>();
function pinLabels(canvasEl: HTMLElement, scrollX: number) {
  const before = pinned.get(canvasEl) || new Set<HTMLElement>();
  const now = new Set<HTMLElement>();
  for (const item of canvasEl.querySelectorAll<HTMLElement>(".ve-item[data-x]")) {
    const x = Number(item.dataset.x);
    const w = Number(item.dataset.w);
    if (x >= scrollX || x + w <= scrollX || w < 140) continue;
    const label = item.querySelector<HTMLElement>(".ve-item-label");
    if (!label) continue;
    label.style.paddingLeft = `${Math.min(Math.max(8, w - 96), scrollX - x + 8)}px`;
    now.add(label);
  }
  for (const label of before) if (!now.has(label)) label.style.paddingLeft = "";
  pinned.set(canvasEl, now);
}

/** Three bars of rising height: the icon for each track-height preset. */
function DensityIcon({ level }: { level: number }) {
  return (
    <svg width="16" height="14" viewBox="0 0 16 14" aria-hidden="true">
      {[0, 1].map((row) => {
        const h = [3, 4.5, 6][level];
        const y = row === 0 ? 7 - h - 0.75 : 7.75;
        return <rect key={row} x="1.5" y={y} width="13" height={h} rx="1.2" fill="currentColor" opacity={row === 0 ? 1 : 0.55} />;
      })}
    </svg>
  );
}

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
  y0: number;
  base: VibeProject;
  start: number;
  end: number;
  inPoint: number;
  moved: boolean;
  /** Everything selected, when the drag moves a group. */
  group: string[];
  /** The scroller's position when the drag began, so auto-scroll keeps the clip under the pointer. */
  scroll0: number;
  /** This drag's undo key: every step of it folds into one undo. */
  key: string;
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
  // A recap's whole film: its contact sheets already hold a frame every few seconds, so no video is decoded.
  if (asset.film?.sheets) return <FilmSheetStrip asset={asset} inPoint={inPoint} width={width} height={height} pps={pps} />;
  return <VideoStrip asset={asset} inPoint={inPoint} width={width} height={height} pps={pps} />;
}
function FilmSheetStrip({ asset, inPoint, width, height, pps }: { asset: VibeAsset; inPoint: number; width: number; height: number; pps: number }) {
  const { base, every, cols, rows } = asset.film!.sheets!;
  const aspect = asset.width && asset.height ? asset.width / asset.height : 16 / 9;
  const tileW = Math.max(24, Math.round(height * aspect));
  const tiles = Math.min(200, Math.ceil(width / tileW));
  const per = cols * rows;
  return (
    <span className="ve-strip" aria-hidden="true">
      {Array.from({ length: tiles }, (_, i) => {
        const t = inPoint + (i * tileW + tileW / 2) / pps;
        const n = Math.max(0, Math.floor(t / every));
        const at = n % per;
        const col = at % cols;
        const row = Math.floor(at / cols);
        return (
          <span
            key={i}
            className="ve-strip-tile"
            style={{
              left: i * tileW,
              width: tileW,
              height,
              backgroundImage: `url("${base}s${String(Math.floor(n / per)).padStart(3, "0")}.jpg")`,
              backgroundSize: `${cols * 100}% ${rows * 100}%`,
              backgroundPosition: `${cols > 1 ? (col / (cols - 1)) * 100 : 0}% ${rows > 1 ? (row / (rows - 1)) * 100 : 0}%`,
            }}
          />
        );
      })}
    </span>
  );
}
function VideoStrip({ asset, inPoint, width, height, pps }: { asset: VibeAsset; inPoint: number; width: number; height: number; pps: number }) {
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

// ---------- Pieces that follow the playhead or the scroll on their own ----------
// The playhead moves every frame during playback and skimming, and the view
// scrolls every frame; only these small pieces re-render for that, never the
// clips and filmstrips.

/** How wide the scrollable edit is: the content plus some runway after it,
 * a third of the view (never a fixed number of seconds, which at high zoom
 * meant scrolling through screens of nothing). */
function editWidth(duration: number, pps: number, viewW: number) {
  return Math.max(duration * pps + Math.max(160, viewW / 3), viewW);
}

function RulerHead({ head, pps, active }: { head: number; pps: number; active: boolean }) {
  const playhead = useVibe((s) => s.playhead);
  return <span className={`ve-ph-head${active ? " is-active" : ""}`} style={{ left: head + playhead * pps }} />;
}

function PlayheadLine({ head, pps, active }: { head: number; pps: number; active: boolean }) {
  const playhead = useVibe((s) => s.playhead);
  return <div className={`ve-playhead${active ? " is-scrubbing" : ""}`} style={{ left: head + playhead * pps }} aria-hidden="true" />;
}

function underPlayhead(p: VibeProject, t: number, ids?: string[]) {
  const wanted = ids && new Set(ids);
  const spans = [...p.clips, ...p.audio].map((c) => [c.id, c.start, clipEnd(c)] as const).concat(p.texts.map((x) => [x.id, x.start, x.end] as const));
  return spans.some(([id, a, b]) => (!wanted || wanted.has(id)) && t > a + 0.1 && t < b - 0.1);
}

function SplitButton() {
  const can = useVibe((s) => underPlayhead(s.project, s.playhead));
  return (
    <button type="button" className="ve-tool" onClick={() => vibe.commit((p) => splitAt(p, vibe.get().playhead, vibe.get().selection.length ? vibe.get().selection : undefined))} disabled={!can} aria-label="Split at playhead" title="Split (S)">
      <Scissors size={16} />
    </button>
  );
}

/** Resolve-style overview of the whole edit: drag to scroll. It reads the
 * scroll position itself and moves its window by style writes. */
function Overview({ scroller, head, pps, project, duration, total }: { scroller: React.RefObject<HTMLDivElement | null>; head: number; pps: number; project: VibeProject; duration: number; total: number }) {
  const playhead = useVibe((s) => s.playhead);
  const windowRef = useRef<HTMLSpanElement>(null);
  const [viewW, setViewW] = useState(0);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const place = () => {
      const w = windowRef.current;
      if (w) {
        const width = Math.min(100, ((el.clientWidth - head) / total) * 100);
        w.style.width = `${width}%`;
        w.style.left = `${Math.min(100 - width, (el.scrollLeft / total) * 100)}%`;
      }
    };
    const resize = () => {
      setViewW(el.clientWidth - head);
      place();
    };
    resize();
    el.addEventListener("scroll", place, { passive: true });
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", place);
      ro.disconnect();
    };
  }, [scroller, head, total]);
  if (!(duration > 0 && duration * pps > viewW + 4)) return null;
  const at = (t: number) => `${((t * pps) / total) * 100}%`;
  const span = (a: number, b: number) => `${(((b - a) * pps) / total) * 100}%`;
  return (
    <div
      className="ve-overview"
      onPointerDown={(e) => {
        const el = scroller.current;
        if (!el || e.button !== 0) return;
        e.preventDefault();
        const strip = e.currentTarget.querySelector(".ve-overview-track")!.getBoundingClientRect();
        const jump = (clientX: number) => {
          const f = Math.min(1, Math.max(0, (clientX - strip.left) / strip.width));
          el.scrollLeft = f * total - (el.clientWidth - head) / 2;
        };
        jump(e.clientX);
        const move = (ev: PointerEvent) => jump(ev.clientX);
        const up = () => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
      }}
      aria-hidden="true"
    >
      <div className="ve-overview-track">
        {project.clips.map((c) => (
          <span key={c.id} className="ve-ov-clip ve-ov-video" style={{ left: at(c.start), width: span(c.start, clipEnd(c)), ...(labelColor(c.label) ? { background: labelColor(c.label) } : {}) }} />
        ))}
        {project.audio.map((c) => (
          <span key={c.id} className="ve-ov-clip ve-ov-audio" style={{ left: at(c.start), width: span(c.start, clipEnd(c)), ...(labelColor(c.label) ? { background: labelColor(c.label) } : {}) }} />
        ))}
        {(project.markers || []).map((m) => (
          <span key={m.id} className="ve-ov-marker" style={{ left: at(m.time) }} />
        ))}
        <span className="ve-ov-playhead" style={{ left: at(playhead) }} />
        <span className="ve-ov-window" ref={windowRef} />
      </div>
    </div>
  );
}

export function Timeline({ snapping, onToggleSnap, onCollapse, onDetails }: { snapping: boolean; onToggleSnap: () => void; onCollapse?: () => void; onDetails?: () => void }) {
  const project = useVibe((s) => s.project);
  const selection = useVibe((s) => s.selection);
  const pps = useVibe((s) => s.pxPerSec);
  const canUndo = useVibe((s) => s.past.length > 0);
  const canRedo = useVibe((s) => s.future.length > 0);
  const scroller = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  // The clip (or "lanes") a finger landed on, so a tap can select without a drag.
  const touchTap = useRef<string | null>(null);
  const hoverLine = useRef<HTMLDivElement>(null);
  const hoverChip = useRef<HTMLSpanElement>(null);
  const drag = useRef<Drag | null>(null);
  const [scrubbing, setScrubbing] = useState(false);
  const [guide, setGuide] = useState<number | null>(null);
  const [marquee, setMarquee] = useState<Marquee | null>(null);
  const [readout, setReadout] = useState<Readout | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; label: string; items: MenuEntry[] } | null>(null);
  const [shortcuts, setShortcuts] = useState(false);
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);
  const [density, setDensity] = usePref<Density>(DENSITY_KEY, "standard", ["compact", "standard", "large"]);
  const [skimPref, setSkimPref] = usePref<"on" | "off">(SKIM_KEY, "off", ["on", "off"]);
  const skimming = skimPref === "on";
  const skimFrom = useRef<number | null>(null);
  const magnetic = useVibe((s) => s.magnetic);
  const HEAD = useHeadWidth();
  const narrow = HEAD === HEAD_NARROW;
  const windowH = useWindowHeight();
  const [height, setHeight] = useState(() => {
    try {
      return Number(window.localStorage.getItem(HEIGHT_KEY)) || 0;
    } catch {
      return 0;
    }
  });

  const duration = projectDuration(project);
  const [viewW, setViewW] = useState(900);
  const width = editWidth(duration, pps, viewW);
  const videoTracks = Math.max(1, ...project.clips.map((c) => c.track + 1));
  const audioLanes = Math.max(1, ...project.audio.map((c) => c.lane + 1));
  const selected = new Set(selection);
  const step = rulerStep(pps);
  const markers = project.markers || [];
  const gaps = baseGaps(project);

  // Keep the playhead in view while playing, without re-rendering the tracks.
  useEffect(
    () =>
      vibe.subscribe(() => {
        const el = scroller.current;
        const { playing, playhead } = vibe.get();
        if (!el || !playing) return;
        const x = playhead * pps;
        if (x > el.scrollLeft + el.clientWidth - HEAD - 40 || x < el.scrollLeft) el.scrollLeft = Math.max(0, x - 40);
      }),
    [pps, HEAD],
  );

  // The scroll position, as a CSS variable written straight to the canvas:
  // overlays clip to the track area and clip names stay in view, all without
  // a React render per scroll frame.
  useEffect(() => {
    const el = scroller.current;
    const cv = canvas.current;
    if (!el || !cv) return;
    let lastX = -1;
    let frame = 0;
    const write = () => {
      frame = 0;
      const x = el.scrollLeft;
      if (x === lastX) return;
      lastX = x;
      const overlays = cv.querySelector<HTMLElement>(".ve-overlays");
      if (overlays) overlays.style.clipPath = `inset(0 0 0 ${x + headRef.current}px)`;
      pinLabels(cv, x);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(write);
    };
    write();
    el.addEventListener("scroll", onScroll, { passive: true });
    const ro = new ResizeObserver(() => setViewW(el.clientWidth - headRef.current));
    ro.observe(el);
    repin.current = () => {
      lastX = -1;
      write();
    };
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener("scroll", onScroll);
      ro.disconnect();
    };
  }, []);

  // After any render the clips may have moved: re-pin names and re-clip overlays.
  const repin = useRef<() => void>(() => undefined);
  const headRef = useRef(HEAD);
  headRef.current = HEAD;
  useLayoutEffect(() => repin.current());

  // ⌘/Ctrl + scroll zooms around the pointer.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        // A mouse wheel moves along the edit when there are no more tracks to scroll to.
        if (el.scrollHeight <= el.clientHeight + 1 && Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
          e.preventDefault();
          el.scrollLeft += e.deltaY;
        }
        return;
      }
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

  // Two fingers pinch the timeline's zoom around the point between them.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    let pinch: { dist: number; pps: number; t: number; x: number } | null = null;
    const spread = (e: TouchEvent) => Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    const middle = (e: TouchEvent) => (e.touches[0].clientX + e.touches[1].clientX) / 2 - el.getBoundingClientRect().left - HEAD;
    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      const x = middle(e);
      pinch = { dist: spread(e), pps: vibe.get().pxPerSec, t: (el.scrollLeft + x) / vibe.get().pxPerSec, x };
    };
    const onMove = (e: TouchEvent) => {
      if (!pinch || e.touches.length !== 2) return;
      e.preventDefault();
      const next = Math.min(400, Math.max(6, pinch.pps * (spread(e) / Math.max(1, pinch.dist))));
      const t = pinch.t;
      const x = middle(e);
      vibe.set({ pxPerSec: next });
      requestAnimationFrame(() => {
        el.scrollLeft = Math.max(0, t * next - x);
      });
    };
    const onEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) pinch = null;
    };
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd);
    el.addEventListener("touchcancel", onEnd);
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, [HEAD]);

  const importer = useRef<HTMLInputElement>(null);
  const fit = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    vibe.set({ pxPerSec: Math.min(400, Math.max(6, (el.clientWidth - HEAD - 48) / Math.max(1, projectDuration(vibe.get().project)))) });
    el.scrollLeft = 0;
  }, [HEAD]);

  // Fill the view with the selection (Premiere's zoom to selection).
  const zoomToSelection = useCallback(() => {
    const el = scroller.current;
    const { project: p, selection: sel } = vibe.get();
    const wanted = new Set(sel);
    const spans = [...p.clips, ...p.audio].filter((c) => wanted.has(c.id)).map((c) => [c.start, clipEnd(c)]).concat([...p.texts, ...p.captions.cues].filter((t) => wanted.has(t.id)).map((t) => [t.start, t.end]));
    if (!el || !spans.length) return;
    const a = Math.min(...spans.map((x) => x[0]));
    const b = Math.max(...spans.map((x) => x[1]));
    const next = Math.min(400, Math.max(6, (el.clientWidth - HEAD - 96) / Math.max(0.2, b - a)));
    vibe.set({ pxPerSec: next });
    requestAnimationFrame(() => {
      el.scrollLeft = Math.max(0, a * next - 48);
    });
  }, [HEAD]);

  // Z fits the edit, End goes to the end, ? opens the shortcut sheet.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea, select, [contenteditable=true]")) return;
      if (e.key === "z" && !e.metaKey && !e.ctrlKey && !e.altKey) fit();
      if (e.key === "Z" && e.shiftKey && !e.metaKey && !e.ctrlKey) zoomToSelection();
      if (e.key === "End") vibe.seek(projectDuration(vibe.get().project));
      if (e.key === "?") setShortcuts((v) => !v);
      if (e.key.toLowerCase() === "n" && !e.metaKey && !e.ctrlKey && !e.altKey) onToggleSnap();
      if (e.key === "S" && e.shiftKey && !e.metaKey && !e.ctrlKey) setSkimPref(skimming ? "off" : "on");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fit, zoomToSelection, onToggleSnap, skimming, setSkimPref]);

  // Skimming: while the pointer is over the tracks the playhead follows it, and
  // it goes back where it was when the pointer leaves (unless you clicked).
  const skim = (clientX: number) => {
    if (!skimming || drag.current || vibe.get().playing || scrubbing) return;
    if (skimFrom.current === null) skimFrom.current = vibe.get().playhead;
    vibe.seek(timeAt(clientX));
  };
  const endSkim = () => {
    if (skimFrom.current !== null && !drag.current) vibe.seek(skimFrom.current);
    skimFrom.current = null;
  };
  const keepSkim = () => {
    skimFrom.current = null;
  };

  // Near either edge during a drag, scroll the tracks along with the pointer.
  const edgeScroll = (clientX: number) => {
    const el = scroller.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    const zone = 48;
    if (clientX > box.right - zone) el.scrollLeft += Math.ceil(((clientX - (box.right - zone)) / zone) * 18);
    else if (clientX < box.left + HEAD + zone && el.scrollLeft > 0) el.scrollLeft -= Math.ceil(((box.left + HEAD + zone - clientX) / zone) * 18);
  };

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
    keepSkim();
    vibe.seek(timeAt(e.clientX));
    setScrubbing(true);
    showHover(null);
    const move = (ev: PointerEvent) => {
      const t = timeAt(ev.clientX);
      vibe.seek(t);
      setReadout({ x: ev.clientX, y: ev.clientY, text: formatTimecode(t) });
    };
    const up = () => {
      setScrubbing(false);
      setReadout(null);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
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
    const key = gestureKey(`marker:${id}`);
    let moved = false;
    const move = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientX - x0) < 3) return;
      moved = true;
      const t = Math.max(0, time + (ev.clientX - x0) / pps);
      vibe.commit((p) => updateMarker(p, id, { time: t }), key);
      setReadout({ x: ev.clientX, y: ev.clientY, text: formatTimecode(t) });
    };
    const up = () => {
      if (!moved) vibe.seek(time);
      setReadout(null);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  const commitRename = () => {
    if (!renaming) return;
    vibe.commit((p) => updateMarker(p, renaming.id, { label: renaming.value }));
    setRenaming(null);
  };

  const onResizeDown = (e: ReactPointerEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect().height;
    let last = startH;
    const move = (ev: PointerEvent) => {
      last = Math.min(maxTimelineHeight(window.innerHeight), Math.max(170, startH + (startY - ev.clientY)));
      setHeight(last);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      try {
        window.localStorage.setItem(HEIGHT_KEY, String(Math.round(last)));
      } catch {
        // Preference only.
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  const rowAt = (clientX: number, clientY: number, kind: TrackKind): number | undefined => {
    const hit = document.elementsFromPoint(clientX, clientY).find((el) => (el as HTMLElement).dataset?.rowKind === kind) as HTMLElement | undefined;
    return hit ? Number(hit.dataset.rowIndex) : undefined;
  };

  // ---------- Clips: move, trim, group move ----------
  const onItemDown = (e: ReactPointerEvent, id: string, kind: TrackKind, mode: Drag["mode"], start: number, end: number, inPoint: number) => {
    if (e.button !== 0) return;
    // Touch: a finger on a clip that isn't selected scrolls the timeline; a tap selects it
    // (onClick), and only a selected clip drags or trims, so swiping never moves clips.
    if (e.pointerType === "touch" && !selected.has(id)) {
      touchTap.current = id;
      return;
    }
    e.stopPropagation();
    e.preventDefault();
    keepSkim();
    let nextSelection = selection;
    if (e.shiftKey || e.metaKey) nextSelection = selected.has(id) ? selection.filter((s) => s !== id) : [...selection, id];
    else if (!selected.has(id)) nextSelection = [id];
    if (nextSelection !== selection) vibe.select(nextSelection);
    if (isLocked(vibe.get().project, id) || !nextSelection.includes(id)) return;
    const group = mode === "move" && nextSelection.length > 1 ? nextSelection : [];
    drag.current = { id, mode, kind, x0: e.clientX, y0: e.clientY, base: vibe.get().project, start, end, inPoint, moved: false, group, scroll0: scroller.current?.scrollLeft || 0, key: gestureKey(`drag:${id}`) };
    const baseClip = kind === "video" ? vibe.get().project.clips.find((c) => c.id === id) : undefined;
    const ripples = vibe.get().magnetic && baseClip?.track === 0;
    const move = (ev: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      if (!d.moved && Math.hypot(ev.clientX - d.x0, ev.clientY - d.y0) < 3) return;
      d.moved = true;
      edgeScroll(ev.clientX);
      const dt = (ev.clientX - d.x0 + ((scroller.current?.scrollLeft || 0) - d.scroll0)) / pps;
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
          let row = d.kind === "video" || d.kind === "audio" ? rowAt(ev.clientX, ev.clientY, d.kind) : undefined;
          // Past the top video track or the last audio lane makes a new one (CapCut).
          let fresh = false;
          if (row === undefined && (d.kind === "video" || d.kind === "audio")) {
            const p = d.base;
            const top = d.kind === "video" ? Math.max(1, ...p.clips.map((c) => c.track + 1)) : Math.max(1, ...p.audio.map((c) => c.lane + 1));
            const edge = canvas.current?.querySelector<HTMLElement>(`[data-row-kind="${d.kind}"][data-row-index="${top - 1}"]`)?.getBoundingClientRect();
            if (edge && (d.kind === "video" ? ev.clientY < edge.top : ev.clientY > edge.bottom)) {
              row = top;
              fresh = true;
            }
          }
          const targetKey = row !== undefined ? trackKey(d.kind, row) : null;
          next = moveItem(d.base, d.id, s, targetKey && trackState(d.base, targetKey).locked ? undefined : row);
          text = `${formatTime(s, true)} · ${signed(s - d.start)}${fresh ? " · new track" : ""}`;
        }
      } else if (ripples && d.mode === "trim-start") {
        next = rippleTrim(d.base, d.id, "start", dt);
        const c = next.clips.find((x) => x.id === d.id)!;
        text = `${(c.out - c.in).toFixed(1)}s long · closes up ${signed(-(c.in - d.inPoint))}`;
      } else if (ripples && d.mode === "trim-end") {
        const e2 = snap(Math.max(d.start + 0.1, d.end + dt));
        next = rippleTrim(d.base, d.id, "end", e2 - d.end);
        const c = next.clips.find((x) => x.id === d.id)!;
        text = `${(c.out - c.in).toFixed(1)}s long · ${signed(c.out - c.in - (d.end - d.start))}`;
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
      vibe.commit(next, d.key);
    };
    const up = (ev?: Event) => {
      const d = drag.current;
      const key = d?.key || "";
      if (d?.moved) {
        // A cancelled gesture (or Escape) puts everything back where it was;
        // a finished move closes up any emptied track. Both join the drag's undo step.
        if (ev?.type === "pointercancel" || ev?.type === "keydown") vibe.commit(d.base, key, { fold: true });
        else if (d.mode === "move") vibe.commit((p) => compactTracks(p), key, { fold: true });
      }
      drag.current = null;
      setGuide(null);
      setReadout(null);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      window.removeEventListener("keydown", escape, true);
    };
    const escape = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      ev.preventDefault();
      ev.stopPropagation();
      up(ev);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    window.addEventListener("keydown", escape, true);
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
    const key = gestureKey(`env:${clip.id}:${part}`);
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
      window.removeEventListener("pointercancel", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
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
    if (e.pointerType === "touch") {
      touchTap.current = "lanes";
      return;
    }
    e.preventDefault();
    keepSkim();
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
      edgeScroll(ev.clientX);
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
      window.removeEventListener("pointercancel", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  // ---------- Commands shared by the toolbar, menus, and keys ----------
  const ripple = () => vibe.commit((p) => rippleDeleteItems(p, vibe.get().selection));
  const remove = (ids = vibe.get().selection) =>
    vibe.commit((p) => compactTracks(vibe.get().magnetic ? rippleDeleteItems(p, ids) : deleteItems(p, ids.filter((x) => !isLocked(p, x)))));
  const duplicate = () => {
    const { project: next, ids } = duplicateItems(vibe.get().project, vibe.get().selection);
    if (!ids.length) return;
    vibe.commit(next);
    vibe.select(ids);
  };
  const trimTo = (side: "start" | "end") => vibe.commit((p) => trimToTime(p, vibe.get().selection, vibe.get().playhead, side));

  const itemMenu = (e: Pick<ReactMouseEvent, "clientX" | "clientY" | "preventDefault" | "stopPropagation">, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    const sel = selected.has(id) ? selection : [id];
    if (!selected.has(id)) vibe.select([id]);
    const key = itemTrack(project, id);
    const locked = Boolean(key && trackState(project, key).locked);
    const under = underPlayhead(project, vibe.get().playhead, sel);
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
        {
          swatches: CLIP_LABELS,
          current: [...project.clips, ...project.audio, ...project.texts].find((x) => x.id === id)?.label,
          onPick: (l) => vibe.commit((p) => setLabel(p, sel, l)),
        },
        "sep",
        { label: locked ? "Unlock track" : "Lock track", icon: locked ? <Unlock size={14} /> : <Lock size={14} />, disabled: !key, onSelect: () => key && vibe.commit((p) => setTrackState(p, key, { locked: !locked })) },
        "sep",
        magnetic
          ? { label: "Delete, leave the gap", icon: <Trash2 size={14} />, disabled: locked, onSelect: () => vibe.commit((p) => deleteItems(p, sel.filter((x) => !isLocked(p, x)))) }
          : { label: "Delete and close gap", icon: <FoldHorizontal size={14} />, keys: "⇧⌫", disabled: locked, onSelect: ripple },
        { label: magnetic ? "Delete and close gap" : "Delete", icon: magnetic ? <FoldHorizontal size={14} /> : <Trash2 size={14} />, keys: "⌫", danger: true, disabled: locked, onSelect: () => remove(sel) },
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

  const item = (o: { id: string; kind: TrackKind; start: number; end: number; inPoint: number; label: string; icon: ReactNode; tone: string; body?: ReactNode; title?: string; locked: boolean; dim: boolean; color?: string }) => {
    const w = Math.max(4, (o.end - o.start) * pps);
    const len = o.end - o.start;
    const tint = labelColor(o.color);
    return (
      <div
        key={o.id}
        data-item-id={o.id}
        className={`ve-item ve-item-${o.tone}${selected.has(o.id) ? " is-selected" : ""}${o.locked ? " is-locked" : ""}${o.dim ? " is-dim" : ""}${w < 44 ? " is-tiny" : ""}${tint ? " has-label" : ""}`}
        data-x={o.start * pps}
        data-w={w}
        style={{ left: o.start * pps, width: w > 10 ? w - 2 : w, ...(tint ? { ["--ve-label" as string]: tint } : {}) }}
        onPointerDown={(e) => onItemDown(e, o.id, o.kind, "move", o.start, o.end, o.inPoint)}
        onClick={() => {
          if (touchTap.current !== o.id) return;
          touchTap.current = null;
          vibe.select([o.id]);
        }}
        onContextMenu={(e) => itemMenu(e, o.id)}
        tabIndex={0}
        role="button"
        aria-pressed={selected.has(o.id)}
        aria-label={`${o.label}, ${formatTime(o.start, true)} to ${formatTime(o.end, true)}${o.locked ? ", locked" : ""}`}
        onKeyDown={(e) => {
          // Enter selects (Shift adds); the menu key or Shift+F10 opens the clip menu.
          if (e.key === "Enter") {
            e.preventDefault();
            vibe.select(e.shiftKey ? (selected.has(o.id) ? selection.filter((x) => x !== o.id) : [...selection, o.id]) : [o.id]);
          } else if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
            const box = e.currentTarget.getBoundingClientRect();
            itemMenu({ clientX: box.left + Math.min(box.width / 2, 120), clientY: box.top + box.height / 2, preventDefault: () => e.preventDefault(), stopPropagation: () => e.stopPropagation() }, o.id);
          }
        }}
        title={o.title || `${o.label} · ${formatTime(o.start, true)}–${formatTime(o.end, true)}`}
      >
        {o.body}
        <span className="ve-item-label">
          <span className="ve-item-title">
            {o.icon}
            <span className="ve-item-name">{o.label}</span>
          </span>
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

  const st = (key: string) => trackState(project, key);
  const anyUnlocked = selection.some((id) => !isLocked(project, id));
  // 100% is the zoom that fits the whole edit in view.
  const fitPps = (scroller.current ? scroller.current.clientWidth - HEAD - 48 : 900) / Math.max(1, duration);
  const zoomPct = Math.max(1, Math.round((pps / Math.max(1, fitPps)) * 100));
  const videoH = (DENSITIES.find((d) => d.id === density) || DENSITIES[1]).video;
  const style: CSSProperties = { ...(height ? { height: Math.min(height, maxTimelineHeight(windowH)) } : {}), ["--ve-head" as string]: `${HEAD}px` };

  // What the middle of the toolbar reports: the selection, or the edit.
  const selSpans = [
    ...project.clips.filter((c) => selected.has(c.id)).map((c) => [c.start, clipEnd(c)]),
    ...project.audio.filter((c) => selected.has(c.id)).map((c) => [c.start, clipEnd(c)]),
    ...project.texts.filter((t) => selected.has(t.id)).map((t) => [t.start, t.end]),
    ...project.captions.cues.filter((c) => selected.has(c.id)).map((c) => [c.start, c.end]),
  ];
  const status = selSpans.length
    ? `${selSpans.length} selected · ${(Math.max(...selSpans.map((s) => s[1])) - Math.min(...selSpans.map((s) => s[0]))).toFixed(1)}s`
    : `${project.clips.length + project.audio.length} ${project.clips.length + project.audio.length === 1 ? "clip" : "clips"}${markers.length ? ` · ${markers.length} ${markers.length === 1 ? "marker" : "markers"}` : ""}${gaps.length ? ` · ${gaps.length} ${gaps.length === 1 ? "gap" : "gaps"}` : ""}`;

  return (
    <section className="ve-timeline" aria-label="Timeline" style={style} data-density={density}>
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
          <SplitButton />
          <button type="button" className="ve-tool" onClick={duplicate} disabled={!selection.length} aria-label="Duplicate" title="Duplicate (⌘D)">
            <Copy size={16} />
          </button>
          <button
            type="button"
            className="ve-tool"
            onClick={() => remove()}
            disabled={!anyUnlocked}
            aria-label={magnetic ? "Delete and close the gap" : "Delete selected"}
            title={magnetic ? "Delete and close the gap (⌫). Turn off the magnetic main track to leave gaps." : "Delete (⌫)"}
          >
            <Trash2 size={16} />
          </button>
          <button type="button" className="ve-tool" onClick={() => vibe.commit((p) => toggleMarker(p, vibe.get().playhead))} aria-label="Add or remove a marker at the playhead" title="Marker (M)">
            <BookmarkPlus size={16} />
          </button>
          {onDetails && selection.length === 1 ? (
            // Phones: selecting doesn't cover the editor with the details panel; this opens it.
            <button type="button" className="ve-tool ve-tl-details" onClick={onDetails} aria-label="Clip details" title="Clip details">
              <SlidersHorizontal size={16} />
            </button>
          ) : null}
        </div>
        <p className="ve-tl-status" aria-live="polite">
          {status}
        </p>
        <div className="ve-tl-group ve-zoom">
          <div className="ve-modes" role="group" aria-label="Editing modes">
            <button type="button" className={`ve-mode${magnetic ? " is-on" : ""}`} onClick={() => vibe.setMagnetic(!magnetic)} aria-pressed={magnetic} title="Magnetic main track: deletes and trims on Video 1 close up the gap">
              <FoldHorizontal size={15} />
              <span>Magnetic</span>
            </button>
            <button type="button" className={`ve-mode${snapping ? " is-on" : ""}`} onClick={onToggleSnap} aria-pressed={snapping} title="Snap to edges, markers, and the playhead (N)">
              <Magnet size={15} />
              <span>Snap</span>
            </button>
            <button type="button" className={`ve-mode${skimming ? " is-on" : ""}`} onClick={() => setSkimPref(skimming ? "off" : "on")} aria-pressed={skimming} title="Skimming: the preview follows the pointer over the tracks (⇧S)">
              <ScanLine size={15} />
              <span>Skim</span>
            </button>
          </div>
          <span className="ve-tl-sep" />
          <button type="button" className="ve-tool" onClick={fit} disabled={duration <= 0} aria-label="Fit the edit" title="Fit the edit (Z)">
            <UnfoldHorizontal size={16} strokeWidth={1.75} />
          </button>
          <input className="ve-zoom-range" type="range" min={Math.log(6)} max={Math.log(400)} step={0.01} value={Math.log(pps)} onChange={(e) => vibe.set({ pxPerSec: Math.round(Math.exp(Number(e.target.value)) * 10) / 10 })} aria-label="Timeline zoom" aria-valuetext={`${zoomPct}%`} title="Zoom (⌘ scroll)" />
          <output className="ve-zoom-pct" title="Zoom, where 100% fits the whole edit">{duration > 0 ? `${zoomPct}%` : "–"}</output>
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

      <div className="ve-tl-scroll" ref={scroller} onPointerMove={(e) => (e.target as HTMLElement).closest(".ve-ruler, .ve-row-head") ? undefined : skim(e.clientX)} onPointerLeave={endSkim}>
        <div className="ve-tl-canvas" ref={canvas} style={{ width: width + HEAD, minWidth: "100%" }} onContextMenu={laneMenu}>
          <div className="ve-ruler" onPointerDown={onRulerDown} onPointerMove={(e) => showHover(scrubbing ? null : e.clientX)} onPointerLeave={() => showHover(null)}>
            <div className="ve-ruler-corner" onPointerDown={(e) => e.stopPropagation()}>
              {narrow ? (
                <button
                  type="button"
                  className="ve-density-one"
                  onClick={() => setDensity(DENSITIES[(DENSITIES.findIndex((d) => d.id === density) + 1) % DENSITIES.length].id)}
                  aria-label={`Track height: ${DENSITIES.find((d) => d.id === density)?.name}. Change`}
                  title="Track height"
                >
                  <DensityIcon level={DENSITIES.findIndex((d) => d.id === density)} />
                </button>
              ) : (
                <div className="ve-density" role="radiogroup" aria-label="Track height">
                  {DENSITIES.map((d, i) => (
                    <button key={d.id} type="button" role="radio" aria-checked={density === d.id} className={density === d.id ? "is-on" : ""} onClick={() => setDensity(d.id)} aria-label={d.name} title={d.name}>
                      <DensityIcon level={i} />
                    </button>
                  ))}
                </div>
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
            <RulerHead head={HEAD} pps={pps} active={scrubbing} />
          </div>

          <div
            className="ve-rows"
            onPointerDown={onLanesDown}
            onClick={(e) => {
              const target = e.target as HTMLElement;
              if (touchTap.current !== "lanes" || !(target.classList.contains("ve-lane") || target.classList.contains("ve-rows"))) return;
              touchTap.current = null;
              vibe.select([]);
            }}
          >
            <div className="ve-row ve-row-thin">
              <TrackHead label="Titles" icon={<Type size={13} />} kind="text" row={0} project={project} narrow={narrow} />
              <div className={`ve-lane${st("text").locked ? " is-locked" : ""}`} data-row-kind="text" data-row-index={0}>
                {project.texts.map((t) => item({ id: t.id, kind: "text", start: t.start, end: t.end, inPoint: 0, label: t.text || "Title", icon: <Type size={11} />, tone: "text", locked: Boolean(st("text").locked), dim: Boolean(st("text").hidden), color: t.label }))}
              </div>
            </div>
            {Array.from({ length: videoTracks }, (_, k) => videoTracks - 1 - k).map((track) => {
              const key = trackKey("video", track);
              return (
                <div className={`ve-row ve-row-video${track === 0 ? " ve-row-main" : ""}${track === 0 && magnetic ? " is-magnetic" : ""}`} key={key}>
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
                          color: c.label,
                          locked: Boolean(st(key).locked),
                          dim: Boolean(st(key).hidden),
                          body: a ? <Strip asset={a} inPoint={c.in} width={(c.out - c.in) * pps} height={videoH - 8} pps={pps} /> : null,
                        });
                      })}
                    {st(key).locked ? null : (
                      <button type="button" className="ve-lane-add" style={{ left: project.clips.filter((c) => c.track === track).reduce((end, c) => Math.max(end, clipEnd(c)), 0) * pps + 10 }} onClick={() => importer.current?.click()} aria-label="Add clips" title="Add videos or photos">
                        <Plus size={15} strokeWidth={1.75} />
                      </button>
                    )}
                    {track === 0 && !project.clips.length && !project.audio.length && !project.texts.length ? <span className="ve-lane-hint">Drop videos, photos, or music anywhere to start, or press + to browse.</span> : null}
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
                <div className={`ve-row ve-row-audio${lane === 0 ? " ve-row-first-audio" : ""}`} key={key}>
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
                          color: c.label,
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

          <div className="ve-overlays" aria-hidden="true">
          {markers.map((m) => (
            <div key={`line-${m.id}`} className="ve-marker-line" style={{ left: HEAD + m.time * pps }} />
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
          <PlayheadLine head={HEAD} pps={pps} active={scrubbing} />
          </div>
        </div>
      </div>
      <Overview scroller={scroller} head={HEAD} pps={pps} project={project} duration={duration} total={width} />
      {readout ? (
        <div className="ve-readout" style={{ left: readout.x, top: readout.y }} aria-hidden="true">
          {readout.text}
        </div>
      ) : null}
      {menu ? <ContextMenu x={menu.x} y={menu.y} label={menu.label} items={menu.items} onClose={() => setMenu(null)} /> : null}
    </section>
  );
}
