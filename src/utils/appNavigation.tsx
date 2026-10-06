// The header's information architecture. One list drives the desktop mega
// menus, the mobile menu, quick search, and which top-level item is current.
import type { ReactNode } from "react";
import {
  AudioLines,
  Bot,
  BookOpen,
  Camera,
  Captions,
  Clapperboard,
  PersonStanding,
  Compass,
  Download,
  Drama,
  Popcorn,
  Eraser,
  Expand,
  FileText,
  Film,
  Hash,
  Heading,
  History,
  Home,
  ImageDown,
  ImageIcon,
  ImageUpscale,
  Layers,
  LayoutPanelTop,
  LibraryBig,
  Megaphone,
  Mic,
  Move,
  Music2,
  Palette,
  PenLine,
  PenTool,
  PlayCircle,
  Projector,
  Presentation,
  Radar,
  Rocket,
  Scissors,
  ScanSearch,
  Scan,
  Sparkles,
  Star,
  Sun,
  Ticket,
  UserRoundCog,
  Wand2,
  Workflow,
  Youtube,
  Zap,
  WandSparkles,
} from "lucide-react";
import type { FilmRoute, MainView, StudioTab, ToolId } from "./tiktokRoute";

export type NavTarget = { view: MainView; studioTab?: StudioTab; toolId?: ToolId; shotTemplateId?: string; filmFormat?: FilmRoute };
export type NavEntry = { id: string; label: string; description: string; icon: ReactNode; target: NavTarget; badge?: string };
export type NavGroup = { id: string; label: string; columns: Array<{ title: string; entries: NavEntry[] }> };

const icon = (Icon: typeof Film) => <Icon className="h-[18px] w-[18px]" strokeWidth={1.8} aria-hidden="true" />;
const studio = (studioTab: StudioTab): NavTarget => ({ view: "studio", studioTab });
const tool = (toolId: ToolId): NavTarget => ({ view: "tool", toolId });

