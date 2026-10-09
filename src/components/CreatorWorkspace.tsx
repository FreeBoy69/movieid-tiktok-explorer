import { Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { Composer, SendButton, StudioLayout } from "./StudioLayout";
import {
  ArrowLeft,
  ArrowUpRight,
  Archive,
  BarChart3,
  Bookmark,
  CircleDollarSign,
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
  Grid2x2,
  Grid3x3,
  Square,
  FolderOpen,
  ImagePlus,
  Layers,
  ListOrdered,
  Loader2,
  Mic,
  Music,
  Pause,
  Play,
  Pencil,
  Plus,
  RefreshCw,
  AlertCircle,
  RotateCcw,
  Save,
  Scissors,
  Search,
  Shuffle,
  SlidersHorizontal,
  Sparkles,
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
  ART_STYLE_PRESETS,
  DEFAULT_SCENE_SECONDS,
  assertStageReady,
  dialogueSpeakers,
  isDialogueProject,
  mergeVisualSegment,
  parseDialogue,
  normalizeMusicSegments,
  normalizeVisualSegments,
  rankDiscoveryChannels,
  segmentImageLimit,
  SHOT_LABELS,
  SHOT_SIZES,
  splitVisualSegment,
  transcriptBoundaries,
} from "../utils/creatorPipeline.js";
import { VoiceoverStudio } from "./VoiceoverStudio";
import { StandardVideoCard } from "./StandardCards";
import { loadVoiceProfiles } from "../utils/voiceProfiles";
import { AudioPlayer } from "./AudioPlayer";
import { lazyPage } from "../utils/lazyPage";
import { MusicLibrary } from "./MusicLibrary";
import { MixPreview, ScenePlayButton, SyncedClip, playbackStyle, useScenePlayback, type MixPreviewHandle } from "./ScenePlayback";
import { VideoPlayer } from "./VideoPlayer";
import { CharactersStep, type CastSheetState, type Framing, type StoryObject } from "./CharactersStep";
import { VoicePicker } from "./VoicePicker";
import { PromptSuggestions } from "./PromptSuggestions";
import { toast, useErrorToast } from "../utils/toast";
import { DramaStudio } from "./DramaStudio";
import ShortfilmTemplatePicker from "./ShortfilmTemplatePicker";
import CaptionStylePicker from "./CaptionStylePicker";
import { GraphicEditor, graphicSummary, LookPicker, OverlayEditor, overlaySummary, WinningThumbnails, type SceneGraphic, type SceneOverlay, type WinningVideo } from "./CreateVideoExtras";
import { VIDEO_TRANSITIONS } from "../utils/videoLooks.js";
import { findShortfilmTemplate, shortfilmSettings } from "../utils/shortfilmTemplates";
import { takePendingTemplate, type PendingTemplate } from "../utils/promptTemplates";
import { isDramaSeries } from "../utils/dramaTemplates";
import { PRODUCTION_PLAYBOOKS, PRODUCTION_PROFILES } from "../utils/productionProfiles.js";
import { tokensToCredits } from "../utils/credits.js";
import { ProductionPreflight, type ProductionReview } from "./ProductionPreflight";
import { FileDrop } from "./FileDrop";
import { SourcePicker } from "./SourcePicker";
import { UploadButton } from "./UploadButton";
import { LanguagePicker } from "./LanguagePicker";
import "./CreatorWorkspace.css";
import { confirm as confirmDialog, Dialog } from "./ui/Dialog";
import { EmptyState, Progress, SearchField, Segmented, Switch, Tabs } from "./ui/controls";
import { confirmRemoveCharacter } from "./castSheets";

type BoardSize = "s" | "m" | "l";
const BOARD_SIZE_KEY = "autoyt-storyboard-size";
function readBoardSize(): BoardSize {
  try {
    const saved = window.localStorage.getItem(BOARD_SIZE_KEY);
    return saved === "s" || saved === "l" ? saved : "m";
  } catch {
    return "m";
  }
}

// Failed jobs already announced this session, so revisiting a stage does not repeat the toast.
const announcedFailures = new Set<string>();

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
  thumbnail: { name: "Thumbnail Generator", text: "Copy the style of a winning video on your topic, edit a reference, or start from scratch.", icon: <ImagePlus size={18} /> },
  review: { name: "Export", text: "Validate, render, and download everything in one bundle.", icon: <Download size={18} /> },
};
const PAGE_SIZE = 18;
type Job = {
  id: string;
  stage: string;
  status: string;
  progress: number;
  message: string;
  error?: string;
  createdAt: number;
};
export async function creatorApi(url: string, body?: unknown, method?: string, options: { signal?: AbortSignal } = {}) {
  const response = await fetch(url, {
    method: method || (body === undefined ? "GET" : "POST"),
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: options.signal,
  });
  // An outage or proxy page comes back as HTML; it gets a plain message, never a parser error.
  const text = await response.text();
  let data: any = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = null;
  }
  if (!response.ok || data === null) {
    const message = data?.error || (data === null || response.status >= 500 ? "The server is unavailable right now. Try again in a moment." : "Request failed. Try again.");
    const error = new Error(message) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return data;
}
// Unknown counts read as a dash, never as zero.
const compact = (value: number | null | undefined) =>
  value === null || value === undefined || !Number.isFinite(Number(value))
    ? "—"
    : new Intl.NumberFormat("en", {
        notation: "compact",
        maximumFractionDigits: 1,
      }).format(Number(value));
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

