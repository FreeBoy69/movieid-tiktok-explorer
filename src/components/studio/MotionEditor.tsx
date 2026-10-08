// Edit a generated motion graphic in its own player, the way HyperFrames does: click any element, drag it, drag
// its corner to resize, change its words and colour, or choose when it's on screen. The film runs sandboxed (no
// access to the app), so a small bridge inside it reports clicks and drags over postMessage; the edits are a
// layer the film re-applies every frame (src/utils/videoGraphics.js), so the rendered video has them too.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowUpLeft, Eye, EyeOff, Loader2, MousePointer2, Pause, Play, Redo2, RotateCcw, Undo2, X } from "lucide-react";
import { motionEditorDocument } from "../../utils/videoGraphics.js";
import { toast } from "../../utils/toast";
import "./MotionEditor.css";

type Edit = { dx?: number; dy?: number; scale?: number; text?: string; color?: string; hidden?: boolean; from?: number; to?: number };
type Edits = Record<string, Edit>;
type Selected = { path: string; tag: string; isText: boolean; text: string; color: string; label: string; hasParent: boolean } | null;

// The same strict policy the gallery frames films under: no network, inline code only.
const MOTION_CSP = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; form-action 'none'">`;
const ratio = (aspect?: string) => String(aspect || "16:9").replace(":", " / ");
const arOf = (aspect?: string) => {
  const [w, h] = String(aspect || "16:9").split(":").map(Number);
  return w > 0 && h > 0 ? w / h : 16 / 9;
};
const clock = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;
const clean = (edit: Edit): Edit | null => {
  const out: Edit = { ...edit };
  (Object.keys(out) as Array<keyof Edit>).forEach((k) => out[k] === undefined && delete out[k]);
  if (out.dx === 0) delete out.dx;
  if (out.dy === 0) delete out.dy;
  if (out.scale === 1) delete out.scale;
  return Object.keys(out).length ? out : null;
};

