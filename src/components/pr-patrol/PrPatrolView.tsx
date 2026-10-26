import { useMemo, useState } from "react";
import type { Agent } from "../../types";
import { getPrPatrolStatus, triggerPrPatrolTick, type PrPatrolPhase, type PrPatrolPr } from "../../api";
import { usePolling } from "../../hooks/usePolling";
import PrDetail from "./PrDetail";
import { PHASE_META, TONE_TEXT, checksSummary, timeAgo } from "./pr-ui";

const PHASE_ORDER: PrPatrolPhase[] = ["working", "blocked", "waiting", "watching", "ready", "error", "skipped"];

function PrRow({ pr, selected, onSelect }: { pr: PrPatrolPr; selected: boolean; onSelect: () => void }) {
  const meta = PHASE_META[pr.phase] ?? PHASE_META.watching;
  const checks = checksSummary(pr.snapshot?.checks ?? []);
  return (
    <button
      type="button"
      onClick={onSelect}
      className="w-full rounded-lg border px-3 py-2.5 text-left transition"
      style={{
        borderColor: selected ? "var(--th-focus-ring)" : "var(--th-card-border)",
        background: selected ? "var(--th-card-bg-hover)" : "var(--th-card-bg)",
      }}
    >
      <div className="flex items-center gap-2">
        <span className={`h-2 w-2 shrink-0 rounded-full ${meta.dot}`} title={meta.label} />
        <span className="truncate text-xs" style={{ color: "var(--th-text-muted)" }}>
          {pr.repo.split("/")[1]} #{pr.number}
        </span>
        {pr.agent && <span className="ml-auto shrink-0 text-[11px] text-sky-400">{pr.agent.name}…</span>}
      </div>
      <div className="mt-0.5 line-clamp-2 text-sm leading-snug" style={{ color: "var(--th-text-primary)" }}>
        {pr.title || pr.pr_key}
      </div>
      <div className="mt-1 flex items-center gap-2 text-[11px]">
        <span style={{ color: "var(--th-text-secondary)" }}>{meta.label}</span>
        {pr.snapshot && <span className={TONE_TEXT[checks.tone]}>· {checks.text}</span>}
      </div>
    </button>
  );
}

export default function PrPatrolView({
  agents,
  onOpenTerminal,
}: {
  agents: Agent[];
  onOpenTerminal: (taskId: string) => void;
}) {
  const { data, error, loading, refresh } = usePolling(getPrPatrolStatus, 4000);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [showSkipped, setShowSkipped] = useState(false);
  const [ticking, setTicking] = useState(false);

  const prs = useMemo(() => {
    const list = (data?.prs ?? []).filter((p) => showSkipped || p.phase !== "skipped");
    return list.sort(
      (a, b) => PHASE_ORDER.indexOf(a.phase) - PHASE_ORDER.indexOf(b.phase) || b.updated_at - a.updated_at,
    );
  }, [data, showSkipped]);
  const counts = useMemo(() => {
    const c: Partial<Record<PrPatrolPhase, number>> = {};
    for (const p of data?.prs ?? []) c[p.phase] = (c[p.phase] ?? 0) + 1;
    return c;
  }, [data]);
  const selected = prs.find((p) => p.pr_key === selectedKey) ?? prs[0] ?? null;

  const checkNow = async () => {
    setTicking(true);
    try {
      await triggerPrPatrolTick();
      setTimeout(() => void refresh(), 1500);
    } finally {
      setTimeout(() => setTicking(false), 1500);
    }
  };

  if (loading && !data) {
    return (
      <div className="p-8 text-sm" style={{ color: "var(--th-text-muted)" }}>
        Loading pull requests…
      </div>
    );
  }
  if (!data) {
    return <div className="p-8 text-sm text-rose-400">PR patrol is unavailable: {error}</div>;
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Summary bar */}
      <div
        className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border px-4 py-3"
        style={{ borderColor: "var(--th-card-border)", background: "var(--th-card-bg)" }}
      >
        {(["working", "blocked", "waiting", "ready"] as const).map((ph) => (
          <div key={ph} className="flex items-center gap-2 text-sm">
            <span className={`h-2 w-2 rounded-full ${PHASE_META[ph].dot}`} />
            <b style={{ color: "var(--th-text-heading)" }}>{counts[ph] ?? 0}</b>
            <span style={{ color: "var(--th-text-muted)" }}>{PHASE_META[ph].label}</span>
          </div>
        ))}
        <div className="ml-auto flex items-center gap-3 text-xs">
          <span
            className={`rounded-full border px-2 py-0.5 ${
              data.write
                ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-500"
                : "border-amber-500/30 bg-amber-500/15 text-amber-500"
            }`}
            title={
              data.write ? "Fixes are pushed to the PR branches" : "Agents commit locally only (PR_PATROL_WRITE=0)"
            }
          >
            {data.write ? "Auto-fix: pushing" : "Auto-fix: dry run"}
          </span>
          <span style={{ color: "var(--th-text-muted)" }}>
            checked {timeAgo(data.lastTick.at)}
            {data.lastTick.error ? ` · error: ${data.lastTick.error}` : ""}
          </span>
          <button
            type="button"
            disabled={ticking}
            onClick={() => void checkNow()}
            className="header-action-btn header-action-btn-secondary text-xs disabled:opacity-50"
          >
            {ticking ? "Checking…" : "Check now"}
          </button>
        </div>
      </div>

      {!data.enabled && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm text-amber-500">
          PR patrol is disabled (PR_PATROL_ENABLED=0).
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(260px,340px)_1fr]">
        {/* List */}
        <div className="flex flex-col gap-2">
          {prs.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--th-text-muted)" }}>
              No open pull requests match the patrol query.
            </p>
          ) : (
            prs.map((pr) => (
              <PrRow
                key={pr.pr_key}
                pr={pr}
                selected={selected?.pr_key === pr.pr_key}
                onSelect={() => setSelectedKey(pr.pr_key)}
              />
            ))
          )}
          {(counts.skipped ?? 0) > 0 && (
            <button
              type="button"
              onClick={() => setShowSkipped((v) => !v)}
              className="mt-1 text-left text-xs hover:underline"
              style={{ color: "var(--th-text-muted)" }}
            >
              {showSkipped ? "Hide" : "Show"} {counts.skipped} skipped / closed
            </button>
          )}
        </div>

        {/* Detail */}
        {selected ? (
          <PrDetail pr={selected} agents={agents} onOpenTerminal={onOpenTerminal} />
        ) : (
          <div className="text-sm" style={{ color: "var(--th-text-muted)" }}>
            Select a pull request.
          </div>
        )}
      </div>
    </div>
  );
}
