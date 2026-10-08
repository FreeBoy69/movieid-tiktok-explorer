// The one dialog shell (from Create Video's Modal: focus trap, Escape, focus
// restore) plus promise-based confirm/choose that replace window.confirm.
// <DialogHost /> is mounted once in main.tsx.
import { type ReactNode, useEffect, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import "./ui.css";

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export type DialogProps = {
  title: string;
  onClose: () => void;
  /** Short line under the title. */
  description?: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
  /** Hide the header (the title still labels the dialog for screen readers). */
  bare?: boolean;
  /** Clicking the backdrop closes (default true). */
  dismissible?: boolean;
  /** "right" docks the dialog as a full-height side sheet. */
  placement?: "center" | "right";
  /** Slot before the title, e.g. a back button. */
  leading?: ReactNode;
  /** Class and theme on the backdrop layer, for hosts whose tokens hang off a wrapper. */
  layerClassName?: string;
  theme?: string;
  className?: string;
  children?: ReactNode;
};

export function Dialog({ title, onClose, description, footer, size = "md", bare, dismissible = true, placement = "center", leading, layerClassName, theme, className, children }: DialogProps) {
  const ref = useRef<HTMLElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const items = () => ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
    // First field, else the primary action, else the close button.
    const first = ref.current?.querySelector<HTMLElement>("[data-autofocus], input:not([type=hidden]):not([disabled]), textarea, select") || ref.current?.querySelector<HTMLElement>(".ui-dialog-foot .is-primary") || items()?.[0];
    first?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close.current();
        return;
      }
      if (event.key !== "Tab") return;
      const list = items();
      if (!list?.length) return;
      const head = list[0];
      const tail = list[list.length - 1];
      if (event.shiftKey && document.activeElement === head) {
        event.preventDefault();
        tail.focus();
      } else if (!event.shiftKey && document.activeElement === tail) {
        event.preventDefault();
        head.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, []);
  return createPortal(
    <div className={["ui-dialog-layer", placement === "right" && "is-right", layerClassName].filter(Boolean).join(" ")} data-theme={theme} onMouseDown={(event) => dismissible && event.target === event.currentTarget && onClose()}>
      <section ref={ref} className={["ui-dialog", `ui-dialog-${size}`, placement === "right" && "is-right", className].filter(Boolean).join(" ")} role="dialog" aria-modal="true" aria-label={title}>
        {bare ? null : (
          <header className="ui-dialog-head">
            {leading ? <div className="ui-dialog-lead">{leading}</div> : null}
            <div className="ui-dialog-titles">
              <h2>{title}</h2>
              {description ? <p>{description}</p> : null}
            </div>
            <button type="button" className="ui-icon-btn" onClick={onClose} aria-label="Close">
              <X size={17} />
            </button>
          </header>
        )}
        {children ? <div className="ui-dialog-body">{children}</div> : null}
        {footer ? <footer className="ui-dialog-foot">{footer}</footer> : null}
      </section>
    </div>,
    document.body,
  );
}

// ---------- confirm / choose ----------
export type ChoiceOption<T extends string> = { value: T; label: string; tone?: "danger" | "primary" | "default" };
type Pending = {
  id: number;
  title: string;
  body?: ReactNode;
  options: Array<ChoiceOption<string>>;
  cancelLabel: string;
  resolve: (value: string | null) => void;
};

let pending: Pending[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

function open(entry: Omit<Pending, "id" | "resolve">) {
  return new Promise<string | null>((resolve) => {
    pending = [...pending, { ...entry, id: nextId++, resolve }];
    emit();
  });
}
function settle(id: number, value: string | null) {
  const entry = pending.find((item) => item.id === id);
  pending = pending.filter((item) => item.id !== id);
  emit();
  entry?.resolve(value);
}

/** Styled replacement for window.confirm. Resolves true when confirmed. */
export async function confirm({ title, body, confirmLabel = "Confirm", cancelLabel = "Cancel", danger }: { title: string; body?: ReactNode; confirmLabel?: string; cancelLabel?: string; danger?: boolean }) {
  return (await open({ title, body, cancelLabel, options: [{ value: "ok", label: confirmLabel, tone: danger ? "danger" : "primary" }] })) === "ok";
}

/** Several named answers (e.g. "Delete everywhere" / "Only here"). Resolves null on cancel. */
export async function choose<T extends string>({ title, body, options, cancelLabel = "Cancel" }: { title: string; body?: ReactNode; options: Array<ChoiceOption<T>>; cancelLabel?: string }) {
  return (await open({ title, body, cancelLabel, options })) as T | null;
}

export function DialogHost() {
  const list = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => pending,
  );
  const top = list[list.length - 1];
  if (!top) return null;
  return (
    <Dialog
      key={top.id}
      title={top.title}
      size="sm"
      onClose={() => settle(top.id, null)}
      footer={
        <>
          <button type="button" className="ui-btn" onClick={() => settle(top.id, null)}>
            {top.cancelLabel}
          </button>
          {top.options.map((option, index) => (
            <button
              key={option.value}
              type="button"
              className={`ui-btn${option.tone === "danger" ? " is-danger" : option.tone === "default" ? "" : " is-primary"}`}
              data-autofocus={index === top.options.length - 1 || undefined}
              onClick={() => settle(top.id, option.value)}
            >
              {option.label}
            </button>
          ))}
        </>
      }
    >
      {top.body ? <div className="ui-dialog-text">{top.body}</div> : null}
    </Dialog>
  );
}
