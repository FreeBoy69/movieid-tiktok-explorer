import { Activity, AlertCircle, BarChart3, Download, Pause, Play, TrendingUp, Volume2 } from "lucide-react";
import { Fragment, useEffect, useRef, useState } from "react";
import { cn } from "../lib/utils";
import { StandardChannelCard, StandardVideoCard, type CardTheme } from "./StandardCards";

export type AgentReportSource = {
  author?: string;
  uploads?: number;
  views?: number;
  bestViews?: number;
  avgViews?: number;
  hits10k?: number;
  promoted?: boolean;
};

export type AgentPerformanceReport = {
  generatedAt?: string;
  windowDays?: number;
  uploads30d?: number;
  views30d?: number;
  likes30d?: number;
  comments30d?: number;
  avgViews30d?: number;
  bestViews30d?: number;
  uploadsAbove1k?: number;
  uploadsAbove10k?: number;
  recentFailures7d?: number;
  recentSuccess7d?: number;
  topSources?: AgentReportSource[];
  weakSources?: AgentReportSource[];
  recommendations?: string[];
};

export type AgentChatVideo = {
  id?: string;
  title: string;
  url: string;
  thumbnailUrl?: string;
  source?: string;
  platform?: string;
  views?: number;
  likes?: number;
  comments?: number;
  viewsPerHour?: number;
  durationSeconds?: number;
  publishedAt?: string | number;
  badge?: string;
};

export type AgentChatChannel = {
  id?: string;
  title: string;
  url: string;
  thumbnailUrl?: string;
  handle?: string;
  platform?: string;
  description?: string;
  subscriberCount?: number;
  videoCount?: number;
  bestVideoViews?: number;
  bestViewsPerHour?: number;
  niche?: string;
};

export type AgentChatAudio = {
  id?: string;
  title?: string;
  text?: string;
  voiceName?: string;
  audioUrl?: string;
  duration?: number;
  createdAt?: string;
  error?: string;
};

export type AgentChatBlock =
  | { type: "report"; title?: string; report: AgentPerformanceReport }
  | { type: "channels"; title?: string; items: AgentChatChannel[] }
  | { type: "videos"; title?: string; items: AgentChatVideo[] }
  | { type: "audio"; title?: string; audio: AgentChatAudio };

function compact(value?: number): string {
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(Number(value || 0));
}

function percent(value: number, total: number): number {
  if (!total) return 0;
  return Math.max(0, Math.min(100, Math.round((value / total) * 100)));
}

function reportTheme(theme: CardTheme) {
  const dark = theme === "dark";
  return {
    dark,
    frame: dark ? "border-white/12 bg-[#191C18] text-[#F8F5E8]" : "border-[#1A1A1A]/10 bg-white text-[#1A1A1A]",
    divider: dark ? "border-white/10" : "border-[#1A1A1A]/8",
    muted: dark ? "text-[#F8F5E8]/55" : "text-[#1A1A1A]/55",
    subtle: dark ? "text-[#F8F5E8]/40" : "text-[#1A1A1A]/40",
    soft: dark ? "bg-white/6" : "bg-[#F7F7F5]",
  };
}

