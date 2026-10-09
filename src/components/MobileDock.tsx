// The phone dock: four sections (Create, Projects, Agents, Tools) around a raised "+"
// that springs open a half-disc of quick tools picked for the page you're on.
// Shows below 760px and inside the native apps; hidden in full-screen editors.
import { type ComponentType, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Bot, FolderOpen, Grid2x2, Plus, Sparkles } from "lucide-react";
import { ALL_NAV_ENTRIES, CREATE_HOME_ENTRY, currentGroup, isCurrentEntry, navEntryFor, TOOL_NAV_GROUPS, type NavEntry, type NavTarget } from "../utils/appNavigation";
import type { MainView, StudioTab, ToolId } from "../utils/tiktokRoute";
import { nativePlatform } from "../native/platform";
import { tapFeedback } from "../native/bootstrap";
import { Dialog } from "./ui/Dialog";
import "./MobileDock.css";

type SectionId = "create" | "projects" | "agents" | "tools";
type Section = { id: SectionId; label: string; icon: ComponentType<{ size?: number; strokeWidth?: number; fill?: string; "aria-hidden"?: boolean }> };

const SECTIONS: Section[] = [
  { id: "create", label: "Create", icon: Sparkles },
  { id: "projects", label: "Projects", icon: FolderOpen },
  { id: "agents", label: "Agents", icon: Bot },
  { id: "tools", label: "Tools", icon: Grid2x2 },
];

// Quick tools per header group, and for a few pages that need their own set.
const QUICK_BY_GROUP: Record<string, string[]> = {
  "": ["image", "video", "create", "vibe-edit"],
  image: ["image-upscaler", "background-remover", "magic-edit", "relight"],
  video: ["vibe-edit", "thumbnail-maker", "transcriber", "video-upscaler"],
  film: ["audio", "music", "cinema", "thumbnail-maker"],
  audio: ["music", "vocal-remover", "audio-extractor", "transcriber"],
  "image-tools": ["image", "magic-edit", "background-remover", "image-upscaler"],
  research: ["title-generator", "downloader", "movie", "hashtag-generator"],
  tools: ["downloader", "transcriber", "thumbnail-downloader", "audio-extractor"],
  writing: ["title-generator", "description-writer", "hashtag-generator", "rewriter"],
  agents: ["agents", "design-agent", "workflows", "channels"],
  channels: ["thumbnail-maker", "title-generator", "description-writer", "feed"],
};
const QUICK_BY_ENTRY: Record<string, string[]> = {
  create: ["title-generator", "thumbnail-maker", "audio", "vibe-edit"],
  "vibe-edit": ["transcriber", "music", "thumbnail-maker", "video-upscaler"],
  "movie-recap": ["poster-finder", "downloader", "thumbnail-maker", "vibe-edit"],
  cinema: ["image-upscaler", "relight", "restyle", "video"],
};
// Short names that fit under a quick-tool icon.
const SHORT: Record<string, string> = {
  "image-upscaler": "Upscale", "background-remover": "Remove BG", "magic-edit": "Magic Edit", relight: "Relight", restyle: "Restyle",
  "vibe-edit": "Vibe Edit", "thumbnail-maker": "Thumbnail", transcriber: "Transcribe", "video-upscaler": "Upscale",
  audio: "Voice", music: "Music", cinema: "Cinema", image: "Image", video: "Video", create: "Create Video",
  "vocal-remover": "Vocals", "audio-extractor": "Extract audio", "title-generator": "Titles", downloader: "Download",
  movie: "Movie ID", "hashtag-generator": "Hashtags", "thumbnail-downloader": "Thumbnails", "description-writer": "Description",
  rewriter: "Rewrite", agents: "Agents", "design-agent": "Design", workflows: "Workflows", channels: "Channels",
  feed: "Feed", "poster-finder": "Posters",
};
export const shortLabel = (entry: NavEntry) => SHORT[entry.id] || entry.label.split(" ")[0];

const FALLBACK = ["image", "video", "audio", "title-generator", "thumbnail-maker", "downloader"];
const QUICK_COUNT = 4;
const CLOSE_MS = 560;

