// Create Video's finishing tools: the video-wide look, motion-graphic data
// cards (designed here, filmed by the render worker), and thumbnails modelled
// on the winning videos for a topic.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { BarChart3, CalendarDays, Check, Hash, ListChecks, Loader2, Quote, Search, Sigma, Trash2, TrendingUp } from "lucide-react";
import { VIDEO_LOOKS } from "../utils/videoLooks.js";
import { GRAPHIC_KINDS, graphicFontCss, graphicHtml, normalizeGraphic } from "../utils/videoGraphics.js";
import { normalizeOverlay, OVERLAY_KINDS, overlayExample, overlayTemplate } from "../utils/videoOverlays.js";
import { Modal } from "./CreatorWorkspace";
import "./CreateVideoExtras.css";

// ---------- Look ----------
export function LookPicker({ value, onChange, disabled }: { value: string; onChange: (look: string) => void; disabled?: boolean }) {
  return (
    <div className="cvx-looks" role="radiogroup" aria-label="Look">
      {VIDEO_LOOKS.map((look) => {
        const on = (value || "none") === look.id;
        return (
          <button key={look.id} type="button" role="radio" aria-checked={on} className={`cvx-look${on ? " is-on" : ""}`} disabled={disabled} onClick={() => onChange(look.id)}>
            <span className="cvx-swatch" style={{ background: look.swatch }} aria-hidden="true">
              {on ? <Check size={14} /> : null}
            </span>
            <span className="cvx-look-text">
              <strong>{look.name}</strong>
              <small>{look.detail}</small>
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ---------- Data cards ----------
export type SceneGraphic = { kind: string; vars: Record<string, any>; look?: string };
const KIND_ICONS: Record<string, ReactNode> = {
  year: <CalendarDays size={15} />,
  stat: <Sigma size={15} />,
  rank: <Hash size={15} />,
  bars: <BarChart3 size={15} />,
  list: <ListChecks size={15} />,
  quote: <Quote size={15} />,
};
export const graphicSummary = (graphic?: SceneGraphic | null) => {
  if (!graphic) return "";
  const v = graphic.vars || {};
  const label = GRAPHIC_KINDS[graphic.kind as keyof typeof GRAPHIC_KINDS]?.name || "Card";
  const lead = graphic.kind === "year" ? v.year : graphic.kind === "stat" ? v.value : graphic.kind === "rank" ? `#${v.rank} ${v.title}` : graphic.kind === "quote" ? `“${v.text}”` : v.title;
  return lead ? `${label}: ${lead}` : label;
};

const FONT_CSS = graphicFontCss((file: string) => `/fonts/captions/${file}`);

/** The card itself, looping in an iframe exactly as the renderer will film it. */
export function GraphicPreview({ graphic, look, aspect, background, seconds = 5 }: { graphic: SceneGraphic | null; look: string; aspect: string; background?: string; seconds?: number }) {
  const [w, h] = aspect === "9:16" ? [1080, 1920] : aspect === "1:1" ? [1080, 1080] : [1920, 1080];
  const doc = useMemo(() => {
    const valid = graphic ? normalizeGraphic(graphic) : null;
    if (!valid) return "";
    const html = graphicHtml(valid, { width: w, height: h, duration: seconds, look, background: background ? "bg" : "" })
      .replace('"asset:bg"', JSON.stringify(background || ""))
      .replace("<style>", `<style>${FONT_CSS}html,body{margin:0;overflow:hidden;background:#000}#stage{transform-origin:0 0}`);
    // Fit the stage to the frame and loop the timeline; the pause at the end shows the settled card.
    return html.replace(
      "window.seek(0);",
      `window.seek(${seconds});(function(){var s=document.getElementById("stage");function fit(){s.style.transform="scale("+(innerWidth/${w})+")"}fit();addEventListener("resize",fit);var t0=null;function loop(n){if(t0===null)t0=n;window.seek(((n-t0)/1000)%(${seconds}+1.2));requestAnimationFrame(loop)}document.fonts.ready.then(function(){requestAnimationFrame(loop)})})();`,
    );
  }, [graphic, look, w, h, background, seconds]);
  return (
    <div className="cvx-preview" style={{ aspectRatio: `${w} / ${h}` }}>
      {doc ? <iframe title="Card preview" srcDoc={doc} sandbox="allow-scripts allow-same-origin" /> : <span>Fill in the card to preview it</span>}
    </div>
  );
}

const EMPTY: Record<string, Record<string, any>> = {
  year: { year: "", label: "" },
  stat: { value: "", label: "", note: "" },
  rank: { rank: 1, title: "", subtitle: "" },
  bars: { title: "", unit: "", items: [{ label: "", value: "" }, { label: "", value: "" }] },
  list: { title: "", items: [{ label: "", value: "" }, { label: "", value: "" }] },
  quote: { text: "", by: "" },
};

/** Design one scene's card: pick a kind, fill it in, preview it, then film it. */
export function GraphicEditor({
  scene,
  look,
  aspect,
  onClose,
  onFilm,
  onRemove,
}: {
  scene: { id: string; start: number; end: number; text?: string; asset?: string | null; graphic?: SceneGraphic | null };
  look: string;
  aspect: string;
  onClose: () => void;
  onFilm: (graphic: SceneGraphic) => void;
  onRemove?: () => void;
}) {
  const [draft, setDraft] = useState<SceneGraphic>(() => scene.graphic ? { kind: scene.graphic.kind, vars: structuredClone(scene.graphic.vars) } : { kind: "stat", vars: { ...EMPTY.stat } });
  const valid = normalizeGraphic(draft);
  const set = (key: string, value: unknown) => setDraft((d) => ({ ...d, vars: { ...d.vars, [key]: value } }));
  const setItem = (i: number, key: string, value: string) =>
    setDraft((d) => ({ ...d, vars: { ...d.vars, items: d.vars.items.map((item: any, k: number) => (k === i ? { ...item, [key]: value } : item)) } }));
  const field = (key: string, label: string, placeholder = "", type = "text") => (
    <label className="maker-field">
      {label}
      <input type={type} value={draft.vars[key] ?? ""} placeholder={placeholder} onChange={(e) => set(key, type === "number" ? Number(e.target.value) : e.target.value)} />
    </label>
  );
  const many = draft.kind === "bars" || draft.kind === "list";
  return (
    <Modal
      title={scene.graphic ? "Edit the data card" : "Add a data card"}
      wide
      onClose={onClose}
      footer={
        <>
          {onRemove ? (
            <button type="button" className="maker-ghost cvx-remove" onClick={onRemove}>
              <Trash2 size={15} /> Remove card
            </button>
          ) : null}
          <button type="button" className="maker-outline" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="maker-primary" disabled={!valid} onClick={() => valid && onFilm({ kind: valid.kind, vars: valid.vars })}>
            {scene.graphic ? "Film the new card" : "Film the card"}
          </button>
        </>
      }
    >
      <div className="cvx-editor">
        <div className="cvx-editor-form">
          <div className="cvx-kinds" role="radiogroup" aria-label="Card type">
            {Object.entries(GRAPHIC_KINDS).map(([id, kind]) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={draft.kind === id}
                className={draft.kind === id ? "is-on" : ""}
                onClick={() => setDraft((d) => (d.kind === id ? d : { kind: id, vars: { ...EMPTY[id] } }))}
              >
                {KIND_ICONS[id]} {kind.name}
              </button>
            ))}
          </div>
          {scene.text ? <p className="cvx-narration">“{scene.text}”</p> : null}
          {draft.kind === "year" && (
            <>
              {field("year", "Year", "1965")}
              {field("label", "What happened", "Dr. Max Huber publishes his recipe")}
            </>
          )}
          {draft.kind === "stat" && (
            <>
              {field("value", "The number", "$390, 70%, 2 million")}
              {field("label", "What it measures", "for a two-ounce jar")}
              {field("note", "Small print (optional)", "2026 retail price")}
            </>
          )}
          {draft.kind === "rank" && (
            <>
              {field("rank", "Rank", "7", "number")}
              {field("title", "Entry", "The backyard incinerator")}
              {field("subtitle", "One line about it (optional)", "Every suburban lot had one until 1957")}
            </>
          )}
          {draft.kind === "quote" && (
            <>
              <label className="maker-field">
                Quote
                <textarea rows={3} value={draft.vars.text || ""} onChange={(e) => set("text", e.target.value)} />
              </label>
              {field("by", "Who said it", "Estée Lauder ad, 1995")}
            </>
          )}
          {many && (
            <>
              {field("title", "Title", draft.kind === "bars" ? "What you actually pay for" : "First three ingredients")}
              {draft.kind === "bars" ? field("unit", "Unit (optional)", "%") : null}
              <div className="cvx-items">
                <span className="cvx-items-head">{draft.kind === "bars" ? "Bars" : "Rows"}</span>
                {draft.vars.items.map((item: any, i: number) => (
                  <div key={i} className="cvx-item">
                    <input aria-label={`Label ${i + 1}`} placeholder="Label" value={item.label} onChange={(e) => setItem(i, "label", e.target.value)} />
                    <input aria-label={`Value ${i + 1}`} placeholder={draft.kind === "bars" ? "62" : "Value"} inputMode={draft.kind === "bars" ? "decimal" : undefined} value={item.value} onChange={(e) => setItem(i, "value", e.target.value)} />
                    <button
                      type="button"
                      className="maker-icon"
                      aria-label={`Remove row ${i + 1}`}
                      disabled={draft.vars.items.length <= 2}
                      onClick={() => setDraft((d) => ({ ...d, vars: { ...d.vars, items: d.vars.items.filter((_: any, k: number) => k !== i) } }))}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
                {draft.vars.items.length < (draft.kind === "bars" ? 5 : 6) ? (
                  <button type="button" className="maker-link" onClick={() => setDraft((d) => ({ ...d, vars: { ...d.vars, items: [...d.vars.items, { label: "", value: "" }] } }))}>
                    Add a row
                  </button>
                ) : null}
              </div>
            </>
          )}
        </div>
        <div className="cvx-editor-preview">
          <GraphicPreview graphic={valid} look={look} aspect={aspect} background={scene.asset || ""} seconds={Math.max(2, Math.min(8, scene.end - scene.start))} />
          <small>Filmed in the video's look for the scene's full {Math.max(1, Math.round(scene.end - scene.start))} seconds, over a blur of its own picture.</small>
        </div>
      </div>
    </Modal>
  );
}

// ---------- Winning thumbnails ----------
export type WinningVideo = { url: string; title: string; thumbnailUrl: string; viewCount: number; multiplier: number; channelTitle?: string };
const compact = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n));
const youtubeId = (url: string) => String(url).match(/(?:v=|youtu\.be\/|shorts\/|embed\/)([A-Za-z0-9_-]{11})/)?.[1] || "";

/**
 * Thumbnails of the videos outperforming their channels on this topic (views
 * per subscriber), plus any video pasted by link. Picking one makes its
 * thumbnail the style reference.
 */
export function WinningThumbnails({ topic, picked, onPick }: { topic: string; picked: string; onPick: (video: WinningVideo) => void }) {
  const [query, setQuery] = useState(topic);
  const [videos, setVideos] = useState<WinningVideo[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [link, setLink] = useState("");
  useEffect(() => setQuery((q) => q || topic), [topic]);

  async function search(q = query) {
    const clean = q.trim();
    if (!clean) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/youtube/radar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "search", query: clean, maxResults: 30, order: "viewCount", relevanceLanguage: "en" }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || "The search failed");
      const list: WinningVideo[] = (data.videos || [])
        .filter((v: any) => v.url && v.thumbnailUrl)
        .map((v: any) => ({
          url: v.url,
          title: v.title,
          thumbnailUrl: v.thumbnailUrl,
          viewCount: Number(v.viewCount) || 0,
          multiplier: v.subscriberCount ? Number(v.viewCount) / Number(v.subscriberCount) : 0,
          channelTitle: v.channelTitle,
        }))
        .sort((a: WinningVideo, b: WinningVideo) => b.multiplier - a.multiplier || b.viewCount - a.viewCount)
        .slice(0, 12);
      setVideos(list);
      if (!list.length) setError("No videos found for that topic. Try broader words.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function pasteLink() {
    const id = youtubeId(link);
    if (!id) return setError("Paste a YouTube video link");
    setError("");
    onPick({ url: `https://www.youtube.com/watch?v=${id}`, title: "Pasted video", thumbnailUrl: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, viewCount: 0, multiplier: 0 });
    setLink("");
  }

  return (
    <div className="cvx-winners">
      <form
        className="cvx-winners-bar"
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
      >
        <label className="cvx-search">
          <Search size={15} aria-hidden="true" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Topic, e.g. backyard nostalgia" aria-label="Topic to search" />
        </label>
        <button type="submit" className="maker-outline" disabled={busy || !query.trim()}>
          {busy ? <Loader2 size={15} className="animate-spin" /> : <TrendingUp size={15} />} Find winners
        </button>
      </form>
      <div className="cvx-winners-bar">
        <label className="cvx-search">
          <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="Or paste a YouTube link" aria-label="YouTube link" />
        </label>
        <button type="button" className="maker-outline" disabled={!link.trim()} onClick={pasteLink}>
          Use this thumbnail
        </button>
      </div>
      {error ? <p className="cvx-error" role="alert">{error}</p> : null}
      {videos?.length ? (
        <>
          <p className="cvx-hint">Sorted by views per subscriber: the higher the multiple, the more the thumbnail outperformed its channel.</p>
          <div className="cvx-winner-grid" role="radiogroup" aria-label="Winning thumbnails">
            {videos.map((video) => {
              const on = picked === video.url;
              return (
                <button key={video.url} type="button" role="radio" aria-checked={on} className={`cvx-winner${on ? " is-on" : ""}`} onClick={() => onPick(video)}>
                  <span className="cvx-winner-thumb">
                    <img src={video.thumbnailUrl} alt="" loading="lazy" />
                    {video.multiplier >= 1 ? <b>{video.multiplier >= 10 ? Math.round(video.multiplier) : video.multiplier.toFixed(1)}×</b> : null}
                    {on ? <i aria-hidden="true"><Check size={14} /></i> : null}
                  </span>
                  <span className="cvx-winner-title">{video.title}</span>
                  <small>
                    {compact(video.viewCount)} views{video.channelTitle ? ` · ${video.channelTitle}` : ""}
                  </small>
                </button>
              );
            })}
          </div>
        </>
      ) : null}
    </div>
  );
}

// ---------- Overlays ----------
export type SceneOverlay = { id: string; kind: string; vars: Record<string, string>; start: number; seconds: number; manual?: boolean };
export const overlaySummary = (overlay: SceneOverlay) => {
  const v = overlay.vars || {};
  const lead = v.title || v.place || v.value || v.text || "";
  const name = OVERLAY_KINDS[overlay.kind as keyof typeof OVERLAY_KINDS]?.name || "Overlay";
  return lead ? `${name}: ${overlay.kind === "progress" ? `#${v.rank} ${lead}` : lead}` : name;
};

/** The HyperFrames overlay itself, looping over the scene's picture as it will appear on the footage. */
export function OverlayPreview({ kind, vars, look, aspect, background }: { kind: string; vars: Record<string, string>; look: string; aspect: string; background?: string }) {
  const [w, h] = aspect === "9:16" ? [1080, 1920] : aspect === "1:1" ? [1080, 1080] : [1920, 1080];
  const doc = useMemo(() => {
    const template = overlayTemplate(kind, { width: w, height: h, look })
      .replace(/url\(fonts\//g, "url(/fonts/captions/")
      .replace('<script src="gsap.min.js"></script>', `<script>window.__hyperframes={getVariables:function(){return ${JSON.stringify(vars).replace(/</g, "\\u003c")}}}</script><script src="/vendor/gsap.min.js"></script>`)
      .replace("html,body{margin:0;background:transparent}", `html,body{margin:0;overflow:hidden;background:#000 ${background ? `url(${JSON.stringify(background)}) center/cover` : ""}}#root{transform-origin:0 0}`);
    const seconds = OVERLAY_KINDS[kind as keyof typeof OVERLAY_KINDS]?.seconds || 3;
    return template.replace(
      'window.__timelines["root"]=tl;',
      `window.__timelines["root"]=tl;(function(){var r=document.getElementById("root");function fit(){var k=innerWidth/${w};r.style.transform="scale("+k+")";document.body.style.backgroundSize=(${w}*k)+"px "+(${h}*k)+"px"}fit();addEventListener("resize",fit);tl.progress(0.5);var t0=null;function loop(n){if(t0===null)t0=n;tl.seek(((n-t0)/1000)%(${seconds}+0.8));requestAnimationFrame(loop)}document.fonts.ready.then(function(){requestAnimationFrame(loop)})})();`,
    );
  }, [kind, vars, look, w, h, background]);
  return (
    <div className="cvx-preview" style={{ aspectRatio: `${w} / ${h}` }}>
      <iframe title="Overlay preview" srcDoc={doc} sandbox="allow-scripts allow-same-origin" />
    </div>
  );
}

const OVERLAY_FIELDS: Record<string, Array<[string, string, string]>> = {
  "lower-third": [["title", "Name", "Max Huber"], ["subtitle", "Who they are", "Aerospace physicist"]],
  location: [["place", "Place", "Monterey Bay"], ["detail", "Detail (optional)", "California, 1953"]],
  stamp: [["value", "Number or year", "$390"], ["label", "What it is", "for a two-ounce jar"]],
  keyword: [["text", "Words to punch", "Mineral oil"]],
  progress: [["rank", "Rank", "7"], ["total", "Out of", "10"], ["title", "Entry", "The backyard incinerator"]],
};

/** Add one overlay to a scene: kind, words, when it starts, previewed over the scene's picture. */
export function OverlayEditor({
  scene,
  look,
  aspect,
  countdown,
  onClose,
  onAdd,
}: {
  scene: { id: string; start: number; end: number; text?: string; asset?: string | null };
  look: string;
  aspect: string;
  countdown?: boolean;
  onClose: () => void;
  onAdd: (overlay: { kind: string; vars: Record<string, string>; at: number }) => void;
}) {
  const [kind, setKind] = useState("lower-third");
  const [vars, setVars] = useState<Record<string, string>>({});
  const [at, setAt] = useState(0.3);
  const valid = normalizeOverlay({ kind, vars });
  const length = Math.max(0.5, scene.end - scene.start);
  const preview = useMemo(() => ({ ...overlayExample(kind), ...(valid?.vars || {}) }), [kind, valid?.vars]);
  return (
    <Modal
      title="Add an overlay"
      wide
      onClose={onClose}
      footer={
        <>
          <button type="button" className="maker-outline" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="maker-primary" disabled={!valid} onClick={() => valid && onAdd({ kind: valid.kind, vars: valid.vars as Record<string, string>, at })}>
            Animate the overlay
          </button>
        </>
      }
    >
      <div className="cvx-editor">
        <div className="cvx-editor-form">
          <div className="cvx-kinds" role="radiogroup" aria-label="Overlay type">
            {Object.entries(OVERLAY_KINDS)
              .filter(([id, item]) => !("hidden" in item && item.hidden) && (countdown || id !== "progress"))
              .map(([id, item]) => (
                <button key={id} type="button" role="radio" aria-checked={kind === id} className={kind === id ? "is-on" : ""} onClick={() => { setKind(id); setVars({}); }}>
                  {item.name}
                </button>
              ))}
          </div>
          {scene.text ? <p className="cvx-narration">“{scene.text}”</p> : null}
          {OVERLAY_FIELDS[kind].map(([key, label, placeholder]) => (
            <label key={key} className="maker-field">
              {label}
              <input value={vars[key] || ""} placeholder={placeholder} inputMode={key === "rank" || key === "total" ? "numeric" : undefined} onChange={(e) => setVars((v) => ({ ...v, [key]: e.target.value }))} />
            </label>
          ))}
          <label className="maker-field">
            Starts {at.toFixed(1)}s into the scene
            <input type="range" min={0} max={Math.max(0, length - 0.5)} step={0.1} value={at} onChange={(e) => setAt(Number(e.target.value))} />
          </label>
        </div>
        <div className="cvx-editor-preview">
          <OverlayPreview kind={kind} vars={preview} look={look} aspect={aspect} background={scene.asset || ""} />
          <small>Plays over the footage for about {OVERLAY_KINDS[kind as keyof typeof OVERLAY_KINDS].seconds} seconds, in the video's look. It can run past the cut into the next scene.</small>
        </div>
      </div>
    </Modal>
  );
}
