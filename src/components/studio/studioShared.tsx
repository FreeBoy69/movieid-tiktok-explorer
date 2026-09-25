// Shared data, API helpers, and controls for Creator Studio apps.
import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AudioLines, Check, ChevronDown, Download, Film, Loader2, Plus, Search, Sparkles, Upload, X } from "lucide-react";
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
};
export type Asset = { file: string; url: string; type: string; name?: string };
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

export function IconButton({ label, onClick, children, disabled }: { label: string; onClick: () => void; children: ReactNode; disabled?: boolean }) {
  return (
    <button type="button" className="cs-icon" onClick={onClick} aria-label={label} title={label} disabled={disabled}>
      {children}
    </button>
  );
}

export function Choice({ label, value, options, onChange, empty }: { label: string; value: string; options: Array<{ value: string; label: string }>; onChange: (value: string) => void; empty?: string }) {
  const { open, setOpen, ref } = usePopover();
  const current = options.find((option) => option.value === value);
  return (
    <div className="cs-pop" ref={ref}>
      <button type="button" className="cs-chip" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(!open)} disabled={!options.length}>
        <span className="cs-chip-label">{label}</span>
        <span>{current?.label || empty || "None"}</span>
        <ChevronDown className="h-3 w-3" />
      </button>
      {open ? (
        <div className="cs-menu" role="listbox" aria-label={label}>
          {options.map((option) => (
            <button key={option.value} type="button" role="option" aria-selected={option.value === value} className="cs-menu-item" onClick={() => { onChange(option.value); setOpen(false); }}>
              <span>{option.label}</span>
              {option.value === value ? <Check className="h-3.5 w-3.5" /> : null}
            </button>
          ))}
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
    if (m.frames.includes("last_frame")) facts.push("first + last frame");
    else if (m.frames.includes("first_frame")) facts.push("image to video");
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

export function ReferenceTray({ assets, max, onChange, onError }: { assets: Asset[]; max: number; onChange: (assets: Asset[]) => void; onError: (message: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const { busy, upload } = useUpload(onError);
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
        <button type="button" className="cs-ref-add" onClick={() => input.current?.click()} disabled={busy} aria-label={`Add reference images (up to ${max})`} title={`Reference images, up to ${max}`}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
        </button>
      ) : null}
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
      <img src={src} alt="Full size preview" onClick={(event) => event.stopPropagation()} />
      <div className="cs-lightbox-bar" onClick={(event) => event.stopPropagation()}>
        <a className="cs-icon" href={`${src}?download=1`} aria-label="Download" title="Download">
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
