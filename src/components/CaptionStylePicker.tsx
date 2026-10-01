import type { CSSProperties } from "react";
import { Captions } from "lucide-react";
import { CAPTION_SOURCES, CAPTION_STYLES } from "../utils/captionStyles.js";
import "./CaptionStylePicker.css";

type CaptionStyle = (typeof CAPTION_STYLES)[number];

// Three words play on a loop in every swatch; each takes one slot of the cycle
// (see --cap-cycle and --cap-slot in the stylesheet).
const PREVIEW_WORDS = ["ship", "it", "faster"];

// Mirrors the ASS geometry in CSS. Sizes are percentages of the frame width in
// the render; the swatch is small, so text is scaled up to stay legible while
// outline, shadow, colours and placement keep their proportions.
function lineStyle(style: CaptionStyle): CSSProperties {
  const single = style.maxWords === 1;
  const outline = `${style.outline * 0.3}cqw`;
  return {
    // Keep the block inside a square swatch: the render's 50-84% band maps to 36-66%.
    top: `${Math.round(36 + ((style.y - 50) / 34) * 30)}%`,
    fontFamily: `"${style.font}", sans-serif`,
    fontSize: single ? "24cqw" : `min(${style.size * 2.1}cqw, 19cqw)`,
    textTransform: style.uppercase ? "uppercase" : "none",
    fontStyle: style.italic ? "italic" : "normal",
    letterSpacing: style.spacing ? `${style.spacing * 0.2}cqw` : undefined,
    WebkitTextStroke: style.outline ? `${outline} ${style.colors.outline}` : undefined,
    textShadow: style.shadow ? `${style.shadow * 0.3}cqw ${style.shadow * 0.3}cqw 0 ${style.colors.shadow}` : "none",
    ["--cap-text" as string]: style.colors.text,
    ["--cap-active" as string]: style.colors.active,
    ["--cap-box" as string]: style.colors.box || style.colors.active,
    ["--cap-band" as string]: style.animation === "none" && style.colors.box ? `${style.colors.box}b8` : "transparent",
  };
}

export default function CaptionStylePicker({ value, onChange, disabled = false }: { value: string; onChange: (id: string) => void; disabled?: boolean }) {
  const selected = value || "none";
  return (
    <section className="cap-picker" aria-labelledby="cap-picker-title">
      <header className="cap-picker-head">
        <div>
          <strong id="cap-picker-title">Captions</strong>
          <span>Pick how the narration appears on the picture. Each swatch plays the style word by word.</span>
        </div>
      </header>
      <div className="cap-strip" role="radiogroup" aria-label="Caption style">
        <button type="button" role="radio" aria-checked={selected === "none"} className="cap-card" disabled={disabled} onClick={() => onChange("none")}>
          <span className="cap-tile cap-tile-none" aria-hidden="true">
            <Captions size={30} strokeWidth={1.6} />
          </span>
          <span className="cap-name">Subtitle track only</span>
          <span className="cap-for">Captions stay a toggle for viewers</span>
        </button>
        {CAPTION_STYLES.map((style) => {
          const single = style.maxWords === 1;
          const mode = single ? "single" : style.animation;
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
                <span className={`cap-line cap-mode-${mode}`} style={lineStyle(style)}>
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
