import { useEffect, useRef, useState } from "react";
import { CircleAlert, CircleCheck, Info, X } from "lucide-react";
import { toast, useToasts, type Toast } from "../utils/toast";
import "./Toaster.css";

const ICONS = { error: CircleAlert, success: CircleCheck, info: Info };

export function Toaster() {
  const items = useToasts();
  return (
    <section className="toaster" aria-label="Notifications">
      {items.map((item) => (
        <ToastItem key={item.id} item={item} />
      ))}
    </section>
  );
}

function ToastItem({ item }: { item: Toast }) {
  const [paused, setPaused] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const left = useRef(item.duration);
  const started = useRef(Date.now());
  const Icon = ICONS[item.tone];

  const close = () => {
    setLeaving(true);
    window.setTimeout(() => toast.dismiss(item.id), 160);
  };

  // Sticky toasts (duration 0) wait for Dismiss. Hover still pauses timed ones.
  useEffect(() => {
    if (item.duration <= 0 || paused || leaving) return;
    started.current = Date.now();
    const timer = window.setTimeout(close, left.current);
    return () => {
      window.clearTimeout(timer);
      left.current -= Date.now() - started.current;
    };
  }, [paused, leaving, item.duration]);

  return (
    <div
      className={`toast is-${item.tone}${leaving ? " is-leaving" : ""}`}
      role={item.tone === "error" ? "alert" : "status"}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      style={{ ["--toast-ms" as string]: `${item.duration}ms` }}
      data-paused={paused || undefined}
    >
      <Icon className="toast-icon" size={18} aria-hidden="true" />
      <div className="toast-body">
        {item.title ? <strong>{item.title}</strong> : null}
        <p>
          {item.message}
          {item.count > 1 ? <span className="toast-count">×{item.count}</span> : null}
        </p>
        {item.action ? (
          <button
            type="button"
            className="toast-action"
            onClick={() => {
              item.action?.onClick();
              close();
            }}
          >
            {item.action.label}
          </button>
        ) : null}
      </div>
      <button type="button" className="toast-close" aria-label="Dismiss" onClick={close}>
        <X size={15} />
      </button>
      {item.duration > 0 ? <span className="toast-timer" aria-hidden="true" /> : null}
    </div>
  );
}
