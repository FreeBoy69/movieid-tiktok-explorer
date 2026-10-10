// The preview stage: stacked <video>/<img> layers per track, hidden <audio>
// per soundtrack clip, and the caption/title canvas on top. One clock (the
// store's playhead, advanced by requestAnimationFrame) drives every element;
// elements are nudged back into sync when they drift.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { FastForward, Gauge, Grid3x3, Maximize2, Minimize2, Pause, Play, Repeat, Rewind, SkipBack, SkipForward, Volume1, Volume2, VolumeX } from "lucide-react";
import { assetById, clipEnd, formatTimecode, frameSize, parseTimecode, projectDuration, trackState, updateItem, VIBE_ASPECTS, type VibeProject } from "../../utils/vibeEdit";
import { gradeFilter } from "../../utils/vibeAutoEdit";
import { lookCss, motionTransform, transitionStyle } from "../../utils/videoLooks.js";
import { MotionLayer, setMotionPick, useMotionPick } from "./motionLayer";
import { buildSoundChain } from "../../utils/vibeSound.js";
import { drawOverlay, textBox } from "./overlay";
import { gestureKey, useVibe, vibe } from "./store";

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
  // A camera move or an entrance belongs to its own clip, so those never share a player with the next one.
  return chainBy(project.clips, (c) => c.track, (a, b) => a.fit === b.fit && (a.zoom || 1) === (b.zoom || 1) && JSON.stringify(a.grade || null) === JSON.stringify(b.grade || null) && JSON.stringify(a.look || null) === JSON.stringify(b.look || null) && !a.motion && !b.motion && !b.transition);
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
  const total = useMemo(() => projectDuration(project), [project]);
  const { clips, audio } = useVisibleItems(project, playhead);
  const chains = useMemo(() => clipChains(project), [project]);
  const soundChains = useMemo(() => audioChains(project), [project]);
  const groups = useMemo(() => groupByChain(clips, chains, playhead), [clips, chains, playhead]);
  const soundGroups = useMemo(() => groupByChain(audio, soundChains, playhead), [audio, soundChains, playhead]);
  const selection = useVibe((s) => s.selection);
  // A picked part of a motion graphic belongs to its clip: selecting anything else lets it go.
  const motionPick = useMotionPick();
  useEffect(() => {
    if (motionPick && !selection.includes(motionPick.clipId)) setMotionPick(null);
  }, [selection, motionPick]);
  const [guides, setGuides] = useState(() => {
    try {
      return window.localStorage.getItem("vibe-edit-guides") === "1";
    } catch {
      return false;
    }
  });
  const [stageW, setStageW] = useState(0);
  // The viewer's own playback: speed, loop, and volume (preview only; the export plays at 1x with every level as set).
  const [rate, setRate] = useState(() => readPref("vibe-edit-rate", 1, (v) => [0.25, 0.5, 1, 1.5, 2].includes(v)));
  const [loop, setLoop] = useState(() => readPref("vibe-edit-loop", 0, (v) => v === 0 || v === 1) === 1);
  const [volume, setVolume] = useState(() => readPref("vibe-edit-volume", 1, (v) => v >= 0 && v <= 1));
  const [muted, setMuted] = useState(() => readPref("vibe-edit-muted", 0, (v) => v === 0 || v === 1) === 1);
  useEffect(() => writePref("vibe-edit-rate", rate), [rate]);
  useEffect(() => writePref("vibe-edit-loop", loop ? 1 : 0), [loop]);
  useEffect(() => writePref("vibe-edit-volume", volume), [volume]);
  useEffect(() => writePref("vibe-edit-muted", muted ? 1 : 0), [muted]);
  const master = muted ? 0 : volume;
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
    let startWall = performance.now();
    let startTime = vibe.get().playhead;
    const end = projectDuration(vibe.get().project);
    if (startTime >= end - 0.02) startTime = 0;
    const tick = () => {
      const t = startTime + ((performance.now() - startWall) / 1000) * rate;
      if (t >= end) {
        if (loop && end > 0.1) {
          // Round again from the top.
          startWall = performance.now();
          startTime = 0;
          vibe.seek(0);
          raf = requestAnimationFrame(tick);
          return;
        }
        vibe.seek(end);
        vibe.play(false);
        return;
      }
      vibe.seek(t);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, rate, loop]);

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
      const gainValue = Math.max(0, volume) * (ducks ? 1 : duck) * master;
      if (el.playbackRate !== rate) el.playbackRate = rate;
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
      // A held recap cut shows its first frame for the whole clip.
      if (c.look?.freeze) {
        const el = media.current.get(group.key);
        if (el) {
          if (!el.paused) el.pause();
          if (Math.abs(el.currentTime - c.in) > 0.04 && el.readyState > 0) el.currentTime = c.in;
        }
        continue;
      }
      sync(group.key, c.start, c.in, group.end, off ? 0 : c.volume ?? 1, false, c.preset);
    }
    for (const group of soundGroups) {
      const c = group.current;
      sync(group.key, c.start, c.in, group.end, laneOn(c.lane) && !group.gap ? c.volume : 0, c.duck !== undefined, c.preset);
    }
  }, [playhead, playing, groups, soundGroups, project, master, rate]);

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
    const key = gestureKey(`title-drag:${id}`);
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
      window.removeEventListener("pointercancel", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
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
          // The clip's move, its entrance, its grade, and the project's look, as the render will have them.
          const length = Math.max(0.05, c.out - c.in);
          const local = Math.min(length, Math.max(0, playhead - c.start));
          const first = !project.clips.some((o) => o !== c && o.track === c.track && o.start < c.start - 0.001);
          const entrance = c.transition ? (transitionStyle(c.transition, { local, seconds: length, first }) as { opacity?: number; filter?: string; translate?: string; scale?: string }) : {};
          // A recap cut on the film previews its look: the recap's zoom, mirrored, black and white (the export
          // renders these from the original film).
          const filmZoom = a.film && !c.zoom && project.source?.kind === "recap" ? project.source.zoom : undefined;
          const moved = motionTransform(c.motion, local / length, c.zoom || filmZoom);
          const transform = [moved || (filmZoom && filmZoom > 1 ? `scale(${filmZoom})` : ""), c.look?.flip ? "scaleX(-1)" : ""].filter(Boolean).join(" ");
          const filters = [c.grade ? gradeFilter(c.grade) : "", c.look?.bw ? "grayscale(1)" : "", project.look ? lookCss(project.look) : "", entrance.filter || ""].filter(Boolean).join(" ");
          const shown = active(c.start, clipEnd(c)) && !trackState(project, `v${c.track}`).hidden;
          const style = {
            zIndex: 1 + c.track * 100 + i,
            opacity: shown ? entrance.opacity ?? 1 : 0,
            objectFit: c.fit === "fill" ? ("cover" as const) : ("contain" as const),
            ...(transform ? { transform } : {}),
            ...(entrance.translate ? { translate: entrance.translate } : {}),
            ...(entrance.scale ? { scale: entrance.scale } : {}),
            ...(filters ? { filter: filters } : {}),
          };
          // A motion graphic plays live: click its parts to change them.
          if (a.motion) {
            return <MotionLayer key={key} clip={c} asset={a} local={Math.max(0, playhead - c.start + c.in)} style={style} interactive={shown && !trackState(project, `v${c.track}`).locked} />;
          }
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
      <Scrub playhead={playhead} total={total} markers={project.markers || []} />
      <div className="ve-viewer-bar">
        <span className="ve-viewer-meta">
          {VIBE_ASPECTS.find((a) => a.id === project.aspect)?.label} · {w}×{h} · 30 fps
        </span>
        <span className="ve-viewer-tc">
          <span className="ve-transport" role="group" aria-label="Transport">
            <button type="button" className="ve-tool" onClick={() => vibe.seek(0)} disabled={total <= 0} aria-label="Go to start" title="Go to start (Home)"><SkipBack size={15} /></button>
            <button type="button" className="ve-tool" onClick={() => vibe.seek(Math.max(0, playhead - 5))} disabled={total <= 0} aria-label="Back 5 seconds" title="Back 5 seconds"><Rewind size={15} /></button>
            <button type="button" className="ve-viewer-play" onClick={() => vibe.play(!playing)} disabled={total <= 0} aria-label={playing ? "Pause" : "Play"} title={playing ? "Pause (Space)" : "Play (Space)"}>
              {playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
            </button>
            <button type="button" className="ve-tool" onClick={() => vibe.seek(Math.min(total, playhead + 5))} disabled={total <= 0} aria-label="Forward 5 seconds" title="Forward 5 seconds"><FastForward size={15} /></button>
            <button type="button" className="ve-tool" onClick={() => vibe.seek(total)} disabled={total <= 0} aria-label="Go to end" title="Go to end (End)"><SkipForward size={15} /></button>
          </span>
          <Timecode playhead={playhead} total={total} />
        </span>
        <span className="ve-viewer-tools">
          <button type="button" className={`ve-tool${loop ? " is-on" : ""}`} onClick={() => setLoop((l) => !l)} aria-pressed={loop} aria-label="Loop" title={loop ? "Looping: plays again from the start" : "Loop"}><Repeat size={15} /></button>
          <label className="ve-speed" title="Playback speed (preview only)">
            <Gauge size={14} aria-hidden="true" />
            <select value={rate} onChange={(e) => setRate(Number(e.target.value))} aria-label="Playback speed">
              {[0.25, 0.5, 1, 1.5, 2].map((r) => <option key={r} value={r}>{r}×</option>)}
            </select>
          </label>
          <span className="ve-volume">
            <button type="button" className="ve-tool" onClick={() => setMuted((m) => !m)} aria-label={muted ? "Unmute" : "Mute"} title={muted ? "Unmute" : "Mute"}>
              {muted || volume === 0 ? <VolumeX size={15} /> : volume < 0.5 ? <Volume1 size={15} /> : <Volume2 size={15} />}
            </button>
            <input type="range" min={0} max={1} step={0.01} value={muted ? 0 : volume} onChange={(e) => { setVolume(Number(e.target.value)); setMuted(false); }} aria-label="Preview volume" style={{ "--ve-vol": `${(muted ? 0 : volume) * 100}%` } as CSSProperties} />
          </span>
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

// Viewer preferences kept in this browser.
function readPref(key: string, fallback: number, ok: (v: number) => boolean) {
  try {
    const v = Number(window.localStorage.getItem(key));
    return window.localStorage.getItem(key) !== null && Number.isFinite(v) && ok(v) ? v : fallback;
  } catch {
    return fallback;
  }
}
function writePref(key: string, value: number) {
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    // Preference only.
  }
}

/** The scrub bar: drag to move, hover to see the time there, marker ticks along it. */
function Scrub({ playhead, total, markers }: { playhead: number; total: number; markers: Array<{ id: string; time: number; label?: string }> }) {
  const [hover, setHover] = useState<{ x: number; t: number } | null>(null);
  const pct = (t: number) => `${total > 0 ? Math.min(100, Math.max(0, (t / total) * 100)) : 0}%`;
  return (
    <label
      className="ve-scrub"
      style={{ "--ve-scrub": pct(playhead) } as CSSProperties}
      onPointerMove={(e) => {
        const box = (e.currentTarget.querySelector("input") as HTMLInputElement).getBoundingClientRect();
        const k = Math.min(1, Math.max(0, (e.clientX - box.left) / box.width));
        setHover({ x: e.clientX - e.currentTarget.getBoundingClientRect().left, t: k * total });
      }}
      onPointerLeave={() => setHover(null)}
    >
      <span className="ve-sr">Playhead</span>
      <input type="range" min={0} max={Math.max(total, 0.01)} step={1 / 30} value={Math.min(playhead, total)} onChange={(e) => vibe.seek(Number(e.target.value))} disabled={total <= 0} />
      {markers.map((m) => <i key={m.id} className="ve-scrub-mark" style={{ left: `calc(22px + (100% - 44px) * ${total > 0 ? Math.min(1, m.time / total) : 0})` }} title={m.label || formatTimecode(m.time)} aria-hidden="true" />)}
      {hover && total > 0 ? <span className="ve-scrub-tip" style={{ left: hover.x }} aria-hidden="true">{formatTimecode(hover.t)}</span> : null}
    </label>
  );
}

/** The playhead's timecode; click it to type a time to jump to ("1:23", "83.5", "00:01:23:12"). */
function Timecode({ playhead, total }: { playhead: number; total: number }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const t = parseTimecode(draft);
    if (t !== null) vibe.seek(t);
    setDraft(null);
  };
  return (
    <span className="ve-viewer-time">
      {draft !== null ? (
        <input
          className="ve-timecode-input"
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={(e) => e.currentTarget.select()}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") setDraft(null);
          }}
          aria-label="Go to time"
          placeholder="1:23"
        />
      ) : (
        <button type="button" className="ve-timecode" onClick={() => setDraft(formatTimecode(playhead))} title="Click to type a time to jump to" aria-label={`Playhead at ${formatTimecode(playhead)}. Go to a time`}>
          {formatTimecode(playhead)}
        </button>
      )}
      <small>/ {formatTimecode(total)}</small>
    </span>
  );
}
