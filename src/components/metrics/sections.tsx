import type { LoopMetrics, LoopMetricsWaitBucket } from "../../api";
import PixelIcon, { type PixelIconName } from "../pixel/PixelIcon";
import { ACTION_LABEL } from "../pr-patrol/pr-ui";
import { BarList, ChartCard, DataTable, Legend, StackedBars, type StackKey } from "./charts";
import { NONE, fmtDate, fmtDay, fmtDuration, fmtPct, fmtUsd } from "./format";

const S = (n: 1 | 2 | 3 | 4) => `var(--lm-s${n})`;
const INK = (n: 1 | 2 | 3 | 4) => `var(--lm-s${n}-ink)`;

const WAIT_META: Record<LoopMetricsWaitBucket, { label: string; icon: PixelIconName }> = {
  ci: { label: "CI running", icon: "ci" },
  reviewer: { label: "Reviewer", icon: "reviewer" },
  github: { label: "GitHub", icon: "github" },
  you: { label: "You", icon: "you" },
  agent: { label: "Agent slot", icon: "queue" },
  base: { label: "Base broken", icon: "ci" },
  retry: { label: "Retrying later", icon: "queue" },
  ready: { label: "Ready, not merged", icon: "ready" },
};

function collectingNote(m: LoopMetrics): string {
  return m.history.since === null
    ? "Collecting from the next patrol tick."
    : m.history.since > m.since
      ? `Collecting since ${fmtDate(m.history.since)}.`
      : "";
}

export function WaitingCard({ m }: { m: LoopMetrics }) {
  const total = m.waiting.reduce((s, w) => s + w.ms, 0);
  const rows = [...m.waiting].sort((a, b) => b.ms - a.ms);
  return (
    <ChartCard
      title="Where PRs wait"
      subtitle={`Time PRs spent waiting, by what they waited on. ${collectingNote(m)}`}
      table={{
        columns: ["Waiting on", "Time", "Share"],
        rows: rows.map((w) => [WAIT_META[w.on].label, fmtDuration(w.ms), total ? fmtPct(w.ms / total) : NONE]),
      }}
    >
      {total === 0 ? (
        <p className="py-6 text-center text-xs" style={{ color: "var(--th-text-muted)" }}>
          No waiting time recorded yet.
        </p>
      ) : (
        <BarList
          items={rows.map((w) => ({
            key: w.on,
            label: (
              <span className="inline-flex items-center gap-1.5">
                <PixelIcon name={WAIT_META[w.on].icon} size={16} />
                {WAIT_META[w.on].label}
              </span>
            ),
            value: w.ms,
            display: `${fmtDuration(w.ms)} · ${fmtPct(w.ms / total)}`,
            color: S(1),
          }))}
        />
      )}
    </ChartCard>
  );
}

const VERDICT_KEYS: StackKey[] = [
  { key: "accepted", label: "Accepted", color: S(1), ink: INK(1) },
  { key: "declined", label: "Declined", color: S(2), ink: INK(2) },
  { key: "noAction", label: "No action", color: S(3), ink: INK(3) },
  { key: "blocked", label: "Blocked", color: S(4), ink: INK(4) },
];

