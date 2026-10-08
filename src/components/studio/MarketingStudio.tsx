// Marketing Studio, rebuilt after Higgsfield's: one floating control bar with
// product, presenter, format, hook, and setting; modal pickers with previews;
// and a technical popover. Generation runs through /api/studio (runAd).
import { LayoutCard, Masonry, StudioLayout } from "../StudioLayout";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import {
  AppWindow,
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
  SlidersHorizontal,
  Sparkles,
  Trash2,
  User,
  Users,
  X,
  Zap,
} from "lucide-react";
import { AD_ASPECTS, AD_FORMATS, AD_HOOKS, AD_QUALITIES, AD_SETTINGS, findFormat, findHook, findSetting, presetImage } from "../../utils/marketingPresets";
import { AspectPicker, type Asset, type Generation, GenerationUnavailable, IMAGE_TYPES, MediaSlot, ModelPicker, readJson, ReferenceTray, Segment, usePopover, type VideoModel as CatalogVideoModel } from "./studioShared";
import { confirm, Dialog } from "../ui/Dialog";
import { SearchField } from "../ui/controls";
import { type GalleryHandlers, StudioGallery } from "./StudioGallery";
import { clearPendingTemplate, peekPendingTemplate } from "../../utils/promptTemplates";
import { useErrorToast } from "../../utils/toast";
import { CREDIT_ESTIMATE_TITLE, creditEstimateLabel, fallbackCreditEstimate, providerCreditEstimate, useStudioPricing } from "./studioPricing";
import "./MarketingStudio.css";

type Product = { id: string; kind: "product" | "app"; name: string; description: string; images: Asset[] };
type Avatar = { id: string; name: string; gender: "male" | "female"; image: string; builtIn: boolean; pinned: boolean };
type VideoModel = { id: string; name: string; durations: number[]; resolutions: string[]; aspectRatios: string[]; pricePerSecond: number | null };
type Draft = { mode: "product" | "app"; productId: string; avatarId: string; format: string; hook: string; hookPrompt: string; setting: string; aspect: string; quality: string; duration: number; model: string; brief: string };
const DRAFT_KEY = "autoyt-marketing-draft";
const initialDraft = (): Draft => {
  const base: Draft = { mode: "product", productId: "", avatarId: "", format: "ugc", hook: "", hookPrompt: "", setting: "", aspect: "9:16", quality: "720p", duration: 10, model: "", brief: "" };
  let saved: Draft = base;
  try {
    saved = { ...base, ...JSON.parse(window.localStorage.getItem(DRAFT_KEY) || "{}") };
  } catch {}
  const pending = peekPendingTemplate("marketing");
  return pending?.templateId && AD_FORMATS.some((item) => item.id === pending.templateId) ? { ...saved, format: pending.templateId, brief: pending.prompt || saved.brief } : saved;
};

