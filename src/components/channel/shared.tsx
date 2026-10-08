// Helpers shared by ChannelManagement's screens.
import { Loader2 } from "lucide-react";
import { ReactNode } from "react";
import { YouTubeChannelDashboard, YouTubeDashboardVideo } from "../../types";
import { cn } from "../../lib/utils";
import { Notice as SharedNotice } from "../ui/controls";

export function compactNumber(value: number): string {
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value || 0);
}

export function dateAge(value: string): string {
  if (!value) return "unknown";
  const hours = Math.max(1, Math.round((Date.now() - new Date(value).getTime()) / 36e5));
  if (hours < 48) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 60) return `${days}d ago`;
  return `${Math.round(days / 30)}mo ago`;
}

export function sharpYouTubeThumbnail(url: string): string {
  if (!url) return "";
  return url
    .replace(/\/default\.jpg(\?|$)/, "/hqdefault.jpg$1")
    .replace(/\/mqdefault\.jpg(\?|$)/, "/hqdefault.jpg$1");
}

export const GOOGLE_READ_CONNECT_URL = "/api/auth/google?mode=connect&provider=google&next=/channels";

type MonetizationState = "ready" | "no_data" | "missing_scope" | "not_connected" | "unsupported" | "error";

type MonetizationTotals = {
  views?: number;
  estimatedRevenue?: number;
  estimatedAdRevenue?: number;
  estimatedRedPartnerRevenue?: number;
  grossRevenue?: number;
  monetizedPlaybacks?: number;
  adImpressions?: number;
  playbackBasedCpm?: number;
  cpm?: number;
  revenuePerThousandViews?: number;
};

export type YouTubeMonetizationResponse = {
  state?: MonetizationState;
  status?: MonetizationState;
  authorized?: boolean;
  reauthorizationRequired?: boolean;
  reauthorizeUrl?: string;
  message?: string;
  error?: string;
  currency?: string;
  period?: {
    days?: number;
    current?: { startDate?: string; endDate?: string };
    previous?: { startDate?: string; endDate?: string };
  };
  current?: MonetizationTotals;
  previous?: MonetizationTotals;
  changes?: Partial<Record<keyof MonetizationTotals, number | null>>;
  daily?: Array<{
    day: string;
    views: number;
    estimatedRevenue: number;
    monetizedPlaybacks: number;
    adImpressions: number;
    revenuePerThousandViews: number;
  }>;
  topVideos?: Array<{
    videoId: string;
    title: string;
    thumbnailUrl: string;
    views: number;
    estimatedRevenue: number;
    monetizedPlaybacks: number;
    adImpressions: number;
    revenuePerThousandViews: number;
  }>;
};

export function plainNumber(value: number | string | null | undefined): string {
  const n = Number(value || 0);
  return new Intl.NumberFormat("en").format(Number.isFinite(n) ? n : 0);
}

export function formatDuration(seconds: number): string {
  const n = Math.max(0, Math.round(seconds || 0));
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  const s = n % 60;
  if (h) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function feedKeywords(text: string): string[] {
  return Array.from(new Set(String(text || "")
    .toLowerCase()
    .replace(/&amp;/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 3 && !["video", "official", "shorts", "youtube", "with", "from", "that", "this", "your", "what", "when", "where", "into", "then", "they", "their"].includes(word))))
    .slice(0, 12);
}

export function keywordLabel(value: string): string {
  return value.split(/\s+/).map((word) => word.slice(0, 1).toUpperCase() + word.slice(1)).join(" ");
}

export function cleanMetadataTag(value: string): string {
  return String(value || "")
    .replace(/^\s*\d+\s+/, "")
    .replace(/^#+/, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
}

export function uniqueTags(values: string[]): string[] {
  const seen = new Set<string>();
  return values
    .map(cleanMetadataTag)
    .filter(Boolean)
    .filter((tag) => {
      const key = tag.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 30);
}

export function buildTagSuggestions(video: YouTubeDashboardVideo, growth: YouTubeChannelDashboard["growthInsights"] | null, index = 0) {
  const nicheWords = [
    growth?.playbook.bestNiche,
    growth?.playbook.bestHook,
    growth?.playbook.monetizationFocus,
    ...(growth?.niches || []).slice(0, 5).flatMap((niche) => [niche.microNiche, niche.subNiche, niche.macroNiche]),
  ].filter(Boolean).join(" ");
  const currentTags = Array.isArray(video.tags) ? video.tags.join(" ") : "";
  const words = feedKeywords(`${video.title} ${video.description || ""} ${currentTags} ${nicheWords}`);
  const fallback = ["story explained", "faceless content", "youtube shorts", "high retention", "recap", "viral story", "character reveal", "plot twist"];
  return uniqueTags(words.length ? words : fallback).slice(0, 12).map((tag, tagIndex) => ({
    label: keywordLabel(tag),
    score: Math.max(23, 82 - index * 4 - tagIndex * 3),
  }));
}

export function InlineStatus({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2 rounded-2xl border border-[var(--ui-accent)]/35 bg-[var(--ui-accent)]/16 px-4 py-3 text-sm font-bold text-[var(--ui-text)]/70">
      <Loader2 className="h-4 w-4 ui-spin text-[var(--ui-accent-text)]" />
      {message}
    </div>
  );
}

export function Notice({ tone, title, body, action, className }: { tone: "warn" | "error"; title: string; body: string; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("ui-inherit", className)}>
      <SharedNotice tone={tone === "error" ? "error" : "warning"} title={title} action={action}>{body}</SharedNotice>
    </div>
  );
}

export function TagScoreChip({ tag }: { tag: { label: string; score: number } }) {
  return (
    <span className="inline-flex items-center overflow-hidden rounded-xl bg-[var(--ui-accent)]/10 text-xs font-black text-[var(--ui-accent-text)]">
      <span className="bg-[var(--ui-accent-soft)] px-2.5 py-2 text-[var(--ui-text)]">{tag.score}</span>
      <span className="px-2.5 py-2">{tag.label}</span>
    </span>
  );
}
