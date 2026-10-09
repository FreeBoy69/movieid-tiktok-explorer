// Shared data, API helpers, and controls for Creator Studio apps.
import { type KeyboardEvent as ReactKeyboardEvent, ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, AudioLines, Check, ChevronDown, Download, Film, Link2, Loader2, Plus, Sparkles, Upload, Video, X } from "lucide-react";
import { confirm } from "../ui/Dialog";
import { EmptyState, Notice, SearchField, Segmented, Switch, Tabs as UiTabs } from "../ui/controls";
import { VideoPlayer } from "../VideoPlayer";
import "./Lightbox.css";
import { CREDIT_ESTIMATE_TITLE, creditEstimateLabel, providerCreditEstimate, type StudioPricing } from "./studioPricing";

export type ImageModel = { id: string; name: string; provider: string; description: string; aspectRatios: string[]; resolutions: string[]; qualities: string[]; maxImages: number; maxReferences: number };
export type VideoModel = { id: string; name: string; provider: string; description: string; aspectRatios: string[]; resolutions: string[]; durations: number[]; frames: string[]; audio: boolean; pricePerSecond: number | null };
export type AnyModel = ImageModel | VideoModel;
export type Catalog = {
  configured: boolean;
  image: ImageModel[];
  video: VideoModel[];
  avatar: VideoModel[];
  edit: VideoModel[];
  upscale: VideoModel[];
  motion: VideoModel[];
  music: { available: boolean; name: string; reason: string };
  voices: Array<{ id: string; name: string; description: string }>;
  agents: Array<{ id: string; name: string; intro: string }>;
  workflows: Array<{ id: string; name: string; steps: string[] }>;
  promo?: { model: string; renderer: boolean; music: boolean };
  explainer?: { model: string; renderer: boolean; narration: boolean };
};
export type Asset = { file: string; url: string; type: string; name?: string };
export type ExplainerLine = { text: string; cue: string };
export type ExplainerChapter = { id: string; title: string; visuals: string[]; lines: ExplainerLine[] };
export type ExplainerScript = { title: string; chapters: ExplainerChapter[] };
export type ExplainerPlan = ExplainerScript & {
  summary?: string;
  features?: Array<{ name: string; what: string }>;
  template: string;
  length: number;
  sourceUrl?: string;
  assets?: Array<{ id: string; label: string }>;
  notice?: string;
};
export type Output = Asset & { title?: string; caption?: string; start?: number; end?: number; score?: number };
export type Generation = {
  id: string;
  tab: string;
  model: string;
  prompt: string;
  settings: Record<string, any>;
  status: "queued" | "running" | "done" | "failed" | "cancelled";
  message?: string;
  steps?: Array<{ label: string; status: string }>;
  outputs: Output[];
  /** Promo Studio: the film's HTML source, kept for revisions. */
  source?: Output;
  /** Explainer Studio: a plan's drafted script, its material, and asset previews. */
  plan?: ExplainerPlan;
  kit?: Output;
  thumbs?: Output;
  /** Explainer Studio: a finished film's captions, narration mix, and timing. */
  captions?: Output;
  soundtrack?: Output;
  film?: { duration: number; aspect: string; chapters: Array<{ title: string; start: number }>; fallbacks?: number[] };
  notice?: string;
  /** A film re-rendering after edits made in its player. */
  rendering?: boolean;
  error?: string;
  createdAt: string;
};

