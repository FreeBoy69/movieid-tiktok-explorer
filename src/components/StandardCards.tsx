import { ExternalLink, PlaySquare, Users, Youtube } from "lucide-react";
import { ReactNode, type MouseEvent } from "react";
import { cn } from "../lib/utils";

export type CardTheme = "light" | "dark";

export type StandardVideoCardProps = {
  title: string;
  source?: string;
  onSourceClick?: (event: MouseEvent<HTMLButtonElement>) => void;
  meta?: string;
  description?: string;
  imageUrl?: string;
  media?: ReactNode;
  fallback?: ReactNode;
  href?: string;
  onOpen?: () => void;
  badge?: ReactNode;
  topLeft?: ReactNode;
  topRight?: ReactNode;
  contentTop?: ReactNode;
  overlay?: ReactNode;
  aspect?: "portrait" | "vertical" | "landscape";
  theme?: CardTheme;
  className?: string;
  imageClassName?: string;
  ariaLabel?: string;
};

const VIDEO_CARD_ASPECT = {
  portrait: "aspect-[9/13]",
  vertical: "aspect-[9/16]",
  landscape: "aspect-video",
};

export function StandardVideoCard({
  title,
  source,
  onSourceClick,
  meta,
  description,
  imageUrl,
  media,
  fallback,
  href,
  onOpen,
  badge,
  topLeft,
  topRight,
  contentTop,
  overlay,
  aspect = "portrait",
  theme = "light",
  className,
  imageClassName,
  ariaLabel,
}: StandardVideoCardProps) {
  const label = ariaLabel || `Open ${title || "video"}`;
  const interactionClass = "absolute inset-0 z-[1] rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-[#f9dc0b] focus-visible:ring-offset-2";

  return (
    <article
      className={cn(
        "group relative isolate min-w-0 overflow-hidden rounded-2xl shadow-sm ring-1 transition duration-200 hover:-translate-y-0.5 hover:shadow-xl",
        VIDEO_CARD_ASPECT[aspect],
        theme === "dark" ? "bg-[#151923] ring-white/10" : "bg-[#111827] ring-[#1A1A1A]/8",
        className,
      )}
    >
      {href ? (
        <a href={href} target="_blank" rel="noreferrer" className={interactionClass} aria-label={label} />
      ) : onOpen ? (
        <button type="button" onClick={onOpen} className={interactionClass} aria-label={label} />
      ) : null}

      <div className="absolute inset-0 z-0 overflow-hidden">
        {media || (imageUrl ? (
          <img
            src={imageUrl}
            alt=""
            className={cn("h-full w-full object-cover transition duration-500 group-hover:scale-105", imageClassName)}
            referrerPolicy="no-referrer"
            loading="lazy"
          />
        ) : (
          fallback || <div className="grid h-full place-items-center bg-[#111827]"><PlaySquare className="h-8 w-8 text-[#f9dc0b]" /></div>
        ))}
      </div>

      <div className="pointer-events-none absolute inset-0 z-[2] bg-gradient-to-t from-black via-black/22 to-black/5 transition duration-200 group-hover:via-black/30" />

      {(topLeft || badge) ? (
        <div className="pointer-events-none absolute left-3 top-3 z-10 flex max-w-[calc(100%-5rem)] flex-col items-start gap-1.5">
          {topLeft || <span className="max-w-full truncate rounded-full bg-[#f9dc0b] px-2.5 py-1 text-xs font-black text-[#1A1A1A] shadow-sm">{badge}</span>}
        </div>
      ) : null}

      {topRight ? <div className="absolute right-3 top-3 z-20">{topRight}</div> : null}
      {overlay ? <div className="pointer-events-none absolute inset-0 z-20">{overlay}</div> : null}

      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 p-3.5 text-white">
        {contentTop ? <div className="mb-2">{contentTop}</div> : null}
        {source ? onSourceClick ? (
          <button type="button" onClick={onSourceClick} className="pointer-events-auto mb-1 block max-w-full truncate text-left text-[10px] font-black uppercase tracking-widest text-[#f9dc0b] underline-offset-2 hover:underline">{source}</button>
        ) : <p className="mb-1 truncate text-[10px] font-black uppercase tracking-widest text-[#f9dc0b]">{source}</p> : null}
        <h3 className="line-clamp-2 text-sm font-black leading-snug">{title || "Untitled video"}</h3>
        {description ? <p className="mt-1 line-clamp-2 text-[11px] font-semibold leading-4 text-white/68">{description}</p> : null}
        {meta ? <p className="mt-1.5 line-clamp-1 text-[11px] font-semibold text-white/72">{meta}</p> : null}
      </div>
    </article>
  );
}

