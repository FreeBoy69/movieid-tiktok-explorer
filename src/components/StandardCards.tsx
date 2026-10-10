import { ArrowUpRight, ListVideo, PlaySquare, Users, Youtube } from "lucide-react";
import { ReactNode, type MouseEvent } from "react";
import { cn } from "../lib/utils";
import "./StandardCards.css";

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
  /** The still's shape: portrait (TikTok, Shorts) or landscape (YouTube videos). Defaults by the image. */
  shape?: "portrait" | "landscape";
};

/** A video card in the studio layout's card language (LayoutCard): the still first, rounded and framed,
 *  with the title and byline under it. Overlays (a checkbox, a badge) sit on the still. */
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
  className,
  imageClassName,
  ariaLabel,
  shape,
}: StandardVideoCardProps) {
  const label = ariaLabel || `Open ${title || "video"}`;
  // YouTube's stills are 16:9; cropping them into a tall frame cut most of the picture away.
  const landscape = shape ? shape === "landscape" : /ytimg\.com|youtube\.com|ggpht\.com/.test(imageUrl || "") || /\baspect-video\b/.test(className || "");
  return (
    <article className={cn("std-card", landscape && "is-landscape", className?.replace(/\baspect-video\b/, ""))}>
      {href ? (
        <a href={href} target="_blank" rel="noreferrer" className="std-card-hit" aria-label={label} />
      ) : onOpen ? (
        <button type="button" onClick={onOpen} className="std-card-hit" aria-label={label} />
      ) : null}
      <div className="std-card-media">
        {media || (imageUrl ? (
          <img src={imageUrl} alt="" className={imageClassName} referrerPolicy="no-referrer" loading="lazy" decoding="async" />
        ) : (
          fallback || <span className="std-card-empty"><PlaySquare className="h-7 w-7" /></span>
        ))}
        {topLeft || badge ? <div className="std-card-tl">{topLeft || <span className="std-card-badge">{badge}</span>}</div> : null}
        {topRight ? <div className="std-card-tr">{topRight}</div> : null}
        {overlay ? <div className="std-card-overlay">{overlay}</div> : null}
      </div>
      <div className="std-card-body">
        {contentTop ? <div className="std-card-top">{contentTop}</div> : null}
        <h3 className="std-card-title">{title || "Untitled video"}</h3>
        {source ? onSourceClick ? (
          <button type="button" onClick={onSourceClick} className="std-card-source">{source}</button>
        ) : <p className="std-card-source">{source}</p> : null}
        {meta ? <p className="std-card-meta">{meta}</p> : null}
        {description ? <p className="std-card-desc">{description}</p> : null}
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
  return (
    <StandardVideoCard
      title={title}
      source={isChannel ? "Saved channel" : "Saved playlist"}
      meta={meta}
      imageUrl={imageUrl}
      media={media}
      fallback={<span className="std-card-empty"><ListVideo className="h-8 w-8" /></span>}
      onOpen={onOpen}
      topRight={topRight}
      theme={theme}
      className={className}
      ariaLabel={`Open ${isChannel ? "channel" : "playlist"} ${title}`}
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

/** A channel card: its picture and name, the handle under it, a few numbers, and its actions. */
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
  actions,
  topRight,
  onOpen,
  className,
}: StandardChannelCardProps) {
  const platformLabel = platform.toLowerCase() === "tiktok" ? "TikTok" : "YouTube";
  const PlatformIcon = platformLabel === "YouTube" ? Youtube : Users;
  const label = `Open ${title || `${platformLabel} channel`}`;
  return (
    <article className={cn("std-channel", className)}>
      {url ? (
        <a href={url} target="_blank" rel="noreferrer" className="std-card-hit" aria-label={label} />
      ) : onOpen ? (
        <button type="button" onClick={onOpen} className="std-card-hit" aria-label={label} />
      ) : null}
      <div className="std-channel-head">
        <span className="std-channel-avatar">
          {media || (thumbnailUrl ? <img src={thumbnailUrl} alt="" referrerPolicy="no-referrer" loading="lazy" decoding="async" /> : <PlatformIcon className="h-5 w-5" />)}
        </span>
        <div className="std-channel-name">
          <h3>{title || `${platformLabel} channel`}</h3>
          {handle || meta ? <p>{handle || meta}</p> : null}
        </div>
        {topRight ? <div className="std-channel-tr">{topRight}</div> : url ? <ArrowUpRight className="std-channel-go h-4 w-4" aria-hidden="true" /> : null}
      </div>
      {description ? <p className="std-channel-desc">{description}</p> : null}
      {metrics.length ? (
        <dl className="std-channel-metrics">
          {metrics.slice(0, actions ? 2 : 4).map((metric) => (
            <div key={`${metric.label}-${metric.value}`}>
              <dt>{metric.label}</dt>
              <dd className={metric.accent ? "is-accent" : undefined}>{metric.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {actions ? <div className="std-channel-actions">{actions}</div> : null}
    </article>
  );
}
