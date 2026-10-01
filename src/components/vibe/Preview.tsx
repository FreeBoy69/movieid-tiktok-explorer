// The preview stage: stacked <video>/<img> layers per track, hidden <audio>
// per soundtrack clip, and the caption/title canvas on top. One clock (the
// store's playhead, advanced by requestAnimationFrame) drives every element;
// elements are nudged back into sync when they drift.
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { assetById, clipEnd, frameSize, projectDuration, type VibeProject } from "../../utils/vibeEdit";
import { buildSoundChain } from "../../utils/vibeSound.js";
import { drawOverlay } from "./overlay";
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
    const duckActive = p.audio.filter((c) => c.duck !== undefined && playhead >= c.start && playhead < clipEnd(c));
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
      sync(c.id, c.start, c.in, clipEnd(c), c.muted ? 0 : c.volume ?? 1, false);
    }
    for (const c of audio) sync(c.id, c.start, c.in, clipEnd(c), c.volume, c.duck !== undefined, c.preset);
  }, [playhead, playing, clips, audio, project]);

  // Pause everything when playback stops or the editor unmounts.
  useEffect(() => () => media.current.forEach((el) => el.pause()), []);

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

  return (
    <div className="ve-stage-wrap">
      <div ref={stage} className="ve-stage" style={{ aspectRatio: `${w} / ${h}`, background: project.background }} data-aspect={project.aspect}>
        {clips.map((c, i) => {
          const a = assetById(project, c.assetId);
          if (!a) return null;
          const style = { zIndex: 1 + c.track * 100 + i, opacity: active(c.start, clipEnd(c)) ? 1 : 0, objectFit: c.fit === "fill" ? ("cover" as const) : ("contain" as const) };
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
        {empty ? (
          <div className="ve-stage-empty">
            <strong>Your edit plays here</strong>
            <span>Add clips from Media, or tell the assistant what to make.</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
