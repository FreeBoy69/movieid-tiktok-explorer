import { useEffect, useId, useRef, useState, type ClipboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Search, UserRound, Layers3, Link2, Loader2, Tags, X } from "lucide-react";
import "./SourcePicker.css";

export type SourceOption = { value: string; label: string; imageUrl?: string; kind?: "channel" | "collection" | "video"; disabled?: boolean };
type UrlSubmitResult = void | boolean | Promise<void | boolean>;
type PickerTab = "sources" | "tags";
function Picture({ option }: { option?: SourceOption }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [option?.imageUrl]);
  return <span className="source-picker-picture">{option?.imageUrl && !failed
    ? <img src={option.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
    : option?.kind === "collection" ? <Layers3 size={17} /> : option?.label ? <span>{option.label.replace(/^@/, "").slice(0, 2).toUpperCase()}</span> : <UserRound size={17} />}</span>;
}

export function SourcePicker({ options, value, onChange, label = "Source", placeholder = "Choose source", disabled, theme = "light", compact = false, ariaLabel, sourcesTabLabel = "Saved sources", searchLabel, actionIcon, urlValue, onUrlChange, onUrlSubmit, urlPlaceholder = "Paste TikTok or YouTube URL", urlError, tags, selectedTags, onToggleTag }: {
  options: SourceOption[]; value: string; onChange: (value: string) => void;
  label?: string; placeholder?: string; disabled?: boolean; theme?: "light" | "dark"; compact?: boolean;
  ariaLabel?: string; sourcesTabLabel?: string; searchLabel?: string; actionIcon?: ReactNode;
  urlValue?: string; onUrlChange?: (value: string) => void; onUrlSubmit?: (value: string) => UrlSubmitResult; urlPlaceholder?: string; urlError?: string;
  tags?: string[]; selectedTags?: string[]; onToggleTag?: (tag: string) => void;
}) {
  const [open, setOpen] = useState(false), [query, setQuery] = useState(""), [active, setActive] = useState(0), [pickerTab, setPickerTab] = useState<PickerTab>("sources");
  const [urlDraft, setUrlDraft] = useState(""), [urlBusy, setUrlBusy] = useState(false), [localUrlError, setLocalUrlError] = useState("");
  const trigger = useRef<HTMLButtonElement>(null), popup = useRef<HTMLDivElement>(null), search = useRef<HTMLInputElement>(null);
  const id = useId();
  const selected = options.find(option => option.value === value);
  const filtered = options.filter(option => option.label.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const draftUrl = urlValue ?? urlDraft;
  const hasUrlFlow = Boolean(onUrlSubmit || onUrlChange || urlValue !== undefined);
  const hasTags = Boolean(tags?.length && onToggleTag);
  const modalMeta = pickerTab === "sources"
    ? `${filtered.length} ${filtered.length === 1 ? "option" : "options"}`
    : `${selectedTags?.length || 0} selected`;
  function close(restore = false) { setOpen(false); if (restore) trigger.current?.focus(); }
  function choose(option: SourceOption) { if (!option.disabled) { onChange(option.value); close(true); } }
  function updateUrl(value: string) { if (onUrlChange) onUrlChange(value); else setUrlDraft(value); setLocalUrlError(""); }
  async function submitUrl(rawValue = draftUrl) {
    const next = rawValue.trim();
    if (!next || !onUrlSubmit || urlBusy) return;
    setUrlBusy(true);
    setLocalUrlError("");
    try {
      const result = await onUrlSubmit(next);
      if (result !== false) close(true);
    } catch (error) {
      setLocalUrlError(error instanceof Error ? error.message : "Could not analyze this source");
    } finally {
      setUrlBusy(false);
    }
  }
  function handleUrlPaste(event: ClipboardEvent<HTMLInputElement>) {
    const pasted = event.clipboardData.getData("text").trim();
    if (!/^https?:\/\//i.test(pasted) || !onUrlSubmit) return;
    event.preventDefault();
    updateUrl(pasted);
    void submitUrl(pasted);
  }
  useEffect(() => { if (open) search.current?.focus(); }, [open]);
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, [open]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  useEffect(() => { if (open) document.getElementById(`${id}-${active}`)?.scrollIntoView({ block: "nearest" }); }, [active, open, id]);
  return <div className={`source-picker ${compact ? "is-compact" : ""}`} data-theme={theme}>
    <button ref={trigger} type="button" className="source-picker-trigger" data-open={open || undefined} aria-label={ariaLabel || label} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? `${id}-dialog` : undefined} disabled={disabled}
      onClick={() => { setQuery(""); setActive(Math.max(0, options.findIndex(option => option.value === value))); if (!open) setPickerTab("sources"); setOpen(!open); }}
      onKeyDown={event => { if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setQuery(""); setActive(Math.max(0, options.findIndex(option => option.value === value))); setOpen(true); } }}>
      <Picture option={selected} />
      <span className="source-picker-trigger-copy"><span className="source-picker-name">{selected?.label || placeholder}</span><span className="source-picker-trigger-meta">{selected ? selected.kind === "collection" ? "Collection" : selected.kind === "video" ? "Video source" : "Channel source" : options.length ? `${options.length} saved sources` : "Add a source"}</span></span>
      <span className="source-picker-trigger-action" aria-hidden="true">{actionIcon ?? <Layers3 size={15} />}</span>
    </button>
    {open && createPortal(<div className="source-picker-overlay" data-source-picker-overlay="true" onPointerDown={event => { if (event.target === event.currentTarget) close(true); }}>
      <div ref={popup} id={`${id}-dialog`} className="source-picker-popup" data-theme={theme} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`}
      onBlur={event => { if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) close(); }}
      onKeyDown={event => {
        if (event.key === "Escape") { event.stopPropagation(); event.preventDefault(); close(true); }
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          const available = filtered.map((option, i) => option.disabled ? -1 : i).filter(i => i >= 0);
          if (!available.length) return;
          const current = available.indexOf(active), step = event.key === "ArrowUp" ? -1 : 1;
          setActive(event.key === "Home" ? available[0] : event.key === "End" ? available.at(-1)! : available[(current + step + available.length) % available.length]);
        }
        if (event.key === "Enter" && filtered[active]) { event.preventDefault(); choose(filtered[active]); }
      }}>
      <div className="source-picker-modal-head">
        <div className="source-picker-modal-title"><span className="source-picker-modal-icon"><Layers3 size={16} /></span><strong id={`${id}-title`}>{label}</strong></div>
        <div className="source-picker-modal-actions"><span>{modalMeta}</span><button type="button" className="source-picker-close" onClick={() => close(true)} aria-label="Close source picker" title="Close"><X size={17} /></button></div>
      </div>
      <div className="source-picker-tabs" role="tablist" aria-label={`${label} options`}>
        <button id={`${id}-sources-tab`} type="button" role="tab" aria-selected={pickerTab === "sources"} aria-controls={`${id}-sources`} className={`source-picker-tab ${pickerTab === "sources" ? "is-active" : ""}`} onClick={() => setPickerTab("sources")}><Layers3 size={14} />{sourcesTabLabel}</button>
        {hasTags ? <button id={`${id}-tags-tab`} type="button" role="tab" aria-selected={pickerTab === "tags"} aria-controls={`${id}-tags`} className={`source-picker-tab ${pickerTab === "tags" ? "is-active" : ""}`} onClick={() => setPickerTab("tags")}><Tags size={14} />Saved tags</button> : null}
      </div>
      {pickerTab === "sources" ? <div id={`${id}-sources`} role="tabpanel" aria-labelledby={`${id}-sources-tab`} className="source-picker-tabpanel">
        <div className="source-picker-search"><Search size={16} /><input ref={search} value={query} onChange={event => { setQuery(event.target.value); setActive(0); }} placeholder="Search" aria-label={searchLabel || `Search ${label.toLowerCase()}`} role="combobox" aria-expanded="true" aria-controls={id} aria-autocomplete="list" aria-activedescendant={filtered[active] ? `${id}-${active}` : undefined} /></div>
        <div id={id} role="listbox" aria-label={label} className="source-picker-list">
          {filtered.map((option, i) => <div key={option.value} id={`${id}-${i}`} role="option" aria-selected={option.value === value} aria-disabled={option.disabled || undefined} className={`source-picker-option ${active === i ? "is-active" : ""}`} onPointerMove={() => { if (!option.disabled) setActive(i); }} onMouseDown={event => event.preventDefault()} onClick={() => choose(option)}>
            <Picture option={option} /><span className="source-picker-name">{option.label}</span>{option.value === value && <Check className="source-picker-check" size={17} />}
          </div>)}
          {!filtered.length && <div className="source-picker-empty" role="status">{options.length ? "No results" : "No sources"}</div>}
        </div>
      </div> : null}
      {pickerTab === "sources" && hasUrlFlow ? <div id={`${id}-sources-link`} role="group" className="source-picker-url-panel">
        <div className="source-picker-panel-label"><Link2 size={14} /><strong>Paste link</strong></div>
        <div className="source-picker-url-row">
          <input value={draftUrl} onChange={event => updateUrl(event.target.value)} onPaste={handleUrlPaste} onKeyDown={event => { if (event.key === "Enter") { event.stopPropagation(); event.preventDefault(); void submitUrl(); } }} placeholder={urlPlaceholder} inputMode="url" autoComplete="off" aria-label={`${label} link`} />
          <button type="button" onClick={() => void submitUrl()} disabled={!draftUrl.trim() || urlBusy} className="source-picker-url-submit" title="Analyze source" aria-label={urlBusy ? "Analyzing source" : "Analyze source"}>{urlBusy ? <Loader2 size={16} className="source-picker-spin" /> : <Search size={16} />}</button>
        </div>
        {(urlError || localUrlError) ? <p className="source-picker-url-error" role="alert">{urlError || localUrlError}</p> : null}
      </div> : null}
      {pickerTab === "tags" && hasTags ? <div id={`${id}-tags`} role="tabpanel" aria-labelledby={`${id}-tags-tab`} className="source-picker-tabpanel source-picker-tags-panel">
        <div className="source-picker-panel-label"><Tags size={14} /><strong>Saved tags</strong></div>
        <div className="source-picker-tags">{tags?.map(tag => {
          const activeTag = selectedTags?.some(item => item.toLowerCase() === tag.toLowerCase());
          return <button key={tag} type="button" aria-pressed={activeTag} className={`source-picker-tag ${activeTag ? "is-selected" : ""}`} onClick={() => onToggleTag?.(tag)}>{tag}</button>;
        })}</div>
      </div> : null}
    </div></div>, document.body)}
  </div>;
}
