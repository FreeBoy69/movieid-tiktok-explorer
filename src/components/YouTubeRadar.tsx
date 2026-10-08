import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  Bookmark,
  BookmarkCheck,
  Bot,
  Clock3,
  Compass,
  Flame,
  Loader2,
  PlaySquare,
  Radar,
  Search,
  SlidersHorizontal,
  Sparkles,
  TrendingUp,
  Users,
} from "lucide-react";
import { YouTubeRadarCompetitor, YouTubeRadarNiche, YouTubeRadarResult, YouTubeRadarVideo } from "../types";
import { cn } from "../lib/utils";
import { useErrorToast } from "../utils/toast";
import { StandardChannelCard, StandardVideoCard } from "./StandardCards";
import { EmptyState as SharedEmptyState } from "./ui/controls";

type RadarTab = "discover" | "competitors" | "outliers" | "niches" | "saved";
type SourceMode = "search" | "viral";

const SAVED_KEY = "movieid-youtube-radar-saved";

const REGION_OPTIONS: Array<[string, string]> = [
  ["US", "United States"],
  ["GB", "United Kingdom"],
  ["CA", "Canada"],
  ["AU", "Australia"],
  ["IN", "India"],
];
const AGE_OPTIONS: Array<[string, string]> = [
  ["7", "7 days"],
  ["30", "30 days"],
  ["90", "90 days"],
  ["180", "6 months"],
  ["365", "1 year"],
];
const DURATION_OPTIONS: Array<[string, string]> = [
  ["any", "Any"],
  ["short", "Short"],
  ["medium", "4-20 min"],
  ["long", "20+ min"],
];
const SORT_OPTIONS: Array<[string, string]> = [
  ["opportunity", "Best match"],
  ["viewCount", "Views"],
  ["date", "Newest"],
  ["relevance", "Relevant"],
];
const DEPTH_OPTIONS: Array<[string, string]> = [
  ["15", "15 videos"],
  ["30", "30 videos"],
  ["50", "50 videos"],
];

function compactNumber(value: number): string {
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value || 0);
}

function dateAge(value: string): string {
  if (!value) return "unknown";
  const hours = Math.max(1, Math.round((Date.now() - new Date(value).getTime()) / 36e5));
  if (hours < 48) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 60) return `${days}d ago`;
  return `${Math.round(days / 30)}mo ago`;
}

function formatVideoDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds || 0));
  if (!s) return "";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

function scoreTone(score: number): string {
  if (score >= 75) return "text-[var(--ui-accent-text)] bg-[var(--ui-accent-soft)] border-[var(--ui-accent)]/18";
  if (score >= 50) return "text-[var(--ui-accent-text)] bg-[var(--ui-accent)]/10 border-[var(--ui-accent)]/15";
  return "text-[var(--ui-text)]/55 bg-[var(--ui-text)]/5 border-[var(--ui-line)]";
}

