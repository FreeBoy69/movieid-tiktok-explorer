// Cinema Studio, rebuilt after Higgsfield's: a gallery with one floating
// prompt bar. Image mode shoots stills through a virtual camera rig; Video mode
// films shots with the same rig plus a move set and speed ramp.
import { StudioLayout } from "../StudioLayout";
import { useEffect, useMemo, useState } from "react";
import { Camera, Clapperboard, Clock, Crop, Eye, Film, ImageIcon, Loader2, Minus, Move, Palette, Plus, Sparkles, Sun, Volume2, Zap } from "lucide-react";
import { CINEMA_GENRES, CINEMA_LIGHTING, CINEMA_MOVESETS, CINEMA_PALETTES, CINEMA_SPEED_RAMPS } from "../../utils/cinemaPresets";
import { AspectPicker, type Asset, type Catalog, Choice, fit, type Generation, GenerationUnavailable, ModelPicker, readJson, ReferenceTray, Segment, Toggle } from "./studioShared";
import { CAMERA_PICKS, CinemaLookPicker as LookPicker, type Rig, RigPicker } from "./CinemaPickers";
import { type GalleryHandlers, StudioGallery } from "./StudioGallery";
import { useErrorToast } from "../../utils/toast";
import { CREDIT_ESTIMATE_TITLE, creditEstimateLabel, fallbackCreditEstimate, providerCreditEstimate, useStudioPricing } from "./studioPricing";
import "./CinemaStudioPage.css";

type CameraPicks = { angle: string; shot: string; perspective: string; motion: string };
type Draft = {
  mode: "image" | "video";
  prompt: string;
  rig: Rig;
  camera: CameraPicks;
  genre: string;
  palette: string;
  lighting: string;
  moveset: string;
  speed: string;
  imageModel: string;
  videoModel: string;
  aspect: string;
  resolution: string;
  count: number;
  duration: number;
  audio: boolean;
  refs: Asset[];
};
const DRAFT_KEY = "autoyt-cinema-draft";
const baseDraft = (): Draft => ({
  mode: "image",
  prompt: "",
  rig: { camera: "Premium Large Format Digital", lens: "Clinical Sharp Prime", focalLength: 35, aperture: "f/4" },
  camera: { angle: "auto", shot: "auto", perspective: "auto", motion: "auto" },
  genre: "general",
  palette: "auto",
  lighting: "auto",
  moveset: "auto",
  speed: "auto",
  imageModel: "",
  videoModel: "",
  aspect: "21:9",
  resolution: "",
  count: 2,
  duration: 5,
  audio: false,
  refs: [],
});
function loadDraft(): Draft {
  try {
    const saved = JSON.parse(window.localStorage.getItem(DRAFT_KEY) || "{}");
    return { ...baseDraft(), ...saved, camera: { ...baseDraft().camera, ...(saved.camera || {}) } };
  } catch {
    return baseDraft();
  }
}
const IMAGE_PREFERRED = ["google/gemini-3-pro-image", "bytedance-seed/seedream-4.5"];
const VIDEO_PREFERRED = ["google/veo-3.1-fast", "alibaba/wan-3.0", "bytedance/seedance-2.0"];

