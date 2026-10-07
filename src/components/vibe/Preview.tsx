// The preview stage: stacked <video>/<img> layers per track, hidden <audio>
// per soundtrack clip, and the caption/title canvas on top. One clock (the
// store's playhead, advanced by requestAnimationFrame) drives every element;
// elements are nudged back into sync when they drift.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Grid3x3, Maximize2, Minimize2, Pause, Play } from "lucide-react";
import { assetById, clipEnd, formatTimecode, frameSize, projectDuration, trackState, updateItem, VIBE_ASPECTS, type VibeProject } from "../../utils/vibeEdit";
import { gradeFilter } from "../../utils/vibeAutoEdit";
import { buildSoundChain } from "../../utils/vibeSound.js";
import { drawOverlay, textBox } from "./overlay";
import { useVibe, vibe } from "./store";

const LOOKAHEAD = 2;

interface Route {
  ctx: AudioContext;
  gain: GainNode;
  preset: string;
}
let audioCtx: AudioContext | null = null;
const routes = new WeakMap<HTMLMediaElement, Route>();

function route(el: HTMLMediaElement, preset: string | undefined): Route | null {
  try {
    audioCtx ??= new AudioContext();
    let r = routes.get(el);
    if (r && r.preset === (preset || "")) return r;
    const source = (el as HTMLMediaElement & { __src?: MediaElementAudioSourceNode }).__src ?? audioCtx.createMediaElementSource(el);
    (el as HTMLMediaElement & { __src?: MediaElementAudioSourceNode }).__src = source;
    source.disconnect();
    r?.gain.disconnect();
    const gain = audioCtx.createGain();
    const chain = buildSoundChain(audioCtx, preset);
    if (chain) {
      source.connect(chain.input);
      chain.output.connect(gain);
    } else source.connect(gain);
    gain.connect(audioCtx.destination);
    r = { ctx: audioCtx, gain, preset: preset || "" };
    routes.set(el, r);
    return r;
  } catch {
    return null;
  }
}

/**
 * Clips of one file that keep it in step with the timeline (same track or lane, the same offset between
 * timeline and file, at most a second apart, the same look and sound) form a chain that shares one media
 * element, which plays straight through the gaps between them. A recap is hundreds of 3-second cuts of one
 * 400 MB picture file and a hundred narration lines of one audio file: a fresh element per clip had to
 * reopen and seek the file every few seconds, so cuts showed black and lines started late or silent.
 */
type Chainable = { id: string; assetId: string; start: number; in: number; out: number; speed?: number; preset?: string; muted?: boolean; volume?: number };
const MAX_CHAIN_GAP = 1;
function chainBy<T extends Chainable>(items: T[], lane: (c: T) => number, sameLook: (a: T, b: T) => boolean, maxGap = MAX_CHAIN_GAP) {
  const chain = new Map<string, string>();
  const sorted = [...items].sort((a, b) => lane(a) - lane(b) || a.start - b.start);
  let prev: T | null = null;
  for (const c of sorted) {
    const gap = prev ? c.start - clipEnd(prev as never) : Infinity;
    const continues =
      prev !== null &&
      lane(prev) === lane(c) &&
      prev.assetId === c.assetId &&
      (prev.speed || 1) === 1 &&
      (c.speed || 1) === 1 &&
      Math.abs(prev.start - prev.in - (c.start - c.in)) < 1e-3 &&
      gap > -1e-3 &&
      gap <= maxGap &&
      (prev.preset || "") === (c.preset || "") &&
      Boolean(prev.muted) === Boolean(c.muted) &&
      (prev.volume ?? 1) === (c.volume ?? 1) &&
      sameLook(prev, c);
    chain.set(c.id, continues && prev ? chain.get(prev.id)! : c.id);
    prev = c;
  }
  return chain;
}
export function clipChains(project: VibeProject) {
  return chainBy(project.clips, (c) => c.track, (a, b) => a.fit === b.fit && (a.zoom || 1) === (b.zoom || 1) && JSON.stringify(a.grade || null) === JSON.stringify(b.grade || null));
}
// Audio chains bridge any gap: one element plays a narration file straight through, silenced between
// lines, instead of a new element reloading the file (and starting late or not at all) after each pause.
export function audioChains(project: VibeProject) {
  return chainBy(project.audio, (c) => c.lane, () => true, Infinity);
}

/** One entry per chain of visible items: the item at the playhead (or the next), and when the element
 *  should play, which runs across a gap inside the chain. */
