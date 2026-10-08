import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { AudioLines, Check, ChevronDown, ChevronRight, Clapperboard, Film, ImageIcon, Images, LayoutGrid, Loader2, Megaphone, Palette, Plus, Sparkles, Video, Wrench, X } from "lucide-react";
import { ALL_NAV_ENTRIES, NAV_GROUPS, type NavEntry, type NavTarget } from "../utils/appNavigation";
import { CREATE_TABS, promptWithStyle, templatesFor, type CreateTab, type CreateTemplate } from "../utils/createTemplates";
import { writePendingTemplate } from "../utils/promptTemplates";
import { uploadAsset, type Asset, type Catalog } from "./studio/studioShared";
import { PREFERRED } from "./studio/StudioGenerator";
import { toast } from "../utils/toast";
import { Composer, LayoutCard, Masonry, SendButton, StudioLayout } from "./StudioLayout";

// The Create home page: one chat box that makes an image or a video, and below it
// every template in the app, grouped by tab. Simple prompts open Image or Video
// Studio and start generating; a template opens the studio that runs it.

type Mode = "image" | "video";
// Image, Video, and Audio list the studios from those header menus; All tools lists everything.
type AppTab = "image" | "video" | "audio" | "tools";
type Tab = CreateTab | AppTab;
const TAB_ICONS: Record<Tab, ReactNode> = {
  all: <LayoutGrid size={16} />,
  image: <Images size={16} />,
  video: <Film size={16} />,
  audio: <AudioLines size={16} />,
  motion: <Sparkles size={16} />,
  marketing: <Megaphone size={16} />,
  film: <Clapperboard size={16} />,
  shorts: <Clapperboard size={16} />,
  styles: <Palette size={16} />,
  cinematic: <Video size={16} />,
  tools: <Wrench size={16} />,
};
const TAB_LABELS: Record<Tab, string> = { ...Object.fromEntries(CREATE_TABS.map((t) => [t.id, t.label])), image: "Image", video: "Video", audio: "Audio", tools: "All tools" } as Record<Tab, string>;
const TABS: Tab[] = ["all", "image", "video", "audio", ...CREATE_TABS.map((t) => t.id).filter((id) => id !== "all"), "tools"];
const MAX_REFERENCES = 4;
const TAB_KEY = "autoyt-create-tab";

const unique = (entries: NavEntry[]) => entries.filter((entry, index, all) => all.findIndex((e) => e.id === entry.id) === index);
const groupEntries = (...ids: string[]) => unique(NAV_GROUPS.filter((group) => ids.includes(group.id)).flatMap((group) => group.columns.flatMap((column) => column.entries)));
const APP_TABS: Record<AppTab, NavEntry[]> = {
  image: groupEntries("image", "image-tools"),
  video: groupEntries("video"),
  audio: groupEntries("audio"),
  tools: unique(ALL_NAV_ENTRIES),
};
const isAppTab = (tab: Tab): tab is AppTab => tab in APP_TABS;

