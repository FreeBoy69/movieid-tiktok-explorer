import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Copy, Loader2, Plus, Search, Sparkles, Star, Trash2, X } from "lucide-react";
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
import "./PromptLibrary.css";

const PAGE = 30;

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
  const [selectedId, setSelectedId] = useState("");
  const [composing, setComposing] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const { copied, copy } = useCopy();

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
        setTotal(data.total);
        setCategories(data.categories);
        setSavedCount(data.savedCount);
        setSource(data.source);
        setSelectedId((current) => (data.items.some((item) => item.id === current) ? current : data.items[0]?.id || ""));
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
      if (saved && !next && !prompt.custom) setItems((current) => current.filter((item) => item.id !== prompt.id));
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
      setSelectedId("");
    } catch (reason) {
      setError((reason as Error).message);
    }
  }

  const selected = useMemo(() => items.find((item) => item.id === selectedId) || null, [items, selectedId]);
  const libraryTotal = categories.reduce((sum, item) => Math.max(sum, item.count || 0), 0);
  const select = (id: string) => {
    setComposing(false);
    setSelectedId(id);
    setSheetOpen(true);
  };

  return (
    <div className="plib" data-theme={theme}>
      <div className="plib-scroll">
        <header className="plib-head">
          <div>
            <h1>Prompt Library</h1>
            <p>Ready-to-use prompts for visual styles, thumbnails, scripts, hooks, narration, and music. Use them here, or pick them from Suggestions while you build a video.</p>
          </div>
          <button type="button" className="plib-primary" onClick={() => { setComposing(true); setSheetOpen(true); }}>
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

        {error && (
          <p className="plib-error" role="alert">
            {error}
            <button type="button" onClick={() => setError("")} aria-label="Dismiss">
              <X size={14} />
            </button>
          </p>
        )}

        <div className="plib-body">
          <section className="plib-list" aria-label="Prompts" aria-busy={loading}>
            <p className="plib-count">
              {loading ? "Loading prompts…" : `${total.toLocaleString()} ${total === 1 ? "prompt" : "prompts"}${category ? ` in ${categoryLabel(category)}` : ""}${saved ? " saved" : ""}`}
            </p>
            {loading ? (
              Array.from({ length: 6 }, (_, index) => <div key={index} className="plib-skeleton" />)
            ) : !items.length ? (
              <div className="plib-empty">
                <Sparkles size={20} />
                <strong>{saved ? "Nothing saved yet" : "No prompts match"}</strong>
                <span>{saved ? "Star prompts you like, or write your own, and they'll appear here and at the top of Suggestions." : "Try a broader word, or clear the category filter."}</span>
              </div>
            ) : (
              <>
                {items.map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    className={`plib-row ${item.id === selectedId && !composing ? "is-selected" : ""}`}
                    aria-current={item.id === selectedId && !composing ? "true" : undefined}
                    onClick={() => select(item.id)}
                  >
                    <span className="plib-row-title">
                      <strong>{item.title}</strong>
                      {item.custom && <em>Yours</em>}
                      {item.favorite && <Star size={13} className="plib-star-on" aria-label="Saved" />}
                    </span>
                    <span className="plib-row-snippet">{item.snippet}</span>
                    <span className="plib-row-tags">{item.categories.map((id) => categoryLabel(id)).join(" · ")}</span>
                  </button>
                ))}
                {items.length < total && (
                  <button type="button" className="plib-more" onClick={() => void loadMore()} disabled={loadingMore}>
                    {loadingMore ? <Loader2 size={15} className="plib-spin" /> : <ChevronDown size={15} />} Show more
                  </button>
                )}
              </>
            )}
          </section>

          <aside className={`plib-detail ${sheetOpen ? "is-open" : ""}`} aria-label={composing ? "New prompt" : "Prompt details"}>
            <button type="button" className="plib-sheet-close" onClick={() => setSheetOpen(false)} aria-label="Close">
              <X size={18} />
            </button>
            {composing ? (
              <Composer
                onCancel={() => setComposing(false)}
                onCreated={(item) => {
                  setItems((current) => [item, ...current]);
                  setTotal((count) => count + 1);
                  setSavedCount((count) => count + 1);
                  setComposing(false);
                  setSelectedId(item.id);
                }}
              />
            ) : selected ? (
              <div className="plib-detail-body">
                <div className="plib-detail-cats">{selected.categories.map((id) => <span key={id}>{categoryLabel(id)}</span>)}</div>
                <h2>{selected.title}</h2>
                {selected.summary && <p className="plib-summary">{selected.summary}</p>}
                <div className="plib-snippet">
                  <span>Ready to use</span>
                  <p>{selected.snippet}</p>
                </div>
                <div className="plib-actions">
                  <button type="button" className="plib-primary" onClick={() => void copy(`s-${selected.id}`, selected.snippet)}>
                    {copied === `s-${selected.id}` ? <Check size={15} /> : <Copy size={15} />}
                    {copied === `s-${selected.id}` ? "Copied" : "Copy"}
                  </button>
                  <button type="button" className={`plib-outline ${selected.favorite ? "is-on" : ""}`} onClick={() => void toggleFavorite(selected)} aria-pressed={Boolean(selected.favorite)}>
                    <Star size={15} /> {selected.favorite ? "Saved" : "Save"}
                  </button>
                  {selected.custom && (
                    <button type="button" className="plib-outline plib-danger" onClick={() => void remove(selected)}>
                      <Trash2 size={15} /> Delete
                    </button>
                  )}
                </div>
                {!selected.custom && selected.prompt && selected.prompt !== selected.snippet && (
                  <details className="plib-original">
                    <summary>Original prompt{selected.act ? ` · “${selected.act}”` : ""}</summary>
                    <pre>{selected.prompt}</pre>
                    <button type="button" className="plib-outline" onClick={() => void copy(`p-${selected.id}`, selected.prompt || "")}>
                      {copied === `p-${selected.id}` ? <Check size={14} /> : <Copy size={14} />} {copied === `p-${selected.id}` ? "Copied" : "Copy original"}
                    </button>
                  </details>
                )}
                {!selected.custom && (
                  <p className="plib-credit">
                    From <a href="https://prompts.chat" target="_blank" rel="noreferrer">prompts.chat</a>
                    {selected.contributor ? ` · by ${selected.contributor}` : ""} · public domain (CC0)
                  </p>
                )}
              </div>
            ) : (
              <div className="plib-detail-empty">
                <Sparkles size={22} />
                <span>Choose a prompt to see it in full.</span>
              </div>
            )}
          </aside>
        </div>
        {source && (
          <p className="plib-footnote">
            {libraryTotal ? "Curated" : "Built"} from{" "}
            <a href={`${source.repo}/tree/${source.commit}`} target="_blank" rel="noreferrer">
              prompts.chat
            </a>{" "}
            ({source.license}), sorted and adapted for video creation.
          </p>
        )}
      </div>
      {sheetOpen && <div className="plib-scrim" onClick={() => setSheetOpen(false)} />}
    </div>
  );
}

function Composer({ onCancel, onCreated }: { onCancel: () => void; onCreated: (item: LibraryPrompt) => void }) {
  const [title, setTitle] = useState("");
  const [snippet, setSnippet] = useState("");
  const [picked, setPicked] = useState<PromptCategoryId[]>([]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
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
      {problem && <p className="plib-error" role="alert">{problem}</p>}
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