function groupByChain<T extends Chainable>(items: T[], chains: Map<string, string>, playhead: number) {
  const out = new Map<string, { key: string; items: T[]; index: number }>();
  items.forEach((c, index) => {
    const key = chains.get(c.id) || c.id;
    const group = out.get(key);
    if (group) group.items.push(c);
    else out.set(key, { key, items: [c], index });
  });
  return [...out.values()].map(({ key, items: list, index }) => {
    const sorted = [...list].sort((a, b) => a.start - b.start);
    const on = sorted.find((c) => playhead >= c.start - 1e-4 && playhead < clipEnd(c as never));
    const before = [...sorted].reverse().find((c) => clipEnd(c as never) <= playhead);
    const next = sorted.find((c) => c.start > playhead);
    // Between two clips of the chain: keep playing the earlier clip's mapping until the next begins.
    if (!on && before && next) return { key, index, current: before, end: next.start, gap: true };
    const current = on || next || sorted[sorted.length - 1];
    return { key, index, current, end: clipEnd(current as never), gap: false };
  });
}

function useVisibleItems(project: VibeProject, playhead: number) {
  // Re-evaluate the mounted set only when the playhead crosses a second, so
  // elements are not created and torn down every frame.
  const bucket = Math.floor(playhead);
  return useMemo(() => {
    const near = (start: number, end: number) => end > bucket - 1 && start < bucket + LOOKAHEAD + 1;
    return {
      clips: project.clips.filter((c) => near(c.start, clipEnd(c))).sort((a, b) => a.track - b.track || a.start - b.start),
      audio: project.audio.filter((c) => near(c.start, clipEnd(c))),
    };
  }, [project.clips, project.audio, bucket]);
}

