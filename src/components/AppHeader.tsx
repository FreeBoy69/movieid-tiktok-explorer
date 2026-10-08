import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Activity, ArrowRight, AudioLines, Bot, ChevronDown, ChevronRight, Compass, Film, ImageIcon, LifeBuoy, Loader2, LogOut, Menu, Moon, PenLine, Search, SlidersHorizontal, Sun, Trash2, Users, Wrench, X, Youtube } from "lucide-react";
import { BillingOnboarding, BillingReturnVerifier, DeleteAccountDialog, SupportDialog, TokenSummary } from "./AccountServices";
import { ALL_NAV_ENTRIES, isCurrentEntry, MENU_ONLY_NAV_IDS, PRIMARY_NAV_CHILDREN, PRIMARY_NAV_ENTRIES, TOOL_NAV_GROUPS, type NavEntry, type NavGroup, type NavTarget } from "../utils/appNavigation";
import type { MainView, StudioTab, ToolId } from "../utils/tiktokRoute";
import { JuelButton } from "./JuelPanel";
import "./AppHeader.css";

type Theme = "light" | "dark";
// Theme-matched horizontal lockups copied from logo/ (white wordmark for dark, black for light).
const LOGO_SRC: Record<Theme, string> = { dark: "/brand/autoyt-dark-horizontal.png", light: "/brand/autoyt-light-horizontal.png" };
type Account = { name: string; email: string; image: string; channel: string; channelImage: string };

