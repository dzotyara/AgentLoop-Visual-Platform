import type { ReactNode } from "react";
import type { LoopMetrics } from "../../api";
import PixelIcon, { type PixelIconName } from "../pixel/PixelIcon";
import { fmtDate, fmtDuration, fmtPct, fmtUsd } from "./format";

function StatTile({
  icon,
  label,
  value,
  detail,
}: {
  icon: PixelIconName;
  label: string;
  value: string;
  detail: ReactNode;
}) {
  return (
    <div
      className="min-w-0 rounded-xl border px-4 py-3"
      style={{ background: "var(--th-card-bg)", borderColor: "var(--th-card-border)" }}
    >
      <div className="flex items-center gap-1.5 text-xs" style={{ color: "var(--th-text-muted)" }}>
        <PixelIcon name={icon} size={16} />
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-1 text-2xl font-semibold leading-tight" style={{ color: "var(--th-text-heading)" }}>
        {value}
      </div>
      <div className="mt-0.5 truncate text-[11px]" style={{ color: "var(--th-text-secondary)" }}>
        {detail}
      </div>
    </div>
  );
}

/** Headline numbers: time to green, cost per merged PR, merged PRs, accepted-findings rate, today's spend. */
export default function KpiRow({ m }: { m: LoopMetrics }) {
  const k = m.kpis;
  const collecting =
    m.history.since === null ? "collecting from the next tick" : `collecting since ${fmtDate(m.history.since)}`;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
      <StatTile
        icon="clock"
        label="Time to green"
        value={fmtDuration(k.timeToGreen.medianMs)}
        detail={
          k.timeToGreen.n > 0
            ? `median · p90 ${fmtDuration(k.timeToGreen.p90Ms)} · ${k.timeToGreen.n} PR${k.timeToGreen.n === 1 ? "" : "s"}`
            : collecting
        }
      />
      <StatTile
        icon="money"
        label="Cost per merged PR"
        value={fmtUsd(k.costPerMergedPrUsd)}
        detail={
          k.runsPerMergedPr !== null ? `${k.runsPerMergedPr.toFixed(1)} agent runs per merged PR` : "no merged PRs yet"
        }
      />
      <StatTile
        icon="merge"
        label="Merged PRs"
        value={String(k.mergedPrs)}
        detail={
          k.mergedPrs > 0
            ? `${k.mergedWithAgentHelp} with agent help${k.timeToMerge.n > 0 ? ` · ${fmtDuration(k.timeToMerge.medianMs)} to merge` : ""}`
            : `in the last ${m.days} days`
        }
      />
      <StatTile
        icon="check"
        label="Accepted findings"
        value={fmtPct(k.acceptedFindingsRate)}
        detail="fixed, of fixed + declined"
      />
      <StatTile
        icon="spend"
        label="Today's spend"
        value={fmtUsd(k.todaySpendUsd)}
        detail={`${fmtUsd(k.spendUsd)} · ${k.runs} runs in ${m.days} days`}
      />
    </div>
  );
}
