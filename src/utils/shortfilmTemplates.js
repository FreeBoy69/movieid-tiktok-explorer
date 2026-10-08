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
    id: "stickman-director",
    genre: "Explainer",
    thumbnailPrompt: "Vertical 9:16 minimalist illustration on a flat, pure white background: a black stick figure with a hollow circular head and no face leaps toward a huge vivid red question mark that is cracking open, electric blue motion lines, a few warm gold sparks, uniform bold line weight, no shading, no gradients, no text",
    name: "Stickman explainer",
    tagline: "Golden hook, broken assumption, hidden mechanics, the real truth, a question for the comments.",
    aspect: "9:16",
    scriptFormat: "narration",
    artStyleId: "preset:stickman-light",
    fixedCamera: false,
    // Roughly 22 narrated words and three visual beats per ten seconds, as the source skill prescribes.
    settings: {
      sceneSeconds: 3.5,
      wordCount: 140,
      tone: "Confident, warm, conversational and concrete. Counter-intuitive openings, short spoken sentences, no platitudes, no invented facts or statistics.",
      outline: [
        "Golden hook: a counter-intuitive question or visual paradox in the first sentence",
        "Disrupt the assumption: state what everyone believes, then shatter it in one sentence",
        "Unveil the mechanics: the hidden detail or real obstacle behind the surface",
        "Ultimate truth: the underlying logic or human-nature insight, the payoff",
        "Elevation: one memorable takeaway, then a question that invites debate in the comments",
      ],
    },
    variables: [
      { name: "hook", label: "Golden hook", example: "why do the busiest people get the most done?" },
      { name: "assumption", label: "What everyone believes", example: "more hours means more output" },
      { name: "truth", label: "The real mechanism", example: "they decide once, then protect that decision" },
      { name: "question", label: "Closing question", example: "which decision are you still re-making every day?" },
    ],
    look: "Flat, digitally pure canvas with no texture, gradient, shadow, lighting or depth. One minimalist 2D stick figure: hollow circular head, no face, no hair, no clothing, no filled body, uniform medium line weight, stable proportions. Up to three saturated accent colors (vivid red, electric blue, warm gold) used only on the idea that matters in the scene. Composed for vertical: the figure large and central, reveals stacked top to bottom, text-safe margins.",
    camera: "Kinetic motion-graphic staging: the figure acts out each idea as a concrete physical event (leaps, pushes, draws a line, opens a door, taps a surface) with a visible change every two to three seconds. Objects enter, transform and exit; the camera travels with the action instead of cutting to an empty frame. No abstract liquid morphing.",
    acting: "Body language only: posture, gesture and pace carry the emotion. Never idle, never staring at the camera.",
    beats: [
      { role: "hook", label: "Golden hook", action: "Open on a visual paradox for {{hook}}: the figure meets something that should not be possible.", camera: "Figure large in frame with one bold accent object, in motion from the first frame" },
      { role: "disrupt", label: "Disrupt the assumption", action: "Build what everyone believes ({{assumption}}) as a structure, then shatter or flip it in one move.", camera: "Construct, then break: the figure pushes, kicks or pulls the structure apart" },
      { role: "secrets", label: "Unveil the mechanics", action: "Pull back the curtain: the figure finds the hidden mechanism behind the surface.", camera: "Open a panel, descend a level, or trace the connection with a drawn luminous line" },
      { role: "truth", label: "Ultimate truth", action: "Deliver the core insight, {{truth}}, as one clear visual metaphor.", camera: "Hold the metaphor centre frame with the accent color at its strongest" },
      { role: "elevation", label: "Elevation and question", action: "Distil the takeaway and leave {{question}} hanging.", camera: "The figure turns to a new horizon; one accent element remains, unresolved" },
    ],
    avoid: "photorealism, 3D humanoid rendering, facial features, hair, clothing, filled bodies, extra limbs, changing line weight, textures, gradients, shadows, lighting effects, visible words, letters, numbers, captions, logos, speech bubbles, abstract liquid morphing, idle poses",
  },
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
  {
    id: "cinematic-film",
    genre: "Film",
    thumbnailPrompt: "Widescreen 2.39 cinematic film still: a woman in a rain-dark coat stands at a train platform edge at blue hour, sodium lamps behind, a man half in shadow watching her from a bench, anamorphic bokeh, restrained teal and amber grade, film grain",
    name: "Cinematic film",
    tagline: "Widescreen coverage: establishing wides, motivated moves, faces that carry the story.",
    aspect: "16:9",
    scriptFormat: "dialogue",
    artStyleId: "preset:documentary",
    fixedCamera: false,
    variables: [
      { name: "world", label: "World", example: "a rain-soaked port city in late autumn" },
      { name: "want", label: "What the lead wants", example: "to leave town before the truth comes out" },
      { name: "ending", label: "Final image", example: "an empty platform as the last train pulls away" },
    ],
    look: "Feature-film realism: ARRI Alexa with anamorphic primes, motivated practical light, deep blacks and a restrained grade held across every shot, organic film grain. {{world}} built from real texture and weather. Composed for widescreen: use the width, negative space, and depth.",
    camera: "Classical coverage: an establishing wide, a medium two-shot, then singles that tighten as stakes rise. Slow dolly and crane moves with a reason, held frames for the beats that matter.",
    acting: "Grounded, specific performances; emotion shown in the eyes and hands, never announced.",
    beats: [
      { role: "establish", label: "Establish", action: "The world and the lead in it: {{world}}.", camera: "Wide establishing shot, slow push" },
      { role: "want", label: "The want", action: "The lead moves toward it: {{want}}.", camera: "Medium shot tracking with the lead" },
      { role: "obstacle", label: "Obstacle", action: "Someone or something stands in the way; the pressure rises.", camera: "Two-shot, then tightening singles" },
      { role: "turn", label: "Turn", action: "A reveal or decision changes the direction of the story.", camera: "Slow push-in on the face as it lands" },
      { role: "resolve", label: "Final image", action: "{{ending}}.", camera: "Wide, held, the camera settling to stillness" },
    ],
    avoid: "vertical framing, letterbox bars burned in, theatrical overacting, plastic CG skin, glossy idol render, flat even studio lighting, grade shifting between shots, rapid strobe cuts, cheesy lens flare, text on screen",
  },
  {
    id: "music-video",
    genre: "Music",
    thumbnailPrompt: "Widescreen music video still: a singer in a silver jacket performs in a neon-lit empty parking garage, wet floor reflections, haze in magenta and cyan light beams, dancers mid-move behind, anamorphic flare, film grain",
    name: "Music video",
    tagline: "Performance and story cut to the song: hooks land on the downbeat.",
    aspect: "16:9",
    scriptFormat: "narration",
    artStyleId: "preset:documentary",
    fixedCamera: false,
    variables: [
      { name: "world", label: "World", example: "a neon-lit empty parking garage at night" },
      { name: "story", label: "Story thread", example: "two friends drifting apart over one summer" },
      { name: "peak", label: "Peak image", example: "confetti and strobes as the whole crew dances on the roof" },
    ],
    look: "High-end music video: bold controlled color, haze and practical light sources, reflections, strong silhouettes, one consistent grade across every shot, film grain. {{world}}. Performers styled and lit like the hero of the frame.",
    camera: "Moves with the music: slow glides in verses, faster pushes, whips and orbits on the chorus, a held hero frame on the biggest hit. Cuts and motion land on the beat.",
    acting: "Performers sell the song: committed lip-sync on sung lines, attitude and emotion in every look; story scenes stay natural and wordless.",
    beats: [
      { role: "intro", label: "Intro", action: "The world and the artist before the first line: {{world}}.", camera: "Slow glide, wide to medium" },
      { role: "verse", label: "Verse", action: "The story thread unfolds between performance shots: {{story}}.", camera: "Steady medium shots, gentle drift" },
      { role: "chorus", label: "Chorus", action: "Full-energy performance: movement, light, and crowd hit with the hook.", camera: "Fast pushes, orbit, whip transitions on the beat" },
      { role: "bridge", label: "Bridge", action: "A quieter, intimate turn in the story.", camera: "Close-ups, slow motion feel, held frames" },
      { role: "outro", label: "Final chorus and outro", action: "{{peak}}, then the last image fading with the music.", camera: "Big wide on the peak, settling to stillness" },
    ],
    avoid: "lyrics or any text on screen, subtitles, mouths moving on instrumental parts, off-beat cutting, flat even studio lighting, plastic CG skin, glossy idol render, grade shifting between shots, cheesy lens flare overload",
  },
  {
    id: "music-video-vertical",
    genre: "Music",
    thumbnailPrompt: "Vertical 9:16 music video still: a young singer in a red puffer jacket performs straight to camera on a rooftop at golden hour, city skyline behind, wind in her hair, warm haze, dancers in silhouette, film grain",
    name: "Vertical music video",
    tagline: "Phone-first performance: artist large in frame, hooks on the downbeat.",
    aspect: "9:16",
    scriptFormat: "narration",
    artStyleId: "preset:documentary",
    fixedCamera: false,
    variables: [
      { name: "world", label: "World", example: "a city rooftop at golden hour" },
      { name: "story", label: "Story thread", example: "a long-distance couple counting down to meeting again" },
      { name: "peak", label: "Peak image", example: "the couple finally running into each other on a crowded street" },
    ],
    look: "Vertical music video for phones: the artist large in the upper-middle of the frame, bold controlled color, haze, practical light, one consistent grade, film grain. {{world}}.",
    camera: "Moves with the music: handheld energy and push-ins on the chorus, smooth glides on verses, whip transitions on the beat; composed for a vertical frame.",
    acting: "Committed lip-sync on sung lines straight to camera; story moments natural and wordless.",
    beats: [
      { role: "intro", label: "Intro", action: "The artist and the world before the first line: {{world}}.", camera: "Slow push on a vertical single" },
      { role: "verse", label: "Verse", action: "The story thread between performance shots: {{story}}.", camera: "Steady vertical mediums" },
      { role: "chorus", label: "Chorus", action: "Full-energy performance on the hook.", camera: "Handheld push-ins, whip on the beat" },
      { role: "bridge", label: "Bridge", action: "A quiet intimate moment.", camera: "Close-up, held" },
      { role: "outro", label: "Outro", action: "{{peak}}, then the last image.", camera: "Pull back, settle" },
    ],
    avoid: "lyrics or any text on screen, subtitles, horizontal letterboxing, faces too small in frame, mouths moving on instrumental parts, off-beat cutting, plastic CG skin, flat even studio lighting",
  },
  // Faceless long-form formats (the documentary and countdown channels): real
  // footage and stills under narration, cut to data cards in one look.
  {
    id: "documentary",
    genre: "Documentary",
    // The gallery card is a filmed year card (see public/assets/templates/documentary.webp), not a generated image.
    thumbnailPrompt: "Archival documentary still: a 1960s laboratory bench with glass jars of sea kelp, brass scales and handwritten notes under warm window light, film grain, muted palette",
    name: "Documentary",
    tagline: "Narrated history and exposés: footage, archive stills, and data cards in one look.",
    aspect: "16:9",
    scriptFormat: "narration",
    artStyleId: "preset:documentary",
    fixedCamera: false,
    settings: {
      sceneSeconds: 4.5,
      wordCount: 1500,
      look: "paper",
      transition: "fade",
      visualSource: "mixed",
      graphics: true,
      tone: "Calm, authoritative documentary narrator. Concrete names, places, dates, and figures; vivid detail over adjectives. Short spoken sentences. No invented facts or statistics.",
      outline: [
        "Cold open: one vivid, specific moment that poses the video's central question",
        "Context: who, where, and when, with the dates and figures that matter",
        "Rising detail: the evidence, in the order it was discovered",
        "The turn: what most people get wrong, or what changed everything",
        "Resolution: what it means now, and a question for the comments",
      ],
    },
    variables: [
      { name: "subject", label: "Subject", example: "the luxury skincare industry" },
      { name: "era", label: "Era or place", example: "1965 to today" },
      { name: "angle", label: "The angle", example: "what you actually pay for in a $390 jar" },
    ],
    look: "Documentary realism: natural light, believable locations and objects, archival photographs and period detail for {{era}}, one consistent grade. Stills that could be real footage of {{subject}}.",
    camera: "Observational coverage: slow pushes on details, wides to establish place, inserts of documents, products, and maps. Calm pacing; let images breathe under the narration.",
    acting: "People appear as subjects of the story, never posing for the camera.",
    beats: [
      { role: "open", label: "Cold open", action: "The single most vivid image of {{angle}}.", camera: "Slow push in on a telling detail" },
      { role: "context", label: "Context", action: "Establish {{subject}} in {{era}}: the place, the people, the period.", camera: "Wide establishing shot, then a detail insert" },
      { role: "evidence", label: "Evidence", action: "Documents, objects, and places that show the facts.", camera: "Inserts and slow pans across the evidence" },
      { role: "turn", label: "The turn", action: "The revealing contrast at the heart of {{angle}}.", camera: "Two contrasting images, held" },
      { role: "close", label: "Resolution", action: "Today's version of {{subject}}, the question left open.", camera: "A slow pull back to a wide" },
    ],
    avoid: "cartoon or 3D render look, fantasy elements, glossy advertising look, text or captions in images, logos, oversaturated colors, dramatic lens flares",
  },
  {
    id: "top-10",
    genre: "Countdown",
    thumbnailPrompt: "Bold hero shot of a rusted 1950s backyard brick incinerator in a suburban garden at golden hour, centred, clean background, high contrast, documentary realism",
    name: "Top 10 countdown",
    tagline: "Ten entries counted down to number one, each with its own rank card.",
    aspect: "16:9",
    scriptFormat: "narration",
    artStyleId: "preset:documentary",
    fixedCamera: false,
    settings: {
      sceneSeconds: 4,
      wordCount: 1600,
      look: "deep-black",
      transition: "zoom",
      visualSource: "mixed",
      graphics: true,
      tone: "Energetic, confident countdown host. Every entry earns its place with one surprising concrete fact. Short spoken sentences, curiosity hooks between entries. No invented facts or statistics.",
      outline: [
        "Hook: promise the list and tease number one without naming it",
        "Entries 10 to 2, counting down. Each opens with 'Number N:' and its name, then why it matters, one surprising fact, and a hook into the next",
        "Number one: the biggest payoff, with the most specific detail",
        "Outro: recap the top three in one line, then a question for the comments",
      ],
    },
    variables: [
      { name: "topic", label: "List topic", example: "old backyard features that faded into history" },
      { name: "audience", label: "Who it's for", example: "Americans who grew up in the 1950s and 60s" },
    ],
    look: "Real-world documentary stills of each entry in {{topic}}: the object, place, or person itself, shot clearly and centred, period-accurate detail, one consistent grade across all ten.",
    camera: "Hero framing: each entry's subject large and centred, clean background, one detail insert per entry.",
    acting: "Objects and places are the stars; people only when the entry is about them.",
    beats: [
      { role: "hook", label: "Hook", action: "A montage-worthy image that sums up {{topic}}.", camera: "Bold centred hero shot" },
      { role: "entry", label: "Entries", action: "The current entry's subject, clearly shown.", camera: "Hero shot, then a detail insert" },
      { role: "top", label: "Number one", action: "The number one entry at its most striking.", camera: "The most dramatic hero framing of the video" },
      { role: "outro", label: "Outro", action: "A warm closing image of {{topic}} for {{audience}}.", camera: "Slow pull back" },
    ],
    avoid: "text, numbers, or captions in images, logos, cartoon or 3D render look, cluttered collages, split screens, oversaturated colors",
  },
];

