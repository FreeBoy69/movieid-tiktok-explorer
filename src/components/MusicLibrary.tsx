// The one royalty-free music picker: Openverse search with a mood guessed from
// the script, Pixabay hand-off, your own file, and one-at-a-time previews.
// Voiceover Studio, Create Video and Vibe Edit each decide what "Use" does.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AudioLines, Check, ExternalLink, Loader2, Search, Upload } from "lucide-react";
import { inferMusicMood, pixabayMusicSearchUrl } from "../utils/royaltyFreeMusic.js";
import { TrackPreviewButton } from "./ScenePlayback";
import { useErrorToast } from "../utils/toast";
import "./MusicLibrary.css";

export type LibraryTrack = {
  id: string;
  title: string;
  creator?: string;
  provider?: string;
  url: string;
  landingUrl?: string;
  license?: string;
  licenseUrl?: string;
  attribution?: string;
  durationSeconds?: number | null;
  tags?: string[];
};

const MOODS: Array<{ id: string; label: string; query: string }> = [
  { id: "upbeat", label: "Upbeat", query: "upbeat instrumental" },
  { id: "calm", label: "Calm", query: "calm instrumental" },
  { id: "dramatic", label: "Dramatic", query: "dramatic instrumental" },
  { id: "cinematic", label: "Cinematic", query: "cinematic instrumental" },
  { id: "sad", label: "Sad", query: "sad instrumental" },
  { id: "inspiring", label: "Inspiring", query: "inspiring instrumental" },
  { id: "lofi", label: "Lo-fi", query: "lo-fi chill" },
  { id: "piano", label: "Piano", query: "piano" },
  { id: "epic", label: "Epic", query: "epic orchestral" },
];