export function YouTubeRadar() {
  const [sourceMode, setSourceMode] = useState<SourceMode>("search");
  const [searchQuery, setSearchQuery] = useState("faceless movie recaps");
  const [viralFilter, setViralFilter] = useState("");
  const [maxResults, setMaxResults] = useState(30);
  const [regionCode, setRegionCode] = useState("US");
  const [duration, setDuration] = useState("any");
  const [publishedAfterDays, setPublishedAfterDays] = useState(7);
  const [order, setOrder] = useState("opportunity");
  const [activeTab, setActiveTab] = useState<RadarTab>("discover");
  const [result, setResult] = useState<YouTubeRadarResult | null>(null);
  const [saved, setSaved] = useState<YouTubeRadarVideo[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  useErrorToast(error, () => setError(""));

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(SAVED_KEY);
      if (raw) setSaved(JSON.parse(raw));
    } catch {
      /* ignore corrupt local research state */
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(SAVED_KEY, JSON.stringify(saved));
  }, [saved]);

  const outliers = useMemo(() => {
    return (result?.videos || []).filter((video) => video.outlierScore >= 55 || Number(video.discoveryScore || 0) >= 65);
  }, [result]);

  const selectedVideos = activeTab === "saved" ? saved : activeTab === "outliers" ? outliers : result?.videos || [];

  const runScan = useCallback(
    async (nextQuery?: string) => {
      const clean = (nextQuery !== undefined ? nextQuery : searchQuery).trim();
      setIsLoading(true);
      setError("");
      setSearchQuery(clean);
      try {
        const response = await fetch("/api/youtube/radar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode: "search",
            query: clean,
            maxResults,
            regionCode,
            relevanceLanguage: "en",
            order,
            duration,
            publishedAfterDays,
          }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error((data as { error?: string }).error || "YouTube radar scan failed");
        setResult(data as YouTubeRadarResult);
        setActiveTab("discover");
      } catch (err) {
        setError(err instanceof Error ? err.message : "YouTube radar scan failed");
      } finally {
        setIsLoading(false);
      }
    },
    [searchQuery, maxResults, regionCode, order, duration, publishedAfterDays],
  );

  const runTrending = useCallback(async () => {
    setIsLoading(true);
    setError("");
    try {
      const response = await fetch("/api/youtube/radar?trending=1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "trending",
          trending: true,
          query: viralFilter.trim(),
          maxResults,
          regionCode,
          relevanceLanguage: "en",
          order,
          duration,
          publishedAfterDays,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error((data as { error?: string }).error || "Viral load failed");
      setResult(data as YouTubeRadarResult);
      setActiveTab("discover");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Viral load failed");
    } finally {
      setIsLoading(false);
    }
  }, [viralFilter, maxResults, regionCode, order, duration, publishedAfterDays]);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void runScan(undefined);
  }

  function toggleSaved(video: YouTubeRadarVideo) {
    setSaved((current) => {
      if (current.some((item) => item.id === video.id)) return current.filter((item) => item.id !== video.id);
      return [video, ...current].slice(0, 80);
    });
  }

  const filterSummary = `${REGION_OPTIONS.find(([value]) => value === regionCode)?.[1] || regionCode} · ${AGE_OPTIONS.find(([value]) => value === String(publishedAfterDays))?.[1] || `${publishedAfterDays} days`} · ${DURATION_OPTIONS.find(([value]) => value === duration)?.[1] || duration} · ${maxResults} videos`;

  return (
    <div className="workspace-floating-shell relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-[var(--ui-bg)] text-[var(--ui-text)]">
      <header className="workspace-floating-header flex min-h-14 flex-col gap-3 px-4 py-3 xl:flex-row xl:items-center">
        <form
          onSubmit={(event) => {
            if (sourceMode === "search") {
              onSubmit(event);
              return;
            }
            event.preventDefault();
            void runTrending();
          }}
          className="flex min-w-0 flex-1 flex-col gap-2 lg:flex-row lg:items-center"
        >
          <div className="inline-flex w-full shrink-0 rounded-lg border border-[var(--ui-line)] bg-[var(--ui-bg)] p-1 sm:w-auto">
            <SourceModeTab
              active={sourceMode === "search"}
              icon={<Search className="h-4 w-4" />}
              label="Search"
              hint="Keyword search"
              onClick={() => setSourceMode("search")}
            />
            <SourceModeTab
              active={sourceMode === "viral"}
              icon={<TrendingUp className="h-4 w-4" />}
              label="Viral"
              hint="Regional chart"
              onClick={() => setSourceMode("viral")}
            />
          </div>
          <label className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ui-text)]/35" />
            <input
              value={sourceMode === "search" ? searchQuery : viralFilter}
              onChange={(event) => sourceMode === "search" ? setSearchQuery(event.target.value) : setViralFilter(event.target.value)}
              placeholder={sourceMode === "search" ? "Keywords, topics, or channel angles" : "Optional title, description, or tag filter"}
              className="h-11 w-full rounded-lg border border-[var(--ui-line)] bg-[var(--ui-panel)] pl-11 pr-4 text-sm font-medium outline-none transition focus:border-[var(--ui-focus)]/45"
            />
          </label>
          <button
            type="submit"
            disabled={isLoading}
            className="ui-btn is-primary w-full shrink-0 shadow-[#f9dc0b]/20 lg:w-auto lg:min-w-[9rem]"
          >
            {isLoading ? <Loader2 className="h-4 w-4 ui-spin" /> : sourceMode === "search" ? <Sparkles className="h-4 w-4" /> : <TrendingUp className="h-4 w-4" />}
            {sourceMode === "search" ? "Scan" : "Find viral"}
          </button>
        </form>

        <nav className="flex shrink-0 gap-4 overflow-x-auto overscroll-x-contain [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" aria-label="Radar views">
          <RadarTabButton icon={<Compass className="h-4 w-4" />} label="Discover" active={activeTab === "discover"} onClick={() => setActiveTab("discover")} />
          <RadarTabButton icon={<Users className="h-4 w-4" />} label="Competitors" active={activeTab === "competitors"} count={result?.competitors?.length || 0} onClick={() => setActiveTab("competitors")} />
          <RadarTabButton icon={<Flame className="h-4 w-4" />} label="Outliers" active={activeTab === "outliers"} count={outliers.length} onClick={() => setActiveTab("outliers")} />
          <RadarTabButton icon={<BarChart3 className="h-4 w-4" />} label="Niches" active={activeTab === "niches"} count={result?.niches.length || 0} onClick={() => setActiveTab("niches")} />
          <RadarTabButton icon={<Bookmark className="h-4 w-4" />} label="Saved" active={activeTab === "saved"} count={saved.length} onClick={() => setActiveTab("saved")} />
        </nav>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-4 sm:py-4 md:px-6">
        <FilterDrawer summary={filterSummary}>
          <FilterSelect label="Region" value={regionCode} onChange={setRegionCode} options={REGION_OPTIONS} />
          <FilterSelect label="Age" value={String(publishedAfterDays)} onChange={(value) => setPublishedAfterDays(Number(value))} options={AGE_OPTIONS} />
          <FilterSelect label="Duration" value={duration} onChange={setDuration} options={DURATION_OPTIONS} />
          <FilterSelect label="Sort" value={order} onChange={setOrder} options={SORT_OPTIONS} />
          <FilterSelect label="Depth" value={String(maxResults)} onChange={(value) => setMaxResults(Number(value))} options={DEPTH_OPTIONS} />
        </FilterDrawer>

        <div className="pt-4">
          {result && activeTab !== "saved" && (
            <div className="mb-4">
              <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,11rem),1fr))] gap-2">
                <Metric icon={<PlaySquare className="h-4 w-4" />} label="Videos scanned" value={compactNumber(result.summary.videoCount)} />
                <Metric icon={<Users className="h-4 w-4" />} label="Competitors" value={compactNumber(result.summary.competitorCount || result.competitors?.length || 0)} />
                <Metric icon={<Flame className="h-4 w-4" />} label="Recent viral" value={compactNumber(result.summary.recentViralCount || 0)} />
                <Metric icon={<Clock3 className="h-4 w-4" />} label="Avg views/hour" value={compactNumber(result.summary.avgViewsPerHour)} />
                <Metric icon={<Bot className="h-4 w-4" />} label="Best niche" value={result.summary.bestNiche || "None yet"} />
              </div>
            </div>
          )}

          {activeTab === "niches" ? (
            <NicheGrid niches={result?.niches || []} />
          ) : activeTab === "competitors" ? (
            <CompetitorGrid competitors={result?.competitors || []} />
          ) : selectedVideos.length ? (
            <div className="grid grid-cols-1 gap-x-3 gap-y-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
              {selectedVideos.map((video) => (
                <VideoCard key={video.id} video={video} saved={saved.some((item) => item.id === video.id)} onToggleSaved={() => toggleSaved(video)} />
              ))}
            </div>
          ) : (
            <EmptyState activeTab={activeTab} hasResult={!!result} />
          )}
        </div>
      </main>
    </div>
  );
}

