/** Formatting for the loop metrics page. A missing value renders as an en dash. */

export const NONE = "–";

export function fmtDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return NONE;
  const min = ms / 60_000;
  if (min < 1) return `${Math.max(0, Math.round(ms / 1000))}s`;
  if (min < 60) return `${Math.round(min)}m`;
  const h = min / 60;
  if (h < 48) return `${h < 10 ? h.toFixed(1) : Math.round(h)}h`;
  const d = h / 24;
  return `${d < 10 ? d.toFixed(1) : Math.round(d)}d`;
}

export function fmtUsd(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return NONE;
  if (v >= 1000) return `$${(v / 1000).toFixed(1)}K`;
  if (v >= 100) return `$${v.toFixed(0)}`;
  if (v >= 1) return `$${v.toFixed(2)}`;
  if (v === 0) return "$0";
  return `$${v.toFixed(3)}`;
}

export function fmtPct(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return NONE;
  return `${Math.round(v * 100)}%`;
}

export function fmtCount(v: number): string {
  if (v >= 10_000) return `${(v / 1000).toFixed(0)}K`;
  if (v >= 1000) return `${(v / 1000).toFixed(1)}K`;
  return String(Math.round(v * 10) / 10);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function fmtDay(ms: number): string {
  const d = new Date(ms);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

export function fmtDate(ms: number): string {
  const d = new Date(ms);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

/** Clean axis ticks from 0: steps of 1, 2 or 5 x 10^k, at most `count` intervals. */
export function niceTicks(max: number, count = 4, integer = false): number[] {
  if (!(max > 0)) return [0, 1];
  const raw = max / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const nice = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? 10 * pow;
  const step = integer ? Math.max(1, Math.round(nice)) : nice;
  const ticks: number[] = [];
  for (let t = 0; t < max + step * 0.999; t += step) ticks.push(Number(t.toPrecision(12)));
  return ticks;
}
