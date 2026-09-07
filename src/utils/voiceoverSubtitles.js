export const DEFAULT_SUBTITLES = {
  enabled: false, treatment: "strip", y: 76, height: 18,
  font: "Arial", fontSize: 4, color: "#ffffff", outline: 2, bold: true, italic: false,
};

const bounded = (value, fallback, min, max) => Number.isFinite(Number(value)) ? Math.min(max, Math.max(min, Number(value))) : fallback;
export function normalizeSubtitleSettings(value = {}) {
  value = value || {};
  const y = bounded(value.y, 76, 0, 94);
  return {
    enabled: value.enabled === true,
    treatment: value.treatment === "blur" ? "blur" : "strip",
    y, height: bounded(value.height, 18, 6, 100 - y),
    font: ["Arial", "DejaVu Sans", "Liberation Serif"].includes(value.font) ? value.font : "Arial",
    fontSize: bounded(value.fontSize, 4, 2, 8),
    color: /^#[0-9a-f]{6}$/i.test(value.color || "") ? value.color : "#ffffff",
    outline: bounded(value.outline, 2, 0, 6), bold: value.bold !== false, italic: value.italic === true,
  };
}

export function subtitleRegion(dimensions, value) {
  const settings = normalizeSubtitleSettings(value);
  const width = Math.floor(Number(dimensions.width));
  const height = Math.floor(Number(dimensions.height));
  if (!(width >= 16 && height >= 16)) throw new Error("Cannot read video dimensions for subtitles.");
  const y = Math.min(height - 2, Math.floor(height * settings.y / 100 / 2) * 2);
  const bandHeight = Math.max(2, Math.min(height - y, Math.floor(height * settings.height / 100 / 2) * 2));
  const fontSize = Math.max(8, Math.min(width * settings.fontSize / 100, bandHeight / 1.5));
  const maxLines = Math.max(1, Math.min(2, Math.floor(bandHeight / (fontSize * 1.4))));
  return { width, height, y, bandHeight, fontSize, maxLines, centerY: y + bandHeight / 2 };
}

// Use the final audio's word timestamps. Never reuse the original script's clock.
export function buildSubtitleCues(segments, duration, maxChars = 60) {
  const words = [];
  for (const segment of segments || []) {
    if (segment.words?.length) words.push(...segment.words.map((word) => ({ start: word.start, end: word.end, text: word.word })));
    else {
      const tokens = String(segment.text || "").trim().split(/\s+/).filter(Boolean);
      tokens.forEach((text, index) => words.push({ text, start: segment.start + (segment.end - segment.start) * index / tokens.length, end: segment.start + (segment.end - segment.start) * (index + 1) / tokens.length }));
    }
  }
  const valid = words.map((w) => ({ text: String(w.text || "").replace(/[\r\n]+/g, " ").trim(), start: Math.max(0, Number(w.start)), end: Math.min(duration, Number(w.end)) }))
    .filter((w) => w.text && Number.isFinite(w.start) && Number.isFinite(w.end) && w.end > w.start).sort((a, b) => a.start - b.start);
  const cues = [];
  let cue = null;
  for (const word of valid) {
    if (cue && (cue.text.length + word.text.length + 1 > maxChars || word.end - cue.start > 3.5 || word.start - cue.end > 0.6)) { cues.push(cue); cue = null; }
    if (!cue) cue = { ...word };
    else { cue.text += ` ${word.text}`; cue.end = Math.max(cue.end, word.end); }
    if (/[.!?]$/.test(word.text)) { cues.push(cue); cue = null; }
  }
  if (cue) cues.push(cue);
  cues.forEach((item, i) => { item.end = Math.min(duration, cues[i + 1]?.start ?? duration, Math.max(item.end, item.start + 0.12)); });
  return cues.filter((item) => item.end > item.start);
}

function timestamp(seconds, ass = false) {
  const units = ass ? 100 : 1000;
  const n = Math.round(seconds * units);
  return `${String(Math.floor(n / (3600 * units))).padStart(ass ? 1 : 2, "0")}:${String(Math.floor(n / (60 * units)) % 60).padStart(2, "0")}:${String(Math.floor(n / units) % 60).padStart(2, "0")}${ass ? "." : ","}${String(n % units).padStart(ass ? 2 : 3, "0")}`;
}

export function subtitlesSrt(cues) {
  return cues.map((cue, i) => `${i + 1}\n${timestamp(cue.start)} --> ${timestamp(cue.end)}\n${cue.text}\n`).join("\n");
}

export function subtitlesAss(cues, dimensions, value) {
  const settings = normalizeSubtitleSettings(value);
  const r = subtitleRegion(dimensions, settings);
  const color = `&H00${settings.color.slice(5, 7)}${settings.color.slice(3, 5)}${settings.color.slice(1, 3)}`;
  const header = `[Script Info]\nScriptType: v4.00+\nPlayResX: ${r.width}\nPlayResY: ${r.height}\nWrapStyle: 0\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,${settings.font},${r.fontSize},${color},${color},&H00000000,&H00000000,${settings.bold ? -1 : 0},${settings.italic ? -1 : 0},0,0,100,100,0,0,1,${settings.outline},0,5,${Math.round(r.width * .05)},${Math.round(r.width * .05)},0,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;
  return header + cues.map((cue) => {
    // Strip ASS control characters from narration, which is untrusted text.
    const text = cue.text.replace(/\\/g, "＼").replace(/[{}]/g, "").replace(/[\r\n]/g, " ");
    return `Dialogue: 0,${timestamp(cue.start, true)},${timestamp(cue.end, true)},Default,,0,0,0,,{\\an5\\pos(${Math.round(r.width / 2)},${Math.round(r.centerY)})}${text}`;
  }).join("\n") + "\n";
}

export function subtitleVideoFilter(dimensions, value, assPath) {
  const settings = normalizeSubtitleSettings(value);
  const r = subtitleRegion(dimensions, settings);
  const escaped = assPath.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "'\\''");
  const cover = settings.treatment === "strip"
    ? `[0:v]drawbox=x=0:y=${r.y}:w=iw:h=${r.bandHeight}:color=black:t=fill[covered]`
    : `[0:v]split[base][region];[region]crop=iw:${r.bandHeight}:0:${r.y},boxblur=luma_radius=${Math.min(30, Math.floor(r.bandHeight / 4))}:luma_power=3:chroma_radius=8:chroma_power=2[blurred];[base][blurred]overlay=0:${r.y},drawbox=x=0:y=${r.y}:w=iw:h=${r.bandHeight}:color=black@0.35:t=fill[covered]`;
  return `${cover};[covered]ass=filename='${escaped}'[captioned]`;
}
