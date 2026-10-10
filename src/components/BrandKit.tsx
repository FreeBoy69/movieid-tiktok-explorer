// Brand kit: one per account. AI Clipping applies it when "Brand kit" is on:
// the logo in a corner, the caption look, and an intro and outro around every
// clip. Shown in the clipping studio's Brand kit tab and under Account.
import { useEffect, useRef, useState } from "react";
import { Film, ImagePlus, Loader2, X } from "lucide-react";
import { CAPTION_FONTS, CAPTION_STYLES } from "../utils/captionStyles.js";
import { CaptionPreview, type LogoCorner } from "./CaptionStylePicker";
import { Segmented } from "./ui/controls";

export type BrandKit = {
  logo: string;
  logoUrl: string;
  logoPosition: LogoCorner;
  logoOpacity: number;
  primaryColor: string;
  accentColor: string;
  captionStyle: string;
  captionFont: string;
  intro: string;
  introUrl: string;
  outro: string;
  outroUrl: string;
};

export const EMPTY_BRAND_KIT: BrandKit = { logo: "", logoUrl: "", logoPosition: "top-right", logoOpacity: 0.9, primaryColor: "", accentColor: "", captionStyle: "", captionFont: "", intro: "", introUrl: "", outro: "", outroUrl: "" };

async function readJson(response: Response, fallback: string) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || fallback);
  return data;
}

/** The signed-in person's brand kit; null until loaded. `save` stores a new version. */
export function useBrandKit(enabled = true) {
  const [kit, setKit] = useState<BrandKit | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    fetch("/api/studio/brand-kit", { cache: "no-store" })
      .then((response) => readJson(response, "Couldn't load your brand kit"))
      .then((data) => active && setKit({ ...EMPTY_BRAND_KIT, ...(data.kit || {}) }))
      .catch((cause) => active && setError(cause instanceof Error ? cause.message : "Couldn't load your brand kit"));
    return () => {
      active = false;
    };
  }, [enabled]);
  const save = async (next: BrandKit) => {
    const data = await readJson(
      await fetch("/api/studio/brand-kit", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(next) }),
      "Couldn't save your brand kit",
    );
    const saved = { ...EMPTY_BRAND_KIT, ...data.kit };
    setKit(saved);
    return saved;
  };
  return { kit, error, save };
}

const CORNERS: Array<{ value: LogoCorner; label: string }> = [
  { value: "top-left", label: "Top left" },
  { value: "top-right", label: "Top right" },
  { value: "bottom-left", label: "Bottom left" },
  { value: "bottom-right", label: "Bottom right" },
];

function FilePick({ label, accept, url, kind, onPick, onClear, onError }: { label: string; accept: string; url: string; kind: "image" | "video"; onPick: (file: string, url: string) => void; onClear: () => void; onError: (message: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="bk-file">
      <input ref={input} type="file" accept={accept} hidden onChange={async (event) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file) return;
        setBusy(true);
        try {
          const data = await readJson(await fetch("/api/studio/uploads", { method: "POST", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file }), "Upload failed");
          onPick(data.file, data.url);
        } catch (cause) {
          onError(cause instanceof Error ? cause.message : "Upload failed");
        } finally {
          setBusy(false);
        }
      }} />
      {url ? (
        <div className={`bk-file-filled is-${kind}`}>
          {kind === "image" ? <img src={url} alt="" /> : <video src={url} muted playsInline preload="metadata" />}
          <span className="bk-file-tag">{label}</span>
          <button type="button" className="bk-file-clear" onClick={onClear} aria-label={`Remove the ${label.toLowerCase()}`}><X size={12} /></button>
        </div>
      ) : (
        <button type="button" className="bk-file-empty" onClick={() => input.current?.click()} disabled={busy}>
          {busy ? <Loader2 size={16} className="ui-spin" /> : kind === "image" ? <ImagePlus size={16} /> : <Film size={16} />}
          <span>{busy ? "Uploading" : label}</span>
        </button>
      )}
    </div>
  );
}

function ColorField({ label, hint, value, fallback, onChange }: { label: string; hint: string; value: string; fallback: string; onChange: (value: string) => void }) {
  return (
    <div className="bk-color">
      <label>
        <input type="color" value={value || fallback} onChange={(event) => onChange(event.target.value.toUpperCase())} />
        <span>
          <strong>{label}</strong>
          <small>{value ? value : hint}</small>
        </span>
      </label>
      {value ? <button type="button" className="bk-link" onClick={() => onChange("")}>Reset</button> : null}
    </div>
  );
}

