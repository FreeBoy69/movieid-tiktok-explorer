// Network calls for Vibe Edit: projects, media, voices, captions, chat,
// generation, and export. Everything returns parsed JSON or throws an Error
// whose message is safe to show.
import type { VibeAsset, VibeAssetKind, VibeProject, VibeWord } from "../../utils/vibeEdit";
import { vibeId } from "../../utils/vibeEdit";

async function json<T>(response: Response, fallback: string): Promise<T> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) throw new Error("Sign in to keep editing.");
    if (response.status === 402) throw new Error("You're out of credits. Top up to keep generating.");
    throw new Error(data?.error || fallback);
  }
  return data as T;
}
const post = <T>(url: string, body: unknown, fallback: string) =>
  fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => json<T>(r, fallback));

export interface ProjectSummary {
  id: string;
  name: string;
  aspect: string;
  updatedAt: number;
  duration: number;
  clips: number;
  cover?: { kind: string; url: string };
}

export const listProjects = () => fetch("/api/vibe-edit/projects").then((r) => json<{ projects: ProjectSummary[] }>(r, "Couldn't load your edits")).then((d) => d.projects || []);
export const loadProject = (id: string) => fetch(`/api/vibe-edit/projects/${encodeURIComponent(id)}`).then((r) => json<{ project: VibeProject }>(r, "Couldn't open that edit")).then((d) => d.project);
export const saveProject = (project: VibeProject) =>
  fetch(`/api/vibe-edit/projects/${encodeURIComponent(project.id)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project }) }).then((r) => json<{ project: ProjectSummary }>(r, "Couldn't save"));
export const deleteProject = (id: string) => fetch(`/api/vibe-edit/projects/${encodeURIComponent(id)}`, { method: "DELETE" }).then((r) => json(r, "Couldn't delete that edit"));

const kindOf = (type: string): VibeAssetKind | null => (type.startsWith("video/") ? "video" : type.startsWith("audio/") ? "audio" : type.startsWith("image/") ? "image" : null);
const fileFromUrl = (url: string) => decodeURIComponent(url.split("/api/studio/files/")[1]?.split("?")[0] || "");

/** Read duration and size off the media itself. */
export function probeMedia(url: string, kind: VibeAssetKind): Promise<{ duration?: number; width?: number; height?: number }> {
  return new Promise((resolve) => {
    const done = (v: { duration?: number; width?: number; height?: number }) => resolve(v);
    const timer = window.setTimeout(() => done({}), 20000);
    if (kind === "image") {
      const img = new Image();
      img.onload = () => {
        window.clearTimeout(timer);
        done({ width: img.naturalWidth, height: img.naturalHeight });
      };
      img.onerror = () => done({});
      img.src = url;
      return;
    }
    const el = document.createElement(kind === "video" ? "video" : "audio");
    el.preload = "metadata";
    el.onloadedmetadata = () => {
      window.clearTimeout(timer);
      const v = el as HTMLVideoElement;
      done({ duration: Number.isFinite(el.duration) ? el.duration : undefined, width: v.videoWidth || undefined, height: v.videoHeight || undefined });
    };
    el.onerror = () => done({});
    el.src = url;
  });
}

async function assetFrom(url: string, kind: VibeAssetKind, name: string, origin: VibeAsset["origin"], extra: Partial<VibeAsset> = {}): Promise<VibeAsset> {
  const meta = await probeMedia(url, kind);
  return { id: vibeId("as"), kind, name, url, file: fileFromUrl(url), origin, ...meta, ...extra };
}

const MAX_MB: Record<VibeAssetKind, number> = { video: 200, audio: 20, image: 10 };

export async function uploadMedia(file: File): Promise<VibeAsset> {
  const kind = kindOf(file.type);
  if (!kind) throw new Error(`${file.name} isn't a video, audio, or image file.`);
  if (file.size > MAX_MB[kind] * 1024 * 1024) throw new Error(`${file.name} is over ${MAX_MB[kind]} MB.`);
  const response = await fetch("/api/studio/uploads", { method: "POST", headers: { "Content-Type": file.type }, body: file });
  const data = await json<{ url: string }>(response, `Couldn't upload ${file.name}`);
  return assetFrom(data.url, kind, file.name.replace(/\.[^.]+$/, ""), "upload");
}

export async function importLink(url: string): Promise<VibeAsset> {
  const isImage = /\.(png|jpe?g|webp)(\?|$)/i.test(url);
  const data = await post<{ url: string; type?: string; name?: string }>("/api/studio/imports", { url, kind: isImage ? "image" : "video" }, "Couldn't import that link");
  const kind = kindOf(data.type || "") || (isImage ? "image" : "video");
  return assetFrom(data.url, kind, data.name || new URL(url).hostname, "link");
}

export async function importAudioUrl(url: string, name: string): Promise<VibeAsset> {
  const data = await post<{ url: string }>("/api/vibe-edit/import-audio", { url }, "Couldn't add that track");
  return assetFrom(data.url, "audio", name, "music");
}

