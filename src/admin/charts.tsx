// Admin charts. Plain SVG and HTML, sized to their container, themed by the
// --a-* tokens in admin.css. Every chart has a hover layer, a legend once it
// has two or more series, and a table view (the light theme's lighter
// categorical slots sit under 3:1 contrast, so the table is the relief).
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, Info } from "lucide-react";
import { cx } from "./ui";

// Categorical slots in fixed order (validated light and dark against the card
// surface); a series keeps its slot when others are filtered out.
export const SERIES = ["var(--a-s1)", "var(--a-s2)", "var(--a-s3)", "var(--a-s4)", "var(--a-s5)"];
export const OTHER = "var(--a-s-other)";

export type Series = { key: string; label: string; values: number[]; color?: string; dashed?: boolean };

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

// Round axis maxima and ticks (1, 2, 5 × 10^n).
export function niceScale(min: number, max: number, ticks = 4, integer = false) {
  if (min === max) max = min + 1;
  const span = max - min;
  const raw = span / ticks;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  let step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= ticks) || 10 * mag;
  // Counts never get fractional gridlines.
  if (integer) step = Math.max(1, Math.ceil(step));
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const values: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) values.push(Math.round(v * 1e6) / 1e6);
  return { lo, hi, values };
}

export const labelFormats = {
  day: (value: string) => (value ? new Date(`${value.slice(0, 10)}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : ""),
  month: (value: string) => (value ? new Date(`${value.slice(0, 7)}-01T00:00:00`).toLocaleDateString("en-US", { month: "short", year: "numeric" }) : ""),
};

export function Legend({ items }: { items: Array<{ key: string; label: string; color: string; value?: ReactNode; dashed?: boolean }> }) {
  return (
    <ul className="adm-legend">
      {items.map((item) => (
        <li key={item.key}>
          <span className={cx("adm-swatch", item.dashed && "is-dashed")} style={{ background: item.dashed ? undefined : item.color, borderColor: item.color }} aria-hidden="true" />
          <span>{item.label}</span>
          {item.value !== undefined ? <strong>{item.value}</strong> : null}
        </li>
      ))}
    </ul>
  );
}

function TableView({ labels, series, format, labelFormat }: { labels: string[]; series: Series[]; format: (v: number) => string; labelFormat: (l: string) => string }) {
  return (
    <details className="adm-chart-table">
      <summary>Show as table</summary>
      <div className="adm-chart-table-scroll">
        <table>
          <thead>
            <tr>
              <th scope="col"><span className="adm-sr">Period</span></th>
              {series.map((s) => <th key={s.key} scope="col">{s.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {labels.map((label, i) => (
              <tr key={label}>
                <th scope="row">{labelFormat(label)}</th>
                {series.map((s) => <td key={s.key}>{format(s.values[i] || 0)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

const PAD = { top: 12, right: 12, bottom: 24, left: 52 };

// Lines (optionally a filled area for a single series) with a crosshair tooltip.
export function LineChart({ labels, series, format, label, height = 220, area, labelFormat = labelFormats.day, emptyText = "No data in this window" }: {
  labels: string[]; series: Series[]; format: (v: number) => string; label: string; height?: number; area?: boolean; labelFormat?: (l: string) => string; emptyText?: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const gradient = useId().replace(/:/g, "");
  const all = series.flatMap((s) => s.values);
  const hasData = all.some((v) => v !== 0);
  const { lo, hi, values: ticks } = niceScale(Math.min(0, ...all), Math.max(0, ...all), 4, all.every(Number.isInteger));
  const plotW = Math.max(10, width - PAD.left - PAD.right);
  const plotH = height - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (labels.length <= 1 ? plotW / 2 : (i / (labels.length - 1)) * plotW);
  const y = (v: number) => PAD.top + plotH - ((v - lo) / (hi - lo || 1)) * plotH;
  const colored = series.map((s, i) => ({ ...s, color: s.color || SERIES[i] || OTHER }));
  const pick = (clientX: number, el: Element) => {
    const rect = el.getBoundingClientRect();
    const rel = (clientX - rect.left - PAD.left) / plotW;
    setHover(Math.max(0, Math.min(labels.length - 1, Math.round(rel * (labels.length - 1)))));
  };
  const axisLabels = labels.length ? [0, Math.floor((labels.length - 1) / 2), labels.length - 1] : [];
  return (
    <figure className="adm-viz" aria-label={label}>
      <div ref={ref} className="adm-viz-plot" style={{ height }}>
        {width > 0 && hasData ? (
          <svg width={width} height={height} role="img" aria-label={label}
            onPointerMove={(e) => pick(e.clientX, e.currentTarget)} onPointerLeave={() => setHover(null)}>
            <defs>
              <linearGradient id={gradient} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={colored[0]?.color} stopOpacity="0.28" />
                <stop offset="100%" stopColor={colored[0]?.color} stopOpacity="0" />
              </linearGradient>
            </defs>
            {ticks.map((t) => (
              <g key={t}>
                <line className={cx("adm-viz-grid", t === 0 && "is-zero")} x1={PAD.left} x2={PAD.left + plotW} y1={y(t)} y2={y(t)} />
                <text className="adm-viz-tick" x={PAD.left - 8} y={y(t)} textAnchor="end" dominantBaseline="middle">{format(t)}</text>
              </g>
            ))}
            {axisLabels.map((i, k) => (
              <text key={`${i}-${k}`} className="adm-viz-tick" x={x(i)} y={height - 6} textAnchor={k === 0 ? "start" : k === 2 ? "end" : "middle"}>{labelFormat(labels[i])}</text>
            ))}
            {area && colored[0] ? (
              <path fill={`url(#${gradient})`} d={`M${x(0)},${y(Math.max(lo, 0))} ${colored[0].values.map((v, i) => `L${x(i)},${y(v)}`).join(" ")} L${x(labels.length - 1)},${y(Math.max(lo, 0))} Z`} />
            ) : null}
            {colored.map((s) => (
              <path key={s.key} className="adm-viz-line" stroke={s.color} strokeDasharray={s.dashed ? "5 4" : undefined}
                d={s.values.map((v, i) => `${i ? "L" : "M"}${x(i)},${y(v)}`).join(" ")} />
            ))}
            {hover !== null ? (
              <g>
                <line className="adm-viz-cross" x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + plotH} />
                {colored.map((s) => <circle key={s.key} className="adm-viz-dot" cx={x(hover)} cy={y(s.values[hover] || 0)} r={4.5} fill={s.color} />)}
              </g>
            ) : null}
          </svg>
        ) : width > 0 ? <div className="adm-viz-empty">{emptyText}</div> : null}
        {hover !== null && width > 0 && hasData ? (
          <div className="adm-viz-tip" style={{ left: Math.min(Math.max(x(hover), 90), width - 90) }} role="status">
            <small>{labelFormat(labels[hover])}</small>
            {colored.map((s) => (
              <span key={s.key}><i style={{ background: s.color }} aria-hidden="true" />{s.label}<strong>{format(s.values[hover] || 0)}</strong></span>
            ))}
          </div>
        ) : null}
      </div>
      {colored.length > 1 ? <Legend items={colored.map((s) => ({ key: s.key, label: s.label, color: s.color, dashed: s.dashed }))} /> : null}
      <TableView labels={labels} series={colored} format={format} labelFormat={labelFormat} />
    </figure>
  );
}

