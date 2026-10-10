// One composer + gallery that serves every generator app in Creator Studio.
import { VoicePicker } from "../VoicePicker";
import type { VoiceProfile } from "../../utils/voiceProfiles";
import { FormEvent, ReactNode, useEffect, useMemo, useState } from "react";
import {
  AudioLines,
  Clapperboard,
  Image as ImageIcon,
  Images,
  LayoutTemplate,
  Loader2,
  Mic,
  Music,
  PenLine,
  Type,
  Wand2,
} from "lucide-react";
import { type GalleryHandlers, StudioGallery } from "./StudioGallery";
import { TemplateGallery } from "../TemplateGallery";
import { AudioPlayer } from "../AudioPlayer";
import { fillTemplatePrompt, studioDraftFor, type TemplateOutput, type TemplatePrompt } from "../../utils/promptTemplates";
import { listPrompts } from "../../utils/promptLibrary";
import { Composer, LayoutCard, Masonry, SendButton, StudioLayout } from "../StudioLayout";
import { useErrorToast } from "../../utils/toast";
import { STUDIO_APPS, type StudioApp } from "./studioApps";
import { CREDIT_ESTIMATE_TITLE, creditEstimateLabel, fallbackCreditEstimate, providerCreditEstimate, useStudioPricing } from "./studioPricing";
import {
  type AnyModel,
  AspectPicker,
  type Asset,
  type Catalog,
  Choice,
  Empty,
  type Generation,
  GenerationUnavailable,
  IMAGE_TYPES,
  Lightbox,
  MediaSlot,
  ModelPicker,
  OptionCards,
  readJson,
  ReferenceTray,
  Segment,
  StudioNotice,
  Tabs,
  Toggle,
  VIDEO_TYPES,
  fit,
  timeAgo,
  uploadAsset,
  useDeleteGeneration,
} from "./studioShared";

type AppId = StudioApp["id"];
export type Draft = Record<string, any>;

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
const WORKFLOW_ART: Record<string, ReactNode> = {
  "image-to-video": <Clapperboard className="h-4 w-4" />,
  "talking-avatar": <Mic className="h-4 w-4" />,
  storyboard: <PenLine className="h-4 w-4" />,
  "product-ad": <Music className="h-4 w-4" />,
};

export const PREFERRED: Record<string, string[]> = {
  image: ["bytedance-seed/seedream-4.5", "google/gemini-3-pro-image"],
  cinema: ["google/gemini-3-pro-image", "bytedance-seed/seedream-4.5"],
  video: ["alibaba/wan-3.0", "bytedance/seedance-2.0-fast", "google/veo-3.1-fast"],
  upscale: ["black-forest-labs/flux-video-upscale"],
  avatar: ["heygen/avatar-iv"],
  motion: ["bytedance/seedance-2.0-fast"],
  edit: ["black-forest-labs/flux-video-edit"],
};

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
    cinema: { camera: "Full-Frame Cine Digital", lens: "Premium Modern Prime", focalLength: 35, aperture: "f/1.4" },
    videoTab: "text",
    frameMode: "text",
    clipSource: "link",
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
    clipFraming: "auto",
    clipAspect: "9:16",
    clipCaptions: false,
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
  if (app === "ai-influencer") return { key: "image", list: catalog.image.filter((m) => m.maxReferences > 0) };
  if (app === "video") {
    if (draft.videoTab === "upscale") return { key: "upscale", list: catalog.upscale };
    return { key: "video", list: catalog.video };
  }
  if (app === "marketing") return { key: "video", list: catalog.video.filter((m) => m.frames.includes("first_frame")) };
  if (app === "lipsync") return { key: "avatar", list: catalog.avatar };
  if (app === "motion-control") return { key: "motion", list: catalog.motion };
  if (app === "body-swap") return { key: "edit", list: catalog.edit };
  return { key: "", list: [] };
}

// Video Studio's composer inputs follow the model: every model takes text, and
// frame-capable ones add a start frame, or a start and an end frame.
type FrameMode = "text" | "first" | "first-last";
const FRAME_NEEDS: Record<FrameMode, string[]> = { text: [], first: ["first_frame"], "first-last": ["first_frame", "last_frame"] };
const supportsFrames = (m: AnyModel | undefined, mode: FrameMode) =>
  Boolean(m) && FRAME_NEEDS[mode].every((frame) => "frames" in m! && m!.frames.includes(frame));
