// The workspace loading screen: the AutoYT mark as a motion graphic. The tile
// traces itself, floods yellow, and the play glyph drops in; then the play
// button presses, a broadcast ring ripples out, and a glint crosses the tile
// until the app is ready. Pure SVG and CSS, so it paints before any JS chunk.
import "./BrandLoader.css";

type Theme = "light" | "dark";

const savedTheme = (): Theme => {
  try {
    return window.localStorage.getItem("autoyt-theme") === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
};

/** `inline` fills its container instead of the whole window, for a page loading inside the app. */
export function BrandLoader({ label = "Loading your workspace", theme, inline = false }: { label?: string; theme?: Theme; inline?: boolean }) {
  const mode = theme || savedTheme();
  return (
    <div className={inline ? "bl is-inline" : "bl"} data-theme={mode} role="status" aria-live="polite" aria-label={label}>
      <div className="bl-stage" aria-hidden="true">
        <span className="bl-halo" />
        <span className="bl-ring" />
        <span className="bl-ring bl-ring-late" />
        <svg className="bl-mark" viewBox="0 0 120 120" focusable="false">
          <defs>
            <clipPath id="bl-tile-clip">
              <rect x="10" y="10" width="100" height="100" rx="14" />
            </clipPath>
            <linearGradient id="bl-glint" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#fff" stopOpacity="0" />
              <stop offset="0.5" stopColor="#fffbe0" stopOpacity="0.95" />
              <stop offset="1" stopColor="#fff" stopOpacity="0" />
            </linearGradient>
          </defs>
          <g clipPath="url(#bl-tile-clip)">
            <rect className="bl-flood" x="10" y="10" width="100" height="100" />
            <rect className="bl-glint" x="-40" y="-10" width="40" height="140" fill="url(#bl-glint)" style={{ mixBlendMode: "screen" }} />
          </g>
          <rect className="bl-trace" x="10" y="10" width="100" height="100" rx="14" pathLength="100" />
          <g className="bl-play">
            <path d="M47 40.5 L47 79.5 L80.5 60 Z" />
          </g>
        </svg>
      </div>
    </div>
  );
}
