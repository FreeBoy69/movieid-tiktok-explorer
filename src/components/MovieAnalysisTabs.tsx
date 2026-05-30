import { Children, useState } from "react";
import type { ReactNode } from "react";
import {
  ExternalLink,
  Film,
  Info,
  MessageCircle,
  Sparkles,
  Target,
  TrendingUp,
  Zap,
  Clapperboard,
  ScrollText,
  Layers3,
  Eye,
  Megaphone,
  Users,
  Youtube,
} from "lucide-react";
import { cn } from "../lib/utils";
import type { MovieResult } from "../types";
import { getMovieIdentificationSourceDisplay } from "../utils/movieIdentificationSource.js";
import { findRelatedNiches, getTrendingNiches, NICHE_DATABASE } from "../data/niches";

const C = {
  bg: "#F5F4F0",
  bgCard: "#FDFCFA",
  bgMuted: "#EEECEA",
  border: "rgba(28,26,22,0.08)",
  text: "#1C1A16",
  textMuted: "rgba(28,26,22,0.52)",
  accent: "#CF7255",
  accentBg: "rgba(207,114,85,0.1)",
} as const;

export type MainTab = "post" | "movie" | "transcript" | "story" | "visuals" | "niche" | "evidence" | "details";

const tabs = [
  ["movie", "Movie ID", Clapperboard],
  ["transcript", "Transcript", ScrollText],
  ["story", "Story", Layers3],
  ["visuals", "Visuals", Eye],
  ["niche", "Niche", Target],
  ["evidence", "Evidence", Info],
  ["details", "Details", Users],
] as const;

