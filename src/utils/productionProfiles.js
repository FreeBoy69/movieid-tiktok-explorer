// Shared delivery profiles and visual playbooks used by Create Video, Drama,
// and agent-led production planning. Keep these provider-neutral: a profile is
// a promise to the creator, not a model-specific setting.

export const PRODUCTION_PROFILES = [
  { id: "youtube-landscape", name: "YouTube landscape", platform: "YouTube", aspect: "16:9", width: 1920, height: 1080, label: "1920 × 1080" },
  { id: "youtube-shorts", name: "YouTube Shorts", platform: "YouTube", aspect: "9:16", width: 1080, height: 1920, label: "1080 × 1920" },
  { id: "instagram-feed", name: "Instagram feed", platform: "Instagram", aspect: "1:1", width: 1080, height: 1080, label: "1080 × 1080" },
  { id: "cinematic", name: "Cinematic widescreen", platform: "Cinema", aspect: "21:9", width: 2560, height: 1080, label: "2560 × 1080" },
];

export const PRODUCTION_PLAYBOOKS = [
  { id: "clean-professional", name: "Clean professional", description: "Clear hierarchy, restrained motion, and confident narration.", motion: "measured", captions: "lower-third" },
  { id: "flat-motion", name: "Flat motion graphics", description: "Fast typography, graphic transitions, and social-first rhythm.", motion: "kinetic", captions: "word-level" },
  { id: "minimal-diagram", name: "Minimal diagram", description: "Quiet layouts, annotated visuals, and evidence-led pacing.", motion: "subtle", captions: "sentence" },
  { id: "cinematic-editorial", name: "Cinematic editorial", description: "Deliberate shots, natural sound, and controlled visual texture.", motion: "cinematic", captions: "optional" },
];

export function productionProfile(idOrAspect = "youtube-landscape") {
  return PRODUCTION_PROFILES.find((profile) => profile.id === idOrAspect || profile.aspect === idOrAspect) || PRODUCTION_PROFILES[0];
}

export function productionPlaybook(id = "clean-professional") {
  return PRODUCTION_PLAYBOOKS.find((playbook) => playbook.id === id) || PRODUCTION_PLAYBOOKS[0];
}

export function aspectRatioValue(aspect = "16:9") {
  const [width, height] = String(aspect).split(":").map(Number);
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0 ? `${width} / ${height}` : "16 / 9";
}
