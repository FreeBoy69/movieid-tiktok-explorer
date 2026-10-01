// Vibe Edit: a multi-track video editor with an AI assistant beside it,
// after Donkey Cut (Apache-2.0, github.com/donkeycut/donkey). The home lists
// your edits; the editor is a full-screen workspace: tool rail and panel on
// the left, preview in the middle, assistant on the right, timeline below.
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Check, ChevronDown, Clapperboard, CloudOff, Download, Film, Loader2, Plus, SlidersHorizontal, Sparkles, Square, Trash2, Upload, WandSparkles, X } from "lucide-react";
import { toast } from "../../utils/toast";
import { writeDeepLink } from "../../utils/tiktokRoute";
import { loadVoiceProfiles } from "../../utils/voiceProfiles";
import { deleteItems, isLocked, emptyProject, formatTime, frameSize, normalizeProject, projectDuration, splitAt, VIBE_ASPECTS, type VibeAspect } from "../../utils/vibeEdit";
import { deleteProject, getRender, listProjects, loadProject, saveProject, startRender, stopRender, type ProjectSummary, type RenderJob } from "./api";
import { ChatPanel } from "./ChatPanel";
import { setVoices } from "./commands";
import { renderOverlayFrames } from "./overlay";
import { Inspector, PANELS, PanelBody, uploadFiles, type PanelId } from "./Panels";
import { Preview } from "./Preview";
import { useVibe, vibe } from "./store";
import { Timeline } from "./Timeline";
import "../../styles/captionFonts.css";
import "../../styles/captionFonts.css";
import "./VibeEdit.css";

const focusMode = (on: boolean) => {
  window.dispatchEvent(new CustomEvent("autoyt-focus-mode", { detail: on }));
};
const ago = (ms: number) => {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

// ---------- Home ----------
function Home({ onOpen, onCreate }: { onOpen: (id: string) => void; onCreate: (aspect: VibeAspect, files?: File[]) => void }) {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState("");
  const [aspect, setAspect] = useState<VibeAspect>("9:16");
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    listProjects().then(setProjects, (e) => setError((e as Error).message));
  }, []);

  const remove = async (id: string) => {
    if (!window.confirm("Delete this edit? Its media stays in your library.")) return;
    try {
      await deleteProject(id);
      setProjects((list) => list?.filter((p) => p.id !== id) || null);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div
      className={`ve-home${over ? " is-over" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (e.dataTransfer.files.length) onCreate(aspect, [...e.dataTransfer.files]);
      }}
    >
      <header className="ve-home-hero">
        <h1>
          <WandSparkles size={26} /> Vibe Edit
        </h1>
        <p>Drop in footage and edit on a timeline, or tell the assistant what you want: captions, a voiceover in any of 30 voices, music under the voice, titles, generated shots.</p>
        <div className="ve-home-start">
          <div className="ve-seg" role="radiogroup" aria-label="Frame">
            {VIBE_ASPECTS.map((a) => (
              <button key={a.id} type="button" role="radio" aria-checked={aspect === a.id} className={aspect === a.id ? "is-on" : ""} onClick={() => setAspect(a.id)}>
                <span className="ve-aspect-glyph" data-aspect={a.id} aria-hidden="true" />
                {a.label}
              </button>
            ))}
          </div>
          <button type="button" className="ve-btn ve-btn-primary ve-btn-lg" onClick={() => onCreate(aspect)}>
            <Plus size={17} /> New edit
          </button>
          <button type="button" className="ve-btn ve-btn-lg" onClick={() => input.current?.click()}>
            <Upload size={16} /> Start from footage
          </button>
          <input
            ref={input}
            type="file"
            hidden
            multiple
            accept="video/mp4,video/quicktime,video/webm,image/png,image/jpeg,image/webp,audio/mpeg,audio/wav,audio/mp4,audio/ogg"
            onChange={(e) => {
              const files = [...(e.target.files || [])];
              e.target.value = "";
              if (files.length) onCreate(aspect, files);
            }}
          />
        </div>
      </header>

      <section className="ve-home-list" aria-label="Your edits">
        <h2>Your edits</h2>
        {error ? (
          <p className="ve-empty">
            <CloudOff size={16} /> {error}
          </p>
        ) : projects === null ? (
          <div className="ve-cards">
            {[0, 1, 2].map((i) => (
              <div key={i} className="ve-card is-skeleton" />
            ))}
          </div>
        ) : projects.length ? (
          <div className="ve-cards">
            {projects.map((p) => (
              <div key={p.id} className="ve-card">
                <button type="button" className="ve-card-open" onClick={() => onOpen(p.id)}>
                  <span className="ve-card-cover" data-aspect={p.aspect}>
                    {p.cover?.kind === "image" ? <img src={p.cover.url} alt="" loading="lazy" /> : p.cover?.kind === "video" ? <video src={`${p.cover.url}#t=0.5`} preload="metadata" muted /> : <Clapperboard size={26} />}
                  </span>
                  <span className="ve-card-meta">
                    <strong>{p.name}</strong>
                    <small>
                      {p.aspect} · {formatTime(p.duration)} · {ago(p.updatedAt)}
                    </small>
                  </span>
                </button>
                <button type="button" className="ve-card-del" onClick={() => void remove(p.id)} aria-label={`Delete ${p.name}`}>
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="ve-empty">No edits yet. Start one above, or drop footage anywhere on this page.</p>
        )}
      </section>
    </div>
  );
}