function SourceModeTab({
  active,
  label,
  hint,
  icon,
  onClick,
}: {
  active: boolean;
  label: string;
  hint: string;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={hint}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold transition",
        active
          ? "bg-[var(--ui-panel)] text-[var(--ui-text)] shadow-sm"
          : "text-[var(--ui-text)]/45 hover:bg-white/70 hover:text-[var(--ui-text)]/70",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function FilterDrawer({ summary, children }: { summary: string; children: ReactNode }) {
  return (
    <details className="group border-b border-[var(--ui-line)] pb-3">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 py-2 text-xs font-bold text-[var(--ui-text)]/55 [&::-webkit-details-marker]:hidden">
        <span className="inline-flex items-center gap-2">
          <SlidersHorizontal className="h-3.5 w-3.5 text-[var(--ui-accent-text)]" />
          Filters
        </span>
        <span className="truncate text-[11px] font-semibold text-[var(--ui-text)]/38">{summary}</span>
      </summary>
      <div className="grid gap-2 pt-3 md:grid-cols-5">
        {children}
      </div>
    </details>
  );
}

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: Array<[string, string]> }) {
  const id = `yt-radar-${label.toLowerCase().replace(/\s+/g, "-")}`;
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-[11px] font-bold uppercase tracking-widest text-[var(--ui-text)]/35">{label}</label>
      <select
        id={id}
        name={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full rounded-lg border border-[var(--ui-line)] bg-[var(--ui-bg)] px-3 text-xs font-semibold text-[var(--ui-text)]/70 outline-none focus:border-[var(--ui-focus)]/35"
      >
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
    </div>
  );
}

