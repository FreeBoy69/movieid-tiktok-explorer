import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AudioLines, Check, ChevronsUpDown, Loader2, Mic, Play, Search, Sparkles, Square, Star, X } from "lucide-react";
import { usePreview, voicePreviewUrl } from "../utils/voicePreview";
import { isVoiceReady, type VoiceProfile } from "../utils/voiceProfiles";
import "./VoicePicker.css";

type Kind = "cloned" | "preset" | "hosted";
const kindOf = (voice: VoiceProfile): Kind =>
  voice.voiceType === "cloned" ? "cloned" : voice.presetEngine === "hosted" || voice.id.startsWith("openrouter:") ? "hosted" : "preset";
const GROUPS: Array<[Kind, string]> = [
  ["cloned", "Your cloned voices"],
  ["preset", "Preset voices"],
  ["hosted", "Built-in voices"],
];
const KIND_ICON = { cloned: Mic, preset: AudioLines, hosted: Sparkles };

// Quick filters: who it sounds like and what it's for, read from the voice's own description.
const FILTERS: Array<{ id: string; label: string; test: (voice: VoiceProfile, favorite: boolean) => boolean }> = [
  { id: "favorites", label: "Favorites", test: (_voice, favorite) => favorite },
  { id: "f", label: "Women", test: (voice) => voice.gender === "f" },
  { id: "m", label: "Men", test: (voice) => voice.gender === "m" },
  { id: "narrator", label: "Narration", test: (voice) => /narrat|documentar|informative|explainer|knowledgeable|storytell|clear|even/i.test(voice.description || "") },
  { id: "energy", label: "Energetic", test: (voice) => /upbeat|lively|excit|energ|bright|forward|hype/i.test(voice.description || "") },
  { id: "calm", label: "Calm and warm", test: (voice) => /calm|warm|smooth|soft|gentle|breathy|intimate|relaxed|easy|mature/i.test(voice.description || "") },
  { id: "cloned", label: "Cloned", test: (voice) => kindOf(voice) === "cloned" },
];
const FAVORITES_KEY = "autoyt-voice-favorites";
function readFavorites(): string[] {
  try {
    const list = JSON.parse(localStorage.getItem(FAVORITES_KEY) || "[]");
    return Array.isArray(list) ? list.map(String) : [];
  } catch {
    return [];
  }
}

function hue(id: string) {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash % 360;
}
function detail(voice: VoiceProfile) {
  const kind = kindOf(voice);
  if (kind === "cloned") return isVoiceReady(voice) ? "Cloned voice" : "Cloned · needs a voice sample";
  if (kind === "hosted") return voice.description || "Built-in voice";
  const engine = voice.presetEngine || voice.defaultEngine;
  return [engine ? `${engine[0].toUpperCase()}${engine.slice(1)} preset` : "Preset", voice.description].filter(Boolean).join(" · ");
}

export function VoiceAvatar({ voice, size = 36 }: { voice: VoiceProfile; size?: number }) {
  const Icon = KIND_ICON[kindOf(voice)];
  return (
    <span className="mk-voice-avatar" style={{ ["--voice-hue" as string]: hue(voice.id), width: size, height: size }} aria-hidden="true">
      <Icon size={Math.round(size * 0.46)} strokeWidth={2} />
    </span>
  );
}

