import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { ensureClaudeCostSchema } from "../claude-costs/index.ts";
import {
  computeLoopMetrics,
  distribution,
  parseDays,
  prTimelines,
  registerMetricsRoutes,
  waitingTime,
  type EventRow,
  type MetricsInput,
  type RunRow,
} from "./metrics.ts";
import { createPrPatrolStore, ensurePrPatrolSchema, FIRST_SEEN_SUMMARY } from "./store.ts";

const H = 3_600_000;
// Noon local time, so day buckets do not depend on the test machine's time zone.
const NOW = new Date(2026, 9, 20, 12, 0, 0).getTime();

const ev = (pr_key: string, at: number, phase: string, waiting_on: string | null = null, summary = ""): EventRow => ({
  pr_key,
  phase,
  waiting_on,
  summary,
  head_sha: "h1",
  at,
});

const run = (over: Partial<RunRow> & Pick<RunRow, "task_id" | "pr_key" | "action">): RunRow => ({
  status: "done",
  agent: "Argus",
  started_at: NOW - 2 * H,
  completed_at: NOW - 2 * H + 60_000,
  created_at: NOW - 2 * H,
  cost_usd: 0,
  cost_at: null,
  ...over,
});

const emptyInput = (): MetricsInput => ({
  events: [],
  prs: [],
  runs: [],
  actions: [],
  flips: [],
  results: new Map(),
});

describe("pr-patrol history store", () => {
  it("writes a first-seen event and one event per phase / waiting_on change, not per tick", () => {
    const db = new DatabaseSync(":memory:");
    ensurePrPatrolSchema(db);
    let t = 1000;
    const store = createPrPatrolStore(db, () => t);
    const pr = { pr_key: "o/r#1", repo: "o/r", number: 1, title: "x", url: "u", head_sha: "aaa" };
    store.upsertPr(pr);
    store.upsertPr(pr); // second tick: no new first-seen
    t = 2000;
    store.setPhase("o/r#1", "waiting", "CI running", [], "ci");
    t = 3000;
    store.setPhase("o/r#1", "waiting", "CI running (2 checks)", [], "ci"); // same phase + waiting_on
    t = 4000;
    store.setPhase("o/r#1", "waiting", "reviewer", [], "reviewer"); // waiting_on changed
    t = 5000;
    store.setPhase("o/r#1", "ready", "green");
    const rows = db.prepare("SELECT phase, waiting_on, summary, head_sha, at FROM pr_patrol_events ORDER BY id").all();
    expect(rows).toEqual([
      { phase: "watching", waiting_on: null, summary: FIRST_SEEN_SUMMARY, head_sha: "aaa", at: 1000 },
      { phase: "waiting", waiting_on: "ci", summary: "CI running", head_sha: "aaa", at: 2000 },
      { phase: "waiting", waiting_on: "reviewer", summary: "reviewer", head_sha: "aaa", at: 4000 },
      { phase: "ready", waiting_on: null, summary: "green", head_sha: "aaa", at: 5000 },
    ]);
  });

  it("records a check that failed and later passed on the same head", () => {
    const db = new DatabaseSync(":memory:");
    ensurePrPatrolSchema(db);
    let t = 1000;
    const store = createPrPatrolStore(db, () => t);
    store.upsertPr({ pr_key: "o/r#1", repo: "o/r", number: 1, title: "x", url: "u", head_sha: "aaa" });
    const snap = (state: string) => ({
      checks: [
        { name: "test", workflow: "CI", state },
        { name: "gate", workflow: null, state: "failure", ignored: true },
      ],
    });
    store.setSnapshot("o/r#1", snap("failure"));
    t = 2000;
    store.setSnapshot("o/r#1", snap("failure"));
    t = 3000;
    store.setSnapshot("o/r#1", snap("success"));
    t = 4000;
    store.setSnapshot("o/r#1", snap("success"));
    expect(db.prepare("SELECT head_sha, name, failed_at, passed_at FROM pr_patrol_check_flips").all()).toEqual([
      { head_sha: "aaa", name: "CI / test", failed_at: 1000, passed_at: 3000 },
    ]);
  });
});

