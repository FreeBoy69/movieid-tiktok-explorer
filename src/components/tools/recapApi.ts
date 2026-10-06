// Client for /api/recaps (server/movieRecap.js).

export type RecapFormat = "long" | "short";
export type RecapTone = "dramatic" | "suspense" | "funny" | "calm";
export type RecapTransforms = { zoom: boolean; color: boolean; mirror: boolean; speed: boolean };
export type RecapBeat = { id: string; text: string; from: number; to: number; shots: number[] };
export type RecapScript = {
  title: string;
  logline?: string;
  long?: { beats: RecapBeat[] };
  short?: { title?: string; beats: RecapBeat[] };
};
export type RecapStats = { cuts: number; footageSeconds: number; filmShare: number; averageCut: number; shortestGap: number; seconds: number };
export type RecapOutput = { format: RecapFormat; file: string; url: string; size: number; duration: number };
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
    language: string;
    captions: boolean;
    transforms: RecapTransforms;
  };
  film?: { duration: number; shots: number; scenes: number; lines: number; shotEvery: number; sheet: { cols: number; rows: number; count: number } };
  outputs: RecapOutput[];
  /** Vibe Edit project ids, one per rendered format, where the finished recap opens for tweaks and export. */
  vibe: Partial<Record<RecapFormat, string>>;
  stats?: Partial<Record<RecapFormat, RecapStats>>;
  script?: RecapScript | null;
  source: { kind: "link" | "upload"; name: string };
  createdAt: string;
  updatedAt: string;
};

async function json<T>(response: Response, fallback: string): Promise<T> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || fallback);
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

export async function saveScript(id: string, script: RecapScript): Promise<Recap> {
  const data = await json<{ recap: Recap }>(
    await fetch(`/api/recaps/${encodeURIComponent(id)}/script`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ script }) }),
    "Couldn't save the script",
  );
  return data.recap;
}

async function act(id: string, action: "render" | "retry" | "cancel", body?: unknown): Promise<Recap> {
  const data = await json<{ recap: Recap }>(
    await fetch(`/api/recaps/${encodeURIComponent(id)}/${action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) }),
    action === "render" ? "Couldn't start the render" : action === "retry" ? "Couldn't retry" : "Couldn't stop it",
  );
  return data.recap;
}
export const renderRecap = (id: string, voiceId?: string) => act(id, "render", { voiceId });
export const retryRecap = (id: string) => act(id, "retry");
export const cancelRecap = (id: string) => act(id, "cancel");

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

/** Spoken length of narration at about 150 words a minute. */
export const spokenSeconds = (text: string) => Math.max(1, (text.trim().split(/\s+/).filter(Boolean).length / 150) * 60);

/** "12:04" or "1:02:10" back to seconds; NaN when unreadable. */
export function parseClock(value: string) {
  const parts = value.trim().split(":").map(Number);
  if (!parts.length || parts.some((n) => !Number.isFinite(n) || n < 0)) return NaN;
  return parts.reduce((total, n) => total * 60 + n, 0);
}
