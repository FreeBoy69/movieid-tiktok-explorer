// Movie to Recap: a full film in, a narrated long recap and/or Short out.
// Create (link or upload, formats, voice, cut rules) -> progress while the worker watches the film
// -> review and edit the script against the film's frames -> render -> the finished recap opens in
// Vibe Edit with every cut, narration line, and caption on the timeline, ready to tweak and export.
import { type DragEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle, ArrowLeft, ArrowRight, Check, Clapperboard, Download, ExternalLink, Film, Link2, Loader2, Plus,
  Projector, RotateCcw, Search, ShieldCheck, Sparkles, Square, Trash2, Upload, WandSparkles, X,
} from "lucide-react";
import { useErrorToast } from "../../utils/toast";
import { isVoiceReady, loadVoiceProfiles, type VoiceProfile } from "../../utils/voiceProfiles";
import { writeDeepLink } from "../../utils/tiktokRoute";
import { VoicePicker } from "../VoicePicker";
import { ToolLayout } from "./ToolPage";
import { RECAP_STEPS, phaseEta, stepAt, stepEstimates, stepEta, stepFraction } from "../../utils/recapSteps";
import {
  RecapApiError,
  type RecapBounds,
  type RecapQa,
  type FilmSource,
  type SourceResults,
  listSources,
  saveSources,
  searchFilmSources,
  cancelRecap, clock, createRecap, deleteRecap, getRecap, listRecaps, parseClock, renderRecap, retryRecap, saveScript, shotTile, spokenSeconds,
  uploadFilm, type Recap, type RecapBeat, type RecapFormat, type RecapPace, type RecapScript, type RecapTone, type RecapTransforms,
} from "./recapApi";
import "./MovieRecap.css";

const TONES: Array<{ id: RecapTone; label: string }> = [
  { id: "dramatic", label: "Dramatic" },
  { id: "suspense", label: "Suspense" },
  { id: "funny", label: "Witty" },
  { id: "calm", label: "Calm" },
];
const SHORT_LENGTHS = [60, 75, 90];
const PACES: Array<{ id: RecapPace; label: string; hint: string }> = [
  { id: "natural", label: "Natural", hint: "As read" },
  { id: "brisk", label: "Brisk", hint: "10% faster" },
  { id: "fast", label: "Fast", hint: "20% faster" },
];
const FORMAT_LABEL: Record<RecapFormat, string> = { long: "Long recap", short: "Short" };

function readOpenId() {
  try {
    return new URLSearchParams(window.location.search).get("recap") || "";
  } catch {
    return "";
  }
}
function writeOpenId(id: string) {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set("recap", id);
  else url.searchParams.delete("recap");
  window.history.replaceState(window.history.state, "", url.toString());
}