export function PerformanceReportView({ report, theme = "light", compactMode = false }: { report: AgentPerformanceReport; theme?: CardTheme; compactMode?: boolean }) {
  const tokens = reportTheme(theme);
  const topSources = (report.topSources || []).slice(0, compactMode ? 3 : 5);
  const weakSources = (report.weakSources || []).slice(0, compactMode ? 2 : 4);
  const recommendations = (report.recommendations || []).slice(0, compactMode ? 3 : 4);
  const success = Number(report.recentSuccess7d || 0);
  const failures = Number(report.recentFailures7d || 0);
  const runs = success + failures;
  const reliability = runs ? Math.round((success / runs) * 100) : 0;
  const maxSourceViews = Math.max(...topSources.map((source) => Number(source.views || 0)), 1);
  const generated = report.generatedAt ? new Date(report.generatedAt) : null;

  return (
    <section className={cn("overflow-hidden rounded-xl border", tokens.frame)}>
      <header className={cn("flex flex-col gap-4 border-b px-4 py-4 sm:flex-row sm:items-start sm:justify-between", tokens.divider, compactMode ? "md:px-5" : "md:px-6 md:py-5")}>
        <div>
          <p className="inline-flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.16em] text-[#b89f00]"><BarChart3 className="h-3.5 w-3.5" />Performance report</p>
          <h3 className="mt-1.5 font-serif text-xl font-bold">Last {report.windowDays || 30} days</h3>
          <p className={cn("mt-1 text-xs font-semibold", tokens.muted)}>Publishing results, source quality, and the next actions worth taking.</p>
        </div>
        <span className={cn("inline-flex h-8 shrink-0 items-center gap-2 self-start rounded-full px-3 text-[11px] font-black", runs && reliability >= 70 ? "bg-[#f9dc0b] text-[#1A1A1A]" : tokens.soft, runs && reliability >= 70 ? "" : tokens.muted)}>
          <Activity className="h-3.5 w-3.5" />
          {runs ? `${reliability}% run health` : "Collecting data"}
        </span>
      </header>

      <div className={cn("grid grid-cols-2 border-b md:grid-cols-4", tokens.divider)}>
        {[
          ["Uploads", compact(report.uploads30d)],
          ["Total views", compact(report.views30d)],
          ["Average", compact(report.avgViews30d)],
          ["Best upload", compact(report.bestViews30d)],
        ].map(([label, value], index) => (
          <div key={label} className={cn("px-4 py-3.5", index % 2 ? "border-l" : "", index >= 2 ? "border-t md:border-t-0" : "", index > 0 ? "md:border-l" : "", tokens.divider)}>
            <p className={cn("text-[10px] font-black uppercase tracking-widest", tokens.subtle)}>{label}</p>
            <p className="mt-1 text-xl font-black tabular-nums">{value}</p>
          </div>
        ))}
      </div>

      <div className={cn("grid", compactMode ? "lg:grid-cols-[minmax(0,1.15fr)_minmax(240px,0.85fr)]" : "xl:grid-cols-[minmax(0,1.2fr)_minmax(300px,0.8fr)]")}>
        <div className={cn("px-4 py-4 md:px-5", compactMode ? "" : "md:px-6 md:py-5")}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <h4 className="text-sm font-black">Source channel performance</h4>
              <p className={cn("mt-1 text-xs font-semibold", tokens.muted)}>Ranked by views generated from each source.</p>
            </div>
            <span className={cn("text-[10px] font-black uppercase tracking-widest", tokens.subtle)}>{topSources.length} tracked</span>
          </div>
          <div className="mt-4 space-y-3">
            {topSources.map((source, index) => (
              <div key={source.author || `source-${index}`}>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-black">{source.author || "Unknown source"}</p>
                    <p className={cn("mt-0.5 text-[10px] font-semibold", tokens.muted)}>{compact(source.uploads)} uploads / {compact(source.avgViews)} avg</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {source.promoted ? <span className="rounded-full bg-[#f9dc0b]/16 px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-[#b89f00]">Promoted</span> : null}
                    <span className="text-xs font-black tabular-nums">{compact(source.views)}</span>
                  </div>
                </div>
                <div className={cn("mt-2 h-1.5 overflow-hidden rounded-full", tokens.soft)}>
                  <div className="h-full rounded-full bg-[#f9dc0b]" style={{ width: `${percent(Number(source.views || 0), maxSourceViews)}%` }} />
                </div>
              </div>
            ))}
            {!topSources.length ? <p className={cn("border-t py-5 text-sm font-semibold", tokens.divider, tokens.muted)}>Source rankings appear after completed uploads collect performance.</p> : null}
          </div>
        </div>

        <aside className={cn("border-t px-4 py-4 md:px-5 lg:border-l lg:border-t-0", tokens.divider, compactMode ? "" : "md:px-6 md:py-5")}>
          <h4 className="inline-flex items-center gap-2 text-sm font-black"><TrendingUp className="h-4 w-4 text-[#b89f00]" />Recommended next moves</h4>
          <div className="mt-3 space-y-3">
            {recommendations.map((item, index) => (
              <div key={`${item}-${index}`} className="flex gap-3">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#f9dc0b] text-[10px] font-black text-[#1A1A1A]">{index + 1}</span>
                <p className={cn("pt-0.5 text-xs font-semibold leading-5", tokens.muted)}>{item}</p>
              </div>
            ))}
            {!recommendations.length ? <p className={cn("text-xs font-semibold leading-5", tokens.muted)}>Recommendations will appear after the next performance capture.</p> : null}
          </div>

          <div className={cn("mt-5 border-t pt-4", tokens.divider)}>
            <div className="grid grid-cols-3 gap-3">
              <ReportMiniMetric label="1k+" value={compact(report.uploadsAbove1k)} muted={tokens.subtle} />
              <ReportMiniMetric label="10k+" value={compact(report.uploadsAbove10k)} muted={tokens.subtle} />
              <ReportMiniMetric label="Runs" value={runs ? `${success}/${runs}` : "0"} muted={tokens.subtle} />
            </div>
          </div>

          {weakSources.length ? (
            <div className={cn("mt-4 border-t pt-4", tokens.divider)}>
              <p className={cn("text-[10px] font-black uppercase tracking-widest", tokens.subtle)}>Throttle for now</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {weakSources.map((source) => <span key={source.author} className={cn("rounded-full px-2.5 py-1 text-[10px] font-bold", tokens.soft, tokens.muted)}>{source.author || "Unknown"} / {compact(source.bestViews)} best</span>)}
              </div>
            </div>
          ) : null}
        </aside>
      </div>

      {generated && !Number.isNaN(generated.getTime()) ? <footer className={cn("border-t px-4 py-2 text-[10px] font-semibold", tokens.divider, tokens.subtle)}>Updated {generated.toLocaleString()}</footer> : null}
    </section>
  );
}

