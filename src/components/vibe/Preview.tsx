// The preview stage: stacked <video>/<img> layers per track, hidden <audio>
// per soundtrack clip, and the caption/title canvas on top. One clock (the
// store's playhead, advanced by requestAnimationFrame) drives every element;
// elements are nudged back into sync when they drift.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Grid3x3 } from "lucide-react";
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
  const stage = useRef<HTMLDivElement>(null);
  const { w, h } = frameSize(project.aspect);

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
    for (const c of clips) {
      const a = assetById(p, c.assetId);
      if (a?.kind !== "video") continue;
      const off = c.muted || trackState(p, `v${c.track}`).muted || trackState(p, `v${c.track}`).hidden;
      sync(c.id, c.start, c.in, clipEnd(c), off ? 0 : c.volume ?? 1, false, c.preset);
    }
    for (const c of audio) sync(c.id, c.start, c.in, clipEnd(c), laneOn(c.lane) ? c.volume : 0, c.duck !== undefined, c.preset);
  }, [playhead, playing, clips, audio, project]);

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
    <div className="ve-viewer">
    <div className="ve-stage-wrap" onPointerDown={(e) => e.target === e.currentTarget && vibe.select([])}>
      <div ref={stage} className="ve-stage" style={{ aspectRatio: `${w} / ${h}`, background: project.background }} data-aspect={project.aspect}>
        {clips.map((c, i) => {
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
            <img key={c.id} className="ve-layer" src={a.url} alt="" style={style} draggable={false} />
          ) : (
            <video
              key={c.id}
              className="ve-layer"
              src={a.url}
              style={style}
              preload="auto"
              playsInline
              crossOrigin="anonymous"
              ref={(el) => {
                if (el) media.current.set(c.id, el);
                else media.current.delete(c.id);
              }}
              onLoadedMetadata={(e) => {
                e.currentTarget.currentTime = c.in + Math.max(0, vibe.get().playhead - c.start);
              }}
            />
          );
        })}
        {audio.map((c) => {
          const a = assetById(project, c.assetId);
          return a ? (
            <audio
              key={c.id}
              src={a.url}
              preload="auto"
              crossOrigin="anonymous"
              ref={(el) => {
                if (el) media.current.set(c.id, el);
                else media.current.delete(c.id);
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
        <span className="ve-viewer-tc">{formatTimecode(playhead)}</span>
        <button type="button" className={`ve-tool${guides ? " is-on" : ""}`} onClick={toggleGuides} aria-pressed={guides} aria-label="Safe zones and thirds" title="Safe zones and thirds">
          <Grid3x3 size={15} />
        </button>
      </div>
    </div>
  );
}
