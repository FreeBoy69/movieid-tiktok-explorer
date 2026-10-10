// Creator Studio gallery: a masonry wall of the generated media itself, with
// details on hover and a full-screen lightbox. Audio uses the shared player.
import { type MouseEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Captions,
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  Download,
  Loader2,
  Maximize2,
  Mic,
  MousePointer2,
  PenLine,
  RotateCcw,
  Sparkles,
  Square,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { AudioPlayer } from "../AudioPlayer";
import { Dialog } from "../ui/Dialog";
import { PickerDialog } from "../SourcePicker";
import { socialPlatform } from "../SocialPlatforms";
import { YouTubePublishFields } from "../YouTubePublishForm";
import type { AuthSessionPayload, ConnectedYouTubeAccount } from "../../types";
import { MotionPreview } from "./MotionPreview";
import { writeDeepLink } from "../../utils/tiktokRoute";
import { type Asset, elapsed, type Generation, type Output, timeAgo } from "./studioShared";
import { VideoPlayer } from "../VideoPlayer";
import { toast } from "../../utils/toast";

type Send = (target: any, field: string, asset: Asset) => void;
export type GalleryHandlers = {
  modelName: (item: Generation) => string;
  onStop: (item: Generation) => void;
  onRetry: (item: Generation) => void;
  onReuse: (item: Generation) => void;
  onDelete: (item: Generation) => void;
  onSend: Send;
  onRevise: (file: string) => void;
  routeGenerationId?: string;
  onOpenGeneration?: (item: Generation) => void;
  onCloseGeneration?: () => void;
};
type Tile =
  | { kind: "media"; key: string; item: Generation; output: Output; media: "image" | "video" | "html" }
  | { kind: "audio"; key: string; item: Generation; output: Output }
  | { kind: "status"; key: string; item: Generation };

export const kindOf = (output: Output) =>
  output.type.startsWith("image") ? "image" : output.type.startsWith("video") ? "video" : output.type.startsWith("audio") ? "audio" : output.type.startsWith("text/html") ? "html" : "file";
const ratio = (aspect?: string) => {
  const [w, h] = String(aspect || "1:1").split(":").map(Number);
  return w > 0 && h > 0 ? `${w} / ${h}` : "1 / 1";
};
const clock = (seconds?: number) => (Number.isFinite(seconds) ? `${Math.floor(Number(seconds) / 60)}:${String(Math.floor(Number(seconds) % 60)).padStart(2, "0")}` : "");
export function generationFailureMessage(error = "") {
  if (/copyright|copyrighted|trademark|licensed character/i.test(error))
    return "This may use a copyrighted character. Try an original character and setting.";
  if (/real person|likeness|identity/i.test(error))
    return "This may use a real person's likeness. Use an original character or a permitted reference.";
  if (/safety|moderation|policy/i.test(error))
    return "This request could not pass the video model's safety checks. Revise the prompt and try again.";
  return error || "The video could not be generated. Try again.";
}

// Every output becomes its own tile; running or failed generations add a status tile.
export function galleryTiles(items: Generation[]): Tile[] {
  const tiles: Tile[] = [];
  for (const item of items) {
    const pending = item.status === "queued" || item.status === "running";
    // Failures and cancellations are toast notifications, not gallery tiles.
    if (pending) tiles.push({ kind: "status", key: `${item.id}:status`, item });
    for (const output of item.outputs || []) {
      const kind = kindOf(output);
      if (kind === "audio") tiles.push({ kind: "audio", key: `${item.id}:${output.file}`, item, output });
      else if (kind === "image" || kind === "video" || kind === "html") tiles.push({ kind: "media", key: `${item.id}:${output.file}`, item, output, media: kind });
    }
  }
  return tiles;
}

function details(item: Generation, modelName: string, now: number) {
  const s = item.settings || {};
  return [modelName, s.aspectRatio && item.tab !== "clipping" ? s.aspectRatio : "", ["video", "motion-control", "marketing", "vibe-motion", "promo"].includes(item.tab) && s.duration ? `${s.duration}s` : item.film?.duration ? clock(item.film.duration) : "", timeAgo(item.createdAt, now)]
    .filter(Boolean)
    .join(" · ");
}

// Promo and Explainer films and Vibe Motion graphics can be edited element by element in their own player.
// Any finished one with its HTML: the film's source, or (older films that never rendered, and Vibe Motion) the output.
const isEditableMotion = (item: Generation) =>
  ["promo", "explainer", "vibe-motion"].includes(item.tab) && !["queued", "running", "failed", "cancelled"].includes(item.status) && !item.rendering &&
  (Boolean(item.tab !== "vibe-motion" && item.source?.file) || (item.outputs || []).some((o) => /\.html$/i.test(o.file)));
/** Opens the graphic in Vibe Edit, the one editor: its own edit, built the first time and reopened as it was left. */
async function openInVibeEdit(item: Generation) {
  const opening = toast.info("Opening it in Vibe Edit…", { duration: 0 });
  try {
    const response = await fetch(`/api/studio/generations/${encodeURIComponent(item.id)}/vibe-edit`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "It couldn't be opened in Vibe Edit");
    writeDeepLink({ view: "vibe-edit", projectId: data.projectId });
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "It couldn't be opened in Vibe Edit");
  } finally {
    toast.dismiss(opening);
  }
}
/** Something changed a generation outside the studio's own requests: the studio reloads its history. */
function Actions({ item, output, handlers, onClose }: { item: Generation; output?: Output; handlers: GalleryHandlers; onClose?: () => void }) {
  const kind = output ? kindOf(output) : "";
  const act = (fn: () => void) => (event: MouseEvent) => {
    event.stopPropagation();
    fn();
  };
  return (
    <div className="cs-tile-actions">
      {output && kind === "image" ? (
        <>
          <button type="button" className="ui-icon-btn cs-icon" aria-label="Animate in Video Studio" title="Animate in Video Studio" onClick={act(() => { onClose?.(); handlers.onSend("video", "firstFrame", output); })}><Clapperboard className="h-3.5 w-3.5" /></button>
          <button type="button" className="ui-icon-btn cs-icon" aria-label="Edit in Magic Edit" title="Edit in Magic Edit" onClick={act(() => { onClose?.(); handlers.onSend("magic-edit", "image", output); })}><Sparkles className="h-3.5 w-3.5" /></button>
          <button type="button" className="ui-icon-btn cs-icon" aria-label="Make it talk in Lip Sync" title="Make it talk in Lip Sync" onClick={act(() => { onClose?.(); handlers.onSend("lipsync", "image", output); })}><Mic className="h-3.5 w-3.5" /></button>
        </>
      ) : null}
      {output && kind === "audio" ? (
        <button type="button" className="ui-icon-btn cs-icon" aria-label="Use in Lip Sync" title="Use in Lip Sync" onClick={act(() => handlers.onSend("lipsync", "audioFile", output))}><Mic className="h-3.5 w-3.5" /></button>
      ) : null}
      {output && isEditableMotion(item) ? (
        <button type="button" className="ui-icon-btn cs-icon" aria-label="Edit in Vibe Edit" title="Edit in Vibe Edit: click any part of it in the player" onClick={act(() => { onClose?.(); void openInVibeEdit(item); })}><MousePointer2 className="h-3.5 w-3.5" /></button>
      ) : null}
      {output && item.tab === "vibe-motion" && kind === "html" ? (
        <button type="button" className="ui-icon-btn cs-icon" aria-label="Revise this motion graphic" title="Revise" onClick={act(() => { onClose?.(); handlers.onRevise(output.file); })}><PenLine className="h-3.5 w-3.5" /></button>
      ) : null}
      {output && item.tab === "promo" && item.source ? (
        <button type="button" className="ui-icon-btn cs-icon" aria-label="Revise this film" title="Revise" onClick={act(() => { onClose?.(); handlers.onRevise(item.source!.file); })}><PenLine className="h-3.5 w-3.5" /></button>
      ) : null}
      {output && item.tab === "explainer" && item.source ? (
        <button type="button" className="ui-icon-btn cs-icon" aria-label="Edit the script" title="Edit the script" onClick={act(() => { onClose?.(); handlers.onRevise(item.source!.file); })}><PenLine className="h-3.5 w-3.5" /></button>
      ) : null}
      {output && item.tab === "explainer" && item.captions ? (
        <a className="ui-icon-btn cs-icon" href={`${item.captions.url}?download=1`} aria-label="Download captions (SRT)" title="Download captions (SRT)" onClick={(event) => event.stopPropagation()}><Captions className="h-3.5 w-3.5" /></a>
      ) : null}
      {output && item.tab === "clipping" && kind === "video" ? <PostClip output={output} /> : null}
      <button type="button" className="ui-icon-btn cs-icon" aria-label="Reuse settings" title="Reuse settings" onClick={act(() => { onClose?.(); handlers.onReuse(item); })}><RotateCcw className="h-3.5 w-3.5" /></button>
      {output ? (
        <a className="ui-icon-btn cs-icon" href={`${output.url}?download=1`} aria-label="Download" title="Download" onClick={(event) => event.stopPropagation()}><Download className="h-3.5 w-3.5" /></a>
      ) : null}
      <button type="button" className="ui-icon-btn cs-icon" aria-label="Delete" title="Delete" onClick={act(() => { onClose?.(); handlers.onDelete(item); })}><Trash2 className="h-3.5 w-3.5" /></button>
    </div>
  );
}