function RadarTabButton({ icon, label, active, count, onClick }: { icon: ReactNode; label: string; active: boolean; count?: number; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={cn("inline-flex h-11 shrink-0 items-center gap-2 border-b-2 px-1 text-sm font-bold transition", active ? "border-[var(--ui-accent)] text-[var(--ui-text)]" : "border-transparent text-[var(--ui-text)]/45 hover:text-[var(--ui-text)]")}>
      {icon}
      {label}
      {typeof count === "number" && <span className={cn("rounded-full px-2 py-0.5 text-[10px]", active ? "bg-[var(--ui-accent)]/18 text-[var(--ui-text)]" : "bg-[var(--ui-text)]/5 text-[var(--ui-text)]/45")}>{count}</span>}
    </button>
  );
}

function Metric({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[var(--ui-line)] bg-[var(--ui-bg)] px-3 py-2.5">
      <div className="mb-1.5 flex items-center gap-1.5 text-[var(--ui-accent-text)]">{icon}<span className="text-[10px] font-bold uppercase tracking-widest text-[var(--ui-text)]/35">{label}</span></div>
      <p className="truncate text-base font-bold text-[var(--ui-text)]">{value}</p>
    </div>
  );
}

function VideoCard({ video, saved, onToggleSaved }: { video: YouTubeRadarVideo; saved: boolean; onToggleSaved: () => void }) {
  const durationLabel = formatVideoDuration(video.durationSeconds);
  const discoveryScore = Number(video.discoveryScore || video.opportunityScore || 0);
  return (
    <StandardVideoCard
      title={video.title}
      source={video.channelTitle}
      description={video.niche}
      meta={`${compactNumber(video.viewCount)} views · ${compactNumber(video.viewsPerHour)} VPH · ${dateAge(video.publishedAt)}`}
      imageUrl={video.thumbnailUrl}
      href={video.url}
      topLeft={<span className={cn("max-w-full truncate rounded-full border px-2.5 py-1 text-[10px] font-black shadow-sm backdrop-blur-sm border-[var(--ui-line)]", scoreTone(discoveryScore))}>Radar {discoveryScore}</span>}
      topRight={<div className="flex items-center gap-1.5">
        {durationLabel ? <span className="rounded-lg bg-black/70 px-2 py-1 text-[11px] font-black text-white">{durationLabel}</span> : null}
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onToggleSaved();
          }}
          className="grid h-8 w-8 place-items-center rounded-lg border border-white/20 bg-black/50 text-white backdrop-blur-sm transition hover:bg-black/70"
          title={saved ? "Remove saved" : "Save"}
          aria-label={saved ? "Remove saved video" : "Save video"}
        >
          {saved ? <BookmarkCheck className="h-4 w-4" /> : <Bookmark className="h-4 w-4" />}
        </button>
      </div>}
    />
  );
}

