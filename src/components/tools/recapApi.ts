// Client for /api/recaps (server/movieRecap.js).
import { narrationWpm } from "../../utils/recapSteps";

export type RecapFormat = "long" | "short";
export type RecapTone = "dramatic" | "suspense" | "funny" | "calm";
export type RecapPace = "natural" | "brisk" | "fast";
export type RecapTransforms = { zoom: boolean; color: boolean; mirror: boolean; speed: boolean };
export type RecapBeat = { id: string; text: string; from: number; to: number; shots: number[] ; /** The intro line, played over a quick montage of the best shots. */ teaser?: boolean };
export type RecapScript = {
  title: string;
  logline?: string;
  long?: { beats: RecapBeat[] };
  short?: { title?: string; beats: RecapBeat[] };
};
/** Where the story runs (seconds), and where each end came from: TheIntroDB, IntroDB, chapters, frames, or estimate. */
export type RecapBounds = { start: number; end: number; from: { start: string; end: string } };
export type RecapStats = { cuts: number; footageSeconds: number; filmShare: number; averageCut: number; shortestGap: number; seconds: number; /** Short cuts that passed the main-character centring check. */ centred?: number; /** Cuts Jev rated a weak match for their narration (flagged in Vibe Edit). */ weak?: number; /** Checked on the finished video: clips whose angle changes partway through, and jump cuts. */ angleChanges?: number; jumpCuts?: number; multiShot?: number; /** Cuts the visual check rated as showing what is said (of those rated). */ shown?: number; rated?: number };
export type QaFinding = { level: "WARN" | "FAIL"; rule: string; message: string; at?: number };
/** The quality gate's verdict on a finished recap (server/videoQa.js). */
export type RecapQa = { verdict: "PASS" | "WARN" | "FAIL"; findings: QaFinding[]; lufs: number | null; truePeak: number | null };
export type RecapOutput = { format: RecapFormat; file: string; url: string; size: number; duration: number; qa?: RecapQa };
export type Recap = {
  id: string;
  title: string;
  status: "queued" | "working" | "review" | "done" | "failed" | "cancelled";
  stage: string;
  message: string;
  progress: number;
  error: string;
  options: {
    formats: RecapFormat[];
    longMinutes: number;
    shortSeconds: number;
    voiceId: string;
    tone: RecapTone;
    pace?: RecapPace;
    language: string;
    captions: boolean;
    transforms: RecapTransforms;
  };
  film?: { duration: number; shots: number; scenes: number; lines: number; shotEvery: number; sheet: { cols: number; rows: number; count: number }; height?: number; bounds?: RecapBounds; title?: string; year?: number };
  outputs: RecapOutput[];
  /** The long recap's motion graphics (title card, names, subscribe), once rendered. */
  graphics?: { events: { type: "title" | "name" | "subscribe"; start: number; label: string }[] };
  /** Vibe Edit project ids, one per rendered format, where the finished recap opens for tweaks and export. */
  vibe: Partial<Record<RecapFormat, string>>;
  stats?: Partial<Record<RecapFormat, RecapStats>>;
  script?: RecapScript | null;
  source: { kind: "link" | "upload"; name: string };
  /** The server's time when this was sent, so timers can ignore this computer's clock. */
  /** Posts of this recap to the user's channels, newest first. */
  posts?: RecapPost[];
  /** The film's official poster (TMDB), once the film is known. */
  poster?: string | null;
  serverNow?: number;
  /** Working time (ms, pauses excluded), when each step started and ended, and the latest messages. */
  clock?: { workMs: number; since: number | null; steps: Record<string, { start: number; end?: number }>; log: { t: number; m: string }[] } | null;
  createdAt: string;
  updatedAt: string;
};

/** An API failure that keeps its HTTP status, so a missing recap (404) can be told from a server blip. */
export class RecapApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function json<T>(response: Response, fallback: string): Promise<T> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new RecapApiError(data?.error || fallback, response.status);
  return data as T;
}

