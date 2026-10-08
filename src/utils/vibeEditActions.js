// The edit vocabulary the Vibe Edit assistant speaks. The server lists these
// in the model prompt and validates what comes back; the client runs them
// against the project through the same operations the UI uses. Shared, so
// plain JS. Modeled on Donkey Cut's chat tools (github.com/donkeycut/donkey).

export const VIBE_ACTIONS = {
  add_text: { args: "{text, start, end, y?: 0..1 (0 top), size?: px at 1080 wide, color?: hex, look?: plain|boxed|outline}", about: "Put a title on screen" },
  update_item: { args: "{id, start?, in?, out?, volume?: 0..3, muted?, duck?: 0..1|null, fadeIn?, fadeOut?, preset?: voice preset id|null, fit?: fit|fill, text?, color?, size?, y?}", about: "Change any clip, sound, title, or caption by id" },
  move_item: { args: "{id, start, row?}", about: "Move an item in time (row = video track or audio lane)" },
  delete_items: { args: "{ids: string[]}", about: "Remove items" },
  ripple_delete: { args: "{id}", about: "Remove a base-track clip and close the gap" },
  split_at: { args: "{time, ids?: string[]}", about: "Cut items at a time" },
  place_asset: { args: "{assetId, at?, track?}", about: "Put a media file on the timeline" },
  set_aspect: { args: "{aspect: 16:9|9:16|1:1|4:5}", about: "Change the frame" },
  set_background: { args: "{color: hex}", about: "Frame background color" },
  rename: { args: "{name}", about: "Rename the project" },
  caption_look: { args: "{style?: clean|hook|punchy|minimal|highlight|bubble|neon, show?, wordHighlight?, size?, y?}", about: "Restyle captions" },
  generate_captions: { args: "{}", about: "Transcribe the timeline's speech into word-timed captions" },
  edit_captions: { args: "{cues: [{id, text}]}", about: "Rewrite caption lines (fix typos, translate)" },
  voiceover: { args: "{script?: string, fromCaptions?: boolean, voice?: voice name, direction?: delivery e.g. 'warm, unhurried' or 'in Spanish, upbeat', language?: BCP-47, at?: seconds, duck?: 0..1}", about: "Speak a script (or the captions) in an AI voice and lay it on the soundtrack, ducking music under it" },
  add_music: { args: "{query: e.g. 'calm lo-fi piano', volume?: 0..1}", about: "Find a royalty-free track and lay it under the edit" },
  remove_pauses: { args: "{silences?: boolean, fillers?: boolean, retakes?: boolean}", about: "Cut dead air, filler words (um, uh), and retakes out of the speech, rippling every track. 'Edit my video' starts here" },
  clean_audio: { args: "{on?: boolean}", about: "Filter rumble and hiss and even out the speech of the video clips" },
  color_boost: { args: "{on?: boolean}", about: "A gentle contrast and saturation lift on the footage" },
  punch_in: { args: "{}", about: "Zoom in on every other piece of a jump-cut take so cuts read as new angles" },
  add_broll: { args: "{count?: 1..6}", about: "Stock b-roll over a few key spoken lines, voice running under it" },
  generate_image: { args: "{prompt, at?}", about: "Generate a still and place it" },
  generate_video: { args: "{prompt, seconds?: 5|10, at?}", about: "Generate a video shot and place it (takes a minute or two)" },
  seek: { args: "{time}", about: "Move the playhead" },
};
const MAX_ACTIONS = 24;

const clean = (value, depth = 0) => {
  if (depth > 4) return undefined;
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string") return value.slice(0, 4000);
  if (Array.isArray(value)) return value.slice(0, 200).map((v) => clean(v, depth + 1)).filter((v) => v !== undefined);
  if (typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value).slice(0, 40)) {
      const c = clean(v, depth + 1);
      if (c !== undefined) out[k] = c;
    }
    return out;
  }
  return undefined;
};

/** Keep only known actions with object args, capped and size-limited. */
export function sanitizeActions(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((a) => a && typeof a === "object" && VIBE_ACTIONS[a.type])
    .slice(0, MAX_ACTIONS)
    .map((a) => ({ type: a.type, args: clean(a.args && typeof a.args === "object" ? a.args : {}) || {} }));
}

/** The compact state the model sees: ids, kinds, times, and text, never URLs. */
export function summarizeProject(project, extra = {}) {
  const r = (x) => Math.round(Number(x) * 100) / 100;
  const cues = project.captions?.cues || [];
  return {
    name: project.name,
    aspect: project.aspect,
    duration: r(Math.max(0, ...[...project.clips, ...project.audio].map((c) => c.start + c.out - c.in), ...project.texts.map((t) => t.end), ...cues.map((c) => c.end))),
    assets: project.assets.map((a) => ({ id: a.id, kind: a.kind, name: String(a.name).slice(0, 60), ...(a.duration ? { duration: r(a.duration) } : {}), ...(a.origin ? { origin: a.origin } : {}) })),
    clips: project.clips.map((c) => ({ id: c.id, assetId: c.assetId, track: c.track, start: r(c.start), end: r(c.start + c.out - c.in), in: r(c.in), out: r(c.out), ...(c.muted ? { muted: true } : {}), ...(c.volume !== undefined ? { volume: c.volume } : {}) })),
    audio: project.audio.map((c) => ({ id: c.id, assetId: c.assetId, name: c.name, lane: c.lane, start: r(c.start), end: r(c.start + c.out - c.in), volume: c.volume, ...(c.duck !== undefined ? { duck: c.duck } : {}), ...(c.preset ? { preset: c.preset } : {}) })),
    texts: project.texts.map((t) => ({ id: t.id, text: t.text, start: r(t.start), end: r(t.end), y: t.y, size: t.size, color: t.color, look: t.look })),
    ...(project.tracks && Object.keys(project.tracks).length ? { tracks: project.tracks } : {}),
    captions: {
      style: project.captions?.style,
      show: project.captions?.show,
      wordHighlight: project.captions?.wordHighlight,
      count: cues.length,
      cues: cues.slice(0, 80).map((c) => ({ id: c.id, start: r(c.start), end: r(c.end), text: c.text })),
    },
    ...extra,
  };
}
