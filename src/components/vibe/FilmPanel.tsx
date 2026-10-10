// The Film panel of a recap edit: the whole film to scrub, mark a stretch in it, and lay that stretch over
// the selected clip or at the playhead. Clips cut from the film carry film times, so dragging a clip's edge
// on the timeline reaches more of the film too. An edit made before the film was ready moves onto it here.
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ArrowDownToLine, Crosshair, Film, Loader2, Pause, Play, Replace, Volume2, VolumeX } from "lucide-react";
import { toast } from "../../utils/toast";
import { filmAssetOf, formatTime, overwriteFromFilm, recapSource, replaceFromFilm } from "../../utils/vibeEdit";
import { moveEditToFilm } from "./api";
import { useVibe, vibe } from "./store";

const MIN_MARK = 0.5;

export function FilmPanel() {
  const project = useVibe((s) => s.project);
  const selection = useVibe((s) => s.selection);
  const playhead = useVibe((s) => s.playhead);
  const source = recapSource(project);
  const film = filmAssetOf(project);
  if (!source) return <p className="ve-film-note">The Film panel is for edits made by Movie to Recap.</p>;
  if (!film) return <MoveToFilm recapId={source.recapId} projectId={project.id} />;
  const selected = project.clips.find((c) => selection.length === 1 && c.id === selection[0]);
  return <FilmBrowser key={film.url} url={film.url} duration={film.duration || 0} sheets={film.film?.sheets} assetId={film.id} selectedId={selected?.id || ""} selectedFilm={selected?.assetId === film.id ? selected.in : undefined} selectedLength={selected ? selected.out - selected.in : 0} playhead={playhead} />;
}

/** An older recap edit (clips on the cut picture) moves onto the film once its editing copy is ready. */
function MoveToFilm({ recapId, projectId }: { recapId: string; projectId: string }) {
  const [state, setState] = useState<{ busy: boolean; progress: number; error: string }>({ busy: false, progress: 0, error: "" });
  const live = useRef(true);
  useEffect(() => () => {
    live.current = false;
  }, []);
  const start = async () => {
    setState({ busy: true, progress: 0, error: "" });
    try {
      for (;;) {
        const data = await moveEditToFilm(recapId, projectId);
        if (!live.current) return;
        if (data.project) {
          vibe.commit(() => data.project!);
          toast.success("Your clips now play from the film: drag an edge to reach more of it.");
          return;
        }
        if (data.state === "failed" || data.state === "missing") throw new Error(data.error || (data.state === "missing" ? "The film is no longer on the media server. Analyze it again from Movie to Recap." : "The film couldn't be prepared."));
        setState({ busy: true, progress: data.progress || 0, error: "" });
        await new Promise((r) => window.setTimeout(r, 5000));
      }
    } catch (error) {
      if (live.current) setState({ busy: false, progress: 0, error: error instanceof Error ? error.message : "Couldn't load the film" });
    }
  };
  return (
    <div className="ve-film-move">
      <Film size={22} aria-hidden="true" />
      <p>
        <strong>Edit from the whole film</strong>
        Load the film to trim clips past their cut, swap any shot for another moment, or lay a new stretch over the picture.
      </p>
      {state.error ? <p className="ve-film-error" role="alert">{state.error}</p> : null}
      <button type="button" className="ui-btn is-primary" disabled={state.busy} onClick={() => void start()}>
        {state.busy ? <Loader2 size={15} className="animate-spin" /> : <Film size={15} />}
        {state.busy ? (state.progress > 0 ? `Preparing the film… ${Math.round(state.progress * 100)}%` : "Preparing the film…") : "Load the full film"}
      </button>
      {state.busy ? <small>A first load copies the film for playback, about a quarter of its running time. You can keep editing meanwhile.</small> : null}
    </div>
  );
}