describe("loop metric helpers", () => {
  it("computes median and p90", () => {
    expect(distribution([])).toEqual({ medianMs: null, p90Ms: null, n: 0 });
    const d = distribution([10, 1, 5, 3, 7, 9, 2, 4, 6, 8]);
    expect(d.medianMs).toBe(5.5);
    expect(d.p90Ms).toBeCloseTo(9.1);
    expect(d.n).toBe(10);
  });

  it("clamps the days parameter", () => {
    expect(parseDays(undefined)).toBe(30);
    expect(parseDays("7")).toBe(7);
    expect(parseDays("0")).toBe(30);
    expect(parseDays("9999")).toBe(365);
    expect(parseDays("abc")).toBe(30);
  });

  it("derives first seen, first ready and merge from events, with a row backfill for old merges", () => {
    const t = prTimelines(
      [
        ev("a", 100, "watching", null, FIRST_SEEN_SUMMARY),
        ev("a", 200, "ready"),
        ev("a", 300, "merging", "github"),
        ev("a", 400, "skipped", null, "no longer open / not patrolled"),
        ev("b", 150, "waiting", "ci"), // first seen before history began
        ev("b", 250, "skipped", null, "PR is closed"),
      ],
      [{ pr_key: "old", phase: "skipped", summary: "PR is merged", updated_at: 50 }],
    );
    expect(t.get("a")).toEqual({ firstSeenAt: 100, firstReadyAt: 200, mergedAt: 400 });
    expect(t.get("b")).toEqual({ firstSeenAt: null, firstReadyAt: null, mergedAt: null });
    expect(t.get("old")).toEqual({ firstSeenAt: null, firstReadyAt: null, mergedAt: 50 });
  });

  it("splits waiting time by waiting_on and clips it to the range", () => {
    const w = waitingTime(
      [
        ev("a", 0, "waiting", "ci"),
        ev("a", 10, "working"),
        ev("a", 20, "blocked", "you"),
        ev("a", 50, "ready"),
        ev("a", 70, "skipped", null, "PR is merged"),
        ev("b", 60, "watching", "agent"),
      ],
      5,
      100,
    );
    expect(Object.fromEntries(w)).toEqual({ ci: 5, reviewer: 0, github: 0, base: 0, retry: 0, you: 30, agent: 40, ready: 20 });
  });
});