export function MovieRecap() {
  const [openId, setOpenId] = useState(readOpenId);
  const [recaps, setRecaps] = useState<Recap[] | null>(null);
  const [error, setError] = useState("");
  useErrorToast(error, () => setError(""));

  const refresh = useCallback(async () => {
    try {
      setRecaps(await listRecaps());
    } catch (err) {
      setRecaps((current) => current || []);
      setError(err instanceof Error ? err.message : "Couldn't load your recaps");
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  // Keep the list's progress bars moving while anything is working.
  const busy = recaps?.some((r) => r.status === "working" || r.status === "queued");
  useEffect(() => {
    if (!busy || openId) return;
    const timer = window.setInterval(() => void refresh(), 6000);
    return () => window.clearInterval(timer);
  }, [busy, openId, refresh]);

  const open = (id: string) => {
    writeOpenId(id);
    setOpenId(id);
  };
  const close = () => {
    writeOpenId("");
    setOpenId("");
    void refresh();
  };

  if (openId) return <RecapView id={openId} onBack={close} onError={setError} />;
  return (
    <ToolLayout panel={<NewRecapPanel onCreated={(recap) => open(recap.id)} onError={setError} />}>
      <div className="mt-stage-head">
        <h2>Your recaps</h2>
        <span className="mt-meta">{recaps ? (recaps.length ? `${recaps.length} ${recaps.length === 1 ? "recap" : "recaps"}` : "None yet") : ""}</span>
      </div>
      <div className="mt-stage-inner">
        {recaps === null ? <ListSkeleton /> : recaps.length ? <RecapList recaps={recaps} onOpen={open} /> : <HowItWorks />}
      </div>
    </ToolLayout>
  );
}

// ---------------------------------------------------------------- create

/** Your own film sources: search them all for a film and use a result as the link, or manage the list. */
function FilmSources({ onPick, onError, defaultQuery }: { onPick: (url: string) => void; onError: (message: string) => void; defaultQuery: string }) {
  const [sources, setSources] = useState<FilmSource[] | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SourceResults[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [managing, setManaging] = useState(false);
  const [name, setName] = useState("");
  const [link, setLink] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    void listSources().then(setSources, () => setSources([]));
  }, []);
  const search = async () => {
    const q = (query || defaultQuery).trim();
    if (q.length < 2) return onError("Type the film's name to search your sources.");
    setSearching(true);
    setResults(null);
    try {
      setResults(await searchFilmSources(q));
    } catch (err) {
      onError(err instanceof Error ? err.message : "Couldn't search your sources");
    } finally {
      setSearching(false);
    }
  };
  const save = async (next: (Omit<FilmSource, "id"> & { id?: string })[]) => {
    setSaving(true);
    try {
      setSources(await saveSources(next));
      return true;
    } catch (err) {
      onError(err instanceof Error ? err.message : "Couldn't save your sources");
      return false;
    } finally {
      setSaving(false);
    }
  };
  const add = async () => {
    if (!link.trim()) return;
    if (await save([...(sources || []), { name: name.trim(), url: link.trim() }])) {
      setName("");
      setLink("");
    }
  };
  if (sources === null) return null;
  return (
    <div className="mr-sources">
      {sources.length ? (
        <div className="mr-sources-search">
          <input
            className="mt-input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && void search()}
            placeholder={defaultQuery ? `Search my sources for ${defaultQuery}` : "Search my sources for a film"}
            aria-label="Search my sources for a film"
          />
          <button type="button" className="mt-secondary" disabled={searching} onClick={() => void search()}>
            {searching ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Search size={15} aria-hidden="true" />}Search
          </button>
        </div>
      ) : null}
      {results ? (
        <div className="mr-sources-results" role="list" aria-label="Results from your sources">
          {results.every((r) => !r.results.length) ? <p className="mt-note">No results on your sources. Try the film's original title, or add the year.</p> : null}
          {results.filter((r) => !r.results.length && r.error).map((r) => (
            <p key={r.source.id} className="mt-note">{r.source.name}: couldn't reach it ({/\b(\d{3})\b/.exec(r.error || "")?.[1] || "no answer"}). Some sites block automated searches.</p>
          ))}
          {results.filter((r) => r.results.length).map((r) => (
            <div key={r.source.id} className="mr-sources-group" role="listitem">
              <span className="mt-label">{r.source.name}</span>
              {r.results.map((hit) => (
                <div key={hit.url} className="mr-sources-hit">
                  <span className="mr-sources-title" title={hit.url}>{hit.title}</span>
                  <a className="mt-ghost" href={hit.url} target="_blank" rel="noreferrer" aria-label={`Open ${hit.title}`}><ExternalLink size={14} aria-hidden="true" /></a>
                  <button type="button" className="mt-secondary" onClick={() => { onPick(hit.url); setResults(null); }}>Use</button>
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : null}
      <button type="button" className="mr-sources-toggle" aria-expanded={managing} onClick={() => setManaging(!managing)}>
        {sources.length ? `My sources (${sources.length})` : "Add your own sources to search for films"}
      </button>
      {managing ? (
        <div className="mr-sources-manage">
          {sources.map((source) => (
            <div key={source.id} className="mr-sources-row">
              <span><b>{source.name}</b><small>{source.url}</small></span>
              <button type="button" className="mt-ghost" aria-label={`Remove ${source.name}`} disabled={saving} onClick={() => void save(sources.filter((s) => s.id !== source.id))}><Trash2 size={14} aria-hidden="true" /></button>
            </div>
          ))}
          <div className="mr-sources-add">
            <input className="mt-input" value={name} onChange={(event) => setName(event.target.value)} placeholder="Name" aria-label="Source name" maxLength={60} />
            <input className="mt-input" value={link} onChange={(event) => setLink(event.target.value)} placeholder="https://site.com/search?q={query}" aria-label="Source link" inputMode="url" onKeyDown={(event) => event.key === "Enter" && void add()} />
            <button type="button" className="mt-secondary" disabled={saving || !link.trim()} onClick={() => void add()}><Plus size={15} aria-hidden="true" />Add</button>
          </div>
          <p className="mt-note">Put {"{query}"} where the film's name goes in the site's search address. A plain site link is searched the usual way (/?s=).</p>
        </div>
      ) : null}
    </div>
  );
}

function NewRecapPanel({ onCreated, onError }: { onCreated: (recap: Recap) => void; onError: (message: string) => void }) {
  const [mode, setMode] = useState<"link" | "upload">("link");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploadShare, setUploadShare] = useState<number | null>(null);
  const [formats, setFormats] = useState<RecapFormat[]>(["long", "short"]);
  const [longMinutes, setLongMinutes] = useState(12);
  const [shortSeconds, setShortSeconds] = useState(75);
  const [tone, setTone] = useState<RecapTone>("dramatic");
  const [pace, setPace] = useState<RecapPace>("brisk");
  const [filmTitle, setFilmTitle] = useState("");
  const [channelName, setChannelName] = useState(() => {
    try { return window.localStorage.getItem("autoyt-recap-channel") || ""; } catch { return ""; }
  });
  const [music, setMusic] = useState(true);
  const [graphics, setGraphics] = useState(true);
  const [captions, setCaptions] = useState(true);
  const [transforms, setTransforms] = useState<RecapTransforms>({ zoom: true, color: true, mirror: false, speed: false });
  const [voices, setVoices] = useState<VoiceProfile[]>([]);
  const [voicesLoading, setVoicesLoading] = useState(true);
  const [voiceId, setVoiceId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let live = true;
    void loadVoiceProfiles().then(({ profiles }) => {
      if (!live) return;
      const ready = narrationVoices(profiles);
      setVoices(ready);
      setVoiceId((current) => current || ready[0]?.id || "");
      setVoicesLoading(false);
    });
    return () => {
      live = false;
    };
  }, []);

  const toggleFormat = (format: RecapFormat) =>
    setFormats((current) => (current.includes(format) ? (current.length > 1 ? current.filter((f) => f !== format) : current) : [...current, format].sort() as RecapFormat[]));
  const sourceReady = mode === "link" ? /^https?:\/\/\S+\.\S+/i.test(url.trim()) : Boolean(file);
  const ready = sourceReady && Boolean(voiceId) && formats.length > 0 && !submitting;

  const pick = (next: File | null | undefined) => {
    if (!next) return;
    if (!/\.(mp4|mov|mkv|webm|m4v|avi)$/i.test(next.name)) return onError("Upload an MP4, MOV, MKV, WebM, M4V, or AVI file.");
    if (next.size > 1.5 * 1024 ** 3) return onError("Files up to 1.5 GB can be uploaded. Paste a link for larger films.");
    setFile(next);
  };
  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    pick(event.dataTransfer.files?.[0]);
  };

  async function submit() {
    if (!ready) return;
    setSubmitting(true);
    try {
      let upload: { upload: string; name: string } | null = null;
      if (mode === "upload" && file) {
        setUploadShare(0);
        upload = await uploadFilm(file, setUploadShare);
      }
      const recap = await createRecap({
        ...(upload ? { upload: upload.upload, uploadName: upload.name, title: file?.name.replace(/\.[^.]+$/, "") } : { url: url.trim() }),
        formats, longMinutes, shortSeconds, voiceId, tone, pace, captions, transforms, music, graphics,
        filmTitle: filmTitle.trim() || undefined,
        channelName: channelName.trim() || undefined,
      });
      try { window.localStorage.setItem("autoyt-recap-channel", channelName.trim()); } catch {}
      onCreated(recap);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Couldn't start the recap");
    } finally {
      setSubmitting(false);
      setUploadShare(null);
    }
  }

  return (
    <>
      <div className="mt-field">
        <span className="mt-label" id="mr-source-label">The film</span>
        <div className="mr-segment" role="tablist" aria-labelledby="mr-source-label">
          <button type="button" role="tab" aria-selected={mode === "link"} onClick={() => setMode("link")}><Link2 size={14} aria-hidden="true" />Link</button>
          <button type="button" role="tab" aria-selected={mode === "upload"} onClick={() => setMode("upload")}><Upload size={14} aria-hidden="true" />Upload</button>
        </div>
        {mode === "link" ? (
          <>
            <input
              className="mt-input"
              type="url"
              inputMode="url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://"
              aria-label="Link to the full film"
              onKeyDown={(event) => event.key === "Enter" && void submit()}
            />
            <p className="mt-note">A direct file link; a Google Drive, Dropbox, Mega, MediaFire, or PixelDrain share link to your own upload; Internet Archive; or a video page. The media worker downloads it with parallel, resumable connections, so any size works.</p>
            <FilmSources onPick={(link) => setUrl(link)} onError={onError} defaultQuery={filmTitle} />
          </>
        ) : (
          <div
            className="mr-drop"
            data-active={dragging || undefined}
            data-filled={file ? true : undefined}
            onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
          >
            <input ref={input} type="file" accept="video/*,.mkv,.avi" hidden onChange={(event) => pick(event.target.files?.[0])} />
            {file ? (
              <>
                <Film size={18} aria-hidden="true" />
                <span className="mr-drop-name">{file.name}</span>
                <span className="mr-drop-meta">{(file.size / 1024 ** 3).toFixed(2)} GB</span>
                {uploadShare !== null ? (
                  <span className="mt-progress-bar mr-drop-bar" aria-label="Upload progress"><span style={{ ["--p" as string]: Math.max(0.03, uploadShare) }} /></span>
                ) : (
                  <button type="button" className="mr-text-btn" onClick={() => setFile(null)}>Change</button>
                )}
              </>
            ) : (
              <>
                <Upload size={18} aria-hidden="true" />
                <span className="mr-drop-name">Drop the film here</span>
                <span className="mr-drop-meta">MP4, MOV, MKV, or WebM up to 1.5 GB</span>
                <button type="button" className="mt-ghost" onClick={() => input.current?.click()}>Choose file</button>
              </>
            )}
          </div>
        )}
      </div>

      <div className="mr-pair">
        <label className="mt-field">
          <span className="mt-label">Film title <small>Optional</small></span>
          <input className="mt-input" value={filmTitle} maxLength={120} onChange={(event) => setFilmTitle(event.target.value)} placeholder="e.g. Fall (2022)" />
        </label>
        <label className="mt-field">
          <span className="mt-label">Channel name <small>For the intro</small></span>
          <input className="mt-input" value={channelName} maxLength={60} onChange={(event) => setChannelName(event.target.value)} placeholder="e.g. Unicorn Recaps" />
        </label>
      </div>
      <p className="mt-note mr-pair-note">With the title, the script uses the characters' real names and opens the long recap with "This is the movie…".</p>

      <div className="mt-field">
        <span className="mt-label">What to make</span>
        <div className="mr-formats">
          <FormatOption on={formats.includes("long")} onToggle={() => toggleFormat("long")} title="Long recap" detail={`${longMinutes} minutes, 16:9`}>
            <input
              type="range"
              className="mr-range"
              min={10}
              max={17}
              step={1}
              value={longMinutes}
              disabled={!formats.includes("long")}
              onChange={(event) => setLongMinutes(Number(event.target.value))}
              aria-label="Long recap length in minutes"
            />
          </FormatOption>
          <FormatOption on={formats.includes("short")} onToggle={() => toggleFormat("short")} title="Short" detail={`${shortSeconds} seconds, 9:16`}>
            <div className="mr-steps" role="radiogroup" aria-label="Short length">
              {SHORT_LENGTHS.map((s) => (
                <button key={s} type="button" role="radio" aria-checked={shortSeconds === s} disabled={!formats.includes("short")} onClick={() => setShortSeconds(s)}>{s}s</button>
              ))}
            </div>
          </FormatOption>
        </div>
      </div>

      <div className="mt-field">
        <span className="mt-label" id="mr-voice-label">Narrator</span>
        <VoicePicker voices={voices} value={voiceId} onChange={setVoiceId} labelledBy="mr-voice-label" loading={voicesLoading} placeholder="Choose a voice" />
        <VoiceSpeedNote voice={voices.find((v) => v.id === voiceId)} minutes={formats.includes("long") ? longMinutes : shortSeconds / 60} />
      </div>

      <div className="mt-field">
        <span className="mt-label">Tone</span>
        <div className="mt-chips" role="radiogroup" aria-label="Tone">
          {TONES.map((t) => (
            <button key={t.id} type="button" role="radio" aria-checked={tone === t.id} className="mr-chip" onClick={() => setTone(t.id)}>{t.label}</button>
          ))}
        </div>
      </div>

      <div className="mt-field">
        <span className="mt-label" id="mr-pace-label">Pace <small>Pauses are always trimmed</small></span>
        <div className="mr-steps mr-pace" role="radiogroup" aria-labelledby="mr-pace-label">
          {PACES.map((p) => (
            <button key={p.id} type="button" role="radio" aria-checked={pace === p.id} onClick={() => setPace(p.id)}>
              {p.label}<small>{p.hint}</small>
            </button>
          ))}
        </div>
      </div>

      <details className="mr-rules">
        <summary>
          <ShieldCheck size={16} aria-hidden="true" />
          <span>Copyright-safe cutting</span>
          <small>On</small>
        </summary>
        <ul className="mr-rule-list">
          <li><Check size={14} aria-hidden="true" />Every cut is 3 to 4 seconds</li>
          <li><Check size={14} aria-hidden="true" />Footage between cuts is skipped, never shown in a run</li>
          <li><Check size={14} aria-hidden="true" />No moment of the film is used twice</li>
          <li><Check size={14} aria-hidden="true" />The film's own audio is removed; your narration carries it</li>
        </ul>
        <div className="mr-switches">
          <Switch on={transforms.zoom} onChange={(zoom) => setTransforms({ ...transforms, zoom })} label="Slight zoom on every cut" />
          <Switch on={transforms.color} onChange={(color) => setTransforms({ ...transforms, color })} label="Light color shift" />
          <Switch on={transforms.mirror} onChange={(mirror) => setTransforms({ ...transforms, mirror })} label="Mirror the picture" />
          <Switch on={transforms.speed} onChange={(speed) => setTransforms({ ...transforms, speed })} label="Play 5% faster" />
          <Switch on={captions} onChange={setCaptions} label="Burned-in captions" />
          <Switch on={music} onChange={setMusic} label="Background music, 12 dB under the voice" />
          <Switch on={graphics} onChange={setGraphics} label="Motion graphics on the long recap: film title card, character names, subscribe" />
        </div>
        <p className="mt-note">These lower the chance of Content ID claims. No editing method guarantees zero claims.</p>
      </details>

      <button type="button" className="mt-primary" disabled={!ready} onClick={() => void submit()}>
        {submitting ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Projector size={16} aria-hidden="true" />}
        {submitting ? (uploadShare !== null ? `Uploading ${Math.round(uploadShare * 100)}%` : "Starting") : "Analyze film"}
      </button>
    </>
  );
}

function FormatOption({ on, onToggle, title, detail, children }: { on: boolean; onToggle: () => void; title: string; detail: string; children: ReactNode }) {
  return (
    <div className="mr-format" data-on={on || undefined}>
      <button type="button" className="mr-format-toggle" aria-pressed={on} onClick={onToggle}>
        <span className="mr-check" aria-hidden="true">{on ? <Check size={12} strokeWidth={3} /> : null}</span>
        <span className="mr-format-title">{title}</span>
        <span className="mr-format-detail">{detail}</span>
      </button>
      <div className="mr-format-body">{children}</div>
    </div>
  );
}

function Switch({ on, onChange, label }: { on: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} className="mr-switch" onClick={() => onChange(!on)}>
      <span>{label}</span>
      <span className="mr-switch-track" aria-hidden="true"><span /></span>
    </button>
  );
}

// ---------------------------------------------------------------- list

const STATUS_LABEL: Record<Recap["status"], string> = {
  queued: "Queued", working: "Working", review: "Script ready", done: "Rendered", failed: "Failed", cancelled: "Stopped",
};

function RecapList({ recaps, onOpen }: { recaps: Recap[]; onOpen: (id: string) => void }) {
  return (
    <ul className="mr-list">
      {recaps.map((recap) => (
        <li key={recap.id}>
          <button type="button" className="mr-row" onClick={() => onOpen(recap.id)}>
            <span className="mr-row-mark" data-status={recap.status} aria-hidden="true">
              {recap.status === "working" || recap.status === "queued" ? <Loader2 size={16} className="animate-spin" /> : recap.status === "done" ? <Clapperboard size={16} /> : recap.status === "failed" ? <AlertCircle size={16} /> : <Film size={16} />}
            </span>
            <span className="mr-row-main">
              <span className="mr-row-title">{recap.title}</span>
              <span className="mr-row-meta">
                {recap.options.formats.map((f) => (f === "long" ? `${recap.options.longMinutes} min recap` : `${recap.options.shortSeconds}s Short`)).join(" and ")}
                {recap.film ? `, from a ${clock(recap.film.duration)} film` : ""}
              </span>
              {recap.status === "working" || recap.status === "queued" ? (
                <span className="mr-row-progress">
                  <span className="mt-progress-bar"><span style={{ ["--p" as string]: Math.max(0.04, recap.progress) }} /></span>
                  <span>{recap.message}</span>
                </span>
              ) : null}
            </span>
            <span className="mr-pill" data-status={recap.status}>{STATUS_LABEL[recap.status]}</span>
            <ArrowRight size={16} className="mr-row-go" aria-hidden="true" />
          </button>
        </li>
      ))}
    </ul>
  );
}

function ListSkeleton() {
  return (
    <ul className="mr-list" aria-busy="true" aria-label="Loading recaps">
      {[0, 1, 2].map((i) => <li key={i} className="mr-row mr-skel" />)}
    </ul>
  );
}

function HowItWorks() {
  const steps: Array<[ReactNode, string, string]> = [
    [<Projector key="a" size={18} />, "It watches the whole film", "Every scene is sampled, the dialogue transcribed, and each shot described."],
    [<WandSparkles key="b" size={18} />, "You get a script to edit", "A hook, the full story, and the ending, in your tone. Change any line before anything renders."],
    [<Clapperboard key="c" size={18} />, "It cuts in 3 to 4 second shots", "Narration, captions, and short cuts with the film's sound removed, for long-form and Shorts."],
    [<Film key="d" size={18} />, "It lands in Vibe Edit", "Every cut, line, and caption on the timeline, ready to tweak and export."],
  ];
  return (
    <div className="mr-how">
      <h3>A full film, retold in your voice</h3>
      <ol>
        {steps.map(([icon, title, body]) => (
          <li key={title}>
            <span className="mr-how-icon" aria-hidden="true">{icon}</span>
            <span><strong>{title}</strong><span>{body}</span></span>
          </li>
        ))}
      </ol>
    </div>
  );
}

// ---------------------------------------------------------------- one recap

function RecapView({ id, onBack, onError }: { id: string; onBack: () => void; onError: (message: string) => void }) {
  const [recap, setRecap] = useState<Recap | null>(null);
  const [missing, setMissing] = useState(false);
  const sawWorking = useRef(false);

  const [offline, setOffline] = useState(false);
  const load = useCallback(async () => {
    try {
      const next = await getRecap(id);
      setRecap(next);
      setOffline(false);
      return next;
    } catch (err) {
      // Only a real "not found" means the recap is gone. A restart or a network blip (502, timeout) keeps
      // what is on screen and tries again: one failed poll during a deploy once showed a live recap as deleted.
      if (err instanceof RecapApiError && err.status === 404) setMissing(true);
      else setOffline(true);
      return null;
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);
  // While the server can't be reached, keep trying every few seconds.
  useEffect(() => {
    if (!offline) return;
    const timer = window.setInterval(() => void load(), 5000);
    return () => window.clearInterval(timer);
  }, [offline, load]);
  const working = recap?.status === "working" || recap?.status === "queued";
  useEffect(() => {
    if (!working) return;
    sawWorking.current = true;
    const timer = window.setInterval(() => void load(), 4000);
    return () => window.clearInterval(timer);
  }, [working, load]);
  // A render that finishes while you watch lands straight on the Vibe Edit timeline.
  useEffect(() => {
    if (recap?.status !== "done" || !sawWorking.current) return;
    const target = recap.vibe.long || recap.vibe.short;
    if (!target) return;
    const timer = window.setTimeout(() => writeDeepLink({ view: "vibe-edit", projectId: target }), 1400);
    return () => window.clearTimeout(timer);
  }, [recap?.status, recap?.vibe]);

  if (missing) {
    return (
      <div className="mr-view">
        <RecapBar title="Recap not found" onBack={onBack} />
        <div className="mr-center"><p className="mt-note">This recap was deleted or belongs to another account.</p></div>
      </div>
    );
  }
  if (!recap) {
    return (
      <div className="mr-view">
        <RecapBar title="" onBack={onBack} />
        <div className="mr-center">
          <Loader2 size={20} className="animate-spin" aria-label="Loading" />
          {offline ? <p className="mt-note">Can't reach the server right now (it may be restarting). Trying again…</p> : null}
        </div>
      </div>
    );
  }

  const act = async (fn: () => Promise<Recap>) => {
    try {
      setRecap(await fn());
    } catch (err) {
      onError(err instanceof Error ? err.message : "Something went wrong");
    }
  };
  const remove = async () => {
    if (!window.confirm("Delete this recap, its script, and its videos? Vibe Edit projects made from it stay.")) return;
    try {
      await deleteRecap(recap.id);
      onBack();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Couldn't delete this recap");
    }
  };

  return (
    <div className="mr-view">
      {offline ? <p className="mr-offline" role="status">Reconnecting to the server. Your recap keeps going on its own.</p> : null}
      <RecapBar
        title={recap.title}
        onBack={onBack}
        meta={recap.film ? `${clock(recap.film.duration)} film, ${recap.film.scenes} scenes, ${recap.film.lines} lines of dialogue` : recap.source.name}
        actions={
          <>
            {working ? <button type="button" className="mt-ghost" onClick={() => void act(() => cancelRecap(recap.id))}><Square size={14} aria-hidden="true" />Stop</button> : null}
            <button type="button" className="mr-icon-btn" onClick={() => void remove()} aria-label="Delete recap" title="Delete recap"><Trash2 size={16} /></button>
          </>
        }
      />
      {recap.status === "review" && recap.script ? (
        <ScriptReview recap={recap} onChange={setRecap} onRender={(voiceId) => act(() => renderRecap(recap.id, voiceId))} onError={onError} />
      ) : recap.status === "done" ? (
        <Finished recap={recap} onRerender={() => void act(() => renderRecap(recap.id))} />
      ) : recap.status === "failed" || recap.status === "cancelled" ? (
        <div className="mr-center">
          <div className="mr-failed">
            <AlertCircle size={22} aria-hidden="true" />
            <h3>{recap.status === "cancelled" ? "Stopped" : "This recap hit a problem"}</h3>
            <p>{recap.error || "Something went wrong."}</p>
            <RetryWithVoice recap={recap} onRetry={(voiceId) => void act(() => retryRecap(recap.id, voiceId))} />
          </div>
        </div>
      ) : (
        <Working recap={recap} onRetry={() => void act(() => retryRecap(recap.id))} />
      )}
    </div>
  );
}

function RecapBar({ title, meta, onBack, actions }: { title: string; meta?: string; onBack: () => void; actions?: ReactNode }) {
  return (
    <header className="mr-bar">
      <button type="button" className="mt-back" onClick={onBack}><ArrowLeft size={15} aria-hidden="true" />All recaps</button>
      <div className="mr-bar-title">
        <h1>{title}</h1>
        {meta ? <span className="mt-meta">{meta}</span> : null}
      </div>
      <div className="mr-bar-actions">{actions}</div>
    </header>
  );
}

// Narration runs on the local Voicebox models on the media server: Kokoro voices first (about twice as fast
// as real time on its CPU), then cloned voices (Qwen, about 13 times slower than real time). Hosted
// cloud voices appear only when no local voice is available.
const isLocalVoice = (voice: VoiceProfile) => !voice.id.startsWith("openrouter:");
const isKokoro = (voice: VoiceProfile) => /kokoro/i.test(`${voice.presetEngine || ""} ${voice.defaultEngine || ""}`);
function narrationVoices(profiles: VoiceProfile[]) {
  const ready = profiles.filter(isVoiceReady);
  const local = ready.filter(isLocalVoice).sort((a, b) => Number(isKokoro(b)) - Number(isKokoro(a)));
  return local.length ? local : ready;
}

/** Try again, and when the narration is what failed, a choice of narrator first (defaulting to a local voice). */
function RetryWithVoice({ recap, onRetry }: { recap: Recap; onRetry: (voiceId?: string) => void }) {
  const voicing = recap.stage === "voicing";
  const [voices, setVoices] = useState<VoiceProfile[]>([]);
  const [voiceId, setVoiceId] = useState("");
  useEffect(() => {
    if (!voicing) return;
    void loadVoiceProfiles().then(({ profiles }) => {
      const list = narrationVoices(profiles);
      setVoices(list);
      const current = list.find((v) => v.id === recap.options.voiceId);
      setVoiceId(current && isLocalVoice(current) ? current.id : list[0]?.id || recap.options.voiceId);
    });
  }, [voicing, recap.options.voiceId]);
  if (!voicing) return <button type="button" className="mt-primary mr-inline-primary" onClick={() => onRetry()}><RotateCcw size={16} aria-hidden="true" />Try again</button>;
  return (
    <div className="mr-retry-voice">
      <span className="mt-label" id="mr-retry-voice">Narrator</span>
      <VoicePicker voices={voices} value={voiceId} onChange={setVoiceId} labelledBy="mr-retry-voice" loading={!voices.length} />
      <VoiceSpeedNote voice={voices.find((v) => v.id === voiceId)} minutes={spokenSeconds([...(recap.script?.long?.beats || []), ...(recap.script?.short?.beats || [])].map((b) => b.text).join(" ")) / 60} />
      <button type="button" className="mt-primary mr-inline-primary" disabled={!voiceId} onClick={() => onRetry(voiceId)}><RotateCcw size={16} aria-hidden="true" />Try again</button>
    </div>
  );
}

function VoiceSpeedNote({ voice, minutes }: { voice?: VoiceProfile; minutes: number }) {
  if (!voice || !isLocalVoice(voice)) return null;
  const kokoro = isKokoro(voice);
  const estimate = Math.max(1, Math.round(minutes * (kokoro ? 0.6 : 13)));
  return (
    <p className="mt-note">
      {kokoro
        ? `Narrated on our own server, about ${estimate} minute${estimate === 1 ? "" : "s"} of recording.`
        : `Cloned voices are slow on our server: about ${estimate >= 90 ? `${Math.round(estimate / 60)} hours` : `${estimate} minutes`} of recording. A Kokoro voice takes a few minutes.`}
    </p>
  );
}

// Matches STUCK_MS in server/movieRecap.js: after this long with no update, Try again restarts the step.
const STUCK_MS = 10 * 60 * 1000;

const pad = (n: number) => String(Math.max(0, Math.floor(n))).padStart(2, "0");
/** 1:04:09 or 04:09. */
function stopwatch(seconds: number) {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  return h ? `${h}:${pad((s % 3600) / 60)}:${pad(s % 60)}` : `${pad(s / 60)}:${pad(s % 60)}`;
}
/** "7m 32s", "45s", "1h 04m". */
function span(seconds: number) {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${pad(s % 60)}s`;
  return `${Math.floor(s / 3600)}h ${pad((s % 3600) / 60)}m`;
}
const clockTime = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/** The film's stills for the background: TMDB backdrops, else frames from the film's contact sheets. */
function useBackdrops(recap: Recap) {
  const [images, setImages] = useState<string[]>([]);
  useEffect(() => {
    let live = true;
    void fetch(`/api/recaps/${encodeURIComponent(recap.id)}/backdrops`)
      .then((r) => (r.ok ? r.json() : { images: [] }))
      .then((data) => live && setImages(Array.isArray(data.images) ? data.images : []))
      .catch(() => {});
    return () => { live = false; };
  }, [recap.id, recap.film?.duration, recap.film?.title]);
  const sheets = recap.film?.sheet?.count || 0;
  return { images, sheets };
}

/** A dimmed, drifting slideshow of the film behind the progress screen. */
function FilmSlideshow({ recap }: { recap: Recap }) {
  const { images, sheets } = useBackdrops(recap);
  const [index, setIndex] = useState(0);
  // Stills: TMDB backdrops, or random tiles from the film's own contact sheets once it has been sampled.
  const slides = useMemo(() => {
    if (images.length) return images.map((url) => ({ url, tile: null as null | { x: number; y: number } }));
    if (!sheets) return [];
    const picks: { url: string; tile: { x: number; y: number } }[] = [];
    for (let k = 0; k < Math.min(14, sheets); k++) {
      const sheet = Math.floor(((k + 0.5) / Math.min(14, sheets)) * sheets);
      const tile = (k * 5) % 12;
      picks.push({ url: `/api/recaps/${encodeURIComponent(recap.id)}/sheets/s${String(sheet).padStart(3, "0")}.jpg`, tile: { x: ((tile % 4) / 3) * 100, y: (Math.floor(tile / 4) / 2) * 100 } });
    }
    return picks;
  }, [images, sheets, recap.id]);
  useEffect(() => {
    if (slides.length < 2) return;
    const timer = window.setInterval(() => setIndex((i) => (i + 1) % slides.length), 8000);
    return () => window.clearInterval(timer);
  }, [slides.length]);
  if (!slides.length) return <div className="mr-mission-bg" aria-hidden="true" />;
  return (
    <div className="mr-mission-bg" aria-hidden="true">
      {slides.map((slide, i) => (
        <span
          key={slide.url + i}
          className={`mr-slide${i === index ? " is-on" : ""}${i === (index + slides.length - 1) % slides.length ? " is-off" : ""}`}
          style={slide.tile
            ? { backgroundImage: `url(${slide.url})`, backgroundSize: "400% 300%", backgroundPosition: `${slide.tile.x}% ${slide.tile.y}%` }
            : { backgroundImage: `url(${slide.url})` }}
        />
      ))}
    </div>
  );
}

function ProgressRing({ value }: { value: number }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  return (
    <svg className="mr-ring" viewBox="0 0 120 120" role="img" aria-label={`${Math.round(value * 100)}% done`}>
      <circle className="mr-ring-track" cx="60" cy="60" r={r} />
      <circle className="mr-ring-fill" cx="60" cy="60" r={r} strokeDasharray={`${c * value} ${c}`} />
      <text x="60" y="58" className="mr-ring-pct">{Math.round(value * 100)}<tspan dx="1" className="mr-ring-unit">%</tspan></text>
    </svg>
  );
}

function Working({ recap, onRetry }: { recap: Recap; onRetry: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  // The server's clock, so timers don't drift with this computer's.
  const offset = useMemo(() => (recap.serverNow ? recap.serverNow - Date.now() : 0), [recap.serverNow]);
  const serverNow = now + offset;
  const stuck = recap.status === "working" && serverNow - Date.parse(recap.updatedAt) > STUCK_MS;
  const clock = recap.clock;
  const queued = recap.status !== "working";
  const step = stepAt(recap.progress);
  const steps = RECAP_STEPS.filter((s) => s.phase === step.phase);
  const estimates = stepEstimates({ filmSeconds: recap.film?.duration, longMinutes: recap.options.longMinutes, shortSeconds: recap.options.shortSeconds, formats: recap.options.formats });
  const stepStart = clock?.steps?.[step.id]?.start;
  const stepElapsed = stepStart ? (serverNow - stepStart) / 1000 : 0;
  const eta = phaseEta(recap.progress, stepElapsed, estimates);
  const elapsed = clock ? (clock.workMs + (clock.since ? serverNow - clock.since : 0)) / 1000 : 0;
  const phaseProgress = step.phase === "render" ? (recap.progress - 0.75) / 0.25 : recap.progress / 0.75;
  const log = [...(clock?.log || [])].reverse().slice(0, 6);
  const title = recap.film?.title || recap.title;
  return (
    <div className="mr-mission" aria-live="polite">
      <FilmSlideshow recap={recap} />
      <div className="mr-mission-veil" aria-hidden="true" />
      <div className="mr-mission-body">
        <header className="mr-mission-head">
          <div>
            <p className="mr-mission-film">{title}{recap.film?.year ? ` · ${recap.film.year}` : ""}</p>
            <h2>{step.phase === "render" ? "Cutting your recap" : "Watching the film"}</h2>
          </div>
          <dl className="mr-timers">
            <div><dt>Time spent</dt><dd>{stopwatch(elapsed)}</dd></div>
            <div className="is-eta"><dt>{step.phase === "render" ? "Recap ready in" : "Script ready in"}</dt><dd>{queued ? "--:--" : `~${stopwatch(eta)}`}</dd></div>
            <div><dt>Around</dt><dd>{queued ? "--:--" : clockTime(serverNow - offset + eta * 1000)}</dd></div>
          </dl>
        </header>
        <div className="mr-mission-grid">
          <div className="mr-mission-now">
            <ProgressRing value={Math.max(0, Math.min(1, phaseProgress))} />
            <div className="mr-now-text">
              <span className="mr-now-label">{queued ? "Queued" : step.label}</span>
              <p>{recap.message || "Starting"}</p>
              {!queued ? <span className="mr-now-meta">{span(stepElapsed)} in this step · ~{span(stepEta(step, stepFraction(recap.progress), stepElapsed, estimates[step.id] || 60))} left</span> : null}
            </div>
          </div>
          <ol className="mr-stepper">
            {steps.map((s) => {
              const state = s.until <= step.from || recap.progress >= s.until ? "done" : s.id === step.id ? "now" : "next";
              const entry = clock?.steps?.[s.id];
              const took = entry?.start && entry.end ? (entry.end - entry.start) / 1000 : null;
              const fraction = state === "now" ? stepFraction(recap.progress) : state === "done" ? 1 : 0;
              return (
                <li key={s.id} data-state={state}>
                  <span className="mr-stepper-dot" aria-hidden="true">{state === "done" ? <Check size={12} strokeWidth={3} /> : null}</span>
                  <span className="mr-stepper-label">{s.label}</span>
                  <span className="mr-stepper-time">
                    {state === "done" ? (took != null ? span(took) : "done") : state === "now" ? `${span(stepElapsed)} / ~${span(estimates[s.id] || 60)}` : `~${span(estimates[s.id] || 60)}`}
                  </span>
                  <span className="mr-stepper-bar" aria-hidden="true"><span style={{ transform: `scaleX(${fraction})` }} /></span>
                </li>
              );
            })}
          </ol>
        </div>
        {log.length ? (
          <ol className="mr-feed" aria-label="Latest activity">
            {log.map((entry, i) => (
              <li key={`${entry.t}-${i}`} data-latest={i === 0 || undefined}>
                <time>{new Date(entry.t - offset).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time>
                <span>{entry.m}</span>
              </li>
            ))}
          </ol>
        ) : null}
        <p className="mr-mission-note">You can leave this page. It keeps going, and times are estimates that sharpen as each step runs.</p>
        {stuck ? (
          <div className="mr-stuck" role="status">
            <p>No progress for {Math.round((serverNow - Date.parse(recap.updatedAt)) / 60000)} minutes. Try again picks up from this step, keeping the work already done.</p>
            <button type="button" className="mt-secondary" onClick={onRetry}><RotateCcw size={15} aria-hidden="true" />Try again</button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- script review

function useTileAspect(recapId: string, ready: boolean) {
  const [aspect, setAspect] = useState(16 / 9);
  useEffect(() => {
    if (!ready) return;
    const img = new Image();
    img.onload = () => img.naturalWidth && setAspect(img.naturalWidth / 4 / (img.naturalHeight / 3));
    img.src = `/api/recaps/${recapId}/sheets/s000.jpg`;
  }, [recapId, ready]);
  return aspect;
}

function Shot({ recapId, n }: { recapId: string; n: number }) {
  const tile = shotTile(n);
  return (
    <span
      className="mr-shot"
      style={{ backgroundImage: `url(/api/recaps/${recapId}/sheets/${tile.sheet})`, backgroundPosition: `${(tile.col / 3) * 100}% ${(tile.row / 2) * 100}%` }}
      aria-hidden="true"
    />
  );
}

/** The shots a beat will most likely cut from: its anchors, else evenly spread across its stretch. */
function beatShots(beat: RecapBeat, shotEvery: number, total: number, count = 4) {
  if (beat.shots.length) return beat.shots.slice(0, count);
  const first = Math.floor(beat.from / shotEvery);
  const last = Math.max(first, Math.floor(beat.to / shotEvery));
  return Array.from({ length: count }, (_, i) => Math.min(total - 1, Math.round(first + ((last - first) * i) / Math.max(1, count - 1))));
}

function ScriptReview({ recap, onChange, onRender, onError }: { recap: Recap; onChange: (recap: Recap) => void; onRender: (voiceId: string) => Promise<void>; onError: (message: string) => void }) {
  const [script, setScript] = useState<RecapScript>(recap.script as RecapScript);
  const [format, setFormat] = useState<RecapFormat>(recap.options.formats[0]);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "dirty">("saved");
  const [voiceId, setVoiceId] = useState(recap.options.voiceId);
  const [voices, setVoices] = useState<VoiceProfile[]>([]);
  const [rendering, setRendering] = useState(false);
  const film = recap.film;
  const aspect = useTileAspect(recap.id, Boolean(film));
  const timer = useRef<number>(0);

  useEffect(() => {
    void loadVoiceProfiles().then(({ profiles }) => setVoices(narrationVoices(profiles)));
  }, []);

  const persist = useCallback((next: RecapScript) => {
    window.clearTimeout(timer.current);
    setSaveState("dirty");
    timer.current = window.setTimeout(async () => {
      setSaveState("saving");
      try {
        onChange(await saveScript(recap.id, next));
        setSaveState("saved");
      } catch (err) {
        setSaveState("dirty");
        onError(err instanceof Error ? err.message : "Couldn't save the script");
      }
    }, 900);
  }, [recap.id, onChange, onError]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const update = (next: RecapScript) => {
    setScript(next);
    persist(next);
  };
  const beats = script[format]?.beats || [];
  const setBeats = (list: RecapBeat[]) => update({ ...script, [format]: { ...script[format], beats: list } });
  const patchBeat = (i: number, patch: Partial<RecapBeat>) => setBeats(beats.map((beat, j) => (j === i ? { ...beat, ...patch } : beat)));
  const removeBeat = (i: number) => beats.length > 1 && setBeats(beats.filter((_, j) => j !== i));
  const addBeat = (i: number) => {
    const at = beats[i];
    setBeats([...beats.slice(0, i + 1), { id: `n${Date.now().toString(36)}`, text: "", from: at.to, to: Math.min(film?.duration || at.to + 60, at.to + 60), shots: [] }, ...beats.slice(i + 1)]);
  };

  const spoken = useMemo(() => beats.reduce((sum, beat) => sum + spokenSeconds(beat.text) + 0.35, 0), [beats]);
  const target = format === "long" ? recap.options.longMinutes * 60 : recap.options.shortSeconds;
  const share = spoken / target;
  const lengthState = share < 0.8 ? "short" : share > 1.2 ? "long" : "ok";

  async function render() {
    window.clearTimeout(timer.current);
    setRendering(true);
    try {
      if (saveState !== "saved") onChange(await saveScript(recap.id, script));
      await onRender(voiceId);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Couldn't save the script");
    } finally {
      setRendering(false);
    }
  }

  return (
    <div className="mr-review" style={{ ["--tile-ar" as string]: aspect }}>
      <section className="mr-script" aria-label="Recap script">
        <div className="mr-script-head">
          <textarea
            className="mr-title-input"
            value={script.title}
            maxLength={80}
            rows={1}
            onChange={(event) => update({ ...script, title: event.target.value.replace(/\n/g, " ") })}
            aria-label="Recap title"
          />
          <span className="mr-save" data-state={saveState}>{saveState === "saving" ? "Saving" : saveState === "dirty" ? "Unsaved" : "Saved"}</span>
        </div>
        {script.logline ? <p className="mr-logline">{script.logline}</p> : null}
        {recap.film?.height && recap.film.height < 720 ? (
          <p className="mr-notice" role="note">This copy of the film is {recap.film.height}p, so the recap will look soft. A 720p or sharper copy gives a cleaner result.</p>
        ) : null}
        {recap.options.formats.length > 1 ? (
          <div className="mr-segment mr-format-tabs" role="tablist" aria-label="Format">
            {recap.options.formats.map((f) => (
              <button key={f} type="button" role="tab" aria-selected={format === f} onClick={() => setFormat(f)}>
                {FORMAT_LABEL[f]}<small>{(script[f]?.beats || []).length} lines</small>
              </button>
            ))}
          </div>
        ) : null}
        {format === "short" ? (
          <input
            className="mt-input mr-short-title"
            value={script.short?.title || ""}
            maxLength={70}
            placeholder="Short title"
            onChange={(event) => update({ ...script, short: { beats: script.short?.beats || [], title: event.target.value } })}
            aria-label="Short title"
          />
        ) : null}
        <ol className="mr-beats">
          {beats.map((beat, i) => (
            <BeatRow
              key={beat.id}
              index={i}
              beat={beat}
              recapId={recap.id}
              shots={film ? beatShots(beat, film.shotEvery, film.shots) : []}
              filmDuration={film?.duration || 0}
              onPatch={(patch) => patchBeat(i, patch)}
              onRemove={beats.length > 1 ? () => removeBeat(i) : undefined}
              onAdd={() => addBeat(i)}
            />
          ))}
        </ol>
      </section>

      <aside className="mr-side" aria-label="Render settings">
        <div className="mr-side-block">
          <span className="mt-label">Length</span>
          <div className="mr-length" data-state={lengthState}>
            <strong>{clock(spoken)}</strong>
            <span>of {clock(target)} {format === "long" ? "target" : "Short"}</span>
          </div>
          <span className="mt-progress-bar mr-length-bar" data-state={lengthState}><span style={{ ["--p" as string]: Math.min(1, share) }} /></span>
          <p className="mt-note">{lengthState === "short" ? "Add lines or longer sentences to reach the length." : lengthState === "long" ? "Trim lines to fit; long scripts make a longer video." : "Right on length."}</p>
        </div>
        {film ? <FilmMap beats={beats} duration={film.duration} bounds={film.bounds} /> : null}
        <div className="mr-side-block">
          <span className="mt-label" id="mr-review-voice">Narrator</span>
          <VoicePicker voices={voices} value={voiceId} onChange={setVoiceId} labelledBy="mr-review-voice" loading={!voices.length} />
          <VoiceSpeedNote voice={voices.find((v) => v.id === voiceId)} minutes={(script.long?.beats.length ? spokenSeconds((script.long?.beats || []).map((b) => b.text).join(" ")) : spokenSeconds((script.short?.beats || []).map((b) => b.text).join(" "))) / 60} />
        </div>
        <div className="mr-side-block mr-side-rules">
          <ShieldCheck size={16} aria-hidden="true" />
          <p>3 to 4 second cuts, film skipped between every cut, the film's audio removed{recap.options.transforms.zoom ? ", slight zoom" : ""}{recap.options.transforms.color ? ", color shift" : ""}{recap.options.transforms.mirror ? ", mirrored" : ""}.</p>
        </div>
        <button type="button" className="mt-primary mr-render" disabled={rendering || beats.some((beat) => !beat.text.trim())} onClick={() => void render()}>
          {rendering ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Clapperboard size={16} aria-hidden="true" />}
          Render {recap.options.formats.length > 1 ? "both" : FORMAT_LABEL[recap.options.formats[0]].toLowerCase()}
        </button>
        <p className="mt-note">When it finishes, the recap opens in Vibe Edit with every cut and caption on the timeline.</p>
      </aside>
    </div>
  );
}

function ClockInput({ value, max, onCommit, label }: { value: number; max: number; onCommit: (seconds: number) => void; label: string }) {
  const [text, setText] = useState(clock(value));
  useEffect(() => setText(clock(value)), [value]);
  const commit = () => {
    const seconds = parseClock(text);
    if (Number.isFinite(seconds)) onCommit(Math.max(0, Math.min(max, seconds)));
    else setText(clock(value));
  };
  return <input className="mr-clock" value={text} onChange={(event) => setText(event.target.value)} onBlur={commit} onKeyDown={(event) => event.key === "Enter" && (event.target as HTMLInputElement).blur()} aria-label={label} inputMode="numeric" />;
}

function BeatRow({ index, beat, recapId, shots, filmDuration, onPatch, onRemove, onAdd }: {
  index: number; beat: RecapBeat; recapId: string; shots: number[]; filmDuration: number;
  onPatch: (patch: Partial<RecapBeat>) => void; onRemove?: () => void; onAdd: () => void;
}) {
  const seconds = spokenSeconds(beat.text);
  return (
    <li className="mr-beat">
      <div className="mr-beat-frames">
        {shots.map((n, i) => <Shot key={`${n}-${i}`} recapId={recapId} n={n} />)}
      </div>
      <div className="mr-beat-body">
        <textarea
          className="mr-beat-text"
          value={beat.text}
          maxLength={600}
          rows={2}
          onChange={(event) => onPatch({ text: event.target.value })}
          aria-label={`Narration line ${index + 1}`}
          placeholder="Write what the narrator says over this stretch of the film"
        />
        <div className="mr-beat-meta">
          <span className="mr-beat-range">
            <span>Film</span>
            <ClockInput value={beat.from} max={filmDuration} onCommit={(from) => onPatch({ from, to: Math.max(beat.to, from + 10), shots: [] })} label={`Line ${index + 1} starts in the film at`} />
            <span aria-hidden="true">to</span>
            <ClockInput value={beat.to} max={filmDuration} onCommit={(to) => onPatch({ to: Math.max(to, beat.from + 10), shots: [] })} label={`Line ${index + 1} ends in the film at`} />
          </span>
          <span className="mr-beat-len">{Math.round(seconds)}s spoken</span>
          <span className="mr-beat-actions">
            <button type="button" className="mr-icon-btn" onClick={onAdd} aria-label={`Add a line after line ${index + 1}`} title="Add a line after"><Plus size={15} /></button>
            {onRemove ? <button type="button" className="mr-icon-btn" onClick={onRemove} aria-label={`Remove line ${index + 1}`} title="Remove line"><X size={15} /></button> : null}
          </span>
        </div>
      </div>
    </li>
  );
}

/** Where in the film every line draws its footage, so gaps and repeats are visible at a glance. */
const BOUNDS_FROM: Record<string, string> = { TheIntroDB: "TheIntroDB", IntroDB: "IntroDB", chapters: "the film's chapters", frames: "the frames", estimate: "an estimate" };

function FilmMap({ beats, duration, bounds }: { beats: RecapBeat[]; duration: number; bounds?: RecapBounds }) {
  const sources = bounds ? [...new Set([bounds.from.start, bounds.from.end])].map((from) => BOUNDS_FROM[from] || from) : [];
  return (
    <div className="mr-side-block">
      <span className="mt-label">Footage across the film</span>
      <div className="mr-map" role="img" aria-label={`${beats.length} narration lines drawing footage across a ${clock(duration)} film${bounds ? `, story from ${clock(bounds.start)} to ${clock(bounds.end)}` : ""}`}>
        {bounds ? (
          <>
            <i className="mr-map-off" style={{ left: 0, width: `${(bounds.start / duration) * 100}%` }} />
            <i className="mr-map-off" style={{ left: `${(bounds.end / duration) * 100}%`, right: 0 }} />
          </>
        ) : null}
        {beats.map((beat) => (
          <span key={beat.id} style={{ left: `${(beat.from / duration) * 100}%`, width: `${Math.max(0.4, ((beat.to - beat.from) / duration) * 100)}%` }} />
        ))}
      </div>
      <div className="mr-map-scale"><span>0:00</span><span>{clock(duration)}</span></div>
      {bounds ? <p className="mr-map-note">Story {clock(bounds.start)} to {clock(bounds.end)}. Opening titles and end credits are left out (from {sources.join(" and ")}).</p> : null}
    </div>
  );
}

// ---------------------------------------------------------------- finished

function QaVerdict({ qa }: { qa: RecapQa }) {
  const loud = qa.lufs != null ? `${qa.lufs.toFixed(1)} LUFS` : "";
  return (
    <div className="mr-qa" data-verdict={qa.verdict}>
      <p className="mr-qa-head">
        {qa.verdict === "PASS" ? <Check size={14} strokeWidth={3} aria-hidden="true" /> : <AlertCircle size={14} aria-hidden="true" />}
        {qa.verdict === "PASS" ? "Quality check passed" : qa.verdict === "FAIL" ? "Fix before posting" : "Worth a look before posting"}
        {loud ? <span>{loud}</span> : null}
      </p>
      {qa.findings.length ? (
        <ul>
          {qa.findings.slice(0, 4).map((f, i) => (
            <li key={`${f.rule}-${i}`}>{f.at != null ? <span className="mr-qa-at">{clock(f.at)}</span> : null}{f.message}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function Finished({ recap, onRerender }: { recap: Recap; onRerender: () => void }) {
  return (
    <div className="mr-done">
      {recap.options.formats.map((format) => {
        const output = recap.outputs.find((o) => o.format === format);
        const stats = recap.stats?.[format];
        const project = recap.vibe[format];
        return (
          <section key={format} className="mr-result" data-format={format}>
            <div className="mr-result-video">
              {output ? <video src={output.url} controls preload="metadata" playsInline /> : <span className="mt-note">Not rendered</span>}
            </div>
            <div className="mr-result-body">
              <h2>{format === "short" ? recap.script?.short?.title || "Short" : recap.title}</h2>
              {stats ? (
                <dl className="mr-stats">
                  <div><dt>Length</dt><dd>{clock(output?.duration || stats.seconds)}</dd></div>
                  <div><dt>Cuts</dt><dd>{stats.cuts}</dd></div>
                  <div><dt>Average cut</dt><dd>{stats.averageCut.toFixed(1)}s</dd></div>
                  <div><dt>Film used</dt><dd>{(stats.filmShare * 100).toFixed(1)}%</dd></div>
                  {format === "short" && typeof stats.centred === "number" ? (
                    <div className="mr-stats-wide"><dt>Character centred</dt><dd>{stats.centred} of {stats.cuts} cuts</dd></div>
                  ) : null}
                  {typeof stats.weak === "number" ? (
                    <div className="mr-stats-wide" title="Jev scored every cut's footage against the narration over it. Weak matches arrive flagged in Vibe Edit, where Replace all flagged shots swaps them.">
                      <dt>Weak matches flagged</dt><dd>{stats.weak} of {stats.cuts} cuts</dd>
                    </div>
                  ) : null}
                </dl>
              ) : null}
              {output?.qa ? <QaVerdict qa={output.qa} /> : null}
              <div className="mt-actions">
                {project ? (
                  <button type="button" className="mt-primary mr-inline-primary" onClick={() => writeDeepLink({ view: "vibe-edit", projectId: project })}>
                    <WandSparkles size={16} aria-hidden="true" />Edit in Vibe Edit
                  </button>
                ) : null}
                {output ? <a className="mt-ghost" href={`${output.url}?download=1`}><Download size={15} aria-hidden="true" />Download</a> : null}
                {format === "long" && !recap.graphics?.events?.length ? (
                  <button type="button" className="mt-ghost" onClick={onRerender} title="Renders the recap again with a film title card, character names, and a subscribe moment"><Sparkles size={15} aria-hidden="true" />Add motion graphics</button>
                ) : null}
              </div>
            </div>
          </section>
        );
      })}
    </div>
  );
}
