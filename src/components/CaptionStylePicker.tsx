import type { CSSProperties } from "react";
import { Captions } from "lucide-react";
import { CAPTION_FONTS, CAPTION_SOURCES, CAPTION_STYLES } from "../utils/captionStyles.js";
import "../styles/captionFonts.css";
import "./CaptionStylePicker.css";

type CaptionStyle = (typeof CAPTION_STYLES)[number];

// Three words play on a loop in every swatch; each takes one slot of the cycle
// (see --cap-cycle and --cap-slot in the stylesheet).
const PREVIEW_WORDS = ["ship", "it", "faster"];

// Mirrors the ASS geometry in CSS. Sizes are percentages of the frame width in
// the render; the swatch is small, so text is scaled up to stay legible while
// outline, shadow, colours and placement keep their proportions.
// Wide faces need a smaller preview to keep "faster" inside the swatch.
const PREVIEW_SCALE: Record<string, number> = { Syne: 0.78, Orbitron: 0.82, "Permanent Marker": 0.86, Bangers: 0.9 };

function lineStyle(style: CaptionStyle, frame = false): CSSProperties {
  const single = style.maxWords === 1;
  const fit = PREVIEW_SCALE[style.font] ?? 1;
  // A full 9:16 frame preview (CaptionPreview) uses the render's own geometry, unscaled.
  const outline = frame ? `${style.outline}cqw` : `${style.outline * 0.3}cqw`;
  const shadow = style.shadow * (frame ? 1 : 0.3);
  return {
    // Keep the block inside a square swatch: the render's 50-84% band maps to 36-66%.
    top: frame ? `${style.y}%` : `${Math.round(36 + ((style.y - 50) / 34) * 30)}%`,
    fontFamily: `"${style.font}", sans-serif`,
    fontSize: frame ? `${style.size}cqw` : single ? "24cqw" : `min(${style.size * 2.1 * fit}cqw, ${19 * fit}cqw)`,
    textTransform: style.uppercase ? "uppercase" : "none",
    fontStyle: style.italic ? "italic" : "normal",
    letterSpacing: style.spacing ? `${style.spacing * 0.2}cqw` : undefined,
    WebkitTextStroke: style.outline ? `${outline} ${style.colors.outline}` : undefined,
    textShadow: style.shadow ? `${shadow}cqw ${shadow}cqw 0 ${style.colors.shadow}` : "none",
    ["--cap-text" as string]: style.colors.text,
    ["--cap-active" as string]: style.colors.active,
    ["--cap-box" as string]: style.colors.box || style.colors.active,
    ["--cap-band" as string]: style.band ? `${style.band}${Math.round((style.bandAlpha ?? 0.7) * 255).toString(16).padStart(2, "0")}` : "transparent",
  };
}

export type CaptionLook = { text?: string; active?: string; font?: string };

/** A caption style with brand colours and font laid over it, as the render does (clipEdit's brandedCaptionStyle). */
export function brandedStyle(style: CaptionStyle, look?: CaptionLook): CaptionStyle {
  if (!look) return style;
  const hex = /^#[0-9a-f]{6}$/i;
  const colors: Record<string, string> = { ...style.colors };
  if (look.text && hex.test(look.text)) colors.text = look.text;
  if (look.active && hex.test(look.active)) {
    colors.active = look.active;
    if (colors.box) colors.box = look.active;
  }
  const font = look.font && look.font in CAPTION_FONTS ? look.font : style.font;
  return { ...style, font, colors } as CaptionStyle;
}

const SAMPLE_WORDS = ["this", "changes", "everything"];
export type LogoCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

/**
 * A 9:16 frame that plays one caption style on a sample line at the render's
 * own size and placement, with an optional emoji and brand logo, so a pick
 * shows what the clip will look like.
 */
