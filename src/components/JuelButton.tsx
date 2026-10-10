// The header's Juel button. The panel itself (and its players, reports, and animation) loads the
// first time it opens, so the first page of the site doesn't wait for it.
import { lazy, Suspense, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { JuelMascot, useJuelMood } from "./JuelMascot";

const JuelPanel = lazy(() => import("./JuelPanel").then((m) => ({ default: m.JuelPanel })));
// Juel's page tours load once the page has settled, so they never slow the first paint.
const JuelTourHost = lazy(() => import("./JuelTour"));

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
  // What Juel is doing (thinking, talking, done) shows on the button too, even with the panel closed.
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
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  // Warm the panel's code on intent, so the first open is instant.
  const warm = () => void import("./JuelPanel");
  return (
    <>
      <button type="button" className={`juel-trigger${open ? " is-on" : ""}`} onClick={() => setOpen((o) => !o)} onPointerEnter={() => { warm(); setHover(true); }} onPointerLeave={() => setHover(false)} onFocus={warm} aria-expanded={open} aria-label="Ask Juel (⌘J)" title="Ask Juel (⌘J)">
        <JuelMascot pose={mood} size={22} framing="bust" className="juel-trigger-mascot" />
        <span>Juel</span>
      </button>
      {tours ? <Suspense fallback={null}><JuelTourHost /></Suspense> : null}
      {mounted ? createPortal(<Suspense fallback={null}><JuelPanel onClose={() => setOpen(false)} leaving={!open} onLeft={() => setMounted(false)} /></Suspense>, document.body) : null}
    </>
  );
}
