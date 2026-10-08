// Camera vocabulary shared by Cinema Studio and Create Film: camera angle
// (height and tilt), shot size (framing), perspective (composition), and
// movement. Each option carries the phrase that image and video models follow
// reliably; the screenplay writer picks ids, the storyboard and clip prompts
// spell them out. Shared by the server and the UI, so plain JS.

export const CAMERA_GROUPS = [
  { id: "angle", label: "Angle", hint: "Where the camera sits and how it tilts" },
  { id: "shot", label: "Shot size", hint: "How much of the subject the frame holds" },
  { id: "perspective", label: "Perspective", hint: "Viewpoint and composition" },
  { id: "motion", label: "Movement", hint: "How the camera moves through the shot" },
];

const o = (group, id, label, description, prompt, notes) => ({ group, id, label, description, prompt, ...(notes ? { notes } : {}) });

export const CAMERA_OPTIONS = [
  // ---------- Angle: describe where the camera physically is ----------
  o("angle", "eye-level", "Eye level", "Lens at the subject's eye height; neutral, honest.", "eye-level shot, camera at eye height, straight-on neutral perspective", "The model default; pick it only to stop a stylised angle."),
  o("angle", "slight-high", "Slightly high", "A gentle downward angle; flattering, intimate.", "slightly high camera angle, about 15 degrees above eye level, looking slightly down"),
  o("angle", "high-angle", "High angle", "Camera above, looking down; the subject feels smaller or vulnerable.", "high angle shot, camera above the subject looking down at them"),
  o("angle", "birds-eye", "Bird's-eye", "Steep view from high above that maps the layout and scale.", "bird's-eye view, camera high above the scene looking steeply down", "Give a height or 'steeply down'; models blur it with a plain high angle."),
  o("angle", "overhead-90", "Overhead 90°", "Directly above, pointing straight down; flat-lay.", "top-down overhead shot, camera directly above pointing straight down at 90 degrees, flat-lay composition", "Without '90 degrees' and 'directly above' models give a 45-degree view."),
  o("angle", "slight-low", "Slightly low", "A gentle upward angle; stature without distortion.", "slightly low camera angle, about 15 degrees below eye level, looking slightly up"),
  o("angle", "low-angle", "Low angle", "Camera below the eyeline looking up; the subject feels powerful.", "low angle shot, camera below the subject looking up, dramatic upward perspective, 24mm lens"),
  o("angle", "worms-eye", "Worm's-eye", "From the ground looking straight up; subjects tower.", "worm's-eye view, camera placed on the ground pointing almost vertically up, converging verticals, ultra-wide 16-24mm lens", "Often softened to a mild low angle; the physical camera position is what makes it work."),
  o("angle", "dutch", "Dutch angle", "Camera rolled sideways so the horizon tilts; unease.", "Dutch angle, camera rolled 20-30 degrees clockwise, diagonal tilted horizon, canted frame, natural body proportions", "Models love level horizons: the degrees and vertical lines in the scene make the tilt read. In video, hold the tilt steady."),
  o("angle", "ground-level", "Ground level", "Lens resting on the floor; the ground fills the foreground.", "ground-level shot, camera resting on the floor, ground texture in the foreground"),
  o("angle", "knee-level", "Knee level", "Camera at knee height; a subtle low perspective.", "knee-level shot, camera at knee height angled slightly up"),
  o("angle", "hip-level", "Hip level", "Camera at waist height; hands and holsters.", "hip-level shot, camera at waist height"),
  o("angle", "shoulder-level", "Shoulder level", "Camera at shoulder height; a quietly heroic default.", "shoulder-level shot, camera at shoulder height, slightly below the eyeline"),
  o("angle", "aerial", "Aerial", "High-altitude drone or helicopter view; landscape scale.", "aerial drone shot from high altitude, sweeping landscape view"),
  o("angle", "satellite", "Satellite", "Orbital-height straight-down view of terrain or cities.", "satellite view, orbital top-down imagery of the terrain"),

  // ---------- Shot size ----------
  o("shot", "extreme-wide", "Extreme wide", "A vast environment with a tiny subject; scale and isolation.", "extreme wide shot, tiny figure in a vast landscape, epic scale"),
  o("shot", "establishing", "Establishing", "Opens a scene by showing where and when it is.", "establishing shot of the location, wide view setting the scene"),
  o("shot", "wide", "Wide", "The full subject with plenty of surroundings.", "wide shot, full body visible with significant environment around the subject"),
  o("shot", "full", "Full shot", "Head to toe, filling the frame height.", "full shot, head-to-toe framing, entire body in frame"),
  o("shot", "medium-wide", "Medium wide", "From the knees up.", "medium wide shot, framed from the knees up"),
  o("shot", "cowboy", "Cowboy", "From mid-thigh up; classic western framing.", "cowboy shot, framed from mid-thigh up"),
  o("shot", "medium", "Medium", "Waist up; the dialogue workhorse.", "medium shot, waist-up framing, 50mm lens"),
  o("shot", "medium-close", "Medium close-up", "Chest up; face with some body.", "medium close-up, framed from the chest up"),
  o("shot", "close-up", "Close-up", "The face fills the frame; emotion and reaction.", "close-up shot of the face, head and shoulders, 85mm lens, shallow depth of field"),
  o("shot", "extreme-close-up", "Extreme close-up", "One feature: the eyes, the lips, a hand.", "extreme close-up of the eyes filling the entire frame, macro detail", "Name the feature or it becomes a plain close-up."),
  o("shot", "insert", "Insert", "A tight cut-in on an object or hand that matters.", "insert shot, macro detail of the object, shallow depth of field"),
  o("shot", "two-shot", "Two-shot", "Two characters share the frame.", "two-shot, two people sharing the frame side by side"),
  o("shot", "three-shot", "Three-shot", "Three characters in frame.", "three-shot, three people grouped in frame"),
  o("shot", "group", "Group", "An ensemble of four or more.", "group shot, ensemble of people arranged across the frame"),
  o("shot", "over-the-shoulder", "Over the shoulder", "From behind one person's shoulder toward the other.", "over-the-shoulder shot, out-of-focus shoulder and back of head at the frame edge, looking at the second person's face", "Image models over-weight the shoulder; keep it at the frame edge and out of focus."),
  o("shot", "pov", "Point of view", "What a character sees, first person.", "first-person POV shot, the character's own hands visible at the bottom of the frame", "Plain 'POV' is weak; the hands anchor it."),
  o("shot", "reaction", "Reaction", "Close on someone responding to something off screen.", "reaction shot, close-up of the person reacting to something off-screen"),
  o("shot", "single", "Single", "One person alone in the frame.", "clean single of one character"),

  // ---------- Perspective and composition ----------
  o("perspective", "frontal", "Frontal", "Facing the lens head-on.", "frontal view, subject facing the camera directly, straight-on"),
  o("perspective", "three-quarter", "Three-quarter", "Turned about 45 degrees from camera.", "three-quarter view, subject turned 45 degrees from the camera"),
  o("perspective", "profile", "Profile", "Exactly side-on.", "profile shot, side view, subject in clean profile"),
  o("perspective", "back", "From behind", "Facing away into the scene.", "shot from behind, subject facing away toward the scene, back to the camera, face not visible", "Models turn faces to camera unless told 'face not visible'."),
  o("perspective", "symmetrical", "Symmetrical", "Centred, one-point-perspective symmetry.", "perfectly symmetrical centred composition, one-point perspective"),
  o("perspective", "rule-of-thirds", "Rule of thirds", "On a third line with negative space.", "subject on the right third of the frame, negative space on the left"),
  o("perspective", "foreground-frame", "Foreground framing", "Out-of-focus foreground elements frame the subject.", "shot through out-of-focus foreground elements framing the subject, layered depth"),
  o("perspective", "through-doorway", "Through a doorway", "Seen through a door, window, or gap.", "shot through an open doorway, the door frame framing the subject in the room beyond"),
  o("perspective", "reflection", "Reflection", "Captured in a mirror, glass, or puddle.", "subject seen as a reflection in a mirror, reflection in focus"),
  o("perspective", "silhouette", "Silhouette", "Dark against a bright background.", "backlit silhouette against a bright sky, subject in full shadow"),
  o("perspective", "split-diopter", "Split diopter", "Near and far subjects both sharp.", "split diopter shot, foreground face and background figure both in sharp focus, visible blur seam between them", "Rarely reproduced; deep focus is the safer fallback."),
  o("perspective", "deep-focus", "Deep focus", "Everything sharp from front to back.", "deep focus, foreground and background both sharp"),
  o("perspective", "shallow-focus", "Shallow focus", "Subject sharp, the rest in bokeh.", "shallow depth of field, subject sharp, background melting into bokeh"),
  o("perspective", "fisheye", "Fisheye", "Extreme wide lens with curved distortion.", "fisheye lens, extreme barrel distortion, curved horizon"),

  // ---------- Movement: one move per shot, with a speed word ----------
  o("motion", "static", "Static", "Locked-off camera; the frame never moves.", "static shot, locked-off tripod camera, no camera movement", "Video models drift by default; 'no camera movement' stops it."),
  o("motion", "pan-left", "Pan left", "Turns left from a fixed point.", "slow pan left across the scene, smooth motion, fixed camera position"),
  o("motion", "pan-right", "Pan right", "Turns right from a fixed point.", "slow pan right across the scene, smooth motion, fixed camera position"),
  o("motion", "tilt-up", "Tilt up", "Tilts up from a fixed point.", "slow tilt up, fixed camera position"),
  o("motion", "tilt-down", "Tilt down", "Tilts down from a fixed point.", "slow tilt down, fixed camera position"),
  o("motion", "push-in", "Push in", "Creeps toward the subject; tension rises.", "slow push-in toward the subject's face, building tension"),
  o("motion", "dolly-in", "Dolly in", "Physically moves toward the subject.", "slow dolly in toward the subject, camera physically moves forward, background compressing"),
  o("motion", "dolly-out", "Dolly out", "Physically moves away from the subject.", "slow dolly out, camera physically moves backward away from the subject"),
  o("motion", "pull-out-reveal", "Pull-out reveal", "Pulls back to reveal the wider scene.", "camera pulls back slowly, revealing the wider surroundings"),
  o("motion", "truck-left", "Truck left", "Slides sideways left on a track.", "truck left, camera slides sideways on a track, strong parallax"),
  o("motion", "truck-right", "Truck right", "Slides sideways right on a track.", "truck right, camera slides sideways on a track, strong parallax"),
  o("motion", "tracking-side", "Side tracking", "Moves alongside a moving subject.", "side tracking shot, camera moves parallel alongside the walking subject"),
  o("motion", "follow", "Follow", "Follows behind the subject.", "following shot, camera follows behind the subject at the same speed"),
  o("motion", "lead", "Lead", "Retreats ahead of an approaching subject.", "leading shot, subject walks toward the camera while the camera moves backward at the same speed"),
  o("motion", "pedestal", "Pedestal", "Rises or lowers without tilting.", "pedestal up, the entire camera rises vertically from waist height to eye level, staying level"),
  o("motion", "crane-up", "Crane up", "Sweeps up and over the scene.", "crane shot starting low on the subject and ascending high above, revealing the landscape"),
  o("motion", "crane-down", "Crane down", "Descends from high into the scene.", "crane shot descending smoothly from high above down to the subject"),
  o("motion", "handheld", "Handheld", "Organic, documentary feel.", "handheld camera, subtle organic shake and breathing motion", "Comes out too shaky or not at all; 'subtle' keeps it right."),
  o("motion", "steadicam", "Steadicam", "Smooth floating move through space.", "smooth Steadicam glide forward, stabilized floating movement"),
  o("motion", "arc", "Arc", "A slow partial circle around the subject.", "slow 90-degree arc around the subject at chest height, subject stays centered"),
  o("motion", "orbit", "Orbit", "Circles around the subject.", "smooth 180-degree arc around the subject at chest height, constant speed, subject stays centered and in focus", "Faces warp past about 30 degrees per 5 seconds; keep orbits to long shots."),
  o("motion", "zoom-in", "Zoom in", "The lens zooms; the camera stays put.", "smooth lens zoom in, camera position fixed, focal length increases", "Models confuse zoom and dolly; 'camera position fixed' separates them."),
  o("motion", "crash-zoom", "Crash zoom", "A sudden, very fast zoom for impact.", "snap zoom, sudden instantaneous zoom into the subject's eyes"),
  o("motion", "dolly-zoom", "Dolly zoom", "The vertigo effect: the background warps, the subject holds size.", "dolly zoom vertigo effect: camera physically moves backward while the lens zooms in, subject stays the same size, background stretches", "Spell out both halves; Seedance handles it best."),
  o("motion", "whip-pan", "Whip pan", "An ultra-fast pan with motion blur.", "whip pan, violent fast pan with heavy directional motion blur"),
  o("motion", "rack-focus", "Rack focus", "Focus shifts between subjects.", "rack focus: starts sharp on the foreground object, then focus shifts to the person in the background"),
  o("motion", "fpv-drone", "FPV drone", "A fast, agile first-person drone dive.", "FPV drone shot, fast agile dive and weave through the space toward the subject"),
  o("motion", "drone-flyover", "Drone flyover", "A smooth aerial glide over the land.", "high-altitude drone flyover, smooth steady forward aerial movement over the landscape"),
  o("motion", "drone-reveal", "Drone reveal", "Rises and pulls back to reveal the place.", "drone rises and pulls back to reveal the whole location"),
  o("motion", "bullet-time", "Bullet time", "A frozen moment while the camera sweeps around.", "bullet time, action frozen mid-air, everything frozen, only the camera orbits smoothly around the subject", "Motion often fails to freeze; say only the camera moves."),
  o("motion", "roll", "Camera roll", "Rotates around the lens axis.", "slow camera roll, the frame rotates clockwise around the lens axis"),
  o("motion", "fly-through", "Fly-through", "Passes through a window, gap, or object.", "camera flies forward through the open window to reveal the subject inside", "A weak spot for every model; expect re-rolls."),
  o("motion", "reveal", "Reveal", "Moves past an obstruction to reveal the subject.", "camera moves past a foreground obstruction to reveal the subject"),
];

