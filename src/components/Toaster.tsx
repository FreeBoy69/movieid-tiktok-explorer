import { useEffect, useRef, useState } from "react";
import { CircleAlert, CircleCheck, Coins, Info, X } from "lucide-react";
import { toast, useToasts, type Toast } from "../utils/toast";
import "./Toaster.css";

const ICONS = { error: CircleAlert, success: CircleCheck, info: Info, credits: Coins };
const credits = (n: number) => `${Math.max(0, Math.round(n)).toLocaleString("en-US")}`;

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
      role={item.tone === "error" || item.tone === "credits" ? "alert" : "status"}
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
        {item.meter && item.meter.needed > 0 ? (
          <div className="toast-meter">
            <div className="toast-meter-bar" aria-hidden="true">
              <span style={{ width: `${Math.min(100, Math.max(item.meter.balance ? 4 : 0, ((item.meter.balance ?? 0) / item.meter.needed) * 100))}%` }} />
            </div>
            <p className="toast-meter-row">
              <span>{item.meter.balance === null ? "Your balance is used up" : <>You have <b>{credits(item.meter.balance)}</b></>}</span>
              <span>Needs <b>{credits(item.meter.needed)}</b></span>
            </p>
          </div>
        ) : null}
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
