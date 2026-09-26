// Promo Studio: a link, images, or a brief in; a motion-graphics film out.
// Opus 5.5 writes the film as code, checks its frames, and it is rendered
// with a music bed (server/promoStudio.js). Shares Marketing Studio's styles.
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Check, ChevronDown, ChevronLeft, ChevronRight, Clock, ExternalLink, Film, ImagePlus, Link2, Loader2, Music, Play, RectangleHorizontal, Shapes, SlidersHorizontal, Sparkles, X, Zap } from "lucide-react";
import { PROMO_ASPECTS, PROMO_DURATIONS, PROMO_SUBJECTS, PROMO_TEMPLATES, findPromoSubject, findPromoTemplate, promoPreview } from "../../utils/promoPresets";
import { type Asset, type Catalog, type Generation, readJson, uploadAsset, usePopover } from "./studioShared";
import { type GalleryHandlers, StudioGallery } from "./StudioGallery";
import { useErrorToast } from "../../utils/toast";
import { CREDIT_ESTIMATE_TITLE, creditEstimateLabel, providerCreditEstimate, useStudioPricing } from "./studioPricing";
import "./MarketingStudio.css";
import "./PromoStudio.css";

type Template = (typeof PROMO_TEMPLATES)[number];
type Draft = { url: string; brief: string; uploads: Asset[]; template: string; subject: string; aspect: string; duration: number; music: boolean };
type Revision = { file: string; prompt: string; settings: Record<string, any> };
const DRAFT_KEY = "autoyt-promo-draft";
const MAX_UPLOADS = 8;
const initialDraft = (): Draft => {
  const template = PROMO_TEMPLATES[0];
  const base: Draft = { url: "", brief: "", uploads: [], template: template.id, subject: "auto", aspect: template.aspect, duration: template.duration, music: true };
  try {
    return { ...base, ...JSON.parse(window.localStorage.getItem(DRAFT_KEY) || "{}") };
  } catch {
    return base;
  }
};
// One Opus pass that reads the example film and the material, plus a frame-check fix when needed. The score is synthesized locally.
const estimateUsd = (duration: number) => 0.7 + duration * 0.01;
// Writing takes about four minutes; rendering the MP4 takes about ten seconds per second of film.
const estimateMinutes = (duration: number, revising: boolean) => (revising ? "4–6" : duration <= 15 ? "6–8" : duration <= 30 ? "8–11" : "13–17");