export type StandardChannelMetric = {
  label: string;
  value: string;
  accent?: boolean;
};

export type StandardChannelCardProps = {
  title: string;
  url: string;
  thumbnailUrl?: string;
  handle?: string;
  platform?: "youtube" | "tiktok" | string;
  description?: string;
  metrics?: StandardChannelMetric[];
  theme?: CardTheme;
  actions?: ReactNode;
  className?: string;
};

export function StandardChannelCard({
  title,
  url,
  thumbnailUrl,
  handle,
  platform = "youtube",
  description,
  metrics = [],
  theme = "light",
  actions,
  className,
}: StandardChannelCardProps) {
  const dark = theme === "dark";
  const platformLabel = platform.toLowerCase() === "tiktok" ? "TikTok" : "YouTube";
  const PlatformIcon = platformLabel === "YouTube" ? Youtube : Users;

  return (
    <article className={cn(
      "flex min-h-40 min-w-0 flex-col rounded-2xl p-4 shadow-sm ring-1 transition duration-200 hover:-translate-y-0.5 hover:shadow-lg",
      dark ? "bg-[#151923] text-white ring-white/10" : "bg-white text-[#111827] ring-[#1A1A1A]/8",
      className,
    )}>
      <div className="flex items-start gap-3">
        <div className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-2xl bg-[#111827]">
          {thumbnailUrl ? (
            <img src={thumbnailUrl} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" loading="lazy" />
          ) : (
            <PlatformIcon className="h-6 w-6 text-[#f9dc0b]" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <span className="inline-flex items-center rounded-full bg-[#f9dc0b]/12 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-[#b89f00]">{platformLabel}</span>
          <a href={url} target="_blank" rel="noreferrer" className="mt-1.5 flex min-w-0 items-start gap-2 hover:underline hover:decoration-[#f9dc0b] hover:underline-offset-4">
            <span className="min-w-0 flex-1 truncate text-sm font-black">{title || `${platformLabel} channel`}</span>
            <ExternalLink className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", dark ? "text-white/45" : "text-[#1A1A1A]/35")} />
          </a>
          {handle ? <p className={cn("mt-1 truncate text-[11px] font-bold", dark ? "text-white/45" : "text-[#1A1A1A]/42")}>{handle}</p> : null}
        </div>
      </div>

      {description ? <p className={cn("mt-3 line-clamp-2 text-xs font-semibold leading-5", dark ? "text-white/58" : "text-[#1A1A1A]/55")}>{description}</p> : null}

      {metrics.length ? (
        <div className="mt-auto flex flex-wrap gap-2 pt-3">
          {metrics.slice(0, 4).map((metric) => (
            <span key={`${metric.label}-${metric.value}`} className={cn(
              "rounded-full px-2.5 py-1 text-[10px] font-black",
              metric.accent ? "bg-[#f9dc0b] text-[#1A1A1A]" : dark ? "bg-white/8 text-white/70" : "bg-[#F4F5F8] text-[#1A1A1A]/65",
            )}>
              {metric.value} {metric.label}
            </span>
          ))}
        </div>
      ) : null}

      {actions ? <div className="relative z-10 mt-3">{actions}</div> : null}
    </article>
  );
}
