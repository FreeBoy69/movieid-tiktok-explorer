// Generates the Explore posters for the Tools suite (public/assets/explore/<tool>.webp)
// with the app's OpenRouter image model, then compresses them to webp.
//
//   node scripts/generate-tool-thumbnails.mjs             # only missing files
//   node scripts/generate-tool-thumbnails.mjs --force     # regenerate all
//   node scripts/generate-tool-thumbnails.mjs relight transcriber
//
// Needs OPENROUTER_API_KEY (read from .env) and cwebp on PATH.
import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { openRouterRequest } from "../src/utils/openRouterClient.js";

for (const line of (await fs.readFile(".env", "utf8").catch(() => "")).split("\n")) {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
}
const args = process.argv.slice(2);
const force = args.includes("--force");
const only = new Set(args.filter((arg) => !arg.startsWith("--")));

// Same world as the existing Explore posters: a vertical, photographic still of the tool's
// result, no interface chrome, no text. Seedream letters anything that smells like a poster.
const NO_TEXT = "One single upright photographic frame, not a collage or split screen. No text, letters, logos, UI, cursors, or watermark anywhere.";
const LOOK = "Premium editorial product photography, soft directional studio light, warm paper-white and charcoal palette with one accent of saturated yellow, shallow depth of field, crisp detail.";
const SCENES = {
  "editable-design": "A large printed launch poster pinned to a studio wall, its headline block, a product photo, and a price badge lifted slightly off the paper as separate floating paper layers casting soft shadows, a hand holding one layer by its corner, warm daylight, the poster's own graphics abstract blocks of dark green and gold with no readable words.",
  "background-remover": "A cut-out portrait of a young woman with curly hair floating in front of a pure white studio sweep, the original busy street background peeled back like a sheet of paper behind her.",
  "layer-splitter": "Two translucent glass panes standing in a row on a white table: the front pane holds a cut-out figure of a skateboarder mid-air, the back pane holds the empty skate park he jumped from, lit from the side so the gap between the layers shows.",
  "image-upscaler": "A loupe magnifier resting on a glossy photo print of a hummingbird; inside the lens every feather is razor sharp while the print around it is softly pixelated.",
  "image-expander": "A small framed landscape photograph of a mountain lake on a wall, with the same scene painted continuing outward across the wall far beyond the frame's edges, seamless.",
  relight: "The same ceramic vase of wildflowers lit from two sides at once: cool blue daylight on the left half, warm amber sunset on the right half, a hard line of light down the middle.",
  restyle: "A still life of a pear and a coffee cup where the left half is a photograph and the right half is the identical scene as a bold oil painting with thick visible brushstrokes.",
  "object-remover": "A clean city square at golden hour with a faint ghost outline where a lamp post used to stand, a soft eraser-shaped glow finishing the fill, cobblestones continuing perfectly.",
  "magic-edit": "A woman in a studio portrait whose plain grey jacket is turning emerald green from the shoulder down, the color change caught mid-sweep like a wave of light, tiny snowflakes starting to drift in.",
  "thumbnail-maker": "A widescreen 16:9 frame propped on an easel showing an expressive man with wide eyes pointing at a glowing cracked phone, saturated colors, a dramatic yellow glow behind him, shot as a photograph of the printed frame.",
  "video-upscaler": "A film strip pulled taut across a dark studio, the frames on the left soft and grainy and the frames on the right crisp and detailed, a tiny beam of yellow light at the transition.",
  transcriber: "A vintage microphone on a desk with a long ribbon of blank white paper flowing out of it and curling across the table, soft window light, everything pin sharp.",
  "audio-extractor": "A pair of over-ear headphones resting on a stack of dark film reels on a wooden desk, one yellow audio cable coiling toward the camera, soft morning light.",
  "vocal-remover": "Two clean audio waveforms printed on glossy cards pulled apart on a dark mixing desk: the left card a single bright yellow voice waveform, the right card a dense grey music waveform, a studio microphone softly out of focus behind them, no text.",
  "thumbnail-downloader": "A glossy 16:9 photo print of a mountain road at dusk sliding out of a slim matte-black device onto a white desk, caught mid-slide, soft studio light.",
  "poster-finder": "A wall of cinema one-sheet posters in a dim lobby, every poster an abstract blur of color and shape with no readable text, one poster lit by a warm spotlight and pulled slightly forward.",
  "title-generator": "Three bold blank cardboard title cards of different widths standing on a white desk beside a yellow marker, dramatic side light, one card tilted toward the camera.",
  "description-writer": "A single sheet of cream paper on a dark desk filled with neat blank ruled lines and a few yellow highlighter strokes, a fountain pen resting on it, soft window light, no legible words.",
  "hashtag-generator": "A cluster of small matte tiles in white, grey, and yellow scattered on a dark table, three tiles stacked in a tidy pile in front, soft overhead light, no letters on the tiles.",
};
const jobs = Object.entries(SCENES)
  .filter(([id]) => !only.size || only.has(id))
  .map(([id, scene]) => ({ id, out: `public/assets/explore/${id}.webp`, width: 540, prompt: `${scene} ${LOOK} ${NO_TEXT}` }));

let failed = 0;
const queue = [...jobs];
const CONCURRENCY = Number(process.env.THUMB_CONCURRENCY) || 3;
async function run(job) {
  if (!force && (await fs.stat(job.out).catch(() => null))) {
    console.log(`skip ${job.out} (exists)`);
    return;
  }
  try {
    const model = process.env.OPENROUTER_IMAGE_MODEL || "bytedance-seed/seedream-4.5";
    const response = await openRouterRequest("/images", { timeoutMs: 300000, body: { model, prompt: job.prompt, n: 1, aspect_ratio: "3:4", resolution: "2K" } });
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
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  while (queue.length) await run(queue.shift());
}));
process.exit(failed ? 1 : 0);
