import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  Bookmark,
  BookmarkCheck,
  Bot,
  Clock3,
  Compass,
  ExternalLink,
  Flame,
  Loader2,
  PlaySquare,
  Radar,
  Search,
  SlidersHorizontal,
  Sparkles,
  TrendingUp,
  UploadCloud,
  Youtube,
} from "lucide-react";
import { AuthSessionPayload, YouTubeChannelDashboard, YouTubeDashboardVideo, YouTubeRadarNiche, YouTubeRadarResult, YouTubeRadarVideo } from "../types";
import { cn } from "../lib/utils";
import { StandardVideoCard } from "./StandardCards";

type RadarTab = "discover" | "outliers" | "niches" | "saved";
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
  if (score >= 75) return "text-[#6a5b00] bg-[#fff9d6] border-[#f9dc0b]/18";
  if (score >= 50) return "text-[#f9dc0b] bg-[#f9dc0b]/10 border-[#f9dc0b]/15";
  return "text-[#1A1A1A]/55 bg-[#1A1A1A]/5 border-[#1A1A1A]/10";
}

function outlierHighlight(score: number): { box: string; value: string; label: string } {
  if (score >= 75) {
    return {
      box: "border-[#f9dc0b]/55 bg-gradient-to-br from-[#fff9d6] to-[#fff9d6]/30 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.6)]",
      value: "text-[#443b00]",
      label: "text-[#6a5b00]/80",
    };
  }
  if (score >= 50) {
    return {
      box: "border-[#f9dc0b]/55 bg-gradient-to-br from-[#fff9d6] to-[#fff9d6]/20",
      value: "text-[#2d2700]",
      label: "text-[#6a5b00]/75",
    };
  }
  return {
    box: "border-slate-200/90 bg-slate-50/95",
    value: "text-slate-800",
    label: "text-slate-500",
  };
}

