import type { PrPatrolRunStatus } from "../../api";

export function formatDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "-";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

/** Offset of a step from the run start: "+0:42", "+12:05", "+1:02:10". */
export function formatOffset(at: number | null, start: number | null): string {
  if (at == null || start == null) return "";
  const total = Math.max(0, Math.round((at - start) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h ? `+${h}:${String(m).padStart(2, "0")}:${s}` : `+${m}:${s}`;
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export function formatCost(v: number | null | undefined): string {
  if (v == null) return "-";
  if (v >= 100) return `$${v.toFixed(0)}`;
  if (v >= 1) return `$${v.toFixed(2)}`;
  return `$${v.toFixed(3)}`;
}

export function formatWhen(ms: number | null, now = Date.now()): string {
  if (!ms) return "-";
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(ms).toLocaleDateString();
}

/** "acme/widgets#12" -> "widgets#12". */
export function shortPr(pr: string | null): string {
  if (!pr) return "-";
  const [repo, n] = pr.split("#");
  return `${repo.split("/")[1] ?? repo}#${n}`;
}

export function shortModel(model: string): string {
  return model.replace(/^claude-/, "");
}

export const STATUS_META: Record<PrPatrolRunStatus, { label: string; dot: string; chip: string }> = {
  running: { label: "Running", dot: "bg-sky-400 animate-pulse", chip: "bg-sky-500/15 text-sky-400 border-sky-500/30" },
  done: { label: "Done", dot: "bg-emerald-500", chip: "bg-emerald-500/15 text-emerald-500 border-emerald-500/30" },
  failed: { label: "Failed", dot: "bg-rose-500", chip: "bg-rose-500/15 text-rose-400 border-rose-500/30" },
};

export const SEVERITY_CHIP: Record<string, string> = {
  P0: "bg-rose-600/20 text-rose-500 border-rose-600/40",
  P1: "bg-orange-500/15 text-orange-500 border-orange-500/30",
  P2: "bg-amber-500/15 text-amber-500 border-amber-500/30",
  P3: "bg-slate-500/15 text-slate-400 border-slate-500/30",
};

export function verdictTone(verdict: string | null | undefined): string {
  if (!verdict) return "text-slate-400";
  if (verdict.startsWith("fixed")) return "text-emerald-500";
  if (verdict === "declined") return "text-amber-500";
  if (verdict === "blocked") return "text-rose-400";
  return "text-slate-400";
}
