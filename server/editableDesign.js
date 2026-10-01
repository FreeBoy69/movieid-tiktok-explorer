// Editable Design: a fixed-canvas poster written as one HTML file with live
// text and independently movable layers, after the Editable-Design method
// (github.com/yejy53/Editable-Design, Apache-2.0). The text model plans the
// composition and the imagery, the image runner paints the assets, the text
// model then writes the layout against those assets. These helpers are pure;
// the runner in creatorStudio.js wires them to the models and storage.

export const DESIGN_CANVASES = {
  "3:4": { width: 1200, height: 1600, label: "Poster 3:4", use: "print poster, flyer, feed post" },
  "4:5": { width: 1080, height: 1350, label: "Portrait 4:5", use: "Instagram and feed posts" },
  "1:1": { width: 1200, height: 1200, label: "Square 1:1", use: "covers, social squares" },
  "9:16": { width: 1080, height: 1920, label: "Story 9:16", use: "stories, phone wallpapers, vertical ads" },
  "16:9": { width: 1920, height: 1080, label: "Wide 16:9", use: "banners, slides, YouTube covers" },
  a4: { width: 1240, height: 1754, label: "A4", use: "printable sheets, menus, one-pagers" },
};
export const DESIGN_DIRECTIONS = ["auto", "editorial", "luxury", "brutalist", "playful", "technical", "retro", "minimal"];
export const DESIGN_IMAGERY = ["auto", "none", "rich"];
export const MAX_DESIGN_ASSETS = 4;
export const MAX_DESIGN_UPLOADS = 6;

// Zero external requests means system stacks only; every role gets a stack that exists on Mac, Windows, and most phones.
export const DESIGN_FONT_STACKS = {
  "serif-display": `Georgia, "Iowan Old Style", "Palatino Linotype", "Book Antiqua", "Times New Roman", serif`,
  grotesk: `"Helvetica Neue", Helvetica, Arial, "Segoe UI", sans-serif`,
  humanist: `"Gill Sans", "Gill Sans MT", "Trebuchet MS", Verdana, sans-serif`,
  condensed: `"Avenir Next Condensed", "Arial Narrow", "Roboto Condensed", "Helvetica Neue", sans-serif`,
  mono: `"SF Mono", Menlo, Consolas, "Liberation Mono", monospace`,
  system: `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`,
  cjk: `"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif`,
  "cjk-serif": `"Songti SC", "STSong", "SimSun", "Noto Serif CJK SC", serif`,
};

const clip = (value, max) => String(value ?? "").trim().slice(0, max);
const oneOf = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);

/** The settings a request may carry, trimmed to what the runner understands. */
export function designSettings(s = {}, { ref = (v) => v } = {}) {
  const canvas = DESIGN_CANVASES[s.canvas] ? s.canvas : "3:4";
  return {
    canvas,
    aspectRatio: canvas === "a4" ? "3:4" : canvas,
    direction: oneOf(String(s.direction || "auto"), DESIGN_DIRECTIONS, "auto"),
    imagery: oneOf(String(s.imagery || "auto"), DESIGN_IMAGERY, "auto"),
    uploads: (Array.isArray(s.uploads) ? s.uploads : [])
      .map((u) => ({ file: ref(u?.file), label: clip(u?.label, 60) || undefined }))
      .filter((u) => u.file && /\.(png|jpg|webp)$/.test(u.file))
      .slice(0, MAX_DESIGN_UPLOADS),
  };
}

const fontList = () => Object.entries(DESIGN_FONT_STACKS).map(([id, stack]) => `- ${id}: ${stack}`).join("\n");

