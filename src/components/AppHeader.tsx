import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Activity, ArrowRight, ChevronDown, LifeBuoy, Loader2, LogOut, Menu, Moon, Search, Sun, Users, X } from "lucide-react";
import { SupportDialog, TokenSummary } from "./AccountServices";
import { ALL_NAV_ENTRIES, isCurrentEntry, PRIMARY_NAV_CHILDREN, PRIMARY_NAV_ENTRIES, TOOL_NAV_GROUPS, type NavEntry, type NavTarget } from "../utils/appNavigation";
import type { MainView, StudioTab } from "../utils/tiktokRoute";
import "./AppHeader.css";

type Theme = "light" | "dark";
// Theme-matched horizontal lockups copied from logo/ (white wordmark for dark, black for light).
const LOGO_SRC: Record<Theme, string> = { dark: "/brand/autoyt-dark-horizontal.png", light: "/brand/autoyt-light-horizontal.png" };
type Account = { name: string; email: string; image: string; channel: string; channelImage: string };

export function AppHeader({
  view,
  studioTab,
  theme,
  overHero = "",
  account,
  signedIn = true,
  onSignIn = () => {},
  onNavigate,
  onThemeChange,
  onOpenActivity,
  onOpenChannels,
  onLogout,
}: {
  view: MainView;
  studioTab?: StudioTab;
  theme: Theme;
  overHero?: "" | "top" | "scrolled";
  account: Account;
  signedIn?: boolean;
  onSignIn?: () => void;
  onNavigate: (target: NavTarget) => void;
  onThemeChange: (theme: Theme) => void;
  onOpenActivity: () => void;
  onOpenChannels: (anchor: DOMRect) => void;
  onLogout: () => void;
}) {
  const [menu, setMenu] = useState("");
  const [toolCategory, setToolCategory] = useState("video");
  const [searchOpen, setSearchOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [supportOpen, setSupportOpen] = useState(false);
  useEffect(() => {
    const onOpen = () => setSupportOpen(true);
    window.addEventListener("autoyt-open-support", onOpen);
    return () => window.removeEventListener("autoyt-open-support", onOpen);
  }, []);
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
  const activePrimary = PRIMARY_NAV_ENTRIES.find((entry) => isCurrentEntry(entry, view, studioTab) || PRIMARY_NAV_CHILDREN[entry.id]?.some((child) => isCurrentEntry(child, view, studioTab)));
  const activeToolGroup = TOOL_NAV_GROUPS.find((group) => group.columns.some((column) => column.entries.some((entry) => isCurrentEntry(entry, view, studioTab))));
  const selectedToolGroup = TOOL_NAV_GROUPS.find((group) => group.id === toolCategory) || TOOL_NAV_GROUPS[0];
  const closeSupport = useCallback(() => setSupportOpen(false), []);

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

  function onTriggerKey(event: ReactKeyboardEvent, id: string) {
    if (event.key === "ArrowDown" || (id === "tools" && ["Enter", " "].includes(event.key))) {
      event.preventDefault();
      if (id === "tools") setToolCategory(activeToolGroup?.id || TOOL_NAV_GROUPS[0].id);
      setMenu(id);
      requestAnimationFrame(() => panels.current[id]?.querySelector<HTMLElement>("button")?.focus());
    } else if (event.key === "Escape") setMenu("");
  }
  function onPanelKey(event: ReactKeyboardEvent, id: string) {
    const items = [...(panels.current[id]?.querySelectorAll<HTMLElement>("button") || [])];
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === "Escape") {
      event.preventDefault();
      setMenu("");
      triggers.current[id]?.focus();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      items[(index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
    }
  }

  return (
    <>
      <header className="ah" data-theme={theme} data-over-hero={overHero || undefined}>
        <button type="button" className="ah-logo" onClick={() => go({ view: "tools" })} aria-label="AutoYT home">
          <img src={LOGO_SRC[overHero === "top" ? "dark" : theme]} alt="" />
        </button>

        <nav className="ah-nav" aria-label="Main">
          {PRIMARY_NAV_ENTRIES.map((entry) => {
            const children = PRIMARY_NAV_CHILDREN[entry.id] || [];
            return <div key={entry.id} className="ah-group" onPointerEnter={(e) => e.pointerType === "mouse" && children.length && hoverOpen(entry.id)} onPointerLeave={(e) => e.pointerType === "mouse" && children.length && hoverClose()}>
              <button ref={(el) => { triggers.current[entry.id] = el; }} type="button" className="ah-link" aria-current={activePrimary?.id === entry.id ? "page" : undefined} aria-haspopup={children.length ? "true" : undefined} aria-expanded={children.length ? menu === entry.id : undefined} onClick={() => go(entry.target)} onKeyDown={(event) => children.length && onTriggerKey(event, entry.id)}>
                {entry.label}{children.length > 0 && <ChevronDown className="ah-caret" aria-hidden="true" />}
              </button>
              {children.length > 0 && menu === entry.id && <div ref={(el) => { panels.current[entry.id] = el; }} className="ah-panel is-feature" onKeyDown={(event) => onPanelKey(event, entry.id)}>
                {children.map((child) => <EntryButton key={child.id} entry={child} current={isCurrentEntry(child, view, studioTab)} onPick={() => go(child.target)} />)}
              </div>}
            </div>;
          })}
          <div className="ah-group ah-tools-group" onPointerEnter={(e) => { if (e.pointerType === "mouse") { setToolCategory(activeToolGroup?.id || TOOL_NAV_GROUPS[0].id); hoverOpen("tools"); } }} onPointerLeave={(e) => e.pointerType === "mouse" && hoverClose()}>
            <button
              ref={(el) => { triggers.current.tools = el; }}
              type="button"
              className="ah-link"
              aria-haspopup="true"
              aria-expanded={menu === "tools"}
              aria-current={(view === "tools" || activeToolGroup) && !activePrimary ? "page" : undefined}
              onClick={() => { setToolCategory(activeToolGroup?.id || TOOL_NAV_GROUPS[0].id); setMenu(menu === "tools" ? "" : "tools"); }}
              onKeyDown={(event) => onTriggerKey(event, "tools")}
            >
              Tools <ChevronDown className="ah-caret" aria-hidden="true" />
            </button>
            {menu === "tools" && (
              <div ref={(el) => { panels.current.tools = el; }} className="ah-panel is-tools" onKeyDown={(event) => onPanelKey(event, "tools")}>
                <div className="ah-tool-categories" aria-label="Tool categories">
                  {TOOL_NAV_GROUPS.map((group) => (
                    <button key={group.id} type="button" className="ah-tool-category" aria-pressed={selectedToolGroup.id === group.id} onPointerEnter={(e) => e.pointerType === "mouse" && setToolCategory(group.id)} onFocus={() => setToolCategory(group.id)} onClick={() => setToolCategory(group.id)}>
                      {group.label}<ArrowRight size={14} aria-hidden="true" />
                    </button>
                  ))}
                  <button type="button" className="ah-tool-all" onClick={() => go({ view: "tools" })}>All tools <ArrowRight size={14} aria-hidden="true" /></button>
                </div>
                <div className="ah-tool-content">
                  <p className="ah-col-title">{selectedToolGroup.label}</p>
                  <div className="ah-tool-entries">
                    {selectedToolGroup.columns.flatMap((column) => column.entries).map((entry) => (
                      <EntryButton key={entry.id} entry={entry} current={isCurrentEntry(entry, view, studioTab)} onPick={() => go(entry.target)} />
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
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
          {signedIn ? <div className="ah-account">
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
                <TokenSummary />
                <button type="button" role="menuitem" onClick={(event) => { onOpenChannels(event.currentTarget.querySelector("svg")?.getBoundingClientRect() || event.currentTarget.getBoundingClientRect()); setAccountOpen(false); }}>
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
                <button type="button" role="menuitem" onClick={() => { setAccountOpen(false); setSupportOpen(true); }}>
                  <LifeBuoy size={16} />
                  <span>Help & support</span>
                </button>
                <button type="button" role="menuitem" onClick={() => { setAccountOpen(false); onLogout(); }}>
                  <LogOut size={16} />
                  <span>Log out</span>
                </button>
              </div>
            )}
            <SupportDialog open={supportOpen} onClose={closeSupport} theme={theme} />
          </div> : <button type="button" className="ah-get-started" onClick={onSignIn}>Get started <ArrowRight size={15} aria-hidden="true" /></button>}
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
  const activeGroup = TOOL_NAV_GROUPS.find((group) => group.columns.some((column) => column.entries.some((entry) => isCurrentEntry(entry, view, studioTab))))?.id || "";
  const activeParent = PRIMARY_NAV_ENTRIES.find((entry) => PRIMARY_NAV_CHILDREN[entry.id]?.some((child) => isCurrentEntry(child, view, studioTab)))?.id || "";
  const [open, setOpen] = useState(activeParent || activeGroup);
  return (
    <Overlay theme={theme} onClose={onClose} className="is-mobile" label="Menu">
      <div className="ah-m-head">
        <span className="ah-logo">
          <img src={LOGO_SRC[theme]} alt="AutoYT" />
        </span>
        <button type="button" className="ah-icon" onClick={onClose} aria-label="Close menu">
          <X size={18} />
        </button>
      </div>
      <div className="ah-m-body">
        <div className="ah-m-primary">
          {PRIMARY_NAV_ENTRIES.map((entry) => {
            const children = PRIMARY_NAV_CHILDREN[entry.id] || [];
            return <div key={entry.id} className="ah-m-primary-item">
              <button type="button" className="ah-m-primary-link" aria-current={isCurrentEntry(entry, view, studioTab) ? "page" : undefined} onClick={() => onPick(entry.target)}>{entry.label}</button>
              {children.length > 0 && <button type="button" className="ah-m-expand" aria-label={`${open === entry.id ? "Collapse" : "Expand"} ${entry.label}`} aria-expanded={open === entry.id} onClick={() => setOpen(open === entry.id ? "" : entry.id)}><ChevronDown size={16} aria-hidden="true" /></button>}
              {open === entry.id && children.length > 0 && <div className="ah-m-primary-children">{children.map((child) => <EntryButton key={child.id} entry={child} current={isCurrentEntry(child, view, studioTab)} onPick={() => onPick(child.target)} />)}</div>}
            </div>;
          })}
        </div>
        <button type="button" className="ah-m-section-title" onClick={() => onPick({ view: "tools" })}>Tools <ArrowRight size={15} aria-hidden="true" /></button>
        {TOOL_NAV_GROUPS.map((group) => (
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
