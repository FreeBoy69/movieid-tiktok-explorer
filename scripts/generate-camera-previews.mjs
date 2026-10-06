// Generates the Cinema Studio previews for camera angle, shot size, perspective, and
// movement. Every frame shows the same scene so the only thing that changes between
// previews is the camera choice. Stills are kept in design/cinema-camera/<group>-<id>.webp
// and packed into one sprite per group (public/assets/cinema/camera-<group>.webp), because
// the hosted app accepts at most 500 files. Layout: src/utils/cameraPreviews.js.
//
//   node scripts/generate-camera-previews.mjs                 # only missing files
//   node scripts/generate-camera-previews.mjs --force         # regenerate all
//   node scripts/generate-camera-previews.mjs dutch orbit     # just these option ids
//   node scripts/generate-camera-previews.mjs --sprites-only  # rebuild the sprites from the stills
//
// Needs OPENROUTER_API_KEY (read from .env) and cwebp on PATH.
import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { openRouterRequest } from "../src/utils/openRouterClient.js";
import { CAMERA_OPTIONS, cameraOptions } from "../src/utils/cameraShots.js";
import { CAMERA_TILE, cameraSprite } from "../src/utils/cameraPreviews.js";

const STILLS = "design/cinema-camera";

for (const line of (await fs.readFile(".env", "utf8").catch(() => "")).split("\n")) {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
}
const args = process.argv.slice(2);
const force = args.includes("--force");
const only = new Set(args.filter((arg) => !arg.startsWith("--")));
const spritesOnly = args.includes("--sprites-only");

const HERO = "a woman in her thirties with dark shoulder-length hair wearing a long red wool coat";
const PLACE = "on a rain-slicked cobblestone street in an old European town at blue hour, warm glowing shop windows, light drizzle";
const SCENE = `${HERO}, standing ${PLACE}`;
// Shots that need more people, an object, or a different vantage get their own scene.
const SCENES = {
  "overhead-90": `${HERO} holding an open red umbrella, standing on wet cobblestones, seen from directly above so the umbrella and her shadow form the composition`,
  "ground-level": `${HERO} standing a few steps away, seen from a lens lying on the wet cobblestones so the stones fill the bottom of the frame large and sharp, ${PLACE}`,
  "worms-eye": `${HERO} standing upright over the lens, the tall buildings and dusk sky above her, ${PLACE}`,
  "birds-eye": `${HERO} holding a red umbrella, seen from a third-floor window steeply above her, the wet street spread out around her, ${PLACE}`,
  "truck-left": `${HERO} standing still on the pavement, seen side-on with the shop fronts behind her, ${PLACE}`,
  "truck-right": `${HERO} standing still on the pavement, seen side-on with the shop fronts behind her, ${PLACE}`,
  aerial: `the rooftops and winding streets of an old European town at blue hour, one tiny figure in a red coat crossing a square`,
  satellite: `an old European town and its river seen from orbit at dusk, streets as thin glowing lines`,
  "extreme-wide": `one tiny figure in a red coat on an empty cobblestone square in an old European town at blue hour, towering facades all around`,
  establishing: `an old European town square at blue hour in light rain, warm shop windows, a figure in a red coat small in the middle distance`,
  insert: `her gloved hand holding an old brass key against the red wool of her coat, raindrops on the leather`,
  "extreme-close-up": `the eyes of ${HERO}, raindrops on her lashes, warm shop light reflected in her irises`,
  "two-shot": `${HERO} and a man in a grey overcoat facing each other ${PLACE}`,
  "three-shot": `${HERO} with two friends in dark coats standing together ${PLACE}`,
  group: `${HERO} among a group of five people in dark coats with umbrellas ${PLACE}`,
  "over-the-shoulder": `${HERO} facing a man in a grey overcoat ${PLACE}; the camera looks past his blurred shoulder at her face`,
  pov: `the street ahead seen through her own eyes, her gloved hands holding a red umbrella handle at the bottom of the frame, ${PLACE.replace(/^on /, "")}`,
  reaction: `${HERO} gasping in surprise at something off screen, ${PLACE}`,
  reflection: `${HERO} reflected upside down in a rain puddle on the cobblestones, warm shop windows around her`,
  silhouette: `${HERO} as a dark silhouette against a brightly lit misty shop window, ${PLACE}`,
  "through-doorway": `${HERO} seen from inside a dim café through its open doorway, standing outside ${PLACE}`,
  "foreground-frame": `${HERO} seen past out-of-focus wrought-iron railings and hanging lanterns, ${PLACE}`,
  "split-diopter": `a man in a grey overcoat close to the camera on one side and ${HERO} far behind him on the other, ${PLACE}`,
  "rack-focus": `raindrops on a café window pane sharp in the foreground, and through the glass ${HERO} soft and out of focus in the street beyond`,
  "fly-through": `passing through an open café window, the window frame blurred at the edges of the frame, ${HERO} standing in the warm room inside`,
  "drone-flyover": `the rooftops of an old European town at blue hour in light rain, the camera gliding over them`,
  "drone-reveal": `an old European town at blue hour seen from high above and rising, rooftops opening up, one tiny figure in a red coat in a square`,
  "fpv-drone": `a narrow rain-slicked alley rushing past in motion blur, the walls streaking, with one woman in a long red coat standing still far down at its end facing the camera`,
  "bullet-time": `${HERO} frozen mid-turn with raindrops suspended in the air around her, ${PLACE}`,
};
// Where the camera phrase names equipment (a drone, a camera on the floor), models draw the equipment.
// For these stills, describe the picture the move produces instead.
const LEADS = {
  "ground-level": "ultra-low shot from just above the wet cobblestones, the stones large and sharp in the foreground",
  "worms-eye": "dramatic extreme low angle from the ground looking up at her, she stands upright and towers over the frame, the buildings converging toward the sky",
  "drone-reveal": "high aerial view of the whole town at blue hour, wide and open, seen from far above",
  "fpv-drone": "fast first-person flight down a narrow alley, heavy motion blur on the walls",
  "drone-flyover": "high aerial view gliding over the rooftops",
};
const STYLE = "Cinematic 35mm film still from a modern drama, natural color grade, realistic photography, crisp detail.";
const NO_TEXT = "One single photographic frame, not a collage, split screen, or storyboard. No text, letters, arrows, boxes, diagrams, UI, or watermark. No cameras, drones, film crew, lorries, or trucks visible anywhere in the frame.";

