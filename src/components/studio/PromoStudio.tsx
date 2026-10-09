// Promo Studio: a link, images, or a brief in; a motion-graphics film out.
// Opus 5.5 writes the film as code, checks its frames, and it is rendered
// with a music bed (server/promoStudio.js). Shares Marketing Studio's styles.
import { StudioLayout } from "../StudioLayout";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Check, ChevronDown, ChevronLeft, ChevronRight, Clock, ExternalLink, Film, Link2, Loader2, Music, Palette, Play, RectangleHorizontal, Shapes, SlidersHorizontal, X, Zap } from "lucide-react";
import { PROMO_ASPECTS, PROMO_DURATIONS, PROMO_SUBJECTS, PROMO_TEMPLATES, findPromoSubject, findPromoTemplate, promoPreview } from "../../utils/promoPresets";
import { PROMO_STYLES, PROMO_STYLE_SPRITE, findPromoStyle, promoStyleTile } from "../../utils/promoStyles";
import { AspectPicker, type Asset, type Catalog, Choice, type Generation, GenerationUnavailable, readJson, ReferenceTray, Segment, Toggle, usePopover } from "./studioShared";
import { SheetChip, StudioSheet } from "./MarketingStudio";
import { type GalleryHandlers, StudioGallery } from "./StudioGallery";
import { clearPendingTemplate, peekPendingTemplate } from "../../utils/promptTemplates";
import { useErrorToast } from "../../utils/toast";
import { CREDIT_ESTIMATE_TITLE, creditEstimateLabel, providerCreditEstimate, useStudioPricing } from "./studioPricing";
import "./MarketingStudio.css";
import "./PromoStudio.css";

