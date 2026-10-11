// Tools that run on the studio runners: the image edits split out of Layers
// Studio, the Thumbnail Maker, the Video Upscaler, the Vocal Remover, Watch a
// Video, and Ranking Video. One uploaded file (or link), a few choices, one button;
// results land in the stage as they finish.
import { FormEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, Download, ExternalLink, Loader2, Repeat, Wand2 } from "lucide-react";
import { useErrorToast } from "../../utils/toast";
import type { Catalog, AnyModel, Asset, Generation } from "../studio/studioShared";
import { AspectPicker, Choice, Empty, GenerationUnavailable, IMAGE_TYPES, LinkImport, MediaSlot, ModelPicker, OptionCards, readJson, ReferenceTray, StudioNotice, Toggle, VIDEO_TYPES, fit, useDeleteGeneration } from "../studio/studioShared";
import { CAPTION_STYLES } from "../../utils/captionStyles.js";
import { type GalleryHandlers, StudioGallery } from "../studio/StudioGallery";
import { CREDIT_ESTIMATE_TITLE, creditEstimateLabel, fallbackCreditEstimate, useStudioPricing } from "../studio/studioPricing";
import { readDrafts, sendAsset, TOOL_DRAFTS_KEY, writeDrafts } from "./toolHandoff";
import { toolEntry, type ToolDef } from "./toolApps";
import { clearPendingTemplate, peekPendingTemplate } from "../../utils/promptTemplates";
import { ToolLayout } from "./ToolPage";

type Draft = {
  image?: Asset;
  /** Thumbnail maker only: example thumbnails whose layout and style the result follows. */
  references?: Asset[];
  sourceVideo?: Asset;
  /** Watch a Video: the link to watch when nothing is uploaded. */
  sourceUrl?: string;
  prompt: string;
  operation: string;
  aspectRatio: string;
  model: string;
  title: string;
  upscaleFactor: number;
  /** Ranking Video: the countdown's settings. */
  ranking?: RankingDraft;
};
type RankingDraft = { template: "countdown" | "reaction-loop"; count: number; language: string; voiceId: string; captions: boolean; captionStyle: string; music: boolean; reactionPrompt: string };
const RANKING_DEFAULTS: RankingDraft = { template: "countdown", count: 5, language: "English", voiceId: "", captions: true, captionStyle: "hormozi", music: false, reactionPrompt: "" };
const RANKING_LANGUAGES = ["English", "Spanish", "Portuguese", "French", "German", "Italian", "Hindi", "Arabic", "Japanese", "Korean", "Indonesian", "Turkish", "Russian"];
const RANKING_TEMPLATES = [
  { value: "countdown", label: "Countdown", hint: "#5 to #1 with a spoken hook and a rank list, 20-25 s" },
  { value: "reaction-loop", label: "Reaction loop", hint: "A fail, an AI reaction, the payoff, the reaction again, about 7 s" },
];
const MAX_THUMB_REFS = 3;
const PREFERRED_IMAGE = ["google/gemini-3-pro-image", "bytedance-seed/seedream-4.5", "openai/gpt-image-2"];
// Layers Studio history shows up in the tool that now owns that operation.
const LEGACY_TAB = "layers";