export async function readJson(response: Response, fallback: string) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || fallback);
  return data;
}
export async function uploadAsset(file: Blob, name?: string): Promise<Asset> {
  const response = await fetch("/api/studio/uploads", { method: "POST", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file });
  return { ...(await readJson(response, "Upload failed")), ...(name ? { name } : {}) };
}
export function fit(value: string, allowed: string[], prefer: string[] = []) {
  if (!allowed.length) return "";
  if (allowed.includes(value)) return value;
  return prefer.find((item) => allowed.includes(item)) || allowed[0];
}
export function timeAgo(iso: string, now: number) {
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
export function elapsed(iso: string, now: number) {
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  usePopoverPlacement(open, ref);
  return { open, setOpen, ref };
}

const EDGE = 8;
const GAP = 8;

// Bottom of the app's fixed header (or any fixed/sticky bar at the top), so panels never open behind it.
function topLimit() {
  let limit = EDGE;
  for (const bar of document.querySelectorAll<HTMLElement>("header.ah, [data-fixed-header]")) {
    const rect = bar.getBoundingClientRect();
    if (rect.top <= 0 && rect.bottom > limit) limit = rect.bottom + EDGE;
  }
  return limit;
}

/**
 * Keeps an open popover panel on screen: it opens below its trigger when it fits (or when
 * there is more room below), otherwise above; its height is capped to the room it has, with
 * its own scroll; and it shifts sideways to stay inside the viewport. The panel is any
 * absolutely positioned child of the popover root other than the trigger. Phone bottom
 * sheets (position: fixed) are left alone.
 */
export function usePopoverPlacement(open: boolean, root: { current: HTMLElement | null }) {
  useLayoutEffect(() => {
    if (!open) return;
    let first = true;
    const place = () => {
      const box = root.current;
      if (!box) return;
      const trigger = box.firstElementChild as HTMLElement | null;
      const panel = [...box.children].find((el) => el !== trigger && getComputedStyle(el).position === "absolute") as HTMLElement | undefined;
      if (!trigger || !panel) return;
      Object.assign(panel.style, { top: "", bottom: "", maxHeight: "", overflowY: "", translate: "" });
      const anchor = trigger.getBoundingClientRect();
      const natural = panel.scrollHeight;
      const below = window.innerHeight - anchor.bottom - GAP - EDGE;
      const above = anchor.top - GAP - topLimit();
      // Below when it fits, else above when that fits; when neither does, open below at full
      // size and scroll the page just enough to show it (a tall panel squeezed into a small
      // scroll box is harder to use than a short page scroll).
      const down = natural <= below || natural > above;
      panel.style.top = down ? `calc(100% + ${GAP}px)` : "auto";
      panel.style.bottom = down ? "auto" : `calc(100% + ${GAP}px)`;
      const viewport = window.innerHeight - topLimit() - EDGE;
      if (natural > viewport) {
        panel.style.maxHeight = `${Math.max(200, viewport)}px`;
        panel.style.overflowY = "auto";
      }
      panel.dataset.place = down ? "below" : "above";
      if (first && down && natural > below) panel.scrollIntoView({ block: "nearest" });
      first = false;
      // Last resort when the page can't scroll far enough: cap to what is visible.
      const placed = panel.getBoundingClientRect();
      const visible = down ? window.innerHeight - EDGE - placed.top : placed.bottom - topLimit();
      if (placed.height > visible + 1) {
        panel.style.maxHeight = `${Math.max(160, Math.floor(visible))}px`;
        panel.style.overflowY = "auto";
      }
      const rect = panel.getBoundingClientRect();
      const shift = rect.right > window.innerWidth - EDGE ? window.innerWidth - EDGE - rect.right : rect.left < EDGE ? EDGE - rect.left : 0;
      if (shift) panel.style.translate = `${Math.round(shift)}px 0`;
    };
    place();
    const frame = requestAnimationFrame(place);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, root]);
}

// The one setting dropdown: a chip that opens a listbox. Skins dress it for each surface
// (studio prompt bars, the Create Drama composer, Cinema Studio's dock) with the same
// behaviour everywhere: Escape and outside-click close, arrow keys move, the pick is focused.
export type ChoiceOption = { value: string; label: string; hint?: string; icon?: ReactNode };
const CHOICE_SKINS = {
  studio: { root: "cs-pop", chip: "ui-chip cs-chip", label: "cs-chip-label", value: "", menu: "ui-menu cs-menu", item: "ui-menu-item cs-menu-item" },
  drama: { root: "dr-pop", chip: "dr-composer-chip is-choice", label: "dr-chip-label", value: "dr-composer-chip-text", menu: "ui-menu dr-menu", item: "ui-menu-item dr-menu-item" },
  cinema: { root: "cns-pop", chip: "ui-chip cns-look", label: "cns-look-label", value: "", menu: "ui-menu cns-panel cns-listpanel", item: "ui-menu-item" },
  "cinema-mini": { root: "cns-pop", chip: "ui-chip cns-chip", label: "", value: "", menu: "ui-menu cns-panel cns-mini", item: "ui-menu-item" },
  // Marketing, Promo, and Explainer: the dock's pill chips and their stacked option lists.
  mks: { root: "mks-pop", chip: "", label: "", value: "", menu: "ui-menu mks-tech prs-subjects", item: "ui-menu-item prs-subject" },
} as const;
export function Choice({
  label,
  value,
  options,
  onChange,
  empty,
  icon,
  skin = "studio",
  note,
  disabled,
}: {
  label: string;
  value: string;
  options: ChoiceOption[];
  onChange: (value: string) => void;
  empty?: string;
  icon?: ReactNode;
  skin?: keyof typeof CHOICE_SKINS;
  /** A line under the options, e.g. what the setting doesn't control. */
  note?: ReactNode;
  disabled?: boolean;
}) {
  const { open, setOpen, ref } = usePopover();
  const menu = useRef<HTMLDivElement>(null);
  const css = CHOICE_SKINS[skin];
  const mini = skin === "cinema-mini";
  const current = options.find((option) => option.value === value);
  const shown = current?.label || empty || (skin === "drama" ? value : "None");
  const hinted = skin === "cinema" && options.some((option) => option.hint);
  const stacked = skin === "mks";
  const chip = useRef<HTMLButtonElement>(null);
  const wrapChip = (button: ReactNode) => (stacked ? <span className="mks-chip">{button}</span> : button);
  useEffect(() => {
    if (!open) return;
    const items = menu.current?.querySelectorAll<HTMLButtonElement>('[role="option"]');
    const picked = menu.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]');
    (picked || items?.[0])?.focus({ preventScroll: false });
  }, [open]);
  // Closing from inside the list (Escape or a pick) hands focus back to the chip.
  const onMenuKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") chip.current?.focus();
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const items = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') || []);
    if (!items.length) return;
    event.preventDefault();
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (at + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    items[next].focus();
  };
  return (
    <div className={css.root} ref={ref}>
      {wrapChip(
        <button
          ref={chip}
          type="button"
          className={css.chip || undefined}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={mini || stacked ? `${label}: ${shown}` : undefined}
          onClick={() => setOpen(!open)}
          disabled={disabled || (mini ? options.length < 2 : !options.length)}
        >
          {current?.icon && !icon ? current.icon : icon}
          {!mini && css.label ? <span className={css.label}>{skin === "cinema" ? `${label}:` : label}</span> : null}
          <span className={css.value || undefined}>{shown}</span>
          {skin === "studio" || skin === "drama" || stacked ? <ChevronDown className="h-3 w-3" aria-hidden="true" /> : null}
        </button>,
      )}
      {open ? (
        <div className={css.menu} role="listbox" aria-label={label} ref={menu} onKeyDown={onMenuKey}>
          {mini ? <p>{label}</p> : null}
          {options.map((option) => {
            const on = option.value === value;
            const check = on ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : null;
            return (
              <button key={option.value} type="button" role="option" aria-selected={on} className={css.item || undefined} title={hinted || stacked ? undefined : option.hint} onClick={() => { onChange(option.value); setOpen(false); chip.current?.focus(); }}>
                {stacked ? (
                  <>
                    <span>
                      <strong>{option.label}</strong>
                      {option.hint ? <small>{option.hint}</small> : null}
                    </span>
                    {check}
                  </>
                ) : hinted ? (
                  <>
                    <strong>{option.label}{check}</strong>
                    {option.hint ? <span>{option.hint}</span> : null}
                  </>
                ) : (
                  <>
                    {option.icon}
                    <span>{option.label}</span>
                    {check}
                  </>
                )}
              </button>
            );
          })}
          {note ? <p className={stacked ? "prs-format-note" : "cs-choice-note"}>{note}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

// On/off setting shaped as a chip for composer bars; the switch itself is the shared ui Switch.
export function Toggle({ label, value, onChange, icon, className }: { label: ReactNode; value: boolean; onChange: (value: boolean) => void; icon?: ReactNode; className?: string }) {
  return <Switch compact className={`cs-toggle${className ? ` ${className}` : ""}`} checked={value} onChange={onChange} label={icon ? <>{icon}{label}</> : label} />;
}

export function Segment<T extends string>({ label, value, options, onChange, className, block }: { label: string; value: T; options: Array<{ value: T; label: ReactNode; icon?: ReactNode; hint?: string; disabled?: boolean }>; onChange: (value: T) => void; className?: string; block?: boolean }) {
  return <Segmented label={label} value={value} options={options} onChange={onChange} className={className} block={block} />;
}

// Searchable model list with provider filters, like the Open Generative AI picker.
export function ModelPicker({ models, value, onChange, loading, pricing, auto }: { models: AnyModel[]; value: string; onChange: (id: string) => void; loading: boolean; pricing?: StudioPricing | null; /** Offer "let the server choose" as the empty value. */ auto?: { label: string; description?: string } }) {
  const { open, setOpen, ref } = usePopover();
  const [query, setQuery] = useState("");
  const [providerFilter, setProviderFilter] = useState("");
  const providers = useMemo(() => [...new Set(models.map((m) => m.provider))].sort(), [models]);
  const current = models.find((m) => m.id === value);
  const shown = models.filter((m) =>
    (!providerFilter || m.provider === providerFilter) &&
    (!query || `${m.name} ${m.id} ${m.description}`.toLowerCase().includes(query.toLowerCase())),
  );
  return (
    <div className="cs-pop" ref={ref}>
      <button type="button" className="ui-chip cs-chip cs-chip-model" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(!open)} disabled={!models.length}>
        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
        <span className="cs-truncate">{current?.name || (auto && !value && models.length ? auto.label : loading ? "Loading models" : "No models available")}</span>
        <ChevronDown className="h-3 w-3" />
      </button>
      {open ? (
        <div className="ui-menu cs-menu cs-model-menu" role="dialog" aria-label="Choose a model">
          {/* On touch screens focusing the search would open the keyboard over the list. */}
          <SearchField size="sm" autoFocus={typeof window !== "undefined" && window.matchMedia?.("(pointer: fine)").matches} value={query} onChange={setQuery} placeholder={`Search ${models.length} models`} />
          {providers.length > 1 ? (
            <div className="cs-providers">
              <button type="button" className="ui-chip" aria-pressed={!providerFilter} onClick={() => setProviderFilter("")}>All</button>
              {providers.map((p) => (
                <button key={p} type="button" className="ui-chip" aria-pressed={providerFilter === p} onClick={() => setProviderFilter(providerFilter === p ? "" : p)}>{p}</button>
              ))}
            </div>
          ) : null}
          <div className="cs-model-list" role="listbox" aria-label="Models">
            {auto && !query && !providerFilter ? (
              <button type="button" role="option" aria-selected={!value} className="ui-menu-item cs-model" onClick={() => { onChange(""); setOpen(false); }}>
                <span className="cs-model-name">{auto.label}{!value ? <Check className="h-3.5 w-3.5" /> : null}</span>
                {auto.description ? <span className="cs-model-desc">{auto.description}</span> : null}
              </button>
            ) : null}
            {shown.length ? shown.map((m) => (
              <button key={m.id} type="button" role="option" aria-selected={m.id === value} className="ui-menu-item cs-model" onClick={() => { onChange(m.id); setOpen(false); }}>
                <span className="cs-model-name">{m.name}{m.id === value ? <Check className="h-3.5 w-3.5" /> : null}</span>
                <span className="cs-model-facts" title={pricing ? CREDIT_ESTIMATE_TITLE : undefined}>{modelFacts(m, pricing || null)}</span>
                {m.description ? <span className="cs-model-desc">{m.description}</span> : null}
              </button>
            )) : <p className="cs-model-none">No models match “{query}”.</p>}
          </div>
        </div>
      ) : null}
    </div>
  );
}
function modelFacts(m: AnyModel, pricing: StudioPricing | null) {
  const facts = [m.provider || m.id.split("/")[0]];
  if ("maxReferences" in m) facts.push(m.maxReferences ? `up to ${m.maxReferences} references` : "text only");
  if ("durations" in m) {
    if (m.durations.length) facts.push(`${m.durations[0]}–${m.durations[m.durations.length - 1]}s`);
    const frames = m.frames || [];
    if (frames.includes("first_frame") && frames.includes("last_frame")) facts.push("start + end frame");
    else if (frames.includes("first_frame")) facts.push("start frame");
    if (m.audio) facts.push("sound");
    const creditsPerSecond = providerCreditEstimate(m.pricePerSecond, pricing);
    if (creditsPerSecond !== null) facts.push(`${creditEstimateLabel(creditsPerSecond)}/s`);
  }
  return facts.join(" · ");
}

function useUpload(onError: (message: string) => void) {
  const [busy, setBusy] = useState(false);
  const upload = useCallback(async (file: File, name = file.name) => {
    setBusy(true);
    try {
      return await uploadAsset(file, name);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Upload failed");
      return null;
    } finally {
      setBusy(false);
    }
  }, [onError]);
  return { busy, upload };
}

export const IMAGE_TYPES = "image/png,image/jpeg,image/webp";
export const VIDEO_TYPES = "video/mp4,video/quicktime,video/webm";

export function MediaSlot({ label, accept, asset, onChange, onError, compact }: { label: string; accept: string; asset?: Asset; onChange: (asset?: Asset) => void; onError: (message: string) => void; compact?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const { busy, upload } = useUpload(onError);
  const kind = accept.startsWith("audio") ? "audio" : accept.startsWith("video") ? "video" : "image";
  return (
    <div className={compact ? "cs-slot cs-slot-compact" : "cs-slot"}>
      <input ref={input} type="file" accept={accept} hidden onChange={async (event) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (file) {
          const uploaded = await upload(file);
          if (uploaded) onChange(uploaded);
        }
      }} />
      {asset ? (
        <div className="cs-slot-filled">
          {kind === "image" ? <img src={asset.url} alt={label} /> : kind === "video" ? <video src={asset.url} muted playsInline preload="metadata" /> : (
            <span className="cs-slot-audio"><AudioLines className="h-4 w-4" /><span className="cs-truncate">{asset.name || "Audio track"}</span></span>
          )}
          <span className="cs-slot-tag">{label}</span>
          <button type="button" className="cs-slot-clear" onClick={() => onChange(undefined)} aria-label={`Remove ${label.toLowerCase()}`}><X className="h-3 w-3" /></button>
        </div>
      ) : (
        <button type="button" className="cs-slot-empty" onClick={() => input.current?.click()} disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : kind === "video" ? <Film className="h-4 w-4" /> : <Upload className="h-4 w-4" />}
          <span>{busy ? "Uploading" : label}</span>
        </button>
      )}
    </div>
  );
}

/** Saves the image behind a link: a direct image, a page with a preview image, or a YouTube or other video link (its thumbnail). */
export async function importLinkAsset(url: string, kind: "image" | "video" = "image"): Promise<Asset> {
  return readJson(
    await fetch("/api/studio/imports", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: url.trim(), kind }) }),
    "Could not import that link",
  );
}
export const LINK_PATTERN = /^(https?:\/\/)?[^\s]+\.[^\s]+/;

