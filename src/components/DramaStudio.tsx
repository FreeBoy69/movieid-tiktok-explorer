// Create Drama: pick a template, shape the premise, and make a vertical short
// drama series one episode at a time. Each episode opens in the Create Video
// editor with the series' cast, voices, and art style already set.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertCircle, Apple, Archive, ArrowLeft, ArrowUpRight, Briefcase, Check, ChevronDown, Clapperboard, Coffee, FolderOpen, GraduationCap, Heart, Hourglass, LayoutGrid, Loader2, Pencil, Play, Plus, Rocket, RotateCcw, Search, Smartphone, Sparkles, X } from "lucide-react";
import { Empty, Modal, PageHead, creatorApi } from "./CreatorWorkspace";
import { usePopover } from "./studio/studioShared";
import { CastPanel, LocationsPanel, useSeriesProduction, type DramaLocation } from "./DramaCast";
import { DramaEpisode } from "./DramaEpisode";
import { loadVoiceProfiles } from "../utils/voiceProfiles";
import { writeDeepLink } from "../utils/tiktokRoute";
import { ART_STYLE_PRESETS } from "../utils/creatorPipeline";
import { SHORTFILM_TEMPLATES } from "../utils/shortfilmTemplates.js";
import {
  DRAMA_EPISODE_LENGTHS,
  DRAMA_EPISODE_RANGE,
  DRAMA_GENRE_STARTERS,
  dramaStarterThumb,
  DRAMA_TEMPLATES,
  dramaTemplateThumb,
  episodeLength,
  findDramaTemplate,
  speakerName,
} from "../utils/dramaTemplates";
import { toast } from "../utils/toast";
import "./DramaStudio.css";

type Template = (typeof DRAMA_TEMPLATES)[number];
type Concept = { title: string; genre: string; premise: string; logline: string; tone: string; visualPrompt: string; artStyleId: string; cast: Character[]; locations: DramaLocation[] };
type Character = { id: string; name: string; role: string; appearance: string; outfit: string; voice?: string };
type EpisodePlan = { n: number; title: string; hook: string; goal: string; turn: string; payoff: string; cliffhanger: string };
type Series = {
  id: string;
  title: string;
  status: string;
  version: number;
  updatedAt: number;
  templateId: string;
  genre: string;
  poster: string;
  posterStatus: string;
  posterError: string;
  twist: string;
  logline: string;
  tone: string;
  artStyleId: string;
  shotTemplateId: string;
  episodeSeconds: number;
  episodeCount: number;
  cast: Character[];
  locations: DramaLocation[];
  voices: Record<string, string>;
  episodes: EpisodePlan[];
  outline: "pending" | "writing" | "ready" | "failed";
  outlineError: string;
  made?: number;
  rendered?: number;
};
type EpisodeProject = { id: string; n: number; title: string; status: string; legacy?: boolean; done: number; stages: number; video: string; thumbnail: string; firstScene: string };

const styleName = (id: string) => ART_STYLE_PRESETS.find((style: { id: string }) => style.id === id)?.name || "Custom style";
// Drama can use every shared short-film grammar. The selected template owns
// the aspect ratio, camera language, and beat structure for the episode.
const DRAMA_SHOT_TEMPLATES = SHORTFILM_TEMPLATES;
const formatName = (id: string) => SHORTFILM_TEMPLATES.find((format) => format.id === id)?.name || "Scene format";

function Poster({ templateId, posterUrl = "", alt = "" }: { templateId: string; posterUrl?: string; alt?: string }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [posterUrl, templateId]);
  const template = findDramaTemplate(templateId);
  return !broken && posterUrl ? (
    <img src={posterUrl} alt={alt} loading="lazy" decoding="async" onError={() => setBroken(true)} />
  ) : broken || !template ? (
    <span className="dr-poster-fallback" aria-hidden="true">
      <Clapperboard size={22} />
    </span>
  ) : (
    <img src={dramaTemplateThumb(template.id)} alt={alt} loading="lazy" decoding="async" onError={() => setBroken(true)} />
  );
}

export function DramaStudio({ accountId, seriesId, episodeId, onError }: { accountId: string; seriesId?: string; episodeId?: string; onError: (e: string) => void }) {
  if (seriesId && episodeId) return <DramaEpisode key={episodeId} accountId={accountId} seriesId={seriesId} episodeId={episodeId} onError={onError} />;
  return seriesId ? (
    <SeriesPage key={seriesId} accountId={accountId} id={seriesId} onError={onError} />
  ) : (
    <DramaHome accountId={accountId} onError={onError} />
  );
}

