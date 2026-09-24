import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, Check, Clapperboard, Copy, ExternalLink, LayoutTemplate, Loader2, Search, X } from "lucide-react";
import { listPrompts, type LibraryPrompt } from "../utils/promptLibrary";
import {
  STUDIO_PROMPT_LIMIT,
  fillTemplatePrompt,
  variableLabel,
  type TemplateOutput,
  type TemplatePrompt,
} from "../utils/promptTemplates";
import "./TemplateGallery.css";

const PAGE = 30;
const TITLES: Record<TemplateOutput, { title: string; hint: string; search: string }> = {
  video: { title: "Video templates", hint: "Proven prompts for a single clip or a multi-shot scene.", search: "Search, e.g. horror, product ad, anime" },
  image: { title: "Image templates", hint: "Art direction and thumbnail looks, ready to fill in.", search: "Search, e.g. noir, watercolor, neon" },
  audio: { title: "Music templates", hint: "Soundtrack moods to start a cue from.", search: "Search, e.g. lo-fi, cinematic, upbeat" },
  writing: { title: "Writing templates", hint: "Briefs, scripts, and hooks.", search: "Search prompts" },
};
const IMAGE_FILTERS = [
  { id: "", label: "All" },
  { id: "visualStyle", label: "Visual styles" },
  { id: "thumbnail", label: "Thumbnails" },
];

// First line of real content: multi-line templates open with "1 · Core theme:".
const coverLine = (text: string) => String(text || "").split("\n").find((line) => line.trim() && !line.trim().endsWith(":")) || text;

function Cover({ item, large = false }: { item: LibraryPrompt; large?: boolean }) {
  const [broken, setBroken] = useState(false);
  if (item.image && !broken)
    return <img className="tg-cover-media" src={item.image} alt="" loading={large ? "eager" : "lazy"} decoding="async" referrerPolicy="no-referrer" onError={() => setBroken(true)} />;
  if (item.video && !broken)
    return <video className="tg-cover-media" src={item.video} muted loop playsInline autoPlay={large} preload="metadata" onError={() => setBroken(true)} />;
  return (
    <span className="tg-cover-type" aria-hidden="true">
      <span>{coverLine(item.snippet)}</span>
    </span>
  );
}

/* A popup of library prompts for one kind of output. Picking a template
   previews it and lets the creator fill its blanks; "Use template" hands the
   finished prompt back. The studio underneath keeps its blank default view. */