// One paste-a-link field: the reference tray's link box, the tools' "or paste a link" row,
// and the text tools' page reader. `onSubmit` does the work; the field shows the busy state.
export function LinkField({
  label,
  placeholder,
  action = "Import",
  busyAction = "Fetching",
  onSubmit,
  onError,
  skin = "studio",
  autoFocus,
  onCancel,
}: {
  label: string;
  placeholder?: string;
  action?: string;
  busyAction?: string;
  onSubmit: (url: string) => Promise<void>;
  onError: (message: string) => void;
  skin?: "studio" | "tool";
  autoFocus?: boolean;
  onCancel?: () => void;
}) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const ready = LINK_PATTERN.test(url.trim()) && !busy;
  async function go() {
    if (!ready) return;
    setBusy(true);
    try {
      await onSubmit(url.trim());
      setUrl("");
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not use that link");
    } finally {
      setBusy(false);
    }
  }
  const tool = skin === "tool";
  return (
    <div className={tool ? "mt-link cs-linkfield" : "cs-linkfield"}>
      <span className="cs-linkfield-input">
        <Link2 size={15} aria-hidden="true" />
        <input
          className={tool ? "ui-input mt-input" : "ui-input cs-input"}
          type="url"
          inputMode="url"
          autoFocus={autoFocus}
          value={url}
          disabled={busy}
          aria-label={label}
          placeholder={placeholder || label}
          onChange={(event) => setUrl(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void go();
            }
            if (event.key === "Escape" && !busy && onCancel) onCancel();
          }}
        />
      </span>
      <button type="button" className={tool ? "ui-btn mt-secondary" : "ui-btn is-sm cs-ghost"} disabled={!ready} onClick={() => void go()}>
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
        {busy ? busyAction : action}
      </button>
    </div>
  );
}