// Post one clip to a connected channel through the same upload route Channel
// Management uses: YouTube directly (or Zernio as its backup), TikTok via Zernio.
export function PostClip({ output }: { output: Output }) {
  const [open, setOpen] = useState(false);
  const [channels, setChannels] = useState<ConnectedYouTubeAccount[] | null>(null);
  const [accountId, setAccountId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const [privacy, setPrivacy] = useState("public");
  const [when, setWhen] = useState("");
  const [posting, setPosting] = useState(false);
  const channel = channels?.find((c) => c.id === accountId);
  useEffect(() => {
    if (!open || channels) return;
    fetch("/api/auth/session", { cache: "no-store" })
      .then((response) => response.json() as Promise<AuthSessionPayload>)
      .then((data) => setChannels(data.accounts || []))
      .catch(() => { setChannels([]); toast.error("Couldn't load your channels"); });
  }, [open, channels]);
  const start = (event: MouseEvent) => {
    event.stopPropagation();
    setTitle((output.title || "").slice(0, 100));
    setDescription(output.caption || "");
    setAccountId("");
    setWhen("");
    setOpen(true);
  };
  const post = async () => {
    setPosting(true);
    try {
      const file = await fetch(output.url, { credentials: "same-origin" });
      if (!file.ok) throw new Error("Couldn't read the clip");
      const params = new URLSearchParams({ accountId, title: title.trim(), description, tags, privacyStatus: privacy });
      if (when) params.set("publishAt", new Date(when).toISOString());
      const response = await fetch(`/api/youtube/videos/upload?${params.toString()}`, {
        method: "POST",
        headers: { "Content-Type": "video/mp4" },
        body: await file.blob(),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Couldn't post the clip");
      const name = channel?.channelTitle || "your channel";
      toast.success(when ? `Scheduled on ${name}` : `Posted to ${name}`);
      setOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't post the clip");
    } finally {
      setPosting(false);
    }
  };
  // The earliest schedule the server accepts is a couple of minutes out.
  const earliest = new Date(Date.now() + 5 * 60_000 - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  // The dialogs portal out, but React still bubbles their clicks and keys to the
  // tile (opens the lightbox) and the lightbox (arrows switch clips): stop them here.
  const contain = (event: { stopPropagation: () => void }) => event.stopPropagation();
  return (
    <span style={{ display: "contents" }} onClick={contain} onKeyDown={contain}>
      <button type="button" className="ui-icon-btn cs-icon" aria-label="Post to a channel" title="Post to a channel" onClick={start}><Upload className="h-3.5 w-3.5" /></button>
      <PickerDialog
        open={open && !accountId}
        onClose={() => setOpen(false)}
        title="Post to a channel"
        loading={!channels}
        emptyText="No channels are connected. Connect one from the channel menu at the top."
        items={(channels || []).map((c) => ({ value: c.id, label: c.channelTitle, imageUrl: c.thumbnailUrl || undefined, kind: "channel" as const, platform: c.platform, meta: `${socialPlatform(c.platform)?.label || c.platform || "YouTube"}${c.channelHandle ? ` · ${c.channelHandle}` : ""}` }))}
        onChoose={(choice) => setAccountId(choice.value)}
      />
      {open && accountId ? (
        <Dialog
          title={`Post to ${channel?.channelTitle || "channel"}`}
          size="sm"
          dismissible={!posting}
          onClose={() => { if (!posting) setOpen(false); }}
          footer={
            <>
              <button type="button" className="ui-btn" disabled={posting} onClick={() => setAccountId("")}>Another channel</button>
              <button type="button" className="ui-btn is-primary" disabled={posting || !title.trim()} onClick={() => void post()}>
                {posting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Upload className="h-4 w-4" aria-hidden="true" />}
                {when ? "Schedule" : "Post now"}
              </button>
            </>
          }
        >
          <YouTubePublishFields
            theme={document.documentElement.dataset.theme === "light" ? "light" : "dark"}
            title={title}
            onTitleChange={setTitle}
            description={description}
            onDescriptionChange={setDescription}
            tags={tags}
            onTagsChange={setTags}
            privacyStatus={privacy}
            onPrivacyStatusChange={setPrivacy}
          >
            <label className="ytp-field">
              <span className="ytp-label-row"><span className="ytp-label">Schedule</span><span className="ytp-count">Leave empty to post now</span></span>
              <input className="ui-input" type="datetime-local" min={earliest} value={when} onChange={(event) => setWhen(event.target.value)} />
            </label>
          </YouTubePublishFields>
        </Dialog>
      ) : null}
    </span>
  );
}

// autoyt.cc's edge sends X-Frame-Options: DENY on every response, so a motion
// graphic can't be framed by URL. Load its HTML and frame it inline instead,
// sandboxed without same-origin and under a strict CSP.
const motionCache = new Map<string, Promise<string>>();
export const MOTION_CSP = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; form-action 'none'">`;
function loadMotion(url: string) {
  if (!motionCache.has(url))
    motionCache.set(
      url,
      fetch(url, { credentials: "same-origin" })
        .then((response) => {
          if (!response.ok) throw new Error("Motion graphic unavailable");
          return response.text();
        })
        .then((html) => {
          if (!/<html[\s>]/i.test(html)) throw new Error("Not a motion graphic");
          return html.replace(/<head[^>]*>/i, (head) => head + MOTION_CSP);
        })
        .catch((error) => {
          motionCache.delete(url);
          throw error;
        }),
    );
  return motionCache.get(url)!;
}
function MotionFrame({ url, title, aspect }: { url: string; title: string; aspect?: string }) {
  const [html, setHtml] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    setFailed(false);
    loadMotion(url).then((doc) => alive && setHtml(doc)).catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [url]);
  return html ? (
    <iframe srcDoc={html} sandbox="allow-scripts" title={title} style={{ aspectRatio: ratio(aspect) }} tabIndex={-1} />
  ) : (
    <span className="cs-tile-motion-wait" style={{ aspectRatio: ratio(aspect) }}>
      {failed ? <AlertCircle className="h-5 w-5" /> : <Loader2 className="h-5 w-5 animate-spin" />}
    </span>
  );
}

function MediaTile({ tile, handlers, now, onOpen }: { tile: Extract<Tile, { kind: "media" }>; handlers: GalleryHandlers; now: number; onOpen: () => void }) {
  const { item, output, media } = tile;
  const video = useRef<HTMLVideoElement>(null);
  const s = item.settings || {};
  return (
    <figure
      className="cs-tile"
      tabIndex={0}
      role="button"
      aria-label={`Open ${output.title || item.prompt.slice(0, 80) || "generation"}`}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
      onMouseEnter={() => void video.current?.play().catch(() => {})}
      onMouseLeave={() => video.current?.pause()}
    >
      {media === "image" ? (
        <img src={output.url} alt={output.caption || item.prompt.slice(0, 160) || "Generated image"} loading="lazy" />
      ) : media === "video" ? (
        <video ref={video} src={output.url} muted loop playsInline preload="metadata" style={item.tab === "clipping" && s.vertical !== false ? { aspectRatio: s.clipAspect === "1:1" ? "1 / 1" : "9 / 16" } : undefined} />
      ) : (
        <MotionFrame url={output.url} title={`Motion graphic: ${item.prompt.slice(0, 80)}`} aspect={s.aspectRatio} />
      )}
      {media !== "image" ? <span className="cs-tile-kind">{media === "html" ? "Motion" : output.title ? clock(output.end! - output.start!) || "Clip" : "Video"}</span> : null}
      {output.title ? <span className="cs-tile-title">{output.title}</span> : null}
      <figcaption className="cs-tile-over">
        <div className="cs-tile-top">
          <Actions item={item} output={output} handlers={handlers} />
        </div>
        <div className="cs-tile-bottom">
          {item.prompt ? <p>{item.prompt}</p> : null}
          <span>{details(item, handlers.modelName(item), now)}</span>
        </div>
        <Maximize2 className="cs-tile-expand h-4 w-4" aria-hidden="true" />
      </figcaption>
    </figure>
  );
}

function StatusTile({ item, handlers, now }: { item: Generation; handlers: GalleryHandlers; now: number }) {
  const s = item.settings || {};
  return (
    <div className="cs-tile cs-tile-status" style={{ aspectRatio: item.tab === "audio" || item.tab === "vocal-remover" ? "3 / 1" : ratio(item.tab === "clipping" ? "9:16" : s.aspectRatio) }}>
      <Loader2 className="h-5 w-5 animate-spin" />
      <strong>{`${item.message || (item.tab === "audio" ? "Composing" : item.tab === "vocal-remover" ? "Splitting" : "Generating")} · ${elapsed(item.createdAt, now)}`}</strong>
      {item.prompt ? <p className="is-quiet">{item.prompt}</p> : null}
      {item.steps?.length ? (
        <ol className="cs-steps">
          {item.steps.map((step) => (
            <li key={step.label} data-status={step.status}>{step.label}</li>
          ))}
        </ol>
      ) : null}
      <div className="cs-tile-status-actions">
        <button type="button" className="ui-btn is-sm cs-ghost" onClick={() => handlers.onStop(item)}><Square className="h-3 w-3" />Stop</button>
      </div>
    </div>
  );
}

export function StudioGallery({ items, now, handlers, extraAudio = [] }: { items: Generation[]; now: number; handlers: GalleryHandlers; extraAudio?: Array<{ id: string; title: string; meta: string; url: string; onLipSync: () => void }> }) {
  const tiles = useMemo(() => galleryTiles(items), [items]);
  const viewable = tiles.filter((tile): tile is Extract<Tile, { kind: "media" }> => tile.kind === "media");
  const [open, setOpen] = useState<string | null>(handlers.routeGenerationId || null);
  useEffect(() => setOpen(handlers.routeGenerationId || null), [handlers.routeGenerationId]);
  const previous = useRef(new Map<string, Generation["status"]>());
  useEffect(() => {
    for (const item of items) {
      const before = previous.current.get(item.id);
      if (before && before !== "failed" && item.status === "failed") {
        toast.error(generationFailureMessage(item.error), {
          title: "Generation failed",
          duration: 0,
          action: { label: "Try again", onClick: () => handlers.onRetry(item) },
        });
      }
      if (before && (before === "queued" || before === "running") && item.status === "cancelled") {
        toast.info("Stopped before it finished", { title: "Generation stopped", duration: 0 });
      }
      previous.current.set(item.id, item.status);
    }
  }, [items, handlers]);
  const index = viewable.findIndex((tile) => tile.key === open || tile.item.id === open);
  return (
    <>
      <div className="cs-masonry">
        {extraAudio.map((clip) => (
          <div key={clip.id} className="cs-tile cs-tile-audio">
            <AudioPlayer src={clip.url} title={clip.title} meta={clip.meta} download />
            <div className="cs-tile-actions is-static">
              <button type="button" className="ui-icon-btn cs-icon" aria-label="Use in Lip Sync" title="Use in Lip Sync" onClick={clip.onLipSync}><Mic className="h-3.5 w-3.5" /></button>
            </div>
          </div>
        ))}
        {tiles.map((tile) =>
          tile.kind === "status" ? (
            <StatusTile key={tile.key} item={tile.item} handlers={handlers} now={now} />
          ) : tile.kind === "audio" ? (
            <div key={tile.key} className="cs-tile cs-tile-audio">
              <AudioPlayer src={tile.output.url} title={tile.output.title || tile.item.prompt.slice(0, 90) || "Generated audio"} meta={details(tile.item, handlers.modelName(tile.item), now)} download />
              <Actions item={tile.item} output={tile.output} handlers={handlers} />
            </div>
          ) : (
            <MediaTile key={tile.key} tile={tile} handlers={handlers} now={now} onOpen={() => { setOpen(tile.item.id); handlers.onOpenGeneration?.(tile.item); }} />
          ),
        )}
      </div>
      {index >= 0 ? (
        <GalleryLightbox
          tile={viewable[index]}
          position={`${index + 1} / ${viewable.length}`}
          handlers={handlers}
          now={now}
          onClose={() => { setOpen(null); handlers.onCloseGeneration?.(); }}
          onPrev={index > 0 ? () => setOpen(viewable[index - 1].key) : undefined}
          onNext={index < viewable.length - 1 ? () => setOpen(viewable[index + 1].key) : undefined}
        />
      ) : null}
    </>
  );
}

function GalleryLightbox({ tile, position, handlers, now, onClose, onPrev, onNext }: { tile: Extract<Tile, { kind: "media" }>; position: string; handlers: GalleryHandlers; now: number; onClose: () => void; onPrev?: () => void; onNext?: () => void }) {
  const close = useRef<HTMLButtonElement>(null);
  const { item, output, media } = tile;
  const key = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowLeft" && onPrev) onPrev();
      if (event.key === "ArrowRight" && onNext) onNext();
    },
    [onClose, onPrev, onNext],
  );
  useEffect(() => {
    close.current?.focus();
    document.addEventListener("keydown", key);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", key);
      document.body.style.overflow = overflow;
    };
  }, [key]);
  const s = item.settings || {};
  return (
    <div className="cs-lb" role="dialog" aria-modal="true" aria-label="Generation preview" onClick={onClose}>
      <div className="cs-lb-media" onClick={(event) => event.stopPropagation()}>
        {media === "image" ? (
          <img key={output.file} src={output.url} alt={output.caption || item.prompt.slice(0, 160) || "Generated image"} />
        ) : media === "video" ? (
          <VideoPlayer key={output.file} src={output.url} autoPlay loop size="fit" label="Generated video" download />
        ) : (
          <div className="cs-lb-motion" style={{ aspectRatio: ratio(s.aspectRatio) }}>
            <MotionPreview url={output.url} generationId={item.id} aspect={s.aspectRatio} title={`Motion graphic: ${item.prompt.slice(0, 80)}`} />
          </div>
        )}
      </div>
      <aside className="cs-lb-info" onClick={(event) => event.stopPropagation()}>
        <div className="cs-lb-head">
          <span>{position}</span>
          <button ref={close} type="button" className="ui-icon-btn cs-icon" onClick={onClose} aria-label="Close preview"><X className="h-4 w-4" /></button>
        </div>
        {output.title ? <h2>{output.title}</h2> : null}
        {output.caption ? <p className="cs-lb-caption">{output.caption}</p> : null}
        {item.prompt ? <p className="cs-lb-prompt">{item.prompt}</p> : null}
        <dl>
          <dt>Model</dt>
          <dd>{handlers.modelName(item)}</dd>
          {s.aspectRatio && item.tab !== "clipping" ? (<><dt>Aspect</dt><dd>{s.aspectRatio}</dd></>) : null}
          {output.start !== undefined ? (<><dt>Source time</dt><dd>{clock(output.start)} – {clock(output.end)}</dd></>) : null}
          {output.score ? (<><dt>Score</dt><dd>{output.score}</dd></>) : null}
          <dt>Created</dt>
          <dd>{timeAgo(item.createdAt, now)}</dd>
        </dl>
        <Actions item={item} output={output} handlers={handlers} onClose={onClose} />
      </aside>
      {onPrev ? (
        <button type="button" className="cs-lb-nav is-prev" onClick={(event) => { event.stopPropagation(); onPrev(); }} aria-label="Previous"><ChevronLeft className="h-5 w-5" /></button>
      ) : null}
      {onNext ? (
        <button type="button" className="cs-lb-nav is-next" onClick={(event) => { event.stopPropagation(); onNext(); }} aria-label="Next"><ChevronRight className="h-5 w-5" /></button>
      ) : null}
    </div>
  );
}
