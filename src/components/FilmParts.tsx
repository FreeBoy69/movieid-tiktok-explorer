// Create Film: the pieces the four formats add to Create Drama's pages. The
// hub that picks a format, the song intake and lyrics editor a music video
// starts from, and the cinema look (camera rig and grade from Cinema Studio)
// every film can lock once and carry into each storyboard and clip.
import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, ArrowUpRight, Camera, Clapperboard, Drama, Film, Link2, Loader2, Music2, Pause, Play, Plus, Scissors, Trash2, Upload, Wand2 } from "lucide-react";
import { creatorApi, PageHead } from "./CreatorWorkspace";
import { writeDeepLink, type FilmRoute } from "../utils/tiktokRoute";
import { FILM_FORMATS, normalizeLyrics } from "../utils/filmFormats.js";
import { CINEMA_GENRES, CINEMA_LIGHTING, CINEMA_MOVESETS, CINEMA_PALETTES, CINEMA_RIG, CINEMA_SPEED_RAMPS } from "../utils/cinemaPresets";
import { toast } from "../utils/toast";
import { cameraLabel, cameraOption, cameraOptions } from "../utils/cameraShots.js";
import { rescaleBeats } from "../utils/beatTrack.js";

export type FilmFormatId = "series" | "short" | "long" | "music";
export type LyricLine = { id: string; start: number; end: number; text: string };
export type BeatGrid = { bpm: number; beats: number[]; bars: number[] };
export type Song = { file: string; url: string; name: string; duration: number; lyrics: LyricLine[]; engine?: string; grid?: BeatGrid | null };
export type FilmCinema = Partial<{ camera: string; lens: string; focalLength: number; aperture: string; genre: string; palette: string; lighting: string; moveset: string; speed: string }>;

export const formatOfRoute = (route?: FilmRoute | string): FilmFormatId =>
  route === "short" || route === "long" || route === "music" ? route : "series";

/** The format a /film/<format>/… URL is on; Create Series lives at /drama. */
export function currentFilmRoute(): FilmFormatId {
  const match = typeof window === "undefined" ? null : window.location.pathname.match(/^\/film\/(short|long|music|series)(\/|$)/);
  return match ? (match[1] as FilmFormatId) : "series";
}
/** Navigate inside a format's pages, keeping the format in the URL. */
export function filmLink(link: { seriesId?: string; episodeId?: string } = {}, format: FilmFormatId = currentFilmRoute()) {
  writeDeepLink({ view: "drama", ...(format === "series" ? {} : { filmFormat: format }), ...link });
}

const FORMAT_ICONS: Record<FilmFormatId, typeof Film> = { series: Drama, short: Clapperboard, long: Film, music: Music2 };
export const formatIcon = (format: FilmFormatId, size = 18) => {
  const Icon = FORMAT_ICONS[format];
  return <Icon size={size} aria-hidden="true" />;
};

// ---------- Hub ----------
type SeriesSummary = { id: string; title: string; format?: FilmFormatId; updatedAt: number; poster: string; status: string; made?: number; rendered?: number; episodeCount: number };

