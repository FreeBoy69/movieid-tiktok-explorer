// The Creator Studio app list, grouped the way the Open Generative AI navigation groups it.
import { ReactNode } from "react";
import {
  AudioLines,
  Bot,
  Camera,
  Film,
  ImageIcon,
  Layers,
  LayoutGrid,
  Megaphone,
  Mic,
  Move,
  PenTool,
  Scissors,
  Star,
  UserRoundCog,
  Workflow,
  Zap,
} from "lucide-react";
import type { StudioTab } from "../../utils/tiktokRoute";

export type StudioApp = {
  id: Exclude<StudioTab, "apps">;
  label: string;
  icon: ReactNode;
  summary: string;
  heading: string;
  body: string;
  action: string;
  placeholder: string;
};
const i = (Icon: typeof ImageIcon) => <Icon className="h-4 w-4" aria-hidden="true" />;

export const STUDIO_APPS: Record<StudioApp["id"], StudioApp> = {
  image: { id: "image", label: "Image Studio", icon: i(ImageIcon), summary: "Text to image and image to image, with reference uploads.", heading: "Make an image", body: "Describe a scene, character, or style. Add reference images to edit, combine, or restyle them.", action: "Generate", placeholder: "Describe the image you want to create" },
  layers: { id: "layers", label: "Layers Studio", icon: i(Layers), summary: "Cut out subjects, split layers, expand, upscale, relight.", heading: "Edit an image in layers", body: "Upload an image, then remove the background, split it into subject and background layers, expand the canvas, upscale, relight, or clean it up.", action: "Apply", placeholder: "Optional: describe the edit, lighting, or style" },
  cinema: { id: "cinema", label: "Cinema Studio", icon: i(Camera), summary: "Pro camera, lens, focal length, and aperture control.", heading: "Shoot a cinematic still", body: "Pick a camera, lens, focal length, and aperture, then describe the shot. The rig becomes part of the prompt.", action: "Shoot", placeholder: "Describe your scene" },
  "design-agent": { id: "design-agent", label: "Design Agent", icon: i(PenTool), summary: "Chat with a designer that makes posters, graphics, and logos.", heading: "Brief the Design Agent", body: "Describe the poster, social graphic, logo, or brand visual you need. The agent plans the design and renders it.", action: "Send", placeholder: "A launch poster for my channel's new series…" },
  "ai-influencer": { id: "ai-influencer", label: "AI Influencer Studio", icon: i(Star), summary: "One face, consistent across every scene.", heading: "Create a consistent persona", body: "Upload a face you have permission to use, describe the persona, and generate photos of the same person in any scene.", action: "Generate", placeholder: "Outfit, expression, or extra details for this shot" },
  video: { id: "video", label: "Video Studio", icon: i(Film), summary: "Text to video, image to video, and video upscaling.", heading: "Make a video", body: "Describe a shot to generate it from text, animate a still in Image to video (with a last frame on models that support it), or sharpen a clip in Upscale.", action: "Generate video", placeholder: "Describe the shot, subject, and camera movement" },
  clipping: { id: "clipping", label: "AI Clipping", icon: i(Scissors), summary: "Turn a long video into ready-to-post short clips.", heading: "Clip a long video", body: "Paste a link or upload a video. It's transcribed, the strongest moments are picked, and each one is cut into a vertical clip.", action: "Find clips", placeholder: "Optional focus, e.g. funniest moments or key advice" },
  "motion-control": { id: "motion-control", label: "Motion Control", icon: i(Move), summary: "Make a character copy the moves from a reference video.", heading: "Transfer motion to a character", body: "Add a character image and a short video with the movement you want. The character performs that motion.", action: "Generate", placeholder: "Optional: setting, camera, or style" },
  "vibe-motion": { id: "vibe-motion", label: "Vibe Motion", icon: i(Zap), summary: "Prompt animated motion graphics and titles.", heading: "Prompt a motion graphic", body: "Describe animated titles, lower thirds, kinetic type, or data animations. Revise them with follow-up prompts.", action: "Animate", placeholder: "Kinetic title card that says 'Top 10 Twists' with punchy yellow accents" },
  lipsync: { id: "lipsync", label: "Lip Sync", icon: i(Mic), summary: "Make any portrait speak your audio.", heading: "Make a portrait talk", body: "Add a front-facing portrait and a voice track up to 3 minutes. The model animates the face to match the audio.", action: "Sync lips", placeholder: "Speaking style, e.g. warm, subtle gestures, looks at camera" },
  "body-swap": { id: "body-swap", label: "Body Swap", icon: i(UserRoundCog), summary: "Replace the person in a video with someone else.", heading: "Swap the person in a video", body: "Upload a source video and a photo of the new person. Motion, framing, and background stay; the person changes. Use only people who have agreed to it.", action: "Swap", placeholder: "Optional: outfit or details to keep or change" },
  marketing: { id: "marketing", label: "Marketing Studio", icon: i(Megaphone), summary: "Turn a product photo into an ad video.", heading: "Make a product ad", body: "Add a product photo, name the product, and pick an ad style. You get a short commercial built around it.", action: "Make ad", placeholder: "Key message, audience, or setting" },
  audio: { id: "audio", label: "Audio Studio", icon: i(AudioLines), summary: "Original music and text to speech.", heading: "Compose music or voice", body: "Compose an original music cue from a description, or turn text into speech with your voices.", action: "Compose", placeholder: "Genre, mood, instruments, tempo" },
  agents: { id: "agents", label: "Agents", icon: i(Bot), summary: "Creative agents that plan and produce media for you.", heading: "Work with an agent", body: "Pick an agent and describe what you need. It plans the shots and launches the images, videos, and music itself.", action: "Send", placeholder: "Message the agent" },
  workflows: { id: "workflows", label: "Workflows", icon: i(Workflow), summary: "Multi-step pipelines that chain the studios.", heading: "Run a workflow", body: "Chain several studios in one run: a still into motion, a presenter who speaks a script, a full storyboard, or a product ad with music.", action: "Run workflow", placeholder: "Describe the subject" },
};

export const STUDIO_CATEGORIES: Array<{ id: string; label: string; icon: ReactNode; apps: StudioApp["id"][] }> = [
  { id: "images", label: "Images", icon: i(ImageIcon), apps: ["image", "layers", "cinema", "design-agent", "ai-influencer"] },
  { id: "video", label: "Video", icon: i(Film), apps: ["video", "clipping", "motion-control", "vibe-motion", "lipsync", "body-swap", "marketing"] },
  { id: "audio", label: "Audio", icon: i(AudioLines), apps: ["audio"] },
  { id: "agents", label: "Agents & Automation", icon: i(Workflow), apps: ["agents", "workflows"] },
];
export const EXPLORE_ICON = i(LayoutGrid);
