import { FormEvent, useCallback, useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, Clock3, Film, Layers3, Loader2, Play, RefreshCw, Scissors, Search, Sparkles, Youtube } from "lucide-react";
import { AuthSessionPayload, ConnectedYouTubeAccount, YouTubePlaylistSummary } from "../types";
import { TikTokPlaylist, TikTokVideo, fetchTikTokPlaylist } from "../services/tiktok";
import { cn } from "../lib/utils";

type SortMode = "views" | "oldest" | "newest" | "length";
type PlaylistMode = "none" | "existing" | "create";
type OutputMode = "file" | "upload";
type CompilationJob = {
  id: string;
  status: "queued" | "running" | "done" | "error";
  message?: string;
  result?: any;
  error?: string;
};

function compact(value?: number | string | null): string {
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(Number(value || 0));
}

function durationSeconds(video: TikTokVideo): number {
  const seconds = Number(video.durationSeconds || 0);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
}

function formatDuration(seconds: number): string {
  if (!seconds) return "unknown";
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours) return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

function videoViews(video: TikTokVideo): number {
  return Number(video.stats?.playCount || 0);
}

function videoCreatedAt(video: TikTokVideo): number {
  const value = Number(video.createdAt || 0);
  return Number.isFinite(value) ? value : 0;
}

function sortVideos(videos: TikTokVideo[], sort: SortMode): TikTokVideo[] {
  return [...videos].sort((a, b) => {
    if (sort === "oldest") return videoCreatedAt(a) - videoCreatedAt(b);
    if (sort === "newest") return videoCreatedAt(b) - videoCreatedAt(a);
    if (sort === "length") return durationSeconds(b) - durationSeconds(a);
    return videoViews(b) - videoViews(a);
  });
}

async function readApiJson(response: Response, fallback: string): Promise<any> {
  const text = await response.text();
  let data: any = {};
  if (text.trim()) {
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`${fallback}. Server returned ${response.status}.`);
    }
  }
  if (!response.ok) throw new Error(data.error || fallback);
  return data;
}