function FilmBrowser({ url, duration, sheets, assetId, selectedId, selectedFilm, selectedLength, playhead }: {
  url: string;
  duration: number;
  sheets?: { base: string; every: number; cols: number; rows: number };
  assetId: string;
  selectedId: string;
  selectedFilm?: number;
  selectedLength: number;
  playhead: number;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [time, setTime] = useState(selectedFilm ?? 0);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const [mark, setMark] = useState<{ in: number | null; out: number | null }>({ in: null, out: null });
  const [error, setError] = useState("");
  const total = duration || video.current?.duration || 0;

  const seek = (t: number) => {
    const next = Math.max(0, Math.min(total || t, t));
    setTime(next);
    if (video.current) video.current.currentTime = next;
  };
  // Selecting a film clip on the timeline shows where it sits in the film.
  useEffect(() => {
    if (selectedFilm !== undefined) seek(selectedFilm);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);
  const toggle = () => {
    const el = video.current;
    if (!el) return;
    if (el.paused) void el.play().catch(() => setError("The film couldn't play. Try again in a moment."));
    else el.pause();
  };
  const markIn = () => setMark((m) => ({ in: time, out: m.out !== null && m.out > time + MIN_MARK ? m.out : null }));
  const markOut = () => setMark((m) => ({ in: m.in !== null && m.in < time - MIN_MARK ? m.in : Math.max(0, time - (selectedLength || 3)), out: time }));
  const marked = mark.in !== null && mark.out !== null && mark.out - mark.in >= MIN_MARK ? { from: mark.in, to: mark.out } : null;

  const replace = () => {
    if (!selectedId) return;
    // The selected clip keeps its place and length; it now starts at the mark (or the current frame).
    const from = marked ? marked.from : time;
    vibe.commit((p) => replaceFromFilm(p, selectedId, assetId, from));
    toast.success(`Shot replaced with the film at ${formatTime(from)}`);
  };
  const insert = () => {
    const range = marked || { from: time, to: Math.min(total, time + 3) };
    let id = "";
    vibe.commit((p) => {
      const placed = overwriteFromFilm(p, assetId, range.from, range.to, vibe.get().playhead, 0);
      id = placed.id;
      return placed.project;
    });
    if (id) {
      vibe.select([id]);
      toast.success(`Laid ${formatTime(range.to - range.from)} of film at ${formatTime(playhead)}`);
    }
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("input, textarea, select")) return;
    const k = e.key.toLowerCase();
    if (k === " ") toggle();
    else if (k === "i") markIn();
    else if (k === "o") markOut();
    else if (k === "arrowleft") seek(time - (e.shiftKey ? 5 : 1 / 30));
    else if (k === "arrowright") seek(time + (e.shiftKey ? 5 : 1 / 30));
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  // An overview of the whole film from its contact sheets: click a frame to go there.
  const overview = sheets && total ? Array.from({ length: 24 }, (_, i) => (i + 0.5) * (total / 24)) : [];
  const tile = (t: number) => {
    if (!sheets) return {};
    const per = sheets.cols * sheets.rows;
    const n = Math.max(0, Math.floor(t / sheets.every));
    const at = n % per;
    return {
      backgroundImage: `url("${sheets.base}s${String(Math.floor(n / per)).padStart(3, "0")}.jpg")`,
      backgroundSize: `${sheets.cols * 100}% ${sheets.rows * 100}%`,
      backgroundPosition: `${sheets.cols > 1 ? ((at % sheets.cols) / (sheets.cols - 1)) * 100 : 0}% ${sheets.rows > 1 ? (Math.floor(at / sheets.cols) / (sheets.rows - 1)) * 100 : 0}%`,
    };
  };
  const pct = (t: number) => `${total ? (t / total) * 100 : 0}%`;

  return (
    <div className="ve-film" tabIndex={-1} onKeyDown={onKey}>
      <div className="ve-film-screen">
        <video
          ref={video}
          src={url}
          muted={muted}
          playsInline
          preload="metadata"
          onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onLoadedMetadata={(e) => {
            e.currentTarget.currentTime = time;
          }}
          onError={() => setError("The film couldn't load. The media server may be reconnecting: try again in a minute.")}
          onClick={toggle}
        />
        {error ? <p className="ve-film-error" role="alert">{error}</p> : null}
      </div>
      <div className="ve-film-bar">
        <button type="button" className="ui-icon-btn" onClick={toggle} aria-label={playing ? "Pause the film" : "Play the film"} title={playing ? "Pause (Space)" : "Play (Space)"}>
          {playing ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <span className="ve-film-time">{formatTime(time, true)} <small>/ {formatTime(total)}</small></span>
        <button type="button" className="ui-icon-btn" onClick={() => setMuted((m) => !m)} aria-label={muted ? "Hear the film" : "Mute the film"} title={muted ? "Hear the film's sound (it never goes into the recap)" : "Mute the film"}>
          {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
        </button>
      </div>
      <div className="ve-film-scrub">
        {mark.in !== null ? <span className="ve-film-range" style={{ left: pct(mark.in), width: mark.out !== null ? `calc(${pct(mark.out)} - ${pct(mark.in)})` : "2px" }} /> : null}
        {selectedFilm !== undefined ? <span className="ve-film-clip" style={{ left: pct(selectedFilm), width: `max(2px, ${pct(selectedLength)})` }} title="The selected clip" /> : null}
        <input type="range" className="ui-range" min={0} max={total || 1} step={0.04} value={Math.min(time, total || 1)} onChange={(e) => seek(Number(e.target.value))} aria-label="Position in the film" />
      </div>
      {overview.length ? (
        <div className="ve-film-overview" aria-label="The film at a glance">
          {overview.map((t) => (
            <button key={t} type="button" style={tile(t)} onClick={() => seek(t)} aria-label={`Go to ${formatTime(t)}`} title={formatTime(t)} />
          ))}
        </div>
      ) : null}
      <div className="ve-film-marks">
        <button type="button" className="ui-btn is-sm" onClick={markIn} title="Mark where the stretch starts (I)">In <kbd>I</kbd>{mark.in !== null ? <span>{formatTime(mark.in, true)}</span> : null}</button>
        <button type="button" className="ui-btn is-sm" onClick={markOut} title="Mark where the stretch ends (O)">Out <kbd>O</kbd>{mark.out !== null ? <span>{formatTime(mark.out, true)}</span> : null}</button>
        {marked ? <span className="ve-film-len">{formatTime(marked.to - marked.from, true)}</span> : null}
      </div>
      <div className="ve-film-actions">
        <button type="button" className="ui-btn is-primary" disabled={!selectedId} onClick={replace} title={selectedId ? "The selected clip keeps its place and length and starts at your mark (or this frame)" : "Select a clip on the timeline first"}>
          <Replace size={15} /> Replace selected clip
        </button>
        <button type="button" className="ui-btn" onClick={insert} title="Lay the marked stretch (or the next 3 seconds) over the picture at the playhead; nothing after it moves">
          <ArrowDownToLine size={15} /> Lay over at playhead
        </button>
        {selectedFilm !== undefined ? (
          <button type="button" className="ui-btn is-ghost" onClick={() => seek(selectedFilm)} title="Jump to where the selected clip sits in the film">
            <Crosshair size={15} /> Show selected clip
          </button>
        ) : null}
      </div>
      <p className="ve-film-hint">Space plays, ← → step a frame (Shift: 5 s), I and O mark a stretch. Drag a clip's edge on the timeline to reach more film.</p>
    </div>
  );
}
