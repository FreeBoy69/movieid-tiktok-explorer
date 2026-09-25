// The header's information architecture. One list drives the desktop mega
// menus, the mobile menu, quick search, and which top-level item is current.
import type { ReactNode } from "react";
import {
  AudioLines,
  Bot,
  Camera,
  Clapperboard,
  Compass,
  Download,
  Drama,
  Film,
  History,
  Home,
  ImageIcon,
  Layers,
  LibraryBig,
  Megaphone,
  Mic,
  Move,
  PenLine,
  PenTool,
  PlayCircle,
  Radar,
  Scissors,
  ScanSearch,
  Sparkles,
  Star,
  UserRoundCog,
  Workflow,
  Youtube,
  Zap,
} from "lucide-react";
import type { MainView, StudioTab } from "./tiktokRoute";

export type NavTarget = { view: MainView; studioTab?: StudioTab };
export type NavEntry = { id: string; label: string; description: string; icon: ReactNode; target: NavTarget; badge?: string };
export type NavGroup = { id: string; label: string; columns: Array<{ title: string; entries: NavEntry[] }> };

const icon = (Icon: typeof Film) => <Icon className="h-[18px] w-[18px]" strokeWidth={1.8} aria-hidden="true" />;
const studio = (studioTab: StudioTab): NavTarget => ({ view: "studio", studioTab });

export const NAV_GROUPS: NavGroup[] = [
  {
    id: "image",
    label: "Image",
    columns: [
      {
        title: "Create",
        entries: [
          { id: "image", label: "Image Studio", description: "Text to image and image to image", icon: icon(ImageIcon), target: studio("image") },
          { id: "layers", label: "Layers Studio", description: "Cut out, expand, upscale, relight", icon: icon(Layers), target: studio("layers") },
          { id: "cinema", label: "Cinema Studio", description: "Camera, lens, and aperture control", icon: icon(Camera), target: studio("cinema") },
          { id: "design-agent", label: "Design Agent", description: "Posters, graphics, and logos by chat", icon: icon(PenTool), target: studio("design-agent") },
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
          { id: "drama", label: "Create Drama", description: "Short drama series, episode by episode", icon: icon(Drama), target: { view: "drama" } },
          { id: "compile", label: "Compilations", description: "Long-form videos from many clips", icon: icon(Scissors), target: { view: "compile" } },
          { id: "video", label: "Video Studio", description: "Text or image to video, upscaling", icon: icon(Film), target: studio("video") },
          { id: "marketing", label: "Marketing Studio", description: "Turn a product photo into an ad", icon: icon(Megaphone), target: studio("marketing") },
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
    id: "audio",
    label: "Audio",
    columns: [
      {
        title: "Voice & music",
        entries: [
          { id: "tts", label: "Text to Speech", description: "Studio voices and your cloned voices", icon: icon(AudioLines), target: { view: "tts" } },
          { id: "voiceover", label: "Voiceover Studio", description: "Rewrite, re-voice, and mix a video", icon: icon(Mic), target: { view: "voiceover" } },
          { id: "audio", label: "Audio Studio", description: "Original music cues from a prompt", icon: icon(Sparkles), target: studio("audio") },
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
          { id: "rewriter", label: "AI Rewriter", description: "Transcripts into original scripts", icon: icon(PenLine), target: { view: "rewriter" } },
          { id: "prompts", label: "Prompt Library", description: "Proven prompts for every field", icon: icon(Sparkles), target: { view: "prompts" } },
          { id: "styles", label: "Styles", description: "Reusable channel and art styles", icon: icon(Layers), target: { view: "styles" } },
          { id: "projects", label: "Projects", description: "Every video you've made", icon: icon(History), target: { view: "projects" } },
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

const PRIMARY_NAV_IDS = ["create", "drama", "image", "video", "marketing", "cinema", "audio", "automation"];
const NAV_CHILD_IDS: Record<string, string[]> = {
  create: ["styles", "projects"],
  image: ["layers", "design-agent", "ai-influencer"],
  video: ["clipping", "vibe-motion", "motion-control", "body-swap", "lipsync"],
  audio: ["tts", "voiceover"],
  automation: ["agents", "workflows"],
};
const assignedIds = new Set([...PRIMARY_NAV_IDS, ...Object.values(NAV_CHILD_IDS).flat()]);

function findEntry(id: string): NavEntry {
  const entry = ALL_NAV_ENTRIES.find((candidate) => candidate.id === id);
  if (!entry) throw new Error(`Missing navigation entry: ${id}`);
  return entry;
}

export const PRIMARY_NAV_ENTRIES: NavEntry[] = PRIMARY_NAV_IDS.map((id) => {
  const entry = findEntry(id);
  return id === "automation" ? { ...entry, label: "Agency" } : id === "audio" ? { ...entry, label: "Audio" } : entry;
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

/** The header group the current page belongs to ("" for Explore). */
export function currentGroup(view: MainView, studioTab?: StudioTab) {
  const match = (entry: NavEntry) =>
    entry.target.view === view && (view !== "studio" || !entry.target.studioTab || entry.target.studioTab === studioTab);
  return NAV_GROUPS.find((group) => group.columns.some((column) => column.entries.some(match)))?.id || "";
}

export function isCurrentEntry(entry: NavEntry, view: MainView, studioTab?: StudioTab) {
  return entry.target.view === view && (view !== "studio" || entry.target.studioTab === studioTab);
}
