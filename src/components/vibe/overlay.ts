// Draws titles and captions onto a full-frame canvas. The preview paints it
// live over the video; the export paints the same frames to PNGs that ffmpeg
// lays over the picture, so captions look identical in both.
import type { CaptionStyleId, VibeCue, VibeProject, VibeText } from "../../utils/vibeEdit";
import { CAPTION_STYLES as CATALOG, findCaptionStyle } from "../../utils/captionStyles.js";

export interface CaptionStyle {
  id: CaptionStyleId;
  name: string;
  y: number;
  size: number;
  weight: number;
  upper: boolean;
  fill: string;
  active: string;
  stroke?: string;
  strokeWidth?: number;
  shadow?: string;
  box?: string;
  activeBox?: string;
  glow?: string;
  /** Active word scale. */
  pop?: number;
  maxWords?: number;
  /** Catalog extras: a font family (loaded from /fonts/captions), italics, a
   * left-to-right colour wipe, a band behind the whole line, and a hard shadow. */
  font?: string;
  italic?: boolean;
  karaoke?: boolean;
  shadowOffset?: number;
  catalog?: boolean;
}

// Vibe Edit draws from the shared caption catalog, the same looks Create Video
// burns in. Projects saved with the editor's retired looks map to their nearest
// catalog style ("clean" and "bubble" moved into the catalog as they were).
const RETIRED_LOOKS: Record<string, string> = { hook: "hormozi", punchy: "mrbeast", highlight: "tiktok-hype", neon: "neon-cyber" };
export const resolveCaptionStyleId = (id?: string) => (id && RETIRED_LOOKS[id]) || id || "clean";

// A shared-catalog style (see captionStyles.js) expressed in the canvas renderer's
// terms. Catalog sizes are percentages of the frame width; the canvas works in
// pixels at a 1080 frame, so 1% is 10.8px.
function fromCatalog(entry: (typeof CATALOG)[number]): CaptionStyle {
  const px = (pct: number) => Math.round(pct * 10.8 * 10) / 10;
  const size = px(entry.size * (entry.maxWords === 1 ? 1 : 0.92));
  const banded = Boolean(entry.band);
  const alpha = Math.round(((entry.bandAlpha ?? 0.7) * 255)).toString(16).padStart(2, "0");
  return {
    id: entry.id,
    name: entry.name,
    y: entry.y / 100,
    size,
    weight: 800,
    upper: Boolean(entry.uppercase),
    fill: entry.colors.text,
    active: entry.colors.active,
    ...(entry.outline && !banded ? { stroke: entry.colors.outline, strokeWidth: (px(entry.outline) * 2) / size } : {}),
    ...(entry.shadow && !banded ? { shadow: entry.colors.shadow, shadowOffset: px(entry.shadow) / size } : {}),
    ...(banded ? { box: `${entry.band}${alpha}` } : {}),
    ...(entry.animation === "box" ? { activeBox: entry.colors.box || entry.colors.active } : {}),
    ...(entry.animation === "glow" ? { glow: "transparent" } : {}),
    ...(entry.animation === "pop" ? { pop: 1.12 } : entry.animation === "bounce" ? { pop: 1.2 } : entry.animation === "scale" ? { pop: 1.06 } : {}),
    ...(entry.animation === "karaoke" ? { karaoke: true } : {}),
    maxWords: entry.maxWords,
    font: entry.font,
    italic: Boolean(entry.italic),
    catalog: true,
  };
}
const catalogCache = new Map<string, CaptionStyle>();
export function captionStyle(id?: string): CaptionStyle {
  const entry = findCaptionStyle(resolveCaptionStyleId(id)) || findCaptionStyle("clean")!;
  let style = catalogCache.get(entry.id);
  if (!style) {
    style = fromCatalog(entry);
    catalogCache.set(entry.id, style);
  }
  return style;
}
/** A short tour of the catalog for one-tap cycling (Auto edit). */
export const CAPTION_STYLES: CaptionStyle[] = ["clean", "hormozi", "mrbeast", "minimal", "pill", "bubble", "neon-cyber", "karaoke"].map((id) => captionStyle(id));
/** Start loading a catalog font so the next preview frame and the export draw with it. */
export function loadCaptionFont(id?: string): Promise<unknown> {
  const style = captionStyle(id);
  if (!style.font || typeof document === "undefined" || !document.fonts?.load) return Promise.resolve();
  return document.fonts.load(`${style.weight} 24px "${style.font}"`).catch(() => undefined);
}