// ---------- Export ----------
function ExportMenu() {
  const project = useVibe((s) => s.project);
  const [open, setOpen] = useState(false);
  const [job, setJob] = useState<RenderJob | null>(null);
  const [phase, setPhase] = useState<"" | "frames" | "render">("");
  const [progress, setProgress] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const duration = projectDuration(project);
  const { w, h } = frameSize(project.aspect);

  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("pointerdown", down);
    return () => document.removeEventListener("pointerdown", down);
  }, [open]);

  useEffect(() => {
    if (!job || job.status !== "running") return;
    const timer = window.setInterval(async () => {
      try {
        const next = await getRender(job.id);
        setJob(next);
        setProgress(next.progress);
        if (next.status === "completed") {
          setPhase("");
          toast.success("Your video is ready.");
        } else if (next.status !== "running") {
          setPhase("");
          if (next.status === "failed") toast.error(next.error || "The export failed.");
        }
      } catch (e) {
        toast.error((e as Error).message);
      }
    }, 2000);
    return () => window.clearInterval(timer);
  }, [job]);

  const start = async () => {
    try {
      setJob(null);
      setPhase("frames");
      setProgress(0);
      const { blank, frames } = await renderOverlayFrames(project, w, h, duration, (k) => setProgress(k * 0.15));
      setPhase("render");
      const render = await startRender(project, [{ blank: true, png: blank }, ...frames]);
      setJob(render);
    } catch (e) {
      setPhase("");
      toast.error((e as Error).message);
    }
  };

  const running = phase !== "" || job?.status === "running";
  return (
    <div className="ve-export" ref={box}>
      <button type="button" className="ve-btn ve-btn-primary" onClick={() => setOpen((o) => !o)} aria-expanded={open} disabled={duration <= 0}>
        {running ? <Loader2 size={15} className="ve-spin" /> : <Download size={15} />} Export
      </button>
      {open ? (
        <div className="ve-pop" role="dialog" aria-label="Export">
          <h3>Export video</h3>
          <dl className="ve-spec">
            <div>
              <dt>Frame</dt>
              <dd>
                {w}×{h} · {project.aspect}
              </dd>
            </div>
            <div>
              <dt>Length</dt>
              <dd>{formatTime(duration, true)}</dd>
            </div>
            <div>
              <dt>Format</dt>
              <dd>MP4 · H.264 · AAC</dd>
            </div>
          </dl>
          {running ? (
            <div className="ve-progress">
              <div className="ve-progress-bar">
                <span style={{ width: `${Math.round(Math.max(0.03, phase === "frames" ? progress : 0.15 + (job?.progress || 0) * 0.85) * 100)}%` }} />
              </div>
              <p>
                {phase === "frames" ? "Drawing captions and titles…" : "Rendering on the server. You can keep editing; this edit is what exports."}
              </p>
              {job?.status === "running" ? (
                <button type="button" className="ve-btn ve-btn-quiet" onClick={() => void stopRender(job.id).then(() => setJob({ ...job, status: "stopped" }))}>
                  <Square size={13} /> Stop
                </button>
              ) : null}
            </div>
          ) : job?.status === "completed" && job.url ? (
            <div className="ve-done">
              <video src={job.url} controls playsInline className="ve-done-video" />
              <div className="ve-actions">
                <a className="ve-btn ve-btn-primary" href={`${job.url}?download=1`} download>
                  <Download size={15} /> Download MP4
                </a>
                <button type="button" className="ve-btn" onClick={() => void start()}>
                  Export again
                </button>
              </div>
            </div>
          ) : (
            <>
              {job?.status === "failed" ? <p className="ve-error">{job.error || "The export failed."}</p> : null}
              <button type="button" className="ve-btn ve-btn-primary ve-btn-block" onClick={() => void start()}>
                <Film size={15} /> Render MP4
              </button>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

// ---------- Editor ----------
function StatusStrip() {
  const tasks = useVibe((s) => s.tasks);
  const labels = Object.values(tasks);
  if (!labels.length) return null;
  return (
    <div className="ve-status" role="status">
      <Loader2 size={14} className="ve-spin" /> {labels[0]}
      {labels.length > 1 ? <span> +{labels.length - 1} more</span> : null}
    </div>
  );
}

function SaveBadge() {
  const save = useVibe((s) => s.save);
  return (
    <span className={`ve-save is-${save}`} aria-live="polite">
      {save === "saving" ? <Loader2 size={12} className="ve-spin" /> : save === "error" ? <CloudOff size={12} /> : save === "saved" ? <Check size={12} /> : null}
      {save === "saved" ? "Saved" : save === "saving" || save === "dirty" ? "Saving" : "Not saved"}
    </span>
  );
}

function Editor({ onBack }: { onBack: () => void }) {
  const name = useVibe((s) => s.project.name);
  const aspect = useVibe((s) => s.project.aspect);
  const [panel, setPanel] = useState<PanelId | null>("media");
  const [side, setSide] = useState<"props" | "chat" | null>("chat");
  const [snapping, setSnapping] = useState(true);
  const [voicesLoading, setVoicesLoading] = useState(true);
  const [over, setOver] = useState(false);
  const selectedId = useVibe((s) => (s.selection.length === 1 ? s.selection[0] : ""));
  // Properties follow the selection, the way every editor's inspector does.
  useEffect(() => {
    if (selectedId) setSide((current) => (current ? "props" : current));
  }, [selectedId]);

  useEffect(() => {
    const controller = new AbortController();
    loadVoiceProfiles(controller.signal)
      .then(({ profiles }) => setVoices(profiles))
      .catch(() => {})
      .finally(() => setVoicesLoading(false));
    return () => controller.abort();
  }, []);

  // Narrow screens start with the panels folded so the preview has room.
  useEffect(() => {
    if (window.matchMedia("(max-width: 900px)").matches) {
      setPanel(null);
      setSide(null);
    }
  }, []);

  // Keyboard: space, S, delete, undo/redo, arrows.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [contenteditable=true]")) return;
      const mod = e.metaKey || e.ctrlKey;
      const s = vibe.get();
      if (e.code === "Space") {
        e.preventDefault();
        vibe.play();
      } else if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) vibe.redo();
        else vibe.undo();
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        vibe.redo();
      } else if (!mod && e.key.toLowerCase() === "s") {
        vibe.commit((p) => splitAt(p, s.playhead, s.selection.length ? s.selection : undefined));
      } else if ((e.key === "Delete" || e.key === "Backspace") && s.selection.length) {
        e.preventDefault();
        vibe.commit((p) => deleteItems(p, s.selection.filter((id) => !isLocked(p, id))));
      } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        vibe.seek(s.playhead + (e.key === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? 1 : 1 / 30));
      } else if (e.key === "Home") vibe.seek(0);
      else if (e.key === "Escape") vibe.select([]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div
      className="ve-editor"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setOver(true);
        }
      }}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setOver(false)}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        setOver(false);
        void uploadFiles([...e.dataTransfer.files]);
      }}
    >
      <header className="ve-top">
        <button type="button" className="ve-tool" onClick={onBack} aria-label="Back to your edits" title="Your edits">
          <ArrowLeft size={18} />
        </button>
        <input className="ve-name" value={name} onChange={(e) => vibe.commit((p) => ({ ...p, name: e.target.value.slice(0, 120), updatedAt: Date.now() }), "rename")} aria-label="Project name" spellCheck={false} />
        <SaveBadge />
        <div className="ve-top-mid">
          <label className="ve-aspect">
            <span className="ve-aspect-glyph" data-aspect={aspect} aria-hidden="true" />
            <select value={aspect} onChange={(e) => vibe.commit((p) => ({ ...p, aspect: e.target.value as VibeAspect, updatedAt: Date.now() }))} aria-label="Frame">
              {VIBE_ASPECTS.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.id} · {a.label}
                </option>
              ))}
            </select>
            <ChevronDown size={14} />
          </label>
        </div>
        <div className="ve-top-end">
          <StatusStrip />
          <button type="button" className={`ve-btn ve-btn-quiet${side === "chat" ? " is-on" : ""}`} onClick={() => setSide((c) => (c === "chat" ? null : "chat"))} aria-pressed={side === "chat"}>
            <Sparkles size={15} /> <span className="ve-label-wide">Assistant</span>
          </button>
          <button type="button" className={`ve-tool${side === "props" ? " is-on" : ""}`} onClick={() => setSide((c) => (c === "props" ? null : "props"))} aria-pressed={side === "props"} aria-label="Properties" title="Properties">
            <SlidersHorizontal size={16} />
          </button>
          <ExportMenu />
        </div>
      </header>

      <div className={`ve-body${panel ? " has-panel" : ""}${side ? " has-chat" : ""}`}>
        <nav className="ve-rail" aria-label="Tools">
          {PANELS.map((p) => (
            <button key={p.id} type="button" className={`ve-rail-btn${panel === p.id ? " is-on" : ""}`} onClick={() => setPanel(panel === p.id ? null : p.id)} aria-pressed={panel === p.id}>
              {p.icon}
              <span>{p.label}</span>
            </button>
          ))}
        </nav>
        {panel ? (
          <aside className="ve-panel" aria-label={PANELS.find((p) => p.id === panel)?.label}>
            <div className="ve-panel-head">
              <h2>{PANELS.find((p) => p.id === panel)?.label}</h2>
              <button type="button" className="ve-tool" onClick={() => setPanel(null)} aria-label="Close panel">
                <X size={16} />
              </button>
            </div>
            <div className="ve-panel-body">
              <PanelBody panel={panel} voicesLoading={voicesLoading} />
            </div>
          </aside>
        ) : null}
        <main className="ve-center">
          <Preview />
        </main>
        {side ? (
          <aside className="ve-side" aria-label={side === "props" ? "Properties" : "Assistant"}>
            <div className="ve-side-head" role="tablist" aria-label="Side panel">
              <button type="button" role="tab" aria-selected={side === "props"} className={side === "props" ? "is-on" : ""} onClick={() => setSide("props")}>
                <SlidersHorizontal size={14} /> Properties
              </button>
              <button type="button" role="tab" aria-selected={side === "chat"} className={side === "chat" ? "is-on" : ""} onClick={() => setSide("chat")}>
                <Sparkles size={14} /> Assistant
              </button>
              <button type="button" className="ve-tool" onClick={() => setSide(null)} aria-label="Close side panel">
                <X size={16} />
              </button>
            </div>
            {side === "props" ? <Inspector /> : <ChatPanel />}
          </aside>
        ) : null}
      </div>

      <Timeline snapping={snapping} onToggleSnap={() => setSnapping((s) => !s)} />
      {over ? (
        <div className="ve-dropzone" aria-hidden="true">
          <Upload size={28} />
          <strong>Drop to add to your edit</strong>
        </div>
      ) : null}
    </div>
  );
}