/** Messages that ask the text model for the integrated design plan as JSON. */
export function designPlanMessages({ brief, canvas, direction, imagery, uploads = [], previous = null }) {
  const size = DESIGN_CANVASES[canvas] || DESIGN_CANVASES["3:4"];
  const maxAssets = imagery === "none" ? 0 : imagery === "rich" ? MAX_DESIGN_ASSETS : 3;
  const system = `You are a senior graphic designer planning a fixed-canvas poster that will be built as editable HTML: real text, independent image layers, nothing baked into pictures.
Canvas: ${size.width}x${size.height} px (${size.label}). Direction: ${direction === "auto" ? "choose one and commit to it" : direction}.
You decide hierarchy, palette, type, composition, and white space yourself. Keep every fact the user gave (names, prices, dates, places, contact details, legal lines) verbatim; never invent facts. Hook, then claim, then detail: three clearly different steps of visual weight.
Return compact JSON only, with exactly these keys:
{"title": "short name for this design",
 "direction": "one word",
 "summary": "two sentences: the idea and why it serves the brief",
 "palette": {"field": "#hex", "text": "#hex", "accent": "#hex", "muted": "#hex"},
 "fonts": {"display": "<font stack id>", "body": "<font stack id>"},
 "copy": ["every line of live text that will appear, in reading order"],
 "topology": "slot-matrix | code-native | continuous-scene | layered-collage",
 "layout": "3-5 sentences naming each region with its approximate x, y, width, height in px and what it holds",
 "assets": [{"id": "kebab-id", "form": "backdrop | slot", "rect": {"x": 0, "y": 0, "width": 0, "height": 0}, "aspect": "1:1 | 3:4 | 4:3 | 16:9 | 9:16", "prompt": "English prompt"}]}
Font stack ids (use only these):
${fontList()}
Imagery rules: at most ${maxAssets} generated assets${maxAssets === 0 ? " (the user wants none: carry the design with type, colour, and geometry)" : ""}. Use generated artwork only where photographic, illustrative, or material content carries the design; live type and geometry may be the whole visual system. Each asset prompt is written in English, describes appearance only, and never mentions text, logos, headlines, or "space for" anything: describe the region that text will cover purely by its physical properties (an even, low-detail wash of colour or sky, no objects, no marks). A backdrop prompt reads as two to four horizontal bands with position, material, brightness, and detail density. Shipping assets contain no lettering.${uploads.length ? `\nThe user supplied ${uploads.length} image(s) that must be placed as layers: ${uploads.map((u) => `${u.id}${u.label ? ` (${u.label})` : ""}`).join(", ")}. Do not list them under assets; plan their regions in the layout.` : ""}`;
  const user = previous
    ? `The current design's plan is:\n${JSON.stringify(previous).slice(0, 6000)}\n\nRevise the plan for this request, keeping what still fits: ${brief}`
    : `Brief:\n${brief}`;
  return [{ role: "system", content: system }, { role: "user", content: user }];
}

