// Poster Finder: a title (and optional year) looked up on TMDB through the
// server's cached poster endpoint. Poster, backdrop, synopsis, cast, links.
import { FormEvent, useState } from "react";
import { ExternalLink, Loader2, Search, Star } from "lucide-react";
import { useErrorToast } from "../../utils/toast";
import { Empty } from "../studio/studioShared";
import { toolEntry, type ToolDef } from "./toolApps";
import { ToolLayout } from "./ToolPage";

type Film = {
  posterUrl: string;
  backdropUrl: string;
  tmdbUrl: string;
  imdbUrl: string;
  mediaType: string;
  title: string;
  originalTitle: string;
  overview: string;
  tagline: string;
  releaseDate: string;
  runtime: number | null;
  genres: string[];
  rating: number | null;
  voteCount: number;
  language: string;
  countries: string[];
  director: string;
  cast: Array<{ name: string; character: string; profileUrl: string }>;
  notFound?: boolean;
  warning?: string;
};
const fullSize = (url: string) => url.replace(/\/w\d+\//, "/original/");
const runtimeLabel = (minutes: number | null) => (minutes ? `${Math.floor(minutes / 60) ? `${Math.floor(minutes / 60)}h ` : ""}${minutes % 60}m` : "");

export function PosterFinder({ tool }: { tool: ToolDef }) {
  const entry = toolEntry(tool.id);
  const [title, setTitle] = useState("");
  const [year, setYear] = useState("");
  const [busy, setBusy] = useState(false);
  const [film, setFilm] = useState<Film | null>(null);
  const [missing, setMissing] = useState("");
  const [error, setError] = useState("");
  useErrorToast(error, () => setError(""));

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim() || busy) return;
    setBusy(true);
    setError("");
    setMissing("");
    setFilm(null);
    try {
      const params = new URLSearchParams({ title: title.trim() });
      if (year.trim()) params.set("year", year.trim());
      const response = await fetch(`/api/movie/poster?${params}`);
      const data: Film = await response.json().catch(() => ({} as Film));
      if (!response.ok) throw new Error((data as any).error || "Lookup failed.");
      if (data.notFound || !data.posterUrl) {
        setMissing(data.warning ? `Lookup failed: ${data.warning}` : `No film or series called “${title.trim()}”${year.trim() ? ` from ${year.trim()}` : ""} was found. Check the spelling or drop the year.`);
        return;
      }
      setFilm(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lookup failed.");
    } finally {
      setBusy(false);
    }
  }

  const panel = (
    <form style={{ display: "contents" }} onSubmit={(event) => void submit(event)}>
      <label className="mt-field">
        <span className="mt-label">Film or series</span>
        <input className="ui-input" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Blade Runner" autoComplete="off" />
      </label>
      <label className="mt-field">
        <span className="mt-label">Year <small>optional</small></span>
        <input className="ui-input" value={year} onChange={(event) => setYear(event.target.value.replace(/[^\d]/g, "").slice(0, 4))} inputMode="numeric" placeholder="e.g. 1982" />
      </label>
      <button type="submit" className="ui-btn is-primary is-lg is-block mt-primary" disabled={!title.trim() || busy}>
        {busy ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
        {tool.action}
      </button>
      <p className="mt-note">Data and images from TMDB. Posters open at full size; right-click to save.</p>
    </form>
  );

  return (
    <ToolLayout panel={panel}>
      <div className="mt-stage-head">
        <h2>Result</h2>
        <span className="mt-meta">{film ? (film.mediaType === "tv" ? "Series" : "Film") : "Nothing yet"}</span>
      </div>
      <div className="mt-stage-inner">
        {busy ? <div className="mt-skeleton" aria-hidden="true"><span className="ui-skeleton" /><span className="ui-skeleton" /><span className="ui-skeleton" /></div> : null}
        {missing ? <p className="mt-error" role="status">{missing}</p> : null}
        {film ? (
          <article className="mt-film">
            {film.backdropUrl ? <div className="mt-film-backdrop" style={{ backgroundImage: `url(${film.backdropUrl})` }} aria-hidden="true" /> : null}
            <div className="mt-film-body">
              <a href={fullSize(film.posterUrl)} target="_blank" rel="noreferrer" aria-label={`Open the ${film.title} poster at full size`}>
                <img className="mt-poster" src={film.posterUrl} alt={`${film.title} poster`} />
              </a>
              <div>
                <div className={film.backdropUrl ? "mt-film-over" : undefined}>
                  <h2>{film.title}</h2>
                  {film.originalTitle && film.originalTitle !== film.title ? <p className="mt-meta">{film.originalTitle}</p> : null}
                  {film.tagline ? <p className="mt-film-tagline">{film.tagline}</p> : null}
                </div>
                {film.overview ? <p className="mt-film-overview">{film.overview}</p> : null}
                <dl className="mt-facts">
                  {film.releaseDate ? <div><dt>Released</dt><dd>{film.releaseDate}</dd></div> : null}
                  {film.runtime ? <div><dt>Runtime</dt><dd>{runtimeLabel(film.runtime)}</dd></div> : null}
                  {film.rating ? <div><dt>Rating</dt><dd><Star size={12} style={{ display: "inline", verticalAlign: "-1px", marginRight: 4 }} aria-hidden="true" />{film.rating.toFixed(1)} <span className="mt-meta">({film.voteCount.toLocaleString()})</span></dd></div> : null}
                  {film.genres.length ? <div><dt>Genres</dt><dd>{film.genres.join(", ")}</dd></div> : null}
                  {film.director ? <div><dt>{film.mediaType === "tv" ? "Created by" : "Director"}</dt><dd>{film.director}</dd></div> : null}
                  {film.language ? <div><dt>Language</dt><dd>{film.language.toUpperCase()}{film.countries.length ? ` · ${film.countries.slice(0, 2).join(", ")}` : ""}</dd></div> : null}
                </dl>
                {film.cast.length ? (
                  <ul className="mt-cast" aria-label="Cast">
                    {film.cast.map((person) => (
                      <li key={`${person.name}-${person.character}`}>
                        {person.profileUrl ? <img src={person.profileUrl} alt="" loading="lazy" /> : <span className="mt-cast-blank" aria-hidden="true" />}
                        <strong>{person.name}</strong>
                        {person.character ? <span>{person.character}</span> : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
                <div className="mt-actions" style={{ marginTop: 16 }}>
                  <a className="ui-btn is-sm mt-secondary" href={fullSize(film.posterUrl)} target="_blank" rel="noreferrer"><ExternalLink size={15} />Poster, full size</a>
                  {film.backdropUrl ? <a className="ui-btn is-sm mt-secondary" href={fullSize(film.backdropUrl)} target="_blank" rel="noreferrer"><ExternalLink size={15} />Backdrop, full size</a> : null}
                  {film.tmdbUrl ? <a className="ui-btn is-sm is-ghost mt-ghost" href={film.tmdbUrl} target="_blank" rel="noreferrer">TMDB <ExternalLink size={13} /></a> : null}
                  {film.imdbUrl ? <a className="ui-btn is-sm is-ghost mt-ghost" href={film.imdbUrl} target="_blank" rel="noreferrer">IMDb <ExternalLink size={13} /></a> : null}
                </div>
              </div>
            </div>
          </article>
        ) : !busy && !missing ? (
          <Empty icon={entry?.icon} heading={tool.heading} body={tool.body} />
        ) : null}
      </div>
    </ToolLayout>
  );
}
