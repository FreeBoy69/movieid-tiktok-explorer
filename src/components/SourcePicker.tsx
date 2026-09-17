import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Search, UserRound, Layers3 } from "lucide-react";
import "./SourcePicker.css";

export type SourceOption = { value: string; label: string; imageUrl?: string; kind?: "channel" | "collection" | "video"; disabled?: boolean };
function Picture({ option }: { option?: SourceOption }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [option?.imageUrl]);
  return <span className="source-picker-picture">{option?.imageUrl && !failed
    ? <img src={option.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
    : option?.kind === "collection" ? <Layers3 size={17} /> : option?.label ? <span>{option.label.replace(/^@/, "").slice(0, 2).toUpperCase()}</span> : <UserRound size={17} />}</span>;
}

export function SourcePicker({ options, value, onChange, label = "Source", placeholder = "Choose source", disabled, theme = "light", compact = false }: {
  options: SourceOption[]; value: string; onChange: (value: string) => void;
  label?: string; placeholder?: string; disabled?: boolean; theme?: "light" | "dark"; compact?: boolean;
}) {
  const [open, setOpen] = useState(false), [query, setQuery] = useState(""), [active, setActive] = useState(0);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 320, maxHeight: 360 });
  const trigger = useRef<HTMLButtonElement>(null), popup = useRef<HTMLDivElement>(null), search = useRef<HTMLInputElement>(null);
  const id = useId();
  const selected = options.find(option => option.value === value);
  const filtered = options.filter(option => option.label.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  function close(restore = false) { setOpen(false); if (restore) trigger.current?.focus(); }
  function choose(option: SourceOption) { if (!option.disabled) { onChange(option.value); close(true); } }
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(Math.max(rect.width, 320), window.innerWidth - 24);
      const below = window.innerHeight - rect.bottom - 18, above = rect.top - 18;
      const preferredHeight = Math.min(384, options.length * 48 + 56);
      const height = Math.min(preferredHeight, Math.max(below, above));
      setPosition({ left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)), top: below >= Math.min(preferredHeight, above) ? rect.bottom + 6 : Math.max(12, rect.top - height - 6), width, maxHeight: height });
    };
    place(); search.current?.focus();
    window.addEventListener("resize", place); window.addEventListener("scroll", place, true);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!popup.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) close(); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  useEffect(() => { if (open) document.getElementById(`${id}-${active}`)?.scrollIntoView({ block: "nearest" }); }, [active, open, id]);
  return <div className={`source-picker ${compact ? "is-compact" : ""}`} data-theme={theme}>
    <button ref={trigger} type="button" className="source-picker-trigger" aria-label={label} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? id : undefined} disabled={disabled}
      onClick={() => { setQuery(""); setActive(Math.max(0, options.findIndex(option => option.value === value))); setOpen(!open); }}
      onKeyDown={event => { if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setQuery(""); setActive(Math.max(0, options.findIndex(option => option.value === value))); setOpen(true); } }}>
      <Picture option={selected} /><span className="source-picker-name">{selected?.label || placeholder}</span><ChevronDown size={15} />
    </button>
    {open && createPortal(<div ref={popup} className="source-picker-popup" data-theme={theme} style={position}
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
      <div className="source-picker-search"><Search size={16} /><input ref={search} value={query} onChange={event => { setQuery(event.target.value); setActive(0); }} placeholder="Search" aria-label={`Search ${label.toLowerCase()}`} role="combobox" aria-expanded="true" aria-controls={id} aria-autocomplete="list" aria-activedescendant={filtered[active] ? `${id}-${active}` : undefined} /></div>
      <div id={id} role="listbox" aria-label={label} className="source-picker-list">
        {filtered.map((option, i) => <div key={option.value} id={`${id}-${i}`} role="option" aria-selected={option.value === value} aria-disabled={option.disabled || undefined} className={`source-picker-option ${active === i ? "is-active" : ""}`} onPointerMove={() => { if (!option.disabled) setActive(i); }} onMouseDown={event => event.preventDefault()} onClick={() => choose(option)}>
          <Picture option={option} /><span className="source-picker-name">{option.label}</span>{option.value === value && <Check className="source-picker-check" size={17} />}
        </div>)}
        {!filtered.length && <div className="source-picker-empty" role="status">{options.length ? "No results" : "No sources"}</div>}
      </div>
    </div>, document.body)}
  </div>;
}