/** Messages that ask the text model to write the poster HTML against the plan and the real assets. */
export function designHtmlMessages({ brief, canvas, plan, assets = [], previous = "", revision = "" }) {
  const size = DESIGN_CANVASES[canvas] || DESIGN_CANVASES["3:4"];
  const margin = Math.round(Math.min(size.width, size.height) * 0.05);
  const assetLines = assets.length
    ? assets.map((a) => `- asset:${a.id} (${a.width}x${a.height}px source${a.form ? `, ${a.form}` : ""}${a.label ? `, ${a.label}` : ""})${a.rect ? ` planned at x=${a.rect.x} y=${a.rect.y} w=${a.rect.width} h=${a.rect.height}` : ""}`).join("\n")
    : "- none: the design is type, colour, and geometry only";
  const system = `You are a senior graphic designer who writes finished posters as one self-contained HTML document with live, editable text and independently movable layers.
Output ONLY the HTML document, starting with <!doctype html>. No markdown fences, no commentary, no HTML comments.

Canvas contract:
- The root is <div class="poster" data-canvas-width="${size.width}" data-canvas-height="${size.height}"> with position:relative; width:${size.width}px; height:${size.height}px; overflow:hidden. html and body have margin 0 and the body background equals the poster field colour. <title> is the design title.
- One <style> in <head>. No <script>, no <link>, no @import, no web fonts, no url(http...) anywhere, no media queries, no transitions or animations. Set * { box-sizing: border-box }.
- Declare the palette and the font stacks as custom properties on :root (--field, --text, --accent, --muted, --font-display, --font-body, plus any extra roles) and reference them everywhere. Use only these font stacks, verbatim:
${fontList()}
- Every independently movable unit (the headline, each text block, each badge, price, caption, logo line, each image) is its own element, absolutely positioned inside the root with fixed px left, top, and width (images also height), and carries a unique data-layer-id="kebab-name". Never nest one data-layer-id inside another. A card that holds two or more text leaves is a wrapper with data-explode-group="name" (no data-layer-id on the wrapper, ids on its leaves). Full-bleed backdrops, scrims, textures, rules, and frames carry no data-layer-id.
- Fixed px for every dimension, position, gap, and font size that carries layout. No vw, vh, vmin, percentages, or transforms for layout. Nothing may extend past the canvas edge; keep at least ${margin}px of margin and generous, deliberate white space.
- Images: only <img src="asset:ID" alt=""> for the ids listed below, each with explicit width and height and object-fit:cover plus a chosen object-position. Never reference any other image. Do not draw illustrations in SVG; small inline SVG icons (consistent stroke) are fine.
- Text: every string the user gave appears verbatim as live text, never inside an image. Where text sits over artwork, guarantee contrast with a scrim, a panel, or a directional gradient sized to the text block. A single tracked line gets white-space:nowrap. Build a real size ramp: display, headline, subhead, body, caption, each clearly different. Body lines 20-40 characters. Nothing smaller than 14px.
- No placeholder copy, no lorem ipsum, no invented facts.

Assets available (use these ids exactly):
${assetLines}`;
  const planText = JSON.stringify(plan || {}, null, 0).slice(0, 8000);
  const messages = [{ role: "system", content: system }];
  if (previous) {
    messages.push({ role: "user", content: `Here is the current poster:\n\n${previous}` });
    messages.push({ role: "user", content: `Design plan:\n${planText}\n\nRevise the poster for this request and return the complete document: ${revision || brief}` });
  } else {
    messages.push({ role: "user", content: `Design plan:\n${planText}\n\nBrief:\n${brief}\n\nWrite the complete poster now.` });
  }
  return messages;
}

/** Pulls a JSON object out of a model reply that may carry fences or prose. */
export function extractJsonObject(text) {
  const raw = String(text || "").trim();
  const candidates = [raw];
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) candidates.push(fenced[1].trim());
  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first !== -1 && last > first) candidates.push(raw.slice(first, last + 1));
  for (const candidate of candidates) {
    try {
      const value = JSON.parse(candidate);
      if (value && typeof value === "object" && !Array.isArray(value)) return value;
    } catch {}
  }
  return null;
}

