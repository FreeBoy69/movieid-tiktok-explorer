// Promo Studio: a link, images, or a brief in; a motion-graphics film out.
// Opus 5.5 writes the film as code, checks its frames, and it is rendered
// with a music bed (server/promoStudio.js). Shares Marketing Studio's styles.
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Clock, ExternalLink, Film, ImagePlus, Link2, Loader2, Music, RectangleHorizontal, Shapes, SlidersHorizontal, Sparkles, X, Zap } from "lucide-react";
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
// Opus tokens for the storyboard, the film, and two review rounds, plus the music bed.
const estimateUsd = (duration: number, music: boolean) => 1.1 + duration * 0.045 + (music ? 0.08 : 0);
const estimateMinutes = (duration: number, revising: boolean) => (revising ? "2–3" : duration <= 15 ? "3–4" : duration <= 30 ? "4–5" : "5–7");

export function PromoStudio({ generations, now, handlers, onCreated, catalog }: { generations: Generation[]; now: number; handlers: GalleryHandlers; onCreated: (item: Generation) => void; catalog: Catalog | null }) {
  const [draft, setDraft] = useState<Draft>(initialDraft);
  const [revision, setRevision] = useState<Revision | null>(null);
  const [modal, setModal] = useState<"" | "template">("");
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
  const credits = providerCreditEstimate(estimateUsd(duration, draft.music), pricing);
  const missing = revision ? (draft.brief.trim() ? "" : "Say what to change") : hasMaterial ? "" : "Add a link, images, or a description";

  function pickTemplate(item: Template) {
    // The template's own shape is the default; a length or aspect chosen by hand wins until the next pick.
    patch({ template: item.id, aspect: item.aspect, duration: item.duration });
    setModal("");
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
                      <Chip icon={<Film className="h-3.5 w-3.5" />} label={template.name} onClick={() => setModal("template")} />
                      <SubjectChip value={subject.id} onPick={(id) => patch({ subject: id })} />
                    </>
                  ) : null}
                  <FormatPopover draft={draft} patch={patch} locked={Boolean(revision)} />
                  <button type="button" className={`mks-chip prs-toggle${draft.music ? " is-on" : ""}`} aria-pressed={draft.music} onClick={() => patch({ music: !draft.music })} disabled={catalog?.promo?.music === false}>
                    <Music className="h-3.5 w-3.5" />
                    <span>{catalog?.promo?.music === false ? "No music" : draft.music ? "Music" : "Silent"}</span>
                  </button>
                </div>
              </div>
              <div className="mks-cluster">
                {!revision ? (
                  <button type="button" className="mks-slot prs-slot" onClick={() => setModal("template")} aria-label={`Template: ${template.name}. Change template`}>
                    <img src={promoPreview(template.id).poster} alt="" />
                    <span>Template</span>
                  </button>
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
            <TemplateCard key={item.id} item={item} selected={draft.template === item.id} onPick={() => pickTemplate(item)} compact />
          ))}
        </div>
        <p className="prs-credit-note">Template previews are the reference films each template was modeled on. Your film is built only from your own material.</p>
      </section>

      {modal === "template" ? <TemplateModal selected={draft.template} onPick={pickTemplate} onClose={() => setModal("")} /> : null}
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

// Previews stay still until hovered or focused, so a page of them costs nothing.
function TemplateCard({ item, selected, onPick, compact }: { item: Template; selected: boolean; onPick: () => void; compact?: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const preview = promoPreview(item.id);
  const play = () => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    void video.current?.play().catch(() => undefined);
  };
  const pause = () => {
    const el = video.current;
    if (!el) return;
    el.pause();
    el.currentTime = 0;
  };
  return (
    <div className={compact ? "prs-card is-compact" : "prs-card"} onMouseEnter={play} onMouseLeave={pause}>
      <button type="button" aria-pressed={selected} onClick={onPick} onFocus={play} onBlur={pause}>
        <span className="prs-card-media">
          <video ref={video} src={preview.video} poster={preview.poster} muted loop playsInline preload="none" tabIndex={-1} aria-hidden="true" />
          <span className="prs-card-meta prs-num">{item.aspect} · {item.duration}s</span>
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

function TemplateModal({ selected, onPick, onClose }: { selected: string; onPick: (item: Template) => void; onClose: () => void }) {
  const [tab, setTab] = useState("all");
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    close.current?.focus();
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);
  const shown = PROMO_TEMPLATES.filter((item) => tab === "all" || item.group === tab);
  return (
    <div className="mks-modal" onClick={onClose}>
      <div className="mks-sheet is-wide" role="dialog" aria-modal="true" aria-label="Pick a template" onClick={(event) => event.stopPropagation()}>
        <button ref={close} type="button" className="mks-close" aria-label="Close" onClick={onClose}><X className="h-4 w-4" /></button>
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
            <TemplateCard key={item.id} item={item} selected={selected === item.id} onPick={() => onPick(item)} />
          ))}
        </div>
      </div>
    </div>
  );
}