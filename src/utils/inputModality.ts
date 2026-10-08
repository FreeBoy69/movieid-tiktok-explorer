// Marks <html data-input="keyboard" | "pointer"> so focus rings show only while the
// person navigates with the keyboard (Tab, arrows), never after a click, tap or typing.
const NAV_KEYS = new Set(["Tab", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"]);

export function installInputModality(root: HTMLElement = document.documentElement) {
  const set = (mode: "keyboard" | "pointer") => {
    if (root.dataset.input !== mode) root.dataset.input = mode;
  };
  set("pointer");
  const onKey = (event: KeyboardEvent) => {
    if (!NAV_KEYS.has(event.key) || event.metaKey || event.ctrlKey || event.altKey) return;
    // Arrows and Home/End inside a text field move the caret; only Tab means navigation there.
    const target = event.target as HTMLElement | null;
    const typing = !!target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
    if (typing && event.key !== "Tab") return;
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
