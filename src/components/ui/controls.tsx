// Small shared controls. Each picks up the host app's palette (studio --cs-*,
// maker --mk-*, Vibe --ve-*) and falls back to the site theme on :root.
import { forwardRef, type KeyboardEvent, type ReactNode, useId, useRef } from "react";
import { Search, X } from "lucide-react";
import "./ui.css";

const cx = (...names: Array<string | false | null | undefined>) => names.filter(Boolean).join(" ");

// ---------- Switch (from the YouTube publish form) ----------
export function Switch({ checked, onChange, label, description, disabled, compact, title, className }: { checked: boolean; onChange: (next: boolean) => void; label: ReactNode; description?: ReactNode; disabled?: boolean; compact?: boolean; title?: string; className?: string }) {
  return (
    <label className={cx("ui-switch", compact && "is-compact", disabled && "is-disabled", className)} title={title}>
      <span className="ui-switch-copy">
        <span className="ui-switch-label">{label}</span>
        {description ? <span className="ui-hint">{description}</span> : null}
      </span>
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
      <span className="ui-switch-track" aria-hidden="true"><span /></span>
    </label>
  );
}

// ---------- Segmented (radiogroup, arrow keys) and Tabs (tablist) ----------
type SegOption<T extends string> = { value: T; label: ReactNode; icon?: ReactNode; hint?: string; disabled?: boolean; title?: string };

function useRoving<T extends string>(options: Array<SegOption<T>>, value: T, onChange: (value: T) => void) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const move = (from: number, step: number) => {
    for (let i = 1; i <= options.length; i++) {
      const next = (from + step * i + options.length * 2) % options.length;
      if (options[next].disabled) continue;
      onChange(options[next].value);
      refs.current[next]?.focus();
      return;
    }
  };
  const onKeyDown = (index: number) => (event: KeyboardEvent) => {
    if (event.key === "ArrowRight" || event.key === "ArrowDown") { event.preventDefault(); move(index, 1); }
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") { event.preventDefault(); move(index, -1); }
  };
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));
  return { refs, onKeyDown, selectedIndex };
}

export function Segmented<T extends string>({ label, value, options, onChange, size = "md", block, className }: { label: string; value: T; options: Array<SegOption<T>>; onChange: (value: T) => void; size?: "sm" | "md"; block?: boolean; className?: string }) {
  const { refs, onKeyDown, selectedIndex } = useRoving(options, value, onChange);
  return (
    <div className={cx("ui-seg", `ui-seg-${size}`, block && "is-block", className)} role="radiogroup" aria-label={label}>
      {options.map((option, index) => (
        <button
          key={option.value}
          ref={(node) => { refs.current[index] = node; }}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          tabIndex={index === selectedIndex ? 0 : -1}
          disabled={option.disabled}
          title={option.title}
          onClick={() => onChange(option.value)}
          onKeyDown={onKeyDown(index)}
        >
          {option.icon}
          <span>{option.label}</span>
          {option.hint ? <small>{option.hint}</small> : null}
        </button>
      ))}
    </div>
  );
}

export function Tabs<T extends string>({ label, value, options, onChange, className }: { label: string; value: T; options: Array<SegOption<T>>; onChange: (value: T) => void; className?: string }) {
  const { refs, onKeyDown, selectedIndex } = useRoving(options, value, onChange);
  return (
    <div className={cx("ui-tabs", className)} role="tablist" aria-label={label}>
      {options.map((option, index) => (
        <button
          key={option.value}
          ref={(node) => { refs.current[index] = node; }}
          type="button"
          role="tab"
          aria-selected={option.value === value}
          tabIndex={index === selectedIndex ? 0 : -1}
          disabled={option.disabled}
          onClick={() => onChange(option.value)}
          onKeyDown={onKeyDown(index)}
        >
          {option.icon}
          <span>{option.label}</span>
          {option.hint ? <small>{option.hint}</small> : null}
        </button>
      ))}
    </div>
  );
}

// ---------- Empty state ----------
export function EmptyState({ icon, title, body, children, compact, className }: { icon?: ReactNode; title: string; body?: ReactNode; children?: ReactNode; compact?: boolean; className?: string }) {
  return (
    <div className={cx("ui-empty", compact && "is-compact", className)}>
      {icon ? <span className="ui-empty-mark" aria-hidden="true">{icon}</span> : null}
      <h3>{title}</h3>
      {body ? <p>{body}</p> : null}
      {children ? <div className="ui-empty-actions">{children}</div> : null}
    </div>
  );
}

// ---------- Notice (persistent conditions; use toast for one-off results) ----------
export function Notice({ tone = "info", title, children, action, onDismiss, className }: { tone?: "info" | "warning" | "error" | "success"; title?: ReactNode; children?: ReactNode; action?: ReactNode; onDismiss?: () => void; className?: string }) {
  return (
    <div className={cx("ui-notice", `is-${tone}`, className)} role={tone === "error" ? "alert" : "status"}>
      <div className="ui-notice-copy">
        {title ? <strong>{title}</strong> : null}
        {children ? <span>{children}</span> : null}
      </div>
      {action ? <div className="ui-notice-action">{action}</div> : null}
      {onDismiss ? (
        <button type="button" className="ui-icon-btn" onClick={onDismiss} aria-label="Dismiss">
          <X size={15} />
        </button>
      ) : null}
    </div>
  );
}

// ---------- Search field ----------
type SearchFieldProps = { value: string; onChange: (value: string) => void; placeholder?: string; label?: string; autoFocus?: boolean; onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void; className?: string; size?: "sm" | "md" };
export const SearchField = forwardRef<HTMLInputElement, SearchFieldProps>(function SearchField({ value, onChange, placeholder = "Search", label, autoFocus, onKeyDown, className, size = "md" }, ref) {
  const id = useId();
  return (
    <div className={cx("ui-search", `ui-search-${size}`, className)}>
      <Search size={size === "sm" ? 14 : 16} aria-hidden="true" />
      <input ref={ref} id={id} type="search" value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} aria-label={label || placeholder} autoFocus={autoFocus} onKeyDown={onKeyDown} />
      {value ? (
        <button type="button" className="ui-icon-btn" onClick={() => onChange("")} aria-label="Clear search">
          <X size={14} />
        </button>
      ) : null}
    </div>
  );
});

// ---------- Meter / progress ----------
export function Meter({ value, label, low, className }: { value: number; label: string; low?: boolean; className?: string }) {
  const share = Math.max(0, Math.min(1, value || 0));
  return (
    <span className={cx("ui-meter", low && "is-low", className)} role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(share * 100)}>
      <span style={{ width: `${share * 100}%` }} />
    </span>
  );
}

/** Job progress: a bar with an optional message and percent. `value` null = indeterminate. */
export function Progress({ value, message, label = "Progress", showPercent = true, className }: { value: number | null; message?: ReactNode; label?: string; showPercent?: boolean; className?: string }) {
  const share = value === null ? null : Math.max(0, Math.min(1, value));
  return (
    <div className={cx("ui-progress", className)}>
      {message || (showPercent && share !== null) ? (
        <div className="ui-progress-copy">
          {message ? <span>{message}</span> : <span />}
          {showPercent && share !== null ? <span className="ui-num">{Math.round(share * 100)}%</span> : null}
        </div>
      ) : null}
      <span className={cx("ui-progress-bar", share === null && "is-indeterminate")} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={share === null ? undefined : Math.round(share * 100)}>
        <span style={share === null ? undefined : { width: `${Math.max(2, share * 100)}%` }} />
      </span>
    </div>
  );
}