export function Action({
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
export function Empty({
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
    <EmptyState className="maker-empty" icon={icon || <Film size={22} />} title={title} body={text}>
      {children}
    </EmptyState>
  );
}
export function PageHead({
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
// Channel style cards: picked when a project starts and when it is edited.
function StyleCardPicker({ styles, value, onChange, allowNone }: { styles: ChannelStyle[]; value: string; onChange: (id: string) => void; allowNone?: boolean }) {
  return (
    <div className="maker-style-picker" role="radiogroup" aria-label="Channel style">
      {allowNone ? (
        <button type="button" role="radio" aria-checked={!value} aria-pressed={!value} className="is-dashed" onClick={() => onChange("")}>
          <X size={18} />
          <strong>No style</strong>
        </button>
      ) : null}
      {styles.map((s) => (
        <button key={s.id} type="button" role="radio" aria-checked={value === s.id} aria-pressed={value === s.id} onClick={() => onChange(s.id)}>
          <StyleCover style={s} />
          <strong>{s.name}</strong>
          <small>{s.profile?.settings?.wordCount || 600} words</small>
        </button>
      ))}
      <button type="button" className="is-dashed" onClick={() => writeDeepLink({ view: "styles" })}>
        <Plus size={18} />
        <strong>Create style</strong>
      </button>
    </div>
  );
}
// Create Video's dialogs use the shared Dialog. Its body and footer sit in a
// maker scope (display: contents) so maker form styles and theme still apply.
function makerTheme() {
  if (typeof document === "undefined") return "dark";
  return document.querySelector<HTMLElement>(".maker-workspace:not(.maker-scope)")?.dataset.theme || document.documentElement.dataset.theme || "dark";
}
export function MakerScope({ children }: { children: ReactNode }) {
  return (
    <div className="maker-workspace maker-scope" data-theme={makerTheme()}>
      {children}
    </div>
  );
}
export function Modal({
  title,
  onClose,
  wide,
  footer,
  className = "",
  children,
}: {
  title: string;
  onClose: () => void;
  wide?: boolean;
  footer?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Dialog
      title={title}
      onClose={onClose}
      size={wide ? "lg" : "sm"}
      className={`maker-dialog${wide ? " is-wide" : ""} ${className}`.trim()}
      footer={footer ? <MakerScope>{footer}</MakerScope> : undefined}
    >
      <MakerScope>{children}</MakerScope>
    </Dialog>
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
  useErrorToast(error, () => setError(""));
  return (
    <section className="maker-workspace" data-theme={theme}>
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
      ) : route.view === "drama" ? (
        <DramaStudio key={`${accountId}:${route.filmFormat || "series"}`} accountId={accountId} format={route.filmFormat} seriesId={route.seriesId} episodeId={route.episodeId} onError={setError} />
      ) : route.projectId ? (
        <ProjectEditor
          key={`${accountId}:${route.projectId}`}
          id={route.projectId}
          stage={route.projectStage || "title"}
          initialSceneId={route.sceneId}
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
  initial,
  onClose,
  onError,
}: {
  accountId: string;
  styles: ChannelStyle[];
  collections: any[];
  /** A prompt handed over from the Prompt Library ("Make it a long video"). */
  initial?: PendingTemplate | null;
  onClose: () => void;
  onError: (e: string) => void;
}) {
  const [mode, setMode] = useState(initial ? (initial.shotTemplateId ? "template" : "blank") : styles.length ? "style" : "blank"),
    [styleId, setStyleId] = useState(styles[0]?.id || ""),
    [collectionId, setCollectionId] = useState(""),
    [channelUrl, setChannelUrl] = useState(""),
    [title, setTitle] = useState(initial?.title || ""),
    [shot, setShot] = useState<{ id: string; values: Record<string, string> }>({ id: initial?.shotTemplateId || "", values: initial?.shotTemplateValues || {} }),
    [busy, setBusy] = useState(false);
  const research = collections.filter((c) => c.data?.kind !== "bookmarks");
  async function start() {
    setBusy(true);
    try {
      const style = styles.find((s) => s.id === styleId);
      const collection = research.find((c) => c.id === collectionId);
      const shotTemplate = mode === "template" ? findShortfilmTemplate(shot.id) : null;
      const handedOver = initial && (mode === "template" || mode === "blank") ? initial : null;
      await createProject(accountId, {
        title: title.trim() || "Untitled video",
        brief:
          mode === "collection" && collection
            ? `Research query: ${collection.data?.search || ""}\nSelected evidence:\n${(collection.data?.selected || []).join("\n")}`
            : mode === "style"
              ? style?.niche || ""
              : [
                  shotTemplate
                    ? [
                        `${shotTemplate.name}: ${shotTemplate.tagline}`,
                        ...shotTemplate.variables.map((item: { name: string; label: string; example: string }) => `${item.label}: ${shot.values[item.name]?.trim() || item.example}`),
                      ].join("\n")
                    : "",
                  handedOver?.prompt ? `${handedOver.title ? `Idea (${handedOver.title})` : "Idea"}:\n${handedOver.prompt}` : "",
                ]
                  .filter(Boolean)
                  .join("\n\n"),
        styleId: mode === "style" ? styleId : "",
        settings:
          mode === "style"
            ? style?.profile?.settings || {}
            : shotTemplate || handedOver?.aspect
              ? {
                  ...(handedOver?.aspect ? { aspect: handedOver.aspect } : {}),
                  ...(shotTemplate ? { ...shortfilmSettings(shotTemplate.id), shotTemplateValues: shot.values } : {}),
                }
              : undefined,
        researchCollectionId: mode === "collection" ? collectionId : "",
        sourceUrl: mode === "channel" ? channelUrl : "",
        createdFrom:
          mode === "collection"
            ? "research-collection"
            : mode === "channel"
              ? "channel-reference"
              : mode === "style"
                ? "style-profile"
                : handedOver
                  ? "prompt-library"
                  : shotTemplate
                    ? "shot-template"
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
    (mode === "template" && shot.id) ||
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
        {initial && (
          <p className="maker-hint maker-flush">
            Starting from <strong>{initial.title}</strong> in the Prompt Library. Its prompt becomes the brief.
          </p>
        )}
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
                <StyleCardPicker styles={styles} value={styleId} onChange={setStyleId} />
              ) : (
                <p className="maker-muted maker-small">
                  No styles yet. Copy one from a channel in Niche Finder or Styles.
                </p>
              )}
            </div>
          )}
          <Option
            name="start-from"
            value="template"
            checked={mode === "template"}
            onChange={() => setMode("template")}
            title="Start from a template"
            text="A genre's camera moves, look, and beats: micro-drama, trailer, found footage, and more."
            icon={<Clapperboard size={18} />}
            tone="is-soft"
          />
          {mode === "template" && (
            <div className="maker-option-extra">
              <ShortfilmTemplatePicker value={shot.id} onPick={(template, values) => setShot({ id: template?.id || "", values })} />
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
              <SourcePicker
                label="Research collection"
                ariaLabel="Research collection"
                placeholder={research.length ? "Choose saved research" : "No saved research yet"}
                sourcesTabLabel="Saved research"
                disabled={!research.length}
                theme={makerTheme() === "light" ? "light" : "dark"}
                options={research.map((c) => ({ value: c.id, label: c.name, kind: "collection" as const }))}
                value={collectionId}
                onChange={setCollectionId}
              />
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
    setProjects((data.projects || []).filter((project: CreatorProject) => !isDramaSeries(project) && project.sourceType !== "drama_episode"));
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
        setProjects((p.projects || []).filter((project: CreatorProject) => !isDramaSeries(project) && project.sourceType !== "drama_episode"));
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
  const [pending] = useState(() => takePendingTemplate("create"));
  const [picker, setPicker] = useState(Boolean(pending));
  // The box's idea goes to the New video picker the same way a library prompt does.
  const [handoff, setHandoff] = useState<PendingTemplate | null>(pending);
  const [idea, setIdea] = useState("");
  const [section, setSection] = useState<"recent" | "shortcuts">("recent");
  const startFromIdea = () => {
    const text = idea.trim();
    setHandoff(text ? { target: "create", title: "", prompt: text, at: Date.now() } : null);
    setPicker(true);
  };
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
    <div className="maker-scroll maker-in-layout">
      <StudioLayout
        title="Create Video"
        intro="Describe a video and start a project, then move from title to script, voice, visuals, and export."
        composer={
          <Composer
            as="form"
            onSubmit={(event) => {
              event.preventDefault();
              startFromIdea();
            }}
            controls={
              <>
                <button type="button" className="maker-box-chip" onClick={() => { setHandoff(null); setPicker(true); }}>
                  <Layers size={14} /> Start from a style or template
                </button>
                <span className="maker-box-meta">{loading ? "Loading projects" : `${live.length} ${live.length === 1 ? "video" : "videos"} · ${inProgress} in progress · ${thisMonth} this month`}</span>
              </>
            }
            send={<SendButton type="submit" disabled={!idea.trim()} label="Start a video from this idea" />}
          >
            <textarea
              value={idea}
              onChange={(event) => setIdea(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && idea.trim()) {
                  event.preventDefault();
                  startFromIdea();
                }
              }}
              rows={2}
              placeholder="What's the video about? e.g. the rise and fall of a forgotten 1990s gadget, explained in 8 minutes"
              aria-label="Video idea"
            />
          </Composer>
        }
        tabsLabel="Create Video sections"
        tabs={[
          { value: "recent", label: "Continue where you left off", hint: live.length ? String(live.length) : undefined },
          { value: "shortcuts", label: "Shortcuts" },
        ]}
        tab={section}
        onTab={(next) => setSection(next as "recent" | "shortcuts")}
        aside={live.length > 4 ? (
          <button type="button" className="sl-aside" onClick={() => writeDeepLink({ view: "projects" })}>
            <strong>View all projects</strong> <ArrowUpRight size={14} />
          </button>
        ) : null}
      >
        {section === "shortcuts" ? (
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
          ) : (
          <>
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
            </>
        )}
      </StudioLayout>
      {picker && (
        <NewVideoModal
          accountId={accountId}
          styles={styles}
          collections={collections}
          initial={handoff}
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
      wide
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
        <div className="maker-field">
          <span>Style</span>
          <StyleCardPicker styles={styles} value={styleId} onChange={setStyleId} allowNone />
        </div>
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
    [freeMedia, setFreeMedia] = useState(false),
    [editing, setEditing] = useState<CreatorProject | null>(null);
  async function mutate(p: CreatorProject, status: string, free = false) {
    setConfirm(null);
    try {
      let version = p.version || 1;
      // Freeing media keeps the text, voiceover and thumbnail; images, clips and renders go.
      if (free) {
        const data = await creatorApi(`/api/maker/projects/${p.id}/prune`, {
          accountId,
          confirmed: true,
          categories: ["workspace", "renders", "clips", "images"],
          expectedVersion: version,
        });
        version = data.project?.version || version;
      }
      await creatorApi(
        `/api/maker/projects/${p.id}`,
        { status, accountId, expectedVersion: version },
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
  const kept = (p: CreatorProject, free = false) =>
    [
      "Title, script, and description",
      p.outputs?.voiceover?.asset && "Voiceover audio and transcript",
      p.outputs?.soundtrack?.asset && "Soundtrack and license credit",
      !free && p.outputs?.visualPlan?.scenes?.length &&
        `${p.outputs.visualPlan.scenes.filter((s: any) => s.asset).length} scene images`,
      p.outputs?.thumbnail?.asset && "Thumbnail variants",
      !free && p.outputs?.review?.asset && "Rendered video and export bundle",
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
          <SearchField className="maker-searchbar" value={query} onChange={setQuery} placeholder="Search projects" />
          <Segmented
            label="Project list"
            value={archived ? "archived" : "active"}
            onChange={(next) => setArchived(next === "archived")}
            options={[
              { value: "active", label: "Active" },
              { value: "archived", label: "Archived" },
            ]}
          />
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
                onClick={() => void mutate(confirm.project, confirm.status, confirm.status === "archived" && freeMedia)}
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
              <p>{freeMedia ? "Archiving hides the project from your active list and frees its storage. These stay:" : "Archiving hides the project from your active list. Nothing is deleted:"}</p>
              <ul className="maker-kept">
                {kept(confirm.project, freeMedia).map((item) => (
                  <li key={item}>
                    <Check size={14} />
                    {item}
                  </li>
                ))}
              </ul>
              <Switch
                className="maker-switch-row"
                compact
                checked={freeMedia}
                onChange={setFreeMedia}
                label="Also free its storage"
                description="Removes scene images, animated clips, rendered videos and working files. The title, script, description, voiceover and thumbnail stay, and images can be generated again."
              />
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
// What a saved search keeps: every video (the page ranks from them) and the server's channel order,
// without the channels' own video previews. A collection holds at most about 1 MB, so a very large
// search keeps the selected channels' videos plus the busiest channels' until it fits.
const COLLECTION_BYTES = 900_000;
function storedResult(result: any, keep: string[] = []) {
  const slim = { ...result, channels: (result?.channels || []).map((channel: any) => ({ id: channel.id })) };
  if (JSON.stringify(slim).length <= COLLECTION_BYTES) return slim;
  const order = [...keep, ...slim.channels.map((channel: any) => channel.id)];
  const counts = new Map<string, number>();
  for (const video of slim.videos || []) counts.set(video.channelId, (counts.get(video.channelId) || 0) + 1);
  const ids = [...new Set([...order, ...counts.keys()])];
  for (let n = ids.length; n > 1; n = Math.floor(n * 0.75)) {
    const allowed = new Set(ids.slice(0, n));
    const trimmed = { ...slim, videos: (slim.videos || []).filter((video: any) => allowed.has(video.channelId)) };
    if (JSON.stringify(trimmed).length <= COLLECTION_BYTES) return trimmed;
  }
  return { ...slim, videos: (slim.videos || []).filter((video: any) => keep.includes(video.channelId)) };
}
// Niches left out by default: music and kids content, reuploads, and niches that game the algorithm.
const DEFAULT_EXCLUDED = ["music", "song", "lofi", "movies", "breastfeeding", "lingerie", "transparent", "transparency", "clean", "haul", "kids", "gaming", "tv", "compilation", "bodycam", "dashcam"];
// Every filter switched off. Removing a chip sets that filter back to this value.
const EMPTY_FILTERS = {
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
  monetized: false,
  sort: "created",
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
// The view a first visit opens on: faceless, long-form, English channels with a typical
// video above 5K views, newest channels first.
const DEFAULT_FILTERS = {
  ...EMPTY_FILTERS,
  faceless: true,
  format: "longform",
  language: "en",
  minViews: 5000,
  excludeTerms: DEFAULT_EXCLUDED.join(", "),
};
type Filters = typeof DEFAULT_FILTERS;
const SERVER_FILTERS: Array<keyof Filters> = ["days", "duration", "region"];
const LANGUAGES: Array<[string, string]> = [["en", "English"], ["es", "Spanish"], ["pt", "Portuguese"], ["fr", "French"], ["de", "German"], ["it", "Italian"], ["hi", "Hindi"], ["ar", "Arabic"], ["ja", "Japanese"], ["ko", "Korean"], ["id", "Indonesian"], ["tr", "Turkish"], ["ru", "Russian"]];
const NICHE_PRESETS: Array<{ label: string; query: string; filters: Partial<Filters> }> = [
  { label: "Sleep", query: "sleep stories", filters: { minViews: 1000, minDurationMinutes: 50 } },
  { label: "Story", query: "stories", filters: { minViews: 4000, minDurationMinutes: 30 } },
];
const daysAgo = (days: number) => new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
function activeFilterChips(filters: Filters) {
  const chips: Array<[keyof Filters, string]> = [];
  if (filters.days !== EMPTY_FILTERS.days) chips.push(["days", `Videos from the last ${filters.days} days`]);
  if (filters.duration !== "any")
    chips.push(["duration", { short: "Under 4 min", medium: "4–20 min", long: "20+ min" }[filters.duration] || filters.duration]);
  if (filters.region !== EMPTY_FILTERS.region) chips.push(["region", `Region ${filters.region}`]);
  if (filters.faceless) chips.push(["faceless", "Faceless channels"]);
  if (filters.monetized) chips.push(["monetized", "Monetized"]);
  if (filters.format !== "any") chips.push(["format", filters.format === "shorts" ? "Shorts" : "Long form"]);
  if (filters.language) chips.push(["language", LANGUAGES.find(([code]) => code === filters.language)?.[1] || `Language ${filters.language}`]);
  if (filters.facelessUnknown !== "include")
    chips.push(["facelessUnknown", filters.facelessUnknown === "exclude" ? "Faceless known" : "Faceless unknown"]);
  if (filters.createdAfter) chips.push(["createdAfter", `Started after ${filters.createdAfter}`]);
  if (filters.createdBefore) chips.push(["createdBefore", `Started before ${filters.createdBefore}`]);
  if (filters.minViews) chips.push(["minViews", `Typical views ≥ ${compact(filters.minViews)}`]);
  if (filters.maxViews) chips.push(["maxViews", `Typical views ≤ ${compact(filters.maxViews)}`]);
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
  if (filters.excludeTerms) {
    const count = filters.excludeTerms.split(",").filter((t) => t.trim()).length;
    chips.push(["excludeTerms", `${count} excluded ${count === 1 ? "niche" : "niches"}`]);
  }
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
// How long a channel has been posting: "5mo", "3y".
function activeFor(since: number) {
  const days = Math.max(0, (Date.now() - since) / 86400000);
  return days < 30 ? `${Math.round(days)}d` : days < 365 ? `${Math.floor(days / 30)}mo` : `${Math.floor(days / 365)}y`;
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
  const [broken, setBroken] = useState(false);
  const avatar =
    c.thumbnailUrl && !broken ? (
      <img className="maker-avatar" src={c.thumbnailUrl} alt="" onError={() => setBroken(true)} />
    ) : (
      <span className="maker-avatar" aria-hidden="true">
        {(c.title || "C")[0]}
      </span>
    );
  const known = (v: unknown) => v !== null && v !== undefined;
  // Faceless from the thumbnails is a finding; from titles alone it's only a guess, so
  // "On camera" is shown only when the thumbnails were checked.
  const facelessTag = !known(c.facelessConfidence) ? "" : c.facelessConfidence >= 50 ? "Faceless" : c.facelessSource === "thumbnails" ? "On camera" : "";
  const tags = [c.niche, c.language && c.language.toUpperCase(), facelessTag].filter(Boolean);
  // Newest and most-viewed uploads; when they are the same video, the next best fills in.
  const recent = c.recentVideo;
  const best = c.bestVideo?.id !== recent?.id ? c.bestVideo : (c.videos || []).find((v: any) => v.id !== recent?.id);
  const video = (label: string, v: any) =>
    v && (
      <a className="maker-channel-card-video" href={v.url} target="_blank" rel="noreferrer" title={v.title}>
        <span>{v.thumbnailUrl && <img src={v.thumbnailUrl} alt="" loading="lazy" onError={(e) => (e.currentTarget.style.display = "none")} />}</span>
        <small>
          <b>{label}</b> · {compact(v.viewCount)} views · {ageLabel(v.publishedAt)}
        </small>
      </a>
    );
  return (
    <article className="maker-channel-card" data-selected={selected || undefined}>
      <div className="maker-channel-card-head">
        {avatar}
        <a className="maker-channel-card-name" href={c.url} target="_blank" rel="noreferrer">
          <strong>{c.title || "Channel"}</strong>
          <small>{c.handle || (Number.isFinite(Number(c.sampleCount)) ? `${c.sampleCount} videos sampled` : "")}</small>
        </a>
        <label className="maker-channel-card-check" title="Use as project evidence">
          <input type="checkbox" aria-label={`Select ${c.title || "this channel"}`} checked={selected} onChange={(e) => onSelect(e.target.checked)} />
        </label>
        <Action label={bookmarked ? "Remove bookmark" : "Bookmark channel"} className="maker-channel-card-mark" aria-pressed={bookmarked} onClick={onBookmark}>
          <Bookmark size={17} />
        </Action>
      </div>
      <ul className="maker-channel-card-stats">
        {known(c.subscribers) && (
          <li title="Subscribers">
            <Users size={13} />
            {compact(c.subscribers)}
          </li>
        )}
        <li title="Typical (median) views of recent uploads">
          <Eye size={13} />~{compact(c.medianViews)}
        </li>
        {known(c.videoCount) && (
          <li title="Videos on the channel">
            <Film size={13} />
            {compact(c.videoCount)}
          </li>
        )}
        {c.createdAt && (
          <li title={`Active since ${new Date(c.createdAt).toLocaleDateString([], { month: "short", year: "numeric" })}`}>
            <CalendarDays size={13} />
            {activeFor(c.createdAt)}
          </li>
        )}
        {c.monetization === "likely" && (
          <li className="is-money" title="Likely monetized: estimated from subscribers and recent watch time">
            <CircleDollarSign size={13} />
            Monetized
          </li>
        )}
      </ul>
      {tags.length > 0 && (
        <ul className="maker-channel-card-tags">
          {tags.map((tag) => (
            <li key={tag} title={tag === facelessTag ? c.facelessReason || (c.facelessSource === "titles" ? "Guessed from video titles" : undefined) : undefined}>
              {tag}
            </li>
          ))}
        </ul>
      )}
      {(recent || best) && (
        <div className="maker-channel-card-videos">
          {video("Recent", recent)}
          {video("Best", best)}
        </div>
      )}
      <div className="maker-channel-card-actions">
        <button className="maker-outline" onClick={onSimilar}>
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
    [copying, setCopying] = useState<Set<string>>(() => new Set()),
    [similar, setSimilar] = useState<{ title: string; previous: any; channel: any } | null>(null),
    [failed, setFailed] = useState(""),
    [shuffle, setShuffle] = useState(0),
    // The search the shown results belong to (the box can hold a newer, unsent one).
    [shownQuery, setShownQuery] = useState(query || "");
  const [collections, setCollections] = useState<any[]>([]),
    [collectionsLoaded, setCollectionsLoaded] = useState(false),
    [selected, setSelected] = useState<string[]>([]);
  // Only the latest search or similar lookup may show; starting one cancels the one before.
  const requestId = useRef(0);
  const inFlight = useRef<AbortController | null>(null);
  const begin = () => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    return { id: ++requestId.current, signal: controller.signal };
  };
  // The bookmarks collection is created once, even when two bookmarks land before it exists.
  const bookmarkCreate = useRef<Promise<string> | null>(null);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [draftFilters, setDraftFilters] = useState<Filters>(DEFAULT_FILTERS);
  const cacheKey = `autoyt-niche-feed-${accountId}`;
  const [shown, setShown] = useState(PAGE_SIZE);
  const endRef = useRef<HTMLDivElement | null>(null);
  const loadCollections = () =>
    creatorApi(`/api/maker/collections?accountId=${accountId}`).then((d) => {
      setCollections(d.collections || []);
      setCollectionsLoaded(true);
    });
  useEffect(() => {
    let cache: any = null;
    try {
      cache = JSON.parse(sessionStorage.getItem(cacheKey) || "null");
    } catch {}
    if (cache?.result && (!query || query === cache.search)) {
      setResult(cache.result);
      setFilters({ ...DEFAULT_FILTERS, ...(cache.filters || {}) });
      setSearch(cache.search || "");
      setShownQuery(cache.search || "");
      setSelected(cache.selected || []);
      setShuffle(Number(cache.shuffle) || 0);
    } else {
      // Results load on open: the linked search, or the feed across faceless niches.
      void scan(query || "");
    }
    void loadCollections().catch((e) => onError(e.message));
  }, [accountId]);
  useEffect(() => {
    if (result)
      try {
        sessionStorage.setItem(cacheKey, JSON.stringify({ result: storedResult(result), filters, search: shownQuery, selected, shuffle }));
      } catch {}
  }, [result, filters, shownQuery, selected, shuffle]);
  // Back and forward: the address names a search the page isn't showing, so run it.
  const routed = useRef(true);
  useEffect(() => {
    if (routed.current) {
      routed.current = false;
      return;
    }
    if ((query || "") !== shownQuery) {
      setSimilar(null);
      void scan(query || "", filters, shuffle, { link: false });
    }
  }, [query]);
  useEffect(() => () => inFlight.current?.abort(), []);
  const bookmarkCollection = collections.find((c) => c.data?.kind === "bookmarks");
  const bookmarks: any[] = bookmarkCollection?.data?.channels || [];
  const research = collections.filter((c) => c.data?.kind !== "bookmarks");
  // An empty search loads the feed: channels across several faceless niches.
  // A failed search keeps the results and address it had, and says what went wrong above them.
  async function scan(value = search, nextFilters = filters, nextShuffle = shuffle, { link = true } = {}) {
    value = value.trim();
    const { id, signal } = begin();
    setBusy(true);
    setFailed("");
    onError("");
    try {
      const data = await creatorApi(
        "/api/maker/discover",
        {
          accountId,
          query: value,
          shuffle: nextShuffle,
          publishedAfterDays: nextFilters.days,
          duration: nextFilters.duration,
          regionCode: nextFilters.region,
          filters: nextFilters,
        },
        undefined,
        { signal },
      );
      if (id !== requestId.current) return false;
      if (link) writeDeepLink({ view: "discover", discoveryQuery: value });
      setResult(data);
      setSearch(value);
      setShownQuery(value);
      setSimilar(null);
      setSelected([]);
      setShown(PAGE_SIZE);
      setTab("channels");
      return true;
    } catch (e) {
      if (signal.aborted || id !== requestId.current) return false;
      setFailed((e as Error).message || "Channels couldn't load. Try again.");
      return false;
    } finally {
      if (id === requestId.current) setBusy(false);
    }
  }
  async function toggleBookmark(c: any) {
    if (!collectionsLoaded) {
      toast.info("Your bookmarks are still loading. Try again in a moment.");
      return;
    }
    const exists = bookmarks.some((b) => b.id === c.id);
    const channels = exists ? bookmarks.filter((b) => b.id !== c.id) : [snapshotChannel(c), ...bookmarks];
    const data = { kind: "bookmarks", channels };
    setCollections((items) =>
      bookmarkCollection
        ? items.map((item) => (item.id === bookmarkCollection.id ? { ...item, data } : item))
        : [{ id: "pending-bookmarks", name: "Bookmarked channels", data }, ...items],
    );
    try {
      let id = bookmarkCollection && bookmarkCollection.id !== "pending-bookmarks" ? bookmarkCollection.id : "";
      if (!id && bookmarkCreate.current) id = await bookmarkCreate.current;
      if (id) await creatorApi(`/api/maker/collections/${id}`, { accountId, name: "Bookmarked channels", data }, "PUT");
      else {
        bookmarkCreate.current = creatorApi("/api/maker/collections", { accountId, name: "Bookmarked channels", data }).then((d) => String(d.id));
        await bookmarkCreate.current;
      }
      await loadCollections();
    } catch (e) {
      bookmarkCreate.current = null;
      onError((e as Error).message);
      void loadCollections().catch(() => {});
    }
  }
  async function copyStyle(c: any) {
    setCopying((set) => new Set(set).add(c.id));
    try {
      await creatorApi("/api/channel-styles/copy", { accountId, sourceUrl: c.url, niche: c.niche || shownQuery });
      toast.success(`Copied ${c.title || "this channel"}'s style.`, { action: { label: "Open Styles", onClick: () => writeDeepLink({ view: "styles" }) } });
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setCopying((set) => {
        const next = new Set(set);
        next.delete(c.id);
        return next;
      });
    }
  }
  async function findSimilar(c: any, nextFilters = filters) {
    const previous = similar?.previous || { result, search: shownQuery };
    const { id, signal } = begin();
    setBusy(true);
    setFailed("");
    onError("");
    try {
      const titles = (c.videos?.length ? c.videos : [c.bestVideo, c.recentVideo]).filter(Boolean).map((v: any) => v.title);
      const data = await creatorApi(
        "/api/maker/similar",
        { accountId, channel: { id: c.id, title: c.title, niche: c.niche, titles }, filters: nextFilters },
        undefined,
        { signal },
      );
      if (id !== requestId.current) return;
      setResult(data);
      setSearch(data.query);
      setShownQuery(data.query);
      setSelected([]);
      setShown(PAGE_SIZE);
      setTab("channels");
      writeDeepLink({ view: "discover", discoveryQuery: data.query });
      setSimilar({ title: c.title, previous, channel: c });
    } catch (e) {
      if (signal.aborted || id !== requestId.current) return;
      setFailed((e as Error).message || "Similar channels couldn't load. Try again.");
    } finally {
      if (id === requestId.current) setBusy(false);
    }
  }
  // Days, length and region change what YouTube is asked, so they search again, in the feed
  // too; while showing similar channels, the similar lookup runs again with them.
  function applyFilters(next: Filters) {
    // Switching to "Discovery" asks the server for its ranked order (cached, so it's quick).
    const serverChanged = SERVER_FILTERS.some((key) => next[key] !== filters[key]) || (next.sort === "score" && filters.sort !== "score" && !result?.reranked);
    setFilters(next);
    setFilterOpen(false);
    if (!serverChanged || !result) return;
    if (similar) void findSimilar(similar.channel, next);
    else void scan(shownQuery, next);
  }
  const clearAll = () => applyFilters({ ...EMPTY_FILTERS, sort: filters.sort });
  // Filters apply instantly on the client. "Discovery" keeps the server's ranking, which
  // weighs fit to the niche and repeatable breakouts.
  // A pasted channel link asks about that one channel, so the niche filters (faceless, long form,
  // size) don't hide it.
  const ranked = rankDiscoveryChannels(result?.videos || [], result?.pasted ? { sort: filters.sort } : filters);
  const serverOrder = new Map<string, number>((result?.channels || []).map((c: any, i: number) => [c.id, i]));
  const channels = filters.sort === "score" && result?.reranked && serverOrder.size
    ? [...ranked].sort((a: any, b: any) => (serverOrder.get(a.id) ?? 1e6) - (serverOrder.get(b.id) ?? 1e6))
    : ranked;
  const visible = channels.slice(0, shown);
  useEffect(() => {
    const node = endRef.current;
    if (!node || shown >= channels.length) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setShown((n) => n + PAGE_SIZE);
    }, { rootMargin: "400px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [shown, channels.length, tab]);
  const chips = activeFilterChips(filters);
  async function createFromSelection() {
    try {
      const evidence = channels.filter((c: any) => selected.includes(c.id));
      await createProject(accountId, {
        title: shownQuery ? `${shownQuery[0].toUpperCase()}${shownQuery.slice(1)} video` : "Research project",
        createdFrom: "discovery",
        brief: `Create an original video about ${shownQuery || evidence.map((c: any) => c.niche).filter(Boolean)[0] || "this niche"}.\nResearch references:\n${evidence
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
      copying={copying.has(c.id)}
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
                    inFlight.current?.abort();
                    requestId.current += 1;
                    setBusy(false);
                    setFailed("");
                    setResult(similar.previous.result);
                    setSearch(similar.previous.search);
                    setShownQuery(similar.previous.search);
                    writeDeepLink({ view: "discover", discoveryQuery: similar.previous.search });
                    setSimilar(null);
                  }}
                >
                  <ChevronLeft size={14} />
                  Back to search
                </button>
              </span>
            ) : (
              "Channels finding an audience on YouTube. Search a niche or paste a channel link."
            )
          }
        />
        <form
          className="maker-searchbar"
          onSubmit={(e) => {
            e.preventDefault();
            void scan();
          }}
        >
          <Search size={18} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search a niche or paste a channel link, or leave empty to browse"
            aria-label="Niche or channel"
          />
          <Action
            label="Shuffle niches"
            disabled={busy}
            onClick={() => {
              const next = shuffle + 1;
              setShuffle(next);
              void scan("", filters, next);
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
                  onClick={() => applyFilters({ ...filters, [key]: EMPTY_FILTERS[key] })}
                >
                  <X size={12} />
                </button>
              </span>
            ))}
            <button className="maker-link" onClick={clearAll}>
              Clear all
            </button>
          </div>
        )}
        <div className="maker-filterbar">
          <Segmented
            label="Results"
            value={tab}
            onChange={(next) => setTab(next as typeof tab)}
            options={[
              { value: "channels", label: "Channels" },
              { value: "videos", label: "Videos" },
              { value: "bookmarks", label: "Bookmarks", hint: bookmarks.length ? String(bookmarks.length) : undefined },
              { value: "saved", label: "Collections", hint: research.length ? String(research.length) : undefined },
            ]}
          />
          <div className="maker-niche-presets" role="group" aria-label="Presets">
            <span>Presets</span>
            {NICHE_PRESETS.map((preset) => (
              <button
                key={preset.label}
                className="maker-outline"
                disabled={busy}
                onClick={() => {
                  const next = { ...filters, ...preset.filters };
                  setFilters(next);
                  void scan(preset.query, next);
                }}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <label className="maker-sort">
            Sort by
            <select
              aria-label="Sort channels"
              value={filters.sort}
              onChange={(e) => applyFilters({ ...filters, sort: e.target.value })}
            >
              {[
                ["created", "Recency (newest channel)"],
                ["medianViews", "Typical views"],
                ["averageViews", "Average views"],
                ["subscribers", "Subscribers"],
                ["consistency", "Consistency (uploads a month)"],
                ["ratio", "Views per subscriber"],
                ["newest", "Latest upload"],
                ["score", "Discovery"],
              ].map(([v, l]) => (
                <option value={v} key={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
        </div>
        {failed && result && !busy ? (
          <div className="maker-niche-error" role="alert">
            <AlertCircle size={16} aria-hidden="true" />
            <span>{failed} The results below are from your last search.</span>
            <button className="maker-outline" onClick={() => (similar ? void findSimilar(similar.channel) : void scan())}>
              <RefreshCw size={14} />
              Try again
            </button>
          </div>
        ) : null}
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
                      inFlight.current?.abort();
                      requestId.current += 1;
                      setBusy(false);
                      setFailed("");
                      setResult(c.data.result);
                      setSearch(c.data.search);
                      setShownQuery(c.data.search || "");
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
                      if (!(await confirmDialog({ title: `Delete “${c.name}”?`, body: "The saved channels and filters in this collection are removed. This can't be undone.", confirmLabel: "Delete collection", danger: true }))) return;
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
            title={failed ? "Channels couldn't load" : "Find your next niche"}
            text={failed || "Search a topic, paste a channel, or browse channels across faceless niches."}
          >
            <button className="maker-outline" onClick={() => void scan()}>
              <RefreshCw size={15} />
              {failed ? "Try again" : "Browse channels"}
            </button>
          </Empty>
        ) : tab === "channels" ? (
          <>
            <div className="maker-result-summary">
              <span>
                {channels.length} {channels.length === 1 ? "channel" : "channels"}
                {!result.query && result.niches?.length ? ` across ${result.niches.join(", ")}` : ""} · {result.videos?.length || 0} videos analyzed
                {result.sampledAt ? ` · sampled ${new Date(result.sampledAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}
                {(ranked as { hiddenSubscribersExcluded?: number }).hiddenSubscribersExcluded ? ` · ${(ranked as { hiddenSubscribersExcluded?: number }).hiddenSubscribersExcluded} left out for hiding their subscriber count` : ""}
              </span>
              <span>Faceless and monetized are estimates</span>
            </div>
            {channels.length ? (
              <>
                <div className="maker-channel-grid">{visible.map(card)}</div>
                <div ref={endRef} className="maker-niche-end">
                  {shown < channels.length ? <Loader2 size={16} className="animate-spin" aria-label="Loading more channels" /> : "No more channels to load"}
                </div>
              </>
            ) : (
              (() => {
                const found = rankDiscoveryChannels(result.videos || [], { sort: filters.sort }).length;
                return found ? (
                  <Empty
                    title="No channels match these filters"
                    text={`${found} ${found === 1 ? "channel was" : "channels were"} found, but your filters hide all of them. Remove a filter or clear them all.`}
                  >
                    <button className="maker-outline" onClick={clearAll}>
                      Clear filters
                    </button>
                  </Empty>
                ) : (
                  <Empty title="No channels found" text="YouTube returned no channels for this search. Try another niche or shuffle." />
                );
              })()
            )}
          </>
        ) : (
          <div className="maker-video-grid">
            {channels
              .flatMap((c: any) => (c.videos || []).map((v: any) => ({ ...v, channelTitle: v.channelTitle || c.title })))
              .sort((a: any, b: any) => (Number(b.viewCount) || 0) - (Number(a.viewCount) || 0))
              .map((v: any) => (
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
              disabled={!selected.length}
              title={selected.length ? undefined : "Select channels first"}
              onClick={async () => {
                try {
                  await creatorApi("/api/maker/collections", {
                    accountId,
                    name: (shownQuery || `Niche feed: ${(result.niches || []).join(", ")}`).slice(0, 120),
                    data: { result: storedResult(result, selected), filters, search: shownQuery, selected },
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
            <button className="maker-primary" disabled={!selected.length} title={selected.length ? undefined : "Select channels first"} onClick={() => void createFromSelection()}>
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
  const excluded = f.excludeTerms.split(",").map((t) => t.trim()).filter(Boolean);
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
            <select value={f.duration} onChange={(e) => set({ duration: e.target.value, ...(e.target.value === "short" && f.format === "longform" ? { format: "any" } : {}) })}>
              <option value="any">All lengths</option>
              <option value="short">Under 4 minutes</option>
              <option value="medium">4–20 minutes</option>
              <option value="long">20+ minutes</option>
            </select>
          </label>
          <label className="maker-field">
            Content type
            <select value={f.format} onChange={(e) => set({ format: e.target.value, ...(e.target.value === "longform" && f.duration === "short" ? { duration: "any" } : {}) })}>
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
            <select value={f.language} onChange={(e) => set({ language: e.target.value })}>
              <option value="">Any language</option>
              {LANGUAGES.map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </select>
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
        <Switch className="maker-switch-row maker-filter-switch" compact checked={f.faceless} onChange={(on) => set({ faceless: on })} label="Faceless channels only" />
        <Switch className="maker-switch-row maker-filter-switch" compact checked={f.monetized} onChange={(on) => set({ monetized: on })} label="Monetized channels only (estimated)" />
      </section>
      <section>
        <h3>Channel recency</h3>
        <p className="maker-filter-note">When the channel started posting: its first upload, or the date it was created when it has too many videos to check.</p>
        <div className="maker-grid-2">
          <label className="maker-field">
            From
            <input type="date" value={f.createdAfter} max={f.createdBefore || undefined} onChange={(e) => set({ createdAfter: e.target.value })} />
          </label>
          <label className="maker-field">
            To
            <input type="date" value={f.createdBefore} min={f.createdAfter || undefined} onChange={(e) => set({ createdBefore: e.target.value })} />
          </label>
        </div>
        <div className="maker-chips">
          {[
            [90, "Last 3 months"],
            [180, "Last 6 months"],
            [365, "Last year"],
          ].map(([days, label]) => (
            <button key={days} type="button" className="maker-chip" aria-pressed={f.createdAfter === daysAgo(days as number)} onClick={() => set({ createdAfter: daysAgo(days as number), createdBefore: "" })}>
              {label}
            </button>
          ))}
        </div>
      </section>
      <section>
        <h3>View statistics</h3>
        <p className="maker-filter-note">Typical views is the median of a channel's latest uploads. Average views get pulled up by a single viral hit.</p>
        <div className="maker-grid-4">
          {num("minViews", "Min typical views")}
          {num("maxViews", "Max typical views")}
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
          {num("minDurationMinutes", "Min video length (min)")}
          {num("maxDurationMinutes", "Max video length (min)")}
        </div>
      </section>
      <section>
        <h3>Niches</h3>
        <label className="maker-field">
          Include terms
          <input value={f.includeTerms} placeholder="anime, history" onChange={(e) => set({ includeTerms: e.target.value })} />
        </label>
        <label className="maker-field">
          Excluded niches
          <input
            placeholder="Type a niche and press Enter"
            onKeyDown={(e) => {
              const value = e.currentTarget.value.trim().toLowerCase().replace(/,/g, "");
              if (e.key !== "Enter" || !value) return;
              e.preventDefault();
              if (!excluded.includes(value)) set({ excludeTerms: [...excluded, value].join(", ") });
              e.currentTarget.value = "";
            }}
          />
        </label>
        {excluded.length > 0 && (
          <div className="maker-excluded">
            {excluded.map((term) => (
              <span className="maker-chip" key={term}>
                {term}
                <button type="button" aria-label={`Stop excluding ${term}`} onClick={() => set({ excludeTerms: excluded.filter((t) => t !== term).join(", ") })}>
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        )}
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
              if (!(await confirmDialog({ title: `Delete the “${s.name}” style?`, body: "Projects that used it keep their settings.", confirmLabel: "Delete style", danger: true }))) return;
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
          <div className="maker-field">
            <span>Language</span>
            <LanguagePicker
              value={settings.language || "en"}
              only={["en", "es", "fr", "de", "it", "pt", "ja", "ko", "zh", "hi", "sw"]}
              onChange={(language) => setSettings({ ...settings, language })}
            />
          </div>
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
                "Analyze three reference transcripts to learn hooks, pacing, and structure. Each video is transcribed automatically."}
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
/** The one art style chooser: preview tiles for the presets and any custom styles. */
export function ArtStylePicker({
  presets,
  customs = [],
  value,
  onChange,
  onCreate,
  onDelete,
  required = false,
}: {
  presets: ArtStyle[];
  customs?: ArtStyle[];
  value: string;
  onChange: (id: string) => void;
  onCreate?: () => void;
  onDelete?: (style: ArtStyle) => void;
  /** Picking the selected tile again keeps it instead of clearing the choice. */
  required?: boolean;
}) {
  const pick = (id: string) => onChange(value === id && !required ? "" : id);
  return (
    <div className="maker-art-grid" role="radiogroup" aria-label="Art style">
      {onCreate ? (
        <button type="button" className="maker-art-tile is-create" onClick={onCreate}>
          <span className="maker-art-swatch">
            <Plus size={20} />
          </span>
          <strong>Custom style</strong>
          <small>From your frames</small>
        </button>
      ) : null}
      {customs.map((style) => (
        <div key={style.id} className="maker-art-tile-wrap">
          <button
            type="button"
            role="radio"
            aria-checked={value === style.id}
            className="maker-art-tile"
            onClick={() => pick(style.id)}
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
          {onDelete ? (
            <Action label={`Delete ${style.name}`} className="maker-icon maker-art-delete" onClick={() => onDelete(style)}>
              <X size={14} />
            </Action>
          ) : null}
        </div>
      ))}
      {presets.map((style) => (
        <button
          key={style.id}
          type="button"
          role="radio"
          aria-checked={value === style.id}
          className="maker-art-tile"
          onClick={() => pick(style.id)}
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
/**
 * A compact "Look" button showing the chosen art style; it opens the same
 * tile grid in a pop-up. For places too tight for the grid itself.
 */
export function ArtStyleButton({ value, onChange, auto = false, label = "Look", className = "" }: { value: string; onChange: (id: string) => void; auto?: boolean; label?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const presets = ART_STYLE_PRESETS as ArtStyle[];
  const current = presets.find((style) => style.id === value);
  return (
    <>
      <button type="button" className={`maker-art-button ${className}`} onClick={() => setOpen(true)} aria-haspopup="dialog">
        <span className="maker-art-button-thumb" aria-hidden="true">{current?.preview ? <img src={current.preview} alt="" /> : <Sparkles size={13} />}</span>
        {label ? <span className="maker-art-button-label">{label}</span> : null}
        <strong>{current?.name || (auto ? "Auto" : "Choose")}</strong>
        <ChevronDown size={13} aria-hidden="true" />
      </button>
      {open && (
        <Modal title="Choose a look" wide onClose={() => setOpen(false)}>
          {auto ? (
            <button type="button" className={`maker-art-auto ${!value ? "is-on" : ""}`} onClick={() => { onChange(""); setOpen(false); }}>
              <Sparkles size={15} /> Auto: pick the look from the idea
            </button>
          ) : null}
          <ArtStylePicker presets={presets} value={value} required onChange={(id) => { onChange(id); setOpen(false); }} />
        </Modal>
      )}
    </>
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
    [busy, setBusy] = useState(false),
    [problem, setProblem] = useState("");
  useErrorToast(problem, () => setProblem(""));
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
        <Segmented
          label="Style source"
          block
          value={mode}
          onChange={(next) => setMode(next as typeof mode)}
          options={[
            { value: "video", label: "Sample video", icon: <Clapperboard size={16} /> },
            { value: "frames", label: "Reference images", icon: <ImagePlus size={16} /> },
          ]}
        />
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
              <Switch className="maker-switch-row maker-rights-confirm" compact checked={rightsConfirmed} onChange={(on) => setRightsConfirmed(on)} label="I own this sample or have permission to analyze it" />
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
              <FileDrop
                className="maker-art-drop"
                multiple
                accept="image/png,image/jpeg,image/webp"
                onFiles={(files) => add(files)}
                title="Add images"
                hint="PNG, JPEG, or WebP"
                icon={<ImagePlus size={20} />}
              />
            )}
          </div>
          </>}
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
  cast: Array<{ id: string; name: string; role?: string; appearance: string; outfit: string; approvedReferences: string[] }>;
  objects: StoryObject[];
};
const emptyVisualBible = (): VisualBible => ({
  version: 1,
  locked: true,
  consistency: true,
  artDirection: { palette: "", lighting: "", camera: "", texture: "", negative: "" },
  cast: [],
  objects: [],
});
// The locked art direction the scene prompts follow; characters have their own step.
function ArtDirectionPanel({ value, onChange }: { value: VisualBible; onChange: (value: VisualBible) => void }) {
  return (
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
  );
}

type MakerPrices = { imageUsd: number | null; video: Record<string, { name: string; usdPerSecond: number | null; durations: number[] }> };
// The clip length a scene animates at: the model's shortest supported length that covers the
// scene (the same rule the server uses), or 4 to 10 seconds when the model's lengths are unknown.
function clipSecondsFor(durations: number[], length: number) {
  const want = Math.max(1, Math.ceil(Number(length) || 0));
  if (durations.length) return durations.find((d) => d >= want) ?? durations[durations.length - 1];
  return Math.min(10, Math.max(4, want));
}
/* Visual segments: split the narration at sentence breaks and give each part its own settings. */
const QUALITY_OPTIONS: Array<[string, string]> = [
  ["standard", "Standard · 1K"],
  ["high", "High · 2K"],
  ["ultra", "Ultra · 4K"],
];
/** Delivery format, visual playbook, and image quality: one control set wherever a project sets them. */
function DeliverySettings({ settings, editSetting, imageCredits }: { settings: any; editSetting: (patch: Record<string, unknown>) => void; imageCredits?: number }) {
  const profileId = settings.productionProfile || PRODUCTION_PROFILES.find((item) => item.aspect === settings.aspect)?.id || "youtube-landscape";
  const playbookId = settings.productionPlaybook || "clean-professional";
  return (
    <>
      <div className="maker-field">
        <span>Format</span>
        <div className="maker-presets">
          {PRODUCTION_PROFILES.map((profile) => (
            <button key={profile.id} type="button" aria-pressed={profileId === profile.id} title={profile.aspect} onClick={() => editSetting({ productionProfile: profile.id, aspect: profile.aspect })}>
              {profile.name}
            </button>
          ))}
        </div>
      </div>
      <label className="maker-field">
        Visual playbook
        <select value={playbookId} onChange={(e) => editSetting({ productionPlaybook: e.target.value })}>
          {PRODUCTION_PLAYBOOKS.map((playbook) => <option key={playbook.id} value={playbook.id}>{playbook.name}</option>)}
        </select>
        <small>{PRODUCTION_PLAYBOOKS.find((playbook) => playbook.id === playbookId)?.description}</small>
      </label>
      <div className="maker-field">
        <span>Image quality</span>
        <div className="maker-presets">
          {QUALITY_OPTIONS.map(([value, label]) => (
            <button key={value} type="button" aria-pressed={(settings.quality || "standard") === value} onClick={() => editSetting({ quality: value })}>
              {label}
            </button>
          ))}
        </div>
        {imageCredits ? <small>~{Math.ceil(imageCredits).toLocaleString()} credits an image at any quality</small> : null}
      </div>
    </>
  );
}
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
        <span className="maker-tile-switch" title={animation?.available ? "" : animation?.reason}>
          <Switch
            checked={Boolean(current.animate)}
            onChange={(on) => update({ animate: on })}
            label={<>Animate<span className="sr-only">{segments.length > 1 ? ` segment ${index + 1}` : " the whole video"}</span></>}
            description={animation?.available ? "Image-to-video for every scene in this part" : animation?.reason || "Checking scene animation"}
            disabled={!animation?.available}
          />
        </span>
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
  onPreview,
}: {
  segments: any[];
  duration: number;
  boundaries: number[];
  onChange: (segments: any[]) => void;
  /** Plays the composed soundtrack under the narration from this time. */
  onPreview?: (start: number) => void;
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
                {onPreview ? (
                  <Action label={`Preview segment ${i + 1} with narration`} onClick={() => onPreview(segment.start)}>
                    <Play size={14} />
                  </Action>
                ) : null}
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
// The one editor: a project's video is cut in Vibe Edit (loaded when first opened), inside this page.
const VibeEdit = lazyPage(() => import("./vibe/VibeEdit"));

/** The project's own edit, embedded: built from the storyboard the first time, opened as it was left after that.
 *  When the storyboard has changed since, it asks first: bring the new media in (keeping the cuts), start over,
 *  or open it as it was. Its export becomes the project's video. */
export function ProjectVibeEdit({ endpoint, accountId, theme, backLabel, onBack, what = "storyboard" }: { endpoint: string; accountId: string; theme: "light" | "dark"; backLabel: string; onBack: () => void; what?: string }) {
  const [state, setState] = useState<{ editId: string; stale: boolean } | null>(null);
  const [error, setError] = useState("");
  const [working, setWorking] = useState("");
  const open = async (mode: "" | "refresh" | "rebuild" = "") => {
    setWorking(mode || "open");
    setError("");
    try {
      const data = await creatorApi(endpoint, { accountId, ...(mode ? { [mode]: true } : {}) });
      setState({ editId: data.projectId, stale: Boolean(data.stale) && !mode });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setWorking("");
    }
  };
  useEffect(() => {
    void open();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpoint]);
  if (error) {
    return (
      <div className="maker-vibe-gate" role="alert">
        <strong>The editor didn't open</strong>
        <p>{error}</p>
        <div className="maker-vibe-gate-actions">
          <button className="maker-outline" onClick={onBack}>Back to the {backLabel.toLowerCase()}</button>
          <button className="maker-primary" onClick={() => void open()}>Try again</button>
        </div>
      </div>
    );
  }
  if (!state || working) {
    return <div className="maker-vibe-gate"><Loader2 size={18} className="animate-spin" />{working === "rebuild" ? `Building the edit from your ${what}…` : working === "refresh" ? "Bringing in the new media…" : "Opening your edit…"}</div>;
  }
  if (state.stale) {
    return (
      <div className="maker-vibe-gate">
        <strong>Your {what} changed since you last edited</strong>
        <p>Bring the new pictures, clips, and sound into your edit and keep your cuts, titles, and captions, or start the edit over from the {what}.</p>
        <div className="maker-vibe-gate-actions">
          <button className="maker-primary" onClick={() => void open("refresh")}>Bring in the new media</button>
          <button className="maker-outline" onClick={() => void open("rebuild")}>Start over from the {what}</button>
          <button className="maker-link" onClick={() => setState({ ...state, stale: false })}>Open it as it was</button>
        </div>
      </div>
    );
  }
  return (
    <div className="maker-vibe-embed">
      <Suspense fallback={<div className="maker-vibe-gate"><Loader2 size={18} className="animate-spin" />Opening your edit…</div>}>
        <VibeEdit theme={theme} projectId={state.editId} embedded={{ backLabel, onBack }} />
      </Suspense>
    </div>
  );
}

function ProjectEditor({
  id,
  stage,
  initialSceneId,
  accountId,
  theme,
  onError,
}: {
  id: string;
  stage: string;
  initialSceneId?: string;
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
    [channelStyles, setChannelStyles] = useState<ChannelStyle[]>([]),
    [scriptText, setScriptText] = useState<string | null>(null),
    [titleText, setTitleText] = useState<string | null>(null),
    narrationInput = useRef<HTMLInputElement | null>(null),
    [confirm, setConfirm] = useState<any>(null),
    [cardScene, setCardScene] = useState(""),
    [overlayScene, setOverlayScene] = useState(""),
    [handingOff, setHandingOff] = useState(false),
    [archiveOpen, setArchiveOpen] = useState(false),
    [selectedScene, setSelectedScene] = useState(""),
    // Review's "open the editor" lands here (the stage change can remount this page), via a one-shot flag.
    [visualView, setVisualView] = useState<"settings" | "cast" | "scenes" | "edit" | "">(() => {
      try {
        if (sessionStorage.getItem(`maker-open-edit:${id}`) !== "1") return "";
        sessionStorage.removeItem(`maker-open-edit:${id}`);
        return "edit";
      } catch {
        return "";
      }
    }),
    [visualTab, setVisualTab] = useState<"style" | "timing" | "output">("style"),
    [suggesting, setSuggesting] = useState(false),
    [suggestingObjects, setSuggestingObjects] = useState(false),
    [sceneFilter, setSceneFilter] = useState<"all" | "missing" | "ready" | "failed" | "animated">("all"),
    [boardQuery, setBoardQuery] = useState(""),
    [boardSize, setBoardSize] = useState<BoardSize>(readBoardSize),
    [promptEditing, setPromptEditing] = useState(""),
    [sceneEditor, setSceneEditor] = useState(Boolean(initialSceneId)),
    [advanced, setAdvanced] = useState(false),
    [copied, setCopied] = useState(false),
    [animation, setAnimation] = useState<{ available: boolean; reason: string; model: string; models?: string[]; provider?: string } | null>(null),
    [prices, setPrices] = useState<MakerPrices | null>(null),
    [music, setMusic] = useState<{ available: boolean; reason: string; model: string; provider: string } | null>(null),
    [media, setMedia] = useState<{ available: boolean; reason: string } | null>(null),
    [stock, setStock] = useState<{ available: boolean; reason: string; providers?: string[] } | null>(null),
    [artStyles, setArtStyles] = useState<{ presets: ArtStyle[]; styles: ArtStyle[] }>({ presets: [], styles: [] }),
    [artModal, setArtModal] = useState(false),
    [thumbUrl, setThumbUrl] = useState(""),
    [thumbMode, setThumbMode] = useState<"channel" | "reference" | "scratch" | "">(""),
    [animOptions, setAnimOptions] = useState<{ model: string; fixedCamera: boolean }>({ model: "", fixedCamera: false }),
    [imaging, setImaging] = useState<{ available: boolean; reason: string; model: string } | null>(null),
    [billingPricing, setBillingPricing] = useState<{ flatTokens: Record<string, number>; tokensPerCredit: number; tokensPerUsd?: number }>({ flatTokens: { image: 60000, video: 750000, speech: 3000, music: 150000, default: 10000 }, tokensPerCredit: 100 });
  const timelineAudio = useRef<HTMLAudioElement>(null);
  // A found-footage style template locks the camera by default.
  useEffect(() => {
    if (project?.metadata?.settings?.fixedCamera) setAnimOptions((current) => ({ ...current, fixedCamera: true }));
  }, [project?.id]);
  // Plays one storyboard scene with its narration (cards and the scene popup).
  const scenePlayback = useScenePlayback(project?.outputs?.voiceover?.asset || null);
  const mixPreview = useRef<MixPreviewHandle>(null);
  const stopScenePlayback = scenePlayback.stop;
  useEffect(() => {
    stopScenePlayback();
  }, [stage, visualView, sceneEditor, selectedScene, stopScenePlayback]);
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
  // Character sheets generate in the background; announce when each run finishes.
  const sheetStatus = useRef<Record<string, string>>({});
  useEffect(() => {
    const sheets = ((project?.metadata as any)?.castSheets || {}) as Record<string, CastSheetState>;
    const cast: any[] = project?.metadata?.settings?.visualBible?.cast || [];
    for (const [castId, entry] of Object.entries(sheets)) {
      const before = sheetStatus.current[castId];
      const name = cast.find((item) => item.id === castId)?.name || "Character";
      if (before === "running" && entry.status === "ready")
        toast.success(entry.error ? `${name}'s sheets are ready. ${entry.error}` : `${name}'s sheets are ready. Pick one and lock it.`);
      if (before === "running" && entry.status === "failed") toast.error(entry.error || "Try again.", { title: `${name}'s sheets failed` });
      sheetStatus.current[castId] = entry.status || "";
    }
    const objectSheets = ((project?.metadata as any)?.objectSheets || {}) as Record<string, CastSheetState>;
    const objects: any[] = project?.metadata?.settings?.visualBible?.objects || [];
    for (const [objectId, entry] of Object.entries(objectSheets)) {
      const key = `object:${objectId}`;
      const before = sheetStatus.current[key];
      const name = objects.find((item) => item.id === objectId)?.name || "Object";
      if (before === "running" && entry.status === "ready")
        toast.success(entry.error ? `${name}'s sheets are ready. ${entry.error}` : `${name}'s sheets are ready. Pick one and lock it.`);
      if (before === "running" && entry.status === "failed") toast.error(entry.error || "Try again.", { title: `${name}'s sheets failed` });
      sheetStatus.current[key] = entry.status || "";
    }
  }, [project]);
  // A stage job that fails is announced once as a toast: when it fails while the
  // project is open, or on arrival if it is this stage's newest job and failed
  // within the last half hour. Old failures from other stages stay quiet.
  const jobSeen = useRef<Record<string, string>>({});
  useEffect(() => {
    const newest = new Map<string, Job>();
    for (const job of jobs) if (!newest.has(job.stage)) newest.set(job.stage, job);
    const seen = jobSeen.current;
    for (const job of jobs) {
      const before = seen[job.id];
      seen[job.id] = job.status;
      if (job.status !== "failed" || announcedFailures.has(job.id)) continue;
      const watched = before === "queued" || before === "running";
      const fresh = !before && newest.get(job.stage) === job && job.stage === currentStage && Date.now() - Number(job.createdAt || 0) < 30 * 60 * 1000;
      if (!watched && !fresh) continue;
      announcedFailures.add(job.id);
      const label = stages.find(([key]) => key === job.stage)?.[1] || "This step";
      toast.error(job.error || "Try again.", { title: `${label} failed` });
    }
  }, [jobs]);
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
        setPrices(data.prices || null);
        setImaging(data.images || null);
        setMusic(data.music || null);
        setMedia(data.media || null);
        setStock(data.stock || null);
      })
      .catch(() => {});
    void fetch("/api/billing/me", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((data) => {
        if (data?.pricing?.flatTokens) setBillingPricing({ flatTokens: data.pricing.flatTokens, tokensPerCredit: Number(data.pricing.tokensPerCredit) || 100, tokensPerUsd: Number(data.pricing.tokensPerUsd) || undefined });
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
    void creatorApi(`/api/channel-styles?accountId=${encodeURIComponent(accountId)}`)
      .then((data) => {
        setChannelStyles(data.styles || []);
        setStyleName((data.styles || []).find((s: ChannelStyle) => s.id === project?.styleId)?.name || "");
      })
      .catch(() => {});
  }, [project?.styleId, accountId]);
  // Saves one change outside the current stage's draft (the style, the title, or the
  // script from another tab), against the latest project version.
  async function patchProject(change: Record<string, unknown>) {
    if (dirty && !(await save())) return false;
    setBusy(true);
    try {
      const latest = await creatorApi(`/api/maker/projects/${id}`);
      const data = await creatorApi(`/api/maker/projects/${id}`, { ...change, accountId, expectedVersion: latest.project.version || 1 }, "PATCH");
      setProject(data.project);
      return true;
    } catch (e) {
      onError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function uploadNarration(file: File | null) {
    if (dirty && !(await save())) return;
    if (file && file.size > 70 * 1024 * 1024) return onError("Choose an audio or video file smaller than 70 MB");
    setBusy(true);
    try {
      const data = await creatorApi(`/api/maker/projects/${id}/narration-upload`, {
        ...(file ? { media: await readFile(file), name: file.name } : { clear: true }),
        accountId,
        expectedVersion: project?.version || 1,
      });
      setProject(data.project);
      if (data.job) setJobs((items) => [data.job, ...items.filter((j) => j.id !== data.job.id)]);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
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
      const body = (version: number) => ({
        ...(currentStage === "brief"
          ? value
          : readOnlyOutput
            ? {}
            : { outputStage: currentStage, output: value }),
        settings,
        accountId,
        expectedVersion: version,
      });
      let data;
      try {
        data = await creatorApi(`/api/maker/projects/${id}`, body(project?.version || 1), "PATCH");
      } catch (e) {
        // Background work (character sheets, progress) bumps the version without
        // touching what this save edits. Retry once when nothing we edit changed.
        if ((e as Error & { status?: number }).status !== 409 || !project) throw e;
        const latest = await creatorApi(`/api/maker/projects/${id}`);
        const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
        if (
          !same(latest.project.outputs?.[currentStage], project.outputs?.[currentStage]) ||
          !same(latest.project.metadata?.settings, project.metadata?.settings) ||
          latest.project.title !== project.title
        ) {
          setProject(latest.project);
          throw e;
        }
        data = await creatorApi(`/api/maker/projects/${id}`, body(latest.project.version || 1), "PATCH");
      }
      setDirty(false);
      dirtyRef.current = false;
      setProject(data.project);
      return true;
    } catch (e) {
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
  async function openInVibeEdit() {
    setHandingOff(true);
    try {
      if (dirty && !(await save())) return;
      // The project's own edit lives in the Visuals stage's editor.
      try {
        sessionStorage.setItem(`maker-open-edit:${id}`, "1");
      } catch {}
      setVisualView("edit");
      await navigate("visualPlan");
    } finally {
      setHandingOff(false);
    }
  }
  async function runQualityReview() {
    if (dirty && !(await save())) return;
    setBusy(true);
    try {
      const data = await creatorApi(`/api/maker/projects/${id}/quality-review`, {
        accountId,
        profileId: settings.productionProfile || settings.aspect || "youtube-landscape",
        playbookId: settings.productionPlaybook || "clean-professional",
      });
      if (data.project) setProject(data.project);
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
    if (kind === "audio" && !(await confirmDialog({ title: "Do you have the rights to this music?", body: "Only use music you own or have permission to use.", confirmLabel: "I have the rights" }))) return;
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
  // Uses the creator's own picture for one scene: upload it as a reference asset,
  // then point the scene's image at it (the server accepts reference assets as scene images).
  async function applyOwnSceneImage(sceneId: string, file: File | undefined) {
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) return onError("Choose a PNG, JPEG, or WebP image");
    if (file.size > 15 * 1024 * 1024) return onError("Choose an image smaller than 15 MB");
    if (dirty && !(await save())) return;
    setBusy(true);
    try {
      const uploaded = await creatorApi(`/api/maker/projects/${id}/reference-assets`, { image: await readFile(file), mediaType: file.type, accountId });
      const assets: string[] = uploaded.project.metadata.referenceAssets || [];
      const asset = assets[assets.length - 1];
      const plan = uploaded.project.outputs.visualPlan || {};
      const nextScenes = (plan.scenes || []).map((scene: any) =>
        scene.id === sceneId ? { ...scene, asset, clip: null, sourcePolicy: "upload", referenceAsset: asset } : scene,
      );
      const data = await creatorApi(
        `/api/maker/projects/${id}`,
        { outputStage: "visualPlan", output: { ...plan, scenes: nextScenes }, settings, accountId, expectedVersion: uploaded.project.version },
        "PATCH",
      );
      setProject(data.project);
      setDraft(structuredClone(data.project.outputs.visualPlan || {}));
      setDirty(false);
      dirtyRef.current = false;
      const number = nextScenes.findIndex((scene: any) => scene.id === sceneId) + 1;
      toast.success(`Scene ${number} now uses your image`);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function editBible(patch: Partial<VisualBible>) {
    editSetting({ visualBible: { ...bible, ...patch, version: (Number(bible.version) || 1) + 1 } });
  }
  // Reads the script and adds the recurring characters it finds to the visual bible.
  async function suggestCast() {
    if (dirty && !(await save())) return;
    setSuggesting(true);
    try {
      const data = await creatorApi(`/api/maker/projects/${id}/cast/suggest`, { accountId });
      const fresh = await creatorApi(`/api/maker/projects/${id}`);
      const base = { ...emptyVisualBible(), ...(fresh.project.metadata.settings?.visualBible || {}) } as VisualBible;
      const added = (data.cast || []).map((item: any) => ({ id: `cast-${crypto.randomUUID()}`, approvedReferences: [], ...item }));
      const next = { ...base, version: (Number(base.version) || 1) + 1, cast: [...(base.cast || []), ...added] };
      const saved = await creatorApi(
        `/api/maker/projects/${id}`,
        { settings: { ...fresh.project.metadata.settings, visualBible: next }, accountId, expectedVersion: fresh.project.version || 1 },
        "PATCH",
      );
      setProject(saved.project);
      setSettings(structuredClone(saved.project.metadata.settings || {}));
      setDirty(false);
      dirtyRef.current = false;
      toast.success(`Cast ${added.length} ${added.length === 1 ? "character" : "characters"} from the script. Review their looks, then generate sheets.`);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setSuggesting(false);
    }
  }
  // Reads the script and adds the recurring objects it finds to the visual bible.
  async function suggestObjects() {
    if (dirty && !(await save())) return;
    setSuggestingObjects(true);
    try {
      const data = await creatorApi(`/api/maker/projects/${id}/objects/suggest`, { accountId });
      const fresh = await creatorApi(`/api/maker/projects/${id}`);
      const base = { ...emptyVisualBible(), ...(fresh.project.metadata.settings?.visualBible || {}) } as VisualBible;
      const added = (data.objects || []).map((item: any) => ({ id: `object-${crypto.randomUUID()}`, approvedReferences: [], ...item }));
      const next = { ...base, version: (Number(base.version) || 1) + 1, objects: [...(base.objects || []), ...added] };
      const saved = await creatorApi(
        `/api/maker/projects/${id}`,
        { settings: { ...fresh.project.metadata.settings, visualBible: next }, accountId, expectedVersion: fresh.project.version || 1 },
        "PATCH",
      );
      setProject(saved.project);
      setSettings(structuredClone(saved.project.metadata.settings || {}));
      setDirty(false);
      dirtyRef.current = false;
      toast.success(`Found ${added.length} recurring ${added.length === 1 ? "object" : "objects"} in the script. Check their looks, then generate sheets.`);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setSuggestingObjects(false);
    }
  }
  async function generateObjectSheets(objectId: string, count: number) {
    if (dirty && !(await save())) return;
    try {
      const data = await creatorApi(`/api/maker/projects/${id}/objects/${encodeURIComponent(objectId)}/sheets`, { count, accountId });
      setProject(data.project);
    } catch (e) {
      onError((e as Error).message);
    }
  }
  async function approveObjectSheet(objectId: string, asset: string) {
    if (dirty && !(await save())) return;
    setBusy(true);
    try {
      const fresh = await creatorApi(`/api/maker/projects/${id}`);
      const data = await creatorApi(`/api/maker/projects/${id}/objects/${encodeURIComponent(objectId)}/approve`, { asset, accountId, expectedVersion: fresh.project.version || 1 });
      setProject(data.project);
      setSettings(structuredClone(data.project.metadata.settings || {}));
      setDirty(false);
      dirtyRef.current = false;
      const name = (data.project.metadata.settings?.visualBible?.objects || []).find((item: any) => item.id === objectId)?.name || "The object";
      toast.success(`${name} is locked. Every scene that names it uses this sheet.`);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function generateCastSheets(castId: string, count: number) {
    if (dirty && !(await save())) return;
    try {
      const data = await creatorApi(`/api/maker/projects/${id}/cast/${encodeURIComponent(castId)}/sheets`, { count, accountId });
      setProject(data.project);
    } catch (e) {
      onError((e as Error).message);
    }
  }
  async function approveCastSheet(castId: string, asset: string) {
    if (dirty && !(await save())) return;
    setBusy(true);
    try {
      const fresh = await creatorApi(`/api/maker/projects/${id}`);
      const data = await creatorApi(`/api/maker/projects/${id}/cast/${encodeURIComponent(castId)}/approve`, { asset, accountId, expectedVersion: fresh.project.version || 1 });
      setProject(data.project);
      setSettings(structuredClone(data.project.metadata.settings || {}));
      setDirty(false);
      dirtyRef.current = false;
      const name = (data.project.metadata.settings?.visualBible?.cast || []).find((item: any) => item.id === castId)?.name || "Character";
      toast.success(`${name} is locked. Every scene with them uses this sheet.`);
    } catch (e) {
      onError((e as Error).message);
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
    (visualView === "cast" || visualView === "scenes" || visualView === "edit" || (!visualView && (draft.scenes || []).length > 0));
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("autoyt-focus-mode", { detail: focusMode }));
  }, [focusMode]);
  useEffect(() => () => void window.dispatchEvent(new CustomEvent("autoyt-focus-mode", { detail: false })), []);
  // Opening a scene by link. Hooks stay above the loading return below.
  useEffect(() => {
    if (!initialSceneId) {
      setSceneEditor(false);
      return;
    }
    const scene = (draft.scenes || []).find((item: any) => item.id === initialSceneId);
    if (scene) {
      setSelectedScene(scene.id);
      setSceneEditor(true);
    }
  }, [initialSceneId, draft.scenes]);
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
  // The channel's own videos plus winners picked from a topic search or pasted in.
  const winners: WinningVideo[] = settings.thumbnailWinners || [];
  const channelThumbs: any[] = [...(project.outputs.title?.blueprint?.videos || []), ...winners].filter((video: any) => video.thumbnailUrl && video.url);
  const pickWinner = (video: WinningVideo) =>
    editSetting({
      thumbnailWinners: [video, ...winners.filter((item) => item.url !== video.url)].slice(0, 12),
      thumbnailStyleRefs: [video.url],
      thumbnailMode: "channel",
    });
  const thumbModeNow: "channel" | "reference" | "scratch" =
    settings.thumbnailMode || thumbMode || (thumbReference ? "reference" : channelThumbs.length ? "channel" : "scratch");
  const defaultStyleRefs = [...channelThumbs].sort((a, b) => b.viewCount - a.viewCount).slice(0, 1).map((video) => video.url);
  const styleRefs: string[] = (settings.thumbnailStyleRefs?.length ? settings.thumbnailStyleRefs : defaultStyleRefs).slice(0, 1);
  const thumbCount = Math.min(3, Math.max(1, Number(settings.thumbnailVariants) || (thumbModeNow === "reference" ? 1 : 3)));
  if (!blocked && currentStage === "thumbnail" && thumbModeNow === "channel" && !channelThumbs.length)
    blocked = "Find a winning thumbnail on your topic, or paste a video link, first";
  if (!blocked && currentStage === "thumbnail" && thumbModeNow === "reference")
    blocked = !thumbReference
      ? "Add a reference thumbnail first, or switch to Start from scratch"
      : !String(settings.thumbnailPrompt || "").trim()
        ? "Describe what to change in the reference"
        : "";
  if (!blocked && currentStage === "voiceover" && !String(settings.voiceId || "").trim()) {
    // A dialogue whose every speaker has a voice needs no main voice.
    const script = project.outputs.script?.draft || "";
    const castVoices = settings.voiceCast || {};
    const allVoiced = isDialogueProject(settings, script) && dialogueSpeakers(parseDialogue(script)).every((speaker) => castVoices[speaker]);
    if (!allVoiced) blocked = isDialogueProject(settings, script) ? "Choose a main voice, or a voice for every character" : "Select a voice first";
  }
  const voiceDuration = Number(project.outputs.voiceover?.duration) || 0;
  const bible: VisualBible = {
    ...emptyVisualBible(),
    ...(settings.visualBible || {}),
    artDirection: { ...emptyVisualBible().artDirection, ...(settings.visualBible?.artDirection || {}) },
    cast: Array.isArray(settings.visualBible?.cast) ? settings.visualBible.cast : [],
    objects: Array.isArray(settings.visualBible?.objects) ? settings.visualBible.objects : [],
  };
  const paceSeconds = settings.imageCount && voiceDuration ? Math.max(1, voiceDuration / Number(settings.imageCount)) : Number(settings.sceneSeconds) || DEFAULT_SCENE_SECONDS;
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
  // Credits a paid step will cost. Billing charges each call at the provider's price,
  // so images and animation are quoted from those prices; the flat rates are the fallback.
  const estimatedCredits = (action = confirm?.action) => {
    if (currentStage === "review" || action === "stock") return 0;
    const flat = billingPricing.flatTokens || {};
    const perUsd = Number(billingPricing.tokensPerUsd) || 0;
    let operation = "default";
    let units = 1;
    if (action === "images" || action === "thumbnailVariants") {
      const count = action === "thumbnailVariants" ? Math.max(1, thumbCount) : confirm?.sceneId ? 1 : Math.max(1, missingImages);
      if (prices?.imageUsd && perUsd) return tokensToCredits(prices.imageUsd * perUsd * count);
      operation = "image";
      units = count;
    } else if (action === "animate") {
      const model = animOptions.model || animation?.model || "";
      const rate = prices?.video?.[model]?.usdPerSecond;
      if (rate && perUsd) return tokensToCredits(rate * perUsd * animateSeconds(model));
      operation = "video";
      units = Math.max(1, animateTargets().length);
    } else if (action === "music") {
      operation = "music";
      units = Math.max(1, normalizeMusicSegments(draft.segments, Number(project.outputs.soundtrackSource?.duration || voiceover?.duration || 0)).filter((part: any) => !part.muted).length);
    } else if (currentStage === "voiceover") {
      // Speech is billed per 1,000 characters of script.
      operation = "speech";
      units = Math.max(1, Math.ceil(String(project.outputs.script?.draft || "").length / 1000));
    }
    return tokensToCredits(Number(flat[operation] ?? flat.default ?? 0) * units);
  };
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
  const stockMode = Boolean(stock?.available) && ["stock", "mixed"].includes(settings.visualSource);
  const toAnimate = scenes.filter((s) => s.animate && s.asset && !s.clip).length;
  const unanimated = scenes.filter((s) => s.asset && !s.clip).length;
  const imageCredits = prices?.imageUsd && billingPricing.tokensPerUsd ? tokensToCredits(prices.imageUsd * billingPricing.tokensPerUsd) : 0;
  const animateTargets = () =>
    confirm?.sceneId ? scenes.filter((scene) => scene.id === confirm.sceneId) : scenes.filter((scene) => scene.animate && scene.asset && !scene.clip);
  // Seconds of video the targets come to: each clip is the model's shortest length that covers its scene.
  const animateSeconds = (model: string) =>
    animateTargets().reduce((sum, scene) => sum + clipSecondsFor(prices?.video?.[model]?.durations || [], Number(scene.end) - Number(scene.start)), 0);
  sceneKeys.current = (event: KeyboardEvent) => {
    if (event.key === "Escape") return closeSceneEditor();
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
    )
    .filter(({ scene }) => {
      const query = boardQuery.trim().toLowerCase();
      return !query || `${scene.text || ""} ${scene.prompt || ""}`.toLowerCase().includes(query);
    });
  const focusIndex = Math.max(0, scenes.findIndex((scene) => scene.id === selectedScene));
  const focusScene = scenes.length ? { scene: scenes[focusIndex], index: focusIndex } : null;
  const selectScene = (sceneId: string) => {
    setSelectedScene(sceneId);
    if (sceneEditor) writeDeepLink({ view: "projects", projectId: id, projectStage: stage, sceneId });
    const scene = scenes.find((item) => item.id === sceneId);
    if (scene && timelineAudio.current) timelineAudio.current.currentTime = scene.start;
  };
  const openSceneEditor = (sceneId: string) => {
    selectScene(sceneId);
    setSceneEditor(true);
    writeDeepLink({ view: "projects", projectId: id, projectStage: stage, sceneId });
  };
  const closeSceneEditor = () => {
    setSceneEditor(false);
    writeDeepLink({ view: "projects", projectId: id, projectStage: stage });
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
          <Progress
            label="Stage progress"
            value={(latest.progress || 0) / 100}
            message={
              <>
                <Loader2 size={14} className="animate-spin" />
                {latest.message || "Queued"}
                {latest.progress > 5 && latest.progress < 95
                  ? ` · about ${Math.max(1, Math.ceil((((Date.now() - latest.createdAt) / 60000) * (100 - latest.progress)) / latest.progress))} min left`
                  : ""}
              </>
            }
          />
        </div>
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
  const qualityReview = project?.metadata?.productionReview as ProductionReview | undefined;
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
            <>
              <span className="maker-caption" title="Estimated customer-facing charge">~{estimatedCredits().toLocaleString()} credits</span>
              <button className="maker-primary" title={blocked || generateLabel} disabled={busy || !!blocked} onClick={generate}>
                <WandSparkles size={15} />
                {generateLabel}
              </button>
            </>
          ))}
      </div>
    </header>
  );
  const dramaEpisode: { seriesId: string; episode: number } | null = project.metadata?.drama?.seriesId ? project.metadata.drama : null;
  return (
    <>
      {!focusMode && <div className="maker-topbar">
        <div className="maker-topbar-left">
          <button
            className="maker-ghost"
            onClick={async () => {
              if (!dirty || (await confirmDialog({ title: "Leave without saving?", body: "Your draft changes will be lost.", confirmLabel: "Leave", danger: true })))
                writeDeepLink(dramaEpisode ? { view: "drama", seriesId: dramaEpisode.seriesId } : { view: "projects" });
            }}
          >
            <ArrowLeft size={16} />
            {dramaEpisode ? "Series" : "Projects"}
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
            title={dramaEpisode ? `Episode ${dramaEpisode.episode}` : "Create Video"}
            text={
              dramaEpisode
                ? "The cast, voices, and art style come from the series. Generate the script, then voice it and storyboard every scene."
                : "Follow the steps below. Start with a title, then generate your script, voiceover, and visuals."
            }
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
                      <Switch className="maker-switch-row maker-align-end" compact checked={Boolean(settings.research)} onChange={(on) => editSetting({ research: on })} label="Research and keep source links" />
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
                      <DeliverySettings settings={settings} editSetting={editSetting} imageCredits={imageCredits} />
                      <label className="maker-field">
                        Visual style
                        <input value={settings.visualStyle || ""} placeholder="Cinematic, hand-drawn, documentary…" onChange={(e) => editSetting({ visualStyle: e.target.value })} />
                      </label>
                      <label className="maker-field">
                        Scene length (seconds)
                        <input type="number" min={2} max={60} value={settings.sceneSeconds ?? DEFAULT_SCENE_SECONDS} onChange={(e) => editSetting({ sceneSeconds: Number(e.target.value) })} />
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
                    {/* Editable until a script exists; after that a new title belongs on the Title tab, since it makes the script stale. */}
                    {project.outputs.title && !String(project.outputs.script?.draft || draft.draft || "").trim() ? (
                      <input
                        className="maker-title-inline"
                        aria-label="Video title"
                        value={titleText ?? project.outputs.title.current ?? ""}
                        onChange={(e) => setTitleText(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                        onBlur={() => {
                          const next = (titleText ?? "").trim();
                          setTitleText(null);
                          if (next && next !== project.outputs.title?.current)
                            void patchProject({ outputStage: "title", output: { ...project.outputs.title, current: next } });
                        }}
                      />
                    ) : (
                      <strong>{project.outputs.title?.current || "No title yet"}</strong>
                    )}
                    {project.outputs.title?.concept && <p>{project.outputs.title.concept}</p>}
                    {project.outputs.title?.blueprint?.scriptFormat?.hook && (
                      <small className="maker-follows">
                        <Sparkles size={12} />
                        Written in {project.outputs.title.blueprint.channel?.title ? possessive(project.outputs.title.blueprint.channel.title) : "the reference"} script format
                      </small>
                    )}
                  </div>
                  <div className="maker-field">
                    <span>Format</span>
                    <Segmented
                      label="Script format"
                      value={settings.scriptFormat === "dialogue" ? "dialogue" : "narration"}
                      onChange={(scriptFormat) => editSetting({ scriptFormat })}
                      options={[
                        { value: "narration", label: "Narration", title: "One voice tells the story" },
                        { value: "dialogue", label: "Dialogue", title: "Characters talk: short dramas, AI fruit stories" },
                      ]}
                    />
                    <small>
                      {settings.scriptFormat === "dialogue"
                        ? "One line per turn as NAME: what they say. Add a voice direction in parentheses, e.g. APPLE (whispering): … Each character gets their own voice and every line gets its own scene."
                        : "A single narrator. Scenes follow the narration sentence by sentence."}
                    </small>
                  </div>
                  <Switch className="maker-switch-row" compact checked={Boolean(settings.research)} onChange={(on) => editSetting({ research: on })} label="Web research" description="Pull citable sources into the script. May take longer." />
                  <Disclosure label="Show options" summary={`${styleName || "no style"} · ${settings.wordCount ?? 600} words`}>
                    <div className="maker-grid-2">
                      <label className="maker-field maker-span">
                        Style
                        <select value={project.styleId || ""} disabled={busy} onChange={(e) => void patchProject({ styleId: e.target.value })}>
                          <option value="">No style</option>
                          {channelStyles.map((style) => (
                            <option key={style.id} value={style.id}>
                              {style.name}
                            </option>
                          ))}
                        </select>
                        <small>The script follows this style's tone and structure.</small>
                      </label>
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
                      placeholder={settings.scriptFormat === "dialogue" ? "APPLE: Did you hear that?\nBANANA (nervous): Hear what?\nNARRATOR: Something moved behind the fridge." : "Write or generate your narration"}
                      onChange={(e) => edit({ draft: e.target.value })}
                    />
                    <div className="maker-meta-row">
                      <span>{wordCount(draft.draft)} words</span>
                      {isDialogueProject(settings, draft.draft || "") ? (
                        <span>
                          {parseDialogue(draft.draft || "").length} lines · {dialogueSpeakers(parseDialogue(draft.draft || "")).join(", ")}
                        </span>
                      ) : null}
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
                  <div className="maker-narration-source">
                    <div>
                      <strong>{output?.uploaded ? `Using your recording: ${output.name || "narration"}` : "Have your own recording?"}</strong>
                      <small>
                        {output?.uploaded
                          ? "It was transcribed to time the scenes. Generate below to replace it with an AI voice."
                          : "Upload audio or video of your narration instead of generating a voice. It's transcribed to time the scenes, and becomes the script if you don't have one."}
                      </small>
                    </div>
                    <button className="maker-outline" disabled={busy || active} onClick={() => narrationInput.current?.click()}>
                      <Upload size={15} />
                      {output?.uploaded ? "Replace recording" : "Upload narration"}
                    </button>
                    <input
                      ref={narrationInput}
                      type="file"
                      accept="audio/*,video/*"
                      hidden
                      onChange={(e) => {
                        const file = e.target.files?.[0] || null;
                        e.target.value = "";
                        if (file) void uploadNarration(file);
                      }}
                    />
                  </div>
                  <Disclosure label="Edit script" summary={`${wordCount(project.outputs.script?.draft)} words`}>
                    <textarea
                      aria-label="Narration script"
                      className="maker-script-editor"
                      value={scriptText ?? project.outputs.script?.draft ?? ""}
                      placeholder="Paste or write the narration to voice"
                      onChange={(e) => setScriptText(e.target.value)}
                    />
                    {scriptText !== null && scriptText !== (project.outputs.script?.draft || "") && (
                      <div className="maker-actions">
                        <button className="maker-outline" onClick={() => setScriptText(null)}>
                          Discard
                        </button>
                        <button
                          className="maker-primary"
                          disabled={busy}
                          onClick={async () => {
                            if (await patchProject({ outputStage: "script", output: { ...(project.outputs.script || {}), draft: scriptText } })) setScriptText(null);
                          }}
                        >
                          <Save size={15} />
                          Save script
                        </button>
                      </div>
                    )}
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
                    <label className="maker-field maker-span">
                      Voice direction
                      <input value={settings.narrationStyle || ""} placeholder="Calm documentary, slow and warm" onChange={(e) => editSetting({ narrationStyle: e.target.value.slice(0, 200) })} />
                    </label>
                  </div>
                  {isDialogueProject(settings, project.outputs.script?.draft || "") ? (() => {
                    const speakers = dialogueSpeakers(parseDialogue(project.outputs.script?.draft || ""));
                    const cast: Record<string, string> = settings.voiceCast && typeof settings.voiceCast === "object" ? settings.voiceCast : {};
                    return (
                      <section className="maker-voice-cast" aria-label="Character voices">
                        <div className="maker-voice-cast-head">
                          <strong>Character voices</strong>
                          <small>Each speaker reads their own lines. Characters without a voice use the main voice above.</small>
                        </div>
                        <div className="maker-voice-cast-grid">
                          {speakers.map((speaker) => (
                            <div className="maker-field" key={speaker}>
                              <span id={`voice-cast-${speaker}`}>{speaker}</span>
                              <VoicePicker
                                voices={voices}
                                value={cast[speaker] || ""}
                                labelledBy={`voice-cast-${speaker}`}
                                loading={voicesLoading}
                                placeholder="Main voice"
                                noneLabel="Use the main voice"
                                onChange={(voiceId) => editSetting({ voiceCast: { ...cast, [speaker]: voiceId || undefined } })}
                              />
                            </div>
                          ))}
                        </div>
                      </section>
                    );
                  })() : null}
                  <p className="maker-caption">{voiceCaption}</p>
                  {output?.asset ? (
                    <>
                      <AudioPlayer src={output.asset} title="Your voiceover is ready" meta={voiceCaption} download="voiceover" />
                      <Disclosure label="Timestamped transcript" summary={`${output.segments?.length || 0} segments, timed to the audio`}>
                        <div className="maker-transcript">
                          {output.segments?.map((s: any, i: number) => (
                            <p key={i}>
                              <time>{durationLabel(s.start)}</time>
                              {s.speaker ? <b className="maker-speaker">{s.speaker}</b> : null}
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
                <MusicLibrary
                  title={null}
                  seed={project.outputs.script?.draft || ""}
                  query={draft.query || draft.mood || settings.soundtrackMood || ""}
                  disabled={busy}
                  useLabel="Use track"
                  onImport={(file) => void upload(file, 30, "audio")}
                  importHint="Licensed audio, up to 30 MB"
                  onUse={async (track) => {
                    if (!(await confirmDialog({ title: `Import “${track.title}”?`, body: `It’s used under its stated ${track.license || "free"} license.`, confirmLabel: "Import track" }))) return;
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
                  <label className="ml-field">
                    Music credit
                    <input value={draft.credit || ""} placeholder="Artist · license" onChange={(e) => edit({ credit: e.target.value })} />
                  </label>
                </MusicLibrary>
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
                          onPreview={output?.asset ? (start) => mixPreview.current?.playFrom(start) : undefined}
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
                        <MixPreview
                          ref={mixPreview}
                          voice={source ? null : voiceover?.asset}
                          music={output.asset}
                          volume={settings.soundtrackVolume ?? 0.18}
                          duration={timingDuration}
                        />
                      )}
                      {output?.asset && (
                        <AudioPlayer src={output.asset} title="Current soundtrack" meta={draft.credit || output.credit || undefined} download="soundtrack" />
                      )}
                      <div className="maker-grid-2">
                        <label className="maker-field">
                          Music level · {Math.round((settings.soundtrackVolume ?? 0.18) * 100)}%
                          <input type="range" min={0} max={1} step={0.05} value={settings.soundtrackVolume ?? 0.18} onChange={(e) => editSetting({ soundtrackVolume: Number(e.target.value) })} />
                        </label>
                        <Switch className="maker-switch-row maker-align-end" compact checked={settings.preserveDialogue !== false} onChange={(on) => editSetting({ preserveDialogue: on })} label="Duck music under narration" />
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
                    <Tabs
                      label="Visual settings"
                      className="maker-vtabs"
                      value={visualTab}
                      onChange={(next) => setVisualTab(next as typeof visualTab)}
                      options={[
                        { value: "style", label: "Style", hint: styleLabel },
                        { value: "timing", label: "Timing", hint: promptEstimate ? `~${promptEstimate} scenes` : `${paceSeconds.toFixed(0)}s each` },
                        { value: "output", label: "Output", hint: `${settings.aspect || "16:9"} · ${QUALITY_OPTIONS.find(([key]) => key === (settings.quality || "standard"))?.[1]}` },
                      ]}
                    />
                    {visualTab === "style" && (
                      <div className="maker-stack-sm" role="tabpanel" aria-label="Style">
                        <ArtStylePicker
                          presets={artStyles.presets}
                          customs={artStyles.styles}
                          value={settings.artStyleId || ""}
                          onChange={(artStyleId) => editSetting({ artStyleId })}
                          onCreate={() => setArtModal(true)}
                          onDelete={async (style) => {
                            if (!(await confirmDialog({ title: `Delete the “${style.name}” art style?`, body: "Projects using it will need a new style before generating images.", confirmLabel: "Delete style", danger: true }))) return;
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
                        <ArtDirectionPanel value={bible} onChange={(visualBible) => editSetting({ visualBible })} />
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
                              value={settings.imageCount ? "" : String(settings.sceneSeconds ?? DEFAULT_SCENE_SECONDS)}
                              onChange={(e) => editSetting({ sceneSeconds: Number(e.target.value), imageCount: undefined })}
                            >
                              {settings.imageCount ? <option value="">~{paceSeconds.toFixed(0)}s (from image count)</option> : null}
                              {[...new Set([2, 3, 4, 5, 6, 8, 12, 20, Number(settings.sceneSeconds) || DEFAULT_SCENE_SECONDS])].sort((a, b) => a - b).map((n) => (
                                <option key={n} value={n}>
                                  {n}s
                                </option>
                              ))}
                            </select>
                          </div>
                          <Switch className="maker-tile-switch" checked={settings.motion !== "still"} onChange={(on) => editSetting({ motion: on ? "push" : "still" })} label="Pan and zoom" description="Every still zooms or pans, switching direction each cut. Rendered locally. Free." />
                          <div className="maker-setting-tile">
                            <div>
                              <strong>Footage</strong>
                              <span>{stock?.available ? "Free stock clips from Pexels, Pixabay and Coverr, matched to each line. Credited in the bundle." : stock?.reason || "Stock footage isn't set up on the server yet."}</span>
                            </div>
                            <select aria-label="Scene footage" value={settings.visualSource || "images"} onChange={(e) => editSetting({ visualSource: e.target.value })}>
                              <option value="images">AI images</option>
                              <option value="stock" disabled={!stock?.available}>Stock footage</option>
                              <option value="mixed" disabled={!stock?.available}>Mixed</option>
                            </select>
                          </div>
                          {stockMode && (
                            <div className="maker-setting-tile">
                              <div>
                                <strong>Clip order</strong>
                                <span>Sequential follows the narration's keywords in order. Random shuffles each scene's matches.</span>
                              </div>
                              <select aria-label="Clip order" value={settings.clipOrder || "sequential"} onChange={(e) => editSetting({ clipOrder: e.target.value })}>
                                <option value="sequential">Sequential</option>
                                <option value="random">Random</option>
                              </select>
                            </div>
                          )}
                        </div>
                        <Switch className="maker-switch-row maker-advanced-toggle" compact checked={advanced} onChange={(on) => setAdvanced(on)} label="Per-segment control" description="Split the narration and set animation, quality, and image count for each part" />
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
                        <DeliverySettings settings={settings} editSetting={editSetting} imageCredits={imageCredits} />
                        <div className="maker-field">
                          <span>Safe prompts</span>
                          <Switch className="maker-switch-row" compact checked={Boolean(settings.safePrompts)} onChange={(on) => editSetting({ safePrompts: on })} label={settings.safePrompts ? "On · no gore, logos, or real people" : "Off"} />
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
                        <button className="maker-primary" title={blocked || "Lock your characters, then generate the storyboard"} disabled={busy || !!blocked} onClick={() => setVisualView("cast")}>
                          <Users size={15} />
                          Next: Characters
                        </button>
                      )}
                    </div>
                  </div>
                </section>
              ) : view === "cast" ? (
                <>
                  <CharactersStep
                    cast={bible.cast}
                    sheets={(project.metadata as any).castSheets || {}}
                    consistency={bible.consistency}
                    framing={(settings.framing === "cinematic" ? "cinematic" : "character") as Framing}
                    busy={busy}
                    dirty={dirty}
                    suggesting={suggesting}
                    generateLabel={scenes.length ? "Regenerate storyboard" : "Generate storyboard"}
                    generateBlocked={blocked}
                    generating={active}
                    reviewCount={scenes.length}
                    onReview={() => setVisualView("scenes")}
                    onBack={() => setVisualView("settings")}
                    onSave={() => void save()}
                    onSuggest={() => void suggestCast()}
                    onAdd={() => editBible({ cast: [...bible.cast, { id: `cast-${crypto.randomUUID()}`, name: `Character ${bible.cast.length + 1}`, role: "", appearance: "", outfit: "", approvedReferences: [] }] })}
                    onEdit={(castId, patch) => editBible({ cast: bible.cast.map((item) => (item.id === castId ? { ...item, ...patch } : item)) })}
                    onRemove={async (castId) => {
                      const character = bible.cast.find((item) => item.id === castId);
                      if (character?.approvedReferences.length && !(await confirmRemoveCharacter(character.name))) return;
                      editBible({ cast: bible.cast.filter((item) => item.id !== castId) });
                    }}
                    onSheets={(castId, count) => void generateCastSheets(castId, count)}
                    onApprove={(castId, asset) => void approveCastSheet(castId, asset)}
                    onUpload={(castId, file) => void uploadCastReference(castId, file)}
                    onConsistency={(consistency) => editBible({ consistency })}
                    onFraming={(framing) => editSetting({ framing })}
                    objects={{
                      objects: bible.objects,
                      sheets: (project.metadata as any).objectSheets || {},
                      suggesting: suggestingObjects,
                      onSuggest: () => void suggestObjects(),
                      onAdd: () => editBible({ objects: [...bible.objects, { id: `object-${crypto.randomUUID()}`, name: `Object ${bible.objects.length + 1}`, description: "", approvedReferences: [] }] }),
                      onEdit: (objectId, patch) => editBible({ objects: bible.objects.map((item) => (item.id === objectId ? { ...item, ...patch } : item)) }),
                      onRemove: async (objectId) => {
                        const object = bible.objects.find((item) => item.id === objectId);
                        if (object?.approvedReferences.length && !(await confirmRemoveCharacter(object.name, "Its locked sheet is removed from this project."))) return;
                        editBible({ objects: bible.objects.filter((item) => item.id !== objectId) });
                      },
                      onSheets: (objectId, count) => void generateObjectSheets(objectId, count),
                      onApprove: (objectId, asset) => void approveObjectSheet(objectId, asset),
                    }}
                    onGenerate={() => {
                      setVisualView("scenes");
                      document.querySelector(".maker-scroll")?.scrollTo({ top: 0 });
                      void start();
                    }}
                  />
                  {stageNotices}
                </>
              ) : (
                <>
                  <div className="maker-scene-head">
                    <button className="maker-link maker-focus-back" onClick={() => setVisualView(view === "edit" ? "scenes" : "cast")}>
                      <ChevronLeft size={16} />
                      Back
                      <span className="maker-focus-back-to">{view === "edit" ? "to storyboard" : "to characters"}</span>
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
                            {toAnimate > 0 ? (
                              <button className="maker-outline" disabled={busy} onClick={() => setConfirm({ action: "animate", confirmed: true })}>
                                <Sparkles size={15} />
                                Animate {toAnimate}
                              </button>
                            ) : unanimated > 0 && animation?.available ? (
                              <button
                                className="maker-outline"
                                disabled={busy}
                                title="Turn every still image into a video clip"
                                onClick={() => {
                                  edit({ scenes: scenes.map((scene) => (scene.asset && !scene.clip ? { ...scene, animate: true } : scene)) });
                                  setConfirm({ action: "animate", confirmed: true });
                                }}
                              >
                                <Sparkles size={15} />
                                Animate all {unanimated}
                              </button>
                            ) : null}
                            {view === "edit" ? (
                              <>
                                {stockMode && missingImages > 0 && (
                                  <button className="maker-outline" disabled={busy} onClick={() => setConfirm({ action: "stock", confirmed: true })}>
                                    <Film size={15} />
                                    Find {missingImages} {missingImages === 1 ? "clip" : "clips"}
                                  </button>
                                )}
                                {voiceover?.asset && scenes.length > 2 && (
                                  <button
                                    className="maker-outline"
                                    disabled={busy}
                                    title="Turn the years, figures, rankings, and quotes in the narration into animated data cards"
                                    onClick={() => void start({ action: "graphics", confirmed: true })}
                                  >
                                    <BarChart3 size={15} />
                                    {scenes.some((scene: any) => scene.graphic) ? "Add more data cards" : "Add data cards"}
                                  </button>
                                )}
                                {voiceover?.asset && scenes.length > 2 && (
                                  <button
                                    className="maker-outline"
                                    disabled={busy}
                                    title="Animate name tags, places, numbers, and key phrases over the footage, timed to the narration"
                                    onClick={() => void start({ action: "overlays", confirmed: true })}
                                  >
                                    <Layers size={15} />
                                    {scenes.some((scene: any) => scene.overlays?.some((overlay: any) => !overlay.manual)) ? "Redo overlays" : "Add overlays"}
                                  </button>
                                )}
                                {missingImages > 1 && !scenes.some((scene) => scene.asset) && (
                                  <button
                                    className="maker-outline"
                                    disabled={busy}
                                    title="Make the first scene's image to check the style before generating the rest"
                                    onClick={() => setConfirm({ action: "images", sceneId: scenes.find((scene) => !scene.asset)?.id, confirmed: true })}
                                  >
                                    <Eye size={15} />
                                    Preview 1 image
                                  </button>
                                )}
                                {missingImages > 0 && (
                                  <button className="maker-outline" disabled={busy} onClick={() => setConfirm({ action: "images", confirmed: true })}>
                                    <ImagePlus size={15} />
                                    Generate {missingImages} {missingImages === 1 ? "image" : "images"}
                                  </button>
                                )}
                                <button className="maker-primary" title={missingImages ? "Every scene needs a visual before rendering" : ""} disabled={busy || !scenes.length || missingImages > 0} onClick={() => void navigate("review")}>
                                  <Film size={15} />
                                  Render video
                                </button>
                              </>
                            ) : (
                              <>
                                {stockMode && missingImages > 0 && (
                                  <button className="maker-outline" disabled={busy} onClick={() => setConfirm({ action: "stock", confirmed: true })}>
                                    <Film size={15} />
                                    Find {missingImages} {missingImages === 1 ? "clip" : "clips"}
                                  </button>
                                )}
                                {voiceover?.asset && scenes.length > 2 && (
                                  <button
                                    className="maker-outline"
                                    disabled={busy}
                                    title="Turn the years, figures, rankings, and quotes in the narration into animated data cards"
                                    onClick={() => void start({ action: "graphics", confirmed: true })}
                                  >
                                    <BarChart3 size={15} />
                                    {scenes.some((scene: any) => scene.graphic) ? "Add more data cards" : "Add data cards"}
                                  </button>
                                )}
                                {voiceover?.asset && scenes.length > 2 && (
                                  <button
                                    className="maker-outline"
                                    disabled={busy}
                                    title="Animate name tags, places, numbers, and key phrases over the footage, timed to the narration"
                                    onClick={() => void start({ action: "overlays", confirmed: true })}
                                  >
                                    <Layers size={15} />
                                    {scenes.some((scene: any) => scene.overlays?.some((overlay: any) => !overlay.manual)) ? "Redo overlays" : "Add overlays"}
                                  </button>
                                )}
                                {missingImages > 1 && !scenes.some((scene) => scene.asset) && (
                                  <button
                                    className="maker-outline"
                                    disabled={busy}
                                    title="Make the first scene's image to check the style before generating the rest"
                                    onClick={() => setConfirm({ action: "images", sceneId: scenes.find((scene) => !scene.asset)?.id, confirmed: true })}
                                  >
                                    <Eye size={15} />
                                    Preview 1 image
                                  </button>
                                )}
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
                    // The whole Vibe Edit: preview, media, captions, music, the timeline, and Juel. Its export
                    // becomes this project's video in Review.
                    <ProjectVibeEdit endpoint={`/api/maker/projects/${id}/vibe-edit`} accountId={accountId} theme={theme} backLabel="Storyboard" onBack={() => setVisualView("scenes")} />
                  ) : null}
                  {focusScene && sceneEditor && (() => {
                    const { scene, index } = focusScene;
                    const state = scene.error ? "failed" : active && scene.generating ? "busy" : scene.asset || scene.clip ? "ready" : "missing";
                    const references: string[] = project.metadata.referenceAssets || [];
                    return (
                      <div className="sce-backdrop" onClick={closeSceneEditor}>
                        <div className="sce" role="dialog" aria-modal="true" aria-label={`Scene ${index + 1} editor`} tabIndex={-1} ref={(node) => node && !node.contains(document.activeElement) && node.focus({ preventScroll: true })} onClick={(event) => event.stopPropagation()}>
                          <header className="sce-head">
                            <div className="sce-title">
                              <h3>
                                Scene {index + 1}
                                <small> of {scenes.length}</small>
                              </h3>
                              <span className="sce-time">
                                {durationLabel(scene.start)} – {durationLabel(scene.end)} · {(scene.end - scene.start).toFixed(1)}s
                              </span>
                              {scene.shot ? <span className="sce-chip">{SHOT_LABELS[scene.shot as keyof typeof SHOT_LABELS]}</span> : null}
                              {state === "failed" ? <span className="sce-chip is-bad">Failed</span> : state === "busy" ? <span className="sce-chip">Generating</span> : scene.stock ? <span className="sce-chip is-accent">Stock</span> : scene.graphic ? <span className="sce-chip is-accent">Data card</span> : scene.clip ? <span className="sce-chip is-accent">Animated</span> : null}
                            </div>
                            <div className="sce-nav">
                              <button type="button" className="sce-icon" aria-label="Previous scene" title="Previous scene (←)" disabled={index === 0} onClick={() => selectScene(scenes[index - 1].id)}>
                                <ChevronLeft size={17} />
                              </button>
                              <button type="button" className="sce-icon" aria-label="Next scene" title="Next scene (→)" disabled={index === scenes.length - 1} onClick={() => selectScene(scenes[index + 1].id)}>
                                <ChevronLeft size={17} style={{ transform: "rotate(180deg)" }} />
                              </button>
                              <span className="sce-divider" aria-hidden="true" />
                              <button type="button" className="sce-icon" aria-label="Close scene editor" title="Close (Esc)" onClick={closeSceneEditor}>
                                <X size={17} />
                              </button>
                            </div>
                          </header>
                          <div className="sce-body">
                            <section className="sce-left" aria-label="Preview">
                              <div className="sce-media" data-state={state}>
                                <div className="sce-frame" style={{ aspectRatio: sceneRatio }}>
                                  {scene.clip ? (
                                    <SyncedClip src={scene.clip} playback={scenePlayback} scene={scene} label={`Scene ${index + 1} animation`} />
                                  ) : scene.asset ? (
                                    <img key={scene.asset} src={scene.asset} alt={scene.prompt} style={playbackStyle(scenePlayback, scene, index)} />
                                  ) : (
                                    <span className="sce-empty">
                                      {state === "busy" ? <Loader2 size={26} className="animate-spin" /> : state === "failed" ? <CircleAlert size={26} /> : <ImagePlus size={26} />}
                                      {state === "busy" ? "Generating the image" : state === "failed" ? "The image failed" : "No image yet"}
                                    </span>
                                  )}
                                  {scene.asset || scene.clip ? <ScenePlayButton playback={scenePlayback} scene={scene} index={index} size="lg" /> : null}
                                </div>
                              </div>
                              <div className="sce-actions">
                                <button className="maker-primary" disabled={active || busy} onClick={() => setConfirm({ action: "images", sceneId: scene.id, confirmed: true })}>
                                  <RefreshCw size={15} />
                                  {scene.error ? "Retry image" : scene.asset ? "Regenerate" : "Generate image"}
                                </button>
                                {stock?.available && (
                                  <button className="maker-outline" disabled={active || busy} onClick={() => setConfirm({ action: "stock", sceneId: scene.id, confirmed: true })}>
                                    <Film size={15} />
                                    {scene.stock ? "Swap footage" : "Find footage"}
                                  </button>
                                )}
                                <button className="maker-outline" disabled={active || busy} onClick={() => setCardScene(scene.id)}>
                                  <BarChart3 size={15} />
                                  {scene.graphic ? "Edit card" : "Data card"}
                                </button>
                                {!scene.graphic && (
                                  <button className="maker-outline" disabled={active || busy} onClick={() => setOverlayScene(scene.id)}>
                                    <Layers size={15} />
                                    Overlay
                                  </button>
                                )}
                                {animation?.available && scene.asset && (
                                  <button className="maker-outline" disabled={active || busy} onClick={() => setConfirm({ action: "animate", sceneId: scene.id, confirmed: true })}>
                                    <Sparkles size={15} />
                                    {scene.clip ? "Re-animate" : "Animate now"}
                                  </button>
                                )}
                                <span className="sce-spacer" />
                                <UploadButton className="sce-icon" title="Use your own image" label={`Use your own image for scene ${index + 1}`} disabled={active || busy} maxBytes={15 * 1024 ** 2} onError={onError} onFile={(file) => void applyOwnSceneImage(scene.id, file)}>
                                  <Upload size={16} />
                                </UploadButton>
                                {scene.asset && (
                                  <a className="sce-icon" href={scene.asset} download title="Download image" aria-label={`Download scene ${index + 1}`}>
                                    <Download size={16} />
                                  </a>
                                )}
                              </div>
                              {scene.overlays?.length ? (
                                <ul className="cvx-overlays" aria-label="Overlays in this scene">
                                  {scene.overlays.map((overlay: SceneOverlay) => (
                                    <li key={overlay.id}>
                                      <Layers size={13} aria-hidden="true" />
                                      <span>{overlaySummary(overlay)}</span>
                                      <small>{durationLabel(overlay.start)}</small>
                                      <button
                                        type="button"
                                        aria-label={`Remove ${overlaySummary(overlay)}`}
                                        title="Remove overlay"
                                        onClick={() => editScene(index, { overlays: scene.overlays.filter((item: SceneOverlay) => item.id !== overlay.id) })}
                                      >
                                        <X size={13} />
                                      </button>
                                    </li>
                                  ))}
                                </ul>
                              ) : null}
                              {scene.graphic ? (
                                <p className="cvx-badge" title={graphicSummary(scene.graphic)}>
                                  <BarChart3 size={13} aria-hidden="true" />
                                  <span>{graphicSummary(scene.graphic)}</span>
                                </p>
                              ) : null}
                              {scene.error && <p className="sce-error">{scene.error}</p>}
                              <figure className="sce-line">
                                <figcaption>{scene.speaker && scene.speaker !== "Narrator" ? `${scene.speaker} says` : "Narration"}</figcaption>
                                <blockquote>{scene.text}</blockquote>
                              </figure>
                            </section>
                            <section className="sce-right" aria-label="Scene settings">
                              <label className="sce-field">
                                <span className="sce-label">Image prompt</span>
                                <textarea aria-label={`Scene ${index + 1} prompt`} rows={6} value={scene.prompt} onChange={(e) => editScene(index, { prompt: e.target.value })} />
                                {scene.promptFallback ? <small>Written from the narration because the AI skipped this scene. Edit it or regenerate prompts.</small> : null}
                                {scene.promptSoftened ? <small>This image used a softened prompt to pass the safety filter.</small> : null}
                              </label>
                              <div className="sce-field">
                                <span className="sce-label">Shot size</span>
                                <Segmented
                                  size="sm"
                                  label={`Scene ${index + 1} shot size`}
                                  value={scene.shot || ""}
                                  onChange={(shot) => editScene(index, { shot, ...(shot === "broll" ? { castIds: [] } : {}) })}
                                  options={SHOT_SIZES.map((shot: string) => ({ value: shot, label: SHOT_LABELS[shot as keyof typeof SHOT_LABELS] }))}
                                />
                                <small>Applies when you regenerate. B-roll takes the cast out of the scene.</small>
                              </div>
                              {bible.cast.length > 0 && (
                                <div className="sce-field">
                                  <span className="sce-label">In this scene</span>
                                  <div className="sce-cast" aria-label={`Characters in scene ${index + 1}`}>
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
                                          <span className="sce-cast-face">
                                            {character.approvedReferences?.[0] ? <img src={character.approvedReferences[0]} alt="" className={/-sheet-/.test(character.approvedReferences[0]) ? "is-sheet" : undefined} /> : <Users size={14} />}
                                          </span>
                                          {character.name}
                                          {selected && <Check size={13} />}
                                        </button>
                                      );
                                    })}
                                  </div>
                                </div>
                              )}
                              <div className="sce-field">
                                <span className="sce-label">Motion</span>
                                <Segmented
                                  size="sm"
                                  label={`Scene ${index + 1} motion`}
                                  value={scene.motion || "still"}
                                  onChange={(motion) => editScene(index, { motion })}
                                  options={[
                                    { value: "still", label: "Still" },
                                    { value: "push", label: "Pan & zoom" },
                                  ]}
                                />
                              </div>
                              <div className="sce-field">
                                <span className="sce-label">Image source</span>
                                <Segmented
                                  size="sm"
                                  label={`Scene ${index + 1} source policy`}
                                  value={scene.sourcePolicy || "generated"}
                                  onChange={(sourcePolicy) => editScene(index, { sourcePolicy })}
                                  options={[
                                    { value: "generated", label: "Generated" },
                                    { value: "reference", label: "From a reference" },
                                    { value: "upload", label: "Uploaded" },
                                  ]}
                                />
                                {scene.sourcePolicy && scene.sourcePolicy !== "generated" ? (
                                  references.length ? (
                                    <div className="sce-refs" role="radiogroup" aria-label={`Scene ${index + 1} reference image`}>
                                      {references.map((asset) => (
                                        <button key={asset} type="button" role="radio" aria-checked={scene.referenceAsset === asset} title={asset.split("/").pop()} onClick={() => editScene(index, { referenceAsset: asset })}>
                                          <img src={asset} alt="" loading="lazy" />
                                          {scene.referenceAsset === asset ? <Check size={12} /> : null}
                                        </button>
                                      ))}
                                    </div>
                                  ) : (
                                    <small>Upload a reference image from the storyboard toolbar first.</small>
                                  )
                                ) : null}
                              </div>
                              {scene.stock?.credit ? (
                                <div className="sce-field">
                                  <small>Footage: {scene.stock.credit}</small>
                                </div>
                              ) : null}
                              <div className="sce-field sce-animate">
                                <span className="maker-switch-row" title={animation?.available ? "Animate this scene with AI" : animation?.reason}>
                                  <Switch compact checked={Boolean(scene.animate)} onChange={(on) => editScene(index, { animate: on })} label="Animate this scene" disabled={!animation?.available} />
                                </span>
                                {!animation?.available && animation?.reason ? <small>{animation.reason}</small> : null}
                                {(scene.animate || scene.clip) && (
                                  <textarea
                                    aria-label={`Scene ${index + 1} animation direction`}
                                    rows={2}
                                    maxLength={600}
                                    value={scene.animationPrompt || ""}
                                    placeholder="Leave blank and AI directs the motion. e.g. the cart rolls slowly left, camera still"
                                    onChange={(e) => editScene(index, { animationPrompt: e.target.value })}
                                  />
                                )}
                              </div>
                            </section>
                          </div>
                          <footer className="sce-foot">
                            <span>
                              <kbd>←</kbd>
                              <kbd>→</kbd> scenes · <kbd>Esc</kbd> close
                            </span>
                            <span className="sce-foot-actions">
                              {dirty ? <span className="sce-unsaved">Unsaved changes</span> : <span>All changes saved</span>}
                              {dirty && (
                                <button className="maker-primary" disabled={busy} onClick={() => void save()}>
                                  <Save size={15} />
                                  Save
                                </button>
                              )}
                            </span>
                          </footer>
                        </div>
                      </div>
                    );
                  })()}
                  {view === "scenes" && (
                  <>
                  <div className="maker-board-bar">
                    <Segmented
                      label="Filter scenes"
                      value={sceneFilter}
                      onChange={(next) => setSceneFilter(next as typeof sceneFilter)}
                      options={([
                        ["all", "All", scenes.length],
                        ["missing", "Missing", missingImages],
                        ["ready", "Ready", scenes.filter((s) => s.asset).length],
                        ["failed", "Failed", failedScenes],
                        ["animated", "Animated", scenes.filter((s) => s.clip || s.animate).length],
                      ] as const)
                        .filter(([key, , count]) => key === "all" || count > 0)
                        .map(([key, label, count]) => ({ value: key, label, hint: String(count) }))}
                    />
                    <SearchField className="sb-search" size="sm" value={boardQuery} onChange={setBoardQuery} placeholder="Search narration or prompts" label="Search scenes" />
                    <div className="maker-actions">
                      <Segmented
                        label="Card size"
                        className="sb-size"
                        size="sm"
                        value={boardSize}
                        onChange={(key) => {
                          setBoardSize(key);
                          try {
                            window.localStorage.setItem(BOARD_SIZE_KEY, key);
                          } catch {}
                        }}
                        options={([
                          ["s", "Small cards", <Grid3x3 size={15} key="i" />],
                          ["m", "Medium cards", <Grid2x2 size={15} key="i" />],
                          ["l", "Large cards", <Square size={15} key="i" />],
                        ] as const).map(([value, label, icon]) => ({ value, title: label, icon, label: <span className="sr-only">{label}</span> }))}
                      />
                      <UploadButton className="mk-btn maker-outline" title="Reference images are used by scenes set to Reference" onFile={(file) => void upload(file, 15, "image")}>
                        <ImagePlus size={15} />
                        Reference image{project.metadata.referenceAssets?.length ? ` (${project.metadata.referenceAssets.length})` : ""}
                      </UploadButton>
                      {scenes.some((s) => s.asset) && (
                        <a className="mk-btn maker-outline" href={`/api/maker/projects/${id}/scene-images.zip?accountId=${encodeURIComponent(accountId)}`} download>
                          <Download size={15} />
                          Download all
                        </a>
                      )}
                    </div>
                  </div>
                  <div className="sb-grid" data-size={boardSize} style={{ ["--scene-ratio" as string]: sceneRatio, ["--sb-min" as string]: `${Math.round({ s: 240, m: 320, l: 440 }[boardSize] * (sceneRatio.startsWith("9") || sceneRatio.startsWith("3 / 4") ? 0.62 : sceneRatio.startsWith("1 /") ? 0.8 : 1))}px` }}>
                    {filteredScenes.map(({ scene, index }) => {
                      const state = scene.error ? "failed" : active && scene.generating ? "busy" : scene.asset || scene.clip ? "ready" : "missing";
                      const cast = bible.cast.filter((character) => (scene.castIds || []).includes(character.id));
                      const openEditor = () => openSceneEditor(scene.id);
                      return (
                        <article key={scene.id} className="sb-card" data-state={state} aria-current={selectedScene === scene.id || undefined}>
                          <div className="sb-mediawrap">
                          <button
                            type="button"
                            className="sb-media"
                            aria-label={`Open scene ${index + 1} in the editor`}
                            onClick={openEditor}
                          >
                            {scene.clip ? (
                              <SyncedClip src={scene.clip} playback={scenePlayback} scene={scene} />
                            ) : scene.asset ? (
                              <img src={scene.asset} alt="" loading="lazy" style={playbackStyle(scenePlayback, scene, index)} />
                            ) : state === "busy" ? (
                              <span className="sb-empty">
                                <Loader2 size={22} className="animate-spin" />
                                Generating
                              </span>
                            ) : state === "failed" ? (
                              <span className="sb-empty">
                                <CircleAlert size={22} />
                                Image failed
                              </span>
                            ) : (
                              <span className="sb-empty">
                                <ImagePlus size={22} />
                                No image yet
                              </span>
                            )}
                            {state === "busy" && scene.asset ? (
                              <span className="sb-busy">
                                <Loader2 size={16} className="animate-spin" />
                              </span>
                            ) : null}
                            <span className="sb-num">
                              {index + 1}
                              {scene.shot ? <small>{SHOT_LABELS[scene.shot as keyof typeof SHOT_LABELS]}</small> : null}
                            </span>
                            {scene.stock ? <em className="sb-flag">Stock</em> : scene.graphic ? <em className="sb-flag">Data card</em> : scene.clip ? <em className="sb-flag">Animated</em> : scene.animate ? <em className="sb-flag is-soft">To animate</em> : null}
                            <span className="sb-time">
                              {durationLabel(scene.start)} – {durationLabel(scene.end)}
                              <b>{(scene.end - scene.start).toFixed(1)}s</b>
                            </span>
                            <span className="sb-open" aria-hidden="true">
                              <Pencil size={14} />
                              Edit scene
                            </span>
                          </button>
                          {scene.asset || scene.clip ? <ScenePlayButton playback={scenePlayback} scene={scene} index={index} /> : null}
                          </div>
                          <div className="sb-body">
                            <p className="sb-line">
                              {scene.speaker && scene.speaker !== "Narrator" ? <b className="sb-speaker">{scene.speaker}</b> : null}
                              {scene.text}
                            </p>
                            {scene.error ? <p className="sb-error">{scene.error}</p> : null}
                            {promptEditing === scene.id ? (
                              <textarea
                                className="sb-prompt-edit"
                                rows={4}
                                autoFocus
                                aria-label={`Scene ${index + 1} image prompt`}
                                value={scene.prompt}
                                onChange={(e) => editScene(index, { prompt: e.target.value })}
                                onBlur={() => setPromptEditing("")}
                                onKeyDown={(e) => e.key === "Escape" && setPromptEditing("")}
                              />
                            ) : (
                              <button type="button" className="sb-prompt" title="Edit the image prompt" onClick={() => setPromptEditing(scene.id)}>
                                <span>{scene.prompt || "No prompt yet. Click to write one."}</span>
                                <Pencil size={13} aria-hidden="true" />
                              </button>
                            )}
                            <div className="sb-chips">
                              <button
                                type="button"
                                aria-pressed={scene.motion === "push"}
                                title="Slow pan and zoom over the image"
                                onClick={() => editScene(index, { motion: scene.motion === "push" ? "still" : "push" })}
                              >
                                <Film size={13} />
                                Pan &amp; zoom
                              </button>
                              <button
                                type="button"
                                aria-pressed={Boolean(scene.animate)}
                                disabled={!animation?.available}
                                title={animation?.available ? "Mark this scene to animate with AI" : animation?.reason || "Animation isn't available"}
                                onClick={() => editScene(index, { animate: !scene.animate })}
                              >
                                <Sparkles size={13} />
                                Animate
                              </button>
                              {cast.length ? (
                                <span className="sb-cast" title={cast.map((character) => character.name).join(", ")}>
                                  {cast.slice(0, 3).map((character) =>
                                    character.approvedReferences?.[0] ? <img key={character.id} src={character.approvedReferences[0]} alt="" /> : <Users key={character.id} size={13} />,
                                  )}
                                  {cast.length > 3 ? <small>+{cast.length - 3}</small> : null}
                                </span>
                              ) : null}
                            </div>
                          </div>
                          <footer className="sb-actions">
                            <button
                              type="button"
                              className="sb-go"
                              disabled={active || busy}
                              onClick={() => setConfirm({ action: "images", sceneId: scene.id, confirmed: true })}
                            >
                              <RefreshCw size={14} />
                              {scene.error ? "Retry" : scene.asset ? "Regenerate" : "Generate"}
                            </button>
                            <UploadButton className="sb-icon" title="Use your own image" label={`Use your own image for scene ${index + 1}`} disabled={active || busy} maxBytes={15 * 1024 ** 2} onError={onError} onFile={(file) => void applyOwnSceneImage(scene.id, file)}>
                              <Upload size={15} />
                            </UploadButton>
                            {scene.asset ? (
                              <a className="sb-icon" href={scene.asset} download title="Download image" aria-label={`Download scene ${index + 1} image`}>
                                <Download size={15} />
                              </a>
                            ) : null}
                            <button type="button" className="sb-icon" title="Open in the scene editor" aria-label={`Edit scene ${index + 1}`} onClick={openEditor}>
                              <SlidersHorizontal size={15} />
                            </button>
                          </footer>
                        </article>
                      );
                    })}
                    {!filteredScenes.length && (
                      <p className="sb-none">
                        No scenes match{boardQuery.trim() ? ` “${boardQuery.trim()}”` : " this filter"}.{" "}
                        <button
                          type="button"
                          className="maker-link"
                          onClick={() => {
                            setBoardQuery("");
                            setSceneFilter("all");
                          }}
                        >
                          Show all scenes
                        </button>
                      </p>
                    )}
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
                  <Segmented
                    label="Thumbnail method"
                    className="maker-thumb-mode"
                    value={thumbModeNow}
                    onChange={(key) => {
                      setThumbMode(key as any);
                      editSetting({ thumbnailMode: key, ...(key !== "reference" && thumbReference ? { thumbnailReference: "" } : {}) });
                    }}
                    options={[
                      { value: "channel", label: "Copy a winner", icon: <TrendingUp size={14} /> },
                      { value: "reference", label: "Edit a reference", icon: <ImageIcon size={14} /> },
                      { value: "scratch", label: "Start from scratch", icon: <WandSparkles size={14} /> },
                    ]}
                  />
                  {thumbModeNow === "channel" ? (
                    <>
                      <Step n={1} title="Pick a winning thumbnail">
                        <p className="maker-caption maker-flush">
                          Your new thumbnail copies its style — layout, text treatment, colors, and framing — with a new subject for this video. Faces in the reference are blurred before it's used.
                        </p>
                        <WinningThumbnails topic={project.outputs.title?.current || project.title || ""} picked={styleRefs[0] || ""} onPick={pickWinner} />
                        {channelThumbs.length ? <p className="maker-caption maker-flush">{project.outputs.title?.blueprint?.videos?.length ? `From ${project.outputs.title?.blueprint?.channel?.title || "the channel"} and your picks` : "Your picks"}</p> : null}
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
                                <UploadButton className="mk-btn maker-outline" maxBytes={15 * 1024 ** 2} onError={onError} onFile={(file) => void setThumbnailReference({ file })}>
                                  <Upload size={14} />
                                  Replace
                                </UploadButton>
                                <button className="maker-link" onClick={() => editSetting({ thumbnailReference: "" })}>
                                  <X size={13} />
                                  Remove
                                </button>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="maker-thumb-source">
                            <FileDrop
                              accept="image/png,image/jpeg,image/webp"
                              maxBytes={15 * 1024 ** 2}
                              onError={onError}
                              onFiles={([file]) => void setThumbnailReference({ file })}
                              disabled={busy}
                              title="Upload image"
                              hint="PNG, JPEG, or WebP · up to 15 MB"
                              icon={busy ? <Loader2 size={20} className="animate-spin" /> : undefined}
                            />
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
                  <ProductionPreflight review={qualityReview} busy={busy} onCheck={() => void runQualityReview()} />
                  {(output?.warnings || []).map((warning: string) => (
                    <p key={warning} className="maker-notice">
                      <CircleAlert size={15} />
                      {warning}
                    </p>
                  ))}
                  {voiceover?.asset && project.outputs.visualPlan?.scenes?.length && project.outputs.visualPlan.scenes.every((scene: any) => scene.asset) ? (
                    <div className="maker-vibe-handoff">
                      <div>
                        <strong>{output?.editedIn === "vibe-edit" ? "Made in the editor" : "Fine-tune it in the editor"}</strong>
                        <span>{output?.editedIn === "vibe-edit" ? "This video is your last export from the editor. Open it again to change anything; exporting replaces it here." : "Trim cuts, swap shots, add titles, restyle captions, and animate text in Vibe Edit. Its export becomes this project's video."}</span>
                      </div>
                      <button className="maker-outline" disabled={busy || handingOff} onClick={() => void openInVibeEdit()}>
                        {handingOff ? <Loader2 size={15} className="animate-spin" /> : <Film size={15} />}
                        {handingOff ? "Preparing the edit…" : "Edit in Vibe Edit"}
                      </button>
                    </div>
                  ) : null}
                  {output?.asset && (
                    <>
                      <VideoPlayer className="maker-media-frame" src={output.asset} label="Exported video" />
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
                        {output.styledCaptions && (
                          <a className="mk-btn maker-outline" href={output.styledCaptions} download>
                            <Download size={15} />
                            Styled captions
                          </a>
                        )}
                        {(output.variants || []).map((variant: any) => (
                          <a key={variant.cut} className="mk-btn maker-outline" href={variant.asset} download>
                            <Download size={15} />
                            Cut {variant.cut}
                          </a>
                        ))}
                      </div>
                    </>
                  )}
                  <div className="maker-card maker-checklist">
                    {(output?.asset
                      ? [
                          [Boolean(output.validation?.audio), "Audio stream present", ""],
                          [Boolean(output.validation?.subtitle), output.captionStyle ? "Captions burned in and embedded" : "Captions embedded", ""],
                          [output.validation?.sceneCount === project.outputs.visualPlan?.scenes?.length, "Scene order matches the plan", ""],
                          [Boolean(output.validation?.width && output.validation?.height), `${output.validation?.width || "?"} × ${output.validation?.height || "?"} · ${Math.round(output.validation?.duration || 0)}s`, ""],
                        ]
                      : [
                          [Boolean(voiceover?.asset), "Voiceover", "voiceover"],
                          [Boolean(project.outputs.visualPlan?.scenes?.length && project.outputs.visualPlan.scenes.every((scene: any) => scene.asset)), "Every scene has a visual", "visualPlan"],
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
                  <CaptionStylePicker value={settings.captionStyle || "none"} onChange={(captionStyle) => editSetting({ captionStyle })} disabled={busy} />
                  <Switch className="maker-switch-row" compact checked={settings.musicPolicy === "none"} onChange={(on) => editSetting({ musicPolicy: on ? "none" : "imported" })} label="Export without music" />
                  <div className="maker-grid-2">
                    <label className="maker-field maker-inline-field">
                      Cuts to render
                      <select value={String(settings.renderVariants || 1)} onChange={(e) => editSetting({ renderVariants: Number(e.target.value) })}>
                        <option value="1">One video</option>
                        <option value="2">Two cuts</option>
                        <option value="3">Three cuts</option>
                      </select>
                      <small>Extra cuts reuse the same narration with different pan directions and footage offsets.</small>
                    </label>
                    <label className="maker-field maker-inline-field">
                      Transition
                      <select value={settings.transition || "cut"} onChange={(e) => editSetting({ transition: e.target.value })}>
                        {VIDEO_TRANSITIONS.map((transition) => (
                          <option key={transition.id} value={transition.id}>{transition.name}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div className="maker-grid-2">
                    <div className="maker-field">
                      <Switch className="maker-switch-row" compact checked={Boolean(settings.hookHeadline)} onChange={(on) => editSetting({ hookHeadline: on })} label="Open with a hook headline" />
                      {settings.hookHeadline ? (
                        <input aria-label="Hook headline" value={settings.hookText || ""} placeholder={project.outputs.title?.current || "The line that stops the scroll"} maxLength={70} onChange={(e) => editSetting({ hookText: e.target.value })} />
                      ) : null}
                      <small>An animated headline over the first two seconds. Leave the text blank to use the title.</small>
                    </div>
                    <div className="maker-field">
                      <Switch className="maker-switch-row" compact checked={Boolean(settings.subscribeOutro)} onChange={(on) => editSetting({ subscribeOutro: on })} label="End with a subscribe card" />
                      {settings.subscribeOutro ? (
                        <input aria-label="Channel name" value={settings.channelName || ""} placeholder={project.outputs.title?.blueprint?.channel?.title || "Your channel name"} maxLength={32} onChange={(e) => editSetting({ channelName: e.target.value })} />
                      ) : null}
                      <small>Subscribe, bell, and like animate over the last few seconds.</small>
                    </div>
                  </div>
                  <div className="maker-field">
                    <span>Look</span>
                    <LookPicker value={settings.look || "none"} onChange={(look) => editSetting({ look })} disabled={busy} />
                    <small>One grade and texture over every scene. Data cards are drawn in the same palette; film them again after changing it.</small>
                  </div>
                  <span className="maker-switch-row" title={settings.captionStyle && settings.captionStyle !== "none" ? "A caption style is burned in, so the overlay captions are off" : ""}>
                    <Switch compact checked={Boolean(settings.animatedCaptions) && !(settings.captionStyle && settings.captionStyle !== "none")} onChange={(on) => editSetting({ animatedCaptions: on })} label="Animated captions and scene effects" disabled={Boolean(settings.captionStyle && settings.captionStyle !== "none")} />
                  </span>
                  {settings.animatedCaptions && !(settings.captionStyle && settings.captionStyle !== "none") ? (
                    <label className="maker-field maker-inline-field">
                      Effect
                      <select value={settings.hyperframesEffect || "cinematic"} onChange={(e) => editSetting({ hyperframesEffect: e.target.value })}>
                        <option value="cinematic">Cinematic pulse</option>
                        <option value="flat-motion">Flat motion sweep</option>
                        <option value="minimal-diagram">Minimal light</option>
                      </select>
                    </label>
                  ) : null}
                  <Switch className="maker-switch-row" compact checked={Boolean(settings.rightsConfirmed)} onChange={(on) => editSetting({ rightsConfirmed: on })} label="I confirm rights and provenance for every asset in this video" />
                </div>
              </section>
            )}
          </div>
        )}
      </div>
      {overlayScene &&
        (() => {
          const scene = draft.scenes.find((item: any) => item.id === overlayScene);
          if (!scene) return null;
          return (
            <OverlayEditor
              scene={scene}
              look={settings.look || "none"}
              aspect={settings.aspect || "16:9"}
              countdown={settings.shotTemplateId === "top-10"}
              onClose={() => setOverlayScene("")}
              onAdd={(overlay) => {
                setOverlayScene("");
                void start({ action: "overlays", sceneId: scene.id, overlay, confirmed: true });
              }}
            />
          );
        })()}
      {cardScene &&
        (() => {
          const index = draft.scenes.findIndex((item: any) => item.id === cardScene);
          const scene = draft.scenes[index];
          if (!scene) return null;
          return (
            <GraphicEditor
              scene={scene}
              look={settings.look || "none"}
              aspect={settings.aspect || "16:9"}
              onClose={() => setCardScene("")}
              onFilm={(graphic: SceneGraphic) => {
                setCardScene("");
                void start({ action: "graphics", sceneId: scene.id, graphic, confirmed: true });
              }}
              onRemove={
                scene.graphic
                  ? () => {
                      editScene(index, { clip: null, graphic: undefined });
                      setCardScene("");
                    }
                  : undefined
              }
            />
          );
        })()}
      {confirm && (
        <Modal
          title={
            confirm.action === "music"
              ? "Compose the soundtrack?"
              : confirm.action === "animate"
              ? confirm.sceneId
                ? "Animate this scene?"
                : `Animate ${toAnimate} ${toAnimate === 1 ? "scene" : "scenes"}?`
              : confirm.action === "stock"
              ? confirm.sceneId
                ? "Find footage for this scene?"
                : "Find stock footage?"
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
                {currentStage === "review" ? "Render" : confirm.action === "music" ? "Compose" : confirm.action === "animate" ? "Animate" : confirm.action === "stock" ? "Find footage" : "Generate"}
              </button>
            </>
          }
        >
          {(() => {
            const targets = animateTargets();
            const clipSeconds = animateSeconds(animOptions.model || animation?.model || "");
            const musicParts = normalizeMusicSegments(draft.segments, Number(project.metadata.soundtrackSource?.duration || voiceover?.duration || 0));
            const musicSeconds = Number(project.metadata.soundtrackSource?.duration || voiceover?.duration || 0);
            if (confirm.action === "animate")
              return (
                <div className="maker-stack">
                  <p>
                    {targets.length} image-to-video {targets.length === 1 ? "clip" : "clips"}, about {clipSeconds}s of video in total, billed per second of video. A retry resumes the same job instead of paying twice. Needs about {Math.round(targets.length * 8)} MB of storage.
                  </p>
                  <label className="maker-field">
                    Animation model
                    <select value={animOptions.model || animation?.model || ""} onChange={(e) => setAnimOptions({ ...animOptions, model: e.target.value })}>
                      {(animation?.models?.length ? animation.models : [animation?.model || ""]).map((model) => {
                        const price = prices?.video?.[model];
                        const perSecond = price?.usdPerSecond && billingPricing.tokensPerUsd ? tokensToCredits(price.usdPerSecond * billingPricing.tokensPerUsd) : 0;
                        return (
                          <option key={model} value={model}>
                            {[price?.name || model, model === animation?.model ? "default" : "", perSecond ? `~${Math.ceil(perSecond).toLocaleString()} credits a second` : ""].filter(Boolean).join(" · ")}
                          </option>
                        );
                      })}
                    </select>
                  </label>
                  <Switch className="maker-tile-switch" checked={animOptions.fixedCamera} onChange={(on) => setAnimOptions({ ...animOptions, fixedCamera: on })} label="Fixed camera" description="Only the subjects move. The frame stays locked, with no pans or zooms." />
                </div>
              );
            if (confirm.action === "music")
              return (
                <p>
                  Composes {musicParts.filter((part) => !part.muted).length} {musicParts.filter((part) => !part.muted).length === 1 ? "cue" : "cues"}, one for each segment, then crossfades them into {Math.round(musicSeconds)}s of instrumental music.
                  {musicParts.some((part) => part.muted) ? ` Muted segments stay silent and aren't generated.` : ""} Each cue is billed separately. A retry reuses cues that were already composed.
                </p>
              );
            return (
              <p>
                {confirm.action === "stock"
                  ? confirm.sceneId
                    ? "Searches the free stock libraries for a clip that matches this line, trims it to the scene, and keeps a poster frame. No credits."
                    : `Searches the free stock libraries for the ${missingImages} ${missingImages === 1 ? "scene" : "scenes"} without a visual. Scenes with no match stay empty so you can generate images for them. No credits.`
                  : confirm.action === "images"
                  ? confirm.sceneId
                    ? `Makes one image request. Needs about ${imageMb} MB of storage.`
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
                      ? "Renders the video from your voiceover, scenes, music, and captions, then checks the output."
                      : "Narration is generated with your selected voice, then timed for captions. Generation charges may apply."}
              </p>
            );
          })()}
          <p className="maker-caption"><strong>Estimated charge:</strong> {estimatedCredits(confirm.action).toLocaleString()} credits{currentStage === "review" ? " · local render" : ""}.</p>
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
