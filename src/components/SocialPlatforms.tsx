// The one list of social platforms and the one way to show them: brand-tinted
// icon tiles (from Automation Agents' publish destinations). Used to connect
// channels (channel picker, Account) and to pick where an agent publishes.
import type { ReactNode } from "react";
import { Facebook, Ghost, Instagram, Linkedin, Music2, Pin, Twitter, Youtube } from "lucide-react";
import "./SocialPlatforms.css";

export type SocialPlatformId = "youtube" | "tiktok" | "instagram" | "facebook" | "snapchat" | "pinterest" | "twitter" | "linkedin";

export type SocialPlatform = {
  id: SocialPlatformId;
  label: string;
  /** Longer name for "Connect …" actions. */
  connectLabel: string;
  icon: (size?: number) => ReactNode;
  /** Brand colour; `ink` is the icon colour on the tint ("" = follow the text colour). */
  color: string;
  ink: string;
};

export const SOCIAL_PLATFORMS: SocialPlatform[] = [
  { id: "youtube", label: "YouTube", connectLabel: "YouTube channel", icon: (s = 16) => <Youtube size={s} />, color: "#FF0000", ink: "#D60000" },
  { id: "tiktok", label: "TikTok", connectLabel: "TikTok account", icon: (s = 16) => <Music2 size={s} />, color: "#1A1A1A", ink: "" },
  { id: "instagram", label: "Instagram", connectLabel: "Instagram", icon: (s = 16) => <Instagram size={s} />, color: "#E1306C", ink: "#C13584" },
  { id: "facebook", label: "Facebook", connectLabel: "Facebook Page", icon: (s = 16) => <Facebook size={s} />, color: "#1877F2", ink: "#1877F2" },
  { id: "snapchat", label: "Snapchat", connectLabel: "Snapchat", icon: (s = 16) => <Ghost size={s} />, color: "#FFFC00", ink: "#1A1A1A" },
  { id: "pinterest", label: "Pinterest", connectLabel: "Pinterest", icon: (s = 16) => <Pin size={s} />, color: "#E60023", ink: "#E60023" },
  { id: "twitter", label: "X", connectLabel: "X", icon: (s = 16) => <Twitter size={s} />, color: "#1A1A1A", ink: "" },
  { id: "linkedin", label: "LinkedIn", connectLabel: "LinkedIn", icon: (s = 16) => <Linkedin size={s} />, color: "#0A66C2", ink: "#0A66C2" },
];

export function socialPlatform(id: string) {
  return SOCIAL_PLATFORMS.find((platform) => platform.id === String(id || "").toLowerCase());
}

/** Where to send someone to connect an account on `id`, returning them to `next`. */
export function connectHref(id: string, next = "/channels") {
  const back = encodeURIComponent(next);
  if (id === "youtube") return `/api/auth/google?mode=connect&next=${back}`;
  if (id === "tiktok") return `/api/auth/tiktok?mode=connect&next=${back}`;
  return `/api/auth/social/${id}?next=${back}`;
}

/** The brand-tinted icon square on its own (lists, modal headers). */
export function PlatformIcon({ id, size = 40 }: { id: string; size?: number }) {
  const platform = socialPlatform(id);
  if (!platform) return null;
  return (
    <span className="sp-icon" style={{ ["--sp-brand" as string]: platform.color, ["--sp-ink" as string]: platform.ink || "currentColor", width: size, height: size }} aria-hidden="true">
      {platform.icon(Math.round(size * 0.42))}
    </span>
  );
}

type GridProps = {
  /** Defaults to every platform. */
  platforms?: SocialPlatform[];
  /** Tiles become links to connect each platform. */
  connectNext?: string;
  /** Tiles become buttons. */
  onSelect?: (id: SocialPlatformId) => void;
  selected?: (id: SocialPlatformId) => boolean;
  /** Small line under the label, e.g. "2 on". */
  note?: (id: SocialPlatformId) => ReactNode;
  /** "row" scrolls sideways in one line; "wrap" fills a grid. */
  layout?: "row" | "wrap";
  label?: string;
  className?: string;
};

export function PlatformGrid({ platforms = SOCIAL_PLATFORMS, connectNext, onSelect, selected, note, layout = "wrap", label = "Social platforms", className }: GridProps) {
  return (
    <div className={["sp-grid", `sp-grid-${layout}`, className].filter(Boolean).join(" ")} role="list" aria-label={label}>
      {platforms.map((platform) => {
        const on = Boolean(selected?.(platform.id));
        const body = (
          <>
            <PlatformIcon id={platform.id} />
            <span className="sp-label">{platform.label}</span>
            {note ? <span className="sp-note">{note(platform.id)}</span> : null}
          </>
        );
        return (
          <div key={platform.id} role="listitem" className="sp-cell">
            {onSelect ? (
              <button type="button" className="sp-tile" data-on={on || undefined} aria-pressed={selected ? on : undefined} onClick={() => onSelect(platform.id)}>
                {body}
              </button>
            ) : (
              <a className="sp-tile" href={connectHref(platform.id, connectNext)} aria-label={`Connect ${platform.connectLabel}`} title={`Connect ${platform.connectLabel}`}>
                {body}
              </a>
            )}
          </div>
        );
      })}
    </div>
  );
}
