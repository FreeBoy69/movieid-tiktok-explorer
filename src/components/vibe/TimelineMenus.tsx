// The timeline's right-click menu and its keyboard reference. Both float in
// fixed position so the timeline's scroll box never clips them.
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { Ban, X } from "lucide-react";

export type MenuEntry =
  | { label: string; icon?: ReactNode; keys?: string; danger?: boolean; disabled?: boolean; onSelect: () => void }
  | { swatches: { id: string; name: string; color: string }[]; current?: string; onPick: (id: string | null) => void }
  | "sep";

export function ContextMenu({ x, y, items, label, onClose }: { x: number; y: number; items: MenuEntry[]; label: string; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  // Keep the whole menu on screen: flip left or up near the edges.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    setPos({
      left: x + box.width + 8 > window.innerWidth ? Math.max(8, x - box.width) : x,
      top: y + box.height + 8 > window.innerHeight ? Math.max(8, y - box.height) : y,
    });
    el.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }, [x, y]);

  useEffect(() => {
    const away = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("pointerdown", away, true);
    window.addEventListener("keydown", key, true);
    window.addEventListener("resize", onClose);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("pointerdown", away, true);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  // Arrow keys walk the enabled items, wrapping at the ends.
  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    e.stopPropagation();
    const buttons = [...(ref.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") || [])];
    if (!buttons.length) return;
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === "Home" ? 0 : e.key === "End" ? buttons.length - 1 : (at + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next].focus();
  };

  return (
    <div ref={ref} className="ui-menu ve-menu" role="menu" aria-label={label} style={pos} onKeyDown={onKeyDown} onContextMenu={(e) => e.preventDefault()}>
      {items.map((item, i) =>
        item === "sep" ? (
          <span key={`sep-${i}`} className="ui-menu-sep" role="separator" />
        ) : "swatches" in item ? (
          <div key={`swatches-${i}`} className="ve-menu-swatches" role="group" aria-label="Color label">
            {item.swatches.map((sw) => (
              <button
                key={sw.id}
                type="button"
                role="menuitemradio"
                aria-checked={item.current === sw.id}
                className={`ve-swatch${item.current === sw.id ? " is-on" : ""}`}
                style={{ background: sw.color }}
                onClick={() => {
                  onClose();
                  item.onPick(sw.id);
                }}
                aria-label={`${sw.name} label`}
                title={sw.name}
              />
            ))}
            <button
              type="button"
              role="menuitemradio"
              aria-checked={!item.current}
              className={`ve-swatch ve-swatch-none${item.current ? "" : " is-on"}`}
              onClick={() => {
                onClose();
                item.onPick(null);
              }}
              aria-label="No label"
              title="No label"
            >
              <Ban size={12} aria-hidden="true" />
            </button>
          </div>
        ) : (
          <button
            key={item.label}
            type="button"
            role="menuitem"
            className={`ui-menu-item ve-menu-item${item.danger ? " is-danger" : ""}`}
            disabled={item.disabled}
            onClick={() => {
              onClose();
              item.onSelect();
            }}
          >
            <span className="ve-menu-icon" aria-hidden="true">{item.icon}</span>
            <span className="ve-menu-label">{item.label}</span>
            {item.keys ? <kbd>{item.keys}</kbd> : null}
          </button>
        ),
      )}
    </div>
  );
}

const SHORTCUTS: { group: string; keys: [string, string][] }[] = [
  {
    group: "Play and move",
    keys: [
      ["Space", "Play or pause"],
      ["← →", "Step one frame"],
      ["Shift ← →", "Step one second"],
      ["↑ ↓", "Jump to the previous or next cut"],
      ["Home End", "Go to the start or end"],
    ],
  },
  {
    group: "Edit",
    keys: [
      ["S", "Split at the playhead"],
      ["Q", "Trim the start to the playhead"],
      ["W", "Trim the end to the playhead"],
      ["⌥ ← →", "Nudge the selection a frame"],
      ["⌘ D", "Duplicate"],
      ["⌫", "Delete (closes the gap when Magnetic is on)"],
      ["Shift ⌫", "Delete the other way: leave or close the gap"],
      ["⌘ Z", "Undo"],
      ["Shift ⌘ Z", "Redo"],
    ],
  },
  {
    group: "Select and view",
    keys: [
      ["⌘ A", "Select everything"],
      ["Drag", "Select clips inside a box"],
      ["Drag up", "Past the top track: a new video track"],
      ["Shift click", "Add to the selection"],
      ["M", "Add or remove a marker"],
      ["Shift S", "Skimming: the preview follows the pointer"],
      ["N", "Snapping on or off"],
      ["Z", "Fit the edit"],
      ["Shift Z", "Zoom to the selection"],
      ["⌘ scroll", "Zoom around the pointer (⌥ works too)"],
      ["Scroll", "Move along the edit"],
    ],
  },
];

export function ShortcutsPanel({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
    const away = (e: PointerEvent) => {
      const target = e.target as HTMLElement;
      if (!ref.current?.contains(target) && !target.closest("[data-shortcuts-toggle]")) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("pointerdown", away, true);
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("pointerdown", away, true);
      window.removeEventListener("keydown", key, true);
    };
  }, [onClose]);
  return (
    <div ref={ref} className="ve-keys-panel" role="dialog" aria-label="Keyboard shortcuts" tabIndex={-1}>
      <header>
        <strong>Keyboard shortcuts</strong>
        <button type="button" className="ve-mini" onClick={onClose} aria-label="Close shortcuts">
          <X size={14} />
        </button>
      </header>
      <div className="ve-keys-groups">
        {SHORTCUTS.map((g) => (
          <section key={g.group}>
            <h4>{g.group}</h4>
            <dl>
              {g.keys.map(([k, what]) => (
                <div key={what}>
                  <dt>
                    {k.split(" ").map((part) => (
                      <kbd key={part}>{part}</kbd>
                    ))}
                  </dt>
                  <dd>{what}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </div>
  );
}