export function Preview() {
  const project = useVibe((s) => s.project);
  const playhead = useVibe((s) => s.playhead);
  const playing = useVibe((s) => s.playing);
  const { clips, audio } = useVisibleItems(project, playhead);
  const chains = useMemo(() => clipChains(project), [project]);
  const soundChains = useMemo(() => audioChains(project), [project]);
  const groups = useMemo(() => groupByChain(clips, chains, playhead), [clips, chains, playhead]);
  const soundGroups = useMemo(() => groupByChain(audio, soundChains, playhead), [audio, soundChains, playhead]);
  const selection = useVibe((s) => s.selection);
  const [guides, setGuides] = useState(() => {
    try {
      return window.localStorage.getItem("vibe-edit-guides") === "1";
    } catch {
      return false;
    }
  });
  const [stageW, setStageW] = useState(0);
  const media = useRef(new Map<string, HTMLMediaElement>());
  const canvas = useRef<HTMLCanvasElement>(null);
  const viewer = useRef<HTMLDivElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === viewer.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);
  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void viewer.current?.requestFullscreen?.().catch(() => {});
  };
  const stage = useRef<HTMLDivElement>(null);
  const { w, h } = frameSize(project.aspect);

  // Browsers (Safari and the iOS app above all) only let sound start from a click or key press, and every
  // clip's sound runs through one AudioContext: create and wake it inside the gesture, or it stays silent.
  useEffect(() => {
    const unlock = () => {
      try {
        audioCtx ??= new AudioContext();
        if (audioCtx.state !== "running") void audioCtx.resume();
      } catch {}
    };
    window.addEventListener("pointerdown", unlock, true);
    window.addEventListener("keydown", unlock, true);
    return () => {
      window.removeEventListener("pointerdown", unlock, true);
      window.removeEventListener("keydown", unlock, true);
    };
  }, []);

  // Transport clock.
  useEffect(() => {
    if (!playing) return;
    void audioCtx?.resume();
    let raf = 0;
    const startWall = performance.now();
    const startTime = vibe.get().playhead;
    const end = projectDuration(vibe.get().project);
    const tick = () => {
      const t = startTime + (performance.now() - startWall) / 1000;
      if (t >= end) {
        vibe.seek(end);
        vibe.play(false);
        return;
      }
      vibe.seek(t);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  // Sync every mounted element to the playhead.
  useEffect(() => {
    const p = project;
    const laneOn = (lane: number) => !trackState(p, `a${lane}`).muted && !trackState(p, `a${lane}`).hidden;
    const duckActive = p.audio.filter((c) => c.duck !== undefined && laneOn(c.lane) && playhead >= c.start && playhead < clipEnd(c));
    const duck = duckActive.reduce((g, c) => Math.min(g, c.duck ?? 1), 1);
    const sync = (id: string, start: number, inPoint: number, end: number, volume: number, ducks: boolean, preset?: string) => {
      const el = media.current.get(id);
      if (!el) return;
      const active = playhead >= start && playhead < end;
      const local = inPoint + Math.max(0, playhead - start);
      if (!active) {
        if (!el.paused) el.pause();
        // Park upcoming clips on their first frame so they start instantly.
        if (playhead < start && Math.abs(el.currentTime - inPoint) > 0.05 && el.readyState > 0) el.currentTime = inPoint;
        return;
      }
      const gainValue = Math.max(0, volume) * (ducks ? 1 : duck);
      if (playing) {
        const r = route(el, preset);
        if (r?.ctx.state === "suspended") void r.ctx.resume();
        if (r) {
          el.volume = 1;
          r.gain.gain.setTargetAtTime(gainValue, r.ctx.currentTime, 0.04);
        } else el.volume = Math.min(1, gainValue);
        if (Math.abs(el.currentTime - local) > 0.25) el.currentTime = local;
        if (el.paused) void el.play().catch(() => {});
      } else {
        if (!el.paused) el.pause();
        if (Math.abs(el.currentTime - local) > 0.04 && el.readyState > 0) el.currentTime = local;
      }
    };
    for (const group of groups) {
      const c = group.current;
      const a = assetById(p, c.assetId);
      if (a?.kind !== "video") continue;
      const off = c.muted || trackState(p, `v${c.track}`).muted || trackState(p, `v${c.track}`).hidden;
      sync(group.key, c.start, c.in, group.end, off ? 0 : c.volume ?? 1, false, c.preset);
    }
    for (const group of soundGroups) {
      const c = group.current;
      sync(group.key, c.start, c.in, group.end, laneOn(c.lane) && !group.gap ? c.volume : 0, c.duck !== undefined, c.preset);
    }
  }, [playhead, playing, groups, soundGroups, project]);

  // Pause everything when playback stops or the editor unmounts.
  useEffect(() => () => media.current.forEach((el) => el.pause()), []);

  // Track the stage size for the title handles.
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const measure = () => setStageW(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Captions and titles.
  useLayoutEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const box = c.getBoundingClientRect();
    const scale = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(2, Math.round(box.width * scale));
    const height = Math.max(2, Math.round((width * h) / w));
    if (c.width !== width || c.height !== height) {
      c.width = width;
      c.height = height;
    }
    const ctx = c.getContext("2d");
    if (ctx) drawOverlay(ctx, project, playhead);
  });

  const active = (start: number, end: number) => playhead >= start - 1e-4 && playhead < end;
  const empty = !project.clips.length && !project.texts.length && !project.captions.cues.length;
  // Read the live width so handles never lag a layout change.
  const scale = (stage.current?.clientWidth || stageW) / w;
  const titlesOn = !trackState(project, "text").hidden;
  const titlesLocked = Boolean(trackState(project, "text").locked);

  // Drag a title on the preview to place it.
  const onTitleDown = (e: ReactPointerEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    vibe.select([id]);
    if (titlesLocked) return;
    const t = vibe.get().project.texts.find((x) => x.id === id);
    const box = stage.current?.getBoundingClientRect();
    if (!t || !box) return;
    const x0 = e.clientX;
    const y0 = e.clientY;
    const key = `title-drag:${id}:${x0}`;
    const move = (ev: PointerEvent) => {
      const nx = Math.min(0.97, Math.max(0.03, t.x + (ev.clientX - x0) / box.width));
      let ny = Math.min(0.97, Math.max(0.03, t.y + (ev.clientY - y0) / box.height));
      // Settle on the centre lines when close.
      const cx = Math.abs(nx - 0.5) < 0.015 ? 0.5 : nx;
      if (Math.abs(ny - 0.5) < 0.015) ny = 0.5;
      vibe.commit((p) => updateItem(p, id, { x: cx, y: ny }), key);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const toggleGuides = () =>
    setGuides((g) => {
      try {
        window.localStorage.setItem("vibe-edit-guides", g ? "0" : "1");
      } catch {
        // Preference only.
      }
      return !g;
    });

  return (
    <div ref={viewer} className={`ve-viewer${fullscreen ? " is-fullscreen" : ""}`}>
    <div className="ve-stage-wrap" onPointerDown={(e) => e.target === e.currentTarget && vibe.select([])} onDoubleClick={(e) => (e.target as HTMLElement).closest(".ve-handle") || toggleFullscreen()}>
      <div ref={stage} className="ve-stage" style={{ aspectRatio: `${w} / ${h}`, background: project.background }} data-aspect={project.aspect}>
        {groups.map(({ key, current: c, index: i }) => {
          const a = assetById(project, c.assetId);
          if (!a) return null;
          const style = {
            zIndex: 1 + c.track * 100 + i,
            opacity: active(c.start, clipEnd(c)) && !trackState(project, `v${c.track}`).hidden ? 1 : 0,
            objectFit: c.fit === "fill" ? ("cover" as const) : ("contain" as const),
            ...(c.zoom && c.zoom > 1 ? { transform: `scale(${c.zoom})` } : {}),
            ...(c.grade ? { filter: gradeFilter(c.grade) } : {}),
          };
          return a.kind === "image" ? (
            <img key={key} className="ve-layer" src={a.url} alt="" style={style} draggable={false} />
          ) : (
            <video
              key={key}
              className="ve-layer"
              src={a.url}
              style={style}
              preload="auto"
              playsInline
              crossOrigin="anonymous"
              ref={(el) => {
                if (el) media.current.set(key, el);
                else media.current.delete(key);
              }}
              onLoadedMetadata={(e) => {
                e.currentTarget.currentTime = c.in + Math.max(0, vibe.get().playhead - c.start);
              }}
            />
          );
        })}
        {soundGroups.map(({ key, current: c }) => {
          const a = assetById(project, c.assetId);
          return a ? (
            <audio
              key={key}
              src={a.url}
              preload="auto"
              crossOrigin="anonymous"
              ref={(el) => {
                if (el) media.current.set(key, el);
                else media.current.delete(key);
              }}
            />
          ) : null;
        })}
        <canvas ref={canvas} className="ve-overlay" aria-hidden="true" />
        {guides ? (
          <div className="ve-guides" aria-hidden="true">
            <span className="ve-guide-safe" />
            <span className="ve-guide-v" style={{ left: "33.333%" }} />
            <span className="ve-guide-v" style={{ left: "66.666%" }} />
            <span className="ve-guide-h" style={{ top: "33.333%" }} />
            <span className="ve-guide-h" style={{ top: "66.666%" }} />
          </div>
        ) : null}
        {titlesOn && scale > 0
          ? project.texts
              .filter((t) => active(t.start, t.end))
              .map((t) => {
                const b = textBox(t, w, h);
                const on = selection.includes(t.id);
                return (
                  <div
                    key={t.id}
                    className={`ve-handle${on ? " is-on" : ""}${titlesLocked ? " is-locked" : ""}`}
                    style={{ left: `${(b.left / w) * 100}%`, top: `${(b.top / h) * 100}%`, width: `${(b.width / w) * 100}%`, height: `${(b.height / h) * 100}%` }}
                    onPointerDown={(e) => onTitleDown(e, t.id)}
                    title={titlesLocked ? "Titles are locked" : "Drag to move"}
                  >
                    {on ? (
                      <>
                        <i className="tl" />
                        <i className="tr" />
                        <i className="bl" />
                        <i className="br" />
                      </>
                    ) : null}
                  </div>
                );
              })
          : null}
        {empty ? (
          <div className="ve-stage-empty">
            <strong>Your edit plays here</strong>
            <span>Add clips from Media, or tell the assistant what to make.</span>
          </div>
        ) : null}
      </div>
    </div>
      <div className="ve-viewer-bar">
        <span className="ve-viewer-meta">
          {VIBE_ASPECTS.find((a) => a.id === project.aspect)?.label} · {w}×{h} · 30 fps
        </span>
        <span className="ve-viewer-tc">
          {fullscreen ? (
            <button type="button" className="ve-tool" onClick={() => vibe.play(!playing)} aria-label={playing ? "Pause" : "Play"} title={playing ? "Pause (Space)" : "Play (Space)"}>
              {playing ? <Pause size={15} /> : <Play size={15} />}
            </button>
          ) : null}
          {formatTimecode(playhead)}
        </span>
        <span className="ve-viewer-tools">
          <button type="button" className={`ve-tool${guides ? " is-on" : ""}`} onClick={toggleGuides} aria-pressed={guides} aria-label="Safe zones and thirds" title="Safe zones and thirds">
            <Grid3x3 size={15} />
          </button>
          <button type="button" className="ve-tool" onClick={toggleFullscreen} aria-label={fullscreen ? "Exit full screen" : "Full screen"} title={fullscreen ? "Exit full screen (Esc)" : "Full screen (double-click the picture)"}>
            {fullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          </button>
        </span>
      </div>
    </div>
  );
}
