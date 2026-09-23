// Creator Studio: every app from github.com/anil-matcha/open-generative-ai (MIT)
// rebuilt on our own providers. Images, video, lip sync, and music go through
// OpenRouter (not MuAPI); clipping reuses our downloader and Whisper; agents and
// Vibe Motion use our text models. Model pickers come from OpenRouter's live
// image and video catalogs.
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { openRouterConfigured, openRouterRequest, requestOpenRouter } from "../src/utils/openRouterClient.js";
import { assetStoreConfigured, ensureFile, removeFile, saveFile } from "./assetStore.js";
import { creatorCommand, musicCapability, publicMessage, streamOpenRouterAudio } from "./creatorWorkspace.js";
import { hostedVoiceProfiles, synthesizeHostedVoice } from "./hostedVoices.js";

const API = "https://openrouter.ai/api/v1";
const CATALOG_TTL = 30 * 60 * 1000;
const MAX_ACTIVE_PER_USER = 4;
const MAX_HISTORY = 300;
const PUBLIC_TTL = 2 * 60 * 60 * 1000;
const UPLOAD_TYPES = {
  "image/png": { ext: "png", max: 10 },
  "image/jpeg": { ext: "jpg", max: 10 },
  "image/webp": { ext: "webp", max: 10 },
  "audio/mpeg": { ext: "mp3", max: 20 },
  "audio/mp3": { ext: "mp3", max: 20 },
  "audio/wav": { ext: "wav", max: 20 },
  "audio/x-wav": { ext: "wav", max: 20 },
  "audio/wave": { ext: "wav", max: 20 },
  "audio/mp4": { ext: "m4a", max: 20 },
  "audio/x-m4a": { ext: "m4a", max: 20 },
  "audio/ogg": { ext: "ogg", max: 20 },
  "video/mp4": { ext: "mp4", max: 200 },
  "video/quicktime": { ext: "mov", max: 200 },
  "video/webm": { ext: "webm", max: 200 },
};
const MIME = { png: "image/png", jpg: "image/jpeg", webp: "image/webp", mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm", mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", ogg: "audio/ogg", html: "text/html; charset=utf-8" };
const FILE_NAME = /^(up|gen)-[a-z0-9-]+\.(png|jpg|webp|mp4|mov|webm|mp3|wav|m4a|ogg|html)$/;

// Each app from the Open Generative AI navigation, mapped to the runner that serves it.
export const STUDIO_APPS = {
  image: "image",
  layers: "image",
  cinema: "image",
  "design-agent": "image",
  "ai-influencer": "image",
  video: "video",
  clipping: "clip",
  "motion-control": "video",
  "vibe-motion": "motion",
  lipsync: "lipsync",
  "body-swap": "video",
  marketing: "video",
  audio: "music",
  agents: "image",
  workflows: "workflow",
};
export const STUDIO_TABS = Object.keys(STUDIO_APPS);

const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const newId = (prefix) => `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(5).toString("hex")}`;
const extOf = (file) => path.extname(file).slice(1).toLowerCase();
const clip = (value, max) => String(value || "").trim().slice(0, max);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let dependencies = {};
export function configureCreatorStudio(deps) {
  dependencies = deps;
}

const root = () =>
  path.resolve(process.env.CREATOR_STUDIO_DIR || path.join(process.env.CREATOR_ASSETS_DIR || "data/creator-assets", "studio"));
// Folder and storage keys use a hash so user ids never appear in paths.
const userKey = (userId) => crypto.createHash("sha256").update(String(userId)).digest("hex").slice(0, 24);
const userDir = (userId) => path.join(root(), userKey(userId));
const storeKey = (userId, file) => `studio/${userKey(userId)}/${file}`;
export const studioFileUrl = (file) => `/api/studio/files/${encodeURIComponent(file)}`;

function userFile(userId, name) {
  if (!FILE_NAME.test(String(name || ""))) throw fail("Invalid studio file");
  return path.join(userDir(userId), name);
}
async function persist(userId, file) {
  if (!assetStoreConfigured()) return;
  await saveFile(storeKey(userId, path.basename(file)), file).catch((error) =>
    console.warn(`[creator-studio] could not store ${path.basename(file)}: ${error.message}`),
  );
}
async function readableFile(userId, name) {
  const file = userFile(userId, name);
  if (!(await ensureFile(storeKey(userId, name), file))) throw fail("That file is no longer available. Upload it again.", 404);
  return file;
}

// ---------- Per-user JSON documents (history, agent chats), writes serialized ----------
const documents = new Map();
const writeChains = new Map();
async function doc(userId, name) {
  const cacheKey = `${userId}:${name}`;
  if (documents.has(cacheKey)) return documents.get(cacheKey);
  const file = path.join(userDir(userId), name);
  await ensureFile(storeKey(userId, name), file);
  let items = [];
  try {
    items = JSON.parse(await fs.readFile(file, "utf8"));
  } catch {}
  const list = Array.isArray(items) ? items : [];
  documents.set(cacheKey, list);
  return list;
}
function saveDoc(userId, name, limit = MAX_HISTORY) {
  const cacheKey = `${userId}:${name}`;
  const run = async () => {
    const items = await doc(userId, name);
    if (items.length > limit) items.length = limit;
    const dir = userDir(userId);
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, name);
    const partial = `${file}.${crypto.randomBytes(4).toString("hex")}`;
    await fs.writeFile(partial, JSON.stringify(items));
    await fs.rename(partial, file);
    await persist(userId, file);
  };
  const next = (writeChains.get(cacheKey) || Promise.resolve()).then(run, run);
  writeChains.set(cacheKey, next.catch(() => {}));
  return next;
}
const history = (userId) => doc(userId, "history.json");
const saveHistory = (userId) => saveDoc(userId, "history.json");
async function update(userId, id, patch) {
  const items = await history(userId);
  const item = items.find((entry) => entry.id === id);
  if (!item) return null;
  Object.assign(item, patch, { updatedAt: new Date().toISOString() });
  await saveHistory(userId);
  return item;
}

// ---------- Short-lived public URLs so providers can fetch uploaded audio and video ----------
const publicDir = () => path.join(root(), "public-links");
async function publishStudioMedia(userId, name) {
  const base = String(process.env.APP_URL || process.env.PUBLIC_APP_URL || "");
  let origin;
  try {
    origin = new URL(base);
  } catch {}
  if (origin?.protocol !== "https:") throw fail("This app needs a public HTTPS address (APP_URL) before providers can read uploaded audio or video.", 503);
  await readableFile(userId, name);
  await fs.mkdir(publicDir(), { recursive: true, mode: 0o700 });
  const token = crypto.randomBytes(32).toString("hex");
  await fs.writeFile(path.join(publicDir(), `${token}.json`), JSON.stringify({ user: userKey(userId), name, expiresAt: Date.now() + PUBLIC_TTL }), { mode: 0o600 });
  return new URL(`/api/studio/public/${token}/${encodeURIComponent(name)}`, origin).href;
}
async function resolvePublicMedia(token) {
  if (!/^[a-f0-9]{64}$/.test(String(token))) return null;
  try {
    const link = JSON.parse(await fs.readFile(path.join(publicDir(), `${token}.json`), "utf8"));
    if (!(link.expiresAt > Date.now()) || !FILE_NAME.test(link.name) || !/^[a-f0-9]{24}$/.test(link.user)) return null;
    const file = path.join(root(), link.user, link.name);
    return (await fs.stat(file).catch(() => null))?.isFile() ? file : null;
  } catch {
    return null;
  }
}