export function CreateHub({ theme, signedIn, onSignIn, onNavigate }: { theme: "light" | "dark"; signedIn: boolean; onSignIn: () => void; onNavigate: (target: NavTarget) => void }) {
  const [mode, setMode] = useState<Mode>("image");
  const [prompt, setPrompt] = useState("");
  const [template, setTemplate] = useState<CreateTemplate | null>(null);
  const [references, setReferences] = useState<Asset[]>([]);
  const [uploading, setUploading] = useState(false);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [model, setModel] = useState<Record<Mode, string>>({ image: "", video: "" });
  const [tab, setTab] = useState<Tab>(() => {
    try {
      const saved = window.localStorage.getItem(TAB_KEY) as Tab | null;
      return saved && TABS.includes(saved) ? saved : "all";
    } catch {
      return "all";
    }
  });
  const box = useRef<HTMLTextAreaElement>(null);
  const files = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      window.localStorage.setItem(TAB_KEY, tab);
    } catch {}
  }, [tab]);

  useEffect(() => {
    if (!signedIn) return;
    let alive = true;
    fetch("/api/studio/catalog", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data: Catalog) => alive && setCatalog(data))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [signedIn]);

  const models = mode === "image" ? catalog?.image || [] : catalog?.video || [];
  const chosenModel = models.find((m) => m.id === model[mode]) || (PREFERRED[mode] || []).map((id) => models.find((m) => m.id === id)).find(Boolean) || models[0];

  // The box grows with the text, like a chat composer.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(320, Math.max(72, el.scrollHeight))}px`;
  }, [prompt]);

  const workspace = template?.kind === "workspace" ? template : null;
  const canSend = Boolean(prompt.trim() || template) && !uploading;
  const placeholder = workspace
    ? `Tell ${workspace.studio} what it's for: your product, link, or story. You can add the rest there.`
    : mode === "image"
      ? "Describe the image you want. Add reference images with +, or pick a style below."
      : "Describe the video you want. Add a start frame with +, or pick a template below.";

  const pick = (next: CreateTemplate) => {
    setTemplate((current) => (current?.key === next.key ? null : next));
    window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    window.setTimeout(() => box.current?.focus(), 250);
  };

  const addFiles = async (list: FileList | null) => {
    if (!signedIn) return onSignIn();
    const picked = Array.from(list || []).filter((file) => file.type.startsWith("image/")).slice(0, MAX_REFERENCES - references.length);
    if (!picked.length) return;
    setUploading(true);
    try {
      const uploaded = await Promise.all(picked.map((file) => uploadAsset(file, file.name)));
      setReferences((current) => [...current, ...uploaded].slice(0, MAX_REFERENCES));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't upload that image.");
    } finally {
      setUploading(false);
      if (files.current) files.current.value = "";
    }
  };

  const send = () => {
    if (!canSend) return;
    if (!signedIn) return onSignIn();
    const text = prompt.trim();
    if (workspace?.pending && workspace.target) {
      writePendingTemplate({ ...workspace.pending, title: workspace.title, prompt: text });
      onNavigate(workspace.target);
      return;
    }
    const full = promptWithStyle(text, template);
    writePendingTemplate({
      target: mode,
      title: template?.title || "Create",
      prompt: full,
      model: chosenModel?.id || "",
      references: mode === "video" ? references.slice(0, 1) : references,
      autoRun: true,
    });
    onNavigate({ view: "studio", studioTab: mode });
  };

  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      send();
    }
  };

  const items = useMemo(() => (isAppTab(tab) ? [] : templatesFor(tab)), [tab]);

  return (
    <StudioLayout
      big
      theme={theme}
      title="What are we making?"
      composer={
        <Composer
          className={workspace ? "is-workspace" : ""}
          top={workspace ? null : <ReferenceStack references={references} uploading={uploading} mode={mode} onAdd={() => (signedIn ? files.current?.click() : onSignIn())} onRemove={(file) => setReferences((current) => current.filter((r) => r.file !== file))} />}
          controls={workspace ? (
            <span className="sl-hint">{workspace.studio} · {TAB_LABELS[workspace.tab]}</span>
          ) : (
            <>
              <div className="sl-mode" role="radiogroup" aria-label="Make an image or a video">
                <button type="button" role="radio" aria-checked={mode === "image"} onClick={() => setMode("image")}><ImageIcon size={15} />Image</button>
                <button type="button" role="radio" aria-checked={mode === "video"} onClick={() => setMode("video")}><Video size={15} />Video</button>
              </div>
              {models.length ? <ModelMenu models={models} value={chosenModel?.id || ""} onChange={(id) => setModel((current) => ({ ...current, [mode]: id }))} /> : null}
            </>
          )}
          send={<SendButton disabled={!canSend} busy={uploading} onClick={send} label={workspace ? `Open ${workspace.studio}` : `Make ${mode === "image" ? "an image" : "a video"}`} />}
        >
          <input ref={files} type="file" accept="image/*" multiple hidden onChange={(event) => void addFiles(event.target.files)} />
          {template ? (
            <div className="sl-chip">
              {template.image ? <img src={template.image} alt="" /> : <span className="sl-chip-mark" aria-hidden="true">{template.title.slice(0, 1)}</span>}
              <span>
                <strong>{template.title}</strong>
                <small>{template.kind === "style" ? "Style added to your prompt" : `Opens ${template.studio}`}</small>
              </span>
              <button type="button" onClick={() => setTemplate(null)} aria-label={`Remove ${template.title}`}><X size={14} /></button>
            </div>
          ) : null}
          <textarea ref={box} value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={onKey} placeholder={placeholder} rows={2} aria-label="Describe what you want to make" />
        </Composer>
      }
      heading="Get inspired"
      aside={
        <button type="button" className="sl-aside" onClick={() => onNavigate({ view: "prompts" })}>
          <span>Need ideas?</span> <strong>Browse the prompt library</strong> <ChevronRight size={16} />
        </button>
      }
      tabsLabel="Templates"
      tabs={TABS.map((id) => ({ value: id as Tab, label: TAB_LABELS[id], icon: TAB_ICONS[id] }))}
      tab={tab}
      onTab={(next) => setTab(next as Tab)}
    >
      <Masonry>
        {isAppTab(tab)
          ? APP_TABS[tab].map((entry) => (
            <LayoutCard key={entry.id} title={entry.label} sub={entry.description} tag={entry.badge} image={`/assets/explore/${entry.id}.webp`} ratio={16 / 10} onClick={() => onNavigate(entry.target)} />
          ))
          : items.map((item) => (
            <LayoutCard
              key={item.key}
              title={item.title}
              sub={item.by || item.blurb}
              note={item.blurb}
              tag={TAB_LABELS[item.tab]}
              image={item.image}
              ratio={item.ratio}
              selected={template?.key === item.key}
              onClick={() => pick(item)}
            />
          ))}
      </Masonry>
    </StudioLayout>
  );
}

