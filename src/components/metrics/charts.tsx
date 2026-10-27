import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { fmtDay, niceTicks } from "./format";

/** Chart pieces for the loop metrics page: plain SVG/HTML, themed by the --lm-* and --th-* variables. */

export type TipRow = { label: string; value: string; color?: string };
export type Tip = { x: number; y: number; title: string; rows: TipRow[] };

/** Width of an element, following resizes (fallback where ResizeObserver is missing, e.g. jsdom). */
export function useWidth(ref: RefObject<HTMLElement | null>, fallback = 560): number {
  const [width, setWidth] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.clientWidth > 0) setWidth(el.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry && entry.contentRect.width > 0) setWidth(entry.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}

/** Hover/focus readout: the value leads, the series name follows; rows keyed by a short line of the series color. */
export function Tooltip({ tip, width }: { tip: Tip | null; width: number }) {
  if (!tip) return null;
  const left = Math.min(Math.max(tip.x, 80), Math.max(80, width - 80));
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute z-10 min-w-[120px] rounded-md border px-2.5 py-1.5 text-xs shadow-lg"
      style={{
        left,
        top: tip.y,
        transform: "translate(-50%, calc(-100% - 8px))",
        background: "var(--lm-tip-bg)",
        borderColor: "var(--lm-tip-border)",
        color: "var(--th-text-primary)",
      }}
    >
      <div style={{ color: "var(--th-text-muted)" }}>{tip.title}</div>
      {tip.rows.map((r) => (
        <div key={r.label} className="mt-0.5 flex items-center gap-2 whitespace-nowrap">
          {r.color && <span className="inline-block h-[2px] w-3 rounded" style={{ background: r.color }} />}
          <span className="lm-num font-semibold" style={{ color: "var(--th-text-heading)" }}>
            {r.value}
          </span>
          <span style={{ color: "var(--th-text-secondary)" }}>{r.label}</span>
        </div>
      ))}
    </div>
  );
}