export interface MusicTrack {
  id: string;
  title: string;
  creator?: string;
  url: string;
  duration?: number;
  license?: string;
  attribution?: string;
}
export async function searchMusic(q: string): Promise<MusicTrack[]> {
  const r = await fetch(`/api/automation/voice/music/search?q=${encodeURIComponent(q)}`);
  const data = await json<{ tracks: Array<Record<string, unknown>> }>(r, "Music search is unavailable");
  return (data.tracks || []).map((t, i) => ({
    id: String(t.id || i),
    title: String(t.title || "Untitled"),
    creator: t.creator ? String(t.creator) : undefined,
    url: String(t.url || ""),
    duration: Number(t.durationSeconds) || undefined,
    license: t.license ? String(t.license) : undefined,
    attribution: t.attribution ? String(t.attribution) : undefined,
  })).filter((t) => t.url);
}

export const transcribeFile = (file: string) => post<{ text: string; words: VibeWord[] }>("/api/vibe-edit/transcribe", { file }, "Couldn't transcribe that audio");

export interface VoiceoverResult {
  file: string;
  url: string;
  duration: number;
  start: number;
  layout: { id: string; start: number; duration: number; text: string }[];
  language?: string;
}
export const synthesizeVoiceover = (body: { voiceId: string; lines: { id: string; text: string; at?: number }[]; direction?: string; language?: string; gap?: number }) =>
  post<VoiceoverResult>("/api/vibe-edit/voiceover", body, "Couldn't voice that script");

/** One edit the editor runs: an action name from VIBE_ACTIONS and its arguments. */
export interface ChatAction {
  type: string;
  args: Record<string, unknown>;
}

/** An export of an edit made for a Create Video project or a film episode becomes that project's video. Returns
 *  what it became, or "" when the edit belongs to nothing. */
export async function exportToSource(project: VibeProject, file: string): Promise<string> {
  const source = project.source;
  if (!file || !source || source.kind === "recap") return "";
  const url = source.kind === "create-video"
    ? `/api/maker/projects/${encodeURIComponent(source.projectId)}/vibe-edit/export`
    : source.kind === "drama"
      ? `/api/drama/episodes/${encodeURIComponent(source.episodeId)}/vibe-edit/export`
      : `/api/studio/generations/${encodeURIComponent(source.generationId)}/vibe-edit/export`;
  // A studio graphic also keeps the edits made to it, so its own document (and Revise) stay in step.
  const motion = source.kind === "studio" ? project.assets.find((a) => a.motion)?.motion : undefined;
  await post(url, { file, ...(motion ? { edits: motion.edits || {} } : {}) }, "Couldn't save the export to its project");
  return source.kind === "create-video" ? "Saved as the Create Video project's video" : source.kind === "drama" ? "Saved as the episode's final cut" : "Saved back to the studio";
}

export interface RenderJob {
  id: string;
  status: "running" | "completed" | "failed" | "stopped";
  progress: number;
  error?: string;
  url?: string;
  file?: string;
  /** What the server is doing first (cutting a recap edit from its film). */
  message?: string;
  warning?: string;
}
export const startRender = (project: VibeProject, overlays: { t0?: number; t1?: number; png: string; blank?: boolean }[]) =>
  post<{ render: RenderJob }>("/api/vibe-edit/renders", { project, overlays }, "Couldn't start the export").then((d) => d.render);
export const getRender = (id: string) => fetch(`/api/vibe-edit/renders/${encodeURIComponent(id)}`).then((r) => json<{ render: RenderJob }>(r, "Lost track of the export")).then((d) => d.render);
export const stopRender = (id: string) => post(`/api/vibe-edit/renders/${encodeURIComponent(id)}/stop`, {}, "Couldn't stop the export");

interface Generation {
  id: string;
  status: string;
  error?: string;
  message?: string;
  outputs: { file: string; url: string; type?: string }[];
}
const sleep = (ms: number) => new Promise((r) => window.setTimeout(r, ms));

/** Generate an image or video through the Creator Studio runners and wait. */
export async function generateMedia(kind: "image" | "video", prompt: string, aspect: string, seconds?: number, signal?: AbortSignal): Promise<VibeAsset> {
  const settings: Record<string, unknown> = { aspectRatio: aspect, count: 1 };
  if (kind === "video") Object.assign(settings, { duration: seconds || 5, audio: false });
  const { generation } = await post<{ generation: Generation }>("/api/studio/generations", { tab: kind, prompt, settings }, `Couldn't start the ${kind}`);
  const started = Date.now();
  for (;;) {
    if (signal?.aborted) throw new Error("Stopped");
    await sleep(kind === "video" ? 5000 : 2500);
    const r = await fetch(`/api/studio/generations?tab=${kind}`);
    const data = await json<{ generations: Generation[] }>(r, "Lost track of the generation");
    const item = data.generations.find((g) => g.id === generation.id);
    if (!item) throw new Error("The generation disappeared. Try again.");
    if (item.status === "done" && item.outputs[0]) {
      const out = item.outputs[0];
      return assetFrom(out.url, kind, prompt.slice(0, 48), "generated");
    }
    if (["failed", "error", "stopped", "cancelled"].includes(item.status)) throw new Error(item.error || item.message || `The ${kind} didn't generate`);
    if (Date.now() - started > 15 * 60 * 1000) throw new Error(`The ${kind} is taking too long. Check Video Studio later.`);
  }
}

