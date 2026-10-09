// Vibe Edit: a multi-track video editor with an AI assistant beside it,
// after Donkey Cut (Apache-2.0, github.com/donkeycut/donkey). The home lists
// your edits; the editor is a full-screen workspace: tool rail and panel on
// the left, preview in the middle, assistant on the right, timeline below.
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import  { Check, Clapperboard, CloudOff, Download, Film, Loader2, Plus, SlidersHorizontal, Square, Trash2, Upload, WandSparkles, ChevronLeft, Link2, LayoutGrid, PanelBottom, PanelLeft, PanelLeftClose, PanelLeftOpen, PanelRight, Search, Pencil } from "lucide-react";
import { toast } from "../../utils/toast";
import { writeDeepLink } from "../../utils/tiktokRoute";
import { loadVoiceProfiles } from "../../utils/voiceProfiles";
import { compactTracks, deleteItems, duplicateItems, editPoints, isLocked, emptyProject, formatTime, frameSize, moveItems, normalizeProject, projectDuration, rippleDeleteItems, splitAt, toggleMarker, trimToTime, VIBE_ASPECTS, type VibeAspect } from "../../utils/vibeEdit";
import { deleteProject, exportToSource, filmMotion, getRender, listProjects, loadProject, saveProject, startRender, stopRender, type ProjectSummary, type RenderJob } from "./api";
import { getVoices, runActions, setVoices } from "./commands";
import { JuelPanel, provideJuelContext, type JuelPageTools } from "../JuelPanel";
import { summarizeProject, VIBE_ACTIONS } from "../../utils/vibeEditActions";
import { SOUND_PRESETS } from "../../utils/vibeSound.js";
import { renderOverlayFrames } from "./overlay";
import { Inspector, PANELS, PanelBody, uploadFiles, type PanelId } from "./Panels";
import { Preview } from "./Preview";
import { useVibe, vibe } from "./store";
import { Timeline } from "./Timeline";
import "../../styles/captionFonts.css";
import "./VibeEdit.css";
import { confirm } from "../ui/Dialog";
import { Progress, SearchField } from "../ui/controls";
import { AspectPicker } from "../studio/studioShared";
import { VideoPlayer } from "../VideoPlayer";

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
    if (!(await confirm({ title: "Delete this edit?", body: "Its media stays in your library.", confirmLabel: "Delete edit", danger: true }))) return;
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
          <AspectPicker label="Frame" className="ve-home-frame" value={aspect} onChange={(next) => setAspect(next as VibeAspect)} options={VIBE_ASPECTS.map((a) => ({ value: a.id, label: a.label, hint: a.id }))} />
          <button type="button" className="ui-btn is-primary is-lg" onClick={() => onCreate(aspect)}>
            <Plus size={17} /> New edit
          </button>
          <button type="button" className="ui-btn is-lg" onClick={() => input.current?.click()}>
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
  const [phase, setPhase] = useState<"" | "motion" | "frames" | "render">("");
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
          // An edit made for a Create Video project or a film episode hands its export back to it.
          const saved = next.file ? await exportToSource(vibe.get().project, next.file).catch((e) => { toast.error((e as Error).message); return ""; }) : "";
          toast.success(saved ? `Your video is ready. ${saved}.` : "Your video is ready.");
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
      setProgress(0);
      // Motion graphics changed in the player are filmed again first, so the export has the changes.
      const changed = vibe.get().project.assets.filter((a) => a.motion?.dirty);
      if (changed.length) setPhase("motion");
      for (const asset of changed) {
        const made = await filmMotion(asset.motion!);
        vibe.commit((p) => ({ ...p, assets: p.assets.map((a) => (a.id === asset.id && a.motion ? { ...a, url: made.url, file: made.file, motion: { ...a.motion, dirty: false } } : a)), updatedAt: Date.now() }));
      }
      const current = vibe.get().project;
      setPhase("frames");
      const { blank, frames } = await renderOverlayFrames(current, w, h, duration, (k) => setProgress(k * 0.15));
      setPhase("render");
      const render = await startRender(current, [{ blank: true, png: blank }, ...frames]);
      setJob(render);
    } catch (e) {
      setPhase("");
      toast.error((e as Error).message);
    }
  };

  const running = phase !== "" || job?.status === "running";
  return (
    <div className="ve-export" ref={box}>
      <button type="button" className="ui-btn is-sm is-ink" onClick={() => setOpen((o) => !o)} aria-expanded={open} disabled={duration <= 0}>
        {running ? <Loader2 size={15} className="ui-spin" /> : <Download size={15} />} Export
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
              <Progress
                label="Export progress"
                value={Math.max(0.03, phase === "frames" ? progress : 0.15 + (job?.progress || 0) * 0.85)}
                message={phase === "motion" ? "Filming your motion graphic changes…" : phase === "frames" ? "Drawing captions and titles…" : "Rendering on the server. You can keep editing; this edit is what exports."}
              />
              {job?.status === "running" ? (
                <button type="button" className="ui-btn is-sm is-ghost" onClick={() => void stopRender(job.id).then(() => setJob({ ...job, status: "stopped" }))}>
                  <Square size={13} /> Stop
                </button>
              ) : null}
            </div>
          ) : job?.status === "completed" && job.url ? (
            <div className="ve-done">
              <VideoPlayer src={job.url} label="Exported video" size="fit" className="ve-done-video" />
              <div className="ve-actions">
                <a className="ui-btn is-sm is-primary" href={`${job.url}?download=1`} download>
                  <Download size={15} /> Download MP4
                </a>
                <button type="button" className="ui-btn is-sm" onClick={() => void start()}>
                  Export again
                </button>
              </div>
            </div>
          ) : (
            <>
              {job?.status === "failed" ? <p className="ve-error">{job.error || "The export failed."}</p> : null}
              <button type="button" className="ui-btn is-sm is-primary is-block" onClick={() => void start()}>
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
      <Loader2 size={14} className="ui-spin" /> {labels[0]}
      {labels.length > 1 ? <span> +{labels.length - 1} more</span> : null}
    </div>
  );
}

