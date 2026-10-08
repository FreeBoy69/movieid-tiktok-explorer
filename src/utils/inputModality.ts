// Marks <html data-input="keyboard" | "pointer"> so focus rings show only while the
// person moves focus with Tab, never after a click, tap or typing. Arrows, Home and End
// are not counted: the players and editors use them as shortcuts (seek, nudge, jump),
// and counting them put a ring around whatever had focus mid-playback.
const NAV_KEYS = new Set(["Tab"]);

export function installInputModality(root: HTMLElement = document.documentElement) {
  const set = (mode: "keyboard" | "pointer") => {
    if (root.dataset.input !== mode) root.dataset.input = mode;
  };
  set("pointer");
  const onKey = (event: KeyboardEvent) => {
    if (!NAV_KEYS.has(event.key) || event.metaKey || event.ctrlKey || event.altKey) return;
    set("keyboard");
  };
  const onPointer = () => set("pointer");
  window.addEventListener("keydown", onKey, true);
  window.addEventListener("pointerdown", onPointer, true);
  return () => {
    window.removeEventListener("keydown", onKey, true);
    window.removeEventListener("pointerdown", onPointer, true);
  };
}
