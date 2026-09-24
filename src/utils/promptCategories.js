// Prompt library categories, shared by the build script, server, and UI.
// `use` tells the curation model what belongs; `label` and `hint` are UI copy.
export const PROMPT_CATEGORIES = [
  { id: "visualStyle", label: "Visual styles", hint: "Art direction for scene images", use: "art direction for AI-generated video scene images: medium, palette, lighting, lens, texture" },
  { id: "thumbnail", label: "Thumbnails", hint: "Click-worthy thumbnail looks", use: "designing eye-catching YouTube thumbnails or cover images" },
  { id: "idea", label: "Video ideas", hint: "Topics, angles, and briefs", use: "brainstorming video topics, angles, series, or content strategy" },
  { id: "script", label: "Scripts", hint: "Story structure and tone", use: "writing video scripts, storytelling structure, tone, or explainers" },
  { id: "hook", label: "Hooks & titles", hint: "Openers, titles, captions", use: "hooks, video titles, captions, headlines, or SEO descriptions" },
  { id: "narration", label: "Narration", hint: "Voice delivery and pacing", use: "voice-over delivery direction: tone, pacing, energy, character voice" },
  { id: "music", label: "Music", hint: "Soundtrack mood", use: "soundtrack or music mood, genre, tempo, instrumentation" },
  { id: "video", label: "Videos", hint: "Shot-by-shot video prompts", use: "complete text-to-video or image-to-video prompts: shot-by-shot storyboard, camera moves, sound, and negative prompt" },
];
export const PROMPT_CATEGORY_IDS = PROMPT_CATEGORIES.map((category) => category.id);
