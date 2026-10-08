// Shared data, API helpers, and controls for Creator Studio apps.
import { type KeyboardEvent as ReactKeyboardEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AudioLines, Check, ChevronDown, Download, Film, Link2, Loader2, Plus, Search, Sparkles, Upload, X } from "lucide-react";
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
  return { open, setOpen, ref };
}

// The one setting dropdown: a chip that opens a listbox. Skins dress it for each surface
// (studio prompt bars, the Create Drama composer, Cinema Studio's dock) with the same
// behaviour everywhere: Escape and outside-click close, arrow keys move, the pick is focused.
export type ChoiceOption = { value: string; label: string; hint?: string };
const CHOICE_SKINS = {
  studio: { root: "cs-pop", chip: "cs-chip", label: "cs-chip-label", value: "", menu: "cs-menu", item: "cs-menu-item" },
  drama: { root: "dr-pop", chip: "dr-composer-chip is-choice", label: "dr-chip-label", value: "dr-composer-chip-text", menu: "dr-menu", item: "dr-menu-item" },
  cinema: { root: "cns-pop", chip: "cns-look", label: "cns-look-label", value: "", menu: "cns-panel cns-listpanel", item: "" },
  "cinema-mini": { root: "cns-pop", chip: "cns-chip", label: "", value: "", menu: "cns-panel cns-mini", item: "" },
} as const;
export function Choice({
  label,
  value,
  options,
  onChange,
  empty,
  icon,
  skin = "studio",
}: {
  label: string;
  value: string;
  options: ChoiceOption[];
  onChange: (value: string) => void;
  empty?: string;
  icon?: ReactNode;
  skin?: keyof typeof CHOICE_SKINS;
}) {
  const { open, setOpen, ref } = usePopover();
  const menu = useRef<HTMLDivElement>(null);
  const css = CHOICE_SKINS[skin];
  const mini = skin === "cinema-mini";
  const current = options.find((option) => option.value === value);
  const shown = current?.label || empty || (skin === "drama" ? value : "None");
  const hinted = skin === "cinema" && options.some((option) => option.hint);
  const chip = useRef<HTMLButtonElement>(null);
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
      <button
        ref={chip}
        type="button"
        className={css.chip}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={mini ? `${label}: ${shown}` : undefined}
        onClick={() => setOpen(!open)}
        disabled={mini ? options.length < 2 : !options.length}
      >
        {icon}
        {!mini && css.label ? <span className={css.label}>{skin === "cinema" ? `${label}:` : label}</span> : null}
        <span className={css.value || undefined}>{shown}</span>
        {skin === "studio" || skin === "drama" ? <ChevronDown className="h-3 w-3" aria-hidden="true" /> : null}
      </button>
      {open ? (
        <div className={css.menu} role="listbox" aria-label={label} ref={menu} onKeyDown={onMenuKey}>
          {mini ? <p>{label}</p> : null}
          {options.map((option) => {
            const on = option.value === value;
            const check = on ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : null;
            return (
              <button key={option.value} type="button" role="option" aria-selected={on} className={css.item || undefined} title={hinted ? undefined : option.hint} onClick={() => { onChange(option.value); setOpen(false); chip.current?.focus(); }}>
                {hinted ? (
                  <>
                    <strong>{option.label}{check}</strong>
                    {option.hint ? <span>{option.hint}</span> : null}
                  </>
                ) : (
                  <>
                    <span>{option.label}</span>
                    {check}
                  </>
                )}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (value: boolean) => void }) {
  return (
    <button type="button" className="cs-chip" role="switch" aria-checked={value} onClick={() => onChange(!value)}>
      <span className="cs-switch" aria-hidden="true" />
      {label}
    </button>
  );
}

export function Segment<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: Array<{ value: T; label: string; icon?: ReactNode }>; onChange: (value: T) => void }) {
  return (
    <div className="cs-segment" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button key={option.value} type="button" role="radio" aria-checked={option.value === value} onClick={() => onChange(option.value)}>
          {option.icon}
          {option.label}
        </button>
      ))}
    </div>
  );
}