export const NAV_GROUPS: NavGroup[] = [
  {
    id: "image",
    label: "Image",
    columns: [
      {
        title: "Create",
        entries: [
          { id: "image", label: "Image Studio", description: "Text to image and image to image", icon: icon(ImageIcon), target: studio("image") },
          { id: "cinema", label: "Cinema Studio", description: "Camera, lens, and aperture control", icon: icon(Camera), target: studio("cinema") },
          { id: "ai-influencer", label: "AI Influencer", description: "One face, consistent in every scene", icon: icon(Star), target: studio("ai-influencer") },
        ],
      },
    ],
  },
  {
    id: "video",
    label: "Video",
    columns: [
      {
        title: "Make videos",
        entries: [
          { id: "create", label: "Create Video", description: "Script to finished, narrated video", icon: icon(Clapperboard), target: { view: "create" } },
          { id: "movie-recap", label: "Movie to Recap", description: "A full film into a narrated recap and a Short", icon: icon(Projector), target: tool("movie-recap"), badge: "New" },
          { id: "vibe-edit", label: "Vibe Edit", description: "Edit on a timeline by chatting with AI", icon: icon(WandSparkles), target: { view: "vibe-edit" }, badge: "New" },
          { id: "stickman", label: "Stickman Explainer", description: "A directed stick-figure short from any idea", icon: icon(PersonStanding), target: { view: "create", shotTemplateId: "stickman-director" } },
          { id: "compile", label: "Compilations", description: "Long-form videos from many clips", icon: icon(Scissors), target: { view: "compile" } },
          { id: "video", label: "Video Studio", description: "Text or image to video, upscaling", icon: icon(Film), target: studio("video") },
          { id: "marketing", label: "Marketing Studio", description: "Turn a product photo into an ad", icon: icon(Megaphone), target: studio("marketing") },
          { id: "promo", label: "Promo Studio", description: "Launch videos in motion graphics", icon: icon(Rocket), target: studio("promo") },
          { id: "explainer", label: "Explainer Studio", description: "Narrated product walkthroughs in your voice", icon: icon(Presentation), target: studio("explainer") },
          { id: "clipping", label: "AI Clipping", description: "Long video to ready-to-post shorts", icon: icon(Scissors), target: studio("clipping") },
        ],
      },
      {
        title: "Motion & effects",
        entries: [
          { id: "motion-control", label: "Motion Control", description: "A character copies a reference move", icon: icon(Move), target: studio("motion-control") },
          { id: "vibe-motion", label: "Vibe Motion", description: "Prompted motion graphics and titles", icon: icon(Zap), target: studio("vibe-motion") },
          { id: "lipsync", label: "Lip Sync", description: "Make a portrait speak your audio", icon: icon(Mic), target: studio("lipsync") },
          { id: "body-swap", label: "Body Swap", description: "Replace the person in a video", icon: icon(UserRoundCog), target: studio("body-swap") },
        ],
      },
    ],
  },
  {
    id: "film",
    label: "Create Film",
    columns: [
      {
        title: "Make a film",
        entries: [
          { id: "film", label: "Create Film", description: "Series, short and long films, and music videos", icon: icon(Popcorn), target: { view: "drama", filmFormat: "hub" }, badge: "New" },
          { id: "drama", label: "Create Series", description: "Short drama series, episode by episode", icon: icon(Drama), target: { view: "drama", filmFormat: "series" } },
          { id: "short-film", label: "Short Film", description: "One complete story, two to five minutes", icon: icon(Clapperboard), target: { view: "drama", filmFormat: "short" } },
          { id: "long-film", label: "Long Film", description: "A feature told in parts with one cast", icon: icon(Film), target: { view: "drama", filmFormat: "long" } },
          { id: "music-video", label: "Music Video", description: "From your song: lyrics, concept, video", icon: icon(Music2), target: { view: "drama", filmFormat: "music" } },
        ],
      },
    ],
  },
  {
    id: "audio",
    label: "Audio",
    columns: [
      {
        title: "Voice & music",
        entries: [
          { id: "audio", label: "Audio Studio", description: "Text to speech, voices, and authorized cloning", icon: icon(AudioLines), target: studio("audio") },
          { id: "music", label: "Music Generation", description: "Original music cues from a prompt", icon: icon(Sparkles), target: studio("music") },
        ],
      },
    ],
  },
  {
    id: "image-tools",
    label: "Image tools",
    columns: [
      {
        title: "Design and edit images",
        entries: [
          { id: "editable-design", label: "Editable Design", description: "Posters with live text and movable layers", icon: icon(LayoutPanelTop), target: tool("editable-design") },
          { id: "background-remover", label: "Background Remover", description: "Clean cutout on white, or the scene alone", icon: icon(Scan), target: tool("background-remover") },
          { id: "layer-splitter", label: "Layer Splitter", description: "Subject and background as two files", icon: icon(Layers), target: tool("layer-splitter") },
          { id: "image-upscaler", label: "Image Upscaler", description: "Re-render at the highest resolution", icon: icon(ImageUpscale), target: tool("image-upscaler") },
          { id: "image-expander", label: "Image Expander", description: "Outpaint to a new aspect ratio", icon: icon(Expand), target: tool("image-expander") },
          { id: "relight", label: "Relight", description: "Change the light, keep the shot", icon: icon(Sun), target: tool("relight") },
          { id: "restyle", label: "Restyle", description: "The same picture in a new style", icon: icon(Palette), target: tool("restyle") },
          { id: "object-remover", label: "Object Remover", description: "Erase text, logos, and objects", icon: icon(Eraser), target: tool("object-remover") },
          { id: "magic-edit", label: "Magic Edit", description: "Any change you can describe", icon: icon(Wand2), target: tool("magic-edit") },
          { id: "thumbnail-maker", label: "Thumbnail Maker", description: "Click-worthy 16:9 thumbnails with your title", icon: icon(ImageIcon), target: tool("thumbnail-maker") },
        ],
      },
    ],
  },
  {
    id: "research",
    label: "Research",
    columns: [
      {
        title: "Find what works",
        entries: [
          { id: "discover", label: "Niche Finder", description: "Channels and outliers in any niche", icon: icon(Compass), target: { view: "discover" } },
          { id: "youtube", label: "YouTube Radar", description: "Scan niches and emerging channels", icon: icon(Radar), target: { view: "youtube" } },
          { id: "tiktok", label: "TikTok Explorer", description: "Analyze videos and collections", icon: icon(PlayCircle), target: { view: "tiktok" } },
          { id: "niches", label: "Niche Library", description: "The taxonomy of content markets", icon: icon(LibraryBig), target: { view: "niches" } },
          { id: "movie", label: "Movie ID", description: "Identify a film from any clip", icon: icon(ScanSearch), target: { view: "movie" } },
        ],
      },
    ],
  },
  {
    id: "tools",
    label: "Tools",
    columns: [
      {
        title: "Utilities",
        entries: [
          { id: "downloader", label: "Video Downloader", description: "Download video or audio in any quality", icon: icon(Download), target: { view: "downloader" } },
          { id: "audio-extractor", label: "Audio Extractor", description: "Pull the soundtrack out of any video link", icon: icon(Music2), target: tool("audio-extractor") },
          { id: "vocal-remover", label: "Vocal Remover", description: "Split the voice from the music and effects", icon: icon(Mic), target: tool("vocal-remover") },
          { id: "transcriber", label: "Video Transcriber", description: "A link becomes a transcript and subtitles", icon: icon(Captions), target: tool("transcriber") },
          { id: "video-upscaler", label: "Video Upscaler", description: "Sharpen a clip up to 3×", icon: icon(Film), target: tool("video-upscaler") },
          { id: "thumbnail-downloader", label: "Thumbnail Downloader", description: "Save any video's cover image in full size", icon: icon(ImageDown), target: tool("thumbnail-downloader") },
          { id: "poster-finder", label: "Poster Finder", description: "Posters, backdrops, and facts for any film", icon: icon(Ticket), target: tool("poster-finder") },
          { id: "styles", label: "Styles", description: "Reusable channel and art styles", icon: icon(Layers), target: { view: "styles" } },
          { id: "projects", label: "Projects", description: "Every video you've made", icon: icon(History), target: { view: "projects" } },
        ],
      },
    ],
  },
  {
    id: "writing",
    label: "Writing",
    columns: [
      {
        title: "Words that publish",
        entries: [
          { id: "digital-products", label: "Digital Product Maker", description: "Build, illustrate, and preview reader-ready books", icon: icon(BookOpen), target: { view: "products" } },
          { id: "rewriter", label: "AI Rewriter", description: "Transcripts into original scripts", icon: icon(PenLine), target: { view: "rewriter" } },
          { id: "title-generator", label: "Title Generator", description: "Titles and hooks people click", icon: icon(Heading), target: tool("title-generator") },
          { id: "description-writer", label: "Description Writer", description: "Descriptions, tags, and chapters", icon: icon(FileText), target: tool("description-writer") },
          { id: "hashtag-generator", label: "Hashtag Generator", description: "Hashtag sets sized for reach", icon: icon(Hash), target: tool("hashtag-generator") },
          { id: "prompts", label: "Prompt Library", description: "Proven prompts for every field", icon: icon(Sparkles), target: { view: "prompts" } },
        ],
      },
    ],
  },
  {
    id: "agents",
    label: "Agents",
    columns: [
      {
        title: "Automate",
        entries: [
          { id: "automation", label: "Automation", description: "Agents that run your channels", icon: icon(Bot), target: { view: "automation" } },
          { id: "agents", label: "Creative Agents", description: "Agents that plan and produce media", icon: icon(Sparkles), target: studio("agents") },
          { id: "design-agent", label: "Design Agent", description: "Posters, graphics, and logos by chat", icon: icon(PenTool), target: studio("design-agent") },
          { id: "workflows", label: "Workflows", description: "Multi-step pipelines across studios", icon: icon(Workflow), target: studio("workflows") },
        ],
      },
    ],
  },
  {
    id: "channels",
    label: "Channels",
    columns: [
      {
        title: "Your channels",
        entries: [
          { id: "channels", label: "Channel Management", description: "Optimize and publish to your channels", icon: icon(Youtube), target: { view: "channels" } },
          { id: "feed", label: "Feed", description: "New videos from channels you follow", icon: icon(Home), target: { view: "feed" } },
        ],
      },
    ],
  },
];

