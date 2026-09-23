// Marketing Studio, rebuilt after Higgsfield's: one floating control bar with
// product, presenter, format, hook, and setting; modal pickers with previews;
// and a technical popover. Generation runs through /api/studio (runAd).
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AppWindow,
  Check,
  ChevronDown,
  Clock,
  Film,
  Link2,
  Loader2,
  Package,
  Pencil,
  Pin,
  Plus,
  RectangleHorizontal,
  Search,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Upload,
  User,
  Users,
  X,
  Zap,
} from "lucide-react";
import { AD_ASPECTS, AD_FORMATS, AD_HOOKS, AD_QUALITIES, AD_SETTINGS, findFormat, findHook, findSetting, presetImage } from "../../utils/marketingPresets";
import { type Asset, type Generation, readJson, uploadAsset, usePopover } from "./studioShared";
import { type GalleryHandlers, StudioGallery } from "./StudioGallery";
import { useErrorToast } from "../../utils/toast";
import "./MarketingStudio.css";

type Product = { id: string; kind: "product" | "app"; name: string; description: string; images: Asset[] };
type Avatar = { id: string; name: string; gender: "male" | "female"; image: string; builtIn: boolean; pinned: boolean };
type VideoModel = { id: string; name: string; durations: number[]; resolutions: string[]; aspectRatios: string[]; pricePerSecond: number | null };
type Draft = { mode: "product" | "app"; productId: string; avatarId: string; format: string; hook: string; hookPrompt: string; setting: string; aspect: string; quality: string; duration: number; model: string; brief: string };
const DRAFT_KEY = "autoyt-marketing-draft";
const initialDraft = (): Draft => {
  const base: Draft = { mode: "product", productId: "", avatarId: "", format: "ugc", hook: "", hookPrompt: "", setting: "", aspect: "9:16", quality: "720p", duration: 10, model: "", brief: "" };
  try {
    return { ...base, ...JSON.parse(window.localStorage.getItem(DRAFT_KEY) || "{}") };
  } catch {
    return base;
  }
};