/** Paste a link instead of uploading. Images: a direct image, a page's preview image, or a video link's thumbnail. Video: a link the server downloads. */
export function LinkImport({ kind, onImport, onError, skin = "tool", autoFocus, onCancel }: { kind: "image" | "video"; onImport: (asset: Asset) => void; onError: (message: string) => void; skin?: "studio" | "tool"; autoFocus?: boolean; onCancel?: () => void }) {
  return (
    <LinkField
      skin={skin}
      autoFocus={autoFocus}
      onCancel={onCancel}
      label={kind === "video" ? "Video link" : "Image, YouTube, or video link"}
      placeholder={kind === "video" ? "or paste a video link" : skin === "studio" ? "Image, YouTube, or video link" : "or paste an image or video link"}
      action={skin === "studio" ? "Add" : "Import"}
      busyAction={kind === "video" ? "Downloading" : "Fetching"}
      onError={onError}
      onSubmit={async (url) => onImport(await importLinkAsset(url, kind))}
    />
  );
}

/** Opens under a reference tray for pasting a link instead of uploading. */
function ReferenceLinkBox({ kind, onAdd, onClose, onError }: { kind: "image" | "video"; onAdd: (asset: Asset) => void; onClose: () => void; onError: (message: string) => void }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const away = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (box.current && !box.current.contains(target) && !target?.closest?.(".cs-ref-link")) onClose();
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [onClose]);
  return (
    <div ref={box} className="cs-ref-linkbox" role="dialog" aria-label="Add from a link">
      <LinkImport skin="studio" kind={kind} autoFocus onCancel={onClose} onError={onError} onImport={(asset) => { onAdd(asset); onClose(); }} />
    </div>
  );
}

