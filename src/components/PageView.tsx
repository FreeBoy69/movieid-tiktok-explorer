// Every page enters and leaves the same way, so moving around AutoYT feels like one product.
//
// Entry: the page rises 14px out of a soft blur, and its main blocks (title, box, tabs, the first
// cards) follow in a short cascade. Exit: a quick fade upward, so the next page isn't kept waiting.
// GSAP runs both; AnimatePresence decides when a page leaves (usePresence), and the exit tells it
// when it's gone. People who ask for less motion get a plain fade.
import { type ReactNode, useEffect, useLayoutEffect, useRef } from "react";
import { usePresence } from "motion/react";
import gsap from "gsap";

const ENTER = { duration: 0.6, ease: "expo.out" };
const EXIT = { duration: 0.2, ease: "power2.in" };
const CASCADE = { y: 16, stagger: 0.055, duration: 0.7, ease: "expo.out", max: 8 };

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** The blocks a page is made of: walk down through single-child wrappers to the first element with
 *  several children, and take those (visible, in the flow, at most eight). */
export function pageBlocks(container: HTMLElement): HTMLElement[] {
  let node: HTMLElement = container;
  for (let depth = 0; depth < 8; depth++) {
    const kids = [...node.children].filter((el): el is HTMLElement => el instanceof HTMLElement);
    if (kids.length !== 1) break;
    node = kids[0];
  }
  return [...node.children]
    .filter((el): el is HTMLElement => el instanceof HTMLElement)
    .filter((el) => {
      if (!el.offsetHeight && !el.offsetWidth) return false;
      const position = getComputedStyle(el).position;
      return position !== "fixed" && position !== "sticky";
    })
    .slice(0, CASCADE.max);
}

/** A page still waiting for its code shows the logo loader; its blocks cascade once they arrive. */
const isLoading = (container: HTMLElement) => !!container.querySelector(".bl, [aria-busy='true']") && container.textContent!.trim().length < 40;

function cascade(container: HTMLElement) {
  const blocks = pageBlocks(container);
  if (blocks.length < 2) return null;
  return gsap.fromTo(blocks, { opacity: 0, y: CASCADE.y }, { opacity: 1, y: 0, duration: CASCADE.duration, ease: CASCADE.ease, stagger: CASCADE.stagger, clearProps: "opacity,transform" });
}

/** A page in the app's page switcher. `revealKey` replays the cascade when the page shows something
 *  new without leaving (a studio's tab). `cascade={false}` for editors, whose parts manage themselves. */
export function PageView({ children, className, revealKey, cascade: withCascade = true }: { children: ReactNode; className?: string; revealKey?: string; cascade?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [present, safeToRemove] = usePresence();
  const first = useRef(true);

  // Entry, before the first paint so nothing flashes in at full strength.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (reducedMotion()) {
      const fade = gsap.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 0.2, clearProps: "opacity" });
      return () => void fade.kill();
    }
    const tweens: Array<gsap.core.Tween | null> = [gsap.fromTo(el, { opacity: 0, y: 14, filter: "blur(6px)" }, { opacity: 1, y: 0, filter: "blur(0px)", ...ENTER, clearProps: "opacity,transform,filter" })];
    let observer: MutationObserver | null = null;
    let stopWatching = 0;
    if (withCascade) {
      if (!isLoading(el)) tweens.push(cascade(el));
      else {
        // The page's code is still downloading: cascade its blocks when they replace the loader.
        observer = new MutationObserver(() => {
          if (isLoading(el)) return;
          observer?.disconnect();
          tweens.push(cascade(el));
        });
        observer.observe(el, { childList: true, subtree: true });
        stopWatching = window.setTimeout(() => observer?.disconnect(), 4000);
      }
    }
    return () => {
      observer?.disconnect();
      window.clearTimeout(stopWatching);
      tweens.forEach((t) => t?.kill());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A new tab inside the same page: its blocks cascade in again (no exit, no blur).
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const el = ref.current;
    if (!el || !withCascade || reducedMotion()) return;
    const frame = requestAnimationFrame(() => {
      tween = cascade(el);
    });
    let tween: gsap.core.Tween | null = null;
    return () => {
      cancelAnimationFrame(frame);
      tween?.kill();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealKey]);

  // Exit: AnimatePresence keeps the page until this says it's gone.
  useEffect(() => {
    if (present) return;
    const el = ref.current;
    if (!el) {
      safeToRemove?.();
      return;
    }
    gsap.killTweensOf(el);
    const out = reducedMotion()
      ? gsap.to(el, { opacity: 0, duration: 0.12, onComplete: () => safeToRemove?.() })
      : gsap.to(el, { opacity: 0, y: -8, filter: "blur(4px)", ...EXIT, onComplete: () => safeToRemove?.() });
    return () => void out.kill();
  }, [present, safeToRemove]);

  return (
    <div ref={ref} className={className} data-page-view="">
      {children}
    </div>
  );
}
