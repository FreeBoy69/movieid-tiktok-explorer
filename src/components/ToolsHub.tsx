import type { ComponentType } from "react";
import {
  ArrowUpRight,
  AudioLines,
  Download,
  Clapperboard,
  LibraryBig,
  PenLine,
  PlayCircle,
  Radar,
  Sparkles,
} from "lucide-react";
import { cn } from "../lib/utils";
import type { MainView } from "../utils/tiktokRoute";
import { NAV_GROUPS, type NavTarget } from "../utils/appNavigation";

type ToolArtwork = "movie" | "radar" | "library" | "rewriter" | "voice" | "download" | "prompts" | "tiktok";

type ToolCard = {
  title: string;
  description: string;
  view: MainView;
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  artwork: ToolArtwork;
};

const TOOL_CARDS: ToolCard[] = [
  {
    title: "Video Downloader",
    description: "Detect available quality and download video or audio.",
    view: "downloader",
    icon: Download,
    artwork: "download",
  },
  {
    title: "Movie ID",
    description: "Identify a film from a clip, link, or uploaded video.",
    view: "movie",
    icon: Clapperboard,
    artwork: "movie",
  },
  {
    title: "YouTube Radar",
    description: "Scan YouTube niches, channels, and emerging opportunities.",
    view: "youtube",
    icon: Radar,
    artwork: "radar",
  },
  {
    title: "TikTok Explorer",
    description: "Analyze TikTok videos, collections, and saved posts.",
    view: "tiktok",
    icon: PlayCircle,
    artwork: "tiktok",
  },
  {
    title: "Niche Library",
    description: "Explore the taxonomy behind focused content markets.",
    view: "niches",
    icon: LibraryBig,
    artwork: "library",
  },
  {
    title: "Voiceover Studio",
    description: "Rewrite narration, swap voices, and mix video audio.",
    view: "voiceover",
    icon: AudioLines,
    artwork: "voice",
  },
  {
    title: "AI Rewriter",
    description: "Turn raw transcripts into clean, original scripts.",
    view: "rewriter",
    icon: PenLine,
    artwork: "rewriter",
  },
  {
    title: "Text to Speech",
    description: "Create production-ready voice audio from your script.",
    view: "tts",
    icon: AudioLines,
    artwork: "voice",
  },
  {
    title: "Prompt Library",
    description: "Proven prompts for styles, scripts, hooks, voice, and music.",
    view: "prompts",
    icon: Sparkles,
    artwork: "prompts",
  },
];

