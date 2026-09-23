import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Activity, ArrowRight, ChevronDown, Loader2, LogOut, Menu, Moon, Search, Sun, Users, X } from "lucide-react";
import { ALL_NAV_ENTRIES, currentGroup, isCurrentEntry, NAV_GROUPS, type NavEntry, type NavGroup, type NavTarget } from "../utils/appNavigation";
import type { MainView, StudioTab } from "../utils/tiktokRoute";
import "./AppHeader.css";

type Theme = "light" | "dark";
type Account = { name: string; email: string; image: string; channel: string; channelImage: string };

export function AppHeader({
  view,
  studioTab,
  theme,
  account,
  onNavigate,
  onThemeChange,
  onOpenActivity,
  onOpenChannels,
  onLogout,
}: {
  view: MainView;
  studioTab?: StudioTab;
  theme: Theme;
  account: Account;
  onNavigate: (target: NavTarget) => void;
  onThemeChange: (theme: Theme) => void;
  onOpenActivity: () => void;
  onOpenChannels: () => void;
  onLogout: () => void;
}) {
  const [menu, setMenu] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [running, setRunning] = useState(0);
  useEffect(() => {
    const onCount = (event: Event) => setRunning(Number((event as CustomEvent).detail) || 0);
    window.addEventListener("autoyt-activity-count", onCount);
    return () => window.removeEventListener("autoyt-activity-count", onCount);
  }, []);
  const closeTimer = useRef<number | undefined>(undefined);
  const openTimer = useRef<number | undefined>(undefined);
  const triggers = useRef<Record<string, HTMLButtonElement | null>>({});
  const panels = useRef<Record<string, HTMLDivElement | null>>({});
  const active = currentGroup(view, studioTab);

  const go = (target: NavTarget) => {
    setMenu("");
    setMobileOpen(false);
    setSearchOpen(false);
    setAccountOpen(false);
    onNavigate(target);
  };

  // Hover intent: open after a short pause, close with a grace period so the
  // pointer can travel from the trigger into the panel.
  const hoverOpen = (id: string) => {
    window.clearTimeout(closeTimer.current);
    window.clearTimeout(openTimer.current);
    openTimer.current = window.setTimeout(() => setMenu(id), menu ? 0 : 90);
  };
  const hoverClose = () => {
    window.clearTimeout(openTimer.current);
    closeTimer.current = window.setTimeout(() => setMenu(""), 160);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    if (!menu && !accountOpen) return;
    const onPointer = (event: PointerEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest(".ah-group, .ah-account")) {
        setMenu("");
        setAccountOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [menu, accountOpen]);

  function onTriggerKey(event: ReactKeyboardEvent, group: NavGroup) {
    if (["Enter", " ", "ArrowDown"].includes(event.key)) {
      event.preventDefault();
      setMenu(group.id);
      requestAnimationFrame(() => panels.current[group.id]?.querySelector<HTMLElement>("a,button")?.focus());
    } else if (event.key === "Escape") setMenu("");
  }
  function onPanelKey(event: ReactKeyboardEvent, group: NavGroup) {
    const items = [...(panels.current[group.id]?.querySelectorAll<HTMLElement>("button") || [])];
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === "Escape") {
      event.preventDefault();
      setMenu("");
      triggers.current[group.id]?.focus();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      items[(index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
    }
  }

  return (
    <>
      <header className="ah" data-theme={theme}>
        <button type="button" className="ah-logo" onClick={() => go({ view: "tools" })} aria-label="AutoYT home">
          <img src="/favicon.svg" alt="" />
          <span>AutoYT</span>
        </button>

        <nav className="ah-nav" aria-label="Main">
          <button type="button" className="ah-link" aria-current={active === "" && view === "tools" ? "page" : undefined} onClick={() => go({ view: "tools" })}>
            Explore
          </button>
          {NAV_GROUPS.map((group) => (
            <div key={group.id} className="ah-group" onPointerEnter={(e) => e.pointerType === "mouse" && hoverOpen(group.id)} onPointerLeave={(e) => e.pointerType === "mouse" && hoverClose()}>
              <button
                ref={(el) => {
                  triggers.current[group.id] = el;
                }}
                type="button"
                className="ah-link"
                aria-haspopup="true"
                aria-expanded={menu === group.id}
                aria-current={active === group.id ? "page" : undefined}
                onClick={() => setMenu(menu === group.id ? "" : group.id)}
                onKeyDown={(e) => onTriggerKey(e, group)}
              >
                {group.label}
                <ChevronDown className="ah-caret" aria-hidden="true" />
              </button>
              {menu === group.id && (
                <div
                  ref={(el) => {
                    panels.current[group.id] = el;
                  }}
                  className="ah-panel"
                  onKeyDown={(e) => onPanelKey(e, group)}
                >
                  {group.columns.map((column) => (
                    <div key={column.title} className="ah-col">
                      <p className="ah-col-title">{column.title}</p>
                      {column.entries.map((entry) => (
                        <EntryButton key={entry.id} entry={entry} current={isCurrentEntry(entry, view, studioTab)} onPick={() => go(entry.target)} />
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </nav>

        <div className="ah-tools">
          <button type="button" className="ah-search" onClick={() => setSearchOpen(true)} aria-label="Search tools (⌘K)">
            <Search size={15} aria-hidden="true" />
            <span>Search</span>
            <kbd>⌘K</kbd>
          </button>
          <button type="button" className={`ah-icon ${running ? "is-busy" : ""}`} onClick={onOpenActivity} aria-label={running ? `Background activity, ${running} running` : "Background activity"} title="Background activity">
            {running ? <Loader2 size={16} className="ah-spin" /> : <Activity size={16} />}
            {running ? <span className="ah-count">{running}</span> : null}
          </button>
          <button type="button" className="ah-icon ah-hide-sm" onClick={() => onThemeChange(theme === "dark" ? "light" : "dark")} aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"} title={theme === "dark" ? "Light mode" : "Dark mode"}>
            {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          <div className="ah-account">
            <button type="button" className="ah-avatar" onClick={() => setAccountOpen(!accountOpen)} aria-haspopup="menu" aria-expanded={accountOpen} aria-label="Account" title={account.name}>
              <Avatar src={account.channelImage || account.image} label={account.channel || account.name} />
            </button>
            {accountOpen && (
              <div className="ah-account-panel" role="menu">
                <div className="ah-account-head">
                  <Avatar src={account.image} label={account.name} />
                  <span>
                    <strong>{account.name}</strong>
                    <small>{account.email}</small>
                  </span>
                </div>
                <button type="button" role="menuitem" onClick={() => { setAccountOpen(false); onOpenChannels(); }}>
                  <Users size={16} />
                  <span>
                    Switch channel
                    <small>{account.channel || "No channel connected"}</small>
                  </span>
                </button>
                <button type="button" role="menuitem" onClick={() => onThemeChange(theme === "dark" ? "light" : "dark")}>
                  {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
                  <span>{theme === "dark" ? "Light mode" : "Dark mode"}</span>
                </button>
                <button type="button" role="menuitem" onClick={() => { setAccountOpen(false); onLogout(); }}>
                  <LogOut size={16} />
                  <span>Log out</span>
                </button>
              </div>
            )}
          </div>
          <button type="button" className="ah-icon ah-menu" onClick={() => setMobileOpen(true)} aria-label="Open menu" aria-expanded={mobileOpen}>
            <Menu size={18} />
          </button>
        </div>
      </header>

      {searchOpen && <QuickSearch theme={theme} onClose={() => setSearchOpen(false)} onPick={go} />}
      {mobileOpen && <MobileMenu theme={theme} view={view} studioTab={studioTab} onClose={() => setMobileOpen(false)} onPick={go} onThemeChange={onThemeChange} />}
    </>
  );
}

function Avatar({ src, label }: { src: string; label: string }) {
  const [broken, setBroken] = useState(false);
  return src && !broken ? (
    <img className="ah-avatar-img" src={src} alt="" referrerPolicy="no-referrer" onError={() => setBroken(true)} />
  ) : (
    <span className="ah-avatar-img is-letter">{(label || "A").slice(0, 1).toUpperCase()}</span>
  );
}

function EntryButton({ entry, current, onPick }: { entry: NavEntry; current: boolean; onPick: () => void }) {
  return (
    <button type="button" className="ah-entry" aria-current={current ? "page" : undefined} onClick={onPick}>
      <span className="ah-entry-icon">{entry.icon}</span>
      <span className="ah-entry-text">
        <strong>{entry.label}</strong>
        <span>{entry.description}</span>
      </span>
    </button>
  );
}

function Overlay({ theme, onClose, className, label, children }: { theme: Theme; onClose: () => void; className: string; label: string; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = overflow;
      window.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, [onClose]);
  return createPortal(
    <div className={`ah-overlay ${className}`} data-theme={theme} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={panel} className="ah-sheet" role="dialog" aria-modal="true" aria-label={label}>
        {children}
      </div>
    </div>,
    document.body,
  );
}

function QuickSearch({ theme, onClose, onPick }: { theme: Theme; onClose: () => void; onPick: (target: NavTarget) => void }) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return ALL_NAV_ENTRIES.filter((entry) => !needle || `${entry.label} ${entry.description}`.toLowerCase().includes(needle)).slice(0, 12);
  }, [query]);
  useEffect(() => setIndex(0), [query]);
  return (
    <Overlay theme={theme} onClose={onClose} className="is-search" label="Search tools">
      <label className="ah-q">
        <Search size={17} aria-hidden="true" />
        <input
          autoFocus
          value={query}
          placeholder="Jump to a tool or studio"
          aria-label="Search tools"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              setIndex((i) => (i + (e.key === "ArrowDown" ? 1 : -1) + results.length) % Math.max(1, results.length));
            } else if (e.key === "Enter" && results[index]) onPick(results[index].target);
          }}
        />
        <kbd>Esc</kbd>
      </label>
      <div className="ah-q-list" role="listbox" aria-label="Results">
        {results.length ? (
          results.map((entry, i) => (
            <button key={entry.id} type="button" role="option" aria-selected={i === index} className="ah-entry" onMouseEnter={() => setIndex(i)} onClick={() => onPick(entry.target)}>
              <span className="ah-entry-icon">{entry.icon}</span>
              <span className="ah-entry-text">
                <strong>{entry.label}</strong>
                <span>{entry.description}</span>
              </span>
              {i === index && <ArrowRight size={15} className="ah-q-go" aria-hidden="true" />}
            </button>
          ))
        ) : (
          <p className="ah-q-empty">Nothing matches “{query}”.</p>
        )}
      </div>
    </Overlay>
  );
}

function MobileMenu({ theme, view, studioTab, onClose, onPick, onThemeChange }: { theme: Theme; view: MainView; studioTab?: StudioTab; onClose: () => void; onPick: (target: NavTarget) => void; onThemeChange: (theme: Theme) => void }) {
  const [open, setOpen] = useState(currentGroup(view, studioTab) || NAV_GROUPS[0].id);
  return (
    <Overlay theme={theme} onClose={onClose} className="is-mobile" label="Menu">
      <div className="ah-m-head">
        <span className="ah-logo">
          <img src="/favicon.svg" alt="" />
          <span>AutoYT</span>
        </span>
        <button type="button" className="ah-icon" onClick={onClose} aria-label="Close menu">
          <X size={18} />
        </button>
      </div>
      <div className="ah-m-body">
        <button type="button" className="ah-m-explore" onClick={() => onPick({ view: "tools" })}>
          Explore everything <ArrowRight size={16} />
        </button>
        {NAV_GROUPS.map((group) => (
          <section key={group.id} className="ah-m-group">
            <button type="button" className="ah-m-trigger" aria-expanded={open === group.id} onClick={() => setOpen(open === group.id ? "" : group.id)}>
              {group.label}
              <ChevronDown size={16} />
            </button>
            {open === group.id && (
              <div className="ah-m-entries">
                {group.columns.flatMap((column) => column.entries).map((entry) => (
                  <EntryButton key={entry.id} entry={entry} current={isCurrentEntry(entry, view, studioTab)} onPick={() => onPick(entry.target)} />
                ))}
              </div>
            )}
          </section>
        ))}
        <button type="button" className="ah-m-theme" onClick={() => onThemeChange(theme === "dark" ? "light" : "dark")}>
          {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          {theme === "dark" ? "Light mode" : "Dark mode"}
        </button>
      </div>
    </Overlay>
  );
}
