import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, Search, Sparkles, Star, Undo2, X } from "lucide-react";
import { categoryLabel, listPrompts, setFavorite, suggestPrompts, type LibraryPrompt, type PromptCategoryId } from "../utils/promptLibrary";
import { useErrorToast } from "../utils/toast";
import "./PromptSuggestions.css";

/**
 * Inline prompt suggestions for one field. Chips apply a prompt's snippet;
 * "Browse" opens the whole category. `append` adds to existing text instead
 * of replacing it. The previous value can be restored with Undo.
 */
export function PromptSuggestions({
  category,
  context = "",
  value,
  onChange,
  append = false,
  accountId,
  limit = 4,
}: {
  category: PromptCategoryId;
  /** Project words (topic, title, script) that rank the suggestions. */
  context?: string;
  value: string;
  onChange: (next: string) => void;
  append?: boolean;
  accountId?: string;
  limit?: number;
}) {
  const [items, setItems] = useState<LibraryPrompt[]>([]);
  const [loading, setLoading] = useState(true);
  const [undo, setUndo] = useState<{ previous: string; title: string } | null>(null);
  const [browsing, setBrowsing] = useState(false);
  const browse = useRef<HTMLButtonElement>(null);
  const undoTimer = useRef<number | undefined>(undefined);

  // Context changes as the user types elsewhere; wait for a pause.
  useEffect(() => {
    let active = true;
    const id = window.setTimeout(() => {
      suggestPrompts(category, context, accountId, limit)
        .then((data) => active && setItems(data.items))
        .catch(() => active && setItems([]))
        .finally(() => active && setLoading(false));
    }, 400);
    return () => {
      active = false;
      window.clearTimeout(id);
    };
  }, [category, context, accountId, limit]);
  useEffect(() => () => window.clearTimeout(undoTimer.current), []);

  function apply(prompt: LibraryPrompt) {
    const previous = value;
    const current = value.trim();
    onChange(append && current ? `${current}${/[.!?]$/.test(current) ? "" : "."} ${prompt.snippet}` : prompt.snippet);
    setUndo({ previous, title: prompt.title });
    window.clearTimeout(undoTimer.current);
    undoTimer.current = window.setTimeout(() => setUndo(null), 8000);
  }

  if (!loading && !items.length) return null;
  return (
    <div className="mk-suggest" aria-label={`${categoryLabel(category)} suggestions`}>
      <span className="mk-suggest-label">
        <Sparkles size={13} aria-hidden="true" /> Suggestions
      </span>
      {undo ? (
        <span className="mk-suggest-applied" role="status">
          Used “{undo.title}”
          <button type="button" onClick={() => { onChange(undo.previous); setUndo(null); }}>
            <Undo2 size={13} /> Undo
          </button>
        </span>
      ) : loading ? (
        <span className="mk-suggest-loading" aria-hidden="true">
          <i /> <i /> <i />
        </span>
      ) : (
        items.map((prompt) => (
          <button key={prompt.id} type="button" className="mk-suggest-chip" title={prompt.snippet} onClick={() => apply(prompt)}>
            {prompt.image && <img className="mk-suggest-thumb" src={prompt.image} alt="" loading="lazy" referrerPolicy="no-referrer" onError={(e) => e.currentTarget.remove()} />}
            {prompt.favorite && <Star size={11} className="mk-suggest-star" aria-label="Saved" />}
            {prompt.title}
          </button>
        ))
      )}
      <button ref={browse} type="button" className="mk-suggest-browse" aria-haspopup="dialog" aria-expanded={browsing} onClick={() => setBrowsing(!browsing)}>
        Browse
      </button>
      {browsing && (
        <BrowsePanel
          anchor={browse}
          category={category}
          accountId={accountId}
          onClose={() => setBrowsing(false)}
          onUse={(prompt) => {
            apply(prompt);
            setBrowsing(false);
          }}
        />
      )}
    </div>
  );
}