function ToolArtwork({ artwork, Icon }: { artwork: ToolArtwork; Icon: ToolCard["icon"] }) {
  if (artwork === "download") {
    return (
      <div className="relative h-full overflow-hidden bg-[#1A1A1A] text-[#f9dc0b]" aria-hidden="true">
        <span className="absolute inset-x-[14%] top-[16%] h-[58%] rounded-lg border border-white/18 bg-white/5" />
        <span className="absolute inset-x-[22%] top-[27%] h-[2px] bg-white/18" />
        <span className="absolute inset-x-[22%] top-[38%] h-[2px] bg-white/18" />
        <span className="absolute bottom-[15%] left-1/2 grid h-12 w-12 -translate-x-1/2 place-items-center rounded-full bg-[#f9dc0b] text-[#1A1A1A]">
          <Icon className="h-6 w-6 stroke-[1.8]" />
        </span>
      </div>
    );
  }

  if (artwork === "movie") {
    return (
      <div className="relative h-full overflow-hidden bg-[#1A1A1A] text-[#F8F5E8]" aria-hidden="true">
        <span className="absolute left-[12%] top-[14%] h-[62%] w-[72%] border border-[#F8F5E8]/28" />
        <span className="absolute left-[20%] top-[22%] h-[62%] w-[72%] border border-[#F8F5E8]/12" />
        <span className="absolute left-[12%] top-[14%] h-8 w-[2px] bg-[#f9dc0b]" />
        <span className="absolute left-[12%] top-[14%] h-[2px] w-8 bg-[#f9dc0b]" />
        <span className="absolute bottom-[24%] right-[8%] h-8 w-[2px] bg-[#f9dc0b]" />
        <span className="absolute bottom-[24%] right-[8%] h-[2px] w-8 bg-[#f9dc0b]" />
        <span className="absolute bottom-0 left-0 h-[18%] w-full bg-[#f9dc0b]" />
        <Icon className="absolute left-1/2 top-[44%] h-9 w-9 -translate-x-1/2 -translate-y-1/2 stroke-[1.5] sm:h-11 sm:w-11" />
      </div>
    );
  }

  if (artwork === "radar") {
    return (
      <div className="relative h-full overflow-hidden bg-[#f9dc0b] text-[#1A1A1A]" aria-hidden="true">
        <span className="absolute left-1/2 top-1/2 h-[76%] w-[76%] -translate-x-1/2 -translate-y-1/2 rounded-full border border-[#1A1A1A]/22" />
        <span className="absolute left-1/2 top-1/2 h-[48%] w-[48%] -translate-x-1/2 -translate-y-1/2 rounded-full border border-[#1A1A1A]/30" />
        <span className="absolute left-1/2 top-1/2 h-[20%] w-[20%] -translate-x-1/2 -translate-y-1/2 rounded-full border border-[#1A1A1A]/38" />
        <span className="absolute left-1/2 top-1/2 h-[1px] w-[36%] origin-left -rotate-[42deg] bg-[#1A1A1A]/75" />
        <span className="absolute right-[21%] top-[25%] h-3 w-3 rounded-full border-[3px] border-[#f9dc0b] bg-[#1A1A1A] sm:h-3.5 sm:w-3.5" />
        <Icon className="absolute bottom-[13%] left-[11%] h-5 w-5 stroke-[1.8] sm:h-6 sm:w-6" />
      </div>
    );
  }

  if (artwork === "library") {
    return (
      <div className="relative h-full overflow-hidden bg-[#E9E4D8] text-[#1A1A1A]" aria-hidden="true">
        <span className="absolute bottom-[14%] left-[14%] h-[65%] w-[20%] rounded-t-sm border border-[#1A1A1A]/25 bg-[#F8F5E8]" />
        <span className="absolute bottom-[14%] left-[36%] h-[76%] w-[23%] rounded-t-sm bg-[#1A1A1A]" />
        <span className="absolute bottom-[14%] left-[61%] h-[57%] w-[24%] -rotate-[7deg] origin-bottom rounded-t-sm border border-[#1A1A1A]/20 bg-[#f9dc0b]" />
        <span className="absolute bottom-[21%] left-[41%] h-[2px] w-[13%] bg-[#F8F5E8]/70" />
        <span className="absolute bottom-[28%] left-[41%] h-[2px] w-[10%] bg-[#F8F5E8]/38" />
        <span className="absolute bottom-[16%] left-[9%] h-[2px] w-[82%] bg-[#1A1A1A]/55" />
        <Icon className="absolute right-[11%] top-[10%] h-5 w-5 stroke-[1.7] sm:h-6 sm:w-6" />
      </div>
    );
  }

  if (artwork === "tiktok") {
    // A vertical phone frame with a feed of stacked clips; the live clip is yellow.
    return (
      <div className="relative h-full overflow-hidden bg-[#1A1A1A] text-[#1A1A1A]" aria-hidden="true">
        <span className="absolute left-1/2 top-[10%] h-[80%] w-[46%] -translate-x-1/2 rounded-[14px] border border-[#F8F5E8]/28 p-[6%]">
          <span className="block h-[22%] w-full rounded-md bg-[#F8F5E8]/14" />
          <span className="mt-[8%] grid h-[46%] w-full place-items-center rounded-md bg-[#f9dc0b]">
            <Icon className="h-6 w-6 stroke-[1.8] sm:h-7 sm:w-7" />
          </span>
          <span className="mt-[8%] block h-[14%] w-full rounded-md bg-[#F8F5E8]/14" />
        </span>
        <span className="absolute left-[14%] top-[34%] h-[2px] w-[12%] bg-[#F8F5E8]/30" />
        <span className="absolute right-[14%] top-[58%] h-[2px] w-[12%] bg-[#F8F5E8]/30" />
      </div>
    );
  }

  if (artwork === "prompts") {
    // A fanned stack of prompt cards; the top card carries the yellow signal.
    return (
      <div className="relative h-full overflow-hidden bg-[#E9E4D8] text-[#1A1A1A]" aria-hidden="true">
        <span className="absolute left-[18%] top-[18%] h-[52%] w-[58%] -rotate-[9deg] rounded-lg border border-[#1A1A1A]/20 bg-[#F8F5E8]" />
        <span className="absolute left-[22%] top-[17%] h-[52%] w-[58%] rotate-[5deg] rounded-lg border border-[#1A1A1A]/22 bg-[#F8F5E8]" />
        <span className="absolute left-[20%] top-[20%] flex h-[52%] w-[58%] flex-col gap-[9%] rounded-lg bg-[#1A1A1A] p-[9%]">
          <span className="h-[7%] w-[54%] rounded-full bg-[#f9dc0b]" />
          <span className="h-[5%] w-full rounded-full bg-[#F8F5E8]/35" />
          <span className="h-[5%] w-[82%] rounded-full bg-[#F8F5E8]/35" />
          <span className="h-[5%] w-[64%] rounded-full bg-[#F8F5E8]/35" />
        </span>
        <span className="absolute bottom-[12%] right-[12%] grid h-10 w-10 place-items-center rounded-full bg-[#f9dc0b] text-[#1A1A1A] sm:h-12 sm:w-12">
          <Icon className="h-5 w-5 stroke-[1.8] sm:h-6 sm:w-6" />
        </span>
      </div>
    );
  }

  if (artwork === "rewriter") {
    return (
      <div className="relative h-full overflow-hidden bg-[#1A1A1A] text-[#F8F5E8]" aria-hidden="true">
        <span className="absolute left-[12%] top-[16%] h-[2px] w-[54%] bg-[#F8F5E8]/72" />
        <span className="absolute left-[12%] top-[27%] h-[2px] w-[72%] bg-[#F8F5E8]/30" />
        <span className="absolute left-[12%] top-[38%] h-[2px] w-[62%] bg-[#F8F5E8]/30" />
        <span className="absolute left-[12%] top-[49%] h-[2px] w-[76%] bg-[#F8F5E8]/30" />
        <span className="absolute left-[12%] top-[60%] h-[10%] w-[48%] bg-[#f9dc0b]" />
        <span className="absolute bottom-[13%] right-[12%] grid h-10 w-10 place-items-center rounded-full bg-[#F8F5E8] text-[#1A1A1A] sm:h-12 sm:w-12">
          <Icon className="h-5 w-5 stroke-[1.8] sm:h-6 sm:w-6" />
        </span>
      </div>
    );
  }

  return (
    <div className="relative h-full overflow-hidden bg-[#f9dc0b] text-[#1A1A1A]" aria-hidden="true">
      <div className="absolute inset-x-[10%] top-1/2 flex h-[54%] -translate-y-1/2 items-center justify-between gap-[3px] sm:gap-1">
        {[28, 50, 76, 42, 88, 60, 34, 72, 46, 82, 54].map((height, index) => (
          <span key={`${height}-${index}`} className="w-full rounded-full bg-[#1A1A1A]" style={{ height: `${height}%` }} />
        ))}
      </div>
      <span className="absolute left-1/2 top-1/2 grid h-11 w-11 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-4 border-[#f9dc0b] bg-[#1A1A1A] text-[#f9dc0b] sm:h-[52px] sm:w-[52px]">
        <Icon className="h-5 w-5 stroke-[1.8] sm:h-6 sm:w-6" />
      </span>
    </div>
  );
}