const jobs = spritesOnly ? [] : CAMERA_OPTIONS
  .filter((option) => !only.size || only.has(option.id))
  .map((option) => ({
    id: `${option.group}-${option.id}`,
    out: `${STILLS}/${option.group}-${option.id}.webp`,
    // The camera phrase leads: models weigh the opening words most.
    prompt: `${LEADS[option.id] || option.prompt}. ${SCENES[option.id] || SCENE}. ${option.group === "motion" ? "A single frame captured from the middle of this camera move. " : ""}${STYLE} ${NO_TEXT}`,
  }));

let failed = 0;
const queue = [...jobs];
const CONCURRENCY = Number(process.env.THUMB_CONCURRENCY) || 4;
async function run(job) {
  if (!force && (await fs.stat(job.out).catch(() => null))) return;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const model = process.env.OPENROUTER_IMAGE_MODEL || "bytedance-seed/seedream-4.5";
      const response = await openRouterRequest("/images", { timeoutMs: 300000, body: { model, prompt: job.prompt, n: 1, aspect_ratio: "16:9", resolution: "2K" } });
      const image = response.data?.[0];
      if (!image?.b64_json) throw new Error("no image returned");
      const raw = `${job.out}.src`;
      await fs.mkdir(path.dirname(job.out), { recursive: true });
      await fs.writeFile(raw, Buffer.from(image.b64_json, "base64"));
      execFileSync("cwebp", ["-quiet", "-q", "78", "-resize", "800", "0", raw, "-o", job.out]);
      await fs.rm(raw);
      console.log(`wrote ${job.out}`);
      return;
    } catch (error) {
      if (attempt === 2) {
        failed++;
        console.error(`failed ${job.id}: ${error.message}`);
      }
    }
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  while (queue.length) await run(queue.shift());
}));
console.log(`${jobs.length - failed} of ${jobs.length} stills ready`);

// One sprite per group, tiles in catalogue order.
for (const group of ["angle", "shot", "perspective", "motion"]) {
  const options = cameraOptions(group);
  const { columns, rows } = cameraSprite(group, options[0].id);
  const dir = await fs.mkdtemp(path.join(process.env.TMPDIR || "/tmp", "camera-sprite-"));
  try {
    for (const [index, option] of options.entries()) {
      const still = `${STILLS}/${group}-${option.id}.webp`;
      if (!(await fs.stat(still).catch(() => null))) throw new Error(`missing still ${still}`);
      execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-i", still, "-vf", `scale=${CAMERA_TILE.width}:${CAMERA_TILE.height}:force_original_aspect_ratio=increase,crop=${CAMERA_TILE.width}:${CAMERA_TILE.height}`, path.join(dir, `${String(index).padStart(3, "0")}.png`)]);
    }
    const sheet = path.join(dir, "sheet.png");
    execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-framerate", "1", "-i", path.join(dir, "%03d.png"), "-vf", `tile=${columns}x${rows}`, "-frames:v", "1", sheet]);
    const out = `public/assets/cinema/camera-${group}.webp`;
    execFileSync("cwebp", ["-quiet", "-q", "74", sheet, "-o", out]);
    console.log(`sprite ${out}: ${options.length} tiles, ${columns}x${rows}`);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
process.exit(failed ? 1 : 0);
