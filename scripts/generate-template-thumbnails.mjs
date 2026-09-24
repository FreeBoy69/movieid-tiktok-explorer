// Generates poster thumbnails for Create Drama templates and Create Video shot
// templates with the app's OpenRouter image model, then compresses them to webp.
//
//   node scripts/generate-template-thumbnails.mjs            # only missing files
//   node scripts/generate-template-thumbnails.mjs --force    # regenerate all
//   node scripts/generate-template-thumbnails.mjs contract-bride micro-drama
//
// Needs OPENROUTER_API_KEY (read from .env) and cwebp on PATH.
import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { DRAMA_TEMPLATES } from "../src/utils/dramaTemplates.js";
import { SHORTFILM_TEMPLATES } from "../src/utils/shortfilmTemplates.js";
import { ART_STYLE_PRESETS } from "../src/utils/creatorPipeline.js";
import { openRouterRequest } from "../src/utils/openRouterClient.js";

for (const line of (await fs.readFile(".env", "utf8").catch(() => "")).split("\n")) {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
}

const args = process.argv.slice(2);
const force = args.includes("--force");
const only = new Set(args.filter((arg) => !arg.startsWith("--")));
const style = (id) => ART_STYLE_PRESETS.find((preset) => preset.id === id)?.prompt || "";
// Seedream otherwise adds signage, clothing logos, split panels, or a sideways composition.
const NO_TEXT =
  "One single continuous upright photograph-like frame, not a collage, split screen, or multiple panels; people are upright. No text, title, letters, signage, logos on clothing, or watermark anywhere in the image.";

// Hand-written scenes for templates whose generic prompt came back as a poster collage.
const SCENES = {
  "hidden-heir":
    "Film still at a glamorous engagement party in a chandelier-lit ballroom: a calm young man with short black hair in a plain unbranded red courier jacket over a grey hoodie stands in the middle of the room while a honey-blonde woman in a champagne satin dress and a smug man in a navy three-piece suit laugh at him; guests turn to stare. Medium-wide shot at eye level, warm golden light.",
  "real-daughter":
    "Film still in a marble mansion foyer: a young woman with a messy dark ponytail in a faded denim jacket and white tee, holding a worn backpack, stands face to face with a sweet-smiling young woman with glossy light-brown waves in a pastel pink silk dress and pearl hairclip; an elegant ash-blonde mother watches from the staircase. Medium shot at eye level, soft window light, tense.",
};
const jobs = [
  ...DRAMA_TEMPLATES.map((template) => {
    const [lead, rival] = template.cast;
    if (SCENES[template.id])
      return {
        id: template.id,
        out: `public/assets/drama/${template.id}.webp`,
        width: 600,
        prompt: [SCENES[template.id], "Photoreal glossy streaming-series look, premium color grade, shallow depth of field.", NO_TEXT].join(" "),
      };
    return {
      id: template.id,
      out: `public/assets/drama/${template.id}.webp`,
      width: 600,
      prompt: [
        // "Poster" and a quoted mood line make the model letter a title, so describe a film still.
        `Vertical cinematic film still from a ${template.genre.toLowerCase()} short drama series, both characters large in frame.`,
        `In front, ${lead.name.split(" ")[0]}: ${lead.appearance}, wearing ${lead.outfit}, a charged expression, looking just past the camera.`,
        rival ? `Behind them, ${rival.name.split(" ")[0]}: ${rival.appearance}, wearing ${rival.outfit}.` : "",
        `Story: ${template.premise.split(". ")[0]}. Show a hint of that world in the background.`,
        "Dramatic cinematic lighting, strong subject separation, rich color, the faces in the upper two thirds with darker space at the bottom.",
        // The documentary preset reads flat on a poster; photoreal templates get streaming key-art polish instead.
        template.artStyleId === "preset:documentary"
          ? "Photoreal glossy streaming-series key art, premium color grade, shallow depth of field."
          : style(template.artStyleId),
        NO_TEXT,
      ].filter(Boolean).join(" "),
    };
  }),
  ...SHORTFILM_TEMPLATES.map((template) => ({
    id: template.id,
    out: `public/assets/templates/${template.id}.webp`,
    width: 600,
    prompt: [template.thumbnailPrompt, NO_TEXT].join(" "),
  })),
  {
    id: "explore-drama",
    out: "public/assets/explore/drama.webp",
    width: 540,
    aspect: "3:4",
    prompt: `Cinematic vertical film still of a tense short drama scene: a woman in an elegant black blazer confronts a man in a grey suit in a candlelit penthouse at night, city lights behind, a third figure watching from a doorway. Moody teal and amber light, shallow depth of field, film grain. ${NO_TEXT}`,
  },
].filter((job) => !only.size || only.has(job.id));

let failed = 0;
for (const job of jobs) {
  if (!force && (await fs.stat(job.out).catch(() => null))) {
    console.log(`skip ${job.out} (exists)`);
    continue;
  }
  try {
    const response = await openRouterRequest("/images", {
      timeoutMs: 300000,
      body: { model: process.env.OPENROUTER_IMAGE_MODEL || "bytedance-seed/seedream-4.5", prompt: job.prompt, n: 1, aspect_ratio: job.aspect || "2:3", resolution: "2K" },
    });
    const image = response.data?.[0];
    if (!image?.b64_json) throw new Error("no image returned");
    await fs.mkdir(path.dirname(job.out), { recursive: true });
    const raw = `${job.out}.src`;
    await fs.writeFile(raw, Buffer.from(image.b64_json, "base64"));
    execFileSync("cwebp", ["-quiet", "-q", "78", "-resize", String(job.width), "0", raw, "-o", job.out]);
    await fs.rm(raw);
    console.log(`wrote ${job.out}`);
  } catch (error) {
    failed++;
    console.error(`failed ${job.id}: ${error.message}`);
  }
}
process.exit(failed ? 1 : 0);