export default function VibeEdit({ theme, projectId }: { theme: "light" | "dark"; projectId?: string }) {
  const [openId, setOpenId] = useState<string | undefined>(projectId);
  const [loading, setLoading] = useState(false);
  const loadedId = useVibe((s) => s.project.id);
  const save = useVibe((s) => s.save);

  useEffect(() => setOpenId(projectId), [projectId]);

  // Open the requested project.
  useEffect(() => {
    if (!openId || openId === loadedId) return;
    let live = true;
    setLoading(true);
    loadProject(openId)
      .then((p) => {
        if (!live) return;
        // Clear the flag first: loading the project changes loadedId, which
        // re-runs this effect and marks this request stale.
        setLoading(false);
        vibe.load(normalizeProject(p));
      })
      .catch((e) => {
        if (!live) return;
        setLoading(false);
        toast.error((e as Error).message);
        setOpenId(undefined);
        writeDeepLink({ view: "vibe-edit" }, true);
      });
    return () => {
      live = false;
    };
  }, [openId, loadedId]);

  // Full-screen while editing.
  const editing = Boolean(openId && openId === loadedId && !loading);
  useEffect(() => {
    focusMode(editing);
    return () => focusMode(false);
  }, [editing]);

  // Autosave shortly after each edit.
  useEffect(() => {
    if (save !== "dirty" || !editing) return;
    const timer = window.setTimeout(async () => {
      const snapshot = vibe.get().project;
      vibe.set({ save: "saving" });
      try {
        await saveProject(snapshot);
        if (vibe.get().project === snapshot) vibe.set({ save: "saved" });
        else vibe.set({ save: "dirty" });
      } catch (e) {
        vibe.set({ save: "error" });
        toast.error((e as Error).message);
      }
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [save, editing]);

  // Warn before leaving with unsaved edits.
  useEffect(() => {
    const onLeave = (e: BeforeUnloadEvent) => {
      if (vibe.get().save !== "saved") e.preventDefault();
    };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, []);

  const open = useCallback((id: string) => {
    setOpenId(id);
    writeDeepLink({ view: "vibe-edit", projectId: id });
  }, []);

  const create = useCallback(
    async (aspect: VibeAspect, files?: File[]) => {
      const project = emptyProject(files?.[0]?.name.replace(/\.[^.]+$/, "") || "Untitled edit", aspect);
      try {
        await saveProject(project);
        vibe.load(project);
        open(project.id);
        if (files?.length) await uploadFiles(files);
      } catch (e) {
        toast.error((e as Error).message);
      }
    },
    [open],
  );

  const back = async () => {
    vibe.play(false);
    if (vibe.get().save !== "saved") await saveProject(vibe.get().project).catch(() => {});
    setOpenId(undefined);
    writeDeepLink({ view: "vibe-edit" });
  };

  return (
    <div className="ve-root" data-theme={theme}>
      {editing ? (
        <Editor onBack={() => void back()} />
      ) : openId ? (
        <div className="ve-loading">
          <Loader2 size={20} className="ve-spin" /> Opening your edit…
        </div>
      ) : (
        <Home onOpen={open} onCreate={(a, f) => void create(a, f)} />
      )}
    </div>
  );
}