type Template = (typeof PROMO_TEMPLATES)[number];
type Draft = { url: string; brief: string; uploads: Asset[]; template: string; subject: string; style: string; aspect: string; duration: number; music: boolean };
type Revision = { file: string; prompt: string; settings: Record<string, any> };
const DRAFT_KEY = "autoyt-promo-draft";
const MAX_UPLOADS = 8;
const initialDraft = (): Draft => {
  const template = PROMO_TEMPLATES[0];
  const base: Draft = { url: "", brief: "", uploads: [], template: template.id, subject: "auto", style: "", aspect: template.aspect, duration: template.duration, music: true };
  let saved: Draft = base;
  try {
    saved = { ...base, ...JSON.parse(window.localStorage.getItem(DRAFT_KEY) || "{}") };
  } catch {}
  // A template picked on the Create page wins over the saved draft.
  const pending = peekPendingTemplate("promo");
  if (!pending?.templateId) return saved;
  const picked = findPromoTemplate(pending.templateId);
  return { ...saved, template: picked.id, aspect: picked.aspect, duration: picked.duration, brief: pending.prompt || saved.brief };
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
  const [section, setSection] = useState<"films" | "templates" | "styles">("films");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useErrorToast(error, () => setError(""));
  const pricing = useStudioPricing();
  const brief = useRef<HTMLTextAreaElement>(null);
  const patch = (changes: Partial<Draft>) => setDraft((current) => ({ ...current, ...changes }));

  useEffect(() => clearPendingTemplate("promo"), []);
  useEffect(() => {
    try {
      window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {}
  }, [draft]);

  const template = findPromoTemplate(draft.template);
  const subject = findPromoSubject(draft.subject);
  const style = findPromoStyle(draft.style);
  const films = useMemo(() => generations.filter((item) => item.tab === "promo"), [generations]);
  const configured = catalog?.configured !== false;
  const hasMaterial = Boolean(draft.url.trim() || draft.uploads.length || draft.brief.trim());
  const ready = configured && !busy && (revision ? Boolean(draft.brief.trim()) : hasMaterial);
  const duration = revision ? Number(revision.settings.duration) || draft.duration : draft.duration;
  const credits = providerCreditEstimate(estimateUsd(duration), pricing);
  const missing = revision ? (draft.brief.trim() ? "" : "Say what to change") : hasMaterial ? "" : "Add a link, images, or a description";

  function pickTemplate(item: Template) {
    // The template's own shape is the default; a length or aspect chosen by hand wins until the next pick.
    patch({ template: item.id, aspect: item.aspect, duration: item.duration });
    setModal(null);
  }

  async function generate() {
    setBusy(true);
    setError("");
    try {
      const settings = revision
        ? { ...revision.settings, baseFile: revision.file, music: draft.music, uploads: draft.uploads.map((u) => ({ file: u.file, label: u.name })) }
        : { template: template.id, subject: subject.id, style: style?.id, aspectRatio: draft.aspect, duration: draft.duration, music: draft.music, sourceUrl: draft.url.trim() || undefined, uploads: draft.uploads.map((u) => ({ file: u.file, label: u.name })) };
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
        style: findPromoStyle(s.style)?.id || "",
        aspect: PROMO_ASPECTS.includes(s.aspectRatio) ? s.aspectRatio : draft.aspect,
        duration: PROMO_DURATIONS.includes(Number(s.duration)) ? Number(s.duration) : draft.duration,
        music: s.music !== false,
      });
    },
  };

  const shownSection = section === "films" && !films.length ? "templates" : section;
  return (
    <div className="mks prs">
      <StudioLayout
        title="Launch anything in motion"
        intro="Paste a link, drop in images, or just describe it. Opus 5.5 writes a motion-graphics film in your brand, checks every frame, and scores it to music."
        composer={
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
                  <ReferenceTray
                    className="prs-uploads"
                    assets={draft.uploads}
                    max={MAX_UPLOADS}
                    label="images"
                    onChange={(uploads) => patch({ uploads })}
                    onError={setError}
                    empty="Logo, screenshots, product photos"
                  />
                </div>
                <div className="mks-row">
                  {!revision ? (
                    <>
                      <SheetChip icon={<Film className="h-3.5 w-3.5" />} label={template.name} onClick={() => setModal({ preview: "" })} />
                      <StyleChip value={style?.id || ""} onPick={(id) => patch({ style: id })} />
                      <Choice
                        skin="mks"
                        label="What you're promoting"
                        icon={<Shapes className="h-3.5 w-3.5" />}
                        value={subject.id}
                        onChange={(id) => patch({ subject: id })}
                        options={PROMO_SUBJECTS.map((item) => (item.id === "auto" ? { value: item.id, label: "Any subject", hint: "Worked out from your link, images, and notes" } : { value: item.id, label: item.name, hint: item.hint }))}
                      />
                    </>
                  ) : null}
                  <FormatPopover draft={draft} patch={patch} locked={Boolean(revision)} />
                  <Toggle className="mks-toggle" icon={<Music className="h-3.5 w-3.5" />} label="Music" value={draft.music} onChange={(music) => patch({ music })} />
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
        }
        notices={(missing && !busy) || !configured || (catalog?.promo && !catalog.promo.renderer) ? <>
          {missing && !busy ? <p className="mks-hint">{missing}</p> : null}
          {!configured ? <GenerationUnavailable className="mks-notice" /> : catalog?.promo && !catalog.promo.renderer ? <p className="mks-hint">This server can't render video yet, so films come back as live HTML you can play and revise.</p> : null}
        </> : null}
        tabsLabel="Promo sections"
        tabs={[...(films.length ? [{ value: "films", label: "Your films", hint: String(films.length) }] : []), { value: "templates", label: "Templates" }, { value: "styles", label: "Styles" }]}
        tab={shownSection}
        onTab={(next) => setSection(next as "films" | "templates" | "styles")}
      >
        {shownSection === "films" ? (
          <StudioGallery items={films} now={now} handlers={gallery} />
        ) : shownSection === "templates" ? (
          <div className="sl-grid prs-grid">
            {PROMO_TEMPLATES.map((item) => (
              <TemplateCard key={item.id} item={item} selected={draft.template === item.id} onOpen={() => setModal({ preview: item.id })} compact />
            ))}
          </div>
        ) : (
          <div className="sl-grid prs-grid prs-style-strip">
            {PROMO_STYLES.map((item) => (
              <StyleCard key={item.id} item={item} selected={draft.style === item.id} onPick={() => patch({ style: draft.style === item.id ? "" : item.id })} />
            ))}
          </div>
        )}
        <p className="prs-credit-note">
          Template previews are the reference films each template was modeled on. Styles are adapted from{" "}
          <a href="https://github.com/Vincentwei1021/mg-styles-15" target="_blank" rel="noreferrer">mg-styles-15</a>, and each is scored in its own genre. Your film is built only from your own material.
        </p>
      </StudioLayout>

      {modal ? <TemplateModal selected={draft.template} initialPreview={modal.preview} onPick={pickTemplate} onClose={() => setModal(null)} /> : null}
    </div>
  );
}

type Style = (typeof PROMO_STYLES)[number];

function StyleThumb({ id }: { id: string }) {
  const tile = promoStyleTile(id);
  if (!tile) return null;
  return (
    <span
      className="prs-style-thumb"
      aria-hidden="true"
      style={{ backgroundImage: `url(${PROMO_STYLE_SPRITE.url})`, backgroundSize: `${tile.cols * 100}% ${tile.rows * 100}%`, backgroundPosition: `${tile.x}% ${tile.y}%` }}
    />
  );
}