export function MarketingStudio({ generations, now, handlers, onCreated, configured }: { generations: Generation[]; now: number; handlers: GalleryHandlers; onCreated: (item: Generation) => void; configured: boolean }) {
  const [draft, setDraft] = useState<Draft>(initialDraft);
  const [products, setProducts] = useState<Product[]>([]);
  const [avatars, setAvatars] = useState<Avatar[]>([]);
  const [models, setModels] = useState<VideoModel[]>([]);
  const [modal, setModal] = useState<"" | "product" | "avatar" | "format" | "hook" | "setting">("");
  const [editingHook, setEditingHook] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useErrorToast(error, () => setError(""));
  const patch = (changes: Partial<Draft>) => setDraft((current) => ({ ...current, ...changes }));

  useEffect(() => {
    try {
      window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {}
  }, [draft]);
  const load = useCallback(async () => {
    try {
      const data = await readJson(await fetch("/api/studio/marketing"), "Marketing Studio is unavailable");
      setProducts(data.products || []);
      setAvatars(data.avatars || []);
      setModels(data.videoModels || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Marketing Studio is unavailable");
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const format = findFormat(draft.format);
  const hook = findHook(draft.hook);
  const setting = findSetting(draft.setting);
  const product = products.find((item) => item.id === draft.productId);
  const avatar = avatars.find((item) => item.id === draft.avatarId);
  // Auto lets the server pick (Veo, then Wan, then Seedance) and fall back on refusals.
  const chosen = models.find((item) => item.id === draft.model);
  const model = chosen || ["google/veo-3.1-fast", "alibaba/wan-3.0", "bytedance/seedance-2.0"].map((id) => models.find((m) => m.id === id)).find(Boolean) || models[0];
  const durations = model?.durations?.length ? model.durations : [5, 10, 15];
  const duration = durations.filter((d) => d <= draft.duration).at(-1) ?? durations[0];
  const cost = model?.pricePerSecond ? model.pricePerSecond * duration + 0.08 : null;
  const ads = useMemo(() => generations.filter((item) => item.tab === "marketing"), [generations]);
  const ready = configured && !busy && (draft.mode === "app" ? Boolean(draft.brief.trim()) : Boolean(product)) && (!format.person || Boolean(avatar) || draft.mode === "app");

  async function generate() {
    setBusy(true);
    setError("");
    try {
      const data = await readJson(
        await fetch("/api/studio/generations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tab: "marketing",
            model: chosen?.id || "",
            prompt: draft.brief,
            settings: { mode: draft.mode, productId: product?.id, avatarId: format.person ? avatar?.id : undefined, format: format.id, hook: hook?.id, hookPrompt: draft.hookPrompt, setting: setting?.id, aspectRatio: draft.aspect, quality: draft.quality, duration },
          }),
        }),
        "Couldn't start the ad",
      );
      onCreated(data.generation);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't start the ad");
    } finally {
      setBusy(false);
    }
  }

  const missing = draft.mode === "product" && !product ? "Add your product" : format.person && !avatar && draft.mode === "product" ? `${format.name} needs a presenter` : "";
  return (
    <div className="mks">
      <section className="mks-hero">
        <h1>
          Turn any product
          <br />
          into a video ad
        </h1>

        <div className="mks-dock">
          <div className="mks-modes" role="tablist" aria-label="What you're advertising">
            {([
              ["product", "Product", <Package key="p" className="h-4 w-4" />],
              ["app", "App", <AppWindow key="a" className="h-4 w-4" />],
            ] as const).map(([value, label, icon]) => (
              <button key={value} type="button" role="tab" aria-selected={draft.mode === value} onClick={() => patch({ mode: value })}>
                {icon}
                <span>{label}</span>
              </button>
            ))}
          </div>

          <div className="mks-bar">
            {hook && draft.mode === "product" ? (
              <div className="mks-hookline">
                <span className="mks-hooktag">Hook prompt</span>
                {editingHook ? (
                  <input autoFocus value={draft.hookPrompt || hook.text} onChange={(event) => patch({ hookPrompt: event.target.value })} onBlur={() => setEditingHook(false)} onKeyDown={(event) => event.key === "Enter" && setEditingHook(false)} aria-label="Hook prompt" maxLength={600} />
                ) : (
                  <p>{draft.hookPrompt || hook.text}</p>
                )}
                <button type="button" onClick={() => setEditingHook(!editingHook)}>{editingHook ? "Done" : "Edit"}</button>
              </div>
            ) : null}
            <div className="mks-bar-body">
              <div className="mks-bar-main">
                {draft.mode === "app" ? (
                  <textarea className="mks-brief" rows={2} value={draft.brief} onChange={(event) => patch({ brief: event.target.value })} placeholder="Describe what happens in the ad…" aria-label="Ad brief" maxLength={1500} />
                ) : null}
                <div className="mks-row">
                  <button type="button" className="mks-plus" aria-label="Add product" onClick={() => setModal("product")}><Plus className="h-4 w-4" /></button>
                  {product ? (
                    <span className="mks-tag">
                      {product.images[0] ? <img src={product.images[0].url} alt="" /> : <Package className="h-3.5 w-3.5" />}
                      <span>{product.name}</span>
                      <button type="button" aria-label="Remove product" onClick={() => patch({ productId: "" })}><X className="h-3 w-3" /></button>
                    </span>
                  ) : null}
                  {avatar && format.person ? (
                    <span className="mks-tag">
                      <img src={avatar.image} alt="" />
                      <span>{avatar.name}</span>
                      <button type="button" aria-label="Remove presenter" onClick={() => patch({ avatarId: "" })}><X className="h-3 w-3" /></button>
                    </span>
                  ) : null}
                </div>
                <div className="mks-row">
                  <Chip icon={<Film className="h-3.5 w-3.5" />} label={format.name} onClick={() => setModal("format")} />
                  {draft.mode === "product" ? (
                    <>
                      <Chip tone="hook" icon={<Zap className="h-3.5 w-3.5" />} label={hook?.name || "Hook"} active={Boolean(hook)} onClick={() => setModal("hook")} onClear={hook ? () => patch({ hook: "", hookPrompt: "" }) : undefined} />
                      <Chip tone="setting" icon={<Sparkles className="h-3.5 w-3.5" />} label={setting?.name || "Setting"} active={Boolean(setting)} onClick={() => setModal("setting")} onClear={setting ? () => patch({ setting: "" }) : undefined} />
                    </>
                  ) : null}
                  <TechPopover draft={draft} patch={patch} models={models} model={model} auto={!chosen} durations={durations} duration={duration} />
                </div>
              </div>
              <div className="mks-cluster">
                <button type="button" className="mks-slot" onClick={() => setModal("product")} aria-label={product ? `Product: ${product.name}` : "Add product"}>
                  {product?.images[0] ? <img src={product.images[0].url} alt="" /> : <Package className="h-5 w-5" />}
                  <span>Product</span>
                </button>
                {format.person ? (
                  <button type="button" className="mks-slot" onClick={() => setModal("avatar")} aria-label={avatar ? `Presenter: ${avatar.name}` : "Choose presenter"}>
                    {avatar ? <img src={avatar.image} alt="" /> : <User className="h-5 w-5" />}
                    <span>Avatar</span>
                  </button>
                ) : null}
                <button type="button" className="mks-generate" disabled={!ready} onClick={() => void generate()} title={missing || undefined}>
                  {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <span>Generate</span>}
                  {cost ? <small><Zap className="h-3 w-3" />≈ ${cost.toFixed(2)}</small> : null}
                </button>
              </div>
            </div>
          </div>
        </div>
        {missing && !busy ? <p className="mks-hint">{missing}</p> : null}
        {!configured ? <p className="mks-error">Generation isn't set up on this server yet.</p> : null}
      </section>

      <section className="mks-results" aria-label={ads.length ? "Your ads" : "Formats"}>
        {ads.length ? (
          <>
            <h2><Sparkles className="h-4 w-4" />Your ads</h2>
            <StudioGallery items={ads} now={now} handlers={handlers} />
          </>
        ) : (
          <>
            <h2><Sparkles className="h-4 w-4" />Generate across formats</h2>
            <div className="mks-strip">
              {AD_FORMATS.map((item) => (
                <button key={item.id} type="button" className="mks-strip-card" aria-pressed={draft.format === item.id} onClick={() => patch({ format: item.id })}>
                  <img src={presetImage("format", item.id)} alt="" loading="lazy" />
                  <span>{item.name}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </section>

      {modal === "product" ? (
        <ProductModal
          mode={draft.mode}
          products={products}
          selected={draft.productId}
          onMode={(mode) => patch({ mode })}
          onClose={() => setModal("")}
          onPick={(id) => {
            patch({ productId: id });
            setModal(format.person && !avatar && draft.mode === "product" ? "avatar" : "");
          }}
          onChange={load}
        />
      ) : null}
      {modal === "avatar" ? <AvatarModal avatars={avatars} selected={draft.avatarId} onClose={() => setModal("")} onPick={(id) => { patch({ avatarId: id }); setModal(""); }} onChange={load} /> : null}
      {modal === "format" ? (
        <PickerModal
          title="Pick the format that hits"
          tabs={[["all", "All"], ["ugc", "UGC"], ["commercial", "Commercial"]]}
          items={AD_FORMATS.map((item) => ({ id: item.id, name: item.name, text: item.blurb, group: item.group, image: presetImage("format", item.id) }))}
          selected={draft.format}
          onClose={() => setModal("")}
          onPick={(id) => { patch({ format: id }); setModal(""); }}
        />
      ) : null}
      {modal === "hook" ? (
        <PickerModal
          title="Hooks that stop the scroll"
          tabs={[["all", "All"], ["stunt", "Stunt"], ["subtle", "Subtle"]]}
          search
          items={AD_HOOKS.map((item) => ({ id: item.id, name: item.name, text: item.text, group: item.group, image: presetImage("hook", item.id) }))}
          selected={draft.hook}
          onClose={() => setModal("")}
          onPick={(id) => { patch({ hook: id, hookPrompt: "" }); setModal(""); }}
        />
      ) : null}
      {modal === "setting" ? (
        <PickerModal
          title="Settings that set the scene"
          tabs={[["all", "All"], ["realistic", "Realistic"], ["unrealistic", "Unrealistic"]]}
          search
          items={AD_SETTINGS.map((item) => ({ id: item.id, name: item.name, text: item.text, group: item.group, image: presetImage("setting", item.id) }))}
          selected={draft.setting}
          onClose={() => setModal("")}
          onPick={(id) => { patch({ setting: id }); setModal(""); }}
        />
      ) : null}
    </div>
  );
}

function Chip({ icon, label, onClick, onClear, active, tone }: { icon: ReactNode; label: string; onClick: () => void; onClear?: () => void; active?: boolean; tone?: "hook" | "setting" }) {
  return (
    <span className={`mks-chip${active ? ` is-${tone}` : ""}`}>
      <button type="button" onClick={onClick}>
        {icon}
        <span>{label}</span>
        {!onClear ? <ChevronDown className="h-3 w-3" /> : null}
      </button>
      {onClear ? <button type="button" className="mks-chip-x" aria-label={`Clear ${label}`} onClick={onClear}><X className="h-3 w-3" /></button> : null}
    </span>
  );
}

function TechPopover({ draft, patch, models, model, auto, durations, duration }: { draft: Draft; patch: (changes: Partial<Draft>) => void; models: VideoModel[]; model?: VideoModel; auto: boolean; durations: number[]; duration: number }) {
  const { open, setOpen, ref } = usePopover();
  const [flyout, setFlyout] = useState<"" | "aspect" | "quality" | "model">("");
  const qualities = AD_QUALITIES.filter((q) => !model?.resolutions?.length || model.resolutions.includes(q));
  const aspects = AD_ASPECTS.filter((a) => a === "auto" || !model?.aspectRatios?.length || model.aspectRatios.includes(a));
  const min = durations[0], max = durations[durations.length - 1];
  return (
    <div className="mks-pop" ref={ref}>
      <button type="button" className="mks-chip-icon" aria-label="Aspect ratio, quality, duration, and model" aria-expanded={open} onClick={() => setOpen(!open)}>
        <SlidersHorizontal className="h-4 w-4" />
      </button>
      {open ? (
        <div className="mks-tech" role="dialog" aria-label="Technical settings">
          <button type="button" className="mks-tech-row" onClick={() => setFlyout(flyout === "aspect" ? "" : "aspect")}>
            <RectangleHorizontal className="h-4 w-4" /><span>Aspect ratio</span><strong>{draft.aspect === "auto" ? "Auto" : draft.aspect}</strong>
          </button>
          <button type="button" className="mks-tech-row" onClick={() => setFlyout(flyout === "quality" ? "" : "quality")}>
            <Sparkles className="h-4 w-4" /><span>Quality</span><strong>{draft.quality}</strong>
          </button>
          <label className="mks-tech-row is-slider">
            <Clock className="h-4 w-4" /><span>Duration</span><strong>{duration}s</strong>
            <input type="range" min={min} max={max} step={1} value={duration} onChange={(event) => patch({ duration: Number(event.target.value) })} aria-label="Duration in seconds" style={{ ["--fill" as string]: `${((duration - min) / Math.max(1, max - min)) * 100}%` }} />
          </label>
          <button type="button" className="mks-tech-row" onClick={() => setFlyout(flyout === "model" ? "" : "model")}>
            <Film className="h-4 w-4" /><span>Model</span><strong>{auto ? "Auto" : model?.name}</strong>
          </button>
          {flyout ? (
            <div className="mks-flyout">
              <p>{flyout === "aspect" ? "Aspect ratio" : flyout === "quality" ? "Quality" : "Video model"}</p>
              <div className={flyout === "aspect" ? "mks-flyout-grid" : "mks-flyout-list"}>
                {(flyout === "aspect" ? aspects : flyout === "quality" ? qualities : ["", ...models.map((m) => m.id)]).map((value) => {
                  const label = flyout === "model" ? (value ? models.find((m) => m.id === value)?.name || value : "Auto (recommended)") : value === "auto" ? "Auto" : value;
                  const current = flyout === "aspect" ? draft.aspect : flyout === "quality" ? draft.quality : auto ? "" : model?.id;
                  return (
                    <button key={value} type="button" aria-pressed={current === value} onClick={() => { patch(flyout === "aspect" ? { aspect: value } : flyout === "quality" ? { quality: value } : { model: value }); setFlyout(""); }}>
                      {label}
                      {current === value ? <Check className="h-3.5 w-3.5" /> : null}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Modal({ label, onClose, children, wide }: { label: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    close.current?.focus();
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);
  return (
    <div className="mks-modal" onClick={onClose}>
      <div className={wide ? "mks-sheet is-wide" : "mks-sheet"} role="dialog" aria-modal="true" aria-label={label} onClick={(event) => event.stopPropagation()}>
        <button ref={close} type="button" className="mks-close" aria-label="Close" onClick={onClose}><X className="h-4 w-4" /></button>
        {children}
      </div>
    </div>
  );
}

function PickerModal({ title, tabs, items, selected, onPick, onClose, search }: { title: string; tabs: Array<[string, string]>; items: Array<{ id: string; name: string; text: string; group: string; image: string }>; selected: string; onPick: (id: string) => void; onClose: () => void; search?: boolean }) {
  const [tab, setTab] = useState("all");
  const [query, setQuery] = useState("");
  const shown = items.filter((item) => (tab === "all" || item.group === tab) && (!query || `${item.name} ${item.text}`.toLowerCase().includes(query.toLowerCase())));
  return (
    <Modal label={title} onClose={onClose} wide>
      <p className="mks-tagline">{title}</p>
      <div className="mks-sheet-bar">
        <div className="mks-tabs" role="tablist" aria-label="Categories">
          {tabs.map(([value, label]) => (
            <button key={value} type="button" role="tab" aria-selected={tab === value} onClick={() => setTab(value)}>{label}</button>
          ))}
        </div>
        {search ? (
          <label className="mks-search"><Search className="h-4 w-4" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search" /></label>
        ) : null}
      </div>
      <div className="mks-cards">
        {shown.map((item) => (
          <button key={item.id} type="button" className="mks-card" aria-pressed={selected === item.id} onClick={() => onPick(item.id)}>
            <span className="mks-card-media"><img src={item.image} alt="" loading="lazy" /></span>
            <strong>{item.name}</strong>
            <span>{item.text}</span>
          </button>
        ))}
        {!shown.length ? <p className="mks-empty">Nothing matches “{query}”.</p> : null}
      </div>
    </Modal>
  );
}

function ProductModal({ mode, products, selected, onMode, onPick, onClose, onChange }: { mode: "product" | "app"; products: Product[]; selected: string; onMode: (mode: "product" | "app") => void; onPick: (id: string) => void; onClose: () => void; onChange: () => Promise<void> }) {
  const [url, setUrl] = useState("");
  const [manual, setManual] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [images, setImages] = useState<Asset[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  useErrorToast(error, () => setError(""));
  const file = useRef<HTMLInputElement>(null);
  const shown = products.filter((item) => item.kind === mode);

  async function importUrl() {
    setBusy("import");
    setError("");
    try {
      const data = await readJson(await fetch("/api/studio/marketing/products/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url, kind: mode }) }), "Couldn't import that link");
      await onChange();
      onPick(data.product.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't import that link");
    } finally {
      setBusy("");
    }
  }
  async function save() {
    setBusy("save");
    setError("");
    try {
      const data = await readJson(await fetch("/api/studio/marketing/products", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, description, kind: mode, images: images.map((img) => img.file) }) }), "Couldn't save the product");
      await onChange();
      onPick(data.product.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save the product");
    } finally {
      setBusy("");
    }
  }
  async function remove(id: string) {
    await fetch(`/api/studio/marketing/products/${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => undefined);
    await onChange();
  }
  return (
    <Modal label="Add your product" onClose={onClose} wide>
      <div className="mks-tabs is-center" role="tablist" aria-label="Product type">
        <button type="button" role="tab" aria-selected={mode === "product"} onClick={() => onMode("product")}><Package className="h-3.5 w-3.5" />Product</button>
        <button type="button" role="tab" aria-selected={mode === "app"} onClick={() => onMode("app")}><AppWindow className="h-3.5 w-3.5" />App</button>
      </div>
      <div className="mks-add">
        <div>
          <h2>Add your {mode === "app" ? "app" : "product"}</h2>
          <p>Add a link or upload images to use your {mode === "app" ? "app" : "product"} across generations.</p>
        </div>
        {!manual ? (
          <div className="mks-add-row">
            <label className="mks-url">
              <Link2 className="h-4 w-4" />
              <input value={url} onChange={(event) => setUrl(event.target.value)} onKeyDown={(event) => event.key === "Enter" && url.trim() && void importUrl()} placeholder={mode === "app" ? "www.yourapp.com" : "www.yourproduct.com"} aria-label="Product link" />
              <button type="button" aria-label="Import" disabled={!url.trim() || Boolean(busy)} onClick={() => void importUrl()}>{busy === "import" ? <Loader2 className="h-4 w-4 animate-spin" /> : "→"}</button>
            </label>
            <span className="mks-or">or</span>
            <button type="button" className="mks-white" onClick={() => setManual(true)}>Create manually</button>
          </div>
        ) : (
          <div className="mks-manual">
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder={mode === "app" ? "App name" : "Product name"} aria-label="Name" maxLength={80} />
            <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={2} placeholder="What it is and why people love it (optional)" aria-label="Description" maxLength={600} />
            <div className="mks-uploads">
              {images.map((img) => (
                <span key={img.file} className="mks-upload"><img src={img.url} alt="" /><button type="button" aria-label="Remove image" onClick={() => setImages(images.filter((i) => i.file !== img.file))}><X className="h-3 w-3" /></button></span>
              ))}
              {images.length < 5 ? (
                <button type="button" className="mks-upload is-add" onClick={() => file.current?.click()} disabled={busy === "upload"}>
                  {busy === "upload" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                  <span>{images.length ? "Add" : "Upload up to 5"}</span>
                </button>
              ) : null}
              <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={async (event) => {
                const files = Array.from(event.target.files || []).slice(0, 5 - images.length);
                event.target.value = "";
                setBusy("upload");
                try {
                  const added: Asset[] = [];
                  for (const f of files) added.push(await uploadAsset(f, f.name));
                  setImages((current) => [...current, ...added].slice(0, 5));
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Upload failed");
                } finally {
                  setBusy("");
                }
              }} />
            </div>
            <div className="mks-manual-actions">
              <button type="button" className="mks-ghost" onClick={() => setManual(false)}>Back</button>
              <button type="button" className="mks-pink" disabled={!name.trim() || !images.length || Boolean(busy)} onClick={() => void save()}>{busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}</button>
            </div>
          </div>
        )}
      </div>
      {shown.length ? (
        <div className="mks-products">
          {shown.map((item) => (
            <div key={item.id} className="mks-product" data-selected={selected === item.id || undefined}>
              <button type="button" onClick={() => onPick(item.id)} aria-label={`Use ${item.name}`}>
                <span className="mks-product-media">{item.images[0] ? <img src={item.images[0].url} alt="" /> : <Package className="h-6 w-6" />}</span>
                <span className="mks-product-name">{item.name}</span>
              </button>
              <button type="button" className="mks-product-del" aria-label={`Delete ${item.name}`} onClick={() => void remove(item.id)}><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
          ))}
        </div>
      ) : null}
    </Modal>
  );
}

function AvatarModal({ avatars, selected, onPick, onClose, onChange }: { avatars: Avatar[]; selected: string; onPick: (id: string) => void; onClose: () => void; onChange: () => Promise<void> }) {
  const [filter, setFilter] = useState<"all" | "pinned" | "mine">("all");
  const [gender, setGender] = useState<"" | "male" | "female">("");
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const shown = avatars.filter((item) => (filter === "all" || (filter === "pinned" ? item.pinned : !item.builtIn)) && (!gender || item.gender === gender) && (!query || item.name.toLowerCase().includes(query.toLowerCase())));
  async function pin(id: string) {
    await fetch(`/api/studio/marketing/avatars/${encodeURIComponent(id)}/pin`, { method: "POST" }).catch(() => undefined);
    await onChange();
  }
  async function remove(id: string) {
    await fetch(`/api/studio/marketing/avatars/${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => undefined);
    await onChange();
  }
  return (
    <Modal label="Select avatar" onClose={onClose} wide>
      <div className="mks-avatars">
        <aside>
          <h2>Select avatar</h2>
          {([
            ["all", "All", <Users key="a" className="h-4 w-4" />],
            ["pinned", "Pinned", <Pin key="p" className="h-4 w-4" />],
            ["mine", "My avatars", <Sparkles key="m" className="h-4 w-4" />],
          ] as const).map(([value, label, icon]) => (
            <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>{icon}{label}</button>
          ))}
          <p>Gender</p>
          {(["male", "female"] as const).map((value) => (
            <button key={value} type="button" aria-pressed={gender === value} onClick={() => setGender(gender === value ? "" : value)}>{value === "male" ? "Male" : "Female"}</button>
          ))}
        </aside>
        <div className="mks-avatars-main">
          <label className="mks-search is-wide"><Search className="h-4 w-4" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search..." /></label>
          <div className="mks-faces">
            {filter !== "pinned" ? (
              <button type="button" className="mks-face is-create" onClick={() => setCreating(true)}>
                <Plus className="h-6 w-6" />
                <span>Create avatar</span>
              </button>
            ) : null}
            {shown.map((item) => (
              <div key={item.id} className="mks-face" data-selected={selected === item.id || undefined}>
                <img src={item.image} alt="" loading="lazy" />
                <span className="mks-face-name">{item.name}</span>
                <button type="button" className="mks-face-select" onClick={() => onPick(item.id)}>Select avatar</button>
                <button type="button" className="mks-face-pin" aria-pressed={item.pinned} aria-label={item.pinned ? `Unpin ${item.name}` : `Pin ${item.name}`} onClick={() => void pin(item.id)}><Pin className="h-3.5 w-3.5" /></button>
                {!item.builtIn ? <button type="button" className="mks-face-del" aria-label={`Delete ${item.name}`} onClick={() => void remove(item.id)}><Trash2 className="h-3.5 w-3.5" /></button> : null}
              </div>
            ))}
          </div>
        </div>
      </div>
      {creating ? <CreateAvatar onClose={() => setCreating(false)} onCreated={async (id) => { await onChange(); setCreating(false); onPick(id); }} /> : null}
    </Modal>
  );
}

function CreateAvatar({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => Promise<void> }) {
  const [name, setName] = useState("");
  const [gender, setGender] = useState<"female" | "male">("female");
  const [description, setDescription] = useState("");
  const [photo, setPhoto] = useState<Asset | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useErrorToast(error, () => setError(""));
  const file = useRef<HTMLInputElement>(null);
  async function create() {
    setBusy(true);
    setError("");
    try {
      const data = await readJson(await fetch("/api/studio/marketing/avatars", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, gender, description, image: photo?.file }) }), "Couldn't create the avatar");
      await onCreated(data.avatar.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create the avatar");
      setBusy(false);
    }
  }
  return (
    <div className="mks-create" role="dialog" aria-label="Create avatar">
      <h3>Create avatar</h3>
      <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Name" aria-label="Avatar name" maxLength={40} />
      <div className="mks-tabs">
        {(["female", "male"] as const).map((value) => (
          <button key={value} type="button" role="tab" aria-selected={gender === value} onClick={() => setGender(value)}>{value === "female" ? "Female" : "Male"}</button>
        ))}
      </div>
      <div className="mks-create-body">
        <button type="button" className="mks-upload is-add is-tall" onClick={() => file.current?.click()}>
          {photo ? <img src={photo.url} alt="" /> : <><Upload className="h-4 w-4" /><span>Upload a photo you have rights to</span></>}
        </button>
        <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={async (event) => {
          const f = event.target.files?.[0];
          event.target.value = "";
          if (!f) return;
          try {
            setPhoto(await uploadAsset(f, f.name));
          } catch (err) {
            setError(err instanceof Error ? err.message : "Upload failed");
          }
        }} />
        <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={4} placeholder="…or describe them: 28-year-old runner with a buzz cut and a warm smile" aria-label="Describe the presenter" disabled={Boolean(photo)} maxLength={400} />
      </div>
      <div className="mks-manual-actions">
        <button type="button" className="mks-ghost" onClick={onClose}>Cancel</button>
        <button type="button" className="mks-pink" disabled={busy || (!photo && !description.trim())} onClick={() => void create()}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : photo ? "Create" : <><Pencil className="h-3.5 w-3.5" />Generate avatar</>}
        </button>
      </div>
    </div>
  );
}
