import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AudioLines, Check, ChevronsUpDown, Loader2, Mic, Play, Search, Sparkles, Square, X } from "lucide-react";
import { claimPlayback } from "./AudioPlayer";
import { isVoiceReady, type VoiceProfile } from "../utils/voiceProfiles";
import "./VoicePicker.css";

type Kind = "cloned" | "preset" | "hosted";
const kindOf = (voice: VoiceProfile): Kind =>
  voice.voiceType === "cloned" ? "cloned" : voice.presetEngine === "hosted" || voice.id.startsWith("openrouter:") ? "hosted" : "preset";
const GROUPS: Array<[Kind, string]> = [
  ["cloned", "Your cloned voices"],
  ["preset", "Voicebox voices"],
  ["hosted", "Built-in voices"],
];
const KIND_ICON = { cloned: Mic, preset: AudioLines, hosted: Sparkles };

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

// One shared element so previews never overlap each other or other players.
let previewAudio: HTMLAudioElement | null = null;
function usePreview() {
  const [state, setState] = useState<{ id: string; status: "loading" | "playing" | "error" } | null>(null);
  const current = useRef<string>("");
  const stop = () => {
    current.current = "";
    previewAudio?.pause();
    setState(null);
  };
  useEffect(() => stop, []);
  async function toggle(voice: VoiceProfile) {
    if (state?.id === voice.id && state.status !== "error") return stop();
    previewAudio ??= new Audio();
    const audio = previewAudio;
    audio.pause();
    current.current = voice.id;
    setState({ id: voice.id, status: "loading" });
    audio.src = `/api/voicebox/profiles/${encodeURIComponent(voice.id)}/preview`;
    audio.onplaying = () => current.current === voice.id && setState({ id: voice.id, status: "playing" });
    audio.onended = () => current.current === voice.id && setState(null);
    audio.onerror = () => current.current === voice.id && setState({ id: voice.id, status: "error" });
    try {
      claimPlayback(audio);
      await audio.play();
    } catch (error) {
      if ((error as Error)?.name !== "AbortError" && current.current === voice.id) setState({ id: voice.id, status: "error" });
    }
  }
  return { state, toggle, stop };
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
  /** Adds a first row that clears the choice, e.g. "Choose per project". */
  noneLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [position, setPosition] = useState<{ top: number; left: number; width: number; maxHeight: number; above: boolean } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const preview = usePreview();
  const selected = voices.find((voice) => voice.id === value);

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matches = voices.filter((voice) => !needle || `${voice.name} ${voice.description || ""} ${detail(voice)}`.toLowerCase().includes(needle));
    return GROUPS.map(([kind, label]) => ({ kind, label, voices: matches.filter((voice) => kindOf(voice) === kind) })).filter((group) => group.voices.length);
  }, [voices, query]);

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
                  <div className="mk-voice-empty">No voices match “{query}”.</div>
                ) : (
                  groups.map((group) => (
                    <section key={group.kind} className="mk-voice-group" aria-label={group.label}>
                      <h4>{group.label}</h4>
                      {group.voices.map((voice) => {
                        const ready = isVoiceReady(voice);
                        const isSelected = voice.id === value;
                        const status = preview.state?.id === voice.id ? preview.state.status : null;
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
                              className="mk-voice-preview"
                              disabled={!ready}
                              aria-label={status === "playing" || status === "loading" ? `Stop preview of ${voice.name}` : `Preview ${voice.name}`}
                              onClick={() => void preview.toggle(voice)}
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
