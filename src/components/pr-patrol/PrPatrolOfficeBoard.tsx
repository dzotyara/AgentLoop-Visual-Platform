import { useEffect, useMemo } from "react";
import type { Agent } from "../../types";
import { formatUsd, getClaudeCosts, getPrPatrolStatus, type PrPatrolPhase } from "../../api";
import { usePolling } from "../../hooks/usePolling";
import AgentAvatar from "../AgentAvatar";
import { setLiveFromStatus } from "./live-store";
import ReadyToMergeBlock from "./ReadyToMergeBlock";
import { ACTION_LABEL, PHASE_META, TONE_TEXT, WaitReason, checksSummary } from "./pr-ui";
import PixelIcon from "../pixel/PixelIcon";

const ORDER: PrPatrolPhase[] = ["working", "blocked", "waiting", "watching", "ready", "error"];

/**
 * PR status board under the office scene. Also feeds the live store the scene reads,
 * so the bubbles over working agents show their PR and current tool call.
 */
export default function PrPatrolOfficeBoard({ agents, onOpenPrs }: { agents: Agent[]; onOpenPrs?: () => void }) {
  const { data } = usePolling(getPrPatrolStatus, 2500);
  const { data: costs } = usePolling(getClaudeCosts, 30_000);

  useEffect(() => {
    if (data) setLiveFromStatus(data);
  }, [data]);

  const prs = useMemo(
    () =>
      (data?.prs ?? [])
        .filter((p) => p.phase !== "skipped" && p.phase !== "ready" && p.phase !== "merging")
        .sort((a, b) => ORDER.indexOf(a.phase) - ORDER.indexOf(b.phase) || b.updated_at - a.updated_at),
    [data],
  );
  const ready = (data?.prs ?? [])
    .filter((p) => p.phase === "ready" || p.phase === "merging")
    .sort((a, b) => Number(b.phase === "merging") - Number(a.phase === "merging"));
  if (!data || prs.length + ready.length === 0) return null;
  const working = prs.filter((p) => p.agent).length;

  return (
    <section
      className="mx-auto mt-3 w-full rounded-xl border px-3 py-3"
      style={{ borderColor: "var(--th-card-border)", background: "var(--th-card-bg)" }}
    >
      <header className="mb-2 flex items-center gap-3">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold" style={{ color: "var(--th-text-heading)" }}>
          <PixelIcon name="prs" size={16} /> PR Patrol
        </h3>
        <span className="text-xs" style={{ color: "var(--th-text-muted)" }}>
          {working} agent{working === 1 ? "" : "s"} working · {prs.length + ready.length} open PRs
          {costs && (
            <>
              {" · "}
              <PixelIcon name="spend" size={12} /> today {formatUsd(costs.today.costUsd)}
            </>
          )}
        </span>
        <span
          className={`rounded-full border px-2 py-0.5 text-[11px] ${
            data.write
              ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-500"
              : "border-amber-500/30 bg-amber-500/15 text-amber-500"
          }`}
        >
          {data.write ? "pushing" : "dry run"}
        </span>
        {onOpenPrs && (
          <button
            type="button"
            onClick={onOpenPrs}
            className="ml-auto text-xs hover:underline"
            style={{ color: "var(--th-text-secondary)" }}
          >
            Open PRs →
          </button>
        )}
      </header>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {prs.map((pr) => {
          const meta = PHASE_META[pr.phase] ?? PHASE_META.watching;
          const checks = checksSummary(pr.snapshot?.checks ?? []);
          const agent = pr.agent ? agents.find((a) => a.id === pr.agent?.id) : undefined;
          return (
            <button
              type="button"
              key={pr.pr_key}
              onClick={onOpenPrs}
              className="flex min-w-0 items-start gap-2 rounded-lg border px-2.5 py-2 text-left transition hover:brightness-110"
              style={{
                borderColor: pr.agent ? "rgba(56,189,248,0.45)" : "var(--th-card-border)",
                background: "var(--th-bg-surface)",
              }}
            >
              {pr.agent ? (
                <AgentAvatar agent={agent} agents={agents} size={28} rounded="xl" />
              ) : (
                <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${meta.dot}`} />
              )}
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 text-[11px]" style={{ color: "var(--th-text-muted)" }}>
                  {pr.repo.split("/")[1]} #{pr.number}
                  <span className="ml-auto shrink-0" style={{ color: "var(--th-text-secondary)" }}>
                    {meta.label}
                  </span>
                </span>
                <span className="block truncate text-xs font-medium" style={{ color: "var(--th-text-primary)" }}>
                  {pr.title}
                </span>
                {pr.agent ? (
                  <span className="block truncate text-[11px] text-sky-400">
                    {pr.agent.name} · {ACTION_LABEL[pr.agent.action] ?? pr.agent.action} — {pr.agent.activity}
                  </span>
                ) : (
                  <>
                    <span className="mt-0.5 block">
                      <WaitReason waitingOn={pr.waiting_on} summary={pr.summary} clamp={1} />
                    </span>
                    {pr.snapshot && (
                      <span className={`block truncate text-[10px] ${TONE_TEXT[checks.tone]}`}>{checks.text}</span>
                    )}
                  </>
                )}
              </span>
            </button>
          );
        })}
      </div>
      {ready.length > 0 && (
        <div className={prs.length ? "mt-3" : ""}>
          <ReadyToMergeBlock prs={ready} costs={costs} compact />
        </div>
      )}
    </section>
  );
}
