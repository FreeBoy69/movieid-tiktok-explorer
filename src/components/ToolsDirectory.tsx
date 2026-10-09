// Every studio and tool in one searchable directory. The Tools page (/tools) shows it
// as described rows; the phone dock's Tools sheet shows it as compact icon tiles.
import { useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import { ALL_NAV_ENTRIES, isCurrentEntry, NAV_GROUPS, type NavEntry, type NavTarget } from "../utils/appNavigation";
import type { MainView, StudioTab, ToolId } from "../utils/tiktokRoute";
import { SearchField } from "./ui/controls";
import "./ToolsDirectory.css";

const POPULAR_IDS = ["image", "video", "create", "vibe-edit", "movie-recap", "audio", "thumbnail-maker", "title-generator"];

const byId = (id: string) => ALL_NAV_ENTRIES.find((entry) => entry.id === id);

export function ToolsDirectory({ variant, onNavigate, view, studioTab, toolId, autoFocus }: {
  variant: "page" | "sheet";
  onNavigate: (target: NavTarget) => void;
  view?: MainView;
  studioTab?: StudioTab;
  toolId?: ToolId;
  autoFocus?: boolean;
}) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const popular = useMemo(() => POPULAR_IDS.map(byId).filter((e): e is NavEntry => Boolean(e)), []);
  const groups = useMemo(
    () => NAV_GROUPS.map((group) => ({ id: group.id, label: group.label, entries: group.columns.flatMap((column) => column.entries) })),
    [],
  );
  const results = useMemo(
    () => (needle ? ALL_NAV_ENTRIES.filter((entry) => `${entry.label} ${entry.description}`.toLowerCase().includes(needle)) : []),
    [needle],
  );
  const current = (entry: NavEntry) => (view ? isCurrentEntry(entry, view, studioTab, toolId) : false);

  const item = (entry: NavEntry) =>
    variant === "sheet" ? (
      <button key={entry.id} type="button" className="td-tile" aria-current={current(entry) ? "page" : undefined} onClick={() => onNavigate(entry.target)} title={entry.description}>
        <span className="td-tile-icon">{entry.icon}</span>
        <span className="td-tile-label">{entry.label}</span>
      </button>
    ) : (
      <button key={entry.id} type="button" className="td-row" aria-current={current(entry) ? "page" : undefined} onClick={() => onNavigate(entry.target)}>
        <span className="td-row-icon">{entry.icon}</span>
        <span className="td-row-text">
          <strong>{entry.label}</strong>
          <span>{entry.description}</span>
        </span>
        <ChevronRight size={16} className="td-row-go" aria-hidden="true" />
      </button>
    );

  return (
    <div className={`td td-is-${variant}`}>
      <SearchField value={query} onChange={setQuery} placeholder="Search tools and studios" label="Search tools and studios" autoFocus={autoFocus} className="td-search" />
      {needle ? (
        results.length ? (
          <div className={variant === "sheet" ? "td-tiles" : "td-rows"}>{results.map(item)}</div>
        ) : (
          <p className="td-empty">Nothing matches “{query}”.</p>
        )
      ) : (
        <>
          <section className="td-group" aria-labelledby={`td-${variant}-popular`}>
            <h3 id={`td-${variant}-popular`}>Popular</h3>
            <div className={variant === "sheet" ? "td-tiles" : "td-popular"}>
              {variant === "sheet"
                ? popular.map(item)
                : popular.map((entry) => (
                    <button key={entry.id} type="button" className="td-card" aria-current={current(entry) ? "page" : undefined} onClick={() => onNavigate(entry.target)}>
                      <span className="td-card-icon">{entry.icon}</span>
                      <strong>{entry.label}</strong>
                      <span>{entry.description}</span>
                    </button>
                  ))}
            </div>
          </section>
          {groups.map((group) => (
            <section key={group.id} className="td-group" aria-labelledby={`td-${variant}-${group.id}`}>
              <h3 id={`td-${variant}-${group.id}`}>
                {group.label}
                <small>{group.entries.length}</small>
              </h3>
              <div className={variant === "sheet" ? "td-tiles" : "td-rows"}>{group.entries.map(item)}</div>
            </section>
          ))}
        </>
      )}
    </div>
  );
}

/** The Tools page at /tools. */
export function ToolsPage({ onNavigate }: { onNavigate: (target: NavTarget) => void }) {
  return (
    <div className="td-page">
      <header className="td-page-head">
        <h1>Tools</h1>
        <p>Every studio, editor and utility in AutoYT.</p>
      </header>
      <ToolsDirectory variant="page" onNavigate={onNavigate} />
    </div>
  );
}
