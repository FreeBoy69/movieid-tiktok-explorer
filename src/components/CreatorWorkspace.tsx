import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  Archive,
  Bookmark,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  Clapperboard,
  Clock,
  Compass,
  Copy,
  Download,
  Eye,
  FileText,
  Film,
  FolderOpen,
  ImagePlus,
  Layers,
  ListOrdered,
  ListVideo,
  Loader2,
  Mic,
  Music,
  Pause,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Scissors,
  Search,
  Shuffle,
  SlidersHorizontal,
  Sparkles,
  Timer,
  Trash2,
  TrendingUp,
  Type,
  Users,
  WandSparkles,
  X,
  Youtube,
  Image as ImageIcon,
  CircleAlert,
} from "lucide-react";
import { type CreatorProject, type ChannelStyleProfile as ChannelStyle } from "../types";
import { writeDeepLink, type TikTokDeepLink } from "../utils/tiktokRoute";
import {
  assertStageReady,
  rankDiscoveryChannels,
  splitCreatorScene,
} from "../utils/creatorPipeline.js";
import { VoiceoverStudio } from "./VoiceoverStudio";
import { StandardVideoCard } from "./StandardCards";
import "./CreatorWorkspace.css";

const stages: Array<[string, string]> = [
  ["brief", "Brief"],
  ["title", "Title"],
  ["script", "Script"],
  ["seo", "Description"],
  ["voiceover", "Voiceover"],
  ["soundtrack", "Soundtrack"],
  ["visualPlan", "Visuals"],
  ["thumbnail", "Thumbnail"],
  ["studio", "Studio"],
  ["review", "Export"],
];
const trackedStages = ["title", "script", "seo", "voiceover", "soundtrack", "visualPlan", "thumbnail", "review"];
const stageCopy: Record<string, { name: string; text: string; icon: ReactNode }> = {
  brief: { name: "Project Brief", text: "Set the story, audience, and defaults every later stage uses.", icon: <FileText size={18} /> },
  title: { name: "Title Generator", text: "Generate titles from examples, a channel, or your saved style.", icon: <Type size={18} /> },
  script: { name: "Script Generator", text: "Write narration built for retention, with optional web research.", icon: <FileText size={18} /> },
  seo: { name: "Description Generator", text: "Description, tags, chapters, and disclosure, ready to publish.", icon: <ListOrdered size={18} /> },
  voiceover: { name: "Voiceover Generator", text: "Turn the script into narration with your chosen voice.", icon: <Mic size={18} /> },
  soundtrack: { name: "Soundtrack", text: "Find royalty-free music that follows the story's mood.", icon: <Music size={18} /> },
  visualPlan: { name: "Visuals", text: "Split the narration into scenes, review prompts, then generate images.", icon: <ImageIcon size={18} /> },
  thumbnail: { name: "Thumbnail Generator", text: "Describe the click moment and compare three variants.", icon: <ImagePlus size={18} /> },
  review: { name: "Export", text: "Validate, render, and download everything in one bundle.", icon: <Download size={18} /> },
};
const NICHE_SEEDS = [
  "history documentaries",
  "true crime cases",
  "space and astronomy facts",
  "anime recaps",
  "personal finance explainers",
  "horror stories",
  "geography explained",
  "mythology stories",
  "psychology facts",
  "tech explainers",
  "movie recaps",
  "ancient civilizations",
  "business case studies",
  "animal documentaries",
];
type Job = {
  id: string;
  stage: string;
  status: string;
  progress: number;
  message: string;
  error?: string;
  createdAt: number;
};
export async function creatorApi(url: string, body?: unknown, method?: string) {
  const response = await fetch(url, {
    method: method || (body === undefined ? "GET" : "POST"),
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error || "Request failed. Try again.") as Error & {
      status?: number;
    };
    error.status = response.status;
    throw error;
  }
  return data;
}
const compact = (value: number) =>
  new Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value || 0);
const durationLabel = (seconds: number) => {
  const value = Math.max(0, Math.round(Number(seconds) || 0));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
};
const ageLabel = (value: string) => {
  const time = Date.parse(value || "");
  if (!Number.isFinite(time)) return "date unknown";
  const days = Math.max(0, Math.floor((Date.now() - time) / 86400000));
  return days < 1
    ? "today"
    : days < 30
      ? `${days}d ago`
      : `${Math.floor(days / 30)}mo ago`;
};
const dateLabel = (value?: number) =>
  new Date(value || Date.now()).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
const readFile = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
const doneStages = (p: CreatorProject) =>
  trackedStages.filter((key) => p.outputs?.[key] && !p.outputs[key].stale);
const projectStatus = (p: CreatorProject) =>
  p.status === "archived"
    ? { label: "Archived", tone: "" }
    : p.outputs?.review?.asset
      ? { label: "Rendered", tone: "is-ready" }
      : doneStages(p).length
        ? { label: "In progress", tone: "is-running" }
        : { label: "Draft", tone: "" };