function StyleCard({ item, selected, onPick }: { item: Style; selected: boolean; onPick: () => void }) {
  return (
    <div className={`prs-card is-compact${selected ? " is-selected" : ""}`}>
      <button type="button" onClick={onPick} aria-pressed={selected} title={item.blurb}>
        <span className="prs-card-media"><StyleThumb id={item.id} /></span>
        <strong>{item.name}</strong>
      </button>
    </div>
  );
}

function StyleChip({ value, onPick }: { value: string; onPick: (id: string) => void }) {
  const { open, setOpen, ref } = usePopover();
  const current = findPromoStyle(value);
  const pick = (id: string) => { onPick(id); setOpen(false); };
  return (
    <div className="mks-pop" ref={ref}>
      <span className="mks-chip">
        <button type="button" aria-expanded={open} aria-haspopup="listbox" onClick={() => setOpen(!open)}>
          <Palette className="h-3.5 w-3.5" />
          <span>{current ? current.name : "Template look"}</span>
          <ChevronDown className="h-3 w-3" />
        </button>
      </span>
      {open ? (
        <div className="mks-tech prs-styles" role="listbox" aria-label="Style">
          <button type="button" role="option" aria-selected={!current} className="prs-subject" onClick={() => pick("")}>
            <span>
              <strong>Template look</strong>
              <small>Clean motion design in your brand's colours and type</small>
            </span>
            {!current ? <Check className="h-3.5 w-3.5" /> : null}
          </button>
          <div className="prs-style-grid">
            {PROMO_STYLES.map((item) => (
              <button key={item.id} type="button" role="option" aria-selected={item.id === value} className="prs-style-option" title={item.blurb} onClick={() => pick(item.id)}>
                <StyleThumb id={item.id} />
                <span>{item.name}</span>
              </button>
            ))}
          </div>
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
            <AspectPicker value={draft.aspect} options={PROMO_ASPECTS} onChange={(aspect) => patch({ aspect })} disabled={locked} />
          </fieldset>
          <fieldset disabled={locked}>
            <legend><Clock className="h-3.5 w-3.5" />Length</legend>
            <Segment className="cs-tile-seg is-tiles" label="Length" value={String(draft.duration)} options={PROMO_DURATIONS.map((value) => ({ value: String(value), label: <span className="prs-num">{value}s</span>, disabled: locked }))} onChange={(value) => patch({ duration: Number(value) })} />
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
  const current = preview ? findPromoTemplate(preview) : null;
  const step = (direction: number) => {
    const index = PROMO_TEMPLATES.findIndex((item) => item.id === preview);
    setPreview(PROMO_TEMPLATES[(index + direction + PROMO_TEMPLATES.length) % PROMO_TEMPLATES.length].id);
  };
  const back = () => {
    setFromGrid(true);
    setPreview("");
  };
  // Escape (and the backdrop) step back to the grid from a preview opened there; otherwise they close.
  const dismiss = () => (preview && fromGrid ? setPreview("") : onClose());
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
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
    <StudioSheet wide scope="prs" label={current ? `Preview: ${current.name}` : "Pick a template"} onClose={dismiss}>
        {current ? (
          <TemplatePreview item={current} selected={selected === current.id} onUse={() => onPick(current)} onStep={step} onBack={back} />
        ) : (
          <>
            <h2 className="prs-sheet-title">Pick a template</h2>
            <p className="prs-sheet-sub">Each one sets the pacing and structure. The words, colors, and images come from your material.</p>
            <div className="mks-sheet-bar">
              <Segment className="mks-tabs" label="Template type" value={tab} onChange={setTab} options={[{ value: "all", label: "All" }, { value: "launch", label: "Launch" }, { value: "explain", label: "Explain" }, { value: "social", label: "Social" }]} />
            </div>
            <div className="prs-cards">
              {shown.map((item) => (
                <TemplateCard key={item.id} item={item} selected={selected === item.id} onOpen={() => setPreview(item.id)} />
              ))}
            </div>
          </>
        )}
    </StudioSheet>
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
        <button type="button" className="ui-btn is-primary is-lg prs-use" onClick={onUse}>
          {selected ? <Check className="h-4 w-4" aria-hidden="true" /> : null}
          {selected ? "Keep this template" : "Use this template"}
        </button>
      </div>
      <p className="prs-preview-note">This is the creator's reference film. Yours is built only from your own link, images, and notes.</p>
    </div>
  );
}
