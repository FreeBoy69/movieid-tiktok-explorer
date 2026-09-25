// Cinema Studio, rebuilt after Higgsfield's: a gallery with one floating
// prompt bar. Image mode shoots stills through a virtual camera rig; Video mode
// films shots with the same rig plus a move set and speed ramp.
import { type PointerEvent as ReactPointerEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Camera, Check, ChevronDown, Clapperboard, Clock, Film, ImageIcon, Loader2, Minus, Palette, Plus, RectangleHorizontal, Save, Search, Sparkles, Sun, Volume2, VolumeX, X, Zap } from "lucide-react";
import { CINEMA_GENRES, CINEMA_LIGHTING, CINEMA_MOVESETS, CINEMA_PALETTES, CINEMA_SPEED_RAMPS, cinemaPreview } from "../../utils/cinemaPresets";
import { type Asset, type Catalog, fit, type Generation, readJson, uploadAsset, usePopover } from "./studioShared";
import { type GalleryHandlers, StudioGallery } from "./StudioGallery";
import { useErrorToast } from "../../utils/toast";
import { CREDIT_ESTIMATE_TITLE, creditEstimateLabel, fallbackCreditEstimate, providerCreditEstimate, useStudioPricing } from "./studioPricing";
import "./CinemaStudioPage.css";