// ---------- Catalog ----------
let catalogCache = null;
async function fetchCatalog(endpoint) {
  const response = await fetch(`${API}${endpoint}`, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`Model catalog unavailable (${response.status})`);
  const data = await response.json();
  return Array.isArray(data?.data) ? data.data : [];
}
const provider = (id) => String(id).split("/")[0];
const shortName = (name, id) => String(name || id).replace(/^[^:]+:\s*/, "");

export function normalizeImageModels(models) {
  return models
    // Vector models return SVG, which we don't serve from our origin.
    .filter((m) => m?.id && !/vector|^openrouter\//.test(m.id))
    .map((m) => {
      const p = m.supported_parameters || {};
      return {
        id: m.id,
        name: shortName(m.name, m.id),
        provider: provider(m.id),
        description: String(m.description || "").slice(0, 220),
        aspectRatios: p.aspect_ratio?.values || [],
        resolutions: p.resolution?.values || [],
        qualities: p.quality?.values || [],
        maxImages: Math.max(1, Math.min(4, Number(p.n?.max) || 1)),
        maxReferences: Math.max(0, Math.min(8, Number(p.input_references?.max ?? 0))),
      };
    });
}
export function normalizeVideoModels(models) {
  const out = { video: [], avatar: [], edit: [], upscale: [], motion: [] };
  for (const m of models) {
    if (!m?.id) continue;
    const text = `${m.id} ${m.description || ""}`;
    const durations = (m.supported_durations || []).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
    const base = {
      id: m.id,
      name: shortName(m.name, m.id),
      provider: provider(m.id),
      description: String(m.description || "").slice(0, 220),
      aspectRatios: m.supported_aspect_ratios || [],
      resolutions: m.supported_resolutions || [],
      durations,
      frames: m.supported_frame_images || [],
      audio: m.generate_audio === true,
      pricePerSecond: Number(m.pricing_skus?.duration_seconds_720p || m.pricing_skus?.duration_seconds || 0) || (Number(m.pricing_skus?.cents_per_second_output) / 100 || null),
    };
    if (/avatar|lip-?sync/i.test(text)) out.avatar.push(base);
    else if (/upscal/i.test(text) && !durations.length) out.upscale.push(base);
    else if (!durations.length) out.edit.push(base);
    else {
      out.video.push(base);
      // Video references (motion transfer) are honored by Seedance 2 and newer.
      if (/bytedance\/seedance-(2|[3-9])/.test(m.id)) out.motion.push(base);
    }
  }
  return out;
}
export async function studioCatalog() {
  if (catalogCache && Date.now() - catalogCache.at < CATALOG_TTL) return catalogCache.value;
  const [images, videos] = await Promise.all([fetchCatalog("/images/models"), fetchCatalog("/videos/models")]);
  const music = musicCapability();
  const value = {
    configured: openRouterConfigured(),
    image: normalizeImageModels(images),
    ...normalizeVideoModels(videos),
    music: { available: music.available, name: music.provider, reason: music.reason },
    voices: hostedVoiceProfiles().map((voice) => ({ id: voice.id, name: voice.name, description: voice.description })),
  };
  catalogCache = { at: Date.now(), value };
  return value;
}
const PREFERRED = {
  image: ["bytedance-seed/seedream-4.5", "google/gemini-3-pro-image"],
  video: ["alibaba/wan-3.0", "bytedance/seedance-2.0-fast", "google/veo-3.1-fast"],
  avatar: ["heygen/avatar-iv"],
  motion: ["bytedance/seedance-2.0-fast", "bytedance/seedance-2.0"],
  edit: ["black-forest-labs/flux-video-edit", "runway/aleph-2"],
  upscale: ["black-forest-labs/flux-video-upscale"],
};
async function findModel(kind, id) {
  const list = (await studioCatalog())[kind] || [];
  const model = id ? list.find((m) => m.id === id) : PREFERRED[kind].map((p) => list.find((m) => m.id === p)).find(Boolean) || list[0];
  if (!model) throw fail(id ? "Choose a model from the list" : "No model is available for this app right now", id ? 400 : 503);
  return model;
}
const pick = (value, allowed) => (allowed.length && allowed.includes(value) ? value : undefined);
// Which catalog list serves each app's model picker.
export function modelKind(tab, settings = {}) {
  if (tab === "lipsync") return "avatar";
  if (tab === "motion-control") return "motion";
  if (tab === "body-swap") return "edit";
  if (tab === "video" && settings.mode === "upscale") return "upscale";
  const runner = STUDIO_APPS[tab];
  return runner === "video" ? "video" : runner === "image" ? "image" : "";
}

// ---------- Inputs ----------
async function uploadedDataUrl(userId, name) {
  const file = await readableFile(userId, name);
  const ext = extOf(file);
  if (!["png", "jpg", "webp"].includes(ext)) throw fail("Images must be PNG, JPEG, or WebP");
  return `data:${MIME[ext]};base64,${(await fs.readFile(file)).toString("base64")}`;
}
async function imageRefs(userId, names, max) {
  const list = [...new Set((Array.isArray(names) ? names : []).map(String))];
  if (list.length > max) throw fail(max ? `This model accepts up to ${max} reference image${max === 1 ? "" : "s"}. Choose another model or remove some.` : "This model doesn't accept reference images. Choose one that does.");
  return Promise.all(list.map(async (name) => ({ type: "image_url", image_url: { url: await uploadedDataUrl(userId, name) } })));
}
function imageBytes(image) {
  const bytes = Buffer.from(String(image?.b64_json || ""), "base64");
  if (!bytes.length || bytes.length > 30 * 1024 * 1024) throw fail("The image model returned an empty or oversized image", 502);
  if (bytes[0] === 0x89 && bytes.subarray(1, 4).toString("ascii") === "PNG") return { bytes, ext: "png" };
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return { bytes, ext: "jpg" };
  if (bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") return { bytes, ext: "webp" };
  throw fail("The image model returned an unreadable image", 502);
}
async function writeOutput(userId, bytes, ext, extra = {}) {
  const name = `${newId("gen")}.${ext}`;
  const file = userFile(userId, name);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, bytes);
  await persist(userId, file);
  return { file: name, url: studioFileUrl(name), type: MIME[ext], ...extra };
}
async function scratchDir(userId, id) {
  const dir = path.join(userDir(userId), `work-${id}`);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

// ---------- Prompt presets (ported from the Open Generative AI studios) ----------
export const CINEMA = {
  cameras: {
    "Modular 8K Digital": "modular 8K digital cinema camera",
    "Full-Frame Cine Digital": "full-frame digital cinema camera",
    "Grand Format 70mm Film": "grand format 70mm film camera",
    "Studio Digital S35": "Super 35 studio digital camera",
    "Classic 16mm Film": "classic 16mm film camera",
    "Premium Large Format Digital": "premium large-format digital cinema camera",
  },
  lenses: {
    "Creative Tilt Lens": "creative tilt lens effect",
    "Compact Anamorphic": "compact anamorphic lens",
    "Extreme Macro": "extreme macro lens",
    "70s Cinema Prime": "1970s cinema prime lens",
    "Classic Anamorphic": "classic anamorphic lens",
    "Premium Modern Prime": "premium modern prime lens",
    "Warm Cinema Prime": "warm-toned cinema prime lens",
    "Swirl Bokeh Portrait": "swirl bokeh portrait lens",
    "Vintage Prime": "vintage prime lens",
    "Halation Diffusion": "halation diffusion filter",
    "Clinical Sharp Prime": "ultra-sharp clinical prime lens",
  },
  focal: { 8: "ultra-wide perspective", 14: "wide-angle perspective", 24: "wide-angle dynamic perspective", 35: "natural cinematic perspective", 50: "standard portrait perspective", 85: "classic portrait perspective" },
  apertures: { "f/1.4": "shallow depth of field, creamy bokeh", "f/4": "balanced depth of field", "f/11": "deep focus clarity, sharp foreground to background" },
};
export function cinemaPrompt(base, { camera, lens, focalLength, aperture } = {}) {
  const cam = CINEMA.cameras[camera];
  const glass = CINEMA.lenses[lens];
  const focal = Number(focalLength);
  const perspective = CINEMA.focal[focal];
  const depth = CINEMA.apertures[aperture];
  if (!cam || !glass || !perspective || !depth) throw fail("Choose a camera, lens, focal length, and aperture");
  return [
    String(base || "").trim(),
    `shot on a ${cam}`,
    `using a ${glass} at ${focal}mm (${perspective})`,
    `aperture ${aperture}`,
    depth,
    "cinematic lighting",
    "natural color science",
    "high dynamic range",
    "professional photography, ultra-detailed, 8K resolution",
  ].filter(Boolean).join(", ");
}
export const LAYER_OPERATIONS = {
  "remove-background": "Remove the background completely. Keep the main subject exactly as it is, with clean edges, on a plain pure white background.",
  "extract-subject": "Isolate the main subject exactly as it is on a plain pure white background, cleanly cut out.",
  "background-plate": "Remove the main subject and fill the space naturally so only the empty background scene remains, matching lighting and perspective.",
  expand: "Extend the canvas outward (outpaint) to the new aspect ratio, continuing the scene naturally with matching lighting, perspective, and style. Keep the original content unchanged.",
  upscale: "Re-render this exact image at higher resolution with crisp fine detail. Do not change composition, colors, or content.",
  relight: "Keep the subject and composition identical but change the lighting as described.",
  restyle: "Keep the composition and subjects but render the image in the described style.",
  cleanup: "Remove the described unwanted elements (text, logos, objects, blemishes) and fill naturally. Change nothing else.",
  edit: "Apply the described edit precisely and change nothing else.",
};
export const INFLUENCER_SCENES = {
  portrait: "clean studio portrait, soft key light, neutral backdrop",
  cafe: "candid selfie in a sunlit café, holding a coffee cup",
  gym: "mirror selfie at a modern gym, athletic wear",
  travel: "travel photo on a beach at golden hour, relaxed smile",
  street: "streetwear outfit walking in a busy city street, shot on phone",
  home: "cozy home vlog setup, ring light glow, sitting on a sofa",
  product: "holding a product toward the camera like a sponsored post",
  night: "night out with neon city lights, flash photography",
};
export const MARKETING_STYLES = {
  hero: "Studio hero shot: the product rotates slowly on a seamless backdrop with a sweeping light pass and premium reflections.",
  lifestyle: "Lifestyle scene: a person naturally uses the product in a bright, aspirational everyday setting.",
  unboxing: "Unboxing: hands open the packaging and reveal the product with satisfying close-ups.",
  promo: "Energetic promo: fast dynamic camera moves, bold motion, punchy social-ad pacing.",
  luxury: "Luxury macro: slow macro glides across materials and details, moody dramatic lighting.",
  ugc: "UGC testimonial: handheld phone footage of a creator showing the product to camera.",
};
function buildPrompt(tab, prompt, s) {
  if (tab === "cinema") return cinemaPrompt(prompt, s.cinema);
  if (tab === "layers") {
    const op = LAYER_OPERATIONS[s.operation];
    if (!op) throw fail("Choose what to do with the image");
    return [op, prompt].filter(Boolean).join(" ");
  }
  if (tab === "ai-influencer") {
    const scene = INFLUENCER_SCENES[s.scene] || "";
    return [
      "Photorealistic photo of the exact same person shown in the reference image: identical face, facial structure, skin tone, and hair. Keep their identity consistent.",
      s.persona ? `Persona: ${clip(s.persona, 400)}.` : "",
      scene ? `Scene: ${scene}.` : "",
      prompt,
      "Natural, authentic social media photo, realistic skin texture.",
    ].filter(Boolean).join(" ");
  }
  if (tab === "marketing") {
    const style = MARKETING_STYLES[s.adStyle] || MARKETING_STYLES.hero;
    return [
      `A polished ${s.product ? `advertisement for ${clip(s.product, 120)}` : "product advertisement"}.`,
      style,
      prompt,
      s.firstFrame ? "The product must look exactly like the provided image." : "",
      "Commercial quality, clean composition, no on-screen text.",
    ].filter(Boolean).join(" ");
  }
  if (tab === "motion-control") return [prompt || "The character performs the movement.", "Transfer the exact body motion and timing from the reference video onto the character from the reference image. Keep the character's appearance consistent."].join(" ");
  if (tab === "body-swap") return [prompt, "Replace the main person in the video with the person from the reference image, keeping their face and look. Preserve the original motion, framing, background, and lighting."].filter(Boolean).join(" ");
  return prompt;
}

// ---------- Runners ----------
async function runImage(userId, item, signal) {
  const s = item.settings;
  const model = await findModel("image", item.model);
  const references = [...(s.references || [])];
  if (item.tab === "layers" || item.tab === "ai-influencer") {
    const source = item.tab === "layers" ? s.image : s.face;
    if (!source) throw fail(item.tab === "layers" ? "Add the image to edit" : "Add a face photo first");
    references.unshift(source);
  }
  const refs = await imageRefs(userId, references, model.maxReferences);
  const prompt = buildPrompt(item.tab, item.prompt, s);
  const aspect = pick(s.aspectRatio, model.aspectRatios);
  const call = async (text) => {
    const response = await openRouterRequest("/images", {
      signal,
      timeoutMs: 300000,
      body: {
        model: model.id,
        prompt: text,
        n: Math.max(1, Math.min(model.maxImages, Number(s.count) || 1)),
        ...(aspect ? { aspect_ratio: aspect } : {}),
        ...(pick(s.operation === "upscale" ? model.resolutions.at(-1) : s.resolution, model.resolutions) ? { resolution: s.operation === "upscale" ? model.resolutions.at(-1) : s.resolution } : {}),
        ...(pick(s.quality, model.qualities) ? { quality: s.quality } : {}),
        ...(refs.length ? { input_references: refs } : {}),
      },
    });
    const images = Array.isArray(response?.data) ? response.data : [];
    if (!images.length) throw fail("The image model returned no image", 502);
    return images;
  };
  const outputs = [];
  // Decompose returns two layers: the cut-out subject and the clean background.
  const passes = item.tab === "layers" && s.operation === "decompose"
    ? [["Subject", `${LAYER_OPERATIONS["extract-subject"]} ${item.prompt}`], ["Background", `${LAYER_OPERATIONS["background-plate"]} ${item.prompt}`]]
    : [["", prompt]];
  // Influencer sets need one call per image so every shot keeps the reference face.
  for (const [title, text] of passes)
    for (const image of await call(text)) {
      const { bytes, ext } = imageBytes(image);
      outputs.push(await writeOutput(userId, bytes, ext, title ? { title } : {}));
    }
  return { outputs, finalPrompt: passes.length > 1 ? item.prompt : prompt };
}

async function submitVideo(userId, item, signal) {
  const s = item.settings;
  if (item.tab === "lipsync") return submitLipSync(userId, item, signal);
  const kind = modelKind(item.tab, s);
  const model = await findModel(kind, item.model);
  const body = { model: model.id };
  const prompt = buildPrompt(item.tab, item.prompt, s);
  if (prompt) body.prompt = prompt.slice(0, 3800);
  if (kind === "upscale" || kind === "edit") {
    if (!s.sourceVideo) throw fail("Add the source video first");
    body.input_references = [{ type: "video_url", video_url: { url: await publishStudioMedia(userId, s.sourceVideo) } }];
    if (kind === "upscale") body.upscale_factor = Math.min(3, Math.max(1.5, Number(s.upscaleFactor) || 2));
    if (item.tab === "body-swap") {
      if (!s.face) throw fail("Add a photo of the new person");
      body.input_references.push({ type: "image_url", image_url: { url: await uploadedDataUrl(userId, s.face) } });
    }
  } else {
    const frames = [];
    if (s.firstFrame) {
      if (!model.frames.includes("first_frame")) throw fail(`${model.name} can't start from an image. Choose another model.`);
      frames.push({ type: "image_url", image_url: { url: await uploadedDataUrl(userId, s.firstFrame) }, frame_type: "first_frame" });
    }
    if (s.lastFrame) {
      if (!model.frames.includes("last_frame")) throw fail(`${model.name} can't end on an image. Choose another model.`);
      frames.push({ type: "image_url", image_url: { url: await uploadedDataUrl(userId, s.lastFrame) }, frame_type: "last_frame" });
    }
    if (frames.length) body.frame_images = frames;
    if (item.tab === "motion-control") {
      if (!s.face) throw fail("Add the character image");
      if (!s.sourceVideo) throw fail("Add the motion reference video");
      body.input_references = [
        { type: "image_url", image_url: { url: await uploadedDataUrl(userId, s.face) } },
        { type: "video_url", video_url: { url: await publishStudioMedia(userId, s.sourceVideo) } },
      ];
    }
    const duration = Number(s.duration);
    if (model.durations.includes(duration)) body.duration = duration;
    if (pick(s.aspectRatio, model.aspectRatios)) body.aspect_ratio = s.aspectRatio;
    if (pick(s.resolution, model.resolutions)) body.resolution = s.resolution;
    if (model.audio) body.generate_audio = s.audio !== false;
    if (!body.prompt && !frames.length) throw fail("Describe the video first");
  }
  const created = await openRouterRequest("/videos", { body, signal, timeoutMs: 120000 });
  if (!created?.id) throw fail("The video model did not return a job ID", 502);
  return String(created.id);
}

async function submitLipSync(userId, item, signal) {
  const s = item.settings;
  const model = await findModel("avatar", item.model);
  if (!s.image) throw fail("Add a portrait image first");
  if (!s.audioFile) throw fail("Add an audio track first");
  const audioFile = await readableFile(userId, s.audioFile);
  const probe = JSON.parse(await creatorCommand(process.env.FFPROBE_PATH || "ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "json", audioFile], signal));
  const seconds = Number(probe.format?.duration);
  if (!Number.isFinite(seconds) || seconds <= 0) throw fail("That audio file has no readable duration");
  if (seconds > 180) throw fail("Lip sync supports up to 3 minutes of audio. Trim the track and try again.");
  // Providers read the narration over HTTPS, so publish a compact MP3 copy.
  const name = `up-${item.id.replace(/^job-/, "")}-voice.mp3`;
  await creatorCommand(process.env.FFMPEG_PATH || "ffmpeg", ["-y", "-i", audioFile, "-vn", "-ac", "1", "-ar", "24000", "-c:a", "libmp3lame", "-b:a", "96k", userFile(userId, name)], signal);
  await persist(userId, userFile(userId, name));
  const audioUrl = await publishStudioMedia(userId, name);
  const motion = item.prompt || "Natural talking head, subtle gestures, look at camera.";
  const body = {
    model: model.id,
    prompt: motion,
    ...(pick(s.aspectRatio, model.aspectRatios) ? { aspect_ratio: s.aspectRatio } : {}),
    ...(pick(s.resolution, model.resolutions) ? { resolution: s.resolution } : {}),
    input_references: [
      { type: "image_url", image_url: { url: await uploadedDataUrl(userId, s.image) } },
      { type: "audio_url", audio_url: { url: audioUrl } },
    ],
    ...(model.provider === "heygen" ? { provider: { options: { heygen: { motion_prompt: motion, expressiveness: "low" } } } } : {}),
  };
  const created = await openRouterRequest("/videos", { body, signal, timeoutMs: 120000 });
  if (!created?.id) throw fail("The lip sync model did not return a job ID", 502);
  return String(created.id);
}

async function pollVideo(userId, remoteJobId, signal, onStatus = () => {}) {
  const endpoint = `/videos/${encodeURIComponent(remoteJobId)}`;
  const deadline = Date.now() + 30 * 60 * 1000;
  while (Date.now() < deadline) {
    signal.throwIfAborted();
    const remote = await openRouterRequest(endpoint, { signal });
    if (remote.status === "completed") {
      const video = await openRouterRequest(`${endpoint}/content`, { binary: true, signal, timeoutMs: 300000 });
      if (!video?.length || video.length > 300 * 1024 * 1024) throw fail("The video model returned an empty or oversized clip", 502);
      return writeOutput(userId, video, "mp4");
    }
    if (["failed", "cancelled", "canceled", "expired"].includes(remote.status))
      throw fail(`Generation ${remote.status}: ${String(remote.error?.message || remote.error || "the provider rejected this request").slice(0, 300)}`, 502);
    onStatus(remote.status);
    await sleep(6000);
  }
  throw fail("The video is still rendering. Open Creator Studio again later to pick it up.", 504);
}

async function runMusic(userId, item, signal) {
  const capability = musicCapability();
  if (!capability.available) throw fail(capability.reason, 503);
  const s = item.settings;
  const prompt = [
    item.prompt,
    s.instrumental !== false ? "Instrumental only: no vocals, no lyrics." : "",
    s.lyrics ? `Lyrics:\n${clip(s.lyrics, 3000)}` : "",
  ].filter(Boolean).join("\n\n");
  const audio = await streamOpenRouterAudio({
    model: capability.model,
    messages: [{ role: "user", content: prompt }],
    modalities: ["text", "audio"],
    audio: { format: "wav" },
    stream: true,
  }, signal);
  if (audio.extension === "wav" || audio.extension === "mp3") return { outputs: [await writeOutput(userId, audio.bytes, audio.extension)] };
  // Bare PCM, FLAC, or Ogg: convert to MP3 so every browser can play it.
  const dir = await scratchDir(userId, item.id);
  try {
    const scratch = path.join(dir, `music.${audio.extension}`);
    const target = path.join(dir, "music.mp3");
    await fs.writeFile(scratch, audio.bytes);
    await creatorCommand(process.env.FFMPEG_PATH || "ffmpeg", ["-y", ...audio.input, "-i", scratch, "-c:a", "libmp3lame", "-b:a", "192k", target], signal);
    return { outputs: [await writeOutput(userId, await fs.readFile(target), "mp3")] };
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

// Vibe Motion: a text model writes a self-contained animated HTML scene.
// Benchmarked 2026-09-23 on OpenRouter with low reasoning effort: Gemini 3.8 Flash
// (~30s, ~2 cents) and Claude Sonnet 5 (~25s, ~3 cents) returned valid, well-framed
// animations. The previous default (Qwen 3.8 Max) timed out, and reasoning models at
// default effort spent the whole token budget thinking and returned nothing.
export const MOTION_MODELS = () =>
  [...new Set([process.env.OPENROUTER_MOTION_MODEL, "google/gemini-3.8-flash", "anthropic/claude-sonnet-5"].map((m) => String(m || "").trim()).filter(Boolean))];
export const MOTION_STAGES = { "16:9": [1920, 1080], "9:16": [1080, 1920], "1:1": [1080, 1080] };
const HOST_MARK = "data-vibe-host";
// Pulls the HTML document out of a reply, even when the model adds fences or prose.
export function extractHtmlDocument(text) {
  const raw = String(text || "");
  const match = raw.match(/<!doctype html[\s\S]*<\/html>/i) || raw.match(/<html[\s\S]*<\/html>/i);
  return match ? match[0].trim() : "";
}
// The model designs on a fixed-size #stage; this host code scales it to fit any frame.
export function hostMotionDocument(html, [width, height], seconds) {
  const host = `<style ${HOST_MARK}>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#000}#stage{position:absolute!important;left:50%!important;top:50%!important;width:${width}px!important;height:${height}px!important;transform-origin:center center;overflow:hidden}</style>` +
    `<script ${HOST_MARK}>window.__VIBE__={width:${width},height:${height},duration:${seconds}};(function(){function fit(){var s=document.getElementById("stage");if(!s)return;var k=Math.min(innerWidth/${width},innerHeight/${height});s.style.transform="translate(-50%,-50%) scale("+k+")"}addEventListener("resize",fit);document.addEventListener("DOMContentLoaded",fit);addEventListener("load",fit)})();</script>`;
  return /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (tag) => tag + host) : html.replace(/<html[^>]*>/i, (tag) => `${tag}<head>${host}</head>`);
}
export const stripHost = (html) => String(html).replace(new RegExp(`<(style|script) ${HOST_MARK}>[\\s\\S]*?</\\1>`, "g"), "");

async function runVibeMotion(userId, item, signal) {
  const s = item.settings;
  const aspect = MOTION_STAGES[s.aspectRatio] ? s.aspectRatio : "16:9";
  const [width, height] = MOTION_STAGES[aspect];
  const seconds = Math.min(20, Math.max(3, Number(s.duration) || 8));
  let previous = "";
  if (s.baseFile && extOf(s.baseFile) === "html") previous = stripHost(await fs.readFile(await readableFile(userId, s.baseFile), "utf8")).slice(0, 60000);
  const messages = [
    {
      role: "system",
      content: `You are a senior motion designer who writes animated motion graphics as one self-contained HTML document.
Rules:
- Output ONLY the HTML document, starting with <!doctype html>. No markdown fences, no commentary.
- Put everything inside one element: <div id="stage">. Design it at exactly ${width}x${height} CSS pixels and position children inside it. Do not scale, letterbox, or resize the stage yourself, and do not size anything with vw, vh, or window dimensions; the host fits the stage to the screen.
- No external resources at all: no <script src>, no web fonts, no images by URL, no fetch. Inline CSS and JS only; SVG and canvas are fine.
- The animation lasts ${seconds} seconds and loops seamlessly. Drive it with CSS keyframes or requestAnimationFrame using elapsed time, never frame counts.
- Keep all text fully inside the stage with safe margins. Broadcast-quality typography with system font stacks, confident easing, and a deliberate color palette.`,
    },
    ...(previous ? [{ role: "user", content: `Here is the current motion graphic:\n\n${previous}` }] : []),
    { role: "user", content: previous ? `Revise it: ${item.prompt}` : `Create this motion graphic: ${item.prompt}${s.style ? `\nVisual style: ${clip(s.style, 300)}` : ""}` },
  ];
  let lastError;
  for (const model of MOTION_MODELS()) {
    signal.throwIfAborted();
    try {
      const data = await openRouterRequest("/chat/completions", {
        signal,
        timeoutMs: 180000,
        body: { model, messages, max_tokens: 32000, temperature: 0.7, reasoning: { effort: "low", exclude: true } },
      });
      const choice = data.choices?.[0];
      const content = choice?.message?.content;
      const html = extractHtmlDocument(Array.isArray(content) ? content.map((part) => part?.text || "").join("") : content);
      if (!html) throw fail(choice?.finish_reason === "length" ? "The motion graphic was too long to finish" : "The model didn't return a motion graphic", 502);
      return { outputs: [await writeOutput(userId, Buffer.from(hostMotionDocument(html, [width, height], seconds), "utf8"), "html")], motionModel: data.model || model };
    } catch (error) {
      signal.throwIfAborted();
      lastError = error;
      if ([401, 402, 403].includes(error.status)) break;
    }
  }
  throw lastError || fail("No motion model is available", 503);
}

// AI Clipping: download, transcribe, let a text model pick moments, cut them with FFmpeg.
async function runClipping(userId, item, signal, report) {
  const s = item.settings;
  const dir = await scratchDir(userId, item.id);
  try {
    let source;
    if (s.sourceVideo) source = await readableFile(userId, s.sourceVideo);
    else {
      if (!dependencies.downloadVideo) throw fail("Downloading videos isn't available on this server", 503);
      let url;
      try {
        url = new URL(String(s.sourceUrl || ""));
      } catch {}
      if (!url || url.protocol !== "https:") throw fail("Paste a public https video link, or upload a video");
      await report("Downloading the video");
      await dependencies.downloadVideo(url.href, path.join(dir, "source.mp4"), { signal });
      // yt-dlp may pick another container than the requested name.
      const found = (await fs.readdir(dir)).find((file) => file.startsWith("source."));
      if (!found) throw fail("The video could not be downloaded", 502);
      source = path.join(dir, found);
    }
    const probe = JSON.parse(await creatorCommand(process.env.FFPROBE_PATH || "ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "json", source], signal));
    const duration = Number(probe.format?.duration);
    if (!Number.isFinite(duration) || duration < 20) throw fail("The video is too short to clip (under 20 seconds)");
    if (duration > 2 * 60 * 60) throw fail("Videos up to 2 hours can be clipped");
    await report("Transcribing");
    if (!dependencies.transcribe) throw fail("Transcription isn't available on this server", 503);
    const transcript = await dependencies.transcribe(source, { signal, maxDurationSeconds: duration + 1 });
    const lines = (transcript.segments || [])
      .map((seg) => `[${Number(seg.start).toFixed(1)}-${Number(seg.end).toFixed(1)}] ${String(seg.text || "").trim()}`)
      .join("\n")
      .slice(0, 60000);
    if (!lines) throw fail("No speech was found to pick clips from", 422);
    await report("Finding the best moments");
    const count = Math.min(6, Math.max(1, Number(s.count) || 3));
    const [minLen, maxLen] = s.clipLength === "long" ? [45, 90] : s.clipLength === "medium" ? [30, 60] : [15, 35];
    const { value } = await requestOpenRouter({
      kind: "text",
      json: true,
      maxTokens: 3000,
      temperature: 0.3,
      signal,
      messages: [{
        role: "user",
        content: `Pick the ${count} most engaging, self-contained moments for short-form clips from this timestamped transcript of a ${Math.round(duration)}s video.${item.prompt ? ` Focus: ${item.prompt}.` : ""}
Each clip must be ${minLen}-${maxLen} seconds, start at the beginning of a sentence with a strong hook, end on a complete thought, and not overlap another clip.
Return JSON only: {"clips":[{"title":"catchy title under 70 characters","start":seconds,"end":seconds,"hook":"why it works, under 20 words","score":1-100}]}

${lines}`,
      }],
      validate: (v) => {
        if (!Array.isArray(v?.clips) || !v.clips.length) throw new Error("No clips returned");
      },
    });
    const clips = value.clips
      .map((c) => ({ ...c, start: Math.max(0, Number(c.start)), end: Math.min(duration, Number(c.end)) }))
      .filter((c) => Number.isFinite(c.start) && Number.isFinite(c.end) && c.end - c.start >= 5)
      .slice(0, count);
    if (!clips.length) throw fail("No usable moments were found. Try another video or focus.", 422);
    const outputs = [];
    for (const [index, c] of clips.entries()) {
      await report(`Cutting clip ${index + 1} of ${clips.length}`);
      const target = path.join(dir, `clip-${index}.mp4`);
      const vf = s.vertical !== false ? ["-vf", "crop='min(iw,ih*9/16)':ih,scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2,setsar=1"] : [];
      await creatorCommand(process.env.FFMPEG_PATH || "ffmpeg", [
        "-y", "-ss", c.start.toFixed(2), "-to", c.end.toFixed(2), "-i", source,
        ...vf, "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", target,
      ], signal);
      outputs.push(await writeOutput(userId, await fs.readFile(target), "mp4", {
        title: clip(c.title, 90),
        caption: clip(c.hook, 160),
        start: c.start,
        end: c.end,
        score: Math.round(Number(c.score) || 0) || undefined,
      }));
    }
    return { outputs };
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

// Workflows: fixed multi-step pipelines that chain the studios.
export const WORKFLOWS = {
  "image-to-video": { name: "Still to motion", steps: ["Generate the still", "Animate it"] },
  "talking-avatar": { name: "Talking avatar", steps: ["Generate the presenter", "Record the voice", "Sync the lips"] },
  storyboard: { name: "Storyboard", steps: ["Write the shot list", "Draw the frames"] },
  "product-ad": { name: "Product ad with music", steps: ["Animate the product ad", "Compose the music"] },
};
async function runWorkflow(userId, item, signal, report) {
  const s = item.settings;
  const flow = WORKFLOWS[s.workflow];
  if (!flow) throw fail("Choose a workflow");
  const outputs = [];
  const steps = flow.steps.map((label) => ({ label, status: "pending" }));
  const step = async (index, fn) => {
    steps[index].status = "running";
    await report(steps[index].label, { steps });
    const result = await fn();
    steps[index].status = "done";
    await update(userId, item.id, { steps, outputs: [...outputs] });
    return result;
  };
  const child = (tab, prompt, settings, model = "") => ({ id: newId("job"), tab, model, prompt, settings });
  const image = async (prompt, settings = {}) => {
    const result = await runImage(userId, child("image", prompt, { count: 1, aspectRatio: s.aspectRatio, ...settings }), signal);
    outputs.push(...result.outputs);
    return result.outputs[0];
  };
  const video = async (tab, prompt, settings) => {
    const sub = child(tab, prompt, { aspectRatio: s.aspectRatio, ...settings });
    const remote = await submitVideo(userId, sub, signal);
    const out = await pollVideo(userId, remote, signal);
    outputs.push(out);
    return out;
  };
  if (s.workflow === "image-to-video") {
    const still = await step(0, () => image(item.prompt));
    await step(1, () => video("video", s.motion || "Subtle cinematic camera movement, natural motion", { firstFrame: still.file, duration: 5 }));
  } else if (s.workflow === "talking-avatar") {
    if (!s.script) throw fail("Write the script for the presenter");
    const voice = hostedVoiceProfiles().find((v) => v.id === s.voiceId) || hostedVoiceProfiles()[0];
    if (!voice) throw fail("Voices aren't set up on this server", 503);
    const still = await step(0, () => image(`Front-facing head-and-shoulders portrait of a presenter looking directly at the camera, mouth closed, even lighting. ${item.prompt}`));
    const audio = await step(1, async () => {
      const spoken = await synthesizeHostedVoice({ profileId: voice.id, text: clip(s.script, 3000), signal });
      const out = await writeOutput(userId, spoken.audio, spoken.extension);
      outputs.push(out);
      return out;
    });
    await step(2, () => video("lipsync", "Natural talking head, subtle gestures, look at camera.", { image: still.file, audioFile: audio.file }));
  } else if (s.workflow === "storyboard") {
    const shots = await step(0, async () => {
      const { value } = await requestOpenRouter({
        kind: "text",
        json: true,
        maxTokens: 2000,
        temperature: 0.6,
        signal,
        messages: [{ role: "user", content: `Write a ${Math.min(6, Math.max(3, Number(s.count) || 4))}-shot storyboard for: ${item.prompt}\nKeep characters, wardrobe, and visual style consistent across shots. Return JSON only: {"style":"shared visual style under 40 words","shots":["image prompt for shot 1 under 60 words", "..."]}` }],
        validate: (v) => {
          if (!Array.isArray(v?.shots) || !v.shots.length) throw new Error("No shots");
        },
      });
      return value;
    });
    await step(1, async () => {
      for (const [index, shot] of shots.shots.slice(0, 6).entries()) {
        await report(`Drawing frame ${index + 1} of ${Math.min(6, shots.shots.length)}`, { steps });
        const out = await image(`${shot}. Style: ${shots.style}`);
        out.title = `Shot ${index + 1}`;
        out.caption = clip(shot, 200);
      }
    });
  } else if (s.workflow === "product-ad") {
    if (!s.firstFrame) throw fail("Add a product photo");
    await step(0, () => video("marketing", item.prompt, { firstFrame: s.firstFrame, adStyle: s.adStyle || "hero", product: s.product, duration: 5 }));
    await step(1, async () => {
      const music = await runMusic(userId, child("audio", `Upbeat modern advertising music bed for ${s.product || "a product"} commercial. ${item.prompt}`, { instrumental: true }), signal);
      outputs.push(...music.outputs);
    });
  }
  return { outputs, steps };
}

// ---------- Job runner ----------
const running = new Map();
function start(userId, item) {
  if (running.has(item.id)) return;
  const controller = new AbortController();
  running.set(item.id, controller);
  const report = (message, extra = {}) => update(userId, item.id, { message, ...extra });
  (async () => {
    try {
      await update(userId, item.id, { status: "running", error: "" });
      const runner = STUDIO_APPS[item.tab];
      let result;
      if (runner === "image") result = await runImage(userId, item, controller.signal);
      else if (runner === "music") result = await runMusic(userId, item, controller.signal);
      else if (runner === "motion") result = await runVibeMotion(userId, item, controller.signal);
      else if (runner === "clip") result = await runClipping(userId, item, controller.signal, report);
      else if (runner === "workflow") result = await runWorkflow(userId, item, controller.signal, report);
      else {
        if (!item.remoteJobId) {
          const remoteJobId = await submitVideo(userId, item, controller.signal);
          // The paid job id is saved first so a restart resumes it instead of paying twice.
          await update(userId, item.id, { remoteJobId });
        }
        result = { outputs: [await pollVideo(userId, item.remoteJobId, controller.signal, (status) => void report(status === "pending" ? "Queued at the provider" : "Rendering"))] };
      }
      await update(userId, item.id, { status: "done", message: "", ...result });
    } catch (error) {
      const stopped = controller.signal.aborted;
      await update(userId, item.id, {
        status: stopped ? "cancelled" : "failed",
        message: "",
        error: stopped ? "Stopped" : publicMessage(error instanceof Error ? error.message : String(error)),
      }).catch(() => {});
    } finally {
      running.delete(item.id);
    }
  })();
}
// After a restart, resume paid video jobs; other in-flight work can't be recovered.
async function resume(userId) {
  const items = await history(userId);
  let changed = false;
  for (const item of items) {
    if (!["queued", "running"].includes(item.status) || running.has(item.id)) continue;
    if (item.remoteJobId) start(userId, item);
    else {
      Object.assign(item, { status: "failed", message: "", error: "Interrupted by a server restart. Generate again.", updatedAt: new Date().toISOString() });
      changed = true;
    }
  }
  if (changed) await saveHistory(userId);
}

const ref = (value) => (FILE_NAME.test(String(value || "")) ? String(value) : undefined);
export function normalizeRequest(body = {}) {
  const tab = String(body.tab || "");
  if (!STUDIO_APPS[tab] || tab === "agents") throw fail("Unknown studio app");
  const prompt = clip(body.prompt, 4000);
  const s = body.settings || {};
  const settings = {
    mode: ["generate", "upscale"].includes(s.mode) ? s.mode : undefined,
    aspectRatio: clip(s.aspectRatio, 12) || undefined,
    resolution: clip(s.resolution, 12) || undefined,
    quality: clip(s.quality, 12) || undefined,
    count: Math.min(6, Math.max(1, Number(s.count) || 1)),
    duration: Number(s.duration) || undefined,
    audio: s.audio !== false,
    references: (Array.isArray(s.references) ? s.references : []).map(ref).filter(Boolean).slice(0, 8),
    firstFrame: ref(s.firstFrame),
    lastFrame: ref(s.lastFrame),
    image: ref(s.image),
    face: ref(s.face),
    audioFile: ref(s.audioFile),
    sourceVideo: ref(s.sourceVideo),
    sourceUrl: clip(s.sourceUrl, 500) || undefined,
    baseFile: ref(s.baseFile),
    upscaleFactor: Number(s.upscaleFactor) || undefined,
    operation: s.operation === "decompose" || LAYER_OPERATIONS[s.operation] ? s.operation : undefined,
    scene: INFLUENCER_SCENES[s.scene] ? s.scene : undefined,
    persona: clip(s.persona, 400) || undefined,
    adStyle: MARKETING_STYLES[s.adStyle] ? s.adStyle : undefined,
    product: clip(s.product, 120) || undefined,
    instrumental: s.instrumental !== false,
    lyrics: clip(s.lyrics, 3000) || undefined,
    style: clip(s.style, 300) || undefined,
    clipLength: ["short", "medium", "long"].includes(s.clipLength) ? s.clipLength : undefined,
    vertical: s.vertical !== false,
    workflow: WORKFLOWS[s.workflow] ? s.workflow : undefined,
    script: clip(s.script, 3000) || undefined,
    voiceId: clip(s.voiceId, 200) || undefined,
    motion: clip(s.motion, 400) || undefined,
    ...(tab === "cinema" ? { cinema: { camera: clip(s.cinema?.camera, 60), lens: clip(s.cinema?.lens, 60), focalLength: Number(s.cinema?.focalLength), aperture: clip(s.cinema?.aperture, 8) } } : {}),
  };
  for (const key of Object.keys(settings)) if (settings[key] === undefined) delete settings[key];
  const needsPrompt = ["image", "cinema", "design-agent", "audio", "vibe-motion", "workflows"].includes(tab) || (tab === "video" && settings.mode !== "upscale" && !settings.firstFrame);
  if (needsPrompt && !prompt && !(tab === "image" && settings.references.length)) throw fail("Describe what you want to create first");
  return { tab, model: clip(body.model, 120), prompt, settings };
}
async function enqueue(userId, request) {
  const items = await history(userId);
  if (items.filter((item) => ["queued", "running"].includes(item.status)).length >= MAX_ACTIVE_PER_USER)
    throw fail(`You can run ${MAX_ACTIVE_PER_USER} generations at once. Wait for one to finish.`, 429);
  const kind = modelKind(request.tab, request.settings);
  // Resolve the model now so the history shows what actually ran.
  if (kind) request.model = (await findModel(kind, request.model || undefined)).id;
  if (request.tab === "cinema") cinemaPrompt(request.prompt, request.settings.cinema);
  const now = new Date().toISOString();
  const item = { id: newId("job"), ...request, status: "queued", message: "", outputs: [], error: "", createdAt: now, updatedAt: now };
  items.unshift(item);
  await saveHistory(userId);
  start(userId, item);
  return item;
}

// ---------- Agents (chat that plans and launches generations) ----------
export const AGENTS = {
  creative: { name: "Creative Director", intro: "I plan and produce images, videos, and music from one idea.", brief: "a versatile creative director for video creators" },
  thumbnail: { name: "Thumbnail Designer", intro: "I design high-click YouTube thumbnails.", brief: "a YouTube thumbnail designer. Default to 16:9 images with a bold focal subject, strong contrast, and at most 4 words of large on-image text" },
  storyboard: { name: "Storyboard Artist", intro: "I break a story into consistent shots and animate them.", brief: "a storyboard artist who keeps characters and style consistent from shot to shot" },
  ads: { name: "Ad Creative", intro: "I turn a product into ad images and short ad videos.", brief: "a performance ad creative who writes scroll-stopping social ad concepts" },
  design: { name: "Design Agent", intro: "I make posters, social graphics, logos, and brand visuals.", brief: "a senior graphic designer who makes posters, social graphics, logos, and brand visuals with precise typography and layout. Prefer image models that render text well" },
};
async function agentTurn(userId, chat, message, signal) {
  const agent = AGENTS[chat.agent] || AGENTS.creative;
  const transcript = chat.messages.slice(-16).map((m) => ({ role: m.role, content: m.role === "assistant" && m.actions?.length ? `${m.content}\n[launched: ${m.actions.map((a) => `${a.app}: ${a.prompt}`).join(" | ")}]` : m.content }));
  const { value } = await requestOpenRouter({
    kind: "agent",
    json: true,
    maxTokens: 2500,
    temperature: 0.6,
    signal,
    messages: [
      {
        role: "system",
        content: `You are ${agent.brief}, working inside AutoYT Creator Studio.
You can launch generations. Each action runs immediately and its result appears in the chat.
Apps: "image" (prompt, aspectRatio one of 16:9, 9:16, 1:1, 4:5; count 1-4), "video" (prompt, aspectRatio 16:9 or 9:16, duration 5 or 8), "audio" (prompt for an instrumental music cue).
Reply in JSON only: {"reply":"short conversational message","actions":[{"app":"image","prompt":"detailed generation prompt","aspectRatio":"16:9","count":1}]}
Launch at most 4 actions per turn, and only when the user wants something made. Ask one clarifying question instead when the request is too vague. Write rich, specific generation prompts.`,
      },
      ...transcript,
      { role: "user", content: message },
    ],
    validate: (v) => {
      if (typeof v?.reply !== "string") throw new Error("No reply");
    },
  });
  const actions = [];
  for (const action of (Array.isArray(value.actions) ? value.actions : []).slice(0, 4)) {
    const app = ["image", "video", "audio"].includes(action?.app) ? action.app : "";
    const prompt = clip(action?.prompt, 2000);
    if (!app || !prompt) continue;
    try {
      const item = await enqueue(userId, normalizeRequest({
        tab: app,
        prompt,
        settings: { aspectRatio: clip(action.aspectRatio, 8) || "16:9", count: Number(action.count) || 1, duration: Number(action.duration) || 5, instrumental: true },
      }));
      actions.push({ app, prompt, generationId: item.id });
    } catch (error) {
      actions.push({ app, prompt, error: publicMessage(error.message) });
    }
  }
  return { content: clip(value.reply, 4000) || "Done.", actions };
}

// ---------- Routes ----------
export function registerCreatorStudio(app, express) {
  const route = (handler) => async (req, res) => {
    try {
      const session = await dependencies.session(req);
      if (!session?.user) throw fail("Sign in required", 401);
      await handler(req, res, String(session.user.id));
    } catch (error) {
      res.status(error.statusCode || 400).json({ error: publicMessage(error.message) });
    }
  };
  const sendFile = (res, file, name, download) => {
    const ext = extOf(file);
    res.setHeader("Content-Type", MIME[ext] || "application/octet-stream");
    res.setHeader("X-Content-Type-Options", "nosniff");
    // Generated HTML runs in an opaque origin so it can never reach the app.
    if (ext === "html") res.setHeader("Content-Security-Policy", "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:");
    if (download) res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
    res.sendFile(file);
  };

  app.get("/api/studio/catalog", route(async (_req, res) => {
    try {
      res.json({ ...(await studioCatalog()), agents: Object.entries(AGENTS).map(([id, a]) => ({ id, name: a.name, intro: a.intro })), workflows: Object.entries(WORKFLOWS).map(([id, w]) => ({ id, ...w })) });
    } catch (error) {
      throw fail(error.message, 503);
    }
  }));

  app.post(
    "/api/studio/uploads",
    express.raw({ type: () => true, limit: "200mb" }),
    route(async (req, res, userId) => {
      const type = String(req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
      const spec = UPLOAD_TYPES[type];
      if (!spec) throw fail("Upload a PNG, JPEG, or WebP image; an MP3, WAV, M4A, or OGG track; or an MP4, MOV, or WebM video");
      const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      if (!bytes.length) throw fail("The file is empty");
      if (bytes.length > spec.max * 1024 * 1024) throw fail(`Files of this type can be up to ${spec.max} MB`);
      const name = `${newId("up")}.${spec.ext}`;
      const file = userFile(userId, name);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, bytes);
      await persist(userId, file);
      res.json({ file: name, url: studioFileUrl(name), type });
    }),
  );

  app.get("/api/studio/files/:name", route(async (req, res, userId) => {
    const file = await readableFile(userId, req.params.name);
    res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
    sendFile(res, file, req.params.name, Boolean(req.query.download));
  }));

  // Unauthenticated on purpose: providers fetch inputs through these expiring links.
  app.get("/api/studio/public/:token/:name", async (req, res) => {
    const file = await resolvePublicMedia(req.params.token);
    if (!file || path.basename(file) !== req.params.name) return res.status(404).end();
    res.setHeader("Cache-Control", "no-store");
    sendFile(res, file, req.params.name, false);
  });

  app.get("/api/studio/generations", route(async (req, res, userId) => {
    await resume(userId);
    const tab = String(req.query.tab || "");
    const items = (await history(userId)).filter((item) => !tab || item.tab === tab);
    res.json({ generations: items.slice(0, 150) });
  }));

  app.post("/api/studio/generations", route(async (req, res, userId) => {
    if (!openRouterConfigured()) throw fail("Generation isn't set up on the server yet.", 503);
    res.status(202).json({ generation: await enqueue(userId, normalizeRequest(req.body)) });
  }));

  app.post("/api/studio/generations/:id/stop", route(async (req, res, userId) => {
    const item = (await history(userId)).find((entry) => entry.id === req.params.id);
    if (!item) throw fail("Generation not found", 404);
    running.get(item.id)?.abort();
    res.json({ stopped: running.has(item.id) });
  }));

  app.delete("/api/studio/generations/:id", route(async (req, res, userId) => {
    const items = await history(userId);
    const index = items.findIndex((entry) => entry.id === req.params.id);
    if (index < 0) throw fail("Generation not found", 404);
    const [item] = items.splice(index, 1);
    running.get(item.id)?.abort();
    await saveHistory(userId);
    for (const output of item.outputs || []) {
      await fs.rm(userFile(userId, output.file), { force: true }).catch(() => {});
      if (assetStoreConfigured()) void removeFile(storeKey(userId, output.file));
    }
    res.json({ deleted: true });
  }));

  app.get("/api/studio/agents/chats", route(async (_req, res, userId) => {
    res.json({ chats: await doc(userId, "agent-chats.json") });
  }));

  app.post("/api/studio/agents/chats", route(async (req, res, userId) => {
    if (!openRouterConfigured()) throw fail("Agents aren't set up on the server yet.", 503);
    const message = clip(req.body?.message, 4000);
    if (!message) throw fail("Write a message first");
    const chats = await doc(userId, "agent-chats.json");
    let chat = chats.find((c) => c.id === req.body?.chatId);
    if (!chat) {
      const agent = AGENTS[req.body?.agent] ? req.body.agent : "creative";
      chat = { id: newId("chat"), agent, title: message.slice(0, 60), messages: [], createdAt: new Date().toISOString() };
      chats.unshift(chat);
    }
    const reply = await agentTurn(userId, chat, message, AbortSignal.timeout(180000));
    chat.messages.push({ role: "user", content: message, at: new Date().toISOString() }, { role: "assistant", ...reply, at: new Date().toISOString() });
    if (chat.messages.length > 80) chat.messages.splice(0, chat.messages.length - 80);
    chat.updatedAt = new Date().toISOString();
    chats.sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)));
    await saveDoc(userId, "agent-chats.json", 60);
    res.json({ chat });
  }));

  app.delete("/api/studio/agents/chats/:id", route(async (req, res, userId) => {
    const chats = await doc(userId, "agent-chats.json");
    const index = chats.findIndex((c) => c.id === req.params.id);
    if (index >= 0) chats.splice(index, 1);
    await saveDoc(userId, "agent-chats.json", 60);
    res.json({ deleted: index >= 0 });
  }));
}