// Which cards a viewer keeps open, remembered in this browser only.
const LAYOUT_KEY = "vibe-edit-layout";
type Layout = { chat?: boolean; panel?: boolean; timeline?: boolean; nav?: boolean };
function readLayout(): Layout {
  try {
    return JSON.parse(localStorage.getItem(LAYOUT_KEY) || "{}") as Layout;
  } catch {
    return {};
  }
}
function writeLayout(layout: Layout) {
  try {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
  } catch {
    // Private windows can refuse storage; the layout just isn't remembered.
  }
}

// Share copies this edit's link; the edit stays private to your account.
function ShareButton() {
  const [copied, setCopied] = useState(false);
  const share = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error("Couldn't copy the link. Copy it from the address bar.");
    }
  };
  return (
    <button type="button" className="ui-btn is-sm" onClick={() => void share()}>
      {copied ? <Check size={15} /> : <Link2 size={15} />} <span className="ve-label-wide">{copied ? "Link copied" : "Share"}</span>
    </button>
  );
}

function SaveBadge() {
  const save = useVibe((s) => s.save);
  return (
    <span className={`ve-save is-${save}`} aria-live="polite">
      {save === "saving" ? <Loader2 size={12} className="ui-spin" /> : save === "error" ? <CloudOff size={12} /> : save === "saved" ? <Check size={12} /> : null}
      {save === "saved" ? "Saved" : save === "saving" || save === "dirty" ? "Saving" : "Not saved"}
    </span>
  );
}

// The workspace sidebar: a slim icon column, or open, a card listing your edits
// with the layout toggles at its foot.
type SideItemProps = { icon: ReactNode; label: string; on?: boolean; onClick: () => void; className?: string };
function SideItem({ icon, label, on, onClick, className = "" }: SideItemProps) {
  return (
    <button type="button" className={`ve-nav-item${on ? " is-on" : ""}${className ? ` ${className}` : ""}`} onClick={onClick} aria-pressed={on === undefined ? undefined : on} aria-label={label} title={label}>
      {icon}
      <span>{label}</span>
    </button>
  );
}