type Rig = { camera: string; lens: string; focalLength: number; aperture: string };
type Draft = {
  mode: "image" | "video";
  prompt: string;
  rig: Rig;
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
const CAMERAS = [
  { name: "Premium Large Format Digital", kind: "Digital" },
  { name: "Modular 8K Digital", kind: "Digital" },
  { name: "Full-Frame Cine Digital", kind: "Digital" },
  { name: "Studio Digital S35", kind: "Digital" },
  { name: "Grand Format 70mm Film", kind: "Film" },
  { name: "Classic 16mm Film", kind: "Film" },
];
const LENSES = [
  { name: "Clinical Sharp Prime", kind: "Spherical" },
  { name: "Premium Modern Prime", kind: "Spherical" },
  { name: "Warm Cinema Prime", kind: "Spherical" },
  { name: "Vintage Prime", kind: "Spherical" },
  { name: "70s Cinema Prime", kind: "Spherical" },
  { name: "Swirl Bokeh Portrait", kind: "Spherical" },
  { name: "Classic Anamorphic", kind: "Anamorphic" },
  { name: "Compact Anamorphic", kind: "Anamorphic" },
  { name: "Halation Diffusion", kind: "Filter" },
  { name: "Creative Tilt Lens", kind: "Specialty" },
  { name: "Extreme Macro", kind: "Specialty" },
];
const FOCALS = [8, 14, 24, 35, 50, 85];
const APERTURES = ["f/1.4", "f/4", "f/11"];
const RECOMMENDED: Array<{ name: string; rig: Rig }> = [
  { name: "Epic widescreen", rig: { camera: "Grand Format 70mm Film", lens: "Classic Anamorphic", focalLength: 35, aperture: "f/4" } },
  { name: "Intimate portrait", rig: { camera: "Full-Frame Cine Digital", lens: "Swirl Bokeh Portrait", focalLength: 85, aperture: "f/1.4" } },
  { name: "Indie grain", rig: { camera: "Classic 16mm Film", lens: "Vintage Prime", focalLength: 24, aperture: "f/4" } },
  { name: "Crisp commercial", rig: { camera: "Premium Large Format Digital", lens: "Clinical Sharp Prime", focalLength: 50, aperture: "f/11" } },
  { name: "Dream sequence", rig: { camera: "Studio Digital S35", lens: "Halation Diffusion", focalLength: 35, aperture: "f/1.4" } },
];
const gear = (name: string) => `/assets/cinema/${name.toLowerCase().replace("/", "_").replace(/\./g, "_").replace(/[^a-z0-9_]+/g, "_")}.webp`;
const DRAFT_KEY = "autoyt-cinema-draft";
const SAVED_KEY = "autoyt-cinema-saved-rigs";
const baseDraft = (): Draft => ({
  mode: "image",
  prompt: "",
  rig: { camera: "Premium Large Format Digital", lens: "Clinical Sharp Prime", focalLength: 35, aperture: "f/4" },
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
    return { ...baseDraft(), ...JSON.parse(window.localStorage.getItem(DRAFT_KEY) || "{}") };
  } catch {
    return baseDraft();
  }
}
const IMAGE_PREFERRED = ["google/gemini-3-pro-image", "bytedance-seed/seedream-4.5"];
const VIDEO_PREFERRED = ["google/veo-3.1-fast", "alibaba/wan-3.0", "bytedance/seedance-2.0"];

function Preview({ src, alt, fallback }: { src: string; alt: string; fallback: ReactNode }) {
  const [broken, setBroken] = useState(false);
  return broken ? <span className="cns-fallback">{fallback}</span> : <img src={src} alt={alt} loading="lazy" onError={() => setBroken(true)} />;
}

export function CinemaStudioPage({ catalog, generations, now, handlers, onCreated }: { catalog: Catalog | null; generations: Generation[]; now: number; handlers: GalleryHandlers; onCreated: (item: Generation) => void }) {
  const [draft, setDraft] = useState<Draft>(loadDraft);
  const pricing = useStudioPricing();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useErrorToast(error, () => setError(""));
  const [uploading, setUploading] = useState(false);
  const file = useRef<HTMLInputElement>(null);
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
      <div className="cns-canvas">
        {shots.length ? (
          <>
            <div className="cs-app-head">
              <h1>Cinema Studio</h1>
            </div>
            <StudioGallery items={shots} now={now} handlers={handlers} />
          </>
        ) : (
          <div className="cns-hero">
            <h1>Direct anything you imagine</h1>
            <p>Choose a camera, lens, focal length, and aperture, set the look, then describe the scene. Shoot stills, or film moving shots.</p>
          </div>
        )}
      </div>

      <div className="cns-dock">
        <div className="cns-modes" role="tablist" aria-label="Mode">
          {([
            ["image", "Image", <ImageIcon key="i" className="h-4 w-4" />],
            ["video", "Video", <Clapperboard key="v" className="h-4 w-4" />],
          ] as const).map(([value, label, icon]) => (
            <button key={value} type="button" role="tab" aria-selected={draft.mode === value} onClick={() => patch({ mode: value })}>
              {icon}
              <span>{label}</span>
            </button>
          ))}
        </div>

        <div className="cns-bar">
          <div className="cns-looks">
            <LookPicker label="Genre" icon={<Film className="h-3.5 w-3.5" />} value={draft.genre} options={CINEMA_GENRES} kind="genre" onChange={(genre) => patch({ genre })} />
            <LookPicker label="Palette" icon={<Palette className="h-3.5 w-3.5" />} value={draft.palette} options={CINEMA_PALETTES} kind="palette" onChange={(palette) => patch({ palette })} />
            <LookPicker label="Lighting" icon={<Sun className="h-3.5 w-3.5" />} value={draft.lighting} options={CINEMA_LIGHTING} kind="lighting" onChange={(lighting) => patch({ lighting })} />
            {video ? (
              <>
                <ListPicker label="Move set" icon={<Camera className="h-3.5 w-3.5" />} value={draft.moveset} options={CINEMA_MOVESETS} onChange={(moveset) => patch({ moveset })} />
                <ListPicker label="Speed" icon={<Zap className="h-3.5 w-3.5" />} value={draft.speed} options={CINEMA_SPEED_RAMPS} onChange={(speed) => patch({ speed })} />
              </>
            ) : null}
          </div>

          {draft.refs.length ? (
            <div className="cns-refs">
              {draft.refs.map((ref, index) => (
                <span key={ref.file} className="cns-ref">
                  <img src={ref.url} alt="" />
                  {video && index === 0 ? <em>Start frame</em> : null}
                  <button type="button" aria-label="Remove reference" onClick={() => patch({ refs: draft.refs.filter((r) => r.file !== ref.file) })}><X className="h-3 w-3" /></button>
                </span>
              ))}
            </div>
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
            <button type="button" className="cns-icon" aria-label={video ? "Add a start frame" : "Add reference images"} title={video ? "Start frame" : "Reference images"} disabled={uploading || draft.refs.length >= Math.max(1, maxRefs)} onClick={() => file.current?.click()}>
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            </button>
            <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" multiple={!video} hidden onChange={async (event) => {
              const files = Array.from(event.target.files || []).slice(0, Math.max(1, maxRefs) - draft.refs.length);
              event.target.value = "";
              setUploading(true);
              try {
                const added: Asset[] = [];
                for (const f of files) added.push(await uploadAsset(f, f.name));
                patch({ refs: [...draft.refs, ...added] });
              } catch (err) {
                setError(err instanceof Error ? err.message : "Upload failed");
              } finally {
                setUploading(false);
              }
            }} />
            <ModelPicker models={(video ? videoModels : imageModels).map((m) => ({ id: m.id, name: m.name, provider: m.provider }))} value={(video ? videoModel : imageModel)?.id || ""} onChange={(id) => patch(video ? { videoModel: id } : { imageModel: id })} />
            <MiniChoice icon={<RectangleHorizontal className="h-3.5 w-3.5" />} label="Aspect ratio" value={aspect} options={aspects} onChange={(value) => patch({ aspect: value })} />
            {resolutions.length ? <MiniChoice icon={<Sparkles className="h-3.5 w-3.5" />} label="Quality" value={resolution} options={resolutions} onChange={(value) => patch({ resolution: value })} /> : null}
            {video ? (
              <>
                <MiniChoice icon={<Clock className="h-3.5 w-3.5" />} label="Duration" value={`${duration}s`} options={durations.map((d) => `${d}s`)} onChange={(value) => patch({ duration: Number(value.replace("s", "")) })} />
                {videoModel?.audio ? (
                  <button type="button" className="cns-chip" aria-pressed={draft.audio} onClick={() => patch({ audio: !draft.audio })} aria-label="Native audio">
                    {draft.audio ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
                    {draft.audio ? "On" : "Off"}
                  </button>
                ) : null}
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

        <RigPicker rig={draft.rig} onChange={(rig) => patch({ rig })} />
        <button type="button" className="cns-generate" disabled={busy || !draft.prompt.trim() || !catalog?.configured} onClick={() => void generate()}>
          {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <span>Generate</span>}
          <small title={cost ? CREDIT_ESTIMATE_TITLE : undefined}>{cost || (video ? "Video" : `${count} ${count === 1 ? "still" : "stills"}`)}</small>
        </button>
      </div>
    </div>
  );
}

function LookPicker({ label, icon, value, options, kind, onChange }: { label: string; icon: ReactNode; value: string; options: Array<{ id: string; name: string }>; kind: string; onChange: (id: string) => void }) {
  const { open, setOpen, ref } = usePopover();
  const [hover, setHover] = useState(value);
  const current = options.find((o) => o.id === value) || options[0];
  const shown = options.find((o) => o.id === hover) || current;
  useEffect(() => {
    if (open) setHover(value);
  }, [open, value]);
  return (
    <div className="cns-pop" ref={ref}>
      <button type="button" className="cns-look" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(!open)}>
        {icon}
        <span className="cns-look-label">{label}:</span>
        <span>{current.name}</span>
      </button>
      {open ? (
        <div className="cns-panel cns-lookpanel" role="dialog" aria-label={label}>
          <div className="cns-lookpanel-art">
            {shown.id === "auto" ? <span className="cns-fallback"><Sparkles className="h-6 w-6" />Auto</span> : <Preview src={cinemaPreview(kind, shown.id)} alt="" fallback={<><Sun className="h-6 w-6" />{shown.name}</>} />}
          </div>
          <div className="cns-lookpanel-list" role="listbox" aria-label={label}>
            <p>{label}</p>
            {options.map((option) => (
              <button key={option.id} type="button" role="option" aria-selected={option.id === value} onMouseEnter={() => setHover(option.id)} onFocus={() => setHover(option.id)} onClick={() => { onChange(option.id); setOpen(false); }}>
                <span className="cns-dot-thumb">{option.id === "auto" ? <Sparkles className="h-3 w-3" /> : <Preview src={cinemaPreview(kind, option.id)} alt="" fallback={null} />}</span>
                {option.name}
                {option.id === value ? <Check className="h-3.5 w-3.5" /> : null}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ListPicker({ label, icon, value, options, onChange }: { label: string; icon: ReactNode; value: string; options: Array<{ id: string; name: string; text: string }>; onChange: (id: string) => void }) {
  const { open, setOpen, ref } = usePopover();
  const current = options.find((o) => o.id === value) || options[0];
  return (
    <div className="cns-pop" ref={ref}>
      <button type="button" className="cns-look" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(!open)}>
        {icon}
        <span className="cns-look-label">{label}:</span>
        <span>{current.name}</span>
      </button>
      {open ? (
        <div className="cns-panel cns-listpanel" role="listbox" aria-label={label}>
          {options.map((option) => (
            <button key={option.id} type="button" role="option" aria-selected={option.id === value} onClick={() => { onChange(option.id); setOpen(false); }}>
              <strong>{option.name}{option.id === value ? <Check className="h-3.5 w-3.5" /> : null}</strong>
              <span>{option.text || "Let the scene decide"}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function MiniChoice({ icon, label, value, options, onChange }: { icon: ReactNode; label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  const { open, setOpen, ref } = usePopover();
  return (
    <div className="cns-pop" ref={ref}>
      <button type="button" className="cns-chip" aria-label={`${label}: ${value}`} aria-expanded={open} onClick={() => setOpen(!open)} disabled={options.length < 2}>
        {icon}
        {value}
      </button>
      {open ? (
        <div className="cns-panel cns-mini" role="listbox" aria-label={label}>
          <p>{label}</p>
          {options.map((option) => (
            <button key={option} type="button" role="option" aria-selected={option === value} onClick={() => { onChange(option); setOpen(false); }}>
              {option}
              {option === value ? <Check className="h-3.5 w-3.5" /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ModelPicker({ models, value, onChange }: { models: Array<{ id: string; name: string; provider: string }>; value: string; onChange: (id: string) => void }) {
  const { open, setOpen, ref } = usePopover();
  const [query, setQuery] = useState("");
  const current = models.find((m) => m.id === value);
  const shown = models.filter((m) => !query || `${m.name} ${m.provider}`.toLowerCase().includes(query.toLowerCase()));
  return (
    <div className="cns-pop" ref={ref}>
      <button type="button" className="cns-chip is-model" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Sparkles className="h-3.5 w-3.5" />
        <span>{current?.name || "Model"}</span>
        <ChevronDown className="h-3 w-3" />
      </button>
      {open ? (
        <div className="cns-panel cns-models" role="dialog" aria-label="Model">
          <label className="cns-search"><Search className="h-3.5 w-3.5" /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search models" /></label>
          <div role="listbox" aria-label="Models">
            {shown.map((m) => (
              <button key={m.id} type="button" role="option" aria-selected={m.id === value} onClick={() => { onChange(m.id); setOpen(false); }}>
                <span>{m.name}</span>
                <small>{m.provider}</small>
                {m.id === value ? <Check className="h-3.5 w-3.5" /> : null}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function RigPicker({ rig, onChange }: { rig: Rig; onChange: (rig: Rig) => void }) {
  const { open, setOpen, ref } = usePopover();
  const [tab, setTab] = useState<"all" | "recommended" | "saved">("all");
  const [part, setPart] = useState<"" | "camera" | "lens" | "aperture">("");
  const [saved, setSaved] = useState<Rig[]>(() => {
    try {
      return JSON.parse(window.localStorage.getItem(SAVED_KEY) || "[]");
    } catch {
      return [];
    }
  });
  const drag = useRef<{ x: number; index: number } | null>(null);
  const camera = CAMERAS.find((c) => c.name === rig.camera) || CAMERAS[0];
  const lens = LENSES.find((l) => l.name === rig.lens) || LENSES[0];
  const focalIndex = Math.max(0, FOCALS.indexOf(rig.focalLength));
  const setFocal = (index: number) => onChange({ ...rig, focalLength: FOCALS[Math.min(FOCALS.length - 1, Math.max(0, index))] });
  const saveSetup = () => {
    const next = [rig, ...saved.filter((s) => JSON.stringify(s) !== JSON.stringify(rig))].slice(0, 8);
    setSaved(next);
    try {
      window.localStorage.setItem(SAVED_KEY, JSON.stringify(next));
    } catch {}
    setTab("saved");
  };
  const onFocalDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    drag.current = { x: event.clientX, index: focalIndex };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onFocalMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!drag.current) return;
    setFocal(drag.current.index + Math.round((event.clientX - drag.current.x) / 28));
  };
  const setups = tab === "recommended" ? RECOMMENDED : tab === "saved" ? saved.map((r, i) => ({ name: `Setup ${i + 1}`, rig: r })) : [];
  return (
    <div className="cns-pop" ref={ref}>
      <button type="button" className="cns-rig" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(!open)}>
        <img src={gear(rig.camera)} alt="" />
        <span>
          <strong>{rig.camera}</strong>
          <small>{rig.lens}, {rig.focalLength}mm {rig.aperture}</small>
        </span>
      </button>
      {open ? (
        <div className="cns-panel cns-rigpanel" role="dialog" aria-label="Camera rig">
          <div className="cns-rig-tabs" role="tablist" aria-label="Setups">
            {(["all", "recommended", "saved"] as const).map((value) => (
              <button key={value} type="button" role="tab" aria-selected={tab === value} onClick={() => { setTab(value); setPart(""); }}>
                {value === "all" ? "All" : value === "recommended" ? "Recommended" : "Saved"}
              </button>
            ))}
          </div>
          {tab === "all" ? (
            <>
              <div className="cns-rig-cards">
                <button type="button" className="cns-rig-card" aria-pressed={part === "camera"} onClick={() => setPart(part === "camera" ? "" : "camera")}>
                  <em>Camera</em>
                  <img src={gear(rig.camera)} alt="" />
                  <small>{camera.kind}</small>
                  <strong>{rig.camera}</strong>
                </button>
                <button type="button" className="cns-rig-card" aria-pressed={part === "lens"} onClick={() => setPart(part === "lens" ? "" : "lens")}>
                  <em>Lens</em>
                  <img src={gear(rig.lens)} alt="" />
                  <small>{lens.kind}</small>
                  <strong>{rig.lens}</strong>
                </button>
                <button
                  type="button"
                  className="cns-rig-card is-focal"
                  aria-label={`Focal length ${rig.focalLength}mm. Drag sideways or use arrow keys to change.`}
                  onPointerDown={onFocalDown}
                  onPointerMove={onFocalMove}
                  onPointerUp={() => (drag.current = null)}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowRight" || event.key === "ArrowUp") setFocal(focalIndex + 1);
                    if (event.key === "ArrowLeft" || event.key === "ArrowDown") setFocal(focalIndex - 1);
                  }}
                >
                  <em>Focal length</em>
                  <span className="cns-focal">{rig.focalLength}</span>
                  <span className="cns-ruler" aria-hidden="true">
                    {FOCALS.map((f) => <i key={f} data-on={f === rig.focalLength || undefined} />)}
                  </span>
                  <strong>mm · drag</strong>
                </button>
                <button type="button" className="cns-rig-card" aria-pressed={part === "aperture"} onClick={() => setPart(part === "aperture" ? "" : "aperture")}>
                  <em>Aperture</em>
                  <img src={gear(rig.aperture)} alt="" />
                  <small>{rig.aperture === "f/1.4" ? "Shallow" : rig.aperture === "f/4" ? "Balanced" : "Deep"}</small>
                  <strong>{rig.aperture}</strong>
                </button>
              </div>
              {part ? (
                <div className="cns-rig-options" role="listbox" aria-label={part}>
                  {(part === "camera" ? CAMERAS.map((c) => c.name) : part === "lens" ? LENSES.map((l) => l.name) : APERTURES).map((name) => {
                    const selected = part === "camera" ? rig.camera === name : part === "lens" ? rig.lens === name : rig.aperture === name;
                    return (
                      <button key={name} type="button" role="option" aria-selected={selected} onClick={() => onChange({ ...rig, [part]: name } as Rig)}>
                        <img src={gear(name)} alt="" loading="lazy" />
                        {selected ? <i className="cns-rig-check" aria-hidden="true"><Check className="h-3 w-3" strokeWidth={3} /></i> : null}
                        <span>{name}</span>
                      </button>
                    );
                  })}
                </div>
              ) : null}
              <button type="button" className="cns-save" onClick={saveSetup}><Save className="h-3.5 w-3.5" />Save setup</button>
            </>
          ) : (
            <div className="cns-setups">
              {setups.length ? setups.map((setup) => (
                <button key={setup.name + JSON.stringify(setup.rig)} type="button" onClick={() => { onChange(setup.rig); setTab("all"); }}>
                  <img src={gear(setup.rig.camera)} alt="" />
                  <span>
                    <strong>{setup.name}</strong>
                    <small>{setup.rig.camera} · {setup.rig.lens} · {setup.rig.focalLength}mm {setup.rig.aperture}</small>
                  </span>
                </button>
              )) : <p className="cns-empty">No saved setups yet. Build a rig in All and choose Save setup.</p>}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