function Action({
  label,
  children,
  className,
  ...props
}: {
  label: string;
  children: ReactNode;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      className={className || "maker-icon"}
      {...props}
    >
      {children}
    </button>
  );
}
function Empty({
  title,
  text,
  icon,
  children,
}: {
  title: string;
  text?: string;
  icon?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="maker-empty">
      {icon || <Film size={28} />}
      <h2>{title}</h2>
      {text && <p>{text}</p>}
      {children && <div className="maker-actions">{children}</div>}
    </div>
  );
}
function PageHead({
  title,
  text,
  centered,
  children,
}: {
  title: string;
  text: ReactNode;
  centered?: boolean;
  children?: ReactNode;
}) {
  return (
    <header className={centered ? "maker-hero" : "maker-pagehead"}>
      <div>
        <h1>{title}</h1>
        <p>{text}</p>
      </div>
      {children && <div className="maker-actions">{children}</div>}
    </header>
  );
}
function Modal({
  title,
  onClose,
  wide,
  footer,
  children,
}: {
  title: string;
  onClose: () => void;
  wide?: boolean;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const focusable = () =>
      ref.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
    focusable()?.[0]?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (!items?.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("keydown", handleKey);
      previous?.focus();
    };
  }, []);
  return (
    <div className="maker-modal-backdrop" onMouseDown={onClose}>
      <section
        ref={ref}
        className={`maker-modal ${wide ? "is-wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {wide ? (
          <>
            <header>
              <h2>{title}</h2>
              <Action label="Close" onClick={onClose}>
                <X size={18} />
              </Action>
            </header>
            <div className="maker-modal-body">{children}</div>
            {footer && <footer>{footer}</footer>}
          </>
        ) : (
          <>
            <h2>{title}</h2>
            {children}
            {footer && <div className="maker-actions">{footer}</div>}
          </>
        )}
      </section>
    </div>
  );
}
function Disclosure({
  label,
  summary,
  defaultOpen,
  children,
}: {
  label: string;
  summary?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details className="maker-disclosure" open={defaultOpen}>
      <summary>
        <span>
          {label}
          {summary && <small> · {summary}</small>}
        </span>
        <ChevronDown size={16} />
      </summary>
      <div className="maker-disclosure-body">{children}</div>
    </details>
  );
}
function Option({
  name,
  value,
  checked,
  onChange,
  title,
  text,
  icon,
  tone,
}: {
  name: string;
  value: string;
  checked: boolean;
  onChange: () => void;
  title: string;
  text: string;
  icon: ReactNode;
  tone?: string;
}) {
  return (
    <label className="maker-option">
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={onChange}
      />
      <span className={`maker-tile ${tone || ""}`}>{icon}</span>
      <span className="maker-option-body">
        <strong>{title}</strong>
        <span>{text}</span>
      </span>
      <span className="maker-radio" aria-hidden="true" />
    </label>
  );
}

export function CreatorWorkspace({
  route,
  accountId,
  theme,
}: {
  route: TikTokDeepLink;
  accountId?: string;
  theme: "light" | "dark";
}) {
  const [error, setError] = useState("");
  return (
    <section className="maker-workspace" data-theme={theme}>
      {error && (
        <div className="maker-error" role="alert">
          <span>{error}</span>
          <Action label="Dismiss error" onClick={() => setError("")}>
            <X size={16} />
          </Action>
        </div>
      )}
      {!accountId ? (
        <div className="maker-scroll">
          <div className="maker-page">
            <Empty
              title="Connect a channel to start"
              text="Projects, styles, and research are saved per channel, so connect one first."
            >
              <button
                className="maker-primary"
                onClick={() => writeDeepLink({ view: "channels" })}
              >
                Connect channel
              </button>
            </Empty>
          </div>
        </div>
      ) : route.projectId ? (
        <ProjectEditor
          key={`${accountId}:${route.projectId}`}
          id={route.projectId}
          stage={route.projectStage || "title"}
          accountId={accountId}
          theme={theme}
          onError={setError}
        />
      ) : route.view === "discover" ? (
        <Discovery
          key={accountId}
          accountId={accountId}
          query={route.discoveryQuery}
          theme={theme}
          onError={setError}
        />
      ) : route.view === "styles" ? (
        <Styles key={accountId} accountId={accountId} onError={setError} />
      ) : route.view === "create" ? (
        <CreateHome key={accountId} accountId={accountId} onError={setError} />
      ) : (
        <Projects key={accountId} accountId={accountId} onError={setError} />
      )}
    </section>
  );
}

async function createProject(
  accountId: string,
  input: Record<string, unknown>,
  stage = "title",
) {
  const { project } = await creatorApi("/api/creator-projects", {
    accountId,
    sourceType: "maker",
    title: "Untitled video",
    ...input,
  });
  writeDeepLink({ view: "projects", projectId: project.id, projectStage: stage });
  return project;
}

/* Select a Style: the modal TubeGen opens from every Create Video entry point. */
function NewVideoModal({
  accountId,
  styles,
  collections,
  onClose,
  onError,
}: {
  accountId: string;
  styles: ChannelStyle[];
  collections: any[];
  onClose: () => void;
  onError: (e: string) => void;
}) {
  const [mode, setMode] = useState(styles.length ? "style" : "blank"),
    [styleId, setStyleId] = useState(styles[0]?.id || ""),
    [collectionId, setCollectionId] = useState(""),
    [channelUrl, setChannelUrl] = useState(""),
    [title, setTitle] = useState(""),
    [busy, setBusy] = useState(false);
  const research = collections.filter((c) => c.data?.kind !== "bookmarks");
  async function start() {
    setBusy(true);
    try {
      const style = styles.find((s) => s.id === styleId);
      const collection = research.find((c) => c.id === collectionId);
      await createProject(accountId, {
        title: title.trim() || "Untitled video",
        brief:
          mode === "collection" && collection
            ? `Research query: ${collection.data?.search || ""}\nSelected evidence:\n${(collection.data?.selected || []).join("\n")}`
            : mode === "style"
              ? style?.niche || ""
              : "",
        styleId: mode === "style" ? styleId : "",
        settings: mode === "style" ? style?.profile?.settings || {} : undefined,
        researchCollectionId: mode === "collection" ? collectionId : "",
        sourceUrl: mode === "channel" ? channelUrl : "",
        createdFrom:
          mode === "collection"
            ? "research-collection"
            : mode === "channel"
              ? "channel-reference"
              : mode === "style"
                ? "style-profile"
                : "video-maker",
      });
    } catch (e) {
      onError((e as Error).message);
      setBusy(false);
    }
  }
  const ready =
    (mode === "style" && styleId) ||
    (mode === "collection" && collectionId) ||
    (mode === "channel" && /^https?:\/\//.test(channelUrl)) ||
    mode === "blank";
  return (
    <Modal
      title="Start a new video"
      wide
      onClose={onClose}
      footer={
        <>
          <button className="maker-outline" onClick={onClose}>
            Cancel
          </button>
          <button
            className="maker-primary"
            disabled={busy || !ready}
            onClick={() => void start()}
          >
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
            {busy ? "Creating project" : "Create project"}
          </button>
        </>
      }
    >
      <div className="maker-stack">
        <label className="maker-field">
          Working title
          <input
            value={title}
            maxLength={180}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Untitled video — you can generate one next"
          />
        </label>
        <div className="maker-options" role="radiogroup" aria-label="Start from">
          <Option
            name="start-from"
            value="style"
            checked={mode === "style"}
            onChange={() => setMode("style")}
            title="Start from a style"
            text="Reuse a saved channel's references, word count, voice, and pacing."
            icon={<Sparkles size={18} />}
          />
          {mode === "style" && (
            <div className="maker-option-extra">
              {styles.length ? (
                <div className="maker-style-picker">
                  {styles.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      aria-pressed={styleId === s.id}
                      onClick={() => setStyleId(s.id)}
                    >
                      <StyleCover style={s} />
                      <strong>{s.name}</strong>
                      <small>{s.profile?.settings?.wordCount || 600} words</small>
                    </button>
                  ))}
                  <button
                    type="button"
                    className="is-dashed"
                    onClick={() => writeDeepLink({ view: "styles" })}
                  >
                    <Plus size={18} />
                    <strong>Create style</strong>
                  </button>
                </div>
              ) : (
                <p className="maker-muted maker-small">
                  No styles yet. Copy one from a channel in Niche Finder or Styles.
                </p>
              )}
            </div>
          )}
          <Option
            name="start-from"
            value="collection"
            checked={mode === "collection"}
            onChange={() => setMode("collection")}
            title="Start from saved research"
            text="Turn a Niche Finder collection into the project brief."
            icon={<FolderOpen size={18} />}
            tone="is-ink"
          />
          {mode === "collection" && (
            <div className="maker-option-extra">
              <select
                aria-label="Research collection"
                value={collectionId}
                onChange={(e) => setCollectionId(e.target.value)}
              >
                <option value="">
                  {research.length ? "Choose saved research" : "No saved research yet"}
                </option>
                {research.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <Option
            name="start-from"
            value="channel"
            checked={mode === "channel"}
            onChange={() => setMode("channel")}
            title="Start from a YouTube channel"
            text="Use a reference channel as evidence for titles and structure."
            icon={<Youtube size={18} />}
            tone="is-soft"
          />
          {mode === "channel" && (
            <div className="maker-option-extra">
              <input
                type="url"
                aria-label="Reference channel URL"
                value={channelUrl}
                onChange={(e) => setChannelUrl(e.target.value)}
                placeholder="https://youtube.com/@channel"
              />
            </div>
          )}
          <Option
            name="start-from"
            value="blank"
            checked={mode === "blank"}
            onChange={() => setMode("blank")}
            title="Start blank"
            text="Write your own brief and pick every setting yourself."
            icon={<FileText size={18} />}
            tone="is-line"
          />
        </div>
      </div>
    </Modal>
  );
}
function StyleCover({ style }: { style: ChannelStyle }) {
  const image =
    style.profile?.topVideos?.[0]?.thumbnailUrl ||
    style.profile?.samples?.find((s: any) => s.thumbnailUrl)?.thumbnailUrl ||
    style.profile?.sourceChannel?.thumbnailUrl;
  return image ? (
    <img src={image} alt="" loading="lazy" />
  ) : (
    <span className="maker-cover-fallback">{(style.name || "S")[0]}</span>
  );
}
function useCreatorLibrary(accountId: string, onError: (e: string) => void) {
  const [projects, setProjects] = useState<CreatorProject[]>([]),
    [styles, setStyles] = useState<ChannelStyle[]>([]),
    [collections, setCollections] = useState<any[]>([]),
    [loading, setLoading] = useState(true);
  const refresh = async () => {
    const data = await creatorApi(
      `/api/creator-projects?accountId=${encodeURIComponent(accountId)}`,
    );
    setProjects(data.projects);
  };
  useEffect(() => {
    let active = true;
    Promise.all([
      creatorApi(`/api/creator-projects?accountId=${encodeURIComponent(accountId)}`),
      creatorApi(`/api/channel-styles?accountId=${encodeURIComponent(accountId)}`),
      creatorApi(`/api/maker/collections?accountId=${encodeURIComponent(accountId)}`),
    ])
      .then(([p, s, c]) => {
        if (!active) return;
        setProjects(p.projects || []);
        setStyles(s.styles || []);
        setCollections(c.collections || []);
      })
      .catch((e) => active && onError(e.message))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [accountId]);
  return { projects, styles, collections, loading, refresh };
}

/* Create Video home: TubeGen's dashboard, in AutoYT colors. */
function CreateHome({
  accountId,
  onError,
}: {
  accountId: string;
  onError: (e: string) => void;
}) {
  const { projects, styles, collections, loading } = useCreatorLibrary(accountId, onError);
  const [picker, setPicker] = useState(false);
  const live = projects.filter((p) => p.status !== "archived");
  const month = new Date();
  const thisMonth = projects.filter((p) => {
    const d = new Date(p.createdAt || 0);
    return d.getMonth() === month.getMonth() && d.getFullYear() === month.getFullYear();
  }).length;
  const inProgress = live.filter((p) => !p.outputs?.review?.asset).length;
  const recent = [...live]
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .slice(0, 4);
  return (
    <div className="maker-scroll">
      <div className="maker-page is-wide">
        <PageHead
          title="Create Video"
          text="Start a project, then move from title to script, voice, visuals, and export."
        />
        <div className="maker-feature-grid">
          <article className="maker-feature is-accent">
            <Clapperboard size={20} />
            <h2>Create a video</h2>
            <p>Pick a style or start blank. Every stage saves as you go.</p>
            <button className="maker-feature-cta" onClick={() => setPicker(true)}>
              <Plus size={15} />
              New video
            </button>
          </article>
          <article className="maker-feature is-ink">
            <Compass size={20} />
            <h2>Find a niche</h2>
            <p>Search channels, compare median views, and bookmark what works.</p>
            <button
              className="maker-feature-cta"
              onClick={() => writeDeepLink({ view: "discover" })}
            >
              Open Niche Finder
            </button>
          </article>
          <article className="maker-feature">
            <Layers size={20} />
            <h2>Your styles</h2>
            <p>
              {styles.length
                ? `${styles.length} saved ${styles.length === 1 ? "style" : "styles"} keep voice, pacing, and length consistent.`
                : "Save a channel's voice, pacing, and length to reuse on every video."}
            </p>
            <button
              className="maker-feature-cta"
              onClick={() => writeDeepLink({ view: "styles" })}
            >
              Manage styles
            </button>
          </article>
        </div>
        <div className="maker-stats">
          {[
            ["Total videos", live.length, "All active projects", <Film key="a" size={16} />],
            ["This month", thisMonth, "Projects started", <TrendingUp key="b" size={16} />],
            ["In progress", inProgress, "Not rendered yet", <Clock key="c" size={16} />],
          ].map(([label, value, caption, icon]) => (
            <div className="maker-card maker-stat" key={String(label)}>
              <div>
                <span>{label}</span>
                {icon}
              </div>
              <strong>{loading ? "–" : (value as number)}</strong>
              <small>{caption}</small>
            </div>
          ))}
        </div>
        <div className="maker-section-title">
          <h2>Continue where you left off</h2>
          {live.length > 4 && (
            <button onClick={() => writeDeepLink({ view: "projects" })}>
              View all
              <ArrowUpRight size={14} />
            </button>
          )}
        </div>
        {loading ? (
          <div className="maker-loading">
            <Loader2 className="animate-spin" />
            Loading projects
          </div>
        ) : recent.length ? (
          <div className="maker-card maker-list">
            {recent.map((p) => (
              <ProjectRow key={p.id} project={p} styles={styles} compact />
            ))}
          </div>
        ) : (
          <Empty
            title="No projects yet"
            text="Create your first video project to get started."
          >
            <button className="maker-primary" onClick={() => setPicker(true)}>
              <Plus size={16} />
              New video
            </button>
          </Empty>
        )}
      </div>
      {picker && (
        <NewVideoModal
          accountId={accountId}
          styles={styles}
          collections={collections}
          onClose={() => setPicker(false)}
          onError={onError}
        />
      )}
    </div>
  );
}
function ProjectRow({
  project: p,
  styles,
  compact: small,
  open,
  onToggle,
  children,
}: {
  project: CreatorProject;
  styles: ChannelStyle[];
  compact?: boolean;
  open?: boolean;
  onToggle?: () => void;
  children?: ReactNode;
}) {
  const status = projectStatus(p);
  const style = styles.find((s) => s.id === p.styleId);
  const done = doneStages(p);
  const go = () =>
    writeDeepLink({
      view: "projects",
      projectId: p.id,
      projectStage: !p.stage || p.stage === "overview" ? "title" : p.stage,
    });
  return (
    <article className="maker-history-row" data-open={open || undefined}>
      <div className="maker-history-main">
        <button className="maker-history-open" onClick={go}>
          <span className="maker-history-thumb">
            {p.outputs?.thumbnail?.asset ? (
              <img src={p.outputs.thumbnail.asset} alt="" />
            ) : (
              <Film size={20} />
            )}
          </span>
          <span className="maker-history-text">
            <strong>{p.title}</strong>
            <small>
              <CalendarDays size={12} />
              {dateLabel(p.updatedAt)}
              <span className={`maker-pill-status ${status.tone}`}>{status.label}</span>
              {style && <span>Style: {style.name}</span>}
              <span>
                {done.length}/{trackedStages.length} stages
              </span>
            </small>
          </span>
        </button>
        {small ? (
          <button className="maker-outline" onClick={go}>
            Open
          </button>
        ) : (
          <Action
            label={open ? "Hide actions" : "Show actions"}
            aria-expanded={open}
            onClick={onToggle}
          >
            <ChevronDown size={18} className={open ? "maker-rotate" : ""} />
          </Action>
        )}
      </div>
      {open && children}
    </article>
  );
}

/* Project History */
function Projects({
  accountId,
  onError,
}: {
  accountId: string;
  onError: (e: string) => void;
}) {
  const { projects, styles, collections, loading, refresh } = useCreatorLibrary(accountId, onError);
  const [query, setQuery] = useState(""),
    [archived, setArchived] = useState(false),
    [open, setOpen] = useState(""),
    [picker, setPicker] = useState(false),
    [confirm, setConfirm] = useState<{ project: CreatorProject; status: string } | null>(null),
    [pruning, setPruning] = useState<CreatorProject | null>(null);
  async function mutate(p: CreatorProject, status: string) {
    setConfirm(null);
    try {
      await creatorApi(
        `/api/maker/projects/${p.id}`,
        { status, accountId, expectedVersion: p.version || 1 },
        "PATCH",
      );
      await refresh();
    } catch (e) {
      onError((e as Error).message);
    }
  }
  async function duplicate(p: CreatorProject) {
    try {
      const data = await creatorApi(`/api/maker/projects/${p.id}/duplicate`, {
        accountId,
      });
      writeDeepLink({ view: "projects", projectId: data.project.id, projectStage: "title" });
    } catch (e) {
      onError((e as Error).message);
    }
  }
  const visible = projects
    .filter(
      (p) =>
        (p.status === "archived") === archived &&
        p.title.toLowerCase().includes(query.toLowerCase()),
    )
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const kept = (p: CreatorProject) =>
    [
      "Title, script, and description",
      p.outputs?.voiceover?.asset && "Voiceover audio and transcript",
      p.outputs?.soundtrack?.asset && "Soundtrack and license credit",
      p.outputs?.visualPlan?.scenes?.length &&
        `${p.outputs.visualPlan.scenes.filter((s: any) => s.asset).length} scene images`,
      p.outputs?.thumbnail?.asset && "Thumbnail variants",
      p.outputs?.review?.asset && "Rendered video and export bundle",
    ].filter(Boolean) as string[];
  return (
    <div className="maker-scroll">
      <div className="maker-page is-wide">
        <PageHead title="Project History" text="Reopen, duplicate, archive, or download your video projects.">
          <button className="maker-primary" onClick={() => setPicker(true)}>
            <Plus size={16} />
            New video
          </button>
        </PageHead>
        <div className="maker-history-toolbar">
          <label className="maker-searchbar">
            <Search size={16} />
            <input
              aria-label="Search projects"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search projects"
            />
          </label>
          <div className="maker-segmented">
            <button aria-pressed={!archived} onClick={() => setArchived(false)}>
              Active
            </button>
            <button aria-pressed={archived} onClick={() => setArchived(true)}>
              Archived
            </button>
          </div>
        </div>
        {loading ? (
          <div className="maker-loading">
            <Loader2 className="animate-spin" />
            Loading projects
          </div>
        ) : visible.length ? (
          <div className="maker-card maker-list">
            {visible.map((p) => (
              <ProjectRow
                key={p.id}
                project={p}
                styles={styles}
                open={open === p.id}
                onToggle={() => setOpen(open === p.id ? "" : p.id)}
              >
                <div className="maker-history-actions">
                  <button
                    onClick={() =>
                      writeDeepLink({ view: "projects", projectId: p.id, projectStage: "title" })
                    }
                  >
                    <Pencil size={14} />
                    Edit
                  </button>
                  <button onClick={() => void duplicate(p)}>
                    <Copy size={14} />
                    Duplicate
                  </button>
                  {p.outputs?.review?.bundle && (
                    <a className="mk-btn" href={p.outputs.review.bundle} download>
                      <Download size={14} />
                      Download bundle
                    </a>
                  )}
                  <button onClick={() => setPruning(p)}>
                    <Layers size={14} />
                    Free up space
                  </button>
                  <button
                    onClick={() =>
                      archived ? void mutate(p, "active") : setConfirm({ project: p, status: "archived" })
                    }
                  >
                    {archived ? <RotateCcw size={14} /> : <Archive size={14} />}
                    {archived ? "Restore" : "Archive"}
                  </button>
                  <button
                    className="maker-danger"
                    onClick={() => setConfirm({ project: p, status: "deleted" })}
                  >
                    <Trash2 size={14} />
                    Delete
                  </button>
                </div>
              </ProjectRow>
            ))}
          </div>
        ) : (
          <Empty
            title={archived ? "No archived projects" : query ? "No projects match" : "No projects yet"}
            text={
              archived
                ? "Archived projects keep all of their media and can be restored at any time."
                : query
                  ? "Try a different title."
                  : "Create your first video project to get started."
            }
          >
            {!archived && !query && (
              <button className="maker-primary" onClick={() => setPicker(true)}>
                <Plus size={16} />
                New video
              </button>
            )}
          </Empty>
        )}
      </div>
      {picker && (
        <NewVideoModal
          accountId={accountId}
          styles={styles}
          collections={collections}
          onClose={() => setPicker(false)}
          onError={onError}
        />
      )}
      {pruning && (
        <PruneModal
          accountId={accountId}
          project={pruning}
          onClose={() => setPruning(null)}
          onDone={async () => {
            setPruning(null);
            await refresh();
          }}
          onError={onError}
        />
      )}
      {confirm && (
        <Modal
          title={confirm.status === "deleted" ? "Delete this project?" : "Archive this project?"}
          onClose={() => setConfirm(null)}
          footer={
            <>
              <button className="maker-outline" onClick={() => setConfirm(null)}>
                Cancel
              </button>
              <button
                className={confirm.status === "deleted" ? "maker-destructive" : "maker-primary"}
                onClick={() => void mutate(confirm.project, confirm.status)}
              >
                {confirm.status === "deleted" ? "Delete project" : "Archive project"}
              </button>
            </>
          }
        >
          {confirm.status === "deleted" ? (
            <p>
              “{confirm.project.title}” and its generated media will no longer be accessible.
              This can’t be undone.
            </p>
          ) : (
            <>
              <p>Archiving hides the project from your active list. Nothing is deleted:</p>
              <ul className="maker-kept">
                {kept(confirm.project).map((item) => (
                  <li key={item}>
                    <Check size={14} />
                    {item}
                  </li>
                ))}
              </ul>
            </>
          )}
        </Modal>
      )}
    </div>
  );
}

const bytesLabel = (bytes: number) =>
  bytes >= 1024 ** 3
    ? `${(bytes / 1024 ** 3).toFixed(1)} GB`
    : bytes >= 1024 ** 2
      ? `${(bytes / 1024 ** 2).toFixed(1)} MB`
      : `${Math.max(1, Math.round(bytes / 1024))} KB`;
function PruneModal({
  accountId,
  project,
  onClose,
  onDone,
  onError,
}: {
  accountId: string;
  project: CreatorProject;
  onClose: () => void;
  onDone: () => Promise<void>;
  onError: (e: string) => void;
}) {
  const [storage, setStorage] = useState<any[] | null>(null),
    [chosen, setChosen] = useState<string[]>([]),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    void creatorApi(`/api/maker/projects/${project.id}/storage?accountId=${encodeURIComponent(accountId)}`)
      .then((data) => {
        setStorage(data.storage || []);
        setChosen((data.storage || []).filter((g: any) => g.key === "workspace").map((g: any) => g.key));
      })
      .catch((e) => {
        onError(e.message);
        onClose();
      });
  }, [project.id]);
  const total = (storage || []).reduce((sum, g) => sum + g.bytes, 0);
  const freed = (storage || []).filter((g) => chosen.includes(g.key)).reduce((sum, g) => sum + g.bytes, 0);
  return (
    <Modal
      title="Free up space"
      wide
      onClose={onClose}
      footer={
        <>
          <button className="maker-outline" onClick={onClose}>
            Cancel
          </button>
          <button
            className="maker-destructive"
            disabled={busy || !chosen.length}
            onClick={async () => {
              setBusy(true);
              try {
                await creatorApi(`/api/maker/projects/${project.id}/prune`, {
                  accountId,
                  categories: chosen,
                  confirmed: true,
                  expectedVersion: project.version || 1,
                });
                await onDone();
              } catch (e) {
                onError((e as Error).message);
                setBusy(false);
              }
            }}
          >
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
            Remove {bytesLabel(freed)}
          </button>
        </>
      }
    >
      {!storage ? (
        <div className="maker-loading">
          <Loader2 className="animate-spin" />
          Measuring project files
        </div>
      ) : (
        <div className="maker-stack">
          <p className="maker-muted maker-small maker-flush">
            “{project.title}” uses {bytesLabel(total)}. The brief, script, description, and transcript are always kept, and a
            list of removed files is saved with the project. Removed images and renders can be generated again.
          </p>
          <div className="maker-card maker-checklist">
            {storage.map((group) => (
              <label key={group.key} className={`maker-storage-row ${group.prunable ? "" : "is-locked"}`}>
                <input
                  type="checkbox"
                  disabled={!group.prunable}
                  checked={chosen.includes(group.key)}
                  onChange={(e) =>
                    setChosen((items) => (e.target.checked ? [...items, group.key] : items.filter((key) => key !== group.key)))
                  }
                />
                <span>
                  <strong>{group.label}</strong>
                  <small>
                    {group.files.length} {group.files.length === 1 ? "file" : "files"}
                    {group.prunable ? "" : " · kept"}
                  </small>
                </span>
                <em>{bytesLabel(group.bytes)}</em>
              </label>
            ))}
            {!storage.length && <div>No generated files yet.</div>}
          </div>
        </div>
      )}
    </Modal>
  );
}

/* Niche Finder */
const DEFAULT_FILTERS = {
  minViews: 0,
  minSubs: 0,
  maxSubs: 0,
  faceless: false,
  sort: "score",
  days: 90,
  duration: "any",
  region: "US",
  language: "",
  format: "any",
  minRatio: 0,
  minDurationMinutes: 0,
  maxDurationMinutes: 0,
  includeTerms: "",
  excludeTerms: "",
  facelessUnknown: "include",
};
type Filters = typeof DEFAULT_FILTERS;
const SERVER_FILTERS: Array<keyof Filters> = ["days", "duration", "region"];
function activeFilterChips(filters: Filters) {
  const chips: Array<[keyof Filters, string]> = [];
  if (filters.days !== DEFAULT_FILTERS.days) chips.push(["days", `Last ${filters.days} days`]);
  if (filters.duration !== "any")
    chips.push(["duration", { short: "Under 4 min", medium: "4–20 min", long: "20+ min" }[filters.duration] || filters.duration]);
  if (filters.region !== DEFAULT_FILTERS.region) chips.push(["region", `Region ${filters.region}`]);
  if (filters.format !== "any") chips.push(["format", filters.format === "shorts" ? "Shorts" : "Long-form"]);
  if (filters.language) chips.push(["language", `Language ${filters.language}`]);
  if (filters.faceless) chips.push(["faceless", "Likely faceless"]);
  if (filters.facelessUnknown !== "include")
    chips.push(["facelessUnknown", filters.facelessUnknown === "exclude" ? "Faceless known" : "Faceless unknown"]);
  if (filters.minViews) chips.push(["minViews", `Median views ≥ ${compact(filters.minViews)}`]);
  if (filters.minSubs) chips.push(["minSubs", `Subscribers ≥ ${compact(filters.minSubs)}`]);
  if (filters.maxSubs) chips.push(["maxSubs", `Subscribers ≤ ${compact(filters.maxSubs)}`]);
  if (filters.minRatio) chips.push(["minRatio", `Views/sub ≥ ${filters.minRatio}`]);
  if (filters.minDurationMinutes) chips.push(["minDurationMinutes", `Length ≥ ${filters.minDurationMinutes} min`]);
  if (filters.maxDurationMinutes) chips.push(["maxDurationMinutes", `Length ≤ ${filters.maxDurationMinutes} min`]);
  if (filters.includeTerms) chips.push(["includeTerms", `Includes ${filters.includeTerms}`]);
  if (filters.excludeTerms) chips.push(["excludeTerms", `Excludes ${filters.excludeTerms}`]);
  return chips;
}
function snapshotChannel(c: any) {
  const trim = (v: any) =>
    v && {
      id: v.id,
      url: v.url,
      title: v.title,
      thumbnailUrl: v.thumbnailUrl,
      viewCount: v.viewCount,
      publishedAt: v.publishedAt,
    };
  const { videos, ...rest } = c;
  return { ...rest, bestVideo: trim(c.bestVideo), recentVideo: trim(c.recentVideo), savedAt: Date.now() };
}
function ChannelCard({
  channel: c,
  selected,
  bookmarked,
  copying,
  onSelect,
  onBookmark,
  onSimilar,
  onCopyStyle,
}: {
  channel: any;
  selected: boolean;
  bookmarked: boolean;
  copying: boolean;
  onSelect: (value: boolean) => void;
  onBookmark: () => void;
  onSimilar: () => void;
  onCopyStyle: () => void;
}) {
  const [broken, setBroken] = useState(false);
  const tags = [c.niche, c.language && c.language.toUpperCase(), c.region].filter(Boolean);
  return (
    <article className="maker-card maker-channel" data-selected={selected || undefined}>
      <div className="maker-channel-top">
        {c.thumbnailUrl && !broken ? (
          <img className="maker-avatar" src={c.thumbnailUrl} alt="" onError={() => setBroken(true)} />
        ) : (
          <span className="maker-avatar" aria-hidden="true">
            {(c.title || "C")[0]}
          </span>
        )}
        <div className="maker-channel-name">
          <a href={c.url} target="_blank" rel="noreferrer">
            {c.title || "Channel"}
            <ArrowUpRight size={14} />
          </a>
          <small>{c.handle || (c.niche ? `${c.niche} channel` : "YouTube channel")}</small>
        </div>
        <label className="maker-select-check" title="Select for project">
          <input
            type="checkbox"
            aria-label={`Select ${c.title}`}
            checked={selected}
            onChange={(e) => onSelect(e.target.checked)}
          />
        </label>
        <Action
          label={bookmarked ? "Remove bookmark" : "Bookmark channel"}
          className="maker-icon maker-bookmark"
          aria-pressed={bookmarked}
          onClick={onBookmark}
        >
          <Bookmark size={17} />
        </Action>
      </div>
      <div className="maker-chips">
        <span className="maker-chip" title="Subscribers">
          <Users size={13} />
          {c.subscribers === null || c.subscribers === undefined ? "Unknown" : compact(c.subscribers)}
        </span>
        <span className="maker-chip" title="Median views across sampled videos">
          <Eye size={13} />
          {compact(c.medianViews)} median
        </span>
        <span className="maker-chip" title="Videos in this sample">
          <ListVideo size={13} />
          {c.sampleCount} sampled
        </span>
        <span className="maker-chip" title="Median gap between sampled uploads">
          <CalendarDays size={13} />
          {c.uploadCadenceDays === null || c.uploadCadenceDays === undefined
            ? "Cadence unknown"
            : `Every ~${Math.max(1, Math.round(c.uploadCadenceDays))}d`}
        </span>
        {c.medianDurationSeconds ? (
          <span className="maker-chip" title="Median video length">
            <Timer size={13} />
            {durationLabel(c.medianDurationSeconds)}
          </span>
        ) : null}
        <span className="maker-chip is-accent" title="Inferred from titles and thumbnails, not verified">
          {c.facelessConfidence === null || c.facelessConfidence === undefined
            ? "Faceless unknown"
            : `Faceless ${c.facelessConfidence}% · inferred`}
        </span>
      </div>
      {tags.length > 0 && (
        <>
          <p className="maker-channel-label">Niches</p>
          <div className="maker-chips">
            {tags.map((tag: string) => (
              <span className="maker-tag" key={tag}>
                {tag}
              </span>
            ))}
          </div>
        </>
      )}
      {(c.recentVideo || c.bestVideo) && (
        <>
          <p className="maker-channel-label">Recent videos</p>
          <div className="maker-channel-videos">
            {[
              ["Recent", c.recentVideo],
              ["Best", c.bestVideo],
            ]
              .filter(([, video], index, all) => video && (index === 0 || video.id !== all[0][1]?.id))
              .map(([label, video]: any) => (
                <a key={`${label}-${video.id}`} href={video.url} target="_blank" rel="noreferrer" title={video.title}>
                  {video.thumbnailUrl ? (
                    <img className="maker-thumb" src={video.thumbnailUrl} alt={video.title} loading="lazy" />
                  ) : (
                    <span className="maker-thumb" />
                  )}
                  <span>
                    {label} · {compact(video.viewCount)} views
                  </span>
                </a>
              ))}
          </div>
        </>
      )}
      <div className="maker-channel-actions">
        <button className="maker-ink" onClick={onSimilar}>
          <Users size={15} />
          Similar channels
        </button>
        <button className="maker-outline" disabled={copying} onClick={onCopyStyle}>
          {copying ? <Loader2 size={15} className="animate-spin" /> : <Copy size={15} />}
          {copying ? "Copying…" : "Copy style"}
        </button>
      </div>
    </article>
  );
}
function Discovery({
  accountId,
  query,
  theme,
  onError,
}: {
  accountId: string;
  query?: string;
  theme: "light" | "dark";
  onError: (e: string) => void;
}) {
  const [search, setSearch] = useState(query || ""),
    [result, setResult] = useState<any>(null),
    [busy, setBusy] = useState(false),
    [filterOpen, setFilterOpen] = useState(false),
    [tab, setTab] = useState("channels"),
    [copying, setCopying] = useState(""),
    [similar, setSimilar] = useState<{ title: string; previous: any } | null>(null);
  const [collections, setCollections] = useState<any[]>([]),
    [selected, setSelected] = useState<string[]>([]);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [draftFilters, setDraftFilters] = useState<Filters>(DEFAULT_FILTERS);
  const cacheKey = `autoyt-research-${accountId}`;
  const loadCollections = () =>
    creatorApi(`/api/maker/collections?accountId=${accountId}`).then((d) =>
      setCollections(d.collections || []),
    );
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(cacheKey);
      if (raw) {
        const cache = JSON.parse(raw);
        setResult(cache.result);
        setFilters({ ...DEFAULT_FILTERS, ...(cache.filters || {}) });
        setSearch(query || cache.search || "");
        setSelected(cache.selected || []);
      }
    } catch {}
    void loadCollections().catch((e) => onError(e.message));
  }, [accountId]);
  useEffect(() => {
    if (result)
      try {
        sessionStorage.setItem(cacheKey, JSON.stringify({ result, filters, search, selected }));
      } catch {}
  }, [result, filters, search, selected]);
  const bookmarkCollection = collections.find((c) => c.data?.kind === "bookmarks");
  const bookmarks: any[] = bookmarkCollection?.data?.channels || [];
  const research = collections.filter((c) => c.data?.kind !== "bookmarks");
  async function scan(value = search, nextFilters = filters) {
    if (!value.trim()) return;
    setBusy(true);
    onError("");
    try {
      writeDeepLink({ view: "discover", discoveryQuery: value });
      setSearch(value);
      setResult(
        await creatorApi("/api/maker/discover", {
          accountId,
          query: value,
          publishedAfterDays: nextFilters.days,
          duration: nextFilters.duration,
          regionCode: nextFilters.region,
          filters: nextFilters,
        }),
      );
      setSelected([]);
      setTab("channels");
      return true;
    } catch (e) {
      onError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function toggleBookmark(c: any) {
    const exists = bookmarks.some((b) => b.id === c.id);
    const channels = exists ? bookmarks.filter((b) => b.id !== c.id) : [snapshotChannel(c), ...bookmarks];
    const data = { kind: "bookmarks", channels };
    setCollections((items) =>
      bookmarkCollection
        ? items.map((item) => (item.id === bookmarkCollection.id ? { ...item, data } : item))
        : [{ id: "pending-bookmarks", name: "Bookmarked channels", data }, ...items],
    );
    try {
      if (bookmarkCollection && bookmarkCollection.id !== "pending-bookmarks")
        await creatorApi(`/api/maker/collections/${bookmarkCollection.id}`, { accountId, name: "Bookmarked channels", data }, "PUT");
      else await creatorApi("/api/maker/collections", { accountId, name: "Bookmarked channels", data });
      await loadCollections();
    } catch (e) {
      onError((e as Error).message);
      void loadCollections().catch(() => {});
    }
  }
  async function copyStyle(c: any) {
    setCopying(c.id);
    try {
      await creatorApi("/api/channel-styles/copy", { accountId, sourceUrl: c.url, niche: c.niche || search });
      writeDeepLink({ view: "styles" });
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setCopying("");
    }
  }
  async function findSimilar(c: any) {
    const previous = similar?.previous || { result, search };
    setBusy(true);
    onError("");
    try {
      const titles = (c.videos?.length ? c.videos : [c.bestVideo, c.recentVideo]).filter(Boolean).map((v: any) => v.title);
      const data = await creatorApi("/api/maker/similar", {
        accountId,
        channel: { id: c.id, title: c.title, niche: c.niche, titles },
        filters,
      });
      setResult(data);
      setSearch(data.query);
      setSelected([]);
      setTab("channels");
      writeDeepLink({ view: "discover", discoveryQuery: data.query });
      setSimilar({ title: c.title, previous });
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function applyFilters(next: Filters) {
    const serverChanged = SERVER_FILTERS.some((key) => next[key] !== filters[key]);
    setFilters(next);
    setFilterOpen(false);
    if (serverChanged && result && search) void scan(search, next);
  }
  const channels = rankDiscoveryChannels(result?.videos || [], filters);
  const chips = activeFilterChips(filters);
  async function createFromSelection() {
    try {
      const evidence = channels.filter((c: any) => selected.includes(c.id));
      await createProject(accountId, {
        title: search ? `${search[0].toUpperCase()}${search.slice(1)} video` : "Research project",
        createdFrom: "discovery",
        brief: `Create an original video about ${search}.\nResearch references:\n${evidence
          .map((c: any) => `${c.title}: ${c.url} (median ${compact(c.medianViews)} views across ${c.sampleCount} sampled videos)`)
          .join("\n")}`,
      });
    } catch (e) {
      onError((e as Error).message);
    }
  }
  const card = (c: any) => (
    <ChannelCard
      key={c.id}
      channel={c}
      selected={selected.includes(c.id)}
      bookmarked={bookmarks.some((b) => b.id === c.id)}
      copying={copying === c.id}
      onSelect={(value) => setSelected((items) => (value ? [...items, c.id] : items.filter((id) => id !== c.id)))}
      onBookmark={() => void toggleBookmark(c)}
      onSimilar={() => void findSimilar(c)}
      onCopyStyle={() => void copyStyle(c)}
    />
  );
  return (
    <div className="maker-scroll">
      <div className="maker-page is-wide">
        <PageHead
          centered
          title="Niche Finder"
          text={
            similar ? (
              <span className="maker-similar-line">
                Channels similar to “{similar.title}”
                <button
                  className="maker-outline"
                  onClick={() => {
                    setResult(similar.previous.result);
                    setSearch(similar.previous.search);
                    writeDeepLink({ view: "discover", discoveryQuery: similar.previous.search });
                    setSimilar(null);
                  }}
                >
                  <ChevronLeft size={14} />
                  Back to search
                </button>
              </span>
            ) : (
              "Search a niche or paste a channel link. Metrics describe the sampled videos, not whole channels."
            )
          }
        />
        <form
          className="maker-searchbar"
          onSubmit={(e) => {
            e.preventDefault();
            setSimilar(null);
            void scan();
          }}
        >
          <Search size={18} />
          <input
            required
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search a niche, topic, or @channel"
            aria-label="Niche or channel"
          />
          <Action
            label="Shuffle niche"
            disabled={busy}
            onClick={() => {
              const pool = NICHE_SEEDS.filter((seed) => seed !== search);
              setSimilar(null);
              void scan(pool[Math.floor(Math.random() * pool.length)]);
            }}
          >
            <Shuffle size={17} />
          </Action>
          <Action
            label="Advanced filters"
            className="maker-icon maker-filter-btn"
            aria-expanded={filterOpen}
            onClick={() => {
              setDraftFilters(filters);
              setFilterOpen(true);
            }}
          >
            <SlidersHorizontal size={17} />
            {chips.length > 0 && <em>{chips.length}</em>}
          </Action>
          <button disabled={busy} className="maker-primary">
            {busy ? <Loader2 className="animate-spin" size={16} /> : <Search size={16} />}
            Search
          </button>
        </form>
        {chips.length > 0 && (
          <div className="maker-chips maker-active-filters">
            {chips.map(([key, label]) => (
              <span className="maker-chip" key={key}>
                {label}
                <button
                  aria-label={`Remove ${label}`}
                  onClick={() => applyFilters({ ...filters, [key]: DEFAULT_FILTERS[key] })}
                >
                  <X size={12} />
                </button>
              </span>
            ))}
            <button className="maker-link" onClick={() => applyFilters({ ...DEFAULT_FILTERS, sort: filters.sort })}>
              Clear all
            </button>
          </div>
        )}
        <div className="maker-filterbar">
          <div className="maker-segmented" role="tablist" aria-label="Results">
            {[
              ["channels", "Channels"],
              ["videos", "Videos"],
              ["bookmarks", `Bookmarks${bookmarks.length ? ` · ${bookmarks.length}` : ""}`],
              ["saved", `Collections${research.length ? ` · ${research.length}` : ""}`],
            ].map(([t, label]) => (
              <button key={t} role="tab" aria-selected={tab === t} aria-pressed={tab === t} onClick={() => setTab(t)}>
                {label}
              </button>
            ))}
          </div>
          <label className="maker-sort">
            Sort by
            <select
              aria-label="Sort channels"
              value={filters.sort}
              onChange={(e) => setFilters({ ...filters, sort: e.target.value })}
            >
              {[
                ["score", "Discovery score"],
                ["medianViews", "Median views"],
                ["averageViews", "Average views"],
                ["newest", "Latest upload"],
                ["subscribers", "Subscribers"],
                ["ratio", "Views per subscriber"],
                ["recentVph", "Recent views per hour"],
                ["consistency", "Upload consistency"],
                ["opportunity", "Opportunity"],
              ].map(([v, l]) => (
                <option value={v} key={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
        </div>
        {busy ? (
          <div className="maker-loading">
            <Loader2 className="animate-spin" />
            Finding channels and recent outliers
          </div>
        ) : tab === "saved" ? (
          research.length ? (
            <div className="maker-card maker-list">
              {research.map((c) => (
                <div className="maker-list-row" key={c.id}>
                  <button
                    onClick={() => {
                      setResult(c.data.result);
                      setSearch(c.data.search);
                      setFilters({ ...DEFAULT_FILTERS, ...(c.data.filters || {}) });
                      setSelected(c.data.selected || []);
                      setSimilar(null);
                      setTab("channels");
                      writeDeepLink({ view: "discover", discoveryQuery: c.data.search });
                    }}
                  >
                    <span className="maker-tile is-soft">
                      <FolderOpen size={17} />
                    </span>
                    <span>
                      <strong>{c.name}</strong>
                      <small>
                        {c.data?.result?.videos?.length || 0} sampled videos · {c.data?.selected?.length || 0} selected ·
                        saved {dateLabel(Date.parse(c.updated_at))}
                      </small>
                    </span>
                  </button>
                  <Action
                    label="Delete collection"
                    onClick={async () => {
                      try {
                        await creatorApi(`/api/maker/collections/${c.id}`, {}, "DELETE");
                        setCollections((items) => items.filter((i) => i.id !== c.id));
                      } catch (e) {
                        onError((e as Error).message);
                      }
                    }}
                  >
                    <Trash2 size={16} />
                  </Action>
                </div>
              ))}
            </div>
          ) : (
            <Empty
              icon={<FolderOpen size={28} />}
              title="No saved research yet"
              text="Run a search, select channels, and save the collection to reopen it with the same filters."
            />
          )
        ) : tab === "bookmarks" ? (
          bookmarks.length ? (
            <div className="maker-channel-grid">{bookmarks.map(card)}</div>
          ) : (
            <Empty
              icon={<Bookmark size={28} />}
              title="No bookmarks yet"
              text="Bookmark channels from any search to keep them here, with the metrics from when you saved them."
            />
          )
        ) : !result ? (
          <Empty
            icon={<Compass size={28} />}
            title="Find your next niche"
            text="Search a topic, paste a channel, or shuffle for a faceless niche to explore."
          >
            <button
              className="maker-outline"
              onClick={() => void scan(NICHE_SEEDS[Math.floor(Math.random() * NICHE_SEEDS.length)])}
            >
              <Shuffle size={15} />
              Shuffle a niche
            </button>
          </Empty>
        ) : tab === "channels" ? (
          <>
            <div className="maker-result-summary">
              <span>
                {channels.length} {channels.length === 1 ? "channel" : "channels"} · {result.videos?.length || 0} sampled videos
                {result.sampledAt ? ` · sampled ${new Date(result.sampledAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}
              </span>
              <span>Faceless is inferred · monetization isn’t shown because it can’t be verified</span>
            </div>
            {channels.length ? (
              <div className="maker-channel-grid">{channels.map(card)}</div>
            ) : (
              <Empty title="No channels match these filters" text="Loosen a metric filter or remove a term.">
                <button className="maker-outline" onClick={() => applyFilters({ ...DEFAULT_FILTERS, sort: filters.sort, days: filters.days, duration: filters.duration, region: filters.region })}>
                  Clear metric filters
                </button>
              </Empty>
            )}
          </>
        ) : (
          <div className="maker-video-grid">
            {[...(result.videos || [])]
              .sort((a, b) => b.viewCount - a.viewCount)
              .map((v) => (
                <StandardVideoCard
                  key={v.id}
                  title={v.title}
                  source={v.channelTitle}
                  imageUrl={v.thumbnailUrl}
                  href={v.url}
                  meta={`${compact(v.viewCount)} views · ${compact(v.viewsPerHour)} VPH · ${durationLabel(v.durationSeconds)} · ${ageLabel(v.publishedAt)}`}
                  theme={theme}
                />
              ))}
          </div>
        )}
        {result && (tab === "channels" || tab === "videos") && (
          <footer className="maker-selection">
            <span>
              {selected.length
                ? `${selected.length} ${selected.length === 1 ? "channel" : "channels"} selected as project evidence`
                : "Select channels to use them as project evidence"}
            </span>
            <button
              className="maker-outline"
              onClick={async () => {
                try {
                  await creatorApi("/api/maker/collections", {
                    accountId,
                    name: search,
                    data: { result, filters, search, selected },
                  });
                  await loadCollections();
                  setTab("saved");
                } catch (e) {
                  onError((e as Error).message);
                }
              }}
            >
              <Save size={16} />
              Save collection
            </button>
            <button className="maker-primary" onClick={() => void createFromSelection()}>
              <Plus size={16} />
              Create project
            </button>
          </footer>
        )}
      </div>
      {filterOpen && (
        <Modal
          title="Advanced filters"
          wide
          onClose={() => setFilterOpen(false)}
          footer={
            <>
              <button className="maker-link maker-push-left" onClick={() => setDraftFilters({ ...DEFAULT_FILTERS, sort: filters.sort })}>
                Reset to default
              </button>
              <button className="maker-outline" onClick={() => setFilterOpen(false)}>
                Cancel
              </button>
              <button className="maker-primary" onClick={() => applyFilters(draftFilters)}>
                Apply filters
              </button>
            </>
          }
        >
          <FilterForm value={draftFilters} onChange={setDraftFilters} />
        </Modal>
      )}
    </div>
  );
}
function FilterForm({ value: f, onChange }: { value: Filters; onChange: (f: Filters) => void }) {
  const set = (patch: Partial<Filters>) => onChange({ ...f, ...patch });
  const num = (key: keyof Filters, label: string, extra: Record<string, number> = {}) => (
    <label className="maker-field">
      {label}
      <input
        type="number"
        min={0}
        {...extra}
        value={(f[key] as number) || ""}
        placeholder="Any"
        onChange={(e) => set({ [key]: Number(e.target.value) || 0 } as Partial<Filters>)}
      />
    </label>
  );
  return (
    <div className="maker-filter-form">
      <section>
        <h3>Recency and format</h3>
        <div className="maker-grid-3">
          <label className="maker-field">
            Published within
            <select value={f.days} onChange={(e) => set({ days: Number(e.target.value) })}>
              {[7, 30, 90, 180, 365].map((n) => (
                <option key={n} value={n}>
                  {n} days
                </option>
              ))}
            </select>
          </label>
          <label className="maker-field">
            Video length
            <select value={f.duration} onChange={(e) => set({ duration: e.target.value })}>
              <option value="any">All lengths</option>
              <option value="short">Under 4 minutes</option>
              <option value="medium">4–20 minutes</option>
              <option value="long">20+ minutes</option>
            </select>
          </label>
          <label className="maker-field">
            Content type
            <select value={f.format} onChange={(e) => set({ format: e.target.value })}>
              <option value="any">Long-form and Shorts</option>
              <option value="longform">Long-form</option>
              <option value="shorts">Shorts</option>
            </select>
          </label>
          <label className="maker-field">
            Region
            <select value={f.region} onChange={(e) => set({ region: e.target.value })}>
              {["US", "GB", "CA", "AU", "IN"].map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </label>
          <label className="maker-field">
            Language
            <input value={f.language} placeholder="Any, e.g. en" onChange={(e) => set({ language: e.target.value })} />
          </label>
          <label className="maker-field">
            Unknown faceless
            <select value={f.facelessUnknown} onChange={(e) => set({ facelessUnknown: e.target.value })}>
              <option value="include">Include unknown</option>
              <option value="exclude">Exclude unknown</option>
              <option value="only">Only unknown</option>
            </select>
          </label>
        </div>
        <label className="maker-switch maker-filter-switch">
          <input type="checkbox" checked={f.faceless} onChange={(e) => set({ faceless: e.target.checked })} />
          Likely faceless channels only
        </label>
      </section>
      <section>
        <h3>View statistics</h3>
        <div className="maker-grid-3">
          {num("minViews", "Minimum median views")}
          {num("minRatio", "Minimum views per subscriber", { step: 0.05 })}
          <span />
        </div>
      </section>
      <section>
        <h3>Channel statistics</h3>
        <div className="maker-grid-4">
          {num("minSubs", "Min subscribers")}
          {num("maxSubs", "Max subscribers")}
          {num("minDurationMinutes", "Min length (min)")}
          {num("maxDurationMinutes", "Max length (min)")}
        </div>
      </section>
      <section>
        <h3>Niches</h3>
        <div className="maker-grid-2">
          <label className="maker-field">
            Include terms
            <input value={f.includeTerms} placeholder="anime, history" onChange={(e) => set({ includeTerms: e.target.value })} />
          </label>
          <label className="maker-field">
            Exclude terms
            <input value={f.excludeTerms} placeholder="gaming, reaction" onChange={(e) => set({ excludeTerms: e.target.value })} />
          </label>
        </div>
      </section>
    </div>
  );
}

/* Styles */
function Styles({
  accountId,
  onError,
}: {
  accountId: string;
  onError: (e: string) => void;
}) {
  const [styles, setStyles] = useState<ChannelStyle[]>([]),
    [voices, setVoices] = useState<any[]>([]),
    [loading, setLoading] = useState(true),
    [creating, setCreating] = useState(false),
    [editing, setEditing] = useState<ChannelStyle | null>(null),
    [picker, setPicker] = useState<ChannelStyle | null>(null);
  const refresh = async () => {
    const list = (await creatorApi(`/api/channel-styles?accountId=${accountId}`)).styles || [];
    setStyles(list);
    return list as ChannelStyle[];
  };
  useEffect(() => {
    void refresh()
      .catch((e) => onError(e.message))
      .finally(() => setLoading(false));
    void creatorApi("/api/automation/voice/status")
      .then((data) => setVoices(data.profiles || []))
      .catch(() => {});
  }, [accountId]);
  const voiceName = (id?: string) => voices.find((v) => v.id === id)?.name;
  return (
    <div className="maker-scroll">
      <div className="maker-page is-wide">
        <PageHead title="Styles" text="Save a channel's voice, pacing, and length, then start every video from it.">
          <button className="maker-primary" onClick={() => setCreating(true)}>
            <Plus size={16} />
            Create new style
          </button>
        </PageHead>
        <div className="maker-section-title">
          <h2>Your styles</h2>
          {styles.length > 0 && <span>{styles.length} saved</span>}
        </div>
        {loading ? (
          <div className="maker-loading">
            <Loader2 className="animate-spin" />
            Loading styles
          </div>
        ) : styles.length ? (
          <div className="maker-style-grid">
            {styles.map((s) => {
              const refs = s.profile?.samples?.length || s.profile?.topVideos?.length || 0;
              const learned = Boolean(s.profile?.transcriptLearning || s.profile?.guide);
              return (
                <article className="maker-card maker-style-card" key={s.id}>
                  <button className="maker-style-cover" onClick={() => setEditing(s)} aria-label={`Review ${s.name}`}>
                    <StyleCover style={s} />
                    <span className={`maker-pill-status ${learned ? "is-ready" : ""}`}>
                      {learned ? "Guide ready" : "Not analyzed"}
                    </span>
                  </button>
                  <div className="maker-style-body">
                    <h2>{s.name}</h2>
                    <p>
                      <Mic size={13} />
                      {voiceName(s.profile?.settings?.voiceId) || "No default voice"}
                    </p>
                    <div className="maker-style-meta">
                      <span>
                        {refs} {refs === 1 ? "reference" : "references"} · {s.profile?.settings?.wordCount || 600} words
                      </span>
                      <button className="maker-link" onClick={() => setEditing(s)}>
                        Review
                        <ArrowUpRight size={13} />
                      </button>
                    </div>
                  </div>
                  <div className="maker-style-foot">
                    <button className="maker-primary maker-block" onClick={() => setPicker(s)}>
                      <Clapperboard size={15} />
                      Use style
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <Empty
            icon={<Layers size={28} />}
            title="No styles yet"
            text="Paste a channel link, or use Copy style in Niche Finder, to capture its references and pacing."
          >
            <button className="maker-primary" onClick={() => setCreating(true)}>
              <Plus size={16} />
              Create new style
            </button>
            <button className="maker-outline" onClick={() => writeDeepLink({ view: "discover" })}>
              <Compass size={15} />
              Open Niche Finder
            </button>
          </Empty>
        )}
        <div className="maker-section-title">
          <h2>Voices</h2>
          <button className="maker-outline" onClick={() => writeDeepLink({ view: "tts" })}>
            <Plus size={15} />
            Create voice clone
          </button>
        </div>
        {voices.length ? (
          <div className="maker-voice-grid">
            {voices.map((v) => (
              <div className="maker-card maker-voice" key={v.id}>
                <span className="maker-tile is-soft">
                  <Mic size={16} />
                </span>
                <span>
                  <strong>{v.name}</strong>
                  <small>
                    {v.voiceType === "cloned" ? "Voice clone" : "Preset voice"}
                    {v.sampleCount ? ` · ${v.sampleCount} ${v.sampleCount === 1 ? "sample" : "samples"}` : ""}
                  </small>
                </span>
              </div>
            ))}
          </div>
        ) : (
          <Empty
            icon={<Mic size={28} />}
            title="No voice clones yet"
            text="Create a voice clone from audio you own to use it as a style's default narrator."
          />
        )}
      </div>
      {creating && (
        <CreateStyleModal
          accountId={accountId}
          onClose={() => setCreating(false)}
          onCreated={async () => {
            const before = new Set(styles.map((s) => s.id));
            const list = await refresh();
            setCreating(false);
            const created = list.find((s) => !before.has(s.id));
            if (created) setEditing(created);
          }}
          onError={onError}
        />
      )}
      {editing && (
        <EditStyleModal
          key={editing.id}
          accountId={accountId}
          style={editing}
          voices={voices}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            const list = await refresh();
            setEditing((current) => (current ? list.find((s) => s.id === current.id) || null : null));
          }}
          onDeleted={async () => {
            setEditing(null);
            await refresh();
          }}
          onError={onError}
        />
      )}
      {picker && (
        <NewVideoModal
          accountId={accountId}
          styles={[picker, ...styles.filter((s) => s.id !== picker.id)]}
          collections={[]}
          onClose={() => setPicker(null)}
          onError={onError}
        />
      )}
    </div>
  );
}
function CreateStyleModal({
  accountId,
  onClose,
  onCreated,
  onError,
}: {
  accountId: string;
  onClose: () => void;
  onCreated: () => Promise<void>;
  onError: (e: string) => void;
}) {
  const [source, setSource] = useState(""),
    [niche, setNiche] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true);
    try {
      await creatorApi("/api/channel-styles/copy", { accountId, sourceUrl: source, niche });
      await onCreated();
    } catch (e) {
      onError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Create style"
      wide
      onClose={onClose}
      footer={
        <>
          <button className="maker-outline" onClick={onClose}>
            Cancel
          </button>
          <button className="maker-primary" disabled={busy || !/^https?:\/\//.test(source)} onClick={() => void submit()}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Copy size={16} />}
            {busy ? "Reading channel" : "Copy style"}
          </button>
        </>
      }
    >
      <div className="maker-stack">
        <p className="maker-muted maker-small maker-flush">
          AutoYT reads the channel's top and recent videos to save reference titles and pacing. Scripts and thumbnails are
          never copied verbatim.
        </p>
        <label className="maker-field">
          Reference channel
          <input
            type="url"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            placeholder="https://youtube.com/@channel"
          />
        </label>
        <label className="maker-field">
          Niche <small>Optional. Helps title and script prompts.</small>
          <input value={niche} onChange={(e) => setNiche(e.target.value)} placeholder="e.g. true crime documentaries" />
        </label>
      </div>
    </Modal>
  );
}
function EditStyleModal({
  accountId,
  style: s,
  voices,
  onClose,
  onSaved,
  onDeleted,
  onError,
}: {
  accountId: string;
  style: ChannelStyle;
  voices: any[];
  onClose: () => void;
  onSaved: () => Promise<void>;
  onDeleted: () => Promise<void>;
  onError: (e: string) => void;
}) {
  const [name, setName] = useState(s.name),
    [settings, setSettings] = useState<any>({ wordCount: 600, language: "en", ...(s.profile?.settings || {}) }),
    [guide, setGuide] = useState(s.profile?.guide || s.profile?.titleFormula || ""),
    [samples, setSamples] = useState<any[]>(s.profile?.samples || []),
    [busy, setBusy] = useState(""),
    [learnStatus, setLearnStatus] = useState("");
  useEffect(() => {
    if (s.profile?.guide) setGuide(s.profile.guide);
  }, [s.profile?.guide, s.profile?.transcriptLearning]);
  const references = samples.length
    ? samples
    : (s.profile?.topVideos || []).slice(0, 6).map((v: any) => ({ ...v, role: "outlier", readonly: true }));
  async function save(close = true) {
    setBusy("save");
    try {
      await creatorApi(
        `/api/maker/styles/${s.id}`,
        { accountId, name: name.trim() || s.name, profile: { ...s.profile, settings, guide, samples } },
        "PATCH",
      );
      await onSaved();
      if (close) onClose();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function learn() {
    setBusy("learn");
    setLearnStatus("Queued");
    try {
      const { job } = await creatorApi(`/api/maker/styles/${s.id}/learn`, { accountId });
      if (!job?.id) throw new Error("Style learning could not be queued");
      for (let attempt = 0; attempt < 200; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
        const { jobs } = await creatorApi(`/api/maker/styles/${s.id}/jobs?accountId=${encodeURIComponent(accountId)}`);
        const latest = jobs.find((item: any) => item.id === job.id);
        if (latest?.message) setLearnStatus(latest.message);
        if (latest?.status === "ready") {
          await onSaved();
          setLearnStatus("");
          return;
        }
        if (latest?.status === "failed" || latest?.status === "cancelled")
          throw new Error(latest.error || "Style learning did not finish");
      }
      throw new Error("Style learning is still running. Check Background Activity.");
    } catch (e) {
      onError((e as Error).message);
      setLearnStatus("");
    } finally {
      setBusy("");
    }
  }
  return (
    <Modal
      title="Edit style"
      wide
      onClose={onClose}
      footer={
        <>
          <button
            className="maker-danger maker-push-left"
            disabled={!!busy}
            onClick={async () => {
              if (!window.confirm(`Delete the “${s.name}” style? Projects that used it keep their settings.`)) return;
              try {
                await creatorApi(`/api/maker/styles/${s.id}`, { accountId, name: s.name, deleted: true }, "PATCH");
                await onDeleted();
              } catch (e) {
                onError((e as Error).message);
              }
            }}
          >
            <Trash2 size={15} />
            Delete
          </button>
          <button className="maker-outline" onClick={onClose}>
            Cancel
          </button>
          <button className="maker-primary" disabled={!!busy} onClick={() => void save()}>
            {busy === "save" ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
            Save style
          </button>
        </>
      }
    >
      <div className="maker-stack">
        <div className="maker-grid-4">
          <label className="maker-field">
            Style name
            <input value={name} maxLength={150} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="maker-field">
            Default word count
            <input
              type="number"
              min={100}
              max={5000}
              step={50}
              value={settings.wordCount}
              onChange={(e) => setSettings({ ...settings, wordCount: Number(e.target.value) || 600 })}
            />
          </label>
          <label className="maker-field">
            Language
            <select value={settings.language} onChange={(e) => setSettings({ ...settings, language: e.target.value })}>
              {[
                ["en", "English"],
                ["es", "Spanish"],
                ["fr", "French"],
                ["de", "German"],
                ["pt", "Portuguese"],
                ["hi", "Hindi"],
                ["ja", "Japanese"],
              ].map(([code, label]) => (
                <option key={code} value={code}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="maker-field">
            Voice
            <select value={settings.voiceId || ""} onChange={(e) => setSettings({ ...settings, voiceId: e.target.value })}>
              <option value="">Choose per project</option>
              {voices.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div>
          <div className="maker-section-title maker-flush-top">
            <h3>Reference videos</h3>
            <a className="maker-link" href={s.sourceUrl} target="_blank" rel="noreferrer">
              Open channel
              <ArrowUpRight size={13} />
            </a>
          </div>
          {references.length ? (
            <div className="maker-reference-list">
              {references.map((sample: any) => (
                <div className="maker-reference-row" key={sample.id || sample.url}>
                  {sample.thumbnailUrl ? <img src={sample.thumbnailUrl} alt="" loading="lazy" /> : <span className="maker-ref-thumb" />}
                  <a href={sample.url} target="_blank" rel="noreferrer">
                    {sample.title}
                  </a>
                  {sample.readonly ? (
                    <span className="maker-tag">Top video</span>
                  ) : (
                    <select
                      aria-label={`Role for ${sample.title}`}
                      value={sample.role || "representative"}
                      onChange={(e) =>
                        setSamples((items) => items.map((item) => (item.id === sample.id ? { ...item, role: e.target.value } : item)))
                      }
                    >
                      <option value="outlier">Outlier</option>
                      <option value="recent">Recent</option>
                      <option value="representative">Representative</option>
                      <option value="manual">Manual</option>
                    </select>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="maker-muted maker-small">No reference videos were saved for this channel.</p>
          )}
        </div>
        <Disclosure
          label="Style guide"
          summary={s.profile?.transcriptLearning ? "learned from transcripts" : "not analyzed yet"}
          defaultOpen={!guide}
        >
          <div className="maker-stack-sm">
            <p className="maker-muted maker-small maker-flush">
              {s.profile?.transcriptLearning ||
                "Analyze three reference transcripts to learn hooks, pacing, and structure. Local Whisper does the transcription."}
            </p>
            <textarea
              aria-label={`${s.name} style guide`}
              rows={7}
              value={guide}
              placeholder="Hook patterns, pacing, sentence length, and tone"
              onChange={(e) => setGuide(e.target.value)}
            />
            <div className="maker-actions">
              <button className="maker-outline" disabled={!!busy} onClick={() => void learn()}>
                {busy === "learn" ? <Loader2 size={15} className="animate-spin" /> : <WandSparkles size={15} />}
                {busy === "learn" ? learnStatus || "Analyzing" : "Analyze 3 transcripts"}
              </button>
            </div>
          </div>
        </Disclosure>
      </div>
    </Modal>
  );
}

/* Create Video workspace */
const generateLabels: Record<string, [string, string]> = {
  title: ["Generate titles", "Regenerate"],
  script: ["Generate script", "Regenerate"],
  seo: ["Generate description", "Regenerate"],
  voiceover: ["Generate voiceover", "Regenerate"],
  soundtrack: ["Auto-split moods", "Re-split moods"],
  visualPlan: ["Generate scene prompts", "Regenerate prompts"],
  thumbnail: ["Generate thumbnails", "Generate new variants"],
  review: ["Render video", "Render again"],
};
function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section className="maker-step">
      <h3>
        <span>{n}</span>
        {title}
      </h3>
      <div>{children}</div>
    </section>
  );
}
function ProjectEditor({
  id,
  stage,
  accountId,
  theme,
  onError,
}: {
  id: string;
  stage: string;
  accountId: string;
  theme: "light" | "dark";
  onError: (e: string) => void;
}) {
  const [project, setProject] = useState<CreatorProject | null>(null),
    [jobs, setJobs] = useState<Job[]>([]),
    [busy, setBusy] = useState(false),
    [draft, setDraft] = useState<any>({}),
    [settings, setSettings] = useState<any>({}),
    [dirty, setDirty] = useState(false),
    [voices, setVoices] = useState<any[]>([]),
    [styleName, setStyleName] = useState(""),
    [musicTracks, setMusicTracks] = useState<any[]>([]),
    [musicBusy, setMusicBusy] = useState(false),
    [confirm, setConfirm] = useState<any>(null),
    [archiveOpen, setArchiveOpen] = useState(false),
    [playhead, setPlayhead] = useState(0),
    [zoom, setZoom] = useState(1),
    [selectedScene, setSelectedScene] = useState(""),
    [visualView, setVisualView] = useState<"settings" | "scenes" | "">(""),
    [advanced, setAdvanced] = useState(true),
    [copied, setCopied] = useState(false),
    [animation, setAnimation] = useState<{ available: boolean; reason: string; model: string } | null>(null);
  const timelineAudio = useRef<HTMLAudioElement>(null);
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;
  const currentStage = stages.some(([s]) => s === stage) ? stage : "title";
  useEffect(() => {
    let active = true,
      timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const data = await creatorApi(`/api/maker/projects/${id}`);
        if (active) {
          setProject(data.project);
          setJobs(data.jobs || []);
        }
      } catch (e) {
        if (active) onError((e as Error).message);
      } finally {
        if (active) timer = setTimeout(poll, 4000);
      }
    }
    void poll();
    void creatorApi("/api/automation/voice/status")
      .then((data) => active && setVoices(data.profiles || []))
      .catch(() => {});
    void creatorApi("/api/maker/capabilities")
      .then((data) => active && setAnimation(data.animation || null))
      .catch(() => {});
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [id]);
  useEffect(() => {
    if (!project?.styleId) return;
    void creatorApi(`/api/channel-styles?accountId=${encodeURIComponent(accountId)}`)
      .then((data) => setStyleName((data.styles || []).find((s: ChannelStyle) => s.id === project.styleId)?.name || ""))
      .catch(() => {});
  }, [project?.styleId]);
  useEffect(() => {
    if (!dirtyRef.current && project) {
      setDraft(
        currentStage === "brief"
          ? { brief: project.metadata.brief || "", title: project.title }
          : structuredClone(project.outputs[currentStage] || {}),
      );
      setSettings(structuredClone(project.metadata.settings || {}));
    }
  }, [project, currentStage]);
  useEffect(() => {
    const protect = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", protect);
    return () => window.removeEventListener("beforeunload", protect);
  }, []);
  async function save(value = draft) {
    setBusy(true);
    try {
      const data = await creatorApi(
        `/api/maker/projects/${id}`,
        {
          ...(currentStage === "brief" ? value : { outputStage: currentStage, output: value }),
          settings,
          accountId,
          expectedVersion: project?.version || 1,
        },
        "PATCH",
      );
      setDirty(false);
      dirtyRef.current = false;
      setProject(data.project);
      return true;
    } catch (e) {
      if ((e as Error & { status?: number }).status === 409) {
        const latest = await creatorApi(`/api/maker/projects/${id}`).catch(() => null);
        if (latest?.project) setProject(latest.project);
      }
      onError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  function edit(patch: any) {
    setDraft((d: any) => ({ ...d, ...patch }));
    setDirty(true);
  }
  function editSetting(patch: Record<string, unknown>) {
    setSettings((current: Record<string, unknown>) => ({ ...current, ...patch }));
    setDirty(true);
  }
  function editScene(index: number, patch: Record<string, unknown>) {
    edit({ scenes: draft.scenes.map((s: any, i: number) => (i === index ? { ...s, ...patch } : s)) });
  }
  async function navigate(next: string) {
    if (dirty && !(await save())) return;
    setDirty(false);
    dirtyRef.current = false;
    writeDeepLink({ view: "projects", projectId: id, projectStage: next });
  }
  async function start(payload: any = {}) {
    setConfirm(null);
    if (dirty && !(await save())) return;
    setBusy(true);
    try {
      const data = await creatorApi(`/api/maker/projects/${id}/jobs/${currentStage}`, payload);
      setJobs((items) => [data.job, ...items.filter((j) => j.id !== data.job?.id)]);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function stop(job: Job) {
    try {
      await creatorApi(`/api/maker/jobs/${job.id}/stop`, {});
      setJobs((items) => items.map((j) => (j.id === job.id ? { ...j, status: "cancelled" } : j)));
    } catch (e) {
      onError((e as Error).message);
    }
  }
  async function upload(file: File | undefined, limitMb: number, kind: "image" | "audio") {
    if (!file) return;
    if (file.size > limitMb * 1024 * 1024) {
      onError(`Choose ${kind === "image" ? "an image" : "audio"} smaller than ${limitMb} MB`);
      return;
    }
    if (kind === "audio" && !window.confirm("Do you own this music or have permission to use it?")) return;
    setBusy(true);
    try {
      const encoded = await readFile(file);
      const data =
        kind === "image"
          ? await creatorApi(`/api/maker/projects/${id}/reference-assets`, {
              image: encoded,
              mediaType: file.type,
              accountId,
              expectedVersion: project?.version || 1,
            })
          : await creatorApi(`/api/maker/projects/${id}/soundtrack`, {
              audio: encoded,
              credit: draft.credit,
              rightsConfirmed: true,
              accountId,
              expectedVersion: project?.version || 1,
            });
      if (kind === "audio") {
        setDirty(false);
        dirtyRef.current = false;
      }
      setProject(data.project);
    } catch (error) {
      onError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!project)
    return (
      <div className="maker-loading">
        <Loader2 className="animate-spin" />
        Opening project
      </div>
    );
  const jobFor = (key: string) => jobs.find((j) => j.stage === key);
  const running = (key: string) => ["running", "queued"].includes(jobFor(key)?.status || "");
  const latest = jobFor(currentStage),
    active = running(currentStage);
  const output = project.outputs[currentStage];
  let blocked = "";
  try {
    if (!["brief", "studio"].includes(currentStage)) assertStageReady(project, currentStage);
  } catch (e) {
    blocked = (e as Error).message;
  }
  const canSave = ["brief", "title", "script", "seo", "soundtrack", "visualPlan", "thumbnail", "voiceover", "review"].includes(currentStage);
  const [firstLabel, againLabel] = generateLabels[currentStage] || ["Generate", "Regenerate"];
  const generateLabel = output && currentStage !== "thumbnail" ? againLabel : firstLabel;
  const generate = () =>
    currentStage === "thumbnail"
      ? setConfirm({ action: "thumbnailVariants", confirmed: true })
      : ["voiceover", "review"].includes(currentStage)
        ? setConfirm({ confirmed: true })
        : void start();
  const copy = stageCopy[currentStage];
  const scenes: any[] = draft.scenes || [];
  const voiceover = project.outputs.voiceover;
  const view = visualView || (scenes.length ? "scenes" : "settings");
  const missingImages = scenes.filter((s) => !s.asset).length;
  const toAnimate = scenes.filter((s) => s.animate && s.asset && !s.clip).length;
  const imageMb = settings.quality === "high" ? 5 : 1.5;
  const wordCount = (text?: string) => (text || "").trim().split(/\s+/).filter(Boolean).length;
  const voiceSelect = (
    <label className="maker-field">
      Voice
      <select value={settings.voiceId || ""} onChange={(e) => editSetting({ voiceId: e.target.value })}>
        <option value="">Select a voice</option>
        {voices.map((v) => (
          <option key={v.id} value={v.id}>
            {v.name}
          </option>
        ))}
      </select>
    </label>
  );
  const voiceCaption = `${voices.find((v) => v.id === settings.voiceId)?.name || "No voice selected"} · ${Math.round((settings.voiceSpeed ?? 1) * 100)}% speed`;
  const stageNotices = (
    <>
      {active && latest && (
        <div className="maker-progress" role="status">
          <Loader2 size={15} className="animate-spin" />
          <span>{latest.message || "Queued"}</span>
          <span className="maker-progress-track">
            <span style={{ width: `${Math.max(3, latest.progress || 0)}%` }} />
          </span>
          <span className="maker-mono">{Math.round(latest.progress || 0)}%</span>
          {latest.progress > 5 && latest.progress < 95 ? (
            <span>
              about{" "}
              {Math.max(1, Math.ceil((((Date.now() - latest.createdAt) / 60000) * (100 - latest.progress)) / latest.progress))} min
              left
            </span>
          ) : null}
        </div>
      )}
      {latest?.status === "failed" && (
        <p className="maker-error is-inline" role="alert">
          {latest.error || "This stage failed. Try again."}
        </p>
      )}
      {output?.stale && (
        <p className="maker-notice">
          <CircleAlert size={15} />
          Earlier inputs changed. Regenerate this stage so it matches before export.
        </p>
      )}
      {blocked && currentStage !== "brief" && !active && (
        <p className="maker-notice">
          <CircleAlert size={15} />
          {blocked}
        </p>
      )}
    </>
  );
  const genHead = (extra?: ReactNode) => (
    <header className="maker-gen-head">
      <span className="maker-tile is-soft">{copy?.icon}</span>
      <div>
        <h2>{copy?.name}</h2>
        <p>{copy?.text}</p>
      </div>
      <div className="maker-actions">
        {extra}
        {dirty && canSave && (
          <button className="maker-outline" disabled={busy} onClick={() => void save()}>
            <Save size={15} />
            Save
          </button>
        )}
        {currentStage !== "brief" &&
          (active && latest ? (
            <button className="maker-outline" onClick={() => void stop(latest)}>
              <Pause size={15} />
              Stop
            </button>
          ) : (
            <button className="maker-primary" title={blocked || generateLabel} disabled={busy || !!blocked} onClick={generate}>
              <WandSparkles size={15} />
              {generateLabel}
            </button>
          ))}
      </div>
    </header>
  );
  const timeline =
    scenes.length > 0 && voiceover?.duration ? (
      <section className="maker-card maker-card-body maker-timeline" aria-label="Scene timeline">
        <div className="maker-timeline-head">
          <h3>
            <Clock size={15} />
            Timeline
          </h3>
          <span className="maker-mono">
            {durationLabel(playhead)} / {durationLabel(voiceover.duration)}
          </span>
          <div className="maker-actions">
            <button
              className="maker-outline"
              onClick={() => {
                try {
                  edit({ scenes: splitCreatorScene(scenes, voiceover.segments, playhead) });
                } catch (e) {
                  onError((e as Error).message);
                }
              }}
            >
              <Scissors size={14} />
              Split at playhead
            </button>
            <label className="maker-zoom">
              Zoom
              <input type="range" min={1} max={4} step={0.5} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} />
            </label>
          </div>
        </div>
        <audio ref={timelineAudio} controls src={voiceover.asset} onTimeUpdate={(e) => setPlayhead(e.currentTarget.currentTime)} />
        <div className="maker-timeline-viewport">
          <div className="maker-timeline-track" style={{ width: `${zoom * 100}%` }}>
            <div className="maker-timeline-segments">
              {scenes.map((scene, index) => (
                <button
                  style={{ flexGrow: Math.max(0.1, scene.end - scene.start) }}
                  key={scene.id}
                  aria-label={`Select scene ${index + 1}`}
                  aria-pressed={selectedScene === scene.id}
                  onClick={() => {
                    setSelectedScene(scene.id);
                    setPlayhead(scene.start);
                    if (timelineAudio.current) timelineAudio.current.currentTime = scene.start;
                    document.getElementById(scene.id)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
                  }}
                >
                  <strong>Scene {index + 1}</strong>
                  <em>{scene.motion === "push" ? "Pan & zoom" : "Still"}</em>
                  <small>{(scene.end - scene.start).toFixed(1)}s</small>
                </button>
              ))}
            </div>
            <span className="maker-playhead" style={{ left: `${(playhead / voiceover.duration) * 100}%` }} />
          </div>
        </div>
        <input
          className="maker-timeline-scrub"
          aria-label="Scene playhead"
          type="range"
          min={0}
          max={voiceover.duration || 1}
          step={0.1}
          value={playhead}
          onChange={(e) => {
            setPlayhead(Number(e.target.value));
            if (timelineAudio.current) timelineAudio.current.currentTime = Number(e.target.value);
          }}
        />
        <div className="maker-timeline-scale">
          <span>0:00</span>
          <span>{durationLabel(voiceover.duration)}</span>
        </div>
        <div className="maker-seg-chips">
          {scenes.map((scene, index) => (
            <button
              key={scene.id}
              aria-pressed={selectedScene === scene.id}
              onClick={() => {
                setSelectedScene(scene.id);
                document.getElementById(scene.id)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
              }}
            >
              Scene {index + 1}: {scene.asset ? "image ready" : "prompt only"}
            </button>
          ))}
        </div>
      </section>
    ) : null;
  return (
    <>
      <div className="maker-topbar">
        <div className="maker-topbar-left">
          <button
            className="maker-ghost"
            onClick={() => {
              if (!dirty || window.confirm("Leave without saving this draft?")) writeDeepLink({ view: "projects" });
            }}
          >
            <ArrowLeft size={16} />
            Projects
          </button>
        </div>
        <div className="maker-actions">
          <span className="maker-save-status" aria-live="polite">
            {busy ? "Saving…" : dirty ? "Unsaved changes" : "All changes saved"}
          </span>
          <span className="maker-project-chip" title={project.title}>
            <FolderOpen size={14} />
            <span>{project.title}</span>
            {styleName && <small>· {styleName}</small>}
          </span>
          <Action
            label={project.status === "archived" ? "Restore project" : "Archive project"}
            onClick={async () => {
              if (project.status !== "archived") return setArchiveOpen(true);
              try {
                const data = await creatorApi(`/api/maker/projects/${id}`, { status: "active", accountId, expectedVersion: project.version || 1 }, "PATCH");
                setProject(data.project);
              } catch (error) {
                onError((error as Error).message);
              }
            }}
          >
            {project.status === "archived" ? <RotateCcw size={16} /> : <Archive size={16} />}
          </Action>
        </div>
      </div>
      <div className={currentStage === "studio" ? "maker-studio-shell" : "maker-scroll"}>
        {currentStage !== "studio" && (
          <PageHead
            centered
            title="Create Video"
            text="Follow the steps below. Start with a title, then generate your script, voiceover, and visuals."
          />
        )}
        <nav className="maker-stagebar" aria-label="Project stages">
          {stages.map(([key, label]) => (
            <button key={key} aria-current={currentStage === key ? "page" : undefined} onClick={() => void navigate(key)}>
              {label}
              {running(key) ? (
                <Loader2 size={13} className="animate-spin" aria-label="Generating" />
              ) : project.outputs[key]?.stale ? (
                <span className="maker-stage-dot" title="Needs updating" />
              ) : project.outputs[key] ? (
                <Check size={13} className="is-done" aria-label="Done" />
              ) : null}
            </button>
          ))}
        </nav>
        {currentStage === "studio" ? (
          <div className="maker-embedded">
            <VoiceoverStudio
              embedded
              theme={theme}
              accountId={accountId}
              agentId={project.metadata.studio?.agentId}
              uploadId={project.metadata.studio?.uploadId}
              onSourceChange={(source) => {
                void creatorApi(`/api/maker/projects/${id}`, { studio: source, accountId, expectedVersion: project.version || 1 }, "PATCH")
                  .then((data) => setProject(data.project))
                  .catch((e) => onError(e.message));
              }}
              onProjectOutput={(studio) => {
                void creatorApi(`/api/maker/projects/${id}/studio`, { ...studio, accountId, expectedVersion: project.version || 1 })
                  .then((data) => setProject(data.project))
                  .catch((e) => onError(e.message));
              }}
            />
          </div>
        ) : (
          <div className={`maker-page ${currentStage === "visualPlan" ? "is-medium" : ""}`}>
            {currentStage === "brief" && (
              <section className="maker-card maker-gen">
                {genHead()}
                <div className="maker-gen-body maker-stack">
                  <label className="maker-field">
                    Project name
                    <input value={draft.title || ""} maxLength={180} onChange={(e) => edit({ title: e.target.value })} />
                  </label>
                  <label className="maker-field">
                    Creative brief
                    <textarea
                      rows={6}
                      value={draft.brief || ""}
                      placeholder="Topic, audience, story angle, and must-have details"
                      onChange={(e) => edit({ brief: e.target.value })}
                    />
                  </label>
                  <Disclosure label="Script defaults" summary={`${settings.wordCount ?? 600} words · research ${settings.research ? "on" : "off"}`}>
                    <div className="maker-grid-2">
                      <label className="maker-field">
                        Target words
                        <input type="number" min={100} max={5000} step={50} value={settings.wordCount ?? 600} onChange={(e) => editSetting({ wordCount: Number(e.target.value) })} />
                      </label>
                      <label className="maker-switch maker-align-end">
                        <input type="checkbox" checked={Boolean(settings.research)} onChange={(e) => editSetting({ research: e.target.checked })} />
                        Research and keep source links
                      </label>
                      <label className="maker-field maker-span">
                        Additional script context
                        <textarea rows={3} value={settings.additionalContext || ""} onChange={(e) => editSetting({ additionalContext: e.target.value })} />
                      </label>
                    </div>
                  </Disclosure>
                  <Disclosure label="Voice" summary={voiceCaption}>
                    <div className="maker-grid-2">
                      {voiceSelect}
                      <label className="maker-field">
                        Voice speed
                        <input type="number" min={0.5} max={1.5} step={0.05} value={settings.voiceSpeed ?? 1} onChange={(e) => editSetting({ voiceSpeed: Number(e.target.value) })} />
                      </label>
                      <label className="maker-field">
                        Narration style
                        <input value={settings.narrationStyle || ""} placeholder="Calm documentary" onChange={(e) => editSetting({ narrationStyle: e.target.value })} />
                      </label>
                      <label className="maker-field">
                        Pronunciation notes
                        <input value={settings.pronunciation || ""} onChange={(e) => editSetting({ pronunciation: e.target.value })} />
                      </label>
                    </div>
                  </Disclosure>
                  <Disclosure label="Visuals" summary={`${settings.aspect || "16:9"} · ${settings.visualStyle || "no style set"}`}>
                    <div className="maker-grid-2">
                      <label className="maker-field">
                        Format
                        <select value={settings.aspect || "16:9"} onChange={(e) => editSetting({ aspect: e.target.value })}>
                          <option value="16:9">16:9 · YouTube</option>
                          <option value="9:16">9:16 · Shorts</option>
                          <option value="1:1">1:1 · Square</option>
                        </select>
                      </label>
                      <label className="maker-field">
                        Visual style
                        <input value={settings.visualStyle || ""} placeholder="Cinematic, hand-drawn, documentary…" onChange={(e) => editSetting({ visualStyle: e.target.value })} />
                      </label>
                      <label className="maker-field">
                        Scene length (seconds)
                        <input type="number" min={5} max={60} value={settings.sceneSeconds ?? 12} onChange={(e) => editSetting({ sceneSeconds: Number(e.target.value) })} />
                      </label>
                      <label className="maker-field">
                        Image quality
                        <select value={settings.quality || "standard"} onChange={(e) => editSetting({ quality: e.target.value })}>
                          <option value="standard">Standard · 1K</option>
                          <option value="high">High · 2K</option>
                        </select>
                      </label>
                    </div>
                  </Disclosure>
                  <Disclosure label="Soundtrack and thumbnail" summary={settings.soundtrackMood || "mood inferred from script"}>
                    <div className="maker-grid-2">
                      <label className="maker-field">
                        Soundtrack mood
                        <input value={settings.soundtrackMood || ""} placeholder="Infer from the script" onChange={(e) => editSetting({ soundtrackMood: e.target.value })} />
                      </label>
                      <label className="maker-field">
                        Music timing
                        <select value={settings.soundtrackTiming || "narrative"} onChange={(e) => editSetting({ soundtrackTiming: e.target.value })}>
                          <option value="narrative">Split at narrative beats</option>
                          <option value="single">Use one track</option>
                        </select>
                      </label>
                      <label className="maker-field maker-span">
                        Thumbnail brief
                        <textarea rows={2} value={settings.thumbnailPrompt || ""} onChange={(e) => editSetting({ thumbnailPrompt: e.target.value })} />
                      </label>
                    </div>
                  </Disclosure>
                  <div className="maker-stage-footer">
                    <button className="maker-primary maker-lg" disabled={busy} onClick={async () => { if (!dirty || (await save())) void navigate("title"); }}>
                      Continue to title
                      <ArrowUpRight size={16} />
                    </button>
                  </div>
                </div>
              </section>
            )}
            {currentStage === "title" && (
              <section className="maker-card maker-gen">
                {genHead()}
                <div className="maker-gen-body maker-stack">
                  {stageNotices}
                  <div className="maker-options" role="radiogroup" aria-label="Title inspiration">
                    <Option
                      name="title-source"
                      value="samples"
                      checked={draft.reference?.mode === "samples"}
                      onChange={() => edit({ reference: { ...draft.reference, mode: "samples" } })}
                      title="Generate from sample list"
                      text="Paste titles you like and get similar ones."
                      icon={<ListOrdered size={18} />}
                      tone="is-ink"
                    />
                    {draft.reference?.mode === "samples" && (
                      <div className="maker-option-extra">
                        <textarea
                          aria-label="Reference titles"
                          rows={4}
                          placeholder="One title per line"
                          value={draft.reference?.samples || ""}
                          onChange={(e) => edit({ reference: { ...draft.reference, samples: e.target.value } })}
                        />
                      </div>
                    )}
                    <Option
                      name="title-source"
                      value="channel"
                      checked={draft.reference?.mode === "channel"}
                      onChange={() => edit({ reference: { ...draft.reference, mode: "channel" } })}
                      title="Generate from YouTube channel"
                      text="Analyze a channel and write titles in its style."
                      icon={<Youtube size={18} />}
                      tone="is-soft"
                    />
                    {draft.reference?.mode === "channel" && (
                      <div className="maker-option-extra">
                        <input
                          type="url"
                          aria-label="Channel URL"
                          value={draft.reference?.url || ""}
                          placeholder="https://youtube.com/@channel"
                          onChange={(e) => edit({ reference: { ...draft.reference, url: e.target.value } })}
                        />
                      </div>
                    )}
                    <Option
                      name="title-source"
                      value="style"
                      checked={(draft.reference?.mode || "style") === "style"}
                      onChange={() => edit({ reference: { ...draft.reference, mode: "style" } })}
                      title="Generate from your style"
                      text={styleName ? `Use “${styleName}” reference videos.` : "Use the project brief and saved style guide."}
                      icon={<Sparkles size={18} />}
                    />
                  </div>
                  <label className="maker-field">
                    Selected title
                    <input value={draft.current || ""} maxLength={100} onChange={(e) => edit({ current: e.target.value })} placeholder="Write a title or generate candidates" />
                    <small>{(draft.current || "").length} / 100 characters</small>
                  </label>
                  {draft.ideas?.length ? (
                    <>
                      <div className="maker-section-title maker-flush-top">
                        <h3>{draft.ideas.length} titles generated</h3>
                        <span>Pick one, or edit it above</span>
                      </div>
                      <div className="maker-title-list" role="radiogroup" aria-label="Generated titles">
                        {draft.ideas.map((idea: any, i: number) => (
                          <label className="maker-option" key={`${idea.title}-${i}`}>
                            <input type="radio" name="title-pick" checked={draft.current === idea.title} onChange={() => edit({ current: idea.title })} />
                            <span className="maker-option-body">
                              <strong>{idea.title}</strong>
                              <span>{idea.reason}</span>
                            </span>
                            <span className="maker-radio" aria-hidden="true" />
                          </label>
                        ))}
                      </div>
                    </>
                  ) : null}
                  <button
                    className="maker-primary maker-lg maker-block"
                    disabled={busy || !draft.current?.trim()}
                    onClick={async () => {
                      if (await save()) void navigate("script");
                    }}
                  >
                    Use title and continue
                  </button>
                </div>
              </section>
            )}
            {currentStage === "script" && (
              <section className="maker-card maker-gen">
                {genHead()}
                <div className="maker-gen-body maker-stack">
                  {stageNotices}
                  <div className="maker-readonly">
                    <span>Title</span>
                    <strong>{project.outputs.title?.current || "No title yet"}</strong>
                  </div>
                  <label className="maker-switch">
                    <input type="checkbox" checked={Boolean(settings.research)} onChange={(e) => editSetting({ research: e.target.checked })} />
                    <span>
                      Web research
                      <small>Pull citable sources into the script. May take longer.</small>
                    </span>
                  </label>
                  <Disclosure label="Show options" summary={`${styleName || "no style"} · ${settings.wordCount ?? 600} words`}>
                    <div className="maker-grid-2">
                      <label className="maker-field">
                        Target word count
                        <input type="number" min={100} max={5000} step={50} value={settings.wordCount ?? 600} onChange={(e) => editSetting({ wordCount: Number(e.target.value) })} />
                      </label>
                      <span />
                      <label className="maker-field maker-span">
                        Additional context
                        <textarea rows={3} value={settings.additionalContext || ""} placeholder="Facts to include, angle, audience" onChange={(e) => editSetting({ additionalContext: e.target.value })} />
                      </label>
                    </div>
                  </Disclosure>
                  <div>
                    <textarea
                      aria-label="Narration script"
                      className="maker-script-editor"
                      value={draft.draft || ""}
                      placeholder="Write or generate your narration"
                      onChange={(e) => edit({ draft: e.target.value })}
                    />
                    <div className="maker-meta-row">
                      <span>{wordCount(draft.draft)} words</span>
                      <span>Target {settings.wordCount || 600}</span>
                    </div>
                  </div>
                  {draft.outline?.length ? (
                    <Disclosure label="Outline" summary={`${draft.outline.length} beats`}>
                      <ol className="maker-outline-list">
                        {draft.outline.map((beat: string, index: number) => (
                          <li key={`${beat}-${index}`}>{beat}</li>
                        ))}
                      </ol>
                    </Disclosure>
                  ) : null}
                  {draft.sources?.length ? (
                    <Disclosure label="Research sources" summary={`${draft.sources.length} linked`} defaultOpen>
                      <ul className="maker-sources">
                        {draft.sources.map((source: any, index: number) => (
                          <li key={`${source.url || source.title}-${index}`}>
                            <a href={source.url} target="_blank" rel="noreferrer">
                              {source.title || source.url}
                              <ArrowUpRight size={13} />
                            </a>
                          </li>
                        ))}
                      </ul>
                    </Disclosure>
                  ) : null}
                </div>
              </section>
            )}
            {currentStage === "seo" && (
              <section className="maker-card maker-gen">
                {genHead(
                  draft.description ? (
                    <button
                      className="maker-outline"
                      onClick={() => {
                        void navigator.clipboard?.writeText([draft.description, (draft.tags || []).map((t: string) => `#${t.replace(/\s+/g, "")}`).join(" ")].filter(Boolean).join("\n\n"));
                        setCopied(true);
                        setTimeout(() => setCopied(false), 1600);
                      }}
                    >
                      {copied ? <Check size={15} /> : <Copy size={15} />}
                      {copied ? "Copied" : "Copy"}
                    </button>
                  ) : null,
                )}
                <div className="maker-gen-body maker-stack">
                  {stageNotices}
                  <label className="maker-field">
                    Description
                    <textarea rows={10} value={draft.description || ""} onChange={(e) => edit({ description: e.target.value })} />
                  </label>
                  <label className="maker-field">
                    Tags <small>Comma separated</small>
                    <input value={(draft.tags || []).join(", ")} onChange={(e) => edit({ tags: e.target.value.split(",").map((t) => t.trim()) })} />
                  </label>
                  <div className="maker-grid-2">
                    <label className="maker-field">
                      Chapters
                      <textarea
                        rows={4}
                        value={(draft.chapters || []).join("\n")}
                        placeholder="00:00 Opening"
                        onChange={(e) => edit({ chapters: e.target.value.split("\n").map((line) => line.trim()).filter(Boolean) })}
                      />
                    </label>
                    <label className="maker-field">
                      Pinned comment
                      <textarea rows={4} value={draft.pinnedComment || ""} onChange={(e) => edit({ pinnedComment: e.target.value })} />
                    </label>
                    <label className="maker-field">
                      Disclosure
                      <textarea rows={3} value={draft.disclosure || ""} onChange={(e) => edit({ disclosure: e.target.value })} />
                    </label>
                    <label className="maker-field">
                      Links
                      <textarea
                        rows={3}
                        value={(draft.links || []).join("\n")}
                        placeholder="https://example.com/source"
                        onChange={(e) => edit({ links: e.target.value.split("\n").map((line) => line.trim()).filter(Boolean) })}
                      />
                    </label>
                  </div>
                </div>
              </section>
            )}
            {currentStage === "voiceover" && (
              <section className="maker-card maker-gen">
                {genHead()}
                <div className="maker-gen-body maker-stack">
                  {stageNotices}
                  <Disclosure label="Show script" summary={`${wordCount(project.outputs.script?.draft)} words`}>
                    <p className="maker-script-preview">{project.outputs.script?.draft || "No script yet."}</p>
                  </Disclosure>
                  <div className="maker-grid-3">
                    {voiceSelect}
                    <label className="maker-field">
                      Speed
                      <input type="number" min={0.5} max={1.5} step={0.05} value={settings.voiceSpeed ?? 1} onChange={(e) => editSetting({ voiceSpeed: Number(e.target.value) })} />
                    </label>
                    <label className="maker-field">
                      Pronunciation
                      <input value={settings.pronunciation || ""} placeholder="Names, acronyms" onChange={(e) => editSetting({ pronunciation: e.target.value })} />
                    </label>
                  </div>
                  <p className="maker-caption">{voiceCaption}</p>
                  {output?.asset ? (
                    <>
                      <div className="maker-player">
                        <span>Your voiceover is ready · {durationLabel(output.duration)}</span>
                        <audio controls src={output.asset} />
                      </div>
                      <Disclosure label="Timestamped transcript" summary={`${output.segments?.length || 0} segments, aligned with local Whisper`}>
                        <div className="maker-transcript">
                          {output.segments?.map((s: any, i: number) => (
                            <p key={i}>
                              <time>{durationLabel(s.start)}</time>
                              {s.text}
                            </p>
                          ))}
                        </div>
                      </Disclosure>
                    </>
                  ) : null}
                </div>
              </section>
            )}
            {currentStage === "soundtrack" && (
              <section className="maker-card maker-gen">
                {genHead()}
                <div className="maker-gen-body">
                  {stageNotices}
                  <Step n={1} title="Audio source">
                    {voiceover?.asset ? (
                      <div className="maker-source-row">
                        <Mic size={16} />
                        <span>
                          <strong>Generated voiceover</strong>
                          <small>{durationLabel(voiceover.duration)} · music is timed and ducked against it</small>
                        </span>
                      </div>
                    ) : (
                      <p className="maker-caption">Generate the voiceover first so music can follow its timing.</p>
                    )}
                  </Step>
                  <Step n={2} title="Mood and segments">
                    <div className="maker-grid-2">
                      <label className="maker-field">
                        Music mood
                        <input
                          value={draft.query || draft.mood || ""}
                          placeholder="e.g. tense investigative, low strings"
                          onChange={(e) => {
                            edit({ query: e.target.value });
                            editSetting({ soundtrackMood: e.target.value });
                          }}
                        />
                      </label>
                      <label className="maker-field">
                        Timing
                        <select value={settings.soundtrackTiming || "narrative"} onChange={(e) => editSetting({ soundtrackTiming: e.target.value })}>
                          <option value="narrative">Split at narrative beats</option>
                          <option value="single">One track throughout</option>
                        </select>
                      </label>
                      <label className="maker-field">
                        Music level · {Math.round((settings.soundtrackVolume ?? 0.18) * 100)}%
                        <input type="range" min={0} max={1} step={0.05} value={settings.soundtrackVolume ?? 0.18} onChange={(e) => editSetting({ soundtrackVolume: Number(e.target.value) })} />
                      </label>
                      <label className="maker-switch maker-align-end">
                        <input type="checkbox" checked={settings.preserveDialogue !== false} onChange={(e) => editSetting({ preserveDialogue: e.target.checked })} />
                        Duck music under narration
                      </label>
                    </div>
                    {draft.segments?.length ? (
                      <div className="maker-mood-bar" aria-label="Mood segments">
                        {draft.segments.map((s: any, i: number) => (
                          <div key={i} style={{ flexGrow: Math.max(1, (s.text || "").length) }} title={s.text}>
                            {s.mood}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="maker-caption">Auto-split reads the script and marks where the mood should change.</p>
                    )}
                  </Step>
                  <Step n={3} title="Find and import a track">
                    <div className="maker-actions">
                      <button
                        className="maker-ink"
                        disabled={musicBusy}
                        onClick={async () => {
                          setMusicBusy(true);
                          try {
                            const query = draft.query || draft.mood || settings.soundtrackMood || "";
                            const data = await creatorApi(`/api/automation/voice/music/search?q=${encodeURIComponent(query)}`);
                            setMusicTracks(data.tracks || []);
                            if (!(data.tracks || []).length) onError("No royalty-free tracks matched that mood. Try broader words.");
                          } catch (error) {
                            onError((error as Error).message);
                          } finally {
                            setMusicBusy(false);
                          }
                        }}
                      >
                        {musicBusy ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
                        Search royalty-free
                      </button>
                      <a className="mk-btn maker-outline" href={`https://pixabay.com/music/search/${encodeURIComponent(draft.query || draft.mood || "")}/`} target="_blank" rel="noreferrer">
                        Pixabay
                        <ArrowUpRight size={14} />
                      </a>
                      <a className="mk-btn maker-outline" href={`https://openverse.org/search/audio?q=${encodeURIComponent(draft.query || draft.mood || "")}`} target="_blank" rel="noreferrer">
                        Openverse
                        <ArrowUpRight size={14} />
                      </a>
                    </div>
                    {musicTracks.length ? (
                      <div className="maker-card maker-track-list">
                        {musicTracks.map((track) => (
                          <div className="maker-track" key={track.id}>
                            <Music size={16} />
                            <div>
                              <strong>{track.title}</strong>
                              <span>
                                {track.creator} · {track.provider} · {track.license}
                              </span>
                            </div>
                            <button
                              className="maker-outline"
                              disabled={busy}
                              onClick={async () => {
                                if (!window.confirm(`Import “${track.title}” under its stated ${track.license} license?`)) return;
                                setBusy(true);
                                try {
                                  const data = await creatorApi(`/api/maker/projects/${id}/soundtrack-url`, {
                                    url: track.url,
                                    landingUrl: track.landingUrl,
                                    credit: track.attribution || track.creator,
                                    license: track.license,
                                    rightsConfirmed: true,
                                    accountId,
                                    expectedVersion: project.version || 1,
                                  });
                                  setProject(data.project);
                                } catch (error) {
                                  onError((error as Error).message);
                                } finally {
                                  setBusy(false);
                                }
                              }}
                            >
                              Use track
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : null}
                    {output?.asset && (
                      <div className="maker-player">
                        <span>Current soundtrack{draft.credit ? ` · ${draft.credit}` : ""}</span>
                        <audio controls src={output.asset} />
                      </div>
                    )}
                    <div className="maker-grid-2">
                      <label className="maker-field">
                        Music credit
                        <input value={draft.credit || ""} placeholder="Artist · license" onChange={(e) => edit({ credit: e.target.value })} />
                      </label>
                      <label className="maker-field">
                        Import licensed audio <small>Up to 30 MB</small>
                        <input type="file" accept="audio/*" onChange={(e) => void upload(e.target.files?.[0], 30, "audio")} />
                      </label>
                    </div>
                  </Step>
                </div>
              </section>
            )}
            {currentStage === "visualPlan" &&
              (view === "settings" ? (
                <section className="maker-card maker-gen">
                  {genHead()}
                  <div className="maker-gen-body maker-stack">
                    {stageNotices}
                    {voiceover?.asset ? (
                      <div className="maker-player">
                        <span>Your generated voiceover is ready to use · {durationLabel(voiceover.duration)}</span>
                        <audio controls src={voiceover.asset} />
                      </div>
                    ) : null}
                    <label className="maker-switch">
                      <input type="checkbox" checked={advanced} onChange={(e) => setAdvanced(e.target.checked)} />
                      Advanced
                    </label>
                    <div className="maker-visual-settings">
                      <div className="maker-field">
                        <span>1. Aspect ratio</span>
                        <div className="maker-presets">
                          {["16:9", "9:16", "1:1"].map((ratio) => (
                            <button key={ratio} aria-pressed={(settings.aspect || "16:9") === ratio} onClick={() => editSetting({ aspect: ratio })}>
                              {ratio}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="maker-field">
                        <span>2. Safe prompts</span>
                        <label className="maker-switch">
                          <input type="checkbox" checked={Boolean(settings.safePrompts)} onChange={(e) => editSetting({ safePrompts: e.target.checked })} />
                          {settings.safePrompts ? "On" : "Off"}
                        </label>
                      </div>
                      <label className="maker-field">
                        3. Visual style
                        <input value={settings.visualStyle || ""} placeholder="3D animation, ink wash…" onChange={(e) => editSetting({ visualStyle: e.target.value })} />
                      </label>
                      <label className="maker-field">
                        4. Image source
                        <select value={settings.sourcePolicy || "generated"} onChange={(e) => editSetting({ sourcePolicy: e.target.value })}>
                          <option value="generated">Generated</option>
                          <option value="reference">Approved references</option>
                          <option value="upload">Uploaded images</option>
                        </select>
                      </label>
                    </div>
                    {advanced && (
                      <div className="maker-card maker-segment-settings">
                        <div className="maker-card-head">
                          <h3>Segment settings</h3>
                          <span className="maker-mono">
                            {voiceover?.duration ? `${durationLabel(voiceover.duration)} narration` : "No narration yet"}
                          </span>
                        </div>
                        <div className="maker-card-body maker-stack">
                          <div className="maker-field">
                            <span>Quality preset</span>
                            <div className="maker-presets">
                              {[
                                ["standard", "Standard · 1K"],
                                ["high", "High · 2K"],
                              ].map(([value, label]) => (
                                <button key={value} aria-pressed={(settings.quality || "standard") === value} onClick={() => editSetting({ quality: value })}>
                                  {label}
                                </button>
                              ))}
                            </div>
                          </div>
                          <div className="maker-grid-2">
                            <div className="maker-setting-tile">
                              <div>
                                <strong>Motion</strong>
                                <span>Local pan and zoom on stills. Not generative animation.</span>
                              </div>
                              <label className="maker-switch">
                                <input type="checkbox" aria-label="Pan and zoom" checked={settings.motion === "push"} onChange={(e) => editSetting({ motion: e.target.checked ? "push" : "still" })} />
                              </label>
                            </div>
                            <div className="maker-setting-tile">
                              <div>
                                <strong>Pacing</strong>
                                <span>Seconds each image stays on screen</span>
                              </div>
                              <span className="maker-chip">
                                ~
                                {voiceover?.duration && settings.imageCount
                                  ? (voiceover.duration / settings.imageCount).toFixed(1)
                                  : settings.sceneSeconds ?? 12}
                                s
                              </span>
                            </div>
                          </div>
                          <div className="maker-setting-tile">
                            <div>
                              <strong>AI animation</strong>
                              <span>
                                {animation?.available
                                  ? `Image-to-video through OpenRouter (${animation.model}). Turn it on per scene.`
                                  : animation?.reason || "Checking the animation provider"}
                              </span>
                            </div>
                            <span className={`maker-pill-status ${animation?.available ? "is-ready" : ""}`}>
                              {animation?.available ? "Available" : "Off"}
                            </span>
                          </div>
                          <label className="maker-field">
                            <span className="maker-split">
                              Image count
                              <small>{settings.imageCount ? `${settings.imageCount} images` : "Auto from scene length"}</small>
                            </span>
                            <input
                              type="range"
                              min={1}
                              max={Math.max(12, Math.min(300, Math.ceil((voiceover?.duration || 600) / 3)))}
                              value={settings.imageCount || Math.max(1, Math.round((voiceover?.duration || 120) / (settings.sceneSeconds || 12)))}
                              onChange={(e) => editSetting({ imageCount: Number(e.target.value) })}
                            />
                          </label>
                        </div>
                      </div>
                    )}
                    <div className="maker-stage-footer">
                      {scenes.length > 0 && (
                        <button className="maker-outline" onClick={() => setVisualView("scenes")}>
                          Review {scenes.length} scenes
                          <ArrowUpRight size={15} />
                        </button>
                      )}
                    </div>
                  </div>
                </section>
              ) : (
                <>
                  <div className="maker-scene-head">
                    <button className="maker-link" onClick={() => setVisualView("settings")}>
                      <ChevronLeft size={14} />
                      Back to settings
                    </button>
                    <div className="maker-stage-head">
                      <div>
                        <h2>Scene generation</h2>
                        <p>Review each prompt, then generate images. Only missing scenes are generated.</p>
                      </div>
                      <div className="maker-actions">
                        {dirty && (
                          <button className="maker-outline" disabled={busy} onClick={() => void save()}>
                            <Save size={15} />
                            Save
                          </button>
                        )}
                        {active && latest ? (
                          <button className="maker-outline" onClick={() => void stop(latest)}>
                            <Pause size={15} />
                            Stop
                          </button>
                        ) : (
                          <button className="maker-primary" disabled={busy || !scenes.some((s) => !s.asset)} onClick={() => setConfirm({ action: "images", confirmed: true })}>
                            <ImagePlus size={15} />
                            Generate all images
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                  {stageNotices}
                  {timeline}
                  <div className="maker-reference-upload">
                    <span>
                      <ImagePlus size={15} />
                      Reference images <small>{project.metadata.referenceAssets?.length || 0} uploaded · used by scenes set to Reference</small>
                    </span>
                    <label className="mk-btn maker-outline">
                      Upload image
                      <input type="file" hidden accept="image/png,image/jpeg,image/webp" onChange={(e) => void upload(e.target.files?.[0], 15, "image")} />
                    </label>
                  </div>
                  <div className="maker-scenes">
                    {scenes.map((scene, index) => (
                      <article key={scene.id} id={scene.id} className="maker-card maker-scene" data-selected={selectedScene === scene.id || undefined}>
                        <div className="maker-scene-body">
                          <div className="maker-scene-row">
                            <span className="maker-chip">Scene {index + 1}</span>
                            <span className="maker-mono">
                              {durationLabel(scene.start)} – {durationLabel(scene.end)}
                            </span>
                          </div>
                          <p className="maker-scene-text">“{scene.text}”</p>
                          <div className="maker-duration">
                            <span>Duration ({(scene.end - scene.start).toFixed(1)}s)</span>
                            <span className="maker-progress-track">
                              <span style={{ width: `${Math.min(100, ((scene.end - scene.start) / Math.max(1, voiceover?.duration || scene.end)) * 100 * 4)}%` }} />
                            </span>
                          </div>
                          <label className="maker-field">
                            Image prompt
                            <textarea aria-label={`Scene ${index + 1} prompt`} rows={3} value={scene.prompt} onChange={(e) => editScene(index, { prompt: e.target.value })} />
                          </label>
                          <div className="maker-scene-row">
                            <select aria-label={`Scene ${index + 1} motion`} value={scene.motion || "still"} onChange={(e) => editScene(index, { motion: e.target.value })}>
                              <option value="still">Still</option>
                              <option value="push">Pan and zoom</option>
                            </select>
                            <select aria-label={`Scene ${index + 1} source policy`} value={scene.sourcePolicy || "generated"} onChange={(e) => editScene(index, { sourcePolicy: e.target.value })}>
                              <option value="generated">Generated</option>
                              <option value="reference">Reference</option>
                              <option value="upload">Upload</option>
                            </select>
                            <label className="maker-switch" title={animation?.available ? "Animate this scene with AI" : animation?.reason}>
                              <input
                                type="checkbox"
                                aria-label={`Animate scene ${index + 1}`}
                                disabled={!animation?.available}
                                checked={Boolean(scene.animate)}
                                onChange={(e) => editScene(index, { animate: e.target.checked })}
                              />
                              Animate this scene
                            </label>
                            {scene.sourcePolicy && scene.sourcePolicy !== "generated" && project.metadata.referenceAssets?.length ? (
                              <select aria-label={`Scene ${index + 1} reference image`} value={scene.referenceAsset || ""} onChange={(e) => editScene(index, { referenceAsset: e.target.value })}>
                                <option value="">Choose a reference</option>
                                {project.metadata.referenceAssets.map((asset: string) => (
                                  <option key={asset} value={asset}>
                                    {asset.split("/").pop()}
                                  </option>
                                ))}
                              </select>
                            ) : null}
                          </div>
                        </div>
                        <div className="maker-scene-media" style={{ aspectRatio: (project.metadata.settings?.aspect || "16:9").replace(":", "/") }}>
                          {scene.clip ? (
                            <video src={scene.clip} muted loop autoPlay playsInline aria-label={`Scene ${index + 1} animation`} />
                          ) : scene.asset ? (
                            <img src={scene.asset} alt={scene.prompt} />
                          ) : (
                            <ImagePlus size={28} />
                          )}
                          {scene.clip && <em className="maker-media-tag">Animated</em>}
                          {animation?.available && scene.asset && (
                            <Action
                              label={scene.clip ? `Re-animate scene ${index + 1}` : `Animate scene ${index + 1}`}
                              className="maker-icon maker-media-action is-third"
                              disabled={active}
                              onClick={() => setConfirm({ action: "animate", sceneId: scene.id, confirmed: true })}
                            >
                              <Sparkles size={15} />
                            </Action>
                          )}
                          <Action
                            label={scene.asset ? `Regenerate scene ${index + 1}` : `Generate scene ${index + 1}`}
                            className="maker-icon maker-media-action"
                            disabled={active}
                            onClick={() => setConfirm({ action: "images", sceneId: scene.id, confirmed: true })}
                          >
                            <RefreshCw size={15} />
                          </Action>
                          {scene.asset && (
                            <a className="mk-btn maker-icon maker-media-action is-second" href={scene.asset} download aria-label={`Download scene ${index + 1}`}>
                              <Download size={15} />
                            </a>
                          )}
                        </div>
                      </article>
                    ))}
                  </div>
                  <div className="maker-scene-footer">
                    <span>
                      {scenes.length} scenes · {Math.round(voiceover?.duration || scenes.at(-1)?.end || 0)}s · {scenes.filter((s) => s.asset).length} images ready
                    </span>
                    <button className="maker-outline" onClick={() => setVisualView("settings")}>
                      Back to settings
                    </button>
                    <button className="maker-primary" disabled={active || busy || !missingImages} onClick={() => setConfirm({ action: "images", confirmed: true })}>
                      <ImagePlus size={15} />
                      Generate all images{missingImages ? ` (${missingImages})` : ""}
                    </button>
                    {toAnimate > 0 && (
                      <button className="maker-outline" disabled={active || busy} onClick={() => setConfirm({ action: "animate", confirmed: true })}>
                        <Sparkles size={15} />
                        Animate {toAnimate} {toAnimate === 1 ? "scene" : "scenes"}
                      </button>
                    )}
                    <button className="maker-ink" disabled={!scenes.length || scenes.some((s) => !s.asset)} onClick={() => void navigate("review")}>
                      Render video
                    </button>
                  </div>
                </>
              ))}
            {currentStage === "thumbnail" && (
              <section className="maker-card maker-gen">
                {genHead()}
                <div className="maker-gen-body">
                  {stageNotices}
                  <Step n={1} title="Describe the click moment">
                    <textarea
                      rows={3}
                      aria-label="Thumbnail description"
                      value={settings.thumbnailPrompt || ""}
                      placeholder={project.outputs.title?.current ? `Defaults to the title: ${project.outputs.title.current}` : "Subject, emotion, contrast, and one short text idea"}
                      onChange={(e) => editSetting({ thumbnailPrompt: e.target.value })}
                    />
                  </Step>
                  <Step n={2} title="Generate three variants">
                    <p className="maker-caption">Three image requests go to your configured provider. Compare them before choosing.</p>
                  </Step>
                  <Step n={3} title="Choose one">
                    {draft.variants?.length ? (
                      <div className="maker-thumbnail-grid">
                        {draft.variants.map((variant: any, index: number) => (
                          <button key={variant.asset} aria-pressed={draft.asset === variant.asset} onClick={() => edit({ asset: variant.asset, selectedVariant: index })}>
                            <img src={variant.asset} alt={`Thumbnail variant ${index + 1}`} />
                            <span>
                              Variant {index + 1}
                              {draft.asset === variant.asset && <Check size={14} />}
                            </span>
                          </button>
                        ))}
                      </div>
                    ) : output?.asset ? (
                      <img className="maker-media-frame" src={output.asset} alt="Generated thumbnail" />
                    ) : (
                      <div className="maker-placeholder">
                        <ImagePlus size={24} />
                        Variants appear here
                      </div>
                    )}
                    {(draft.asset || output?.asset) && (
                      <div className="maker-actions">
                        <a className="mk-btn maker-outline" href={draft.asset || output.asset} download>
                          <Download size={15} />
                          Download selected
                        </a>
                      </div>
                    )}
                  </Step>
                </div>
              </section>
            )}
            {currentStage === "review" && (
              <section className="maker-card maker-gen">
                {genHead()}
                <div className="maker-gen-body maker-stack">
                  {stageNotices}
                  {output?.asset && (
                    <>
                      <video className="maker-media-frame" controls src={output.asset} playsInline />
                      <div className="maker-bundle">
                        <a className="mk-btn maker-outline" href={output.asset} download>
                          <Download size={15} />
                          Video
                        </a>
                        <a className="mk-btn maker-primary" href={output.bundle} download>
                          <Download size={15} />
                          Download all assets
                        </a>
                        {output.captions && (
                          <a className="mk-btn maker-outline" href={output.captions} download>
                            <Download size={15} />
                            Captions
                          </a>
                        )}
                      </div>
                    </>
                  )}
                  <div className="maker-card maker-checklist">
                    {(output?.asset
                      ? [
                          [Boolean(output.validation?.audio), "Audio stream present", ""],
                          [Boolean(output.validation?.subtitle), "Captions embedded", ""],
                          [output.validation?.sceneCount === project.outputs.visualPlan?.scenes?.length, "Scene order matches the plan", ""],
                          [Boolean(output.validation?.width && output.validation?.height), `${output.validation?.width || "?"} × ${output.validation?.height || "?"} · ${Math.round(output.validation?.duration || 0)}s`, ""],
                        ]
                      : [
                          [Boolean(voiceover?.asset), "Voiceover", "voiceover"],
                          [Boolean(project.outputs.visualPlan?.scenes?.length && project.outputs.visualPlan.scenes.every((scene: any) => scene.asset)), "Every scene has an image", "visualPlan"],
                          [Boolean(project.outputs.soundtrack?.asset || settings.musicPolicy === "none"), "Soundtrack imported or skipped", "soundtrack"],
                          [Boolean(project.outputs.thumbnail?.asset), "Thumbnail selected", "thumbnail"],
                          [Boolean(settings.rightsConfirmed), "Rights and provenance confirmed", ""],
                        ]
                    ).map(([ok, label, target]) => (
                      <div key={String(label)} className={ok ? "is-pass" : "is-fail"}>
                        <span>{ok ? <Check size={13} /> : <X size={13} />}</span>
                        {label}
                        {!ok && target ? (
                          <button className="maker-link" onClick={() => void navigate(String(target))}>
                            Open
                            <ArrowUpRight size={13} />
                          </button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                  <label className="maker-switch">
                    <input type="checkbox" checked={settings.musicPolicy === "none"} onChange={(e) => editSetting({ musicPolicy: e.target.checked ? "none" : "imported" })} />
                    Export without music
                  </label>
                  <label className="maker-switch">
                    <input type="checkbox" checked={Boolean(settings.rightsConfirmed)} onChange={(e) => editSetting({ rightsConfirmed: e.target.checked })} />
                    I confirm rights and provenance for every asset in this video
                  </label>
                </div>
              </section>
            )}
          </div>
        )}
      </div>
      {confirm && (
        <Modal
          title={
            confirm.action === "animate"
              ? confirm.sceneId
                ? "Animate this scene?"
                : `Animate ${toAnimate} ${toAnimate === 1 ? "scene" : "scenes"}?`
              : confirm.action === "images"
              ? confirm.sceneId
                ? "Generate this scene?"
                : "Generate scene images?"
              : confirm.action === "thumbnailVariants"
                ? "Generate three thumbnails?"
                : currentStage === "review"
                  ? "Render the video?"
                  : "Generate the voiceover?"
          }
          onClose={() => setConfirm(null)}
          footer={
            <>
              <button className="maker-outline" onClick={() => setConfirm(null)}>
                Cancel
              </button>
              <button className="maker-primary" onClick={() => void start(confirm)}>
                {currentStage === "review" ? "Render" : "Generate"}
              </button>
            </>
          }
        >
          <p>
            {confirm.action === "animate"
              ? `${confirm.sceneId ? "One" : toAnimate} image-to-video ${confirm.sceneId || toAnimate === 1 ? "request goes" : "requests go"} to OpenRouter (${animation?.model || "video model"}), billed per second of video. A retry resumes the same job instead of paying twice. Needs about ${Math.round((confirm.sceneId ? 1 : toAnimate) * 8)} MB of storage.`
              : confirm.action === "images"
              ? confirm.sceneId
                ? `One image request is sent to your configured provider. Needs about ${imageMb} MB of storage.`
                : `${missingImages} missing images will be requested. Scenes that already have images are skipped. Needs about ${Math.ceil(missingImages * imageMb)} MB of storage.`
              : confirm.action === "thumbnailVariants"
                ? "Three image requests are sent to your configured provider. Compare the variants before choosing."
                : currentStage === "review"
                  ? "FFmpeg renders locally from your voiceover, scenes, music, and captions, then validates the output."
                  : "Narration is generated with your selected voice, then aligned with local Whisper. Provider charges may apply."}
          </p>
        </Modal>
      )}
      {archiveOpen && (
        <Modal
          title="Archive this project?"
          onClose={() => setArchiveOpen(false)}
          footer={
            <>
              <button className="maker-outline" onClick={() => setArchiveOpen(false)}>
                Cancel
              </button>
              <button
                className="maker-primary"
                onClick={async () => {
                  setArchiveOpen(false);
                  try {
                    await creatorApi(`/api/maker/projects/${id}`, { status: "archived", accountId, expectedVersion: project.version || 1 }, "PATCH");
                    writeDeepLink({ view: "projects" });
                  } catch (error) {
                    onError((error as Error).message);
                  }
                }}
              >
                Archive project
              </button>
            </>
          }
        >
          <p>It moves to the Archived tab. Every script, voiceover, image, and render is kept, and you can restore it any time.</p>
        </Modal>
      )}
    </>
  );
}
