// Loading pages on demand without blank screens.
//
// Pages like Vibe Edit load as separate files whose names change on every
// deploy. A tab opened before a deploy still asks for the old name, which no
// longer exists, so the import fails. Without help that leaves an empty page
// until a manual reload. Here, a failed page load reloads the app once (fresh
// file names), and anything still failing shows a message with a Reload button.
import { Component, lazy, type ComponentType, type ReactNode } from "react";

const RELOAD_KEY = "autoyt-chunk-reload-at";
const RELOAD_GAP_MS = 15_000;

/** Is this the error a missing or unreachable page file produces? */
export function isChunkLoadError(error: unknown): boolean {
  const text = String((error as { message?: string })?.message || error || "");
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS|ChunkLoadError|Loading chunk .* failed|is not a valid JavaScript MIME type/i.test(text);
}

/** Reload the app, at most once every 15 seconds so a real outage can't loop. Returns whether it reloaded. */
export function reloadOnce(): boolean {
  try {
    const last = Number(window.sessionStorage.getItem(RELOAD_KEY) || 0);
    if (Date.now() - last < RELOAD_GAP_MS) return false;
    window.sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    // No session storage (private mode): reload anyway; the boundary stops a loop.
  }
  window.location.reload();
  return true;
}

/** React.lazy that recovers from a stale deploy by reloading once. */
export function lazyPage<T extends ComponentType<any>>(load: () => Promise<{ default: T }>) {
  return lazy(async () => {
    try {
      return await load();
    } catch (error) {
      // Hold the Suspense fallback on screen while the page reloads.
      if (isChunkLoadError(error) && reloadOnce()) return new Promise<{ default: T }>(() => undefined);
      throw error;
    }
  });
}

/** Vite reports failed preloads of a page's own files; recover the same way. */
export function installChunkRecovery() {
  window.addEventListener("vite:preloadError", (event) => {
    if (reloadOnce()) event.preventDefault();
  });
}

interface BoundaryProps {
  children: ReactNode;
  /** Changing this clears an earlier failure, e.g. when the person navigates away and back. */
  resetKey?: string;
  theme?: "light" | "dark";
}

/** Shows a short message instead of an empty page when a page fails to load or crashes. */
export class PageBoundary extends Component<BoundaryProps, { error: unknown; key?: string }> {
  state: { error: unknown; key?: string } = { error: null, key: this.props.resetKey };

  static getDerivedStateFromProps(props: BoundaryProps, state: { error: unknown; key?: string }) {
    return props.resetKey !== state.key ? { error: null, key: props.resetKey } : null;
  }

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  componentDidCatch(error: unknown) {
    console.error("Page failed to load", error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    const dark = this.props.theme !== "light";
    const stale = isChunkLoadError(this.state.error);
    return (
      <div role="alert" className={`flex h-full min-h-[320px] flex-col items-center justify-center gap-3 px-6 text-center ${dark ? "text-[#eceae3]" : "text-[#1b1b18]"}`}>
        <strong className="text-[15px] font-semibold">{stale ? "AutoYT was just updated" : "This page didn't load"}</strong>
        <p className={`m-0 max-w-[42ch] text-[13px] leading-relaxed ${dark ? "text-[#9b9a93]" : "text-[#66655e]"}`}>
          {stale ? "Reload to get the new version. Your saved work is safe." : "Something went wrong while opening it. Reloading usually fixes this, and your saved work is safe."}
        </p>
        <button type="button" onClick={() => window.location.reload()} className="mt-1 h-9 rounded-full bg-[#f9dc0b] px-4 text-[13px] font-semibold text-[#15130a] transition-colors duration-150 hover:bg-[#e7ca00] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ui-focus)]">
          Reload
        </button>
      </div>
    );
  }
}