export function YouTubeRadar() {
  const [sourceMode, setSourceMode] = useState<SourceMode>("search");
  const [searchQuery, setSearchQuery] = useState("faceless movie recaps");
  const [viralFilter, setViralFilter] = useState("");
  const [maxResults, setMaxResults] = useState(30);
  const [regionCode, setRegionCode] = useState("US");
  const [duration, setDuration] = useState("any");
  const [publishedAfterDays, setPublishedAfterDays] = useState(7);
  const [order, setOrder] = useState("viewCount");
  const [activeTab, setActiveTab] = useState<RadarTab>("discover");
  const [result, setResult] = useState<YouTubeRadarResult | null>(null);
  const [saved, setSaved] = useState<YouTubeRadarVideo[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

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
    return (result?.videos || []).filter((video) => video.outlierScore >= 55 || video.opportunityScore >= 65);
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
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-[#F9F8F6] text-[#1A1A1A]">
      <header className="sticky top-0 z-20 flex min-h-14 flex-col gap-3 border-b border-[#1A1A1A]/8 bg-white px-4 py-3 xl:flex-row xl:items-center">
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
          <div className="inline-flex w-full shrink-0 rounded-lg border border-[#1A1A1A]/8 bg-[#F9F8F6] p-1 sm:w-auto">
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
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#1A1A1A]/35" />
            <input
              value={sourceMode === "search" ? searchQuery : viralFilter}
              onChange={(event) => sourceMode === "search" ? setSearchQuery(event.target.value) : setViralFilter(event.target.value)}
              placeholder={sourceMode === "search" ? "Keywords, topics, or channel angles" : "Optional title, description, or tag filter"}
              className="h-11 w-full rounded-lg border border-[#1A1A1A]/10 bg-white pl-11 pr-4 text-sm font-medium outline-none transition focus:border-[#f9dc0b]/45"
            />
          </label>
          <button
            type="submit"
            disabled={isLoading}
            className="inline-flex min-h-11 w-full shrink-0 items-center justify-center gap-2 rounded-lg bg-[#f9dc0b] px-4 py-2 text-sm font-bold text-[#1A1A1A] shadow-sm shadow-[#f9dc0b]/20 transition hover:bg-[#1A1A1A] hover:text-white disabled:cursor-not-allowed disabled:opacity-60 lg:w-auto lg:min-w-[9rem]"
          >
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : sourceMode === "search" ? <Sparkles className="h-4 w-4" /> : <TrendingUp className="h-4 w-4" />}
            {sourceMode === "search" ? "Scan" : "Find viral"}
          </button>
        </form>

        <nav className="flex shrink-0 gap-4 overflow-x-auto overscroll-x-contain [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" aria-label="Radar views">
          <RadarTabButton icon={<Compass className="h-4 w-4" />} label="Discover" active={activeTab === "discover"} onClick={() => setActiveTab("discover")} />
          <RadarTabButton icon={<Flame className="h-4 w-4" />} label="Outliers" active={activeTab === "outliers"} count={outliers.length} onClick={() => setActiveTab("outliers")} />
          <RadarTabButton icon={<BarChart3 className="h-4 w-4" />} label="Niches" active={activeTab === "niches"} count={result?.niches.length || 0} onClick={() => setActiveTab("niches")} />
          <RadarTabButton icon={<Bookmark className="h-4 w-4" />} label="Saved" active={activeTab === "saved"} count={saved.length} onClick={() => setActiveTab("saved")} />
        </nav>
      </header>

      {error && (
        <div className="mx-4 mt-4 rounded-lg border border-[#f9dc0b]/18 bg-[#fff9d6] p-3 text-sm font-medium text-[#443b00] md:mx-6">
          {error}
        </div>
      )}

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
                <Metric icon={<TrendingUp className="h-4 w-4" />} label="Avg opportunity" value={`${result.summary.avgOpportunity}/100`} />
                <Metric icon={<Clock3 className="h-4 w-4" />} label="Avg views/hour" value={compactNumber(result.summary.avgViewsPerHour)} />
                <Metric icon={<Bot className="h-4 w-4" />} label="Best niche" value={result.summary.bestNiche || "None yet"} />
              </div>
            </div>
          )}

          {activeTab === "niches" ? (
            <NicheGrid niches={result?.niches || []} />
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

function ConnectedChannelPanel({
  auth,
  dashboard,
  loading,
  error,
  onRefresh,
  onAuthRefresh,
}: {
  auth: AuthSessionPayload;
  dashboard: YouTubeChannelDashboard | null;
  loading: boolean;
  error: string;
  onRefresh: () => void;
  onAuthRefresh: () => Promise<void>;
}) {
  const active = auth.activeAccount;

  async function switchAccount(id: string) {
    const response = await fetch(`/api/youtube/accounts/${encodeURIComponent(id)}/select`, { method: "POST" });
    if (response.ok) await onAuthRefresh();
  }

  return (
    <section className="overflow-hidden rounded-xl border border-[#1A1A1A]/8 bg-white shadow-sm">
      <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_minmax(280px,330px)]">
        <div className="p-4 md:p-5">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              {active?.thumbnailUrl ? (
                <img src={active.thumbnailUrl} alt="" className="h-12 w-12 rounded-xl" referrerPolicy="no-referrer" />
              ) : (
                <div className="grid h-12 w-12 place-items-center rounded-xl bg-[#f9dc0b]/10 text-[#f9dc0b]">
                  <Youtube className="h-5 w-5" />
                </div>
              )}
              <div className="min-w-0">
                <p className="text-xs font-bold uppercase tracking-widest text-[#f9dc0b]">Connected channel</p>
                <h2 className="truncate font-serif text-2xl font-bold text-[#1A1A1A]">{active?.channelTitle || "No YouTube channel connected"}</h2>
                <p className="truncate text-xs font-medium text-[#1A1A1A]/45">{active ? `${active.channelHandle || active.channelId} · ${active.email}` : "Connect Google to unlock channel analytics and account switching."}</p>
              </div>
            </div>
            <div className="grid w-full grid-cols-1 gap-2 min-[430px]:w-auto min-[430px]:grid-cols-2">
              <a href="/api/auth/google?mode=connect&next=/youtube" className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-[#f9dc0b] px-4 py-2 text-xs font-bold text-[#1A1A1A] transition hover:bg-[#1A1A1A] hover:text-white">
                <Youtube className="h-4 w-4" />
                Add account
              </a>
              <button type="button" onClick={onRefresh} className="inline-flex min-h-10 items-center justify-center rounded-lg border border-[#1A1A1A]/10 bg-[#FDFCFA] px-4 py-2 text-xs font-bold text-[#1A1A1A]/60 transition hover:border-[#1A1A1A]/25 hover:text-[#1A1A1A]">
                Refresh
              </button>
            </div>
          </div>

          {loading ? (
            <div className="mt-4 flex items-center gap-2 rounded-lg bg-[#F9F8F6] px-3 py-3 text-sm font-semibold text-[#1A1A1A]/55">
              <Loader2 className="h-4 w-4 animate-spin text-[#f9dc0b]" />
              Loading channel analytics
            </div>
          ) : error ? (
            <div className="mt-4 rounded-lg border border-[#f9dc0b]/35 bg-[#fff9d6] px-3 py-3 text-sm font-semibold text-[#443b00]">{error}</div>
          ) : dashboard ? (
            <>
              <div className="mt-4 grid grid-cols-[repeat(auto-fit,minmax(min(100%,9.5rem),1fr))] gap-2">
                <Metric icon={<Youtube className="h-4 w-4" />} label="Subscribers" value={compactNumber(dashboard.stats.subscriberCount)} />
                <Metric icon={<PlaySquare className="h-4 w-4" />} label="Videos" value={compactNumber(dashboard.stats.videoCount)} />
                <Metric icon={<BarChart3 className="h-4 w-4" />} label="Total views" value={compactNumber(dashboard.stats.viewCount)} />
                <Metric icon={<TrendingUp className="h-4 w-4" />} label="Recent views" value={compactNumber(dashboard.stats.recentViews)} />
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <a href={dashboard.account.url || "#"} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#1A1A1A]/10 bg-[#FDFCFA] px-3 text-xs font-bold text-[#1A1A1A]/60 transition hover:text-[#1A1A1A]">
                  <ExternalLink className="h-3.5 w-3.5" />
                  Open channel
                </a>
                <a href="https://studio.youtube.com/" target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#f9dc0b]/70 bg-[#f9dc0b] px-3 text-xs font-bold text-[#1A1A1A] transition hover:border-[#1A1A1A] hover:bg-[#1A1A1A] hover:text-white">
                  <UploadCloud className="h-3.5 w-3.5" />
                  Open YouTube upload
                </a>
              </div>
            </>
          ) : null}
        </div>

        <div className="border-t border-[#1A1A1A]/8 bg-[#F9F8F6] p-4 lg:border-l lg:border-t-0">
          <p className="mb-3 text-xs font-bold uppercase tracking-widest text-[#1A1A1A]/35">Switch account</p>
          <div className="space-y-2">
            {auth.accounts.length ? auth.accounts.map((account) => (
              <button
                key={account.id}
                type="button"
                onClick={() => void switchAccount(account.id)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition",
                  active?.id === account.id ? "bg-[#1A1A1A] text-white" : "bg-white text-[#1A1A1A]/65 hover:bg-[#FDFCFA]",
                )}
              >
                {account.thumbnailUrl ? <img src={account.thumbnailUrl} alt="" className="h-8 w-8 rounded-lg" referrerPolicy="no-referrer" /> : <Youtube className="h-4 w-4" />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-bold">{account.channelTitle}</span>
                  <span className={cn("block truncate text-[11px]", active?.id === account.id ? "text-white/45" : "text-[#1A1A1A]/35")}>{account.email}</span>
                </span>
              </button>
            )) : (
              <p className="rounded-lg bg-white px-3 py-3 text-xs font-semibold leading-5 text-[#1A1A1A]/45">No connected channels yet.</p>
            )}
          </div>
        </div>
      </div>

      {dashboard?.recentVideos?.length ? (
        <div className="border-t border-[#1A1A1A]/8 p-4 md:p-5">
          <p className="mb-3 text-xs font-bold uppercase tracking-widest text-[#1A1A1A]/35">Recent uploads</p>
          <div className="grid gap-3 md:grid-cols-3">
            {dashboard.recentVideos.slice(0, 3).map((video) => <RecentUpload key={video.id} video={video} />)}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function RecentUpload({ video }: { video: YouTubeDashboardVideo }) {
  return (
    <a href={video.url} target="_blank" rel="noreferrer" className="grid grid-cols-[96px_minmax(0,1fr)] gap-3 rounded-lg border border-[#1A1A1A]/8 bg-[#FDFCFA] p-2 transition hover:border-[#1A1A1A]/25">
      <div className="aspect-video overflow-hidden rounded-md bg-[#1A1A1A]/5">
        {video.thumbnailUrl ? <img src={video.thumbnailUrl} alt="" className="h-full w-full object-cover" /> : null}
      </div>
      <div className="min-w-0">
        <p className="line-clamp-2 text-xs font-bold leading-snug text-[#1A1A1A]">{video.title}</p>
        <p className="mt-1 text-[11px] font-semibold text-[#1A1A1A]/42">{compactNumber(video.viewCount)} views · {dateAge(video.publishedAt)}</p>
      </div>
    </a>
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
          ? "bg-white text-[#1A1A1A] shadow-sm"
          : "text-[#1A1A1A]/45 hover:bg-white/70 hover:text-[#1A1A1A]/70",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function FilterDrawer({ summary, children }: { summary: string; children: ReactNode }) {
  return (
    <details className="group border-b border-[#1A1A1A]/8 pb-3">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 py-2 text-xs font-bold text-[#1A1A1A]/55 [&::-webkit-details-marker]:hidden">
        <span className="inline-flex items-center gap-2">
          <SlidersHorizontal className="h-3.5 w-3.5 text-[#f9dc0b]" />
          Filters
        </span>
        <span className="truncate text-[11px] font-semibold text-[#1A1A1A]/38">{summary}</span>
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
      <label htmlFor={id} className="flex cursor-pointer items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-[#1A1A1A]/35">
        <SlidersHorizontal className="h-3 w-3" aria-hidden />
        {label}
      </label>
      <select
        id={id}
        name={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full rounded-lg border border-[#1A1A1A]/8 bg-[#F9F8F6] px-3 text-xs font-semibold text-[#1A1A1A]/70 outline-none focus:border-[#f9dc0b]/35"
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
    <button type="button" onClick={onClick} className={cn("inline-flex h-11 shrink-0 items-center gap-2 border-b-2 px-1 text-sm font-bold transition", active ? "border-[#f9dc0b] text-[#1A1A1A]" : "border-transparent text-[#1A1A1A]/45 hover:text-[#1A1A1A]")}>
      {icon}
      {label}
      {typeof count === "number" && <span className={cn("rounded-full px-2 py-0.5 text-[10px]", active ? "bg-[#f9dc0b]/18 text-[#1A1A1A]" : "bg-[#1A1A1A]/5 text-[#1A1A1A]/45")}>{count}</span>}
    </button>
  );
}

function Metric({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[#1A1A1A]/8 bg-[#F9F8F6] px-3 py-2.5">
      <div className="mb-1.5 flex items-center gap-1.5 text-[#f9dc0b]">{icon}<span className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/35">{label}</span></div>
      <p className="truncate text-base font-bold text-[#1A1A1A]">{value}</p>
    </div>
  );
}

function VideoCardStats({ video }: { video: YouTubeRadarVideo }) {
  const ol = outlierHighlight(video.outlierScore);
  const category = video.categoryName?.trim() || "—";
  return (
    <div className="mt-1.5 space-y-1.5">
      <div
        className="rounded-md border border-teal-300/40 bg-gradient-to-br from-teal-50/90 to-teal-50/30 px-2 py-1.5 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.65)]"
        title={category === "—" ? "" : `YouTube category ID ${video.categoryId ?? ""}`}
      >
        <p className="text-[8px] font-bold uppercase tracking-[0.1em] text-teal-800/80">YT category</p>
        <p className="mt-0.5 line-clamp-2 text-[11px] font-semibold leading-tight text-[#1A1A1A]">{category}</p>
      </div>
      <div
        className="rounded-md border border-[#f9dc0b]/28 bg-gradient-to-br from-[#f9dc0b]/14 via-[#FDF8F5] to-[#F9F8F6] px-2 py-1.5 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.7)]"
        title={video.niche}
      >
        <p className="text-[8px] font-bold uppercase tracking-[0.1em] text-[#6a5b00]">Niche (inferred)</p>
        <p className="mt-0.5 line-clamp-2 text-[11px] font-semibold leading-tight text-[#1A1A1A]">{video.niche}</p>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <div
          className="rounded-md border border-[#f9dc0b]/35 bg-gradient-to-br from-[#fff9d6] to-[#fff1a3]/40 px-2 py-1.5 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.65)]"
          title="Views per hour (velocity)"
        >
          <p className="text-[8px] font-bold uppercase tracking-[0.1em] text-[#6a5b00]/85">V/h</p>
          <p className="mt-0.5 text-sm font-bold tabular-nums leading-none text-[#2d2700]">{compactNumber(video.viewsPerHour)}</p>
        </div>
        <div className={cn("rounded-md border px-2 py-1.5", ol.box)} title="Outlier score">
          <p className={cn("text-[8px] font-bold uppercase tracking-[0.1em]", ol.label)}>Outlier</p>
          <p className={cn("mt-0.5 text-sm font-bold tabular-nums leading-none", ol.value)}>{video.outlierScore}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-1">
        <span
          className="inline-flex min-w-0 max-w-full items-baseline gap-0.5 rounded border border-[#f9dc0b]/55 bg-[#fff9d6] px-1.5 py-1 text-[10px] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.6)]"
          title="Faceless channel signal"
        >
          <span className="shrink-0 text-[7px] font-bold uppercase tracking-tight text-[#6a5b00]/85">Face</span>
          <span className="font-bold tabular-nums text-[#2d2700]">{video.facelessScore}</span>
        </span>
        <span
          className="inline-flex items-baseline gap-0.5 rounded border border-[#f9dc0b]/55 bg-[#fff9d6]/95 px-1.5 py-1 text-[10px] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.5)]"
          title="Estimated RPM range"
        >
          <span className="shrink-0 text-[7px] font-bold uppercase tracking-wide text-[#6a5b00]/80">RPM</span>
          <span className="font-bold text-[#2d2700]">{video.rpmEstimate}</span>
        </span>
        <span
          className="inline-flex min-w-0 max-w-full flex-1 items-baseline gap-0.5 rounded border border-slate-200/95 bg-slate-50 px-1.5 py-1 text-[10px] sm:flex-initial sm:min-w-0"
          title="Channel subscribers"
        >
          <span className="shrink-0 text-[7px] font-bold uppercase tracking-tight text-slate-500">Subs</span>
          <span className="min-w-0 truncate text-right font-bold tabular-nums text-slate-800">
            {video.subscriberCount ? compactNumber(video.subscriberCount) : "—"}
          </span>
        </span>
      </div>
    </div>
  );
}

function VideoCard({ video, saved, onToggleSaved }: { video: YouTubeRadarVideo; saved: boolean; onToggleSaved: () => void }) {
  const durationLabel = formatVideoDuration(video.durationSeconds);
  return (
    <article className="min-w-0">
      <StandardVideoCard
        title={video.title}
        source={video.channelTitle}
        meta={`${compactNumber(video.viewCount)} views / ${dateAge(video.publishedAt)}`}
        imageUrl={video.thumbnailUrl}
        href={video.url}
        topLeft={<span className={cn("max-w-full truncate rounded-full border px-2.5 py-1 text-[10px] font-black shadow-sm backdrop-blur-sm", scoreTone(video.opportunityScore))}>Opportunity {video.opportunityScore}</span>}
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
      <div className="mt-2 min-w-0 px-0.5">
        <VideoCardStats video={video} />
      </div>
    </article>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-white px-3 py-2">
      <p className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/32">{label}</p>
      <p className="mt-1 text-sm font-bold text-[#1A1A1A]/78">{value}</p>
    </div>
  );
}

function NicheGrid({ niches }: { niches: YouTubeRadarNiche[] }) {
  if (!niches.length) return <EmptyState activeTab="niches" hasResult={false} />;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {niches.map((niche) => (
        <article key={niche.name} className="rounded-xl border border-[#1A1A1A]/8 bg-[#FDFCFA] p-5">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-[#f9dc0b]">{niche.competition} competition</p>
              <h3 className="mt-1 font-serif text-2xl font-bold text-[#1A1A1A]">{niche.name}</h3>
            </div>
            <span className={cn("rounded-full border px-3 py-1 text-xs font-bold", scoreTone(niche.opportunityScore))}>{niche.opportunityScore}/100</span>
          </div>
          <div className="mb-4 grid grid-cols-3 gap-2">
            <MiniStat label="RPM" value={niche.estimatedRpm} />
            <MiniStat label="Outliers" value={String(niche.outlierCount)} />
            <MiniStat label="VPH" value={compactNumber(niche.viewsPerHour)} />
          </div>
          <div className="space-y-2">
            {niche.angles.map((angle) => (
              <div key={angle} className="rounded-lg bg-white px-3 py-2 text-xs font-medium leading-relaxed text-[#1A1A1A]/62">
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
  const copy = activeTab === "saved" ? "Saved videos will appear here after you bookmark opportunities." : hasResult ? "No videos matched this view yet. Try widening the filters or changing the query." : "Run a radar scan to populate opportunities, outliers, and niche clusters.";
  return (
    <div className="grid min-h-[360px] place-items-center p-8 text-center">
      <div>
        <Radar className="mx-auto mb-3 h-8 w-8 text-[#f9dc0b]/55" />
        <p className="max-w-sm text-sm font-medium leading-relaxed text-[#1A1A1A]/50">{copy}</p>
      </div>
    </div>
  );
}
