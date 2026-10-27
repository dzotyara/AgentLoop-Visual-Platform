import { useState } from "react";
import type { Agent } from "../../types";
import { formatUsd, type ClaudeCostBreakdown, type PrPatrolPr } from "../../api";
import AgentAvatar from "../AgentAvatar";
import { ACTION_LABEL, CheckIcon, ExternalLink, PhaseChip, Section, TONE_TEXT, checksSummary, timeAgo } from "./pr-ui";
import PixelIcon, { type PixelIconName } from "../pixel/PixelIcon";

const MERGEABLE_TEXT: Record<string, { text: string; tone: string }> = {
  MERGEABLE: { text: "No conflicts with base", tone: "text-emerald-500" },
  CONFLICTING: { text: "Conflicts with base", tone: "text-rose-400" },
  UNKNOWN: { text: "Checking mergeability…", tone: "text-amber-500" },
};

const REVIEW_TEXT: Record<string, { text: string; tone: string }> = {
  APPROVED: { text: "Approved", tone: "text-emerald-500" },
  CHANGES_REQUESTED: { text: "Changes requested", tone: "text-rose-400" },
  REVIEW_REQUIRED: { text: "Review required", tone: "text-amber-500" },
};

function StatusRow({
  icon,
  label,
  value,
  tone,
}: {
  icon: PixelIconName;
  label: string;
  value: string;
  tone: string;
}) {
  return (
    <div className="flex items-center gap-3 py-1.5 text-sm">
      <span className="flex w-5 justify-center">
        <PixelIcon name={icon} size={16} />
      </span>
      <span className="w-28 shrink-0" style={{ color: "var(--th-text-muted)" }}>
        {label}
      </span>
      <span className={tone}>{value}</span>
    </div>
  );
}

