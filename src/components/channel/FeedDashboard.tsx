// FeedDashboard, one of ChannelManagement's screens.
import { AlertCircle, BarChart3, CheckCircle2, ChevronLeft, ChevronRight, Loader2, MessageCircle, PlaySquare, RefreshCw, Search, Sparkles, Trophy, Wand2, Youtube } from "lucide-react";
import { ReactNode, useRef, useState } from "react";
import { FeedInsight, YouTubeChannelDashboard, YouTubeDashboardVideo } from "../../types";
import { cn } from "../../lib/utils";
import { StandardChannelCard, StandardVideoCard } from "../StandardCards";
import { Notice, TagScoreChip, type YouTubeMonetizationResponse, buildTagSuggestions, compactNumber, dateAge, feedKeywords, keywordLabel, plainNumber, sharpYouTubeThumbnail, uniqueTags } from "./shared";

function formatRevenueCurrency(value: number | null | undefined, currency = "USD"): string {
  const amount = Number(value || 0);
  const safeCurrency = /^[A-Z]{3}$/.test(currency) ? currency : "USD";
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency: safeCurrency,
    minimumFractionDigits: amount >= 1000 ? 0 : 2,
    maximumFractionDigits: amount >= 1000 ? 0 : 2,
  }).format(Number.isFinite(amount) ? amount : 0);
}

function formatRevenuePeriod(startDate?: string, endDate?: string): string {
  if (!startDate || !endDate) return "Last 28 days";
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return "Last 28 days";
  const startLabel = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" }).format(start);
  const endLabel = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" }).format(end);
  return `${startLabel}–${endLabel}`;
}