/** A voiceover result as a project asset. */
export const voiceAsset = (result: VoiceoverResult, name: string): VibeAsset => ({
  id: vibeId("as"),
  kind: "audio",
  name,
  url: result.url,
  file: result.file,
  duration: result.duration,
  origin: "voiceover",
  ...(result.language ? { language: result.language } : {}),
});

export interface BrollClip {
  start: number;
  seconds: number;
  term: string;
  file: string;
  url: string;
  width?: number;
  height?: number;
  duration: number;
  credit: string;
}
/** Stock footage matched to spoken moments, already cut to length. */
export const findBroll = (moments: { start: number; end: number; text: string }[], aspect: string, subject = "") =>
  post<{ clips: BrollClip[] }>("/api/vibe-edit/broll", { moments, aspect, subject }, "Couldn't find b-roll").then((d) => d.clips);

export type RankedShot = { n: number; t: number; filmTime: string; description: string; tags: string; score: number | null; match: string; aiPick: boolean; why: string; sheet: string; col: number; row: number };

/** Starts a slow recap request as a background job and waits for it (minutes, past any proxy timeout). */
async function recapJob<T>(recapId: string, path: string, body: Record<string, unknown>, fallback: string): Promise<T> {
  const { job } = await post<{ job: string }>(`/api/recaps/${encodeURIComponent(recapId)}/${path}`, { ...body, async: true }, fallback);
  for (let waited = 0; waited < 25 * 60 * 1000; waited += 2500) {
    await new Promise((resolve) => setTimeout(resolve, 2500));
    const response = await fetch(`/api/recaps/${encodeURIComponent(recapId)}/jobs/${encodeURIComponent(job)}`, { cache: "no-store" }).catch(() => null);
    if (!response) continue; // a dropped poll is retried
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || fallback);
    if (data.status === "done") return data.result as T;
    if (data.status === "failed") throw new Error(data.error || fallback);
  }
  throw new Error(fallback);
}

/** The best shots for one recap cut's narration, ranked and classed by Jev (Movie to Recap). */
export const rankShots = (recapId: string, format: "long" | "short", index: number, note: string) =>
  recapJob<{ said: string; line: string; current: { t: number; description: string }; shots: RankedShot[] }>(
    recapId,
    "shots",
    { format, index, note },
    "Couldn't rank shots for this narration",
  );

/** Asks a recap for a better shot for one of its cuts: the top-ranked one, or the moment `t` an editor chose. */
export async function findBetterShot(recapId: string, format: "long" | "short", index: number, note: string, t?: number) {
  const data = await recapJob<{ asset: Omit<VibeAsset, "id">; frame: { t: number; description?: string; why?: string } }>(
    recapId,
    "recut",
    { format, index, note, ...(Number.isFinite(t) ? { t } : {}) },
    "Couldn't find a better shot",
  );
  return { asset: { ...data.asset, id: vibeId("a") } as VibeAsset, frame: data.frame };
}

/** A HyperFrames motion title: WebM with alpha to preview, ProRes to export. */
export const renderMotionTitle = (kind: string, vars: Record<string, string>, look: string, aspect: string) =>
  post<{ url: string; file: string; seconds: number; width: number; height: number; html?: string; kind?: string; vars?: Record<string, string> }>("/api/vibe-edit/motion", { kind, vars, look, aspect }, "Couldn't animate that title");
/** Films a motion graphic again with the edits made to it in the player. */
export const filmMotion = (motion: NonNullable<VibeAsset["motion"]>) =>
  post<{ url: string; file: string; edits: Record<string, unknown> }>(
    "/api/vibe-edit/motion/edit",
    { engine: motion.engine || "title", html: motion.html, vars: motion.vars, edits: motion.edits || {}, seconds: motion.seconds, width: motion.width, height: motion.height },
    "Couldn't film the edited graphic",
  );

/** Moves a recap edit onto the film: 202 with progress while the film's editing copy is made, then the project. */
export async function moveEditToFilm(recapId: string, projectId: string): Promise<{ state: string; progress?: number; error?: string; project?: VibeProject }> {
  const response = await fetch(`/api/recaps/${encodeURIComponent(recapId)}/vibe-film`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId }) });
  return json(response, "Couldn't load the film");
}