/** The compact editor: logo, colours, caption look, and intro/outro, with a live 9:16 preview. */
export function BrandKitEditor({ fallbackStyle = "hormozi", brand, onSaved }: { fallbackStyle?: string; /** A kit the page already loaded with useBrandKit. */ brand?: ReturnType<typeof useBrandKit>; onSaved?: (kit: BrandKit) => void }) {
  const own = useBrandKit(!brand);
  const { kit, error: loadError, save } = brand || own;
  const [draft, setDraft] = useState<BrandKit | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "done"; text: string } | null>(null);
  useEffect(() => {
    if (kit && !draft) setDraft(kit);
  }, [kit, draft]);
  if (loadError) return <p className="bk-note is-error" role="alert">{loadError}</p>;
  if (!draft) return <p className="bk-note"><Loader2 size={15} className="ui-spin" aria-hidden="true" /> Loading your brand kit</p>;
  const patch = (next: Partial<BrandKit>) => {
    setDraft({ ...draft, ...next });
    setMessage(null);
  };
  const onError = (text: string) => setMessage({ tone: "error", text });
  const styleId = draft.captionStyle || fallbackStyle;
  const style = CAPTION_STYLES.find((item) => item.id === styleId) || CAPTION_STYLES[0];
  const changed = JSON.stringify(draft) !== JSON.stringify(kit);
  return (
    <div className="bk">
      <CaptionPreview
        styleId={styleId}
        look={{ text: draft.primaryColor, active: draft.accentColor, font: draft.captionFont }}
        logo={draft.logoUrl ? { url: draft.logoUrl, position: draft.logoPosition, opacity: draft.logoOpacity } : undefined}
        label="Brand kit preview"
      />
      <form
        className="bk-form"
        onSubmit={async (event) => {
          event.preventDefault();
          setSaving(true);
          try {
            const saved = await save(draft);
            setDraft(saved);
            setMessage({ tone: "done", text: "Saved. Turn on Brand kit when you clip to use it." });
            onSaved?.(saved);
          } catch (cause) {
            onError(cause instanceof Error ? cause.message : "Couldn't save your brand kit");
          } finally {
            setSaving(false);
          }
        }}
      >
        <fieldset className="bk-group">
          <legend>Logo</legend>
          <div className="bk-row">
            <FilePick label="Logo" kind="image" accept="image/png,image/jpeg,image/webp" url={draft.logoUrl} onPick={(logo, logoUrl) => patch({ logo, logoUrl })} onClear={() => patch({ logo: "", logoUrl: "" })} onError={onError} />
            <div className="bk-stack">
              <Segmented size="sm" label="Logo corner" value={draft.logoPosition} options={CORNERS} onChange={(logoPosition) => patch({ logoPosition })} />
              <label className="bk-range">
                <span>Opacity</span>
                <input type="range" min={10} max={100} step={5} value={Math.round(draft.logoOpacity * 100)} onChange={(event) => patch({ logoOpacity: Number(event.target.value) / 100 })} />
                <output>{Math.round(draft.logoOpacity * 100)}%</output>
              </label>
            </div>
          </div>
          <p className="bk-hint">A PNG with a transparent background looks best.</p>
        </fieldset>
        <fieldset className="bk-group">
          <legend>Captions</legend>
          <div className="bk-row is-fields">
            <label className="bk-select">
              <span>Style</span>
              <select value={draft.captionStyle} onChange={(event) => patch({ captionStyle: event.target.value })}>
                <option value="">Same as each clip</option>
                {CAPTION_STYLES.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
            <label className="bk-select">
              <span>Font</span>
              <select value={draft.captionFont} onChange={(event) => patch({ captionFont: event.target.value })}>
                <option value="">The style's own font</option>
                {Object.keys(CAPTION_FONTS).map((font) => <option key={font} value={font}>{font}</option>)}
              </select>
            </label>
          </div>
          <div className="bk-row is-fields">
            <ColorField label="Primary" hint="Caption text" value={draft.primaryColor} fallback={style.colors.text} onChange={(primaryColor) => patch({ primaryColor })} />
            <ColorField label="Accent" hint="The spoken word" value={draft.accentColor} fallback={style.colors.active} onChange={(accentColor) => patch({ accentColor })} />
          </div>
        </fieldset>
        <fieldset className="bk-group">
          <legend>Intro and outro</legend>
          <div className="bk-row">
            <FilePick label="Intro" kind="video" accept="video/mp4,video/quicktime,video/webm" url={draft.introUrl} onPick={(intro, introUrl) => patch({ intro, introUrl })} onClear={() => patch({ intro: "", introUrl: "" })} onError={onError} />
            <FilePick label="Outro" kind="video" accept="video/mp4,video/quicktime,video/webm" url={draft.outroUrl} onPick={(outro, outroUrl) => patch({ outro, outroUrl })} onClear={() => patch({ outro: "", outroUrl: "" })} onError={onError} />
          </div>
          <p className="bk-hint">Up to 15 seconds each. They're resized to fit each clip.</p>
        </fieldset>
        <footer className="bk-foot">
          {message ? <p className={`bk-note${message.tone === "error" ? " is-error" : ""}`} role={message.tone === "error" ? "alert" : "status"}>{message.text}</p> : <span />}
          <button type="submit" className="ui-btn is-primary" disabled={saving || !changed}>
            {saving ? <Loader2 size={15} className="ui-spin" aria-hidden="true" /> : null}
            {saving ? "Saving" : "Save brand kit"}
          </button>
        </footer>
      </form>
    </div>
  );
}