describe("computeLoopMetrics", () => {
  it("aggregates time to green, merges, cost, outcomes, findings, verdicts, CI and daily series", () => {
    const input = emptyInput();
    input.events = [
      ev("o/r#1", NOW - 30 * H, "watching", null, FIRST_SEEN_SUMMARY),
      ev("o/r#1", NOW - 29 * H, "working"),
      ev("o/r#1", NOW - 26 * H, "ready"),
      ev("o/r#1", NOW - 3 * H, "skipped", null, "PR is merged"),
      ev("o/r#2", NOW - 10 * H, "watching", null, FIRST_SEEN_SUMMARY),
      ev("o/r#2", NOW - 8 * H, "ready"),
    ];
    input.prs = [{ pr_key: "o/r#1", phase: "skipped", summary: "PR is merged", updated_at: NOW - 3 * H }];
    input.runs = [
      run({ task_id: "rv1", pr_key: "o/r#1", action: "review", cost_usd: 1.5, cost_at: NOW - 2 * H }),
      run({ task_id: "fr1", pr_key: "o/r#1", action: "fix_review", agent: "Patch", cost_usd: 0.5 }),
      run({ task_id: "fb1", pr_key: "o/r#1", action: "address_feedback", agent: "Patch", status: "cancelled" }),
      run({ task_id: "fb2", pr_key: "o/r#2", action: "address_feedback", agent: "Patch", cost_usd: 1 }),
      run({ task_id: "ci1", pr_key: "o/r#2", action: "fix_ci", agent: "Medic", cost_usd: 2 }),
      run({ task_id: "ci2", pr_key: "o/r#2", action: "fix_ci", agent: "Medic" }),
      run({ task_id: "g1", pr_key: "o/r#2", action: "ready", agent: "Gate", created_at: NOW - 8 * H }),
      // outside a 7-day range
      run({
        task_id: "old",
        pr_key: "o/r#3",
        action: "review",
        started_at: NOW - 20 * 24 * H,
        completed_at: NOW - 20 * 24 * H,
        cost_usd: 9,
      }),
    ];
    input.actions = [
      { pr_key: "o/r#2", action_key: "ci:h1", action: "fix_ci", task_id: "ci1" },
      { pr_key: "o/r#2", action_key: "ci:h0", action: "fix_ci", task_id: "ci2" },
    ];
    input.results = new Map<string, unknown>([
      ["rv1", { findings: [{ severity: "P1" }, { severity: "high" }, { severity: "P3" }, { severity: "low" }] }],
      ["fr1", { items: [{ verdict: "fixed" }, { verdict: "declined" }] }],
      ["fb2", { items: [{ verdict: "fixed-differently" }, { verdict: "no_action" }, { verdict: "blocked" }] }],
      ["ci1", { classification: "flaky" }],
    ]);
    input.flips = [
      { pr_key: "o/r#2", head_sha: "h1", name: "CI / test", failed_at: NOW - 5 * H, passed_at: NOW - 4 * H },
      { pr_key: "o/r#2", head_sha: "h1", name: "CI / lint", failed_at: NOW - 5 * H, passed_at: null },
      { pr_key: "o/r#4", head_sha: "x", name: "CI / test", failed_at: NOW - 6 * H, passed_at: NOW - 5 * H },
    ];
    const notes = new Map([["ci2", "infra failure; re-ran failed jobs of 1 run(s)."]]);

    const m = computeLoopMetrics(input, { now: NOW, days: 7, notes });

    expect(m.history.since).toBe(NOW - 30 * H);
    expect(m.kpis.timeToGreen).toEqual({ medianMs: 3 * H, p90Ms: expect.any(Number), n: 2 });
    expect(m.kpis.timeToMerge).toEqual({ medianMs: 27 * H, p90Ms: 27 * H, n: 1 });
    expect(m.kpis.mergedPrs).toBe(1);
    expect(m.kpis.mergedWithAgentHelp).toBe(1);
    expect(m.kpis.costPerMergedPrUsd).toBeCloseTo(2);
    expect(m.kpis.runsPerMergedPr).toBe(3);
    expect(m.kpis.runs).toBe(6);
    expect(m.kpis.runsPerActivePr).toBe(3);
    expect(m.kpis.spendUsd).toBeCloseTo(5);
    expect(m.kpis.todaySpendUsd).toBeCloseTo(5);
    // accepted: fixed + fixed-differently = 2; declined: 1
    expect(m.kpis.acceptedFindingsRate).toBeCloseTo(2 / 3);

    expect(m.findings).toEqual({ reviews: 1, bySeverity: { P0: 0, P1: 2, P2: 0, P3: 2 } });
    expect(m.verdicts).toEqual([
      { action: "fix_review", accepted: 1, declined: 1, noAction: 0, blocked: 0 },
      { action: "address_feedback", accepted: 1, declined: 0, noAction: 1, blocked: 1 },
    ]);
    expect(m.ci.classification).toEqual({ branch: 0, flaky: 1, infra: 1, unknown: 0 });
    expect(m.ci.flakyChecks).toEqual([
      { name: "CI / test", flips: 2, classifiedFlaky: 1, prs: 2, lastAt: NOW - 4 * H },
      { name: "CI / lint", flips: 0, classifiedFlaky: 1, prs: 1, lastAt: NOW - 5 * H },
    ]);

    const patch = m.outcomes.find((o) => o.agent === "Patch" && o.action === "address_feedback");
    expect(patch).toMatchObject({ runs: 2, done: 1, failed: 1, running: 0, costUsd: 1, medianDurationMs: 60_000 });
    expect(m.outcomes.some((o) => o.action === "ready")).toBe(false);

    expect(m.daily).toHaveLength(7);
    const today = m.daily[m.daily.length - 1];
    expect(today).toMatchObject({ runs: 6, prsReady: 1, prsMerged: 1 });
    expect(today.spendUsd).toBeCloseTo(5);
    const yesterday = m.daily[m.daily.length - 2];
    expect(yesterday.prsReady).toBe(1); // o/r#1 got ready yesterday (26h ago)

    expect(m.waiting.find((w) => w.on === "ready")?.ms).toBe(23 * H + 8 * H);
  });

  it("returns empty metrics without data", () => {
    const m = computeLoopMetrics(emptyInput(), { now: NOW, days: 30 });
    expect(m.history.since).toBeNull();
    expect(m.kpis.costPerMergedPrUsd).toBeNull();
    expect(m.kpis.acceptedFindingsRate).toBeNull();
    expect(m.daily).toHaveLength(30);
    expect(m.outcomes).toEqual([]);
  });
});

