import { useState, type FormEvent, type ReactNode } from "react";
import { ArrowUp, Check, Loader2 } from "lucide-react";
import { Tabs } from "./ui/controls";
import "./StudioLayout.css";

// One layout for the Create home page and every studio: a title, the chat box
// (inputs and settings inside it, a round send button at its foot), then tabs over
// the results, templates, or options. Studios supply the pieces; the page looks the
// same everywhere.

export type LayoutTab<T extends string = string> = { value: T; label: string; icon?: ReactNode; hint?: string };

export function StudioLayout<T extends string>({
  title,
  intro,
  back,
  big = false,
  above,
  composer,
  notices,
  heading,
  aside,
  tabs,
  tab,
  onTab,
  tabsLabel = "Sections",
  theme,
  children,
}: {
  title: ReactNode;
  intro?: ReactNode;
  /** A back link above the title (tools return to All tools). */
  back?: ReactNode;
  /** The home page's oversized title. */
  big?: boolean;
  /** Mode switches that change what the box makes (sit just above it). */
  above?: ReactNode;
  /** The chat box; a section without one (a library, a form) renders straight into the panel. */
  composer?: ReactNode;
  notices?: ReactNode;
  heading?: ReactNode;
  aside?: ReactNode;
  tabs?: Array<LayoutTab<T>>;
  tab?: T;
  onTab?: (tab: T) => void;
  tabsLabel?: string;
  theme?: "light" | "dark";
  children?: ReactNode;
}) {
  return (
    <div className={`sl${big ? " is-home" : ""}`} data-theme={theme}>
      <div className="sl-inner">
        <header className="sl-head">
          {back ? <div className="sl-back">{back}</div> : null}
          <h1 className="sl-title">{title}</h1>
          {intro ? <p className="sl-intro">{intro}</p> : null}
        </header>
        {above ? <div className="sl-above">{above}</div> : null}
        {composer}
        {notices ? <div className="sl-notices">{notices}</div> : null}
        {heading || aside ? (
          <div className="sl-gallery-head">
            {heading ? <h2>{heading}</h2> : <span />}
            {aside}
          </div>
        ) : null}
        {tabs && tabs.length > 1 && tab !== undefined && onTab ? (
          <div className="sl-tabs-row">
            <Tabs className="sl-tabs is-pill" label={tabsLabel} value={tab} options={tabs} onChange={onTab} />
          </div>
        ) : null}
        <div className="sl-panel">{children}</div>
      </div>
    </div>
  );
}

/** The chat box. Render it as a form when the send button submits. */
export function Composer({
  as = "div",
  onSubmit,
  className = "",
  top,
  children,
  controls,
  send,
}: {
  as?: "div" | "form";
  onSubmit?: (event: FormEvent) => void;
  className?: string;
  /** Floats on the box's top-left corner (the reference card stack). */
  top?: ReactNode;
  children: ReactNode;
  /** Settings at the box's foot: mode, model, aspect, length, cost. */
  controls?: ReactNode;
  send: ReactNode;
}) {
  const body = (
    <>
      {top}
      {children}
      <div className="sl-bar">
        <div className="sl-controls">{controls}</div>
        {send}
      </div>
    </>
  );
  const cls = `sl-box${top ? "" : " no-stack"}${className ? ` ${className}` : ""}`;
  return as === "form" ? <form className={cls} onSubmit={onSubmit}>{body}</form> : <div className={cls}>{body}</div>;
}

export function SendButton({ disabled, busy, label, type = "button", onClick }: { disabled?: boolean; busy?: boolean; label: string; type?: "button" | "submit"; onClick?: () => void }) {
  return (
    <button type={type} className="sl-send" disabled={disabled} onClick={onClick} aria-label={label} title={label}>
      {busy ? <Loader2 size={18} className="ui-spin" /> : <ArrowUp size={18} />}
    </button>
  );
}

export function Masonry({ children }: { children: ReactNode }) {
  return <div className="sl-masonry">{children}</div>;
}

/** A template or app card: still (or a text card when there is none), title and byline under it, a tag on the right. */
export function LayoutCard({ title, sub, note, tag, image, video, ratio, selected, onClick }: { title: string; sub?: string; note?: string; tag?: string; image?: string; video?: string; ratio: number; selected?: boolean; onClick: () => void }) {
  const [broken, setBroken] = useState(false);
  const showMedia = Boolean((image || video) && !broken);
  return (
    <button type="button" className={`sl-card${selected ? " is-selected" : ""}`} onClick={onClick} aria-pressed={selected}>
      <span className={`sl-card-media${showMedia ? "" : " is-text"}`} style={{ aspectRatio: String(showMedia ? Math.max(0.56, Math.min(1.9, ratio)) : 4 / 3) }}>
        {showMedia ? (
          image
            ? <img src={image} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setBroken(true)} />
            : <video src={video} muted loop playsInline preload="metadata" onMouseEnter={(event) => void event.currentTarget.play().catch(() => {})} onMouseLeave={(event) => event.currentTarget.pause()} onError={() => setBroken(true)} />
        ) : (
          // No still yet: the card shows what it does, and the title sits below like every other card.
          <span className="sl-card-text"><strong>{note || sub || title}</strong></span>
        )}
        {selected ? <span className="sl-card-check"><Check size={14} /> Selected</span> : null}
      </span>
      <span className="sl-card-meta">
        <span className="sl-card-title">
          <strong>{title}</strong>
          {sub ? <small>{sub}</small> : null}
        </span>
        {tag ? <span className="sl-card-tag">{tag}</span> : null}
      </span>
    </button>
  );
}
