// Tools that run on the studio runners: the image edits split out of Layers
// Studio, the Thumbnail Maker, and the Video Upscaler. One uploaded file, a
// few choices, one button; results land in the stage as they finish.
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Wand2 } from "lucide-react";
import { useErrorToast } from "../../utils/toast";
import type { Catalog, AnyModel, Asset, Generation } from "../studio/studioShared";
import { AspectPicker, Choice, Empty, GenerationUnavailable, IMAGE_TYPES, LinkImport, MediaSlot, ModelPicker, OptionCards, readJson, ReferenceTray, StudioNotice, VIDEO_TYPES, fit, useDeleteGeneration } from "../studio/studioShared";
import { type GalleryHandlers, StudioGallery } from "../studio/StudioGallery";
import { CREDIT_ESTIMATE_TITLE, creditEstimateLabel, fallbackCreditEstimate, useStudioPricing } from "../studio/studioPricing";
import { readDrafts, sendAsset, TOOL_DRAFTS_KEY, writeDrafts } from "./toolHandoff";
import { toolEntry, type ToolDef } from "./toolApps";
import { ToolLayout } from "./ToolPage";

type Draft = {
  image?: Asset;
  /** Thumbnail maker only: example thumbnails whose layout and style the result follows. */
  references?: Asset[];
  sourceVideo?: Asset;
  prompt: string;
  operation: string;
  aspectRatio: string;
  model: string;
  title: string;
  upscaleFactor: number;
};
const MAX_THUMB_REFS = 3;
const PREFERRED_IMAGE = ["google/gemini-3-pro-image", "bytedance-seed/seedream-4.5", "openai/gpt-image-2"];
// Layers Studio history shows up in the tool that now owns that operation.
const LEGACY_TAB = "layers";