export function Legend({ items }: { items: Array<{ label: string; color: string; detail?: string }> }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs" style={{ color: "var(--th-text-secondary)" }}>
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-1.5">
          <span className="lm-mark inline-block h-2.5 w-2.5 rounded-sm" style={{ background: i.color }} />
          <span>{i.label}</span>
          {i.detail && (
            <span className="lm-num" style={{ color: "var(--th-text-muted)" }}>
              {i.detail}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Card with title, optional subtitle and a chart / table toggle: the table is the chart's accessible twin. */
export function ChartCard({
  title,
  subtitle,
  table,
  children,
  className = "",
}: {
  title: string;
  subtitle?: ReactNode;
  table?: { columns: string[]; rows: Array<Array<string | number>> };
  children: ReactNode;
  className?: string;
}) {
  const [showTable, setShowTable] = useState(false);
  return (
    <section
      className={`min-w-0 rounded-xl border p-4 ${className}`}
      style={{ background: "var(--th-card-bg)", borderColor: "var(--th-card-border)" }}
      aria-label={title}
    >
      <header className="mb-3 flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold" style={{ color: "var(--th-text-heading)" }}>
            {title}
          </h2>
          {subtitle && (
            <p className="mt-0.5 text-xs" style={{ color: "var(--th-text-muted)" }}>
              {subtitle}
            </p>
          )}
        </div>
        {table && (
          <button
            type="button"
            onClick={() => setShowTable((v) => !v)}
            aria-pressed={showTable}
            className="shrink-0 rounded-md border px-2 py-0.5 text-[11px] transition"
            style={{ borderColor: "var(--th-border)", color: "var(--th-text-secondary)" }}
          >
            {showTable ? "Chart" : "Table"}
          </button>
        )}
      </header>
      {showTable && table ? <DataTable columns={table.columns} rows={table.rows} /> : children}
    </section>
  );
}

export function DataTable({
  columns,
  rows,
  empty = "No data in this range",
}: {
  columns: string[];
  rows: Array<Array<ReactNode>>;
  empty?: string;
}) {
  if (rows.length === 0)
    return (
      <p className="py-6 text-center text-xs" style={{ color: "var(--th-text-muted)" }}>
        {empty}
      </p>
    );
  return (
    <div className="max-h-80 overflow-auto">
      <table className="w-full text-left text-xs">
        <thead>
          <tr style={{ color: "var(--th-text-muted)" }}>
            {columns.map((c, i) => (
              <th key={c} className={`pb-1.5 font-medium ${i > 0 ? "text-right" : ""}`}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri} className="border-t" style={{ borderColor: "var(--th-border)" }}>
              {r.map((cell, ci) => (
                <td
                  key={ci}
                  className={`py-1.5 ${ci > 0 ? "lm-num text-right" : ""}`}
                  style={{ color: ci === 0 ? "var(--th-text-primary)" : "var(--th-text-secondary)" }}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Column path: square at the baseline, 4px rounded data-end. */
function columnPath(x: number, y: number, w: number, h: number): string {
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

export type ColumnSeries = { name: string; color: string; values: number[] };

/** Daily columns, one or two series side by side; one y-axis; per-day hover/focus readout. */
export function ColumnChart({
  days,
  series,
  format,
  integer = false,
  height = 168,
  label,
}: {
  days: number[];
  series: ColumnSeries[];
  format: (v: number) => string;
  integer?: boolean;
  height?: number;
  label: string;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const width = useWidth(boxRef);
  const [tip, setTip] = useState<Tip | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const m = { top: 10, right: 6, bottom: 22, left: 44 };
  const plotW = Math.max(40, width - m.left - m.right);
  const plotH = height - m.top - m.bottom;
  const max = Math.max(0, ...series.flatMap((s) => s.values));
  const ticks = niceTicks(max, 4, integer);
  const top = ticks[ticks.length - 1] || 1;
  const n = Math.max(days.length, 1);
  const band = plotW / n;
  const gap = 2;
  const barW = Math.max(1, Math.min(24, (band * 0.75 - gap * (series.length - 1)) / series.length));
  const groupW = barW * series.length + gap * (series.length - 1);
  const y = (v: number) => m.top + plotH - (v / top) * plotH;
  const labelEvery = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(plotW / 64))));

  const show = (i: number) => {
    const peak = Math.max(...series.map((s) => s.values[i] ?? 0));
    setHover(i);
    setTip({
      x: m.left + band * i + band / 2,
      y: y(peak),
      title: fmtDay(days[i]),
      rows: series.map((s) => ({ label: s.name, value: format(s.values[i] ?? 0), color: s.color })),
    });
  };
  const hide = () => {
    setHover(null);
    setTip(null);
  };

  return (
    <div ref={boxRef} className="relative w-full">
      <svg width={width} height={height} role="img" aria-label={label} className="block">
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={m.left}
              x2={m.left + plotW}
              y1={y(t)}
              y2={y(t)}
              stroke={t === 0 ? "var(--lm-axis)" : "var(--lm-grid)"}
              strokeWidth={1}
              shapeRendering="crispEdges"
            />
            <text
              x={m.left - 6}
              y={y(t)}
              dy="0.32em"
              textAnchor="end"
              fontSize={10}
              className="lm-num"
              fill="var(--th-text-muted)"
            >
              {format(t)}
            </text>
          </g>
        ))}
        {days.map((d, i) => {
          const x0 = m.left + band * i + (band - groupW) / 2;
          return (
            <g key={d}>
              {hover === i && (
                <rect x={m.left + band * i} y={m.top} width={band} height={plotH} fill="var(--lm-hover)" />
              )}
              {series.map((s, si) => {
                const v = s.values[i] ?? 0;
                if (v <= 0) return null;
                const h = Math.max(1, plotH - (y(v) - m.top));
                return (
                  <path
                    key={s.name}
                    className="lm-mark"
                    d={columnPath(x0 + si * (barW + gap), m.top + plotH - h, barW, h)}
                    fill={s.color}
                  />
                );
              })}
              {(i % labelEvery === 0 || i === n - 1) && (i === n - 1 || n - 1 - i >= labelEvery / 2) && (
                <text
                  x={m.left + band * i + band / 2}
                  y={height - 6}
                  textAnchor={i === 0 && band < 30 ? "start" : i === n - 1 && band < 30 ? "end" : "middle"}
                  fontSize={10}
                  fill="var(--th-text-muted)"
                >
                  {fmtDay(d)}
                </text>
              )}
              <rect
                className="lm-hit"
                x={m.left + band * i}
                y={m.top}
                width={band}
                height={plotH}
                fill="transparent"
                tabIndex={0}
                aria-label={`${fmtDay(d)}: ${series.map((s) => `${s.name} ${format(s.values[i] ?? 0)}`).join(", ")}`}
                onPointerEnter={() => show(i)}
                onPointerLeave={hide}
                onFocus={() => show(i)}
                onBlur={hide}
              />
            </g>
          );
        })}
      </svg>
      <Tooltip tip={tip} width={width} />
    </div>
  );
}

/** Horizontal bars, value at the tip; for a short list where every value is labelled. */
export function BarList({
  items,
}: {
  items: Array<{ key: string; label: ReactNode; value: number; display: string; color: string }>;
}) {
  const max = Math.max(0, ...items.map((i) => i.value));
  return (
    <ul className="space-y-2">
      {items.map((i) => (
        <li key={i.key} className="flex items-center gap-3 text-xs">
          <span className="w-32 shrink-0 truncate" style={{ color: "var(--th-text-secondary)" }}>
            {i.label}
          </span>
          <span className="flex min-w-0 flex-1 items-center gap-2">
            {i.value > 0 && (
              <span
                className="lm-mark h-3 shrink-0 rounded-r"
                style={{
                  width: `calc((100% - 88px) * ${(i.value / (max || 1)).toFixed(4)})`,
                  minWidth: 2,
                  background: i.color,
                }}
              />
            )}
            <span className="lm-num shrink-0" style={{ color: "var(--th-text-primary)" }}>
              {i.display}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

export type StackKey = { key: string; label: string; color: string; ink: string };

/** 100% stacked horizontal bars with 2px gaps; a segment is labelled inside only when it clearly fits. */
export function StackedBars({
  keys,
  rows,
}: {
  keys: StackKey[];
  rows: Array<{ label: string; values: Record<string, number> }>;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const width = useWidth(boxRef);
  const [tip, setTip] = useState<Tip | null>(null);
  const totals = keys.map((k) => ({ ...k, total: rows.reduce((s, r) => s + (r.values[k.key] ?? 0), 0) }));
  const grand = totals.reduce((s, k) => s + k.total, 0);
  const showTip = (el: HTMLElement, row: string, k: StackKey, v: number, share: number) => {
    const box = boxRef.current?.getBoundingClientRect();
    const seg = el.getBoundingClientRect();
    setTip({
      x: seg.left - (box?.left ?? 0) + seg.width / 2,
      y: seg.top - (box?.top ?? 0),
      title: row,
      rows: [{ label: k.label, value: `${v} (${Math.round(share * 100)}%)`, color: k.color }],
    });
  };

  return (
    <div ref={boxRef} className="relative">
      <div className="space-y-2.5">
        {rows.map((r) => {
          const sum = keys.reduce((s, k) => s + (r.values[k.key] ?? 0), 0);
          return (
            <div key={r.label}>
              <div className="mb-1 flex text-xs" style={{ color: "var(--th-text-secondary)" }}>
                <span className="flex-1">{r.label}</span>
                <span className="lm-num" style={{ color: "var(--th-text-muted)" }}>
                  {sum}
                </span>
              </div>
              <div className="flex h-5 gap-[2px] overflow-hidden rounded-r" role="list" aria-label={r.label}>
                {sum === 0 && <div className="h-full w-full rounded-r" style={{ background: "var(--lm-grid)" }} />}
                {keys.map((k) => {
                  const v = r.values[k.key] ?? 0;
                  if (v <= 0) return null;
                  const share = v / sum;
                  const text = String(v);
                  const fits = share * (width - 8) >= text.length * 7 + 12;
                  const readout = `${r.label}: ${k.label} ${v} (${Math.round(share * 100)}%)`;
                  return (
                    <div
                      key={k.key}
                      role="listitem"
                      tabIndex={0}
                      aria-label={readout}
                      className="lm-mark lm-hit flex h-full min-w-[2px] items-center justify-center text-[11px] font-semibold"
                      style={{ flexGrow: v, flexBasis: 0, background: k.color, color: k.ink }}
                      onPointerEnter={(e) => showTip(e.currentTarget, r.label, k, v, share)}
                      onPointerLeave={() => setTip(null)}
                      onFocus={(e) => showTip(e.currentTarget, r.label, k, v, share)}
                      onBlur={() => setTip(null)}
                    >
                      {fits ? text : null}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-3">
        <Legend
          items={totals.map((k) => ({
            label: k.label,
            color: k.color,
            detail: `${k.total}${grand ? ` (${Math.round((k.total / grand) * 100)}%)` : ""}`,
          }))}
        />
      </div>
      <Tooltip tip={tip} width={width} />
    </div>
  );
}