export function CompilationStudio({ auth }: { auth: AuthSessionPayload }) {
  const [url, setUrl] = useState("");
  const [count, setCount] = useState(100);
  const [playlist, setPlaylist] = useState<TikTokPlaylist | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<SortMode>("views");
  const [loading, setLoading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [downloadUrl, setDownloadUrl] = useState("");
  const [jobMessage, setJobMessage] = useState("");
  const [outputMode, setOutputMode] = useState<OutputMode>("file");
  const [accountId, setAccountId] = useState(auth.activeAccount?.id || auth.accounts[0]?.id || "");
  const [playlists, setPlaylists] = useState<YouTubePlaylistSummary[]>([]);
  const [playlistMode, setPlaylistMode] = useState<PlaylistMode>("none");
  const [targetPlaylistId, setTargetPlaylistId] = useState("");
  const [createPlaylistTitle, setCreatePlaylistTitle] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [privacyStatus, setPrivacyStatus] = useState("private");
  const [layout, setLayout] = useState<"vertical" | "landscape">("vertical");
  const [minMinutes, setMinMinutes] = useState(30);
  const [maxMinutes, setMaxMinutes] = useState(40);
  const [rightsConfirmed, setRightsConfirmed] = useState(false);

  const account = useMemo<ConnectedYouTubeAccount | null>(() => auth.accounts.find((item) => item.id === accountId) || auth.activeAccount || auth.accounts[0] || null, [accountId, auth.accounts, auth.activeAccount]);
  const sortedVideos = useMemo(() => sortVideos(playlist?.videos || [], sort), [playlist?.videos, sort]);
  const selectedVideos = useMemo(() => sortedVideos.filter((video) => selectedIds.has(video.id)), [selectedIds, sortedVideos]);
  const totalSeconds = useMemo(() => selectedVideos.reduce((sum, video) => sum + durationSeconds(video), 0), [selectedVideos]);
  const targetSeconds = maxMinutes * 60;

  const loadPlaylists = useCallback(async (nextAccountId = accountId) => {
    if (!nextAccountId) {
      setPlaylists([]);
      return;
    }
    try {
      const response = await fetch(`/api/youtube/playlists?accountId=${encodeURIComponent(nextAccountId)}`);
      const data = await readApiJson(response, "Could not load YouTube playlists");
      setPlaylists(data.playlists || []);
    } catch {
      setPlaylists([]);
    }
  }, [accountId]);

  async function loadSource(event: FormEvent) {
    event.preventDefault();
    if (!url.trim()) return;
    setLoading(true);
    setError("");
    setNotice("");
    try {
      const data = await fetchTikTokPlaylist(url.trim(), count, undefined, { forceNetwork: true });
      setPlaylist(data);
      setSelectedIds(new Set());
      if (!title.trim()) setTitle(`${data.title || data.author || "AutoYT"} compilation`.slice(0, 100));
      if (!description.trim()) setDescription(`A curated compilation from ${data.title || data.author || "selected clips"}.`);
      setNotice(`Loaded ${data.videos.length} clips.`);
      void loadPlaylists(accountId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load clips");
    } finally {
      setLoading(false);
    }
  }

  function toggleClip(video: TikTokVideo) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(video.id)) next.delete(video.id);
      else next.add(video.id);
      return next;
    });
  }

  function selectUntilTarget() {
    const next = new Set<string>();
    let total = 0;
    for (const video of sortedVideos) {
      const seconds = durationSeconds(video) || 60;
      if (next.size && total + seconds > targetSeconds) continue;
      next.add(video.id);
      total += seconds;
      if (total >= minMinutes * 60) break;
    }
    setSelectedIds(next);
  }

  async function createCompilation() {
    if (outputMode === "upload" && !account) {
      setError("Connect a YouTube channel first.");
      return;
    }
    if (!selectedVideos.length) {
      setError("Select clips before creating a compilation.");
      return;
    }
    setProcessing(true);
    setError("");
    setNotice("");
    setDownloadUrl("");
    setJobMessage("");
    try {
      const response = await fetch("/api/compilations/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId: account?.id || "",
          videos: selectedVideos,
          sourceTitle: playlist?.title || playlist?.author || "",
          title: title.trim(),
          description: description.trim(),
          privacyStatus,
          layout,
          playlistId: playlistMode === "existing" ? targetPlaylistId : "",
          createPlaylistTitle: playlistMode === "create" ? createPlaylistTitle : "",
          minMinutes,
          maxMinutes,
          outputMode: outputMode === "file" ? "download" : "upload",
          rightsConfirmed,
        }),
      });
      const data = await readApiJson(response, "Could not create compilation");
      if (data.job?.id) {
        setJobMessage(data.job.message || "Compilation queued");
        await pollCompilationJob(data.job.id);
      } else {
        handleCompilationResult(data.result);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create compilation");
    } finally {
      setProcessing(false);
    }
  }

  function handleCompilationResult(result: any) {
    if (outputMode === "file") {
      const fileUrl = result?.file?.downloadUrl || "";
      setDownloadUrl(fileUrl);
      setNotice(fileUrl ? "Compilation file is ready." : "Compilation file created.");
    } else {
      const uploadedTitle = result?.upload?.title || "Compilation";
      const uploadedUrl = result?.upload?.url || "";
      setNotice(uploadedUrl ? `${uploadedTitle} uploaded: ${uploadedUrl}` : `${uploadedTitle} uploaded.`);
    }
  }

  async function pollCompilationJob(jobId: string) {
    for (let attempt = 0; attempt < 720; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, attempt < 6 ? 3000 : 5000));
      const response = await fetch(`/api/compilations/jobs/${encodeURIComponent(jobId)}`);
      const data = await readApiJson(response, "Could not load compilation progress");
      const job: CompilationJob | undefined = data.job;
      if (!job) throw new Error("Compilation job not found");
      setJobMessage(job.message || job.status);
      if (job.status === "done") {
        handleCompilationResult(job.result);
        return;
      }
      if (job.status === "error") {
        throw new Error(job.error || job.message || "Compilation failed");
      }
    }
    throw new Error("Compilation is still running. Refresh the page and try again in a few minutes.");
  }

  return (
    <div className="min-w-0 space-y-6 overflow-x-clip">
      <header className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-[#FF0033]/10 text-[#FF0033]">
            <Layers3 className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-widest text-[#FF0033]">Compilation studio</p>
            <h1 className="font-serif text-2xl font-bold tracking-tight text-[#1A1A1A] sm:text-3xl md:text-4xl">Turn short clips into long videos.</h1>
          </div>
        </div>
        <div className="grid w-full grid-cols-3 gap-2 rounded-2xl border border-[#1A1A1A]/8 bg-white p-2 shadow-sm sm:w-auto">
          <MiniStat label="Selected" value={String(selectedVideos.length)} />
          <MiniStat label="Length" value={formatDuration(totalSeconds)} />
          <MiniStat label="Target" value={`${minMinutes}-${maxMinutes}m`} />
        </div>
      </header>

      {error ? <Notice tone="error" title="Request error" body={error} /> : null}
      {notice ? <Notice tone="success" title="Ready" body={notice} /> : null}
      {jobMessage && processing ? <Notice tone="info" title="Working" body={jobMessage} /> : null}
      {downloadUrl ? (
        <a href={downloadUrl} className="inline-flex h-11 items-center justify-center rounded-xl bg-[#1A1A1A] px-5 text-xs font-black text-white shadow-sm transition hover:bg-[#FF0033]">
          Download compilation
        </a>
      ) : null}

      <section className="rounded-2xl border border-[#1A1A1A]/8 bg-white p-4 shadow-sm md:p-5">
        <form onSubmit={loadSource} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_120px] lg:grid-cols-[minmax(0,1fr)_120px_150px]">
          <label className="relative min-w-0">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#1A1A1A]/35" />
            <input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="Paste TikTok playlist, channel, search, or collection URL" className="h-12 w-full rounded-xl border border-[#1A1A1A]/10 bg-[#FDFCFA] pl-11 pr-4 text-sm font-semibold outline-none transition focus:border-[#FF0033]/40 focus:ring-2 focus:ring-[#FF0033]/10" />
          </label>
          <input type="number" min={1} max={5000} value={count} onChange={(event) => setCount(Number(event.target.value))} className="h-12 rounded-xl border border-[#1A1A1A]/10 bg-[#FDFCFA] px-4 text-sm font-bold outline-none transition focus:border-[#FF0033]/40" />
          <button type="submit" disabled={loading || !url.trim()} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[#1A1A1A] px-5 py-3 text-xs font-bold text-white shadow-sm transition hover:bg-[#FF0033] disabled:opacity-50 sm:col-span-2 lg:col-span-1">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Load clips
          </button>
        </form>
      </section>

      {playlist ? (
        <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(280px,360px)]">
          <div className="rounded-2xl border border-[#1A1A1A]/8 bg-white shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#1A1A1A]/8 p-4">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-widest text-[#FF0033]">{playlist.author || "Source"}</p>
                <h2 className="mt-1 font-serif text-2xl font-bold text-[#1A1A1A]">{playlist.title || "Selected source"}</h2>
              </div>
              <div className="flex flex-wrap gap-2">
                <select value={sort} onChange={(event) => setSort(event.target.value as SortMode)} className="h-10 rounded-xl border border-[#1A1A1A]/10 bg-[#FDFCFA] px-3 text-xs font-bold outline-none">
                  <option value="views">Views high to low</option>
                  <option value="newest">Newest first</option>
                  <option value="oldest">Oldest first</option>
                  <option value="length">Longest first</option>
                </select>
                <button type="button" onClick={selectUntilTarget} className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#FFDE32] px-4 text-xs font-bold text-[#1A1A1A] transition hover:bg-[#FF0033] hover:text-white">
                  <Sparkles className="h-4 w-4" />
                  Auto-select
                </button>
                <button type="button" onClick={() => setSelectedIds(new Set())} className="inline-flex h-10 items-center rounded-xl border border-[#1A1A1A]/10 bg-white px-4 text-xs font-bold text-[#1A1A1A]/60 transition hover:text-[#FF0033]">
                  Clear
                </button>
              </div>
            </div>
            <div className="max-h-[min(720px,70dvh)] overflow-auto p-3">
              <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,18rem),1fr))] gap-3">
                {sortedVideos.map((video) => {
                  const selected = selectedIds.has(video.id);
                  return (
                    <button key={video.id} type="button" onClick={() => toggleClip(video)} className={cn("grid min-h-24 grid-cols-[78px_minmax(0,1fr)] gap-3 rounded-xl border p-2 text-left transition", selected ? "border-[#FF0033]/45 bg-[#FF0033]/5 shadow-sm" : "border-[#1A1A1A]/8 bg-[#FDFCFA] hover:border-[#FF0033]/25")}>
                      <div className="relative aspect-[9/16] overflow-hidden rounded-lg bg-[#FFECEF]">
                        {video.dynamicCover ? <img src={video.dynamicCover} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" /> : <div className="grid h-full w-full place-items-center text-[#FF0033]"><Film className="h-6 w-6" /></div>}
                        <span className="absolute bottom-1 left-1 rounded bg-[#1A1A1A]/80 px-1.5 py-0.5 text-[10px] font-bold text-white">{formatDuration(durationSeconds(video))}</span>
                      </div>
                      <div className="min-w-0 py-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate text-xs font-bold text-[#FF0033]">{video.authorHandle || video.author}</p>
                          <span className={cn("grid h-5 w-5 place-items-center rounded-full border text-[10px]", selected ? "border-[#FF0033] bg-[#FF0033] text-white" : "border-[#1A1A1A]/15 text-transparent")}>{selected ? "OK" : ""}</span>
                        </div>
                        <h3 className="mt-1 line-clamp-2 text-sm font-black leading-snug text-[#1A1A1A]">{video.title || "Untitled clip"}</h3>
                        <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-bold text-[#1A1A1A]/45">
                          <span className="rounded-lg bg-white px-2 py-1">{compact(videoViews(video))} views</span>
                          <span className="rounded-lg bg-white px-2 py-1">{compact(video.stats?.commentCount)} comments</span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <aside className="space-y-4">
            <section className="rounded-2xl border border-[#1A1A1A]/8 bg-white p-4 shadow-sm">
              <SectionTitle icon={<Scissors className="h-4 w-4" />} title="Compile settings" />
              <div className="mt-4 grid gap-3">
                <Field label="Mode">
                  <div className="grid grid-cols-2 gap-2 rounded-xl border border-[#1A1A1A]/10 bg-[#F9F8F6] p-1">
                    <button type="button" onClick={() => setOutputMode("file")} className={cn("h-10 rounded-lg text-xs font-black transition", outputMode === "file" ? "bg-[#FFDE32] text-[#1A1A1A] shadow-sm" : "text-[#1A1A1A]/55 hover:text-[#FF0033]")}>
                      Create file
                    </button>
                    <button type="button" onClick={() => setOutputMode("upload")} className={cn("h-10 rounded-lg text-xs font-black transition", outputMode === "upload" ? "bg-[#FFDE32] text-[#1A1A1A] shadow-sm" : "text-[#1A1A1A]/55 hover:text-[#FF0033]")}>
                      Upload to YouTube
                    </button>
                  </div>
                </Field>
                {outputMode === "upload" ? (
                  <Field label="Channel">
                    <select value={accountId} onChange={(event) => { setAccountId(event.target.value); void loadPlaylists(event.target.value); }} className="input bg-white">
                      {auth.accounts.map((item) => <option key={item.id} value={item.id}>{item.channelTitle}</option>)}
                    </select>
                  </Field>
                ) : null}
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Min minutes"><input type="number" min={1} max={240} value={minMinutes} onChange={(event) => setMinMinutes(Number(event.target.value))} className="input bg-white" /></Field>
                  <Field label="Max minutes"><input type="number" min={1} max={300} value={maxMinutes} onChange={(event) => setMaxMinutes(Number(event.target.value))} className="input bg-white" /></Field>
                </div>
                <Field label="Format">
                  <select value={layout} onChange={(event) => setLayout(event.target.value as "vertical" | "landscape")} className="input bg-white">
                    <option value="vertical">Vertical 9:16</option>
                    <option value="landscape">Landscape 16:9</option>
                  </select>
                </Field>
                {outputMode === "upload" ? (
                  <>
                    <Field label="Visibility">
                      <select value={privacyStatus} onChange={(event) => setPrivacyStatus(event.target.value)} className="input bg-white">
                        <option value="private">Private</option>
                        <option value="unlisted">Unlisted</option>
                        <option value="public">Public</option>
                      </select>
                    </Field>
                    <Field label="YouTube playlist">
                      <select value={playlistMode} onChange={(event) => setPlaylistMode(event.target.value as PlaylistMode)} className="input bg-white">
                        <option value="none">No playlist</option>
                        <option value="existing">Existing playlist</option>
                        <option value="create">Create new playlist</option>
                      </select>
                    </Field>
                    {playlistMode === "existing" ? (
                      <Field label="Playlist">
                        <select value={targetPlaylistId} onChange={(event) => setTargetPlaylistId(event.target.value)} className="input bg-white">
                          <option value="">Choose playlist</option>
                          {playlists.map((item) => <option key={item.id} value={item.id}>{item.title}{item.videoCount !== undefined ? ` (${item.videoCount})` : ""}</option>)}
                        </select>
                      </Field>
                    ) : null}
                    {playlistMode === "create" ? (
                      <Field label="New playlist name">
                        <input value={createPlaylistTitle} onChange={(event) => setCreatePlaylistTitle(event.target.value)} className="input bg-white" placeholder="Anime Recap Compilations" />
                      </Field>
                    ) : null}
                  </>
                ) : null}
              </div>
            </section>

            <section className="rounded-2xl border border-[#1A1A1A]/8 bg-white p-4 shadow-sm">
              <SectionTitle icon={<Youtube className="h-4 w-4" />} title="Upload details" />
              <div className="mt-4 grid gap-3">
                <Field label="Title"><input value={title} onChange={(event) => setTitle(event.target.value)} className="input bg-white" /></Field>
                <Field label="Description"><textarea value={description} onChange={(event) => setDescription(event.target.value)} className="input min-h-24 bg-white py-3 leading-6" /></Field>
                <label className="flex items-start gap-3 rounded-xl border border-[#FFDE32]/70 bg-[#FFDE32]/20 p-3 text-xs font-bold leading-5 text-[#1A1A1A]/75">
                  <input type="checkbox" checked={rightsConfirmed} onChange={(event) => setRightsConfirmed(event.target.checked)} className="mt-1" />
                  I have rights or permission to compile and upload these clips.
                </label>
                <button type="button" onClick={createCompilation} disabled={processing || !selectedVideos.length || !rightsConfirmed} className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-[#FFDE32] px-5 text-xs font-black text-[#1A1A1A] shadow-sm transition hover:bg-[#FF0033] hover:text-white disabled:opacity-45">
                  {processing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                  {outputMode === "file" ? "Create file" : "Create and upload"}
                </button>
              </div>
            </section>
          </aside>
        </section>
      ) : (
        <section className="rounded-2xl border border-dashed border-[#1A1A1A]/12 bg-white p-10 text-center shadow-sm">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[#FF0033]/10 text-[#FF0033]"><Clock3 className="h-6 w-6" /></div>
          <h2 className="mt-4 font-serif text-2xl font-bold text-[#1A1A1A]">Load a source to start selecting clips.</h2>
        </section>
      )}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-[84px] rounded-xl bg-[#F9F8F6] px-3 py-2">
      <p className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/35">{label}</p>
      <p className="mt-1 text-sm font-black text-[#1A1A1A]">{value}</p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40">{label}</span>
      {children}
    </label>
  );
}

function SectionTitle({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="grid h-8 w-8 place-items-center rounded-lg bg-[#FF0033]/10 text-[#FF0033]">{icon}</span>
      <h3 className="text-sm font-black text-[#1A1A1A]">{title}</h3>
    </div>
  );
}

function Notice({ title, body, tone = "success" }: { title: string; body: string; tone?: "success" | "error" | "info" }) {
  const isError = tone === "error";
  const isInfo = tone === "info";
  return (
    <div className={cn("flex gap-3 rounded-2xl border p-4 text-sm shadow-sm", isError ? "border-red-200 bg-red-50 text-red-800" : isInfo ? "border-[#FFDE32]/60 bg-[#FFDE32]/15 text-[#1A1A1A]" : "border-green-200 bg-green-50 text-green-800")}>
      <div className="mt-0.5 shrink-0">{isError ? <AlertCircle className="h-4 w-4" /> : isInfo ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}</div>
      <div>
        <p className="font-black">{title}</p>
        <p className="mt-1 font-semibold leading-6 opacity-80">{body}</p>
      </div>
    </div>
  );
}
