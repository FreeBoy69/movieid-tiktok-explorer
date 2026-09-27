// Explainer Studio: walkthrough and explainer videos narrated in your own
// (cloned) voice or a built-in one. Two steps: Opus 5.5 reads the site and
// drafts a chaptered script (server/explainerStudio.js, plan), you edit it and
// pick a voice, then the film is written chapter by chapter on the narration's
// timing and rendered (film). Shares Promo Studio's page styles.
import { type ReactNode, type TextareaHTMLAttributes, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Captions,
  ChevronDown,
  Clock,
  FileText,
  Film,
  ImagePlus,
  Link2,
  ListChecks,
  Loader2,
  MonitorPlay,
  Music,
  Plus,
  Presentation,
  RectangleHorizontal,
  Sparkles,
  Trash2,
  Video,
  X,
  Zap,
} from "lucide-react";
import {
  EXPLAINER_ASPECTS,
  EXPLAINER_LENGTHS,
  EXPLAINER_LIMITS,
  EXPLAINER_MAX_SECONDS,
  EXPLAINER_MAX_WORDS,
  EXPLAINER_TEMPLATES,
  countWords,
  estimateScriptSeconds,
  findExplainerTemplate,
  normalizeExplainerScript,
  scriptWords,
} from "../../utils/explainerPresets";
import { isVoiceReady, loadVoiceProfiles, type VoiceProfile } from "../../utils/voiceProfiles";
import { VoicePicker } from "../VoicePicker";
import { type Asset, type Catalog, type ExplainerChapter, type ExplainerPlan, type ExplainerScript, type Generation, readJson, timeAgo, uploadAsset, usePopover } from "./studioShared";
import { type GalleryHandlers, StudioGallery } from "./StudioGallery";
import { VoiceCloneSheet } from "./VoiceCloneSheet";
import { useErrorToast } from "../../utils/toast";
import { CREDIT_ESTIMATE_TITLE, creditEstimateLabel, providerCreditEstimate, useStudioPricing } from "./studioPricing";
import "./MarketingStudio.css";
import "./PromoStudio.css";
import "./ExplainerStudio.css";

type Draft = {
  url: string;
  notes: string;
  uploads: Asset[];
  recordings: Asset[];
  template: string;
  length: number;
  voiceId: string;
  aspect: string;
  captions: boolean;
  music: boolean;
};
type Editing = { key: string; planId: string; kitFile: string; thumbsFile?: string; baseFile?: string; plan: ExplainerPlan; script: ExplainerScript };