export function MovieAnalysisTabs({
  result,
  savedAt,
  compact = false,
  hideTabs = false,
  postContent,
  postLabel = "Post",
  initialTab,
  activeTab,
  onTabChange,
  onUploadToYoutube,
}: {
  result: MovieResult;
  savedAt?: number;
  compact?: boolean;
  hideTabs?: boolean;
  postContent?: ReactNode;
  postLabel?: string;
  initialTab?: MainTab;
  activeTab?: MainTab;
  onTabChange?: (tab: MainTab) => void;
  onUploadToYoutube?: () => void;
}) {
  const [internalActiveTab, setInternalActiveTab] = useState<MainTab>(initialTab || (postContent ? "post" : "movie"));
  const currentTab = activeTab || internalActiveTab;
  const handleTabChange = (tab: MainTab) => {
    if (onTabChange) onTabChange(tab);
    else setInternalActiveTab(tab);
  };
  const transcript = result.transcript;
  const va = result.videoAnalysis;
  const transcriptText = transcript?.fullText || transcript?.excerpt || result.evidence.audio || "";
  const phases = va?.framework?.climaxLine?.phases || [];

  const rewrite = () => {
    window.dispatchEvent(
      new CustomEvent("navToRewriter", {
        detail: {
          transcript: transcriptText,
          phases,
        },
      }),
    );
  };

  if (hideTabs) {
    return (
      <div className="w-full max-w-full overflow-x-hidden px-4 py-4 md:px-5 md:py-5">
        {currentTab === "post" && postContent}
        {currentTab === "movie" && <MovieTab result={result} savedAt={savedAt} onRewrite={rewrite} onUploadToYoutube={onUploadToYoutube} />}
        {currentTab === "transcript" && (
          <TabbedPage nav={[["copy", "Transcript"], ["hooks", "Hooks"], ["style", "Content notes"]]}>
            <Panel id="copy" title="Transcript" action={<SmallAction onClick={rewrite}>Rewrite</SmallAction>}>
              <TextBlock text={transcriptText || "No transcript was returned for this clip."} />
            </Panel>
            <Panel id="hooks" title="Hooks">
              <ListPanel items={transcript?.hooks} fallback={["No hooks were returned for this clip."]} />
            </Panel>
            <Panel id="style" title="Content notes">
              <div className="grid gap-3 md:grid-cols-2">
                <ListPanel title="Content style" items={transcript?.contentStyle} fallback={["No content style notes were returned."]} />
                <ListPanel title="Structure" items={transcript?.structure} fallback={["No structure notes were returned."]} />
              </div>
            </Panel>
          </TabbedPage>
        )}
        {currentTab === "story" && <StoryTab result={result} />}
        {currentTab === "visuals" && <VisualsTab result={result} />}
        {currentTab === "niche" && <NicheTab result={result} />}
        {currentTab === "evidence" && <EvidenceTab result={result} />}
        {currentTab === "details" && <DetailsTab result={result} />}
      </div>
    );
  }

  return (
    <div className="w-full max-w-full overflow-hidden rounded-xl border shadow-sm" style={{ background: C.bgCard, borderColor: C.border }}>
      <div className="border-b p-2" style={{ background: C.bg, borderColor: C.border }}>
        <div className="flex gap-1 overflow-x-auto overscroll-x-contain [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {postContent && (
            <button
              type="button"
              onClick={() => handleTabChange("post")}
              className="inline-flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition-all md:px-4"
              style={currentTab === "post" ? { background: C.text, color: "#fff" } : { color: C.textMuted }}
            >
              <Film className="h-3.5 w-3.5" />
              {postLabel}
            </button>
          )}
          {tabs.map(([tab, label, Icon]) => (
            <button
              key={tab}
              type="button"
              onClick={() => handleTabChange(tab)}
              className="inline-flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition-all md:px-4"
              style={currentTab === tab ? { background: C.text, color: "#fff" } : { color: C.textMuted }}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className={cn("max-w-full overflow-hidden", compact ? "p-4 md:p-5" : "p-5 md:p-7")}>
        {currentTab === "post" && postContent}
        {currentTab === "movie" && <MovieTab result={result} savedAt={savedAt} onRewrite={rewrite} onUploadToYoutube={onUploadToYoutube} />}
        {currentTab === "transcript" && (
          <TabbedPage
            nav={[
              ["copy", "Transcript"],
              ["hooks", "Hooks"],
              ["style", "Content notes"],
            ]}
          >
            <Panel id="copy" title="Transcript" action={<SmallAction onClick={rewrite}>Rewrite</SmallAction>}>
              <TextBlock text={transcriptText || "No transcript was returned for this clip."} />
            </Panel>
            <Panel id="hooks" title="Hooks">
              <ListPanel items={transcript?.hooks} fallback={["No hooks were returned for this clip."]} />
            </Panel>
            <Panel id="style" title="Content notes">
              <div className="grid gap-3 md:grid-cols-2">
                <ListPanel title="Content style" items={transcript?.contentStyle} fallback={["No content style notes were returned."]} />
                <ListPanel title="Structure" items={transcript?.structure} fallback={["No structure notes were returned."]} />
              </div>
            </Panel>
          </TabbedPage>
        )}
        {currentTab === "story" && <StoryTab result={result} />}
        {currentTab === "visuals" && <VisualsTab result={result} />}
        {currentTab === "niche" && <NicheTab result={result} />}
        {currentTab === "evidence" && <EvidenceTab result={result} />}
        {currentTab === "details" && <DetailsTab result={result} />}
      </div>
    </div>
  );
}

function sourceBadgeStyle(source: string) {
  switch (source) {
    case "comment-reply":
      return { background: "rgba(22,163,74,0.12)", color: "#15803d", border: "rgba(22,163,74,0.24)" };
    case "comment-corpus":
      return { background: "rgba(13,148,136,0.12)", color: "#0f766e", border: "rgba(13,148,136,0.24)" };
    case "cache":
      return { background: "rgba(28,26,22,0.06)", color: C.textMuted, border: C.border };
    case "ai-video":
    default:
      return { background: "rgba(124,58,237,0.12)", color: "#6d28d9", border: "rgba(124,58,237,0.24)" };
  }
}

function IdentificationSourceBadge({ result, prominent = false }: { result: MovieResult; prominent?: boolean }) {
  const display = getMovieIdentificationSourceDisplay(result);
  const style = sourceBadgeStyle(display.source);
  return (
    <div
      className={cn("inline-flex max-w-full flex-col gap-1 rounded-xl border px-3 py-2", prominent ? "w-full" : "w-fit")}
      style={{ background: style.background, borderColor: style.border }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Sparkles className="h-3.5 w-3.5 shrink-0" style={{ color: style.color }} />
        <span className="text-[11px] font-black uppercase tracking-widest" style={{ color: style.color }}>
          Source: {display.label}
        </span>
      </div>
      <p className={cn("leading-5", prominent ? "text-sm" : "text-xs")} style={{ color: C.textMuted }}>
        {display.detail}
      </p>
      {result.commentHint?.replyText && (display.source === "comment-reply" || display.source === "comment-corpus") ? (
        <p className="text-xs italic leading-5" style={{ color: C.text }}>
          “{result.commentHint.replyText}”
        </p>
      ) : null}
    </div>
  );
}

function MovieTab({
  result,
  savedAt,
  onRewrite,
  onUploadToYoutube,
}: {
  result: MovieResult;
  savedAt?: number;
  onRewrite: () => void;
  onUploadToYoutube?: () => void;
}) {
  const tmdb = result.tmdb;
  const mal = result.mal;
  const mediaLabel = mal?.type ? (mal.type === "manga" ? "Manga / Manhwa" : "Anime") : tmdb?.mediaType === "tv" ? "TV / Series" : tmdb?.mediaType ? "Movie" : result.mediaType;
  return (
    <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(180px,220px)]">
      <div className="space-y-5">
        <IdentificationSourceBadge result={result} prominent />
        <div className="flex flex-wrap gap-2">
          <Pill>Confidence {Math.round((result.confidence || 0) * 100)}%</Pill>
          {mediaLabel && <Pill muted>{mediaLabel}</Pill>}
          {result.year && <Pill muted>{result.year}</Pill>}
          {savedAt && <Pill muted>Saved {new Date(savedAt).toLocaleDateString()}</Pill>}
        </div>
        <div>
          <h2 className="font-serif text-3xl font-bold leading-tight md:text-4xl" style={{ color: C.text }}>
            {result.title}
          </h2>
          <p className="mt-2 text-sm" style={{ color: C.textMuted }}>
            {result.director || tmdb?.director || "Director unknown"}
            {result.year ? `, ${result.year}` : ""}
          </p>
        </div>
        <p className="max-w-3xl text-base leading-7" style={{ color: C.textMuted }}>
          {tmdb?.overview || mal?.synopsis || result.summary || "No overview available."}
        </p>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={onRewrite}
            className="inline-flex items-center gap-2 rounded-lg px-5 py-3 text-sm font-bold text-white shadow-lg transition-all hover:bg-[#1A1A1A]"
            style={{ background: C.accent, boxShadow: `0 8px 20px ${C.accent}33` }}
          >
            <Zap className="h-4 w-4" />
            Rewrite script
          </button>
          {onUploadToYoutube && (
            <button
              type="button"
              onClick={onUploadToYoutube}
              className="inline-flex items-center gap-2 rounded-lg px-5 py-3 text-sm font-bold text-white shadow-lg transition-all hover:bg-[#b91c1c]"
              style={{ background: "#FF0000", boxShadow: "0 8px 20px rgba(255, 0, 0, 0.25)" }}
            >
              <Youtube className="h-4 w-4" />
              Upload to YouTube
            </button>
          )}
          {result.imdbUrl && <AnalysisLink href={result.imdbUrl} label="Open IMDb" />}
          {tmdb?.tmdbUrl && <AnalysisLink href={tmdb.tmdbUrl} label="Open TMDB" />}
          {mal?.url && <AnalysisLink href={mal.url} label="Open MAL" />}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-[110px_1fr] lg:block">
        <Poster result={result} />
        <div className="mt-0 grid grid-cols-2 gap-3 lg:mt-5">
          <Metric label="Rating" value={tmdb?.rating ? `${tmdb.rating.toFixed(1)}/10` : mal?.score ? `${mal.score.toFixed(1)}/10` : "N/A"} />
          <Metric label="Runtime" value={tmdb?.runtime ? `${tmdb.runtime} min` : "N/A"} />
          <Metric label={mal?.type === "manga" ? "Chapters" : "Votes"} value={mal?.chapters ? mal.chapters.toLocaleString() : tmdb?.voteCount ? tmdb.voteCount.toLocaleString() : "N/A"} />
          <Metric label="Release" value={tmdb?.releaseDate || mal?.startDate || result.year || "N/A"} />
        </div>
      </div>
    </div>
  );
}

function StoryTab({ result }: { result: MovieResult }) {
  const va = result.videoAnalysis;
  const phases = va?.framework?.climaxLine?.phases || [];
  const standards = va?.framework?.scriptStandards;
  return (
    <TabbedPage nav={[["overview", "Overview"], ["phases", "Phases"], ["standards", "Script rules"]]}>
      <Panel id="overview" title="Story overview">
        {va?.framework?.climaxLine?.name || va?.framework?.climaxLine?.description ? (
          <InfoBox>
            {va.framework.climaxLine.name && <p className="font-semibold" style={{ color: C.text }}>{va.framework.climaxLine.name}</p>}
            {va.framework.climaxLine.description && <p className="mt-1 text-sm leading-6" style={{ color: C.textMuted }}>{va.framework.climaxLine.description}</p>}
          </InfoBox>
        ) : (
          <EmptyNote>Narrative structure could not be parsed for this video.</EmptyNote>
        )}
      </Panel>
      <Panel id="phases" title="Story phases">
        {phases.length ? <PhaseList phases={phases} /> : <EmptyNote>Narrative phases were not returned.</EmptyNote>}
      </Panel>
      <Panel id="standards" title="Script rules">
        {standards ? (
          <div className="grid gap-3">
            <InfoBox>
              <p className="text-sm font-semibold" style={{ color: C.text }}>Follows script rules: {standards.followsRules ? "Yes" : "No"}</p>
              {standards.notes && <p className="mt-2 text-sm leading-6" style={{ color: C.textMuted }}>{standards.notes}</p>}
            </InfoBox>
            {standards.draftScript && <TextBlock title="Draft version" text={standards.draftScript} />}
            {standards.finalScript && <TextBlock title="Final approved copy" text={standards.finalScript} emphasized />}
          </div>
        ) : (
          <EmptyNote>No script rules analysis was returned.</EmptyNote>
        )}
      </Panel>
    </TabbedPage>
  );
}

function VisualsTab({ result }: { result: MovieResult }) {
  const va = result.videoAnalysis;
  return (
    <TabbedPage nav={[["style", "Style"], ["strategy", "Strategy"], ["pillars", "Pillars"]]}>
      <Panel id="style" title="Visual style">
        <div className="grid gap-3 md:grid-cols-3">
          <Detail label="Editing pacing" value={va?.visualStyle?.editingPacing || "N/A"} />
          <Detail label="Visual identity" value={va?.visualStyle?.visualIdentity || "N/A"} />
          <Detail label="Production style" value={va?.visualStyle?.productionStyle || "N/A"} />
        </div>
      </Panel>
      <Panel id="strategy" title="Content strategy">
        <Detail label="Emotional trigger" value={va?.formula?.whyFactor || "N/A"} />
      </Panel>
      <Panel id="pillars" title="Projected pillars">
        <ListPanel items={va?.formula?.pillars} fallback={["Not enough data to reverse engineer pillars."]} />
      </Panel>
    </TabbedPage>
  );
}

function NicheTab({ result }: { result: MovieResult }) {
  const niche = result.contentNiche;
  const primaryText = niche?.primary || "Movie recap / cinematic mystery clips";
  const dbMatches = findRelatedNiches(primaryText, 6);
  const trending = getTrendingNiches().slice(0, 4);
  return (
    <TabbedPage nav={[["overview", "Overview"], ["matches", "Matches"], ["trending", "Trending"], ["opportunities", "Opportunities"]]}>
      <Panel id="overview" title="Audience & niche">
        <div className="grid gap-3 md:grid-cols-2">
          <Detail label="Primary niche" value={primaryText} />
          <Detail label="Platform fit" value={niche?.platforms?.join(", ") || "TikTok, YouTube Shorts, Instagram Reels"} />
          <Detail label="Audience" value={niche?.audience || "Viewers looking for fast movie discovery, plot twists, and title identification."} />
          <Detail label="Why it works" value={niche?.rationale || result.evidence.reasoning || "Recognisable visual and audio clues trigger search intent around the movie title."} />
        </div>
      </Panel>
      <Panel id="matches" title="Matched niches">
        {dbMatches.length ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {dbMatches.map((n) => (
              <InfoBox key={n.id}>
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-bold leading-snug" style={{ color: C.text }}>{n.name}</p>
                  {n.trending && <span className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold" style={{ background: C.accentBg, color: C.accent }}><TrendingUp className="h-3 w-3" />Hot</span>}
                </div>
                <p className="mt-1 text-xs" style={{ color: C.textMuted }}>{n.category}</p>
                <p className="mt-2 text-xs leading-relaxed" style={{ color: C.textMuted }}>{n.why}</p>
              </InfoBox>
            ))}
          </div>
        ) : (
          <EmptyNote>No database niche matches were returned.</EmptyNote>
        )}
        <p className="mt-3 text-xs" style={{ color: C.textMuted }}>{NICHE_DATABASE.length} niches indexed</p>
      </Panel>
      <Panel id="trending" title="Trending niches">
        <ListPanel items={trending.map((n) => `${n.name} - ${n.category}`)} />
      </Panel>
      <Panel id="opportunities" title="Adjacent opportunities">
        <ListPanel items={[...(niche?.secondary || []), ...(niche?.opportunities || [])]} fallback={["No adjacent opportunities were returned."]} />
      </Panel>
    </TabbedPage>
  );
}

function EvidenceTab({ result }: { result: MovieResult }) {
  return (
    <TabbedPage nav={[["source", "Source"], ["audio", "Audio"], ["visual", "Visual"], ["reasoning", "Reasoning"]]}>
      <Panel id="source" title="Identification source">
        <IdentificationSourceBadge result={result} prominent />
      </Panel>
      <Panel id="audio" title="Audio clues">
        <EvidenceCard icon={<MessageCircle className="h-5 w-5" />} title="Audio clues" content={result.evidence.audio} />
      </Panel>
      <Panel id="visual" title="Visual clues">
        <EvidenceCard icon={<Film className="h-5 w-5" />} title="Visual clues" content={result.evidence.visual} />
      </Panel>
      <Panel id="reasoning" title="Reasoning">
        <EvidenceCard icon={<Zap className="h-5 w-5" />} title="Reasoning" content={result.evidence.reasoning} />
      </Panel>
    </TabbedPage>
  );
}

function DetailsTab({ result }: { result: MovieResult }) {
  const tmdb = result.tmdb;
  const mal = result.mal;
  return (
    <TabbedPage nav={mal ? [["movie", "Title details"], ["mal", "MAL"], ["cast", "Cast"]] : [["movie", "Movie details"], ["cast", "Cast"]]}>
      <Panel id="movie" title={mal ? "Title details" : "Movie details"}>
        <div className="grid gap-3 md:grid-cols-2">
          <Detail label="Original title" value={mal?.originalTitle || tmdb?.originalTitle || tmdb?.title || result.title} />
          <Detail label={tmdb?.mediaType === "tv" ? "Creator" : "Director"} value={tmdb?.director || result.director || "N/A"} />
          <Detail label="Media type" value={mal?.mediaType || (tmdb?.mediaType === "tv" ? "TV / Series" : tmdb?.mediaType ? "Movie" : result.mediaType || "N/A")} />
          <Detail label="Genres" value={mal?.genres?.join(", ") || tmdb?.genres?.join(", ") || "N/A"} />
          <Detail label="Status" value={mal?.status || tmdb?.status || "N/A"} />
          <Detail label="Countries" value={tmdb?.countries?.join(", ") || "N/A"} />
        </div>
      </Panel>
      {mal && (
        <Panel id="mal" title="MyAnimeList details">
          <div className="grid gap-3 md:grid-cols-2">
            <Detail label="English title" value={mal.englishTitle || "N/A"} />
            <Detail label="MAL type" value={mal.type || "N/A"} />
            <Detail label="Score" value={mal.score ? `${mal.score.toFixed(1)}/10` : "N/A"} />
            <Detail label="Start date" value={mal.startDate || "N/A"} />
            <Detail label="Episodes" value={mal.episodes ? String(mal.episodes) : "N/A"} />
            <Detail label="Chapters / volumes" value={[mal.chapters ? `${mal.chapters} chapters` : "", mal.volumes ? `${mal.volumes} volumes` : ""].filter(Boolean).join(", ") || "N/A"} />
          </div>
          {mal.synopsis ? <TextBlock title="Synopsis" text={mal.synopsis} /> : null}
        </Panel>
      )}
      <Panel id="cast" title="Cast">
        {tmdb?.cast?.length ? <CastGrid cast={tmdb.cast} /> : <EmptyNote>TMDB did not return cast details.</EmptyNote>}
      </Panel>
    </TabbedPage>
  );
}

function TabbedPage({ nav, children }: { nav: [string, string][]; children: ReactNode }) {
  const [activeSection, setActiveSection] = useState(nav[0]?.[0] || "");
  const panels = Children.toArray(children);
  const activeIndex = Math.max(0, nav.findIndex(([id]) => id === activeSection));
  const activePanel = panels[activeIndex] ?? panels[0] ?? null;

  return (
    <div className="grid min-w-0 gap-5 lg:grid-cols-[170px_minmax(0,1fr)]">
      <aside className="lg:sticky lg:top-4 lg:self-start">
        <div className="flex gap-2 overflow-x-auto overscroll-x-contain rounded-lg border p-2 lg:flex-col lg:overflow-visible [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" style={{ background: C.bg, borderColor: C.border }}>
          {nav.map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setActiveSection(id)}
              className="shrink-0 rounded-md px-3 py-2 text-left text-xs font-semibold transition-colors hover:bg-white"
              style={activeSection === id ? { background: "#fff", color: C.text, boxShadow: "0 1px 3px rgba(0,0,0,0.06)" } : { color: C.textMuted }}
            >
              {label}
            </button>
          ))}
        </div>
      </aside>
      <div className="min-w-0">{activePanel}</div>
    </div>
  );
}