const stripExtension = (name: string) => name.replace(/\.[^.]+$/, "");

/**
 * The one strip of uploaded files: thumbnails with remove buttons, an add button, and
 * paste-a-link. Images by default; pass VIDEO_TYPES for recordings.
 */
export function ReferenceTray({
  assets,
  max,
  onChange,
  onError,
  accept = IMAGE_TYPES,
  link = true,
  label = "reference images",
  tagFor,
  maxBytes,
  empty,
  className,
}: {
  assets: Asset[];
  max: number;
  onChange: (assets: Asset[]) => void;
  onError: (message: string) => void;
  accept?: string;
  /** Offer paste-a-link (images and video links). */
  link?: boolean;
  /** What the files are, for the add button's label: "screenshots", "product photos". */
  label?: string;
  /** A tag over one thumbnail, e.g. "Start frame" on the first. */
  tagFor?: (index: number) => string | undefined;
  maxBytes?: number;
  /** Shown beside the add button while the tray is empty. */
  empty?: ReactNode;
  className?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const { busy, upload } = useUpload(onError);
  const [linking, setLinking] = useState(false);
  const closeLink = useCallback(() => setLinking(false), []);
  const video = accept.startsWith("video");
  const kinds = accept.split(",").map((type) => type.trim());
  return (
    <div className={className ? `cs-refs ${className}` : "cs-refs"}>
      <input ref={input} type="file" accept={accept} multiple={max - assets.length > 1} hidden onChange={async (event) => {
        const picked = Array.from(event.target.files || []);
        event.target.value = "";
        const files = picked.filter((file) => kinds.includes(file.type)).slice(0, max - assets.length);
        if (picked.length && !files.length) return onError(video ? "Use an MP4, MOV, or WebM video" : "Use PNG, JPG, or WebP images");
        const added: Asset[] = [];
        for (const file of files) {
          if (maxBytes && file.size > maxBytes) {
            onError(`${file.name} is over ${Math.round(maxBytes / 1024 / 1024)} MB`);
            continue;
          }
          const uploaded = await upload(file, stripExtension(file.name));
          if (uploaded) added.push(uploaded);
        }
        if (added.length) onChange([...assets, ...added].slice(0, max));
      }} />
      {assets.map((asset, index) => {
        const tag = tagFor?.(index);
        return (
          <div key={asset.file} className="cs-ref" title={asset.name || undefined}>
            {String(asset.type || "").startsWith("video") || video ? <video src={asset.url} muted playsInline preload="metadata" /> : <img src={asset.url} alt={asset.name || "Reference"} />}
            {tag ? <span className="cs-ref-tag">{tag}</span> : null}
            <button type="button" className="cs-slot-clear" onClick={() => onChange(assets.filter((a) => a.file !== asset.file))} aria-label={`Remove ${asset.name || tag || "this file"}`}><X className="h-3 w-3" /></button>
          </div>
        );
      })}
      {assets.length < max ? (
        <>
          <button type="button" className="cs-ref-add" onClick={() => input.current?.click()} disabled={busy} aria-label={`Upload ${label} (up to ${max})`} title={`Upload ${label}, up to ${max}`}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : video ? <Video className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          </button>
          {link ? (
            <button type="button" className="cs-ref-add cs-ref-link" onClick={() => setLinking((open) => !open)} aria-expanded={linking} aria-label={`Add ${label} from a link`} title={video ? "Paste a video link" : "Paste an image, YouTube, or video link"}>
              <Link2 className="h-4 w-4" />
            </button>
          ) : null}
          {!assets.length && empty ? <span className="cs-refs-empty">{empty}</span> : null}
        </>
      ) : null}
      {linking && assets.length < max ? <ReferenceLinkBox kind={video ? "video" : "image"} onAdd={(asset) => onChange([...assets, asset].slice(0, max))} onClose={closeLink} onError={onError} /> : null}
    </div>
  );
}

// Big radio cards for a short list of named choices with a line of detail each.
export function OptionCards({ label, options, value, onChange, className }: { label: string; options: Array<{ value: string; label: string; hint?: string; icon?: ReactNode }>; value: string; onChange: (value: string) => void; className?: string }) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const selected = Math.max(0, options.findIndex((option) => option.value === value));
  const move = (from: number, step: number) => {
    const next = (from + step + options.length) % options.length;
    onChange(options[next].value);
    refs.current[next]?.focus();
  };
  return (
    <div className={className ? `cs-options ${className}` : "cs-options"} role="radiogroup" aria-label={label}>
      {options.map((option, index) => (
        <button
          key={option.value}
          ref={(node) => { refs.current[index] = node; }}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          tabIndex={index === selected ? 0 : -1}
          className="cs-option"
          onClick={() => onChange(option.value)}
          onKeyDown={(event) => {
            if (event.key === "ArrowRight" || event.key === "ArrowDown") { event.preventDefault(); move(index, 1); }
            if (event.key === "ArrowLeft" || event.key === "ArrowUp") { event.preventDefault(); move(index, -1); }
          }}
        >
          {option.icon}
          <strong>{option.label}</strong>
          {option.hint ? <span>{option.hint}</span> : null}
        </button>
      ))}
    </div>
  );
}