export function FindingsCard({ m }: { m: LoopMetrics }) {
  const sev = m.findings.bySeverity;
  const severities = (["P0", "P1", "P2", "P3"] as const).map((s) => ({ s, n: sev[s] }));
  const blocking = (s: string) => s === "P0" || s === "P1";
  return (
    <ChartCard
      title="Review findings and fix verdicts"
      subtitle={`${m.findings.reviews} review${m.findings.reviews === 1 ? "" : "s"} by Argus; what Patch did with findings and comments.`}
      table={{
        columns: ["Item", "Count"],
        rows: [
          ...severities.map(({ s, n }) => [`Findings ${s}`, n]),
          ...m.verdicts.flatMap((v) =>
            VERDICT_KEYS.map((k) => [
              `${ACTION_LABEL[v.action] ?? v.action}: ${k.label}`,
              v[k.key as "accepted" | "declined" | "noAction" | "blocked"],
            ]),
          ),
        ],
      }}
    >
      <div className="mb-2">
        <Legend
          items={[
            { label: "Blocking (P0/P1), auto-fixed", color: S(1) },
            { label: "Left for the author (P2/P3)", color: "var(--lm-deemph)" },
          ]}
        />
      </div>
      <BarList
        items={severities.map(({ s, n }) => ({
          key: s,
          label: s,
          value: n,
          display: String(n),
          color: blocking(s) ? S(1) : "var(--lm-deemph)",
        }))}
      />
      <div className="mt-4 border-t pt-3" style={{ borderColor: "var(--th-border)" }}>
        {m.verdicts.length === 0 ? (
          <p className="text-xs" style={{ color: "var(--th-text-muted)" }}>
            No fix runs in this range.
          </p>
        ) : (
          <StackedBars
            keys={VERDICT_KEYS}
            rows={m.verdicts.map((v) => ({
              label: ACTION_LABEL[v.action] ?? v.action,
              values: { accepted: v.accepted, declined: v.declined, noAction: v.noAction, blocked: v.blocked },
            }))}
          />
        )}
      </div>
    </ChartCard>
  );
}

const CI_KEYS: StackKey[] = [
  { key: "branch", label: "Caused by the branch", color: S(1), ink: INK(1) },
  { key: "infra", label: "Infra", color: S(2), ink: INK(2) },
  { key: "flaky", label: "Flaky", color: S(3), ink: INK(3) },
  { key: "unknown", label: "Unknown", color: S(4), ink: INK(4) },
];

export function CiCard({ m }: { m: LoopMetrics }) {
  const c = m.ci.classification;
  const total = c.branch + c.flaky + c.infra + c.unknown;
  return (
    <ChartCard title="CI failures" subtitle="How Medic classified failing CI, and which checks flip.">
      {total === 0 ? (
        <p className="text-xs" style={{ color: "var(--th-text-muted)" }}>
          No CI fix runs in this range.
        </p>
      ) : (
        <StackedBars keys={CI_KEYS} rows={[{ label: "Fix CI runs", values: c }]} />
      )}
      <h3 className="mb-1 mt-4 text-xs font-semibold" style={{ color: "var(--th-text-heading)" }}>
        Flaky checks
      </h3>
      <p className="mb-2 text-[11px]" style={{ color: "var(--th-text-muted)" }}>
        Failed then passed on the same head, or failed on a head Medic classified flaky / infra. {collectingNote(m)}
      </p>
      <DataTable
        columns={["Check", "Flips", "Flaky / infra", "PRs", "Last"]}
        rows={m.ci.flakyChecks.map((f) => [
          <span className="break-all">{f.name}</span>,
          f.flips,
          f.classifiedFlaky,
          f.prs,
          fmtDay(f.lastAt),
        ])}
        empty="No flaky checks recorded yet"
      />
    </ChartCard>
  );
}

export function OutcomesCard({ m }: { m: LoopMetrics }) {
  return (
    <ChartCard title="Agent outcomes" subtitle="Runs started in this range, per agent and action.">
      <DataTable
        columns={["Agent / action", "Runs", "Done", "Failed", "Success", "Spend", "Median"]}
        rows={m.outcomes.map((o) => [
          <span>
            <span style={{ color: "var(--th-text-heading)" }}>{o.agent}</span>
            <span style={{ color: "var(--th-text-muted)" }}> · {ACTION_LABEL[o.action] ?? o.action}</span>
          </span>,
          o.runs,
          o.done,
          o.failed,
          o.done + o.failed > 0 ? fmtPct(o.done / (o.done + o.failed)) : NONE,
          fmtUsd(o.costUsd),
          fmtDuration(o.medianDurationMs),
        ])}
        empty="No agent runs in this range"
      />
    </ChartCard>
  );
}
