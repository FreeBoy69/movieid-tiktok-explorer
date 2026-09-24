import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, ChevronLeft, ChevronRight, Copy, ExternalLink, Loader2, Plus, Search, Sparkles, Star, Trash2, X } from "lucide-react";
import {
  CATEGORIES,
  categoryLabel,
  createPrompt,
  deletePrompt,
  listPrompts,
  setFavorite,
  type LibraryPrompt,
  type PromptCategory,
  type PromptCategoryId,
  type PromptSource,
} from "../utils/promptLibrary";
import { useErrorToast } from "../utils/toast";
import "./PromptLibrary.css";

const PAGE = 36;

function useCopy() {
  const [copied, setCopied] = useState("");
  const timer = useRef<number | undefined>(undefined);
  return {
    copied,
    copy: async (key: string, text: string) => {
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        return;
      }
      setCopied(key);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(""), 1600);
    },
  };
}

// A card cover: the example output when prompts.chat has one, otherwise the
// opening of the snippet set as type, so text prompts keep the grid's rhythm.
function Cover({ prompt, large = false }: { prompt: LibraryPrompt; large?: boolean }) {
  const [broken, setBroken] = useState(false);
  if (!broken && prompt.image)
    return (
      <img
        className="plib-cover-media"
        src={prompt.image}
        alt={large ? `Example output for ${prompt.title}` : ""}
        loading={large ? "eager" : "lazy"}
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setBroken(true)}
      />
    );
  if (!broken && prompt.video)
    return <video className="plib-cover-media" src={prompt.video} muted loop autoPlay={large} playsInline preload="metadata" onError={() => setBroken(true)} />;
  return (
    <span className={`plib-cover-type is-${prompt.categories[0] || "idea"}`} aria-hidden="true">
      <span>{prompt.snippet}</span>
    </span>
  );
}