export function CinemaStudioPage({ catalog, generations, now, handlers, onCreated }: { catalog: Catalog | null; generations: Generation[]; now: number; handlers: GalleryHandlers; onCreated: (item: Generation) => void }) {
  const [draft, setDraft] = useState<Draft>(loadDraft);
  const pricing = useStudioPricing();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useErrorToast(error, () => setError(""));
  const patch = (changes: Partial<Draft>) => setDraft((current) => ({ ...current, ...changes }));
  useEffect(() => {
    try {
      window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {}
  }, [draft]);

  const video = draft.mode === "video";
  const imageModels = catalog?.image || [];
  const videoModels = catalog?.video || [];
  const imageModel = imageModels.find((m) => m.id === draft.imageModel) || IMAGE_PREFERRED.map((id) => imageModels.find((m) => m.id === id)).find(Boolean) || imageModels[0];
  const videoModel = videoModels.find((m) => m.id === draft.videoModel) || VIDEO_PREFERRED.map((id) => videoModels.find((m) => m.id === id)).find(Boolean) || videoModels[0];
  const aspects = (video ? videoModel?.aspectRatios : imageModel?.aspectRatios)?.filter((a) => a !== "auto") || ["16:9"];
  const aspect = fit(draft.aspect, aspects, ["21:9", "16:9"]);
  const resolutions = (video ? videoModel?.resolutions : imageModel?.resolutions) || [];
  const resolution = fit(draft.resolution, resolutions, video ? ["1080p", "720p"] : ["2K", "4K"]);
  const maxCount = imageModel?.maxImages || 1;
  const count = Math.min(draft.count, maxCount);
  const durations = videoModel?.durations || [5];
  const duration = durations.includes(draft.duration) ? draft.duration : durations.includes(5) ? 5 : durations[0];
  const maxRefs = video ? 1 : Math.max(0, imageModel?.maxReferences || 0);
  const estimatedCredits = video
    ? providerCreditEstimate(videoModel?.pricePerSecond ? videoModel.pricePerSecond * duration : null, pricing) ?? fallbackCreditEstimate("video", pricing)
    : fallbackCreditEstimate("image", pricing, count);
  const cost = creditEstimateLabel(estimatedCredits);
  const shots = useMemo(() => generations.filter((item) => item.tab === "cinema"), [generations]);

  async function generate() {
    setBusy(true);
    setError("");
    try {
      const data = await readJson(
        await fetch("/api/studio/generations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tab: "cinema",
            model: video ? videoModel?.id : imageModel?.id,
            prompt: draft.prompt,
            settings: {
              cinemaMode: draft.mode,
              cinema: draft.rig,
              camera: draft.camera,
              genre: draft.genre,
              palette: draft.palette,
              lighting: draft.lighting,
              moveset: draft.moveset,
              speed: draft.speed,
              aspectRatio: aspect,
              resolution,
              count,
              duration,
              audio: draft.audio,
              ...(video ? { firstFrame: draft.refs[0]?.file } : { references: draft.refs.slice(0, maxRefs).map((ref) => ref.file) }),
            },
          }),
        }),
        "Couldn't start the shot",
      );
      onCreated(data.generation);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't start the shot");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="cns">
      <StudioLayout
        title="Cinema Studio"
        intro="Choose a camera, lens, focal length, and aperture, set the look, then describe the scene. Shoot stills, or film moving shots."
        notices={catalog && !catalog.configured ? <GenerationUnavailable className="cns-notice" /> : null}
        above={
        <Segment
          className="cns-modes"
          label="Mode"
          value={draft.mode}
          onChange={(mode) => patch({ mode })}
          options={[
            { value: "image", label: "Image", icon: <ImageIcon className="h-4 w-4" /> },
            { value: "video", label: "Video", icon: <Clapperboard className="h-4 w-4" /> },
          ]}
        />
        }
        composer={
      <div className="cns-dock">
        <div className="cns-bar">
          <div className="cns-looks">
            <LookPicker label="Genre" icon={<Film className="h-3.5 w-3.5" />} value={draft.genre} options={CINEMA_GENRES} kind="genre" onChange={(genre) => patch({ genre })} />
            <LookPicker label="Palette" icon={<Palette className="h-3.5 w-3.5" />} value={draft.palette} options={CINEMA_PALETTES} kind="palette" onChange={(palette) => patch({ palette })} />
            <LookPicker label="Lighting" icon={<Sun className="h-3.5 w-3.5" />} value={draft.lighting} options={CINEMA_LIGHTING} kind="lighting" onChange={(lighting) => patch({ lighting })} />
            <LookPicker wide label="Angle" icon={<Camera className="h-3.5 w-3.5" />} value={draft.camera.angle} options={CAMERA_PICKS.angle} kind="angle" onChange={(angle) => patch({ camera: { ...draft.camera, angle } })} />
            <LookPicker wide label="Shot" icon={<Crop className="h-3.5 w-3.5" />} value={draft.camera.shot} options={CAMERA_PICKS.shot} kind="shot" onChange={(shot) => patch({ camera: { ...draft.camera, shot } })} />
            <LookPicker wide label="Perspective" icon={<Eye className="h-3.5 w-3.5" />} value={draft.camera.perspective} options={CAMERA_PICKS.perspective} kind="perspective" onChange={(perspective) => patch({ camera: { ...draft.camera, perspective } })} />
            {video ? (
              <>
                <LookPicker wide label="Movement" icon={<Move className="h-3.5 w-3.5" />} value={draft.camera.motion} options={CAMERA_PICKS.motion} kind="motion" onChange={(motion) => patch({ camera: { ...draft.camera, motion } })} />
                <Choice skin="cinema" label="Move set" icon={<Camera className="h-3.5 w-3.5" />} value={draft.moveset} options={CINEMA_MOVESETS.map((o) => ({ value: o.id, label: o.name, hint: o.text || "Let the scene decide" }))} onChange={(moveset) => patch({ moveset })} />
                <Choice skin="cinema" label="Speed" icon={<Zap className="h-3.5 w-3.5" />} value={draft.speed} options={CINEMA_SPEED_RAMPS.map((o) => ({ value: o.id, label: o.name, hint: o.text || "Let the scene decide" }))} onChange={(speed) => patch({ speed })} />
              </>
            ) : null}
          </div>

          {maxRefs > 0 || video ? (
            <ReferenceTray
              className="cns-refs"
              assets={draft.refs}
              max={Math.max(1, maxRefs)}
              label={video ? "a start frame" : "reference images"}
              tagFor={(index) => (video && index === 0 ? "Start frame" : undefined)}
              onChange={(refs) => patch({ refs })}
              onError={setError}
            />
          ) : null}

          <textarea
            className="cns-input"
            rows={2}
            value={draft.prompt}
            onChange={(event) => patch({ prompt: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && draft.prompt.trim() && !busy) void generate();
            }}
            placeholder={video ? "Describe the shot: who, where, and what happens. Add timings like 0:00-0:03 for multiple beats…" : "Describe your scene…"}
            aria-label="Scene description"
            maxLength={4000}
          />

          <div className="cns-controls">
            <ModelPicker models={video ? videoModels : imageModels} value={(video ? videoModel : imageModel)?.id || ""} onChange={(id) => patch(video ? { videoModel: id } : { imageModel: id })} loading={!catalog} pricing={pricing} />
            <AspectPicker variant="chip" skin="cinema-mini" label="Aspect ratio" value={aspect} options={aspects} onChange={(value) => patch({ aspect: value })} />
            {resolutions.length ? <Choice skin="cinema-mini" icon={<Sparkles className="h-3.5 w-3.5" />} label="Quality" value={resolution} options={resolutions.map((r) => ({ value: r, label: r }))} onChange={(value) => patch({ resolution: value })} /> : null}
            {video ? (
              <>
                <Choice skin="cinema-mini" icon={<Clock className="h-3.5 w-3.5" />} label="Duration" value={`${duration}s`} options={durations.map((d) => ({ value: `${d}s`, label: `${d}s` }))} onChange={(value) => patch({ duration: Number(value.replace("s", "")) })} />
                {videoModel?.audio ? <Toggle className="cns-toggle" icon={<Volume2 className="h-3.5 w-3.5" />} label="Sound" value={draft.audio} onChange={(audio) => patch({ audio })} /> : null}
              </>
            ) : maxCount > 1 ? (
              <span className="cns-stepper" aria-label="Images per shot">
                <button type="button" aria-label="Fewer images" disabled={count <= 1} onClick={() => patch({ count: count - 1 })}><Minus className="h-3 w-3" /></button>
                <span>{count}/{maxCount}</span>
                <button type="button" aria-label="More images" disabled={count >= maxCount} onClick={() => patch({ count: count + 1 })}><Plus className="h-3 w-3" /></button>
              </span>
            ) : null}
          </div>
        </div>

        <RigPicker rig={draft.rig} onChange={(rig) => patch({ rig: { ...draft.rig, ...rig } as Rig })} />
        <button type="button" className="cns-generate" disabled={busy || !draft.prompt.trim() || !catalog?.configured} onClick={() => void generate()}>
          {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <span>Generate</span>}
          <small title={cost ? CREDIT_ESTIMATE_TITLE : undefined}>{cost || (video ? "Video" : `${count} ${count === 1 ? "still" : "stills"}`)}</small>
        </button>
      </div>
        }
        tabsLabel="Cinema sections"
        tabs={[{ value: "shots", label: "Your shots", hint: shots.length ? String(shots.length) : undefined }]}
        tab="shots"
        onTab={() => undefined}
      >
        {shots.length ? <StudioGallery items={shots} now={now} handlers={handlers} /> : <p className="sl-empty-note">Your shots appear here. Pick a look, describe the scene, and press Generate.</p>}
      </StudioLayout>
    </div>
  );
}