// Searchable model list with provider filters, like the Open Generative AI picker.
export function ModelPicker({ models, value, onChange, loading, pricing }: { models: AnyModel[]; value: string; onChange: (id: string) => void; loading: boolean; pricing?: StudioPricing | null }) {
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
      <button type="button" className="cs-chip cs-chip-model" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(!open)} disabled={!models.length}>
        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
        <span className="cs-truncate">{current?.name || (loading ? "Loading models" : "No models available")}</span>
        <ChevronDown className="h-3 w-3" />
      </button>
      {open ? (
        <div className="cs-menu cs-model-menu" role="dialog" aria-label="Choose a model">
          <label className="cs-search">
            <Search className="h-3.5 w-3.5" />
            <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${models.length} models`} />
          </label>
          {providers.length > 1 ? (
            <div className="cs-providers">
              <button type="button" aria-pressed={!providerFilter} onClick={() => setProviderFilter("")}>All</button>
              {providers.map((p) => (
                <button key={p} type="button" aria-pressed={providerFilter === p} onClick={() => setProviderFilter(providerFilter === p ? "" : p)}>{p}</button>
              ))}
            </div>
          ) : null}
          <div className="cs-model-list" role="listbox" aria-label="Models">
            {shown.length ? shown.map((m) => (
              <button key={m.id} type="button" role="option" aria-selected={m.id === value} className="cs-model" onClick={() => { onChange(m.id); setOpen(false); }}>
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
  const facts = [m.provider];
  if ("maxReferences" in m) facts.push(m.maxReferences ? `up to ${m.maxReferences} references` : "text only");
  if ("durations" in m) {
    if (m.durations.length) facts.push(`${m.durations[0]}–${m.durations[m.durations.length - 1]}s`);
    if (m.frames.includes("first_frame") && m.frames.includes("last_frame")) facts.push("start + end frame");
    else if (m.frames.includes("first_frame")) facts.push("start frame");
    if (m.audio) facts.push("sound");
    const creditsPerSecond = providerCreditEstimate(m.pricePerSecond, pricing);
    if (creditsPerSecond !== null) facts.push(`${creditEstimateLabel(creditsPerSecond)}/s`);
  }
  return facts.join(" · ");
}

function useUpload(onError: (message: string) => void) {
  const [busy, setBusy] = useState(false);
  const upload = useCallback(async (file: File) => {
    setBusy(true);
    try {
      return await uploadAsset(file, file.name);
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

/** Opens under a reference tray (or above it in a prompt bar) for pasting a link instead of uploading. */
function ReferenceLinkBox({ onAdd, onClose, onError }: { onAdd: (asset: Asset) => void; onClose: () => void; onError: (message: string) => void }) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const ready = LINK_PATTERN.test(url.trim()) && !busy;
  useEffect(() => {
    const away = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (!busy && box.current && !box.current.contains(target) && !target?.closest?.(".cs-ref-link")) onClose();
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [busy, onClose]);
  async function add() {
    if (!ready) return;
    setBusy(true);
    try {
      onAdd(await importLinkAsset(url));
      onClose();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not import that link");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div ref={box} className="cs-ref-linkbox" role="dialog" aria-label="Add a reference from a link">
      <input
        className="cs-input"
        type="url"
        inputMode="url"
        autoFocus
        value={url}
        disabled={busy}
        aria-label="Image, YouTube, or video link"
        placeholder="Image, YouTube, or video link"
        onChange={(event) => setUrl(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void add();
          }
          if (event.key === "Escape" && !busy) onClose();
        }}
      />
      <button type="button" className="cs-ghost" disabled={!ready} onClick={() => void add()}>
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
        {busy ? "Fetching" : "Add"}
      </button>
    </div>
  );
}

export function ReferenceTray({ assets, max, onChange, onError }: { assets: Asset[]; max: number; onChange: (assets: Asset[]) => void; onError: (message: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const { busy, upload } = useUpload(onError);
  const [linking, setLinking] = useState(false);
  const closeLink = useCallback(() => setLinking(false), []);
  return (
    <div className="cs-refs">
      <input ref={input} type="file" accept={IMAGE_TYPES} multiple hidden onChange={async (event) => {
        const files = Array.from(event.target.files || []).slice(0, max - assets.length);
        event.target.value = "";
        const added: Asset[] = [];
        for (const file of files) {
          const uploaded = await upload(file);
          if (uploaded) added.push(uploaded);
        }
        if (added.length) onChange([...assets, ...added].slice(0, max));
      }} />
      {assets.map((asset) => (
        <div key={asset.file} className="cs-ref">
          <img src={asset.url} alt="Reference" />
          <button type="button" className="cs-slot-clear" onClick={() => onChange(assets.filter((a) => a.file !== asset.file))} aria-label="Remove reference"><X className="h-3 w-3" /></button>
        </div>
      ))}
      {assets.length < max ? (
        <>
          <button type="button" className="cs-ref-add" onClick={() => input.current?.click()} disabled={busy} aria-label={`Upload reference images (up to ${max})`} title={`Upload reference images, up to ${max}`}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          </button>
          <button type="button" className="cs-ref-add cs-ref-link" onClick={() => setLinking((open) => !open)} aria-expanded={linking} aria-label="Add a reference from a link" title="Paste an image, YouTube, or video link">
            <Link2 className="h-4 w-4" />
          </button>
        </>
      ) : null}
      {linking && assets.length < max ? <ReferenceLinkBox onAdd={(asset) => onChange([...assets, asset].slice(0, max))} onClose={closeLink} onError={onError} /> : null}
    </div>
  );
}

export function Empty({ icon, heading, body, children }: { icon: ReactNode; heading: string; body: string; children?: ReactNode }) {
  return (
    <div className="cs-empty">
      <span className="cs-empty-mark">{icon}</span>
      <h2>{heading}</h2>
      <p>{body}</p>
      {children}
    </div>
  );
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
        <a className="cs-icon" href={`${src}${src.includes("?") ? "&" : "?"}download=1`} aria-label="Download" title="Download">
          <Download className="h-4 w-4" />
        </a>
        <button ref={close} type="button" className="cs-icon" onClick={onClose} aria-label="Close preview" title="Close"><X className="h-4 w-4" /></button>
      </div>
    </div>
  );
}

// Tab bar used inside apps to split long option sets into groups.
export function Tabs<T extends string>({ label, value, options, onChange, compact }: { label: string; value: T; options: Array<{ value: T; label: string; hint?: string; icon?: ReactNode }>; onChange: (value: T) => void; compact?: boolean }) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const move = (index: number) => {
    const next = (index + options.length) % options.length;
    onChange(options[next].value);
    refs.current[next]?.focus();
  };
  return (
    <div className={compact ? "cs-tabs cs-tabs-compact" : "cs-tabs"} role="tablist" aria-label={label}>
      {options.map((option, index) => (
        <button
          key={option.value}
          ref={(node) => {
            refs.current[index] = node;
          }}
          type="button"
          role="tab"
          aria-selected={option.value === value}
          tabIndex={option.value === value ? 0 : -1}
          className="cs-tab"
          onClick={() => onChange(option.value)}
          onKeyDown={(event) => {
            if (event.key === "ArrowRight") move(index + 1);
            if (event.key === "ArrowLeft") move(index - 1);
          }}
        >
          {option.icon}
          <span>{option.label}</span>
          {option.hint ? <span className="cs-tab-hint">{option.hint}</span> : null}
        </button>
      ))}
    </div>
  );
}
