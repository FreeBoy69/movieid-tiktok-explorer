// One composer + gallery that serves every generator app in Creator Studio.
import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  AudioLines,
  BookOpen,
  Camera,
  Check,
  ChevronDown,
  Clapperboard,
  Download,
  History,
  Loader2,
  Mic,
  Music,
  PenLine,
  RotateCcw,
  Sparkles,
  Square,
  Trash2,
  Wand2,
} from "lucide-react";
import type { StudioTab } from "../../utils/tiktokRoute";
import { type GalleryHandlers, StudioGallery } from "./StudioGallery";
import { useErrorToast } from "../../utils/toast";
import { STUDIO_APPS, type StudioApp } from "./studioApps";
import {
  type AnyModel,
  type Asset,
  type Catalog,
  Choice,
  Empty,
  type Generation,
  IconButton,
  IMAGE_TYPES,
  Lightbox,
  MediaSlot,
  ModelPicker,
  type Output,
  readJson,
  ReferenceTray,
  Tabs,
  Toggle,
  VIDEO_TYPES,
  elapsed,
  fit,
  timeAgo,
  uploadAsset,
} from "./studioShared";

type AppId = StudioApp["id"];
export type Draft = Record<string, any>;

// Camera rig presets and preview art from Open Generative AI's Cinema Studio.
const CAMERAS = ["Modular 8K Digital", "Full-Frame Cine Digital", "Grand Format 70mm Film", "Studio Digital S35", "Classic 16mm Film", "Premium Large Format Digital"];
const LENSES = ["Creative Tilt Lens", "Compact Anamorphic", "Extreme Macro", "70s Cinema Prime", "Classic Anamorphic", "Premium Modern Prime", "Warm Cinema Prime", "Swirl Bokeh Portrait", "Vintage Prime", "Halation Diffusion", "Clinical Sharp Prime"];
const FOCAL_LENGTHS = [8, 14, 24, 35, 50, 85];
const APERTURES = ["f/1.4", "f/4", "f/11"];
const rigArt = (name: string) => `/assets/cinema/${name.toLowerCase().replace("/", "_").replace(/\./g, "_").replace(/[^a-z0-9_]+/g, "_")}.webp`;

const LAYER_OPS = [
  { value: "remove-background", label: "Remove background", hint: "Subject on plain white", group: "cutout" },
  { value: "decompose", label: "Split into layers", hint: "Subject and background as two images", group: "cutout" },
  { value: "extract-subject", label: "Extract subject", hint: "Cut out the main subject", group: "cutout" },
  { value: "background-plate", label: "Clean background", hint: "Remove the subject, keep the scene", group: "cutout" },
  { value: "expand", label: "Expand canvas", hint: "Outpaint to a new aspect ratio", group: "canvas" },
  { value: "upscale", label: "Upscale", hint: "Re-render at the highest resolution", group: "canvas" },
  { value: "relight", label: "Relight", hint: "Change the lighting you describe", group: "look" },
  { value: "restyle", label: "Restyle", hint: "Render it in a new style", group: "look" },
  { value: "cleanup", label: "Remove objects", hint: "Erase text, logos, or objects", group: "fix" },
  { value: "edit", label: "Custom edit", hint: "Any change you describe", group: "fix" },
];
const LAYER_GROUPS = [
  { value: "cutout", label: "Cut out" },
  { value: "canvas", label: "Canvas" },
  { value: "look", label: "Look" },
  { value: "fix", label: "Fix" },
];
const NEEDS_DESCRIPTION = ["relight", "restyle", "cleanup", "edit"];
const SCENES = [
  { value: "cafe", label: "Café selfie", hint: "Sunlit café, coffee in hand", group: "everyday" },
  { value: "home", label: "Home vlog", hint: "Cozy sofa, ring light glow", group: "everyday" },
  { value: "gym", label: "Gym mirror", hint: "Mirror selfie, athletic wear", group: "everyday" },
  { value: "street", label: "City streetwear", hint: "Walking a busy street", group: "everyday" },
  { value: "portrait", label: "Studio portrait", hint: "Soft key light, neutral backdrop", group: "studio" },
  { value: "product", label: "Sponsored post", hint: "Holding a product to camera", group: "studio" },
  { value: "travel", label: "Beach travel", hint: "Golden hour on the beach", group: "going-out" },
  { value: "night", label: "Night out", hint: "Neon lights, flash photo", group: "going-out" },
];
const SCENE_GROUPS = [
  { value: "everyday", label: "Everyday" },
  { value: "studio", label: "Studio" },
  { value: "going-out", label: "Going out" },
];
const AD_STYLES = [
  { value: "hero", label: "Studio hero", hint: "Slow spin, sweeping light", group: "product" },
  { value: "luxury", label: "Luxury macro", hint: "Moody close-ups of details", group: "product" },
  { value: "unboxing", label: "Unboxing", hint: "Hands reveal the product", group: "product" },
  { value: "lifestyle", label: "Lifestyle", hint: "Someone using it day to day", group: "people" },
  { value: "ugc", label: "UGC testimonial", hint: "Handheld creator to camera", group: "people" },
  { value: "promo", label: "Energetic promo", hint: "Fast moves, punchy pacing", group: "promo" },
];
const AD_GROUPS = [
  { value: "product", label: "Product shots" },
  { value: "people", label: "With people" },
  { value: "promo", label: "Promo" },
];
const pickInGroup = (list: Array<{ value: string; group: string }>, group: string, current: string) =>
  list.find((item) => item.group === group && item.value === current)?.value || list.find((item) => item.group === group)!.value;