export function ToolsHub({ theme, onOpen, onNavigate }: { theme: "light" | "dark"; onOpen: (view: MainView) => void; onNavigate?: (target: NavTarget) => void }) {
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
          Explore
        </h1>
        <p className={cn("mt-3 max-w-[62ch] text-sm leading-6 sm:text-[15px]", isDark ? "text-[#F8F5E8]/68" : "text-[#1A1A1A]/66")}>
          Every studio and tool in AutoYT. Start with a featured tool, or jump to anything below.
        </p>
      </header>

      <div className="mt-9 grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-5">
        {TOOL_CARDS.map(({ title, description, view, icon: Icon, artwork }) => (
          <button
            key={view}
            type="button"
            onClick={() => onOpen(view)}
            className={cn(
              "group relative flex aspect-[9/16] min-w-0 flex-col overflow-hidden rounded-[18px] border text-left shadow-[0_10px_28px_rgba(26,26,26,0.07)] transition-[transform,border-color,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:shadow-[0_16px_36px_rgba(26,26,26,0.12)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 motion-reduce:transform-none motion-reduce:transition-none",
              isDark
                ? "border-[#F8F5E8]/14 bg-[#171B16] text-[#F8F5E8] hover:border-[#f9dc0b]/48 focus-visible:outline-[#f9dc0b]"
                : "border-[#1A1A1A]/12 bg-[#FFFDF8] text-[#1A1A1A] hover:border-[#1A1A1A]/32 focus-visible:outline-[#8a7500]",
            )}
            aria-label={`Open ${title}`}
          >
            <div className="h-[56%] w-full shrink-0 origin-top overflow-hidden border-b border-[#1A1A1A]/12 transition-transform duration-300 ease-out group-hover:scale-[1.012] motion-reduce:transform-none motion-reduce:transition-none">
              <ToolArtwork artwork={artwork} Icon={Icon} />
            </div>

            <div className="flex min-h-0 flex-1 flex-col p-3 sm:p-4">
              <h2 className="text-[13px] font-bold leading-5 sm:text-[15px]">{title}</h2>
              <p className={cn("mt-1.5 line-clamp-3 text-[10px] leading-[1.55] sm:text-[11px]", isDark ? "text-[#F8F5E8]/68" : "text-[#1A1A1A]/68")}>{description}</p>
              <span
                className={cn(
                  "ml-auto mt-auto grid h-9 w-9 place-items-center rounded-full border transition-[background-color,color,border-color] duration-200 sm:h-10 sm:w-10",
                  isDark
                    ? "border-[#F8F5E8]/16 text-[#f9dc0b] group-hover:border-[#f9dc0b] group-hover:bg-[#f9dc0b] group-hover:text-[#1A1A1A]"
                    : "border-[#1A1A1A]/14 text-[#1A1A1A] group-hover:border-[#1A1A1A] group-hover:bg-[#1A1A1A] group-hover:text-[#f9dc0b]",
                )}
                aria-hidden="true"
              >
                <ArrowUpRight className="h-4 w-4 stroke-[1.8]" />
              </span>
            </div>
          </button>
        ))}
      </div>

      {onNavigate ? (
        <div className="mt-14 space-y-10" aria-label="Everything in AutoYT">
          <h2 className={cn("text-[22px] font-extrabold tracking-[-0.02em]", isDark ? "text-[#F8F5E8]" : "text-[#1A1A1A]")}>Everything in AutoYT</h2>
          {NAV_GROUPS.map((group) => (
            <section key={group.id} aria-labelledby={`explore-${group.id}`}>
              <h3 id={`explore-${group.id}`} className={cn("mb-3 text-[13px] font-semibold", isDark ? "text-[#F8F5E8]/55" : "text-[#1A1A1A]/55")}>
                {group.label}
              </h3>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {group.columns.flatMap((column) => column.entries).map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => onNavigate(entry.target)}
                    className={cn(
                      "group flex min-w-0 items-center gap-3 rounded-2xl p-3 text-left transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2",
                      isDark ? "bg-white/[0.04] hover:bg-white/[0.08] focus-visible:outline-[#f9dc0b]" : "bg-white hover:bg-[#F2F0EB] focus-visible:outline-[#8a7500]",
                    )}
                  >
                    <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-xl transition-colors duration-150 group-hover:bg-[#f9dc0b] group-hover:text-[#171717]", isDark ? "bg-white/[0.06] text-[#F8F5E8]" : "bg-[#F2F0EB] text-[#1A1A1A]")}>
                      {entry.icon}
                    </span>
                    <span className="min-w-0">
                      <span className={cn("block truncate text-sm font-semibold", isDark ? "text-[#F8F5E8]" : "text-[#1A1A1A]")}>{entry.label}</span>
                      <span className={cn("block truncate text-[12.5px]", isDark ? "text-[#F8F5E8]/58" : "text-[#1A1A1A]/58")}>{entry.description}</span>
                    </span>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : null}
    </section>
  );
}