export function StudioTool({ tool }: { tool: ToolDef }) {
  const entry = toolEntry(tool.id);
  // Server-side tools with no model to pick.
  const noModel = tool.kind === "stems" || tool.kind === "watch" || tool.kind === "ranking";
  const defaultOp = tool.operations?.[0]?.value || "";
  const [draft, setDraft] = useState<Draft>(() => {
    const saved: Draft = { prompt: "", operation: defaultOp, aspectRatio: tool.kind === "thumbnail" ? "16:9" : "", model: "", title: "", upscaleFactor: 2, ...(readDrafts(TOOL_DRAFTS_KEY)[tool.id] || {}) };
    // A Ranking Video card on the Create page brings its format and the words typed there.
    const pending = tool.kind === "ranking" ? peekPendingTemplate("ranking") : null;
    if (!pending) return saved;
    const template = pending.templateId === "reaction-loop" ? "reaction-loop" : "countdown";
    return { ...saved, prompt: pending.prompt || saved.prompt, ranking: { ...RANKING_DEFAULTS, ...(saved.ranking || {}), template } };
  });
  useEffect(() => {
    if (tool.kind === "ranking") clearPendingTemplate("ranking");
  }, [tool.kind]);
  const patch = useCallback((changes: Partial<Draft>) => setDraft((current) => ({ ...current, ...changes })), []);
  const ranking = { ...RANKING_DEFAULTS, ...(draft.ranking || {}) };
  const patchRanking = (changes: Partial<RankingDraft>) => patch({ ranking: { ...ranking, ...changes } });
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
    if (noModel) return [];
    if (tool.kind === "thumbnail") return draft.image || draft.references?.length ? catalog.image.filter((m) => m.maxReferences > 0) : catalog.image;
    return catalog.image.filter((m) => m.maxReferences > 0);
  }, [catalog, tool.kind, noModel, draft.image, draft.references?.length]);
  const model = models.find((m) => m.id === draft.model);
  // Keep the model and aspect ratio inside what's available.
  const chosenId = useRef("");
  useEffect(() => {
    if (!models.length || noModel) return;
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
  }, [models, model, noModel, draft.model, draft.aspectRatio, tool.aspect, patch]);

  const watchLink = (draft.sourceUrl || "").trim();
  const watchLinkOk = /^(https?:\/\/)?[^\s/]+\.[^\s]{2,}/i.test(watchLink);
  const needsPrompt = Boolean(tool.prompt?.required) || (tool.kind === "image" && ["relight", "restyle", "cleanup", "edit"].includes(draft.operation));
  const ready = (() => {
    if (tool.kind === "stems") return !submitting && Boolean(draft.sourceVideo);
    if (tool.kind === "watch") return !submitting && (Boolean(draft.sourceVideo) || watchLinkOk);
    if (tool.kind === "ranking") return !submitting;
    if (submitting || !model) return false;
    if (tool.kind === "video-upscale") return Boolean(draft.sourceVideo);
    if (tool.kind === "thumbnail") return Boolean(draft.prompt.trim() || draft.title.trim());
    if (!draft.image) return false;
    return !needsPrompt || Boolean(draft.prompt.trim());
  })();
  const estimate = tool.kind === "video-upscale" || noModel ? null : fallbackCreditEstimate("image", pricing, tool.kind === "image" && draft.operation === "decompose" ? 2 : 1);

  async function submit(event?: FormEvent, retry?: Generation, swap?: { rank: number; id: string }) {
    event?.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const body = retry && swap
        ? // A swap re-renders the finished video from its saved plan with one clip changed.
          { tab: retry.tab, model: "", prompt: retry.prompt, settings: { ...retry.settings, planId: retry.id, picks: { [swap.rank]: swap.id } } }
        : retry
        ? { tab: retry.tab === LEGACY_TAB ? tool.id : retry.tab, model: retry.model, prompt: retry.prompt, settings: retry.settings }
        : tool.kind === "ranking"
        ? {
            tab: tool.id,
            model: "",
            prompt: draft.prompt,
            settings: {
              template: ranking.template,
              count: ranking.count,
              language: ranking.language,
              voiceId: ranking.voiceId || undefined,
              captions: ranking.captions,
              captionStyle: ranking.captionStyle,
              music: ranking.template === "reaction-loop" ? true : ranking.music,
              reactionPrompt: ranking.template === "reaction-loop" ? ranking.reactionPrompt || undefined : undefined,
            },
          }
        : {
            tab: tool.id,
            model: noModel ? "" : draft.model,
            prompt: draft.prompt,
            settings: {
              image: draft.image?.file,
              references: tool.kind === "thumbnail" ? (draft.references || []).map((ref) => ref.file) : undefined,
              sourceVideo: draft.sourceVideo?.file,
              sourceUrl: tool.kind === "watch" && !draft.sourceVideo ? watchLink : undefined,
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
    modelName: (item) => tool.kind === "watch" ? "Watch a Video" : tool.kind === "ranking" ? "Ranking Video" : tool.kind === "stems" ? String((item as { engine?: string }).engine || "Vocal Remover") : models.find((m) => m.id === item.model)?.name || [...(catalog?.image || []), ...(catalog?.upscale || [])].find((m) => m.id === item.model)?.name || item.model.split("/").pop() || "Model",
    onStop: (item) => void fetch(`/api/studio/generations/${encodeURIComponent(item.id)}/stop`, { method: "POST" }).then(() => refresh()),
    onRetry: (item) => void submit(undefined, item),
    onReuse: (item) => patch({ prompt: item.prompt, ...(item.settings?.operation && ops.has(item.settings.operation) ? { operation: item.settings.operation } : {}), ...(item.settings?.title ? { title: item.settings.title } : {}) }),
    onDelete: (item) => void deleteResult(item),
    onSend: (target, field, asset) => sendAsset(String(target), field, asset),
    onRevise: () => undefined,
  };

  const panel = (
    <form className="mt-panel-form" onSubmit={(event) => void submit(event)} style={{ display: "contents" }}>
      {tool.kind === "watch" ? (
        <div className="mt-field">
          {!draft.sourceVideo ? (
            <label className="mt-field">
              <span className="mt-label">Video link</span>
              <input className="ui-input" type="url" inputMode="url" value={draft.sourceUrl || ""} maxLength={500} onChange={(event) => patch({ sourceUrl: event.target.value })} placeholder="https://youtube.com/watch?v=…" />
            </label>
          ) : null}
          <MediaSlot label={draft.sourceVideo ? "Video to watch" : "Or upload a video"} accept={VIDEO_TYPES} asset={draft.sourceVideo} onChange={(sourceVideo) => patch({ sourceVideo })} onError={setError} />
        </div>
      ) : tool.kind === "ranking" ? null : tool.kind === "video-upscale" || tool.kind === "stems" ? (
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
      {tool.kind === "ranking" ? (
        <div className="mt-field">
          <span className="mt-label">Format</span>
          <OptionCards label="Format" options={RANKING_TEMPLATES} value={ranking.template} onChange={(template) => patchRanking({ template: template as RankingDraft["template"] })} />
        </div>
      ) : null}
      {tool.prompt ? (
        <label className="mt-field">
          <span className="mt-label">{tool.kind === "ranking" && ranking.template === "reaction-loop" ? "What kind of fail? (optional)" : tool.prompt.label}{needsPrompt && !tool.prompt.required ? <small>Required for this edit</small> : null}</span>
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
      {tool.kind === "ranking" ? (
        <>
          {ranking.template === "reaction-loop" ? (
            <label className="mt-field">
              <span className="mt-label">The reaction <small>generated once, then reused</small></span>
              <input className="ui-input" value={ranking.reactionPrompt} maxLength={300} onChange={(event) => patchRanking({ reactionPrompt: event.target.value })} placeholder="e.g. cartoon forest animals in Santa hats laughing" />
            </label>
          ) : null}
          <div className="mt-row">
            {ranking.template === "countdown" ? (
              <Choice label="Entries" value={String(ranking.count)} options={[3, 4, 5, 6, 7, 8, 9, 10].map((n) => ({ value: String(n), label: `Top ${n}` }))} onChange={(count) => patchRanking({ count: Number(count) })} />
            ) : null}
            <Choice label="Language" value={ranking.language} options={RANKING_LANGUAGES.map((language) => ({ value: language, label: language }))} onChange={(language) => patchRanking({ language })} />
            {ranking.template === "countdown" ? (
              <>
                <Choice label="Voice" value={ranking.voiceId} empty="Theo Calloway" options={[{ value: "", label: "Theo Calloway", hint: "Upbeat and lively, the default" }, ...(catalog?.voices || []).map((voice) => ({ value: voice.id, label: voice.name, hint: voice.description }))]} onChange={(voiceId) => patchRanking({ voiceId })} />
                <Toggle label="Captions" value={ranking.captions} onChange={(captions) => patchRanking({ captions })} />
                {ranking.captions ? <Choice label="Caption style" value={ranking.captionStyle} options={CAPTION_STYLES.map((style) => ({ value: style.id, label: style.name, hint: style.description }))} onChange={(captionStyle) => patchRanking({ captionStyle })} /> : null}
                <Toggle label="Music bed" value={ranking.music} onChange={(music) => patchRanking({ music })} />
              </>
            ) : null}
          </div>
        </>
      ) : null}
      {noModel ? null : <div className="mt-row">
        <ModelPicker models={models} value={draft.model} onChange={(id) => patch({ model: id })} loading={!catalog && !catalogError} pricing={pricing} />
        {tool.aspect && model ? <AspectPicker variant="chip" label="Aspect" value={draft.aspectRatio} options={model.aspectRatios.filter((a) => a !== "auto")} onChange={(aspectRatio) => patch({ aspectRatio })} /> : null}
        {tool.kind === "video-upscale" ? <Choice label="Scale" value={String(draft.upscaleFactor)} options={[{ value: "1.5", label: "1.5×" }, { value: "2", label: "2×" }, { value: "3", label: "3×" }]} onChange={(upscaleFactor) => patch({ upscaleFactor: Number(upscaleFactor) })} /> : null}
        {estimate !== null && model ? <span className="cs-cost" title={CREDIT_ESTIMATE_TITLE}>{creditEstimateLabel(estimate)}</span> : null}
      </div>}
      {catalogError ? <StudioNotice tone="error">{catalogError}</StudioNotice> : null}
      {catalog && !catalog.configured && !noModel ? <GenerationUnavailable /> : null}
      {catalog && catalog.configured && !models.length && !noModel ? <StudioNotice>No model can run this tool right now.</StudioNotice> : null}
      <button type="submit" className="ui-btn is-primary is-lg is-block mt-primary" disabled={!ready}>
        {submitting ? <Loader2 size={16} className="animate-spin" /> : <Wand2 size={16} />}
        {tool.action}
      </button>
      {tool.kind === "image" && draft.operation === "decompose" ? <p className="mt-note">Two images come back: the subject on white and the background without it.</p> : null}
      {tool.kind === "stems" ? <p className="mt-note">Runs on our servers at no credit cost. Only split audio you own or have permission to edit.</p> : null}
      {tool.kind === "ranking" ? <p className="mt-note">{ranking.template === "countdown" ? `Takes 5-10 minutes. Uses credits to plan, to check each clip (about ${ranking.count * 4} short vision reads), and for the narration.` : "Takes a few minutes. Uses credits to check the clips, and once per reaction for the reaction video and music."} Clips belong to their creators: a sources list comes with every video so you can credit them.</p> : null}
      {tool.kind === "watch" ? <p className="mt-note">Takes a few minutes. Uses credits for the transcript and for reading the frames. Videos over 30 minutes are watched up to the 30-minute mark.</p> : null}
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
        {!mine.length ? (
          <Empty icon={entry?.icon} heading={tool.heading} body={tool.body} />
        ) : tool.kind === "ranking" ? (
          <>
            {/* Running jobs keep their status tiles; finished ones show the video, its clips, and the swaps. */}
            <StudioGallery items={mine.filter((item) => item.status !== "done" || !(item as RankingItem).ranking)} now={now} handlers={handlers} />
            {mine.filter((item) => item.status === "done" && (item as RankingItem).ranking).map((item) => (
              <RankingCard key={item.id} item={item as RankingItem} busy={submitting} onSwap={(rank, id) => void submit(undefined, item, { rank, id })} onDelete={() => handlers.onDelete(item)} />
            ))}
          </>
        ) : tool.kind === "watch" ? (
          <>
            {/* Running jobs keep their status tiles (and failure toasts); finished ones read as reports. */}
            <StudioGallery items={mine.map((item) => (item.status === "done" ? { ...item, outputs: [] } : item))} now={now} handlers={handlers} />
            {mine.filter((item) => item.status === "done" && (item as WatchItem).report).map((item) => (
              <WatchReportCard key={item.id} item={item as WatchItem} onDelete={() => handlers.onDelete(item)} />
            ))}
          </>
        ) : (
          <StudioGallery items={mine} now={now} handlers={handlers} />
        )}
      </div>
    </ToolLayout>
  );
}

// ---------- Watch a Video: the report ----------

type WatchReport = {
  question: string;
  answer: string;
  summary: string[];
  keyMoments: Array<{ t: number; what: string }>;
  hook: { pattern: string; breakdown: Array<{ t: number; see: string; say: string }> };
  editorialProfile: { fingerprint: string; shots: number; cutsPerMinute: number; meanShot: number; medianShot: number; wordsPerMinute: number | null; sentenceWords: number | null };
  visualStyle: Record<string, string>;
  audio: Record<string, string>;
  structure: Array<{ from: number; to: number; beat: string }>;
  quotable: Array<{ t: number; line: string }>;
  recreate: { tool: string; why: string; template: string; captionStyle: string; voice: string; settings: Record<string, string>; steps: string[]; prompt: string; alsoUse: Array<{ tool: string; for: string }> };
  source: { title: string; url: string; duration: number; analysedSeconds: number; transcript: string; frames: number };
};
type WatchItem = Generation & { report: WatchReport };
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
const LABELS: Record<string, string> = { shots: "Shots", framing: "Framing", colour: "Colour", textOverlays: "Text on screen", captions: "Captions", narration: "Narration", music: "Music", sfx: "Sound effects", cantTell: "Can't tell" };

function WatchReportCard({ item, onDelete }: { item: WatchItem; onDelete: () => void }) {
  const r = item.report;
  const [copied, setCopied] = useState(false);
  const markdown = item.outputs.find((o) => /\.md$/i.test(o.file));
  const frames = item.outputs.filter((o) => o.type.startsWith("image"));
  const e = r.editorialProfile;
  const picks = [
    r.recreate.template && ["Template", r.recreate.template],
    r.recreate.captionStyle && ["Caption style", r.recreate.captionStyle],
    r.recreate.voice && ["Voice", r.recreate.voice],
    ...Object.entries(r.recreate.settings || {}),
  ].filter(Boolean) as Array<[string, string]>;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(r.recreate.prompt);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {}
  };
  const rows = (obj: Record<string, string>) => Object.entries(obj || {}).filter(([, v]) => v);
  return (
    <article className="mt-watch" aria-label={`Breakdown of ${r.source.title || "the video"}`}>
      <header className="mt-watch-head">
        <div>
          <h3>{r.source.title || "Video breakdown"}</h3>
          <p className="mt-meta">
            {clock(r.source.duration)} · {e.shots} shots · {e.cutsPerMinute} cuts/min · median shot {e.medianShot}s{e.wordsPerMinute ? ` · ${e.wordsPerMinute} wpm` : ""}
          </p>
        </div>
        <div className="mt-actions">
          {markdown ? <a className="ui-btn is-sm" href={`${markdown.url}?download=1`} download><Download size={14} aria-hidden="true" />Report</a> : null}
          <button type="button" className="ui-btn is-sm is-ghost" onClick={onDelete}>Delete</button>
        </div>
      </header>
      {r.question ? (
        <section className="mt-watch-answer">
          <p className="mt-watch-q">{r.question}</p>
          <p>{r.answer || "No direct answer could be given from what was seen and said."}</p>
        </section>
      ) : null}
      {r.summary.length ? <ul className="mt-watch-list">{r.summary.map((s) => <li key={s}>{s}</li>)}</ul> : null}
      {frames.length ? (
        <div className="mt-watch-frames">
          {frames.map((f) => <figure key={f.file}><img src={f.url} alt={f.title || "Frame"} loading="lazy" /><figcaption className="mt-meta">{f.title?.replace(/^Frame at /, "")}</figcaption></figure>)}
        </div>
      ) : null}
      <section className="mt-watch-make">
        <h4>Make one like it: {r.recreate.tool}</h4>
        {r.recreate.why ? <p>{r.recreate.why}</p> : null}
        {picks.length ? <dl className="mt-watch-picks">{picks.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl> : null}
        {r.recreate.steps.length ? <ol className="mt-watch-list">{r.recreate.steps.map((s) => <li key={s}>{s}</li>)}</ol> : null}
        {r.recreate.prompt ? (
          <div className="mt-watch-prompt">
            <pre>{r.recreate.prompt}</pre>
            <button type="button" className="ui-btn is-sm" onClick={() => void copy()}>{copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}{copied ? "Copied" : "Copy prompt"}</button>
          </div>
        ) : null}
        {r.recreate.alsoUse.length ? <ul className="mt-watch-list">{r.recreate.alsoUse.map((a) => <li key={a.tool}><strong>{a.tool}</strong>: {a.for}</li>)}</ul> : null}
      </section>
      <details className="mt-watch-more">
        <summary>Hook, moments, style, and structure</summary>
        <h4>Hook{r.hook.pattern ? `: ${r.hook.pattern}` : ""}</h4>
        {r.hook.breakdown.length ? <ul className="mt-watch-times">{r.hook.breakdown.map((b, i) => <li key={i}><span className="mt-meta">{b.t.toFixed(1)}s</span>{[b.see, b.say && `"${b.say}"`].filter(Boolean).join(" · ")}</li>)}</ul> : null}
        {e.fingerprint ? <p>{e.fingerprint}</p> : null}
        {r.keyMoments.length ? <><h4>Key moments</h4><ul className="mt-watch-times">{r.keyMoments.map((m, i) => <li key={i}><span className="mt-meta">{clock(m.t)}</span>{m.what}</li>)}</ul></> : null}
        {rows(r.visualStyle).length ? <><h4>Visual style</h4><dl className="mt-watch-picks">{rows(r.visualStyle).map(([k, v]) => <div key={k}><dt>{LABELS[k] || k}</dt><dd>{v}</dd></div>)}</dl></> : null}
        {rows(r.audio).length ? <><h4>Audio</h4><dl className="mt-watch-picks">{rows(r.audio).map(([k, v]) => <div key={k}><dt>{LABELS[k] || k}</dt><dd>{v}</dd></div>)}</dl></> : null}
        {r.structure.length ? <><h4>Structure</h4><ul className="mt-watch-times">{r.structure.map((b, i) => <li key={i}><span className="mt-meta">{clock(b.from)}–{clock(b.to)}</span>{b.beat}</li>)}</ul></> : null}
        {r.quotable.length ? <><h4>Quotable</h4><ul className="mt-watch-times">{r.quotable.map((q, i) => <li key={i}><span className="mt-meta">{clock(q.t)}</span>"{q.line}"</li>)}</ul></> : null}
        <p className="mt-note">{r.source.frames} frames · transcript: {r.source.transcript}{r.source.analysedSeconds < r.source.duration ? ` · first ${clock(r.source.analysedSeconds)} watched` : ""}</p>
      </details>
    </article>
  );
}

// ---------- Ranking Video: the video, its clips, and the runners-up ----------

type RankingCandidate = { id: string; platform: "youtube" | "tiktok"; url: string; title: string; uploader: string; duration: number | null; check: { score: number; sees: string; label: string; emoji: string; window: { start: number; end: number } } };
type RankingEntry = { rank: number; label: string; emoji: string; line: string; chosen: RankingCandidate; runnersUp: RankingCandidate[] };
type RankingItem = Generation & { ranking: { title: { lines: string[] }; hook: string; template: string; entries: RankingEntry[]; timeline?: { duration: number } } };
const youtubeThumb = (c: RankingCandidate) => (c.platform === "youtube" ? `https://i.ytimg.com/vi/${c.id.replace(/^youtube:/, "")}/mqdefault.jpg` : "");

function RankingClip({ candidate, action }: { candidate: RankingCandidate; action?: ReactNode }) {
  const thumb = youtubeThumb(candidate);
  return (
    <div className="mt-rank-clip">
      <div className="mt-rank-thumb" aria-hidden="true">{thumb ? <img src={thumb} alt="" loading="lazy" /> : <span>{candidate.platform === "tiktok" ? "TikTok" : "YouTube"}</span>}</div>
      <div className="mt-rank-body">
        <p>{candidate.check.sees || candidate.title || "Clip"}</p>
        <p className="mt-meta">
          {candidate.uploader || "Unknown creator"} · {candidate.platform === "tiktok" ? "TikTok" : "YouTube"} · {clock(candidate.check.window.start)}–{clock(candidate.check.window.end)}
          {" · "}
          <a href={candidate.url} target="_blank" rel="noreferrer">Source<ExternalLink size={11} aria-hidden="true" /></a>
        </p>
      </div>
      {action}
    </div>
  );
}

function RankingCard({ item, busy, onSwap, onDelete }: { item: RankingItem; busy: boolean; onSwap: (rank: number, id: string) => void; onDelete: () => void }) {
  const r = item.ranking;
  const video = item.outputs.find((o) => o.type.startsWith("video"));
  const sources = item.outputs.find((o) => /\.md$/i.test(o.file));
  const title = r.title.lines.join(" ");
  return (
    <article className="mt-rank" aria-label={title}>
      <div className="mt-rank-video">
        {video ? <video src={video.url} controls playsInline loop preload="metadata" /> : null}
      </div>
      <div className="mt-rank-side">
        <header className="mt-watch-head">
          <div>
            <h3>{title}</h3>
            <p className="mt-meta">{r.template === "reaction-loop" ? "Reaction loop" : `Top ${r.entries.length} countdown`}{r.timeline?.duration ? ` · ${Math.round(r.timeline.duration)}s` : ""}{item.settings?.planId ? " · clip swapped" : ""}</p>
          </div>
          <div className="mt-actions">
            {video ? <a className="ui-btn is-sm" href={`${video.url}?download=1`} download><Download size={14} aria-hidden="true" />Video</a> : null}
            {sources ? <a className="ui-btn is-sm" href={`${sources.url}?download=1`} download><Download size={14} aria-hidden="true" />Sources</a> : null}
            <button type="button" className="ui-btn is-sm is-ghost" onClick={onDelete}>Delete</button>
          </div>
        </header>
        {r.hook ? <p className="mt-rank-hook">“{r.hook}”</p> : null}
        <ol className="mt-rank-list">
          {[...r.entries].sort((a, b) => b.rank - a.rank).map((entry) => (
            <li key={entry.rank}>
              <div className="mt-rank-row">
                <span className={`mt-rank-num is-${Math.min(entry.rank, 4)}`}>{entry.rank}</span>
                <div className="mt-rank-entry">
                  <strong>{entry.label}{entry.emoji ? ` ${entry.emoji}` : ""}</strong>
                  {entry.line ? <p className="mt-rank-line">{entry.line}</p> : null}
                </div>
              </div>
              <RankingClip candidate={entry.chosen} />
              {entry.runnersUp.length ? (
                <details className="mt-watch-more mt-rank-more">
                  <summary>{entry.runnersUp.length} other {entry.runnersUp.length === 1 ? "clip" : "clips"} for #{entry.rank}</summary>
                  {entry.runnersUp.map((c) => (
                    <RankingClip key={c.id} candidate={c} action={<button type="button" className="ui-btn is-sm" disabled={busy} onClick={() => onSwap(entry.rank, c.id)}><Repeat size={14} aria-hidden="true" />Use this clip</button>} />
                  ))}
                </details>
              ) : null}
            </li>
          ))}
        </ol>
        <p className="mt-note">Using a different clip makes a new version from the same plan: only the narration and the render run again.</p>
      </div>
    </article>
  );
}