export async function listRecaps(): Promise<Recap[]> {
  const data = await json<{ recaps: Recap[] }>(await fetch("/api/recaps", { cache: "no-store" }), "Couldn't load your recaps");
  return data.recaps || [];
}

export async function getRecap(id: string): Promise<Recap> {
  const data = await json<{ recap: Recap }>(await fetch(`/api/recaps/${encodeURIComponent(id)}`, { cache: "no-store" }), "Couldn't load this recap");
  return data.recap;
}

export type NewRecap = {
  url?: string;
  upload?: string;
  uploadName?: string;
  title?: string;
  formats: RecapFormat[];
  longMinutes: number;
  shortSeconds: number;
  voiceId: string;
  tone: RecapTone;
  pace: RecapPace;
  filmTitle?: string;
  channelName?: string;
  music: boolean;
  graphics: boolean;
  captions: boolean;
  transforms: RecapTransforms;
};

export async function createRecap(body: NewRecap): Promise<Recap> {
  const data = await json<{ recap: Recap }>(
    await fetch("/api/recaps", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    "Couldn't start the recap",
  );
  return data.recap;
}

/** Streams a film to the server with progress (fetch can't report upload progress). */
export function uploadFilm(file: File, onProgress: (share: number) => void, signal?: AbortSignal): Promise<{ upload: string; name: string; size: number }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/recaps/uploads");
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.setRequestHeader("X-File-Name", encodeURIComponent(file.name));
    xhr.upload.onprogress = (event) => event.lengthComputable && onProgress(event.loaded / event.total);
    xhr.onload = () => {
      let data: { upload?: string; name?: string; size?: number; error?: string } = {};
      try { data = JSON.parse(xhr.responseText); } catch {}
      if (xhr.status >= 200 && xhr.status < 300 && data.upload) resolve(data as { upload: string; name: string; size: number });
      else reject(new Error(data.error || "The upload didn't finish. Try again, or paste a link."));
    };
    xhr.onerror = () => reject(new Error("The upload was interrupted. Check your connection and try again."));
    signal?.addEventListener("abort", () => { xhr.abort(); reject(new Error("Upload cancelled")); }, { once: true });
    xhr.send(file);
  });
}

export type RecapPost = { id: string; format: RecapFormat; accountId: string; channel: string; title: string; privacy: string; status: "uploading" | "posted" | "failed"; url?: string; error?: string; at: number };
export type PostChannel = { id: string; title: string; handle: string; platform: string; thumbnail: string };
export type PostDraft = { title: string; description: string; tags: string[] };

export async function postChannels(id: string): Promise<PostChannel[]> {
  const data = await json<{ channels: PostChannel[] }>(await fetch(`/api/recaps/${encodeURIComponent(id)}/post/channels`), "Couldn't load your channels");
  return data.channels || [];
}
/** A title, description, and tags for posting to a channel, written the way automation agents write them. */
export async function draftPost(id: string, format: RecapFormat, accountId: string): Promise<PostDraft> {
  const data = await json<{ draft: PostDraft }>(
    await fetch(`/api/recaps/${encodeURIComponent(id)}/post/draft`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ format, accountId }) }),
    "Couldn't write the title and description",
  );
  return data.draft;
}
export async function postRecap(id: string, body: { format: RecapFormat; accountId: string; channel: string; title: string; description: string; tags: string[]; privacy: string }): Promise<Recap> {
  const data = await json<{ recap: Recap }>(
    await fetch(`/api/recaps/${encodeURIComponent(id)}/post`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    "Couldn't start the post",
  );
  return data.recap;
}

/** Adds (a teaser line over a quick montage of the best shots) or removes the long recap's intro. */
export async function setIntro(id: string, on: boolean): Promise<Recap> {
  const data = await json<{ recap: Recap }>(
    await fetch(`/api/recaps/${encodeURIComponent(id)}/intro`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ on }) }),
    on ? "Couldn't write the intro" : "Couldn't remove the intro",
  );
  return data.recap;
}

