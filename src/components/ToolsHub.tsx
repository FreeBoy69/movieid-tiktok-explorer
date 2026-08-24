import type { ComponentType } from "react";
import {
  ArrowUpRight,
  AudioLines,
  Clapperboard,
  LibraryBig,
  PenLine,
  Radar,
} from "lucide-react";
import { cn } from "../lib/utils";
import type { MainView } from "../utils/tiktokRoute";

type ToolCard = {
  title: string;
  description: string;
  view: MainView;
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  motif: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
};

const TOOL_CARDS: ToolCard[] = [
  {
    title: "Movie ID",
    description: "Identify a film from a clip, link, or uploaded video.",
    view: "movie",
    icon: Clapperboard,
    motif: Clapperboard,
  },
  {
    title: "YouTube Radar",
    description: "Scan YouTube niches, channels, and emerging opportunities.",
    view: "youtube",
    icon: Radar,
    motif: Radar,
  },
  {
    title: "Niche Library",
    description: "Explore the taxonomy behind focused content markets.",
    view: "niches",
    icon: LibraryBig,
    motif: LibraryBig,
  },
  {
    title: "AI Rewriter",
    description: "Turn raw transcripts into clean, original scripts.",
    view: "rewriter",
    icon: PenLine,
    motif: PenLine,
  },
  {
    title: "Text to Speech",
    description: "Create production-ready voice audio from your script.",
    view: "tts",
    icon: AudioLines,
    motif: AudioLines,
  },
];

export function ToolsHub({ theme, onOpen }: { theme: "light" | "dark"; onOpen: (view: MainView) => void }) {
  const isDark = theme === "dark";

  return (
    <section className="pb-12" aria-labelledby="tools-title">
      <header className="max-w-2xl">
        <h1
          id="tools-title"
          className={cn(
            "text-balance font-serif text-4xl font-bold tracking-[-0.035em] sm:text-5xl",
            isDark ? "text-[#F8F5E8]" : "text-[#1A1A1A]",
          )}
        >
          Tools
        </h1>
        <p className={cn("mt-3 max-w-[62ch] text-sm leading-6 sm:text-[15px]", isDark ? "text-[#F8F5E8]/68" : "text-[#1A1A1A]/66")}>
          Focused utilities for research, rewriting, and production. Pick a tool to move directly into its workspace.
        </p>
      </header>

      <div className="mt-9 grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-5">
        {TOOL_CARDS.map(({ title, description, view, icon: Icon, motif: Motif }) => (
          <button
            key={view}
            type="button"
            onClick={() => onOpen(view)}
            className={cn(
              "group relative flex aspect-[9/16] min-w-0 flex-col overflow-hidden rounded-[18px] border p-3 text-left shadow-[0_12px_30px_rgba(26,26,26,0.07)] transition-[transform,border-color,box-shadow] duration-200 hover:-translate-y-1 hover:shadow-[0_18px_42px_rgba(26,26,26,0.11)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#b89f00] sm:p-4",
              isDark
                ? "border-[#F8F5E8]/12 bg-[#171B16] text-[#F8F5E8] hover:border-[#f9dc0b]/42"
                : "border-[#1A1A1A]/10 bg-[#FFFDF8] text-[#1A1A1A] hover:border-[#1A1A1A]/28",
            )}
            aria-label={`Open ${title}`}
          >
            <div
              className={cn(
                "relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-[12px] border",
                isDark ? "border-[#F8F5E8]/8 bg-[#101310]" : "border-[#1A1A1A]/7 bg-[#F1F0EB]",
              )}
              aria-hidden="true"
            >
              <Motif className={cn("absolute h-[70%] w-[70%] stroke-[1] transition-transform duration-300 group-hover:scale-[1.04]", isDark ? "text-[#F8F5E8]/7" : "text-[#1A1A1A]/[0.055]")} />
              <span className={cn("relative grid h-11 w-11 place-items-center rounded-xl border sm:h-12 sm:w-12", isDark ? "border-[#f9dc0b]/28 bg-[#1D211B] text-[#f9dc0b]" : "border-[#1A1A1A]/9 bg-[#FFFDF8] text-[#8a7500]")}>
                <Icon className="h-5 w-5 stroke-[1.8]" />
              </span>
            </div>

            <div className="flex min-h-[42%] flex-col pt-3 sm:pt-4">
              <h2 className="text-[13px] font-bold leading-5 sm:text-sm">{title}</h2>
              <p className={cn("mt-1.5 line-clamp-3 text-[10px] leading-[1.55] sm:text-[11px]", isDark ? "text-[#F8F5E8]/62" : "text-[#1A1A1A]/62")}>
                {description}
              </p>
              <span className={cn("mt-auto flex items-center justify-between gap-2 pt-3 text-[10px] font-semibold sm:text-[11px]", isDark ? "text-[#F8F5E8]/72" : "text-[#1A1A1A]/68")}>
                Open tool
                <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-[#9b8400] transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden="true" />
              </span>
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}
