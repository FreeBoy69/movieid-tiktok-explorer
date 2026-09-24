// Shot templates: genre-level camera grammar, look, and beat structure for a
// Create Video project (and for Create Drama episodes via settings.shotTemplateId).
//
// Adapted from the MIT-licensed templates/ in jnMetaCode/ai-shortfilm-prompts
// (https://github.com/jnMetaCode/ai-shortfilm-prompts). Only the MIT templates/
// directory is used; that repo's prompts/ directory is All Rights Reserved.
//
// Each template is a beat sequence written for one ~10-15s clip. Longer videos
// stretch it: the first scene is always the opening beat, the last scene is the
// closing beat, and the scenes between map proportionally onto the middle beats.

export const SHORTFILM_SOURCE = {
  name: "ai-shortfilm-prompts",
  author: "jnMetaCode",
  license: "MIT",
  url: "https://github.com/jnMetaCode/ai-shortfilm-prompts",
};

export const SHORTFILM_TEMPLATES = [
  {
    id: "micro-drama",
    genre: "Drama",
    thumbnailPrompt: "Vertical 9:16 cinematic still: a tired young woman in office wear faces an older man in an expensive suit across a desk at night, desk lamp light, cold city window, tense restrained expressions, shallow focus, film grain",
    name: "Vertical micro-drama",
    tagline: "Cold-open hook, shot-reverse-shot confrontation, cliffhanger cut.",
    aspect: "9:16",
    scriptFormat: "dialogue",
    artStyleId: "preset:documentary",
    fixedCamera: false,
    variables: [
      { name: "hook", label: "Opening shock", example: "she slaps a resignation letter on the desk" },
      { name: "conflict", label: "The line that escalates it", example: "\"You knew. The whole time.\"" },
      { name: "cliff", label: "Unanswered turn at the end", example: "he slides her a photo and she freezes" },
    ],
    look: "Grounded cinematic realism, ARRI Alexa with vintage primes, restrained grade, shallow focus isolating faces, motivated practical light, film grain. Composed for vertical: faces large in the upper-middle, eye-lines respected.",
    camera: "Shot-reverse-shot dialogue grammar: a clean single, a reverse single, a tighter push as tension rises. A subtle, breath-like handheld float keeps it immediate.",
    acting: "Real, restrained emotion (a tight jaw, a held breath), never theatrical soap-opera overacting.",
    beats: [
      { role: "hook", label: "Cold open", action: "Open directly on the shocking beat, no setup: {{hook}}.", camera: "Punch-in single on the lead, face large in a vertical frame" },
      { role: "confront", label: "Confrontation", action: "The exchange escalates line by line: {{conflict}}. Cut between the two faces.", camera: "Clean single, then reverse single, each with a slow push as it heats up" },
      { role: "cliff", label: "Cliffhanger", action: "{{cliff}}: a reveal that flips the scene, left unresolved.", camera: "Hold on the frozen reaction, a slight push-in, cut before any resolution" },
    ],
    avoid: "theatrical overacting, exaggerated soap-opera expressions, plastic CG skin, glossy idol render, flat even studio lighting, horizontal letterboxing, faces too small in frame, swelling melodramatic score, lifeless locked-off camera",
  },
  {
    id: "movie-trailer",
    genre: "Trailer",
    thumbnailPrompt: "Widescreen cinematic still of a drowned near-future coastal city at dusk, a lone diver silhouette on a flooded street, desaturated steel-blue grade, wet concrete, flickering signage, film grain, ominous calm",
    name: "Movie teaser trailer",
    tagline: "Escalating montage under one locked grade, smash to black on the title.",
    aspect: "16:9",
    scriptFormat: "narration",
    artStyleId: "preset:documentary",
    fixedCamera: false,
    variables: [
      { name: "world", label: "World", example: "a drowned near-future coastal city" },
      { name: "protagonist", label: "Protagonist", example: "a lone diver-engineer" },
      { name: "threat", label: "Threat (felt, never fully shown)", example: "something vast moving under the water" },
      { name: "grade", label: "Colour grade", example: "desaturated steel-blue" },
    ],
    look: "Large-format film look: IMAX-style wides for the world, tight Sony Venice close-ups for the character. One locked grade on every shot ({{grade}}), low contrast, organic film grain. The world is built from texture: wet concrete, flickering signage, debris, weather.",
    camera: "Escalating rhythm: long quiet holds early, shorter and more active shots as tension rises, then one held beat of stillness at the end. Subtle breath-like handheld float.",
    acting: "The protagonist appears in only a few shots; a teaser implies rather than explains.",
    beats: [
      { role: "establish", label: "Establish", action: "Wide of {{world}}, almost still. The calm before.", camera: "Slow push on a wide, long hold" },
      { role: "character", label: "The protagonist", action: "{{protagonist}}, a flicker of unease.", camera: "Tight close-up on the face" },
      { role: "inciting", label: "First sign", action: "The first sign of {{threat}}: something shifts, a light dies, a sensor spikes.", camera: "Medium shot, camera starts to move" },
      { role: "escalate", label: "Escalation", action: "Motion, reaction, a glimpse (never the full reveal) of {{threat}}.", camera: "Short, active shots; faster camera moves" },
      { role: "close", label: "Smash to black", action: "One final motion, then stillness.", camera: "Hard stop on the last motion, hold in near-darkness" },
    ],
    avoid: "grade shifting between shots, oversaturated colors, glossy CG render, video-game look, flat even studio lighting, rapid strobe cuts, cheesy lens flare, full reveal of the threat, generic stock music feel",
  },
  {
    id: "found-footage-horror",
    genre: "Horror",
    thumbnailPrompt: "Security camera frame of an empty office corridor at night, IR night-vision green-grey, fisheye distortion, sensor noise, compression artefacts, a door at the far end standing slightly open",
    name: "Found-footage horror",
    tagline: "A fixed security camera, nothing happens, then one quiet wrong thing.",
    aspect: "16:9",
    scriptFormat: "narration",
    artStyleId: "",
    fixedCamera: true,
    variables: [
      { name: "place", label: "Place", example: "an empty office corridor at 3 AM" },
      { name: "wrong_thing", label: "What goes wrong", example: "a door at the end stands open that was shut" },
      { name: "cam_type", label: "Camera", example: "ceiling security camera, wide fisheye" },
    ],
    look: "Real cheap surveillance footage, not a cinema camera: {{cam_type}}, IR night-vision green-grey or murky low-light colour, low resolution, compression blocking in the shadows, crawling sensor noise, warped fisheye edges, a timestamp burn-in. The artefacts are the aesthetic.",
    camera: "Fixed mount, locked off for the whole shot. No handheld float, no drift, no reframing: a security camera stares.",
    acting: "Dread through stillness. No monster reveal, no blood; the wrongness is quiet and specific.",
    beats: [
      { role: "normal", label: "Normal", action: "{{place}}, empty and still. Nothing happens; hold the boredom.", camera: "Fixed wide, locked" },
      { role: "wrong", label: "Wrong", action: "{{wrong_thing}}: subtle and easy to miss, a frame stutters as it happens.", camera: "Still fixed; the eye has to find it" },
      { role: "hold", label: "Hold", action: "Nothing else moves. The wrong thing just stays.", camera: "Still fixed, the footage keeps rolling" },
    ],
    avoid: "cinematic color grade, filmic look, shallow depth of field, smooth handheld motion, dramatic lighting, lens flare, clean high-resolution image, gore, blood, jumpscare monster reveal, oversaturated colors, 3D cartoon render, polished VFX",
  },
  {
    id: "product-commercial",
    genre: "Commercial",
    thumbnailPrompt: "Macro product photograph of a brushed steel mechanical wristwatch on a dark walnut tabletop, low raking window light, dust motes in the light shaft, warm amber bokeh, true specular highlights",
    name: "Premium product commercial",
    tagline: "Macro tactile realism: the object at rest, a touch, the detail, settle.",
    aspect: "16:9",
    scriptFormat: "narration",
    artStyleId: "preset:documentary",
    fixedCamera: false,
    variables: [
      { name: "product", label: "Product", example: "a mechanical wristwatch" },
      { name: "material", label: "Material", example: "brushed steel case, sapphire crystal" },
      { name: "hero_action", label: "Hero action", example: "the crown is wound and the second hand sweeps" },
      { name: "surface", label: "Surface", example: "dark walnut tabletop" },
    ],
    look: "ARRI Alexa with a probe macro lens, one hard key from window-left, soft bounce fill, controlled falloff. {{product}} on a {{surface}}, fine dust in a low shaft of light, soft warm bokeh behind. Real touched objects: a hairline scratch, a half-wiped fingerprint. True specular highlights, restrained grade, film grain.",
    camera: "Slow, deliberate probe push-ins and one lateral track across the surface; micro breath-float only, a product macro wants stability.",
    acting: "Only a hand enters frame; no faces.",
    beats: [
      { role: "rest", label: "At rest", action: "{{product}} sits still on the {{surface}}, side light raking low.", camera: "Slow probe push-in from a low angle" },
      { role: "touch", label: "The touch", action: "A hand enters frame; {{hero_action}}.", camera: "Lateral track following the contact point" },
      { role: "detail", label: "The detail", action: "Extreme macro on {{material}}, a specular glint travelling across an edge.", camera: "Slow rack focus from texture to bokeh" },
      { role: "settle", label: "Settle", action: "The hand withdraws; {{product}} returns to rest.", camera: "Hold, light dimming slightly" },
    ],
    avoid: "plastic CG gloss, floating product in an empty white void, seamless infinity backdrop, perfectly flawless surfaces, blown-out highlights, oversaturated colors, spinning hero rotation, logo slam, cheesy lens flare, flat even studio lighting",
  },
];