/** Sets the script's character names to the film's cast list; returns the recap and how many lines changed. */
export async function correctNames(id: string): Promise<{ recap: Recap; changed: number }> {
  return json<{ recap: Recap; changed: number }>(await fetch(`/api/recaps/${encodeURIComponent(id)}/names`, { method: "POST" }), "Couldn't correct the names");
}

export async function saveScript(id: string, script: RecapScript): Promise<Recap> {
  const data = await json<{ recap: Recap }>(
    await fetch(`/api/recaps/${encodeURIComponent(id)}/script`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ script }) }),
    "Couldn't save the script",
  );
  return data.recap;
}

async function act(id: string, action: "render" | "retry" | "cancel" | "back", body?: unknown): Promise<Recap> {
  const data = await json<{ recap: Recap }>(
    await fetch(`/api/recaps/${encodeURIComponent(id)}/${action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) }),
    action === "render" ? "Couldn't start the render" : action === "retry" ? "Couldn't retry" : action === "back" ? "Couldn't go back to the storyboard" : "Couldn't stop it",
  );
  return data.recap;
}
export const renderRecap = (id: string, voiceId?: string, captions?: boolean) => act(id, "render", { voiceId, captions });
export const retryRecap = (id: string, voiceId?: string) => act(id, "retry", voiceId ? { voiceId } : undefined);
export const cancelRecap = (id: string) => act(id, "cancel");
/** Stops a render and reopens the script and its settings. */
export const backToStoryboard = (id: string) => act(id, "back");

export async function deleteRecap(id: string): Promise<void> {
  await json(await fetch(`/api/recaps/${encodeURIComponent(id)}`, { method: "DELETE" }), "Couldn't delete this recap");
}

/** Where shot n sits in the contact sheets: sheet s, column and row inside its 4x3 grid. */
export function shotTile(n: number, sheet = { cols: 4, rows: 3 }) {
  const per = sheet.cols * sheet.rows;
  const index = n % per;
  return { sheet: `s${String(Math.floor(n / per)).padStart(3, "0")}.jpg`, col: index % sheet.cols, row: Math.floor(index / sheet.cols) };
}

export const clock = (seconds: number) => {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`;
};

/** Seconds a text takes as finished narration at a pace (the same rate the script writer budgets for). */
export const spokenSeconds = (text: string, pace?: string) => Math.max(1, (text.trim().split(/\s+/).filter(Boolean).length / narrationWpm(pace)) * 60);

/** "12:04" or "1:02:10" back to seconds; NaN when unreadable. */
export function parseClock(value: string) {
  const parts = value.trim().split(":").map(Number);
  if (!parts.length || parts.some((n) => !Number.isFinite(n) || n < 0)) return NaN;
  return parts.reduce((total, n) => total * 60 + n, 0);
}

/** A saved film source: a site by name and link; a link with {query} is its search address. */
export type FilmSource = { id: string; name: string; url: string };
export type SourceResults = { source: { id: string; name: string }; results: { url: string; title: string; score: number }[]; error?: string };

export async function listSources(): Promise<FilmSource[]> {
  return (await json<{ sources: FilmSource[] }>(await fetch("/api/recaps/sources", { cache: "no-store" }), "Couldn't load your sources")).sources || [];
}
export async function saveSources(sources: (Omit<FilmSource, "id"> & { id?: string })[]): Promise<FilmSource[]> {
  const data = await json<{ sources: FilmSource[] }>(
    await fetch("/api/recaps/sources", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sources }) }),
    "Couldn't save your sources",
  );
  return data.sources;
}
export async function searchFilmSources(query: string): Promise<SourceResults[]> {
  const data = await json<{ results: SourceResults[] }>(
    await fetch("/api/recaps/sources/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query }) }),
    "Couldn't search your sources",
  );
  return data.results;
}