function Cover({ cover }: { cover?: ProjectSummary["cover"] }) {
  return (
    <span className="ve-nav-cover" aria-hidden="true">
      {cover?.kind === "image" ? <img src={cover.url} alt="" loading="lazy" /> : cover?.kind === "video" ? <video src={`${cover.url}#t=0.5`} preload="metadata" muted /> : <Clapperboard size={13} strokeWidth={1.75} />}
    </span>
  );
}

function Sidebar({ open, onToggle, onAll, onOpenEdit, onNew, embedded = false, children }: { open: boolean; onToggle: () => void; onAll: () => void; onOpenEdit: (id: string) => void; onNew: () => void; embedded?: boolean; children: ReactNode }) {
  const currentId = useVibe((s) => s.project.id);
  const currentName = useVibe((s) => s.project.name);
  const [edits, setEdits] = useState<ProjectSummary[] | null>(null);
  const [query, setQuery] = useState("");
  const search = useRef<HTMLInputElement>(null);
  const wantSearch = useRef(false);

  // The list refreshes each time the sidebar opens, so a rename elsewhere shows.
  useEffect(() => {
    if (!open && edits) return;
    let live = true;
    listProjects().then((list) => live && setEdits(list), () => live && setEdits((e) => e || []));
    return () => {
      live = false;
    };
  }, [open]);
  useEffect(() => {
    if (open && wantSearch.current) {
      wantSearch.current = false;
      search.current?.focus();
    }
  }, [open]);

  const q = query.trim().toLowerCase();
  const others = (edits || []).filter((e) => e.id !== currentId && (!q || e.name.toLowerCase().includes(q))).slice(0, 8);
  const current = (edits || []).find((e) => e.id === currentId);
  const showCurrent = !q || currentName.toLowerCase().includes(q);

  // Inside another page (Create Video, Create Film) the edit belongs to that page: only the tools show.
  if (embedded) {
    return (
      <nav className={`ve-nav${open ? " is-open" : ""}`} aria-label="Tools">
        <div className="ve-nav-head">
          <button type="button" className="ve-nav-toggle" onClick={onToggle} aria-expanded={open} aria-label={open ? "Collapse sidebar" : "Expand sidebar"} title={open ? "Collapse sidebar" : "Expand sidebar"}>
            {open ? <PanelLeftClose size={18} strokeWidth={1.75} /> : <PanelLeftOpen size={18} strokeWidth={1.75} />}
          </button>
        </div>
        <div className="ve-nav-foot">{children}</div>
      </nav>
    );
  }
  return (
    <nav className={`ve-nav${open ? " is-open" : ""}`} aria-label="Edits">
      <div className="ve-nav-head">
        <button type="button" className="ve-nav-toggle" onClick={onToggle} aria-expanded={open} aria-label={open ? "Collapse sidebar" : "Expand sidebar"} title={open ? "Collapse sidebar" : "Expand sidebar"}>
          {open ? <PanelLeftClose size={18} strokeWidth={1.75} /> : <PanelLeftOpen size={18} strokeWidth={1.75} />}
        </button>
        {open ? (
          <>
            <strong>Edits</strong>
            <button type="button" className="ve-nav-link" onClick={onAll}>
              See all
            </button>
          </>
        ) : null}
      </div>
      {open ? (
        <SearchField ref={search} value={query} onChange={setQuery} placeholder="Search edits" size="sm" className="ve-nav-search" />
      ) : (
        <SideItem
          icon={<Search size={18} strokeWidth={1.75} />}
          label="Search edits"
          className="ve-nav-wide"
          onClick={() => {
            wantSearch.current = true;
            onToggle();
          }}
        />
      )}
      <SideItem icon={<Plus size={18} strokeWidth={1.75} />} label="New edit" onClick={onNew} />
      <div className="ve-nav-list">
        {showCurrent ? (
          <button type="button" className="ve-nav-item ve-nav-edit is-current" aria-current="page" title={currentName} aria-label={currentName}>
            <Cover cover={current?.cover} />
            <span>{currentName}</span>
          </button>
        ) : null}
        {open
          ? others.map((e) => (
              <button key={e.id} type="button" className="ve-nav-item ve-nav-edit" onClick={() => onOpenEdit(e.id)} title={e.name}>
                <Cover cover={e.cover} />
                <span>{e.name}</span>
                <small>{ago(e.updatedAt)}</small>
              </button>
            ))
          : null}
        {open && q && !showCurrent && !others.length ? <p className="ve-nav-empty">No edit is called “{query.trim()}”.</p> : null}
      </div>
      <SideItem icon={<LayoutGrid size={18} strokeWidth={1.75} />} label={`All edits${edits ? ` (${edits.length})` : ""}`} className="ve-nav-wide" onClick={onAll} />
      <div className="ve-nav-foot">{children}</div>
    </nav>
  );
}