export function FilmHub({ accountId, onError }: { accountId: string; onError: (e: string) => void }) {
  const [projects, setProjects] = useState<SeriesSummary[] | null>(null);
  useEffect(() => {
    let live = true;
    creatorApi(`/api/drama/series?accountId=${encodeURIComponent(accountId)}`)
      .then((data) => live && setProjects((data.series || []).filter((item: SeriesSummary) => item.status !== "archived")))
      .catch((e) => live && onError(e.message));
    return () => {
      live = false;
    };
  }, [accountId]);
  const recent = (projects || []).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 8);
  return (
    <div className="maker-scroll">
      <div className="maker-page is-wide dr-page">
        <PageHead centered title="Create Film" text="One pipeline, four kinds of film. Lock the cast and the look once, then every scene keeps them." />
        <ul className="fl-formats">
          {(Object.keys(FILM_FORMATS) as FilmFormatId[]).map((id) => {
            const format = FILM_FORMATS[id];
            return (
              <li key={id}>
                <button type="button" className="fl-format" data-format={id} onClick={() => filmLink({}, id)}>
                  <span className="fl-format-icon">{formatIcon(id, 22)}</span>
                  <strong>{format.label}</strong>
                  <span>{format.tagline}</span>
                  <small>
                    {id === "music"
                      ? "Song → lyrics → concept → scenes cut to the music"
                      : id === "series"
                        ? `${format.count.min}–${format.count.max} episodes · ${format.lengths[0].label}–${format.lengths[format.lengths.length - 1].label} each`
                        : id === "long"
                          ? `${format.count.min}–${format.count.max} parts · ${format.lengths[0].label}–${format.lengths[format.lengths.length - 1].label} each`
                          : `${format.lengths[0].label}–${format.lengths[format.lengths.length - 1].label}`}
                  </small>
                  <ArrowUpRight size={16} className="fl-format-go" aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
        <section aria-labelledby="fl-recent">
          <div className="maker-section-title">
            <h2 id="fl-recent">Recent</h2>
            <small className="dr-count">{projects ? `${projects.length} projects` : "Loading…"}</small>
          </div>
          {projects === null ? (
            <div className="maker-loading"><Loader2 className="animate-spin" />Loading projects</div>
          ) : recent.length ? (
            <ul className="fl-recent">
              {recent.map((item) => {
                const format = formatOfRoute(item.format);
                return (
                  <li key={item.id}>
                    <button type="button" className="fl-recent-row" onClick={() => filmLink({ seriesId: item.id }, format)}>
                      <span className="fl-recent-cover">{item.poster ? <img src={item.poster} alt="" loading="lazy" /> : formatIcon(format, 18)}</span>
                      <span className="fl-recent-meta">
                        <strong>{item.title}</strong>
                        <small>{FILM_FORMATS[format].label}{format === "series" || format === "long" ? ` · ${item.made || 0} of ${item.episodeCount} ${FILM_FORMATS[format].units.toLowerCase()} started` : item.rendered ? " · rendered" : ""}</small>
                      </span>
                      <ArrowUpRight size={15} aria-hidden="true" />
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="dr-hint">Nothing yet. Pick a format above to start your first film.</p>
          )}
        </section>
      </div>
    </div>
  );
}

// ---------- Time helpers ----------
export const clock = (t: number) => {
  const s = Math.max(0, Number(t) || 0);
  return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;
};
function parseClock(text: string): number | null {
  const m = String(text).trim().match(/^(?:(\d+):)?(\d+(?:\.\d+)?)$/);
  if (!m) return null;
  return (Number(m[1]) || 0) * 60 + Number(m[2]);
}

// ---------- Song intake ----------
const SONG_TYPES = "audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/mp4,audio/x-m4a,audio/ogg,video/mp4,video/quicktime,video/webm";

export function SongStart({ onReady, onError }: { onReady: (song: Song) => void; onError: (e: string) => void }) {
  const [phase, setPhase] = useState<"idle" | "uploading" | "analyzing">("idle");
  const [progress, setProgress] = useState("");
  const [link, setLink] = useState("");
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const cancelled = useRef(false);
  useEffect(() => {
    // Reset on (re)mount: StrictMode mounts twice, and polling must survive that.
    cancelled.current = false;
    return () => {
      cancelled.current = true;
    };
  }, []);

  async function analyze(file: string, url: string, name: string) {
    setPhase("analyzing");
    setProgress("Starting");
    const { job } = await creatorApi("/api/film/song/analyze", { file });
    for (;;) {
      await new Promise((r) => setTimeout(r, 2500));
      if (cancelled.current) return;
      const data = await creatorApi(`/api/film/song/analyze/${encodeURIComponent(job.id)}`);
      if (data.job.status === "done") {
        onReady({ file, url, name, duration: data.job.result.duration, lyrics: data.job.result.lyrics, engine: data.job.result.engine, grid: data.job.result.grid || null });
        return;
      }
      if (data.job.status === "failed") throw new Error(data.job.error || "Could not read the song");
      setProgress(data.job.progress || "Working");
    }
  }
  async function fromFile(file: File) {
    const audio = file.type.startsWith("audio/");
    if (!audio && !file.type.startsWith("video/")) return onError(`${file.name} isn't an audio or video file.`);
    if (audio && file.size > 20 * 1024 * 1024) return onError("Audio files can be up to 20 MB. Use an MP3, or a video file up to 200 MB.");
    setPhase("uploading");
    try {
      const response = await fetch("/api/studio/uploads", { method: "POST", headers: { "Content-Type": file.type }, body: file });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Upload failed");
      await analyze(data.file, data.url, file.name.replace(/\.[^.]+$/, ""));
    } catch (error) {
      onError((error as Error).message);
      setPhase("idle");
    }
  }
  async function fromLink() {
    const url = link.trim();
    if (!url) return;
    setPhase("uploading");
    try {
      const data = await creatorApi("/api/studio/imports", { url, kind: "video" });
      await analyze(data.file, data.url, data.name || "Song");
    } catch (error) {
      onError((error as Error).message);
      setPhase("idle");
    }
  }

  if (phase !== "idle")
    return (
      <div className="fl-song-busy" role="status" aria-live="polite">
        <Loader2 size={22} className="animate-spin" />
        <strong>{phase === "uploading" ? "Bringing in the song" : progress}</strong>
        <span>We find the beat, then separate the vocals so the lyrics read cleanly. A three-minute song takes a minute or two.</span>
      </div>
    );
  return (
    <div
      className={`fl-song-drop${over ? " is-over" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const file = e.dataTransfer.files[0];
        if (file) void fromFile(file);
      }}
    >
      <Music2 size={26} aria-hidden="true" />
      <strong>Start from your song</strong>
      <span>Drop an MP3, WAV, or M4A (up to 20 MB) or a video of it. We find the tempo and beat, separate the vocals, transcribe the lyrics with timings, and you fix anything we misheard.</span>
      <div className="fl-song-actions">
        <button type="button" className="maker-primary" onClick={() => input.current?.click()}>
          <Upload size={15} /> Choose a song
        </button>
        <form
          className="fl-song-link"
          onSubmit={(e) => {
            e.preventDefault();
            void fromLink();
          }}
        >
          <Link2 size={15} aria-hidden="true" />
          <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="or paste a YouTube or TikTok link" aria-label="Song link" />
          <button type="submit" className="maker-outline" disabled={!link.trim()}>
            Import
          </button>
        </form>
      </div>
      <small>Use music you have the rights to.</small>
      <input
        ref={input}
        type="file"
        hidden
        accept={SONG_TYPES}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void fromFile(file);
        }}
      />
    </div>
  );
}

// ---------- Lyrics editor ----------
export function LyricsEditor({ lines, duration, src, onChange, saving, onSave, grid }: { lines: LyricLine[]; duration: number; src: string; onChange: (next: LyricLine[]) => void; saving?: boolean; onSave?: () => void; grid?: BeatGrid | null }) {
  const audio = useRef<HTMLAudioElement>(null);
  const pulse = useRef<HTMLSpanElement>(null);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [paste, setPaste] = useState<string | null>(null);
  const sorted = useMemo(() => [...lines].sort((a, b) => a.start - b.start), [lines]);
  const current = sorted.findIndex((line) => time >= line.start && time < line.end);
  const update = (id: string, patch: Partial<LyricLine>) => onChange(lines.map((line) => (line.id === id ? { ...line, ...patch } : line)));
  // A dot that flashes on every beat (brighter on the bar) while the song plays,
  // so a wrong tempo is easy to see and hear. Driven per frame, outside React.
  useEffect(() => {
    if (!playing || !grid?.beats.length) return;
    const bars = new Set(grid.bars);
    let frame = 0;
    const tick = () => {
      const t = audio.current?.currentTime ?? 0;
      let lo = 0;
      let hi = grid.beats.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (grid.beats[mid] <= t) lo = mid;
        else hi = mid - 1;
      }
      const beat = grid.beats[lo];
      const on = beat <= t && t - beat < 0.12;
      pulse.current?.classList.toggle("is-on", on);
      pulse.current?.classList.toggle("is-bar", on && bars.has(beat));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      pulse.current?.classList.remove("is-on", "is-bar");
    };
  }, [playing, grid]);
  const playFrom = (t: number) => {
    const el = audio.current;
    if (!el) return;
    el.currentTime = t;
    void el.play();
  };
  const newId = () => `l${Math.random().toString(36).slice(2, 7)}`;

  // Pasting the official lyrics keeps the detected timings and swaps the words in, line by line.
  function applyPaste() {
    const texts = String(paste || "").split(/\r?\n/).map((t) => t.trim()).filter(Boolean);
    if (!texts.length) return setPaste(null);
    const next: LyricLine[] = texts.map((text, i) => {
      const at = sorted[i];
      if (at) return { ...at, text };
      const last = sorted[sorted.length - 1];
      const start = Math.min(duration - 1, (last?.end || 0) + (i - sorted.length) * 3);
      return { id: newId(), start, end: Math.min(duration, start + 3), text };
    });
    onChange(normalizeLyrics(next, duration) as LyricLine[]);
    setPaste(null);
    toast.success(`Lyrics replaced: ${texts.length} lines on the detected timings`);
  }

  return (
    <div className="fl-lyrics">
      <div className="fl-lyrics-bar">
        <button type="button" className="fl-round" onClick={() => (playing ? audio.current?.pause() : void audio.current?.play())} aria-label={playing ? "Pause the song" : "Play the song"}>
          {playing ? <Pause size={15} /> : <Play size={15} />}
        </button>
        <input type="range" min={0} max={Math.max(1, duration)} step={0.1} value={time} onChange={(e) => audio.current && (audio.current.currentTime = Number(e.target.value))} aria-label="Song position" />
        <span className="fl-clock">{clock(time)} / {clock(duration)}</span>
        {grid?.bpm ? (
          <span className="fl-bpm" title="Flashes on every beat while the song plays">
            <span ref={pulse} className="fl-pulse" aria-hidden="true" /> <span className="fl-bpm-label">{Math.round(grid.bpm)} BPM</span>
          </span>
        ) : null}
        <button type="button" className="maker-outline dr-small" onClick={() => setPaste(sorted.map((line) => line.text).join("\n"))}>
          Paste lyrics
        </button>
        {onSave ? (
          <button type="button" className="maker-primary dr-small" onClick={onSave} disabled={saving}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : null} Save lyrics
          </button>
        ) : null}
        <audio ref={audio} src={src} preload="metadata" onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} />
      </div>
      {paste !== null ? (
        <div className="fl-paste">
          <textarea rows={8} value={paste} onChange={(e) => setPaste(e.target.value)} aria-label="Official lyrics, one line per row" />
          <p className="dr-hint">One line per row. Each row takes the timing of the line in the same position; extra rows are added after the last one.</p>
          <div className="dr-row dr-row-end">
            <button type="button" className="maker-outline" onClick={() => setPaste(null)}>Cancel</button>
            <button type="button" className="maker-primary" onClick={applyPaste}>Use these lyrics</button>
          </div>
        </div>
      ) : null}
      {sorted.length ? (
        <ol className="fl-lyric-list">
          {sorted.map((line, i) => (
            <li key={line.id} className={i === current ? "is-now" : ""}>
              <button type="button" className="fl-round is-small" onClick={() => playFrom(line.start)} aria-label={`Play from ${clock(line.start)}`}>
                <Play size={12} />
              </button>
              <TimeField value={line.start} onChange={(start) => update(line.id, { start: Math.min(start, line.end - 0.2) })} label="Start" />
              <TimeField value={line.end} onChange={(end) => update(line.id, { end: Math.max(end, line.start + 0.2) })} label="End" />
              <input className="fl-lyric-text" value={line.text} maxLength={200} onChange={(e) => update(line.id, { text: e.target.value })} aria-label={`Lyric at ${clock(line.start)}`} />
              <button
                type="button"
                className="maker-icon fl-split"
                title="Split this line in two"
                aria-label="Split line"
                onClick={() => {
                  const words = line.text.split(/\s+/);
                  if (words.length < 2) return;
                  const half = Math.ceil(words.length / 2);
                  const mid = line.start + (line.end - line.start) / 2;
                  onChange(lines.flatMap((item) => (item.id === line.id ? [{ ...line, end: mid, text: words.slice(0, half).join(" ") }, { id: newId(), start: mid, end: line.end, text: words.slice(half).join(" ") }] : [item])));
                }}
              >
                <Scissors size={14} />
              </button>
              <button type="button" className="maker-icon" aria-label="Delete line" onClick={() => onChange(lines.filter((item) => item.id !== line.id))}>
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <p className="dr-hint">No sung lyrics were found. It can still be a music video: add lines below, or leave it instrumental.</p>
      )}
      <button
        type="button"
        className="maker-ghost dr-small"
        onClick={() => {
          const at = Math.min(Math.max(0, duration - 2), time);
          onChange([...lines, { id: newId(), start: at, end: Math.min(duration, at + 3), text: "New line" }]);
        }}
      >
        <Plus size={14} /> Add a line at {clock(Math.min(Math.max(0, duration - 2), time))}
      </button>
    </div>
  );
}

function TimeField({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) {
  const [draft, setDraft] = useState(clock(value));
  useEffect(() => setDraft(clock(value)), [value]);
  return (
    <input
      className="fl-time"
      value={draft}
      aria-label={label}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const parsed = parseClock(draft);
        if (parsed === null) setDraft(clock(value));
        else onChange(Math.round(parsed * 10) / 10);
      }}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
    />
  );
}

// ---------- Cinema look ----------
const opt = (value: string, label: string) => ({ value, label });
const LOOK_FIELDS: Array<{ key: keyof FilmCinema; label: string; options: Array<{ value: string; label: string }> }> = [
  { key: "camera", label: "Camera", options: Object.keys(CINEMA_RIG.cameras).map((name) => opt(name, name)) },
  { key: "lens", label: "Lens", options: Object.keys(CINEMA_RIG.lenses).map((name) => opt(name, name)) },
  { key: "focalLength", label: "Focal length", options: Object.entries(CINEMA_RIG.focal).map(([mm, text]) => opt(mm, `${mm}mm · ${text}`)) },
  { key: "aperture", label: "Aperture", options: Object.entries(CINEMA_RIG.apertures).map(([f, text]) => opt(f, `${f} · ${String(text).split(",")[0]}`)) },
  { key: "genre", label: "Genre", options: CINEMA_GENRES.filter((g) => g.text).map((g) => opt(g.id, g.name)) },
  { key: "palette", label: "Palette", options: CINEMA_PALETTES.filter((g) => g.text).map((g) => opt(g.id, g.name)) },
  { key: "lighting", label: "Lighting", options: CINEMA_LIGHTING.filter((g) => g.text).map((g) => opt(g.id, g.name)) },
  { key: "moveset", label: "Camera moves", options: CINEMA_MOVESETS.filter((g) => g.text).map((g) => opt(g.id, g.name)) },
  { key: "speed", label: "Speed", options: CINEMA_SPEED_RAMPS.filter((g) => g.text).map((g) => opt(g.id, g.name)) },
];

export function CinemaLookPanel({ cinema, onSave }: { cinema: FilmCinema; onSave: (next: FilmCinema) => Promise<boolean> }) {
  const [draft, setDraft] = useState<FilmCinema>(cinema || {});
  const [saving, setSaving] = useState(false);
  useEffect(() => setDraft(cinema || {}), [cinema]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(cinema || {});
  return (
    <section className="fl-look" aria-labelledby="fl-look-title">
      <div className="maker-section-title">
        <h2 id="fl-look-title"><Camera size={16} aria-hidden="true" /> Cinema look</h2>
        <small className="dr-count">From Cinema Studio</small>
      </div>
      <p className="dr-hint">The camera body, glass, and grade every storyboard and clip in this project is shot with. Leave a field on Auto to let each scene decide. Shot sizes, angles, and moves are picked per shot in the screenplay.</p>
      <div className="fl-look-grid">
        {LOOK_FIELDS.map((field) => (
          <label key={field.key} className="maker-field">
            {field.label}
            <select
              value={draft[field.key] !== undefined ? String(draft[field.key]) : ""}
              onChange={(e) => {
                const value = e.target.value;
                setDraft((current) => {
                  const next = { ...current } as Record<string, unknown>;
                  if (!value) delete next[field.key];
                  else next[field.key] = field.key === "focalLength" ? Number(value) : value;
                  return next as FilmCinema;
                });
              }}
            >
              <option value="">Auto</option>
              {field.options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      <div className="dr-row dr-row-end">
        {dirty ? <button type="button" className="maker-outline" onClick={() => setDraft(cinema || {})}>Discard</button> : null}
        <button
          type="button"
          className="maker-primary"
          disabled={!dirty || saving}
          onClick={async () => {
            setSaving(true);
            try {
              if (await onSave(draft)) toast.success("Cinema look saved. New storyboards and clips use it; older ones show as out of date.");
            } finally {
              setSaving(false);
            }
          }}
        >
          {saving ? <Loader2 size={15} className="animate-spin" /> : <Wand2 size={15} />} {dirty ? "Save look" : "Saved"}
        </button>
      </div>
    </section>
  );
}

/**
 * The song's tempo: scenes cut on its bar lines and shots change on its beats.
 * Detectors often land on half or double the felt tempo, so both are one tap.
 */
export function TempoRow({ grid, onChange, onDetect }: { grid?: BeatGrid | null; onChange: (grid: BeatGrid) => void | Promise<unknown>; onDetect?: () => Promise<unknown> }) {
  const [busy, setBusy] = useState(false);
  const run = async (work: () => void | Promise<unknown>) => {
    setBusy(true);
    try {
      await work();
    } finally {
      setBusy(false);
    }
  };
  if (!grid?.bpm)
    return (
      <div className="fl-tempo">
        <span className="fl-tempo-text">
          <strong>No beat grid</strong>
          <span>Scenes cut on lyric lines instead of bar lines.</span>
        </span>
        {onDetect ? (
          <button type="button" className="maker-outline dr-small" disabled={busy} onClick={() => void run(onDetect)}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Music2 size={14} />} Find the beat
          </button>
        ) : null}
      </div>
    );
  const scale = (factor: 0.5 | 2) => run(() => onChange(rescaleBeats(grid, factor) as BeatGrid));
  return (
    <div className="fl-tempo">
      <span className="fl-tempo-text">
        <strong>{Math.round(grid.bpm)} BPM</strong>
        <span>Scenes cut on bar lines and shots change on the beat. Play the song: if the dot pulses twice as fast or slow as you'd clap, fix it here.</span>
      </span>
      <div className="fl-tempo-actions" role="group" aria-label="Fix the tempo">
        <button type="button" className="maker-outline dr-small" disabled={busy || grid.bpm / 2 < 40} onClick={() => void scale(0.5)} title={`Use ${Math.round(grid.bpm / 2)} BPM`}>
          Half time
        </button>
        <button type="button" className="maker-outline dr-small" disabled={busy || grid.bpm * 2 > 260} onClick={() => void scale(2)} title={`Use ${Math.round(grid.bpm * 2)} BPM`}>
          Double time
        </button>
      </div>
    </div>
  );
}

export function SongPanel({ song, onSave, onTempo, onDetect }: { song: { asset: string; duration: number; lyrics: LyricLine[]; name?: string; grid?: BeatGrid | null }; onSave: (lyrics: LyricLine[]) => Promise<boolean>; onTempo: (grid: BeatGrid) => Promise<unknown>; onDetect: () => Promise<unknown> }) {
  const [lines, setLines] = useState<LyricLine[]>(song.lyrics);
  const [saving, setSaving] = useState(false);
  useEffect(() => setLines(song.lyrics), [song.lyrics]);
  return (
    <section aria-labelledby="fl-song-title">
      <div className="maker-section-title">
        <h2 id="fl-song-title"><Music2 size={16} aria-hidden="true" /> {song.name || "Song"}</h2>
        <small className="dr-count">{clock(song.duration)} · {lines.length} lyric lines</small>
      </div>
      <p className="dr-hint"><AlertCircle size={13} aria-hidden="true" /> The beat and the lyrics decide where scenes cut and what performers sing. After changing either, rewrite the shot list so the scenes follow.</p>
      <TempoRow grid={song.grid} onChange={onTempo} onDetect={onDetect} />
      <LyricsEditor
        lines={lines}
        duration={song.duration}
        src={song.asset}
        grid={song.grid}
        onChange={setLines}
        saving={saving}
        onSave={async () => {
          setSaving(true);
          try {
            if (await onSave(lines)) toast.success("Lyrics saved");
          } finally {
            setSaving(false);
          }
        }}
      />
    </section>
  );
}

// ---------- Per-shot camera ----------
export type ShotCamera = { cam: string; shot?: string; angle?: string; perspective?: string; motion?: string };
const CAMERA_FIELDS = [
  { key: "shot", label: "Shot size" },
  { key: "angle", label: "Angle" },
  { key: "perspective", label: "Perspective" },
  { key: "motion", label: "Movement" },
] as const;

/** A shot's camera: the catalogue picks plus a free note, in one compact control. */
export function CameraPicker({ value, onChange }: { value: ShotCamera; onChange: (patch: Partial<ShotCamera>) => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", key);
    };
  }, [open]);
  const label = cameraLabel(value);
  return (
    <div className="fl-cam" ref={box}>
      <button type="button" className={`fl-cam-btn${label ? " is-set" : ""}`} onClick={() => setOpen((o) => !o)} aria-expanded={open} title={[label, value.cam].filter(Boolean).join(" — ") || "Choose the camera"}>
        <Camera size={13} aria-hidden="true" />
        <span>{label || value.cam || "Camera"}</span>
      </button>
      {open ? (
        <div className="fl-cam-pop" role="dialog" aria-label="Shot camera">
          {CAMERA_FIELDS.map((field) => (
            <label key={field.key} className="maker-field">
              {field.label}
              <select value={value[field.key] || ""} onChange={(e) => onChange({ [field.key]: e.target.value || undefined } as Partial<ShotCamera>)}>
                <option value="">Auto</option>
                {cameraOptions(field.key).map((option: { id: string; label: string; description: string }) => (
                  <option key={option.id} value={option.id} title={option.description}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <label className="maker-field fl-cam-note">
            Camera note
            <input value={value.cam} maxLength={80} placeholder="e.g. slow push, hold on her face" onChange={(e) => onChange({ cam: e.target.value })} />
          </label>
          {cameraOption(value.angle)?.notes || cameraOption(value.motion)?.notes ? (
            <p className="dr-hint">{[cameraOption(value.angle)?.notes, cameraOption(value.motion)?.notes].filter(Boolean).join(" ")}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