export function VoicePicker({
  voices,
  value,
  onChange,
  labelledBy,
  disabled,
  loading,
  placeholder = "Choose a voice",
  empty,
  noneLabel,
  chip,
}: {
  voices: VoiceProfile[];
  value?: string;
  onChange: (id: string) => void;
  labelledBy?: string;
  disabled?: boolean;
  loading?: boolean;
  placeholder?: string;
  /** Shown in the popup when there are no voices. */
  empty?: ReactNode;
  /** A compact toolbar chip trigger ("Voice  Graham ▾") instead of the full field. */
  chip?: boolean;
  /** Adds a first row that clears the choice, e.g. "Choose per project". */
  noneLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("");
  const [favorites, setFavorites] = useState<string[]>(readFavorites);
  const toggleFavorite = (id: string) =>
    setFavorites((current) => {
      const next = current.includes(id) ? current.filter((item) => item !== id) : [...current, id];
      try {
        localStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
      } catch {
        // Favorites are a convenience; the picker works without them.
      }
      return next;
    });
  const [position, setPosition] = useState<{ top: number; left: number; width: number; maxHeight: number; above: boolean } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const preview = usePreview();
  const selected = voices.find((voice) => voice.id === value);

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const rule = FILTERS.find((item) => item.id === filter);
    const matches = voices.filter(
      (voice) =>
        (!needle || `${voice.name} ${voice.description || ""} ${detail(voice)}`.toLowerCase().includes(needle)) &&
        (!rule || rule.test(voice, favorites.includes(voice.id))),
    );
    // Favorites lead the list (unless that's the filter already).
    const starred = filter === "favorites" ? [] : matches.filter((voice) => favorites.includes(voice.id));
    return [
      ...(starred.length ? [{ kind: "favorites", label: "Favorites", voices: starred }] : []),
      ...GROUPS.map(([kind, label]) => ({ kind, label, voices: matches.filter((voice) => kindOf(voice) === kind && !starred.includes(voice)) })),
    ].filter((group) => group.voices.length);
  }, [voices, query, filter, favorites]);
  const filters = useMemo(() => FILTERS.filter((item) => voices.some((voice) => item.test(voice, favorites.includes(voice.id)))), [voices, favorites]);

  const place = () => {
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(window.innerWidth - 16, Math.max(rect.width, 400));
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    const below = window.innerHeight - rect.bottom - 16;
    const above = below < 320 && rect.top > below;
    const maxHeight = Math.min(460, (above ? rect.top : below) - 8);
    setPosition({ top: above ? rect.top - 6 : rect.bottom + 6, left, width, maxHeight, above });
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

  useEffect(() => {
    if (!open) return;
    const focusFirst = () => {
      if (search.current) return search.current.focus();
      (panel.current?.querySelector<HTMLElement>('[aria-checked="true"]') || panel.current?.querySelector<HTMLElement>('[role="radio"]:not(:disabled)'))?.focus();
    };
    requestAnimationFrame(focusFirst);
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!panel.current?.contains(target) && !trigger.current?.contains(target)) close();
    };
    // Escape closes from anywhere, even before focus has moved into the panel.
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      close(true);
    };
    document.addEventListener("pointerdown", onPointer);
    // Capture phase so a surrounding modal doesn't also close on the same key.
    document.addEventListener("keydown", onEscape, true);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onEscape, true);
    };
  }, [open]);

  function close(restoreFocus = false) {
    setOpen(false);
    setQuery("");
    setFilter("");
    preview.stop();
    if (restoreFocus) trigger.current?.focus();
  }
  function choose(voice: VoiceProfile) {
    onChange(voice.id);
    close(true);
  }
  function onKeyDown(event: React.KeyboardEvent) {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const items = [...(panel.current?.querySelectorAll<HTMLElement>('[role="radio"]:not(:disabled)') || [])];
    if (!items.length) return;
    event.preventDefault();
    const index = items.indexOf(document.activeElement as HTMLElement);
    const next =
      event.key === "Home" ? 0
      : event.key === "End" ? items.length - 1
      : event.key === "ArrowDown" ? (index + 1) % items.length
      : (index - 1 + items.length) % items.length;
    items[next].focus();
  }

  const host = trigger.current?.closest<HTMLElement>(".maker-workspace") || (typeof document !== "undefined" ? document.body : null);
  const mobile = typeof window !== "undefined" && window.matchMedia("(max-width: 640px)").matches;

  return (
    <>
      {chip ? (
        <button
          ref={trigger}
          type="button"
          className="cs-chip"
          aria-haspopup="dialog"
          aria-expanded={open}
          disabled={disabled || (!voices.length && !loading)}
          onClick={() => (open ? close() : setOpen(true))}
        >
          <span className="cs-chip-label">Voice</span>
          <span>{selected ? selected.name : loading ? "Loading" : voices.length ? placeholder : "No voices yet"}</span>
          <ChevronsUpDown className="h-3 w-3" />
        </button>
      ) : (
      <button
        ref={trigger}
        type="button"
        className="mk-voice-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-labelledby={labelledBy}
        disabled={disabled}
        onClick={() => (open ? close() : setOpen(true))}
      >
        {selected ? <VoiceAvatar voice={selected} size={32} /> : <span className="mk-voice-avatar is-empty" aria-hidden="true"><Mic size={15} /></span>}
        <span className="mk-voice-trigger-text">
          <strong>{selected ? selected.name : loading ? "Loading voices…" : noneLabel || placeholder}</strong>
          <small>{selected ? detail(selected) : voices.length ? `${voices.length} voices available` : loading ? "" : "No voices yet"}</small>
        </span>
        {loading ? <Loader2 size={16} className="mk-voice-spin" /> : <ChevronsUpDown size={16} className="mk-voice-chevron" />}
      </button>
      )}
      {open && host && position &&
        createPortal(
          <>
            {mobile && <div className="mk-voice-scrim" onClick={() => close(true)} />}
            <div
              ref={panel}
              role="dialog"
              aria-labelledby={titleId}
              className={`mk-voice-panel ${mobile ? "is-sheet" : ""} ${position.above ? "is-above" : ""}`}
              style={mobile ? undefined : { top: position.top, left: position.left, width: position.width, maxHeight: position.maxHeight }}
              onKeyDown={onKeyDown}
            >
              <div className="mk-voice-panel-head">
                <strong id={titleId}>Choose a voice</strong>
                <button type="button" className="mk-voice-close" onClick={() => close(true)} aria-label="Close">
                  <X size={16} />
                </button>
              </div>
              {voices.length > 6 && (
                <label className="mk-voice-search">
                  <Search size={15} aria-hidden="true" />
                  <input ref={search} value={query} placeholder="Search voices" aria-label="Search voices" style={{ paddingLeft: 34 }} onChange={(e) => setQuery(e.target.value)} />
                </label>
              )}
              {voices.length > 6 && filters.length > 1 && (
                <div className="mk-voice-filters" role="group" aria-label="Filter voices">
                  <button type="button" className={!filter ? "is-on" : ""} aria-pressed={!filter} onClick={() => setFilter("")}>All</button>
                  {filters.map((item) => (
                    <button key={item.id} type="button" className={filter === item.id ? "is-on" : ""} aria-pressed={filter === item.id} onClick={() => setFilter(filter === item.id ? "" : item.id)}>
                      {item.id === "favorites" ? <Star size={12} aria-hidden="true" /> : null}
                      {item.label}
                    </button>
                  ))}
                </div>
              )}
              <div className="mk-voice-list" role="radiogroup" aria-labelledby={titleId}>
                {noneLabel && !query && (
                  <div className={`mk-voice-row ${!value ? "is-selected" : ""}`}>
                    <button type="button" role="radio" aria-checked={!value} className="mk-voice-choose" tabIndex={!value ? 0 : -1} onClick={() => { onChange(""); close(true); }}>
                      <span className="mk-voice-avatar is-empty" style={{ width: 36, height: 36 }} aria-hidden="true"><Mic size={16} /></span>
                      <span className="mk-voice-text">
                        <strong>{noneLabel}</strong>
                        <small>No fixed voice</small>
                      </span>
                      {!value && <Check size={16} className="mk-voice-check" aria-hidden="true" />}
                    </button>
                  </div>
                )}
                {!voices.length ? (
                  <div className="mk-voice-empty">{empty || "No voices are available yet."}</div>
                ) : !groups.length ? (
                  <div className="mk-voice-empty">{query ? `No voices match “${query}”.` : "No voices in this filter yet."}</div>
                ) : (
                  groups.map((group) => (
                    <section key={group.kind} className="mk-voice-group" aria-label={group.label}>
                      <h4>{group.label}</h4>
                      {group.voices.map((voice) => {
                        const ready = isVoiceReady(voice);
                        const isSelected = voice.id === value;
                        const status = preview.state?.key === voice.id ? preview.state.status : null;
                        return (
                          <div key={voice.id} className={`mk-voice-row ${isSelected ? "is-selected" : ""} ${status === "playing" ? "is-previewing" : ""}`}>
                            <button
                              type="button"
                              role="radio"
                              aria-checked={isSelected}
                              className="mk-voice-choose"
                              disabled={!ready}
                              tabIndex={isSelected || (!value && voice === group.voices[0]) ? 0 : -1}
                              onClick={() => choose(voice)}
                            >
                              <VoiceAvatar voice={voice} />
                              <span className="mk-voice-text">
                                <strong>{voice.name}</strong>
                                <small>{status === "error" ? "Preview unavailable right now" : detail(voice)}</small>
                              </span>
                              {isSelected && <Check size={16} className="mk-voice-check" aria-hidden="true" />}
                            </button>
                            <button
                              type="button"
                              className={`mk-voice-star ${favorites.includes(voice.id) ? "is-on" : ""}`}
                              aria-pressed={favorites.includes(voice.id)}
                              aria-label={favorites.includes(voice.id) ? `Remove ${voice.name} from favorites` : `Add ${voice.name} to favorites`}
                              title={favorites.includes(voice.id) ? "Remove from favorites" : "Favorite"}
                              onClick={() => toggleFavorite(voice.id)}
                            >
                              <Star size={14} fill={favorites.includes(voice.id) ? "currentColor" : "none"} />
                            </button>
                            <button
                              type="button"
                              className="mk-voice-preview"
                              disabled={!ready}
                              aria-label={status === "playing" || status === "loading" ? `Stop preview of ${voice.name}` : `Preview ${voice.name}`}
                              onClick={() => void preview.toggle(voice.id, voicePreviewUrl(voice.id))}
                            >
                              {status === "loading" ? (
                                <Loader2 size={15} className="mk-voice-spin" />
                              ) : status === "playing" ? (
                                <Square size={12} fill="currentColor" />
                              ) : (
                                <Play size={14} fill="currentColor" className="mk-voice-play-glyph" />
                              )}
                            </button>
                          </div>
                        );
                      })}
                    </section>
                  ))
                )}
              </div>
            </div>
          </>,
          host,
        )}
    </>
  );
}
