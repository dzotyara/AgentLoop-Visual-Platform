import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LoopMetrics } from "../../api";
import MetricsPage from "./MetricsPage";
import { fmtDuration, fmtUsd, niceTicks } from "./format";

const apiMocks = vi.hoisted(() => ({ getLoopMetrics: vi.fn() }));
vi.mock("../../api", () => ({ getLoopMetrics: apiMocks.getLoopMetrics }));

const DAY = 86_400_000;
const NOW = new Date(2026, 9, 27, 12).getTime();

function metrics(days: number, over: Partial<LoopMetrics> = {}): LoopMetrics {
  const since = NOW - (days - 1) * DAY;
  return {
    days,
    since,
    until: NOW,
    history: { since: NOW - 2 * DAY, needsHistory: ["timeToGreen", "timeToMerge", "waiting", "flakyChecks.flips"] },
    kpis: {
      timeToGreen: { medianMs: 3 * 3_600_000, p90Ms: 9 * 3_600_000, n: 4 },
      timeToMerge: { medianMs: 2 * DAY, p90Ms: 3 * DAY, n: 2 },
      mergedPrs: 8,
      mergedWithAgentHelp: 7,
      costPerMergedPrUsd: 3.41,
      runsPerMergedPr: 5.9,
      runsPerActivePr: 5.1,
      acceptedFindingsRate: 0.9,
      spendUsd: 108.37,
      todaySpendUsd: 16.04,
      runs: 180,
    },
    outcomes: [
      {
        action: "review",
        agent: "Argus",
        runs: 55,
        done: 51,
        failed: 3,
        running: 1,
        costUsd: 40.05,
        medianDurationMs: 74_000,
      },
    ],
    findings: { reviews: 51, bySeverity: { P0: 0, P1: 7, P2: 20, P3: 41 } },
    verdicts: [{ action: "address_feedback", accepted: 22, declined: 3, noAction: 151, blocked: 0 }],
    ci: {
      classification: { branch: 2, flaky: 1, infra: 38, unknown: 0 },
      flakyChecks: [{ name: "CI / unit shard 12", flips: 3, classifiedFlaky: 1, prs: 2, lastAt: NOW - DAY }],
    },
    waiting: [
      { on: "ci", ms: 5 * 3_600_000 },
      { on: "reviewer", ms: 0 },
      { on: "github", ms: 600_000 },
      { on: "you", ms: 2 * 3_600_000 },
      { on: "agent", ms: 0 },
      { on: "ready", ms: 3_600_000 },
    ],
    daily: Array.from({ length: days }, (_, i) => ({
      day: `d${i}`,
      start: since + i * DAY,
      spendUsd: i % 3,
      runs: i % 5,
      prsReady: i % 2,
      prsMerged: i % 4 === 0 ? 1 : 0,
    })),
    merged: [],
    ...over,
  };
}

describe("MetricsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // jsdom under this Node may not provide localStorage; the page must work with or without it.
    const mem = new Map<string, string>();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: (k: string) => mem.get(k) ?? null,
        setItem: (k: string, v: string) => void mem.set(k, v),
        removeItem: (k: string) => void mem.delete(k),
        clear: () => mem.clear(),
      },
    });
    apiMocks.getLoopMetrics.mockImplementation((days: number) => Promise.resolve(metrics(days)));
  });

  it("renders the KPI row, charts, tables and the history note", async () => {
    render(<MetricsPage />);
    expect(await screen.findByText("Time to green")).toBeInTheDocument();
    expect(apiMocks.getLoopMetrics).toHaveBeenCalledWith(30);
    expect(screen.getByText("3.0h")).toBeInTheDocument();
    expect(screen.getByText("$3.41")).toBeInTheDocument();
    expect(screen.getByText("90%")).toBeInTheDocument();
    expect(screen.getByText("$16.04")).toBeInTheDocument();
    expect(screen.getByText("7 with agent help · 2.0d to merge")).toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent(/collecting since Oct 25, 2026/);
    expect(screen.getByRole("img", { name: "Daily agent spend in US dollars" })).toBeInTheDocument();
    expect(screen.getByText("CI / unit shard 12")).toBeInTheDocument();
    expect(screen.getByText("Argus")).toBeInTheDocument();
    expect(screen.getByText("Ready, not merged")).toBeInTheDocument();
  });

  it("switches the range and shows a chart's table view", async () => {
    render(<MetricsPage />);
    await screen.findByText("Time to green");
    fireEvent.click(screen.getByRole("radio", { name: "7 days" }));
    await waitFor(() => expect(apiMocks.getLoopMetrics).toHaveBeenCalledWith(7));
    await waitFor(() => expect(screen.getByText("$108 in 7 days")).toBeInTheDocument());
    expect(window.localStorage.getItem("loop-metrics-range")).toBe("7");

    const spend = screen.getByRole("region", { name: "Daily agent spend" });
    fireEvent.click(within(spend).getByRole("button", { name: "Table" }));
    expect(within(spend).getAllByRole("row")).toHaveLength(8); // header + 7 days
  });

  it("shows a readout on focus of a day column", async () => {
    render(<MetricsPage />);
    await screen.findByText("Time to green");
    const runs = screen.getByRole("region", { name: "Daily agent runs" });
    const cols = runs.querySelectorAll("rect.lm-hit");
    expect(cols).toHaveLength(30);
    fireEvent.focus(cols[4]);
    expect(within(runs).getByRole("tooltip")).toHaveTextContent("4Runs");
  });

  it("says when there is no history yet", async () => {
    apiMocks.getLoopMetrics.mockResolvedValue(
      metrics(30, {
        history: { since: null, needsHistory: [] },
        kpis: { ...metrics(30).kpis, timeToGreen: { medianMs: null, p90Ms: null, n: 0 } },
      }),
    );
    render(<MetricsPage />);
    expect(await screen.findByText("collecting from the next tick")).toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent(/collecting from the next patrol tick/);
  });

  it("works without browser storage", async () => {
    Object.defineProperty(window, "localStorage", { configurable: true, value: undefined });
    render(<MetricsPage />);
    expect(await screen.findByText("Time to green")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "90 days" }));
    await waitFor(() => expect(apiMocks.getLoopMetrics).toHaveBeenCalledWith(90));
  });

  it("shows the error", async () => {
    apiMocks.getLoopMetrics.mockRejectedValue(new Error("unauthorized"));
    render(<MetricsPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load metrics: unauthorized");
  });
});

describe("metrics formatting", () => {
  it("formats durations, money and ticks", () => {
    expect(fmtDuration(null)).toBe("–");
    expect(fmtDuration(42_000)).toBe("42s");
    expect(fmtDuration(25 * 60_000)).toBe("25m");
    expect(fmtDuration(90 * 60_000)).toBe("1.5h");
    expect(fmtDuration(3 * 86_400_000)).toBe("3.0d");
    expect(fmtUsd(0)).toBe("$0");
    expect(fmtUsd(0.25)).toBe("$0.250");
    expect(fmtUsd(1234)).toBe("$1.2K");
    expect(niceTicks(10)).toEqual([0, 5, 10]);
    expect(niceTicks(2, 4, true)).toEqual([0, 1, 2]);
    expect(niceTicks(0)).toEqual([0, 1]);
  });
});