function CompetitorGrid({ competitors }: { competitors: YouTubeRadarCompetitor[] }) {
  if (!competitors.length) return <EmptyState activeTab="competitors" hasResult={false} />;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {competitors.map((competitor) => (
        <StandardChannelCard
          key={competitor.id || competitor.channelId}
          title={competitor.title}
          url={competitor.url}
          thumbnailUrl={competitor.thumbnailUrl}
          handle={competitor.handle}
          platform="youtube"
          description={competitor.description || competitor.niche}
          metrics={[
            { label: "radar score", value: `${competitor.score}/100`, accent: true },
            { label: "recent viral", value: compactNumber(competitor.viralVideoCount) },
            { label: "best VPH", value: compactNumber(competitor.bestViewsPerHour) },
            { label: "subscribers", value: compactNumber(competitor.subscriberCount) },
          ]}
        />
      ))}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-[var(--ui-panel)] px-3 py-2">
      <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--ui-text)]/32">{label}</p>
      <p className="mt-1 text-sm font-bold text-[var(--ui-text)]/78">{value}</p>
    </div>
  );
}

function NicheGrid({ niches }: { niches: YouTubeRadarNiche[] }) {
  if (!niches.length) return <EmptyState activeTab="niches" hasResult={false} />;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {niches.map((niche) => (
        <article key={niche.name} className="rounded-xl border border-[var(--ui-line)] bg-[var(--ui-panel)] p-5">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-[var(--ui-accent-text)]">{niche.competition} competition</p>
              <h3 className="mt-1 font-serif text-2xl font-bold text-[var(--ui-text)]">{niche.name}</h3>
            </div>
            <span className={cn("rounded-full border px-3 py-1 text-xs font-bold border-[var(--ui-line)]", scoreTone(niche.opportunityScore))}>{niche.opportunityScore}/100</span>
          </div>
          <div className="mb-4 grid grid-cols-3 gap-2">
            <MiniStat label="RPM" value={niche.estimatedRpm} />
            <MiniStat label="Outliers" value={String(niche.outlierCount)} />
            <MiniStat label="VPH" value={compactNumber(niche.viewsPerHour)} />
          </div>
          <div className="space-y-2">
            {niche.angles.map((angle) => (
              <div key={angle} className="rounded-lg bg-[var(--ui-panel)] px-3 py-2 text-xs font-medium leading-relaxed text-[var(--ui-text)]/62">
                {angle}
              </div>
            ))}
          </div>
        </article>
      ))}
    </div>
  );
}

function EmptyState({ activeTab, hasResult }: { activeTab: RadarTab; hasResult: boolean }) {
  const copy = activeTab === "saved"
    ? "Saved videos will appear here after you bookmark opportunities."
    : activeTab === "competitors"
      ? "Run a niche scan to discover channels publishing recent breakout videos."
      : hasResult
        ? "No videos matched this view yet. Try widening the filters or changing the query."
        : "Run a radar scan to populate opportunities, outliers, and niche clusters.";
  const title = activeTab === "saved" ? "Nothing saved yet" : hasResult ? "No matches" : "No scan yet";
  return (
    <div className="grid min-h-[360px] place-items-center">
      <SharedEmptyState icon={<Radar className="h-5 w-5" />} title={title} body={copy} />
    </div>
  );
}