const frameModesFor = (m: AnyModel | undefined) => (["text", "first", "first-last"] as FrameMode[]).filter((mode) => supportsFrames(m, mode));
const FRAME_MODE_OPTIONS: Record<FrameMode, { value: FrameMode; label: string; icon: ReactNode }> = {
  text: { value: "text", label: "Text", icon: <Type className="h-3.5 w-3.5" /> },
  first: { value: "first", label: "Start frame", icon: <ImageIcon className="h-3.5 w-3.5" /> },
  "first-last": { value: "first-last", label: "Start + end", icon: <Images className="h-3.5 w-3.5" /> },
};
const bestFrameMode = (m: AnyModel | undefined, wanted: FrameMode): FrameMode => {
  const modes = frameModesFor(m);
  return modes.includes(wanted) ? wanted : wanted === "first-last" && modes.includes("first") ? "first" : "text";
};

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
  routeGenerationId,
  onOpenGeneration,
  onCloseGeneration,
  autoSubmit = false,
  onAutoSubmitted,
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
  routeGenerationId?: string;
  onOpenGeneration?: (item: Generation) => void;
  onCloseGeneration?: () => void;
  /** Start the generation once the draft has been fitted to its model (a prompt sent from the Create page). */
  autoSubmit?: boolean;
  onAutoSubmitted?: () => void;
}) {
  const meta = STUDIO_APPS[app];
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  useErrorToast(error, () => setError(""));
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [templateTheme, setTemplateTheme] = useState<"light" | "dark">("light");
  const [voices, setVoices] = useState<Array<{ id: string; name: string }>>([]);
  const [voiceClips, setVoiceClips] = useState<Array<{ id: string; voice: string; text: string; audioUrl: string; createdAt: string }>>([]);
  const [audioRailTab, setAudioRailTab] = useState<"settings" | "history">("settings");
  const [section, setSection] = useState<"results" | "templates">("results");
  const pricing = useStudioPricing();
  const remove = useDeleteGeneration(onRemoved);
  const { key: modelKey, list: models } = useMemo(() => modelsFor(catalog, app, draft), [catalog, app, draft]);
  const model = models.find((m) => m.id === draft.model);
  const usesModel = Boolean(modelKey);
  const framed = app === "video" && draft.videoTab !== "upscale";
  const frameModes = framed ? frameModesFor(model) : [];
  const frameMode: FrameMode = framed ? bestFrameMode(model, draft.frameMode) : "text";
  const generationTab = app === "music" ? "audio" : app;
  const visible = useMemo(() => generations.filter((item) => item.tab === generationTab), [generations, generationTab]);

  useEffect(() => setError(""), [app]);

  // Pick a default model and keep every setting inside what the model supports.
  useEffect(() => {
    if (!models.length) return;
    const next: Draft = {};
    // Drafts saved before the model-driven composer used a separate image tab.
    const legacyImageTab = app === "video" && draft.videoTab === "image";
    if (legacyImageTab) next.videoTab = "text";
    const wanted: FrameMode = legacyImageTab ? "first" : framed ? draft.frameMode || "text" : "text";
    // Picking a model narrows the mode (see the picker); asking for a frame
    // mode, e.g. by sending an image here, swaps in a model that can do it.
    const fits = (m?: AnyModel) => supportsFrames(m, wanted);
    const preferred = (PREFERRED[modelKey] || []).map((id) => models.find((m) => m.id === id));
    const chosen = (fits(model) ? model : undefined) || preferred.find(fits) || models.find(fits) || model || preferred.find(Boolean) || models[0];
    if (chosen.id !== draft.model) next.model = chosen.id;
    if (framed) {
      const mode = bestFrameMode(chosen, wanted);
      if (mode !== draft.frameMode) next.frameMode = mode;
    }
    const aspect = fit(draft.aspectRatio, chosen.aspectRatios.filter((a) => a !== "auto"), app === "ai-influencer" ? ["4:5", "9:16"] : ["16:9", "9:16", "1:1"]);
    if (aspect && aspect !== draft.aspectRatio) next.aspectRatio = aspect;
    const resolution = fit(draft.resolution, chosen.resolutions, ["720p", "2K", "1K"]);
    if (resolution !== draft.resolution) next.resolution = resolution;
    if ("qualities" in chosen) {
      const quality = fit(draft.quality, chosen.qualities, ["high", "auto"]);
      if (quality !== draft.quality) next.quality = quality;
      if (draft.count > chosen.maxImages) next.count = chosen.maxImages;
      const room = Math.max(0, chosen.maxReferences - (app === "ai-influencer" ? 1 : 0));
      if ((draft.references || []).length > room) next.references = draft.references.slice(0, room);
    }
    if ("durations" in chosen && chosen.durations.length && !chosen.durations.includes(draft.duration)) next.duration = chosen.durations.includes(5) ? 5 : chosen.durations[0];
    if (Object.keys(next).length) patch(next);
  }, [models, model, modelKey, app, framed, draft, patch]);

  // Auto-start waits one render after the models load, so the fitting above has
  // already settled the aspect, resolution, and duration the request will use.
  const [autoStage, setAutoStage] = useState<"" | "fit" | "go" | "done">("");
  useEffect(() => {
    if (autoSubmit && !autoStage) setAutoStage("fit");
    if (!autoSubmit && autoStage === "done") setAutoStage("");
  }, [autoSubmit, autoStage]);
  useEffect(() => {
    if (!models.length || !draft.model || !draft.prompt) return;
    if (autoStage === "fit") setAutoStage("go");
    else if (autoStage === "go") {
      setAutoStage("done");
      onAutoSubmitted?.();
      void submit();
    }
  });

  useEffect(() => {
    if (app !== "music" || voices.length) return;
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
    tab: generationTab,
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
      firstFrame: app !== "video" || frameMode !== "text" ? draft.firstFrame?.file : undefined,
      lastFrame: frameMode === "first-last" ? draft.lastFrame?.file : undefined,
      image: draft.image?.file,
      face: draft.face?.file,
      audioFile: draft.audioFile?.file,
      sourceVideo: app === "clipping" && draft.clipSource === "link" ? undefined : draft.sourceVideo?.file,
      sourceUrl: app === "clipping" && draft.clipSource === "link" ? draft.sourceUrl : "",
      baseFile: draft.baseFile,
      upscaleFactor: draft.upscaleFactor,
      scene: draft.scene,
      persona: draft.persona,
      adStyle: draft.adStyle,
      product: draft.product,
      instrumental: draft.instrumental,
      lyrics: draft.instrumental ? "" : draft.lyrics,
      style: draft.style,
      clipLength: draft.clipLength,
      clipFraming: draft.clipFraming,
      clipAspect: draft.clipAspect,
      clipCaptions: draft.clipCaptions,
      vertical: app === "clipping" ? draft.clipAspect !== "16:9" : draft.vertical,
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

  function reuse(item: Generation) {
    const s = item.settings || {};
    patch({
      prompt: item.prompt,
      ...(item.model ? { model: item.model } : {}),
      ...Object.fromEntries(["operation", "scene", "persona", "adStyle", "product", "style", "clipLength", "clipFraming", "clipAspect", "clipCaptions", "workflow", "script", "motion", "cinema"].filter((k) => s[k] !== undefined).map((k) => [k, s[k]])),
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
    routeGenerationId,
    onOpenGeneration,
    onCloseGeneration,
  };
  const promptRequired = ["image", "cinema", "music", "vibe-motion", "workflows"].includes(app) || (framed && frameMode === "text");
  const ready = (() => {
    if (submitting) return false;
    if (usesModel && !model) return false;
    if (app === "music") return Boolean(draft.prompt.trim() && (draft.audioMode === "voice" ? draft.voiceId : catalog?.music.available));
    if (app === "image" && (draft.references || []).length) return true;
    if (promptRequired && !draft.prompt.trim()) return false;
    if (app === "ai-influencer") return Boolean(draft.face);
    if (app === "video" && draft.videoTab === "upscale") return Boolean(draft.sourceVideo);
    if (framed && frameMode !== "text") return Boolean(draft.firstFrame && (frameMode === "first" || draft.lastFrame));
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
  const maxRefs = model && "maxReferences" in model ? model.maxReferences - (app === "ai-influencer" ? 1 : 0) : 0;
  const actionLabel = app === "music" ? draft.audioMode === "voice" ? "Generate speech" : "Generate track" : app === "vibe-motion" && draft.baseFile ? "Revise" : meta.action;
  const placeholder = app === "music" && draft.audioMode === "voice"
    ? "Write what the voice should say"
    : app === "vibe-motion" && draft.baseFile
      ? "What should change? e.g. slower, add a subtitle line, swap to a blue palette"
      : app === "workflows" && draft.workflow === "talking-avatar"
        ? "Describe the presenter, e.g. friendly tech reviewer in a bright studio"
        : app === "workflows" && draft.workflow === "storyboard"
          ? "The story idea, e.g. a lost robot finds its way home through a city"
          : frameMode === "first"
            ? "Describe the motion from your start frame (optional), e.g. slow push in as she turns"
            : frameMode === "first-last"
              ? "Describe how the shot moves from start to end (optional)"
              : meta.placeholder;
  const showAspect = model && model.aspectRatios.length > 0;
  const showVideoControls = model && "durations" in model && model.durations.length > 0;
  const quotedUsd = showVideoControls && model && "pricePerSecond" in model && model.pricePerSecond
    ? model.pricePerSecond * draft.duration : null;
  const fallbackOperation = app === "music" ? draft.audioMode === "voice" ? "speech" : "music"
    : ["image", "ai-influencer"].includes(app) ? "image"
      : showVideoControls ? "video" : "";
  const estimatedCredits = providerCreditEstimate(quotedUsd, pricing)
    ?? (fallbackOperation && (model || app === "music") ? fallbackCreditEstimate(fallbackOperation, pricing, app === "image" ? Math.max(1, Number(draft.count) || 1) : 1) : null);

  const slots: ReactNode[] = [];
  const slot = (key: string, label: string, accept: string, field: string, compact = true) =>
    slots.push(<MediaSlot key={key} compact={compact} label={label} accept={accept} asset={draft[field]} onChange={(asset) => patch({ [field]: asset })} onError={setError} />);
  if (app === "ai-influencer") slot("face", "Face photo", IMAGE_TYPES, "face");
  if (app === "video" && draft.videoTab === "upscale") slot("src", "Video to upscale", VIDEO_TYPES, "sourceVideo");
  if (frameMode !== "text") slot("first", "Start frame", IMAGE_TYPES, "firstFrame");
  if (frameMode === "first-last") slot("last", "End frame", IMAGE_TYPES, "lastFrame");
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
    app === "ai-influencer"
        ? { label: "Scene type", value: draft.sceneGroup, options: SCENE_GROUPS, onChange: (sceneGroup) => patch({ sceneGroup, scene: pickInGroup(SCENES, sceneGroup, draft.scene) }) }
      : app === "marketing"
        ? { label: "Ad style group", value: draft.adGroup, options: AD_GROUPS, onChange: (adGroup) => patch({ adGroup, adStyle: pickInGroup(AD_STYLES, adGroup, draft.adStyle) }) }
      : app === "video"
        ? { label: "Video mode", value: draft.videoTab === "upscale" ? "upscale" : "text", options: [{ value: "text", label: "Generate" }, { value: "upscale", label: "Upscale" }], onChange: (videoTab) => patch({ videoTab, model: "" }) }
        : app === "music"
          ? { label: "Music mode", value: "music", options: [{ value: "music", label: "Music", icon: <Music className="h-3.5 w-3.5" /> }], onChange: () => undefined }
          : app === "clipping"
            ? { label: "Source", value: draft.clipSource, options: [{ value: "link", label: "From a link" }, { value: "upload", label: "Upload a video" }], onChange: (clipSource) => patch({ clipSource }) }
            : app === "workflows"
              ? { label: "Workflow", value: draft.workflow, options: (catalog?.workflows || []).map((w) => ({ value: w.id, label: w.name, icon: WORKFLOW_ART[w.id] })), onChange: (workflow) => patch({ workflow }) }
              : null;

  const voiceMode = app === "audio" && draft.audioMode === "voice";
  // Image, Video, and Audio (music) can start from a library template; the studio itself opens blank.
  const templateOutput: TemplateOutput | null =
    app === "image" ? "image" : app === "video" && draft.videoTab !== "upscale" ? "video" : app === "music" && !voiceMode ? "audio" : null;
  const historyCount = voiceMode ? voiceClips.length : visible.length;
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
          <input className="ui-input cs-input" type="url" inputMode="url" value={draft.sourceUrl} onChange={(event) => patch({ sourceUrl: event.target.value })} placeholder="Paste a YouTube, TikTok, or other video link" aria-label="Video link" />
        ) : null}
        {app === "ai-influencer" ? (
          <input className="ui-input cs-input" value={draft.persona} onChange={(event) => patch({ persona: event.target.value })} maxLength={400} placeholder="Persona, e.g. 24-year-old fitness coach, upbeat, sporty style" aria-label="Persona" />
        ) : null}
        {app === "marketing" || (app === "workflows" && draft.workflow === "product-ad") ? (
          <input className="ui-input cs-input" value={draft.product} onChange={(event) => patch({ product: event.target.value })} maxLength={120} placeholder="Product name, e.g. Aurora wireless earbuds" aria-label="Product name" />
        ) : null}

        {frameModes.length > 1 ? (
          <Segment
            label="Video input"
            value={frameMode}
            options={frameModes.map((mode) => FRAME_MODE_OPTIONS[mode])}
            onChange={(next) => patch({ frameMode: next })}
          />
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
            rows={draft.prompt.length > 400 ? 6 : 2}
            maxLength={4000}
            placeholder={placeholder}
            aria-label="Prompt"
          />
        </div>
        {app === "workflows" && draft.workflow === "talking-avatar" ? (
          <textarea className="ui-textarea cs-lyrics" value={draft.script} onChange={(event) => patch({ script: event.target.value })} rows={3} maxLength={3000} placeholder="Script the presenter will speak" aria-label="Script" />
        ) : null}
        {app === "workflows" && draft.workflow === "image-to-video" ? (
          <input className="ui-input cs-input" value={draft.motion} onChange={(event) => patch({ motion: event.target.value })} maxLength={400} placeholder="Motion, e.g. slow push in, hair moving in the wind" aria-label="Motion" />
        ) : null}
        {app === "music" && draft.audioMode === "music" && !draft.instrumental ? (
          <textarea className="ui-textarea cs-lyrics" value={draft.lyrics} onChange={(event) => patch({ lyrics: event.target.value })} rows={3} maxLength={3000} placeholder="Lyrics (optional)" aria-label="Lyrics" />
        ) : null}
    </>
  );
  const chips = (
          <div className="cs-chips">
            {/* Templates live in the Templates tab under the box. */}
            {usesModel ? (
              <ModelPicker
                models={models}
                value={draft.model}
                onChange={(id) => patch({ model: id, ...(framed ? { frameMode: bestFrameMode(models.find((m) => m.id === id), frameMode) } : {}) })}
                loading={catalogLoading}
                pricing={pricing}
              />
            ) : null}
            {app === "music" && draft.audioMode === "music" ? (
              <>
                <span className="ui-chip cs-chip cs-chip-static"><Music className="h-3.5 w-3.5" />{catalog?.music.name || "Music"}</span>
                <Toggle label="Instrumental" value={draft.instrumental} onChange={(instrumental) => patch({ instrumental })} />
              </>
            ) : null}
            {app === "music" && draft.audioMode === "voice" ? <VoicePicker chip voices={voices as VoiceProfile[]} value={draft.voiceId} onChange={(voiceId) => patch({ voiceId })} /> : null}
            {app === "workflows" && draft.workflow === "talking-avatar" ? (
              <Choice label="Voice" value={draft.workflowVoice || catalog?.voices[0]?.id || ""} options={(catalog?.voices || []).map((v) => ({ value: v.id, label: v.name }))} onChange={(workflowVoice) => patch({ workflowVoice })} empty="No voices" />
            ) : null}
            {app === "workflows" && draft.workflow === "storyboard" ? <Choice label="Shots" value={String(draft.count)} options={[3, 4, 5, 6].map((n) => ({ value: String(n), label: String(n) }))} onChange={(count) => patch({ count: Number(count) })} /> : null}
            {app === "workflows" || app === "vibe-motion" ? <AspectPicker variant="chip" label="Aspect" value={draft.aspectRatio} options={["16:9", "9:16", "1:1"]} onChange={(aspectRatio) => patch({ aspectRatio })} /> : null}
            {app === "vibe-motion" ? <Choice label="Length" value={String(draft.duration)} options={[5, 8, 12, 20].map((d) => ({ value: String(d), label: `${d}s` }))} onChange={(duration) => patch({ duration: Number(duration) })} /> : null}
            {app === "clipping" ? (
              <>
                <Choice label="Clips" value={String(draft.count)} options={[1, 2, 3, 4, 5, 6].map((n) => ({ value: String(n), label: String(n) }))} onChange={(count) => patch({ count: Number(count) })} />
                <Choice label="Length" value={draft.clipLength} options={[{ value: "short", label: "15–35s" }, { value: "medium", label: "30–60s" }, { value: "long", label: "45–90s" }]} onChange={(clipLength) => patch({ clipLength })} />
                <Choice label="Aspect" value={draft.clipAspect} options={[{ value: "9:16", label: "9:16" }, { value: "1:1", label: "1:1" }, { value: "16:9", label: "16:9 (original)" }]} onChange={(clipAspect) => patch({ clipAspect })} />
                {draft.clipAspect !== "16:9" ? <Choice label="Framing" value={draft.clipFraming} options={[{ value: "auto", label: "AI reframe" }, { value: "crop", label: "Fill" }, { value: "blur", label: "Blurred fill" }, { value: "fit", label: "Fit" }]} onChange={(clipFraming) => patch({ clipFraming })} /> : null}
                <Toggle label="Burn captions" value={draft.clipCaptions} onChange={(clipCaptions) => patch({ clipCaptions })} />
              </>
            ) : null}
            {showAspect ? <AspectPicker variant="chip" label="Aspect" value={draft.aspectRatio} options={model.aspectRatios.filter((a) => a !== "auto")} onChange={(aspectRatio) => patch({ aspectRatio })} /> : null}
            {model && model.resolutions.length > 1 ? <Choice label="Resolution" value={draft.resolution} options={model.resolutions.map((r) => ({ value: r, label: r }))} onChange={(resolution) => patch({ resolution })} /> : null}
            {model && "qualities" in model && model.qualities.length ? <Choice label="Quality" value={draft.quality} options={model.qualities.map((q) => ({ value: q, label: q[0].toUpperCase() + q.slice(1) }))} onChange={(quality) => patch({ quality })} /> : null}
            {model && "maxImages" in model && model.maxImages > 1 ? <Choice label="Images" value={String(draft.count)} options={Array.from({ length: model.maxImages }, (_, n) => ({ value: String(n + 1), label: String(n + 1) }))} onChange={(count) => patch({ count: Number(count) })} /> : null}
            {showVideoControls ? <Choice label="Length" value={String(draft.duration)} options={(model as any).durations.map((d: number) => ({ value: String(d), label: `${d}s` }))} onChange={(duration) => patch({ duration: Number(duration) })} /> : null}
            {model && "audio" in model && model.audio ? <Toggle label="Sound" value={draft.audio} onChange={(audio) => patch({ audio })} /> : null}
            {app === "video" && draft.videoTab === "upscale" ? <Choice label="Scale" value={String(draft.upscaleFactor)} options={[{ value: "1.5", label: "1.5×" }, { value: "2", label: "2×" }, { value: "3", label: "3×" }]} onChange={(upscaleFactor) => patch({ upscaleFactor: Number(upscaleFactor) })} /> : null}
            {estimatedCredits !== null ? (
              <span className="cs-cost" title={CREDIT_ESTIMATE_TITLE}>{creditEstimateLabel(estimatedCredits)}</span>
            ) : null}
          </div>
  );
  const errors = (
    <>
        {app === "music" && draft.audioMode === "music" && catalog && !catalog.music.available ? <StudioNotice>{catalog.music.reason}</StudioNotice> : null}
    </>
  );
  const submitButton = (
    <button type="submit" className="ui-btn is-primary cs-submit" disabled={!ready}>
      {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
      {actionLabel}
    </button>
  );
  const banners = (
    <>
          {catalog && !catalog.configured ? <GenerationUnavailable /> : null}
          {usesModel && catalog && catalog.configured && !models.length ? <StudioNotice>No models for {meta.label} are available right now.</StudioNotice> : null}
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

  const overlays = (
    <>
      {lightbox ? <Lightbox src={lightbox} onClose={() => setLightbox(null)} /> : null}
      {templatesOpen && templateOutput ? (
        <TemplateGallery
          output={templateOutput}
          theme={templateTheme}
          onClose={() => setTemplatesOpen(false)}
          onUse={(prompt) => {
            patch(studioDraftFor(templateOutput, prompt));
            setTemplatesOpen(false);
          }}
        />
      ) : null}
    </>
  );

  if (app === "audio") {
    const audioHistory = visible.flatMap((item) => (item.outputs || [])
      .filter((output) => output.type.startsWith("audio"))
      .map((output) => ({ id: `${item.id}:${output.file}`, title: output.title || item.prompt || "Generated audio", meta: `${catalog?.music.name || "Music"} · ${timeAgo(item.createdAt, now)}`, url: output.url })));
    const voiceHistory = voiceClips.map((clip) => ({ id: clip.id, title: clip.text || "Voice generation", meta: `${clip.voice} · ${timeAgo(clip.createdAt, now)}`, url: clip.audioUrl }));
    const recentAudio = [...voiceHistory, ...audioHistory];
    const latestVoice = voiceClips[0];
    const voiceEditor = (
      <div className="cs-voice-editor">
        <div className="cs-voice-editor-head">
          <span className="cs-voice-count">{draft.prompt.length.toLocaleString()} / 4,000</span>
        </div>
        <textarea
          className="cs-voice-textarea"
          value={draft.prompt}
          onChange={(event) => patch({ prompt: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && ready) void submit();
          }}
          maxLength={4000}
          placeholder="Start typing or paste your script here..."
          aria-label="Voice script"
        />
      </div>
    );
    return (
      <>
        <div className={`cs-audio-workspace${voiceMode ? " is-voice" : " is-music"}`}>
          <main className="cs-audio-main">
            <header className="cs-audio-header">
              <div className="cs-audio-title">
                <span className="cs-audio-mark"><AudioLines className="h-5 w-5" /></span>
                <div><h1>{voiceMode ? "Text to Speech" : "Audio Studio"}</h1><p>{voiceMode ? "Create a natural voiceover from your script." : "Shape an original track around your idea."}</p></div>
              </div>
              {tabs}
            </header>
            <section className="cs-audio-feed" aria-label="Audio results">
              {banners}
              {voiceMode ? voiceEditor : historyCount ? gallery : (
                <div className="cs-audio-welcome">
                  <span className="cs-audio-welcome-icon">{voiceMode ? <Mic className="h-5 w-5" /> : <Music className="h-5 w-5" />}</span>
                  <h2>{voiceMode ? "Your next voiceover starts here" : "What should this sound like?"}</h2>
                  <p>{voiceMode ? "Choose a voice, write or paste your script, then generate a preview." : "Describe the mood, instruments, tempo, or moment you want the music to capture."}</p>
                </div>
              )}
              {voiceMode && historyCount ? <div className="cs-voice-history">{gallery}</div> : null}
            </section>
            {voiceMode && latestVoice ? (
              <div className="cs-voice-player">
                <AudioPlayer src={latestVoice.audioUrl} title="Latest voiceover" meta={`${latestVoice.voice} · Just now`} download />
              </div>
            ) : null}
            <form className={`cs-audio-composer${voiceMode ? " is-voice" : ""}`} onSubmit={(event) => void submit(event)}>
              {!voiceMode ? <div className="cs-audio-fields">{fields}</div> : null}
              <footer className="cs-audio-composer-foot">
                <div className="cs-audio-composer-tools">
                  {!voiceMode && templateOutput ? (
                    <button type="button" className="cs-audio-template-button" onClick={(event) => {
                      setTemplateTheme((event.currentTarget.closest(".cstudio") as HTMLElement | null)?.dataset.theme === "dark" ? "dark" : "light");
                      setTemplatesOpen(true);
                    }}><LayoutTemplate className="h-4 w-4" /> Browse templates</button>
                  ) : null}
                  {estimatedCredits !== null ? <span className="cs-cost" title={CREDIT_ESTIMATE_TITLE}>{creditEstimateLabel(estimatedCredits)}</span> : null}
                </div>
                {submitButton}
              </footer>
              {errors}
            </form>
          </main>
          <aside className="cs-audio-rail" aria-label="Audio controls">
            <Tabs label="Audio panel" value={audioRailTab} onChange={(next) => setAudioRailTab(next as "settings" | "history")} options={[{ value: "settings", label: "Settings" }, { value: "history", label: "History", hint: recentAudio.length ? String(recentAudio.length) : undefined }]} />
            {audioRailTab === "settings" ? (
              <div className="cs-audio-settings" role="tabpanel">
                <div className="cs-audio-setting-heading"><span>Generation</span><span>{voiceMode ? "VOICE" : "MUSIC"}</span></div>
                {chips}
                {voiceMode && !voices.length ? <p className="cs-audio-no-voices">No voice profiles yet. Add one in Voice Studio to get started.</p> : null}
              </div>
            ) : (
              <div className="cs-audio-history" role="tabpanel">
                {recentAudio.length ? recentAudio.map((item) => (
                  <article className="cs-audio-history-item" key={item.id}>
                    <div className="cs-audio-history-copy"><strong>{item.title}</strong><span>{item.meta}</span></div>
                    <AudioPlayer src={item.url} title="" compact />
                  </article>
                )) : <div className="cs-audio-history-empty"><AudioLines className="h-5 w-5" /><strong>No audio yet</strong><span>Your generated tracks and voice previews will appear here.</span></div>}
              </div>
            )}
          </aside>
        </div>
        {overlays}
      </>
    );
  }

  // Every studio uses the Create page layout: title, mode tabs, the chat box with
  // its inputs and settings, then the results and templates as tabs below.
  const empty = voiceMode ? (
    <Empty icon={<Mic className="h-5 w-5" />} heading="Turn text into speech" body="Pick one of your voices, write the line, and generate. Send any clip to Lip Sync to make a portrait speak it." />
  ) : app !== "workflows" ? (
    <Empty icon={meta.icon} heading={meta.heading} body={meta.body} />
  ) : null;
  const shownSection = section === "templates" && templateOutput ? "templates" : "results";
  return (
    <>
      <StudioLayout
        title={meta.label}
        intro={meta.summary}
        above={appTabs && appTabs.options.length ? tabs : null}
        composer={
          <Composer
            as="form"
            onSubmit={(event) => void submit(event)}
            className="cs-studio-box"
            controls={chips}
            send={<SendButton type="submit" disabled={!ready} busy={submitting} label={actionLabel} />}
          >
            {fields}
            {errors}
          </Composer>
        }
        notices={banners}
        tabsLabel={`${meta.label} sections`}
        tabs={[
          { value: "results", label: "Your creations", hint: historyCount ? String(historyCount) : undefined },
          ...(templateOutput ? [{ value: "templates" as const, label: "Templates" }] : []),
        ]}
        tab={shownSection}
        onTab={(next) => setSection(next as "results" | "templates")}
      >
        {shownSection === "templates" && templateOutput ? (
          <LibraryTemplates
            output={templateOutput}
            onUse={(prompt) => {
              patch(studioDraftFor(templateOutput, prompt));
              setSection("results");
              (document.querySelector(".cs-studio-box textarea") as HTMLTextAreaElement | null)?.focus();
            }}
            onBrowseAll={(theme) => {
              setTemplateTheme(theme);
              setTemplatesOpen(true);
            }}
          />
        ) : historyCount ? gallery : empty}
      </StudioLayout>
      {overlays}
    </>
  );
}

// The Templates tab: the first page of prompt-library templates for this kind of
// output as cards. A card fills the prompt; Browse all opens the full gallery.
function LibraryTemplates({ output, onUse, onBrowseAll }: { output: TemplateOutput; onUse: (prompt: string) => void; onBrowseAll: (theme: "light" | "dark") => void }) {
  const [items, setItems] = useState<TemplatePrompt[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    listPrompts({ output, limit: 24 })
      .then((data) => active && setItems(data.items as TemplatePrompt[]))
      .catch(() => active && setFailed(true));
    return () => {
      active = false;
    };
  }, [output]);
  if (failed) return <Empty icon={<LayoutTemplate className="h-5 w-5" />} heading="Templates are unavailable right now" body="Try again in a moment." />;
  if (!items) return <p className="sl-loading"><Loader2 className="h-4 w-4 animate-spin" /> Loading templates</p>;
  return (
    <>
      <Masonry>
        {items.map((item) => (
          <LayoutCard
            key={item.id}
            title={item.title}
            sub={item.contributor ? `By ${item.contributor}` : item.summary}
            note={item.summary || item.snippet}
            image={item.image}
            video={item.image ? undefined : item.video}
            ratio={output === "video" ? 16 / 9 : 4 / 5}
            onClick={() => onUse(fillTemplatePrompt(item))}
          />
        ))}
      </Masonry>
      <div className="sl-more">
        <button type="button" className="sl-more-btn" onClick={(event) => onBrowseAll((event.currentTarget.closest(".cstudio") as HTMLElement | null)?.dataset.theme === "dark" ? "dark" : "light")}>
          <LayoutTemplate className="h-4 w-4" /> Browse all templates
        </button>
      </div>
    </>
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
