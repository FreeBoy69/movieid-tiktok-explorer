/** Scene/timeline helpers for Voiceover Studio. Humans may reorder freely; agents must use adjacent-only swaps. */

export function voiceoverSceneId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `scene-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createVoiceoverScene(partial = {}) {
  const start = Math.max(0, Number(partial.start) || 0);
  const end = Math.max(start + 0.05, Number(partial.end) || start + 1);
  return {
    id: partial.id || voiceoverSceneId(),
    start,
    end,
    label: partial.label || "",
    sourceStart: Number.isFinite(partial.sourceStart) ? partial.sourceStart : start,
    sourceEnd: Number.isFinite(partial.sourceEnd) ? partial.sourceEnd : end,
  };
}

export function sceneDuration(scene) {
  return Math.max(0, (Number(scene?.end) || 0) - (Number(scene?.start) || 0));
}

export function timelineDuration(scenes) {
  return (Array.isArray(scenes) ? scenes : []).reduce((sum, scene) => sum + sceneDuration(scene), 0);
}

/** Build sequential scenes covering [0, duration]. Uses equal slices when count is known. */
export function buildInitialScenes(durationSeconds, options = {}) {
  const duration = Math.max(0.5, Number(durationSeconds) || 0.5);
  const count = Math.max(1, Math.min(48, Math.round(Number(options.sceneCount) || 1)));
  if (count === 1) {
    return [createVoiceoverScene({ start: 0, end: duration, label: "Scene 1", sourceStart: 0, sourceEnd: duration })];
  }
  const slice = duration / count;
  return Array.from({ length: count }, (_, index) => {
    const start = Number((index * slice).toFixed(3));
    const end = Number((index === count - 1 ? duration : (index + 1) * slice).toFixed(3));
    return createVoiceoverScene({
      start,
      end,
      label: `Scene ${index + 1}`,
      sourceStart: start,
      sourceEnd: end,
    });
  });
}

/** After reordering, recompute contiguous start/end while keeping each clip's source window. */
export function normalizeSceneOrder(scenes) {
  let cursor = 0;
  return (Array.isArray(scenes) ? scenes : []).map((scene, index) => {
    const length = sceneDuration(scene) || Math.max(0.05, (Number(scene.sourceEnd) || 0) - (Number(scene.sourceStart) || 0));
    const next = {
      ...scene,
      label: scene.label || `Scene ${index + 1}`,
      start: Number(cursor.toFixed(3)),
      end: Number((cursor + length).toFixed(3)),
      sourceStart: Number.isFinite(scene.sourceStart) ? scene.sourceStart : scene.start,
      sourceEnd: Number.isFinite(scene.sourceEnd) ? scene.sourceEnd : scene.end,
    };
    cursor += length;
    return next;
  });
}

/** Human edits: move a scene to any index. */
export function moveScene(scenes, fromIndex, toIndex) {
  const list = [...(Array.isArray(scenes) ? scenes : [])];
  if (fromIndex < 0 || fromIndex >= list.length || toIndex < 0 || toIndex >= list.length || fromIndex === toIndex) {
    return normalizeSceneOrder(list);
  }
  const [item] = list.splice(fromIndex, 1);
  list.splice(toIndex, 0, item);
  return normalizeSceneOrder(list);
}

/**
 * Agent-only uniqueness nudges: swap with an immediate neighbor.
 * Returns null when the request is not adjacent.
 */
export function swapAdjacentScenes(scenes, index, direction = 1) {
  const list = [...(Array.isArray(scenes) ? scenes : [])];
  const step = Number(direction);
  if (!Number.isFinite(step) || Math.abs(step) !== 1) return null;
  const target = index + step;
  if (index < 0 || index >= list.length || target < 0 || target >= list.length) return null;
  const copy = [...list];
  [copy[index], copy[target]] = [copy[target], copy[index]];
  return normalizeSceneOrder(copy);
}

/** Split the scene under playheadTime into two contiguous scenes. */
export function splitSceneAtTime(scenes, playheadTime) {
  const list = Array.isArray(scenes) ? scenes : [];
  const t = Number(playheadTime) || 0;
  const index = list.findIndex((scene) => t > scene.start + 0.08 && t < scene.end - 0.08);
  if (index < 0) return list;
  const scene = list[index];
  const ratio = (t - scene.start) / sceneDuration(scene);
  const sourceSpan = (Number(scene.sourceEnd) || scene.end) - (Number(scene.sourceStart) || scene.start);
  const sourceMid = (Number(scene.sourceStart) || scene.start) + sourceSpan * ratio;
  const left = createVoiceoverScene({
    ...scene,
    id: voiceoverSceneId(),
    end: t,
    sourceEnd: sourceMid,
    label: scene.label || `Scene ${index + 1}`,
  });
  const right = createVoiceoverScene({
    start: t,
    end: scene.end,
    sourceStart: sourceMid,
    sourceEnd: scene.sourceEnd ?? scene.end,
    label: `${scene.label || "Scene"} b`,
  });
  const next = [...list];
  next.splice(index, 1, left, right);
  return normalizeSceneOrder(next);
}

export function sceneAtTime(scenes, time) {
  const t = Number(time) || 0;
  return (Array.isArray(scenes) ? scenes : []).find((scene) => t >= scene.start && t < scene.end) || null;
}

export function formatTimelineClock(seconds) {
  const total = Math.max(0, Number(seconds) || 0);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${String(mins).padStart(2, "0")}:${secs.toFixed(1).padStart(4, "0")}`;
}