export const ALL_NAV_ENTRIES: NavEntry[] = NAV_GROUPS.flatMap((group) => group.columns.flatMap((column) => column.entries));

const PRIMARY_NAV_IDS = ["image", "video", "audio", "create", "film", "marketing", "promo", "cinema", "automation"];
export const MENU_ONLY_NAV_IDS = new Set(["image", "video", "audio"]);
const NAV_CHILD_IDS: Record<string, string[]> = {
  create: ["styles", "projects"],
  film: ["drama", "short-film", "long-film", "music-video"],
  image: ["image", "ai-influencer"],
  video: ["vibe-edit", "video", "explainer", "clipping", "vibe-motion", "motion-control", "body-swap", "lipsync"],
  audio: ["audio", "music"],
  automation: ["agents", "design-agent", "workflows"],
};
const assignedIds = new Set([...PRIMARY_NAV_IDS, ...Object.values(NAV_CHILD_IDS).flat()]);

function findEntry(id: string): NavEntry {
  const entry = ALL_NAV_ENTRIES.find((candidate) => candidate.id === id);
  if (!entry) throw new Error(`Missing navigation entry: ${id}`);
  return entry;
}

export const PRIMARY_NAV_ENTRIES: NavEntry[] = PRIMARY_NAV_IDS.map((id) => {
  const entry = findEntry(id);
  const labels: Record<string, string> = { image: "Image", video: "Video", audio: "Audio", automation: "Agents" };
  return labels[id] ? { ...entry, label: labels[id] } : entry;
});