function DramaHome({ accountId, onError }: { accountId: string; onError: (e: string) => void }) {
  const [series, setSeries] = useState<Series[]>([]),
    [loading, setLoading] = useState(true),
    [picked, setPicked] = useState<Template | null>(null),
    [projectsOpen, setProjectsOpen] = useState(false);
  const projectsTrigger = useRef<HTMLButtonElement>(null);
  const projectsDrawer = useRef<HTMLElement>(null);
  useEffect(() => {
    let active = true;
    creatorApi(`/api/drama/series?accountId=${encodeURIComponent(accountId)}`)
      .then((data) => active && setSeries(data.series || []))
      .catch((e) => active && onError(e.message))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [accountId]);
  useEffect(() => {
    if (!projectsOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    projectsDrawer.current?.querySelector<HTMLButtonElement>(".dr-drawer-close")?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setProjectsOpen(false);
      }
      if (event.key !== "Tab") return;
      const items = projectsDrawer.current?.querySelectorAll<HTMLElement>('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])');
      if (!items?.length) return;
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      projectsTrigger.current?.focus();
    };
  }, [projectsOpen]);
  const live = series.filter((item) => item.status !== "archived").sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  return (
    <div className="maker-scroll">
      <div className="maker-page is-wide dr-page">
        <PageHead
          centered
          title="Create Drama"
          text="From a first idea to a series of connected episodes."
        />
        <DramaIdea accountId={accountId} onError={onError} projectsAction={
          <button ref={projectsTrigger} type="button" className="dr-projects-trigger" onClick={() => setProjectsOpen(true)} aria-haspopup="dialog" aria-controls="dr-projects-drawer" aria-expanded={projectsOpen}>
            <FolderOpen size={16} aria-hidden="true" />
            <span>Your projects</span>
            {!loading && <span className="dr-projects-count">{live.length}</span>}
          </button>
        } />
        <section aria-labelledby="dr-templates">
          <div className="maker-section-title">
            <h2 id="dr-templates">Start from a template</h2>
            <small className="dr-count">{DRAMA_TEMPLATES.length} templates</small>
          </div>
          <ul className="dr-template-grid">
            {DRAMA_TEMPLATES.map((template) => (
              <li key={template.id}>
                <button type="button" className="dr-template" onClick={() => setPicked(template)} aria-label={`${template.name}: ${template.tagline}`}>
                  <Poster templateId={template.id} />
                  <span className="dr-template-copy">
                    <small>{template.genre}</small>
                    <strong>{template.name}</strong>
                    <span>{template.tagline}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>
      {picked && <NewSeriesModal accountId={accountId} template={picked} onClose={() => setPicked(null)} onError={onError} />}
      {projectsOpen && (
        <div className="dr-project-drawer-layer" role="presentation">
          <button type="button" className="dr-project-drawer-scrim" onClick={() => setProjectsOpen(false)} aria-label="Close your projects" />
          <aside ref={projectsDrawer} id="dr-projects-drawer" className="dr-project-drawer" role="dialog" aria-modal="true" aria-labelledby="dr-projects-title">
            <header className="dr-project-drawer-head">
              <div><h2 id="dr-projects-title">Your projects</h2><span>{loading ? "Loading…" : `${live.length} ongoing`}</span></div>
              <button type="button" className="dr-drawer-close" onClick={() => setProjectsOpen(false)} aria-label="Close your projects"><X size={18} /></button>
            </header>
            <div className="dr-project-drawer-body">
              {loading ? <div className="maker-loading"><Loader2 className="animate-spin" />Loading projects</div> : live.length ? (
                <div className="dr-drawer-list">
                  {live.map((item) => (
                    <button key={item.id} type="button" className="dr-project-row" onClick={() => { setProjectsOpen(false); writeDeepLink({ view: "drama", seriesId: item.id }); }}>
                      <span className="dr-series-cover"><Poster templateId={item.templateId} posterUrl={item.poster} /></span>
                      <span className="dr-series-meta">
                        <strong>{item.title}</strong>
                        <small>{item.outline === "writing" ? "Writing the outline…" : item.outline === "failed" ? "Outline needs a retry" : `${item.made || 0} of ${item.episodeCount} episodes started`}</small>
                        {item.episodeCount > 0 && <span className="dr-meter" aria-hidden="true"><span style={{ width: `${Math.round(((item.made || 0) / item.episodeCount) * 100)}%` }} /></span>}
                      </span>
                      <ArrowUpRight size={15} className="dr-series-open" aria-hidden="true" />
                    </button>
                  ))}
                </div>
              ) : <div className="dr-drawer-empty"><FolderOpen size={24} /><strong>No ongoing dramas yet</strong><span>Your projects will appear here as soon as you create one.</span></div>}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}

const STARTER_ICONS: Record<string, typeof Heart> = {
  Romance: Heart,
  "Objects come alive": Apple,
  "Supernatural & time": Hourglass,
  Workplace: Briefcase,
  "Thriller & mystery": Search,
  "Micro-drama formats": Smartphone,
  "Sci-fi": Rocket,
  Cozy: Coffee,
  School: GraduationCap,
};
function starterIcon(category: string) {
  const Icon = STARTER_ICONS[category] || Sparkles;
  return <Icon size={14} aria-hidden="true" />;
}

function DramaIdea({ accountId, onError, projectsAction }: { accountId: string; onError: (e: string) => void; projectsAction: ReactNode }) {
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<Array<{ role: "user" | "assistant"; content: string }>>([]);
  const [concept, setConcept] = useState<Concept | null>(null);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [episodeCount, setEpisodeCount] = useState(DRAMA_EPISODE_RANGE.default);
  const [episodeSeconds, setEpisodeSeconds] = useState(DRAMA_EPISODE_LENGTHS[0].seconds);
  const [artStyleId, setArtStyleId] = useState("");
  const [shotTemplateId, setShotTemplateId] = useState("micro-drama");
  const [picked, setPicked] = useState<{ name: string; pitch: string; category: string } | null>(null);
  const [genresOpen, setGenresOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [refine, setRefine] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);
  const count = Math.min(DRAMA_EPISODE_RANGE.max, Math.max(DRAMA_EPISODE_RANGE.min, Math.round(episodeCount) || DRAMA_EPISODE_RANGE.default));

  // Each send (the first idea or a refinement) reshapes the whole concept.
  async function develop(content: string, fresh: boolean) {
    const text = content.trim();
    if (!text || busy || creating) return;
    const history = fresh ? [] : messages;
    const next = [...history, { role: "user" as const, content: text }];
    if (fresh) setConcept(null);
    setMessages(next);
    setDetailsOpen(true);
    setBusy(true);
    try {
      const data = await creatorApi("/api/drama/idea", { accountId, messages: next });
      const result = data.concept as Concept;
      setConcept(result);
      // "Auto" takes the look the concept suggests; a look the creator picked stays.
      if (!artStyleId) setArtStyleId(result.artStyleId);
      setMessages([...next, { role: "assistant", content: JSON.stringify({ title: result.title, logline: result.logline, premise: result.premise, cast: result.cast.map((person) => `${person.name} (${person.role})`) }) }]);
      if (fresh) {
        setDraft("");
        setPicked(null);
      }
      setRefine("");
    } catch (error) {
      onError((error as Error).message);
      if (fresh && !concept) setDetailsOpen(false);
    } finally {
      setBusy(false);
    }
  }
  async function create() {
    if (!concept || creating) return;
    setCreating(true);
    try {
      const data = await creatorApi("/api/drama/series", { accountId, concept, episodeCount: count, episodeSeconds, artStyleId, shotTemplateId });
      writeDeepLink({ view: "drama", seriesId: data.series.id });
    } catch (error) {
      onError((error as Error).message);
      setCreating(false);
    }
  }
  function discard() {
    setDetailsOpen(false);
    setConcept(null);
    setMessages([]);
    setRefine("");
  }

  return (
    <section className="dr-idea" aria-labelledby="dr-idea-title">
      <div className="maker-section-title dr-idea-heading"><h2 id="dr-idea-title">Start with your idea</h2>{projectsAction}</div>
      <div className="dr-composer">
        <textarea
          ref={input}
          className="dr-composer-input"
          aria-label="Your drama idea"
          rows={2}
          maxLength={1800}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void develop(draft, true);
            }
          }}
          placeholder="Describe your drama: who wants what, and what stands in the way"
        />
        <div className="dr-composer-bar">
          <div className="dr-composer-chips">
            <button type="button" className="dr-composer-chip is-button" onClick={() => setGenresOpen(true)} aria-haspopup="dialog">
              <LayoutGrid size={14} aria-hidden="true" />
              Genres
            </button>
            <ChipChoice
              label="Episodes"
              value={String(count)}
              options={EPISODE_CHOICES.map((n) => ({ value: String(n), label: String(n) }))}
              onChange={(value) => setEpisodeCount(Number(value))}
            />
            <ChipChoice
              label="Length"
              value={String(episodeSeconds)}
              options={DRAMA_EPISODE_LENGTHS.map((option) => ({ value: String(option.seconds), label: option.label }))}
              onChange={(value) => setEpisodeSeconds(Number(value))}
            />
            <ChipChoice
              label="Look"
              value={artStyleId}
              options={[{ value: "", label: "Auto" }, ...ART_STYLE_PRESETS.map((style: { id: string; name: string }) => ({ value: style.id, label: style.name }))]}
              onChange={setArtStyleId}
            />
            {picked && (
              <span className="dr-composer-chip">
                {starterIcon(picked.category)}
                <span className="dr-composer-chip-text">{picked.name}</span>
                <button type="button" aria-label="Clear idea" onClick={() => { setPicked(null); setDraft(""); input.current?.focus(); }}>
                  <X size={13} />
                </button>
              </span>
            )}
            {concept && !detailsOpen && (
              <button type="button" className="dr-composer-chip is-button" onClick={() => setDetailsOpen(true)}>
                <Clapperboard size={14} aria-hidden="true" />
                <span className="dr-composer-chip-text">{concept.title}</span>
              </button>
            )}
          </div>
          <button type="button" className="dr-composer-send" disabled={!draft.trim() || busy || creating} onClick={() => void develop(draft, true)}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
            Develop idea
          </button>
        </div>
      </div>

      {genresOpen && (
        <GenrePicker
          onClose={() => setGenresOpen(false)}
          onPick={(idea) => {
            setPicked(idea);
            setDraft(`${idea.name}: ${idea.pitch}`);
            setGenresOpen(false);
            requestAnimationFrame(() => input.current?.focus());
          }}
        />
      )}

      {detailsOpen && (
        <Modal
          wide
          className="dr-concept-modal"
          title={concept ? "Your drama" : "Shaping your drama"}
          onClose={() => setDetailsOpen(false)}
          footer={
            <>
              <button type="button" className="maker-ghost" onClick={discard} disabled={creating}>
                Discard
              </button>
              <button type="button" className="maker-primary" disabled={!concept || busy || creating} onClick={() => void create()}>
                {creating ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                {creating ? "Creating series" : "Approve and create"}
              </button>
            </>
          }
        >
          {!concept ? (
            <div className="dr-concept-loading" role="status">
              <Loader2 size={22} className="animate-spin" />
              <strong>Writing the premise, cast, and world</strong>
              <span>This takes about half a minute.</span>
            </div>
          ) : (
            <div className={`dr-concept ${busy ? "is-busy" : ""}`} aria-busy={busy}>
              <div className="dr-concept-head">
                <span className="maker-chip">{concept.genre}</span>
                <h3>{concept.title}</h3>
                {concept.logline && <p className="dr-concept-logline">{concept.logline}</p>}
              </div>
              <p className="dr-concept-premise">{concept.premise}</p>
              <h4>Cast</h4>
              <ul className="dr-concept-cast">
                {concept.cast.map((person) => (
                  <li key={person.id}>
                    <strong>{person.name}</strong>
                    <small>{person.role}</small>
                    <span>{[person.appearance, person.outfit].filter(Boolean).join(" · ")}</span>
                  </li>
                ))}
              </ul>
              {concept.locations.length > 0 && (
                <>
                  <h4>Locations</h4>
                  <ul className="dr-concept-places">
                    {concept.locations.map((place) => (
                      <li key={place.id} title={place.description}>{place.name}</li>
                    ))}
                  </ul>
                </>
              )}
              <h4>Series</h4>
              <div className="dr-idea-settings">
                <label>Episodes <input type="number" inputMode="numeric" min={DRAMA_EPISODE_RANGE.min} max={DRAMA_EPISODE_RANGE.max} value={episodeCount} onChange={(event) => setEpisodeCount(Number(event.target.value))} onBlur={() => setEpisodeCount(count)} /></label>
                <label>Length <select value={episodeSeconds} onChange={(event) => setEpisodeSeconds(Number(event.target.value))}>{DRAMA_EPISODE_LENGTHS.map((option) => <option key={option.seconds} value={option.seconds}>{option.label}</option>)}</select></label>
                <label>Look <select value={artStyleId} onChange={(event) => setArtStyleId(event.target.value)}>{ART_STYLE_PRESETS.map((style: { id: string; name: string }) => <option key={style.id} value={style.id}>{style.name}</option>)}</select></label>
                <label>Scene format <select value={shotTemplateId} onChange={(event) => setShotTemplateId(event.target.value)}>{DRAMA_SHOT_TEMPLATES.map((format) => <option key={format.id} value={format.id}>{format.name}</option>)}</select></label>
              </div>
              <div className="dr-concept-refine">
                <textarea
                  aria-label="Change something"
                  rows={1}
                  maxLength={1800}
                  value={refine}
                  onChange={(event) => setRefine(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void develop(refine, false);
                    }
                  }}
                  placeholder="Change something: the setting, a character, the twist"
                />
                <button type="button" className="maker-outline" disabled={!refine.trim() || busy || creating} onClick={() => void develop(refine, false)}>
                  {busy ? <Loader2 size={15} className="animate-spin" /> : <RotateCcw size={15} />}
                  Revise
                </button>
              </div>
            </div>
          )}
        </Modal>
      )}
    </section>
  );
}

const EPISODE_CHOICES = [3, 5, 8, 10, 12, 15, 20, 25, 30].filter((n) => n >= DRAMA_EPISODE_RANGE.min && n <= DRAMA_EPISODE_RANGE.max);
// Image Studio's setting chip (studioShared Choice) with the drama page's tokens.
function ChipChoice({ label, value, options, onChange }: { label: string; value: string; options: Array<{ value: string; label: string }>; onChange: (value: string) => void }) {
  const { open, setOpen, ref } = usePopover();
  const current = options.find((option) => option.value === value);
  return (
    <div className="dr-pop" ref={ref}>
      <button type="button" className="dr-composer-chip is-choice" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="dr-chip-label">{label}</span>
        <span className="dr-composer-chip-text">{current?.label || value}</span>
        <ChevronDown size={12} aria-hidden="true" />
      </button>
      {open && (
        <div className="dr-menu" role="listbox" aria-label={label}>
          {options.map((option) => (
            <button key={option.value} type="button" role="option" aria-selected={option.value === value} className="dr-menu-item" onClick={() => { onChange(option.value); setOpen(false); }}>
              <span>{option.label}</span>
              {option.value === value && <Check size={14} aria-hidden="true" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

type StarterIdea = { name: string; pitch: string; category: string };
function GenrePicker({ onClose, onPick }: { onClose: () => void; onPick: (idea: StarterIdea) => void }) {
  const [category, setCategory] = useState(DRAMA_GENRE_STARTERS[0].category);
  const shelf = DRAMA_GENRE_STARTERS.find((item) => item.category === category) || DRAMA_GENRE_STARTERS[0];
  return (
    <Modal wide className="dr-genre-modal" title="Genres" onClose={onClose}>
      <div className="dr-starter-tabs" role="group" aria-label="Genre">
        {DRAMA_GENRE_STARTERS.map((item) => (
          <button key={item.category} type="button" aria-pressed={item.category === category} onClick={() => setCategory(item.category)}>
            {starterIcon(item.category)}
            {item.category}
          </button>
        ))}
      </div>
      <ul className="dr-genre-grid" aria-label={`${category} ideas`}>
        {shelf.ideas.map((idea) => (
          <li key={idea.name}>
            <button type="button" className="dr-genre-card" onClick={() => onPick({ ...idea, category })}>
              <GenreThumb name={idea.name} category={category} />
              <span className="dr-genre-copy">
                <strong>{idea.name}</strong>
                <span>{idea.pitch}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
function GenreThumb({ name, category }: { name: string; category: string }) {
  const [broken, setBroken] = useState(false);
  return broken ? (
    <span className="dr-genre-fallback" aria-hidden="true">{starterIcon(category)}</span>
  ) : (
    <img src={dramaStarterThumb(name)} alt="" loading="lazy" decoding="async" onError={() => setBroken(true)} />
  );
}

function NewSeriesModal({ accountId, template, onClose, onError }: { accountId: string; template: Template; onClose: () => void; onError: (e: string) => void }) {
  const [title, setTitle] = useState(""),
    [twist, setTwist] = useState(""),
    [episodeCount, setEpisodeCount] = useState(DRAMA_EPISODE_RANGE.default),
    [episodeSeconds, setEpisodeSeconds] = useState(DRAMA_EPISODE_LENGTHS[0].seconds),
    [artStyleId, setArtStyleId] = useState(template.artStyleId),
    [shotTemplateId, setShotTemplateId] = useState(template.shotTemplateId || "micro-drama"),
    [busy, setBusy] = useState(false);
  const count = Math.min(DRAMA_EPISODE_RANGE.max, Math.max(DRAMA_EPISODE_RANGE.min, Math.round(episodeCount) || DRAMA_EPISODE_RANGE.default));
  async function create() {
    setBusy(true);
    try {
      const data = await creatorApi("/api/drama/series", { accountId, templateId: template.id, title, twist, episodeCount: count, episodeSeconds, artStyleId, shotTemplateId });
      writeDeepLink({ view: "drama", seriesId: data.series.id });
    } catch (e) {
      onError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <Modal
      title={template.name}
      wide
      className="dr-new-series-modal"
      onClose={onClose}
      footer={
        <>
          <button className="maker-outline" onClick={onClose}>
            Cancel
          </button>
          <button className="maker-primary" disabled={busy} onClick={() => void create()}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
            {busy ? "Creating series" : "Create series"}
          </button>
        </>
      }
    >
      <div className="dr-setup">
        <figure className="dr-setup-poster">
          <Poster templateId={template.id} />
          <figcaption>
            <small>{template.genre}</small>
            <p>{template.premise}</p>
          </figcaption>
        </figure>
        <div className="maker-stack dr-setup-form">
          <label className="maker-field">
            Series title
            <input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder={`${template.name} (or let the outline name it)`} />
          </label>
          <label className="maker-field">
            Your twist
            <textarea
              rows={4}
              maxLength={2000}
              value={twist}
              onChange={(e) => setTwist(e.target.value)}
              placeholder="Optional. Change the setting, names, era, or ending, e.g. set it in Lagos, make the butler the villain."
            />
            <small>Leave it empty to use the template as it is.</small>
          </label>
          <div className="maker-grid-2">
            <label className="maker-field">
              Episodes
              <input
                type="number"
                inputMode="numeric"
                min={DRAMA_EPISODE_RANGE.min}
                max={DRAMA_EPISODE_RANGE.max}
                value={episodeCount}
                onChange={(e) => setEpisodeCount(Number(e.target.value))}
                onBlur={() => setEpisodeCount(count)}
              />
              <small>
                {DRAMA_EPISODE_RANGE.min} to {DRAMA_EPISODE_RANGE.max}
              </small>
            </label>
            <label className="maker-field">
              Art style
              <select value={artStyleId} onChange={(e) => setArtStyleId(e.target.value)}>
                {ART_STYLE_PRESETS.map((style: { id: string; name: string }) => (
                  <option key={style.id} value={style.id}>
                    {style.name}
                    {style.id === template.artStyleId ? " (template)" : ""}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <fieldset className="maker-field dr-format-field">
            <legend>Scene format</legend>
            <div className="dr-format-picker" role="group" aria-label="Scene format">
              {DRAMA_SHOT_TEMPLATES.map((format) => (
                <button
                  key={format.id}
                  type="button"
                  className="dr-format-choice"
                  aria-pressed={shotTemplateId === format.id}
                  onClick={() => setShotTemplateId(format.id)}
                >
                  <span className="dr-format-frame" data-aspect={format.aspect} aria-hidden="true"><span /></span>
                  <span className="dr-format-copy">
                    <strong>{format.name}</strong>
                    <small>{format.aspect}{format.id === template.shotTemplateId ? " · template" : ""}</small>
                  </span>
                  <Check className="dr-format-check" size={15} aria-hidden="true" />
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset className="maker-field dr-lengths">
            <legend>Episode length</legend>
            <div className="dr-segmented" role="group" aria-label="Episode length">
              {DRAMA_EPISODE_LENGTHS.map((option) => (
                <button key={option.seconds} type="button" aria-pressed={episodeSeconds === option.seconds} onClick={() => setEpisodeSeconds(option.seconds)}>
                  {option.label}
                  <small>~{option.words} words</small>
                </button>
              ))}
            </div>
          </fieldset>
        </div>
      </div>
    </Modal>
  );
}

function statusOf(project: EpisodeProject | undefined) {
  if (!project) return { label: "Not started", tone: "" };
  if (project.video) return { label: "Rendered", tone: "is-done" };
  if (project.status === "archived") return { label: "Archived", tone: "" };
  return { label: `${project.done} of ${project.stages} steps`, tone: "is-progress" };
}

function SeriesPage({ accountId, id, onError }: { accountId: string; id: string; onError: (e: string) => void }) {
  const [series, setSeries] = useState<Series | null>(null),
    [episodes, setEpisodes] = useState<EpisodeProject[]>([]),
    [tab, setTab] = useState<"episodes" | "cast" | "locations">("episodes"),
    [editingLocation, setEditingLocation] = useState<DramaLocation | null>(null),
    [voices, setVoices] = useState<any[]>([]),
    [voicesLoading, setVoicesLoading] = useState(true),
    [starting, setStarting] = useState(0),
    [editing, setEditing] = useState<EpisodePlan | null>(null),
    [editingCast, setEditingCast] = useState<Character | null>(null),
    [rewrite, setRewrite] = useState(false),
    [missing, setMissing] = useState(false);
  const polling = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const { production, refresh: refreshProduction } = useSeriesProduction(id, onError);
  async function load() {
    try {
      const data = await creatorApi(`/api/drama/series/${encodeURIComponent(id)}?accountId=${encodeURIComponent(accountId)}`);
      setSeries(data.series);
      setEpisodes(data.episodes || []);
      return data.series as Series;
    } catch (e) {
      if ((e as { status?: number }).status === 404) setMissing(true);
      else onError((e as Error).message);
      return null;
    }
  }
  useEffect(() => {
    let active = true;
    const tick = async () => {
      const next = await load();
      if (active && (next?.outline === "writing" || next?.posterStatus === "writing")) polling.current = setTimeout(tick, 3000);
    };
    void tick();
    void loadVoiceProfiles()
      .then(({ profiles }) => active && setVoices(profiles))
      .catch(() => {})
      .finally(() => active && setVoicesLoading(false));
    return () => {
      active = false;
      clearTimeout(polling.current);
    };
  }, [id, accountId]);

  async function patch(body: Record<string, unknown>) {
    if (!series) return;
    try {
      const data = await creatorApi(`/api/drama/series/${encodeURIComponent(id)}`, { ...body, accountId, expectedVersion: series.version }, "PATCH");
      setSeries(data.series);
      return data.series as Series;
    } catch (e) {
      onError((e as Error).message);
      if ((e as { status?: number }).status === 409) void load();
    }
  }
  async function rewriteOutline(note: string) {
    try {
      const data = await creatorApi(`/api/drama/series/${encodeURIComponent(id)}/outline`, { accountId, note, confirmed: true });
      setSeries(data.series);
      setRewrite(false);
      const tick = async () => {
        const next = await load();
        if (next?.outline === "writing") polling.current = setTimeout(tick, 3000);
      };
      clearTimeout(polling.current);
      polling.current = setTimeout(tick, 3000);
    } catch (e) {
      onError((e as Error).message);
    }
  }
  async function startEpisode(n: number) {
    setStarting(n);
    try {
      const data = await creatorApi(`/api/drama/series/${encodeURIComponent(id)}/episodes`, { accountId, episode: n });
      writeDeepLink({ view: "drama", seriesId: id, episodeId: data.project.id });
    } catch (e) {
      onError((e as Error).message);
      setStarting(0);
    }
  }

  const byEpisode = useMemo(() => new Map(episodes.filter((item) => item.status !== "archived").map((item) => [item.n, item])), [episodes]);
  if (missing)
    return (
      <div className="maker-scroll">
        <div className="maker-page">
          <Empty title="Series not found" text="It may have been deleted, or it belongs to another channel.">
            <button className="maker-primary" onClick={() => writeDeepLink({ view: "drama" })}>
              All dramas
            </button>
          </Empty>
        </div>
      </div>
    );
  if (!series)
    return (
      <div className="maker-scroll">
        <div className="maker-loading">
          <Loader2 className="animate-spin" />
          Loading series
        </div>
      </div>
    );
  const template = findDramaTemplate(series.templateId);
  const nextUp = series.episodes.find((episode) => !byEpisode.has(episode.n))?.n || 0;
  const rendered = episodes.filter((item) => item.video).length;
  const length = episodeLength(series.episodeSeconds);
  return (
    <>
      <div className="maker-topbar">
        <div className="maker-topbar-left">
          <button className="maker-ghost" onClick={() => writeDeepLink({ view: "drama" })}>
            <ArrowLeft size={16} />
            All dramas
          </button>
        </div>
        <div className="maker-actions">
          {series.outline === "ready" && (
            <button className="maker-outline" onClick={() => setRewrite(true)}>
              <RotateCcw size={15} />
              Rewrite outline
            </button>
          )}
          <button
            type="button"
            className="maker-icon"
            title={series.status === "archived" ? "Restore series" : "Archive series"}
            aria-label={series.status === "archived" ? "Restore series" : "Archive series"}
            onClick={async () => {
              const next = await patch({ status: series.status === "archived" ? "active" : "archived" });
              if (next) toast.success(next.status === "archived" ? "Series archived" : "Series restored");
            }}
          >
            {series.status === "archived" ? <RotateCcw size={16} /> : <Archive size={16} />}
          </button>
        </div>
      </div>
      <div className="maker-scroll">
        <div className="maker-page is-wide dr-page">
          <header className="dr-series-head">
            <span className="dr-series-poster">
              <Poster templateId={series.templateId} posterUrl={series.poster} />
            </span>
            <div className="dr-series-intro">
              {(template || series.genre) && <span className="maker-chip">{template?.genre || series.genre}</span>}
              <h1>{series.title}</h1>
              {series.logline ? <p className="dr-logline">{series.logline}</p> : template && <p className="dr-logline">{template.tagline}</p>}
              {!series.templateId && series.posterStatus === "writing" && <p className="dr-poster-status"><Loader2 size={14} className="animate-spin" /> Drawing series cover</p>}
              {!series.templateId && series.posterStatus === "failed" && <div className="dr-poster-status is-error"><span>{series.posterError || "Cover could not be made."}</span><button type="button" className="maker-ghost dr-small" onClick={async () => { try { await creatorApi(`/api/drama/series/${encodeURIComponent(id)}/poster`, { accountId }); void load(); } catch (error) { onError((error as Error).message); } }}>Retry cover</button></div>}
              <dl className="dr-facts">
                <div>
                  <dt>Episodes</dt>
                  <dd>{series.episodeCount}</dd>
                </div>
                <div>
                  <dt>Length</dt>
                  <dd>{length.label} each</dd>
                </div>
                <div>
                  <dt>Look</dt>
                  <dd>{styleName(series.artStyleId)}</dd>
                </div>
                <div>
                  <dt>Format</dt>
                  <dd>{formatName(series.shotTemplateId)}</dd>
                </div>
                <div>
                  <dt>Rendered</dt>
                  <dd>
                    {rendered} of {series.episodeCount}
                  </dd>
                </div>
              </dl>
              {series.outline === "ready" && nextUp > 0 && (
                <button className="maker-primary maker-lg dr-next" disabled={starting > 0} onClick={() => void startEpisode(nextUp)}>
                  {starting === nextUp ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
                  {nextUp === 1 ? "Make episode 1" : `Make episode ${nextUp}`}
                </button>
              )}
            </div>
          </header>

          {series.outline === "writing" || series.outline === "pending" ? (
            <section className="dr-writing" aria-live="polite">
              <Loader2 className="animate-spin" size={20} />
              <div>
                <strong>Writing {series.episodeCount} episodes</strong>
                <p>Building the cast and every episode's hook, turn, and cliffhanger. This usually takes under a minute; you can leave and come back.</p>
              </div>
              <ol className="dr-skeleton" aria-hidden="true">
                {Array.from({ length: Math.min(series.episodeCount, 5) }, (_, index) => (
                  <li key={index} style={{ animationDelay: `${index * 120}ms` }} />
                ))}
              </ol>
            </section>
          ) : series.outline === "failed" ? (
            <section className="dr-failed" role="alert">
              <AlertCircle size={20} />
              <div>
                <strong>The outline didn't finish</strong>
                <p>{series.outlineError || "Something went wrong while writing it."}</p>
              </div>
              <button className="maker-primary" onClick={() => void rewriteOutline("")}>
                <RotateCcw size={15} />
                Try again
              </button>
            </section>
          ) : (
            <>
              <div className="dr-tabs" role="tablist" aria-label="Series">
                {(
                  [
                    ["episodes", "Episodes", `${byEpisode.size}/${series.episodes.length}`],
                    ["cast", "Cast", `${series.cast.filter((c) => production.characters[c.id]?.locked && series.voices[speakerName(c.name)]).length}/${series.cast.length}`],
                    ["locations", "Locations", `${series.locations.filter((l) => production.locations[l.id]?.locked).length}/${series.locations.length}`],
                  ] as const
                ).map(([key, label, count]) => (
                  <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)}>
                    {label}
                    <small>{count}</small>
                  </button>
                ))}
              </div>
              {tab === "cast" && (
                <CastPanel
                  seriesId={series.id}
                  accountId={accountId}
                  cast={series.cast}
                  voices={series.voices}
                  voiceProfiles={voices}
                  voicesLoading={voicesLoading}
                  production={production}
                  onChanged={() => {
                    void refreshProduction();
                    void load();
                  }}
                  onEdit={(character) => setEditingCast(character)}
                  onError={onError}
                />
              )}
              {tab === "locations" && (
                <LocationsPanel
                  seriesId={series.id}
                  accountId={accountId}
                  locations={series.locations}
                  production={production}
                  onChanged={() => void refreshProduction()}
                  onEdit={(location) => setEditingLocation(location || { id: "", name: "", description: "" })}
                  onError={onError}
                />
              )}
              {tab === "episodes" && (
              <section aria-labelledby="dr-episodes">
                <div className="maker-section-title">
                  <h2 id="dr-episodes">Episodes</h2>
                  <small className="dr-count">
                    {byEpisode.size} of {series.episodes.length} started
                  </small>
                </div>
                <ol className="dr-episodes">
                  {series.episodes.map((episode) => {
                    const project = byEpisode.get(episode.n);
                    const status = statusOf(project);
                    const still = project?.thumbnail || project?.firstScene;
                    return (
                      <li key={episode.n} className={`dr-episode ${episode.n === nextUp ? "is-next" : ""}`}>
                        <span className="dr-episode-n" aria-hidden="true">
                          {String(episode.n).padStart(2, "0")}
                        </span>
                        <span className="dr-episode-still">{still ? <img src={still} alt="" loading="lazy" /> : <Clapperboard size={16} aria-hidden="true" />}</span>
                        <div className="dr-episode-body">
                          <h3>
                            <span className="sr-only">Episode {episode.n}: </span>
                            {episode.title}
                          </h3>
                          <p>{episode.hook}</p>
                          <details>
                            <summary>Beats</summary>
                            <dl className="dr-beats">
                              {(
                                [
                                  ["Goal", episode.goal],
                                  ["Turn", episode.turn],
                                  ["Payoff", episode.payoff],
                                  ["Ends on", episode.cliffhanger],
                                ] as const
                              ).map(([label, text]) =>
                                text ? (
                                  <div key={label}>
                                    <dt>{label}</dt>
                                    <dd>{text}</dd>
                                  </div>
                                ) : null,
                              )}
                            </dl>
                          </details>
                        </div>
                        <div className="dr-episode-side">
                          <span className={`dr-status ${status.tone}`}>
                            {status.tone === "is-done" && <Check size={13} aria-hidden="true" />}
                            {status.label}
                          </span>
                          <div className="dr-episode-actions">
                            {!project && (
                              <button type="button" className="maker-icon" aria-label={`Edit episode ${episode.n}`} title="Edit beats" onClick={() => setEditing(episode)}>
                                <Pencil size={15} />
                              </button>
                            )}
                            {project ? (
                              <button
                                className="maker-outline"
                                onClick={() =>
                                  project.legacy
                                    ? writeDeepLink({ view: "projects", projectId: project.id, projectStage: project.video ? "review" : "script" })
                                    : writeDeepLink({ view: "drama", seriesId: id, episodeId: project.id })
                                }
                                title={project.legacy ? "Made before Create Drama had its own editor; opens in Create Video" : undefined}
                              >
                                Open
                                <ArrowUpRight size={14} />
                              </button>
                            ) : (
                              <button className={episode.n === nextUp ? "maker-primary" : "maker-outline"} disabled={starting > 0} onClick={() => void startEpisode(episode.n)}>
                                {starting === episode.n ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
                                Start
                              </button>
                            )}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </section>
              )}
            </>
          )}
        </div>
      </div>
      {editingLocation && (
        <LocationModal
          location={editingLocation}
          onClose={() => setEditingLocation(null)}
          onSave={async (next) => {
            const exists = series.locations.some((item) => item.id === next.id);
            const locations = exists ? series.locations.map((item) => (item.id === next.id ? next : item)) : [...series.locations, next];
            const saved = await patch({ locations });
            if (saved) setEditingLocation(null);
          }}
        />
      )}
      {editing && (
        <EpisodeModal
          episode={editing}
          onClose={() => setEditing(null)}
          onSave={async (next) => {
            const saved = await patch({ episodes: series.episodes.map((item) => (item.n === next.n ? next : item)) });
            if (saved) setEditing(null);
          }}
        />
      )}
      {editingCast && (
        <CastModal
          character={editingCast}
          onClose={() => setEditingCast(null)}
          onSave={async (next) => {
            const saved = await patch({ cast: series.cast.map((item) => (item.id === next.id ? next : item)) });
            if (saved) setEditingCast(null);
          }}
        />
      )}
      {rewrite && <RewriteModal startedCount={byEpisode.size} onClose={() => setRewrite(false)} onRewrite={rewriteOutline} />}
    </>
  );
}

function LocationModal({ location, onClose, onSave }: { location: DramaLocation; onClose: () => void; onSave: (next: DramaLocation) => Promise<void> }) {
  const [draft, setDraft] = useState(location),
    [busy, setBusy] = useState(false);
  const id = location.id || draft.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return (
    <Modal
      title={location.id ? `Edit ${location.name}` : "Add a location"}
      wide
      onClose={onClose}
      footer={
        <>
          <button className="maker-outline" onClick={onClose}>
            Cancel
          </button>
          <button
            className="maker-primary"
            disabled={busy || !draft.name.trim() || !id}
            onClick={async () => {
              setBusy(true);
              await onSave({ ...draft, id });
              setBusy(false);
            }}
          >
            {busy && <Loader2 size={16} className="animate-spin" />}
            Save location
          </button>
        </>
      }
    >
      <div className="maker-stack">
        <label className="maker-field">
          Name
          <input value={draft.name} maxLength={60} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Adrian's penthouse office" />
        </label>
        <label className="maker-field">
          What it looks like
          <textarea rows={3} maxLength={400} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="Glass walls over the city at night, dark walnut desk, warm lamp, leather chairs" />
          <small>Architecture, furnishing, palette, and time of day. Redraw the sheet after big changes.</small>
        </label>
      </div>
    </Modal>
  );
}

function EpisodeModal({ episode, onClose, onSave }: { episode: EpisodePlan; onClose: () => void; onSave: (next: EpisodePlan) => Promise<void> }) {
  const [draft, setDraft] = useState(episode),
    [busy, setBusy] = useState(false);
  const field = (key: keyof EpisodePlan, label: string, hint: string) => (
    <label className="maker-field" key={key}>
      {label}
      <textarea rows={2} maxLength={300} value={String(draft[key] || "")} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} />
      <small>{hint}</small>
    </label>
  );
  return (
    <Modal
      title={`Episode ${episode.n}`}
      wide
      onClose={onClose}
      footer={
        <>
          <button className="maker-outline" onClick={onClose}>
            Cancel
          </button>
          <button
            className="maker-primary"
            disabled={busy || !draft.title.trim()}
            onClick={async () => {
              setBusy(true);
              await onSave(draft);
              setBusy(false);
            }}
          >
            {busy && <Loader2 size={16} className="animate-spin" />}
            Save beats
          </button>
        </>
      }
    >
      <div className="maker-stack">
        <label className="maker-field">
          Title
          <input value={draft.title} maxLength={90} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
        </label>
        {field("hook", "Hook", "What the viewer sees in the first seconds.")}
        {field("goal", "Goal", "What the lead wants by the end, and who is in the way.")}
        {field("turn", "Turn", "The reversal that breaks the plan.")}
        {field("payoff", "Payoff", "What this episode delivers.")}
        {field("cliffhanger", "Ends on", "The new danger or reveal that forces the next episode.")}
      </div>
    </Modal>
  );
}

function CastModal({ character, onClose, onSave }: { character: Character; onClose: () => void; onSave: (next: Character) => Promise<void> }) {
  const [draft, setDraft] = useState(character),
    [busy, setBusy] = useState(false);
  return (
    <Modal
      title={`Edit ${character.name}`}
      wide
      onClose={onClose}
      footer={
        <>
          <button className="maker-outline" onClick={onClose}>
            Cancel
          </button>
          <button
            className="maker-primary"
            disabled={busy || !draft.name.trim()}
            onClick={async () => {
              setBusy(true);
              await onSave(draft);
              setBusy(false);
            }}
          >
            {busy && <Loader2 size={16} className="animate-spin" />}
            Save character
          </button>
        </>
      }
    >
      <div className="maker-stack">
        <div className="maker-grid-2">
          <label className="maker-field">
            Name
            <input value={draft.name} maxLength={60} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            <small>Dialogue uses the first name: {speakerName(draft.name) || "—"}</small>
          </label>
          <label className="maker-field">
            Role
            <input value={draft.role} maxLength={160} onChange={(e) => setDraft({ ...draft, role: e.target.value })} />
          </label>
        </div>
        <label className="maker-field">
          Appearance
          <textarea rows={2} maxLength={400} value={draft.appearance} onChange={(e) => setDraft({ ...draft, appearance: e.target.value })} />
          <small>Age, face, hair, build. Reused in every image prompt.</small>
        </label>
        <label className="maker-field">
          Signature outfit
          <textarea rows={2} maxLength={300} value={draft.outfit} onChange={(e) => setDraft({ ...draft, outfit: e.target.value })} />
        </label>
        <label className="maker-field">
          Voice
          <textarea rows={2} maxLength={300} value={draft.voice || ""} onChange={(e) => setDraft({ ...draft, voice: e.target.value })} placeholder="Age, accent, timbre, and manner" />
          <small>Used when you design this character's voice in Cast.</small>
        </label>
        <p className="dr-hint">Changing their look marks storyboards out of date; redraw the sheet in Cast so it matches. Renaming a character changes their speaker label.</p>
      </div>
    </Modal>
  );
}

function RewriteModal({ startedCount, onClose, onRewrite }: { startedCount: number; onClose: () => void; onRewrite: (note: string) => Promise<void> }) {
  const [note, setNote] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <Modal
      title="Rewrite the outline"
      wide
      onClose={onClose}
      footer={
        <>
          <button className="maker-outline" onClick={onClose}>
            Cancel
          </button>
          <button
            className="maker-primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await onRewrite(note);
              setBusy(false);
            }}
          >
            {busy ? <Loader2 size={16} className="animate-spin" /> : <RotateCcw size={16} />}
            Rewrite outline
          </button>
        </>
      }
    >
      <div className="maker-stack">
        <label className="maker-field">
          What should change?
          <textarea rows={4} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Reveal the betrayal sooner, and give the finale a happier ending." />
        </label>
        <p className="dr-hint">
          This replaces the cast and every episode's beats.
          {startedCount > 0 ? ` The ${startedCount === 1 ? "episode" : `${startedCount} episodes`} you already started keep their scripts.` : ""}
        </p>
      </div>
    </Modal>
  );
}