export function MarketingStudio({ generations, now, handlers, onCreated, configured }: { generations: Generation[]; now: number; handlers: GalleryHandlers; onCreated: (item: Generation) => void; configured: boolean }) {
  const [draft, setDraft] = useState<Draft>(initialDraft);
  const pricing = useStudioPricing();
  const [products, setProducts] = useState<Product[]>([]);
  const [avatars, setAvatars] = useState<Avatar[]>([]);
  const [models, setModels] = useState<VideoModel[]>([]);
  const [modal, setModal] = useState<"" | "product" | "avatar" | "format" | "hook" | "setting">("");
  const [section, setSection] = useState<"ads" | "formats">("ads");
  const [editingHook, setEditingHook] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useErrorToast(error, () => setError(""));
  const patch = (changes: Partial<Draft>) => setDraft((current) => ({ ...current, ...changes }));

  useEffect(() => clearPendingTemplate("marketing"), []);
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
  const estimatedCredits = providerCreditEstimate(cost, pricing) ?? fallbackCreditEstimate("video", pricing);
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
  const shownSection = section === "ads" && ads.length ? "ads" : "formats";
  return (
    <div className="mks">
      <StudioLayout
        title="Turn any product into a video ad"
        intro="Add your product or app, pick a format and a hook, and generate a ready-to-post ad."
        above={
          <Segment
            className="mks-modes"
            label="What you're advertising"
            value={draft.mode}
            onChange={(mode) => patch({ mode })}
            options={[
              { value: "product", label: "Product", icon: <Package className="h-4 w-4" /> },
              { value: "app", label: "App", icon: <AppWindow className="h-4 w-4" /> },
            ]}
          />
        }
        composer={
        <div className="mks-dock">
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
                  <SheetChip icon={<Film className="h-3.5 w-3.5" />} label={format.name} onClick={() => setModal("format")} />
                  {draft.mode === "product" ? (
                    <>
                      <SheetChip tone="hook" icon={<Zap className="h-3.5 w-3.5" />} label={hook?.name || "Hook"} active={Boolean(hook)} onClick={() => setModal("hook")} onClear={hook ? () => patch({ hook: "", hookPrompt: "" }) : undefined} />
                      <SheetChip tone="setting" icon={<Sparkles className="h-3.5 w-3.5" />} label={setting?.name || "Setting"} active={Boolean(setting)} onClick={() => setModal("setting")} onClear={setting ? () => patch({ setting: "" }) : undefined} />
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
                  {estimatedCredits !== null ? <small title={CREDIT_ESTIMATE_TITLE}><Zap className="h-3 w-3" />{creditEstimateLabel(estimatedCredits)}</small> : null}
                </button>
              </div>
            </div>
          </div>
        </div>
        }
        notices={missing && !busy || !configured ? <>{missing && !busy ? <p className="mks-hint">{missing}</p> : null}{!configured ? <GenerationUnavailable className="mks-notice" /> : null}</> : null}
        tabsLabel="Marketing sections"
        tabs={[...(ads.length ? [{ value: "ads", label: "Your ads", hint: String(ads.length) }] : []), { value: "formats", label: "Formats" }]}
        tab={shownSection}
        onTab={(next) => setSection(next as "ads" | "formats")}
      >
        {shownSection === "ads" ? (
          <StudioGallery items={ads} now={now} handlers={handlers} />
        ) : (
          <Masonry>
            {AD_FORMATS.map((item) => (
              <LayoutCard key={item.id} title={item.name} sub={item.blurb} image={presetImage("format", item.id)} ratio={9 / 16} selected={draft.format === item.id} onClick={() => patch({ format: item.id })} />
            ))}
          </Masonry>
        )}
      </StudioLayout>

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

/** A dock chip that opens one of the studio's picker sheets (Marketing and Promo). */
export function SheetChip({ icon, label, onClick, onClear, active, tone }: { icon: ReactNode; label: string; onClick: () => void; onClear?: () => void; active?: boolean; tone?: "hook" | "setting" }) {
  return (
    <span className={`mks-chip${active ? ` is-${tone}` : ""}`}>
      <button type="button" onClick={onClick} aria-haspopup="dialog">
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
  const qualities = AD_QUALITIES.filter((q) => !model?.resolutions?.length || model.resolutions.includes(q));
  const aspects = AD_ASPECTS.filter((a) => a === "auto" || !model?.aspectRatios?.length || model.aspectRatios.includes(a));
  const min = durations[0], max = durations[durations.length - 1];
  // The shared model list wants provider and frame facts the marketing endpoint leaves out.
  const pickerModels = useMemo<CatalogVideoModel[]>(() => models.map((m) => ({ ...m, provider: m.id.split("/")[0], description: "", frames: [], audio: false })), [models]);
  return (
    <div className="mks-pop" ref={ref}>
      <button type="button" className="mks-chip-icon" aria-label="Aspect ratio, quality, duration, and model" aria-expanded={open} onClick={() => setOpen(!open)}>
        <SlidersHorizontal className="h-4 w-4" />
      </button>
      {open ? (
        <div className="mks-tech mks-tech-settings" role="dialog" aria-label="Technical settings">
          <div className="mks-tech-group">
            <p><RectangleHorizontal className="h-4 w-4" />Aspect ratio</p>
            <AspectPicker value={draft.aspect} options={aspects} onChange={(aspect) => patch({ aspect })} />
          </div>
          {qualities.length > 1 ? (
            <div className="mks-tech-group">
              <p><Sparkles className="h-4 w-4" />Quality</p>
              <Segment className="cs-tile-seg" label="Quality" value={draft.quality} options={qualities.map((q) => ({ value: q, label: q }))} onChange={(quality) => patch({ quality })} />
            </div>
          ) : null}
          <label className="mks-tech-row is-slider">
            <Clock className="h-4 w-4" /><span>Duration</span><strong>{duration}s</strong>
            <input type="range" min={min} max={max} step={1} value={duration} onChange={(event) => patch({ duration: Number(event.target.value) })} aria-label="Duration in seconds" style={{ ["--fill" as string]: `${((duration - min) / Math.max(1, max - min)) * 100}%` }} />
          </label>
          <div className="mks-tech-group">
            <p><Film className="h-4 w-4" />Video model</p>
            <ModelPicker models={pickerModels} value={auto ? "" : model?.id || ""} onChange={(id) => patch({ model: id })} loading={!models.length} auto={{ label: "Auto (recommended)", description: "Veo first, then Wan, then Seedance if a model refuses." }} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** The studio's picker sheet: the shared Dialog (focus trap, Escape, scroll lock) in Marketing's skin. Promo and Explainer use it too. */
export function StudioSheet({ label, onClose, children, wide, scope = "", className = "" }: { label: string; onClose: () => void; children: ReactNode; wide?: boolean; scope?: string; className?: string }) {
  const theme = document.documentElement.dataset.theme === "light" ? "light" : "dark";
  return (
    <Dialog title={label} onClose={onClose} bare size="xl" className={`mks-dialog${wide ? " is-wide" : ""}`}>
      <div className={`cstudio mks-scope${scope ? ` ${scope}` : ""}`} data-theme={theme}>
        <div className={`mks-sheet${wide ? " is-wide" : ""}${className ? ` ${className}` : ""}`}>
          <button type="button" className="mks-close" aria-label="Close" onClick={onClose}><X className="h-4 w-4" /></button>
          {children}
        </div>
      </div>
    </Dialog>
  );
}

function PickerModal({ title, tabs, items, selected, onPick, onClose, search }: { title: string; tabs: Array<[string, string]>; items: Array<{ id: string; name: string; text: string; group: string; image: string }>; selected: string; onPick: (id: string) => void; onClose: () => void; search?: boolean }) {
  const [tab, setTab] = useState("all");
  const [query, setQuery] = useState("");
  const shown = items.filter((item) => (tab === "all" || item.group === tab) && (!query || `${item.name} ${item.text}`.toLowerCase().includes(query.toLowerCase())));
  return (
    <StudioSheet label={title} onClose={onClose} wide>
      <p className="mks-tagline">{title}</p>
      <div className="mks-sheet-bar">
        <Segment className="mks-tabs" label="Categories" value={tab} onChange={setTab} options={tabs.map(([value, label]) => ({ value, label }))} />
        {search ? <SearchField className="mks-search" size="sm" value={query} onChange={setQuery} placeholder={`Search ${title.toLowerCase().startsWith("hooks") ? "hooks" : "settings"}`} /> : null}
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
    </StudioSheet>
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
  async function remove(item: Product) {
    if (!(await confirm({ title: `Delete ${item.name}?`, body: "Ads you already made keep it; it won't be offered for new ones.", confirmLabel: "Delete", danger: true }))) return;
    await fetch(`/api/studio/marketing/products/${encodeURIComponent(item.id)}`, { method: "DELETE" }).catch(() => undefined);
    await onChange();
  }
  return (
    <StudioSheet label="Add your product" onClose={onClose} wide>
      <div className="mks-tabs-row">
        <Segment
          className="mks-tabs"
          label="Product type"
          value={mode}
          onChange={onMode}
          options={[
            { value: "product", label: "Product", icon: <Package className="h-3.5 w-3.5" /> },
            { value: "app", label: "App", icon: <AppWindow className="h-3.5 w-3.5" /> },
          ]}
        />
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
            <ReferenceTray className="mks-uploads" assets={images} max={5} label="product photos" onChange={setImages} onError={setError} empty={images.length ? null : "Up to 5 photos of the product"} />
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
              <button type="button" className="mks-product-del" aria-label={`Delete ${item.name}`} onClick={() => void remove(item)}><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
          ))}
        </div>
      ) : null}
    </StudioSheet>
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
  async function remove(item: Avatar) {
    if (!(await confirm({ title: `Delete ${item.name}?`, body: "This avatar is removed from your presenters.", confirmLabel: "Delete", danger: true }))) return;
    await fetch(`/api/studio/marketing/avatars/${encodeURIComponent(item.id)}`, { method: "DELETE" }).catch(() => undefined);
    await onChange();
  }
  return (
    <StudioSheet label="Select avatar" onClose={onClose} wide>
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
          <SearchField className="mks-search is-wide" size="sm" value={query} onChange={setQuery} placeholder="Search avatars" />
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
                {!item.builtIn ? <button type="button" className="mks-face-del" aria-label={`Delete ${item.name}`} onClick={() => void remove(item)}><Trash2 className="h-3.5 w-3.5" /></button> : null}
              </div>
            ))}
          </div>
        </div>
      </div>
      {creating ? <CreateAvatar onClose={() => setCreating(false)} onCreated={async (id) => { await onChange(); setCreating(false); onPick(id); }} /> : null}
    </StudioSheet>
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
      <Segment<"female" | "male"> className="mks-tabs" label="Gender" value={gender} onChange={setGender} options={[{ value: "female", label: "Female" }, { value: "male", label: "Male" }]} />
      <div className="mks-create-body">
        <MediaSlot label="Photo you have rights to" accept={IMAGE_TYPES} asset={photo || undefined} onChange={(asset) => setPhoto(asset || null)} onError={setError} />
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
