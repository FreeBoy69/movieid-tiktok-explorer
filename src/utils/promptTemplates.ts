// Prompt library entries used as templates: which studio a prompt opens in,
// its {{blanks}}, and the hand-off that carries a picked template from the
// library (or anywhere else) to the page that uses it.
import type { LibraryPrompt, PromptCategoryId } from "./promptLibrary";

export type TemplateOutput = "image" | "video" | "audio" | "writing";
export type TemplateVariable = { name: string; example: string };
export type TemplatePrompt = LibraryPrompt & { variables?: TemplateVariable[] };

// What a library prompt makes. The first matching output wins, so a video
// template that also lists a visual style still opens in Video Studio.
export const OUTPUT_CATEGORIES: Record<TemplateOutput, PromptCategoryId[]> = {
  video: ["video"],
  image: ["visualStyle", "thumbnail"],
  audio: ["music"],
  writing: ["idea", "script", "hook", "narration"],
};
export const TEMPLATE_OUTPUTS: Array<{ id: TemplateOutput; label: string; studio: "image" | "video" | "audio" | null }> = [
  { id: "image", label: "Image", studio: "image" },
  { id: "video", label: "Video", studio: "video" },
  { id: "audio", label: "Audio", studio: "audio" },
  { id: "writing", label: "Writing", studio: null },
];

// Video providers take up to 3,800 characters (server/creatorStudio.js); longer prompts stay copy-only.
export const STUDIO_PROMPT_LIMIT = 3800;

export function templateOutput(prompt: Pick<LibraryPrompt, "categories">): TemplateOutput | null {
  const order: TemplateOutput[] = ["video", "image", "audio", "writing"];
  return order.find((output) => OUTPUT_CATEGORIES[output].some((id) => prompt.categories?.includes(id))) || null;
}
export function templateStudio(prompt: Pick<LibraryPrompt, "categories">) {
  const output = templateOutput(prompt);
  return TEMPLATE_OUTPUTS.find((item) => item.id === output)?.studio || null;
}

export const variableLabel = (name: string) =>
  /^[a-z]$/i.test(name) ? `Character ${name.toUpperCase()}` : name.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

// The source prompt is what produced the sample output. `snippet` is only a
// short catalog description (or the prompt itself for a custom entry).
export function templatePromptText(template: Pick<TemplatePrompt, "prompt" | "snippet">) {
  return template.prompt?.trim() || template.snippet;
}

// Fill blanks in the source prompt, using its examples for untouched fields.
export function fillTemplatePrompt(template: TemplatePrompt, values: Record<string, string> = {}) {
  const source = templatePromptText(template);
  if (!template.variables?.length) return source;
  const examples = Object.fromEntries(template.variables.map((item) => [item.name, item.example]));
  return source.replace(/\{\{(\w+)\}\}/g, (_, name) => {
    const value = String(values[name] ?? "").trim().replace(/\s+/g, " ").slice(0, 300);
    return value || examples[name] || name;
  });
}

// "9:16", "vertical", or "16:9" named in the prompt, else nothing.
export function detectAspect(text: string): "9:16" | "16:9" | "1:1" | "4:5" | "" {
  const value = String(text || "");
  if (/\b9\s*:\s*16\b|\bvertical (?:video|format|frame|framing)\b/i.test(value)) return "9:16";
  if (/\b16\s*:\s*9\b|\bwidescreen\b/i.test(value)) return "16:9";
  if (/\b1\s*:\s*1\b|\bsquare format\b/i.test(value)) return "1:1";
  if (/\b4\s*:\s*5\b/i.test(value)) return "4:5";
  return "";
}

export const fitsStudio = (text: string) => String(text || "").length <= STUDIO_PROMPT_LIMIT;

// The draft changes a studio takes on when a template is used in it.
export function studioDraftFor(studio: "image" | "video" | "audio", prompt: string) {
  if (!fitsStudio(prompt)) throw new Error("This prompt is too long for the studio. Shorten it before generating.");
  const aspect = detectAspect(prompt);
  return {
    prompt,
    ...(studio === "video" ? { videoTab: "text" } : {}),
    ...(studio === "audio" ? { audioMode: "music" } : {}),
    ...(aspect && studio !== "audio" ? { aspectRatio: aspect } : {}),
  };
}

// Hand-off between pages: the library writes, the target page takes it once.
export type PendingTemplate = {
  target: "image" | "video" | "audio" | "create";
  title: string;
  prompt: string;
  aspect?: string;
  shotTemplateId?: string;
  shotTemplateValues?: Record<string, string>;
  source?: { id: string; url?: string; license?: string };
  at: number;
};
const PENDING_KEY = "autoyt-pending-template";
const PENDING_TTL = 10 * 60 * 1000;

export function writePendingTemplate(pending: Omit<PendingTemplate, "at">) {
  try {
    window.sessionStorage.setItem(PENDING_KEY, JSON.stringify({ ...pending, at: Date.now() }));
  } catch {}
}
export function takePendingTemplate(target: PendingTemplate["target"]): PendingTemplate | null {
  try {
    const pending = JSON.parse(window.sessionStorage.getItem(PENDING_KEY) || "null") as PendingTemplate | null;
    if (!pending || pending.target !== target) return null;
    window.sessionStorage.removeItem(PENDING_KEY);
    return Date.now() - Number(pending.at || 0) < PENDING_TTL ? pending : null;
  } catch {
    return null;
  }
}