// ---------- Aspect ratio ----------
export type AspectOption = string | { value: string; label?: string; hint?: string; ratio?: [number, number] };
function aspectParts(option: AspectOption) {
  const value = typeof option === "string" ? option : option.value;
  const custom = typeof option === "string" ? undefined : option.ratio;
  const [w, h] = custom || value.split(":").map(Number);
  return {
    value,
    label: (typeof option === "string" ? undefined : option.label) || (value === "auto" ? "Auto" : value),
    hint: typeof option === "string" ? undefined : option.hint,
    w: Number.isFinite(w) && w > 0 ? w : 1,
    h: Number.isFinite(h) && h > 0 ? h : 1,
    auto: value === "auto",
  };
}
/** The frame's shape, drawn to scale inside a small box. */
export function AspectGlyph({ ratio }: { ratio: string | [number, number] }) {
  const { w, h, auto } = aspectParts(Array.isArray(ratio) ? { value: "custom", ratio } : ratio);
  return <span className={auto ? "cs-aspect-glyph is-auto" : "cs-aspect-glyph"} style={{ aspectRatio: `${w} / ${h}`, [w >= h ? "width" : "height"]: "100%" }} aria-hidden="true" />;
}

/**
 * The one aspect-ratio picker. Pass only what the chosen model supports (filter the
 * model's aspectRatios); "auto" in the list lets the server decide. Variants:
 * "segment" (inline glyph buttons), "chip" (a dropdown for composer bars), "cards" (named canvases).
 */
