// Text fitting for Editable Design. The model positions every text layer at
// fixed pixels but cannot measure how its lines will wrap, so a headline that
// wraps once more than planned lands on the block below it. This lays the
// design out in a hidden same-origin frame, measures the ink of each text
// layer, and shrinks the type of colliding or overflowing layers until the
// design is clean (never below 60% of its original size).

export interface Box {
  id: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
  fontSize: number;
}

const area = (b: { left: number; top: number; right: number; bottom: number }) => Math.max(0, b.right - b.left) * Math.max(0, b.bottom - b.top);

/** Pairs of text boxes whose ink overlaps enough to read as a collision. */
export function findCollisions(boxes: Box[], tolerance = 4): Array<[Box, Box, number]> {
  const out: Array<[Box, Box, number]> = [];
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (w <= tolerance || h <= tolerance) continue;
      const overlap = w * h;
      // Ignore slivers: a descender grazing the next line's cap height.
      if (overlap < 0.04 * Math.min(area(a), area(b))) continue;
      out.push([a, b, overlap]);
    }
  }
  return out.sort((x, y) => y[2] - x[2]);
}

/** Boxes that run past the canvas edge. */
export function findOverflow(boxes: Box[], width: number, height: number, tolerance = 2): Box[] {
  return boxes.filter((b) => b.left < -tolerance || b.top < -tolerance || b.right > width + tolerance || b.bottom > height + tolerance);
}

/** Which of two colliding layers gives way: the larger type, unless it is already at its floor. */
export function yielder(a: Box, b: Box, floors: Map<string, number>): Box | null {
  const room = (x: Box) => x.fontSize > (floors.get(x.id) ?? 0) + 0.5;
  const [big, small] = a.fontSize >= b.fontSize ? [a, b] : [b, a];
  if (room(big)) return big;
  if (room(small)) return small;
  return null;
}

/** Union of the line boxes of an element's text: what a reader sees, not its layout box. */
function inkBox(el: HTMLElement, origin: DOMRect): DOMRect | null {
  const range = el.ownerDocument.createRange();
  range.selectNodeContents(el);
  const rects = [...range.getClientRects()].filter((r) => r.width > 0.5 && r.height > 0.5);
  if (!rects.length) return null;
  const left = Math.min(...rects.map((r) => r.left));
  const top = Math.min(...rects.map((r) => r.top));
  const right = Math.max(...rects.map((r) => r.right));
  const bottom = Math.max(...rects.map((r) => r.bottom));
  return new DOMRect(left - origin.left, top - origin.top, right - left, bottom - top);
}

/**
 * Fit a design's text. Returns the repaired document and which layers changed,
 * or the original when nothing needed fixing.
 */
export async function fitDesign(html: string, width: number, height: number): Promise<{ html: string; changed: string[] }> {
  const frame = document.createElement("iframe");
  frame.setAttribute("sandbox", "allow-same-origin");
  frame.style.cssText = `position:fixed;left:-${width + 100}px;top:0;width:${width}px;height:${height}px;border:0;opacity:0;pointer-events:none`;
  document.body.appendChild(frame);
  try {
    await new Promise<void>((resolve, reject) => {
      frame.onload = () => resolve();
      frame.onerror = () => reject(new Error("The design could not be measured"));
      frame.srcdoc = html;
    });
    const doc = frame.contentDocument;
    const root = doc?.querySelector<HTMLElement>("[data-canvas-width]");
    if (!doc || !root) return { html, changed: [] };
    await (doc as Document & { fonts?: FontFaceSet }).fonts?.ready;

    const layers = [...root.querySelectorAll<HTMLElement>("[data-layer-id]")].filter((el) => el.tagName !== "IMG" && !el.querySelector("img, svg") && (el.textContent || "").trim());
    const view = doc.defaultView!;
    const original = new Map(layers.map((el) => [el.dataset.layerId!, parseFloat(view.getComputedStyle(el).fontSize) || 16]));
    const floors = new Map([...original].map(([id, size]) => [id, Math.max(14, size * 0.6)]));
    const byId = new Map(layers.map((el) => [el.dataset.layerId!, el]));
    const changed = new Set<string>();

    const measure = (): Box[] => {
      const origin = root.getBoundingClientRect();
      return layers.flatMap((el) => {
        const ink = inkBox(el, origin);
        return ink ? [{ id: el.dataset.layerId!, left: ink.left, top: ink.top, right: ink.right, bottom: ink.bottom, fontSize: parseFloat(view.getComputedStyle(el).fontSize) || 16 }] : [];
      });
    };
    const shrink = (box: Box) => {
      const el = byId.get(box.id);
      if (!el) return false;
      const next = Math.max(floors.get(box.id) ?? 14, box.fontSize * 0.94);
      if (next >= box.fontSize - 0.25) return false;
      el.style.fontSize = `${Math.round(next * 10) / 10}px`;
      changed.add(box.id);
      return true;
    };

    // A short tracked line (a kicker, an eyebrow) is meant to sit on one line;
    // keep it there, and let the overflow pass shrink it if it then spills.
    for (const el of layers) {
      const style = view.getComputedStyle(el);
      const text = (el.textContent || "").trim();
      if (style.whiteSpace === "nowrap" || text.length > 60 || (parseFloat(style.letterSpacing) || 0) < 1) continue;
      const range = doc.createRange();
      range.selectNodeContents(el);
      const lines = new Set([...range.getClientRects()].filter((r) => r.width > 0.5).map((r) => Math.round(r.top)));
      if (lines.size > 1) {
        el.style.whiteSpace = "nowrap";
        changed.add(el.dataset.layerId!);
      }
    }

    for (let pass = 0; pass < 40; pass++) {
      const boxes = measure();
      const over = findOverflow(boxes, width, height).find((b) => b.fontSize > (floors.get(b.id) ?? 0) + 0.5);
      if (over) {
        shrink(over);
        continue;
      }
      const hit = findCollisions(boxes).map(([a, b]) => yielder(a, b, floors)).find(Boolean);
      if (!hit || !shrink(hit)) break;
    }
    if (!changed.size) return { html, changed: [] };
    const doctype = /^\s*<!doctype[^>]*>/i.exec(html)?.[0] || "<!doctype html>";
    return { html: `${doctype}\n${doc.documentElement.outerHTML}`, changed: [...changed] };
  } finally {
    frame.remove();
  }
}
