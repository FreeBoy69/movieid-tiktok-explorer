// One composer + gallery that serves every generator app in Creator Studio.
import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  AudioLines,
  Camera,
  Check,
  ChevronDown,
  Clapperboard,
  Download,
  Film,
  Loader2,
  Maximize2,
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
  Segment,
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
  { value: "remove-background", label: "Remove background" },
  { value: "decompose", label: "Split into layers" },
  { value: "extract-subject", label: "Extract subject" },
  { value: "background-plate", label: "Clean background" },
  { value: "expand", label: "Expand canvas" },
  { value: "upscale", label: "Upscale" },
  { value: "relight", label: "Relight" },
  { value: "restyle", label: "Restyle" },
  { value: "cleanup", label: "Remove objects" },
  { value: "edit", label: "Custom edit" },
];
const NEEDS_DESCRIPTION = ["relight", "restyle", "cleanup", "edit"];
const SCENES = [
  { value: "portrait", label: "Studio portrait" },
  { value: "cafe", label: "Café selfie" },
  { value: "gym", label: "Gym mirror" },
  { value: "travel", label: "Beach travel" },
  { value: "street", label: "City streetwear" },
  { value: "home", label: "Home vlog" },
  { value: "product", label: "Sponsored post" },
  { value: "night", label: "Night out" },
];
const AD_STYLES = [
  { value: "hero", label: "Studio hero" },
  { value: "lifestyle", label: "Lifestyle" },
  { value: "unboxing", label: "Unboxing" },
  { value: "promo", label: "Energetic promo" },
  { value: "luxury", label: "Luxury macro" },
  { value: "ugc", label: "UGC testimonial" },
];
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
    mode: "generate",
    operation: "remove-background",
    scene: "portrait",
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
  if (app === "video") return draft.mode === "upscale" ? { key: "upscale", list: catalog.upscale } : { key: "video", list: catalog.video };
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
  const [lightbox, setLightbox] = useState<string | null>(null);
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
      mode: draft.mode,
      aspectRatio: draft.aspectRatio,
      resolution: draft.resolution,
      quality: draft.quality,
      count: draft.count,
      duration: draft.duration,
      audio: draft.audio,
      references: (draft.references || []).map((ref: Asset) => ref.file),
      firstFrame: draft.firstFrame?.file,
      lastFrame: draft.lastFrame?.file,
      image: draft.image?.file,
      face: draft.face?.file,
      audioFile: draft.audioFile?.file,
      sourceVideo: draft.sourceVideo?.file,
      sourceUrl: draft.sourceVideo ? "" : draft.sourceUrl,
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

  const promptRequired = ["image", "cinema", "audio", "vibe-motion", "workflows"].includes(app) || (app === "video" && draft.mode !== "upscale" && !draft.firstFrame);
  const ready = (() => {
    if (submitting) return false;
    if (usesModel && !model) return false;
    if (app === "audio") return Boolean(draft.prompt.trim() && (draft.audioMode === "voice" ? draft.voiceId : catalog?.music.available));
    if (app === "image" && (draft.references || []).length) return true;
    if (promptRequired && !draft.prompt.trim()) return false;
    if (app === "layers") return Boolean(draft.image && (!NEEDS_DESCRIPTION.includes(draft.operation) || draft.prompt.trim()));
    if (app === "ai-influencer") return Boolean(draft.face);
    if (app === "video" && draft.mode === "upscale") return Boolean(draft.sourceVideo);
    if (app === "clipping") return Boolean(draft.sourceVideo || /^https:\/\//.test(draft.sourceUrl.trim()));
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
  if (app === "video" && draft.mode === "upscale") slot("src", "Video to upscale", VIDEO_TYPES, "sourceVideo");
  if (app === "video" && draft.mode !== "upscale") {
    if (!model || ("frames" in model && model.frames.includes("first_frame"))) slot("first", "First frame", IMAGE_TYPES, "firstFrame");
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
  if (app === "clipping") slot("src", "Upload video", VIDEO_TYPES, "sourceVideo");

  return (
    <>
      <div className="cs-canvas">
        {catalog && !catalog.configured ? <p className="cs-banner" role="alert"><AlertCircle className="h-4 w-4" />Generation isn't set up on this server yet. An admin needs to add the AI provider key.</p> : null}
        {usesModel && catalog && !models.length ? <p className="cs-banner" role="status"><AlertCircle className="h-4 w-4" />No models for {meta.label} are available from the provider right now.</p> : null}

        {app === "workflows" ? (
          <div className="cs-flows" role="radiogroup" aria-label="Workflow">
            {(catalog?.workflows || []).map((flow) => (
              <button key={flow.id} type="button" role="radio" aria-checked={draft.workflow === flow.id} className="cs-flow" onClick={() => patch({ workflow: flow.id })}>
                <span className="cs-flow-icon">{WORKFLOW_ART[flow.id]}</span>
                <span className="cs-flow-name">{flow.name}</span>
                <span className="cs-flow-steps">{flow.steps.join(" → ")}</span>
              </button>
            ))}
          </div>
        ) : null}

        {app === "audio" && draft.audioMode === "voice" ? (
          voiceClips.length ? (
            <div className="cs-grid">
              {voiceClips.map((clip) => (
                <article key={clip.id} className="cs-card">
                  <div className="cs-audio"><AudioLines className="h-5 w-5" /><audio controls src={clip.audioUrl} preload="metadata" /></div>
                  <p className="cs-prompt">{clip.text}</p>
                  <footer className="cs-card-foot">
                    <span className="cs-meta">{clip.voice} · {timeAgo(clip.createdAt, now)}</span>
                    <div className="cs-actions">
                      <IconButton label="Use in Lip Sync" onClick={() => void voiceToLipSync(clip)}><Mic className="h-3.5 w-3.5" /></IconButton>
                      <a className="cs-icon" href={clip.audioUrl} download aria-label="Download" title="Download"><Download className="h-3.5 w-3.5" /></a>
                    </div>
                  </footer>
                </article>
              ))}
            </div>
          ) : <Empty icon={<Mic className="h-5 w-5" />} heading="Turn text into speech" body="Pick one of your voices, write the line, and generate. Send any clip to Lip Sync to make a portrait speak it." />
        ) : visible.length ? (
          <div className={app === "clipping" || app === "vibe-motion" ? "cs-grid cs-grid-wide" : "cs-grid"}>
            {visible.map((item) => (
              <GenerationCard
                key={item.id}
                item={item}
                now={now}
                modelName={modelName(catalog, item)}
                onOpen={setLightbox}
                onStop={() => void stop(item)}
                onRetry={() => void submit(undefined, item)}
                onReuse={() => reuse(item)}
                onDelete={() => void remove(item)}
                onSend={onSend}
                onRevise={(file) => patch({ baseFile: file, prompt: "" })}
              />
            ))}
          </div>
        ) : app !== "workflows" ? (
          <Empty icon={meta.icon} heading={meta.heading} body={meta.body} />
        ) : null}
      </div>

      <form className="cs-composer" onSubmit={(event) => void submit(event)}>
        {app === "cinema" ? <CinemaRig value={draft.cinema} onChange={(cinema) => patch({ cinema })} /> : null}
        {app === "audio" ? (
          <Segment label="Audio type" value={draft.audioMode} onChange={(audioMode) => patch({ audioMode })} options={[{ value: "music", label: "Music", icon: <Music className="h-3.5 w-3.5" /> }, { value: "voice", label: "Voice", icon: <Mic className="h-3.5 w-3.5" /> }]} />
        ) : null}
        {app === "video" ? (
          <Segment label="Video mode" value={draft.mode} onChange={(mode) => patch({ mode, model: "" })} options={[{ value: "generate", label: "Generate", icon: <Film className="h-3.5 w-3.5" /> }, { value: "upscale", label: "Upscale", icon: <Maximize2 className="h-3.5 w-3.5" /> }]} />
        ) : null}
        {app === "layers" ? (
          <div className="cs-ops" role="radiogroup" aria-label="Edit">
            {LAYER_OPS.map((op) => (
              <button key={op.value} type="button" role="radio" aria-checked={draft.operation === op.value} onClick={() => patch({ operation: op.value })}>{op.label}</button>
            ))}
          </div>
        ) : null}
        {app === "vibe-motion" && draft.baseFile ? (
          <p className="cs-revising"><PenLine className="h-3.5 w-3.5" />Revising a motion graphic<button type="button" className="cs-link" onClick={() => patch({ baseFile: undefined })}>Start new</button></p>
        ) : null}
        {app === "clipping" && !draft.sourceVideo ? (
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

        <div className="cs-controls">
          <div className="cs-chips">
            {usesModel ? <ModelPicker models={models} value={draft.model} onChange={(id) => patch({ model: id })} loading={catalogLoading} /> : null}
            {app === "audio" && draft.audioMode === "music" ? (
              <>
                <span className="cs-chip cs-chip-static"><Music className="h-3.5 w-3.5" />{catalog?.music.name || "Music"}</span>
                <Toggle label="Instrumental" value={draft.instrumental} onChange={(instrumental) => patch({ instrumental })} />
              </>
            ) : null}
            {app === "audio" && draft.audioMode === "voice" ? <Choice label="Voice" value={draft.voiceId} options={voices.map((v) => ({ value: v.id, label: v.name }))} onChange={(voiceId) => patch({ voiceId })} empty="No voices yet" /> : null}
            {app === "ai-influencer" ? <Choice label="Scene" value={draft.scene} options={SCENES} onChange={(scene) => patch({ scene })} /> : null}
            {app === "marketing" || (app === "workflows" && draft.workflow === "product-ad") ? <Choice label="Style" value={draft.adStyle} options={AD_STYLES} onChange={(adStyle) => patch({ adStyle })} /> : null}
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
            {app === "video" && draft.mode === "upscale" ? <Choice label="Scale" value={String(draft.upscaleFactor)} options={[{ value: "1.5", label: "1.5×" }, { value: "2", label: "2×" }, { value: "3", label: "3×" }]} onChange={(upscaleFactor) => patch({ upscaleFactor: Number(upscaleFactor) })} /> : null}
            {showVideoControls && model && "pricePerSecond" in model && model.pricePerSecond ? (
              <span className="cs-cost" title="Approximate provider price">≈ ${(model.pricePerSecond * draft.duration).toFixed(2)}</span>
            ) : null}
          </div>
          <button type="submit" className="cs-submit" disabled={!ready}>
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
            {actionLabel}
          </button>
        </div>
        {app === "audio" && draft.audioMode === "music" && catalog && !catalog.music.available ? <p className="cs-error">{catalog.music.reason}</p> : null}
        {error ? <p className="cs-error" role="alert">{error}</p> : null}
      </form>
      {lightbox ? <Lightbox src={lightbox} onClose={() => setLightbox(null)} /> : null}
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
function ratio(aspect: string | undefined) {
  const [w, h] = String(aspect || "1:1").split(":").map(Number);
  return w > 0 && h > 0 ? `${w} / ${h}` : "1 / 1";
}
const kindOf = (output: Output) => (output.type.startsWith("image") ? "image" : output.type.startsWith("video") ? "video" : output.type.startsWith("audio") ? "audio" : output.type.startsWith("text/html") ? "html" : "file");
const clock = (seconds?: number) => (Number.isFinite(seconds) ? `${Math.floor(Number(seconds) / 60)}:${String(Math.floor(Number(seconds) % 60)).padStart(2, "0")}` : "");

function GenerationCard({
  item,
  now,
  modelName,
  onOpen,
  onStop,
  onRetry,
  onReuse,
  onDelete,
  onSend,
  onRevise,
}: {
  item: Generation;
  now: number;
  modelName: string;
  onOpen: (src: string) => void;
  onStop: () => void;
  onRetry: () => void;
  onReuse: () => void;
  onDelete: () => void;
  onSend: (target: AppId, field: string, asset: Asset) => void;
  onRevise: (file: string) => void;
}) {
  const pending = item.status === "queued" || item.status === "running";
  const s = item.settings || {};
  const detail = [modelName, s.aspectRatio && item.tab !== "clipping" ? s.aspectRatio : "", ["video", "motion-control", "marketing", "vibe-motion"].includes(item.tab) && s.duration ? `${s.duration}s` : ""].filter(Boolean).join(" · ");
  const images = item.outputs.filter((o) => kindOf(o) === "image");
  const firstImage = images[0];
  const media = (
    <>
      {images.length ? (
        <div className={images.length > 1 ? "cs-media cs-media-multi" : "cs-media"}>
          {images.map((output) => (
            <button key={output.file} type="button" className="cs-thumb" onClick={() => onOpen(output.url)} aria-label={output.title ? `Open ${output.title}` : "Open full size"}>
              <img src={output.url} alt={output.caption || item.prompt.slice(0, 120) || "Generated image"} loading="lazy" />
              {output.title ? <span className="cs-thumb-tag">{output.title}</span> : null}
            </button>
          ))}
        </div>
      ) : null}
      {item.outputs.filter((o) => kindOf(o) === "video").map((output) => (
        <figure key={output.file} className="cs-figure">
          <video className="cs-video" src={output.url} controls playsInline preload="metadata" style={item.tab === "clipping" && s.vertical !== false ? { aspectRatio: "9 / 16" } : undefined} />
          {output.title ? (
            <figcaption>
              <strong>{output.title}</strong>
              {output.caption ? <span>{output.caption}</span> : null}
              {output.start !== undefined ? <span className="cs-meta">{clock(output.start)}–{clock(output.end)}{output.score ? ` · score ${output.score}` : ""}</span> : null}
            </figcaption>
          ) : null}
        </figure>
      ))}
      {item.outputs.filter((o) => kindOf(o) === "audio").map((output) => (
        <div key={output.file} className="cs-audio"><Music className="h-5 w-5" /><audio controls src={output.url} preload="metadata" /></div>
      ))}
      {item.outputs.filter((o) => kindOf(o) === "html").map((output) => (
        <iframe key={output.file} className="cs-motion" src={output.url} sandbox="allow-scripts" title={`Motion graphic: ${item.prompt.slice(0, 80)}`} style={{ aspectRatio: ratio(s.aspectRatio) }} loading="lazy" />
      ))}
    </>
  );
  return (
    <article className="cs-card" aria-busy={pending}>
      {pending ? (
        <div className="cs-pending" style={{ aspectRatio: item.outputs.length ? undefined : item.tab === "audio" ? "4 / 1" : ratio(item.tab === "clipping" ? "9:16" : s.aspectRatio) }}>
          {item.outputs.length ? media : null}
          <span className="cs-pending-row">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>{item.message || (item.tab === "audio" ? "Composing" : "Generating")} · {elapsed(item.createdAt, now)}</span>
          </span>
          {item.steps?.length ? <Steps steps={item.steps} /> : null}
          <button type="button" className="cs-ghost" onClick={onStop}><Square className="h-3 w-3" />Stop</button>
        </div>
      ) : item.status !== "done" ? (
        <div className="cs-failed">
          <AlertCircle className="h-5 w-5" />
          <p>{item.status === "cancelled" ? "Stopped before it finished." : item.error || "Generation failed."}</p>
          {item.outputs.length ? media : null}
          <button type="button" className="cs-ghost" onClick={onRetry}><RotateCcw className="h-3 w-3" />Try again</button>
        </div>
      ) : (
        <>
          {media}
          {item.steps?.length ? <Steps steps={item.steps} /> : null}
        </>
      )}

      {item.prompt ? <p className="cs-prompt">{item.prompt}</p> : null}
      <footer className="cs-card-foot">
        <span className="cs-meta">{detail} · {timeAgo(item.createdAt, now)}</span>
        <div className="cs-actions">
          {item.status === "done" && firstImage ? (
            <>
              <IconButton label="Animate in Video Studio" onClick={() => onSend("video", "firstFrame", firstImage)}><Clapperboard className="h-3.5 w-3.5" /></IconButton>
              <IconButton label="Edit in Layers Studio" onClick={() => onSend("layers", "image", firstImage)}><Sparkles className="h-3.5 w-3.5" /></IconButton>
              <IconButton label="Make it talk in Lip Sync" onClick={() => onSend("lipsync", "image", firstImage)}><Mic className="h-3.5 w-3.5" /></IconButton>
            </>
          ) : null}
          {item.status === "done" && item.tab === "vibe-motion" && item.outputs[0] ? (
            <IconButton label="Revise this motion graphic" onClick={() => onRevise(item.outputs[0].file)}><PenLine className="h-3.5 w-3.5" /></IconButton>
          ) : null}
          {item.status === "done" && item.tab === "audio" && item.outputs[0] ? (
            <IconButton label="Use in Lip Sync" onClick={() => onSend("lipsync", "audioFile", item.outputs[0])}><Mic className="h-3.5 w-3.5" /></IconButton>
          ) : null}
          {!pending ? <IconButton label="Reuse settings" onClick={onReuse}><RotateCcw className="h-3.5 w-3.5" /></IconButton> : null}
          {item.outputs.length === 1 ? (
            <a className="cs-icon" href={`${item.outputs[0].url}?download=1`} aria-label="Download" title="Download"><Download className="h-3.5 w-3.5" /></a>
          ) : item.outputs.length > 1 ? <DownloadMenu outputs={item.outputs} /> : null}
          <IconButton label="Delete" onClick={onDelete}><Trash2 className="h-3.5 w-3.5" /></IconButton>
        </div>
      </footer>
    </article>
  );
}

function Steps({ steps }: { steps: Array<{ label: string; status: string }> }) {
  return (
    <ol className="cs-steps">
      {steps.map((step) => (
        <li key={step.label} data-status={step.status}>
          {step.status === "done" ? <Check className="h-3 w-3" /> : step.status === "running" ? <Loader2 className="h-3 w-3 animate-spin" /> : <span className="cs-step-dot" />}
          {step.label}
        </li>
      ))}
    </ol>
  );
}

function DownloadMenu({ outputs }: { outputs: Output[] }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  useEffect(() => {
    if (!open) return;
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open, close]);
  return (
    <div className="cs-pop">
      <IconButton label={`Download ${outputs.length} files`} onClick={() => setOpen(!open)}><Download className="h-3.5 w-3.5" /></IconButton>
      {open ? (
        <div className="cs-menu cs-menu-up" role="menu" onPointerDown={(event) => event.stopPropagation()}>
          {outputs.map((output, index) => (
            <a key={output.file} role="menuitem" className="cs-menu-item" href={`${output.url}?download=1`} onClick={close}>
              {output.title || `File ${index + 1}`}
            </a>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function CinemaRig({ value, onChange }: { value: Draft["cinema"]; onChange: (value: Draft["cinema"]) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="cs-rig">
      <button type="button" className="cs-rig-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Camera className="h-4 w-4" />
        <span className="cs-rig-summary">{value.camera} · {value.lens} · {value.focalLength}mm · {value.aperture}</span>
        <ChevronDown className="cs-rig-chevron h-3.5 w-3.5" />
      </button>
      {open ? (
        <div className="cs-rig-panel">
          <RigColumn title="Camera" items={CAMERAS} value={value.camera} onChange={(camera) => onChange({ ...value, camera })} image />
          <RigColumn title="Lens" items={LENSES} value={value.lens} onChange={(lens) => onChange({ ...value, lens })} image />
          <RigColumn title="Focal length" items={FOCAL_LENGTHS.map(String)} value={String(value.focalLength)} onChange={(focal) => onChange({ ...value, focalLength: Number(focal) })} suffix="mm" />
          <RigColumn title="Aperture" items={APERTURES} value={value.aperture} onChange={(aperture) => onChange({ ...value, aperture })} image />
        </div>
      ) : null}
    </div>
  );
}
function RigColumn({ title, items, value, onChange, image, suffix = "" }: { title: string; items: string[]; value: string; onChange: (value: string) => void; image?: boolean; suffix?: string }) {
  return (
    <fieldset className="cs-rig-col">
      <legend>{title}</legend>
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
