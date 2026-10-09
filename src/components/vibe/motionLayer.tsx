// Motion graphics inside Vibe Edit's player. A clip made from a motion graphic (a title, a card, an overlay, a
// Promo, Explainer, or Vibe Motion film) plays as its live HTML in the player, sandboxed, following the playhead.
// Click any part of it to pick it, drag to move it, drag its corner to resize it; the inspector edits its words,
// colour, size, position, and when it's on screen. Edits are kept on the asset and filmed into its video on export
// (src/utils/videoGraphics.js has the edits layer and the bridge the player talks to).
import { type CSSProperties, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ArrowUpLeft, Eye, EyeOff, MousePointer2, RotateCcw } from "lucide-react";
import { motionEditorDocument } from "../../utils/videoGraphics.js";
import type { VibeAsset, VibeClip } from "../../utils/vibeEdit";
import { vibe } from "./store";
import "./motionLayer.css";

type Motion = NonNullable<VibeAsset["motion"]>;
type Edit = { dx?: number; dy?: number; scale?: number; text?: string; color?: string; hidden?: boolean; from?: number; to?: number };

// The same strict policy every motion graphic runs under: no network, inline code only.
const CSP = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; form-action 'none'">`;

// A HyperFrames title loads gsap and its fonts beside it; the sandboxed player can't fetch, so both go inline, and
// its words are handed over the way HyperFrames does.
const inlined = new Map<string, Promise<string>>();
const fetchText = (url: string) => {
  if (!inlined.has(url)) inlined.set(url, fetch(url).then((r) => (r.ok ? r.text() : "")).catch(() => ""));
  return inlined.get(url)!;
};
const fetchDataUrl = (url: string) => {
  if (!inlined.has(url)) {
    inlined.set(url, fetch(url).then((r) => (r.ok ? r.blob() : null)).then((b) => (b ? new Promise<string>((ok) => { const f = new FileReader(); f.onload = () => ok(String(f.result)); f.readAsDataURL(b); }) : "")).catch(() => ""));
  }
  return inlined.get(url)!;
};