export function CaptionPreview({ styleId, look, emoji, logo, label = "Caption preview" }: {
  styleId: string;
  look?: CaptionLook;
  emoji?: string;
  logo?: { url: string; position: LogoCorner; opacity: number };
  label?: string;
}) {
  const style = brandedStyle(CAPTION_STYLES.find((item) => item.id === styleId) || CAPTION_STYLES[0], look);
  const mode = style.maxWords === 1 ? "single" : style.animation;
  return (
    <figure className="cap-frame" role="img" aria-label={`${label}: ${style.name}`}>
      <span className="cap-frame-scene" aria-hidden="true" />
      {logo?.url ? <img className={`cap-frame-logo is-${logo.position}`} src={logo.url} alt="" style={{ opacity: logo.opacity }} /> : null}
      <span key={`${style.id}-${style.font}`} className={`cap-line cap-mode-${mode}${style.band ? " cap-banded" : ""}`} style={lineStyle(style, true)} aria-hidden="true">
        {SAMPLE_WORDS.map((text, i) => (
          <span key={text} className={`cap-word cap-slot-${i}`} style={{ animationDelay: `calc(var(--cap-slot) * ${i} - var(--cap-cycle))` }}>
            {text}
          </span>
        ))}
        {emoji && mode !== "single" ? <span className="cap-emoji">{emoji}</span> : null}
      </span>
      <figcaption className="cap-frame-name" aria-hidden="true">{style.name}</figcaption>
    </figure>
  );
}

export default function CaptionStylePicker({
  value,
  onChange,
  disabled = false,
  hideNone = false,
  title = "Captions",
  intro = "Pick how the narration appears on the picture. Each swatch plays the style word by word.",
}: { value: string; onChange: (id: string) => void; disabled?: boolean; hideNone?: boolean; title?: string; intro?: string }) {
  const selected = value || "none";
  return (
    <section className="cap-picker" aria-labelledby="cap-picker-title">
      <header className="cap-picker-head">
        <div>
          <strong id="cap-picker-title">{title}</strong>
          <span>{intro}</span>
        </div>
      </header>
      <div className="cap-strip" role="radiogroup" aria-label="Caption style">
        {!hideNone && (
          <button type="button" role="radio" aria-checked={selected === "none"} className="cap-card" disabled={disabled} onClick={() => onChange("none")}>
            <span className="cap-tile cap-tile-none" aria-hidden="true">
              <Captions size={30} strokeWidth={1.6} />
            </span>
            <span className="cap-name">Subtitle track only</span>
            <span className="cap-for">Captions stay a toggle for viewers</span>
          </button>
        )}
        {CAPTION_STYLES.map((style) => {
          const single = style.maxWords === 1;
          const mode = single ? "single" : style.animation;
          const banded = Boolean(style.band);
          return (
            <button
              key={style.id}
              type="button"
              role="radio"
              aria-checked={selected === style.id}
              className="cap-card"
              disabled={disabled}
              title={style.description}
              onClick={() => onChange(style.id)}
            >
              <span className="cap-tile" aria-hidden="true">
                <span className={`cap-line cap-mode-${mode}${banded ? " cap-banded" : ""}`} style={lineStyle(style)}>
                  {PREVIEW_WORDS.map((text, i) => (
                    <span key={text} className={`cap-word cap-slot-${i}`} style={{ animationDelay: `calc(var(--cap-slot) * ${i} - var(--cap-cycle))` }}>
                      {text}
                    </span>
                  ))}
                </span>
              </span>
              <span className="cap-name">{style.name}</span>
              <span className="cap-for">{style.bestFor}</span>
            </button>
          );
        })}
      </div>
      <p className="cap-credit">
        Styles adapted from{" "}
        {CAPTION_SOURCES.filter((source) => source.license === "MIT").map((source, i, all) => (
          <span key={source.id}>
            <a href={source.url} target="_blank" rel="noreferrer">
              {source.name}
            </a>
            {i < all.length - 1 ? " and " : ""}
          </span>
        ))}{" "}
        (MIT). Fonts are open licensed and embedded in the export.
      </p>
    </section>
  );
}
