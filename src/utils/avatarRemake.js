/** Shared avatar-remake settings for Voiceover Studio (client + server). */

export const AVATAR_PROVIDERS = ["preview", "heygen", "longcat"];
export const AVATAR_LAYOUTS = ["split", "full"];

export const DEFAULT_AVATAR_REMAKE = Object.freeze({
  layout: "split",
  provider: "preview",
  splitRatio: 0.48,
  aspectRatio: "9:16",
  resolution: "720p",
  faceName: "",
  prompt: "Natural talking head, subtle gestures, look at camera.",
});

/** @returns {{ layout: 'split'|'full', provider: 'preview'|'heygen'|'longcat', splitRatio: number, aspectRatio: '9:16'|'16:9', resolution: '720p'|'480p', faceName: string, prompt: string }} */
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

export function avatarProviderStatus(env = process.env) {
  return {
    preview: { available: true, label: "Layout preview (static face + narration)" },
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
