import { ArrowUpRight, ListVideo, PlaySquare, Users, Youtube } from "lucide-react";
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
  theme?: CardTheme;
  className?: string;
  imageClassName?: string;
  ariaLabel?: string;
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
        "group relative isolate aspect-[9/16] min-w-0 overflow-hidden rounded-2xl shadow-[0_14px_36px_-24px_rgba(15,23,42,0.8)] ring-1 transition duration-300 hover:-translate-y-1 hover:shadow-[0_22px_48px_-24px_rgba(15,23,42,0.9)]",
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

      <div className="pointer-events-none absolute inset-0 z-[2] bg-[linear-gradient(180deg,rgba(0,0,0,0.18)_0%,rgba(0,0,0,0.02)_34%,rgba(0,0,0,0.86)_100%)] transition duration-300 group-hover:bg-[linear-gradient(180deg,rgba(0,0,0,0.22)_0%,rgba(0,0,0,0.06)_34%,rgba(0,0,0,0.9)_100%)]" />

      {(topLeft || badge) ? (
        <div className="pointer-events-none absolute left-3 top-3 z-10 flex max-w-[calc(100%-5rem)] flex-col items-start gap-1.5">
          {topLeft || <span className="max-w-full truncate rounded-full bg-[#f9dc0b] px-2.5 py-1 text-xs font-black text-[#1A1A1A] shadow-sm">{badge}</span>}
        </div>
      ) : null}

      {topRight ? <div className="absolute right-3 top-3 z-20">{topRight}</div> : null}
      {overlay ? <div className="pointer-events-none absolute inset-0 z-20">{overlay}</div> : null}

      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 p-4 text-white">
        {contentTop ? <div className="mb-2">{contentTop}</div> : null}
        {source ? onSourceClick ? (
          <button type="button" onClick={onSourceClick} className="pointer-events-auto mb-1 block max-w-full truncate text-left text-[10px] font-black uppercase tracking-widest text-[#f9dc0b] underline-offset-2 hover:underline">{source}</button>
        ) : <p className="mb-1 truncate text-[10px] font-black uppercase tracking-widest text-[#f9dc0b]">{source}</p> : null}
        <h3 className="line-clamp-2 text-[15px] font-black leading-snug tracking-[-0.01em]">{title || "Untitled video"}</h3>
        {description ? <p className="mt-1 line-clamp-2 text-[11px] font-semibold leading-4 text-white/68">{description}</p> : null}
        {meta ? <p className="mt-1.5 line-clamp-1 text-[11px] font-semibold text-white/72">{meta}</p> : null}
      </div>
    </article>
  );
}

export type StandardPlaylistCardProps = {
  title: string;
  kind?: "playlist" | "channel";
  meta?: string;
  imageUrl?: string;
  media?: ReactNode;
  onOpen: () => void;
  topRight?: ReactNode;
  theme?: CardTheme;
  className?: string;
};

export function StandardPlaylistCard({
  title,
  kind = "playlist",
  meta,
  imageUrl,
  media,
  onOpen,
  topRight,
  theme = "light",
  className,
}: StandardPlaylistCardProps) {
  const isChannel = kind === "channel";
  if (isChannel) {
    return (
      <StandardChannelCard
        title={title}
        platform="tiktok"
        thumbnailUrl={imageUrl}
        media={media}
        meta={meta}
        onOpen={onOpen}
        topRight={topRight}
        theme={theme}
        className={className}
      />
    );
  }
  return (
    <StandardVideoCard
      title={title}
      source="Saved playlist"
      meta={meta}
      imageUrl={imageUrl}
      media={media}
      fallback={<div className="grid h-full place-items-center bg-[linear-gradient(160deg,#111827,#292524)]"><ListVideo className="h-9 w-9 text-[#f9dc0b]" /></div>}
      onOpen={onOpen}
      topRight={topRight}
      theme={theme}
      className={className}
      ariaLabel={`Open playlist ${title}`}
    />
  );
}

export type StandardChannelMetric = {
  label: string;
  value: string;
  accent?: boolean;
};