export function AspectPicker({
  value,
  onChange,
  options,
  variant = "segment",
  label = "Aspect ratio",
  skin = "studio",
  disabled,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  options: AspectOption[];
  variant?: "segment" | "chip" | "cards";
  label?: string;
  /** Chip variant only: the Choice skin for the surface it sits on. */
  skin?: keyof typeof CHOICE_SKINS;
  disabled?: boolean;
  className?: string;
}) {
  const parts = options.map(aspectParts);
  const icon = (part: ReturnType<typeof aspectParts>) => <span className="cs-aspect-box"><AspectGlyph ratio={part.auto ? "auto" : [part.w, part.h]} /></span>;
  if (variant === "chip") {
    return <Choice skin={skin} label={label} value={value} disabled={disabled} options={parts.map((part) => ({ value: part.value, label: part.label, hint: part.hint, icon: icon(part) }))} onChange={onChange} />;
  }
  if (variant === "cards") {
    return <OptionCards className={className ? `cs-aspect-cards ${className}` : "cs-aspect-cards"} label={label} value={value} onChange={onChange} options={parts.map((part) => ({ value: part.value, label: part.label, hint: part.hint, icon: icon(part) }))} />;
  }
  return (
    <Segmented
      label={label}
      value={value}
      onChange={onChange}
      className={className ? `cs-aspect-seg is-tiles ${className}` : "cs-aspect-seg is-tiles"}
      options={parts.map((part) => ({ value: part.value, label: <span className="prs-num">{part.label}</span>, icon: icon(part), disabled, title: part.hint }))}
    />
  );
}