export function PromptLibrary({ theme = "light" }: { theme?: "light" | "dark" }) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [category, setCategory] = useState<PromptCategoryId | "">("");
  const [saved, setSaved] = useState(false);
  const [items, setItems] = useState<LibraryPrompt[]>([]);
  const [total, setTotal] = useState(0);
  const [categories, setCategories] = useState<PromptCategory[]>(CATEGORIES);
  const [savedCount, setSavedCount] = useState(0);
  const [source, setSource] = useState<PromptSource>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  useErrorToast(error, () => setError(""));
  // null = closed; "new" = composer; otherwise a prompt id.
  const [open, setOpen] = useState<string | null>(null);
  const opener = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(query.trim()), 220);
    return () => window.clearTimeout(id);
  }, [query]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    listPrompts({ q: debounced, category, saved, limit: PAGE })
      .then((data) => {
        if (!active) return;
        setItems(data.items);
        setTotal(Number(data.total) || 0);
        setCategories(data.categories);
        setSavedCount(data.savedCount);
        setSource(data.source);
      })
      .catch((reason) => active && setError((reason as Error).message))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [debounced, category, saved]);

  async function loadMore() {
    setLoadingMore(true);
    try {
      const data = await listPrompts({ q: debounced, category, saved, limit: PAGE, offset: items.length });
      setItems((current) => [...current, ...data.items.filter((item) => !current.some((existing) => existing.id === item.id))]);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setLoadingMore(false);
    }
  }
  const patch = (id: string, change: Partial<LibraryPrompt>) => setItems((current) => current.map((item) => (item.id === id ? { ...item, ...change } : item)));
  async function toggleFavorite(prompt: LibraryPrompt) {
    const next = !prompt.favorite;
    patch(prompt.id, { favorite: next });
    try {
      await setFavorite(prompt.id, next);
      setSavedCount((count) => count + (next ? 1 : -1));
    } catch (reason) {
      patch(prompt.id, { favorite: !next });
      setError((reason as Error).message);
    }
  }
  async function remove(prompt: LibraryPrompt) {
    try {
      await deletePrompt(prompt.id);
      setItems((current) => current.filter((item) => item.id !== prompt.id));
      setSavedCount((count) => Math.max(0, count - 1));
      setTotal((count) => Math.max(0, count - 1));
      close();
    } catch (reason) {
      setError((reason as Error).message);
    }
  }
  function show(id: string, from?: HTMLElement | null) {
    if (from) opener.current = from;
    setOpen(id);
  }
  function close() {
    setOpen(null);
    opener.current?.focus();
  }

  const index = open && open !== "new" ? items.findIndex((item) => item.id === open) : -1;
  const selected = index >= 0 ? items[index] : null;

  return (
    <div className="plib" data-theme={theme}>
      <div className="plib-scroll">
        <header className="plib-head">
          <div>
            <h1>Prompt Library</h1>
            <p>Ready-to-use prompts for visual styles, thumbnails, scripts, hooks, narration, and music. Use them here, or pick them from Suggestions while you build a video.</p>
          </div>
          <button type="button" className="plib-primary" onClick={(e) => show("new", e.currentTarget)}>
            <Plus size={16} /> New prompt
          </button>
        </header>

        <div className="plib-toolbar">
          <label className="plib-search">
            <Search size={17} aria-hidden="true" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search prompts, e.g. noir, documentary, lo-fi" aria-label="Search prompts" />
            {query && (
              <button type="button" onClick={() => setQuery("")} aria-label="Clear search">
                <X size={15} />
              </button>
            )}
          </label>
          <div className="plib-tabs" role="tablist" aria-label="Categories">
            <button role="tab" aria-selected={!category && !saved} onClick={() => { setCategory(""); setSaved(false); }}>
              All
            </button>
            {categories.map((item) => (
              <button key={item.id} role="tab" aria-selected={category === item.id} onClick={() => setCategory(category === item.id ? "" : item.id)} title={item.hint}>
                {item.label}
                {item.count ? <span>{item.count}</span> : null}
              </button>
            ))}
            <button role="tab" aria-selected={saved} className="plib-tab-saved" onClick={() => setSaved(!saved)}>
              <Star size={13} /> Saved
              {savedCount ? <span>{savedCount}</span> : null}
            </button>
          </div>
        </div>

        <p className="plib-count" aria-live="polite">
          {loading ? "Loading prompts…" : `${total.toLocaleString()} ${total === 1 ? "prompt" : "prompts"}${category ? ` in ${categoryLabel(category)}` : ""}${saved ? " saved" : ""}`}
        </p>

        {loading ? (
          <div className="plib-grid" aria-hidden="true">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="plib-card is-skeleton">
                <span className="plib-cover" />
                <span className="plib-skel-line" />
                <span className="plib-skel-line is-short" />
              </div>
            ))}
          </div>
        ) : !items.length ? (
          <div className="plib-empty">
            <Sparkles size={22} />
            <strong>{saved ? "Nothing saved yet" : "No prompts match"}</strong>
            <span>{saved ? "Star prompts you like, or write your own, and they'll appear here and at the top of Suggestions." : "Try a broader word, or clear the category filter."}</span>
          </div>
        ) : (
          <>
            <ul className="plib-grid">
              {items.map((item) => (
                <li key={item.id} className="plib-card">
                  <button type="button" className="plib-card-open" onClick={(e) => show(item.id, e.currentTarget)} aria-haspopup="dialog">
                    <span className="plib-cover">
                      <Cover prompt={item} />
                      {item.video && !item.image && <span className="plib-cover-badge">Video</span>}
                      {item.custom && <span className="plib-cover-badge is-yours">Yours</span>}
                    </span>
                    <strong className="plib-card-title">{item.title}</strong>
                    <span className="plib-card-summary">{item.summary || item.snippet}</span>
                    <span className="plib-card-cats">{item.categories.slice(0, 2).map((id) => categoryLabel(id)).join(" · ")}</span>
                  </button>
                  <button
                    type="button"
                    className={`plib-card-star ${item.favorite ? "is-on" : ""}`}
                    aria-pressed={Boolean(item.favorite)}
                    aria-label={item.favorite ? `Unsave ${item.title}` : `Save ${item.title}`}
                    onClick={() => void toggleFavorite(item)}
                  >
                    <Star size={15} />
                  </button>
                </li>
              ))}
            </ul>
            {items.length < total && (
              <div className="plib-more-wrap">
                <button type="button" className="plib-more" onClick={() => void loadMore()} disabled={loadingMore}>
                  {loadingMore ? <Loader2 size={15} className="plib-spin" /> : <ChevronDown size={15} />} Show more
                </button>
              </div>
            )}
          </>
        )}

        {source && (
          <p className="plib-footnote">
            Curated from{" "}
            <a href={source.repo} target="_blank" rel="noreferrer">
              prompts.chat
            </a>{" "}
            ({source.license}) and{" "}
            <a href="https://github.com/devanshug2307/Awesome-AI-Image-Prompts" target="_blank" rel="noreferrer">
              Awesome AI Image Prompts
            </a>{" "}
            (MIT), sorted and adapted for video creation.
          </p>
        )}
      </div>

      {open && (
        <PromptDialog
          theme={theme}
          onClose={close}
          onPrev={index > 0 ? () => setOpen(items[index - 1].id) : undefined}
          onNext={index >= 0 && index < items.length - 1 ? () => setOpen(items[index + 1].id) : undefined}
        >
          {open === "new" ? (
            <Composer
              onCancel={close}
              onCreated={(item) => {
                setItems((current) => [item, ...current]);
                setTotal((count) => count + 1);
                setSavedCount((count) => count + 1);
                setOpen(item.id);
              }}
            />
          ) : selected ? (
            <PromptDetail prompt={selected} onFavorite={() => void toggleFavorite(selected)} onDelete={() => void remove(selected)} />
          ) : null}
        </PromptDialog>
      )}
    </div>
  );
}