function BrowsePanel({
  anchor,
  category,
  accountId,
  onClose,
  onUse,
}: {
  anchor: React.RefObject<HTMLButtonElement | null>;
  category: PromptCategoryId;
  accountId?: string;
  onClose: () => void;
  onUse: (prompt: LibraryPrompt) => void;
}) {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<LibraryPrompt[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useErrorToast(error, () => setError(""));
  const [open, setOpen] = useState("");
  const [position, setPosition] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const mobile = window.matchMedia("(max-width: 640px)").matches;

  useLayoutEffect(() => {
    const place = () => {
      const rect = anchor.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(window.innerWidth - 16, 460);
      const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8));
      const below = window.innerHeight - rect.bottom - 16;
      const above = below < 360 && rect.top > below;
      const maxHeight = Math.min(520, (above ? rect.top : below) - 8);
      setPosition({ top: above ? rect.top - 6 - maxHeight : rect.bottom + 6, left, width, maxHeight });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchor]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    const id = window.setTimeout(() => {
      listPrompts({ category, q: query.trim(), limit: 40, accountId, primary: true })
        .then((data) => {
          if (!active) return;
          setItems(data.items);
          setTotal(data.total);
          setError("");
        })
        .catch((reason) => active && setError((reason as Error).message))
        .finally(() => active && setLoading(false));
    }, 200);
    return () => {
      active = false;
      window.clearTimeout(id);
    };
  }, [category, query, accountId]);
  useEffect(() => {
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!panel.current?.contains(target) && !anchor.current?.contains(target)) onClose();
    };
    // Capture phase so a surrounding modal doesn't also close on Escape.
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onClose();
      anchor.current?.focus();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [onClose, anchor]);

  async function toggleFavorite(prompt: LibraryPrompt) {
    const next = !prompt.favorite;
    setItems((current) => current.map((item) => (item.id === prompt.id ? { ...item, favorite: next } : item)));
    try {
      await setFavorite(prompt.id, next, accountId);
    } catch (reason) {
      setItems((current) => current.map((item) => (item.id === prompt.id ? { ...item, favorite: !next } : item)));
      setError((reason as Error).message);
    }
  }

  const host = anchor.current?.closest<HTMLElement>(".maker-workspace") || document.body;
  if (!position) return null;
  return createPortal(
    <>
      {mobile && <div className="mk-suggest-scrim" onClick={onClose} />}
      <div
        ref={panel}
        role="dialog"
        aria-label={`${categoryLabel(category)} prompts`}
        className={`mk-suggest-panel ${mobile ? "is-sheet" : ""}`}
        style={mobile ? undefined : { top: position.top, left: position.left, width: position.width, maxHeight: position.maxHeight }}
      >
        <div className="mk-suggest-panel-head">
          <strong>{categoryLabel(category)}</strong>
          <span>{loading ? "" : `${total} prompts`}</span>
          <button type="button" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <label className="mk-suggest-search">
          <Search size={15} aria-hidden="true" />
          <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search this category" aria-label="Search prompts" style={{ paddingLeft: 34 }} />
        </label>
        <div className="mk-suggest-list">
          {loading && !items.length ? (
            <div className="mk-suggest-wait"><Loader2 size={16} className="mk-suggest-spin" /></div>
          ) : !items.length ? (
            <p className="mk-suggest-none">No prompts match “{query}”.</p>
          ) : (
            items.map((prompt) => (
              <div key={prompt.id} className={`mk-suggest-item ${open === prompt.id ? "is-open" : ""}`}>
                <button type="button" className={`mk-suggest-item-main ${prompt.image ? "has-image" : ""}`} aria-expanded={open === prompt.id} onClick={() => setOpen(open === prompt.id ? "" : prompt.id)}>
                  {prompt.image && <img src={prompt.image} alt="" loading="lazy" referrerPolicy="no-referrer" onError={(e) => e.currentTarget.remove()} />}
                  <strong>
                    {prompt.title}
                    {prompt.custom && <em>Yours</em>}
                  </strong>
                  <span>{prompt.snippet}</span>
                </button>
                <div className="mk-suggest-item-actions">
                  <button type="button" className="mk-suggest-fav" aria-pressed={Boolean(prompt.favorite)} aria-label={prompt.favorite ? `Unsave ${prompt.title}` : `Save ${prompt.title}`} onClick={() => void toggleFavorite(prompt)}>
                    <Star size={14} />
                  </button>
                  <button type="button" className="mk-suggest-use" onClick={() => onUse(prompt)}>
                    Use
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </>,
    host,
  );
}
