// Juel's way in. On desktop he stands at the bottom right of every page (drag him up or down if he's in
// the way); on phones he's the header's Juel button, since the bottom bar is the dock. The panel itself
// (and its players, reports, and animation) loads the first time it opens, so the first page of the site
// doesn't wait for it.
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { JuelMascot, playJuel, useJuelMood } from "./JuelMascot";
import { readDeepLink } from "../utils/tiktokRoute";

const JuelPanel = lazy(() => import("./JuelPanel").then((m) => ({ default: m.JuelPanel })));
// Juel's page tours load once the page has settled, so they never slow the first paint.
const JuelTourHost = lazy(() => import("./JuelTour"));

/** Opens the Juel panel from anywhere (a toast's "Ask Juel", a tour). */
export function openJuel() {
  window.dispatchEvent(new CustomEvent("juel:open"));
}

const LIFT_KEY = "juel:lift";
const readLift = () => {
  try {
    return Math.max(0, Number(window.localStorage.getItem(LIFT_KEY)) || 0);
  } catch {
    return 0;
  }
};
// Full-screen editors keep the whole canvas: Juel steps out of them.
const editorOpen = () => {
  try {
    return readDeepLink().view === "vibe-edit";
  } catch {
    return false;
  }
};

export function JuelButton() {
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState(false);
  const [tours, setTours] = useState(false);
  useEffect(() => {
    const idle = (window as Window & { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback;
    const load = () => setTours(true);
    const id = idle ? idle(load) : window.setTimeout(load, 1500);
    return () => (idle ? (window as Window & { cancelIdleCallback?: (n: number) => void }).cancelIdleCallback?.(id) : window.clearTimeout(id));
  }, []);
  // What Juel is doing (thinking, talking, done) shows on him, even with the panel closed.
  const mood = useJuelMood(hover || open ? "wave" : "idle");
  // Kept mounted while it animates away, so closing sinks it instead of cutting it.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    if (open) setMounted(true);
  }, [open]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "j") {
        event.preventDefault();
        setOpen((o) => !o);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("juel:open", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("juel:open", onOpen);
    };
  }, []);

  // Out of the way in full-screen editors and focus modes.
  const [hidden, setHidden] = useState(editorOpen);
  useEffect(() => {
    const onRoute = () => setHidden(editorOpen());
    const onFocus = (event: Event) => setHidden(Boolean((event as CustomEvent<boolean>).detail) || editorOpen());
    window.addEventListener("popstate", onRoute);
    window.addEventListener("autoyt-focus-mode", onFocus);
    return () => {
      window.removeEventListener("popstate", onRoute);
      window.removeEventListener("autoyt-focus-mode", onFocus);
    };
  }, []);

  // Now and then, while nobody is busy with him, he fidgets; after a few quiet minutes he dozes off.
  const lastActive = useRef(Date.now());
  useEffect(() => {
    const wake = () => {
      lastActive.current = Date.now();
    };
    window.addEventListener("pointermove", wake, { passive: true });
    window.addEventListener("keydown", wake);
    const timer = window.setInterval(() => {
      if (document.hidden || open) return;
      const quiet = Date.now() - lastActive.current;
      if (quiet > 4 * 60 * 1000) playJuel("sleep", 60 * 1000);
      else if (quiet > 40 * 1000 && Math.random() < 0.5) playJuel((["wiggle", "float", "nod", "peek"] as const)[Math.floor(Math.random() * 4)], 2600);
    }, 45 * 1000);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("pointermove", wake);
      window.removeEventListener("keydown", wake);
    };
  }, [open]);

  // Drag him up or down the right edge if he covers something; a drag is never a click.
  const [lift, setLift] = useState(readLift);
  const drag = useRef<{ y: number; lift: number; moved: boolean } | null>(null);
  const justDragged = useRef(false);
  const onPointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    drag.current = { y: event.clientY, lift, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d) return;
    const dy = d.y - event.clientY;
    if (!d.moved && Math.abs(dy) < 6) return;
    d.moved = true;
    setLift(Math.max(0, Math.min(window.innerHeight - 220, d.lift + dy)));
  };
  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    justDragged.current = Boolean(d?.moved);
    if (d?.moved) {
      try {
        window.localStorage.setItem(LIFT_KEY, String(Math.round(lift)));
      } catch {}
    }
  };
  const onFloatClick = () => {
    // The click that ends a drag doesn't open the panel.
    if (justDragged.current) {
      justDragged.current = false;
      return;
    }
    setOpen((o) => !o);
  };

  // Warm the panel's code on intent, so the first open is instant.
  const warm = () => void import("./JuelPanel");
  const hovering = {
    onPointerEnter: () => {
      warm();
      setHover(true);
    },
    onPointerLeave: () => setHover(false),
    onFocus: warm,
  };
  return (
    <>
      <button type="button" className={`juel-trigger${open ? " is-on" : ""}`} onClick={() => setOpen((o) => !o)} {...hovering} aria-expanded={open} aria-label="Ask Juel (⌘J)" title="Ask Juel (⌘J)">
        <JuelMascot pose={mood} size={22} framing="bust" className="juel-trigger-mascot" />
        <span>Juel</span>
      </button>
      {createPortal(
        <button
          type="button"
          className={`juel-float${open ? " is-on" : ""}${hidden ? " is-hidden" : ""}`}
          style={{ ["--juel-lift" as string]: `${lift}px` }}
          onClick={onFloatClick}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          {...hovering}
          aria-expanded={open}
          aria-label="Ask Juel (⌘J)"
          title="Ask Juel (⌘J). Drag to move him."
        >
          <JuelMascot pose={mood} size={76} />
        </button>,
        document.body,
      )}
      {tours ? <Suspense fallback={null}><JuelTourHost /></Suspense> : null}
      {mounted ? createPortal(<Suspense fallback={null}><JuelPanel onClose={() => setOpen(false)} leaving={!open} onLeft={() => setMounted(false)} /></Suspense>, document.body) : null}
    </>
  );
}