function ReportMiniMetric({ label, value, muted }: { label: string; value: string; muted: string }) {
  return <div><p className={cn("text-[9px] font-black uppercase tracking-widest", muted)}>{label}</p><p className="mt-1 text-sm font-black tabular-nums">{value}</p></div>;
}

function formatDuration(seconds: number): string {
  const safe = Math.max(0, Math.floor(Number(seconds || 0)));
  const minutes = Math.floor(safe / 60);
  return `${minutes}:${String(safe % 60).padStart(2, "0")}`;
}

export function InlineAudioPlayer({ audio, theme = "light" }: { audio: AgentChatAudio; theme?: CardTheme }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(Number(audio.duration || 0));
  const [playbackError, setPlaybackError] = useState("");
  const dark = theme === "dark";

  useEffect(() => {
    setPlaying(false);
    setCurrentTime(0);
    setDuration(Number(audio.duration || 0));
    setPlaybackError("");
  }, [audio.id, audio.audioUrl, audio.duration]);

  function syncDuration(element: HTMLAudioElement) {
    if (Number.isFinite(element.duration) && element.duration > 0) setDuration(element.duration);
  }

  function togglePlay() {
    const element = audioRef.current;
    if (!element || !audio.audioUrl) return;
    if (element.paused) {
      setPlaybackError("");
      void element.play().catch(() => setPlaybackError("Audio could not be played."));
    } else {
      element.pause();
    }
  }

  function seek(next: number) {
    const element = audioRef.current;
    if (!element || !duration) return;
    element.currentTime = Math.max(0, Math.min(duration, next));
    setCurrentTime(element.currentTime);
  }

  const error = audio.error || playbackError;

  return (
    <section className={cn("overflow-hidden rounded-xl border", dark ? "border-white/12 bg-[#191C18] text-[#F8F5E8]" : "border-[#1A1A1A]/10 bg-white text-[#1A1A1A]")}>
      <audio
        ref={audioRef}
        src={audio.audioUrl}
        preload="metadata"
        onLoadedMetadata={(event) => syncDuration(event.currentTarget)}
        onDurationChange={(event) => syncDuration(event.currentTarget)}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime || 0)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onError={() => setPlaybackError("Generated audio is unavailable.")}
      />
      <div className="flex items-center gap-3 border-b border-current/10 px-4 py-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[#f9dc0b] text-[#1A1A1A]"><Volume2 className="h-4 w-4" /></span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-black">{audio.title || "Generated speech"}</p>
          <p className={cn("mt-0.5 truncate text-[11px] font-semibold", dark ? "text-white/48" : "text-[#1A1A1A]/45")}>{audio.voiceName || "AutoYT voice"}</p>
        </div>
        <div className="hidden h-8 items-end gap-1 sm:flex" aria-hidden="true">
          {[9, 18, 13, 25, 16, 29, 12, 21, 15, 24, 10, 18].map((height, index) => <span key={`${height}-${index}`} className="w-1 rounded-full bg-[#f9dc0b]" style={{ height }} />)}
        </div>
      </div>

      <div className="px-4 py-4">
        {audio.text ? <p className={cn("mb-4 line-clamp-2 text-xs font-semibold leading-5", dark ? "text-white/60" : "text-[#1A1A1A]/58")}>{audio.text}</p> : null}
        {error ? (
          <p className="flex items-start gap-2 text-xs font-semibold leading-5 text-[#b89f00]"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{error}</p>
        ) : (
          <div className="grid grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-3">
            <button type="button" onClick={togglePlay} disabled={!audio.audioUrl} className="grid h-11 w-11 place-items-center rounded-full bg-[#1A1A1A] text-white transition hover:bg-[#f9dc0b] hover:text-[#1A1A1A] disabled:opacity-35" aria-label={playing ? "Pause audio" : "Play audio"}>
              {playing ? <Pause className="h-4 w-4 fill-current" /> : <Play className="h-4 w-4 fill-current" />}
            </button>
            <div className="min-w-0">
              <input type="range" min={0} max={duration || 1} step="any" value={duration ? currentTime : 0} disabled={!duration || !audio.audioUrl} onChange={(event) => seek(Number(event.currentTarget.value))} className="h-1.5 w-full accent-[#f9dc0b]" aria-label="Audio progress" />
              <div className={cn("mt-1 flex justify-between font-mono text-[10px] font-semibold", dark ? "text-white/42" : "text-[#1A1A1A]/40")}><span>{formatDuration(currentTime)}</span><span>{formatDuration(duration)}</span></div>
            </div>
            {audio.audioUrl ? <a href={audio.audioUrl} download className={cn("grid h-9 w-9 place-items-center rounded-lg transition", dark ? "hover:bg-white/8" : "hover:bg-[#F3F4F6]")} aria-label="Download audio"><Download className="h-4 w-4" /></a> : null}
          </div>
        )}
      </div>
    </section>
  );
}

