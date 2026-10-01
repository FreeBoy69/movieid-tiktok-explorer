// Editable Design: a brief in, a fixed-canvas poster out as one HTML file with
// live text and independently movable layers (after yejy53/Editable-Design).
// The page composes the brief, previews the design scaled to fit, opens it in
// the bundled mouse editor, saves edits back, revises with a follow-up prompt,
// and exports a PNG rendered in the browser.
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Check, Download, FileCode2, Info, Layers, Loader2, PenLine, Save, Sparkles, Square, Trash2, Wand2, X } from "lucide-react";
import { domToPng } from "modern-screenshot";
import { type Asset, type Catalog, Choice, type Generation, ModelPicker, readJson, ReferenceTray, Segment, timeAgo } from "./studioShared";
import { CREDIT_ESTIMATE_TITLE, creditEstimateLabel, fallbackCreditEstimate, useStudioPricing } from "./studioPricing";
import { useErrorToast, toast } from "../../utils/toast";
import "./EditableDesign.css";

type Theme = "light" | "dark";
type CanvasId = "3:4" | "4:5" | "1:1" | "9:16" | "16:9" | "a4";
type Imagery = "auto" | "none" | "rich";
type Draft = { brief: string; canvas: CanvasId; direction: string; imagery: Imagery; uploads: Asset[]; model: string };
type Design = {
  title: string;
  canvas: { id: CanvasId; width: number; height: number };
  direction: string;
  summary: string;
  palette: Record<string, string>;
  fonts: { display: string; body: string };
  topology: string;
  layout: string;
  copy: string[];
  layers: string[];
  assets: Array<{ id: string; form: string; prompt?: string; label?: string; source: string; url: string; width?: number; height?: number }>;
  models?: Record<string, string>;
  edited?: string;
};
type Item = Generation & { design?: Design };

const DRAFT_KEY = "autoyt-editable-design-draft-v1";
const CANVASES: Array<{ id: CanvasId; label: string; hint: string; w: number; h: number }> = [
  { id: "3:4", label: "Poster", hint: "1200 × 1600", w: 3, h: 4 },
  { id: "4:5", label: "Portrait", hint: "1080 × 1350", w: 4, h: 5 },
  { id: "1:1", label: "Square", hint: "1200 × 1200", w: 1, h: 1 },
  { id: "9:16", label: "Story", hint: "1080 × 1920", w: 9, h: 16 },
  { id: "16:9", label: "Wide", hint: "1920 × 1080", w: 16, h: 9 },
  { id: "a4", label: "A4", hint: "1240 × 1754", w: 210, h: 297 },
];
const DIRECTIONS = ["auto", "editorial", "luxury", "brutalist", "playful", "technical", "retro", "minimal"];
const PREFERRED = ["google/gemini-3-pro-image", "bytedance-seed/seedream-4.5", "openai/gpt-image-2"];
const initialDraft = (): Draft => {
  const base: Draft = { brief: "", canvas: "3:4", direction: "auto", imagery: "auto", uploads: [], model: "" };
  try {
    return { ...base, ...JSON.parse(window.localStorage.getItem(DRAFT_KEY) || "{}") };
  } catch {
    return base;
  }
};
const htmlOf = (item: Item | undefined) => item?.outputs.find((o) => o.type.startsWith("text/html"));
const title = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// The bundled editor runtime, loaded once and inlined into the design when editing starts.
let runtimePromise: Promise<{ css: string; js: string }> | null = null;
const loadRuntime = () => {
  runtimePromise ||= Promise.all([fetch("/assets/editable-design/layer-editor.css"), fetch("/assets/editable-design/layer-editor.js")])
    .then(async ([css, js]) => {
      if (!css.ok || !js.ok) throw new Error("The editor runtime is missing");
      return { css: await css.text(), js: await js.text() };
    })
    .catch((error) => {
      runtimePromise = null;
      throw error;
    });
  return runtimePromise;
};
const withEditor = (html: string, runtime: { css: string; js: string }) =>
  html.replace(/<\/body>/i, `<style>${runtime.css}</style><script>${runtime.js}</script></body>`);