describe("GET /api/pr-patrol/metrics", () => {
  it("loads tasks, costs and result JSONs from the database", () => {
    const db = new DatabaseSync(":memory:");
    ensurePrPatrolSchema(db);
    ensureClaudeCostSchema(db);
    db.exec(`CREATE TABLE agents (id TEXT PRIMARY KEY, name TEXT);
      CREATE TABLE tasks (id TEXT PRIMARY KEY, workflow_meta_json TEXT, status TEXT, assigned_agent_id TEXT,
        started_at INTEGER, completed_at INTEGER, created_at INTEGER);
      INSERT INTO agents VALUES ('ag1', 'Argus');`);
    const meta = (action: string) => JSON.stringify({ source: "pr-patrol", pr: "o/r#1", action });
    db.prepare("INSERT INTO tasks VALUES (?, ?, ?, ?, ?, ?, ?)").run(
      "t1",
      meta("review"),
      "done",
      "ag1",
      NOW - H,
      NOW - H + 1000,
      NOW - H,
    );
    db.prepare("INSERT INTO tasks VALUES (?, ?, ?, ?, ?, ?, ?)").run("t2", "{}", "done", "ag1", NOW, NOW, NOW);
    db.prepare("INSERT INTO claude_costs (run_key, task_id, cost_usd, created_at) VALUES (?, ?, ?, ?)").run(
      "k1",
      "t1",
      0.75,
      NOW - H + 1000,
    );
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-"));
    fs.writeFileSync(path.join(dir, "t1.json"), JSON.stringify({ findings: [{ severity: "P0" }] }));

    const routes = new Map<
      string,
      (req: { query?: Record<string, unknown> }, res: { json(v: unknown): void }) => void
    >();
    registerMetricsRoutes({ get: (p, h) => routes.set(p, h) }, db, dir, () => NOW);
    let body: any = null;
    routes.get("/api/pr-patrol/metrics")!({ query: { days: "7" } }, { json: (v) => (body = v) });

    expect(body.days).toBe(7);
    expect(body.kpis.runs).toBe(1);
    expect(body.kpis.spendUsd).toBeCloseTo(0.75);
    expect(body.findings.bySeverity.P0).toBe(1);
    expect(body.outcomes).toEqual([
      expect.objectContaining({ agent: "Argus", action: "review", runs: 1, done: 1, costUsd: 0.75 }),
    ]);
    expect(body.history.since).toBeNull();
  });
});