export type StandardChannelCardProps = {
  title: string;
  url?: string;
  thumbnailUrl?: string;
  media?: ReactNode;
  handle?: string;
  meta?: string;
  platform?: "youtube" | "tiktok" | string;
  description?: string;
  metrics?: StandardChannelMetric[];
  theme?: CardTheme;
  actions?: ReactNode;
  topRight?: ReactNode;
  onOpen?: () => void;
  className?: string;
};

export function StandardChannelCard({
  title,
  url,
  thumbnailUrl,
  media,
  handle,
  meta,
  platform = "youtube",
  description,
  metrics = [],
  theme = "light",
  actions,
  topRight,
  onOpen,
  className,
}: StandardChannelCardProps) {
  const platformLabel = platform.toLowerCase() === "tiktok" ? "TikTok" : "YouTube";
  const PlatformIcon = platformLabel === "YouTube" ? Youtube : Users;
  const label = `Open ${title || `${platformLabel} channel`}`;

  return (
    <article className={cn(
      "group relative isolate aspect-square min-w-0 overflow-hidden rounded-lg border p-3 text-left shadow-[0_10px_26px_-22px_rgba(15,23,42,0.65)] transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_16px_34px_-22px_rgba(15,23,42,0.75)]",
      theme === "dark" ? "border-white/10 bg-[#151916] text-[#F8F5E8]" : "border-[#1A1A1A]/10 bg-white text-[#1A1A1A]",
      className,
    )}>
      {url ? (
        <a href={url} target="_blank" rel="noreferrer" className="absolute inset-0 z-[1] rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-[#f9dc0b] focus-visible:ring-offset-2" aria-label={label} />
      ) : onOpen ? (
        <button type="button" onClick={onOpen} className="absolute inset-0 z-[1] rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-[#f9dc0b] focus-visible:ring-offset-2" aria-label={label} />
      ) : null}

      <div className="pointer-events-none relative z-10 flex h-full min-h-0 flex-col">
        <div className="flex items-start justify-between gap-2">
          <div className={cn("grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-lg border", theme === "dark" ? "border-white/12 bg-white/7" : "border-[#1A1A1A]/10 bg-[#F4F5F2]")}>
          {media || (thumbnailUrl ? (
            <img src={thumbnailUrl} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" loading="lazy" />
          ) : (
            <PlatformIcon className="h-5 w-5 text-[#b89f00]" />
          ))}
          </div>
          {topRight ? <div className="pointer-events-auto relative z-20">{topRight}</div> : (
            <span className={cn("grid h-7 w-7 place-items-center rounded-lg", theme === "dark" ? "bg-white/7 text-[#F8F5E8]/55" : "bg-[#1A1A1A]/5 text-[#1A1A1A]/45")}>
              {url ? <ArrowUpRight className="h-3.5 w-3.5" /> : <PlatformIcon className="h-3.5 w-3.5" />}
            </span>
          )}
        </div>

        <h3 className="mt-3 line-clamp-2 text-sm font-black leading-[1.25]">{title || `${platformLabel} channel`}</h3>
        {handle || meta ? <p className={cn("mt-1 truncate text-[10px] font-bold", theme === "dark" ? "text-[#F8F5E8]/48" : "text-[#1A1A1A]/48")}>{handle || meta}</p> : null}
        {description ? <p className={cn("mt-1 line-clamp-1 text-[10px] font-semibold", theme === "dark" ? "text-[#F8F5E8]/40" : "text-[#1A1A1A]/42")}>{description}</p> : null}

        {metrics.length ? (
          <div className={cn("mt-auto grid grid-cols-2 gap-1 border-t pt-2 text-[9px] font-bold", theme === "dark" ? "border-white/10 text-[#F8F5E8]/45" : "border-[#1A1A1A]/8 text-[#1A1A1A]/45")}>
            {metrics.slice(0, actions ? 2 : 4).map((metric) => (
              <span key={`${metric.label}-${metric.value}`} className="min-w-0 truncate">
                <strong className={metric.accent ? "text-[#b89f00]" : theme === "dark" ? "text-[#F8F5E8]" : "text-[#1A1A1A]"}>{metric.value}</strong>{metric.label ? <span className="block truncate">{metric.label}</span> : null}
              </span>
            ))}
          </div>
        ) : null}

        {actions ? <div className="pointer-events-auto relative z-20 mt-2">{actions}</div> : null}
      </div>
    </article>
  );
}
