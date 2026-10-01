import { useEffect, useState, type ComponentType } from "react";
import { Bot, Clapperboard, House, Youtube } from "lucide-react";
import { navigateInApp, tapFeedback } from "./bootstrap";
import { nativePlatform } from "./platform";
import "./native.css";

type Tab = {
  id: string;
  label: string;
  path: string;
  icon: ComponentType<{ size?: number; strokeWidth?: number; "aria-hidden"?: boolean }>;
  match: RegExp;
};

// Top-level sections only (HIG: 2–5 sections, never actions). Everything else
// stays reachable from the header menu and search.
const TABS: Tab[] = [
  { id: "explore", label: "Explore", path: "/", icon: House, match: /^\/(?:tools\/?)?$/ },
  { id: "create", label: "Create", path: "/create", icon: Clapperboard, match: /^\/(?:create|discover|projects|styles|drama)(?:\/|$)/ },
  { id: "agents", label: "Agents", path: "/agent", icon: Bot, match: /^\/(?:agent|automation)(?:\/|$)/ },
  { id: "channels", label: "Channels", path: "/channels", icon: Youtube, match: /^\/(?:channels|feed|publish)(?:\/|$)/ },
];

// Hub screens show the bar. Task screens (an open project, a studio, an agent
// chat) hide it like a pushed screen on iOS, so their docks keep the bottom edge.
const HUB_PATHS = /^\/(?:|tools|create|discover|projects|styles|drama|agent|automation|channels|feed|publish)\/?$/;

export function isHubPath(path: string): boolean {
  return HUB_PATHS.test(path);
}

export function activeTabId(path: string): string | null {
  return TABS.find((tab) => tab.match.test(path))?.id ?? null;
}

function usePathname(): string {
  const [path, setPath] = useState(() => window.location.pathname);
  useEffect(() => {
    const update = () => setPath(window.location.pathname);
    // App.tsx writes routes with pushState/replaceState, which fire no event.
    const { pushState, replaceState } = window.history;
    window.history.pushState = function patchedPush(...args) {
      pushState.apply(this, args);
      update();
    };
    window.history.replaceState = function patchedReplace(...args) {
      replaceState.apply(this, args);
      update();
    };
    window.addEventListener("popstate", update);
    return () => {
      window.history.pushState = pushState;
      window.history.replaceState = replaceState;
      window.removeEventListener("popstate", update);
    };
  }, []);
  return path;
}

export function NativeTabBar() {
  const platform = nativePlatform();
  const path = usePathname();
  const visible = Boolean(platform) && isHubPath(path);

  useEffect(() => {
    const root = document.documentElement;
    if (visible) root.dataset.nativeTabbar = "on";
    else delete root.dataset.nativeTabbar;
    return () => { delete root.dataset.nativeTabbar; };
  }, [visible]);

  if (!platform || !visible) return null;
  return (
    <nav className="ntb" data-platform={platform} aria-label="Sections">
      {TABS.map((tab) => {
        const active = activeTabId(path) === tab.id;
        const Icon = tab.icon;
        return (
          <a
            key={tab.id}
            href={tab.path}
            className="ntb-item"
            aria-current={active ? "page" : undefined}
            onClick={(event) => {
              event.preventDefault();
              if (!active) tapFeedback();
              navigateInApp(tab.path);
            }}
          >
            <span className="ntb-icon">
              <Icon size={24} strokeWidth={active ? 2.2 : 1.8} aria-hidden />
            </span>
            <span className="ntb-label">{tab.label}</span>
          </a>
        );
      })}
    </nav>
  );
}
