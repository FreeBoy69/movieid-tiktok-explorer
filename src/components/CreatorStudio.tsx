// Creator Studio: every app from Open Generative AI (github.com/anil-matcha/open-generative-ai, MIT)
// under one page, navigated by the same categories, running on our /api/studio routes.
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, Check, ChevronDown } from "lucide-react";
import { STUDIO_TABS, type StudioTab } from "../utils/tiktokRoute";
import { EXPLORE_ICON, STUDIO_APPS, STUDIO_CATEGORIES, type StudioApp } from "./studio/studioApps";
import { type Asset, type Catalog, type Generation, readJson, usePopover } from "./studio/studioShared";
import { defaultDraft, type Draft, StudioGenerator } from "./studio/StudioGenerator";
import { StudioAgents } from "./studio/StudioAgents";
import "./CreatorStudio.css";

type AppId = StudioApp["id"];
const DRAFTS_KEY = "autoyt-creator-studio-drafts-v2";
// Uploaded and generated files are kept in drafts; anything else is reset per session.
function loadDrafts(): Record<string, Draft> {
  try {
    const saved = JSON.parse(window.localStorage.getItem(DRAFTS_KEY) || "{}");
    return saved && typeof saved === "object" ? saved : {};
  } catch {
    return {};
  }
}

export function CreatorStudio({ theme = "light", tab: routeTab, onTabChange }: { theme?: "light" | "dark"; tab?: StudioTab; onTabChange?: (tab: StudioTab) => void }) {
  const tab: StudioTab = routeTab && STUDIO_TABS.includes(routeTab) ? routeTab : "apps";
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [catalogError, setCatalogError] = useState("");
  const [generations, setGenerations] = useState<Generation[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>(loadDrafts);
  const [now, setNow] = useState(Date.now());

  const draftFor = useCallback((app: string) => ({ ...defaultDraft(), ...(drafts[app] || {}) }), [drafts]);
  const patch = useCallback((changes: Draft, target?: AppId) => {
    const app = target || (tab as AppId);
    setDrafts((current) => ({ ...current, [app]: { ...defaultDraft(), ...(current[app] || {}), ...changes } }));
  }, [tab]);

  useEffect(() => {
    try {
      window.localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts));
    } catch {}
  }, [drafts]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/studio/catalog")
      .then((response) => readJson(response, "Models are unavailable right now"))
      .then((data) => !cancelled && setCatalog(data))
      .catch((err) => !cancelled && setCatalogError(err instanceof Error ? err.message : "Models are unavailable right now"));
    return () => {
      cancelled = true;
    };
  }, []);

  const refresh = useCallback(async () => {
    try {
      const data = await readJson(await fetch("/api/studio/generations", { cache: "no-store" }), "History unavailable");
      setGenerations(Array.isArray(data.generations) ? data.generations : []);
    } catch {}
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const active = generations.some((item) => item.status === "queued" || item.status === "running");
  useEffect(() => {
    if (!active) return;
    const poll = window.setInterval(() => void refresh(), 4000);
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      window.clearInterval(poll);
      window.clearInterval(tick);
    };
  }, [active, refresh]);

  const go = useCallback((next: StudioTab) => onTabChange?.(next), [onTabChange]);
  const busyApps = useMemo(() => new Set(generations.filter((g) => g.status === "queued" || g.status === "running").map((g) => g.tab)), [generations]);
  const send = useCallback((target: AppId, field: string, asset: Asset) => {
    const value = { file: asset.file, url: asset.url, type: asset.type, name: asset.name };
    patch({ [field]: value }, target);
    go(target);
  }, [patch, go]);

  const app = tab === "apps" ? null : STUDIO_APPS[tab as AppId];
  return (
    <div className="cstudio" data-theme={theme}>
      <header className="cs-header">
        <button type="button" className="cs-title" onClick={() => go("apps")}>Creator Studio</button>
        <nav className="cs-nav" aria-label="Creator Studio apps">
          {STUDIO_CATEGORIES.map((category) =>
            category.apps.length === 1 ? (
              <button key={category.id} type="button" className="cs-nav-item" aria-current={tab === category.apps[0] ? "page" : undefined} onClick={() => go(category.apps[0])}>
                {category.icon}
                <span>{category.label}</span>
                {busyApps.has(category.apps[0]) ? <span className="cs-dot" aria-label="Generating" /> : null}
              </button>
            ) : (
              <CategoryMenu key={category.id} label={category.label} icon={category.icon} apps={category.apps} current={tab} busy={busyApps} onPick={go} />
            ),
          )}
          <button type="button" className="cs-nav-item" aria-current={tab === "apps" ? "page" : undefined} onClick={() => go("apps")}>
            {EXPLORE_ICON}
            <span>Explore Apps</span>
          </button>
        </nav>
      </header>

      <section className="cs-body" aria-label={app?.label || "Explore Apps"}>
        {app ? (
          <div className="cs-app-head">
            <span className="cs-app-icon">{app.icon}</span>
            <h1>{app.label}</h1>
          </div>
        ) : null}
        {catalogError ? <p className="cs-banner" role="alert">{catalogError}</p> : null}
        {tab === "apps" ? (
          <ExploreApps onPick={go} busy={busyApps} />
        ) : tab === "agents" || tab === "design-agent" ? (
          <StudioAgents mode={tab} catalog={catalog} generations={generations} now={now} onGenerations={() => void refresh()} />
        ) : (
          <StudioGenerator
            app={tab as AppId}
            catalog={catalog}
            catalogLoading={!catalog && !catalogError}
            generations={generations}
            draft={draftFor(tab)}
            patch={patch}
            now={now}
            onCreated={(item) => {
              setGenerations((current) => [item, ...current.filter((g) => g.id !== item.id)]);
              setNow(Date.now());
            }}
            onRefresh={() => void refresh()}
            onRemoved={(id) => setGenerations((current) => current.filter((g) => g.id !== id))}
            onSend={send}
          />
        )}
      </section>
    </div>
  );
}