export function AppHeader({
  view,
  studioTab,
  toolId,
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
  toolId?: ToolId;
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
  const [deleteOpen, setDeleteOpen] = useState(false);
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
  // Priority+ navigation: every primary item that fits stays in the bar; the rest fold into
  // "More". Widths come from a hidden copy of the row so nothing jumps while measuring.
  const navRef = useRef<HTMLElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(PRIMARY_NAV_ENTRIES.length);
  useEffect(() => {
    const nav = navRef.current;
    const measure = measureRef.current;
    if (!nav || !measure) return;
    const fit = () => {
      const items = [...measure.querySelectorAll<HTMLElement>("[data-measure]")];
      const widths = Object.fromEntries(items.map((el) => [el.dataset.measure!, el.offsetWidth]));
      const gap = 2;
      const available = nav.clientWidth;
      const tools = (widths.tools || 0) + gap;
      const more = (widths.more || 0) + gap;
      let used = tools;
      let count = 0;
      for (const entry of PRIMARY_NAV_ENTRIES) {
        const width = (widths[entry.id] || 0) + gap;
        const rest = count + 1 < PRIMARY_NAV_ENTRIES.length ? more : 0;
        if (used + width + rest > available) break;
        used += width;
        count++;
      }
      setVisibleCount((current) => (current === count ? current : count));
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(nav);
    observer.observe(measure);
    return () => observer.disconnect();
  }, []);
  const shownPrimary = PRIMARY_NAV_ENTRIES.slice(0, visibleCount);
  const foldedPrimary = PRIMARY_NAV_ENTRIES.slice(visibleCount);
  const activePrimary = PRIMARY_NAV_ENTRIES.find((entry) => isCurrentEntry(entry, view, studioTab, toolId) || PRIMARY_NAV_CHILDREN[entry.id]?.some((child) => isCurrentEntry(child, view, studioTab, toolId)));
  const activeToolGroup = TOOL_NAV_GROUPS.find((group) => group.columns.some((column) => column.entries.some((entry) => isCurrentEntry(entry, view, studioTab, toolId))));
  const selectedToolGroup = TOOL_NAV_GROUPS.find((group) => group.id === toolCategory) || TOOL_NAV_GROUPS[0];
  const closeSupport = useCallback(() => setSupportOpen(false), []);
  const closeDelete = useCallback(() => setDeleteOpen(false), []);

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
      if (!target.closest(".ah-group, .ah-account, .as-billing-dialog")) {
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

        <nav ref={navRef} className="ah-nav" aria-label="Main">
          <div ref={measureRef} className="ah-nav-measure" aria-hidden="true">
            {PRIMARY_NAV_ENTRIES.map((entry) => <span key={entry.id} className="ah-link" data-measure={entry.id}>{entry.label}{(PRIMARY_NAV_CHILDREN[entry.id] || []).length > 0 && <ChevronDown className="ah-caret" />}</span>)}
            <span className="ah-link" data-measure="more">More <ChevronDown className="ah-caret" /></span>
            <span className="ah-link" data-measure="tools">Tools <ChevronDown className="ah-caret" /></span>
          </div>
          {shownPrimary.map((entry) => {
            const children = PRIMARY_NAV_CHILDREN[entry.id] || [];
            const menuOnly = MENU_ONLY_NAV_IDS.has(entry.id);
            return <div key={entry.id} className="ah-group" onPointerEnter={(e) => e.pointerType === "mouse" && children.length && hoverOpen(entry.id)} onPointerLeave={(e) => e.pointerType === "mouse" && children.length && hoverClose()}>
              <button ref={(el) => { triggers.current[entry.id] = el; }} type="button" className="ah-link" aria-current={activePrimary?.id === entry.id ? "page" : undefined} aria-haspopup={children.length ? "true" : undefined} aria-expanded={children.length ? menu === entry.id : undefined} onClick={() => menuOnly ? setMenu(menu === entry.id ? "" : entry.id) : go(entry.target)} onKeyDown={(event) => children.length && onTriggerKey(event, entry.id)}>
                {entry.label}{children.length > 0 && <ChevronDown className="ah-caret" aria-hidden="true" />}
              </button>
              {children.length > 0 && menu === entry.id && <div ref={(el) => { panels.current[entry.id] = el; }} className="ah-panel is-feature" onKeyDown={(event) => onPanelKey(event, entry.id)}>
                {children.map((child) => <EntryButton key={child.id} entry={child} current={isCurrentEntry(child, view, studioTab, toolId)} onPick={() => go(child.target)} />)}
              </div>}
            </div>;
          })}
          {foldedPrimary.length > 0 && (
            <div className="ah-group" onPointerEnter={(e) => e.pointerType === "mouse" && hoverOpen("more")} onPointerLeave={(e) => e.pointerType === "mouse" && hoverClose()}>
              <button ref={(el) => { triggers.current.more = el; }} type="button" className="ah-link" aria-haspopup="true" aria-expanded={menu === "more"} aria-current={activePrimary && foldedPrimary.some((entry) => entry.id === activePrimary.id) ? "page" : undefined} onClick={() => setMenu(menu === "more" ? "" : "more")} onKeyDown={(event) => onTriggerKey(event, "more")}>
                More <ChevronDown className="ah-caret" aria-hidden="true" />
              </button>
              {menu === "more" && (
                <div ref={(el) => { panels.current.more = el; }} className="ah-panel is-more" onKeyDown={(event) => onPanelKey(event, "more")}>
                  <div className="ah-col">
                    {foldedPrimary.filter((entry) => !MENU_ONLY_NAV_IDS.has(entry.id)).map((entry) => <EntryButton key={entry.id} entry={entry} current={isCurrentEntry(entry, view, studioTab, toolId)} onPick={() => go(entry.target)} />)}
                  </div>
                  {foldedPrimary.filter((entry) => (PRIMARY_NAV_CHILDREN[entry.id] || []).length > 0).map((entry) => (
                    <div key={entry.id} className="ah-col">
                      <p className="ah-col-title">{entry.label}</p>
                      {(PRIMARY_NAV_CHILDREN[entry.id] || []).map((child) => <EntryButton key={child.id} entry={child} current={isCurrentEntry(child, view, studioTab, toolId)} onPick={() => go(child.target)} />)}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
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
                      <EntryButton key={entry.id} entry={entry} current={isCurrentEntry(entry, view, studioTab, toolId)} onPick={() => go(entry.target)} />
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
          {signedIn ? <JuelButton /> : null}
          <button type="button" className={`ah-icon ${running ? "is-busy" : ""}`} onClick={onOpenActivity} aria-label={running ? `Background activity, ${running} running` : "Background activity"} title="Background activity">
            {running ? <Loader2 size={16} className="ah-spin" /> : <Activity size={16} />}
            {running ? <span className="ah-count">{running}</span> : null}
          </button>
          <button type="button" className="ah-icon ah-hide-sm" onClick={() => onThemeChange(theme === "dark" ? "light" : "dark")} aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"} title={theme === "dark" ? "Light mode" : "Dark mode"}>
            {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          {signedIn ? <div className="ah-account">
            <button type="button" className="ah-avatar" onClick={() => setAccountOpen(!accountOpen)} aria-haspopup="menu" aria-expanded={accountOpen} aria-label="Account" title={account.name}>
              <Avatar src={account.image} label={account.name} />
            </button>
            {accountOpen && (
              <div className="ah-account-panel" role="menu">
                <button type="button" role="menuitem" className="ah-account-head" onClick={() => { setAccountOpen(false); go({ view: "account" }); }} title="Account settings">
                  <Avatar src={account.image} label={account.name} />
                  <span>
                    <strong>{account.name}</strong>
                    <small>{account.email}</small>
                  </span>
                  <ChevronRight size={16} className="ah-account-head-go" aria-hidden="true" />
                </button>
                <TokenSummary theme={theme} email={account.email} />
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
                <button type="button" role="menuitem" className="ah-danger" onClick={() => { setAccountOpen(false); setDeleteOpen(true); }}>
                  <Trash2 size={16} />
                  <span>Delete account</span>
                </button>
              </div>
            )}
            <SupportDialog open={supportOpen} onClose={closeSupport} theme={theme} />
            <DeleteAccountDialog open={deleteOpen} onClose={closeDelete} theme={theme} />
          </div> : <button type="button" className="ah-get-started" onClick={onSignIn}>Get started <ArrowRight size={15} aria-hidden="true" /></button>}
          <button type="button" className="ah-icon ah-menu" onClick={() => setMobileOpen(true)} aria-label="Open menu" aria-expanded={mobileOpen}>
            <Menu size={18} />
          </button>
        </div>
      </header>

      {signedIn ? <><BillingReturnVerifier email={account.email} /><BillingOnboarding theme={theme} email={account.email} /></> : null}
      {searchOpen && <QuickSearch theme={theme} onClose={() => setSearchOpen(false)} onPick={go} />}
      {mobileOpen && <MobileMenu theme={theme} view={view} studioTab={studioTab} toolId={toolId} account={account} signedIn={signedIn} onSignIn={() => { setMobileOpen(false); onSignIn(); }} onLogout={() => { setMobileOpen(false); onLogout(); }} onSearch={() => { setMobileOpen(false); setSearchOpen(true); }} onClose={() => setMobileOpen(false)} onPick={go} onThemeChange={onThemeChange} />}
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

const GROUP_ICONS: Record<string, ReactNode> = {
  image: <ImageIcon size={18} strokeWidth={1.8} />,
  video: <Film size={18} strokeWidth={1.8} />,
  audio: <AudioLines size={18} strokeWidth={1.8} />,
  "image-tools": <SlidersHorizontal size={18} strokeWidth={1.8} />,
  research: <Compass size={18} strokeWidth={1.8} />,
  tools: <Wrench size={18} strokeWidth={1.8} />,
  writing: <PenLine size={18} strokeWidth={1.8} />,
  agents: <Bot size={18} strokeWidth={1.8} />,
  channels: <Youtube size={18} strokeWidth={1.8} />,
};

/** The phone menu: one scrolling sheet with Studios, Tools, and the account at the foot. */
function MobileMenu({ theme, view, studioTab, toolId, account, signedIn, onSignIn, onLogout, onSearch, onClose, onPick, onThemeChange }: {
  theme: Theme;
  view: MainView;
  studioTab?: StudioTab;
  toolId?: ToolId;
  account: Account;
  signedIn: boolean;
  onSignIn: () => void;
  onLogout: () => void;
  onSearch: () => void;
  onClose: () => void;
  onPick: (target: NavTarget) => void;
  onThemeChange: (theme: Theme) => void;
}) {
  const current = (entry: NavEntry) => isCurrentEntry(entry, view, studioTab, toolId);
  const activeGroup = TOOL_NAV_GROUPS.find((group) => group.columns.some((column) => column.entries.some(current)))?.id || "";
  const activeParent = PRIMARY_NAV_ENTRIES.find((entry) => PRIMARY_NAV_CHILDREN[entry.id]?.some(current))?.id || "";
  const [open, setOpen] = useState(activeParent || activeGroup);
  const toggle = (id: string) => setOpen((value) => (value === id ? "" : id));
  const groupEntries = (group: NavGroup) => group.columns.flatMap((column) => column.entries);
  return (
    <Overlay theme={theme} onClose={onClose} className="is-mobile" label="Menu">
      <div className="ah-m-head">
        <span className="ah-logo"><img src={LOGO_SRC[theme]} alt="AutoYT" /></span>
        <div className="ah-m-head-tools">
          <button type="button" className="ah-icon" onClick={onSearch} aria-label="Search"><Search size={18} /></button>
          <button type="button" className="ah-icon" onClick={onClose} aria-label="Close menu"><X size={18} /></button>
        </div>
      </div>
      <div className="ah-m-body">
        <button type="button" className="ah-m-search" onClick={onSearch}>
          <Search size={16} aria-hidden="true" />
          <span>Search every tool</span>
        </button>

        <section className="ah-m-section" aria-labelledby="ah-m-studios">
          <h2 id="ah-m-studios" className="ah-m-label">Studios</h2>
          <div className="ah-m-list">
            {PRIMARY_NAV_ENTRIES.map((entry) => {
              const children = PRIMARY_NAV_CHILDREN[entry.id] || [];
              const menuOnly = MENU_ONLY_NAV_IDS.has(entry.id);
              const expanded = open === entry.id;
              const isCurrent = current(entry) || children.some(current);
              return (
                <div key={entry.id} className="ah-m-row" data-open={expanded ? "true" : undefined}>
                  <div className="ah-m-row-main">
                    <button type="button" className="ah-m-item" aria-current={isCurrent ? "page" : undefined} aria-expanded={menuOnly ? expanded : undefined} onClick={() => (menuOnly ? toggle(entry.id) : onPick(entry.target))}>
                      <span className="ah-m-icon">{entry.icon}</span>
                      <span className="ah-m-item-text">
                        <strong>{entry.label}</strong>
                        <span>{menuOnly ? `${children.length} studios` : entry.description}</span>
                      </span>
                      {menuOnly ? <ChevronDown className="ah-m-chevron" size={18} aria-hidden="true" /> : <ChevronRight className="ah-m-chevron" size={18} aria-hidden="true" />}
                    </button>
                    {!menuOnly && children.length > 0 ? (
                      <button type="button" className="ah-m-expand" aria-label={`${expanded ? "Hide" : "Show"} ${entry.label} options`} aria-expanded={expanded} onClick={() => toggle(entry.id)}>
                        <ChevronDown size={18} aria-hidden="true" />
                      </button>
                    ) : null}
                  </div>
                  {expanded && children.length > 0 ? (
                    <div className="ah-m-children">
                      {children.map((child) => <EntryButton key={child.id} entry={child} current={current(child)} onPick={() => onPick(child.target)} />)}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>

        <section className="ah-m-section" aria-labelledby="ah-m-tools">
          <h2 id="ah-m-tools" className="ah-m-label">Tools</h2>
          <div className="ah-m-list">
            {TOOL_NAV_GROUPS.map((group) => {
              const entries = groupEntries(group);
              const expanded = open === group.id;
              return (
                <div key={group.id} className="ah-m-row" data-open={expanded ? "true" : undefined}>
                  <div className="ah-m-row-main">
                    <button type="button" className="ah-m-item" aria-expanded={expanded} aria-current={activeGroup === group.id ? "page" : undefined} onClick={() => toggle(group.id)}>
                      <span className="ah-m-icon">{GROUP_ICONS[group.id] || <Wrench size={18} strokeWidth={1.8} />}</span>
                      <span className="ah-m-item-text">
                        <strong>{group.label}</strong>
                        <span>{entries.length} {entries.length === 1 ? "tool" : "tools"}</span>
                      </span>
                      <ChevronDown className="ah-m-chevron" size={18} aria-hidden="true" />
                    </button>
                  </div>
                  {expanded ? (
                    <div className="ah-m-children">
                      {entries.map((entry) => <EntryButton key={entry.id} entry={entry} current={current(entry)} onPick={() => onPick(entry.target)} />)}
                    </div>
                  ) : null}
                </div>
              );
            })}
            <div className="ah-m-row">
              <div className="ah-m-row-main">
                <button type="button" className="ah-m-item is-link" onClick={() => onPick({ view: "tools" })}>
                  <span className="ah-m-icon is-accent"><ArrowRight size={18} strokeWidth={2} /></span>
                  <span className="ah-m-item-text"><strong>All tools</strong><span>Browse everything on one page</span></span>
                  <ChevronRight className="ah-m-chevron" size={18} aria-hidden="true" />
                </button>
              </div>
            </div>
          </div>
        </section>
      </div>
      <footer className="ah-m-foot">
        {signedIn ? (
          <div className="ah-m-account">
            <button type="button" className="ah-m-account-open" onClick={() => onPick({ view: "account" })} aria-label="Account settings">
              <Avatar src={account.image} label={account.name} />
              <span className="ah-m-item-text">
                <strong>{account.name}</strong>
                <span>{account.email}</span>
              </span>
            </button>
            <button type="button" className="ah-icon" onClick={onLogout} aria-label="Log out" title="Log out"><LogOut size={17} /></button>
          </div>
        ) : (
          <button type="button" className="ah-get-started ah-m-signin" onClick={onSignIn}>Get started <ArrowRight size={15} aria-hidden="true" /></button>
        )}
        <div className="ah-m-theme" role="radiogroup" aria-label="Theme">
          <button type="button" role="radio" aria-checked={theme === "light"} onClick={() => onThemeChange("light")}><Sun size={15} aria-hidden="true" />Light</button>
          <button type="button" role="radio" aria-checked={theme === "dark"} onClick={() => onThemeChange("dark")}><Moon size={15} aria-hidden="true" />Dark</button>
        </div>
      </footer>
    </Overlay>
  );
}