/** Renders a design's canvas to a PNG data URL in an offscreen frame, at twice the canvas size. */
async function renderPng(html: string, width: number, height: number): Promise<string> {
  const frame = document.createElement("iframe");
  frame.setAttribute("sandbox", "allow-same-origin");
  frame.style.cssText = `position:fixed;left:-${width + 100}px;top:0;width:${width}px;height:${height}px;border:0;opacity:0;pointer-events:none`;
  document.body.appendChild(frame);
  try {
    await new Promise<void>((resolve, reject) => {
      frame.onload = () => resolve();
      frame.onerror = () => reject(new Error("The design could not be loaded"));
      frame.srcdoc = html;
    });
    const doc = frame.contentDocument;
    const root = doc?.querySelector<HTMLElement>("[data-canvas-width]");
    if (!doc || !root) throw new Error("The design has no canvas to render");
    await (doc as any).fonts?.ready;
    await Promise.all([...doc.images].filter((img) => !img.complete).map((img) => new Promise((done) => { img.onload = img.onerror = () => done(null); })));
    return await domToPng(root, { width, height, scale: 2, backgroundColor: getComputedStyle(root).backgroundColor || "#fff" });
  } finally {
    frame.remove();
  }
}
function saveDataUrl(href: string, name: string) {
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}
const fileStem = (item: Item) => (item.design?.title || "design").replace(/[^\w\s-]+/g, "").trim().replace(/\s+/g, "-").toLowerCase() || "design";