export const findShortfilmTemplate = (id) => SHORTFILM_TEMPLATES.find((template) => template.id === id) || null;
export const shortfilmTemplateThumb = (id) => `/assets/templates/${id}.webp`;
export const listShortfilmTemplates = () =>
  SHORTFILM_TEMPLATES.map(({ id, name, genre, tagline }) => ({ id, name, genre, tagline, thumbnail: shortfilmTemplateThumb(id) }));

// Drama episode roles by scene position: first scene hooks, last scene is the cliffhanger,
// the turn lands around 60%, and the scenes between run setup → confrontation → payoff.
export const DRAMA_BEAT_ROLES = ["hook", "setup", "confrontation", "turn", "payoff", "cliffhanger"];
export function beatRoleForScene(index, total) {
  const count = Math.max(1, Math.round(Number(total) || 1));
  const i = Math.min(Math.max(0, Math.round(Number(index) || 0)), count - 1);
  if (i === 0) return "hook";
  if (i === count - 1) return "cliffhanger";
  const turn = Math.min(count - 2, Math.max(1, Math.round((count - 1) * 0.6)));
  if (i === turn) return "turn";
  if (i > turn) return "payoff";
  return i <= Math.ceil((turn - 1) / 2) ? "setup" : "confrontation";
}

// Fills {{name}} slots from the creator's values, falling back to the template's example.
export function fillTemplate(text, template, values = {}) {
  const examples = Object.fromEntries((template?.variables || []).map((item) => [item.name, item.example]));
  return String(text || "").replace(/\{\{(\w+)\}\}/g, (_, name) => {
    const value = String(values?.[name] ?? "").trim().replace(/\s+/g, " ").slice(0, 300);
    return value || examples[name] || name.replace(/_/g, " ");
  });
}