/** The graphic as the player runs it: self-contained, scaled to the frame, transparent over lower tracks. */
export async function motionPlayerHtml(motion: Motion, { transparent = true } = {}) {
  let doc = motion.html;
  if (doc.includes('<script src="gsap.min.js"></script>')) {
    const gsap = (await fetchText("/vendor/gsap.min.js")).replace(/<\/script/gi, "<\\/script");
    doc = doc.replace('<script src="gsap.min.js"></script>', `<script>window.__hyperframes={getVariables:function(){return ${JSON.stringify(motion.vars || {}).replace(/</g, "\\u003c")}}}</script><script>${gsap}</script>`);
  }
  for (const name of [...new Set([...doc.matchAll(/url\((?:["']?)fonts\/([^)"']+)/g)].map((m) => m[1]))]) {
    const data = await fetchDataUrl(`/fonts/captions/${name}`);
    if (data) doc = doc.split(`fonts/${name}`).join(data);
  }
  const fit = `<meta name="color-scheme" content="normal"><style>:root{color-scheme:normal}html,body{margin:0;overflow:hidden;${transparent ? "background:transparent!important" : ""}}[data-composition-id]{transform-origin:0 0}</style><script>(function(){function fit(){var r=document.querySelector("[data-composition-id]:not(#stage)");if(!r)return;var w=+r.getAttribute("data-width")||r.offsetWidth,h=+r.getAttribute("data-height")||r.offsetHeight;r.style.transform="scale("+Math.min(innerWidth/w,innerHeight/h)+")"}addEventListener("resize",fit);addEventListener("load",fit);document.addEventListener("DOMContentLoaded",fit)})()</script>`;
  doc = /<head[^>]*>/i.test(doc) ? doc.replace(/<head[^>]*>/i, (tag) => tag + fit) : doc.replace(/<html[^>]*>/i, (tag) => `${tag}<head>${fit}</head>`);
  return motionEditorDocument(doc, motion.edits || {}, CSP);
}

// ---------- The picked element (one at a time, across the player and the inspector) ----------

export type MotionPick = { clipId: string; assetId: string; path: string; tag: string; isText: boolean; text: string; color: string; label: string; hasParent: boolean } | null;
let picked: MotionPick = null;
const listeners = new Set<() => void>();
export function setMotionPick(next: MotionPick) {
  picked = next;
  listeners.forEach((fn) => fn());
}
export const useMotionPick = () => useSyncExternalStore((fn) => (listeners.add(fn), () => listeners.delete(fn)), () => picked);

// Each live graphic's player, by clip, so the inspector can ask it to pick an element or its group.
const frames = new Map<string, HTMLIFrameElement>();
export const tellMotion = (clipId: string, message: Record<string, unknown>) => frames.get(clipId)?.contentWindow?.postMessage({ mg: 1, ...message }, "*");

const clean = (edit: Edit): Edit | null => {
  const out: Edit = { ...edit };
  (Object.keys(out) as Array<keyof Edit>).forEach((k) => out[k] === undefined && delete out[k]);
  if (out.dx === 0) delete out.dx;
  if (out.dy === 0) delete out.dy;
  if (out.scale === 1) delete out.scale;
  return Object.keys(out).length ? out : null;
};
/** Changes one element of a graphic (undoable like any edit); the export films it again. */
export function editMotion(assetId: string, path: string, patch: Edit | null) {
  vibe.commit((p) => ({
    ...p,
    assets: p.assets.map((a) => {
      if (a.id !== assetId || !a.motion) return a;
      const edits = { ...((a.motion.edits || {}) as Record<string, Edit>) };
      const merged = patch ? clean({ ...(edits[path] || {}), ...patch }) : null;
      if (merged) edits[path] = merged;
      else delete edits[path];
      return { ...a, motion: { ...a.motion, edits, dirty: true } };
    }),
    updatedAt: Date.now(),
  }), `motion:${assetId}:${path}:${patch ? Object.keys(patch).join() : "reset"}`);
}

// ---------- The live layer in the player ----------

export function MotionLayer({ clip, asset, local, style, interactive }: { clip: VibeClip; asset: VibeAsset; local: number; style: CSSProperties; interactive: boolean }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [html, setHtml] = useState("");
  const ready = useRef(false);
  const motion = asset.motion!;
  const latest = useRef({ local, edits: motion.edits });
  latest.current = { local, edits: motion.edits };
  const post = (message: Record<string, unknown>) => frame.current?.contentWindow?.postMessage({ mg: 1, ...message }, "*");

  // The document is built once per graphic; edits and time then go over postMessage.
  useEffect(() => {
    let live = true;
    ready.current = false;
    void motionPlayerHtml(motion, { transparent: clip.track > 0 }).then((doc) => live && setHtml(doc));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [motion.html, clip.track > 0]);

  useEffect(() => {
    const el = frame.current;
    if (el) frames.set(clip.id, el);
    return () => {
      if (frames.get(clip.id) === el) frames.delete(clip.id);
    };
  }, [clip.id, html]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const m = event.data;
      if (!m?.mg || event.source !== frame.current?.contentWindow) return;
      if (m.type === "ready") {
        ready.current = true;
        post({ type: "edits", items: latest.current.edits || {} });
        post({ type: "seek", t: latest.current.local });
      } else if (m.type === "selected") {
        if (m.info) {
          vibe.select([clip.id]);
          setMotionPick({ ...m.info, clipId: clip.id, assetId: asset.id });
        } else if (picked?.clipId === clip.id) setMotionPick(null);
      } else if (m.type === "patch") editMotion(asset.id, m.path, m.patch);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [clip.id, asset.id]);

  useEffect(() => {
    if (ready.current) post({ type: "edits", items: motion.edits || {} });
  }, [motion.edits]);
  useEffect(() => {
    if (ready.current) post({ type: "seek", t: local });
  }, [local]);

  return html ? (
    <iframe
      ref={frame}
      className="ve-layer ve-motion-layer"
      srcDoc={html}
      sandbox="allow-scripts"
      title={asset.name}
      // Chrome paints a frame opaque when its colour scheme differs from the page's: keep both "normal" so an
      // overlay stays see-through over the tracks below.
      style={{ ...style, pointerEvents: interactive ? "auto" : "none", border: 0, colorScheme: "normal" }}
    />
  ) : null;
}

// ---------- The inspector's part ----------

const describe = (edit: Edit) =>
  [...new Set(Object.keys(edit).map((k) => ({ dx: "moved", dy: "moved", scale: "resized", text: "reworded", color: "recoloured", hidden: "hidden", from: "timed", to: "timed" } as Record<string, string>)[k]))].join(", ");

/** The motion graphic group in the inspector: the picked element's words, colour, size, place, and timing. */
export function MotionInspector({ clip, asset }: { clip: VibeClip; asset: VibeAsset }) {
  const pick = useMotionPick();
  const playhead = vibe.get().playhead;
  const local = Math.max(0, playhead - clip.start + clip.in);
  const edits = (asset.motion?.edits || {}) as Record<string, Edit>;
  const mine = pick && pick.clipId === clip.id ? pick : null;
  const edit = mine ? edits[mine.path] || {} : {};
  const set = (patch: Edit) => mine && editMotion(asset.id, mine.path, patch);
  const paths = Object.keys(edits);
  const round = (n: number) => Math.round(n * 10) / 10;
  return (
    <div className="ve-motion">
      {!mine ? (
        <p className="ve-hint"><MousePointer2 size={13} aria-hidden="true" /> Click any part of it in the player to change it: drag to move, drag its corner to resize.</p>
      ) : (
        <div className="ve-motion-fields">
          <div className="ve-motion-picked">
            <strong title={mine.label}>{mine.label}</strong>
            {mine.hasParent ? <button type="button" className="ve-link" onClick={() => tellMotion(clip.id, { type: "parent" })}><ArrowUpLeft size={13} aria-hidden="true" />Its group</button> : null}
          </div>
          {mine.isText ? (
            <label className="ve-motion-field">
              <span>Text</span>
              <textarea rows={2} value={edit.text ?? mine.text} onChange={(e) => set({ text: e.target.value })} />
            </label>
          ) : null}
          <label className="ve-prop-row">
            <span>Colour</span>
            <span className="ve-color">
              <input type="color" value={edit.color || mine.color} onChange={(e) => set({ color: e.target.value })} aria-label="Colour" />
              <code>{(edit.color || mine.color).toUpperCase()}</code>
            </span>
          </label>
          <label className="ve-motion-field">
            <span>Size <em>{Math.round((edit.scale || 1) * 100)}%</em></span>
            <input type="range" min={0.2} max={4} step={0.01} value={edit.scale || 1} onChange={(e) => set({ scale: Number(e.target.value) })} />
          </label>
          <div className="ve-motion-field">
            <span>Position</span>
            <span className="ve-motion-row">
              <label>X<input type="number" value={edit.dx || 0} onChange={(e) => set({ dx: Number(e.target.value) || 0 })} /></label>
              <label>Y<input type="number" value={edit.dy || 0} onChange={(e) => set({ dy: Number(e.target.value) || 0 })} /></label>
            </span>
          </div>
          <div className="ve-motion-field">
            <span>On screen (seconds into the graphic)</span>
            <span className="ve-motion-row">
              <label>From<input type="number" min={0} step={0.1} placeholder="start" value={edit.from ?? ""} onChange={(e) => set({ from: e.target.value === "" ? undefined : Number(e.target.value) })} /></label>
              <label>Until<input type="number" min={0} step={0.1} placeholder="end" value={edit.to ?? ""} onChange={(e) => set({ to: e.target.value === "" ? undefined : Number(e.target.value) })} /></label>
            </span>
            <span className="ve-motion-row">
              <button type="button" className="ve-link" onClick={() => set({ from: round(local) })}>From the playhead</button>
              <button type="button" className="ve-link" onClick={() => set({ to: round(local) })}>Until the playhead</button>
            </span>
          </div>
          <div className="ve-motion-row">
            <button type="button" className="ui-btn is-sm" onClick={() => set({ hidden: edit.hidden ? undefined : true })}>{edit.hidden ? <Eye size={14} /> : <EyeOff size={14} />}{edit.hidden ? "Show it" : "Hide it"}</button>
            {edits[mine.path] ? <button type="button" className="ui-btn is-sm" onClick={() => editMotion(asset.id, mine.path, null)}><RotateCcw size={14} />Reset</button> : null}
          </div>
        </div>
      )}
      {paths.length ? (
        <div className="ve-motion-list">
          <span>Changed ({paths.length})</span>
          {paths.map((path) => (
            <button key={path} type="button" className={mine?.path === path ? "is-on" : undefined} onClick={() => tellMotion(clip.id, { type: "select", path })}>
              {describe(edits[path])}
              <small>{path.split(" > ").slice(-1)[0].replace(/:nth-child\((\d+)\)/, " #$1")}</small>
            </button>
          ))}
        </div>
      ) : null}
      {asset.motion?.dirty ? <p className="ve-hint">Your changes are filmed into the video when you export.</p> : null}
    </div>
  );
}