function OptionCards({ label, options, value, onChange }: { label: string; options: Array<{ value: string; label: string; hint: string }>; value: string; onChange: (value: string) => void }) {
  return (
    <div className="cs-options" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button key={option.value} type="button" role="radio" aria-checked={value === option.value} className="cs-option" onClick={() => onChange(option.value)}>
          <strong>{option.label}</strong>
          <span>{option.hint}</span>
        </button>
      ))}
    </div>
  );
}
const WORKFLOW_ART: Record<string, ReactNode> = {
  "image-to-video": <Clapperboard className="h-4 w-4" />,
  "talking-avatar": <Mic className="h-4 w-4" />,
  storyboard: <PenLine className="h-4 w-4" />,
  "product-ad": <Music className="h-4 w-4" />,
};

const PREFERRED: Record<string, string[]> = {
  image: ["bytedance-seed/seedream-4.5", "google/gemini-3-pro-image"],
  cinema: ["google/gemini-3-pro-image", "bytedance-seed/seedream-4.5"],
  video: ["alibaba/wan-3.0", "bytedance/seedance-2.0-fast", "google/veo-3.1-fast"],
  upscale: ["black-forest-labs/flux-video-upscale"],
  avatar: ["heygen/avatar-iv"],
  motion: ["bytedance/seedance-2.0-fast"],
  edit: ["black-forest-labs/flux-video-edit"],
};

// Apps that use the Higgsfield-style left control panel. Image, Video, and Audio
// keep the composer bar; Marketing and Cinema have their own pages.
export const PANEL_APPS: AppId[] = ["layers", "ai-influencer", "clipping", "motion-control", "vibe-motion", "lipsync", "body-swap", "workflows"];

export function defaultDraft(): Draft {
  return {
    prompt: "",
    model: "",
    aspectRatio: "16:9",
    resolution: "",
    quality: "",
    count: 1,
    duration: 5,
    audio: true,
    references: [],
    cinema: { camera: CAMERAS[1], lens: LENSES[5], focalLength: 35, aperture: "f/1.4" },
    videoTab: "text",
    layerGroup: "cutout",
    clipSource: "link",
    operation: "remove-background",
    scene: "cafe",
    sceneGroup: "everyday",
    adGroup: "product",
    persona: "",
    adStyle: "hero",
    product: "",
    audioMode: "music",
    instrumental: true,
    lyrics: "",
    voiceId: "",
    style: "",
    clipLength: "short",
    vertical: true,
    sourceUrl: "",
    upscaleFactor: 2,
    workflow: "image-to-video",
    script: "",
    motion: "",
  };
}

// Which catalog list serves an app, and which models in it fit the app.
function modelsFor(catalog: Catalog | null, app: AppId, draft: Draft): { key: string; list: AnyModel[] } {
  if (!catalog) return { key: "", list: [] };
  if (app === "image" || app === "cinema") return { key: app, list: catalog.image };
  if (app === "layers" || app === "ai-influencer") return { key: "image", list: catalog.image.filter((m) => m.maxReferences > 0) };
  if (app === "video") {
    if (draft.videoTab === "upscale") return { key: "upscale", list: catalog.upscale };
    if (draft.videoTab === "image") return { key: "video", list: catalog.video.filter((m) => m.frames.includes("first_frame")) };
    return { key: "video", list: catalog.video };
  }
  if (app === "marketing") return { key: "video", list: catalog.video.filter((m) => m.frames.includes("first_frame")) };
  if (app === "lipsync") return { key: "avatar", list: catalog.avatar };
  if (app === "motion-control") return { key: "motion", list: catalog.motion };
  if (app === "body-swap") return { key: "edit", list: catalog.edit };
  return { key: "", list: [] };
}