// The edits Juel's Editor specialist can make on the open project, run here through the same commands
// the old assistant used. Ones that spend credits carry what they spend, so Juel quotes and checks them.
const PAID_EDITS: Record<string, string> = { voiceover: "speech", generate_captions: "transcription", remove_pauses: "transcription", generate_image: "image", generate_video: "video" };
const JUEL_EDITS: JuelPageTools = {
  specialist: "editor",
  actions: Object.fromEntries(Object.entries(VIBE_ACTIONS).map(([type, a]) => [type, { args: a.args, about: a.about, ...(PAID_EDITS[type] ? { risk: "paid" as const, cost: PAID_EDITS[type] } : { risk: "change" as const }) }])),
};
// What the edit actions mean, for the editor specialist (it reads these with the project summary).
const JUEL_PRESETS = SOUND_PRESETS.map((p) => `${p.id} (${p.character})`);
const JUEL_TIMELINE_RULES = "Times are seconds. Video clips sit on tracks (0 = base sequence, higher tracks composite in front); sound sits on audio lanes. A clip plays source seconds in..out starting at timeline start. Captions are word-timed cues. Use ids exactly as given; never invent asset ids (generate or ask for media). voicePresets are the values for update_item preset.";

function Editor({ onBack, onOpenEdit, onNew, backLabel = "Projects", embedded = false }: { onBack: () => void; onOpenEdit: (id: string) => void; onNew: () => void; backLabel?: string; embedded?: boolean }) {
  const name = useVibe((s) => s.project.name);
  const projectId = useVibe((s) => s.project.id);
  // Juel works on this edit: it reads the project as it is when a message is sent, and its edits run here.
  useEffect(() => {
    const stop = provideJuelContext(() => {
      const project = vibe.get().project;
      return { surface: "editor", entityId: project.id, label: `Vibe Edit · ${project.name || "untitled"}`, details: summarizeProject(project, { playhead: vibe.get().playhead, selection: vibe.get().selection, voices: getVoices().map((v) => v.name).slice(0, 40), voicePresets: JUEL_PRESETS, rules: JUEL_TIMELINE_RULES }), clientTools: JUEL_EDITS };
    });
    const onActions = (event: Event) => {
      const { surface, actions } = (event as CustomEvent<{ surface: string; actions: Array<{ type: string; args: Record<string, unknown> }> }>).detail || {};
      if (surface !== "editor" || !actions?.length) return;
      void runActions(actions).then(({ done, failed }) => {
        if (failed.length) toast.error(failed.join(" · "));
        else if (done.length) toast.success(done.join(" · "));
      });
    };
    window.addEventListener("juel:page-actions", onActions);
    return () => {
      stop();
      window.removeEventListener("juel:page-actions", onActions);
    };
  }, [projectId]);
  const aspect = useVibe((s) => s.project.aspect);
  // The assistant is the card on the left; the right card holds the tool panels and the
  // selected item's details as tabs.
  const saved = useRef(readLayout()).current;
  const [chatOpen, setChatOpen] = useState(saved.chat ?? true);
  const [tab, setTab] = useState<PanelId | "props" | null>(saved.panel === false ? null : "media");
  const [timelineOpen, setTimelineOpen] = useState(saved.timeline ?? true);
  const [navOpen, setNavOpen] = useState(saved.nav ?? false);
  // Remember which cards this viewer keeps open.
  useEffect(() => writeLayout({ chat: chatOpen, panel: Boolean(tab), timeline: timelineOpen, nav: navOpen }), [chatOpen, tab, timelineOpen, navOpen]);
  const importer = useRef<HTMLInputElement>(null);
  const [snapping, setSnapping] = useState(true);
  const [voicesLoading, setVoicesLoading] = useState(true);
  const [over, setOver] = useState(false);
  const selectedId = useVibe((s) => (s.selection.length === 1 ? s.selection[0] : ""));
  // Properties follow the selection, the way every editor's inspector does.
  useEffect(() => {
    // Even when the side panel is closed (narrow windows start with it folded): a selected clip's
    // properties, a recap cut's scene match included, should never be one hidden click away.
    // Phones are the exception: there the panel covers the editor, so a tap on a clip selects it
    // and the timeline's Details button opens its properties.
    if (selectedId && !window.matchMedia("(max-width: 900px)").matches) setTab("props");
  }, [selectedId]);

  useEffect(() => {
    const controller = new AbortController();
    loadVoiceProfiles(controller.signal)
      .then(({ profiles }) => setVoices(profiles))
      .catch(() => {})
      .finally(() => setVoicesLoading(false));
    return () => controller.abort();
  }, []);

  // Phones start with the cards folded so the preview has room.
  useEffect(() => {
    if (window.matchMedia("(max-width: 900px)").matches) {
      setTab(null);
      setChatOpen(false);
      setNavOpen(false);
    }
  }, []);

  // Keyboard: transport, editing, selection, and markers. The timeline's
  // shortcut sheet (?) lists every key handled here.
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
      } else if (mod && e.key.toLowerCase() === "a") {
        e.preventDefault();
        const p = s.project;
        vibe.select([...p.clips, ...p.audio, ...p.texts, ...p.captions.cues].map((i) => i.id).filter((id) => !isLocked(p, id)));
      } else if (mod && e.key.toLowerCase() === "d") {
        e.preventDefault();
        const { project, ids } = duplicateItems(s.project, s.selection);
        if (ids.length) {
          vibe.commit(project);
          vibe.select(ids);
        }
      } else if (!mod && !e.shiftKey && e.key.toLowerCase() === "s") {
        vibe.commit((p) => splitAt(p, s.playhead, s.selection.length ? s.selection : undefined));
      } else if (!mod && !e.altKey && (e.key.toLowerCase() === "q" || e.key.toLowerCase() === "w")) {
        // With nothing selected, Q and W act on the base-track clip under the playhead.
        const under = s.project.clips.filter((c) => c.track === 0 && s.playhead > c.start && s.playhead < c.start + c.out - c.in).map((c) => c.id);
        vibe.commit((p) => trimToTime(p, s.selection.length ? s.selection : under, s.playhead, e.key.toLowerCase() === "q" ? "start" : "end"));
      } else if (!mod && !e.altKey && e.key.toLowerCase() === "m") {
        vibe.commit((p) => toggleMarker(p, s.playhead));
      } else if ((e.key === "Delete" || e.key === "Backspace") && s.selection.length) {
        e.preventDefault();
        // The magnetic main track closes gaps; Shift does the opposite of the current mode.
        const close = s.magnetic !== e.shiftKey;
        if (close) vibe.commit((p) => compactTracks(rippleDeleteItems(p, s.selection)));
        else vibe.commit((p) => compactTracks(deleteItems(p, s.selection.filter((id) => !isLocked(p, id)))));
      } else if (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight") && s.selection.length) {
        e.preventDefault();
        const delta = (e.key === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? 1 : 1 / 30);
        vibe.commit((p) => moveItems(p, s.selection, delta), "nudge");
      } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        const points = editPoints(s.project);
        const target = e.key === "ArrowUp" ? [...points].reverse().find((t) => t < s.playhead - 1e-3) : points.find((t) => t > s.playhead + 1e-3);
        if (target !== undefined) vibe.seek(target);
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
      className={`ve-editor${navOpen ? " has-nav" : ""}`}
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
        <nav className="ve-crumbs" aria-label="Breadcrumb">
          <button type="button" className="ve-crumb-back" onClick={onBack} aria-label={`Back to ${backLabel.toLowerCase()}`}>
            <ChevronLeft size={17} /> <span className="ve-label-wide">{backLabel}</span>
          </button>
          <span className="ve-crumb-sep" aria-hidden="true">/</span>
          <label className="ve-name-wrap">
            <input className="ve-name" value={name} onChange={(e) => vibe.commit((p) => ({ ...p, name: e.target.value.slice(0, 120), updatedAt: Date.now() }), "rename")} aria-label="Project name" spellCheck={false} size={Math.max(8, Math.min(40, name.length + 1))} />
            <Pencil size={14} aria-hidden="true" />
          </label>
          <SaveBadge />
        </nav>
        <div className="ve-top-end">
          <StatusStrip />
          <AspectPicker variant="chip" label="Frame" value={aspect} onChange={(next) => vibe.commit((p) => ({ ...p, aspect: next as VibeAspect, updatedAt: Date.now() }))} options={VIBE_ASPECTS.map((a) => ({ value: a.id, hint: a.label }))} />
          <ShareButton />
          <ExportMenu />
        </div>
      </header>

      <Sidebar open={navOpen} onToggle={() => setNavOpen((o) => !o)} onAll={onBack} onOpenEdit={onOpenEdit} onNew={onNew} embedded={embedded}>
        <SideItem icon={<Upload size={18} strokeWidth={1.75} />} label="Import files" onClick={() => importer.current?.click()} />
        <SideItem icon={<WandSparkles size={18} strokeWidth={1.75} />} label="Auto edit" on={tab === "auto"} onClick={() => setTab(tab === "auto" ? "media" : "auto")} />
        <span className="ve-nav-sep ve-nav-phone" aria-hidden="true" />
        <SideItem icon={<PanelLeft size={18} strokeWidth={1.75} />} label="Assistant" on={chatOpen} className="ve-nav-phone" onClick={() => setChatOpen((o) => !o)} />
        <SideItem icon={<PanelRight size={18} strokeWidth={1.75} />} label="Tools" on={Boolean(tab)} className="ve-nav-phone" onClick={() => setTab(tab ? null : "media")} />
        <SideItem icon={<PanelBottom size={18} strokeWidth={1.75} />} label="Timeline" on={timelineOpen} className="ve-nav-phone" onClick={() => setTimelineOpen((o) => !o)} />
        <input
          ref={importer}
          type="file"
          multiple
          hidden
          accept="video/*,audio/*,image/*"
          onChange={(e) => {
            const files = [...(e.target.files || [])];
            e.target.value = "";
            if (files.length) {
              setTab("media");
              void uploadFiles(files);
            }
          }}
        />
      </Sidebar>

      <div className={`ve-body${chatOpen ? " has-chat" : ""}${tab ? " has-panel" : ""}${timelineOpen ? "" : " is-tall"}`}>
        {chatOpen ? (
          <aside className="ve-card ve-chat-card" aria-label="Assistant">
            <JuelPanel embedded headStart={<button type="button" className="ve-collapse" onClick={() => setChatOpen(false)} aria-label="Hide Juel" title="Hide Juel"><PanelLeft size={17} strokeWidth={1.75} /></button>} />
          </aside>
        ) : (
          <aside className="ve-card ve-fold" aria-label="Assistant, hidden">
            <button type="button" className="ve-collapse" onClick={() => setChatOpen(true)} aria-label="Show assistant" title="Show assistant">
              <PanelLeft size={17} strokeWidth={1.75} />
            </button>
          </aside>
        )}
        <main className="ve-center">
          <Preview />
        </main>
        {tab ? (
          <aside className="ve-card ve-tabs-card" aria-label={tab === "props" ? "Details" : PANELS.find((p) => p.id === tab)?.label}>
            <div className="ve-tabs" role="tablist" aria-label="Tools">
              {PANELS.filter((p) => p.id !== "auto").map((p) => (
                <button key={p.id} type="button" role="tab" aria-selected={tab === p.id} className={tab === p.id ? "is-on" : ""} onClick={() => setTab(p.id)} aria-label={p.label} title={p.label}>
                  {p.icon}
                  <span>{p.short || p.label}</span>
                </button>
              ))}
              <button type="button" role="tab" aria-selected={tab === "props"} className={tab === "props" ? "is-on" : ""} onClick={() => setTab("props")} aria-label="Details" title="Details">
                <SlidersHorizontal size={18} />
                <span>Details</span>
              </button>
              <button type="button" className="ve-collapse ve-tabs-collapse" onClick={() => setTab(null)} aria-label="Hide tools" title="Hide tools">
                <PanelRight size={17} strokeWidth={1.75} />
              </button>
            </div>
            {tab === "props" ? (
              <Inspector />
            ) : (
              <div className="ve-panel-body">
                {tab === "auto" ? <h2 className="ve-panel-title">Auto edit</h2> : null}
                <PanelBody panel={tab} voicesLoading={voicesLoading} />
              </div>
            )}
          </aside>
        ) : (
          <aside className="ve-card ve-fold" aria-label="Tools, hidden">
            <button type="button" className="ve-collapse" onClick={() => setTab("media")} aria-label="Show tools" title="Show media, captions, and more">
              <PanelRight size={17} strokeWidth={1.75} />
            </button>
          </aside>
        )}
      </div>

      {timelineOpen ? (
        <Timeline snapping={snapping} onToggleSnap={() => setSnapping((s) => !s)} onCollapse={() => setTimelineOpen(false)} onDetails={() => setTab("props")} />
      ) : (
        <section className="ve-card ve-fold ve-fold-h" aria-label="Timeline, hidden">
          <button type="button" className="ve-collapse" onClick={() => setTimelineOpen(true)} aria-label="Show timeline" title="Show timeline">
            <PanelBottom size={17} strokeWidth={1.75} />
          </button>
        </section>
      )}
      {over ? (
        <div className="ve-dropzone" aria-hidden="true">
          <Upload size={28} />
          <strong>Drop to add to your edit</strong>
        </div>
      ) : null}
    </div>
  );
}

