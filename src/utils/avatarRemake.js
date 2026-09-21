/** Shared avatar-remake settings for Voiceover Studio (client + server). */

export const AVATAR_PROVIDERS = ["preview", "openrouter", "heygen", "longcat"];
export const AVATAR_LAYOUTS = ["split", "full", "smart"];

export const DEFAULT_AVATAR_REMAKE = Object.freeze({
  layout: "split",
  provider: "preview",
  splitRatio: 0.48,
  aspectRatio: "9:16",
  resolution: "720p",
  faceName: "",
  prompt: "Natural talking head, subtle gestures, look at camera.",
});

/** @returns {{ layout: 'split'|'full'|'smart', provider: 'preview'|'openrouter'|'heygen'|'longcat', splitRatio: number, aspectRatio: '9:16'|'16:9', resolution: '720p'|'480p', faceName: string, prompt: string }} */
export function normalizeAvatarRemake(raw = {}) {
  const layout = AVATAR_LAYOUTS.includes(raw.layout) ? raw.layout : DEFAULT_AVATAR_REMAKE.layout;
  const provider = AVATAR_PROVIDERS.includes(raw.provider) ? raw.provider : DEFAULT_AVATAR_REMAKE.provider;
  const splitRatio = Math.min(0.7, Math.max(0.3, Number(raw.splitRatio) || DEFAULT_AVATAR_REMAKE.splitRatio));
  /** @type {'720p'|'480p'} */
  const resolution = String(raw.resolution || DEFAULT_AVATAR_REMAKE.resolution) === "480p" ? "480p" : "720p";
  /** @type {'9:16'|'16:9'} */
  const aspectRatio = String(raw.aspectRatio || DEFAULT_AVATAR_REMAKE.aspectRatio) === "16:9" ? "16:9" : "9:16";
  return {
    layout,
    provider,
    splitRatio,
    aspectRatio,
    resolution,
    faceName: String(raw.faceName || "").slice(0, 120),
    prompt: String(raw.prompt || DEFAULT_AVATAR_REMAKE.prompt).slice(0, 400),
  };
}

/** True when the scene list is still source-order contiguous windows. */
export function timelineNeedsReedit(scenes) {
  const list = Array.isArray(scenes) ? scenes : [];
  if (list.length <= 1) return false;
  let cursor = 0;
  for (const scene of list) {
    const sourceStart = Number(scene.sourceStart);
    const sourceEnd = Number(scene.sourceEnd);
    if (!Number.isFinite(sourceStart) || !Number.isFinite(sourceEnd)) return true;
    if (Math.abs(sourceStart - cursor) > 0.08) return true;
    cursor = sourceEnd;
  }
  return false;
}

/** Validate the entire edit before submitting a paid avatar job. */
export function avatarScenePlan(scenes, duration) {
  if (!Array.isArray(scenes) || !scenes.length) throw new Error("Analyze scene layouts before rendering a Smart remake.");
  let cursor = 0;
  const plan = scenes.map((scene) => {
    const start = Number(scene.start), end = Number(scene.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || Math.abs(start - cursor) > 0.08)
      throw new Error("Scene timing has a gap or overlap. Detect scenes again before rendering.");
    if (!["talking-head", "broll", "split"].includes(scene.role))
      throw new Error("A scene layout could not be identified. Analyze scenes again before rendering.");
    if ((scene.sourceStart != null && (!Number.isFinite(Number(scene.sourceStart)) || Math.abs(Number(scene.sourceStart) - start) > 0.08))
      || (scene.sourceEnd != null && (!Number.isFinite(Number(scene.sourceEnd)) || Math.abs(Number(scene.sourceEnd) - end) > 0.08)))
      throw new Error("Smart remakes need the original scene order to keep narration synchronized.");
    cursor = end;
    const role = scene.replaceAvatar === false ? "broll" : scene.role;
    const presenterSide = scene.presenterSide || "bottom";
    const splitAt = scene.splitAt == null ? 0.5 : Number(scene.splitAt);
    if (role === "split" && (!["top", "bottom", "left", "right"].includes(presenterSide) || !Number.isFinite(splitAt) || splitAt < 0.2 || splitAt > 0.8))
      throw new Error("The presenter region could not be identified. Analyze scenes again.");
    return { ...scene, start, end, role, presenterSide, splitAt };
  });
  if (Math.abs(cursor - duration) > 0.15) throw new Error("Scene timing must cover the complete narration. Detect scenes again.");
  return plan;
}

export function avatarRegion(scene, width, height) {
  if (scene.role !== "split") return { x: 0, y: 0, width, height };
  const horizontal = ["left", "right"].includes(scene.presenterSide);
  const edge = Math.round((horizontal ? width : height) * scene.splitAt / 2) * 2;
  if (scene.presenterSide === "top") return { x: 0, y: 0, width, height: edge };
  if (scene.presenterSide === "left") return { x: 0, y: 0, width: edge, height };
  if (scene.presenterSide === "right") return { x: edge, y: 0, width: width - edge, height };
  return { x: 0, y: edge, width, height: height - edge };
}

export function avatarProviderStatus(env = process.env) {
  return {
    preview: { available: true, label: "Layout preview (static face + narration)" },
    openrouter: {
      available: Boolean(String(env.OPENROUTER_API_KEY || "").trim()),
      label: "OpenRouter / HeyGen Avatar IV",
      env: "OPENROUTER_API_KEY",
    },
    heygen: {
      available: Boolean(String(env.HEYGEN_API_KEY || "").trim()),
      label: "HeyGen talking avatar",
      env: "HEYGEN_API_KEY",
    },
    longcat: {
      available: Boolean(String(env.WAVESPEED_API_KEY || "").trim()),
      label: "LongCat / WaveSpeed talking avatar",
      env: "WAVESPEED_API_KEY",
    },
  };
}
