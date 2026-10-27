import { useCallback, useState } from "react";
import { getLoopMetrics, type LoopMetrics } from "../../api";
import { usePolling } from "../../hooks/usePolling";
import PixelIcon from "../pixel/PixelIcon";
import { ChartCard, ColumnChart, Legend } from "./charts";
import { fmtCount, fmtDate, fmtDay, fmtUsd } from "./format";
import KpiRow from "./KpiRow";
import { CiCard, FindingsCard, OutcomesCard, WaitingCard } from "./sections";
import "./metrics.css";

const RANGES = [7, 30, 90] as const;
const RANGE_KEY = "loop-metrics-range";

function initialRange(): number {
  try {
    const v = Number(window.localStorage.getItem(RANGE_KEY));
    return (RANGES as readonly number[]).includes(v) ? v : 30;
  } catch {
    return 30;
  }
}

function HistoryNote({ m }: { m: LoopMetrics }) {
  if (m.history.since !== null && m.history.since <= m.since) return null;
  return (
    <div
      className="flex items-start gap-2 rounded-lg border px-3 py-2 text-xs"
      style={{ borderColor: "var(--th-border)", color: "var(--th-text-secondary)" }}
      role="note"
    >
      <PixelIcon name="info" size={16} />
      <span>
        {m.history.since === null
          ? "Phase history is collecting from the next patrol tick."
          : `Phase history collecting since ${fmtDate(m.history.since)}.`}{" "}
        Time to green, time to merge, waiting time and check flips only cover PRs seen after that; spend, runs,
        findings, verdicts and merges include earlier data.
      </span>
    </div>
  );
}

function DailyCharts({ m }: { m: LoopMetrics }) {
  const days = m.daily.map((d) => d.start);
  const table = (cols: string[], pick: (d: LoopMetrics["daily"][number]) => Array<string | number>) => ({
    columns: ["Day", ...cols],
    rows: m.daily.map((d) => [fmtDay(d.start), ...pick(d)]),
  });
  return (
    <>
      <div className="grid gap-3 lg:grid-cols-2">
        <ChartCard
          title="Daily agent spend"
          subtitle={`${fmtUsd(m.kpis.spendUsd)} in ${m.days} days`}
          table={table(["Spend"], (d) => [fmtUsd(d.spendUsd)])}
        >
          <ColumnChart
            label="Daily agent spend in US dollars"
            days={days}
            series={[{ name: "Spend", color: "var(--lm-s1)", values: m.daily.map((d) => d.spendUsd) }]}
            format={fmtUsd}
          />
        </ChartCard>
        <ChartCard
          title="Daily agent runs"
          subtitle={`${m.kpis.runs} runs in ${m.days} days`}
          table={table(["Runs"], (d) => [d.runs])}
        >
          <ColumnChart
            label="Daily agent runs"
            days={days}
            series={[{ name: "Runs", color: "var(--lm-s1)", values: m.daily.map((d) => d.runs) }]}
            format={fmtCount}
            integer
          />
        </ChartCard>
      </div>
      <ChartCard
        title="PRs ready and merged per day"
        subtitle="Ready: Gate declared the PR ready. Merged: the PR left the loop merged."
        table={table(["Ready", "Merged"], (d) => [d.prsReady, d.prsMerged])}
      >
        <div className="mb-2">
          <Legend
            items={[
              { label: "Ready", color: "var(--lm-s1)", detail: String(m.daily.reduce((s, d) => s + d.prsReady, 0)) },
              { label: "Merged", color: "var(--lm-s2)", detail: String(m.daily.reduce((s, d) => s + d.prsMerged, 0)) },
            ]}
          />
        </div>
        <ColumnChart
          label="PRs ready and merged per day"
          days={days}
          series={[
            { name: "Ready", color: "var(--lm-s1)", values: m.daily.map((d) => d.prsReady) },
            { name: "Merged", color: "var(--lm-s2)", values: m.daily.map((d) => d.prsMerged) },
          ]}
          format={fmtCount}
          integer
          height={150}
        />
      </ChartCard>
    </>
  );
}

/** Loop metrics: speed, cost and outcomes of the PR auto-fix loop. Self-contained; mounted by the app shell. */
export default function MetricsPage() {
  const [days, setDays] = useState<number>(initialRange);
  const fetcher = useCallback(() => getLoopMetrics(days), [days]);
  const { data, error, loading } = usePolling(fetcher, 60_000, [fetcher]);
  const stale = loading || (data !== null && data.days !== days);

  const pick = (d: number) => {
    setDays(d);
    try {
      window.localStorage.setItem(RANGE_KEY, String(d));
    } catch {
      // storage unavailable: the range just is not remembered
    }
  };

  return (
    <div
      className="lm-root h-full w-full overflow-y-auto px-4 py-4 sm:px-6"
      style={{ color: "var(--th-text-primary)" }}
    >
      <div className="mx-auto flex max-w-7xl flex-col gap-4">
        <header className="flex flex-wrap items-center gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <PixelIcon name="chart" size={32} />
            <div className="min-w-0">
              <h1 className="text-lg font-semibold" style={{ color: "var(--th-text-heading)" }}>
                Loop metrics
              </h1>
              <p className="text-xs" style={{ color: "var(--th-text-muted)" }}>
                How the PR auto-fix loop performs: speed, cost and what the agents' runs end in.
              </p>
            </div>
          </div>
          <div
            role="radiogroup"
            aria-label="Range"
            className="flex rounded-lg border p-0.5"
            style={{ borderColor: "var(--th-border)" }}
          >
            {RANGES.map((r) => (
              <button
                key={r}
                type="button"
                role="radio"
                aria-checked={days === r}
                onClick={() => pick(r)}
                className="rounded-md px-3 py-1 text-xs font-medium transition"
                style={{
                  background: days === r ? "var(--th-card-bg-hover)" : "transparent",
                  color: days === r ? "var(--th-text-heading)" : "var(--th-text-secondary)",
                  boxShadow: days === r ? "inset 0 0 0 1px var(--th-border-strong)" : undefined,
                }}
              >
                {r} days
              </button>
            ))}
          </div>
        </header>

        {error && (
          <div
            className="flex items-center gap-2 rounded-lg border px-3 py-2 text-xs"
            style={{ borderColor: "var(--th-danger-border)", color: "var(--th-text-primary)" }}
            role="alert"
          >
            <PixelIcon name="error" size={16} />
            Could not load metrics: {error}
          </div>
        )}

        {!data && !error && (
          <p className="py-16 text-center text-sm" style={{ color: "var(--th-text-muted)" }}>
            Loading metrics
          </p>
        )}

        {data && (
          <div
            className="flex flex-col gap-4 transition-opacity"
            style={{ opacity: stale ? 0.55 : 1 }}
            aria-busy={stale}
          >
            <HistoryNote m={data} />
            <KpiRow m={data} />
            <DailyCharts m={data} />
            <div className="grid gap-3 lg:grid-cols-2">
              <WaitingCard m={data} />
              <FindingsCard m={data} />
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
              <CiCard m={data} />
              <OutcomesCard m={data} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