const FONT = `Inter, "Inter Variable", system-ui, -apple-system, "Segoe UI", sans-serif`;

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Break words into lines that fit `max` pixels wide. */
function wrap(ctx: CanvasRenderingContext2D, words: string[], max: number): number[][] {
  const lines: number[][] = [];
  let cur: number[] = [];
  let width = 0;
  const space = ctx.measureText(" ").width;
  words.forEach((w, i) => {
    const ww = ctx.measureText(w).width;
    if (cur.length && width + space + ww > max) {
      lines.push(cur);
      cur = [];
      width = 0;
    }
    width += (cur.length ? space : 0) + ww;
    cur.push(i);
  });
  if (cur.length) lines.push(cur);
  return lines;
}

function drawText(ctx: CanvasRenderingContext2D, t: VibeText, W: number) {
  // Sizes are px on the short side of a 1080 frame, so landscape matches portrait.
  const k = Math.min(W, ctx.canvas.height) / 1080;
  const size = t.size * k;
  ctx.font = `800 ${size}px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const words = t.text.split(/\s+/).filter(Boolean);
  const lines = wrap(ctx, words, W * 0.86);
  const lh = size * 1.15;
  const x = t.x * W;
  const top = t.y * ctx.canvas.height - ((lines.length - 1) * lh) / 2;
  lines.forEach((line, li) => {
    const text = line.map((i) => words[i]).join(" ");
    const y = top + li * lh;
    const w = ctx.measureText(text).width;
    if (t.look === "boxed") {
      ctx.fillStyle = "rgba(10,10,12,.82)";
      roundRect(ctx, x - w / 2 - size * 0.35, y - lh / 2, w + size * 0.7, lh, size * 0.18);
      ctx.fill();
    }
    if (t.look === "outline") {
      ctx.lineJoin = "round";
      ctx.lineWidth = size * 0.14;
      ctx.strokeStyle = "#000000";
      ctx.strokeText(text, x, y);
    } else if (t.look !== "boxed") {
      ctx.shadowColor = "rgba(0,0,0,.55)";
      ctx.shadowBlur = size * 0.18;
      ctx.shadowOffsetY = size * 0.04;
    }
    ctx.fillStyle = t.color || "#ffffff";
    ctx.fillText(text, x, y);
    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
  });
}

/** The words of a cue to show at `time`, and which one is being spoken. */
export function cueWindow(cue: VibeCue, time: number, maxWords?: number): { words: string[]; active: number; progress: number } {
  const all = cue.words?.length ? cue.words.map((w) => w.w) : cue.text.split(/\s+/).filter(Boolean);
  let active = -1;
  let progress = 0;
  if (cue.words?.length) {
    active = cue.words.findIndex((w) => time >= w.t0 && time < w.t1);
    if (active < 0) active = cue.words.findIndex((w, i) => time >= w.t0 && (!cue.words![i + 1] || time < cue.words![i + 1].t0));
    const w = cue.words[active];
    if (w) progress = Math.min(1, Math.max(0, (time - w.t0) / Math.max(0.01, w.t1 - w.t0)));
  } else {
    const span = cue.end - cue.start;
    const pos = ((time - cue.start) / Math.max(span, 0.01)) * all.length;
    active = Math.min(all.length - 1, Math.floor(pos));
    progress = Math.min(1, Math.max(0, pos - active));
  }
  if (!maxWords || all.length <= maxWords) return { words: all, active, progress };
  const page = Math.floor(Math.max(0, active) / maxWords);
  return { words: all.slice(page * maxWords, page * maxWords + maxWords), active: active - page * maxWords, progress };
}

function drawCue(ctx: CanvasRenderingContext2D, project: VibeProject, cue: VibeCue, time: number, W: number, H: number) {
  const cap = project.captions;
  const style = captionStyle(cap.style);
  const k = Math.min(W, H) / 1080;
  const size = (cap.size || style.size) * k;
  const { words: raw, active: rawActive, progress } = cueWindow(cue, time, style.maxWords);
  const active = cap.wordHighlight ? rawActive : -1;
  const words = raw.map((w) => (style.upper ? w.toUpperCase() : w));
  ctx.font = `${style.italic ? "italic " : ""}${style.weight} ${size}px ${style.font ? `"${style.font}", ` : ""}${FONT}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const lines = wrap(ctx, words, W * 0.84);
  const lh = size * 1.22;
  const cy = (cap.y ?? style.y) * H;
  const top = cy - ((lines.length - 1) * lh) / 2;
  const space = ctx.measureText(" ").width;

  if (style.box) {
    const widest = Math.max(...lines.map((l) => ctx.measureText(l.map((i) => words[i]).join(" ")).width));
    ctx.fillStyle = style.box;
    ctx.shadowColor = "rgba(0,0,0,.35)";
    ctx.shadowBlur = size * 0.3;
    ctx.shadowOffsetY = size * 0.08;
    roundRect(ctx, W / 2 - widest / 2 - size * 0.45, top - lh / 2 - size * 0.2, widest + size * 0.9, lines.length * lh + size * 0.4, size * 0.4);
    ctx.fill();
    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
  }

  lines.forEach((line, li) => {
    const widths = line.map((i) => ctx.measureText(words[i]).width);
    // The spoken word grows; give it the room so it never eats a space.
    const advance = line.map((i, j) => widths[j] * (i === active && style.pop ? style.pop : 1));
    const total = advance.reduce((a, b) => a + b, 0) + space * (line.length - 1);
    let x = W / 2 - total / 2;
    const y = top + li * lh;
    line.forEach((i, j) => {
      const w = words[i];
      const isActive = i === active;
      const scale = isActive && style.pop ? style.pop : 1;
      ctx.save();
      ctx.translate(x + advance[j] / 2, y);
      ctx.scale(scale, scale);
      if (isActive && style.activeBox) {
        ctx.fillStyle = style.activeBox;
        roundRect(ctx, -widths[j] / 2 - size * 0.14, -lh / 2 + size * 0.06, widths[j] + size * 0.28, lh - size * 0.12, size * 0.16);
        ctx.fill();
      }
      if (style.glow) {
        ctx.shadowColor = isActive ? style.active : style.glow;
        ctx.shadowBlur = size * 0.45;
      } else if (style.shadow && !(isActive && style.activeBox)) {
        ctx.shadowColor = style.shadow;
        ctx.shadowBlur = style.shadowOffset ? 0 : size * 0.2;
        ctx.shadowOffsetX = style.shadowOffset ? size * style.shadowOffset : 0;
        ctx.shadowOffsetY = size * (style.shadowOffset || 0.05);
      }
      if (style.stroke) {
        ctx.lineJoin = "round";
        ctx.lineWidth = size * (style.strokeWidth || 0.14);
        ctx.strokeStyle = style.stroke;
        ctx.strokeText(w, -widths[j] / 2, 0);
      }
      // Karaoke: words before the spoken one are filled, the spoken one fills
      // left to right with the narration, the rest wait in the base colour.
      const sung = style.karaoke && active >= 0 && i < active;
      ctx.fillStyle = sung || (isActive && !style.karaoke) ? style.active : style.fill;
      ctx.fillText(w, -widths[j] / 2, 0);
      if (style.karaoke && isActive && progress > 0) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(-widths[j] / 2 - size * 0.1, -lh, widths[j] * progress + size * 0.1, lh * 2);
        ctx.clip();
        ctx.fillStyle = style.active;
        ctx.fillText(w, -widths[j] / 2, 0);
        ctx.restore();
      }
      ctx.restore();
      x += advance[j] + space;
    });
  });
}

