import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronsUpDown, Search, X } from "lucide-react";
import "./LanguagePicker.css";

// One language list for the whole app. `code` is ISO 639-1 (what Voicebox and the
// script writers take); `locale` is the BCP-47 tag Gemini voices take.
export type Language = { code: string; name: string; native: string; locale: string };
export const LANGUAGES: Language[] = [
  { code: "en", name: "English", native: "English", locale: "en-US" },
  { code: "es", name: "Spanish", native: "Español", locale: "es-US" },
  { code: "fr", name: "French", native: "Français", locale: "fr-FR" },
  { code: "de", name: "German", native: "Deutsch", locale: "de-DE" },
  { code: "it", name: "Italian", native: "Italiano", locale: "it-IT" },
  { code: "pt", name: "Portuguese", native: "Português", locale: "pt-BR" },
  { code: "ja", name: "Japanese", native: "日本語", locale: "ja-JP" },
  { code: "ko", name: "Korean", native: "한국어", locale: "ko-KR" },
  { code: "zh", name: "Chinese", native: "中文", locale: "zh-CN" },
  { code: "hi", name: "Hindi", native: "हिन्दी", locale: "hi-IN" },
  { code: "ar", name: "Arabic", native: "العربية", locale: "ar-EG" },
  { code: "id", name: "Indonesian", native: "Bahasa Indonesia", locale: "id-ID" },
  { code: "ru", name: "Russian", native: "Русский", locale: "ru-RU" },
  { code: "tr", name: "Turkish", native: "Türkçe", locale: "tr-TR" },
  { code: "vi", name: "Vietnamese", native: "Tiếng Việt", locale: "vi-VN" },
  { code: "th", name: "Thai", native: "ไทย", locale: "th-TH" },
  { code: "nl", name: "Dutch", native: "Nederlands", locale: "nl-NL" },
  { code: "pl", name: "Polish", native: "Polski", locale: "pl-PL" },
  { code: "sw", name: "Swahili", native: "Kiswahili", locale: "sw-KE" },
];

// What the self-hosted voice engines (Voicebox: Kokoro and Qwen) speak.
export const VOICEBOX_LANGUAGES = ["en", "zh", "ja", "ko", "de", "fr", "es", "pt", "it", "sw"];

const base = (value: string) => value.toLowerCase().split(/[-_]/)[0];

export function findLanguage(value: string) {
  return LANGUAGES.find((language) => language.code === base(value || ""));
}

export function languageName(value: string) {
  return findLanguage(value)?.name || (value || "").toUpperCase();
}

const AUTO = "auto";

export type FieldOption = { value: string; label: string; sub?: string; badge?: string; search?: string };

/** A field-shaped button that opens a searchable, keyboard-driven list. The
 *  one dropdown for form rails (language, engine, …); chip-style choices in
 *  docks use studioShared Choice. */