/** Vibe Edit, the one editor. On its own page it has a home of edits; `embedded` puts one edit inside another page
 *  (Create Video, Create Film), whose back button returns there. */
export default function VibeEdit({ theme, projectId, embedded }: { theme: "light" | "dark"; projectId?: string; embedded?: { backLabel: string; onBack: () => void } }) {
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
        if (embedded) embedded.onBack();
        else writeDeepLink({ view: "vibe-edit" }, true);
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

  const flush = async () => {
    vibe.play(false);
    if (vibe.get().save !== "saved") await saveProject(vibe.get().project).catch(() => {});
  };
  const back = async () => {
    await flush();
    if (embedded) return embedded.onBack();
    setOpenId(undefined);
    writeDeepLink({ view: "vibe-edit" });
  };
  const switchTo = async (id: string) => {
    await flush();
    open(id);
  };
  const startNew = async () => {
    await flush();
    await create(vibe.get().project.aspect);
  };

  return (
    <div className="ve-root" data-theme={theme}>
      {editing ? (
        <Editor onBack={() => void back()} onOpenEdit={(id) => void switchTo(id)} onNew={() => void startNew()} backLabel={embedded?.backLabel} embedded={Boolean(embedded)} />
      ) : openId || embedded ? (
        <div className="ve-loading">
          <Loader2 size={20} className="ui-spin" /> Opening your edit…
        </div>
      ) : (
        <Home onOpen={open} onCreate={(a, f) => void create(a, f)} />
      )}
    </div>
  );
}