export function TemplateGallery({
  output,
  theme = "light",
  onClose,
  onUse,
  useLabel = "Use template",
}: {
  output: TemplateOutput;
  theme?: "light" | "dark";
  onClose: () => void;
  onUse: (prompt: string, template: TemplatePrompt) => void;
  useLabel?: string;
}) {
  const copy = TITLES[output];
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [category, setCategory] = useState("");
  const [multiScene, setMultiScene] = useState(false);
  const [items, setItems] = useState<TemplatePrompt[]>([]);
  const [total, setTotal] = useState(0);
  const [multiCount, setMultiCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState("");
  // Phones show the grid or the preview, never both.
  const [previewOpen, setPreviewOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const opener = useRef<Element | null>(typeof document !== "undefined" ? document.activeElement : null);

  const params = useMemo(
    () => ({ q: debounced, output, category: category || undefined, multiScene, maxLength: output === "writing" ? undefined : STUDIO_PROMPT_LIMIT }),
    [debounced, output, category, multiScene],
  );

  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(query.trim()), 220);
    return () => window.clearTimeout(id);
  }, [query]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    listPrompts({ ...params, limit: PAGE })
      .then((data) => {
        if (!active) return;
        const list = data.items as TemplatePrompt[];
        setItems(list);
        setTotal(Number(data.total) || 0);
        setMultiCount(Number(data.multiSceneCount) || 0);
        setSelectedId((current) => (list.some((item) => item.id === current) ? current : list[0]?.id || ""));
      })
      .catch((reason) => active && setError((reason as Error).message))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [params]);

  // Esc closes; focus starts in search and returns to the opener; the page behind stops scrolling.
  useEffect(() => {
    search.current?.focus({ preventScroll: true });
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
      if (event.key === "Tab" && dialog.current) {
        const focusable = [...dialog.current.querySelectorAll<HTMLElement>("button:not(:disabled), input, textarea, a[href], [tabindex='0']")].filter((el) => el.offsetParent !== null);
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey, true);
    const returnTo = opener.current;
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = overflow;
      if (returnTo instanceof HTMLElement) returnTo.focus({ preventScroll: true });
    };
  }, [onClose]);

  async function loadMore() {
    setLoadingMore(true);
    try {
      const data = await listPrompts({ ...params, limit: PAGE, offset: items.length });
      setItems((current) => [...current, ...(data.items as TemplatePrompt[]).filter((item) => !current.some((existing) => existing.id === item.id))]);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setLoadingMore(false);
    }
  }

  const selected = items.find((item) => item.id === selectedId) || null;
  const filled = selected ? fillTemplatePrompt(selected, values) : "";
  const pick = (item: TemplatePrompt) => {
    setSelectedId(item.id);
    setValues({});
    setCopied(false);
    setPreviewOpen(true);
  };
  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(filled);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {}
  };

  return createPortal(
    <div className="tg-root" data-theme={theme}>
      <div className="tg-scrim" onClick={onClose} aria-hidden="true" />
      <div ref={dialog} className={`tg-dialog ${previewOpen ? "is-previewing" : ""}`} role="dialog" aria-modal="true" aria-labelledby="tg-title">
        <header className="tg-head">
          <div className="tg-head-text">
            <h2 id="tg-title">
              <LayoutTemplate size={18} aria-hidden="true" /> {copy.title}
            </h2>
            <p>{copy.hint}</p>
          </div>
          <button type="button" className="tg-icon" onClick={onClose} aria-label="Close templates">
            <X size={18} />
          </button>
        </header>

        <div className="tg-toolbar">
          <label className="tg-search">
            <Search size={16} aria-hidden="true" />
            <input ref={search} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={copy.search} aria-label="Search templates" />
            {query ? (
              <button type="button" onClick={() => setQuery("")} aria-label="Clear search">
                <X size={14} />
              </button>
            ) : null}
          </label>
          <div className="tg-filters" role="group" aria-label="Filters">
            {output === "image"
              ? IMAGE_FILTERS.map((filter) => (
                  <button key={filter.id || "all"} type="button" aria-pressed={category === filter.id} onClick={() => setCategory(filter.id)}>
                    {filter.label}
                  </button>
                ))
              : null}
            {output === "video" && (multiScene || multiCount > 0) ? (
              <button type="button" aria-pressed={multiScene} onClick={() => setMultiScene(!multiScene)} title="Prompts laid out as several timed shots or scenes">
                <Clapperboard size={14} aria-hidden="true" /> Multi-scene
                {!multiScene ? <span>{multiCount}</span> : null}
              </button>
            ) : null}
          </div>
        </div>

        <div className="tg-body">
          <section className="tg-list" aria-label="Templates" aria-busy={loading}>
            <p className="tg-count" aria-live="polite">
              {loading ? "Loading templates…" : `${total.toLocaleString()} ${total === 1 ? "template" : "templates"}`}
            </p>
            {error ? <p className="tg-error" role="alert">{error}</p> : null}
            {loading ? (
              <div className="tg-grid" aria-hidden="true">
                {Array.from({ length: 9 }, (_, i) => (
                  <div key={i} className="tg-card is-skeleton">
                    <span className="tg-cover" />
                    <span className="tg-skel" />
                  </div>
                ))}
              </div>
            ) : !items.length ? (
              <div className="tg-empty">
                <strong>No templates match</strong>
                <span>Try another word{multiScene || category ? ", or clear the filter" : ""}.</span>
              </div>
            ) : (
              <>
                <ul className="tg-grid">
                  {items.map((item) => (
                    <li key={item.id}>
                      <button type="button" className="tg-card" aria-pressed={item.id === selectedId} onClick={() => pick(item)}>
                        <span className="tg-cover">
                          <Cover item={item} />
                          {(item.scenes || 0) > 1 ? <span className="tg-badge">{item.scenes} scenes</span> : null}
                          {item.variables?.length ? <span className="tg-badge is-left">Fill in</span> : null}
                        </span>
                        <strong>{item.title}</strong>
                        <small>{item.sourceName === "ai-shortfilm-prompts" ? "Genre template" : item.contributor ? `by ${item.contributor}` : "Prompt library"}</small>
                      </button>
                    </li>
                  ))}
                </ul>
                {items.length < total ? (
                  <button type="button" className="tg-more" onClick={() => void loadMore()} disabled={loadingMore}>
                    {loadingMore ? <Loader2 size={15} className="tg-spin" /> : null} Show more
                  </button>
                ) : null}
              </>
            )}
          </section>

          <aside className="tg-preview" aria-label="Template preview">
            {selected ? (
              <div className="tg-preview-scroll" key={selected.id}>
                <button type="button" className="tg-back" onClick={() => setPreviewOpen(false)}>
                  <ArrowLeft size={15} /> All templates
                </button>
                <div className="tg-preview-cover">
                  <Cover item={selected} large />
                </div>
                <div className="tg-preview-meta">
                  {(selected.scenes || 0) > 1 ? <span>{selected.scenes} scenes</span> : null}
                  {selected.tags?.slice(0, 3).map((tag) => <span key={tag}>{tag}</span>)}
                </div>
                <h3>{selected.title}</h3>
                {selected.summary ? <p className="tg-summary">{selected.summary}</p> : null}

                {selected.variables?.length ? (
                  <fieldset className="tg-fields">
                    <legend>Make it yours</legend>
                    {selected.variables.map((variable) => (
                      <label key={variable.name}>
                        <span>{variableLabel(variable.name)}</span>
                        <input
                          value={values[variable.name] || ""}
                          placeholder={variable.example}
                          maxLength={300}
                          onChange={(event) => setValues({ ...values, [variable.name]: event.target.value })}
                        />
                      </label>
                    ))}
                    <small>Empty fields use the example.</small>
                  </fieldset>
                ) : null}

                <div className="tg-prompt">
                  <div className="tg-prompt-head">
                    <span>Prompt</span>
                    <button type="button" onClick={() => void copyPrompt()}>
                      {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? "Copied" : "Copy"}
                    </button>
                  </div>
                  <pre>{filled}</pre>
                </div>

                {selected.sourceName || selected.contributor ? (
                  <p className="tg-credit">
                    {selected.url ? (
                      <a href={selected.url} target="_blank" rel="noreferrer">
                        {selected.sourceName || "prompts.chat"} <ExternalLink size={11} />
                      </a>
                    ) : (
                      selected.sourceName
                    )}
                    {selected.contributor ? ` · by ${selected.contributor}` : ""}
                    {selected.license ? ` · ${selected.license}` : " · CC0"}
                  </p>
                ) : null}
              </div>
            ) : (
              <div className="tg-preview-empty">
                <LayoutTemplate size={22} aria-hidden="true" />
                <span>{loading ? "Loading…" : "Pick a template to preview it."}</span>
              </div>
            )}
            {selected ? (
              <div className="tg-preview-foot">
                <button type="button" className="tg-secondary" onClick={onClose}>
                  Cancel
                </button>
                <button type="button" className="tg-primary" disabled={filled.length > STUDIO_PROMPT_LIMIT} title={filled.length > STUDIO_PROMPT_LIMIT ? "This prompt is too long for one generation" : undefined} onClick={() => onUse(filled, selected)}>
                  {useLabel}
                </button>
              </div>
            ) : null}
          </aside>
        </div>
      </div>
    </div>,
    document.body,
  );
}
