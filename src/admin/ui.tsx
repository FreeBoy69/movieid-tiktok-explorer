import { useCallback, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Inbox, Loader2, RotateCw, X } from "lucide-react";
import { adminFetch, fmt } from "./api";

export function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

// ---------- data loading ----------
export function useAdminQuery<T = any>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(Boolean(path));
  const current = useRef(path);
  const load = useCallback(async (quiet = false) => {
    if (!path) return;
    current.current = path;
    if (!quiet) setLoading(true);
    setError("");
    try {
      const result = await adminFetch<T>(path);
      if (current.current === path) setData(result);
    } catch (err) {
      if (current.current === path) setError(err instanceof Error ? err.message : "Couldn't load this.");
    } finally {
      if (current.current === path) setLoading(false);
    }
  }, [path]);
  useEffect(() => {
    void load();
  }, [load]);
  return { data, error, loading, reload: () => load(true), setData };
}

// ---------- layout ----------
export function Page({ title, description, actions, children }: { title: string; description?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="adm-page">
      <header className="adm-page-head">
        <div>
          <h1>{title}</h1>
          {description ? <p>{description}</p> : null}
        </div>
        {actions ? <div className="adm-page-actions">{actions}</div> : null}
      </header>
      {children}
    </div>
  );
}

export function Card({ title, action, children, className, flush }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; flush?: boolean }) {
  return (
    <section className={cx("adm-card", flush && "is-flush", className)}>
      {title || action ? (
        <header className="adm-card-head">
          {title ? <h2>{title}</h2> : <span />}
          {action}
        </header>
      ) : null}
      {children}
    </section>
  );
}

export function Stat({ label, value, delta, hint, invertDelta }: { label: string; value: ReactNode; delta?: number | null; hint?: ReactNode; invertDelta?: boolean }) {
  const hasDelta = typeof delta === "number" && Number.isFinite(delta);
  const up = hasDelta && delta! >= 0;
  const good = invertDelta ? !up : up;
  return (
    <div className="adm-stat">
      <span className="adm-stat-label">{label}</span>
      <strong className="adm-stat-value">{value}</strong>
      <span className="adm-stat-foot">
        {hasDelta ? (
          <span className={cx("adm-delta", good ? "is-good" : "is-bad")}>
            {up ? <ArrowUpRight size={13} aria-hidden="true" /> : <ArrowDownRight size={13} aria-hidden="true" />}
            {Math.abs(delta!).toFixed(0)}%
          </span>
        ) : null}
        {hint ? <span>{hint}</span> : null}
      </span>
    </div>
  );
}

const TONES: Record<string, string> = {
  active: "good", ok: "good", done: "good", ready: "good", uploaded: "good", published: "good", resolved: "good", success: "good",
  pending: "warn", queued: "warn", running: "warn", past_due: "warn", paused: "neutral", high: "warn", scheduled: "warn",
  suspended: "bad", failed: "bad", error: "bad", canceled: "bad", cancelled: "bad", urgent: "bad",
  open: "accent", owner: "accent", closed: "neutral", low: "neutral", normal: "neutral",
};
export function Badge({ children, tone }: { children: ReactNode; tone?: string }) {
  const resolved = tone || TONES[String(children).toLowerCase()] || "neutral";
  const text = String(children).replace(/_/g, " ");
  return <span className={cx("adm-badge", `is-${resolved}`)}>{text.charAt(0).toUpperCase() + text.slice(1)}</span>;
}

