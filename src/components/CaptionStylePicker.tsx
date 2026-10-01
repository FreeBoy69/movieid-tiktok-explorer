import type { CSSProperties } from "react";
import { Captions } from "lucide-react";
import { CAPTION_SOURCES, CAPTION_STYLES } from "../utils/captionStyles.js";
import "./CaptionStylePicker.css";

type CaptionStyle = (typeof CAPTION_STYLES)[number];

const PREVIEW_WORDS = ["ship", "it", "faster"];
const ACTIVE_INDEX = 2;

// Mirrors the ASS geometry in CSS. Sizes are percentages of the frame width in
// the render; the tile is a swatch, so text is scaled up to stay legible while
// outline, shadow and placement keep their proportions.
function previewStyle(style: CaptionStyle): { line: CSSProperties; word: CSSProperties; active: CSSProperties } {
  const outline = `${style.outline * 0.3}cqw`;
  const shadow = style.shadow ? `${style.shadow * 0.3}cqw ${style.shadow * 0.3}cqw 0 ${style.colors.shadow}` : "none";
  const line: CSSProperties = {
    top: `${style.y}%`,
    fontFamily: `"${style.font}", sans-serif`,
    fontSize: `${style.size * 2.1}cqw`,
    textTransform: style.uppercase ? "uppercase" : "none",
    fontStyle: style.italic ? "italic" : "normal",
    letterSpacing: style.spacing ? `${style.spacing * 0.2}cqw` : undefined,
    color: style.colors.text,
    WebkitTextStroke: style.outline ? `${outline} ${style.colors.outline}` : undefined,
    textShadow: shadow,
  };
  const word: CSSProperties = {};
  const active: CSSProperties = { color: style.colors.active };
  switch (style.animation) {
    case "pop":
      active.transform = "scale(1.12)";
      break;
    case "scale":
      active.transform = "scale(1.06)";
      break;
    case "bounce":
      active.transform = "scale(1.18) rotate(-2deg)";
      break;
    case "box":
      active.background = style.colors.box;
      active.borderRadius = "0.35em";
      active.padding = "0.04em 0.3em";
      active.WebkitTextStroke = "0";
      break;
    case "karaoke":
      active.backgroundImage = `linear-gradient(90deg, ${style.colors.active} 55%, ${style.colors.text} 55%)`;
      active.WebkitBackgroundClip = "text";
      active.backgroundClip = "text";
      active.color = "transparent";
      active.WebkitTextStroke = "0";
      active.textShadow = "none";
      break;
    case "none":
      line.background = style.colors.box ? `${style.colors.box}b8` : undefined;
      line.borderRadius = "0.3em";
      line.padding = "0.25em 0.6em";
      active.color = style.colors.text;
      break;
    default:
      break;
  }
  return { line, word, active };
}

export default function CaptionStylePicker({ value, onChange, disabled = false }: { value: string; onChange: (id: string) => void; disabled?: boolean }) {
  const selected = value || "none";
  return (
    <section className="cap-picker" aria-labelledby="cap-picker-title">
      <header className="cap-picker-head">
        <div>
          <strong id="cap-picker-title">Captions</strong>
          <span>Pick how the narration appears on the picture. Every style follows the voice word by word.</span>
        </div>
      </header>
      <div className="cap-strip" role="radiogroup" aria-label="Caption style">
        <button
          type="button"
          role="radio"
          aria-checked={selected === "none"}
          className="cap-card"
          disabled={disabled}
          onClick={() => onChange("none")}
        >
          <span className="cap-tile cap-tile-none" aria-hidden="true">
            <Captions size={28} strokeWidth={1.6} />
          </span>
          <span className="cap-name">Subtitle track only</span>
          <span className="cap-for">Captions stay a toggle for viewers</span>
        </button>
        {CAPTION_STYLES.map((style) => {
          const css = previewStyle(style);
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
                <span className="cap-line" style={css.line}>
                  {PREVIEW_WORDS.map((text, i) => (
                    <span key={text} className="cap-word" style={i === ACTIVE_INDEX ? { ...css.word, ...css.active } : css.word}>
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