/** Paint everything drawn over the picture at `time`. Returns whether anything was drawn. */
export function drawOverlay(ctx: CanvasRenderingContext2D, project: VibeProject, time: number): boolean {
  const { width: W, height: H } = ctx.canvas;
  ctx.clearRect(0, 0, W, H);
  let drew = false;
  const hidden = (key: string) => Boolean(project.tracks?.[key]?.hidden);
  for (const t of hidden("text") ? [] : project.texts) {
    if (time >= t.start && time < t.end) {
      drawText(ctx, t, W);
      drew = true;
    }
  }
  if (project.captions.show && !hidden("cue")) {
    const cue = project.captions.cues.find((c) => time >= c.start && time < c.end);
    if (cue) {
      drawCue(ctx, project, cue, time, W, H);
      drew = true;
    }
  }
  return drew;
}

/** Every moment the overlay changes: title and cue edges plus word edges. */
export function overlayChangePoints(project: VibeProject, duration: number): number[] {
  const points = new Set<number>([0, duration]);
  const add = (t: number) => t >= 0 && t <= duration && points.add(Math.round(t * 1000) / 1000);
  (project.tracks?.text?.hidden ? [] : project.texts).forEach((t) => {
    add(t.start);
    add(t.end);
  });
  if (project.captions.show) {
    const style = captionStyle(project.captions.style);
    project.captions.cues.forEach((c) => {
      add(c.start);
      add(c.end);
      if (project.captions.wordHighlight || style.maxWords) {
        // A karaoke wipe moves within the word, so it gets a few steps per word.
        const steps = style.karaoke ? 4 : 1;
        if (c.words?.length) c.words.forEach((w) => {
          for (let k = 0; k < steps; k++) add(w.t0 + ((w.t1 - w.t0) * k) / steps);
          add(w.t1);
        });
        else {
          const n = c.text.split(/\s+/).filter(Boolean).length;
          for (let i = 0; i < n; i++) for (let k = 0; k < steps; k++) add(c.start + ((c.end - c.start) * (i + k / steps)) / n);
        }
      }
    });
  }
  return [...points].sort((a, b) => a - b);
}

