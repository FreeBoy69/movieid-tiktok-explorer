// The Tools suite: one small app per job. Each tool runs on an API the app
// already has (the studio image and video runners, transcription, the
// downloader, TMDB lookups, and the metered text model).
import type { ToolId } from "../../utils/tiktokRoute";
import { navEntryFor } from "../../utils/appNavigation";

export type ToolKind = "image" | "thumbnail" | "video-upscale" | "stems" | "transcribe" | "audio-extract" | "thumbnail-download" | "poster" | "text" | "design" | "recap";
export type TextTask = "titles" | "description" | "hashtags";
export type ToolOperation = { value: string; label: string; hint: string };
export type ToolDef = {
  id: ToolId;
  kind: ToolKind;
  /** One sentence under the title: what goes in, what comes out. */
  tagline: string;
  /** The primary button. */
  action: string;
  /** The empty results stage. */
  heading: string;
  body: string;
  /** Image tools: the edits this tool offers; the first is the default. */
  operations?: ToolOperation[];
  /** Image tools: the description field, when the edit needs words. */
  prompt?: { label: string; placeholder: string; required: boolean };
  /** Image Expander: choose the new aspect ratio. */
  aspect?: boolean;
  /** Text tools: which server task runs. */
  task?: TextTask;
};

export const TOOLS: Record<ToolId, ToolDef> = {
  "movie-recap": {
    id: "movie-recap",
    kind: "recap",
    tagline: "A full film becomes a narrated 10 to 20 minute recap and a vertical Short, cut in 3 to 4 second shots.",
    action: "Analyze film",
    heading: "Your film, retold",
    body: "Paste a link to a full movie or upload it. We watch every scene, write a recap in your voice for you to edit, then cut it in short shots with the film's own sound removed.",
  },
  "editable-design": {
    id: "editable-design",
    kind: "design",
    tagline: "Posters, covers, menus, and campaign visuals as real HTML: live text, independent layers, a mouse editor.",
    action: "Design it",
    heading: "Design a poster you can still edit",
    body: "Describe it. The design is planned, its artwork painted, and the layout written as live text and movable layers. Open the editor to drag, resize, and retype anything, then export the PNG.",
  },
  "background-remover": {
    id: "background-remover",
    kind: "image",
    tagline: "Upload a photo. Get the subject on clean white, or the scene with the subject gone.",
    action: "Remove",
    heading: "Clean cutouts in one pass",
    body: "Drop in any image. The subject comes back on pure white with clean edges, or pick Keep the scene to erase the subject and fill the background naturally.",
    operations: [
      { value: "remove-background", label: "Keep the subject", hint: "Subject on plain white" },
      { value: "background-plate", label: "Keep the scene", hint: "Remove the subject, fill the gap" },
    ],
    prompt: { label: "What is the subject? (optional)", placeholder: "e.g. the woman in the red coat", required: false },
  },
  "layer-splitter": {
    id: "layer-splitter",
    kind: "image",
    tagline: "One image in, two layers out: the cut-out subject and the clean background.",
    action: "Split layers",
    heading: "Subject and background, separately",
    body: "Upload an image and you get two files: the main subject cut out on white, and the scene with the subject removed. Ready for compositing, parallax, or thumbnails.",
    prompt: { label: "What is the subject? (optional)", placeholder: "e.g. the dog on the left", required: false },
  },
  "image-upscaler": {
    id: "image-upscaler",
    kind: "image",
    tagline: "Re-render a small or soft image at the model's highest resolution with crisp detail.",
    action: "Upscale",
    heading: "Sharper, larger, the same picture",
    body: "Upload the image. It is re-rendered at the highest resolution the model offers, keeping composition, colors, and content exactly as they are.",
  },
  "image-expander": {
    id: "image-expander",
    kind: "image",
    tagline: "Outpaint beyond the edges to a new aspect ratio, continuing the scene naturally.",
    action: "Expand",
    heading: "More canvas, same scene",
    body: "Pick the new aspect ratio. The original stays untouched in the middle while the scene continues outward with matching light, perspective, and style.",
    aspect: true,
    prompt: { label: "What should the new space show? (optional)", placeholder: "e.g. more of the beach and a cloudy sky", required: false },
  },
  relight: {
    id: "relight",
    kind: "image",
    tagline: "Describe the light you want. Subject and composition stay exactly as shot.",
    action: "Relight",
    heading: "New light on the same shot",
    body: "Golden hour, soft studio key, neon from the left, overcast noon. Say it in words and the image is relit without moving a thing.",
    prompt: { label: "Describe the lighting", placeholder: "e.g. warm golden-hour sunlight from the right, long soft shadows", required: true },
  },
  restyle: {
    id: "restyle",
    kind: "image",
    tagline: "Keep the composition and subjects, render the picture in a new style.",
    action: "Restyle",
    heading: "Same picture, new look",
    body: "Oil painting, 90s anime, claymation, risograph print. Name the style and the image is redrawn in it while every subject stays where it was.",
    prompt: { label: "Describe the style", placeholder: "e.g. watercolor illustration with soft paper texture", required: true },
  },
  "object-remover": {
    id: "object-remover",
    kind: "image",
    tagline: "Erase text, logos, people, or clutter and fill the gap naturally.",
    action: "Remove objects",
    heading: "Gone without a trace",
    body: "Name what should disappear. Watermarks, signage, a stray hand, the trash can in the corner. The fill matches the surroundings and nothing else changes.",
    prompt: { label: "What should be removed?", placeholder: "e.g. the watermark bottom right and the car behind her", required: true },
  },
  "magic-edit": {
    id: "magic-edit",
    kind: "image",
    tagline: "Any change you can describe, applied precisely to one image.",
    action: "Apply edit",
    heading: "Edit with a sentence",
    body: "Change the shirt to blue, add rain, make it night, open the window. Describe the edit and only that part of the image changes.",
    prompt: { label: "Describe the edit", placeholder: "e.g. make her jacket dark green and add light snowfall", required: true },
  },
  "thumbnail-maker": {
    id: "thumbnail-maker",
    kind: "thumbnail",
    tagline: "A click-worthy 16:9 thumbnail from a description, your title text, and an optional face or product photo.",
    action: "Make thumbnail",
    heading: "Thumbnails built to be tapped",
    body: "Pick a style, write the title that should appear on the image, and describe the moment. Add a photo of yourself or the product to put it in the frame.",
    operations: [
      { value: "creator", label: "Creator", hint: "Big reaction, bold colors" },
      { value: "cinematic", label: "Cinematic", hint: "Moody film still" },
      { value: "clean", label: "Clean", hint: "One object, lots of space" },
      { value: "documentary", label: "Documentary", hint: "Real moment, one accent" },
      { value: "gaming", label: "Gaming", hint: "Neon, dynamic angle" },
      { value: "explainer", label: "Explainer", hint: "Flat colors, arrows" },
    ],
    prompt: { label: "Describe the thumbnail", placeholder: "e.g. a shocked man holding a cracked phone, exploding sparks behind him", required: false },
  },
  "video-upscaler": {
    id: "video-upscaler",
    kind: "video-upscale",
    tagline: "Sharpen a clip to 1.5×, 2×, or 3× its resolution.",
    action: "Upscale video",
    heading: "Crisper footage, same cut",
    body: "Upload an MP4, MOV, or WebM. The clip is re-rendered at the scale you choose with recovered detail and no change to timing or framing.",
  },
  transcriber: {
    id: "transcriber",
    kind: "transcribe",
    tagline: "Paste a video link. Get the full transcript, a subtitle file, and a path straight into the rewriter.",
    action: "Transcribe",
    heading: "Every word, written down",
    body: "YouTube, TikTok, and direct video links work. Long videos run in the background; the page keeps polling until the text is ready.",
  },
  "audio-extractor": {
    id: "audio-extractor",
    kind: "audio-extract",
    tagline: "Pull the soundtrack out of any video link as an audio file.",
    action: "Extract audio",
    heading: "Just the sound",
    body: "Paste the link, pick the audio quality, and download. Music, narration, interviews, all without the picture.",
  },
  "vocal-remover": {
    id: "vocal-remover",
    kind: "stems",
    tagline: "Split a video's sound into the voice on its own and the music and effects without it.",
    action: "Split audio",
    heading: "Voice here, music there",
    body: "Upload a video or paste its link. You get two MP3s: the narration or dialogue alone, and everything else with the voice taken out, ready to re-voice or remix.",
  },
  "thumbnail-downloader": {
    id: "thumbnail-downloader",
    kind: "thumbnail-download",
    tagline: "Save the full-size cover image of any video link.",
    action: "Find cover",
    heading: "The cover, full size",
    body: "Paste a YouTube, TikTok, or other video link. The cover image is fetched at its largest size, ready to save or study.",
  },
  "poster-finder": {
    id: "poster-finder",
    kind: "poster",
    tagline: "Type a film or series. Get the poster, backdrop, cast, and facts.",
    action: "Find",
    heading: "Posters and facts for any title",
    body: "Search by title, add the year when titles repeat. You get the poster and backdrop at full size, the synopsis, runtime, rating, director, and top cast.",
  },
  "title-generator": {
    id: "title-generator",
    kind: "text",
    task: "titles",
    tagline: "Ten honest, specific titles under 60 characters, each with a different angle.",
    action: "Write titles",
    heading: "Titles people click",
    body: "Give it the topic or paste the transcript. Pick a style or let it vary the angle, then copy a title or send it straight to the Thumbnail Maker.",
  },
  "description-writer": {
    id: "description-writer",
    kind: "text",
    task: "description",
    tagline: "A description with the hook up top, your links, search tags, hashtags, and chapters.",
    action: "Write description",
    heading: "The description, done",
    body: "Paste the title and your script or notes. The first two lines carry the hook and keyword, then the value, then your links. Tags and hashtags come with it.",
  },
  "hashtag-generator": {
    id: "hashtag-generator",
    kind: "text",
    task: "hashtags",
    tagline: "A hashtag set mixed across broad, medium, and niche reach.",
    action: "Pick hashtags",
    heading: "Hashtags sized for reach",
    body: "Describe the post. You get a mix of huge, mid-size, and niche tags so it can rank in small pools and still ride the big ones. Tick the ones you want and copy.",
  },
};

export const TOOL_LIST = Object.values(TOOLS);
export const toolEntry = (id: ToolId) => navEntryFor("tool", undefined, id);