export function MotionEditor({ generationId, title, onClose, onSaved }: { generationId: string; title: string; onClose: () => void; onSaved: () => void }) {
  const [doc, setDoc] = useState<{ html: string; aspect: string } | null>(null);
  const [error, setError] = useState("");
  const [edits, setEdits] = useState<Edits>({});
  const [past, setPast] = useState<Edits[]>([]);
  const [future, setFuture] = useState<Edits[]>([]);
  const [saved, setSaved] = useState<Edits>({});
  const [selected, setSelected] = useState<Selected>(null);
  const [ready, setReady] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [saving, setSaving] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const editsRef = useRef(edits);
  editsRef.current = edits;

  // The document and its saved edits; the player gets the edits layer and the bridge, never autoplay.
  useEffect(() => {
    let live = true;
    fetch(`/api/studio/generations/${encodeURIComponent(generationId)}/motion`, { credentials: "same-origin" })
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error || "This motion graphic couldn't be opened");
        return data;
      })
      .then((data) => {
        if (!live) return;
        setEdits(data.edits || {});
        setSaved(data.edits || {});
        setDoc({ html: motionEditorDocument(data.html, data.edits || {}, MOTION_CSP), aspect: data.aspect || "16:9" });
      })
      .catch((err) => live && setError(err instanceof Error ? err.message : "This motion graphic couldn't be opened"));
    return () => {
      live = false;
    };
  }, [generationId]);

  const send = useCallback((message: Record<string, unknown>) => frame.current?.contentWindow?.postMessage({ mg: 1, ...message }, "*"), []);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const m = event.data;
      if (!m?.mg || event.source !== frame.current?.contentWindow) return;
      if (m.type === "ready") {
        setReady(true);
        setDuration(Number(m.duration) || 0);
      } else if (m.type === "time") setTime(Number(m.t) || 0);
      else if (m.type === "selected") setSelected(m.info || null);
      else if (m.type === "patch") change(m.path, m.patch);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Every change goes to the player and onto the undo stack.
  const commit = useCallback((next: Edits) => {
    setPast((p) => [...p.slice(-80), editsRef.current]);
    setFuture([]);
    setEdits(next);
    send({ type: "edits", items: next });
  }, [send]);
  const change = useCallback((path: string, patch: Edit) => {
    const current = editsRef.current;
    const merged = clean({ ...(current[path] || {}), ...patch });
    const next = { ...current };
    if (merged) next[path] = merged;
    else delete next[path];
    commit(next);
  }, [commit]);
  const undo = () => {
    if (!past.length) return;
    setFuture((f) => [edits, ...f]);
    const prev = past[past.length - 1];
    setPast((p) => p.slice(0, -1));
    setEdits(prev);
    send({ type: "edits", items: prev });
  };
  const redo = () => {
    if (!future.length) return;
    setPast((p) => [...p, edits]);
    const [nextEdits, ...rest] = future;
    setFuture(rest);
    setEdits(nextEdits);
    send({ type: "edits", items: nextEdits });
  };

  const dirty = JSON.stringify(edits) !== JSON.stringify(saved);
  const close = useCallback(() => {
    if (dirty && !window.confirm("Leave without saving your edits?")) return;
    onClose();
  }, [dirty, onClose]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const typing = /input|textarea|select/i.test((event.target as HTMLElement).tagName);
      if (event.key === "Escape") close();
      else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z" && !typing) {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      } else if (event.key === " " && !typing) {
        event.preventDefault();
        togglePlay();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const togglePlay = () => {
    send({ type: playing ? "pause" : "play" });
    setPlaying(!playing);
  };
  const seek = (t: number) => {
    setPlaying(false);
    send({ type: "seek", t });
  };

  const save = async () => {
    setSaving(true);
    try {
      const response = await fetch(`/api/studio/generations/${encodeURIComponent(generationId)}/motion`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ edits }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "The edits didn't save");
      setSaved(edits);
      toast.success(Object.keys(edits).length ? "Edits saved. The new video renders in the background." : "Edits removed.");
      onSaved();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "The edits didn't save");
    } finally {
      setSaving(false);
    }
  };

  const edit = selected ? edits[selected.path] || {} : {};
  const editedPaths = useMemo(() => Object.keys(edits), [edits]);

  return createPortal(
    <div className="mge" role="dialog" aria-modal="true" aria-label={`Edit ${title}`}>
      <header className="mge-bar">
        <button type="button" className="mge-icon" onClick={close} aria-label="Close"><X size={18} /></button>
        <div className="mge-title">
          <strong>Edit motion graphic</strong>
          <span>Click anything in the player. Drag to move it, drag its corner to resize.</span>
        </div>
        <div className="mge-bar-tools">
          <button type="button" className="mge-icon" onClick={undo} disabled={!past.length} aria-label="Undo" title="Undo (⌘Z)"><Undo2 size={17} /></button>
          <button type="button" className="mge-icon" onClick={redo} disabled={!future.length} aria-label="Redo" title="Redo (⇧⌘Z)"><Redo2 size={17} /></button>
          <button type="button" className="mge-ghost" onClick={() => commit({})} disabled={!editedPaths.length}>Reset all</button>
          <button type="button" className="mge-primary" onClick={() => void save()} disabled={saving || !dirty}>{saving ? <Loader2 size={15} className="mge-spin" /> : null}Save and render</button>
        </div>
      </header>

      <div className="mge-body">
        <section className="mge-stage-wrap" aria-label="Player">
          <div className="mge-stage" style={{ aspectRatio: ratio(doc?.aspect), ["--mge-ar" as string]: arOf(doc?.aspect) }}>
            {doc ? <iframe ref={frame} srcDoc={doc.html} sandbox="allow-scripts" title={title} /> : null}
            {!ready ? (
              <div className="mge-wait">{error ? <p role="alert">{error}</p> : <><Loader2 size={18} className="mge-spin" />Opening the player</>}</div>
            ) : null}
          </div>
          <div className="mge-transport">
            <button type="button" className="mge-play" onClick={togglePlay} disabled={!ready} aria-label={playing ? "Pause" : "Play"}>{playing ? <Pause size={16} /> : <Play size={16} />}</button>
            <input type="range" min={0} max={duration || 1} step={0.01} value={Math.min(time, duration || 1)} onChange={(event) => seek(Number(event.target.value))} disabled={!ready} aria-label="Playhead" />
            <span className="mge-clock">{clock(time)} / {clock(duration)}</span>
          </div>
        </section>

        <aside className="mge-inspector" aria-label="Selected element">
          {!selected ? (
            <div className="mge-empty">
              <MousePointer2 size={20} aria-hidden="true" />
              <strong>Select something to edit</strong>
              <p>Click any text, shape, or picture in the player. Pause first to catch something that moves.</p>
            </div>
          ) : (
            <div className="mge-fields">
              <div className="mge-picked">
                <strong title={selected.label}>{selected.label}</strong>
                {selected.hasParent ? <button type="button" className="mge-link" onClick={() => send({ type: "parent" })}><ArrowUpLeft size={13} aria-hidden="true" />Select its group</button> : null}
              </div>
              {selected.isText ? (
                <label className="mge-field">
                  <span>Text</span>
                  <textarea rows={3} value={edit.text ?? selected.text} onChange={(event) => change(selected.path, { text: event.target.value })} />
                </label>
              ) : null}
              <label className="mge-field">
                <span>Colour</span>
                <span className="mge-row">
                  <input type="color" value={edit.color || selected.color} onChange={(event) => change(selected.path, { color: event.target.value })} aria-label="Colour" />
                  <code>{(edit.color || selected.color).toUpperCase()}</code>
                  {edit.color ? <button type="button" className="mge-link" onClick={() => change(selected.path, { color: undefined })}>Original</button> : null}
                </span>
              </label>
              <label className="mge-field">
                <span>Size <em>{Math.round((edit.scale || 1) * 100)}%</em></span>
                <input type="range" min={0.2} max={4} step={0.01} value={edit.scale || 1} onChange={(event) => change(selected.path, { scale: Number(event.target.value) })} />
              </label>
              <div className="mge-field">
                <span>Position</span>
                <span className="mge-row">
                  <label className="mge-num">X<input type="number" value={edit.dx || 0} onChange={(event) => change(selected.path, { dx: Number(event.target.value) || 0 })} /></label>
                  <label className="mge-num">Y<input type="number" value={edit.dy || 0} onChange={(event) => change(selected.path, { dy: Number(event.target.value) || 0 })} /></label>
                  {edit.dx || edit.dy ? <button type="button" className="mge-link" onClick={() => change(selected.path, { dx: 0, dy: 0 })}>Centre back</button> : null}
                </span>
              </div>
              <div className="mge-field">
                <span>On screen</span>
                <span className="mge-row">
                  <label className="mge-num">From<input type="number" min={0} step={0.1} placeholder="start" value={edit.from ?? ""} onChange={(event) => change(selected.path, { from: event.target.value === "" ? undefined : Number(event.target.value) })} /></label>
                  <label className="mge-num">Until<input type="number" min={0} step={0.1} placeholder="end" value={edit.to ?? ""} onChange={(event) => change(selected.path, { to: event.target.value === "" ? undefined : Number(event.target.value) })} /></label>
                </span>
                <span className="mge-row">
                  <button type="button" className="mge-link" onClick={() => change(selected.path, { from: Math.round(time * 10) / 10 })}>Start at playhead</button>
                  <button type="button" className="mge-link" onClick={() => change(selected.path, { to: Math.round(time * 10) / 10 })}>End at playhead</button>
                </span>
              </div>
              <div className="mge-row mge-actions">
                <button type="button" className="mge-ghost" onClick={() => change(selected.path, { hidden: edit.hidden ? undefined : true })}>{edit.hidden ? <Eye size={14} /> : <EyeOff size={14} />}{edit.hidden ? "Show it" : "Hide it"}</button>
                {edits[selected.path] ? <button type="button" className="mge-ghost" onClick={() => { const next = { ...edits }; delete next[selected.path]; commit(next); }}><RotateCcw size={14} />Reset</button> : null}
              </div>
            </div>
          )}
          {editedPaths.length ? (
            <div className="mge-list">
              <h3>Edited ({editedPaths.length})</h3>
              <ul>
                {editedPaths.map((path) => (
                  <li key={path}>
                    <button type="button" className={selected?.path === path ? "is-on" : undefined} onClick={() => send({ type: "select", path })}>
                      {Object.keys(edits[path]).map((k) => ({ dx: "moved", dy: "moved", scale: "resized", text: "reworded", color: "recoloured", hidden: "hidden", from: "timed", to: "timed" } as Record<string, string>)[k]).filter((v, i, a) => a.indexOf(v) === i).join(", ")}
                      <small>{path.split(" > ").slice(-1)[0].replace(/:nth-child\((\d+)\)/, " #$1")}</small>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </aside>
      </div>
    </div>,
    document.body,
  );
}