// The dashed card stack on the box's corner: each slot is a reference image, the
// last one adds another.
function ReferenceStack({ references, uploading, mode, onAdd, onRemove }: { references: Asset[]; uploading: boolean; mode: Mode; onAdd: () => void; onRemove: (file: string) => void }) {
  const limit = mode === "video" ? 1 : MAX_REFERENCES;
  const shown = references.slice(0, limit);
  return (
    <div className="sl-stack" aria-label={mode === "video" ? "Start frame" : "Reference images"}>
      {shown.map((ref, index) => (
        <span key={ref.file} className="sl-stack-card has-image" style={{ ["--i" as string]: index }}>
          <img src={ref.url} alt={ref.name || "Reference"} />
          <button type="button" onClick={() => onRemove(ref.file)} aria-label={`Remove ${ref.name || "reference"}`}><X size={12} /></button>
        </span>
      ))}
      {shown.length < limit ? (
        <button type="button" className="sl-stack-card is-add" style={{ ["--i" as string]: shown.length }} onClick={onAdd} aria-label={mode === "video" ? "Add a start frame" : "Add reference images"} title={mode === "video" ? "Add a start frame" : "Add reference images"}>
          {uploading ? <Loader2 size={16} className="ui-spin" /> : <Plus size={18} />}
        </button>
      ) : null}
      {!shown.length ? (
        <>
          <span className="sl-stack-card is-ghost" style={{ ["--i" as string]: 1 }} aria-hidden="true"><Plus size={14} /></span>
          <span className="sl-stack-card is-ghost" style={{ ["--i" as string]: 2 }} aria-hidden="true"><Plus size={14} /></span>
        </>
      ) : null}
    </div>
  );
}

function ModelMenu({ models, value, onChange }: { models: Array<{ id: string; name: string; provider: string; description: string }>; value: string; onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => { if (!wrap.current?.contains(event.target as Node)) setOpen(false); };
    const esc = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  const current = models.find((m) => m.id === value);
  return (
    <div className="sl-model" ref={wrap}>
      <button type="button" className="sl-model-btn" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span>{current?.name || "Model"}</span>
        <ChevronDown size={14} />
      </button>
      {open ? (
        <ul className="sl-model-menu" role="listbox" aria-label="Model">
          {models.map((m) => (
            <li key={m.id}>
              <button type="button" role="option" aria-selected={m.id === value} onClick={() => { onChange(m.id); setOpen(false); }}>
                <span className="sl-model-text">
                  <strong>{m.name}</strong>
                  <small>{m.description || m.provider}</small>
                </span>
                {m.id === value ? <Check size={15} /> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export default CreateHub;
