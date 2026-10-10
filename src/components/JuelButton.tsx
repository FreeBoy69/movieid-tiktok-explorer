// The header's Juel button. The panel itself (and its players, reports, and animation) loads the
// first time it opens, so the first page of the site doesn't wait for it.
import { lazy, Suspense, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Sparkles } from "lucide-react";

const JuelPanel = lazy(() => import("./JuelPanel").then((m) => ({ default: m.JuelPanel })));

export function JuelButton() {
  const [open, setOpen] = useState(false);
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
      <button type="button" className={`juel-trigger${open ? " is-on" : ""}`} onClick={() => setOpen((o) => !o)} onPointerEnter={warm} onFocus={warm} aria-expanded={open} aria-label="Ask Juel (⌘J)" title="Ask Juel (⌘J)">
        <Sparkles size={15} aria-hidden="true" />
        <span>Juel</span>
      </button>
      {mounted ? createPortal(<Suspense fallback={null}><JuelPanel onClose={() => setOpen(false)} leaving={!open} onLeft={() => setMounted(false)} /></Suspense>, document.body) : null}
    </>
  );
}