function videoMeta(video: AgentChatVideo): string {
  const parts = [];
  if (video.views !== undefined) parts.push(`${compact(video.views)} views`);
  if (video.viewsPerHour) parts.push(`${compact(video.viewsPerHour)} VPH`);
  if (video.comments) parts.push(`${compact(video.comments)} comments`);
  return parts.join(" / ");
}

function formatVideoDuration(seconds?: number): string {
  if (!seconds) return "";
  return formatDuration(seconds);
}

export function AgentChatBlocks({ blocks, theme = "light" }: { blocks?: AgentChatBlock[]; theme?: CardTheme }) {
  if (!blocks?.length) return null;
  return (
    <div className="mt-4 space-y-5">
      {blocks.map((block, index) => (
        <Fragment key={`${block.type}-${index}`}>
          {block.type === "report" && block.report ? <PerformanceReportView report={block.report} theme={theme} compactMode /> : null}
          {block.type === "channels" && block.items?.length ? (
            <section>
              <ContentHeading title={block.title || "Channel competitors"} count={block.items.length} theme={theme} />
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {block.items.map((channel, channelIndex) => (
                  <StandardChannelCard
                    key={channel.id || channel.url || channelIndex}
                    title={channel.title}
                    url={channel.url}
                    thumbnailUrl={channel.thumbnailUrl}
                    handle={channel.handle}
                    platform={channel.platform}
                    description={channel.description}
                    theme={theme}
                    metrics={[
                      channel.subscriberCount !== undefined ? { label: "subscribers", value: compact(channel.subscriberCount), accent: true } : null,
                      channel.bestViewsPerHour ? { label: "VPH", value: compact(channel.bestViewsPerHour) } : null,
                      channel.bestVideoViews ? { label: "best views", value: compact(channel.bestVideoViews) } : null,
                      channel.niche ? { label: "", value: channel.niche } : null,
                    ].filter(Boolean) as Array<{ label: string; value: string; accent?: boolean }>}
                  />
                ))}
              </div>
            </section>
          ) : null}
          {block.type === "videos" && block.items?.length ? (
            <section>
              <ContentHeading title={block.title || "Videos"} count={block.items.length} theme={theme} />
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                {block.items.map((video, videoIndex) => (
                  <StandardVideoCard
                    key={video.id || video.url || videoIndex}
                    title={video.title}
                    source={video.source || video.platform}
                    meta={videoMeta(video)}
                    imageUrl={video.thumbnailUrl}
                    href={video.url}
                    badge={video.badge || (video.durationSeconds ? formatVideoDuration(video.durationSeconds) : undefined)}
                    theme={theme}
                  />
                ))}
              </div>
            </section>
          ) : null}
          {block.type === "audio" && block.audio ? <InlineAudioPlayer audio={{ ...block.audio, title: block.audio.title || block.title }} theme={theme} /> : null}
        </Fragment>
      ))}
    </div>
  );
}