export default function PrDetail({
  pr,
  agents,
  onOpenTerminal,
  spend,
}: {
  pr: PrPatrolPr;
  agents: Agent[];
  onOpenTerminal: (taskId: string) => void;
  spend?: ClaudeCostBreakdown;
}) {
  const [showPassing, setShowPassing] = useState(false);
  const snap = pr.snapshot;
  const checks = snap?.checks ?? [];
  const summary = checksSummary(checks);
  const order = { failure: 0, pending: 1, success: 2, neutral: 3 } as const;
  const sorted = [...checks].sort((a, b) => order[a.state] - order[b.state] || a.name.localeCompare(b.name));
  const visibleChecks = showPassing ? sorted : sorted.filter((c) => c.state === "failure" || c.state === "pending");
  const workingAgent = pr.agent ? agents.find((a) => a.name === pr.agent?.name) : undefined;
  const unhandled = (snap?.feedback ?? []).filter((f) => !f.handled);
  const mergeable = MERGEABLE_TEXT[snap?.mergeable ?? "UNKNOWN"] ?? MERGEABLE_TEXT.UNKNOWN;
  const review = snap?.reviewDecision ? REVIEW_TEXT[snap.reviewDecision] : undefined;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {/* Header */}
      <div>
        <div className="flex flex-wrap items-center gap-2 text-xs" style={{ color: "var(--th-text-muted)" }}>
          <span>{pr.repo}</span>
          {snap && (
            <span className="rounded px-1.5 py-0.5 font-mono" style={{ background: "var(--th-glass-bg)" }}>
              {snap.headRefName} → {snap.baseRefName}
            </span>
          )}
          {snap?.isDraft && <span className="rounded bg-slate-500/20 px-1.5 py-0.5">Draft</span>}
        </div>
        <div className="mt-1 flex items-start justify-between gap-3">
          <h2 className="text-lg font-semibold leading-snug" style={{ color: "var(--th-text-heading)" }}>
            {pr.title} <span style={{ color: "var(--th-text-muted)" }}>#{pr.number}</span>
          </h2>
          <a
            href={pr.url}
            target="_blank"
            rel="noreferrer"
            className="header-action-btn header-action-btn-secondary shrink-0 whitespace-nowrap text-xs"
          >
            Open on GitHub ↗
          </a>
        </div>
      </div>

      {/* Auto-fix card */}
      <Section title="Auto-fix" right={<PhaseChip phase={pr.phase} />}>
        {pr.agent ? (
          <div className="flex items-center gap-3">
            <AgentAvatar agent={workingAgent} agents={agents} size={36} rounded="xl" />
            <div className="min-w-0 flex-1">
              <div className="text-sm" style={{ color: "var(--th-text-primary)" }}>
                <b>{pr.agent.name}</b> · {ACTION_LABEL[pr.agent.action] ?? pr.agent.action}
              </div>
              <div className="text-xs" style={{ color: "var(--th-text-muted)" }}>
                Claude Code is working in a local worktree of this PR
              </div>
            </div>
            <button
              type="button"
              onClick={() => onOpenTerminal(pr.agent!.taskId)}
              className="header-action-btn header-action-btn-primary text-xs"
            >
              Watch live
            </button>
          </div>
        ) : (
          <p className="text-sm" style={{ color: "var(--th-text-primary)" }}>
            {pr.summary || "Waiting for the next patrol tick."}
          </p>
        )}
        {pr.notes.length > 0 && (
          <ul className="mt-2 space-y-0.5 text-xs" style={{ color: "var(--th-text-muted)" }}>
            {pr.notes.map((n) => (
              <li key={n}>· {n}</li>
            ))}
          </ul>
        )}
      </Section>

      {/* Merge status */}
      <Section title="Status">
        <StatusRow
          icon={summary.tone === "bad" ? "cross" : summary.tone === "wait" ? "pending" : "check"}
          label="Checks"
          value={summary.text}
          tone={TONE_TEXT[summary.tone]}
        />
        <StatusRow icon="merge" label="Merge" value={mergeable.text} tone={mergeable.tone} />
        <StatusRow
          icon="chat"
          label="Comments"
          value={unhandled.length ? `${unhandled.length} unhandled` : "All handled"}
          tone={unhandled.length ? "text-amber-500" : "text-emerald-500"}
        />
        {review && <StatusRow icon="reviewer" label="Review" value={review.text} tone={review.tone} />}
        <StatusRow
          icon="review"
          label="Own review"
          value={pr.review_rounds ? `${pr.review_rounds} round(s)` : "Not yet"}
          tone="text-slate-400"
        />
        <StatusRow
          icon="spend"
          label="Agent spend"
          value={spend ? `${formatUsd(spend.costUsd)} · ${spend.runs} run(s)` : "No runs yet"}
          tone="text-violet-400"
        />
      </Section>

      {/* Checks */}
      <Section
        title={`Checks (${checks.length})`}
        right={
          checks.length > 0 && (
            <button
              type="button"
              onClick={() => setShowPassing((v) => !v)}
              className="text-xs hover:underline"
              style={{ color: "var(--th-text-secondary)" }}
            >
              {showPassing ? "Hide passing" : "Show all"}
            </button>
          )
        }
      >
        {visibleChecks.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--th-text-muted)" }}>
            {checks.length ? "Nothing failing or running." : "No checks reported."}
          </p>
        ) : (
          <ul>
            {visibleChecks.map((c) => (
              <li
                key={`${c.workflow}::${c.name}`}
                className="flex items-center gap-3 py-1.5 text-sm border-t first:border-t-0"
                style={{ borderColor: "var(--th-card-border)" }}
              >
                <span className="w-4 text-center">
                  <CheckIcon state={c.state} />
                </span>
                <span className={`min-w-0 flex-1 truncate ${c.ignored ? "line-through opacity-60" : ""}`}>
                  {c.workflow ? <span style={{ color: "var(--th-text-muted)" }}>{c.workflow} / </span> : null}
                  {c.name}
                </span>
                {c.detailsUrl && (
                  <ExternalLink href={c.detailsUrl} className="text-xs text-sky-400">
                    Details
                  </ExternalLink>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* Comments */}
      {(snap?.feedback.length ?? 0) > 0 && (
        <Section title={`Review comments (${snap!.feedback.length})`}>
          <ul className="space-y-3">
            {snap!.feedback.map((f) => (
              <li key={f.id} className="text-sm">
                <div className="flex items-center gap-2 text-xs" style={{ color: "var(--th-text-muted)" }}>
                  {f.handled ? (
                    <PixelIcon name="check" size={12} title="handled" />
                  ) : (
                    <span className="text-amber-500">●</span>
                  )}
                  <b style={{ color: "var(--th-text-secondary)" }}>@{f.author}</b>
                  {f.path && (
                    <span className="truncate font-mono">
                      {f.path}
                      {f.line ? `:${f.line}` : ""}
                    </span>
                  )}
                  <ExternalLink href={f.url} className="ml-auto text-sky-400">
                    View
                  </ExternalLink>
                </div>
                <p
                  className="mt-1 line-clamp-3 whitespace-pre-wrap break-words"
                  style={{ color: "var(--th-text-primary)" }}
                >
                  {f.excerpt}
                </p>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* Activity */}
      <Section title="Agent activity">
        {pr.actions.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--th-text-muted)" }}>
            No agent runs yet.
          </p>
        ) : (
          <ol className="space-y-3">
            {pr.actions.map((a) => (
              <li key={`${a.action}-${a.updatedAt}`} className="flex gap-3 text-sm">
                <span
                  className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                    a.status === "done"
                      ? "bg-emerald-500"
                      : a.status === "failed"
                        ? "bg-rose-500"
                        : "animate-pulse bg-sky-400"
                  }`}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <b style={{ color: "var(--th-text-primary)" }}>{ACTION_LABEL[a.action] ?? a.action}</b>
                    <span className="text-xs" style={{ color: "var(--th-text-muted)" }}>
                      {a.status}
                      {a.attempts > 1 ? ` · attempt ${a.attempts}` : ""} · {timeAgo(a.updatedAt)}
                    </span>
                    {a.taskId && (
                      <button
                        type="button"
                        onClick={() => onOpenTerminal(a.taskId!)}
                        className="ml-auto text-xs text-sky-400 hover:underline"
                      >
                        Log
                      </button>
                    )}
                  </div>
                  {a.note && (
                    <p
                      className="mt-0.5 line-clamp-4 whitespace-pre-wrap break-words text-xs"
                      style={{ color: "var(--th-text-secondary)" }}
                    >
                      {a.note}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
      </Section>
    </div>
  );
}