export function PromoStudio({ generations, now, handlers, onCreated, catalog }: { generations: Generation[]; now: number; handlers: GalleryHandlers; onCreated: (item: Generation) => void; catalog: Catalog | null }) {
  const [draft, setDraft] = useState<Draft>(initialDraft);
  const [revision, setRevision] = useState<Revision | null>(null);
  // The template sheet opens on the grid, or straight onto one template's preview.
  const [modal, setModal] = useState<null | { preview: string }>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  useErrorToast(error, () => setError(""));
  const pricing = useStudioPricing();
  const file = useRef<HTMLInputElement>(null);
  const brief = useRef<HTMLTextAreaElement>(null);
  const patch = (changes: Partial<Draft>) => setDraft((current) => ({ ...current, ...changes }));

  useEffect(() => {
    try {
      window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {}
  }, [draft]);

  const template = findPromoTemplate(draft.template);
  const subject = findPromoSubject(draft.subject);
  const films = useMemo(() => generations.filter((item) => item.tab === "promo"), [generations]);
  const configured = catalog?.configured !== false;
  const hasMaterial = Boolean(draft.url.trim() || draft.uploads.length || draft.brief.trim());
  const ready = configured && !busy && !uploading && (revision ? Boolean(draft.brief.trim()) : hasMaterial);
  const duration = revision ? Number(revision.settings.duration) || draft.duration : draft.duration;
  const credits = providerCreditEstimate(estimateUsd(duration), pricing);
  const missing = revision ? (draft.brief.trim() ? "" : "Say what to change") : hasMaterial ? "" : "Add a link, images, or a description";

  function pickTemplate(item: Template) {
    // The template's own shape is the default; a length or aspect chosen by hand wins until the next pick.
    patch({ template: item.id, aspect: item.aspect, duration: item.duration });
    setModal(null);
  }

  async function addFiles(files: File[]) {
    const room = MAX_UPLOADS - draft.uploads.length;
    if (!room) return;
    setUploading(true);
    try {
      const added: Asset[] = [];
      for (const f of files.filter((f) => /^image\/(png|jpeg|webp)$/.test(f.type)).slice(0, room)) added.push(await uploadAsset(f, f.name.replace(/\.[^.]+$/, "")));
      if (!added.length && files.length) throw new Error("Use PNG, JPG, or WebP images");
      setDraft((current) => ({ ...current, uploads: [...current.uploads, ...added].slice(0, MAX_UPLOADS) }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function generate() {
    setBusy(true);
    setError("");
    try {
      const settings = revision
        ? { ...revision.settings, baseFile: revision.file, music: draft.music, uploads: draft.uploads.map((u) => ({ file: u.file, label: u.name })) }
        : { template: template.id, subject: subject.id, aspectRatio: draft.aspect, duration: draft.duration, music: draft.music, sourceUrl: draft.url.trim() || undefined, uploads: draft.uploads.map((u) => ({ file: u.file, label: u.name })) };
      const data = await readJson(
        await fetch("/api/studio/generations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tab: "promo", model: "", prompt: draft.brief.trim(), settings }) }),
        "Couldn't start the film",
      );
      onCreated(data.generation);
      if (revision) {
        setRevision(null);
        patch({ brief: "" });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't start the film");
    } finally {
      setBusy(false);
    }
  }

  const gallery: GalleryHandlers = {
    ...handlers,
    modelName: () => "Promo Studio",
    onRevise: (source) => {
      const item = films.find((film) => film.source?.file === source);
      setRevision({ file: source, prompt: item?.prompt || findPromoTemplate(item?.settings?.template).name, settings: item?.settings || {} });
      patch({ brief: "" });
      document.querySelector(".prs")?.scrollTo({ top: 0, behavior: "smooth" });
      window.setTimeout(() => brief.current?.focus(), 250);
    },
    onReuse: (item) => {
      const s = item.settings || {};
      setRevision(null);
      patch({
        url: s.sourceUrl || "",
        brief: item.prompt || "",
        template: findPromoTemplate(s.template).id,
        subject: findPromoSubject(s.subject).id,
        aspect: PROMO_ASPECTS.includes(s.aspectRatio) ? s.aspectRatio : draft.aspect,
        duration: PROMO_DURATIONS.includes(Number(s.duration)) ? Number(s.duration) : draft.duration,
        music: s.music !== false,
      });
    },
  };

  return (
    <div className="mks prs">
      <section className="mks-hero">
        <h1>
          Launch anything
          <br />
          in motion
        </h1>
        <p className="prs-lede">Paste a link, drop in images, or just describe it. Opus 5.5 writes a motion-graphics film in your brand, checks every frame, and scores it to music.</p>

        <div className="mks-dock prs-dock">
          <div className="mks-bar">
            {revision ? (
              <div className="mks-hookline">
                <span className="mks-hooktag">Revising</span>
                <p>{revision.prompt || "Your film"}</p>
                <button type="button" onClick={() => setRevision(null)}>Cancel</button>
              </div>
            ) : (
              <label className="prs-link">
                <Link2 className="h-4 w-4" aria-hidden="true" />
                <input value={draft.url} onChange={(event) => patch({ url: event.target.value })} placeholder="yoursite.com (optional)" aria-label="Website link" inputMode="url" autoComplete="url" spellCheck={false} maxLength={500} />
                {draft.url ? <button type="button" aria-label="Clear link" onClick={() => patch({ url: "" })}><X className="h-3.5 w-3.5" /></button> : null}
              </label>
            )}
            <div className="mks-bar-body">
              <div className="mks-bar-main">
                <textarea
                  ref={brief}
                  className="mks-brief"
                  rows={3}
                  value={draft.brief}
                  onChange={(event) => patch({ brief: event.target.value })}
                  placeholder={revision ? "What should change? e.g. slower opening, bigger logo, end on the price" : "What are you promoting? Name, what's new, the offer, dates, tone. Anything the film should say."}
                  aria-label={revision ? "What to change" : "Details and direction"}
                  maxLength={4000}
                />
                <div className="mks-row">
                  <button type="button" className="mks-plus" aria-label="Add images" title="Add images: logo, screenshots, product photos" disabled={uploading || draft.uploads.length >= MAX_UPLOADS} onClick={() => file.current?.click()}>
                    {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
                  </button>
                  {draft.uploads.map((asset) => (
                    <span key={asset.file} className="mks-tag prs-thumb">
                      <img src={asset.url} alt="" />
                      <span>{asset.name || "Image"}</span>
                      <button type="button" aria-label={`Remove ${asset.name || "image"}`} onClick={() => patch({ uploads: draft.uploads.filter((u) => u.file !== asset.file) })}><X className="h-3 w-3" /></button>
                    </span>
                  ))}
                  {!draft.uploads.length ? <span className="prs-drop-hint">Logo, screenshots, product photos</span> : null}
                  <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={(event) => { const files = Array.from(event.target.files || []); event.target.value = ""; void addFiles(files); }} />
                </div>
                <div className="mks-row">
                  {!revision ? (
                    <>
                      <Chip icon={<Film className="h-3.5 w-3.5" />} label={template.name} onClick={() => setModal({ preview: "" })} />
                      <SubjectChip value={subject.id} onPick={(id) => patch({ subject: id })} />
                    </>
                  ) : null}
                  <FormatPopover draft={draft} patch={patch} locked={Boolean(revision)} />
                  <button type="button" className={`mks-chip prs-toggle${draft.music ? " is-on" : ""}`} aria-pressed={draft.music} onClick={() => patch({ music: !draft.music })}>
                    <Music className="h-3.5 w-3.5" />
                    <span>{draft.music ? "Music" : "Silent"}</span>
                  </button>
                </div>
              </div>
              <div className="mks-cluster">
                {!revision ? (
                  <TemplateSlot id={template.id} name={template.name} onClick={() => setModal({ preview: "" })} />
                ) : null}
                <button type="button" className="mks-generate" disabled={!ready} onClick={() => void generate()} title={missing || undefined}>
                  {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <span>{revision ? "Revise" : "Generate"}</span>}
                  {credits !== null ? <small title={CREDIT_ESTIMATE_TITLE}><Zap className="h-3 w-3" />{creditEstimateLabel(credits)}</small> : null}
                  <small className="prs-eta"><Clock className="h-3 w-3" />{estimateMinutes(duration, Boolean(revision))} min</small>
                </button>
              </div>
            </div>
          </div>
        </div>
        {missing && !busy ? <p className="mks-hint">{missing}</p> : null}
        {!configured ? <p className="mks-error">Generation isn't set up on this server yet.</p> : catalog?.promo && !catalog.promo.renderer ? <p className="mks-hint">This server can't render video yet, so films come back as live HTML you can play and revise.</p> : null}
      </section>

      <section className="mks-results" aria-label={films.length ? "Your films" : "Templates"}>
        {films.length ? (
          <>
            <h2><Sparkles className="h-4 w-4" />Your films</h2>
            <StudioGallery items={films} now={now} handlers={gallery} />
          </>
        ) : null}
        <h2 className={films.length ? "prs-more" : undefined}><Film className="h-4 w-4" />{films.length ? "More templates" : "Start from a template"}</h2>
        <div className="mks-strip prs-strip">
          {PROMO_TEMPLATES.map((item) => (
            <TemplateCard key={item.id} item={item} selected={draft.template === item.id} onOpen={() => setModal({ preview: item.id })} compact />
          ))}
        </div>
        <p className="prs-credit-note">Template previews are the reference films each template was modeled on. Your film is built only from your own material.</p>
      </section>

      {modal ? <TemplateModal selected={draft.template} initialPreview={modal.preview} onPick={pickTemplate} onClose={() => setModal(null)} /> : null}
    </div>
  );
}

function Chip({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <span className="mks-chip">
      <button type="button" onClick={onClick}>
        {icon}
        <span>{label}</span>
        <ChevronDown className="h-3 w-3" />
      </button>
    </span>
  );
}

function SubjectChip({ value, onPick }: { value: string; onPick: (id: string) => void }) {
  const { open, setOpen, ref } = usePopover();
  const current = findPromoSubject(value);
  return (
    <div className="mks-pop" ref={ref}>
      <span className="mks-chip">
        <button type="button" aria-expanded={open} aria-haspopup="listbox" onClick={() => setOpen(!open)}>
          <Shapes className="h-3.5 w-3.5" />
          <span>{current.id === "auto" ? "Any subject" : current.name}</span>
          <ChevronDown className="h-3 w-3" />
        </button>
      </span>
      {open ? (
        <div className="mks-tech prs-subjects" role="listbox" aria-label="What you're promoting">
          {PROMO_SUBJECTS.map((item) => (
            <button key={item.id} type="button" role="option" aria-selected={item.id === value} className="prs-subject" onClick={() => { onPick(item.id); setOpen(false); }}>
              <span>
                <strong>{item.id === "auto" ? "Work it out" : item.name}</strong>
                <small>{item.id === "auto" ? "From your link, images, and notes" : item.hint}</small>
              </span>
              {item.id === value ? <Check className="h-3.5 w-3.5" /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function FormatPopover({ draft, patch, locked }: { draft: Draft; patch: (changes: Partial<Draft>) => void; locked: boolean }) {
  const { open, setOpen, ref } = usePopover();
  return (
    <div className="mks-pop" ref={ref}>
      <span className="mks-chip">
        <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} aria-label={`Format: ${draft.aspect}, ${draft.duration} seconds`}>
          <SlidersHorizontal className="h-3.5 w-3.5" />
          <span className="prs-num">{draft.aspect} · {draft.duration}s</span>
          <ChevronDown className="h-3 w-3" />
        </button>
      </span>
      {open ? (
        <div className="mks-tech prs-format" role="dialog" aria-label="Format">
          {locked ? <p className="prs-format-note">A revision keeps the film's size and length.</p> : null}
          <fieldset disabled={locked}>
            <legend><RectangleHorizontal className="h-3.5 w-3.5" />Aspect ratio</legend>
            <div className="prs-seg">
              {PROMO_ASPECTS.map((value) => (
                <button key={value} type="button" aria-pressed={draft.aspect === value} onClick={() => patch({ aspect: value })}>
                  <span className="prs-shape" data-aspect={value} aria-hidden="true" />
                  <span className="prs-num">{value}</span>
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset disabled={locked}>
            <legend><Clock className="h-3.5 w-3.5" />Length</legend>
            <div className="prs-seg">
              {PROMO_DURATIONS.map((value) => (
                <button key={value} type="button" aria-pressed={draft.duration === value} onClick={() => patch({ duration: value })}>
                  <span className="prs-num">{value}s</span>
                </button>
              ))}
            </div>
          </fieldset>
        </div>
      ) : null}
    </div>
  );
}

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// A muted loop that plays only while hovered or focused, so a page of them costs nothing,
// with a playhead so a playing card reads as live.
function useHoverLoop() {
  const video = useRef<HTMLVideoElement>(null);
  const bar = useRef<HTMLSpanElement>(null);
  const frame = useRef(0);
  const tick = () => {
    const el = video.current;
    if (el && bar.current && el.duration) bar.current.style.transform = `scaleX(${el.currentTime / el.duration})`;
    frame.current = requestAnimationFrame(tick);
  };
  const play = () => {
    const el = video.current;
    if (!el || reducedMotion()) return;
    void el
      .play()
      .then(() => {
        cancelAnimationFrame(frame.current);
        if (!el.paused) frame.current = requestAnimationFrame(tick);
      })
      .catch(() => undefined);
  };
  const stop = () => {
    cancelAnimationFrame(frame.current);
    const el = video.current;
    if (el) {
      el.pause();
      el.currentTime = 0;
    }
    if (bar.current) bar.current.style.transform = "scaleX(0)";
  };
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  return { video, bar, play, stop };
}

function TemplateSlot({ id, name, onClick }: { id: string; name: string; onClick: () => void }) {
  const loop = useHoverLoop();
  const preview = promoPreview(id);
  return (
    <button type="button" className="mks-slot prs-slot" onClick={onClick} onPointerEnter={loop.play} onPointerLeave={loop.stop} onFocus={loop.play} onBlur={loop.stop} aria-label={`Template: ${name}. Change template`}>
      <video key={id} ref={loop.video} src={preview.video} poster={preview.poster} muted loop playsInline preload="none" tabIndex={-1} aria-hidden="true" />
      <span>Template</span>
    </button>
  );
}

function TemplateCard({ item, selected, onOpen, compact }: { item: Template; selected: boolean; onOpen: () => void; compact?: boolean }) {
  const loop = useHoverLoop();
  const preview = promoPreview(item.id);
  return (
    <div className={`prs-card${compact ? " is-compact" : ""}${selected ? " is-selected" : ""}`} onPointerEnter={loop.play} onPointerLeave={loop.stop}>
      <button type="button" onClick={onOpen} onFocus={loop.play} onBlur={loop.stop} aria-haspopup="dialog" aria-label={`Preview ${item.name}${selected ? ", your current template" : ""}`}>
        <span className="prs-card-media">
          <video ref={loop.video} src={preview.video} poster={preview.poster} muted loop playsInline preload="none" tabIndex={-1} aria-hidden="true" />
          <span className="prs-card-meta prs-num">{item.aspect} · {item.duration}s</span>
          <span className="prs-card-cue" aria-hidden="true"><Play className="h-3 w-3" />Preview</span>
          <span className="prs-card-bar" ref={loop.bar} aria-hidden="true" />
        </span>
        <strong>{item.name}</strong>
        {!compact ? <span className="prs-card-text">{item.blurb}</span> : null}
      </button>
      {!compact ? (
        <a className="prs-card-credit" href={item.credit.url} target="_blank" rel="noreferrer">
          Reference by @{item.credit.handle}
          <ExternalLink className="h-3 w-3" aria-hidden="true" />
        </a>
      ) : null}
    </div>
  );
}

function TemplateModal({ selected, initialPreview, onPick, onClose }: { selected: string; initialPreview: string; onPick: (item: Template) => void; onClose: () => void }) {
  const [tab, setTab] = useState("all");
  const [preview, setPreview] = useState(initialPreview);
  // Opened straight onto a preview, Escape closes; opened from the grid, it goes back there.
  const [fromGrid, setFromGrid] = useState(!initialPreview);
  const close = useRef<HTMLButtonElement>(null);
  const current = preview ? findPromoTemplate(preview) : null;
  const step = (direction: number) => {
    const index = PROMO_TEMPLATES.findIndex((item) => item.id === preview);
    setPreview(PROMO_TEMPLATES[(index + direction + PROMO_TEMPLATES.length) % PROMO_TEMPLATES.length].id);
  };
  const back = () => {
    setFromGrid(true);
    setPreview("");
  };
  useEffect(() => {
    close.current?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
    };
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") return preview && fromGrid ? setPreview("") : onClose();
      // Arrow keys on the player seek; everywhere else in the preview they browse templates.
      if (!preview || (event.target as HTMLElement)?.tagName === "VIDEO") return;
      if (event.key === "ArrowLeft") step(-1);
      if (event.key === "ArrowRight") step(1);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });
  const shown = PROMO_TEMPLATES.filter((item) => tab === "all" || item.group === tab);
  return (
    <div className="mks-modal" onClick={onClose}>
      <div className="mks-sheet is-wide" role="dialog" aria-modal="true" aria-label={current ? `Preview: ${current.name}` : "Pick a template"} onClick={(event) => event.stopPropagation()}>
        <button ref={close} type="button" className="mks-close" aria-label="Close" onClick={onClose}><X className="h-4 w-4" /></button>
        {current ? (
          <TemplatePreview item={current} selected={selected === current.id} onUse={() => onPick(current)} onStep={step} onBack={back} />
        ) : (
          <>
            <h2 className="prs-sheet-title">Pick a template</h2>
            <p className="prs-sheet-sub">Each one sets the pacing and structure. The words, colors, and images come from your material.</p>
            <div className="mks-sheet-bar">
              <div className="mks-tabs" role="tablist" aria-label="Template type">
                {[["all", "All"], ["launch", "Launch"], ["explain", "Explain"], ["social", "Social"]].map(([value, label]) => (
                  <button key={value} type="button" role="tab" aria-selected={tab === value} onClick={() => setTab(value)}>{label}</button>
                ))}
              </div>
            </div>
            <div className="prs-cards">
              {shown.map((item) => (
                <TemplateCard key={item.id} item={item} selected={selected === item.id} onOpen={() => setPreview(item.id)} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// The full reference with sound and a scrubber, so the motion can be judged before committing.
function TemplatePreview({ item, selected, onUse, onStep, onBack }: { item: Template; selected: boolean; onUse: () => void; onStep: (direction: number) => void; onBack: () => void }) {
  const preview = promoPreview(item.id);
  const [fallback, setFallback] = useState(false);
  useEffect(() => setFallback(false), [item.id]);
  const index = PROMO_TEMPLATES.findIndex((entry) => entry.id === item.id);
  return (
    <div className="prs-preview">
      <div className="prs-preview-top">
        <button type="button" className="prs-back" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          All templates
        </button>
        <span className="prs-num prs-preview-count" aria-label={`Template ${index + 1} of ${PROMO_TEMPLATES.length}`}>{index + 1} / {PROMO_TEMPLATES.length}</span>
      </div>
      <div className="prs-preview-stage">
        <video
          key={item.id}
          src={fallback ? preview.video : preview.full}
          poster={preview.poster}
          controls
          autoPlay={!reducedMotion()}
          muted
          loop
          playsInline
          disablePictureInPicture
          controlsList="nodownload noplaybackrate noremoteplayback"
          onError={() => setFallback(true)}
          aria-label={`${item.name} reference film`}
        />
        <button type="button" className="prs-preview-nav is-prev" aria-label="Previous template" onClick={() => onStep(-1)}><ChevronLeft className="h-5 w-5" /></button>
        <button type="button" className="prs-preview-nav is-next" aria-label="Next template" onClick={() => onStep(1)}><ChevronRight className="h-5 w-5" /></button>
      </div>
      <div className="prs-preview-info">
        <div className="prs-preview-copy">
          <h2 className="prs-preview-title">{item.name}</h2>
          <p className="prs-preview-text">{item.blurb}</p>
          <p className="prs-preview-meta">
            <span className="prs-num">{item.aspect} · {item.duration}s</span>
            <span aria-hidden="true">·</span>
            <a href={item.credit.url} target="_blank" rel="noreferrer">
              Reference by @{item.credit.handle}
              <ExternalLink className="h-3 w-3" aria-hidden="true" />
            </a>
          </p>
        </div>
        <button type="button" className="prs-use" onClick={onUse}>
          {selected ? <Check className="h-4 w-4" aria-hidden="true" /> : null}
          {selected ? "Keep this template" : "Use this template"}
        </button>
      </div>
      <p className="prs-preview-note">This is the creator's reference film. Yours is built only from your own link, images, and notes.</p>
    </div>
  );
}