const DRAFT_KEY = "autoyt-explainer-draft";
const SCRIPT_KEY = (key: string) => `autoyt-explainer-script:${key}`;
const MAX_UPLOADS = 10;
const MAX_RECORDINGS = 3;
const initialDraft = (): Draft => {
  const base: Draft = { url: "", notes: "", uploads: [], recordings: [], template: EXPLAINER_TEMPLATES[0].id, length: EXPLAINER_TEMPLATES[0].length, voiceId: "", aspect: "16:9", captions: true, music: true };
  try {
    return { ...base, ...JSON.parse(window.localStorage.getItem(DRAFT_KEY) || "{}") };
  } catch {
    return base;
  }
};
const readSaved = (key: string): ExplainerScript | null => {
  try {
    const saved = JSON.parse(window.localStorage.getItem(SCRIPT_KEY(key)) || "null");
    return saved?.chapters ? normalizeExplainerScript(saved) : null;
  } catch {
    return null;
  }
};
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, "0")}`;
const newId = () => `c${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
// One Opus pass over the material for the plan; a film is one Opus write plus one review per chapter.
const planUsd = 0.6;
const filmUsd = (chapters: number) => 0.3 + chapters * 0.45;
// Writing chapters runs three at a time; rendering takes about ten seconds per second of video.
const filmMinutes = (seconds: number, chapters: number) => Math.round(4 + Math.ceil(chapters / 3) * 3 + (seconds * 10) / 60);

export function ExplainerStudio({ generations, now, handlers, onCreated, catalog }: { generations: Generation[]; now: number; handlers: GalleryHandlers; onCreated: (item: Generation) => void; catalog: Catalog | null }) {
  const [draft, setDraft] = useState<Draft>(initialDraft);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [voices, setVoices] = useState<VoiceProfile[]>([]);
  const [voicesLoading, setVoicesLoading] = useState(true);
  const [voiceError, setVoiceError] = useState("");
  const [cloning, setCloning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState("");
  const [error, setError] = useState("");
  useErrorToast(error, () => setError(""));
  const pricing = useStudioPricing();
  const images = useRef<HTMLInputElement>(null);
  const videos = useRef<HTMLInputElement>(null);
  const top = useRef<HTMLDivElement>(null);
  const patch = (changes: Partial<Draft>) => setDraft((current) => ({ ...current, ...changes }));
  const configured = catalog?.configured !== false;

  useEffect(() => {
    try {
      window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {}
  }, [draft]);

  const items = useMemo(() => generations.filter((item) => item.tab === "explainer"), [generations]);
  const plans = useMemo(() => items.filter((item) => item.settings?.stage !== "film" && item.status === "done" && item.plan), [items]);
  const shown = useMemo(() => items.filter((item) => !(item.settings?.stage !== "film" && item.status === "done")), [items]);

  const reloadVoices = useCallback(async (select?: string) => {
    setVoicesLoading(true);
    const { profiles, error: message } = await loadVoiceProfiles();
    setVoices(profiles);
    setVoiceError(message);
    setVoicesLoading(false);
    const ready = profiles.filter(isVoiceReady);
    setDraft((current) => {
      if (select && ready.some((voice) => voice.id === select)) return { ...current, voiceId: select };
      if (ready.some((voice) => voice.id === current.voiceId)) return current;
      const mine = ready.find((voice) => (voice as VoiceProfile & { owned?: boolean }).owned);
      return { ...current, voiceId: (mine || ready.find((voice) => voice.id.startsWith("openrouter:")) || ready[0])?.id || "" };
    });
  }, []);
  useEffect(() => {
    void reloadVoices();
  }, [reloadVoices]);

  // Keep the editor's work across reloads, per plan or film.
  useEffect(() => {
    if (!editing) return;
    try {
      window.localStorage.setItem(SCRIPT_KEY(editing.key), JSON.stringify(editing.script));
    } catch {}
  }, [editing]);

  useEffect(() => {
    if (!editing?.thumbsFile) return setThumbs({});
    let cancelled = false;
    fetch(`/api/studio/files/${encodeURIComponent(editing.thumbsFile)}`)
      .then((response) => (response.ok ? response.json() : {}))
      .then((data: unknown) => !cancelled && setThumbs(data && typeof data === "object" ? (data as Record<string, string>) : {}))
      .catch(() => !cancelled && setThumbs({}));
    return () => {
      cancelled = true;
    };
  }, [editing?.thumbsFile]);

  const openPlan = useCallback((item: Generation) => {
    if (!item.plan || !item.kit?.file) return;
    const key = `plan:${item.id}`;
    setEditing({ key, planId: item.id, kitFile: item.kit.file, thumbsFile: item.thumbs?.file, plan: item.plan, script: readSaved(key) || normalizeExplainerScript(item.plan) });
    window.setTimeout(() => top.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }, []);
  const openFilm = useCallback((item: Generation) => {
    const s = item.settings || {};
    const plan = items.find((entry) => entry.id === s.planId);
    if (!s.kitFile || !s.script) return;
    const key = `film:${item.id}`;
    setEditing({
      key,
      planId: s.planId || "",
      kitFile: s.kitFile,
      thumbsFile: plan?.thumbs?.file,
      baseFile: item.source?.file,
      plan: plan?.plan || { ...normalizeExplainerScript(s.script), template: s.template, length: 90 },
      script: readSaved(key) || normalizeExplainerScript(s.script),
    });
    patch({ aspect: EXPLAINER_ASPECTS.includes(s.aspectRatio) ? s.aspectRatio : draft.aspect, captions: s.captions !== false, music: s.music !== false, ...(s.voiceId ? { voiceId: s.voiceId } : {}) });
    window.setTimeout(() => top.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }, [items, draft.aspect]);

  // A plan that finishes while you're on the page opens straight into the editor.
  const seen = useRef(new Map<string, string>());
  useEffect(() => {
    for (const item of items) {
      const before = seen.current.get(item.id);
      if (before && before !== "done" && item.status === "done" && item.settings?.stage !== "film" && !editing) openPlan(item);
      seen.current.set(item.id, item.status);
    }
  }, [items, editing, openPlan]);

  async function addFiles(files: File[], kind: "image" | "video") {
    const list = kind === "image" ? draft.uploads : draft.recordings;
    const room = (kind === "image" ? MAX_UPLOADS : MAX_RECORDINGS) - list.length;
    if (room <= 0) return;
    const accepted = files.filter((f) => (kind === "image" ? /^image\/(png|jpeg|webp)$/ : /^video\/(mp4|quicktime|webm)$/).test(f.type)).slice(0, room);
    if (!accepted.length) return setError(kind === "image" ? "Use PNG, JPG, or WebP screenshots" : "Use an MP4, MOV, or WebM screen recording");
    setUploading(kind);
    try {
      const added: Asset[] = [];
      for (const f of accepted) {
        if (kind === "video" && f.size > 200 * 1024 * 1024) throw new Error("Screen recordings can be up to 200 MB");
        added.push(await uploadAsset(f, f.name.replace(/\.[^.]+$/, "")));
      }
      setDraft((current) => (kind === "image" ? { ...current, uploads: [...current.uploads, ...added].slice(0, MAX_UPLOADS) } : { ...current, recordings: [...current.recordings, ...added].slice(0, MAX_RECORDINGS) }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading("");
    }
  }

  const hasMaterial = Boolean(draft.url.trim() || draft.notes.trim() || draft.uploads.length || draft.recordings.length);
  async function plan() {
    setBusy(true);
    setError("");
    try {
      const data = await readJson(
        await fetch("/api/studio/generations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tab: "explainer",
            model: "",
            prompt: draft.notes.trim(),
            settings: {
              stage: "plan",
              template: draft.template,
              length: draft.length,
              sourceUrl: draft.url.trim() || undefined,
              uploads: draft.uploads.map((u) => ({ file: u.file, label: u.name })),
              recordings: draft.recordings.map((u) => ({ file: u.file, label: u.name })),
            },
          }),
        }),
        "Couldn't start the script",
      );
      onCreated(data.generation);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't start the script");
    } finally {
      setBusy(false);
    }
  }

  async function makeFilm() {
    if (!editing) return;
    setBusy(true);
    setError("");
    try {
      const data = await readJson(
        await fetch("/api/studio/generations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tab: "explainer",
            model: "",
            prompt: editing.script.title || editing.plan.title || "Walkthrough",
            settings: {
              stage: "film",
              template: editing.plan.template,
              planId: editing.planId || undefined,
              kitFile: editing.kitFile,
              baseFile: editing.baseFile,
              script: editing.script,
              voiceId: draft.voiceId,
              aspectRatio: draft.aspect,
              captions: draft.captions,
              music: draft.music,
            },
          }),
        }),
        "Couldn't start the video",
      );
      onCreated(data.generation);
      document.querySelector(".exs-films")?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't start the video");
    } finally {
      setBusy(false);
    }
  }

  const template = findExplainerTemplate(draft.template);
  const planCredits = providerCreditEstimate(planUsd, pricing);
  const gallery: GalleryHandlers = {
    ...handlers,
    modelName: () => "Explainer Studio",
    onRevise: (source) => {
      const item = items.find((entry) => entry.source?.file === source);
      if (item) openFilm(item);
    },
    onReuse: (item) => (item.settings?.stage === "film" ? openFilm(item) : item.plan ? openPlan(item) : undefined),
  };

  return (
    <div className="mks prs exs" ref={top}>
      {editing ? (
        <ScriptEditor
          editing={editing}
          setScript={(script) => setEditing((current) => (current ? { ...current, script } : current))}
          thumbs={thumbs}
          draft={draft}
          patch={patch}
          voices={voices}
          voicesLoading={voicesLoading}
          voiceError={voiceError}
          onClone={() => setCloning(true)}
          onBack={() => setEditing(null)}
          onReset={() => setEditing((current) => (current ? { ...current, script: normalizeExplainerScript(current.plan) } : current))}
          onMake={() => void makeFilm()}
          busy={busy}
          configured={configured}
          renderer={catalog?.explainer?.renderer !== false}
        />
      ) : (
        <section className="mks-hero">
          <h1>
            Walk people
            <br />
            through it
          </h1>
          <p className="prs-lede">Paste your site, add screenshots or a screen recording. Opus 5.5 finds the features and drafts the script; you edit it, pick your own cloned voice or a built-in one, and get a narrated walkthrough.</p>
          <div className="mks-dock prs-dock">
            <div className="mks-bar">
              <label className="prs-link">
                <Link2 className="h-4 w-4" aria-hidden="true" />
                <input value={draft.url} onChange={(event) => patch({ url: event.target.value })} placeholder="yoursite.com" aria-label="Website link" inputMode="url" autoComplete="url" spellCheck={false} maxLength={500} />
                {draft.url ? <button type="button" aria-label="Clear link" onClick={() => patch({ url: "" })}><X className="h-3.5 w-3.5" /></button> : null}
              </label>
              <div className="mks-bar-body">
                <div className="mks-bar-main">
                  <textarea
                    className="mks-brief"
                    rows={3}
                    value={draft.notes}
                    onChange={(event) => patch({ notes: event.target.value })}
                    placeholder="What should viewers learn? Features to cover, who it's for, the task to show, and where to send them at the end."
                    aria-label="What the video should cover"
                    maxLength={4000}
                  />
                  <div className="mks-row">
                    <button type="button" className="mks-plus" aria-label="Add screenshots" title="Add screenshots of screens behind a login" disabled={Boolean(uploading) || draft.uploads.length >= MAX_UPLOADS} onClick={() => images.current?.click()}>
                      {uploading === "image" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
                    </button>
                    <button type="button" className="mks-plus" aria-label="Add a screen recording" title="Add a screen recording (MP4, MOV, WebM)" disabled={Boolean(uploading) || draft.recordings.length >= MAX_RECORDINGS} onClick={() => videos.current?.click()}>
                      {uploading === "video" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Video className="h-4 w-4" />}
                    </button>
                    {[...draft.uploads.map((asset) => ({ asset, kind: "image" as const })), ...draft.recordings.map((asset) => ({ asset, kind: "video" as const }))].map(({ asset, kind }) => (
                      <span key={asset.file} className="mks-tag prs-thumb">
                        {kind === "image" ? <img src={asset.url} alt="" /> : <MonitorPlay className="h-4 w-4 exs-tag-icon" aria-hidden="true" />}
                        <span>{asset.name || (kind === "image" ? "Screenshot" : "Recording")}</span>
                        <button type="button" aria-label={`Remove ${asset.name || kind}`} onClick={() => patch(kind === "image" ? { uploads: draft.uploads.filter((u) => u.file !== asset.file) } : { recordings: draft.recordings.filter((u) => u.file !== asset.file) })}><X className="h-3 w-3" /></button>
                      </span>
                    ))}
                    {!draft.uploads.length && !draft.recordings.length ? <span className="prs-drop-hint">Screenshots or a screen recording, for screens behind a login</span> : null}
                    <input ref={images} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={(event) => { const files = Array.from(event.target.files || []); event.target.value = ""; void addFiles(files, "image"); }} />
                    <input ref={videos} type="file" accept="video/mp4,video/quicktime,video/webm" hidden onChange={(event) => { const files = Array.from(event.target.files || []); event.target.value = ""; void addFiles(files, "video"); }} />
                  </div>
                  <div className="mks-row">
                    <TemplateChip value={draft.template} onPick={(id) => patch({ template: id, length: findExplainerTemplate(id).length })} />
                    <LengthChip value={draft.length} onPick={(length) => patch({ length })} />
                  </div>
                </div>
                <div className="mks-cluster">
                  <button type="button" className="mks-generate" disabled={!configured || busy || Boolean(uploading) || !hasMaterial} onClick={() => void plan()} title={hasMaterial ? undefined : "Add a link, screenshots, a recording, or a description"}>
                    {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <span>Draft script</span>}
                    {planCredits !== null ? <small title={CREDIT_ESTIMATE_TITLE}><Zap className="h-3 w-3" />{creditEstimateLabel(planCredits)}</small> : null}
                    <small className="prs-eta"><Clock className="h-3 w-3" />2–4 min</small>
                  </button>
                </div>
              </div>
            </div>
          </div>
          {!hasMaterial && !busy ? <p className="mks-hint">Add a link, screenshots, a recording, or a description</p> : <p className="mks-hint">{template.name}: {template.blurb.toLowerCase()}. You'll review the script before anything is recorded.</p>}
          {!configured ? <p className="mks-error">Generation isn't set up on this server yet.</p> : null}
        </section>
      )}

      <section className="mks-results exs-films" aria-label="Your walkthroughs">
        {plans.length ? (
          <>
            <h2><FileText className="h-4 w-4" />Drafted scripts</h2>
            <ul className="exs-drafts">
              {plans.map((item) => (
                <li key={item.id} className={editing?.planId === item.id && !editing.baseFile ? "is-open" : undefined}>
                  <button type="button" className="exs-draft" onClick={() => openPlan(item)}>
                    <strong>{item.plan?.title || "Walkthrough"}</strong>
                    <span>{item.plan?.chapters.length || 0} chapters · {scriptWords(item.plan)} words · {findExplainerTemplate(item.plan?.template).name} · {timeAgo(item.createdAt, now)}</span>
                  </button>
                  <button type="button" className="exs-icon" aria-label={`Delete the script "${item.plan?.title || "Walkthrough"}"`} onClick={() => handlers.onDelete(item)}><Trash2 className="h-3.5 w-3.5" /></button>
                </li>
              ))}
            </ul>
          </>
        ) : null}
        {shown.length ? (
          <>
            <h2 className={plans.length ? "prs-more" : undefined}><Sparkles className="h-4 w-4" />Your walkthroughs</h2>
            <StudioGallery items={shown} now={now} handlers={gallery} />
          </>
        ) : !plans.length ? (
          <div className="exs-how">
            <h2><ListChecks className="h-4 w-4" />How it works</h2>
            <ol>
              <li><strong>Draft</strong><span>Opus 5.5 reads your site and screens, lists the features, and writes a chaptered script with on-screen cues.</span></li>
              <li><strong>Edit</strong><span>Change any line, reorder chapters, pick the screenshots each chapter shows, and choose the voice.</span></li>
              <li><strong>Narrate</strong><span>Your cloned voice (or a built-in one) reads it; every chapter is animated to the narration's exact timing, with captions.</span></li>
            </ol>
          </div>
        ) : null}
      </section>

      {cloning ? (
        <VoiceCloneSheet
          onClose={() => setCloning(false)}
          onCreated={(id) => {
            setCloning(false);
            void reloadVoices(id);
          }}
        />
      ) : null}
    </div>
  );
}

function TemplateChip({ value, onPick }: { value: string; onPick: (id: string) => void }) {
  const { open, setOpen, ref } = usePopover();
  const current = findExplainerTemplate(value);
  return (
    <div className="mks-pop" ref={ref}>
      <span className="mks-chip">
        <button type="button" aria-expanded={open} aria-haspopup="listbox" onClick={() => setOpen(!open)}>
          <Presentation className="h-3.5 w-3.5" />
          <span>{current.name}</span>
          <ChevronDown className="h-3 w-3" />
        </button>
      </span>
      {open ? (
        <div className="mks-tech prs-subjects" role="listbox" aria-label="Walkthrough type">
          {EXPLAINER_TEMPLATES.map((item) => (
            <button key={item.id} type="button" role="option" aria-selected={item.id === value} className="prs-subject" onClick={() => { onPick(item.id); setOpen(false); }}>
              <span>
                <strong>{item.name}</strong>
                <small>{item.blurb}</small>
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function LengthChip({ value, onPick }: { value: number; onPick: (length: number) => void }) {
  const { open, setOpen, ref } = usePopover();
  return (
    <div className="mks-pop" ref={ref}>
      <span className="mks-chip">
        <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} aria-label={`Length: about ${value} seconds`}>
          <Clock className="h-3.5 w-3.5" />
          <span className="prs-num">~{clock(value)}</span>
          <ChevronDown className="h-3 w-3" />
        </button>
      </span>
      {open ? (
        <div className="mks-tech prs-format" role="dialog" aria-label="Length">
          <fieldset>
            <legend><Clock className="h-3.5 w-3.5" />About how long</legend>
            <div className="prs-seg exs-seg-4">
              {EXPLAINER_LENGTHS.map((length) => (
                <button key={length} type="button" aria-pressed={value === length} onClick={() => { onPick(length); setOpen(false); }}>
                  <span className="prs-num">{clock(length)}</span>
                </button>
              ))}
            </div>
          </fieldset>
          <p className="prs-format-note">The narration sets the final length. Up to {EXPLAINER_MAX_SECONDS / 60} minutes.</p>
        </div>
      ) : null}
    </div>
  );
}

function ScriptEditor({
  editing,
  setScript,
  thumbs,
  draft,
  patch,
  voices,
  voicesLoading,
  voiceError,
  onClone,
  onBack,
  onReset,
  onMake,
  busy,
  configured,
  renderer,
}: {
  editing: Editing;
  setScript: (script: ExplainerScript) => void;
  thumbs: Record<string, string>;
  draft: Draft;
  patch: (changes: Partial<Draft>) => void;
  voices: VoiceProfile[];
  voicesLoading: boolean;
  voiceError: string;
  onClone: () => void;
  onBack: () => void;
  onReset: () => void;
  onMake: () => void;
  busy: boolean;
  configured: boolean;
  renderer: boolean;
}) {
  const { script, plan } = editing;
  const pricing = useStudioPricing();
  const words = scriptWords(script);
  const seconds = estimateScriptSeconds(script);
  const lines = script.chapters.reduce((n, chapter) => n + chapter.lines.length, 0);
  const tooLong = words > EXPLAINER_MAX_WORDS;
  const voice = voices.find((item) => item.id === draft.voiceId);
  const voiceReady = isVoiceReady(voice);
  const credits = providerCreditEstimate(filmUsd(script.chapters.length), pricing);
  const assets = plan.assets || [];
  const problem = !configured ? "Generation isn't set up on this server yet." : !lines ? "Add at least one line to narrate" : tooLong ? `Trim the script to ${EXPLAINER_MAX_WORDS} words` : !voiceReady ? "Choose a voice" : "";

  const setChapter = (index: number, changes: Partial<ExplainerChapter>) => setScript({ ...script, chapters: script.chapters.map((chapter, i) => (i === index ? { ...chapter, ...changes } : chapter)) });
  const move = (index: number, by: number) => {
    const next = [...script.chapters];
    const [chapter] = next.splice(index, 1);
    next.splice(index + by, 0, chapter);
    setScript({ ...script, chapters: next });
  };
  const remove = (index: number) => setScript({ ...script, chapters: script.chapters.filter((_, i) => i !== index) });
  const addChapter = () => setScript({ ...script, chapters: [...script.chapters, { id: newId(), title: "New chapter", visuals: [], lines: [{ text: "", cue: "" }] }] });

  return (
    <section className="exs-editor" aria-labelledby="exs-editor-title">
      <div className="exs-editor-top">
        <button type="button" className="prs-back" onClick={onBack}><ArrowLeft className="h-4 w-4" aria-hidden="true" />New walkthrough</button>
        <span className="exs-step">{editing.baseFile ? "Editing a finished video" : "Step 2 of 2 · Edit the script"}</span>
      </div>
      <label className="exs-title">
        <span className="sr-only">Video title</span>
        <input id="exs-editor-title" value={script.title} onChange={(event) => setScript({ ...script, title: event.target.value.slice(0, 120) })} placeholder="Video title" maxLength={120} />
      </label>
      {plan.summary ? <p className="exs-summary">{plan.summary}</p> : null}
      {plan.features?.length ? (
        <ul className="exs-features" aria-label="Features Opus found">
          {plan.features.map((feature) => (
            <li key={feature.name} title={feature.what}>{feature.name}</li>
          ))}
        </ul>
      ) : null}
      {plan.notice ? <p className="exs-note is-warn">{plan.notice}</p> : null}

      <div className="exs-layout">
        <ol className="exs-chapters">
          {script.chapters.map((chapter, index) => (
            <ChapterCard
              key={chapter.id}
              chapter={chapter}
              index={index}
              total={script.chapters.length}
              assets={assets}
              thumbs={thumbs}
              onChange={(changes) => setChapter(index, changes)}
              onMove={(by) => move(index, by)}
              onRemove={() => remove(index)}
            />
          ))}
          {script.chapters.length < EXPLAINER_LIMITS.chapters ? (
            <li className="exs-add-chapter">
              <button type="button" className="exs-ghost" onClick={addChapter}><Plus className="h-4 w-4" aria-hidden="true" />Add a chapter</button>
            </li>
          ) : null}
        </ol>

        <aside className="exs-side" aria-label="Voice and format">
          <div className="exs-panel">
            <h3 id="exs-voice-label">Narrator</h3>
            <VoicePicker
              voices={voices.filter(isVoiceReady)}
              value={draft.voiceId}
              onChange={(voiceId) => patch({ voiceId })}
              labelledBy="exs-voice-label"
              loading={voicesLoading}
              placeholder="Choose a voice"
              empty={<span>No voices yet. Clone yours below.</span>}
            />
            {voiceError && !voices.length ? <p className="exs-note is-warn">{voiceError}</p> : null}
            <button type="button" className="exs-ghost exs-clone-btn" onClick={onClone}><Plus className="h-4 w-4" aria-hidden="true" />Clone a voice</button>
            <p className="exs-note">Your cloned voices are private to you.</p>
          </div>

          <div className="exs-panel">
            <h3><RectangleHorizontal className="h-3.5 w-3.5" aria-hidden="true" />Format</h3>
            <div className="prs-seg" role="group" aria-label="Aspect ratio">
              {EXPLAINER_ASPECTS.map((value) => (
                <button key={value} type="button" aria-pressed={draft.aspect === value} onClick={() => patch({ aspect: value })}>
                  <span className="prs-shape" data-aspect={value} aria-hidden="true" />
                  <span className="prs-num">{value}</span>
                </button>
              ))}
            </div>
            <div className="exs-toggles">
              <button type="button" className={`mks-chip prs-toggle${draft.captions ? " is-on" : ""}`} aria-pressed={draft.captions} onClick={() => patch({ captions: !draft.captions })}>
                <Captions className="h-3.5 w-3.5" />
                <span>Captions</span>
              </button>
              <button type="button" className={`mks-chip prs-toggle${draft.music ? " is-on" : ""}`} aria-pressed={draft.music} onClick={() => patch({ music: !draft.music })}>
                <Music className="h-3.5 w-3.5" />
                <span>{draft.music ? "Music bed" : "Voice only"}</span>
              </button>
            </div>
          </div>

          <div className="exs-panel exs-stats" aria-live="polite">
            <div>
              <strong className={`prs-num${tooLong ? " is-over" : ""}`}>{words}</strong>
              <span>of {EXPLAINER_MAX_WORDS} words</span>
            </div>
            <div>
              <strong className="prs-num">~{clock(seconds)}</strong>
              <span>spoken</span>
            </div>
            <div>
              <strong className="prs-num">{script.chapters.length}</strong>
              <span>chapters</span>
            </div>
          </div>

          <button type="button" className="mks-generate exs-make" disabled={Boolean(problem) || busy} onClick={onMake} title={problem || undefined}>
            {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <span>{editing.baseFile ? "Make it again" : "Make video"}</span>}
            {credits !== null ? <small title={CREDIT_ESTIMATE_TITLE}><Zap className="h-3 w-3" />{creditEstimateLabel(credits)}</small> : null}
            <small className="prs-eta"><Clock className="h-3 w-3" />~{filmMinutes(seconds, script.chapters.length)} min</small>
          </button>
          {problem ? <p className="mks-hint exs-problem">{problem}</p> : null}
          {!renderer ? <p className="mks-hint">This server can't render video right now, so the video comes back as a live preview you can render to MP4 later.</p> : null}
          {editing.baseFile ? <p className="exs-note">Chapters you didn't change are kept, so only the edited ones are rewritten.</p> : null}
          <button type="button" className="exs-link" onClick={() => window.confirm("Discard your edits and go back to Opus's draft?") && onReset()}>Start over from the draft</button>
        </aside>
      </div>
    </section>
  );
}

function ChapterCard({
  chapter,
  index,
  total,
  assets,
  thumbs,
  onChange,
  onMove,
  onRemove,
}: {
  chapter: ExplainerChapter;
  index: number;
  total: number;
  assets: Array<{ id: string; label: string }>;
  thumbs: Record<string, string>;
  onChange: (changes: Partial<ExplainerChapter>) => void;
  onMove: (by: number) => void;
  onRemove: () => void;
}) {
  const words = chapter.lines.reduce((n, line) => n + countWords(line.text), 0);
  const setLine = (i: number, changes: Partial<{ text: string; cue: string }>) => onChange({ lines: chapter.lines.map((line, j) => (j === i ? { ...line, ...changes } : line)) });
  return (
    <li className="exs-chapter">
      <header>
        <span className="exs-num prs-num" aria-hidden="true">{index + 1}</span>
        <input className="exs-chapter-title" value={chapter.title} onChange={(event) => onChange({ title: event.target.value.slice(0, EXPLAINER_LIMITS.titleChars) })} aria-label={`Chapter ${index + 1} title`} maxLength={EXPLAINER_LIMITS.titleChars} />
        <span className="exs-count prs-num">{words} words</span>
        <div className="exs-chapter-actions">
          <button type="button" className="exs-icon" aria-label={`Move chapter ${index + 1} up`} disabled={index === 0} onClick={() => onMove(-1)}><ArrowUp className="h-3.5 w-3.5" /></button>
          <button type="button" className="exs-icon" aria-label={`Move chapter ${index + 1} down`} disabled={index === total - 1} onClick={() => onMove(1)}><ArrowDown className="h-3.5 w-3.5" /></button>
          <button type="button" className="exs-icon" aria-label={`Delete chapter ${index + 1}`} disabled={total <= 1} onClick={() => window.confirm(`Delete "${chapter.title}"?`) && onRemove()}><Trash2 className="h-3.5 w-3.5" /></button>
        </div>
      </header>
      <VisualPicker chapter={chapter} assets={assets} thumbs={thumbs} onChange={(visuals) => onChange({ visuals })} />
      <ol className="exs-lines">
        {chapter.lines.map((line, i) => (
          <li key={i}>
            <AutoText
              className="exs-spoken"
              value={line.text}
              onChange={(event) => setLine(i, { text: event.target.value.replace(/\n/g, " ").slice(0, EXPLAINER_LIMITS.lineChars) })}
              placeholder="What the narrator says"
              aria-label={`Chapter ${index + 1}, line ${i + 1}: spoken words`}
              maxLength={EXPLAINER_LIMITS.lineChars}
            />
            <label className="exs-cue">
              <span>On screen</span>
              <AutoText value={line.cue} onChange={(event) => setLine(i, { cue: event.target.value.replace(/\n/g, " ").slice(0, EXPLAINER_LIMITS.cueChars) })} placeholder='e.g. cursor clicks "New project"' aria-label={`Chapter ${index + 1}, line ${i + 1}: what happens on screen`} maxLength={EXPLAINER_LIMITS.cueChars} />
            </label>
            <button type="button" className="exs-icon exs-line-x" aria-label={`Delete line ${i + 1}`} disabled={chapter.lines.length <= 1} onClick={() => onChange({ lines: chapter.lines.filter((_, j) => j !== i) })}><X className="h-3.5 w-3.5" /></button>
          </li>
        ))}
      </ol>
      {chapter.lines.length < EXPLAINER_LIMITS.lines ? (
        <button type="button" className="exs-link exs-add-line" onClick={() => onChange({ lines: [...chapter.lines, { text: "", cue: "" }] })}><Plus className="h-3.5 w-3.5" aria-hidden="true" />Add a line</button>
      ) : null}
    </li>
  );
}

// A textarea that grows with its text (and with the width it's given), one line at a time.
function AutoText(props: TextareaHTMLAttributes<HTMLTextAreaElement> & { value: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const fit = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  };
  useLayoutEffect(fit, [props.value]);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let width = el.clientWidth;
    const observer = new ResizeObserver(() => {
      if (el.clientWidth !== width) {
        width = el.clientWidth;
        fit();
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return <textarea ref={ref} rows={1} {...props} />;
}

function VisualPicker({ chapter, assets, thumbs, onChange }: { chapter: ExplainerChapter; assets: Array<{ id: string; label: string }>; thumbs: Record<string, string>; onChange: (visuals: string[]) => void }) {
  const { open, setOpen, ref } = usePopover();
  const label = (id: string) => assets.find((asset) => asset.id === id)?.label || id;
  const tile = (id: string, content?: ReactNode) => (thumbs[id] ? <img src={thumbs[id]} alt="" /> : content || <Film className="h-4 w-4" aria-hidden="true" />);
  if (!assets.length) return null;
  return (
    <div className="exs-visuals mks-pop" ref={ref}>
      <span className="exs-visuals-label">Shows</span>
      {chapter.visuals.map((id) => (
        <button key={id} type="button" className="exs-visual" title={`${label(id)}. Remove`} aria-label={`Remove ${label(id)} from this chapter`} onClick={() => onChange(chapter.visuals.filter((v) => v !== id))}>
          {tile(id)}
          <X className="exs-visual-x h-3 w-3" aria-hidden="true" />
        </button>
      ))}
      {chapter.visuals.length < EXPLAINER_LIMITS.visuals ? (
        <button type="button" className="exs-visual is-add" aria-expanded={open} aria-label="Choose screens for this chapter" onClick={() => setOpen(!open)}><Plus className="h-4 w-4" /></button>
      ) : null}
      {!chapter.visuals.length ? <span className="exs-note">Opus picks the screens</span> : null}
      {open ? (
        <div className="mks-tech exs-visual-menu" role="listbox" aria-label="Screens and images">
          {assets.map((asset) => {
            const on = chapter.visuals.includes(asset.id);
            return (
              <button
                key={asset.id}
                type="button"
                role="option"
                aria-selected={on}
                className="exs-visual-option"
                onClick={() => onChange(on ? chapter.visuals.filter((v) => v !== asset.id) : [...chapter.visuals, asset.id].slice(0, EXPLAINER_LIMITS.visuals))}
              >
                <span className="exs-visual">{tile(asset.id)}</span>
                <span>{asset.label}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