const BY_ID = new Map(CAMERA_OPTIONS.map((option) => [option.id, option]));
export const cameraOption = (id) => BY_ID.get(String(id || "")) || null;
export const cameraOptions = (group) => CAMERA_OPTIONS.filter((option) => option.group === group);
/** Keep an id only when it names an option in that group. */
export const cameraId = (group, id) => (cameraOption(id)?.group === group ? String(id) : "");

/** The prompt phrase for a shot's camera picks, in angle, size, perspective, movement order. */
export function cameraPhrase({ angle, shot, perspective, motion } = {}, { video = true } = {}) {
  return [cameraOption(shot), cameraOption(angle), cameraOption(perspective), video ? cameraOption(motion) : null]
    .filter(Boolean)
    .map((option) => option.prompt)
    .join(", ");
}

/** Short label a storyboard strip or a beat row shows: "Close-up · Low angle · Push in". */
export function cameraLabel({ angle, shot, perspective, motion } = {}) {
  return [cameraOption(shot), cameraOption(angle), cameraOption(perspective), cameraOption(motion)].filter(Boolean).map((option) => option.label).join(" · ");
}

/** The id lists a screenplay writer may choose from, as compact prompt text, with the rules that keep models on track. */
export function cameraMenu() {
  return `${CAMERA_GROUPS.map((group) => `${group.id}: ${cameraOptions(group.id).map((option) => option.id).join(", ")}`).join(". ")}. One camera movement per beat; keep orbits and dolly zooms to beats of 4 seconds or more`;
}