/** Render the export overlay frames: one PNG per stretch where the overlay is constant. */
export async function renderOverlayFrames(project: VibeProject, width: number, height: number, duration: number, onProgress?: (k: number) => void) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser can't draw captions for export.");
  await loadCaptionFont(project.captions.style);
  await document.fonts?.ready;
  const blank = canvas.toDataURL("image/png");
  const points = overlayChangePoints(project, duration);
  const frames: { t0: number; t1: number; png: string }[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const t0 = points[i];
    const t1 = points[i + 1];
    if (t1 - t0 < 0.01) continue;
    if (drawOverlay(ctx, project, (t0 + t1) / 2)) frames.push({ t0, t1, png: canvas.toDataURL("image/png") });
    if (i % 20 === 0) {
      onProgress?.(i / points.length);
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  return { blank, frames };
}

let measurer: CanvasRenderingContext2D | null = null;
/** Where a title's text sits in a W×H frame, matching drawText's layout. */
export function textBox(t: VibeText, W: number, H: number): { left: number; top: number; width: number; height: number } {
  measurer ??= document.createElement("canvas").getContext("2d");
  const k = Math.min(W, H) / 1080;
  const size = t.size * k;
  const lh = size * 1.15;
  if (!measurer) return { left: t.x * W - 100, top: t.y * H - lh / 2, width: 200, height: lh };
  measurer.font = `800 ${size}px ${FONT}`;
  const words = t.text.split(/\s+/).filter(Boolean);
  const lines = wrap(measurer, words, W * 0.86);
  const width = Math.max(size, ...lines.map((l) => measurer!.measureText(l.map((i) => words[i]).join(" ")).width));
  const pad = t.look === "boxed" ? size * 0.35 : size * 0.1;
  const height = lines.length * lh;
  return { left: t.x * W - width / 2 - pad, top: t.y * H - height / 2, width: width + pad * 2, height };
}