export function EditableDesignStudio({ theme, catalog, generations, now, onCreated, onRefresh, onRemoved }: {
  theme: Theme;
  catalog: Catalog | null;
  generations: Generation[];
  now: number;
  onCreated: (item: Generation) => void;
  onRefresh: () => void;
  onRemoved: (id: string) => void;
}) {
  const [draft, setDraft] = useState<Draft>(initialDraft);
  const patch = useCallback((changes: Partial<Draft>) => setDraft((current) => ({ ...current, ...changes })), []);
  useEffect(() => {
    try {
      window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {}
  }, [draft]);
  const [error, setError] = useState("");
  useErrorToast(error, () => setError(""));
  const pricing = useStudioPricing();
  const [busy, setBusy] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [mode, setMode] = useState<"preview" | "edit">("preview");
  const [exploded, setExploded] = useState(false);
  const [editorDoc, setEditorDoc] = useState("");
  const [html, setHtml] = useState<Record<string, string>>({});
  const [revision, setRevision] = useState("");
  const [revising, setRevising] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const editorFrame = useRef<HTMLIFrameElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [stageWidth, setStageWidth] = useState(0);

  const designs = useMemo(() => (generations as Item[]).filter((item) => item.tab === "editable-design"), [generations]);
  const selected = designs.find((item) => item.id === selectedId) || designs[0];
  const design = selected?.design;
  const output = htmlOf(selected);
  const models = catalog?.image || [];
  const model = models.find((m) => m.id === draft.model);
  useEffect(() => {
    if (!models.length || model) return;
    patch({ model: (PREFERRED.map((id) => models.find((m) => m.id === id)).find(Boolean) || models[0]).id });
  }, [models, model, patch]);

  // Keep the selected design's HTML around; a save swaps in the new file.
  useEffect(() => {
    if (!output || html[output.file]) return;
    const controller = new AbortController();
    fetch(output.url, { credentials: "same-origin", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not load the design");
        const text = await response.text();
        if (!/<html[\s>]/i.test(text)) throw new Error("The design is not a valid document");
        setHtml((current) => ({ ...current, [output.file]: text }));
      })
      .catch((err) => !controller.signal.aborted && setError(err instanceof Error ? err.message : "Could not load the design"));
    return () => controller.abort();
  }, [output, html]);
  const current = output ? html[output.file] || "" : "";

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => setStageWidth(el.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  // Leaving a design, or a new file arriving, closes the editor.
  useEffect(() => {
    setMode("preview");
    setExploded(false);
    setEditorDoc("");
    setRevising(false);
  }, [selected?.id, output?.file]);

  const ready = !busy && draft.brief.trim().length > 0 && Boolean(model) && catalog?.configured !== false;
  const estimate = fallbackCreditEstimate("image", pricing, draft.imagery === "none" ? 0 : draft.imagery === "rich" ? 4 : 3);

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError("");
    try {
      const body = {
        tab: "editable-design",
        model: draft.model,
        prompt: draft.brief.trim(),
        settings: { canvas: draft.canvas, direction: draft.direction, imagery: draft.imagery, uploads: draft.uploads.map((u) => ({ file: u.file, label: u.name })) },
      };
      const data = await readJson(await fetch("/api/studio/generations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), "Could not start the design");
      onCreated(data.generation);
      setSelectedId(data.generation.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the design");
    } finally {
      setBusy(false);
    }
  }
  async function revise(event: FormEvent) {
    event.preventDefault();
    if (!selected?.kit?.file || !revision.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const body = {
        tab: "editable-design",
        model: selected.model || draft.model,
        prompt: revision.trim(),
        settings: { canvas: design?.canvas.id || draft.canvas, direction: selected.settings?.direction || "auto", imagery: selected.settings?.imagery || "auto", baseFile: selected.kit.file },
      };
      const data = await readJson(await fetch("/api/studio/generations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), "Could not start the revision");
      onCreated(data.generation);
      setSelectedId(data.generation.id);
      setRevision("");
      setRevising(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the revision");
    } finally {
      setBusy(false);
    }
  }
  async function openEditor() {
    if (!current) return;
    try {
      setEditorDoc(withEditor(current, await loadRuntime()));
      setExploded(false);
      setMode("edit");
    } catch (err) {
      setError(err instanceof Error ? err.message : "The editor could not open");
    }
  }
  const editorApi = () => (editorFrame.current?.contentWindow as any)?.__layerEditor;
  function toggleExplode() {
    const api = editorApi();
    if (!api) return;
    api.setExploded(!exploded);
    setExploded(!exploded);
  }
  async function saveEdits() {
    const api = editorApi();
    if (!api || !selected || !output) return;
    setSaving(true);
    try {
      if (exploded) {
        api.setExploded(false);
        setExploded(false);
      }
      const edited = String(api.fullHTML());
      const data = await readJson(await fetch(`/api/studio/generations/${encodeURIComponent(selected.id)}/design`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ html: edited }) }), "Could not save the edits");
      setHtml((prev) => ({ ...prev, [data.output.file]: edited }));
      onRefresh();
      toast.success("Edits saved. Revisions now start from this version.");
      setMode("preview");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the edits");
    } finally {
      setSaving(false);
    }
  }
  async function exportPng() {
    if (!selected || !design) return;
    setExporting(true);
    try {
      const source = mode === "edit" && editorApi() ? String(editorApi().fullHTML()) : current;
      if (!source) throw new Error("The design hasn't loaded yet");
      saveDataUrl(await renderPng(source, design.canvas.width, design.canvas.height), `${fileStem(selected)}.png`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "PNG export failed");
    } finally {
      setExporting(false);
    }
  }
  function downloadHtml() {
    if (!selected || !output) return;
    const source = mode === "edit" && editorApi() ? String(editorApi().fullHTML()) : current;
    if (source) saveDataUrl(URL.createObjectURL(new Blob([source], { type: "text/html" })), `${fileStem(selected)}.html`);
    else saveDataUrl(`${output.url}?download=1`, `${fileStem(selected)}.html`);
  }
  async function stop(item: Item) {
    await fetch(`/api/studio/generations/${encodeURIComponent(item.id)}/stop`, { method: "POST" }).catch(() => undefined);
    onRefresh();
  }
  async function remove(item: Item) {
    if (!window.confirm("Delete this design and its files?")) return;
    onRemoved(item.id);
    if (item.id === selected?.id) setSelectedId("");
    await fetch(`/api/studio/generations/${encodeURIComponent(item.id)}`, { method: "DELETE" }).catch(() => undefined);
  }

  // Scale the canvas to the stage: full width on phones, up to 760px tall on desktop.
  const canvas = design?.canvas || { width: 1200, height: 1600, id: draft.canvas };
  const scale = stageWidth ? Math.min(stageWidth / canvas.width, 760 / canvas.height, 1) : 0;
  const active = selected && (selected.status === "queued" || selected.status === "running");

  return (
    <div className="eds" data-theme={theme}>
      <form className="eds-composer" onSubmit={(event) => void submit(event)}>
        <div className="eds-head">
          <h1>Editable Design</h1>
          <p>Posters, covers, menus, and campaign visuals as real HTML: live text, independent layers, a mouse editor.</p>
        </div>
        <label className="eds-field">
          <span className="eds-label">The brief</span>
          <textarea
            className="eds-textarea"
            value={draft.brief}
            maxLength={4000}
            rows={6}
            placeholder={"e.g. A 3:4 launch poster for Shanchuan Tea's cold-brew series in dark green, off-white, and gold. Hero: a cold-brew tea with leaves, citrus, and ice. Display exactly: \"Cold Brew Series\", \"New this summer\", \"Medium 16 · Large 19\", \"Second cup half price\", \"April 20 to May 10\". Fine print: \"Images are for reference only.\""}
            onChange={(event) => patch({ brief: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && ready) void submit();
            }}
          />
          <small className="eds-note">Facts you give (names, prices, dates, places) are kept word for word and set as live text, never painted into an image.</small>
        </label>
        <div className="eds-field">
          <span className="eds-label">Canvas</span>
          <div className="eds-canvases" role="radiogroup" aria-label="Canvas">
            {CANVASES.map((option) => (
              <button key={option.id} type="button" role="radio" aria-checked={draft.canvas === option.id} className="eds-canvas" onClick={() => patch({ canvas: option.id })}>
                <span className="eds-canvas-glyph" style={{ aspectRatio: `${option.w} / ${option.h}` }} aria-hidden="true" />
                <strong>{option.label}</strong>
                <span>{option.hint}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="eds-field">
          <span className="eds-label">Artwork</span>
          <Segment<Imagery> label="Artwork" value={draft.imagery} options={[{ value: "none", label: "Type only" }, { value: "auto", label: "As needed" }, { value: "rich", label: "Rich" }]} onChange={(imagery) => patch({ imagery })} />
          <small className="eds-note">{draft.imagery === "none" ? "Type, colour, and geometry carry the design." : draft.imagery === "rich" ? "Up to four generated pieces of artwork." : "Artwork only where photography or illustration carries the design."}</small>
        </div>
        <div className="eds-field">
          <span className="eds-label">Your images <small>optional · logo, product, portrait</small></span>
          <ReferenceTray assets={draft.uploads} max={6} onChange={(uploads) => patch({ uploads })} onError={setError} />
        </div>
        <div className="eds-row">
          <Choice label="Direction" value={draft.direction} options={DIRECTIONS.map((d) => ({ value: d, label: d === "auto" ? "Auto" : title(d) }))} onChange={(direction) => patch({ direction })} />
          <ModelPicker models={models} value={draft.model} onChange={(id) => patch({ model: id })} loading={!catalog} pricing={pricing} />
          {estimate !== null ? <span className="cs-cost" title={CREDIT_ESTIMATE_TITLE}>{creditEstimateLabel(estimate)}</span> : null}
        </div>
        {catalog && !catalog.configured ? <p className="eds-error" role="alert"><AlertCircle size={16} />Generation isn't set up on this server yet.</p> : null}
        <button type="submit" className="eds-primary" disabled={!ready}>
          {busy ? <Loader2 size={16} className="animate-spin" /> : <Wand2 size={16} />}
          Design it
        </button>
        <small className="eds-note">About two to four minutes: the plan, the artwork, then the layout.</small>
      </form>

      <section className="eds-work" aria-label="Designs">
        <div className="eds-stage-card">
          <header className="eds-toolbar">
            <div className="eds-toolbar-title">
              <strong>{design?.title || (selected ? "Designing…" : "No design yet")}</strong>
              {design ? <span className="eds-meta">{design.canvas.width} × {design.canvas.height} · {title(design.direction)} · {design.layers.length} layers{design.edited ? " · edited" : ""}</span> : null}
            </div>
            {selected?.status === "done" && output ? (
              <div className="eds-actions">
                {mode === "preview" ? (
                  <button type="button" className="eds-btn" onClick={() => void openEditor()} disabled={!current}><PenLine size={15} />Edit layers</button>
                ) : (
                  <>
                    <button type="button" className="eds-btn" aria-pressed={exploded} onClick={toggleExplode}><Layers size={15} />{exploded ? "Collapse" : "Explode layers"}</button>
                    <button type="button" className="eds-btn eds-btn-accent" onClick={() => void saveEdits()} disabled={saving}>{saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}Save edits</button>
                    <button type="button" className="eds-btn" onClick={() => { setMode("preview"); setExploded(false); }}><X size={15} />Done</button>
                  </>
                )}
                <button type="button" className="eds-btn" aria-pressed={revising} onClick={() => setRevising((v) => !v)} disabled={!selected.kit}><Sparkles size={15} />Revise</button>
                <button type="button" className="eds-btn" onClick={() => void exportPng()} disabled={exporting || !current}>{exporting ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}PNG</button>
                <button type="button" className="eds-btn" onClick={downloadHtml}><FileCode2 size={15} />HTML</button>
                <button type="button" className="eds-btn" aria-pressed={sheet} onClick={() => setSheet((v) => !v)} aria-label="How it was made" title="How it was made"><Info size={15} /></button>
              </div>
            ) : null}
          </header>
          {revising && selected?.status === "done" ? (
            <form className="eds-revise" onSubmit={(event) => void revise(event)}>
              <input className="eds-input" value={revision} maxLength={2000} placeholder="What should change? e.g. make the headline bigger and move the price to the bottom right" onChange={(event) => setRevision(event.target.value)} autoFocus />
              <button type="submit" className="eds-primary eds-primary-inline" disabled={!revision.trim() || busy}>{busy ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}Revise</button>
            </form>
          ) : null}
          <div ref={stageRef} className="eds-stage" data-mode={mode}>
            {!selected ? (
              <div className="eds-empty">
                <span className="eds-empty-mark"><Layers size={22} /></span>
                <h2>Design a poster you can still edit</h2>
                <p>Describe it on the left. The design is planned, its artwork painted, and the layout written as live text and movable layers. Open the editor to drag, resize, and retype anything, then export the PNG.</p>
              </div>
            ) : active ? (
              <div className="eds-progress" role="status" aria-live="polite">
                <Loader2 size={20} className="animate-spin" />
                <strong>{selected.message || (selected.status === "queued" ? "Queued" : "Working")}</strong>
                <span className="eds-meta">{selected.prompt.slice(0, 120)}</span>
                <button type="button" className="eds-btn" onClick={() => void stop(selected)}><Square size={14} />Stop</button>
              </div>
            ) : selected.status !== "done" ? (
              <div className="eds-progress">
                <AlertCircle size={20} />
                <strong>{selected.status === "cancelled" ? "Stopped" : "This design failed"}</strong>
                <span className="eds-meta">{selected.error || selected.prompt.slice(0, 120)}</span>
              </div>
            ) : mode === "edit" && editorDoc ? (
              <iframe ref={editorFrame} className="eds-editor" srcDoc={editorDoc} sandbox="allow-same-origin allow-scripts allow-downloads allow-modals" title={`Edit ${design?.title || "design"}`} />
            ) : current && scale ? (
              <div className="eds-frame" style={{ width: Math.round(canvas.width * scale), height: Math.round(canvas.height * scale) }}>
                <iframe className="eds-preview" srcDoc={current} sandbox="allow-same-origin" title={design?.title || "Design"} style={{ width: canvas.width, height: canvas.height, transform: `scale(${scale})` }} tabIndex={-1} />
              </div>
            ) : (
              <div className="eds-progress"><Loader2 size={20} className="animate-spin" /><strong>Loading the design</strong></div>
            )}
          </div>
          {mode === "edit" ? <p className="eds-hint">Click to select and drag · green handles resize · double-click to retype · ⌘Z undo. Save edits to keep them; revisions then start from your edited version.</p> : null}
        </div>

        {designs.length ? (
          <ul className="eds-history" aria-label="Your designs">
            {designs.map((item) => {
              const d = item.design;
              return (
                <li key={item.id}>
                  <button type="button" className="eds-item" aria-current={item.id === selected?.id ? "true" : undefined} onClick={() => setSelectedId(item.id)}>
                    <span className="eds-item-glyph" data-status={item.status} style={{ aspectRatio: d ? `${d.canvas.width} / ${d.canvas.height}` : CANVASES.find((c) => c.id === item.settings?.canvas) ? `${CANVASES.find((c) => c.id === item.settings?.canvas)!.w} / ${CANVASES.find((c) => c.id === item.settings?.canvas)!.h}` : "3 / 4", background: d ? `linear-gradient(135deg, ${d.palette.field}, ${d.palette.accent})` : undefined }}>
                      {item.status === "queued" || item.status === "running" ? <Loader2 size={14} className="animate-spin" /> : item.status === "done" ? <Check size={14} /> : <AlertCircle size={14} />}
                    </span>
                    <span className="eds-item-text">
                      <strong>{d?.title || item.prompt.slice(0, 60)}</strong>
                      <span className="eds-meta">{item.settings?.baseFile ? "Revision · " : ""}{timeAgo(item.createdAt, now)}</span>
                    </span>
                  </button>
                  <button type="button" className="eds-icon" aria-label="Delete design" onClick={() => void remove(item)}><Trash2 size={14} /></button>
                </li>
              );
            })}
          </ul>
        ) : null}
      </section>

      {sheet && design ? (
        <aside className="eds-sheet" aria-label="How it was made">
          <header>
            <h2>How it was made</h2>
            <button type="button" className="eds-icon" aria-label="Close" onClick={() => setSheet(false)}><X size={16} /></button>
          </header>
          <div className="eds-sheet-body">
            <section>
              <h3>Brief</h3>
              <p>{selected?.settings?.baseFile ? `Revision: ${selected.prompt}` : selected?.prompt}</p>
            </section>
            {design.summary ? (
              <section>
                <h3>Direction</h3>
                <p>{design.summary}</p>
                <dl className="eds-facts">
                  <div><dt>Canvas</dt><dd>{design.canvas.width} × {design.canvas.height}</dd></div>
                  <div><dt>Topology</dt><dd>{design.topology.replace("-", " ")}</dd></div>
                  <div><dt>Display type</dt><dd>{design.fonts.display}</dd></div>
                  <div><dt>Body type</dt><dd>{design.fonts.body}</dd></div>
                </dl>
                <div className="eds-swatches" aria-label="Palette">
                  {Object.entries(design.palette).map(([role, hex]) => (
                    <span key={role} className="eds-swatch" title={`${role} ${hex}`}><i style={{ background: hex }} />{role}</span>
                  ))}
                </div>
              </section>
            ) : null}
            {design.layout ? <section><h3>Layout</h3><p>{design.layout}</p></section> : null}
            {design.assets.length ? (
              <section>
                <h3>Artwork</h3>
                <ul className="eds-assets">
                  {design.assets.map((asset) => (
                    <li key={asset.id}>
                      <img src={asset.url} alt="" loading="lazy" />
                      <div>
                        <strong>{asset.id}</strong>
                        <span className="eds-meta">{asset.source === "upload" ? asset.label || "your image" : asset.form}{asset.width ? ` · ${asset.width} × ${asset.height}` : ""}</span>
                        {asset.prompt ? <p>{asset.prompt}</p> : null}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
            <section>
              <h3>Layers <span className="eds-meta">{design.layers.length}</span></h3>
              <div className="eds-chips">{design.layers.map((layer) => <span key={layer} className="eds-chip">{layer}</span>)}</div>
            </section>
            {design.copy.length ? (
              <section>
                <h3>Live text</h3>
                <ul className="eds-copy">{design.copy.map((line, index) => <li key={`${index}-${line}`}>{line}</li>)}</ul>
              </section>
            ) : null}
            {design.models ? <p className="eds-meta">Planned and written by {design.models.writer || design.models.planner}; artwork by {design.models.image}.</p> : null}
          </div>
        </aside>
      ) : null}
    </div>
  );
}