export function StudioGenerator({
  app,
  catalog,
  catalogLoading,
  generations,
  draft,
  patch,
  now,
  onCreated,
  onRefresh,
  onRemoved,
  onSend,
}: {
  app: AppId;
  catalog: Catalog | null;
  catalogLoading: boolean;
  generations: Generation[];
  draft: Draft;
  patch: (changes: Draft, target?: AppId) => void;
  now: number;
  onCreated: (item: Generation) => void;
  onRefresh: () => void;
  onRemoved: (id: string) => void;
  onSend: (target: AppId, field: string, asset: Asset) => void;
}) {
  const meta = STUDIO_APPS[app];
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  useErrorToast(error, () => setError(""));
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [stageView, setStageView] = useState<"history" | "how">("history");
  const [voices, setVoices] = useState<Array<{ id: string; name: string }>>([]);
  const [voiceClips, setVoiceClips] = useState<Array<{ id: string; voice: string; text: string; audioUrl: string; createdAt: string }>>([]);
  const { key: modelKey, list: models } = useMemo(() => modelsFor(catalog, app, draft), [catalog, app, draft]);
  const model = models.find((m) => m.id === draft.model);
  const usesModel = Boolean(modelKey);
  const visible = useMemo(() => generations.filter((item) => item.tab === app), [generations, app]);

  useEffect(() => setError(""), [app]);

  // Pick a default model and keep every setting inside what the model supports.
  useEffect(() => {
    if (!models.length) return;
    const chosen = model || PREFERRED[modelKey]?.map((id) => models.find((m) => m.id === id)).find(Boolean) || models[0];
    const next: Draft = {};
    if (chosen.id !== draft.model) next.model = chosen.id;
    const aspect = fit(draft.aspectRatio, chosen.aspectRatios.filter((a) => a !== "auto"), app === "ai-influencer" ? ["4:5", "9:16"] : ["16:9", "9:16", "1:1"]);
    if (aspect && aspect !== draft.aspectRatio) next.aspectRatio = aspect;
    const resolution = fit(draft.resolution, chosen.resolutions, ["720p", "2K", "1K"]);
    if (resolution !== draft.resolution) next.resolution = resolution;
    if ("qualities" in chosen) {
      const quality = fit(draft.quality, chosen.qualities, ["high", "auto"]);
      if (quality !== draft.quality) next.quality = quality;
      if (draft.count > chosen.maxImages) next.count = chosen.maxImages;
      const room = Math.max(0, chosen.maxReferences - (app === "layers" || app === "ai-influencer" ? 1 : 0));
      if ((draft.references || []).length > room) next.references = draft.references.slice(0, room);
    }
    if ("durations" in chosen && chosen.durations.length && !chosen.durations.includes(draft.duration)) next.duration = chosen.durations.includes(5) ? 5 : chosen.durations[0];
    if ("frames" in chosen && draft.lastFrame && !chosen.frames.includes("last_frame")) next.lastFrame = undefined;
    if (Object.keys(next).length) patch(next);
  }, [models, model, modelKey, app, draft, patch]);

  useEffect(() => {
    if (app !== "audio" || voices.length) return;
    fetch("/api/voicebox/profiles")
      .then((response) => readJson(response, "Voices unavailable"))
      .then((data) => {
        const list = (Array.isArray(data.profiles) ? data.profiles : []).map((p: any) => ({ id: String(p.id), name: String(p.name || p.id) }));
        setVoices(list);
        if (list[0] && !draft.voiceId) patch({ voiceId: list[0].id });
      })
      .catch(() => undefined);
  }, [app, voices.length, draft.voiceId, patch]);

  const payload = () => ({
    tab: app,
    model: usesModel ? draft.model : "",
    prompt: app === "workflows" && draft.workflow === "talking-avatar" ? draft.prompt : draft.prompt,
    settings: {
      mode: app === "video" && draft.videoTab === "upscale" ? "upscale" : undefined,
      aspectRatio: draft.aspectRatio,
      resolution: draft.resolution,
      quality: draft.quality,
      count: draft.count,
      duration: draft.duration,
      audio: draft.audio,
      references: (draft.references || []).map((ref: Asset) => ref.file),
      firstFrame: app !== "video" || draft.videoTab === "image" ? draft.firstFrame?.file : undefined,
      lastFrame: app === "video" && draft.videoTab === "image" ? draft.lastFrame?.file : undefined,
      image: draft.image?.file,
      face: draft.face?.file,
      audioFile: draft.audioFile?.file,
      sourceVideo: app === "clipping" && draft.clipSource === "link" ? undefined : draft.sourceVideo?.file,
      sourceUrl: app === "clipping" && draft.clipSource === "link" ? draft.sourceUrl : "",
      baseFile: draft.baseFile,
      upscaleFactor: draft.upscaleFactor,
      operation: draft.operation,
      scene: draft.scene,
      persona: draft.persona,
      adStyle: draft.adStyle,
      product: draft.product,
      instrumental: draft.instrumental,
      lyrics: draft.instrumental ? "" : draft.lyrics,
      style: draft.style,
      clipLength: draft.clipLength,
      vertical: draft.vertical,
      workflow: draft.workflow,
      script: draft.script,
      voiceId: draft.workflowVoice,
      motion: draft.motion,
      cinema: draft.cinema,
    },
  });

  async function submit(event?: FormEvent, retry?: Generation) {
    event?.preventDefault();
    setError("");
    if (app === "audio" && draft.audioMode === "voice" && !retry) return speak();
    setSubmitting(true);
    try {
      const body = retry ? { tab: retry.tab, model: retry.model, prompt: retry.prompt, settings: retry.settings } : payload();
      const data = await readJson(
        await fetch("/api/studio/generations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
        "Could not start the generation",
      );
      onCreated(data.generation);
      setStageView("history");
      if (app === "vibe-motion" && draft.baseFile) patch({ baseFile: undefined, prompt: "" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the generation");
    } finally {
      setSubmitting(false);
    }
  }

  async function speak() {
    const voice = voices.find((v) => v.id === draft.voiceId);
    if (!voice) return setError("Add a voice in Text to Speech first, then pick it here.");
    setSubmitting(true);
    try {
      const data = await readJson(
        await fetch("/api/voicebox/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ profileId: voice.id, text: draft.prompt }) }),
        "Speech generation failed",
      );
      setVoiceClips((current) => [{ id: String(data.generation?.id || Date.now()), voice: voice.name, text: draft.prompt, audioUrl: data.audioUrl, createdAt: new Date().toISOString() }, ...current]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Speech generation failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function stop(item: Generation) {
    await fetch(`/api/studio/generations/${encodeURIComponent(item.id)}/stop`, { method: "POST" }).catch(() => undefined);
    onRefresh();
  }
  async function remove(item: Generation) {
    if (!window.confirm("Delete this generation and its files?")) return;
    onRemoved(item.id);
    await fetch(`/api/studio/generations/${encodeURIComponent(item.id)}`, { method: "DELETE" }).catch(() => undefined);
  }
  function reuse(item: Generation) {
    const s = item.settings || {};
    patch({
      prompt: item.prompt,
      ...(item.model ? { model: item.model } : {}),
      ...Object.fromEntries(["operation", "scene", "persona", "adStyle", "product", "style", "clipLength", "workflow", "script", "motion", "cinema"].filter((k) => s[k] !== undefined).map((k) => [k, s[k]])),
    }, item.tab as AppId);
  }
  async function voiceToLipSync(clip: { voice: string; audioUrl: string }) {
    try {
      const blob = await (await fetch(clip.audioUrl)).blob();
      onSend("lipsync", "audioFile", await uploadAsset(blob.type ? blob : new Blob([blob], { type: "audio/wav" }), `${clip.voice} voice`));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send the voice to Lip Sync");
    }
  }

  const galleryHandlers: GalleryHandlers = {
    modelName: (item) => modelName(catalog, item),
    onStop: (item) => void stop(item),
    onRetry: (item) => void submit(undefined, item),
    onReuse: reuse,
    onDelete: (item) => void remove(item),
    onSend,
    onRevise: (file) => patch({ baseFile: file, prompt: "" }),
  };
  const promptRequired = ["image", "cinema", "audio", "vibe-motion", "workflows"].includes(app) || (app === "video" && draft.videoTab === "text");
  const ready = (() => {
    if (submitting) return false;
    if (usesModel && !model) return false;
    if (app === "audio") return Boolean(draft.prompt.trim() && (draft.audioMode === "voice" ? draft.voiceId : catalog?.music.available));
    if (app === "image" && (draft.references || []).length) return true;
    if (promptRequired && !draft.prompt.trim()) return false;
    if (app === "layers") return Boolean(draft.image && (!NEEDS_DESCRIPTION.includes(draft.operation) || draft.prompt.trim()));
    if (app === "ai-influencer") return Boolean(draft.face);
    if (app === "video" && draft.videoTab === "upscale") return Boolean(draft.sourceVideo);
    if (app === "video" && draft.videoTab === "image") return Boolean(draft.firstFrame);
    if (app === "clipping") return draft.clipSource === "upload" ? Boolean(draft.sourceVideo) : /^https:\/\//.test(draft.sourceUrl.trim());
    if (app === "motion-control") return Boolean(draft.face && draft.sourceVideo);
    if (app === "body-swap") return Boolean(draft.face && draft.sourceVideo);
    if (app === "marketing") return Boolean(draft.firstFrame);
    if (app === "lipsync") return Boolean(draft.image && draft.audioFile);
    if (app === "workflows") {
      if (draft.workflow === "talking-avatar") return Boolean(draft.script.trim());
      if (draft.workflow === "product-ad") return Boolean(draft.firstFrame);
    }
    return true;
  })();
  const maxRefs = model && "maxReferences" in model ? model.maxReferences - (app === "layers" || app === "ai-influencer" ? 1 : 0) : 0;
  const actionLabel = app === "audio" && draft.audioMode === "voice" ? "Speak" : app === "vibe-motion" && draft.baseFile ? "Revise" : meta.action;
  const placeholder = app === "audio" && draft.audioMode === "voice"
    ? "Write what the voice should say"
    : app === "vibe-motion" && draft.baseFile
      ? "What should change? e.g. slower, add a subtitle line, swap to a blue palette"
      : app === "workflows" && draft.workflow === "talking-avatar"
        ? "Describe the presenter, e.g. friendly tech reviewer in a bright studio"
        : app === "workflows" && draft.workflow === "storyboard"
          ? "The story idea, e.g. a lost robot finds its way home through a city"
          : meta.placeholder;
  const showAspect = model && model.aspectRatios.length > 0 && !(app === "layers" && draft.operation !== "expand");
  const showVideoControls = model && "durations" in model && model.durations.length > 0;

  const slots: ReactNode[] = [];
  const slot = (key: string, label: string, accept: string, field: string, compact = true) =>
    slots.push(<MediaSlot key={key} compact={compact} label={label} accept={accept} asset={draft[field]} onChange={(asset) => patch({ [field]: asset })} onError={setError} />);
  if (app === "layers") slot("image", "Image to edit", IMAGE_TYPES, "image");
  if (app === "ai-influencer") slot("face", "Face photo", IMAGE_TYPES, "face");
  if (app === "video" && draft.videoTab === "upscale") slot("src", "Video to upscale", VIDEO_TYPES, "sourceVideo");
  if (app === "video" && draft.videoTab === "image") {
    slot("first", "First frame", IMAGE_TYPES, "firstFrame");
    if (model && "frames" in model && model.frames.includes("last_frame")) slot("last", "Last frame", IMAGE_TYPES, "lastFrame");
  }
  if (app === "motion-control") {
    slot("face", "Character", IMAGE_TYPES, "face");
    slot("src", "Motion video", VIDEO_TYPES, "sourceVideo");
  }
  if (app === "body-swap") {
    slot("src", "Source video", VIDEO_TYPES, "sourceVideo");
    slot("face", "New person", IMAGE_TYPES, "face");
  }
  if (app === "marketing" || (app === "workflows" && draft.workflow === "product-ad")) slot("product", "Product photo", IMAGE_TYPES, "firstFrame");
  if (app === "lipsync") {
    slot("portrait", "Portrait", IMAGE_TYPES, "image");
    slot("voice", "Voice track", "audio/*", "audioFile");
  }
  if (app === "clipping" && draft.clipSource === "upload") slot("src", "Upload video", VIDEO_TYPES, "sourceVideo");

  const appTabs: { label: string; value: string; options: Array<{ value: string; label: string; icon?: ReactNode }>; onChange: (value: string) => void } | null =
    app === "layers"
      ? { label: "Edit type", value: draft.layerGroup, options: LAYER_GROUPS, onChange: (layerGroup) => patch({ layerGroup, operation: pickInGroup(LAYER_OPS, layerGroup, draft.operation) }) }
      : app === "ai-influencer"
        ? { label: "Scene type", value: draft.sceneGroup, options: SCENE_GROUPS, onChange: (sceneGroup) => patch({ sceneGroup, scene: pickInGroup(SCENES, sceneGroup, draft.scene) }) }
      : app === "marketing"
        ? { label: "Ad style group", value: draft.adGroup, options: AD_GROUPS, onChange: (adGroup) => patch({ adGroup, adStyle: pickInGroup(AD_STYLES, adGroup, draft.adStyle) }) }
      : app === "video"
        ? { label: "Video mode", value: draft.videoTab, options: [{ value: "text", label: "Text to video" }, { value: "image", label: "Image to video" }, { value: "upscale", label: "Upscale" }], onChange: (videoTab) => patch({ videoTab, model: "" }) }
        : app === "audio"
          ? { label: "Audio type", value: draft.audioMode, options: [{ value: "music", label: "Music", icon: <Music className="h-3.5 w-3.5" /> }, { value: "voice", label: "Voice", icon: <Mic className="h-3.5 w-3.5" /> }], onChange: (audioMode) => patch({ audioMode }) }
          : app === "clipping"
            ? { label: "Source", value: draft.clipSource, options: [{ value: "link", label: "From a link" }, { value: "upload", label: "Upload a video" }], onChange: (clipSource) => patch({ clipSource }) }
            : app === "workflows"
              ? { label: "Workflow", value: draft.workflow, options: (catalog?.workflows || []).map((w) => ({ value: w.id, label: w.name, icon: WORKFLOW_ART[w.id] })), onChange: (workflow) => patch({ workflow }) }
              : null;

  const voiceMode = app === "audio" && draft.audioMode === "voice";
  const historyCount = voiceMode ? voiceClips.length : visible.length;
  const showHistory = stageView === "history" && historyCount > 0;
  const tabs = (
    <>
        {appTabs && appTabs.options.length ? (
          <div className="cs-app-tabs">
            <Tabs label={appTabs.label} value={appTabs.value} options={appTabs.options} onChange={appTabs.onChange} />
          </div>
        ) : null}
    </>
  );
  const fields = (
    <>
        {app === "cinema" ? <CinemaRig value={draft.cinema} onChange={(cinema) => patch({ cinema })} /> : null}
        {app === "layers" ? <OptionCards label="Edit" options={LAYER_OPS.filter((op) => op.group === draft.layerGroup)} value={draft.operation} onChange={(operation) => patch({ operation })} /> : null}
        {app === "ai-influencer" ? <OptionCards label="Scene" options={SCENES.filter((scene) => scene.group === draft.sceneGroup)} value={draft.scene} onChange={(scene) => patch({ scene })} /> : null}
        {app === "marketing" || (app === "workflows" && draft.workflow === "product-ad") ? (
          <>
            {app === "workflows" ? <Tabs compact label="Ad style group" value={draft.adGroup} options={AD_GROUPS} onChange={(adGroup) => patch({ adGroup, adStyle: pickInGroup(AD_STYLES, adGroup, draft.adStyle) })} /> : null}
            <OptionCards label="Ad style" options={AD_STYLES.filter((style) => style.group === draft.adGroup)} value={draft.adStyle} onChange={(adStyle) => patch({ adStyle })} />
          </>
        ) : null}
        {app === "workflows" ? (
          <ol className="cs-flow-line" aria-label="Steps">
            {(catalog?.workflows.find((w) => w.id === draft.workflow)?.steps || []).map((step, index) => (
              <li key={step}><span>{index + 1}</span>{step}</li>
            ))}
          </ol>
        ) : null}
        {app === "vibe-motion" && draft.baseFile ? (
          <p className="cs-revising"><PenLine className="h-3.5 w-3.5" />Revising a motion graphic<button type="button" className="cs-link" onClick={() => patch({ baseFile: undefined })}>Start new</button></p>
        ) : null}
        {app === "clipping" && draft.clipSource === "link" ? (
          <input className="cs-input" type="url" inputMode="url" value={draft.sourceUrl} onChange={(event) => patch({ sourceUrl: event.target.value })} placeholder="Paste a YouTube, TikTok, or other video link" aria-label="Video link" />
        ) : null}
        {app === "ai-influencer" ? (
          <input className="cs-input" value={draft.persona} onChange={(event) => patch({ persona: event.target.value })} maxLength={400} placeholder="Persona, e.g. 24-year-old fitness coach, upbeat, sporty style" aria-label="Persona" />
        ) : null}
        {app === "marketing" || (app === "workflows" && draft.workflow === "product-ad") ? (
          <input className="cs-input" value={draft.product} onChange={(event) => patch({ product: event.target.value })} maxLength={120} placeholder="Product name, e.g. Aurora wireless earbuds" aria-label="Product name" />
        ) : null}

        <div className="cs-prompt-row">
          {slots.length ? <div className="cs-frames">{slots}</div> : null}
          {(app === "image" || app === "cinema" || app === "ai-influencer") && maxRefs > 0 ? (
            <ReferenceTray assets={draft.references || []} max={maxRefs} onChange={(references) => patch({ references })} onError={setError} />
          ) : null}
          <textarea
            className="cs-textarea"
            value={draft.prompt}
            onChange={(event) => patch({ prompt: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && ready) void submit();
            }}
            rows={2}
            maxLength={4000}
            placeholder={placeholder}
            aria-label="Prompt"
          />
        </div>
        {app === "workflows" && draft.workflow === "talking-avatar" ? (
          <textarea className="cs-textarea cs-lyrics" value={draft.script} onChange={(event) => patch({ script: event.target.value })} rows={3} maxLength={3000} placeholder="Script the presenter will speak" aria-label="Script" />
        ) : null}
        {app === "workflows" && draft.workflow === "image-to-video" ? (
          <input className="cs-input" value={draft.motion} onChange={(event) => patch({ motion: event.target.value })} maxLength={400} placeholder="Motion, e.g. slow push in, hair moving in the wind" aria-label="Motion" />
        ) : null}
        {app === "audio" && draft.audioMode === "music" && !draft.instrumental ? (
          <textarea className="cs-textarea cs-lyrics" value={draft.lyrics} onChange={(event) => patch({ lyrics: event.target.value })} rows={3} maxLength={3000} placeholder="Lyrics (optional)" aria-label="Lyrics" />
        ) : null}
    </>
  );
  const chips = (
          <div className="cs-chips">
            {usesModel ? <ModelPicker models={models} value={draft.model} onChange={(id) => patch({ model: id })} loading={catalogLoading} /> : null}
            {app === "audio" && draft.audioMode === "music" ? (
              <>
                <span className="cs-chip cs-chip-static"><Music className="h-3.5 w-3.5" />{catalog?.music.name || "Music"}</span>
                <Toggle label="Instrumental" value={draft.instrumental} onChange={(instrumental) => patch({ instrumental })} />
              </>
            ) : null}
            {app === "audio" && draft.audioMode === "voice" ? <Choice label="Voice" value={draft.voiceId} options={voices.map((v) => ({ value: v.id, label: v.name }))} onChange={(voiceId) => patch({ voiceId })} empty="No voices yet" /> : null}
            {app === "workflows" && draft.workflow === "talking-avatar" ? (
              <Choice label="Voice" value={draft.workflowVoice || catalog?.voices[0]?.id || ""} options={(catalog?.voices || []).map((v) => ({ value: v.id, label: v.name }))} onChange={(workflowVoice) => patch({ workflowVoice })} empty="No voices" />
            ) : null}
            {app === "workflows" && draft.workflow === "storyboard" ? <Choice label="Shots" value={String(draft.count)} options={[3, 4, 5, 6].map((n) => ({ value: String(n), label: String(n) }))} onChange={(count) => patch({ count: Number(count) })} /> : null}
            {app === "workflows" || app === "vibe-motion" ? <Choice label="Aspect" value={draft.aspectRatio} options={["16:9", "9:16", "1:1"].map((a) => ({ value: a, label: a }))} onChange={(aspectRatio) => patch({ aspectRatio })} /> : null}
            {app === "vibe-motion" ? <Choice label="Length" value={String(draft.duration)} options={[5, 8, 12, 20].map((d) => ({ value: String(d), label: `${d}s` }))} onChange={(duration) => patch({ duration: Number(duration) })} /> : null}
            {app === "clipping" ? (
              <>
                <Choice label="Clips" value={String(draft.count)} options={[1, 2, 3, 4, 5, 6].map((n) => ({ value: String(n), label: String(n) }))} onChange={(count) => patch({ count: Number(count) })} />
                <Choice label="Length" value={draft.clipLength} options={[{ value: "short", label: "15–35s" }, { value: "medium", label: "30–60s" }, { value: "long", label: "45–90s" }]} onChange={(clipLength) => patch({ clipLength })} />
                <Toggle label="Vertical 9:16" value={draft.vertical} onChange={(vertical) => patch({ vertical })} />
              </>
            ) : null}
            {showAspect ? <Choice label="Aspect" value={draft.aspectRatio} options={model.aspectRatios.filter((a) => a !== "auto").map((a) => ({ value: a, label: a }))} onChange={(aspectRatio) => patch({ aspectRatio })} /> : null}
            {model && model.resolutions.length > 1 && !(app === "layers" && draft.operation === "upscale") ? <Choice label="Resolution" value={draft.resolution} options={model.resolutions.map((r) => ({ value: r, label: r }))} onChange={(resolution) => patch({ resolution })} /> : null}
            {model && "qualities" in model && model.qualities.length ? <Choice label="Quality" value={draft.quality} options={model.qualities.map((q) => ({ value: q, label: q[0].toUpperCase() + q.slice(1) }))} onChange={(quality) => patch({ quality })} /> : null}
            {model && "maxImages" in model && model.maxImages > 1 && app !== "layers" ? <Choice label="Images" value={String(draft.count)} options={Array.from({ length: model.maxImages }, (_, n) => ({ value: String(n + 1), label: String(n + 1) }))} onChange={(count) => patch({ count: Number(count) })} /> : null}
            {showVideoControls ? <Choice label="Length" value={String(draft.duration)} options={(model as any).durations.map((d: number) => ({ value: String(d), label: `${d}s` }))} onChange={(duration) => patch({ duration: Number(duration) })} /> : null}
            {model && "audio" in model && model.audio ? <Toggle label="Sound" value={draft.audio} onChange={(audio) => patch({ audio })} /> : null}
            {app === "video" && draft.videoTab === "upscale" ? <Choice label="Scale" value={String(draft.upscaleFactor)} options={[{ value: "1.5", label: "1.5×" }, { value: "2", label: "2×" }, { value: "3", label: "3×" }]} onChange={(upscaleFactor) => patch({ upscaleFactor: Number(upscaleFactor) })} /> : null}
            {showVideoControls && model && "pricePerSecond" in model && model.pricePerSecond ? (
              <span className="cs-cost" title="Approximate provider price">≈ ${(model.pricePerSecond * draft.duration).toFixed(2)}</span>
            ) : null}
          </div>
  );
  const errors = (
    <>
        {app === "audio" && draft.audioMode === "music" && catalog && !catalog.music.available ? <p className="cs-error">{catalog.music.reason}</p> : null}
    </>
  );
  const submitButton = (
    <button type="submit" className="cs-submit" disabled={!ready}>
      {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
      {actionLabel}
    </button>
  );
  const banners = (
    <>
          {catalog && !catalog.configured ? <p className="cs-banner" role="alert"><AlertCircle className="h-4 w-4" />Generation isn't set up on this server yet. An admin needs to add the AI provider key.</p> : null}
          {usesModel && catalog && !models.length ? <p className="cs-banner" role="status"><AlertCircle className="h-4 w-4" />No models for {meta.label} are available from the provider right now.</p> : null}
    </>
  );
  const gallery = voiceMode ? (
              <StudioGallery
                items={[]}
                now={now}
                handlers={galleryHandlers}
                extraAudio={voiceClips.map((clip) => ({ id: clip.id, title: clip.text.slice(0, 90), meta: `${clip.voice} · ${timeAgo(clip.createdAt, now)}`, url: clip.audioUrl, onLipSync: () => void voiceToLipSync(clip) }))}
              />
  ) : (
    <StudioGallery items={visible} now={now} handlers={galleryHandlers} />
  );

  // Image, Video, and Audio keep their original layout: results above, a composer bar below.
  if (!PANEL_APPS.includes(app)) {
    return (
      <>
        {tabs}
        <div className="cs-canvas">
          {banners}
          {historyCount ? gallery : voiceMode ? (
            <Empty icon={<Mic className="h-5 w-5" />} heading="Turn text into speech" body="Pick one of your voices, write the line, and generate. Send any clip to Lip Sync to make a portrait speak it." />
          ) : app !== "workflows" ? (
            <Empty icon={meta.icon} heading={meta.heading} body={meta.body} />
          ) : null}
        </div>
        <form className="cs-composer" onSubmit={(event) => void submit(event)}>
          {fields}
          <div className="cs-controls">
            {chips}
            {submitButton}
          </div>
          {errors}
        </form>
        {lightbox ? <Lightbox src={lightbox} onClose={() => setLightbox(null)} /> : null}
      </>
    );
  }

  return (
    // Higgsfield-style generation page: a fixed control column on the left,
    // the results stage on the right.
    <div className="cs-gen">
      <form className="cs-panel" onSubmit={(event) => void submit(event)} aria-label={`${meta.label} settings`}>
        <div className="cs-panel-scroll">
          {tabs}
          {fields}
          <div className="cs-controls">{chips}</div>
          {errors}
        </div>
        <div className="cs-panel-foot">{submitButton}</div>
      </form>

      <section className="cs-stage" aria-label={`${meta.label} results`}>
        <div className="cs-stage-bar" role="tablist" aria-label="View">
          <button type="button" role="tab" aria-selected={showHistory} disabled={!historyCount} onClick={() => setStageView("history")}>
            <History className="h-4 w-4" />
            History
            {historyCount ? <span>{historyCount}</span> : null}
          </button>
          <button type="button" role="tab" aria-selected={!showHistory} onClick={() => setStageView("how")}>
            <BookOpen className="h-4 w-4" />
            How it works
          </button>
        </div>
        <div className="cs-canvas">
          {banners}
          {showHistory ? gallery : (
            <div className="cs-hero">
              <span className="cs-hero-mark">{voiceMode ? <Mic className="h-5 w-5" /> : meta.icon}</span>
              <h1>{meta.label}</h1>
              <p>{voiceMode ? "Pick one of your voices, write the line, and generate. Send any clip to Lip Sync to make a portrait speak it." : meta.body}</p>
              {historyCount ? (
                <button type="button" className="cs-hero-link" onClick={() => setStageView("history")}>
                  See your {historyCount} {historyCount === 1 ? "result" : "results"}
                </button>
              ) : null}
            </div>
          )}
        </div>
      </section>
      {lightbox ? <Lightbox src={lightbox} onClose={() => setLightbox(null)} /> : null}
    </div>
  );
}

function modelName(catalog: Catalog | null, item: Generation) {
  if (item.tab === "audio") return catalog?.music.name || "Music";
  if (item.tab === "workflows") return catalog?.workflows.find((w) => w.id === item.settings?.workflow)?.name || "Workflow";
  if (item.tab === "clipping") return "AI Clipping";
  if (item.tab === "vibe-motion") return "Vibe Motion";
  const all: AnyModel[] = [...(catalog?.image || []), ...(catalog?.video || []), ...(catalog?.avatar || []), ...(catalog?.edit || []), ...(catalog?.upscale || []), ...(catalog?.motion || [])];
  return all.find((m) => m.id === item.model)?.name || item.model.split("/").pop() || "Model";
}

function CinemaRig({ value, onChange }: { value: Draft["cinema"]; onChange: (value: Draft["cinema"]) => void }) {
  const [open, setOpen] = useState(false);
  const [part, setPart] = useState<"camera" | "lens" | "focal" | "aperture">("camera");
  return (
    <div className="cs-rig">
      <button type="button" className="cs-rig-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Camera className="h-4 w-4" />
        <span className="cs-rig-summary">{value.camera} · {value.lens} · {value.focalLength}mm · {value.aperture}</span>
        <ChevronDown className="cs-rig-chevron h-3.5 w-3.5" />
      </button>
      {open ? (
        <div className="cs-rig-panel">
          <Tabs
            compact
            label="Camera rig"
            value={part}
            onChange={(next) => setPart(next as typeof part)}
            options={[
              { value: "camera", label: "Camera", hint: value.camera },
              { value: "lens", label: "Lens", hint: value.lens },
              { value: "focal", label: "Focal length", hint: `${value.focalLength}mm` },
              { value: "aperture", label: "Aperture", hint: value.aperture },
            ]}
          />
          {part === "camera" ? <RigColumn title="Camera" items={CAMERAS} value={value.camera} onChange={(camera) => onChange({ ...value, camera })} image /> : null}
          {part === "lens" ? <RigColumn title="Lens" items={LENSES} value={value.lens} onChange={(lens) => onChange({ ...value, lens })} image /> : null}
          {part === "focal" ? <RigColumn title="Focal length" items={FOCAL_LENGTHS.map(String)} value={String(value.focalLength)} onChange={(focal) => onChange({ ...value, focalLength: Number(focal) })} suffix="mm" /> : null}
          {part === "aperture" ? <RigColumn title="Aperture" items={APERTURES} value={value.aperture} onChange={(aperture) => onChange({ ...value, aperture })} image /> : null}
        </div>
      ) : null}
    </div>
  );
}
function RigColumn({ title, items, value, onChange, image, suffix = "" }: { title: string; items: string[]; value: string; onChange: (value: string) => void; image?: boolean; suffix?: string }) {
  return (
    <fieldset className="cs-rig-col">
      <legend className="cs-sr-only">{title}</legend>
      <div className={image ? "cs-rig-options" : "cs-rig-options cs-rig-numbers"}>
        {items.map((item) => (
          <button key={item} type="button" aria-pressed={item === value} className="cs-rig-option" onClick={() => onChange(item)}>
            {image ? <img src={rigArt(item)} alt="" loading="lazy" /> : <span className="cs-rig-number">{item}<small>{suffix}</small></span>}
            {image ? <span className="cs-rig-name">{item}</span> : null}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