export function FieldPicker({
  value,
  onChange,
  options,
  label,
  placeholder = "Choose",
  searchPlaceholder = "Search",
  disabled = false,
  className = "",
}: {
  value: string;
  onChange: (value: string) => void;
  options: FieldOption[];
  label: string;
  placeholder?: string;
  searchPlaceholder?: string;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [position, setPosition] = useState<{ top: number; left: number; width: number; maxHeight: number; above: boolean } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const listId = useId();

  const selected = options.find((option) => option.value === value);
  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return options;
    return options.filter((option) => `${option.label} ${option.sub || ""} ${option.value} ${option.search || ""}`.toLowerCase().includes(needle));
  }, [options, query]);
  const searchable = options.length > 8;
  const showBadges = options.some((option) => option.badge);

  const place = () => {
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(window.innerWidth - 16, Math.max(rect.width, 260));
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    const below = window.innerHeight - rect.bottom - 16;
    const above = below < 280 && rect.top > below;
    setPosition({ top: above ? rect.top - 6 : rect.bottom + 6, left, width, maxHeight: Math.min(380, (above ? rect.top : below) - 8), above });
  };
  useLayoutEffect(() => {
    if (!open) return;
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  function close(refocus = false) {
    setOpen(false);
    setQuery("");
    if (refocus) trigger.current?.focus();
  }
  function show() {
    setActive(Math.max(0, options.findIndex((option) => option === selected)));
    setOpen(true);
  }
  function choose(option: FieldOption) {
    onChange(option.value);
    close(true);
  }

  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => (searchable ? search.current : panel.current?.querySelector<HTMLElement>('[aria-selected="true"]') || panel.current)?.focus());
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!panel.current?.contains(target) && !trigger.current?.contains(target)) close();
    };
    // Capture phase so a surrounding modal doesn't also close on the same Escape.
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      close(true);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onEscape, true);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onEscape, true);
    };
  }, [open]);

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    if (open) panel.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((index) => (index + step + matches.length) % Math.max(1, matches.length));
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      setActive(event.key === "Home" ? 0 : matches.length - 1);
    } else if (event.key === "Enter" && matches[active]) {
      event.preventDefault();
      choose(matches[active]);
    } else if (event.key === "Tab") {
      close();
    }
  }

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={`lang-pick-trigger ${showBadges ? "" : "is-plain"} ${className}`.trim()}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label}: ${selected?.label || value || "not set"}`}
        disabled={disabled}
        onClick={() => (open ? close() : show())}
        onKeyDown={(event) => {
          if ((event.key === "ArrowDown" || event.key === "ArrowUp") && !open) {
            event.preventDefault();
            show();
          }
        }}
      >
        {showBadges ? <span className="lang-pick-code" aria-hidden="true">{selected?.badge || "·"}</span> : null}
        {/* strong + small keeps the field corners (the global pill rule skips that pair). */}
        <span className="lang-pick-name">
          <strong>{selected?.label || value || placeholder}</strong>
          <small>{selected?.sub || ""}</small>
        </span>
        <ChevronsUpDown size={15} className="lang-pick-chevron" aria-hidden="true" />
      </button>
      {open && position &&
        createPortal(
          <div
            ref={panel}
            className={`lang-pick-panel ${position.above ? "is-above" : ""}`}
            style={{ top: position.top, left: position.left, width: position.width, maxHeight: position.maxHeight }}
            onKeyDown={onKeyDown}
            tabIndex={-1}
          >
            <div className="lang-pick-head">
              {searchable ? (
                <label className="lang-pick-search">
                  <Search size={14} aria-hidden="true" />
                  <input
                    ref={search}
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={searchPlaceholder}
                    aria-label={searchPlaceholder}
                    aria-controls={listId}
                    aria-activedescendant={matches[active] ? `${listId}-${active}` : undefined}
                  />
                </label>
              ) : (
                <strong>{label}</strong>
              )}
              <button type="button" className="lang-pick-close" onClick={() => close(true)} aria-label="Close">
                <X size={15} />
              </button>
            </div>
            <div id={listId} className="lang-pick-list" role="listbox" aria-label={label}>
              {matches.map((option, index) => {
                const isOn = option === selected;
                return (
                  <button
                    key={option.value}
                    id={`${listId}-${index}`}
                    data-index={index}
                    type="button"
                    role="option"
                    aria-selected={isOn}
                    className={`lang-pick-option ${index === active ? "is-active" : ""}`}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => choose(option)}
                  >
                    {showBadges ? <span className="lang-pick-code" aria-hidden="true">{option.badge || "·"}</span> : null}
                    <span className="lang-pick-name">
                      {option.label}
                      {option.sub ? <small>{option.sub}</small> : null}
                    </span>
                    {isOn ? <Check size={15} className="lang-pick-check" aria-hidden="true" /> : null}
                  </button>
                );
              })}
              {!matches.length ? <p className="lang-pick-empty">Nothing matches “{query}”.</p> : null}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

export function LanguagePicker({
  value,
  onChange,
  only,
  format = "code",
  auto,
  label = "Language",
  disabled = false,
  className = "",
}: {
  value: string;
  onChange: (value: string) => void;
  /** Restrict to these codes (e.g. VOICEBOX_LANGUAGES), in list order. */
  only?: string[];
  /** "locale" hands back BCP-47 tags (en-US) instead of codes (en). */
  format?: "code" | "locale";
  /** Offers an "auto" choice with this label, e.g. "Match the script". */
  auto?: string;
  /** Names the field for screen readers and heads the panel. */
  label?: string;
  disabled?: boolean;
  className?: string;
}) {
  const options = useMemo<FieldOption[]>(() => {
    const pool = only ? (only.map((code) => LANGUAGES.find((language) => language.code === base(code))).filter(Boolean) as Language[]) : LANGUAGES;
    return [
      ...(auto ? [{ value: AUTO, label: auto, badge: "A" }] : []),
      ...pool.map((language) => ({
        value: format === "locale" ? language.locale : language.code,
        label: language.name,
        sub: language.native !== language.name ? language.native : undefined,
        badge: language.code.toUpperCase(),
        search: `${language.code} ${language.locale}`,
      })),
    ];
  }, [only, auto, format]);
  // Accept either form ("en" or "en-US") for the current value.
  const found = value === AUTO ? null : findLanguage(value);
  const current = value === AUTO || !found ? value : format === "locale" ? found.locale : found.code;
  return (
    <FieldPicker
      value={current}
      onChange={onChange}
      options={options}
      label={label}
      placeholder="Choose a language"
      searchPlaceholder="Search languages"
      disabled={disabled}
      className={className}
    />
  );
}