function Panel({ id, title, action, children }: { id: string; title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 rounded-xl border p-5" style={{ background: C.bgCard, borderColor: C.border }}>
      <div className="mb-4 flex items-center gap-3">
        <h3 className="font-serif text-2xl font-bold" style={{ color: C.text }}>{title}</h3>
        {action && <div className="ml-auto">{action}</div>}
      </div>
      <div className="grid gap-4">{children}</div>
    </section>
  );
}

function Poster({ result }: { result: MovieResult }) {
  return (
    <div className="aspect-[2/3] w-full overflow-hidden rounded-lg shadow-sm" style={{ background: C.bg }}>
      {result.posterUrl ? (
        <img src={result.posterUrl} alt={`${result.title} poster`} className="h-full w-full object-cover" referrerPolicy="no-referrer" />
      ) : (
        <div className="flex h-full w-full items-center justify-center" style={{ color: C.accent + "55" }}>
          <Film className="h-8 w-8" />
        </div>
      )}
    </div>
  );
}

function PhaseList({ phases }: { phases: { timeRange: string; label: string; explanation: string }[] }) {
  return (
    <div className="grid gap-3">
      {phases.map((phase, i) => (
        <div key={`${phase.timeRange}-${i}`} className="grid gap-3 rounded-lg p-4 md:grid-cols-[90px_1fr]" style={{ background: C.bg, border: `1px solid ${C.border}` }}>
          <span className="h-fit rounded-md px-2 py-1 text-xs font-bold" style={{ background: C.accentBg, color: C.accent }}>{phase.timeRange}</span>
          <div>
            <p className="font-semibold" style={{ color: C.text }}>{phase.label}</p>
            <p className="mt-1 text-sm leading-6" style={{ color: C.textMuted }}>{phase.explanation}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function CastGrid({ cast }: { cast: NonNullable<NonNullable<MovieResult["tmdb"]>["cast"]> }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {cast.map((p) => (
        <div key={`${p.name}-${p.character}`} className="flex gap-3 rounded-lg p-3" style={{ background: C.bg, border: `1px solid ${C.border}` }}>
          <div className="h-16 w-12 shrink-0 overflow-hidden rounded-lg" style={{ background: C.bgMuted }}>
            {p.profileUrl ? <img src={p.profileUrl} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" /> : <div className="flex h-full w-full items-center justify-center" style={{ color: C.textMuted }}><Film className="h-5 w-5" /></div>}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold" style={{ color: C.text }}>{p.name}</p>
            <p className="mt-1 line-clamp-2 text-xs" style={{ color: C.textMuted }}>{p.character || "Cast"}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function Pill({ children, muted = false }: { children: ReactNode; muted?: boolean }) {
  return <span className="rounded-full px-2.5 py-1 text-xs font-bold" style={muted ? { background: C.bgMuted, color: C.textMuted } : { background: C.accentBg, color: C.accent }}>{children}</span>;
}

function AnalysisLink({ href, label }: { href: string; label: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-lg border px-5 py-3 text-sm font-semibold hover:bg-[#1A1A1A]/5" style={{ color: C.text, borderColor: C.border }}>
      {label} <ExternalLink className="h-4 w-4" />
    </a>
  );
}

function SmallAction({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="rounded-lg px-3 py-2 text-xs font-bold text-white transition-colors hover:bg-[#1A1A1A]" style={{ background: C.accent }}>
      {children}
    </button>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg p-3" style={{ background: C.bg, border: `1px solid ${C.border}` }}>
      <p className="text-xs" style={{ color: C.textMuted }}>{label}</p>
      <p className="mt-1 font-serif text-lg font-bold" style={{ color: C.text }}>{value}</p>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg p-4" style={{ background: C.bg, border: `1px solid ${C.border}` }}>
      <p className="text-xs font-bold" style={{ color: C.accent }}>{label}</p>
      <p className="mt-2 break-words text-sm leading-relaxed" style={{ color: C.textMuted }}>{value}</p>
    </div>
  );
}

function InfoBox({ children }: { children: ReactNode }) {
  return <div className="rounded-lg p-4" style={{ background: C.bg, border: `1px solid ${C.border}` }}>{children}</div>;
}

function TextBlock({ title, text, emphasized = false }: { title?: string; text: string; emphasized?: boolean }) {
  return (
    <div className="rounded-lg p-4" style={{ background: emphasized ? C.accentBg : C.bg, border: `1px solid ${emphasized ? C.accent + "55" : C.border}` }}>
      {title && <p className="mb-3 text-xs font-bold" style={{ color: emphasized ? C.accent : C.textMuted }}>{title}</p>}
      <p className="max-w-full break-words whitespace-pre-wrap text-sm leading-7" style={{ color: emphasized ? C.text : C.textMuted }}>{text}</p>
    </div>
  );
}

function ListPanel({ title, items, fallback }: { title?: string; items?: string[]; fallback?: string[] }) {
  const values = items?.length ? items : fallback || [];
  if (!values.length) return null;
  return (
    <div className="rounded-lg p-4" style={{ background: C.bg, border: `1px solid ${C.border}` }}>
      {title && <p className="text-sm font-semibold" style={{ color: C.text }}>{title}</p>}
      <div className={cn("grid gap-2", title && "mt-3")}>
        {values.map((item, i) => (
          <div key={i} className="flex gap-3 rounded-lg p-3 text-sm leading-6" style={{ background: C.bgCard, color: C.textMuted }}>
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0" style={{ color: C.accent }} />
            <span className="min-w-0 break-words">{item}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function EvidenceCard({ icon, title, content }: { icon: ReactNode; title: string; content: string }) {
  return (
    <div className="rounded-lg p-5" style={{ background: C.bg, border: `1px solid ${C.border}` }}>
      <div className="flex items-center gap-3" style={{ color: C.accent }}>
        <div className="flex h-9 w-9 items-center justify-center rounded-lg" style={{ background: C.accentBg }}>{icon}</div>
        <h4 className="text-sm font-semibold">{title}</h4>
      </div>
      <p className="mt-4 break-words text-sm leading-7" style={{ color: C.textMuted }}>{content}</p>
    </div>
  );
}

function EmptyNote({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border border-dashed p-5 text-sm" style={{ background: C.bg, borderColor: C.border, color: C.textMuted }}>{children}</p>;
}
