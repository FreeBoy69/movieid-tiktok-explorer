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
  Upload,
  Volume2,
  VolumeX,
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
  mergeVisualSegment,
  normalizeMusicSegments,
  normalizeVisualSegments,
  rankDiscoveryChannels,
  segmentImageLimit,
  splitVisualSegment,
  transcriptBoundaries,
} from "../utils/creatorPipeline.js";
import { VoiceoverStudio } from "./VoiceoverStudio";
import { StandardVideoCard } from "./StandardCards";
import { loadVoiceProfiles } from "../utils/voiceProfiles";
import { AudioPlayer } from "./AudioPlayer";
import { StoryboardPreview } from "./StoryboardPreview";
import { SceneTimeline } from "./SceneTimeline";
import { VoicePicker } from "./VoicePicker";
import { PromptSuggestions } from "./PromptSuggestions";
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
  soundtrack: { name: "Soundtrack", text: "Compose original music timed to your narration, or import a royalty-free track.", icon: <Music size={18} /> },
  visualPlan: { name: "Visuals", text: "Split the narration into scenes, review prompts, then generate images.", icon: <ImageIcon size={18} /> },
  thumbnail: { name: "Thumbnail Generator", text: "Make new thumbnails in the style of the channel's winners, edit a reference, or start from scratch.", icon: <ImagePlus size={18} /> },
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