// Which beat a scene plays: first scene opens, last scene closes, the rest spread across the middle.
export function beatForScene(template, index, total) {
  const beats = template?.beats || [];
  if (!beats.length) return null;
  const count = Math.max(1, Number(total) || 1);
  const i = Math.min(Math.max(0, Number(index) || 0), count - 1);
  if (beats.length === 1 || count === 1) return beats[0];
  if (i === 0) return beats[0];
  if (i === count - 1) return beats[beats.length - 1];
  const middle = beats.slice(1, -1);
  if (!middle.length) return beats[Math.round((i / (count - 1)) * (beats.length - 1))];
  return middle[Math.min(middle.length - 1, Math.floor(((i - 1) / Math.max(1, count - 2)) * middle.length))];
}

// Settings a project takes on when it starts from a template. The creator can change any of them afterwards.
export function shortfilmSettings(id) {
  const template = findShortfilmTemplate(id);
  if (!template) return {};
  return {
    shotTemplateId: template.id,
    aspect: template.aspect,
    scriptFormat: template.scriptFormat,
    ...(template.artStyleId ? { artStyleId: template.artStyleId } : {}),
    ...(template.fixedCamera ? { fixedCamera: true } : {}),
  };
}

// Extra rules for the storyboard (visual plan) system prompt.
export function shotDirectionRules(id, values = {}) {
  const template = findShortfilmTemplate(id);
  if (!template) return "";
  const fill = (text) => fillTemplate(text, template, values);
  const beats = template.beats.map((beat, i) => `${i + 1}. ${beat.label}: ${fill(beat.action)} Camera: ${beat.camera}.`).join(" ");
  return [
    ` SHOT TEMPLATE (${template.name}): follow this genre's visual grammar.`,
    `Look: ${fill(template.look)}`,
    `Camera: ${template.camera}`,
    `Performance: ${template.acting}`,
    `Beat structure, stretched across the scenes in order (the first scene is beat 1, the last scene is the final beat): ${beats}`,
    `Never show: ${template.avoid}.`,
  ].join(" ");
}

// Camera and motion direction for one scene's animation clip.
export function sceneAnimationPrompt(id, index, total, values = {}) {
  const template = findShortfilmTemplate(id);
  const beat = beatForScene(template, index, total);
  if (!beat) return "";
  return `${beat.camera}. ${template.camera} Avoid: ${template.avoid}`;
}
