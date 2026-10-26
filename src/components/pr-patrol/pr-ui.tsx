import type { ReactNode } from "react";
import type { PrPatrolCheck, PrPatrolPhase } from "../../api";

export const PHASE_META: Record<PrPatrolPhase, { label: string; dot: string; chip: string }> = {
  working: {
    label: "Agent working",
    dot: "bg-sky-400 animate-pulse",
    chip: "bg-sky-500/15 text-sky-400 border-sky-500/30",
  },
  waiting: { label: "Waiting for CI", dot: "bg-amber-400", chip: "bg-amber-500/15 text-amber-500 border-amber-500/30" },
  watching: { label: "Queued", dot: "bg-slate-400", chip: "bg-slate-500/15 text-slate-400 border-slate-500/30" },
  blocked: { label: "Needs you", dot: "bg-rose-500", chip: "bg-rose-500/15 text-rose-400 border-rose-500/30" },
  ready: {
    label: "Ready to merge",
    dot: "bg-emerald-500",
    chip: "bg-emerald-500/15 text-emerald-500 border-emerald-500/30",
  },
  skipped: { label: "Skipped", dot: "bg-slate-600", chip: "bg-slate-600/15 text-slate-500 border-slate-600/30" },
  error: { label: "Error", dot: "bg-rose-600", chip: "bg-rose-600/15 text-rose-500 border-rose-600/30" },
};

export const ACTION_LABEL: Record<string, string> = {
  review: "Review",
  fix_review: "Fix review findings",
  address_feedback: "Address comments",
  fix_ci: "Fix CI",
  fix_conflict: "Resolve conflict",
  ready: "Ready",
};

export function PhaseChip({ phase }: { phase: PrPatrolPhase }) {
  const m = PHASE_META[phase] ?? PHASE_META.watching;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium ${m.chip}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${m.dot}`} />
      {m.label}
    </span>
  );
}

export function CheckIcon({ state }: { state: PrPatrolCheck["state"] }) {
  if (state === "success") return <span className="text-emerald-500">✓</span>;
  if (state === "failure") return <span className="text-rose-500">✕</span>;
  if (state === "pending") return <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-amber-400" />;
  return <span className="text-slate-500">–</span>;
}

/** One-line checks summary, Claude style: "3 failing · 2 pending · 38 passing". */
export function checksSummary(checks: PrPatrolCheck[]): { text: string; tone: "ok" | "bad" | "wait" | "none" } {
  const live = checks.filter((c) => !c.ignored);
  const failing = live.filter((c) => c.state === "failure").length;
  const pending = live.filter((c) => c.state === "pending").length;
  const passing = live.filter((c) => c.state === "success").length;
  if (live.length === 0) return { text: "No checks", tone: "none" };
  const parts = [
    failing ? `${failing} failing` : null,
    pending ? `${pending} pending` : null,
    passing ? `${passing} passing` : null,
  ].filter(Boolean);
  return { text: parts.join(" · ") || `${live.length} skipped`, tone: failing ? "bad" : pending ? "wait" : "ok" };
}

export const TONE_TEXT: Record<"ok" | "bad" | "wait" | "none", string> = {
  ok: "text-emerald-500",
  bad: "text-rose-400",
  wait: "text-amber-500",
  none: "text-slate-500",
};

export function Section({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section
      className="rounded-xl border"
      style={{ borderColor: "var(--th-card-border)", background: "var(--th-card-bg)" }}
    >
      <header
        className="flex items-center justify-between border-b px-4 py-2.5"
        style={{ borderColor: "var(--th-card-border)" }}
      >
        <h3 className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--th-text-secondary)" }}>
          {title}
        </h3>
        {right}
      </header>
      <div className="px-4 py-3">{children}</div>
    </section>
  );
}

export function timeAgo(ms: number, now = Date.now()): string {
  if (!ms) return "never";
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

export function ExternalLink({
  href,
  children,
  className = "",
}: {
  href: string | null;
  children: ReactNode;
  className?: string;
}) {
  if (!href) return <span className={className}>{children}</span>;
  return (
    <a href={href} target="_blank" rel="noreferrer" className={`hover:underline ${className}`}>
      {children}
    </a>
  );
}