export function Button({ variant = "secondary", size = "md", loading, children, className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger"; size?: "sm" | "md"; loading?: boolean }) {
  return (
    <button type="button" {...props} disabled={props.disabled || loading} className={cx("adm-btn", `is-${variant}`, size === "sm" && "is-sm", className)}>
      {loading ? <Loader2 size={15} className="adm-spin" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

export function Avatar({ src, name, size = 32 }: { src?: string; name?: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  const initial = String(name || "?").trim().charAt(0).toUpperCase() || "?";
  return src && !failed ? (
    <img className="adm-avatar" src={src} alt="" width={size} height={size} style={{ width: size, height: size }} referrerPolicy="no-referrer" onError={() => setFailed(true)} />
  ) : (
    <span className="adm-avatar is-initial" style={{ width: size, height: size, fontSize: size * 0.42 }} aria-hidden="true">{initial}</span>
  );
}

export function Person({ name, email, avatarUrl, onClick }: { name?: string; email?: string; avatarUrl?: string; onClick?: () => void }) {
  const body = (
    <>
      <Avatar src={avatarUrl} name={name || email} size={30} />
      <span className="adm-person-text">
        <strong>{name || email || "Unknown user"}</strong>
        {name && email ? <small>{email}</small> : null}
      </span>
    </>
  );
  return onClick ? <button type="button" className="adm-person is-link" onClick={onClick}>{body}</button> : <span className="adm-person">{body}</span>;
}

// ---------- states ----------
export function Loading({ label = "Loading" }: { label?: string }) {
  return (
    <div className="adm-state" role="status">
      <Loader2 size={20} className="adm-spin" aria-hidden="true" />
      <span>{label}…</span>
    </div>
  );
}
export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="adm-state is-error" role="alert">
      <AlertTriangle size={20} aria-hidden="true" />
      <span>{message}</span>
      {onRetry ? <Button size="sm" onClick={onRetry}><RotateCw size={14} aria-hidden="true" /> Try again</Button> : null}
    </div>
  );
}
export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="adm-state is-empty">
      <Inbox size={22} aria-hidden="true" />
      <strong>{title}</strong>
      {children ? <span>{children}</span> : null}
    </div>
  );
}
export function Guarded<T>({ query, children, label }: { query: { data: T | null; error: string; loading: boolean; reload: () => void }; children: (data: T) => ReactNode; label?: string }) {
  if (query.error && !query.data) return <ErrorState message={query.error} onRetry={query.reload} />;
  if (!query.data) return <Loading label={label} />;
  return <>{children(query.data)}</>;
}

// ---------- table ----------
export type Column<T> = { key: string; label: string; render: (row: T) => ReactNode; align?: "right"; className?: string };
export function DataTable<T>({ columns, rows, onRowClick, empty, rowKey }: { columns: Column<T>[]; rows: T[]; onRowClick?: (row: T) => void; empty?: ReactNode; rowKey: (row: T) => string }) {
  if (!rows.length) return <>{empty || <Empty title="Nothing here yet" />}</>;
  return (
    <div className="adm-table-wrap">
      <table className="adm-table">
        <thead>
          <tr>{columns.map((c) => <th key={c.key} className={cx(c.align === "right" && "is-right", c.className)} scope="col">{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              className={onRowClick ? "is-clickable" : undefined}
              onClick={onRowClick ? (event) => {
                if ((event.target as HTMLElement).closest("button, a, input, select")) return;
                onRowClick(row);
              } : undefined}
              tabIndex={onRowClick ? 0 : undefined}
              onKeyDown={onRowClick ? (event) => { if (event.key === "Enter") onRowClick(row); } : undefined}
            >
              {columns.map((c) => <td key={c.key} className={cx(c.align === "right" && "is-right", c.className)}>{c.render(row)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Pager({ offset, limit, total, count, onChange }: { offset: number; limit: number; total?: number; count: number; onChange: (offset: number) => void }) {
  const end = offset + count;
  const hasNext = total === undefined ? count === limit : end < total;
  if (!offset && !hasNext) return null;
  return (
    <div className="adm-pager">
      <span>{count ? `${fmt.number(offset + 1)}–${fmt.number(end)}${total !== undefined ? ` of ${fmt.number(total)}` : ""}` : "No results"}</span>
      <div>
        <Button size="sm" disabled={!offset} onClick={() => onChange(Math.max(0, offset - limit))}>Previous</Button>
        <Button size="sm" disabled={!hasNext} onClick={() => onChange(offset + limit)}>Next</Button>
      </div>
    </div>
  );
}

// ---------- controls ----------
export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: Array<{ value: NoInfer<T>; label: string; count?: number }>; onChange: (value: NoInfer<T>) => void; label: string }) {
  return (
    <div className="adm-seg" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button key={option.value} type="button" role="radio" aria-checked={value === option.value} className={cx(value === option.value && "is-on")} onClick={() => onChange(option.value)}>
          {option.label}
          {option.count !== undefined ? <span className="adm-seg-count">{fmt.number(option.count)}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="adm-field">
      <label htmlFor={id}>{label}</label>
      {children(id)}
      {hint ? <small>{hint}</small> : null}
    </div>
  );
}

export function Toggle({ checked, onChange, label, description, disabled }: { checked: boolean; onChange: (value: boolean) => void; label: string; description?: ReactNode; disabled?: boolean }) {
  const id = useId();
  return (
    <div className="adm-toggle-row">
      <span>
        <label htmlFor={id}>{label}</label>
        {description ? <small>{description}</small> : null}
      </span>
      <button id={id} type="button" role="switch" aria-checked={checked} disabled={disabled} className={cx("adm-switch", checked && "is-on")} onClick={() => onChange(!checked)}>
        <span />
      </button>
    </div>
  );
}

// ---------- overlays ----------
function useEscape(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
}

export function Drawer({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode }) {
  useEscape(open, onClose);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) panel.current?.focus();
  }, [open]);
  if (!open) return null;
  return createPortal(
    <div className="adm-overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="adm-drawer" role="dialog" aria-modal="true" ref={panel} tabIndex={-1}>
        <header className="adm-drawer-head">
          <div className="adm-drawer-title">{title}</div>
          <button type="button" className="adm-icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </header>
        <div className="adm-drawer-body">{children}</div>
        {footer ? <footer className="adm-drawer-foot">{footer}</footer> : null}
      </div>
    </div>,
    document.querySelector(".adm") || document.body,
  );
}

export function Modal({ open, onClose, title, children, actions }: { open: boolean; onClose: () => void; title: string; children: ReactNode; actions: ReactNode }) {
  useEscape(open, onClose);
  if (!open) return null;
  return createPortal(
    <div className="adm-overlay is-center" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="adm-modal" role="dialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        <div className="adm-modal-body">{children}</div>
        <div className="adm-modal-actions">{actions}</div>
      </div>
    </div>,
    document.querySelector(".adm") || document.body,
  );
}

// ---------- charts ----------
// One series over time. Bars rather than a line: daily totals are discrete, and
// days with no usage should read as empty, not as an interpolated slope.
export function BarChart({ data, format, label, height = 180 }: { data: Array<{ label: string; value: number }>; format: (value: number) => string; label: string; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d.value));
  const nice = niceMax(max);
  const gridLines = [0.5, 1];
  const width = 100 / Math.max(1, data.length);
  const total = data.reduce((sum, d) => sum + d.value, 0);
  const tip = hover === null ? null : data[hover];
  return (
    <figure className="adm-chart" aria-label={`${label}: ${format(total)} total`}>
      <div className="adm-chart-plot" style={{ height }} onMouseLeave={() => setHover(null)}>
        {gridLines.map((line) => (
          <div key={line} className="adm-chart-grid" style={{ bottom: `${line * 100}%` }}>
            <span>{format(nice * line)}</span>
          </div>
        ))}
        <div className="adm-chart-bars">
          {data.map((d, index) => (
            <div
              key={d.label}
              className={cx("adm-chart-col", hover === index && "is-hover")}
              style={{ width: `${width}%` }}
              onMouseEnter={() => setHover(index)}
              onFocus={() => setHover(index)}
              onBlur={() => setHover(null)}
              tabIndex={0}
              aria-label={`${formatDay(d.label)}: ${format(d.value)}`}
            >
              <div className="adm-chart-bar" style={{ height: d.value ? `max(3px, ${(d.value / nice) * 100}%)` : 0 }} />
            </div>
          ))}
        </div>
        {tip ? (
          <div className="adm-chart-tip" style={{ left: `clamp(60px, ${(hover! + 0.5) * width}%, calc(100% - 60px))` }} role="status">
            <small>{formatDay(tip.label)}</small>
            <strong>{format(tip.value)}</strong>
          </div>
        ) : null}
      </div>
      <div className="adm-chart-axis" aria-hidden="true">
        <span>{formatDay(data[0]?.label)}</span>
        <span>{formatDay(data[Math.floor(data.length / 2)]?.label)}</span>
        <span>{formatDay(data[data.length - 1]?.label)}</span>
      </div>
      <details className="adm-chart-table">
        <summary>Show as table</summary>
        <table>
          <tbody>{data.map((d) => <tr key={d.label}><th scope="row">{formatDay(d.label)}</th><td>{format(d.value)}</td></tr>)}</tbody>
        </table>
      </details>
    </figure>
  );
}
function niceMax(value: number) {
  const exponent = Math.pow(10, Math.floor(Math.log10(value)));
  const fraction = value / exponent;
  const step = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  return step * exponent;
}
function formatDay(value?: string) {
  if (!value) return "";
  const date = new Date(`${value}T00:00:00`);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// Ranked magnitudes: one hue, sorted, value labelled at the end of each bar.
export function RankBars({ items, format }: { items: Array<{ key: string; label: ReactNode; sub?: ReactNode; value: number }>; format: (value: number) => string }) {
  if (!items.length) return <Empty title="No usage in this window" />;
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <ol className="adm-rank">
      {items.map((item) => (
        <li key={item.key}>
          <div className="adm-rank-text">
            <span className="adm-rank-label">{item.label}</span>
            {item.sub ? <small>{item.sub}</small> : null}
          </div>
          <div className="adm-rank-track"><div className="adm-rank-bar" style={{ width: `${Math.max(2, (item.value / max) * 100)}%` }} /></div>
          <span className="adm-rank-value">{format(item.value)}</span>
        </li>
      ))}
    </ol>
  );
}