const ASPECTS = ["1:1", "3:4", "4:3", "16:9", "9:16"];
/** Trims the plan to the shape the runner relies on; the model's extra prose is kept out. */
export function normalizeDesignPlan(value, { canvas = "3:4", maxAssets = MAX_DESIGN_ASSETS } = {}) {
  const size = DESIGN_CANVASES[canvas] || DESIGN_CANVASES["3:4"];
  const v = value && typeof value === "object" ? value : {};
  const hex = (x, fallback) => (/^#[0-9a-f]{3,8}$/i.test(String(x || "")) ? String(x) : fallback);
  const seen = new Set();
  const assets = (Array.isArray(v.assets) ? v.assets : [])
    .map((a) => {
      const id = clip(a?.id, 40).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "";
      const rect = a?.rect && typeof a.rect === "object" ? a.rect : {};
      const n = (x, max) => Math.max(0, Math.min(max, Math.round(Number(x) || 0)));
      return {
        id,
        form: a?.form === "backdrop" ? "backdrop" : "slot",
        rect: { x: n(rect.x, size.width), y: n(rect.y, size.height), width: n(rect.width, size.width) || size.width, height: n(rect.height, size.height) || size.height },
        aspect: oneOf(String(a?.aspect || ""), ASPECTS, a?.form === "backdrop" ? (size.width >= size.height ? "16:9" : "3:4") : "1:1"),
        prompt: clip(a?.prompt, 1200),
      };
    })
    .filter((a) => a.id && a.prompt && !seen.has(a.id) && seen.add(a.id))
    .slice(0, maxAssets);
  return {
    title: clip(v.title, 80) || "Untitled design",
    direction: clip(v.direction, 30).toLowerCase() || "editorial",
    summary: clip(v.summary, 600),
    palette: {
      field: hex(v.palette?.field, "#f4f1ea"),
      text: hex(v.palette?.text, "#17181a"),
      accent: hex(v.palette?.accent, "#d9480f"),
      muted: hex(v.palette?.muted, "#8a8680"),
    },
    fonts: {
      display: DESIGN_FONT_STACKS[v.fonts?.display] ? v.fonts.display : "serif-display",
      body: DESIGN_FONT_STACKS[v.fonts?.body] ? v.fonts.body : "grotesk",
    },
    copy: (Array.isArray(v.copy) ? v.copy : []).map((line) => clip(line, 300)).filter(Boolean).slice(0, 60),
    topology: oneOf(String(v.topology || ""), ["slot-matrix", "code-native", "continuous-scene", "layered-collage"], "code-native"),
    layout: clip(v.layout, 1500),
    assets,
  };
}

/** Pulls the HTML document out of a reply, even when the model adds fences or prose. */
export function extractDesignDocument(text) {
  const raw = String(text || "");
  const match = raw.match(/<!doctype html[\s\S]*<\/html>/i) || raw.match(/<html[\s\S]*<\/html>/i);
  return match ? match[0].trim() : "";
}

/**
 * Removes everything the poster contract forbids and anything that could run or
 * reach out: scripts, handlers, embeds, external URLs. The result is inert HTML
 * safe to open same-origin in the editor frame.
 */
export function sanitizeDesignHtml(html) {
  let out = String(html || "");
  out = out.replace(/<!--[\s\S]*?-->/g, "");
  out = out.replace(/<script\b[\s\S]*?<\/script\s*>/gi, "").replace(/<script\b[^>]*\/?>/gi, "");
  out = out.replace(/<(?:link|meta|base|iframe|frame|object|embed|applet|form|input|button|textarea|select|video|audio|source|track|canvas)\b[^>]*>(?:[\s\S]*?<\/\1\s*>)?/gi, (tag) => (/^<meta\b[^>]*charset/i.test(tag) ? tag : ""));
  out = out.replace(/\s(?:on[a-z]+|srcdoc|formaction|xlink:href)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  out = out.replace(/(\s(?:href|src|poster|background)\s*=\s*["']?)\s*(?:javascript|vbscript|data:text\/html)[^"'\s>]*/gi, "$1#");
  out = out.replace(/@import[^;]*;?/gi, "");
  out = out.replace(/url\(\s*(["']?)\s*(?:https?:)?\/\/[^)]*\)/gi, "none");
  out = out.replace(/(\ssrc\s*=\s*["']?)(?:https?:)?\/\/[^"'\s>]*/gi, "$1#");
  out = out.replace(/expression\s*\(/gi, "none(");
  return out;
}

/** Checks the fixed-canvas contract and repairs what can be repaired (duplicate layer ids). */
export function validateDesignHtml(html, canvas) {
  const size = DESIGN_CANVASES[canvas] || DESIGN_CANVASES["3:4"];
  const problems = [];
  const root = html.match(/<([a-z]+)[^>]*\bdata-canvas-width\s*=\s*["']?(\d+)["']?[^>]*\bdata-canvas-height\s*=\s*["']?(\d+)["']?/i) || html.match(/<([a-z]+)[^>]*\bdata-canvas-height\s*=\s*["']?(\d+)["']?[^>]*\bdata-canvas-width\s*=\s*["']?(\d+)["']?/i);
  if (!root) problems.push("The document has no canvas root with data-canvas-width and data-canvas-height.");
  else {
    const [w, h] = /data-canvas-width[^>]*data-canvas-height/i.test(root[0]) ? [Number(root[2]), Number(root[3])] : [Number(root[3]), Number(root[2])];
    if (w !== size.width || h !== size.height) problems.push(`The canvas is ${w}x${h}, not ${size.width}x${size.height}.`);
  }
  const ids = [...html.matchAll(/data-layer-id\s*=\s*["']([^"']*)["']/gi)].map((m) => m[1]);
  if (!ids.length) problems.push("No element carries a data-layer-id, so nothing could be edited.");
  let repaired = html;
  const seen = new Map();
  repaired = repaired.replace(/data-layer-id\s*=\s*["']([^"']*)["']/gi, (_m, id) => {
    const base = String(id || "layer").trim() || "layer";
    const count = (seen.get(base) || 0) + 1;
    seen.set(base, count);
    return `data-layer-id="${count === 1 ? base : `${base}-${count}`}"`;
  });
  if (/<(?:script|link)\b/i.test(repaired)) problems.push("The document still contains scripts or links.");
  return { ok: problems.length === 0, problems, html: repaired, layers: seen.size };
}

/** Swaps asset:ID references for the stored data URLs; images for unknown ids are dropped. */
export function inlineDesignAssets(html, assets) {
  const byId = new Map(assets.map((a) => [a.id, a]));
  let out = String(html || "");
  out = out.replace(/<img\b[^>]*\bsrc\s*=\s*["']asset:([^"']+)["'][^>]*>/gi, (tag, id) => (byId.has(id) ? tag.replace(/(\bsrc\s*=\s*["'])asset:[^"']+(["'])/i, `$1${byId.get(id).dataUrl}$2`) : ""));
  out = out.replace(/url\(\s*(["']?)asset:([^)"']+)\1\s*\)/gi, (_m, _q, id) => (byId.has(id) ? `url("${byId.get(id).dataUrl}")` : "none"));
  return out;
}

/** The reverse: the self-contained document with data URLs folded back to asset:ID, for revisions. */
export function compactDesignHtml(html, assets) {
  let out = String(html || "");
  for (const asset of assets) if (asset.dataUrl) out = out.split(asset.dataUrl).join(`asset:${asset.id}`);
  // Any other data URL (pasted by hand in the editor) is too long for the model; keep a stub.
  out = out.replace(/data:image\/[a-z+.-]+;base64,[A-Za-z0-9+/=]{200,}/g, "asset:unknown");
  return out;
}

/** Layer ids in document order, for the "how it was made" view. */
export function listDesignLayers(html) {
  return [...String(html || "").matchAll(/data-layer-id\s*=\s*["']([^"']*)["']/gi)].map((m) => m[1]);
}

/** Pixel size of a PNG, JPEG, or WebP from its header bytes; null when unreadable. */
export function imageSize(bytes) {
  const b = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []);
  if (b.length > 24 && b[0] === 0x89 && b.subarray(1, 4).toString("ascii") === "PNG") return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const marker = b[i + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      const len = b.readUInt16BE(i + 2);
      if ((marker >= 0xc0 && marker <= 0xcf) && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
      i += 2 + len;
    }
    return null;
  }
  if (b.length > 30 && b.subarray(0, 4).toString("ascii") === "RIFF" && b.subarray(8, 12).toString("ascii") === "WEBP") {
    const chunk = b.subarray(12, 16).toString("ascii");
    if (chunk === "VP8X") return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
    if (chunk === "VP8 ") return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
    if (chunk === "VP8L") { const bits = b.readUInt32LE(21); return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }; }
  }
  return null;
}