const clock = (seconds?: number | null) => {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

type Library = "openverse" | "pixabay" | "upload";

export function MusicLibrary({
  seed = "",
  query: initialQuery = "",
  selectedId,
  onUse,
  useLabel = "Use",
  onImport,
  importHint,
  disabled = false,
  title = "Music",
  meta,
  emptyText = "No tracks matched. Try a broader mood.",
  children,
}: {
  /** Script or caption text the opening mood is guessed from. */
  seed?: string;
  /** A search to start with instead of the guessed mood. */
  query?: string;
  selectedId?: string;
  onUse: (track: LibraryTrack) => void | Promise<unknown>;
  useLabel?: string;
  /** Present when the host accepts the user's own audio file. */
  onImport?: (file: File) => void;
  importHint?: string;
  disabled?: boolean;
  title?: ReactNode;
  meta?: string;
  emptyText?: string;
  /** Host controls under the list: level, credit, ducking. */
  children?: ReactNode;
}) {
  const [library, setLibrary] = useState<Library>("openverse");
  const request = useRef<AbortController | null>(null);
  const [query, setQuery] = useState(initialQuery);
  const [mood, setMood] = useState(() => inferMusicMood(seed).id);
  const [tracks, setTracks] = useState<LibraryTrack[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [using, setUsing] = useState("");
  const [error, setError] = useState("");
  useErrorToast(error, () => setError(""), { title: "Music search failed", action: { label: "Retry", onClick: () => void search() } });

  async function search(next = query.trim() || inferMusicMood(seed).query) {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError("");
    setQuery(next);
    try {
      const response = await fetch(`/api/automation/voice/music/search?q=${encodeURIComponent(next)}`, { signal: controller.signal });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Music search is unavailable right now.");
      if (controller.signal.aborted) return;
      setTracks(((data.tracks || []) as LibraryTrack[]).filter((track) => track.url));
      setSearched(true);
    } catch (e) {
      if (!controller.signal.aborted) setError((e as Error).message);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }

  // Open on music that fits the script; a new script re-guesses the mood.
  useEffect(() => {
    const guess = inferMusicMood(seed);
    setMood(guess.id);
    const timer = window.setTimeout(() => void search(initialQuery.trim() || guess.query), 450);
    return () => {
      window.clearTimeout(timer);
      request.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed]);

  async function use(track: LibraryTrack) {
    setUsing(track.id);
    try {
      await onUse(track);
    } finally {
      setUsing("");
    }
  }

  const tabs: Array<[Library, string]> = [["openverse", "Openverse"], ["pixabay", "Pixabay"]];
  if (onImport) tabs.push(["upload", "Your file"]);
  const fileInput = (label: string) =>
    onImport ? (
      <label className="ml-file">
        <Upload size={15} aria-hidden="true" />
        <span>
          <strong>{label}</strong>
          {importHint ? <small>{importHint}</small> : null}
        </span>
        <input type="file" accept="audio/*" disabled={disabled} onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ""; if (file) onImport(file); }} />
      </label>
    ) : null;

  return (
    <div className="ml">
      {title || meta ? (
        <header className="ml-head">
          {title ? <h3><AudioLines size={16} aria-hidden="true" />{title}</h3> : <span />}
          {meta ? <span className="ml-meta" title={meta}>{meta}</span> : null}
        </header>
      ) : null}

      <div className="ml-tabs" role="tablist" aria-label="Music source">
        {tabs.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={library === id} disabled={disabled} onClick={() => setLibrary(id)}>
            {label}
          </button>
        ))}
      </div>

      {library === "openverse" ? (
        <>
          <form className="ml-search" onSubmit={(e) => { e.preventDefault(); if (query.trim()) void search(query.trim()); }}>
            <Search size={15} aria-hidden="true" />
            <input value={query} disabled={disabled} aria-label="Search music" placeholder="Mood, genre or instrument" onChange={(e) => setQuery(e.target.value)} />
            <button type="submit" disabled={disabled || loading || !query.trim()}>{loading ? <Loader2 size={14} className="ml-spin" /> : "Search"}</button>
          </form>
          <div className="ml-moods" aria-label="Moods">
            {MOODS.map((item) => (
              <button
                type="button"
                key={item.id}
                disabled={disabled}
                aria-pressed={mood === item.id}
                onClick={() => {
                  setMood(item.id);
                  void search(item.query);
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
          {tracks.length ? (
            <ul className="ml-tracks" aria-label="Tracks" aria-busy={loading}>
              {tracks.map((track) => {
                const selected = selectedId === track.id;
                return (
                  <li key={track.id} className={selected ? "is-selected" : ""}>
                    <TrackPreviewButton url={track.url} title={track.title} />
                    <span className="ml-track-meta">
                      <strong title={track.title}>{track.title}</strong>
                      <small>
                        {[track.creator, track.durationSeconds ? clock(track.durationSeconds) : "", track.license].filter(Boolean).join(" · ")}
                      </small>
                    </span>
                    {track.landingUrl ? (
                      <a className="ml-icon" href={track.landingUrl} target="_blank" rel="noreferrer" aria-label={`Source page for ${track.title}`} title="Source and license">
                        <ExternalLink size={14} />
                      </a>
                    ) : null}
                    <button type="button" className="ml-use" disabled={disabled || Boolean(using)} aria-pressed={selected} onClick={() => void use(track)}>
                      {using === track.id ? <Loader2 size={14} className="ml-spin" /> : selected ? <><Check size={14} />In use</> : useLabel}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="ml-empty">{loading ? <><Loader2 size={14} className="ml-spin" />Finding tracks…</> : searched ? emptyText : "Pick a mood or search. Every track is CC0 or CC BY."}</p>
          )}
        </>
      ) : library === "pixabay" ? (
        <div className="ml-stack">
          <p className="ml-note">Pixabay tracks are free to use. Download one there, then bring it back here.</p>
          <a className="ml-link" href={pixabayMusicSearchUrl(query || inferMusicMood(seed).query)} target="_blank" rel="noreferrer">
            Open Pixabay music <ExternalLink size={14} />
          </a>
          {fileInput("Import the download")}
        </div>
      ) : (
        <div className="ml-stack">{fileInput("Choose an audio file")}</div>
      )}

      {children ? <div className="ml-foot">{children}</div> : null}
    </div>
  );
}