export const findShortfilmTemplate = (id) => SHORTFILM_TEMPLATES.find((template) => template.id === id) || null;
export const shortfilmTemplateThumb = (id) => `/assets/templates/${id}.webp`;
export const listShortfilmTemplates = () =>
  SHORTFILM_TEMPLATES.map(({ id, name, genre, tagline }) => ({ id, name, genre, tagline, thumbnail: shortfilmTemplateThumb(id) }));
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
    // Pacing and writing defaults a template prescribes (scene length, word budget, outline).
    ...(template.settings || {}),
  };
}

// Universal motion pacing for an animated scene clip: three timed beats once a
// clip is long enough to hold them, otherwise one continuous action. Adapted
// from the stickman director's [0-3s] [3-7s] [7-10s] rule.
export function timedBeatsDirection(seconds) {
  const s = Math.round(Number(seconds) || 0);
  if (s < 6) return "Continuous purposeful motion for the whole clip; the subject is never idle";
  const a = Math.max(2, Math.round(s * 0.3)), b = Math.max(a + 2, Math.round(s * 0.7));
  return `Three timed beats: [0-${a}s] establish the premise with a concrete action, [${a}-${b}s] escalate or transform it, [${b}-${s}s] land the payoff and begin the motion that leads into the next scene. A visible change every two to three seconds; the subject is never idle`;
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