/** The notice every generator shows when this server has no generation provider. */
export function GenerationUnavailable({ className, children }: { className?: string; children?: ReactNode }) {
  return (
    <Notice tone="warning" className={className ? `cs-unavailable ${className}` : "cs-unavailable"} title="Generation isn't set up on this server yet">
      {children || "Generating needs a model provider. An admin can add one in the server settings."}
    </Notice>
  );
}
/** A persistent studio problem (catalog failed, no model fits) in the same notice style. */
export function StudioNotice({ tone = "warning", children, className }: { tone?: "warning" | "error" | "info"; children: ReactNode; className?: string }) {
  return (
    <Notice tone={tone} className={className ? `cs-unavailable ${className}` : "cs-unavailable"}>
      <span className="cs-notice-line"><AlertCircle className="h-4 w-4" aria-hidden="true" />{children}</span>
    </Notice>
  );
}

/** Confirm, remove from the list, and delete a generation and its files. Resolves true when deleted. */
export function useDeleteGeneration(onRemoved: (id: string) => void, noun = "generation") {
  return useCallback(async (item: { id: string }) => {
    const ok = await confirm({ title: `Delete this ${noun}?`, body: "Its files are deleted too. This can't be undone.", confirmLabel: "Delete", danger: true });
    if (!ok) return false;
    onRemoved(item.id);
    await fetch(`/api/studio/generations/${encodeURIComponent(item.id)}`, { method: "DELETE" }).catch(() => undefined);
    return true;
  }, [onRemoved, noun]);
}

export function Empty({ icon, heading, body, children }: { icon: ReactNode; heading: string; body: string; children?: ReactNode }) {
  return <EmptyState className="cs-empty" icon={icon} title={heading} body={body}>{children}</EmptyState>;
}

export function Lightbox({ src, onClose }: { src: string; onClose: () => void }) {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    close.current?.focus();
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="cs-lightbox" role="dialog" aria-modal="true" aria-label="Full size preview" onClick={onClose}>
      {/\.(mp4|webm|mov)($|\?)/i.test(src) ? (
        <div className="cs-lightbox-media" onClick={(event) => event.stopPropagation()}>
          <VideoPlayer src={src} autoPlay size="fit" label="Clip preview" />
        </div>
      ) : (
        <img src={src} alt="Full size preview" onClick={(event) => event.stopPropagation()} />
      )}
      <div className="cs-lightbox-bar" onClick={(event) => event.stopPropagation()}>
        <a className="ui-icon-btn cs-icon" href={`${src}${src.includes("?") ? "&" : "?"}download=1`} aria-label="Download" title="Download">
          <Download className="h-4 w-4" />
        </a>
        <button ref={close} type="button" className="ui-icon-btn cs-icon" onClick={onClose} aria-label="Close preview" title="Close"><X className="h-4 w-4" /></button>
      </div>
    </div>
  );
}

// Tab bar used inside apps to split long option sets into groups (the shared ui Tabs).
export function Tabs<T extends string>({ label, value, options, onChange, compact }: { label: string; value: T; options: Array<{ value: T; label: string; hint?: string; icon?: ReactNode }>; onChange: (value: T) => void; compact?: boolean }) {
  return <UiTabs label={label} value={value} options={options} onChange={onChange} className={compact ? "cs-tabs-compact" : undefined} />;
}