function ContentHeading({ title, count, theme }: { title: string; count: number; theme: CardTheme }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h4 className={cn("text-xs font-black uppercase tracking-[0.14em]", theme === "dark" ? "text-white/65" : "text-[#1A1A1A]/58")}>{title}</h4>
      <span className="rounded-full bg-[#f9dc0b]/14 px-2.5 py-1 text-[10px] font-black text-[#b89f00]">{count}</span>
    </div>
  );
}

function renderInline(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((part, index) => part.startsWith("**") && part.endsWith("**")
    ? <strong key={`${part}-${index}`} className="font-black">{part.slice(2, -2)}</strong>
    : <Fragment key={`${part}-${index}`}>{part}</Fragment>);
}

export function FormattedChatText({ content, theme = "light" }: { content: string; theme?: CardTheme }) {
  const lines = String(content || "").split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const color = theme === "dark" ? "text-[#F8F5E8]/90" : "text-[#1A1A1A]/88";
  return (
    <div className={cn("max-w-2xl space-y-2.5 text-[15px] leading-7", color)}>
      {lines.map((line, index) => {
        const bullet = line.match(/^[-*]\s+(.+)/);
        const numbered = line.match(/^(\d+)[.)]\s+(.+)/);
        const heading = line.match(/^#{1,3}\s+(.+)/);
        if (bullet) return <div key={`${line}-${index}`} className="flex gap-2.5"><span className="mt-[0.7rem] h-1.5 w-1.5 shrink-0 rounded-full bg-[#f9dc0b]" /><p>{renderInline(bullet[1])}</p></div>;
        if (numbered) return <div key={`${line}-${index}`} className="flex gap-2.5"><span className="mt-1 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[#f9dc0b]/18 text-[10px] font-black text-[#b89f00]">{numbered[1]}</span><p>{renderInline(numbered[2])}</p></div>;
        if (heading) return <h4 key={`${line}-${index}`} className="pt-1 font-serif text-lg font-bold">{renderInline(heading[1])}</h4>;
        return <p key={`${line}-${index}`}>{renderInline(line)}</p>;
      })}
    </div>
  );
}