export const PRIMARY_NAV_CHILDREN: Record<string, NavEntry[]> = Object.fromEntries(
  Object.entries(NAV_CHILD_IDS).map(([parent, ids]) => [parent, ids.map((id) => {
    const entry = findEntry(id);
    return id === "agents" ? { ...entry, label: "Create Agents" } : entry;
  })]),
);

export const TOOL_NAV_GROUPS: NavGroup[] = NAV_GROUPS.map((group) => ({
  ...group,
  label: group.id === "tools" ? "Utilities" : group.id === "agents" ? "Agent tools" : group.label,
  columns: group.columns
    .map((column) => ({ ...column, entries: column.entries.filter((entry) => !assignedIds.has(entry.id)) }))
    .filter((column) => column.entries.length > 0),
})).filter((group) => group.columns.length > 0);

/** The page a navigation target opens, as the router sees it. */
export type NavLocation = { view: MainView; studioTab?: StudioTab; toolId?: ToolId };

/** The header group the current page belongs to ("" for Explore). */
export function currentGroup(view: MainView, studioTab?: StudioTab, toolId?: ToolId) {
  const match = (entry: NavEntry) =>
    entry.target.view === view
    && (view !== "studio" || !entry.target.studioTab || entry.target.studioTab === studioTab)
    && (view !== "tool" || !entry.target.toolId || entry.target.toolId === toolId);
  return NAV_GROUPS.find((group) => group.columns.some((column) => column.entries.some(match)))?.id || "";
}

export function isCurrentEntry(entry: NavEntry, view: MainView, studioTab?: StudioTab, toolId?: ToolId) {
  if (entry.target.view !== view) return false;
  if (view === "studio") return entry.target.studioTab === studioTab;
  if (view === "tool") return entry.target.toolId === toolId;
  return true;
}

/** The navigation entry for a page, falling back to any entry on that view. */
export function navEntryFor(view: MainView, studioTab?: StudioTab, toolId?: ToolId) {
  return ALL_NAV_ENTRIES.find((entry) => isCurrentEntry(entry, view, studioTab, toolId))
    ?? ALL_NAV_ENTRIES.find((entry) => entry.target.view === view);
}