function PromptDialog({
  theme,
  onClose,
  onPrev,
  onNext,
  children,
}: {
  theme: string;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  children: React.ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const keys = useRef({ onClose, onPrev, onNext });
  keys.current = { onClose, onPrev, onNext };

  useEffect(() => {
    panel.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      const typing = (event.target as HTMLElement)?.closest("input, textarea");
      if (event.key === "Escape") {
        event.preventDefault();
        keys.current.onClose();
      } else if (!typing && event.key === "ArrowLeft" && keys.current.onPrev) keys.current.onPrev();
      else if (!typing && event.key === "ArrowRight" && keys.current.onNext) keys.current.onNext();
      else if (event.key === "Tab") {
        // Keep keyboard focus inside the dialog.
        const focusable = panel.current?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input, textarea, summary, [tabindex]:not([tabindex="-1"])');
        if (!focusable?.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  return createPortal(
    <div className="plib-overlay" data-theme={theme} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={panel} className="plib-dialog" role="dialog" aria-modal="true" aria-label="Prompt" tabIndex={-1}>
        <div className="plib-dialog-bar">
          {(onPrev || onNext) && (
            <span className="plib-dialog-nav">
              <button type="button" onClick={onPrev} disabled={!onPrev} aria-label="Previous prompt">
                <ChevronLeft size={18} />
              </button>
              <button type="button" onClick={onNext} disabled={!onNext} aria-label="Next prompt">
                <ChevronRight size={18} />
              </button>
            </span>
          )}
          <button type="button" className="plib-dialog-close" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

function PromptDetail({ prompt, onFavorite, onDelete }: { prompt: LibraryPrompt; onFavorite: () => void; onDelete: () => void }) {
  const { copied, copy } = useCopy();
  const hasMedia = Boolean(prompt.image || prompt.video);
  return (
    <div className={`plib-detail ${hasMedia ? "has-media" : ""}`} key={prompt.id}>
      {hasMedia && (
        <div className="plib-detail-media">
          {prompt.image && <img className="plib-detail-backdrop" src={prompt.image} alt="" aria-hidden="true" referrerPolicy="no-referrer" />}
          <Cover prompt={prompt} large />
        </div>
      )}
      <div className="plib-detail-body">
        <div className="plib-detail-cats">{prompt.categories.map((id) => <span key={id}>{categoryLabel(id)}</span>)}</div>
        <h2>{prompt.title}</h2>
        {prompt.summary && <p className="plib-summary">{prompt.summary}</p>}
        <div className="plib-snippet">
          <span>Ready to use</span>
          <p>{prompt.snippet}</p>
        </div>
        <div className="plib-actions">
          <button type="button" className="plib-primary" onClick={() => void copy("snippet", prompt.snippet)}>
            {copied === "snippet" ? <Check size={15} /> : <Copy size={15} />}
            {copied === "snippet" ? "Copied" : "Copy"}
          </button>
          <button type="button" className={`plib-outline ${prompt.favorite ? "is-on" : ""}`} onClick={onFavorite} aria-pressed={Boolean(prompt.favorite)}>
            <Star size={15} /> {prompt.favorite ? "Saved" : "Save"}
          </button>
          {prompt.custom && (
            <button type="button" className="plib-outline plib-danger" onClick={onDelete}>
              <Trash2 size={15} /> Delete
            </button>
          )}
        </div>
        {!prompt.custom && prompt.prompt && prompt.prompt !== prompt.snippet && (
          <details className="plib-original">
            <summary>Original prompt{prompt.act ? ` · “${prompt.act}”` : ""}</summary>
            <pre>{prompt.prompt}</pre>
            <button type="button" className="plib-outline" onClick={() => void copy("original", prompt.prompt || "")}>
              {copied === "original" ? <Check size={14} /> : <Copy size={14} />} {copied === "original" ? "Copied" : "Copy original"}
            </button>
          </details>
        )}
        {!prompt.custom && (
          <p className="plib-credit">
            <a href={prompt.url || "https://prompts.chat"} target="_blank" rel="noreferrer">
              {prompt.sourceName || "prompts.chat"} <ExternalLink size={11} />
            </a>
            {prompt.contributor ? ` · by ${prompt.contributor}` : ""} ·{" "}
            {prompt.licenseUrl ? (
              <a href={prompt.licenseUrl} target="_blank" rel="noreferrer">
                {prompt.license}
              </a>
            ) : prompt.license ? (
              `${prompt.license} license`
            ) : (
              "public domain (CC0)"
            )}
          </p>
        )}
      </div>
    </div>
  );
}

function Composer({ onCancel, onCreated }: { onCancel: () => void; onCreated: (item: LibraryPrompt) => void }) {
  const [title, setTitle] = useState("");
  const [snippet, setSnippet] = useState("");
  const [picked, setPicked] = useState<PromptCategoryId[]>([]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  useErrorToast(problem, () => setProblem(""));
  const ready = title.trim() && snippet.trim() && picked.length;
  async function save() {
    setBusy(true);
    setProblem("");
    try {
      const { item } = await createPrompt({ title, snippet, categories: picked });
      onCreated(item);
    } catch (reason) {
      setProblem((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="plib-detail-body plib-composer" onSubmit={(e) => { e.preventDefault(); if (ready) void save(); }}>
      <h2>New prompt</h2>
      <label>
        Name
        <input value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} placeholder="Moody noir documentary" autoFocus />
      </label>
      <fieldset>
        <legend>Suggest it for</legend>
        <div className="plib-chips">
          {CATEGORIES.map((category) => {
            const on = picked.includes(category.id);
            return (
              <button type="button" key={category.id} aria-pressed={on} className={on ? "is-on" : ""} onClick={() => setPicked(on ? picked.filter((id) => id !== category.id) : [...picked, category.id])}>
                {on && <Check size={13} />} {category.label}
              </button>
            );
          })}
        </div>
      </fieldset>
      <label>
        Prompt text
        <textarea rows={7} value={snippet} maxLength={1200} onChange={(e) => setSnippet(e.target.value)} placeholder="High-contrast black and white, hard side light, deep shadows, 35mm grain, slow push-ins" />
      </label>
      <div className="plib-actions">
        <button type="submit" className="plib-primary" disabled={!ready || busy}>
          {busy ? <Loader2 size={15} className="plib-spin" /> : <Check size={15} />} Save prompt
        </button>
        <button type="button" className="plib-outline" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
