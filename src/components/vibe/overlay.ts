// Draws titles and captions onto a full-frame canvas. The preview paints it
// live over the video; the export paints the same frames to PNGs that ffmpeg
// lays over the picture, so captions look identical in both.
import type { CaptionStyleId, VibeCue, VibeProject, VibeText } from "../../utils/vibeEdit";

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
}

export const CAPTION_STYLES: CaptionStyle[] = [
  { id: "clean", name: "Clean", y: 0.8, size: 62, weight: 700, upper: false, fill: "#ffffff", active: "#f9dc0b", shadow: "rgba(0,0,0,.75)" },
  { id: "hook", name: "Hook", y: 0.64, size: 86, weight: 900, upper: true, fill: "#ffffff", active: "#f9dc0b", stroke: "#000000", strokeWidth: 0.16, pop: 1.12 },
  { id: "punchy", name: "Punchy", y: 0.6, size: 96, weight: 900, upper: true, fill: "#ffffff", active: "#ffffff", stroke: "#000000", strokeWidth: 0.2, pop: 1.22, maxWords: 3 },
  { id: "minimal", name: "Minimal", y: 0.86, size: 48, weight: 500, upper: false, fill: "#ffffff", active: "#ffffff", shadow: "rgba(0,0,0,.6)" },
  { id: "highlight", name: "Highlight", y: 0.74, size: 70, weight: 800, upper: false, fill: "#ffffff", active: "#14110a", activeBox: "#f9dc0b", shadow: "rgba(0,0,0,.6)" },
  { id: "bubble", name: "Bubble", y: 0.78, size: 60, weight: 700, upper: false, fill: "#14110a", active: "#b02a6b", box: "#ffffff" },
  { id: "neon", name: "Neon", y: 0.7, size: 78, weight: 800, upper: true, fill: "#e9fbff", active: "#ff5ad1", glow: "#38e1ff" },
];
export const captionStyle = (id?: string) => CAPTION_STYLES.find((s) => s.id === id) || CAPTION_STYLES[0];

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
export function cueWindow(cue: VibeCue, time: number, maxWords?: number): { words: string[]; active: number } {
  const all = cue.words?.length ? cue.words.map((w) => w.w) : cue.text.split(/\s+/).filter(Boolean);
  let active = -1;
  if (cue.words?.length) active = cue.words.findIndex((w) => time >= w.t0 && time < w.t1);
  else {
    const span = cue.end - cue.start;
    active = Math.min(all.length - 1, Math.floor(((time - cue.start) / Math.max(span, 0.01)) * all.length));
  }
  if (!maxWords || all.length <= maxWords) return { words: all, active };
  const page = Math.floor(Math.max(0, active) / maxWords);
  return { words: all.slice(page * maxWords, page * maxWords + maxWords), active: active - page * maxWords };
}

function drawCue(ctx: CanvasRenderingContext2D, project: VibeProject, cue: VibeCue, time: number, W: number, H: number) {
  const cap = project.captions;
  const style = captionStyle(cap.style);
  const k = Math.min(W, H) / 1080;
  const size = (cap.size || style.size) * k;
  const { words: raw, active: rawActive } = cueWindow(cue, time, style.maxWords);
  const active = cap.wordHighlight ? rawActive : -1;
  const words = raw.map((w) => (style.upper ? w.toUpperCase() : w));
  ctx.font = `${style.weight} ${size}px ${FONT}`;
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
        ctx.shadowBlur = size * 0.2;
        ctx.shadowOffsetY = size * 0.05;
      }
      if (style.stroke) {
        ctx.lineJoin = "round";
        ctx.lineWidth = size * (style.strokeWidth || 0.14);
        ctx.strokeStyle = style.stroke;
        ctx.strokeText(w, -widths[j] / 2, 0);
      }
      ctx.fillStyle = isActive ? style.active : style.fill;
      ctx.fillText(w, -widths[j] / 2, 0);
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
  for (const t of project.texts) {
    if (time >= t.start && time < t.end) {
      drawText(ctx, t, W);
      drew = true;
    }
  }
  if (project.captions.show) {
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
  project.texts.forEach((t) => {
    add(t.start);
    add(t.end);
  });
  if (project.captions.show) {
    const style = captionStyle(project.captions.style);
    project.captions.cues.forEach((c) => {
      add(c.start);
      add(c.end);
      if (project.captions.wordHighlight || style.maxWords) {
        if (c.words?.length) c.words.forEach((w) => {
          add(w.t0);
          add(w.t1);
        });
        else {
          const n = c.text.split(/\s+/).filter(Boolean).length;
          for (let i = 1; i < n; i++) add(c.start + ((c.end - c.start) * i) / n);
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
