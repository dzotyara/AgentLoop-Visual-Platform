import type { PrPatrolRunDetail, PrPatrolRunSummary } from "../../api";
import PixelIcon from "../pixel/PixelIcon";
import { ACTION_LABEL } from "../pr-patrol/pr-ui";
import { STATUS_META, formatCost, formatDuration, formatTokens, shortModel, shortPr } from "./format";

export function spriteFor(run: PrPatrolRunSummary, spriteMap: Map<string, number>): number {
  return (run.agentId ? spriteMap.get(run.agentId) : undefined) ?? (run.agentSprite || 1);
}

export function AgentSprite({ sprite, name, size }: { sprite: number; name: string | null; size: number }) {
  return (
    <img
      src={`/sprites/${sprite}-D-1.png`}
      alt={name ?? "agent"}
      width={size}
      height={size}
      draggable={false}
      className="shrink-0 rounded-md object-contain"
      style={{ imageRendering: "pixelated", background: "var(--th-bg-surface)", width: size, height: size }}
    />
  );
}

export function StatusChip({ status }: { status: PrPatrolRunSummary["status"] }) {
  const m = STATUS_META[status] ?? STATUS_META.failed;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium ${m.chip}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${m.dot}`} />
      {m.label}
    </span>
  );
}

function Stat({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="flex flex-col" title={title}>
      <span className="text-[10px] uppercase tracking-wide" style={{ color: "var(--th-text-muted)" }}>
        {label}
      </span>
      <span className="font-mono text-sm" style={{ color: "var(--th-text-heading)" }}>
        {value}
      </span>
    </div>
  );
}

export default function RunHeader({ detail, sprite }: { detail: PrPatrolRunDetail; sprite: number }) {
  const { run, log } = detail;
  const totals = log?.totals;
  const cost = totals?.costUsd ?? run.costUsd;
  const models = totals?.byModel.length ? totals.byModel.map((m) => m.model) : run.models;
  const duration = run.durationMs ?? totals?.durationMs ?? null;
  const tokens = totals
    ? `${formatTokens(totals.inputTokens + totals.cacheReadTokens + totals.cacheWriteTokens)} in / ${formatTokens(totals.outputTokens)} out`
    : null;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <AgentSprite sprite={sprite} name={run.agentName} size={56} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-base font-semibold" style={{ color: "var(--th-text-heading)" }}>
              {run.agentName ?? "Agent"}
            </span>
            <span className="text-sm" style={{ color: "var(--th-text-secondary)" }}>
              {ACTION_LABEL[run.action] ?? run.action}
            </span>
            <StatusChip status={run.status} />
            {run.attempts && run.attempts > 1 ? (
              <span className="text-[11px]" style={{ color: "var(--th-text-muted)" }}>
                attempt {run.attempts}
              </span>
            ) : null}
          </div>
          <div className="mt-0.5 truncate text-sm" style={{ color: "var(--th-text-primary)" }} title={run.title}>
            {run.title}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-3 text-xs">
            {run.prUrl ? (
              <a
                href={run.prUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-sky-500 hover:underline"
              >
                <PixelIcon name="prs" size={12} />
                {shortPr(run.pr)}
                <PixelIcon name="external" size={10} />
              </a>
            ) : (
              <span style={{ color: "var(--th-text-muted)" }}>{shortPr(run.pr)}</span>
            )}
            {run.push.status === "pushed" && run.push.head && (
              <span className="inline-flex items-center gap-1" style={{ color: "var(--th-text-secondary)" }}>
                <PixelIcon name="git" size={12} /> pushed {run.push.commits} commit(s), head{" "}
                <code className="font-mono">{run.push.head}</code>
              </span>
            )}
            {run.push.status === "dry_run" && (
              <span style={{ color: "var(--th-text-muted)" }}>{run.push.commits} local commit(s), not pushed</span>
            )}
            {run.startedAt && (
              <span style={{ color: "var(--th-text-muted)" }}>{new Date(run.startedAt).toLocaleString()}</span>
            )}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        <Stat label="Cost" value={formatCost(cost)} />
        <Stat label="Duration" value={formatDuration(duration)} />
        <Stat label="Turns" value={totals ? String(totals.turns) : run.turns != null ? String(run.turns) : "-"} />
        <Stat label="Tool calls" value={log ? String(log.toolCalls) : "-"} />
        {tokens && <Stat label="Tokens" value={tokens} />}
        <Stat
          label="Model"
          value={models.length ? models.map(shortModel).join(", ") : (log?.model ?? "-")}
          title={totals?.byModel.map((m) => `${m.model}: ${formatCost(m.costUsd)}`).join("\n")}
        />
      </div>
    </div>
  );
}
