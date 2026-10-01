// Thumbnail Downloader: the cover image of any video link, previewed at full
// size and saved through the server so the browser downloads instead of opening it.
import { FormEvent, useState } from "react";
import { Check, Copy, Download, ImageDown, Link2, Loader2 } from "lucide-react";
import { useErrorToast } from "../../utils/toast";
import { Empty } from "../studio/studioShared";
import { toolEntry, type ToolDef } from "./toolApps";
import { ToolLayout } from "./ToolPage";

type Info = { title: string; uploader: string; thumbnail: string; duration: number };
const duration = (seconds: number) => {
  if (!seconds) return "";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
};
const filenameOf = (disposition: string | null, fallback: string) => {
  const match = disposition?.match(/filename="?([^";]+)"?/i)?.[1];
  return match || fallback;
};

export function ThumbnailDownloader({ tool }: { tool: ToolDef }) {
  const entry = toolEntry(tool.id);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [info, setInfo] = useState<(Info & { url: string }) | null>(null);
  const [size, setSize] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  useErrorToast(error, () => setError(""));

  async function submit(event: FormEvent) {
    event.preventDefault();
    const source = url.trim();
    if (!source || busy) return;
    setBusy(true);
    setError("");
    setInfo(null);
    setSize("");
    try {
      const response = await fetch("/api/downloader/inspect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: source }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not read this link.");
      if (!data.thumbnail) throw new Error("This video has no cover image.");
      setInfo({ title: data.title || "Untitled", uploader: data.uploader || "", thumbnail: data.thumbnail, duration: Number(data.duration) || 0, url: source });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read this link.");
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    if (!info || saving) return;
    setSaving(true);
    try {
      const response = await fetch("/api/tools/thumbnail", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: info.url }) });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Download failed.");
      }
      const blob = await response.blob();
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.download = filenameOf(response.headers.get("content-disposition"), "thumbnail.jpg");
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(href);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Download failed.");
    } finally {
      setSaving(false);
    }
  }
  async function copyLink() {
    if (!info) return;
    try {
      await navigator.clipboard.writeText(info.thumbnail);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setError("Copy failed. Open the image and copy its address instead.");
    }
  }

  const panel = (
    <form style={{ display: "contents" }} onSubmit={(event) => void submit(event)}>
      <label className="mt-field">
        <span className="mt-label">Video link</span>
        <div className="relative">
          <Link2 size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 opacity-50" aria-hidden="true" />
          <input className="mt-input" style={{ paddingLeft: 34 }} type="url" inputMode="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://www.youtube.com/watch?v=…" disabled={busy} />
        </div>
      </label>
      <button type="submit" className="mt-primary" disabled={!url.trim() || busy}>
        {busy ? <Loader2 size={16} className="animate-spin" /> : <ImageDown size={16} />}
        {busy ? "Looking" : tool.action}
      </button>
      <p className="mt-note">Works with YouTube, TikTok, Instagram, X, Vimeo, and most sites with a video page. Covers belong to their uploaders.</p>
    </form>
  );

  return (
    <ToolLayout panel={panel}>
      <div className="mt-stage-head">
        <h2>Cover image</h2>
        <span className="mt-meta">{size || (info ? "Full size" : "Nothing yet")}</span>
      </div>
      <div className="mt-stage-inner">
        {busy ? <div className="mt-skeleton" aria-hidden="true"><span /><span /><span /></div> : null}
        {info ? (
          <>
            <figure className="mt-cover" style={{ margin: 0 }}>
              <img src={info.thumbnail} alt={`Cover of ${info.title}`} onLoad={(event) => setSize(`${event.currentTarget.naturalWidth} × ${event.currentTarget.naturalHeight}`)} />
              <figcaption className="mt-cover-foot">
                <div style={{ minWidth: 0 }}>
                  <strong style={{ display: "block", fontSize: 14, overflowWrap: "anywhere" }}>{info.title}</strong>
                  <span className="mt-meta">{[info.uploader, duration(info.duration)].filter(Boolean).join(" · ")}</span>
                </div>
                <div className="mt-actions">
                  <button type="button" className="mt-secondary" onClick={() => void copyLink()}>{copied ? <Check size={15} /> : <Copy size={15} />}{copied ? "Copied" : "Copy image link"}</button>
                  <button type="button" className="mt-primary" style={{ width: "auto", height: 34, fontSize: 13 }} onClick={() => void save()} disabled={saving}>
                    {saving ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
                    {saving ? "Saving" : "Download"}
                  </button>
                </div>
              </figcaption>
            </figure>
          </>
        ) : !busy ? (
          <Empty icon={entry?.icon} heading={tool.heading} body={tool.body} />
        ) : null}
      </div>
    </ToolLayout>
  );
}