export function quickToolsFor(view: MainView, studioTab?: StudioTab, toolId?: ToolId): NavEntry[] {
  const here = navEntryFor(view, studioTab, toolId);
  const group = view === "tools" ? "" : currentGroup(view, studioTab, toolId);
  const ids = [...(here && QUICK_BY_ENTRY[here.id]) || QUICK_BY_GROUP[group] || QUICK_BY_GROUP[""], ...FALLBACK];
  const picked: NavEntry[] = [];
  for (const id of ids) {
    const entry = ALL_NAV_ENTRIES.find((e) => e.id === id);
    if (!entry || picked.includes(entry) || isCurrentEntry(entry, view, studioTab, toolId)) continue;
    picked.push(entry);
    if (picked.length === QUICK_COUNT) break;
  }
  return picked;
}

export function sectionFor(view: MainView, studioTab?: StudioTab, toolId?: ToolId): SectionId | null {
  if (view === "projects" || view === "styles") return "projects";
  const group = currentGroup(view, studioTab, toolId);
  if (view === "automation" || group === "agents") return "agents";
  if (view === "tools" || view === "create" || view === "drama" || view === "vibe-edit" || ["image", "video", "film", "audio"].includes(group)) return "create";
  if (group) return "tools";
  return null;
}

const SECTION_TARGET: Record<Exclude<SectionId, "tools">, NavTarget> = {
  create: CREATE_HOME_ENTRY.target,
  projects: { view: "projects" },
  agents: { view: "automation" },
};

// Views that own the bottom edge (full-screen editors) hide the dock.
const HIDDEN_VIEWS = new Set<MainView>(["vibe-edit"]);

