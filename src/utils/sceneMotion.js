// Pan-and-zoom moves for still scenes. The render (FFmpeg zoompan) and the
// storyboard preview (CSS transform) both read these, so they move the same way.
// Moves rotate by scene index so consecutive cuts never repeat a direction.

export const SCENE_MOVES = ["in", "right", "out", "left"];
const ZOOM = 0.2; // zoom in/out travels 1.00 <-> 1.20 across the scene
const PAN_SCALE = 1.16; // pans hold this zoom so there is room to travel

export const sceneMove = (index) => SCENE_MOVES[((Number(index) || 0) % SCENE_MOVES.length + SCENE_MOVES.length) % SCENE_MOVES.length];

// Frame state at progress p (0..1): scale, and the fixed point of the zoom as a
// fraction of the frame (0 = left/top edge, 1 = right/bottom edge).
export function moveAt(move, progress) {
  const p = Math.min(1, Math.max(0, Number(progress) || 0));
  if (move === "in") return { scale: 1 + ZOOM * p, x: 0.5, y: 0.5 };
  if (move === "out") return { scale: 1 + ZOOM * (1 - p), x: 0.5, y: 0.5 };
  if (move === "right") return { scale: PAN_SCALE, x: p, y: 0.5 };
  if (move === "left") return { scale: PAN_SCALE, x: 1 - p, y: 0.5 };
  return { scale: 1, x: 0.5, y: 0.5 };
}

// FFmpeg zoompan for the same move over `frames` output frames at `size`.
// zoompan's window position is (iw - iw/zoom) * x, the same fixed point CSS
// transform-origin gives the preview.
export function zoompanFilter(move, frames, [width, height]) {
  const last = Math.max(1, frames - 1);
  const p = `min(on/${last},1)`;
  const z =
    move === "in" ? `1+${ZOOM}*${p}` : move === "out" ? `1+${ZOOM}*(1-${p})` : move === "right" || move === "left" ? String(PAN_SCALE) : "1";
  const x = move === "right" ? p : move === "left" ? `(1-${p})` : "0.5";
  return `zoompan=z='${z}':x='(iw-iw/zoom)*${x}':y='(ih-ih/zoom)*0.5':d=${frames}:s=${width}x${height}:fps=30`;
}
