// Creator Studio gallery: a masonry wall of the generated media itself, with
// details on hover and a full-screen lightbox. Audio uses the shared player.
import { type MouseEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  Download,
  Loader2,
  Maximize2,
  Mic,
  PenLine,
  RotateCcw,
  Sparkles,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { AudioPlayer } from "../AudioPlayer";
import { MotionPreview } from "./MotionPreview";
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
  if (/copyright|copyrighted|real person|likeness|safety|moderation|policy/i.test(error))
    return "You cannot use copyrighted characters or real people. Describe an original character instead.";
  return error || "The video could not be generated. Try again.";
}

// Every output becomes its own tile; running or failed generations add a status tile.
export function galleryTiles(items: Generation[]): Tile[] {
  const tiles: Tile[] = [];
  for (const item of items) {
    const pending = item.status === "queued" || item.status === "running";
    if (pending || item.status !== "done") tiles.push({ kind: "status", key: `${item.id}:status`, item });
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
  return [modelName, s.aspectRatio && item.tab !== "clipping" ? s.aspectRatio : "", ["video", "motion-control", "marketing", "vibe-motion"].includes(item.tab) && s.duration ? `${s.duration}s` : "", timeAgo(item.createdAt, now)]
    .filter(Boolean)
    .join(" · ");
}

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
          <button type="button" className="cs-icon" aria-label="Animate in Video Studio" title="Animate in Video Studio" onClick={act(() => { onClose?.(); handlers.onSend("video", "firstFrame", output); })}><Clapperboard className="h-3.5 w-3.5" /></button>
          <button type="button" className="cs-icon" aria-label="Edit in Layers Studio" title="Edit in Layers Studio" onClick={act(() => { onClose?.(); handlers.onSend("layers", "image", output); })}><Sparkles className="h-3.5 w-3.5" /></button>
          <button type="button" className="cs-icon" aria-label="Make it talk in Lip Sync" title="Make it talk in Lip Sync" onClick={act(() => { onClose?.(); handlers.onSend("lipsync", "image", output); })}><Mic className="h-3.5 w-3.5" /></button>
        </>
      ) : null}
      {output && kind === "audio" ? (
        <button type="button" className="cs-icon" aria-label="Use in Lip Sync" title="Use in Lip Sync" onClick={act(() => handlers.onSend("lipsync", "audioFile", output))}><Mic className="h-3.5 w-3.5" /></button>
      ) : null}
      {output && item.tab === "vibe-motion" && kind === "html" ? (
        <button type="button" className="cs-icon" aria-label="Revise this motion graphic" title="Revise" onClick={act(() => { onClose?.(); handlers.onRevise(output.file); })}><PenLine className="h-3.5 w-3.5" /></button>
      ) : null}
      <button type="button" className="cs-icon" aria-label="Reuse settings" title="Reuse settings" onClick={act(() => { onClose?.(); handlers.onReuse(item); })}><RotateCcw className="h-3.5 w-3.5" /></button>
      {output ? (
        <a className="cs-icon" href={`${output.url}?download=1`} aria-label="Download" title="Download" onClick={(event) => event.stopPropagation()}><Download className="h-3.5 w-3.5" /></a>
      ) : null}
      <button type="button" className="cs-icon" aria-label="Delete" title="Delete" onClick={act(() => { onClose?.(); handlers.onDelete(item); })}><Trash2 className="h-3.5 w-3.5" /></button>
    </div>
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
        <video ref={video} src={output.url} muted loop playsInline preload="metadata" style={item.tab === "clipping" && s.vertical !== false ? { aspectRatio: "9 / 16" } : undefined} />
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
  const pending = item.status === "queued" || item.status === "running";
  const s = item.settings || {};
  return (
    <div className={pending ? "cs-tile cs-tile-status" : "cs-tile cs-tile-status is-failed"} style={{ aspectRatio: item.tab === "audio" ? "3 / 1" : ratio(item.tab === "clipping" ? "9:16" : s.aspectRatio) }}>
      {pending ? <Loader2 className="h-5 w-5 animate-spin" /> : <AlertCircle className="h-5 w-5" />}
      <strong>{pending ? `${item.message || (item.tab === "audio" ? "Composing" : "Generating")} · ${elapsed(item.createdAt, now)}` : item.status === "cancelled" ? "Stopped before it finished" : "Generation failed"}</strong>
      {pending && item.prompt ? <p className="is-quiet">{item.prompt}</p> : null}
      {item.steps?.length ? (
        <ol className="cs-steps">
          {item.steps.map((step) => (
            <li key={step.label} data-status={step.status}>{step.label}</li>
          ))}
        </ol>
      ) : null}
      <div className="cs-tile-status-actions">
        {pending ? (
          <button type="button" className="cs-ghost" onClick={() => handlers.onStop(item)}><Square className="h-3 w-3" />Stop</button>
        ) : (
          <>
            <button type="button" className="cs-ghost" onClick={() => handlers.onRetry(item)}><RotateCcw className="h-3 w-3" />Try again</button>
            <button type="button" className="cs-icon" aria-label="Delete" onClick={() => handlers.onDelete(item)}><Trash2 className="h-3.5 w-3.5" /></button>
          </>
        )}
      </div>
    </div>
  );
}

export function StudioGallery({ items, now, handlers, extraAudio = [] }: { items: Generation[]; now: number; handlers: GalleryHandlers; extraAudio?: Array<{ id: string; title: string; meta: string; url: string; onLipSync: () => void }> }) {
  const tiles = useMemo(() => galleryTiles(items), [items]);
  const viewable = tiles.filter((tile): tile is Extract<Tile, { kind: "media" }> => tile.kind === "media");
  const [open, setOpen] = useState<string | null>(null);
  const previous = useRef(new Map<string, Generation["status"]>());
  useEffect(() => {
    for (const item of items) {
      const before = previous.current.get(item.id);
      if (before && before !== "failed" && item.status === "failed")
        toast.error(generationFailureMessage(item.error), { title: "Video generation failed" });
      previous.current.set(item.id, item.status);
    }
  }, [items]);
  const index = viewable.findIndex((tile) => tile.key === open);
  return (
    <>
      <div className="cs-masonry">
        {extraAudio.map((clip) => (
          <div key={clip.id} className="cs-tile cs-tile-audio">
            <AudioPlayer src={clip.url} title={clip.title} meta={clip.meta} download />
            <div className="cs-tile-actions is-static">
              <button type="button" className="cs-icon" aria-label="Use in Lip Sync" title="Use in Lip Sync" onClick={clip.onLipSync}><Mic className="h-3.5 w-3.5" /></button>
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
            <MediaTile key={tile.key} tile={tile} handlers={handlers} now={now} onOpen={() => setOpen(tile.key)} />
          ),
        )}
      </div>
      {index >= 0 ? (
        <GalleryLightbox
          tile={viewable[index]}
          position={`${index + 1} / ${viewable.length}`}
          handlers={handlers}
          now={now}
          onClose={() => setOpen(null)}
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
          <button ref={close} type="button" className="cs-icon" onClick={onClose} aria-label="Close preview"><X className="h-4 w-4" /></button>
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