// Stacked columns. Negative series stack below the zero line, so MRR
// movements read as gains above and losses below one axis.
export function StackedBars({ labels, series, format, label, height = 220, labelFormat = labelFormats.day, total = true }: {
  labels: string[]; series: Series[]; format: (v: number) => string; label: string; height?: number; labelFormat?: (l: string) => string; total?: boolean;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const colored = series.map((s, i) => ({ ...s, color: s.color || SERIES[i] || OTHER }));
  const pos = labels.map((_, i) => colored.reduce((sum, s) => sum + Math.max(0, s.values[i] || 0), 0));
  const neg = labels.map((_, i) => colored.reduce((sum, s) => sum + Math.min(0, s.values[i] || 0), 0));
  const hasData = pos.some(Boolean) || neg.some(Boolean);
  const { lo, hi, values: ticks } = niceScale(Math.min(0, ...neg), Math.max(0, ...pos), 4, series.every((x) => x.values.every(Number.isInteger)));
  const plotW = Math.max(10, width - PAD.left - PAD.right);
  const plotH = height - PAD.top - PAD.bottom;
  const slot = plotW / Math.max(1, labels.length);
  const barW = Math.max(2, Math.min(36, slot - Math.max(2, slot * 0.28)));
  const y = (v: number) => PAD.top + plotH - ((v - lo) / (hi - lo || 1)) * plotH;
  const axisLabels = labels.length ? [0, Math.floor((labels.length - 1) / 2), labels.length - 1] : [];
  return (
    <figure className="adm-viz" aria-label={label}>
      <div ref={ref} className="adm-viz-plot" style={{ height }} onPointerLeave={() => setHover(null)}>
        {width > 0 && hasData ? (
          <svg width={width} height={height} role="img" aria-label={label}>
            {ticks.map((t) => (
              <g key={t}>
                <line className={cx("adm-viz-grid", t === 0 && "is-zero")} x1={PAD.left} x2={PAD.left + plotW} y1={y(t)} y2={y(t)} />
                <text className="adm-viz-tick" x={PAD.left - 8} y={y(t)} textAnchor="end" dominantBaseline="middle">{format(t)}</text>
              </g>
            ))}
            {axisLabels.map((i, k) => (
              <text key={`${i}-${k}`} className="adm-viz-tick" x={PAD.left + slot * (i + 0.5)} y={height - 6} textAnchor={k === 0 ? "start" : k === 2 ? "end" : "middle"}>{labelFormat(labels[i])}</text>
            ))}
            {labels.map((day, i) => {
              let up = 0;
              let down = 0;
              const cx0 = PAD.left + slot * i + (slot - barW) / 2;
              const segments = colored.map((s) => {
                const v = s.values[i] || 0;
                if (!v) return null;
                const from = v > 0 ? up : down;
                const to = from + v;
                if (v > 0) up = to;
                else down = to;
                return { key: s.key, color: s.color, top: y(Math.max(from, to)), bottom: y(Math.min(from, to)), sign: Math.sign(v) };
              }).filter(Boolean) as Array<{ key: string; color: string; top: number; bottom: number; sign: number }>;
              const outerUp = segments.filter((s) => s.sign > 0).at(-1)?.key;
              const outerDown = segments.filter((s) => s.sign < 0).at(-1)?.key;
              return (
                <g key={day} className={cx("adm-viz-col", hover === i && "is-hover")} onPointerEnter={() => setHover(i)}>
                  <rect className="adm-viz-hit" x={PAD.left + slot * i} y={PAD.top} width={slot} height={plotH} />
                  {segments.map((s) => (
                    <path key={s.key} className="adm-viz-seg" fill={s.color}
                      d={barPath(cx0, s.top, barW, Math.max(1, s.bottom - s.top), s.key === outerUp ? "top" : s.key === outerDown ? "bottom" : "none")} />
                  ))}
                </g>
              );
            })}
          </svg>
        ) : width > 0 ? <div className="adm-viz-empty">No data in this window</div> : null}
        {hover !== null && width > 0 && hasData ? (
          <div className="adm-viz-tip" style={{ left: Math.min(Math.max(PAD.left + slot * (hover + 0.5), 90), width - 90) }} role="status">
            <small>{labelFormat(labels[hover])}</small>
            {colored.map((s) => (
              <span key={s.key}><i style={{ background: s.color }} aria-hidden="true" />{s.label}<strong>{format(s.values[hover] || 0)}</strong></span>
            ))}
            {total && colored.length > 1 ? <span className="is-total">Net<strong>{format(pos[hover] + neg[hover])}</strong></span> : null}
          </div>
        ) : null}
      </div>
      {colored.length > 1 ? <Legend items={colored.map((s) => ({ key: s.key, label: s.label, color: s.color }))} /> : null}
      <TableView labels={labels} series={colored} format={format} labelFormat={labelFormat} />
    </figure>
  );
}

// A column with a 4px rounded end on its outer edge only.
function barPath(x: number, y: number, w: number, h: number, round: "top" | "bottom" | "none") {
  const r = Math.min(4, w / 2, h);
  if (round === "top") return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;
  if (round === "bottom") return `M${x},${y} V${y + h - r} Q${x},${y + h} ${x + r},${y + h} H${x + w - r} Q${x + w},${y + h} ${x + w},${y + h - r} V${y} Z`;
  return `M${x},${y} H${x + w} V${y + h} H${x} Z`;
}

// Weekday × hour activity, one hue from the card surface to full strength.
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export function Heatmap({ grid, format, label }: { grid: number[][]; format: (v: number) => string; label: string }) {
  const [hover, setHover] = useState<[number, number] | null>(null);
  const max = Math.max(1, ...grid.flat());
  const total = grid.flat().reduce((a, b) => a + b, 0);
  const busiest = useMemo(() => {
    let best: [number, number, number] = [0, 0, -1];
    grid.forEach((row, d) => row.forEach((v, h) => { if (v > best[2]) best = [d, h, v]; }));
    return best;
  }, [grid]);
  if (!total) return <div className="adm-viz-empty is-block">No activity in this window</div>;
  const hourLabel = (h: number) => `${String(h).padStart(2, "0")}:00`;
  return (
    <figure className="adm-viz" aria-label={label}>
      <div className="adm-heat" onPointerLeave={() => setHover(null)}>
        <span />
        {Array.from({ length: 24 }, (_, h) => <span key={h} className="adm-heat-hour">{h % 6 === 0 ? hourLabel(h) : ""}</span>)}
        {grid.map((row, d) => (
          <div key={DAYS[d]} className="adm-heat-row">
            <span className="adm-heat-day">{DAYS[d]}</span>
            {row.map((v, h) => (
              <span key={h} className={cx("adm-heat-cell", hover?.[0] === d && hover?.[1] === h && "is-hover")}
                style={{ background: v ? `color-mix(in oklab, var(--a-seq) ${Math.round(12 + (v / max) * 88)}%, var(--a-panel))` : undefined }}
                onPointerEnter={() => setHover([d, h])} aria-label={`${DAYS[d]} ${hourLabel(h)}: ${format(v)}`} />
            ))}
          </div>
        ))}
      </div>
      <div className="adm-heat-foot">
        <span>{hover ? <>{DAYS[hover[0]]} {hourLabel(hover[0] === undefined ? 0 : hover[1])} UTC · <strong>{format(grid[hover[0]][hover[1]])}</strong></> : <>Busiest: {DAYS[busiest[0]]} {hourLabel(busiest[1])} UTC · <strong>{format(busiest[2])}</strong></>}</span>
        <span className="adm-heat-scale" aria-hidden="true"><small>Less</small><i /><small>More</small></span>
      </div>
      <details className="adm-chart-table">
        <summary>Show as table</summary>
        <div className="adm-chart-table-scroll">
          <table>
            <thead><tr><th scope="col"><span className="adm-sr">Day</span></th>{Array.from({ length: 24 }, (_, h) => <th key={h} scope="col">{h}</th>)}</tr></thead>
            <tbody>{grid.map((row, d) => <tr key={d}><th scope="row">{DAYS[d]}</th>{row.map((v, h) => <td key={h}>{v}</td>)}</tr>)}</tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}

// Conversion steps, each bar relative to the first, with the step-over-step rate.
export function Funnel({ steps, format }: { steps: Array<{ key: string; label: string; value: number; hint?: string }>; format: (v: number) => string }) {
  const first = Math.max(1, steps[0]?.value || 0);
  return (
    <ol className="adm-funnel">
      {steps.map((step, i) => {
        const prev = i ? steps[i - 1].value : 0;
        return (
          <li key={step.key}>
            <div className="adm-funnel-text">
              <span>{step.label}</span>
              <strong>{format(step.value)}</strong>
            </div>
            <div className="adm-funnel-track"><span style={{ width: `${Math.max(step.value ? 1.5 : 0, (step.value / first) * 100)}%` }} /></div>
            <small>
              {i ? (prev ? `${Math.round((step.value / prev) * 100)}% of previous step` : "—") : "Starting cohort"}
              {i && steps[0].value ? ` · ${Math.round((step.value / steps[0].value) * 100)}% overall` : ""}
              {step.hint ? ` · ${step.hint}` : ""}
            </small>
          </li>
        );
      })}
    </ol>
  );
}

// Retention triangle: weekly signup cohorts by weeks since signup.
export function CohortGrid({ cohorts }: { cohorts: Array<{ week: string; size: number; active: Record<string, number> }> }) {
  const maxWeeks = 8;
  if (!cohorts.some((c) => Number(c.size))) return <div className="adm-viz-empty is-block">No signups in the last eight weeks</div>;
  return (
    <div className="adm-chart-table-scroll">
      <table className="adm-cohort">
        <thead>
          <tr>
            <th scope="col">Signed up</th>
            <th scope="col">Users</th>
            {Array.from({ length: maxWeeks }, (_, k) => <th key={k} scope="col">{k === 0 ? "Wk 0" : `+${k}`}</th>)}
          </tr>
        </thead>
        <tbody>
          {[...cohorts].reverse().map((c) => {
            const elapsed = Math.floor((Date.now() - new Date(`${c.week}T00:00:00`).getTime()) / 604800000);
            return (
              <tr key={c.week}>
                <th scope="row">{labelFormats.day(c.week)}</th>
                <td className="adm-num">{Number(c.size)}</td>
                {Array.from({ length: maxWeeks }, (_, k) => {
                  if (k > elapsed) return <td key={k} className="is-future" />;
                  const share = Number(c.size) ? (Number(c.active?.[String(k)]) || 0) / Number(c.size) : 0;
                  return (
                    <td key={k} title={`${Number(c.active?.[String(k)]) || 0} of ${c.size} used AI`}
                      style={{ background: share ? `color-mix(in oklab, var(--a-seq) ${Math.round(10 + share * 90)}%, var(--a-panel))` : undefined }}
                      className={cx(share > 0.55 && "is-strong")}>
                      {Math.round(share * 100)}%
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Parts of a whole on one bar, with a legend that carries the numbers.
export function ShareBar({ items, format }: { items: Array<{ key: string; label: string; value: number; color?: string }>; format: (v: number) => string }) {
  const total = items.reduce((sum, i) => sum + i.value, 0);
  const colored = items.map((item, i) => ({ ...item, color: item.color || SERIES[i] || OTHER }));
  if (!total) return <div className="adm-viz-empty is-block">Nothing to show yet</div>;
  return (
    <div className="adm-share">
      <div className="adm-share-bar" role="img" aria-label={colored.map((i) => `${i.label} ${format(i.value)}`).join(", ")}>
        {colored.filter((i) => i.value > 0).map((i) => (
          <span key={i.key} style={{ flexGrow: i.value, background: i.color }} title={`${i.label}: ${format(i.value)} (${Math.round((i.value / total) * 100)}%)`} />
        ))}
      </div>
      <Legend items={colored.map((i) => ({ key: i.key, label: i.label, color: i.color, value: `${format(i.value)} · ${Math.round((i.value / total) * 100)}%` }))} />
    </div>
  );
}

export function Sparkline({ values, tone = "neutral" }: { values: number[]; tone?: "neutral" | "good" | "bad" }) {
  if (values.length < 2 || !values.some(Boolean)) return null;
  const w = 96;
  const h = 28;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, h - 3 - ((v - min) / (max - min || 1)) * (h - 6)]);
  return (
    <svg className={cx("adm-spark", `is-${tone}`)} width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <path d={pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ")} />
      <circle cx={pts.at(-1)![0]} cy={pts.at(-1)![1]} r={2.5} />
    </svg>
  );
}

// A KPI tile: value, change against the previous window, trend, definition.
export function Kpi({ label, value, delta, invertDelta, hint, spark, info, tone }: {
  label: string; value: ReactNode; delta?: number | null; invertDelta?: boolean; hint?: ReactNode; spark?: number[]; info?: string; tone?: "accent";
}) {
  const hasDelta = typeof delta === "number" && Number.isFinite(delta);
  const up = hasDelta && delta! >= 0;
  const good = invertDelta ? !up : up;
  return (
    <div className={cx("adm-kpi", tone === "accent" && "is-accent")}>
      <span className="adm-kpi-label">
        {label}
        {info ? <span className="adm-kpi-info" title={info} aria-label={info} role="img"><Info size={12} aria-hidden="true" /></span> : null}
      </span>
      <div className="adm-kpi-main">
        <strong className="adm-kpi-value">{value}</strong>
        {spark ? <Sparkline values={spark} tone={hasDelta ? (good ? "good" : "bad") : "neutral"} /> : null}
      </div>
      <span className="adm-stat-foot">
        {hasDelta ? (
          <span className={cx("adm-delta", good ? "is-good" : "is-bad")}>
            {up ? <ArrowUpRight size={13} aria-hidden="true" /> : <ArrowDownRight size={13} aria-hidden="true" />}
            {Math.abs(delta!) >= 1000 ? ">999" : Math.abs(delta!).toFixed(0)}%
          </span>
        ) : null}
        {hint ? <span>{hint}</span> : null}
      </span>
    </div>
  );
}

export function KpiRow({ children, tight }: { children: ReactNode[]; tight?: boolean }) {
  const count = children.filter(Boolean).length;
  const cols = count % 6 === 0 ? 6 : count % 5 === 0 ? 5 : count % 4 === 0 ? 4 : count <= 6 ? count : 5;
  return <div className={cx("adm-kpis", tight && "is-tight")} style={{ ["--cols" as string]: cols }}>{children}</div>;
}

export function useInterval(callback: () => void, ms: number | null) {
  const saved = useRef(callback);
  saved.current = callback;
  useEffect(() => {
    if (!ms) return;
    const id = window.setInterval(() => saved.current(), ms);
    return () => window.clearInterval(id);
  }, [ms]);
}

// Download rows as CSV (values quoted, formulas neutralised for spreadsheets).
export function downloadCsv(filename: string, rows: Array<Record<string, unknown>>) {
  if (!rows.length) return;
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const cell = (v: unknown) => {
    let s = v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
    if (typeof v === "string" && /^[=+\-@]/.test(s) && Number.isNaN(Number(s))) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };
  const csv = [keys.map(cell).join(","), ...rows.map((r) => keys.map((k) => cell(r[k])).join(","))].join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// A compact trend for summary cards: one series, no axes, hover readout and
// first/last labels. The full chart lives on the section's own page.
export function TrendArea({ labels, values, format, label, labelFormat = labelFormats.day, height = 72 }: {
  labels: string[]; values: number[]; format: (v: number) => string; label: string; labelFormat?: (l: string) => string; height?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const gradient = useId().replace(/:/g, "");
  const has = values.some(Boolean);
  const min = Math.min(0, ...values);
  const max = Math.max(...values, min + 1);
  const pad = 4;
  const x = (i: number) => (values.length <= 1 ? width / 2 : (i / (values.length - 1)) * (width - 2 * pad) + pad);
  const y = (v: number) => height - pad - ((v - min) / (max - min || 1)) * (height - 2 * pad);
  const line = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  return (
    <figure className="adm-trend" aria-label={`${label}: ${values.length ? format(values.at(-1)!) : "no data"} latest`}>
      <div ref={ref} className="adm-trend-plot" style={{ height }}
        onPointerMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          setHover(Math.max(0, Math.min(values.length - 1, Math.round(((e.clientX - rect.left - pad) / Math.max(1, width - 2 * pad)) * (values.length - 1)))));
        }}
        onPointerLeave={() => setHover(null)}>
        {width > 0 && has ? (
          <svg width={width} height={height} aria-hidden="true">
            <defs>
              <linearGradient id={gradient} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="var(--a-chart)" stopOpacity="0.3" />
                <stop offset="100%" stopColor="var(--a-chart)" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d={`${line} L${x(values.length - 1)},${height} L${x(0)},${height} Z`} fill={`url(#${gradient})`} />
            <path d={line} className="adm-viz-line" stroke="var(--a-chart)" />
            {hover !== null ? <circle className="adm-viz-dot" cx={x(hover)} cy={y(values[hover])} r={4} fill="var(--a-chart)" /> : null}
          </svg>
        ) : width > 0 ? <div className="adm-viz-empty">No data yet</div> : null}
      </div>
      <figcaption className="adm-trend-foot">
        {hover !== null ? <span><strong>{format(values[hover])}</strong> · {labelFormat(labels[hover])}</span> : <><span>{labelFormat(labels[0])}</span><span>{labelFormat(labels.at(-1) || "")}</span></>}
      </figcaption>
    </figure>
  );
}