function EditProjectModal({
  accountId,
  project,
  styles,
  onClose,
  onSaved,
  onError,
}: {
  accountId: string;
  project: CreatorProject;
  styles: ChannelStyle[];
  onClose: () => void;
  onSaved: () => Promise<void>;
  onError: (e: string) => void;
}) {
  const [title, setTitle] = useState(project.title),
    [styleId, setStyleId] = useState(project.styleId || ""),
    [busy, setBusy] = useState(false);
  const styleChanged = styleId !== (project.styleId || "");
  async function save() {
    setBusy(true);
    try {
      await creatorApi(
        `/api/maker/projects/${project.id}`,
        { title: title.trim() || project.title, styleId, accountId, expectedVersion: project.version || 1 },
        "PATCH",
      );
      await onSaved();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Edit project"
      onClose={onClose}
      footer={
        <>
          <button className="maker-outline" onClick={onClose}>
            Cancel
          </button>
          <button className="maker-primary" disabled={busy || !title.trim()} onClick={() => void save()}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
            Save changes
          </button>
        </>
      }
    >
      <div className="maker-stack maker-modal-fields">
        <label className="maker-field">
          Project title
          <input value={title} maxLength={180} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="maker-field">
          Style
          <select value={styleId} onChange={(e) => setStyleId(e.target.value)}>
            <option value="">No style</option>
            {styles.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        {styleChanged && (
          <p className="maker-notice">
            <CircleAlert size={15} />
            Stages written with the old style are marked for updating. Nothing is deleted.
          </p>
        )}
      </div>
    </Modal>
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
    [pruning, setPruning] = useState<CreatorProject | null>(null),
    [editing, setEditing] = useState<CreatorProject | null>(null);
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
                  <button onClick={() => setEditing(p)}>
                    <Pencil size={14} />
                    Edit details
                  </button>
                  <button onClick={() => void duplicate(p)}>
                    <Copy size={14} />
                    Duplicate
                  </button>
                  {p.outputs?.thumbnail?.asset && (
                    <a className="mk-btn" href={p.outputs.thumbnail.asset} download>
                      <ImageIcon size={14} />
                      Download thumbnail
                    </a>
                  )}
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
      {editing && (
        <EditProjectModal
          accountId={accountId}
          project={editing}
          styles={styles}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await refresh();
          }}
          onError={onError}
        />
      )}
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
  maxViews: 0,
  minAvgViews: 0,
  maxAvgViews: 0,
  minVideos: 0,
  maxVideos: 0,
  createdAfter: "",
  createdBefore: "",
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
  if (filters.createdAfter) chips.push(["createdAfter", `Channel created after ${filters.createdAfter}`]);
  if (filters.createdBefore) chips.push(["createdBefore", `Channel created before ${filters.createdBefore}`]);
  if (filters.minViews) chips.push(["minViews", `Median views ≥ ${compact(filters.minViews)}`]);
  if (filters.maxViews) chips.push(["maxViews", `Median views ≤ ${compact(filters.maxViews)}`]);
  if (filters.minAvgViews) chips.push(["minAvgViews", `Average views ≥ ${compact(filters.minAvgViews)}`]);
  if (filters.maxAvgViews) chips.push(["maxAvgViews", `Average views ≤ ${compact(filters.maxAvgViews)}`]);
  if (filters.minVideos) chips.push(["minVideos", `Videos ≥ ${filters.minVideos}`]);
  if (filters.maxVideos) chips.push(["maxVideos", `Videos ≤ ${filters.maxVideos}`]);
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
export function ChannelCard({
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
  const [broken, setBroken] = useState(false),
    [thumbBroken, setThumbBroken] = useState(false);
  const tags = [c.niche, c.language && c.language.toUpperCase(), c.region].filter(Boolean);
  const hero = c.bestVideo || c.recentVideo;
  const latest = c.recentVideo && c.recentVideo.id !== hero?.id ? c.recentVideo : null;
  const facelessKnown = c.facelessConfidence !== null && c.facelessConfidence !== undefined;
  const meta = [
    c.handle,
    c.videoCount ? `${compact(c.videoCount)} videos` : `${c.sampleCount} sampled`,
    c.createdAt ? `started ${ageLabel(new Date(c.createdAt).toISOString())}` : "",
  ].filter(Boolean);
  const avatar =
    c.thumbnailUrl && !broken ? (
      <img className="maker-avatar" src={c.thumbnailUrl} alt="" onError={() => setBroken(true)} />
    ) : (
      <span className="maker-avatar" aria-hidden="true">
        {(c.title || "C")[0]}
      </span>
    );
  const subs = c.subscribers === null || c.subscribers === undefined ? "" : `${compact(c.subscribers)} subs`;
  const cadence = c.uploadCadenceDays === null || c.uploadCadenceDays === undefined ? "" : `every ~${Math.max(1, Math.round(c.uploadCadenceDays))}d`;
  // Everything that no longer fits on the 16:9 tile stays reachable as hover text.
  const details = [
    hero?.title,
    meta.join(" · "),
    c.medianDurationSeconds ? `${durationLabel(c.medianDurationSeconds)} typical length` : "",
    latest ? `Latest: ${latest.title} (${compact(latest.viewCount)} views, ${ageLabel(latest.publishedAt)})` : "",
  ].filter(Boolean).join("\n");
  return (
    <article className="maker-channel-tile" data-selected={selected || undefined}>
      <a className="maker-channel-tile-media" href={hero?.url || c.url} target="_blank" rel="noreferrer" title={details} aria-label={`Open ${hero?.title || c.title || "channel"} on YouTube`}>
        {hero?.thumbnailUrl && !thumbBroken ? (
          <img src={hero.thumbnailUrl} alt="" loading="lazy" onError={() => setThumbBroken(true)} />
        ) : (
          <span className="maker-yt-thumb-empty">{avatar}</span>
        )}
      </a>
      <div className="maker-channel-tile-top">
        <label className="maker-channel-tile-check" title="Select for a project">
          <input type="checkbox" aria-label={`Select ${c.title}`} checked={selected} onChange={(e) => onSelect(e.target.checked)} />
        </label>
        {tags[0] && <span className="maker-channel-tile-tag">{tags[0]}</span>}
        <span className="maker-channel-tile-tools">
          <Action label={bookmarked ? "Remove bookmark" : "Bookmark channel"} className="maker-channel-tile-tool" aria-pressed={bookmarked} onClick={onBookmark}>
            <Bookmark size={15} />
          </Action>
          <Action label="Similar channels" className="maker-channel-tile-tool" onClick={onSimilar}>
            <Users size={15} />
          </Action>
          <Action label={copying ? "Copying style…" : "Copy style"} className="maker-channel-tile-tool" disabled={copying} onClick={onCopyStyle}>
            {copying ? <Loader2 size={15} className="animate-spin" /> : <Copy size={15} />}
          </Action>
        </span>
      </div>
      <div className="maker-channel-tile-body">
        <a className="maker-channel-tile-name" href={c.url} target="_blank" rel="noreferrer">
          {avatar}
          <strong>{c.title || "Channel"}</strong>
          <ArrowUpRight size={13} />
        </a>
        <p className="maker-channel-tile-stats">
          {[subs, `${compact(c.medianViews)} median views`, cadence].filter(Boolean).join(" · ")}
          {facelessKnown && (
            <span className={c.facelessConfidence >= 50 ? "is-accent" : ""} title="Inferred from titles and thumbnails, not verified">
              {" "}· {c.facelessConfidence}% faceless
            </span>
          )}
        </p>
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
                ["created", "Newest channels"],
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
                  className="aspect-video"
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
        <h3>Channel recency</h3>
        <p className="maker-filter-note">When the channel was created, from YouTube channel data. Channels without a date are left out while a date is set.</p>
        <div className="maker-grid-2">
          <label className="maker-field">
            Created after
            <input type="date" value={f.createdAfter} max={f.createdBefore || undefined} onChange={(e) => set({ createdAfter: e.target.value })} />
          </label>
          <label className="maker-field">
            Created before
            <input type="date" value={f.createdBefore} min={f.createdAfter || undefined} onChange={(e) => set({ createdBefore: e.target.value })} />
          </label>
        </div>
      </section>
      <section>
        <h3>View statistics</h3>
        <p className="maker-filter-note">Median views show a channel's typical video. Average views get pulled up by a single viral hit.</p>
        <div className="maker-grid-4">
          {num("minViews", "Min median views")}
          {num("maxViews", "Max median views")}
          {num("minAvgViews", "Min average views")}
          {num("maxAvgViews", "Max average views")}
          {num("minRatio", "Min views per subscriber", { step: 0.05 })}
        </div>
      </section>
      <section>
        <h3>Channel statistics</h3>
        <div className="maker-grid-4">
          {num("minSubs", "Min subscribers")}
          {num("maxSubs", "Max subscribers")}
          {num("minVideos", "Min videos on channel")}
          {num("maxVideos", "Max videos on channel")}
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
    void loadVoiceProfiles()
      .then(({ profiles }) => setVoices(profiles))
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
          <div className="maker-field">
            <span id="style-voice-label">Voice</span>
            <VoicePicker
              voices={voices}
              value={settings.voiceId || ""}
              labelledBy="style-voice-label"
              noneLabel="Choose per project"
              onChange={(voiceId) => setSettings({ ...settings, voiceId })}
            />
          </div>
        </div>
        <Disclosure
          label="Advanced voice settings"
          summary={`${Math.round((settings.voiceSpeed ?? 1) * 100)}% speed${settings.narrationStyle ? ` · ${settings.narrationStyle}` : ""}`}
        >
          <div className="maker-grid-2">
            <label className="maker-field">
              <span className="maker-split">
                Voice speed
                <small className="maker-mono">{Math.round((settings.voiceSpeed ?? 1) * 100)}%</small>
              </span>
              <input
                type="range"
                min={0.7}
                max={1.3}
                step={0.05}
                value={settings.voiceSpeed ?? 1}
                onChange={(e) => setSettings({ ...settings, voiceSpeed: Number(e.target.value) })}
              />
              <small className="maker-hint">Around 105–110% suits 8–10 minute videos. Clones recorded fast may need 100%.</small>
            </label>
            <label className="maker-field">
              Delivery
              <input
                value={settings.narrationStyle || ""}
                maxLength={200}
                placeholder="Calm, measured documentary narrator"
                onChange={(e) => setSettings({ ...settings, narrationStyle: e.target.value })}
              />
              <small className="maker-hint">Direction passed to the voice engine with every line.</small>
              <PromptSuggestions category="narration" value={settings.narrationStyle || ""} onChange={(narrationStyle) => setSettings({ ...settings, narrationStyle: narrationStyle.slice(0, 200) })} accountId={accountId} limit={3} />
            </label>
            <label className="maker-field maker-span">
              Pronunciation notes
              <input
                value={settings.pronunciation || ""}
                maxLength={300}
                placeholder="Say “Toys R Us” as “toys are us”"
                onChange={(e) => setSettings({ ...settings, pronunciation: e.target.value })}
              />
            </label>
          </div>
        </Disclosure>
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

/* Art styles: built-in looks plus reusable custom styles trained on up to four frames. */
type ArtStyle = {
  id: string;
  name: string;
  description?: string;
  prompt?: string;
  preview?: string;
  images?: string[];
  source?: { type?: string; url?: string; timestamps?: number[] } | null;
};
function ArtStylePicker({
  presets,
  customs,
  value,
  onChange,
  onCreate,
  onDelete,
}: {
  presets: ArtStyle[];
  customs: ArtStyle[];
  value: string;
  onChange: (id: string) => void;
  onCreate: () => void;
  onDelete: (style: ArtStyle) => void;
}) {
  return (
    <div className="maker-art-grid" role="radiogroup" aria-label="Art style">
      <button type="button" className="maker-art-tile is-create" onClick={onCreate}>
        <span className="maker-art-swatch">
          <Plus size={20} />
        </span>
        <strong>Custom style</strong>
        <small>From your frames</small>
      </button>
      {customs.map((style) => (
        <div key={style.id} className="maker-art-tile-wrap">
          <button
            type="button"
            role="radio"
            aria-checked={value === style.id}
            className="maker-art-tile"
            onClick={() => onChange(value === style.id ? "" : style.id)}
            title={style.description}
          >
            <span className={`maker-art-swatch is-collage n-${Math.min(4, style.images?.length || 1)}`}>
              {(style.images || []).slice(0, 4).map((src) => (
                <img key={src} src={src} alt="" loading="lazy" />
              ))}
            </span>
            <strong>{style.name}</strong>
            <small>{style.images?.length || 0} reference{style.images?.length === 1 ? "" : "s"}</small>
            {value === style.id && <Check size={14} className="maker-art-check" />}
          </button>
          <Action label={`Delete ${style.name}`} className="maker-icon maker-art-delete" onClick={() => onDelete(style)}>
            <X size={14} />
          </Action>
        </div>
      ))}
      {presets.map((style) => (
        <button
          key={style.id}
          type="button"
          role="radio"
          aria-checked={value === style.id}
          className="maker-art-tile"
          onClick={() => onChange(value === style.id ? "" : style.id)}
          title={style.prompt}
        >
          <span className="maker-art-swatch">
            {style.preview ? <img src={style.preview} alt="" loading="lazy" /> : <ImageIcon size={20} />}
          </span>
          <strong>{style.name}</strong>
          <small>Built in</small>
          {value === style.id && <Check size={14} className="maker-art-check" />}
        </button>
      ))}
    </div>
  );
}
function CreateArtStyleModal({
  accountId,
  projectId,
  onClose,
  onCreated,
}: {
  accountId: string;
  projectId: string;
  onClose: () => void;
  onCreated: (id: string) => Promise<void>;
}) {
  const [name, setName] = useState(""),
    [description, setDescription] = useState(""),
    [mode, setMode] = useState<"video" | "frames">("video"),
    [sourceUrl, setSourceUrl] = useState(""),
    [rightsConfirmed, setRightsConfirmed] = useState(false),
    [images, setImages] = useState<Array<{ file: File; url: string }>>([]),
    [dragging, setDragging] = useState(false),
    [busy, setBusy] = useState(false),
    [problem, setProblem] = useState("");
  useEffect(() => () => images.forEach((image) => URL.revokeObjectURL(image.url)), []);
  function add(files: FileList | File[] | null) {
    setProblem("");
    const list = Array.from(files || []);
    const accepted = list.filter((file) => ["image/png", "image/jpeg", "image/webp"].includes(file.type) && file.size <= 10 * 1024 * 1024);
    if (accepted.length < list.length) setProblem("Only PNG, JPEG, or WebP images under 10 MB can be added.");
    setImages((current) => [...current, ...accepted.map((file) => ({ file, url: URL.createObjectURL(file) }))].slice(0, 4));
  }
  async function create() {
    setBusy(true);
    setProblem("");
    try {
      const result = mode === "video"
        ? await creatorApi("/api/maker/art-styles/from-video", {
            accountId,
            projectId,
            name,
            sourceUrl,
            rightsConfirmed,
          })
        : await creatorApi("/api/maker/art-styles", {
            accountId,
            name,
            description,
            images: await Promise.all(images.map(async ({ file }) => ({ data: await readFile(file), mediaType: file.type }))),
          });
      const { id } = result;
      await onCreated(id);
    } catch (e) {
      setProblem((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const ready = mode === "video"
    ? /^https:\/\//i.test(sourceUrl.trim()) && rightsConfirmed
    : Boolean(name.trim() && description.trim() && images.length > 0);
  return (
    <Modal
      title="Create custom art style"
      wide
      onClose={onClose}
      footer={
        <>
          <button className="maker-outline" onClick={onClose}>
            Cancel
          </button>
          <button className="maker-primary" disabled={!ready || busy} onClick={() => void create()}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
            {busy && mode === "video" ? "Capturing style" : "Create style"}
          </button>
        </>
      }
    >
      <div className="maker-stack">
        <div className="maker-art-source-tabs" role="tablist" aria-label="Style source">
          <button role="tab" aria-selected={mode === "video"} onClick={() => setMode("video")}>
            <Clapperboard size={16} /> Sample video
          </button>
          <button role="tab" aria-selected={mode === "frames"} onClick={() => setMode("frames")}>
            <ImagePlus size={16} /> Reference images
          </button>
        </div>
        <div className="maker-art-form">
          <div className="maker-stack">
          <label className="maker-field">
            Style name {mode === "video" && <small>Optional</small>}
            <input value={name} maxLength={80} placeholder={mode === "video" ? "AI names it from the frames" : "Documentary 3D"} onChange={(e) => setName(e.target.value)} />
          </label>
          {mode === "video" ? (
            <>
              <label className="maker-field">
                Video link
                <input value={sourceUrl} inputMode="url" placeholder="https://www.youtube.com/watch?v=..." onChange={(e) => setSourceUrl(e.target.value)} />
              </label>
              <label className="maker-switch maker-rights-confirm">
                <input type="checkbox" checked={rightsConfirmed} onChange={(e) => setRightsConfirmed(e.target.checked)} />
                <span>I own this sample or have permission to analyze it</span>
              </label>
            </>
          ) : (
            <label className="maker-field">
              <span className="maker-split">
                Description
                <small className="maker-mono">{description.length}/500</small>
              </span>
              <textarea rows={3} value={description} maxLength={500} placeholder="Soft 3D animation, muted palette, warm key light" onChange={(e) => setDescription(e.target.value)} />
            </label>
          )}
          </div>
          <div className="maker-stack-sm">
          {mode === "video" ? (
            <div className="maker-style-capture-flow">
              <span><strong>4</strong> distinct frames</span>
              <span><Eye size={15} /> visual analysis</span>
              <span><Sparkles size={15} /> original preview</span>
            </div>
          ) : <>
            <span className="maker-split maker-label">
              Reference images
              <small className="maker-mono">{images.length}/4</small>
            </span>
            <div className="maker-art-slots">
            {images.map((image, index) => (
              <figure key={image.url}>
                <img src={image.url} alt={`Reference ${index + 1}`} />
                <Action
                  label={`Remove reference ${index + 1}`}
                  className="maker-icon maker-media-action"
                  onClick={() => {
                    URL.revokeObjectURL(image.url);
                    setImages((current) => current.filter((item) => item !== image));
                  }}
                >
                  <X size={14} />
                </Action>
              </figure>
            ))}
            {images.length < 4 && (
              <label
                className="maker-dropzone"
                data-active={dragging || undefined}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  add(e.dataTransfer.files);
                }}
              >
                <input type="file" hidden multiple accept="image/png,image/jpeg,image/webp" onChange={(e) => add(e.target.files)} />
                <ImagePlus size={20} />
                <strong>{dragging ? "Drop images" : "Add images"}</strong>
                <small>PNG, JPEG, or WebP</small>
              </label>
            )}
          </div>
          </>}
          {problem && <p className="maker-error is-inline">{problem}</p>}
          {busy && mode === "video" && <p className="maker-muted maker-small">Extracting frames, reading the visual language, and generating a fresh style example.</p>}
          </div>
        </div>
      </div>
    </Modal>
  );
}

type VisualBible = {
  version: number;
  locked: boolean;
  consistency: boolean;
  artDirection: { palette: string; lighting: string; camera: string; texture: string; negative: string };
  cast: Array<{ id: string; name: string; appearance: string; outfit: string; approvedReferences: string[] }>;
};
const emptyVisualBible = (): VisualBible => ({
  version: 1,
  locked: true,
  consistency: true,
  artDirection: { palette: "", lighting: "", camera: "", texture: "", negative: "" },
  cast: [],
});
function VisualBiblePanel({
  value,
  onChange,
  onUpload,
  busy,
}: {
  value: VisualBible;
  onChange: (value: VisualBible) => void;
  onUpload: (castId: string, file: File) => Promise<void>;
  busy: boolean;
}) {
  const updateCast = (id: string, patch: Record<string, unknown>) =>
    onChange({ ...value, version: value.version + 1, cast: value.cast.map((item) => (item.id === id ? { ...item, ...patch } : item)) });
  return (
    <section className="maker-bible">
      <div className="maker-bible-head">
        <div>
          <span className="maker-eyebrow"><Users size={14} /> Visual bible</span>
          <strong>{value.cast.length ? `${value.cast.length} recurring character${value.cast.length === 1 ? "" : "s"}` : "Style-only project"}</strong>
        </div>
        <div className="maker-actions">
          <label className="maker-switch">
            <input type="checkbox" checked={value.consistency} onChange={(e) => onChange({ ...value, version: value.version + 1, consistency: e.target.checked })} />
            Consistency
          </label>
          <button
            type="button"
            className="maker-outline"
            onClick={() => onChange({
              ...value,
              version: value.version + 1,
              cast: [...value.cast, { id: `cast-${crypto.randomUUID()}`, name: `Character ${value.cast.length + 1}`, appearance: "", outfit: "", approvedReferences: [] }],
            })}
          >
            <Plus size={14} /> Character
          </button>
        </div>
      </div>
      {value.cast.length > 0 && (
        <div className="maker-bible-cast">
          {value.cast.map((character) => (
            <div className="maker-cast-row" key={character.id}>
              <label className="maker-cast-avatar" title="Add or replace the approved identity image">
                {character.approvedReferences[0]
                  ? <img src={character.approvedReferences[0]} alt="" />
                  : <Users size={19} />}
                <input
                  type="file"
                  hidden
                  disabled={busy}
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(e) => e.target.files?.[0] && void onUpload(character.id, e.target.files[0])}
                />
              </label>
              <div className="maker-cast-fields">
                <input aria-label="Character name" value={character.name} placeholder="Character name" onChange={(e) => updateCast(character.id, { name: e.target.value })} />
                <input aria-label={`${character.name} appearance`} value={character.appearance} placeholder="Defining face, hair, age, build" onChange={(e) => updateCast(character.id, { appearance: e.target.value })} />
                <input aria-label={`${character.name} outfit`} value={character.outfit} placeholder="Locked outfit and accessories" onChange={(e) => updateCast(character.id, { outfit: e.target.value })} />
              </div>
              <Action
                label={`Remove ${character.name}`}
                className="maker-icon"
                onClick={() => onChange({ ...value, version: value.version + 1, cast: value.cast.filter((item) => item.id !== character.id) })}
              >
                <X size={14} />
              </Action>
            </div>
          ))}
        </div>
      )}
      <Disclosure label="Locked art direction" summary={value.locked ? `Version ${value.version} · approved` : `Version ${value.version} · editing`}>
        <div className="maker-bible-direction">
          {(["palette", "lighting", "camera", "texture", "negative"] as const).map((key) => (
            <label className="maker-field" key={key}>
              {key === "negative" ? "Avoid" : key[0].toUpperCase() + key.slice(1)}
              <input
                value={value.artDirection[key]}
                placeholder={key === "negative" ? "Drifting outfits, logos, text" : `Keep ${key} consistent`}
                onChange={(e) => onChange({ ...value, version: value.version + 1, locked: false, artDirection: { ...value.artDirection, [key]: e.target.value } })}
              />
            </label>
          ))}
          <button type="button" className="maker-outline" onClick={() => onChange({ ...value, version: value.version + 1, locked: !value.locked })}>
            {value.locked ? "Unlock direction" : "Approve and lock"}
          </button>
        </div>
      </Disclosure>
    </section>
  );
}

/* Visual segments: split the narration at sentence breaks and give each part its own settings. */
const QUALITY_OPTIONS: Array<[string, string]> = [
  ["standard", "Standard · 1K"],
  ["high", "High · 2K"],
  ["ultra", "Ultra · 4K"],
];
function SegmentEditor({
  advanced,
  duration,
  voiceSegments,
  voiceAsset,
  value,
  fallbackSeconds,
  defaultQuality,
  animation,
  onChange,
  onError,
}: {
  advanced: boolean;
  duration: number;
  voiceSegments: any[];
  voiceAsset: string;
  value: any[];
  fallbackSeconds: number;
  defaultQuality: string;
  animation: { available: boolean; reason: string } | null;
  onChange: (segments: any[]) => void;
  onError: (e: string) => void;
}) {
  const segments: any[] = normalizeVisualSegments(value, duration);
  const boundaries = transcriptBoundaries(voiceSegments, duration);
  const [selected, setSelected] = useState(segments[0]?.id || ""),
    [playhead, setPlayhead] = useState(0),
    [zoom, setZoom] = useState(1);
  const audio = useRef<HTMLAudioElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const index = Math.max(0, segments.findIndex((s) => s.id === selected));
  const current = segments[index];
  const limit = current ? segmentImageLimit(current, boundaries) : 1;
  const estimate = (s: any) =>
    Math.min(segmentImageLimit(s, boundaries), s.imageCount || Math.max(1, Math.round((s.end - s.start) / fallbackSeconds)));
  const update = (patch: Record<string, unknown>) =>
    onChange(segments.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  const seek = (time: number) => {
    const t = Math.min(duration, Math.max(0, time));
    setPlayhead(t);
    if (audio.current) audio.current.currentTime = t;
  };
  if (!current) return null;
  const panel = (
    <div className="maker-segment-panel" aria-live="polite">
      <div className="maker-segment-panel-head">
        <strong>{segments.length > 1 ? `Segment ${index + 1}` : "Whole video"}</strong>
        <span className="maker-mono">
          {durationLabel(current.start)}–{durationLabel(current.end)} · {(current.end - current.start).toFixed(0)}s
        </span>
        {segments.length > 1 && advanced && (
          <button
            className="maker-link maker-push-left"
            onClick={() => {
              const next = mergeVisualSegment(segments, index);
              onChange(next);
              setSelected(next[Math.min(index, next.length - 1)]?.id || "");
            }}
          >
            <X size={13} />
            Remove this split
          </button>
        )}
      </div>
      <div className="maker-segment-grid">
        <label className="maker-setting-tile" title={animation?.available ? "" : animation?.reason}>
          <div>
            <strong>Animate</strong>
            <span>{animation?.available ? "Image-to-video for every scene in this part" : animation?.reason || "Checking the animation provider"}</span>
          </div>
          <span className="maker-switch">
            <input
              type="checkbox"
              aria-label={`Animate ${segments.length > 1 ? `segment ${index + 1}` : "the whole video"}`}
              disabled={!animation?.available}
              checked={Boolean(current.animate)}
              onChange={(e) => update({ animate: e.target.checked })}
            />
          </span>
        </label>
        <div className="maker-field">
          <span>Image quality</span>
          <div className="maker-presets">
            <button aria-pressed={!current.quality} onClick={() => update({ quality: undefined })}>
              Default
            </button>
            {QUALITY_OPTIONS.map(([key, label]) => (
              <button key={key} aria-pressed={current.quality === key} onClick={() => update({ quality: key })}>
                {label.split(" · ")[0]}
              </button>
            ))}
          </div>
          <small className="maker-hint">
            {current.quality ? QUALITY_OPTIONS.find(([key]) => key === current.quality)?.[1] : `Uses the project default (${QUALITY_OPTIONS.find(([key]) => key === defaultQuality)?.[1] || "Standard · 1K"})`}
          </small>
        </div>
        <label className="maker-field maker-span">
          <span className="maker-split is-wrap">
            Images in this {segments.length > 1 ? "segment" : "video"}
            <small className="maker-mono">
              {current.imageCount ? `${Math.min(limit, current.imageCount)} of ${limit} max` : `Auto · ~${estimate(current)}`} · one every ~
              {((current.end - current.start) / estimate(current)).toFixed(1)}s
            </small>
          </span>
          {limit > 1 ? (
            <div className="maker-range-row">
              <input
                type="range"
                min={1}
                max={limit}
                value={Math.min(limit, current.imageCount || estimate(current))}
                onChange={(e) => update({ imageCount: Number(e.target.value) })}
              />
              <button className="maker-outline" aria-pressed={!current.imageCount} disabled={!current.imageCount} onClick={() => update({ imageCount: undefined })}>
                Auto
              </button>
            </div>
          ) : null}
          <small className="maker-hint">
            {limit > 1
              ? "The maximum is one image per sentence, so every image change lands on a pause."
              : "This part is a single sentence, so it holds one image. Split elsewhere or merge it to add more."}
          </small>
        </label>
      </div>
    </div>
  );
  if (!advanced)
    return (
      <div className="maker-segment-editor is-simple">
        {segments.length > 1 ? (
          <p className="maker-notice">
            <Layers size={15} />
            {segments.length} custom segments are set. Turn on Advanced to edit them one by one.
          </p>
        ) : (
          panel
        )}
      </div>
    );
  const total = segments.reduce((sum, s) => sum + estimate(s), 0);
  return (
    <section className="maker-segment-editor" aria-label="Segment timeline">
      <div className="maker-timeline-head">
        <h3>
          <Clock size={15} />
          Segments
        </h3>
        <span className="maker-mono">
          {segments.length} {segments.length === 1 ? "segment" : "segments"} · ~{total} {total === 1 ? "image" : "images"}
        </span>
        <div className="maker-actions">
          <button
            className="maker-outline"
            onClick={() => {
              try {
                const next = splitVisualSegment(segments, boundaries, playhead);
                onChange(next);
                const created = next
                  .filter((s) => s.start > 0)
                  .sort((a, b) => Math.abs(a.start - playhead) - Math.abs(b.start - playhead))[0];
                setSelected(created?.id || selected);
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
            <input type="range" min={1} max={6} step={0.5} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} />
          </label>
        </div>
      </div>
      <AudioPlayer src={voiceAsset} audioRef={audio} title="Narration" onTimeUpdate={setPlayhead} />
      <div className="maker-timeline-viewport">
        <div className="maker-timeline-track" style={{ width: `${zoom * 100}%` }} ref={track}>
          <div className="maker-timeline-segments">
            {segments.map((segment, i) => (
              <button
                key={segment.id}
                style={{ flexGrow: Math.max(0.1, segment.end - segment.start) }}
                aria-pressed={segment.id === current.id}
                aria-label={`Segment ${i + 1}, ${durationLabel(segment.start)} to ${durationLabel(segment.end)}`}
                data-animated={segment.animate || undefined}
                onClick={(e) => {
                  setSelected(segment.id);
                  const rect = track.current?.getBoundingClientRect();
                  if (rect) seek(((e.clientX - rect.left) / rect.width) * duration);
                }}
              >
                <strong>Segment {i + 1}</strong>
                <em>{segment.animate ? "Animated" : "Stills"}</em>
                <small>~{estimate(segment)} {estimate(segment) === 1 ? "image" : "images"}</small>
              </button>
            ))}
          </div>
          <div className="maker-boundaries" aria-hidden="true">
            {boundaries.map((b) => (
              <span key={b} style={{ left: `${(b / duration) * 100}%` }} />
            ))}
          </div>
          <span className="maker-playhead" style={{ left: `${(playhead / duration) * 100}%` }} />
        </div>
      </div>
      <input className="maker-timeline-scrub" aria-label="Playhead" type="range" min={0} max={duration} step={0.1} value={playhead} onChange={(e) => seek(Number(e.target.value))} />
      <div className="maker-timeline-scale">
        <span>{durationLabel(playhead)}</span>
        <span>Dots mark sentence breaks. Splits snap to the nearest one.</span>
        <span>{durationLabel(duration)}</span>
      </div>
      {panel}
    </section>
  );
}

/* Soundtrack segments: timed music direction, editable before anything is composed. */
function MusicSegmentEditor({
  segments,
  duration,
  boundaries,
  onChange,
}: {
  segments: any[];
  duration: number;
  boundaries: number[];
  onChange: (segments: any[]) => void;
}) {
  const list = normalizeMusicSegments(segments, duration);
  const set = (next: any[]) => onChange(normalizeMusicSegments(next, duration));
  const snap = (time: number, min: number, max: number) => {
    const inside = boundaries.filter((b) => b > min + 1 && b < max - 1);
    return inside.length ? inside.sort((a, b) => Math.abs(a - time) - Math.abs(b - time))[0] : time;
  };
  return (
    <div className="maker-music">
      <div className="maker-music-bar" aria-hidden="true">
        {list.map((segment, i) => (
          <span key={segment.id} style={{ flexGrow: segment.end - segment.start }} data-muted={segment.muted || undefined} data-tone={i % 4}>
            {segment.mood || `Segment ${i + 1}`}
          </span>
        ))}
      </div>
      <ol className="maker-music-list">
        {list.map((segment, i) => (
          <li key={segment.id} data-muted={segment.muted || undefined}>
            <div className="maker-music-row-head">
              <span className="maker-chip">{i + 1}</span>
              <span className="maker-mono">
                {durationLabel(segment.start)}–
              </span>
              {i < list.length - 1 ? (
                <span className="maker-time-field">
                <input
                  className="maker-time-input"
                  type="number"
                  aria-label={`Segment ${i + 1} end, in seconds`}
                  min={Math.ceil(segment.start + 3)}
                  max={Math.floor(list[i + 1].end - 3)}
                  step={0.5}
                  value={Math.round(segment.end * 10) / 10}
                  onChange={(e) => {
                    const end = Math.min(list[i + 1].end - 3, Math.max(segment.start + 3, Number(e.target.value) || segment.end));
                    set(list.map((s, j) => (j === i ? { ...s, end } : j === i + 1 ? { ...s, start: end } : s)));
                  }}
                />
                <span aria-hidden="true">s end</span>
                </span>
              ) : (
                <span className="maker-mono">{durationLabel(segment.end)}</span>
              )}
              <small>{(segment.end - segment.start).toFixed(1)}s</small>
              <input
                className="maker-music-mood"
                aria-label={`Segment ${i + 1} mood`}
                value={segment.mood}
                maxLength={80}
                placeholder="Mood"
                onChange={(e) => set(list.map((s, j) => (j === i ? { ...s, mood: e.target.value } : s)))}
              />
              <div className="maker-actions">
                <Action
                  label={segment.end - segment.start < 8 ? "Too short to split" : `Split segment ${i + 1}`}
                  disabled={segment.end - segment.start < 8}
                  onClick={() => {
                    const at = snap((segment.start + segment.end) / 2, segment.start, segment.end);
                    set([...list.slice(0, i), { ...segment, end: at }, { ...segment, id: `mus-${Math.round(at * 100)}`, start: at }, ...list.slice(i + 1)]);
                  }}
                >
                  <Scissors size={14} />
                </Action>
                <Action
                  label={segment.muted ? `Unmute segment ${i + 1}` : `Mute segment ${i + 1}`}
                  aria-pressed={segment.muted}
                  onClick={() => set(list.map((s, j) => (j === i ? { ...s, muted: !s.muted } : s)))}
                >
                  {segment.muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
                </Action>
                <Action
                  label={`Remove segment ${i + 1}`}
                  disabled={list.length < 2}
                  onClick={() => {
                    const into = i > 0 ? i - 1 : i + 1;
                    set(
                      list
                        .map((s, j) => (j === into ? { ...s, start: Math.min(s.start, segment.start), end: Math.max(s.end, segment.end) } : s))
                        .filter((_, j) => j !== i),
                    );
                  }}
                >
                  <Trash2 size={14} />
                </Action>
              </div>
            </div>
            <textarea
              aria-label={`Segment ${i + 1} music direction`}
              rows={2}
              value={segment.prompt}
              maxLength={1000}
              placeholder="Genre, key, tempo, instruments, and how the music supports this part"
              onChange={(e) => set(list.map((s, j) => (j === i ? { ...s, prompt: e.target.value } : s)))}
            />
            <PromptSuggestions
              category="music"
              context={`${segment.mood || ""} ${segment.prompt || ""}`}
              value={segment.prompt || ""}
              onChange={(prompt) => set(list.map((s, j) => (j === i ? { ...s, prompt: prompt.slice(0, 1000) } : s)))}
              limit={3}
            />
          </li>
        ))}
      </ol>
    </div>
  );
}

const possessive = (name: string) => (/s$/i.test(name.trim()) ? `${name.trim()}'` : `${name.trim()}'s`);
/* Channel format: what a reference channel makes and how it titles, describes, and packages videos. */
function ChannelFormat({ blueprint, busy, onReanalyze }: { blueprint: any; busy: boolean; onReanalyze: () => void }) {
  const name = blueprint.channel?.title || (blueprint.source === "samples" ? "your sample titles" : "this channel");
  const [open, setOpen] = useState(false);
  return (
    <section className="maker-format" aria-label="Channel format">
      <header className="maker-format-head">
        {blueprint.channel?.thumbnailUrl ? <img className="maker-avatar" src={blueprint.channel.thumbnailUrl} alt="" /> : <span className="maker-avatar">{String(name)[0]?.toUpperCase()}</span>}
        <div>
          <h3>{blueprint.channel?.title ? `${possessive(blueprint.channel.title)} format` : "Title format"}</h3>
          <p>{blueprint.summary || "Learned from the reference titles."}</p>
        </div>
        <button className="maker-outline" disabled={busy} onClick={onReanalyze} title="Fetch the latest top videos and analyze again">
          <RefreshCw size={14} />
          Re-analyze
        </button>
      </header>
      {blueprint.topics?.length ? (
        <div className="maker-chips">
          {blueprint.topics.map((topic: string) => (
            <span className="maker-tag" key={topic}>
              {topic}
            </span>
          ))}
        </div>
      ) : null}
      {blueprint.titleFormats?.length ? (
        <ol className="maker-format-list">
          {blueprint.titleFormats.map((item: any, index: number) => (
            <li key={`${item.name}-${index}`}>
              <div>
                <strong>{item.name}</strong>
                <code>{item.template}</code>
              </div>
              {item.example && <q>{item.example}</q>}
              {item.why && <small>{item.why}</small>}
            </li>
          ))}
        </ol>
      ) : null}
      <button className="maker-link" aria-expanded={open} onClick={() => setOpen(!open)}>
        <ChevronDown size={13} className={open ? "maker-rotate" : ""} />
        {open ? "Hide" : "Show"} rules, packaging, and {blueprint.videos?.length || 0} reference titles
      </button>
      {open && (
        <div className="maker-format-detail">
          {blueprint.titleRules?.length ? (
            <div>
              <h4>Title rules</h4>
              <ul>
                {blueprint.titleRules.map((rule: string) => (
                  <li key={rule}>{rule}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {blueprint.conceptPattern && (
            <div>
              <h4>Video concept</h4>
              <p>{blueprint.conceptPattern}</p>
            </div>
          )}
          {blueprint.thumbnailFormat?.composition && (
            <div>
              <h4>Thumbnails</h4>
              <p>
                {[blueprint.thumbnailFormat.composition, blueprint.thumbnailFormat.text, blueprint.thumbnailFormat.palette, blueprint.thumbnailFormat.style].filter(Boolean).join(" · ")}
              </p>
            </div>
          )}
          {blueprint.descriptionFormat?.structure?.length ? (
            <div>
              <h4>Descriptions</h4>
              <p>
                {blueprint.descriptionFormat.structure.join(" → ")}
                {blueprint.descriptionFormat.length ? ` · ${blueprint.descriptionFormat.length}` : ""}
              </p>
            </div>
          ) : null}
          {blueprint.scriptFormat?.hook && (
            <div>
              <h4>Scripts</h4>
              <p>
                {blueprint.scriptFormat.hook}
                {blueprint.scriptFormat.voice ? ` · ${blueprint.scriptFormat.voice}` : ""}
              </p>
            </div>
          )}
          {blueprint.videos?.length ? (
            <div className="maker-span">
              <h4>Reference titles</h4>
              <ol className="maker-format-titles">
                {blueprint.videos.map((video: any, index: number) => (
                  <li key={`${video.title}-${index}`}>
                    {video.url ? (
                      <a href={video.url} target="_blank" rel="noreferrer">
                        {video.title}
                      </a>
                    ) : (
                      <span>{video.title}</span>
                    )}
                    {video.viewCount ? <small>{compact(video.viewCount)} views</small> : null}
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
        </div>
      )}
      <p className="maker-hint maker-flush">Scripts, descriptions, and thumbnails for this project follow this format too.</p>
    </section>
  );
}

/* Create Video workspace */
const generateLabels: Record<string, [string, string]> = {
  title: ["Generate titles", "Regenerate"],
  script: ["Generate script", "Regenerate"],
  seo: ["Generate description", "Regenerate"],
  voiceover: ["Generate voiceover", "Regenerate"],
  soundtrack: ["Auto-split with AI", "Re-split with AI"],
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
    [voiceError, setVoiceError] = useState(""),
    [voicesLoading, setVoicesLoading] = useState(true),
    [styleName, setStyleName] = useState(""),
    [musicTracks, setMusicTracks] = useState<any[]>([]),
    [musicBusy, setMusicBusy] = useState(false),
    [confirm, setConfirm] = useState<any>(null),
    [archiveOpen, setArchiveOpen] = useState(false),
    [playhead, setPlayhead] = useState(0),
    [selectedScene, setSelectedScene] = useState(""),
    [visualView, setVisualView] = useState<"settings" | "scenes" | "edit" | "">(""),
    [visualTab, setVisualTab] = useState<"style" | "cast" | "timing" | "output">("style"),
    [sceneFilter, setSceneFilter] = useState<"all" | "missing" | "ready" | "failed" | "animated">("all"),
    [sceneEditor, setSceneEditor] = useState(false),
    [advanced, setAdvanced] = useState(false),
    [copied, setCopied] = useState(false),
    [animation, setAnimation] = useState<{ available: boolean; reason: string; model: string; models?: string[]; provider?: string } | null>(null),
    [music, setMusic] = useState<{ available: boolean; reason: string; model: string; provider: string } | null>(null),
    [media, setMedia] = useState<{ available: boolean; reason: string } | null>(null),
    [artStyles, setArtStyles] = useState<{ presets: ArtStyle[]; styles: ArtStyle[] }>({ presets: [], styles: [] }),
    [artModal, setArtModal] = useState(false),
    [thumbUrl, setThumbUrl] = useState(""),
    [thumbMode, setThumbMode] = useState<"channel" | "reference" | "scratch" | "">(""),
    [animOptions, setAnimOptions] = useState<{ model: string; fixedCamera: boolean }>({ model: "", fixedCamera: false }),
    [imaging, setImaging] = useState<{ available: boolean; reason: string; model: string } | null>(null);
  const timelineAudio = useRef<HTMLAudioElement>(null);
  // Scene editor popup: keys go through a ref so the handler sees current scenes.
  const sceneKeys = useRef<(event: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    if (!sceneEditor) return;
    const onKey = (event: KeyboardEvent) => sceneKeys.current(event);
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [sceneEditor]);
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
    void loadVoiceProfiles()
      .then(({ profiles, error }) => {
        if (!active) return;
        setVoices(profiles);
        setVoiceError(profiles.length ? "" : error || "No voices yet.");
      })
      .catch(() => {})
      .finally(() => active && setVoicesLoading(false));
    void creatorApi("/api/maker/capabilities")
      .then((data) => {
        if (!active) return;
        setAnimation(data.animation || null);
        setImaging(data.images || null);
        setMusic(data.music || null);
        setMedia(data.media || null);
      })
      .catch(() => {});
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [id]);
  async function loadArtStyles() {
    const data = await creatorApi(`/api/maker/art-styles?accountId=${encodeURIComponent(accountId)}`);
    setArtStyles({ presets: data.presets || [], styles: data.styles || [] });
  }
  useEffect(() => {
    void loadArtStyles().catch(() => {});
  }, [accountId]);
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
      // Voiceover and review outputs are produced by stage jobs, not by PATCH.
      // Saving still persists voice/speed/settings; sending outputStage here
      // used to fail with "This output is read-only" and block Generate.
      const readOnlyOutput = ["voiceover", "review"].includes(currentStage);
      const data = await creatorApi(
        `/api/maker/projects/${id}`,
        {
          ...(currentStage === "brief"
            ? value
            : readOnlyOutput
              ? {}
              : { outputStage: currentStage, output: value }),
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
  async function uploadCastReference(castId: string, file: File) {
    if (!file || !["image/png", "image/jpeg", "image/webp"].includes(file.type)) return onError("Choose a PNG, JPEG, or WebP identity image");
    if (file.size > 15 * 1024 * 1024) return onError("Choose an identity image smaller than 15 MB");
    if (dirty && !(await save())) return;
    setBusy(true);
    try {
      const fresh = await creatorApi(`/api/maker/projects/${id}`);
      const uploaded = await creatorApi(`/api/maker/projects/${id}/reference-assets`, {
        image: await readFile(file),
        mediaType: file.type,
        accountId,
        expectedVersion: fresh.project.version || 1,
      });
      const asset = uploaded.project.metadata.referenceAssets?.at(-1);
      const base = { ...emptyVisualBible(), ...(uploaded.project.metadata.settings?.visualBible || {}) } as VisualBible;
      base.artDirection = { ...emptyVisualBible().artDirection, ...(base.artDirection || {}) };
      base.cast = (base.cast || []).map((character) =>
        character.id === castId
          ? { ...character, approvedReferences: [...new Set([asset, ...(character.approvedReferences || [])].filter(Boolean))].slice(0, 4) }
          : character,
      );
      base.version = (Number(base.version) || 1) + 1;
      const saved = await creatorApi(`/api/maker/projects/${id}`, {
        settings: { ...uploaded.project.metadata.settings, visualBible: base },
        accountId,
        expectedVersion: uploaded.project.version || 1,
      }, "PATCH");
      setProject(saved.project);
      setSettings(structuredClone(saved.project.metadata.settings || {}));
      setDirty(false);
      dirtyRef.current = false;
    } catch (error) {
      onError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function setThumbnailReference(input: { file?: File; youtubeUrl?: string }) {
    if (dirty && !(await save())) return;
    if (input.file && input.file.size > 15 * 1024 * 1024) return onError("Choose an image smaller than 15 MB");
    setBusy(true);
    try {
      const data = await creatorApi(`/api/maker/projects/${id}/thumbnail-reference`, {
        ...(input.file ? { image: await readFile(input.file), mediaType: input.file.type } : { youtubeUrl: input.youtubeUrl }),
        accountId,
        expectedVersion: project?.version || 1,
      });
      setProject(data.project);
      setSettings(structuredClone(data.project.metadata.settings || {}));
      setThumbUrl("");
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function setSoundtrackSource(file: File | null) {
    if (dirty && !(await save())) return;
    if (file && file.size > 70 * 1024 * 1024) return onError("Choose an audio or video file smaller than 70 MB");
    setBusy(true);
    try {
      const data = await creatorApi(`/api/maker/projects/${id}/soundtrack-source`, {
        ...(file ? { media: await readFile(file), name: file.name } : { clear: true }),
        accountId,
        expectedVersion: project?.version || 1,
      });
      setProject(data.project);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  // Reviewing scenes and editing the video are full-screen: the app header, the
  // project bar, and the stage tabs step aside, leaving only a Back button.
  const focusMode =
    currentStage === "visualPlan" &&
    (visualView === "scenes" || visualView === "edit" || (!visualView && (draft.scenes || []).length > 0));
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("autoyt-focus-mode", { detail: focusMode }));
  }, [focusMode]);
  useEffect(() => () => void window.dispatchEvent(new CustomEvent("autoyt-focus-mode", { detail: false })), []);
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
  let blocked: string = "";
  try {
    if (!["brief", "studio"].includes(currentStage)) assertStageReady(project, currentStage);
  } catch (e) {
    blocked = (e as Error).message;
  }
  const thumbReference: string = settings.thumbnailReference || "";
  const channelThumbs: any[] = (project.outputs.title?.blueprint?.videos || []).filter((video: any) => video.thumbnailUrl && video.url);
  const thumbModeNow: "channel" | "reference" | "scratch" =
    settings.thumbnailMode || thumbMode || (thumbReference ? "reference" : channelThumbs.length ? "channel" : "scratch");
  const defaultStyleRefs = [...channelThumbs].sort((a, b) => b.viewCount - a.viewCount).slice(0, 1).map((video) => video.url);
  const styleRefs: string[] = (settings.thumbnailStyleRefs?.length ? settings.thumbnailStyleRefs : defaultStyleRefs).slice(0, 1);
  const thumbCount = Math.min(3, Math.max(1, Number(settings.thumbnailVariants) || (thumbModeNow === "reference" ? 1 : 3)));
  if (!blocked && currentStage === "thumbnail" && thumbModeNow === "channel" && !channelThumbs.length)
    blocked = "Generate titles from a channel or style first, so its thumbnails can be analyzed";
  if (!blocked && currentStage === "thumbnail" && thumbModeNow === "reference")
    blocked = !thumbReference
      ? "Add a reference thumbnail first, or switch to Start from scratch"
      : !String(settings.thumbnailPrompt || "").trim()
        ? "Describe what to change in the reference"
        : "";
  if (!blocked && currentStage === "voiceover" && !String(settings.voiceId || "").trim())
    blocked = "Select a Voicebox voice first";
  const voiceDuration = Number(project.outputs.voiceover?.duration) || 0;
  const bible: VisualBible = {
    ...emptyVisualBible(),
    ...(settings.visualBible || {}),
    artDirection: { ...emptyVisualBible().artDirection, ...(settings.visualBible?.artDirection || {}) },
    cast: Array.isArray(settings.visualBible?.cast) ? settings.visualBible.cast : [],
  };
  const paceSeconds = settings.imageCount && voiceDuration ? Math.max(1, voiceDuration / Number(settings.imageCount)) : Number(settings.sceneSeconds) || 12;
  const promptEstimate = voiceDuration
    ? normalizeVisualSegments(settings.visualSegments, voiceDuration).reduce((sum: number, segment: any) => {
        const limit = segmentImageLimit(segment, transcriptBoundaries(project.outputs.voiceover?.segments, voiceDuration));
        return sum + Math.min(limit, segment.imageCount || Math.max(1, Math.round((segment.end - segment.start) / paceSeconds)));
      }, 0)
    : 0;
  const canSave = ["brief", "title", "script", "seo", "soundtrack", "visualPlan", "thumbnail", "voiceover", "review"].includes(currentStage);
  const [firstLabel, againLabel] = generateLabels[currentStage] || ["Generate", "Regenerate"];
  const generateLabel =
    currentStage === "thumbnail"
      ? thumbCount > 1
        ? `Generate ${thumbCount} thumbnails`
        : "Generate thumbnail"
      : currentStage === "visualPlan" && promptEstimate
        ? `${output ? "Regenerate" : "Generate"} ~${promptEstimate} prompts`
        : output
          ? againLabel
          : firstLabel;
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
  sceneKeys.current = (event: KeyboardEvent) => {
    if (event.key === "Escape") return setSceneEditor(false);
    if ((event.target as HTMLElement)?.closest?.("input, textarea, select")) return;
    const at = scenes.findIndex((scene) => scene.id === selectedScene);
    if (event.key === "ArrowRight" && at < scenes.length - 1) selectScene(scenes[at + 1].id);
    if (event.key === "ArrowLeft" && at > 0) selectScene(scenes[at - 1].id);
  };

  const failedScenes = scenes.filter((s) => s.error).length;
  const sceneRatio = (project.metadata.settings?.aspect || settings.aspect || "16:9").replace(":", " / ");
  const styleLabel = [...artStyles.styles, ...artStyles.presets].find((style) => style.id === settings.artStyleId)?.name || (String(settings.visualStyle || "").trim() ? "Custom notes" : "No style");
  const filteredScenes = scenes
    .map((scene, index) => ({ scene, index }))
    .filter(({ scene }) =>
      sceneFilter === "missing" ? !scene.asset : sceneFilter === "ready" ? Boolean(scene.asset) : sceneFilter === "failed" ? Boolean(scene.error) : sceneFilter === "animated" ? Boolean(scene.clip || scene.animate) : true,
    );
  const focusIndex = Math.max(0, scenes.findIndex((scene) => scene.id === selectedScene));
  const focusScene = scenes.length ? { scene: scenes[focusIndex], index: focusIndex } : null;
  const selectScene = (sceneId: string) => {
    setSelectedScene(sceneId);
    const scene = scenes.find((item) => item.id === sceneId);
    if (scene) {
      setPlayhead(scene.start);
      if (timelineAudio.current) timelineAudio.current.currentTime = scene.start;
    }
  };
  const imageMb = settings.quality === "ultra" ? 12 : settings.quality === "high" ? 5 : 1.5;
  const wordCount = (text?: string) => (text || "").trim().split(/\s+/).filter(Boolean).length;
  // Project words that rank prompt-library suggestions for this video.
  const promptContext = [project.title, project.metadata?.brief, project.outputs?.title?.current, project.outputs?.title?.concept]
    .filter(Boolean)
    .join(". ")
    .slice(0, 1500);
  const voiceSelect = (
    <div className="maker-field">
      <span id="project-voice-label">Voice</span>
      <VoicePicker
        voices={voices}
        value={settings.voiceId || ""}
        labelledBy="project-voice-label"
        loading={voicesLoading}
        onChange={(voiceId) => editSetting({ voiceId })}
        empty={
          <>
            {voiceError || "No voices yet."} Clone or add voices in{" "}
            <button type="button" className="maker-link" onClick={() => writeDeepLink({ view: "tts" })}>
              Text to Speech
            </button>
            .
          </>
        }
      />
      {voiceError && (
        <small>
          {voiceError} Clone or add voices in{" "}
          <button type="button" className="maker-link" onClick={() => writeDeepLink({ view: "tts" })}>
            Text to Speech
          </button>
          .
        </small>
      )}
    </div>
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
      {media && !media.available && ["voiceover", "soundtrack", "review"].includes(currentStage) && (
        <p className="maker-notice">
          <CircleAlert size={15} />
          {media.reason}
        </p>
      )}
      {imaging && !imaging.available && ["visualPlan", "thumbnail"].includes(currentStage) && (
        <p className="maker-notice">
          <CircleAlert size={15} />
          {imaging.reason || "Image generation isn't configured on the server."} Prompts and timing still work; images can't be generated yet.
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
  const genHead = (extra?: ReactNode, hideGenerate = false) => (
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
          ) : hideGenerate ? null : (
            <button className="maker-primary" title={blocked || generateLabel} disabled={busy || !!blocked} onClick={generate}>
              <WandSparkles size={15} />
              {generateLabel}
            </button>
          ))}
      </div>
    </header>
  );
  return (
    <>
      {!focusMode && <div className="maker-topbar">
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
      </div>}
      <div className={currentStage === "studio" ? "maker-studio-shell" : `maker-scroll${focusMode ? " is-focus" : ""}`}>
        {currentStage !== "studio" && !focusMode && (
          <PageHead
            centered
            title="Create Video"
            text="Follow the steps below. Start with a title, then generate your script, voiceover, and visuals."
          />
        )}
        {!focusMode && <nav className="maker-stagebar" aria-label="Project stages">
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
        </nav>}
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
          <div className={`maker-page ${currentStage === "visualPlan" ? (view === "edit" ? "is-editor" : view === "scenes" ? "is-board" : "is-medium") : ""}${focusMode ? " is-focus" : ""}`}>
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
                    <PromptSuggestions
                      category={String(draft.brief || "").trim() ? "script" : "idea"}
                      context={`${draft.title || ""}. ${draft.brief || ""}`}
                      value={draft.brief || ""}
                      onChange={(brief) => edit({ brief })}
                      append
                      accountId={accountId}
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
                        <PromptSuggestions category="narration" context={promptContext} value={settings.narrationStyle || ""} onChange={(narrationStyle) => editSetting({ narrationStyle })} accountId={accountId} limit={3} />
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
                        <PromptSuggestions category="thumbnail" context={promptContext} value={settings.thumbnailPrompt || ""} onChange={(thumbnailPrompt) => editSetting({ thumbnailPrompt })} append accountId={accountId} limit={3} />
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
                  {draft.blueprint && <ChannelFormat blueprint={draft.blueprint} busy={busy || active} onReanalyze={() => void start({ action: "analyze" })} />}
                  <label className="maker-field">
                    Selected title
                    <input value={draft.current || ""} maxLength={100} onChange={(e) => edit({ current: e.target.value })} placeholder="Write a title or generate candidates" />
                    <small>{(draft.current || "").length} / 100 characters</small>
                  </label>
                  <label className="maker-field">
                    Video concept
                    <textarea
                      rows={3}
                      maxLength={1200}
                      value={draft.concept || ""}
                      placeholder="What the video covers, its angle, and the payoff. The script, description, and thumbnail are built from this."
                      onChange={(e) => edit({ concept: e.target.value })}
                    />
                    <PromptSuggestions category="hook" context={promptContext} value={draft.concept || ""} onChange={(concept) => edit({ concept: concept.slice(0, 1200) })} append accountId={accountId} limit={3} />
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
                            <input
                              type="radio"
                              name="title-pick"
                              checked={draft.current === idea.title}
                              onChange={() => edit({ current: idea.title, concept: idea.concept || draft.concept || "", format: idea.format || "" })}
                            />
                            <span className="maker-option-body">
                              <strong>{idea.title}</strong>
                              {idea.concept && <span className="maker-idea-concept">{idea.concept}</span>}
                              <span className="maker-idea-meta">
                                {idea.format && <em>{idea.format}</em>}
                                {idea.reason}
                              </span>
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
                    {project.outputs.title?.concept && <p>{project.outputs.title.concept}</p>}
                    {project.outputs.title?.blueprint?.scriptFormat?.hook && (
                      <small className="maker-follows">
                        <Sparkles size={12} />
                        Written in {project.outputs.title.blueprint.channel?.title ? possessive(project.outputs.title.blueprint.channel.title) : "the reference"} script format
                      </small>
                    )}
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
                        <PromptSuggestions category="script" context={promptContext} value={settings.additionalContext || ""} onChange={(additionalContext) => editSetting({ additionalContext })} append accountId={accountId} />
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
                  {project.outputs.title?.blueprint?.descriptionFormat?.structure?.length ? (
                    <p className="maker-format-note">
                      <strong>{project.outputs.title.blueprint.channel?.title ? `${possessive(project.outputs.title.blueprint.channel.title)} description format` : "Reference description format"}:</strong>{" "}
                      {project.outputs.title.blueprint.descriptionFormat.structure.join(" → ")}
                    </p>
                  ) : null}
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
                      <AudioPlayer src={output.asset} title="Your voiceover is ready" meta={voiceCaption} download="voiceover" />
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
            {currentStage === "soundtrack" && (() => {
              const source = project.metadata.soundtrackSource;
              const timingDuration = Number(source?.duration || voiceover?.duration || 0);
              const timingSegments = source ? [] : voiceover?.segments || [];
              const musicSegments = normalizeMusicSegments(draft.segments, timingDuration);
              const composedChanged =
                Boolean(output?.asset && output?.composedSegments) &&
                JSON.stringify(normalizeMusicSegments(output.composedSegments, timingDuration)) !== JSON.stringify(musicSegments);
              const royaltyFree = (
                <div className="maker-stack">
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
                </div>
              );
              return (
                <section className="maker-card maker-gen">
                  {genHead()}
                  <div className="maker-gen-body">
                    {stageNotices}
                    <Step n={1} title="Audio source">
                      <div className="maker-source-options" role="radiogroup" aria-label="Audio source">
                        <button
                          type="button"
                          role="radio"
                          aria-checked={!source}
                          className="maker-source-option"
                          disabled={busy || !voiceover?.asset}
                          onClick={() => source && void setSoundtrackSource(null)}
                        >
                          <Mic size={18} />
                          <span>
                            <strong>Generated voiceover</strong>
                            <small>{voiceover?.asset ? `${durationLabel(voiceover.duration)} · music follows your narration` : "Generate the voiceover first"}</small>
                          </span>
                        </button>
                        <label className="maker-source-option" role="radio" aria-checked={Boolean(source)} data-busy={busy || undefined}>
                          <input type="file" hidden accept="audio/*,video/*" disabled={busy} onChange={(e) => void setSoundtrackSource(e.target.files?.[0] || null)} />
                          <Upload size={18} />
                          <span>
                            <strong>{source ? source.name : "Upload audio or video"}</strong>
                            <small>{source ? `${durationLabel(source.duration)} · click to replace` : "Score a video you edited elsewhere · up to 70 MB"}</small>
                          </span>
                        </label>
                      </div>
                    </Step>
                    <Step n={2} title="Segments">
                      {musicSegments.length ? (
                        <MusicSegmentEditor
                          segments={musicSegments}
                          duration={timingDuration}
                          boundaries={transcriptBoundaries(timingSegments, timingDuration)}
                          onChange={(segments) => edit({ segments })}
                        />
                      ) : (
                        <div className="maker-segment-empty">
                          <p className="maker-caption">
                            {timingDuration
                              ? "Auto-split reads the script and marks where the mood changes, with a music direction for each part. Or set the parts yourself."
                              : "Choose an audio source first so segments can be timed."}
                          </p>
                          <button
                            className="maker-outline"
                            disabled={!timingDuration}
                            onClick={() => edit({ segments: [{ id: "mus-1", start: 0, end: timingDuration, mood: draft.mood || "", prompt: "" }] })}
                          >
                            <Scissors size={14} />
                            Split manually
                          </button>
                        </div>
                      )}
                    </Step>
                    <Step n={3} title="Compose">
                      {music && !music.available && (
                        <p className="maker-notice">
                          <CircleAlert size={15} />
                          {music.reason}
                        </p>
                      )}
                      {composedChanged && (
                        <p className="maker-notice">
                          <CircleAlert size={15} />
                          Segments changed since this music was composed. Recompose so the music matches.
                        </p>
                      )}
                      <div className="maker-actions">
                        <button
                          className="maker-primary"
                          disabled={busy || active || !music?.available || !musicSegments.length || musicSegments.every((segment) => segment.muted)}
                          title={!music?.available ? music?.reason : !musicSegments.length ? "Split the soundtrack into segments first" : ""}
                          onClick={() => setConfirm({ action: "music", confirmed: true })}
                        >
                          <Music size={15} />
                          {output?.asset && output?.provider ? "Recompose music" : "Compose music"}
                        </button>
                        {output?.asset && (
                          <a className="mk-btn maker-outline" href={output.asset} download>
                            <Download size={15} />
                            Download
                          </a>
                        )}
                        {musicSegments.length > 0 && (
                          <button className="maker-link" onClick={() => edit({ segments: [] })}>
                            <RotateCcw size={13} />
                            Start over
                          </button>
                        )}
                      </div>
                      {output?.asset && (
                        <AudioPlayer src={output.asset} title="Current soundtrack" meta={draft.credit || output.credit || undefined} download="soundtrack" />
                      )}
                      <div className="maker-grid-2">
                        <label className="maker-field">
                          Music level · {Math.round((settings.soundtrackVolume ?? 0.18) * 100)}%
                          <input type="range" min={0} max={1} step={0.05} value={settings.soundtrackVolume ?? 0.18} onChange={(e) => editSetting({ soundtrackVolume: Number(e.target.value) })} />
                        </label>
                        <label className="maker-switch maker-align-end">
                          <input type="checkbox" checked={settings.preserveDialogue !== false} onChange={(e) => editSetting({ preserveDialogue: e.target.checked })} />
                          Duck music under narration
                        </label>
                      </div>
                      <Disclosure label="Use a royalty-free track instead" summary="Pixabay, Openverse, or your own file" defaultOpen={music ? !music.available : false}>
                        {royaltyFree}
                      </Disclosure>
                    </Step>
                  </div>
                </section>
              );
            })()}
            {currentStage === "visualPlan" &&
              (view === "settings" ? (
                <section className="maker-card maker-gen">
                  {genHead(undefined, true)}
                  <div className="maker-gen-body maker-stack">
                    {stageNotices}
                    <div className="maker-vtabs" role="tablist" aria-label="Visual settings">
                      {([
                        ["style", "Style", styleLabel],
                        ["cast", "Characters", bible.cast.length ? `${bible.cast.length} locked` : "None"],
                        ["timing", "Timing", promptEstimate ? `~${promptEstimate} scenes` : `${paceSeconds.toFixed(0)}s each`],
                        ["output", "Output", `${settings.aspect || "16:9"} · ${QUALITY_OPTIONS.find(([key]) => key === (settings.quality || "standard"))?.[1]}`],
                      ] as const).map(([key, label, hint]) => (
                        <button key={key} type="button" role="tab" aria-selected={visualTab === key} className="maker-vtab" onClick={() => setVisualTab(key)}>
                          <strong>{label}</strong>
                          <small>{hint}</small>
                        </button>
                      ))}
                    </div>
                    {visualTab === "style" && (
                      <div className="maker-stack-sm" role="tabpanel" aria-label="Style">
                        <ArtStylePicker
                          presets={artStyles.presets}
                          customs={artStyles.styles}
                          value={settings.artStyleId || ""}
                          onChange={(artStyleId) => editSetting({ artStyleId })}
                          onCreate={() => setArtModal(true)}
                          onDelete={async (style) => {
                            if (!window.confirm(`Delete the “${style.name}” art style? Projects using it will need a new style before generating images.`)) return;
                            try {
                              await creatorApi(`/api/maker/art-styles/${style.id}?accountId=${encodeURIComponent(accountId)}`, undefined, "DELETE");
                              if (settings.artStyleId === style.id) editSetting({ artStyleId: "" });
                              await loadArtStyles();
                            } catch (e) {
                              onError((e as Error).message);
                            }
                          }}
                        />
                        <label className="maker-field">
                          Style notes
                          <input value={settings.visualStyle || ""} placeholder="Warm key light, 1970s wardrobe, consistent lead character" onChange={(e) => editSetting({ visualStyle: e.target.value })} />
                          <small>Added to every scene. Leave blank to use only the art style.</small>
                          <PromptSuggestions category="visualStyle" context={promptContext} value={settings.visualStyle || ""} onChange={(visualStyle) => editSetting({ visualStyle })} append accountId={accountId} />
                        </label>
                      </div>
                    )}
                    {visualTab === "cast" && (
                      <div role="tabpanel" aria-label="Characters">
                        <VisualBiblePanel value={bible} busy={busy} onChange={(visualBible) => editSetting({ visualBible })} onUpload={uploadCastReference} />
                      </div>
                    )}
                    {visualTab === "timing" && (
                      <div className="maker-stack" role="tabpanel" aria-label="Timing">
                        <div className="maker-grid-2">
                          <div className="maker-setting-tile">
                            <div>
                              <strong>Auto pacing</strong>
                              <span>Seconds per image where you haven't set a count</span>
                            </div>
                            <select
                              aria-label="Seconds per image"
                              value={settings.imageCount ? "" : String(settings.sceneSeconds ?? 12)}
                              onChange={(e) => editSetting({ sceneSeconds: Number(e.target.value), imageCount: undefined })}
                            >
                              {settings.imageCount ? <option value="">~{paceSeconds.toFixed(0)}s (from image count)</option> : null}
                              {[5, 8, 10, 12, 15, 20, 30].map((n) => (
                                <option key={n} value={n}>
                                  {n}s
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="maker-setting-tile">
                            <div>
                              <strong>Pan and zoom</strong>
                              <span>Slow push-in on still images, rendered locally. Free.</span>
                            </div>
                            <label className="maker-switch">
                              <input type="checkbox" aria-label="Pan and zoom" checked={settings.motion === "push"} onChange={(e) => editSetting({ motion: e.target.checked ? "push" : "still" })} />
                            </label>
                          </div>
                        </div>
                        <label className="maker-switch maker-advanced-toggle">
                          <input type="checkbox" checked={advanced} onChange={(e) => setAdvanced(e.target.checked)} />
                          <span>
                            Per-segment control
                            <small>Split the narration and set animation, quality, and image count for each part</small>
                          </span>
                        </label>
                        {voiceover?.duration ? (
                          <SegmentEditor
                            advanced={advanced}
                            duration={voiceover.duration}
                            voiceSegments={voiceover.segments || []}
                            voiceAsset={voiceover.asset}
                            value={settings.visualSegments || []}
                            fallbackSeconds={paceSeconds}
                            defaultQuality={settings.quality || "standard"}
                            animation={animation}
                            onChange={(visualSegments) => editSetting({ visualSegments })}
                            onError={onError}
                          />
                        ) : (
                          <p className="maker-caption">Generate the voiceover to split the video into segments and set images per segment.</p>
                        )}
                      </div>
                    )}
                    {visualTab === "output" && (
                      <div className="maker-visual-settings" role="tabpanel" aria-label="Output">
                        <div className="maker-field">
                          <span>Aspect ratio</span>
                          <div className="maker-presets">
                            {["16:9", "9:16", "1:1"].map((ratio) => (
                              <button key={ratio} aria-pressed={(settings.aspect || "16:9") === ratio} onClick={() => editSetting({ aspect: ratio })}>
                                {ratio}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="maker-field">
                          <span>Default quality</span>
                          <div className="maker-presets">
                            {QUALITY_OPTIONS.map(([value, label]) => (
                              <button key={value} aria-pressed={(settings.quality || "standard") === value} onClick={() => editSetting({ quality: value })}>
                                {label}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="maker-field">
                          <span>Safe prompts</span>
                          <label className="maker-switch">
                            <input type="checkbox" checked={Boolean(settings.safePrompts)} onChange={(e) => editSetting({ safePrompts: e.target.checked })} />
                            {settings.safePrompts ? "On · no gore, logos, or real people" : "Off"}
                          </label>
                        </div>
                        <label className="maker-field">
                          Image source
                          <select value={settings.sourcePolicy || "generated"} onChange={(e) => editSetting({ sourcePolicy: e.target.value })}>
                            <option value="generated">Generated</option>
                            <option value="reference">Approved references</option>
                            <option value="upload">Uploaded images</option>
                          </select>
                        </label>
                      </div>
                    )}
                    <div className="maker-visual-summary">
                      <p>
                        <strong>{promptEstimate ? `~${promptEstimate} scenes` : "Scenes follow the voiceover"}</strong>
                        <span>
                          {[styleLabel, settings.aspect || "16:9", QUALITY_OPTIONS.find(([key]) => key === (settings.quality || "standard"))?.[1], bible.cast.length ? `${bible.cast.length} characters` : ""].filter(Boolean).join(" · ")}
                        </span>
                      </p>
                      {scenes.length > 0 && (
                        <button className="maker-outline" onClick={() => setVisualView("scenes")}>
                          Review {scenes.length} scenes
                          <ArrowUpRight size={15} />
                        </button>
                      )}
                      {!(active && latest) && (
                        <button className="maker-primary" title={blocked || generateLabel} disabled={busy || !!blocked} onClick={generate}>
                          <WandSparkles size={15} />
                          {generateLabel}
                        </button>
                      )}
                    </div>
                  </div>
                </section>
              ) : (
                <>
                  <div className="maker-scene-head">
                    <button className="maker-link maker-focus-back" onClick={() => setVisualView(view === "edit" ? "scenes" : "settings")}>
                      <ChevronLeft size={16} />
                      Back
                      <span className="maker-focus-back-to">{view === "edit" ? "to storyboard" : "to settings"}</span>
                    </button>
                    <div className="maker-stage-head">
                      <div>
                        <h2>{view === "edit" ? "Edit video" : "Storyboard"}</h2>
                        <p>
                          {view === "edit" ? `${scenes.length} scenes · ${durationLabel(voiceover?.duration || 0)}` : `${scenes.length} scenes · ${scenes.filter((s) => s.asset).length} images ready`}
                          {failedScenes ? ` · ${failedScenes} failed` : ""}
                          {view === "edit" && missingImages ? ` · ${missingImages} without images` : ""}
                        </p>
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
                          <>
                            {toAnimate > 0 && (
                              <button className="maker-outline" disabled={busy} onClick={() => setConfirm({ action: "animate", confirmed: true })}>
                                <Sparkles size={15} />
                                Animate {toAnimate}
                              </button>
                            )}
                            {view === "edit" ? (
                              <>
                                {missingImages > 0 && (
                                  <button className="maker-outline" disabled={busy} onClick={() => setConfirm({ action: "images", confirmed: true })}>
                                    <ImagePlus size={15} />
                                    Generate {missingImages} {missingImages === 1 ? "image" : "images"}
                                  </button>
                                )}
                                <button className="maker-primary" title={missingImages ? "Every scene needs an image before rendering" : ""} disabled={busy || !scenes.length || missingImages > 0} onClick={() => void navigate("review")}>
                                  <Film size={15} />
                                  Render video
                                </button>
                              </>
                            ) : (
                              <>
                                {missingImages > 0 && (
                                  <button className="maker-outline" disabled={busy} onClick={() => setConfirm({ action: "images", confirmed: true })}>
                                    <ImagePlus size={15} />
                                    Generate {missingImages} {missingImages === 1 ? "image" : "images"}
                                  </button>
                                )}
                                <button
                                  className="maker-primary"
                                  title={voiceover?.duration ? "Open the preview and timeline" : "Generate the voiceover first. The timeline follows it."}
                                  disabled={!voiceover?.duration}
                                  onClick={() => {
                                    setVisualView("edit");
                                    document.querySelector(".maker-scroll")?.scrollTo({ top: 0 });
                                  }}
                                >
                                  <Check size={15} />
                                  Approve storyboard
                                </button>
                              </>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  {stageNotices}
                  {view === "edit" && voiceover?.duration ? (
                    <div className="maker-editor">
                    <div className="maker-preview-row">
                      <StoryboardPreview
                        scenes={scenes}
                        lines={voiceover.segments || []}
                        aspect={project.metadata.settings?.aspect || settings.aspect || "16:9"}
                        audioRef={timelineAudio}
                        time={playhead}
                        generating={Boolean(active)}
                        onSceneChange={setSelectedScene}
                      />
                    </div>
                    <SceneTimeline
                      scenes={scenes}
                      lines={voiceover.segments || []}
                      duration={voiceover.duration}
                      voiceSrc={voiceover.asset}
                      musicSrc={project.outputs.soundtrack?.asset || null}
                      musicVolume={settings.soundtrackVolume ?? 0.18}
                      audioRef={timelineAudio}
                      selectedId={selectedScene}
                      disabled={Boolean(active) || busy}
                      keysEnabled={!sceneEditor && !confirm}
                      onSelect={setSelectedScene}
                      onOpen={(sceneId) => {
                        setSelectedScene(sceneId);
                        setSceneEditor(true);
                      }}
                      onChange={(next) => edit({ scenes: next })}
                      onError={onError}
                    />
                    </div>
                  ) : null}
                  {focusScene && sceneEditor && (() => {
                    const { scene, index } = focusScene;
                    return (
                      <div className="maker-scene-modal" onClick={() => setSceneEditor(false)}>
                      <aside className="maker-card maker-inspector" role="dialog" aria-modal="true" aria-label={`Scene ${index + 1} editor`} onClick={(event) => event.stopPropagation()}>
                        <div className="maker-inspector-nav">
                          <button className="maker-icon" aria-label="Previous scene" disabled={index === 0} onClick={() => selectScene(scenes[index - 1].id)}>
                            <ChevronLeft size={16} />
                          </button>
                          <strong>Scene {index + 1}</strong>
                          <span className="maker-mono">
                            {durationLabel(scene.start)} – {durationLabel(scene.end)} · {(scene.end - scene.start).toFixed(1)}s
                          </span>
                          <button className="maker-icon" aria-label="Next scene" disabled={index === scenes.length - 1} onClick={() => selectScene(scenes[index + 1].id)}>
                            <ChevronLeft size={16} style={{ transform: "rotate(180deg)" }} />
                          </button>
                          <button className="maker-icon" aria-label="Close scene editor" autoFocus onClick={() => setSceneEditor(false)}>
                            <X size={16} />
                          </button>
                        </div>
                        <div className="maker-scene-media maker-inspector-media" style={{ aspectRatio: sceneRatio }}>
                          {scene.clip ? (
                            <video key={scene.clip} src={scene.clip} muted loop autoPlay playsInline aria-label={`Scene ${index + 1} animation`} />
                          ) : scene.asset ? (
                            <img key={scene.asset} src={scene.asset} alt={scene.prompt} />
                          ) : active && scene.generating ? (
                            <Loader2 size={28} className="animate-spin" />
                          ) : (
                            <ImagePlus size={28} />
                          )}
                          {scene.clip && <em className="maker-media-tag">Animated</em>}
                        </div>
                        {scene.error && (
                          <p className="maker-error is-inline" role="alert">
                            {scene.error}
                          </p>
                        )}
                        <div className="maker-inspector-actions">
                          <button className="maker-primary" disabled={active || busy} onClick={() => setConfirm({ action: "images", sceneId: scene.id, confirmed: true })}>
                            <RefreshCw size={15} />
                            {scene.asset ? "Regenerate" : "Generate image"}
                          </button>
                          {animation?.available && scene.asset && (
                            <button className="maker-outline" disabled={active || busy} onClick={() => setConfirm({ action: "animate", sceneId: scene.id, confirmed: true })}>
                              <Sparkles size={15} />
                              {scene.clip ? "Re-animate" : "Animate"}
                            </button>
                          )}
                          {scene.asset && (
                            <a className="mk-btn maker-icon" href={scene.asset} download aria-label={`Download scene ${index + 1}`}>
                              <Download size={15} />
                            </a>
                          )}
                        </div>
                        <p className="maker-scene-text">“{scene.text}”</p>
                        <label className="maker-field">
                          Image prompt
                          <textarea aria-label={`Scene ${index + 1} prompt`} rows={5} value={scene.prompt} onChange={(e) => editScene(index, { prompt: e.target.value })} />
                          {scene.promptFallback ? <small>Written from the narration because the AI skipped this scene. Edit it or regenerate prompts.</small> : null}
                          {scene.promptSoftened ? <small>This image used a softened version of the prompt to pass the image provider's safety filter.</small> : null}
                        </label>
                        {bible.cast.length > 0 && (
                          <div className="maker-scene-cast" aria-label={`Characters in scene ${index + 1}`}>
                            <span>Visible cast</span>
                            {bible.cast.map((character) => {
                              const selected = (scene.castIds || []).includes(character.id);
                              return (
                                <button
                                  type="button"
                                  key={character.id}
                                  aria-pressed={selected}
                                  onClick={() => editScene(index, {
                                    castIds: selected
                                      ? (scene.castIds || []).filter((castId: string) => castId !== character.id)
                                      : [...(scene.castIds || []), character.id],
                                  })}
                                >
                                  {character.approvedReferences?.[0] ? <img src={character.approvedReferences[0]} alt="" /> : <Users size={13} />}
                                  {character.name}
                                  {selected && <Check size={12} />}
                                </button>
                              );
                            })}
                          </div>
                        )}
                        <div className="maker-inspector-grid">
                          <label className="maker-field">
                            Motion
                            <select aria-label={`Scene ${index + 1} motion`} value={scene.motion || "still"} onChange={(e) => editScene(index, { motion: e.target.value })}>
                              <option value="still">Still</option>
                              <option value="push">Pan and zoom</option>
                            </select>
                          </label>
                          <label className="maker-field">
                            Source
                            <select aria-label={`Scene ${index + 1} source policy`} value={scene.sourcePolicy || "generated"} onChange={(e) => editScene(index, { sourcePolicy: e.target.value })}>
                              <option value="generated">Generated</option>
                              <option value="reference">Reference</option>
                              <option value="upload">Upload</option>
                            </select>
                          </label>
                          {scene.sourcePolicy && scene.sourcePolicy !== "generated" ? (
                            <label className="maker-field maker-span">
                              Reference image
                              <select aria-label={`Scene ${index + 1} reference image`} value={scene.referenceAsset || ""} onChange={(e) => editScene(index, { referenceAsset: e.target.value })}>
                                <option value="">{project.metadata.referenceAssets?.length ? "Choose a reference" : "Upload a reference image first"}</option>
                                {(project.metadata.referenceAssets || []).map((asset: string) => (
                                  <option key={asset} value={asset}>
                                    {asset.split("/").pop()}
                                  </option>
                                ))}
                              </select>
                            </label>
                          ) : null}
                        </div>
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
                        {(scene.animate || scene.clip) && (
                          <label className="maker-field">
                            Animation direction
                            <textarea
                              aria-label={`Scene ${index + 1} animation direction`}
                              rows={2}
                              maxLength={600}
                              value={scene.animationPrompt || ""}
                              placeholder="Leave blank and AI directs the motion. e.g. the cart rolls slowly left, camera still"
                              onChange={(e) => editScene(index, { animationPrompt: e.target.value })}
                            />
                          </label>
                        )}
                      </aside>
                      </div>
                    );
                  })()}
                  {view === "scenes" && (
                  <>
                  <div className="maker-board-bar">
                    <div className="maker-board-filter" role="tablist" aria-label="Filter scenes">
                      {([
                        ["all", "All", scenes.length],
                        ["missing", "Missing", missingImages],
                        ["ready", "Ready", scenes.filter((s) => s.asset).length],
                        ["failed", "Failed", failedScenes],
                        ["animated", "Animated", scenes.filter((s) => s.clip || s.animate).length],
                      ] as const)
                        .filter(([key, , count]) => key === "all" || count > 0)
                        .map(([key, label, count]) => (
                          <button key={key} type="button" role="tab" aria-selected={sceneFilter === key} onClick={() => setSceneFilter(key)}>
                            {label}
                            <span>{count}</span>
                          </button>
                        ))}
                    </div>
                    <div className="maker-actions">
                      <label className="mk-btn maker-outline" title="Reference images are used by scenes set to Reference">
                        <ImagePlus size={15} />
                        Reference image{project.metadata.referenceAssets?.length ? ` (${project.metadata.referenceAssets.length})` : ""}
                        <input type="file" hidden accept="image/png,image/jpeg,image/webp" onChange={(e) => void upload(e.target.files?.[0], 15, "image")} />
                      </label>
                      {scenes.some((s) => s.asset) && (
                        <a className="mk-btn maker-outline" href={`/api/maker/projects/${id}/scene-images.zip?accountId=${encodeURIComponent(accountId)}`} download>
                          <Download size={15} />
                          Download
                        </a>
                      )}
                    </div>
                  </div>
                  <div className="maker-board">
                    <div className="maker-board-grid" style={{ ["--scene-ratio" as string]: sceneRatio }}>
                      {filteredScenes.map(({ scene, index }) => (
                        <button
                          type="button"
                          key={scene.id}
                          className="maker-board-tile"
                          data-state={scene.error ? "failed" : scene.asset || scene.clip ? "ready" : "missing"}
                          aria-pressed={focusScene?.scene.id === scene.id}
                          aria-label={`Scene ${index + 1}, ${durationLabel(scene.start)} to ${durationLabel(scene.end)}${scene.error ? ", failed" : scene.asset ? "" : ", no image yet"}`}
                          onClick={() => {
                            selectScene(scene.id);
                            setSceneEditor(true);
                          }}
                        >
                          <span className="maker-board-media">
                            {scene.clip ? (
                              <video src={scene.clip} muted loop autoPlay playsInline />
                            ) : scene.asset ? (
                              <img src={scene.asset} alt="" loading="lazy" />
                            ) : active && scene.generating ? (
                              <Loader2 size={20} className="animate-spin" />
                            ) : scene.error ? (
                              <CircleAlert size={20} />
                            ) : (
                              <ImagePlus size={20} />
                            )}
                            {active && scene.generating && scene.asset ? <span className="maker-board-busy"><Loader2 size={16} className="animate-spin" /></span> : null}
                          </span>
                          <span className="maker-board-badge">
                            {index + 1} · {durationLabel(scene.start)}
                          </span>
                          {scene.error ? <em className="maker-board-flag is-bad">Failed</em> : scene.clip ? <em className="maker-board-flag">Animated</em> : scene.animate ? <em className="maker-board-flag">To animate</em> : null}
                          <span className="maker-board-over">
                            <span className="maker-board-text">{scene.text}</span>
                            <span className="maker-board-hint">{(scene.end - scene.start).toFixed(1)}s · {scene.motion === "push" ? "Pan & zoom" : "Still"} · Edit</span>
                          </span>
                        </button>
                      ))}
                      {!filteredScenes.length && <p className="maker-caption">No scenes match this filter.</p>}
                    </div>
                  </div>
                  </>
                  )}
                </>
              ))}
            {currentStage === "thumbnail" && (
              <section className="maker-card maker-gen">
                {genHead()}
                <div className="maker-gen-body">
                  {stageNotices}
                  <div className="maker-segmented maker-thumb-mode" role="tablist" aria-label="Thumbnail method">
                    {[
                      ["channel", <TrendingUp size={14} key="i" />, "Channel style", channelThumbs.length ? "" : "Generate titles from a channel or style first"],
                      ["reference", <ImageIcon size={14} key="i" />, "Edit a reference", ""],
                      ["scratch", <WandSparkles size={14} key="i" />, "Start from scratch", ""],
                    ].map(([key, icon, label, reason]) => (
                      <button
                        key={String(key)}
                        role="tab"
                        aria-selected={thumbModeNow === key}
                        aria-pressed={thumbModeNow === key}
                        disabled={Boolean(reason)}
                        title={String(reason || "")}
                        onClick={() => {
                          setThumbMode(key as any);
                          editSetting({ thumbnailMode: key, ...(key !== "reference" && thumbReference ? { thumbnailReference: "" } : {}) });
                        }}
                      >
                        {icon}
                        {label}
                      </button>
                    ))}
                  </div>
                  {thumbModeNow === "channel" ? (
                    <>
                      <Step n={1} title={`Pick a winning thumbnail from ${project.outputs.title?.blueprint?.channel?.title || "the channel"}`}>
                        <p className="maker-caption maker-flush">
                          Your new thumbnail copies its style — layout, text treatment, colors, and framing — with a new subject for this video.
                        </p>
                        <div className="maker-thumb-picks" role="radiogroup" aria-label="Style reference thumbnail">
                          {[...channelThumbs]
                            .sort((a, b) => b.viewCount - a.viewCount)
                            .map((video) => {
                              const on = styleRefs.includes(video.url);
                              return (
                                <button
                                  key={video.url}
                                  role="radio"
                                  aria-checked={on}
                                  aria-pressed={on}
                                  title={video.title}
                                  onClick={() => editSetting({ thumbnailStyleRefs: [video.url] })}
                                >
                                  <img src={video.thumbnailUrl} alt="" loading="lazy" />
                                  <span>{compact(video.viewCount)} views</span>
                                  {on && <Check size={14} className="maker-art-check" />}
                                </button>
                              );
                            })}
                        </div>
                        {project.outputs.title?.blueprint?.thumbnailFormat?.composition && (
                          <p className="maker-format-note">
                            <strong>{project.outputs.title.blueprint.thumbnailFormat.observed ? "The channel's thumbnail formula" : "Likely formula"}:</strong>{" "}
                            {[
                              project.outputs.title.blueprint.thumbnailFormat.composition,
                              project.outputs.title.blueprint.thumbnailFormat.text,
                              project.outputs.title.blueprint.thumbnailFormat.palette,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                        )}
                      </Step>
                      <Step n={2} title="Idea for this video (optional)">
                        <textarea
                          rows={2}
                          aria-label="Thumbnail idea"
                          value={settings.thumbnailPrompt || ""}
                          placeholder={`Leave blank to build it from the title${project.outputs.title?.concept ? " and concept" : ""}. e.g. an abandoned toy store with a red arrow on the empty shelf`}
                          onChange={(e) => editSetting({ thumbnailPrompt: e.target.value })}
                        />
                        <PromptSuggestions category="thumbnail" context={promptContext} value={settings.thumbnailPrompt || ""} onChange={(thumbnailPrompt) => editSetting({ thumbnailPrompt })} append accountId={accountId} />
                      </Step>
                    </>
                  ) : thumbModeNow === "reference" ? (
                    <>
                      <Step n={1} title="Reference thumbnail">
                        {thumbReference ? (
                          <div className="maker-thumb-reference">
                            <img src={thumbReference} alt="Reference thumbnail" />
                            <div className="maker-stack-sm">
                              <p className="maker-caption maker-flush">This image is edited, not copied: only the changes you describe are applied.</p>
                              <div className="maker-actions">
                                <label className="mk-btn maker-outline">
                                  <Upload size={14} />
                                  Replace
                                  <input type="file" hidden accept="image/png,image/jpeg,image/webp" onChange={(e) => e.target.files?.[0] && void setThumbnailReference({ file: e.target.files[0] })} />
                                </label>
                                <button className="maker-link" onClick={() => editSetting({ thumbnailReference: "" })}>
                                  <X size={13} />
                                  Remove
                                </button>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="maker-thumb-source">
                            <label className="maker-dropzone" data-busy={busy || undefined}>
                              <input type="file" hidden accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={(e) => e.target.files?.[0] && void setThumbnailReference({ file: e.target.files[0] })} />
                              {busy ? <Loader2 size={20} className="animate-spin" /> : <Upload size={20} />}
                              <strong>Upload image</strong>
                              <small>PNG, JPEG, or WebP · up to 15 MB</small>
                            </label>
                            <span className="maker-or">or</span>
                            <form
                              className="maker-url-load"
                              onSubmit={(e) => {
                                e.preventDefault();
                                if (thumbUrl.trim()) void setThumbnailReference({ youtubeUrl: thumbUrl.trim() });
                              }}
                            >
                              <label className="maker-field">
                                YouTube video link
                                <input type="url" value={thumbUrl} placeholder="https://www.youtube.com/watch?v=…" onChange={(e) => setThumbUrl(e.target.value)} />
                              </label>
                              <button className="maker-outline" type="submit" disabled={busy || !thumbUrl.trim()}>
                                Load thumbnail
                              </button>
                            </form>
                          </div>
                        )}
                      </Step>
                      <Step n={2} title="Describe the changes">
                        <textarea
                          rows={3}
                          aria-label="Changes to the reference thumbnail"
                          value={settings.thumbnailPrompt || ""}
                          placeholder="e.g. make the person yellow instead of red, change the bottle to root beer, and change the word “machine” to “soda”"
                          onChange={(e) => editSetting({ thumbnailPrompt: e.target.value })}
                        />
                      </Step>
                    </>
                  ) : (
                    <Step n={1} title="Describe the thumbnail">
                      <textarea
                        rows={3}
                        aria-label="Thumbnail description"
                        value={settings.thumbnailPrompt || ""}
                        placeholder={project.outputs.title?.current ? `Defaults to the title: ${project.outputs.title.current}` : "Subject, emotion, contrast, and one short text idea"}
                        onChange={(e) => editSetting({ thumbnailPrompt: e.target.value })}
                      />
                      <PromptSuggestions category="thumbnail" context={promptContext} value={settings.thumbnailPrompt || ""} onChange={(thumbnailPrompt) => editSetting({ thumbnailPrompt })} append accountId={accountId} />
                      <p className="maker-caption">Uses your Visuals art style when one is selected.</p>
                    </Step>
                  )}
                  <Step n={thumbModeNow === "scratch" ? 2 : 3} title="Variants">
                    <div className="maker-presets">
                      {[1, 2, 3].map((n) => (
                        <button key={n} aria-pressed={thumbCount === n} onClick={() => editSetting({ thumbnailVariants: n })}>
                          {n} {n === 1 ? "image" : "images"}
                        </button>
                      ))}
                    </div>
                  </Step>
                  <Step n={thumbModeNow === "scratch" ? 3 : 4} title="Choose one">
                    {draft.mode === "channel" && draft.styleRefs?.length && draft.variants?.length ? (
                      <div className="maker-styled-after">
                        <span>Styled after</span>
                        {draft.styleRefs.map((ref: any) => (
                          <a key={ref.url} href={ref.url} target="_blank" rel="noreferrer" title={ref.title}>
                            <img src={ref.thumbnailUrl} alt={ref.title} loading="lazy" />
                          </a>
                        ))}
                      </div>
                    ) : null}
                    {draft.variants?.length ? (
                      <div className={`maker-thumbnail-grid ${draft.reference ? "has-reference" : ""}`}>
                        {draft.reference && (
                          <figure className="maker-thumb-before">
                            <img src={draft.reference} alt="Reference used for these variants" />
                            <figcaption>Reference</figcaption>
                          </figure>
                        )}
                        {draft.variants.map((variant: any, index: number) => (
                          <button key={variant.asset} aria-pressed={draft.asset === variant.asset} onClick={() => edit({ asset: variant.asset, selectedVariant: index })}>
                            <img src={variant.asset} alt={`Thumbnail variant ${index + 1}`} />
                            <span>
                              {draft.variants.length > 1 ? `Variant ${index + 1}` : "Result"}
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
                        Your thumbnail appears here
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
            confirm.action === "music"
              ? "Compose the soundtrack?"
              : confirm.action === "animate"
              ? confirm.sceneId
                ? "Animate this scene?"
                : `Animate ${toAnimate} ${toAnimate === 1 ? "scene" : "scenes"}?`
              : confirm.action === "images"
              ? confirm.sceneId
                ? "Generate this scene?"
                : "Generate scene images?"
              : confirm.action === "thumbnailVariants"
                ? thumbCount > 1
                  ? `Generate ${thumbCount} thumbnails?`
                  : "Generate the thumbnail?"
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
              <button
                className="maker-primary"
                onClick={() =>
                  void start(
                    confirm.action === "animate"
                      ? { ...confirm, model: animOptions.model || animation?.model, fixedCamera: animOptions.fixedCamera }
                      : confirm,
                  )
                }
              >
                {currentStage === "review" ? "Render" : confirm.action === "music" ? "Compose" : confirm.action === "animate" ? "Animate" : "Generate"}
              </button>
            </>
          }
        >
          {(() => {
            const animateTargets = confirm.sceneId ? scenes.filter((scene) => scene.id === confirm.sceneId) : scenes.filter((scene) => scene.animate && scene.asset && !scene.clip);
            const clipSeconds = animateTargets.reduce((sum, scene) => sum + Math.min(10, Math.max(4, Math.round(scene.end - scene.start))), 0);
            const musicParts = normalizeMusicSegments(draft.segments, Number(project.metadata.soundtrackSource?.duration || voiceover?.duration || 0));
            const musicSeconds = Number(project.metadata.soundtrackSource?.duration || voiceover?.duration || 0);
            if (confirm.action === "animate")
              return (
                <div className="maker-stack">
                  <p>
                    {animateTargets.length} image-to-video {animateTargets.length === 1 ? "request" : "requests"}, about {clipSeconds}s of video in total, billed per second. A retry resumes the same job instead of paying twice. Needs about {Math.round(animateTargets.length * 8)} MB of storage.
                  </p>
                  <label className="maker-field">
                    Animation model
                    <select value={animOptions.model || animation?.model || ""} onChange={(e) => setAnimOptions({ ...animOptions, model: e.target.value })}>
                      {(animation?.models?.length ? animation.models : [animation?.model || ""]).map((model) => (
                        <option key={model} value={model}>
                          {model}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="maker-setting-tile">
                    <div>
                      <strong>Fixed camera</strong>
                      <span>Only the subjects move. The frame stays locked, with no pans or zooms.</span>
                    </div>
                    <span className="maker-switch">
                      <input type="checkbox" aria-label="Fixed camera" checked={animOptions.fixedCamera} onChange={(e) => setAnimOptions({ ...animOptions, fixedCamera: e.target.checked })} />
                    </span>
                  </label>
                </div>
              );
            if (confirm.action === "music")
              return (
                <p>
                  {music?.provider || "Lyria 3 Pro"} composes {musicParts.filter((part) => !part.muted).length} {musicParts.filter((part) => !part.muted).length === 1 ? "cue" : "cues"}, one for each segment, then crossfades them into {Math.round(musicSeconds)}s of instrumental music.
                  {musicParts.some((part) => part.muted) ? ` Muted segments stay silent and aren't generated.` : ""} Each cue is billed separately. A retry reuses cues that were already composed.
                </p>
              );
            return (
              <p>
                {confirm.action === "images"
                  ? confirm.sceneId
                    ? `One image request is sent to your configured provider. Needs about ${imageMb} MB of storage.`
                    : `${missingImages} missing images will be requested. Scenes that already have images are skipped. Needs about ${Math.ceil(missingImages * imageMb)} MB of storage.`
                  : confirm.action === "thumbnailVariants"
                    ? `${thumbCount} image ${thumbCount === 1 ? "request is" : "requests are"} sent to your image model${
                        thumbModeNow === "channel"
                          ? ", each styled after the channel thumbnail you picked"
                          : thumbReference && thumbModeNow === "reference"
                            ? ", each editing your reference thumbnail"
                            : ""
                      }.`
                    : currentStage === "review"
                      ? "FFmpeg renders locally from your voiceover, scenes, music, and captions, then validates the output."
                      : "Narration is generated with your selected voice, then aligned with local Whisper. Provider charges may apply."}
              </p>
            );
          })()}
        </Modal>
      )}
      {artModal && (
        <CreateArtStyleModal
          accountId={accountId}
          projectId={id}
          onClose={() => setArtModal(false)}
          onCreated={async (artStyleId) => {
            setArtModal(false);
            await loadArtStyles();
            editSetting({ artStyleId });
          }}
        />
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