export function StudioTool({ tool }: { tool: ToolDef }) {
  const entry = toolEntry(tool.id);
  const defaultOp = tool.operations?.[0]?.value || "";
  const [draft, setDraft] = useState<Draft>(() => ({ prompt: "", operation: defaultOp, aspectRatio: tool.kind === "thumbnail" ? "16:9" : "", model: "", title: "", upscaleFactor: 2, ...(readDrafts(TOOL_DRAFTS_KEY)[tool.id] || {}) }));
  const patch = useCallback((changes: Partial<Draft>) => setDraft((current) => ({ ...current, ...changes })), []);
  useEffect(() => {
    const drafts = readDrafts(TOOL_DRAFTS_KEY);
    drafts[tool.id] = draft;
    writeDrafts(TOOL_DRAFTS_KEY, drafts);
  }, [draft, tool.id]);

  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [catalogError, setCatalogError] = useState("");
  const [generations, setGenerations] = useState<Generation[]>([]);
  const [now, setNow] = useState(Date.now());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  useErrorToast(error, () => setError(""));
  const pricing = useStudioPricing();
  const deleteResult = useDeleteGeneration(useCallback((id: string) => setGenerations((current) => current.filter((g) => g.id !== id)), []), "result");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/studio/catalog")
      .then((response) => readJson(response, "Models are unavailable right now"))
      .then((data) => !cancelled && setCatalog(data))
      .catch((err) => !cancelled && setCatalogError(err instanceof Error ? err.message : "Models are unavailable right now"));
    return () => {
      cancelled = true;
    };
  }, []);
  const refresh = useCallback(async () => {
    try {
      const data = await readJson(await fetch("/api/studio/generations", { cache: "no-store" }), "History unavailable");
      setGenerations(Array.isArray(data.generations) ? data.generations : []);
    } catch {}
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const ops = useMemo(() => new Set((tool.operations || []).map((o) => o.value)), [tool.operations]);
  const mine = useMemo(
    () => generations.filter((item) => item.tab === tool.id || (tool.kind === "image" && item.tab === LEGACY_TAB && ops.has(String(item.settings?.operation)))),
    [generations, tool.id, tool.kind, ops],
  );
  const active = mine.some((item) => item.status === "queued" || item.status === "running");
  useEffect(() => {
    if (!active) return;
    const poll = window.setInterval(() => void refresh(), 4000);
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      window.clearInterval(poll);
      window.clearInterval(tick);
    };
  }, [active, refresh]);

  const models: AnyModel[] = useMemo(() => {
    if (!catalog) return [];
    if (tool.kind === "video-upscale") return catalog.upscale;
    if (tool.kind === "stems") return [];
    if (tool.kind === "thumbnail") return draft.image || draft.references?.length ? catalog.image.filter((m) => m.maxReferences > 0) : catalog.image;
    return catalog.image.filter((m) => m.maxReferences > 0);
  }, [catalog, tool.kind, draft.image, draft.references?.length]);
  const model = models.find((m) => m.id === draft.model);
  // Keep the model and aspect ratio inside what's available.
  const chosenId = useRef("");
  useEffect(() => {
    if (!models.length || tool.kind === "stems") return;
    const chosen = model || PREFERRED_IMAGE.map((id) => models.find((m) => m.id === id)).find(Boolean) || models[0];
    const next: Partial<Draft> = {};
    if (chosen.id !== draft.model) next.model = chosen.id;
    if (tool.aspect) {
      const aspect = fit(draft.aspectRatio, chosen.aspectRatios.filter((a) => a !== "auto"), ["16:9", "9:16", "1:1"]);
      if (aspect && aspect !== draft.aspectRatio) next.aspectRatio = aspect;
    }
    if (Object.keys(next).length && chosenId.current !== JSON.stringify(next)) {
      chosenId.current = JSON.stringify(next);
      patch(next);
    }
  }, [models, model, draft.model, draft.aspectRatio, tool.aspect, patch]);

  const needsPrompt = Boolean(tool.prompt?.required) || (tool.kind === "image" && ["relight", "restyle", "cleanup", "edit"].includes(draft.operation));
  const ready = (() => {
    if (tool.kind === "stems") return !submitting && Boolean(draft.sourceVideo);
    if (submitting || !model) return false;
    if (tool.kind === "video-upscale") return Boolean(draft.sourceVideo);
    if (tool.kind === "thumbnail") return Boolean(draft.prompt.trim() || draft.title.trim());
    if (!draft.image) return false;
    return !needsPrompt || Boolean(draft.prompt.trim());
  })();
  const estimate = tool.kind === "video-upscale" || tool.kind === "stems" ? null : fallbackCreditEstimate("image", pricing, tool.kind === "image" && draft.operation === "decompose" ? 2 : 1);

  async function submit(event?: FormEvent, retry?: Generation) {
    event?.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const body = retry
        ? { tab: retry.tab === LEGACY_TAB ? tool.id : retry.tab, model: retry.model, prompt: retry.prompt, settings: retry.settings }
        : {
            tab: tool.id,
            model: tool.kind === "stems" ? "" : draft.model,
            prompt: draft.prompt,
            settings: {
              image: draft.image?.file,
              references: tool.kind === "thumbnail" ? (draft.references || []).map((ref) => ref.file) : undefined,
              sourceVideo: draft.sourceVideo?.file,
              operation: tool.kind === "image" ? draft.operation : undefined,
              thumbStyle: tool.kind === "thumbnail" ? draft.operation : undefined,
              title: tool.kind === "thumbnail" ? draft.title : undefined,
              aspectRatio: tool.kind === "thumbnail" ? "16:9" : tool.aspect ? draft.aspectRatio : undefined,
              upscaleFactor: tool.kind === "video-upscale" ? draft.upscaleFactor : undefined,
              count: 1,
            },
          };
      const data = await readJson(
        await fetch("/api/studio/generations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
        "Could not start",
      );
      setGenerations((current) => [data.generation, ...current.filter((g) => g.id !== data.generation.id)]);
      setNow(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start");
    } finally {
      setSubmitting(false);
    }
  }

  const handlers: GalleryHandlers = {
    modelName: (item) => tool.kind === "stems" ? String((item as { engine?: string }).engine || "Vocal Remover") : models.find((m) => m.id === item.model)?.name || [...(catalog?.image || []), ...(catalog?.upscale || [])].find((m) => m.id === item.model)?.name || item.model.split("/").pop() || "Model",
    onStop: (item) => void fetch(`/api/studio/generations/${encodeURIComponent(item.id)}/stop`, { method: "POST" }).then(() => refresh()),
    onRetry: (item) => void submit(undefined, item),
    onReuse: (item) => patch({ prompt: item.prompt, ...(item.settings?.operation && ops.has(item.settings.operation) ? { operation: item.settings.operation } : {}), ...(item.settings?.title ? { title: item.settings.title } : {}) }),
    onDelete: (item) => void deleteResult(item),
    onSend: (target, field, asset) => sendAsset(String(target), field, asset),
    onRevise: () => undefined,
  };

  const panel = (
    <form className="mt-panel-form" onSubmit={(event) => void submit(event)} style={{ display: "contents" }}>
      {tool.kind === "video-upscale" || tool.kind === "stems" ? (
        <div className="mt-field">
          <MediaSlot label={tool.kind === "stems" ? "Video to split" : "Video to upscale"} accept={VIDEO_TYPES} asset={draft.sourceVideo} onChange={(sourceVideo) => patch({ sourceVideo })} onError={setError} />
          {!draft.sourceVideo ? <LinkImport kind="video" onImport={(sourceVideo) => patch({ sourceVideo })} onError={setError} /> : null}
        </div>
      ) : (
        <div className="mt-field">
          <MediaSlot label={tool.kind === "thumbnail" ? "Face or product photo (optional)" : "Image to edit"} accept={IMAGE_TYPES} asset={draft.image} onChange={(image) => patch({ image })} onError={setError} />
          {!draft.image ? <LinkImport kind="image" onImport={(image) => patch({ image })} onError={setError} /> : null}
        </div>
      )}
      {tool.kind === "thumbnail" ? (
        <div className="mt-field">
          <span className="mt-label">Reference thumbnails <small>optional · up to {MAX_THUMB_REFS}</small></span>
          <ReferenceTray assets={draft.references || []} max={MAX_THUMB_REFS} onChange={(references) => patch({ references })} onError={setError} />
          <p className="mt-note">Upload a thumbnail you like, or paste a YouTube video link to use its thumbnail. Yours follows its layout, colors, and style without copying it.</p>
        </div>
      ) : null}
      {tool.operations && tool.operations.length > 1 ? (
        <div className="mt-field">
          <span className="mt-label">{tool.kind === "thumbnail" ? "Style" : "Edit"}</span>
          <OptionCards label={tool.kind === "thumbnail" ? "Style" : "Edit"} options={tool.operations} value={draft.operation} onChange={(operation) => patch({ operation })} />
        </div>
      ) : null}
      {tool.kind === "thumbnail" ? (
        <label className="mt-field">
          <span className="mt-label">Title on the image <small>{draft.title.length}/80</small></span>
          <input className="ui-input" value={draft.title} maxLength={80} onChange={(event) => patch({ title: event.target.value })} placeholder="e.g. I QUIT" />
        </label>
      ) : null}
      {tool.prompt ? (
        <label className="mt-field">
          <span className="mt-label">{tool.prompt.label}{needsPrompt && !tool.prompt.required ? <small>Required for this edit</small> : null}</span>
          <textarea
            className="ui-textarea mt-textarea"
            value={draft.prompt}
            maxLength={2000}
            rows={3}
            placeholder={tool.prompt.placeholder}
            onChange={(event) => patch({ prompt: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && ready) void submit();
            }}
          />
        </label>
      ) : null}
      {tool.kind === "stems" ? null : <div className="mt-row">
        <ModelPicker models={models} value={draft.model} onChange={(id) => patch({ model: id })} loading={!catalog && !catalogError} pricing={pricing} />
        {tool.aspect && model ? <AspectPicker variant="chip" label="Aspect" value={draft.aspectRatio} options={model.aspectRatios.filter((a) => a !== "auto")} onChange={(aspectRatio) => patch({ aspectRatio })} /> : null}
        {tool.kind === "video-upscale" ? <Choice label="Scale" value={String(draft.upscaleFactor)} options={[{ value: "1.5", label: "1.5×" }, { value: "2", label: "2×" }, { value: "3", label: "3×" }]} onChange={(upscaleFactor) => patch({ upscaleFactor: Number(upscaleFactor) })} /> : null}
        {estimate !== null && model ? <span className="cs-cost" title={CREDIT_ESTIMATE_TITLE}>{creditEstimateLabel(estimate)}</span> : null}
      </div>}
      {catalogError ? <StudioNotice tone="error">{catalogError}</StudioNotice> : null}
      {catalog && !catalog.configured && tool.kind !== "stems" ? <GenerationUnavailable /> : null}
      {catalog && catalog.configured && !models.length && tool.kind !== "stems" ? <StudioNotice>No model can run this tool right now.</StudioNotice> : null}
      <button type="submit" className="ui-btn is-primary is-lg is-block mt-primary" disabled={!ready}>
        {submitting ? <Loader2 size={16} className="animate-spin" /> : <Wand2 size={16} />}
        {tool.action}
      </button>
      {tool.kind === "image" && draft.operation === "decompose" ? <p className="mt-note">Two images come back: the subject on white and the background without it.</p> : null}
      {tool.kind === "stems" ? <p className="mt-note">Runs on our servers at no credit cost. Only split audio you own or have permission to edit.</p> : null}
      {tool.kind === "thumbnail" ? <p className="mt-note">Text in images is rendered by the model. Check the spelling before you upload it.</p> : null}
    </form>
  );

  return (
    <ToolLayout panel={panel}>
      <div className="mt-stage-head">
        <h2>Results</h2>
        <span className="mt-meta">{mine.length ? `${mine.length} ${mine.length === 1 ? "result" : "results"}` : "Nothing yet"}</span>
      </div>
      <div className="mt-stage-inner">
        {mine.length ? <StudioGallery items={mine} now={now} handlers={handlers} /> : <Empty icon={entry?.icon} heading={tool.heading} body={tool.body} />}
      </div>
    </ToolLayout>
  );
}
