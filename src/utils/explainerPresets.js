// Explainer Studio: walkthrough and explainer videos narrated in a chosen or
// cloned voice. Shared by the page and the server. A template sets the
// chapter structure; every word and screen comes from the user's site,
// screenshots, recordings, and notes.

export const EXPLAINER_ASPECTS = ["16:9", "9:16", "1:1"];
export const EXPLAINER_LENGTHS = [60, 90, 120, 180];
/** The renderer's hard limit, in seconds. The narration decides the real length. */
export const EXPLAINER_MAX_SECONDS = 180;
// A narrator speaks about 2.4 words a second with the pauses between lines.
export const EXPLAINER_WORDS_PER_SECOND = 2.4;
export const EXPLAINER_MAX_WORDS = 430;
export const EXPLAINER_LIMITS = { chapters: 9, lines: 8, lineChars: 320, cueChars: 200, titleChars: 80, visuals: 4 };

export const EXPLAINER_TEMPLATES = [
  {
    id: "feature-tour",
    name: "Feature tour",
    blurb: "What it does, one chapter per feature",
    length: 90,
    structure:
      "Chapter 1 (intro): what the product is and who it is for, in one or two lines, over its real home screen. Then one chapter per feature, three to five of them, each: what it is, the feature being used on its real screen, and the benefit in plain words. Last chapter (outro): a one-line recap and the call to action with the address.",
  },
  {
    id: "getting-started",
    name: "Getting started",
    blurb: "From sign-up to the first result, step by step",
    length: 90,
    structure:
      "Chapter 1 (intro): the result the viewer will have at the end. Then one chapter per step from sign-up (or opening the product) to the first real result, each chapter one action on screen: where to click or what to type, using the interface's real labels. Last chapter (outro): the result, and where to go next.",
  },
  {
    id: "how-to",
    name: "How to",
    blurb: "One task, done start to finish",
    length: 60,
    structure:
      "The task comes from the user's notes; if none is given, pick the product's core task from the material. Chapter 1 (intro): the task and why it matters, in one line. Then three to six step chapters, each one action with the real button and field names. Last chapter (outro): the finished result and a one-line call to action.",
  },
  {
    id: "whats-new",
    name: "What's new",
    blurb: "The latest release, change by change",
    length: 60,
    structure:
      "Use the changelog, release notes, or the user's notes. Chapter 1 (intro): the release in one line. Then one chapter per change, three to five of them, most important first: what changed, shown on screen, and why it helps. Last chapter (outro): how to get it.",
  },
];

export const findExplainerTemplate = (id) => EXPLAINER_TEMPLATES.find((item) => item.id === id) || EXPLAINER_TEMPLATES[0];
export const explainerWordBudget = (seconds) => Math.min(EXPLAINER_MAX_WORDS, Math.round((Number(seconds) || 90) * EXPLAINER_WORDS_PER_SECOND));
export const countWords = (text) => (String(text || "").match(/[\p{L}\p{N}][\p{L}\p{N}'’.-]*/gu) || []).length;

const text = (value, max) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const ASSET_ID = /^[a-z][a-z0-9_]{0,23}$/;

/**
 * The script as the page edits it and the server narrates it: a title and
 * chapters of spoken lines, each line with an optional on-screen cue.
 * Anything malformed is dropped, never guessed.
 */
export function normalizeExplainerScript(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const chapters = (Array.isArray(source.chapters) ? source.chapters : [])
    .map((chapter, index) => {
      const lines = (Array.isArray(chapter?.lines) ? chapter.lines : [])
        .map((line) => (typeof line === "string" ? { text: line } : line))
        .map((line) => ({ text: text(line?.text, EXPLAINER_LIMITS.lineChars), cue: text(line?.cue, EXPLAINER_LIMITS.cueChars) }))
        .filter((line) => countWords(line.text) > 0)
        .slice(0, EXPLAINER_LIMITS.lines);
      return {
        id: text(chapter?.id, 24).replace(/[^a-z0-9-]/gi, "") || `c${index + 1}`,
        title: text(chapter?.title, EXPLAINER_LIMITS.titleChars) || `Chapter ${index + 1}`,
        visuals: [...new Set((Array.isArray(chapter?.visuals) ? chapter.visuals : []).map((id) => String(id || "").trim()).filter((id) => ASSET_ID.test(id)))].slice(0, EXPLAINER_LIMITS.visuals),
        lines,
      };
    })
    .filter((chapter) => chapter.lines.length)
    .slice(0, EXPLAINER_LIMITS.chapters);
  const seen = new Set();
  for (const [index, chapter] of chapters.entries()) {
    if (seen.has(chapter.id)) chapter.id = `c${index + 1}`;
    seen.add(chapter.id);
  }
  return { title: text(source.title, 120), chapters };
}

export const scriptWords = (script) => (script?.chapters || []).reduce((sum, chapter) => sum + chapter.lines.reduce((n, line) => n + countWords(line.text), 0), 0);
/** Rough spoken length in seconds, for the page's estimate before narration exists. */
export const estimateScriptSeconds = (script) => {
  const chapters = script?.chapters || [];
  const lines = chapters.reduce((n, chapter) => n + chapter.lines.length, 0);
  return Math.round(scriptWords(script) / 2.7 + lines * 0.3 + chapters.length * 1.2 + 1.5);
};
