// Every template the Create home page offers, from the catalogs each studio already
// uses. A "style" template rides along in the chat box prompt (Image or Video); a
// "workspace" template opens the studio that runs it with the template picked.
import { ART_STYLE_PRESETS } from "./creatorPipeline";
import { CINEMA_GENRES, CINEMA_PALETTES, cinemaPreview } from "./cinemaPresets";
import { PROMO_TEMPLATES, promoPreview } from "./promoPresets";
import { AD_FORMATS, presetImage } from "./marketingPresets";
import { DRAMA_TEMPLATES, dramaTemplateThumb } from "./dramaTemplates";
import { SHORTFILM_TEMPLATES, shortfilmTemplateThumb } from "./shortfilmTemplates";
import { EXPLAINER_TEMPLATES } from "./explainerPresets";
import type { NavTarget } from "./appNavigation";
import type { PendingTemplate } from "./promptTemplates";

export type CreateTab = "all" | "styles" | "cinematic" | "motion" | "marketing" | "film" | "shorts";
export const CREATE_TABS: Array<{ id: CreateTab; label: string }> = [
  { id: "all", label: "All" },
  { id: "motion", label: "Motion graphics" },
  { id: "marketing", label: "Marketing" },
  { id: "film", label: "Film & Drama" },
  { id: "shorts", label: "Shorts" },
  { id: "styles", label: "Styles" },
  { id: "cinematic", label: "Cinematic" },
];

export type CreateTemplate = {
  key: string;
  tab: Exclude<CreateTab, "all">;
  title: string;
  blurb: string;
  by?: string;
  image?: string;
  /** Card shape before the image loads: width / height. */
  ratio: number;
  kind: "style" | "workspace";
  /** Style templates: words added to the prompt. */
  styleText?: string;
  /** Workspace templates: the page to open and what it receives. */
  target?: NavTarget;
  pending?: Omit<PendingTemplate, "at" | "prompt" | "title">;
  /** The studio name shown on the send hint. */
  studio?: string;
};

// Only these marketing formats have a still in /assets/marketing.
const FORMAT_STILLS = new Set(["hyper-motion", "pro-try-on", "product-review", "tutorial", "tv-spot", "ugc-try-on", "ugc", "unboxing", "wild-card"]);
// Only these Create Video templates have a still in /assets/templates.
const SHORT_STILLS = new Set(["documentary", "found-footage-horror", "micro-drama", "movie-trailer", "product-commercial", "stickman-director", "top-10"]);
const ratioOf = (aspect = "16:9") => {
  const [w, h] = String(aspect).split(":").map(Number);
  return w > 0 && h > 0 ? w / h : 16 / 9;
};

export const CREATE_TEMPLATES: CreateTemplate[] = [
  ...PROMO_TEMPLATES.map((t: any): CreateTemplate => ({
    key: `promo:${t.id}`, tab: "motion", title: t.name, blurb: t.blurb, by: t.credit?.handle ? `@${t.credit.handle}` : undefined,
    image: promoPreview(t.id).poster, ratio: ratioOf(t.aspect), kind: "workspace", studio: "Promo Studio",
    target: { view: "studio", studioTab: "promo" }, pending: { target: "promo", templateId: t.id },
  })),
  ...AD_FORMATS.map((f: any): CreateTemplate => ({
    key: `marketing:${f.id}`, tab: "marketing", title: f.name, blurb: f.blurb,
    image: FORMAT_STILLS.has(f.id) ? presetImage("format", f.id) : undefined, ratio: 9 / 16, kind: "workspace", studio: "Marketing Studio",
    target: { view: "studio", studioTab: "marketing" }, pending: { target: "marketing", templateId: f.id },
  })),
  ...DRAMA_TEMPLATES.map((d: any): CreateTemplate => ({
    key: `drama:${d.id}`, tab: "film", title: d.name, blurb: d.tagline, by: d.genre,
    image: dramaTemplateThumb(d.id), ratio: 2 / 3, kind: "workspace", studio: "Create Series",
    target: { view: "drama", filmFormat: "series" }, pending: { target: "drama", templateId: d.id },
  })),
  ...SHORTFILM_TEMPLATES.map((s: any): CreateTemplate => ({
    key: `short:${s.id}`, tab: s.genre && /drama|trailer|film|music/i.test(s.genre) ? "film" : "shorts", title: s.name, blurb: s.tagline, by: s.genre,
    image: SHORT_STILLS.has(s.id) ? shortfilmTemplateThumb(s.id) : undefined, ratio: ratioOf(s.aspect), kind: "workspace", studio: "Create Video",
    target: { view: "create" }, pending: { target: "create", shotTemplateId: s.id, aspect: s.aspect },
  })),
  ...EXPLAINER_TEMPLATES.map((e: any): CreateTemplate => ({
    key: `explainer:${e.id}`, tab: "shorts", title: e.name, blurb: e.blurb, by: "Explainer",
    ratio: 16 / 9, kind: "workspace", studio: "Explainer Studio",
    target: { view: "studio", studioTab: "explainer" }, pending: { target: "explainer", templateId: e.id },
  })),
  // Ranking Video: the countdown Short from real clips, and the reaction loop.
  ...[
    { id: "countdown", title: "Ranking countdown", blurb: "A topic becomes a narrated #5 to #1 Short made from real YouTube and TikTok clips." },
    { id: "reaction-loop", title: "Fail + reaction loop", blurb: "A real fail clip cut with a funny AI reaction, about 7 seconds, built to loop." },
  ].map((r): CreateTemplate => ({
    key: `ranking:${r.id}`, tab: "shorts", title: r.title, blurb: r.blurb, by: "Ranking Video",
    ratio: 9 / 16, kind: "workspace", studio: "Ranking Video",
    target: { view: "tool", toolId: "ranking" }, pending: { target: "ranking", templateId: r.id },
  })),
  ...ART_STYLE_PRESETS.map((a: any): CreateTemplate => ({
    key: `style:${a.id}`, tab: "styles", title: a.name, blurb: "Image style", image: a.preview, ratio: 1, kind: "style", styleText: a.prompt,
  })),
  ...CINEMA_GENRES.filter((g: any) => g.text).map((g: any): CreateTemplate => ({
    key: `genre:${g.id}`, tab: "cinematic", title: `${g.name} look`, blurb: "Cinematic genre", image: cinemaPreview("genre", g.id), ratio: 16 / 9, kind: "style", styleText: g.text,
  })),
  ...CINEMA_PALETTES.filter((p: any) => p.text).map((p: any): CreateTemplate => ({
    key: `palette:${p.id}`, tab: "cinematic", title: p.name, blurb: "Colour grade", image: cinemaPreview("palette", p.id), ratio: 16 / 9, kind: "style", styleText: p.text,
  })),
];

// "All" interleaves the tabs so the first screen shows a bit of everything.
export function templatesFor(tab: CreateTab): CreateTemplate[] {
  if (tab !== "all") return CREATE_TEMPLATES.filter((t) => t.tab === tab);
  const groups = CREATE_TABS.filter((t) => t.id !== "all").map((t) => CREATE_TEMPLATES.filter((x) => x.tab === t.id));
  const out: CreateTemplate[] = [];
  for (let i = 0; groups.some((g) => i < g.length); i++) for (const g of groups) if (g[i]) out.push(g[i]);
  return out;
}

/** The prompt sent for a style template: the person's words, then the look. */
export function promptWithStyle(prompt: string, template?: CreateTemplate | null) {
  const text = prompt.trim();
  if (!template?.styleText) return text;
  return text ? `${text}. ${template.styleText}` : template.styleText;
}