export function MobileDock({ view, studioTab, toolId, onNavigate, hidden }: { view: MainView; studioTab?: StudioTab; toolId?: ToolId; onNavigate: (target: NavTarget) => void; hidden?: boolean }) {
  const [trayOpen, setTrayOpenState] = useState(false);
  // "closing" plays the reverse of the opening (tools spin out, wedge sweeps back, tray folds into the +).
  const [closing, setClosing] = useState(false);
  const closeTimer = useRef(0);
  const setTrayOpen = (next: boolean | ((open: boolean) => boolean)) => {
    setTrayOpenState((open) => {
      const value = typeof next === "function" ? next(open) : next;
      window.clearTimeout(closeTimer.current);
      if (open && !value) {
        setClosing(true);
        closeTimer.current = window.setTimeout(() => setClosing(false), CLOSE_MS);
      } else if (value) setClosing(false);
      return value;
    });
  };
  useEffect(() => () => window.clearTimeout(closeTimer.current), []);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [tilt, setTilt] = useState<"" | "left" | "right">("");
  const root = useRef<HTMLDivElement>(null);
  const native = Boolean(nativePlatform());
  const active = sectionFor(view, studioTab, toolId);
  const quick = useMemo(() => quickToolsFor(view, studioTab, toolId), [view, studioTab, toolId]);
  const previous = useRef(active);
  const bar = useRef<HTMLElement>(null);
  const [pill, setPill] = useState<{ x: number; w: number } | null>(null);

  // The selection pill slides under the active tab; measured so it follows any bar width.
  useLayoutEffect(() => {
    const place = () => {
      const tabEl = active ? bar.current?.querySelector<HTMLElement>(`[data-section="${active}"]`) : null;
      setPill(tabEl ? { x: tabEl.offsetLeft + tabEl.offsetWidth / 2, w: Math.min(64, tabEl.offsetWidth - 6) } : null);
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [active, hidden, view]);

  // The bar leans toward the newly picked section, then springs level.
  useEffect(() => {
    const from = SECTIONS.findIndex((s) => s.id === previous.current);
    const to = SECTIONS.findIndex((s) => s.id === active);
    previous.current = active;
    if (from < 0 || to < 0 || from === to) return;
    setTilt(to > from ? "right" : "left");
    const timer = window.setTimeout(() => setTilt(""), 520);
    return () => window.clearTimeout(timer);
  }, [active]);

  // Close the tray on navigation, an outside tap, or Escape.
  useEffect(() => setTrayOpen(false), [view, studioTab, toolId]);
  useEffect(() => {
    if (!trayOpen) return;
    const onDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setTrayOpen(false);
    };
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setTrayOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [trayOpen]);

  if (hidden || HIDDEN_VIEWS.has(view)) return null;

  const go = (target: NavTarget) => {
    tapFeedback();
    setTrayOpen(false);
    setToolsOpen(false);
    onNavigate(target);
  };
  // Tapping the section you're in takes the page back to the top.
  const toTop = () => {
    tapFeedback();
    document.querySelectorAll<HTMLElement>("main, main *").forEach((el) => {
      if (el.scrollTop > 0 && el.scrollHeight > el.clientHeight) el.scrollTo({ top: 0, behavior: "smooth" });
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const tab = (section: Section) => {
    const on = active === section.id;
    const Icon = section.icon;
    return (
      <button
        key={section.id}
        type="button"
        className="mdock-tab"
        data-section={section.id}
        aria-current={on ? "page" : undefined}
        onClick={() => {
          if (section.id === "tools") {
            tapFeedback();
            setToolsOpen(true);
          } else if (on) toTop();
          else go(SECTION_TARGET[section.id]);
        }}
      >
        <Icon size={22} strokeWidth={on ? 2.1 : 1.7} aria-hidden />
        <span className="mdock-label">{section.label}</span>
      </button>
    );
  };

  return (
    <div ref={root} className="mdock-slot" data-native={native || undefined}>
      <div className="mdock-tray" data-open={trayOpen || undefined} data-closing={closing || undefined} aria-hidden={!trayOpen}>
        <span className="mdock-wedge" aria-hidden="true" />
        <ul className="mdock-quick" role="menu" aria-label="Quick tools for this page">
          {quick.map((entry, index) => (
            <li key={entry.id} role="none" style={{ ["--i" as string]: index, ["--n" as string]: quick.length }}>
              <button type="button" role="menuitem" tabIndex={trayOpen ? 0 : -1} onClick={() => go(entry.target)} aria-label={entry.label} title={`${entry.label}: ${entry.description}`}>
                <span className="mdock-quick-icon">{entry.icon}</span>
                <span className="mdock-quick-label">{shortLabel(entry)}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <nav ref={bar} className="mdock" data-tilt={tilt || undefined} aria-label="Sections">
        {pill ? <span className="mdock-pill" aria-hidden="true" style={{ transform: `translateX(${pill.x}px) translateX(-50%)`, width: pill.w }} /> : null}
        {SECTIONS.slice(0, 2).map(tab)}
        <span className="mdock-fab-gap" aria-hidden="true" />
        {SECTIONS.slice(2).map(tab)}
        <button type="button" className="mdock-fab" data-open={trayOpen || undefined} data-closing={closing || undefined} aria-expanded={trayOpen} aria-label={trayOpen ? "Close quick tools" : "Quick tools for this page"} onClick={() => {
            tapFeedback();
            setTrayOpen((open) => !open);
          }}>
          <Plus size={26} strokeWidth={2.4} aria-hidden="true" />
        </button>
      </nav>
      {toolsOpen ? (
        <Dialog title="Tools" description="Every tool, grouped" onClose={() => setToolsOpen(false)} size="md" className="mdock-tools">
          {TOOL_NAV_GROUPS.map((group) => (
            <section key={group.id} className="mdock-tools-group">
              <h3>{group.label}</h3>
              <div className="mdock-tools-grid">
                {group.columns.flatMap((column) => column.entries).map((entry) => (
                  <button key={entry.id} type="button" className="mdock-tool" aria-current={isCurrentEntry(entry, view, studioTab, toolId) ? "page" : undefined} onClick={() => go(entry.target)}>
                    <span className="mdock-tool-icon">{entry.icon}</span>
                    <span>{entry.label}</span>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </Dialog>
      ) : null}
    </div>
  );
}