function CategoryMenu({ label, icon, apps, current, busy, onPick }: { label: string; icon: ReactNode; apps: AppId[]; current: StudioTab; busy: Set<string>; onPick: (tab: StudioTab) => void }) {
  const { open, setOpen, ref } = usePopover();
  const inside = apps.includes(current as AppId);
  return (
    <div className="cs-pop" ref={ref}>
      <button type="button" className="cs-nav-item" aria-haspopup="menu" aria-expanded={open} aria-current={inside ? "page" : undefined} onClick={() => setOpen(!open)}>
        {icon}
        <span>{label}</span>
        {apps.some((a) => busy.has(a)) ? <span className="cs-dot" aria-label="Generating" /> : null}
        <ChevronDown className="h-3 w-3" />
      </button>
      {open ? (
        <div className="cs-menu cs-app-menu" role="menu" aria-label={label}>
          {apps.map((id) => {
            const item = STUDIO_APPS[id];
            return (
              <button key={id} type="button" role="menuitem" className="cs-app-option" aria-current={current === id ? "page" : undefined} onClick={() => { onPick(id); setOpen(false); }}>
                <span className="cs-app-option-icon">{item.icon}</span>
                <span className="cs-app-option-text">
                  <strong>{item.label}{busy.has(id) ? <span className="cs-dot" aria-label="Generating" /> : null}</strong>
                  <span>{item.summary}</span>
                </span>
                {current === id ? <Check className="h-3.5 w-3.5" /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function ExploreApps({ onPick, busy }: { onPick: (tab: StudioTab) => void; busy: Set<string> }) {
  return (
    <div className="cs-canvas cs-explore">
      <h1 className="cs-explore-title">Every studio, one workspace.</h1>
      {STUDIO_CATEGORIES.map((category) => (
        <section key={category.id} className="cs-explore-group" aria-labelledby={`cs-cat-${category.id}`}>
          <h2 id={`cs-cat-${category.id}`}>{category.label}</h2>
          <div className="cs-explore-grid">
            {category.apps.map((id) => {
              const item = STUDIO_APPS[id];
              return (
                <button key={id} type="button" className="cs-app-card" onClick={() => onPick(id)}>
                  <span className="cs-app-card-icon">{item.icon}</span>
                  <strong>{item.label}{busy.has(id) ? <span className="cs-dot" aria-label="Generating" /> : null}</strong>
                  <span>{item.summary}</span>
                  <ArrowRight className="cs-app-card-arrow h-4 w-4" aria-hidden="true" />
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