function medianMetric(values: number[]): number {
  const sorted = values.filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function videoAgeHours(value: string): number {
  const time = value ? new Date(value).getTime() : 0;
  if (!Number.isFinite(time) || !time) return 24;
  return Math.max(1, (Date.now() - time) / 36e5);
}

function buildOwnedOutlierSignals(videos: YouTubeDashboardVideo[]) {
  const baselineViews = Math.max(1, medianMetric(videos.map((video) => video.viewCount)));
  const baselineVph = Math.max(1, medianMetric(videos.map((video) => Math.round(video.viewCount / videoAgeHours(video.publishedAt)))));
  return videos.map((video) => {
    const ageHours = videoAgeHours(video.publishedAt);
    const viewsPerHour = Math.round(video.viewCount / ageHours);
    const viewMultiple = video.viewCount / baselineViews;
    const velocityMultiple = viewsPerHour / baselineVph;
    const engagementRate = video.viewCount ? (video.likeCount + video.commentCount * 2) / video.viewCount : 0;
    const points = Math.round(Math.min(100, Math.max(viewMultiple, velocityMultiple) * 35 + Math.min(25, engagementRate * 1000)));
    return {
      video,
      points,
      viewsPerHour,
      viewMultiple,
      velocityMultiple,
      badge: `${points} pts`,
    };
  }).sort((a, b) => b.points - a.points || b.viewsPerHour - a.viewsPerHour || b.video.viewCount - a.video.viewCount);
}

function buildAchievementFeed(dashboard: YouTubeChannelDashboard, growth: YouTubeChannelDashboard["growthInsights"] | null) {
  const isTikTok = dashboard.account?.platform === "tiktok";
  const label = isTikTok ? "Followers" : "Subscribers";
  const subscriberThresholds = [100, 250, 500, 600, 650, 700, 750, 1000, 2500, 5000];
  const viewThresholds = [10000, 25000, 50000, 60000, 65000, 70000, 75000, 100000, 250000];
  const subs = subscriberThresholds.filter((value) => dashboard.stats.subscriberCount >= value).slice(-4).map((value) => `Milestone Unlocked - ${plainNumber(value)} ${label}!`);
  const views = viewThresholds.filter((value) => dashboard.stats.viewCount >= value).slice(-4).map((value) => `Milestone Unlocked - ${plainNumber(value)} Views!`);
  const promoted = (growth?.niches || []).filter((niche) => niche.status === "promoted").slice(0, 2).map((niche) => `Niche Promoted - ${niche.microNiche}`);
  return [...subs, ...views, ...promoted].slice(-7).reverse();
}

export function FeedDashboard({ dashboard, monetization, monetizationLoading, monetizationError, onRetryMonetization, onReauthorizeMonetization, onOpenVideo, onCopyStyle, onPublishTags, styleBusy, metadataBusy, metadataNotice, isDark }: { dashboard: YouTubeChannelDashboard; monetization: YouTubeMonetizationResponse | null; monetizationLoading: boolean; monetizationError: string; onRetryMonetization: () => void; onReauthorizeMonetization: (reauthorizeUrl?: string) => void; onOpenVideo: (video: YouTubeDashboardVideo) => void; onCopyStyle: (competitor: any) => void; onPublishTags: (video: YouTubeDashboardVideo, tags: string[]) => void; styleBusy: string; metadataBusy: string; metadataNotice: string; isDark: boolean }) {
  const [activeTab, setActiveTab] = useState<"All" | "Optimization" | "Research" | "Analytics" | "Achievements">("All");
  const videos = dashboard.recentVideos || [];
  const growth = dashboard.growthInsights || null;
  const persistedInsights = (dashboard.feedInsights || []).filter((insight) => activeTab === "All" || insight.type === activeTab);
  const trackedChannels = persistedInsights.filter((i) => i.type === "Research" && i.actionPayload?.competitor);
  const otherInsights = persistedInsights.filter((i) => !(i.type === "Research" && i.actionPayload?.competitor));
  const outlierSignals = buildOwnedOutlierSignals(videos);
  const outliers = outlierSignals.slice(0, 3);
  const youtubeCompetitors = growth?.youtubeCompetitors || [];
  const competitorOutliers = youtubeCompetitors
    .flatMap((competitor) => (competitor.recentVideos || []).map((video) => ({ competitor, video })))
    .sort((a, b) => b.video.viewsPerHour - a.video.viewsPerHour || b.video.viewCount - a.video.viewCount);
  const sourceCandidates = growth?.sourceCandidates || growth?.competitors || [];
  const candidateVideos = growth?.candidateVideos || growth?.competitorVideos || [];
  const tagCards = videos.slice(0, 3).map((video, index) => ({ video, tags: buildTagSuggestions(video, growth, index) }));
  const achievements = buildAchievementFeed(dashboard, growth);
  const topKeyword = growth?.playbook.bestNiche || feedKeywords(videos.map((video) => video.title).join(" ")).slice(0, 2).join(" ") || "story video";
  const growthSignalParts = {
    niches: growth?.niches.length || 0,
    youtubeCompetitors: youtubeCompetitors.length,
    candidates: sourceCandidates.length,
    clips: candidateVideos.length,
  };
  const isTikTokPlatform = dashboard.account.platform === "tiktok";
  const showOptimization = activeTab === "All" || activeTab === "Optimization";
  const showResearch = activeTab === "All" || activeTab === "Research";
  const showAnalytics = activeTab === "Analytics";
  const showAchievements = activeTab === "Achievements";
  const showAll = activeTab === "All";
  const showYouTubeCompetitorResearch = showResearch && (!isTikTokPlatform || youtubeCompetitors.length > 0);
  const showTikTokSources = showResearch && (isTikTokPlatform || sourceCandidates.length > 0 || candidateVideos.length > 0);
  const growthSignalSummary = growth
    ? isTikTokPlatform
      ? `${growthSignalParts.niches} niche signals, ${growthSignalParts.candidates} TikTok candidates, ${growthSignalParts.clips} candidate clips`
      : `${growthSignalParts.niches} niche signals, ${growthSignalParts.youtubeCompetitors} YouTube competitors, ${growthSignalParts.candidates} TikTok candidates, ${growthSignalParts.clips} candidate clips`
    : "Learning insights will appear after agent checks";

  return (
    <div className={cn("mx-auto max-w-3xl space-y-6 pb-12", isDark ? "text-white" : "text-[var(--ui-text)]")}>
      <div className="grid grid-cols-2 gap-2 sm:gap-4 md:grid-cols-2">
        <FeedStat label={isTikTokPlatform ? "Followers" : "Subscribers"} value={compactNumber(dashboard.stats.subscriberCount)} hint={`${compactNumber(Math.max(0, dashboard.stats.subscriberCount - 50))} target`} isDark={isDark} />
        <FeedStat label="Views" value={compactNumber(dashboard.stats.viewCount)} hint={`${compactNumber(dashboard.stats.recentViews)} recent`} isDark={isDark} />
      </div>

      {!isTikTokPlatform ? (
        <FeedMonetizationPanel
          data={monetization}
          loading={monetizationLoading}
          error={monetizationError}
          isDark={isDark}
          onRetry={onRetryMonetization}
          onReauthorize={onReauthorizeMonetization}
        />
      ) : null}

      <div className={cn("rounded-2xl px-5 py-4 text-sm font-black", isDark ? "bg-[var(--ui-accent-soft)] text-white" : "bg-[var(--ui-accent-soft)] text-[var(--ui-text)]")}>
        <div className="flex flex-wrap items-center justify-center gap-3 text-center">
          <span className="inline-flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-[var(--ui-accent)]" />Learning map</span>
          {growth ? (
            <span className={cn("font-bold", isDark ? "text-white/72" : "text-[var(--ui-text)]/72")}>
              {growthSignalSummary}
            </span>
          ) : (
            <span className={cn("font-bold", isDark ? "text-white/72" : "text-[var(--ui-text)]/72")}>Learning insights will appear after agent checks</span>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {[
          { label: "All", icon: Sparkles },
          { label: "Optimization", icon: Wand2 },
          { label: "Research", icon: Search },
          { label: "Analytics", icon: BarChart3 },
          { label: "Achievements", icon: Trophy },
        ].map(({ label, icon: Icon }) => (
          <button key={label} onClick={() => setActiveTab(label as typeof activeTab)} className={cn("inline-flex min-h-10 items-center gap-2 rounded-full px-4 py-2 text-sm font-black transition", activeTab === label ? "bg-[var(--ui-accent)] text-[var(--ui-accent-ink)]" : isDark ? "bg-white/8 text-white/85 hover:bg-white/12" : "bg-[var(--ui-panel)] text-[var(--ui-text)]/75 shadow-sm hover:text-[var(--ui-text)]")}>
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      {metadataNotice ? <Notice tone={metadataNotice.toLowerCase().includes("could not") ? "error" : "warn"} title="YouTube metadata" body={metadataNotice} /> : null}

      {showAll ? (
        <FeedInsightCard icon={<Trophy className="h-4 w-4" />} title={achievements[0] || "Keep building your channel signal"} meta="new insight" isDark={isDark} />
      ) : null}

      {trackedChannels.length ? (
        <FeedSection title="Tracked Channels" meta={`${trackedChannels.length} active monitors`} isDark={isDark}>
          <HorizontalCarousel isDark={isDark}>
            {trackedChannels.map((insight) => (
              <div key={insight.id} className="shrink-0 snap-start basis-[82%] sm:basis-[calc((100%-1rem)/2)] lg:basis-[calc((100%-2rem)/3)]">
                <PersistedInsightCard
                  insight={insight}
                  videos={videos}
                  onOpenVideo={onOpenVideo}
                  onCopyStyle={onCopyStyle}
                  styleBusy={styleBusy}
                  isDark={isDark}
                />
              </div>
            ))}
          </HorizontalCarousel>
        </FeedSection>
      ) : null}

      {otherInsights.length ? (
        <FeedSection title="Saved Growth Insights" meta={`${otherInsights.length} live signals`} isDark={isDark}>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {otherInsights.slice(0, activeTab === "All" ? 5 : 12).map((insight) => (
              <PersistedInsightCard
                key={insight.id}
                insight={insight}
                videos={videos}
                onOpenVideo={onOpenVideo}
                onCopyStyle={onCopyStyle}
                styleBusy={styleBusy}
                isDark={isDark}
              />
            ))}
          </div>
        </FeedSection>
      ) : null}

      {growth && showOptimization ? (
        <section className={cn("rounded-2xl p-5 shadow-sm", isDark ? "bg-[var(--ui-panel)]" : "bg-[var(--ui-panel)]")}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-black uppercase tracking-widest text-[var(--ui-accent-text)]">Monetization playbook</p>
              <h2 className="mt-1 text-xl font-black">{growth.playbook.bestNiche || "Find a repeatable winner"}</h2>
              <p className={cn("mt-2 text-sm font-semibold leading-6", isDark ? "text-white/55" : "text-[var(--ui-text)]/55")}>{growth.playbook.monetizationFocus}</p>
            </div>
            <BarChart3 className="h-5 w-5 shrink-0 text-[var(--ui-accent-text)]" />
          </div>
          <div className="mt-4 grid gap-2">
            {growth.playbook.actions.slice(0, 4).map((action) => (
              <p key={action} className={cn("rounded-xl px-3 py-2 text-sm font-bold leading-6", isDark ? "bg-white/7 text-white/78" : "bg-[var(--ui-bg)] text-[var(--ui-text)]/72")}>{action}</p>
            ))}
          </div>
        </section>
      ) : null}

      {showOptimization ? (
        <FeedSection title="Add Missing Tags" meta={`${tagCards.length} videos`} isDark={isDark}>
          <div className="space-y-4">
            {tagCards.map(({ video, tags }) => (
              <OptimizationTagCard
                key={video.id}
                video={video}
                tags={tags}
                onOpen={() => onOpenVideo(video)}
                onPublishTags={(publishedTags) => onPublishTags(video, publishedTags)}
                publishing={metadataBusy === `${video.id}:Tags`}
                isDark={isDark}
              />
            ))}
          </div>
        </FeedSection>
      ) : null}

      {showYouTubeCompetitorResearch && youtubeCompetitors.length ? (
        <FeedSection title="YouTube Competitor Channels" meta={`${youtubeCompetitors.length} direct YouTube matches`} isDark={isDark}>
          <HorizontalCarousel isDark={isDark}>
            {youtubeCompetitors.map((competitor) => (
              <div key={competitor.id} className="shrink-0 snap-start basis-[48%] sm:basis-[calc((100%-2rem)/3)] lg:basis-[calc((100%-3rem)/4)]">
                <SuggestedCompetitorCard
                  competitor={competitor}
                  onCopyStyle={() => onCopyStyle(competitor)}
                  busy={styleBusy === (competitor.channelId || competitor.url || competitor.title)}
                  isDark={isDark}
                />
              </div>
            ))}
          </HorizontalCarousel>
        </FeedSection>
      ) : showYouTubeCompetitorResearch ? (
        <FeedSection title="YouTube Competitor Channels" meta="direct YouTube search" isDark={isDark}>
          <div className={cn("rounded-2xl border border-dashed p-5 text-sm font-semibold leading-6", isDark ? "border-white/10 bg-[var(--ui-panel)] text-white/55" : "border-[var(--ui-line)] bg-[var(--ui-panel)] text-[var(--ui-text)]/55")}>
            No YouTube competitor channels returned yet. AutoYT searches YouTube from this channel's niche, titles, and learned micro-niches; results appear here once YouTube returns matching same-niche channels.
          </div>
        </FeedSection>
      ) : null}

      {showResearch && competitorOutliers.length ? (
        <FeedSection title="Recent Competitor Videos" meta={`${competitorOutliers.length} direct from YouTube`} isDark={isDark}>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {competitorOutliers.slice(0, 6).map((item) => <YouTubeOutlierCard key={`${item.competitor.id}-${item.video.id}`} item={item} isDark={isDark} />)}
          </div>
        </FeedSection>
      ) : showResearch ? (
        <FeedSection title={isTikTokPlatform ? "Owned TikTok Outlier Signals" : "Owned YouTube Outlier Signals"} meta={`${outliers.length} public-metric leaders`} isDark={isDark}>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {outliers.map((signal) => <FeedVideoCard key={signal.video.id} video={signal.video} multiplier={signal.badge} onClick={() => onOpenVideo(signal.video)} />)}
          </div>
        </FeedSection>
      ) : null}

      {showAnalytics ? <div className={cn("rounded-2xl p-5 shadow-sm", isDark ? "bg-[var(--ui-panel)]" : "bg-[var(--ui-panel)]")}>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-black">Trending Keyword</p>
            <p className={cn("mt-1 text-xs font-bold", isDark ? "text-white/45" : "text-[var(--ui-text)]/42")}>story video · {compactNumber(Math.max(1, dashboard.stats.recentViews))} VPH</p>
          </div>
          <BarChart3 className="h-5 w-5 text-[var(--ui-accent-text)]" />
        </div>
        <TrendGraph />
      </div> : null}

      {showResearch && competitorOutliers.length ? (
        <FeedSection title={`Trending Keyword: ${keywordLabel(topKeyword)}`} meta={`${compactNumber(Math.max(...competitorOutliers.map((item) => item.video.viewsPerHour), 1))} VPH`} isDark={isDark}>
          <TrendGraph />
        </FeedSection>
      ) : null}

      {showAnalytics && outlierSignals.length ? (
        <FeedSection title="Channel Outlier Videos" meta={`${outlierSignals.length} public-metric signals`} isDark={isDark}>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {outlierSignals.slice(0, 9).map((signal) => <AnalyticsOutlierVideoCard key={signal.video.id} signal={signal} onOpen={() => onOpenVideo(signal.video)} isDark={isDark} />)}
          </div>
        </FeedSection>
      ) : null}

      {showResearch && competitorOutliers.length > 6 ? (
        <FeedSection title="More YouTube Outlier Videos" meta="same niche competitors" isDark={isDark}>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {competitorOutliers.slice(6, 12).map((item) => <YouTubeOutlierCard key={`${item.competitor.id}-${item.video.id}`} item={item} isDark={isDark} />)}
          </div>
        </FeedSection>
      ) : null}

      {activeTab === "Research" && youtubeCompetitors.length ? (
        <FeedSection title="Competitor Channel Details" meta={`${youtubeCompetitors.length} same-niche YouTube channels`} isDark={isDark}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {youtubeCompetitors.slice(0, 8).map((competitor) => <YouTubeCompetitorCard key={competitor.id} competitor={competitor} isDark={isDark} />)}
          </div>
        </FeedSection>
      ) : null}

      {showTikTokSources && sourceCandidates.length ? (
        <FeedSection title="TikTok Source Candidates" meta={`${sourceCandidates.length} candidate channels`} isDark={isDark}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {sourceCandidates.slice(0, 6).map((competitor) => <CompetitorChannelCard key={competitor.id} competitor={competitor} isDark={isDark} />)}
          </div>
        </FeedSection>
      ) : null}

      {showTikTokSources && candidateVideos.length ? (
        <FeedSection title="Candidate Clips" meta={`${candidateVideos.length} ranked TikTok clips`} isDark={isDark}>
          <div className="grid gap-4 sm:grid-cols-3">
            {candidateVideos.slice(0, 6).map((video) => <CompetitorVideoCard key={`${video.competitorId}-${video.url}`} video={video} />)}
          </div>
        </FeedSection>
      ) : null}

      {activeTab === "Analytics" && !outlierSignals.length ? (
        <>
          <FeedInsightCard icon={<Trophy className="h-4 w-4" />} title={achievements[0] || "No urgent analytics alerts"} meta="latest channel signal" isDark={isDark} />
          <div className={cn("py-10 text-center text-lg font-black", isDark ? "text-white/55" : "text-[var(--ui-text)]/45")}>
            <CheckCircle2 className="mx-auto mb-3 h-6 w-6" />
            You're all caught up!
          </div>
        </>
      ) : null}

      {showAchievements ? (
        <FeedSection title={`${achievements.length} Achievements`} meta="current channel milestones" isDark={isDark}>
          <div className="space-y-4">
            {achievements.map((achievement, index) => <FeedInsightCard key={`${achievement}-${index}`} icon={<Trophy className="h-4 w-4" />} title={achievement} meta={index === 0 ? "current" : `${index + 1} signals ago`} isDark={isDark} />)}
            {!achievements.length ? <AchievementTile label="Owned library" value={`${dashboard.stats.videoCount} videos`} isDark={isDark} /> : null}
          </div>
        </FeedSection>
      ) : null}

      {showAnalytics ? <div className={cn("rounded-2xl p-5 shadow-sm", isDark ? "bg-[var(--ui-panel)]" : "bg-[var(--ui-panel)]")}>
        <div className="flex items-center gap-3">
          <MessageCircle className="h-5 w-5 text-[var(--ui-accent-text)]" />
          <div>
            <p className="text-sm font-black">Unanswered Comments</p>
            <p className={cn("text-xs font-bold", isDark ? "text-white/45" : "text-[var(--ui-text)]/42")}>Recent comments worth replying to</p>
          </div>
        </div>
        <div className={cn("mt-4 grid gap-3 rounded-2xl p-4", isDark ? "bg-white/6" : "bg-[var(--ui-bg)]")}>
          <p className="text-sm font-semibold">Run the comment agent to answer high-context comments with concise, useful replies.</p>
          <button className="ui-btn is-primary">Open comment agent</button>
        </div>
      </div> : null}
    </div>
  );
}

function FeedMonetizationPanel({ data, loading, error, isDark, onRetry, onReauthorize }: { data: YouTubeMonetizationResponse | null; loading: boolean; error: string; isDark: boolean; onRetry: () => void; onReauthorize: (reauthorizeUrl?: string) => void }) {
  const state = data?.state || data?.status;
  const currency = data?.currency || "USD";
  const totals = data?.current || {};
  const revenueChange = data?.changes?.estimatedRevenue;
  const period = formatRevenuePeriod(data?.period?.current?.startDate, data?.period?.current?.endDate);
  const shellClass = isDark
    ? "border-white/10 bg-[var(--ui-panel)] text-white shadow-[0_12px_32px_rgba(0,0,0,0.18)]"
    : "border-[var(--ui-line)] bg-[var(--ui-panel)] text-[var(--ui-text)] shadow-[0_12px_32px_rgba(26,26,26,0.06)]";
  const mutedClass = isDark ? "text-white/70" : "text-[var(--ui-text)]/65";
  const dividerClass = isDark ? "border-white/10" : "border-[var(--ui-line)]";

  const header = (
    <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3.5 sm:px-5">
      <div>
        <h2 id="feed-revenue-title" className="text-sm font-black tracking-[-0.01em]">Revenue overview</h2>
        <p className={cn("mt-1 text-xs font-semibold", mutedClass)}>{period} · YouTube Analytics</p>
      </div>
      {state === "ready" && typeof revenueChange === "number" ? (
        <p className={cn("text-xs font-bold tabular-nums", revenueChange > 0 ? (isDark ? "text-emerald-400" : "text-emerald-700") : revenueChange < 0 ? (isDark ? "text-red-400" : "text-red-700") : mutedClass)}>
          {revenueChange > 0 ? "+" : ""}{revenueChange.toFixed(1)}% vs previous period
        </p>
      ) : loading && data ? (
        <p className={cn("inline-flex items-center gap-1.5 text-xs font-semibold", mutedClass)}><Loader2 className="h-3.5 w-3.5 ui-spin" />Refreshing</p>
      ) : null}
    </div>
  );

  if ((loading && !data) || (!data && !error)) {
    return (
      <section aria-labelledby="feed-revenue-title" aria-live="polite" aria-busy="true" className={cn("overflow-hidden rounded-2xl border border-[var(--ui-line)]", shellClass)}>
        {header}
        <div className={cn("flex items-center gap-3 border-t px-4 py-5 sm:px-5", dividerClass)}>
          <Loader2 className="h-4 w-4 ui-spin text-[var(--ui-accent-text)]" />
          <p className={cn("text-sm font-semibold", mutedClass)}>Loading private revenue data</p>
        </div>
      </section>
    );
  }

  const needsAuthorization = state === "missing_scope" || state === "not_connected" || data?.reauthorizationRequired;
  if (needsAuthorization) {
    return (
      <section aria-labelledby="feed-revenue-title" className={cn("overflow-hidden rounded-2xl border border-[var(--ui-line)]", shellClass)}>
        {header}
        <div className={cn("flex flex-col gap-4 border-t px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5", dividerClass)}>
          <div className="max-w-xl">
            <p className="text-sm font-bold">Revenue permission is required</p>
            <p className={cn("mt-1 text-xs font-semibold leading-5", mutedClass)}>{data?.message || "Reauthorize Google once to let AutoYT read this channel’s private monetary analytics."}</p>
          </div>
          <button type="button" onClick={() => onReauthorize(data?.reauthorizeUrl)} className="ui-btn is-primary shrink-0">
            <RefreshCw className="h-3.5 w-3.5" />
            {state === "not_connected" ? "Connect Google" : "Reauthorize Google"}
          </button>
        </div>
      </section>
    );
  }

  if (error || state === "error" || state === "unsupported") {
    return (
      <section aria-labelledby="feed-revenue-title" role="alert" className={cn("overflow-hidden rounded-2xl border border-[var(--ui-line)]", shellClass)}>
        {header}
        <div className={cn("flex flex-col gap-4 border-t px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5", dividerClass)}>
          <div className="flex max-w-xl items-start gap-3">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
            <div>
              <p className="text-sm font-bold">Revenue data is unavailable</p>
              <p className={cn("mt-1 text-xs font-semibold leading-5", mutedClass)}>{error || data?.message || "YouTube did not return monetary analytics for this account."}</p>
            </div>
          </div>
          {state !== "unsupported" ? <button type="button" onClick={onRetry} className={cn("inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg border px-3 text-xs font-bold transition-colors", dividerClass, isDark ? "hover:bg-white/8" : "hover:bg-[var(--ui-bg)]")}><RefreshCw className="h-3.5 w-3.5" />Try again</button> : null}
        </div>
      </section>
    );
  }

  if (state === "no_data") {
    return (
      <section aria-labelledby="feed-revenue-title" className={cn("overflow-hidden rounded-2xl border border-[var(--ui-line)]", shellClass)}>
        {header}
        <div className={cn("flex flex-col gap-4 border-t px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5", dividerClass)}>
          <div>
            <p className="text-sm font-bold">No revenue reported for this period</p>
            <p className={cn("mt-1 text-xs font-semibold leading-5", mutedClass)}>{data?.message || "YouTube has not returned monetized playbacks for this 28-day window yet."}</p>
          </div>
          <button type="button" onClick={onRetry} className={cn("inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg border px-3 text-xs font-bold transition-colors", dividerClass, isDark ? "hover:bg-white/8" : "hover:bg-[var(--ui-bg)]")}><RefreshCw className="h-3.5 w-3.5" />Refresh data</button>
        </div>
      </section>
    );
  }

  return (
    <section aria-labelledby="feed-revenue-title" className={cn("overflow-hidden rounded-2xl border border-[var(--ui-line)]", shellClass)}>
      {header}
      <dl className={cn("grid grid-cols-2 border-t md:grid-cols-4", dividerClass)}>
        <div className={cn("border-b px-4 py-4 md:border-b-0 sm:px-5", dividerClass)}><dt className={cn("text-[11px] font-bold", mutedClass)}>Estimated revenue</dt><dd className="mt-1.5 text-xl font-black tracking-[-0.025em] tabular-nums">{formatRevenueCurrency(totals.estimatedRevenue, currency)}</dd></div>
        <div className={cn("border-b border-l px-4 py-4 md:border-b-0 sm:px-5", dividerClass)}><dt className={cn("text-[11px] font-bold", mutedClass)}>Ad revenue</dt><dd className="mt-1.5 text-xl font-black tracking-[-0.025em] tabular-nums">{formatRevenueCurrency(totals.estimatedAdRevenue, currency)}</dd></div>
        <div className={cn("px-4 py-4 md:border-l sm:px-5", dividerClass)}><dt className={cn("text-[11px] font-bold", mutedClass)}>Monetized playbacks</dt><dd className="mt-1.5 text-xl font-black tracking-[-0.025em] tabular-nums">{plainNumber(totals.monetizedPlaybacks)}</dd></div>
        <div className={cn("border-l px-4 py-4 sm:px-5", dividerClass)}><dt className={cn("text-[11px] font-bold", mutedClass)}>Revenue per 1K views</dt><dd className="mt-1.5 text-xl font-black tracking-[-0.025em] tabular-nums">{formatRevenueCurrency(totals.revenuePerThousandViews, currency)}</dd></div>
      </dl>
      <div className={cn("flex flex-wrap items-center justify-between gap-x-5 gap-y-1 border-t px-4 py-3 text-xs font-semibold sm:px-5", dividerClass, mutedClass)}>
        <p>Playback CPM <strong className={cn("font-black", isDark ? "text-white" : "text-[var(--ui-text)]")}>{formatRevenueCurrency(totals.playbackBasedCpm, currency)}</strong></p>
        <p><strong className={cn("font-black tabular-nums", isDark ? "text-white" : "text-[var(--ui-text)]")}>{plainNumber(totals.adImpressions)}</strong> ad impressions</p>
      </div>
    </section>
  );
}

function FeedStat({ label, value, hint, isDark }: { label: string; value: string; hint: string; isDark: boolean }) {
  return (
    <div className={cn("rounded-2xl p-3 text-center shadow-sm sm:rounded-3xl sm:p-6", isDark ? "bg-[var(--ui-panel)]" : "bg-[var(--ui-panel)]")}>
      <p className={cn("text-xs font-black uppercase tracking-widest", isDark ? "text-white/42" : "text-[var(--ui-text)]/38")}>{label}</p>
      <p className="mt-1 text-2xl font-black tracking-tight sm:mt-2 sm:text-5xl">{value}</p>
      <div className={cn("mt-3 h-1.5 rounded-full sm:mt-5 sm:h-2", isDark ? "bg-white/8" : "bg-[var(--ui-bg)]")}>
        <div className="h-full w-[72%] rounded-full bg-[var(--ui-accent)]" />
      </div>
      <p className={cn("mt-1 text-[10px] font-bold sm:mt-2 sm:text-xs", isDark ? "text-white/35" : "text-[var(--ui-text)]/35")}>{hint}</p>
    </div>
  );
}

function FeedSection({ title, meta, children, isDark }: { title: string; meta: string; children: ReactNode; isDark: boolean }) {
  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-black">{title} <span className={cn("text-sm font-bold", isDark ? "text-white/35" : "text-[var(--ui-text)]/35")}>· {meta}</span></h2>
      </div>
      {children}
    </section>
  );
}

function FeedInsightCard({ icon, title, meta, isDark }: { icon: ReactNode; title: string; meta: string; isDark: boolean }) {
  return (
    <div className={cn("flex min-h-24 items-center gap-4 rounded-2xl p-5 shadow-sm", isDark ? "bg-[var(--ui-panel)] text-white" : "bg-[var(--ui-panel)] text-[var(--ui-text)]")}>
      <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[var(--ui-accent)]/12 text-[var(--ui-accent-text)]">{icon}</div>
      <div>
        <p className="text-lg font-black leading-6">{title}</p>
        <p className={cn("mt-1 text-sm font-semibold", isDark ? "text-white/48" : "text-[var(--ui-text)]/45")}>{meta}</p>
      </div>
    </div>
  );
}

function PersistedInsightCard({ insight, videos, onOpenVideo, onCopyStyle, styleBusy, isDark }: { insight: FeedInsight; videos: YouTubeDashboardVideo[]; onOpenVideo: (video: YouTubeDashboardVideo) => void; onCopyStyle: (competitor: any) => void; styleBusy: string; isDark: boolean }) {
  const payload = insight.actionPayload || {};
  const video = payload.videoId ? videos.find((item) => item.id === payload.videoId) : null;
  const competitor = payload.competitor;
  const busy = !!competitor && styleBusy === (competitor.channelId || competitor.url || competitor.title);
  if (insight.type === "Analytics" && video) {
    const match = String(insight.body || "").match(/about\s+([0-9.]+x)/i);
    const viewsPerHour = String(insight.body || "").match(/at\s+([^,]+?)\s+views\/hour/i)?.[1] || "";
    return (
      <AnalyticsOutlierVideoCard
        signal={{
          video,
          badge: match?.[1] || `${Math.round(Number(insight.priority || 0))} pts`,
          points: Number(insight.priority || 0),
          viewsPerHour: 0,
          viewMultiple: 0,
          velocityMultiple: 0,
          hint: viewsPerHour ? `${viewsPerHour} views/hour` : insight.body,
        }}
        onOpen={() => onOpenVideo(video)}
        isDark={isDark}
      />
    );
  }
  if (insight.type === "Research" && competitor) {
    return (
      <div className={cn("flex flex-col rounded-2xl p-4 text-center shadow-sm transition hover:-translate-y-0.5", isDark ? "bg-[var(--ui-panel)] text-white" : "bg-[var(--ui-panel)] text-[var(--ui-text)]")}>
        <div className="mx-auto h-16 w-16 shrink-0 overflow-hidden rounded-2xl bg-[var(--ui-text)]">
          {competitor.thumbnailUrl ? <img src={competitor.thumbnailUrl} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" loading="lazy" /> : <Youtube className="m-auto mt-5 h-6 w-6 text-[var(--ui-accent-text)]" />}
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
          <span className="rounded-full bg-[var(--ui-accent)]/10 px-2.5 py-1 text-[10px] font-black text-[var(--ui-accent-text)]">{insight.type}</span>
          <span className={cn("text-[10px] font-bold", isDark ? "text-white/45" : "text-[var(--ui-text)]/45")}>{insight.priority ? `${Math.round(insight.priority)} priority` : "live signal"}</span>
        </div>
        <p className="mt-2 text-sm font-black line-clamp-1" title={insight.title}>{insight.title}</p>
        <p className={cn("mt-1 flex-1 text-[11px] font-semibold leading-5 text-left line-clamp-3", isDark ? "text-white/55" : "text-[var(--ui-text)]/55")} title={insight.body}>{insight.body}</p>
        <div className="mt-4 grid grid-cols-2 gap-2">
          {video ? (
            <button type="button" onClick={() => onOpenVideo(video)} className="ui-btn is-primary is-sm w-full">
              <PlaySquare className="h-3 w-3 shrink-0" />
              <span className="truncate">{insight.actionLabel || "Open"}</span>
            </button>
          ) : (
            <a href={competitor.url || "#"} target="_blank" rel="noreferrer" className="ui-btn is-primary is-sm w-full">Track</a>
          )}
          <button type="button" onClick={() => onCopyStyle(competitor)} disabled={busy} className="ui-btn is-primary is-sm w-full">
            {busy ? <Loader2 className="h-3 w-3 shrink-0 ui-spin" /> : <Wand2 className="h-3 w-3 shrink-0" />}
            <span className="truncate">Copy</span>
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className={cn("col-span-full rounded-2xl p-4 shadow-sm", isDark ? "bg-[var(--ui-panel)] text-white" : "bg-[var(--ui-panel)] text-[var(--ui-text)]")}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-[var(--ui-accent)]/10 px-2.5 py-1 text-[11px] font-black text-[var(--ui-accent-text)]">{insight.type}</span>
            <span className={cn("text-[11px] font-bold", isDark ? "text-white/38" : "text-[var(--ui-text)]/38")}>{insight.priority ? `${Math.round(insight.priority)} priority` : "live signal"}</span>
          </div>
          <p className="mt-2 text-base font-black leading-6">{insight.title}</p>
          <p className={cn("mt-1 text-sm font-semibold leading-6", isDark ? "text-white/55" : "text-[var(--ui-text)]/55")}>{insight.body}</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {video ? (
            <button type="button" onClick={() => onOpenVideo(video)} className="ui-btn is-primary">
              <PlaySquare className="h-4 w-4" />
              {insight.actionLabel || "Open"}
            </button>
          ) : null}
          {competitor ? (
            <button type="button" onClick={() => onCopyStyle(competitor)} disabled={busy} className="ui-btn is-primary">
              {busy ? <Loader2 className="h-4 w-4 ui-spin" /> : <Wand2 className="h-4 w-4" />}
              Copy style
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function AnalyticsOutlierVideoCard({ signal, onOpen, isDark }: { signal: ReturnType<typeof buildOwnedOutlierSignals>[number] & { hint?: string }; onOpen: () => void; isDark: boolean }) {
  const video = signal.video;
  const thumbnailUrl = sharpYouTubeThumbnail(video.thumbnailUrl);
  return (
    <StandardVideoCard
      title={video.title}
      source="Channel analytics"
      meta={`${compactNumber(video.viewCount)} views / ${signal.hint || `${compactNumber(signal.viewsPerHour)} views/hour`}`}
      imageUrl={thumbnailUrl}
      badge={signal.badge}
      topRight={<span className="rounded-full bg-[var(--ui-accent)] px-2.5 py-1 text-xs font-black text-[var(--ui-accent-ink)]">Analytics</span>}
      onOpen={onOpen}
      theme={isDark ? "dark" : "light"}
    />
  );
}

function OptimizationTagCard({ video, tags, onOpen, onPublishTags, publishing, isDark }: { video: YouTubeDashboardVideo; tags: Array<{ label: string; score: number }>; onOpen: () => void; onPublishTags: (tags: string[]) => void; publishing: boolean; isDark: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const thumbnailUrl = sharpYouTubeThumbnail(video.thumbnailUrl);
  const visibleTags = expanded ? tags : tags.slice(0, 5);
  const publishableTags = uniqueTags(visibleTags.map((tag) => tag.label));
  return (
    <div className={cn("rounded-2xl p-4 shadow-sm", isDark ? "bg-[var(--ui-panel)] text-white" : "bg-[var(--ui-panel)] text-[var(--ui-text)]")}>
      <div className="grid gap-4 sm:grid-cols-[160px_1fr]">
        <button type="button" onClick={onOpen} className="group relative aspect-video overflow-hidden rounded-xl bg-[var(--ui-text)]">
          {thumbnailUrl ? <img src={thumbnailUrl} alt="" className="h-full w-full object-cover transition duration-300 group-hover:scale-105" referrerPolicy="no-referrer" loading="lazy" /> : <PlaySquare className="m-auto mt-10 h-8 w-8 text-[var(--ui-accent-text)]" />}
        </button>
        <div className="min-w-0">
          <p className="line-clamp-2 text-base font-black">{video.title}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {visibleTags.map((tag) => <TagScoreChip key={`${video.id}-${tag.label}`} tag={tag} />)}
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <button type="button" onClick={() => tags.length > 5 ? setExpanded((value) => !value) : onOpen()} className={cn("h-10 rounded-full text-sm font-black", isDark ? "bg-white/8 text-white hover:bg-white/12" : "bg-[var(--ui-bg)] text-[var(--ui-text)] hover:bg-[var(--ui-bg)]")}>{expanded ? "Show fewer" : "Show more"}</button>
            <button type="button" onClick={() => onPublishTags(publishableTags)} disabled={publishing || !publishableTags.length} className="ui-btn is-primary">
              {publishing ? <Loader2 className="h-4 w-4 ui-spin" /> : null}
              Publish tags
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SuggestedCompetitorCard({ competitor, onCopyStyle, busy, isDark }: { competitor: NonNullable<YouTubeChannelDashboard["growthInsights"]>["youtubeCompetitors"][number]; onCopyStyle: () => void; busy: boolean; isDark: boolean }) {
  return (
    <StandardChannelCard
      title={competitor.title}
      url={competitor.url}
      thumbnailUrl={competitor.thumbnailUrl}
      handle={competitor.handle}
      platform="youtube"
      description={competitor.reason}
      theme={isDark ? "dark" : "light"}
      metrics={[
        { label: "subscribers", value: compactNumber(competitor.subscriberCount), accent: true },
        { label: "VPH", value: compactNumber(competitor.bestViewsPerHour) },
      ]}
      topRight={
        <button type="button" onClick={onCopyStyle} disabled={busy} className="grid h-8 w-8 place-items-center rounded-lg bg-[var(--ui-accent)] text-[var(--ui-accent-ink)] transition hover:opacity-85 active:scale-[0.96] disabled:opacity-45" title="Copy channel style" aria-label={`Copy ${competitor.title} channel style`}>
          {busy ? <Loader2 className="h-3.5 w-3.5 ui-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
        </button>
      }
    />
  );
}

function YouTubeOutlierCard({ item, isDark }: { item: { competitor: NonNullable<YouTubeChannelDashboard["growthInsights"]>["youtubeCompetitors"][number]; video: NonNullable<YouTubeChannelDashboard["growthInsights"]>["youtubeCompetitors"][number]["recentVideos"][number] }; isDark: boolean }) {
  const multiple = Math.max(1, Math.round((item.video.viewsPerHour / Math.max(1, item.competitor.bestViewsPerHour / 3)) * 10) / 10);
  return (
    <StandardVideoCard
      title={item.video.title}
      source={item.competitor.title}
      meta={`${compactNumber(item.video.viewCount)} views / ${dateAge(item.video.publishedAt)}`}
      imageUrl={item.video.thumbnailUrl}
      href={item.video.url || item.competitor.url}
      badge={`${multiple}x`}
      theme={isDark ? "dark" : "light"}
    />
  );
}

function HorizontalCarousel({ children, isDark }: { children: ReactNode; isDark: boolean }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const scroll = (direction: "left" | "right") => {
    if (scrollRef.current) {
      const { current } = scrollRef;
      const scrollAmount = direction === "left" ? -current.offsetWidth / 1.5 : current.offsetWidth / 1.5;
      current.scrollBy({ left: scrollAmount, behavior: "smooth" });
    }
  };
  return (
    <div className="relative group">
      <button onClick={() => scroll("left")} className={cn("absolute left-0 top-1/2 z-10 -translate-y-1/2 -translate-x-3 h-9 w-9 grid place-items-center rounded-full border shadow-md opacity-0 transition-opacity group-hover:opacity-100", isDark ? "bg-[var(--ui-panel)] border-white/10 text-white hover:bg-white/10" : "bg-[var(--ui-panel)] border-[var(--ui-line)] text-[var(--ui-text)] hover:bg-[var(--ui-bg)]")} aria-label="Scroll left"><ChevronLeft className="h-4 w-4" /></button>
      <div ref={scrollRef} className="flex gap-4 overflow-x-auto snap-x snap-mandatory pb-4 pt-1 px-1 -mx-1" style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}>
        {children}
      </div>
      <button onClick={() => scroll("right")} className={cn("absolute right-0 top-1/2 z-10 -translate-y-1/2 translate-x-3 h-9 w-9 grid place-items-center rounded-full border shadow-md opacity-0 transition-opacity group-hover:opacity-100", isDark ? "bg-[var(--ui-panel)] border-white/10 text-white hover:bg-white/10" : "bg-[var(--ui-panel)] border-[var(--ui-line)] text-[var(--ui-text)] hover:bg-[var(--ui-bg)]")} aria-label="Scroll right"><ChevronRight className="h-4 w-4" /></button>
    </div>
  );
}

function FeedVideoCard({ video, multiplier, onClick }: { video: YouTubeDashboardVideo; multiplier: string; onClick: () => void }) {
  const thumbnailUrl = sharpYouTubeThumbnail(video.thumbnailUrl);
  return (
    <StandardVideoCard title={video.title} meta={`${compactNumber(video.viewCount)} views / ${dateAge(video.publishedAt)}`} imageUrl={thumbnailUrl} badge={multiplier} onOpen={onClick} />
  );
}

function YouTubeCompetitorCard({ competitor, isDark }: { competitor: NonNullable<YouTubeChannelDashboard["growthInsights"]>["youtubeCompetitors"][number]; isDark: boolean }) {
  const best = competitor.recentVideos?.[0];
  return (
    <StandardChannelCard
      title={competitor.title || "YouTube competitor"}
      url={competitor.url}
      thumbnailUrl={competitor.thumbnailUrl}
      handle={competitor.handle}
      platform="youtube"
      description={competitor.reason || "Same-niche YouTube channel getting recent traction."}
      theme={isDark ? "dark" : "light"}
      metrics={[
        { label: "subscribers", value: compactNumber(competitor.subscriberCount), accent: true },
        { label: "best views", value: compactNumber(competitor.bestVideoViews) },
        { label: "VPH", value: compactNumber(competitor.bestViewsPerHour) },
        ...(best ? [{ label: "top clip", value: compactNumber(best.viewCount) }] : []),
      ]}
    />
  );
}

function CompetitorChannelCard({ competitor, isDark }: { competitor: NonNullable<YouTubeChannelDashboard["growthInsights"]>["competitors"][number]; isDark: boolean }) {
  const score = Number(competitor.metrics?.score || competitor.metrics?.views || 0);
  const uploads = Number(competitor.metrics?.uploads || 0);
  return (
    <StandardChannelCard
      title={competitor.title || competitor.handle || "Similar channel"}
      url={competitor.url}
      handle={competitor.handle}
      platform={/youtube\.com/i.test(competitor.url || "") ? "youtube" : "tiktok"}
      description={competitor.reason || "Posting content similar to this channel's strongest learned patterns."}
      theme={isDark ? "dark" : "light"}
      metrics={[
        ...(competitor.niche ? [{ label: "", value: competitor.niche }] : []),
        ...(score ? [{ label: "learned views", value: compactNumber(score), accent: true }] : []),
        ...(uploads ? [{ label: "uploads", value: String(uploads) }] : []),
      ]}
    />
  );
}

function CompetitorVideoCard({ video }: { video: NonNullable<YouTubeChannelDashboard["growthInsights"]>["competitorVideos"][number] }) {
  return (
    <StandardVideoCard
      title={video.title}
      source={video.competitorTitle}
      description={video.hookPattern}
      meta={`${compactNumber(video.views)} views`}
      imageUrl={video.thumbnailUrl}
      href={video.url}
      badge={`${compactNumber(video.velocity)} VPH`}
    />
  );
}

function AchievementTile({ label, value, isDark }: { label: string; value: string; isDark: boolean }) {
  return (
    <div className={cn("rounded-2xl p-4 shadow-sm", isDark ? "bg-[var(--ui-panel)]" : "bg-[var(--ui-panel)]")}>
      <CheckCircle2 className="h-5 w-5 text-[var(--ui-accent-text)]" />
      <p className={cn("mt-3 text-xs font-black uppercase tracking-widest", isDark ? "text-white/38" : "text-[var(--ui-text)]/35")}>{label}</p>
      <p className="mt-1 text-lg font-black">{value}</p>
    </div>
  );
}

function TrendGraph() {
  return (
    <svg viewBox="0 0 520 150" className="mt-5 h-36 w-full overflow-visible">
      <defs>
        <linearGradient id="trendFill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#f9dc0b" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#f9dc0b" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d="M0 125 L25 110 L52 118 L78 72 L105 96 L132 86 L158 117 L185 108 L212 121 L238 55 L265 92 L292 73 L318 118 L345 114 L372 103 L398 122 L425 62 L452 97 L478 111 L505 76 L520 88 L520 150 L0 150 Z" fill="url(#trendFill)" />
      <path d="M0 125 L25 110 L52 118 L78 72 L105 96 L132 86 L158 117 L185 108 L212 121 L238 55 L265 92 L292 73 L318 118 L345 114 L372 103 L398 122 L425 62 L452 97 L478 111 L505 76 L520 88" fill="none" stroke="#f9dc0b" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
