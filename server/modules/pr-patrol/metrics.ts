import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { normalizeSeverity } from "./review-comment.ts";
import { FIRST_SEEN_SUMMARY } from "./store.ts";

/**
 * Loop metrics: how fast PRs get green and merged, what the agents cost, how their runs end, and where PRs
 * wait. Pure aggregation over plain rows (computeLoopMetrics) plus a loader and the
 * GET /api/pr-patrol/metrics route. Everything that needs phase history (time to green / merge, waiting
 * time, check flips) only counts what happened since pr_patrol_events started filling: see `history`.
 */

const DAY_MS = 86_400_000;
const PATROL_SOURCE_LIKE = '%"source":"pr-patrol"%';

export type EventRow = {
  pr_key: string;
  phase: string;
  waiting_on: string | null;
  summary: string;
  head_sha: string;
  at: number;
};

export type PrStateRow = { pr_key: string; phase: string; summary: string; updated_at: number };

/** One pr-patrol kanban task: an agent run, or a Gate "ready" notice (action "ready"). */
export type RunRow = {
  task_id: string;
  pr_key: string;
  action: string;
  status: string; // tasks.status: in_progress | done | cancelled
  agent: string | null;
  started_at: number | null;
  completed_at: number | null;
  created_at: number;
  cost_usd: number;
  /** created_at of the run's cost rows (Claude Code result events); spend is dated by them. */
  cost_at: number | null;
};

export type ActionStateRow = { pr_key: string; action_key: string; action: string; task_id: string | null };

export type CheckFlipRow = {
  pr_key: string;
  head_sha: string;
  name: string;
  failed_at: number;
  passed_at: number | null;
};

export type MetricsInput = {
  events: EventRow[];
  prs: PrStateRow[];
  runs: RunRow[];
  actions: ActionStateRow[];
  flips: CheckFlipRow[];
  /** Agents' result JSONs by task id (~/.pr-loop/results/<taskId>.json); missing files are simply absent. */
  results: Map<string, unknown>;
};

export type Distribution = { medianMs: number | null; p90Ms: number | null; n: number };

export const WAIT_BUCKETS = ["ci", "reviewer", "github", "you", "agent", "ready"] as const;
export type WaitBucket = (typeof WAIT_BUCKETS)[number];

export type LoopMetrics = {
  days: number;
  since: number;
  until: number;
  /** First recorded phase event; null while there is none. Metrics in `needsHistory` only cover time after it. */
  history: { since: number | null; needsHistory: string[] };
  kpis: {
    timeToGreen: Distribution;
    timeToMerge: Distribution;
    mergedPrs: number;
    mergedWithAgentHelp: number;
    costPerMergedPrUsd: number | null;
    runsPerMergedPr: number | null;
    runsPerActivePr: number | null;
    acceptedFindingsRate: number | null;
    spendUsd: number;
    todaySpendUsd: number;
    runs: number;
  };
  /** Per agent + action, runs started in range. */
  outcomes: Array<{
    action: string;
    agent: string;
    runs: number;
    done: number;
    failed: number;
    running: number;
    costUsd: number;
    medianDurationMs: number | null;
  }>;
  findings: { reviews: number; bySeverity: Record<"P0" | "P1" | "P2" | "P3", number> };
  verdicts: Array<{ action: string; accepted: number; declined: number; noAction: number; blocked: number }>;
  ci: {
    classification: Record<"branch" | "flaky" | "infra" | "unknown", number>;
    flakyChecks: Array<{ name: string; flips: number; classifiedFlaky: number; prs: number; lastAt: number }>;
  };
  waiting: Array<{ on: WaitBucket; ms: number }>;
  daily: Array<{ day: string; start: number; spendUsd: number; runs: number; prsReady: number; prsMerged: number }>;
  merged: Array<{
    prKey: string;
    mergedAt: number;
    runs: number;
    costUsd: number;
    timeToGreenMs: number | null;
    timeToMergeMs: number | null;
  }>;
};

export function quantile(sorted: number[], q: number): number | null {
  if (sorted.length === 0) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function distribution(values: number[]): Distribution {
  const sorted = [...values].sort((a, b) => a - b);
  return { medianMs: quantile(sorted, 0.5), p90Ms: quantile(sorted, 0.9), n: sorted.length };
}

/** Local-time day key, YYYY-MM-DD. */
export function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

const isMergedSummary = (summary: string) => /\bmerged\b/i.test(summary);
const NOT_OPEN = /no longer open/i;

type PrTimeline = { firstSeenAt: number | null; firstReadyAt: number | null; mergedAt: number | null };

/**
 * Per PR: first seen, first ready after that, merged. A merge is a skip whose summary says "merged", or a PR
 * that left the open-PR search straight out of the merge queue (merging -> "no longer open").
 */
export function prTimelines(events: EventRow[], prs: PrStateRow[]): Map<string, PrTimeline> {
  const byPr = new Map<string, EventRow[]>();
  for (const e of [...events].sort((a, b) => a.at - b.at)) {
    const list = byPr.get(e.pr_key) ?? [];
    list.push(e);
    byPr.set(e.pr_key, list);
  }
  const out = new Map<string, PrTimeline>();
  for (const [key, list] of byPr) {
    const t: PrTimeline = { firstSeenAt: null, firstReadyAt: null, mergedAt: null };
    if (list[0].summary === FIRST_SEEN_SUMMARY) t.firstSeenAt = list[0].at;
    let prevPhase: string | null = null;
    for (const e of list) {
      if (e.phase === "ready" && t.firstReadyAt === null) t.firstReadyAt = e.at;
      if (
        e.phase === "skipped" &&
        t.mergedAt === null &&
        (isMergedSummary(e.summary) || (prevPhase === "merging" && NOT_OPEN.test(e.summary)))
      )
        t.mergedAt = e.at;
      prevPhase = e.phase;
    }
    out.set(key, t);
  }
  // Backfill: PRs merged before the event table existed still count as merged (no durations for them).
  for (const p of prs) {
    if (p.phase !== "skipped" || !isMergedSummary(p.summary)) continue;
    const t = out.get(p.pr_key) ?? { firstSeenAt: null, firstReadyAt: null, mergedAt: null };
    if (t.mergedAt === null) t.mergedAt = p.updated_at;
    out.set(p.pr_key, t);
  }
  return out;
}

/**
 * Time per waiting_on bucket, clipped to [since, until]. A segment runs from one event to the next (the last
 * one to `until`); "ready" is time spent ready but not merged. Working and skipped time is not waiting.
 */
export function waitingTime(events: EventRow[], since: number, until: number): Map<WaitBucket, number> {
  const totals = new Map<WaitBucket, number>(WAIT_BUCKETS.map((b) => [b, 0]));
  const byPr = new Map<string, EventRow[]>();
  for (const e of [...events].sort((a, b) => a.at - b.at)) {
    const list = byPr.get(e.pr_key) ?? [];
    list.push(e);
    byPr.set(e.pr_key, list);
  }
  for (const list of byPr.values()) {
    list.forEach((e, i) => {
      const bucket: WaitBucket | null =
        e.phase === "ready"
          ? "ready"
          : e.phase === "working" || e.phase === "skipped"
            ? null
            : (WAIT_BUCKETS as readonly string[]).includes(e.waiting_on ?? "")
              ? (e.waiting_on as WaitBucket)
              : null;
      if (!bucket) return;
      const start = Math.max(e.at, since);
      const end = Math.min(i + 1 < list.length ? list[i + 1].at : until, until);
      if (end > start) totals.set(bucket, (totals.get(bucket) ?? 0) + (end - start));
    });
  }
  return totals;
}

type Verdict = "accepted" | "declined" | "noAction" | "blocked";
function verdictOf(raw: unknown): Verdict | null {
  const v = String(raw ?? "").toLowerCase();
  if (v === "fixed" || v === "fixed-differently") return "accepted";
  if (v === "declined") return "declined";
  if (v === "no_action") return "noAction";
  if (v === "blocked") return "blocked";
  return null;
}

/** fix_ci classification from the result JSON, else from the settle note ("infra failure; ..."). */
function ciClassification(result: unknown, note: string | null): "branch" | "flaky" | "infra" | "unknown" | null {
  const c = (result as { classification?: unknown } | null)?.classification;
  if (c === "branch" || c === "flaky" || c === "infra" || c === "unknown") return c;
  const m = note?.match(/^(flaky|infra) failure/);
  return m ? (m[1] as "flaky" | "infra") : null;
}

export function computeLoopMetrics(
  input: MetricsInput,
  opts: { now: number; days: number; notes?: Map<string, string> },
): LoopMetrics {
  const { now, days } = opts;
  // The last `days` calendar days, today included (local time).
  const n = new Date(now);
  const since = new Date(n.getFullYear(), n.getMonth(), n.getDate() - (days - 1)).getTime();
  const inRange = (t: number | null | undefined) => typeof t === "number" && t >= since && t <= now;
  const agentRuns = input.runs.filter((r) => r.action !== "ready");
  const runStart = (r: RunRow) => r.started_at ?? r.created_at;
  const runsInRange = agentRuns.filter((r) => inRange(runStart(r)));

  // ── PR timelines, merges, cost per merged PR
  const timelines = prTimelines(input.events, input.prs);
  const runsByPr = new Map<string, RunRow[]>();
  for (const r of agentRuns) runsByPr.set(r.pr_key, [...(runsByPr.get(r.pr_key) ?? []), r]);

  const merged: LoopMetrics["merged"] = [];
  const toGreen: number[] = [];
  const toMerge: number[] = [];
  for (const [prKey, t] of timelines) {
    if (t.firstSeenAt !== null && t.firstReadyAt !== null && inRange(t.firstReadyAt))
      toGreen.push(t.firstReadyAt - t.firstSeenAt);
    if (t.mergedAt === null || !inRange(t.mergedAt)) continue;
    const runs = runsByPr.get(prKey) ?? [];
    const timeToMergeMs = t.firstSeenAt !== null ? t.mergedAt - t.firstSeenAt : null;
    if (timeToMergeMs !== null) toMerge.push(timeToMergeMs);
    merged.push({
      prKey,
      mergedAt: t.mergedAt,
      runs: runs.length,
      costUsd: runs.reduce((s, r) => s + r.cost_usd, 0),
      timeToGreenMs: t.firstSeenAt !== null && t.firstReadyAt !== null ? t.firstReadyAt - t.firstSeenAt : null,
      timeToMergeMs,
    });
  }
  merged.sort((a, b) => b.mergedAt - a.mergedAt);
  const mergedWithHelp = merged.filter((m) => m.runs > 0);
  const activePrs = new Set(runsInRange.map((r) => r.pr_key));

  // ── Spend (pr-patrol runs only), dated by their cost rows
  const spendAt = (r: RunRow) => r.cost_at ?? r.completed_at ?? runStart(r);
  const spendRuns = agentRuns.filter((r) => r.cost_usd > 0 && inRange(spendAt(r)));
  const today0 = startOfDay(now);

  // ── Outcomes per agent + action
  const outcomeMap = new Map<string, LoopMetrics["outcomes"][number] & { durations: number[] }>();
  for (const r of runsInRange) {
    const agent = r.agent ?? "?";
    const k = `${agent}\u0000${r.action}`;
    const o = outcomeMap.get(k) ?? {
      action: r.action,
      agent,
      runs: 0,
      done: 0,
      failed: 0,
      running: 0,
      costUsd: 0,
      medianDurationMs: null,
      durations: [],
    };
    o.runs++;
    if (r.status === "done") o.done++;
    else if (r.status === "in_progress") o.running++;
    else o.failed++;
    o.costUsd += r.cost_usd;
    if (r.started_at && r.completed_at && r.completed_at >= r.started_at)
      o.durations.push(r.completed_at - r.started_at);
    outcomeMap.set(k, o);
  }
  const outcomes = [...outcomeMap.values()]
    .map(({ durations, ...o }) => ({ ...o, medianDurationMs: distribution(durations).medianMs }))
    .sort((a, b) => b.runs - a.runs);

  // ── Result JSONs: findings, verdicts, CI classification
  const bySeverity = { P0: 0, P1: 0, P2: 0, P3: 0 };
  let reviews = 0;
  const verdictMap = new Map<string, Record<Verdict, number>>();
  const classification = { branch: 0, flaky: 0, infra: 0, unknown: 0 };
  /** Heads whose CI failure an agent classified flaky/infra: pr_key + head. */
  const flakyHeads = new Set<string>();
  const headOfTask = new Map<string, string>();
  for (const a of input.actions) {
    // keys are ci:<head> (older) or ci:<head>:<failed-jobs hash>
    if (a.task_id && a.action_key.startsWith("ci:")) headOfTask.set(a.task_id, a.action_key.split(":")[1]);
  }
  for (const r of runsInRange) {
    if (r.status !== "done") continue;
    const result = input.results.get(r.task_id) ?? null;
    if (r.action === "review" && result) {
      reviews++;
      const findings = (result as { findings?: unknown }).findings;
      for (const f of Array.isArray(findings) ? findings : [])
        bySeverity[normalizeSeverity((f as { severity?: unknown })?.severity)]++;
    } else if ((r.action === "fix_review" || r.action === "address_feedback") && result) {
      const v = verdictMap.get(r.action) ?? { accepted: 0, declined: 0, noAction: 0, blocked: 0 };
      const items = (result as { items?: unknown }).items;
      for (const i of Array.isArray(items) ? items : []) {
        const verdict = verdictOf((i as { verdict?: unknown })?.verdict);
        if (verdict) v[verdict]++;
      }
      verdictMap.set(r.action, v);
    } else if (r.action === "fix_ci") {
      const c = ciClassification(result, opts.notes?.get(r.task_id) ?? null);
      if (!c) continue;
      classification[c]++;
      const head = headOfTask.get(r.task_id);
      if ((c === "flaky" || c === "infra") && head) flakyHeads.add(`${r.pr_key}\u0000${head}`);
    }
  }
  const verdicts = ["fix_review", "address_feedback"]
    .filter((a) => verdictMap.has(a))
    .map((action) => ({ action, ...verdictMap.get(action)! }));
  const accepted = verdicts.reduce((s, v) => s + v.accepted, 0);
  const declined = verdicts.reduce((s, v) => s + v.declined, 0);

  // ── Flaky checks: failed then passed on the same head, or failed on a head classified flaky/infra
  const flaky = new Map<
    string,
    { name: string; flips: number; classifiedFlaky: number; prs: Set<string>; lastAt: number }
  >();
  for (const f of input.flips) {
    const flipped = f.passed_at !== null && inRange(f.passed_at);
    const classified = flakyHeads.has(`${f.pr_key}\u0000${f.head_sha}`) && inRange(f.failed_at);
    if (!flipped && !classified) continue;
    const e = flaky.get(f.name) ?? { name: f.name, flips: 0, classifiedFlaky: 0, prs: new Set(), lastAt: 0 };
    if (flipped) e.flips++;
    if (classified) e.classifiedFlaky++;
    e.prs.add(f.pr_key);
    e.lastAt = Math.max(e.lastAt, f.passed_at ?? f.failed_at);
    flaky.set(f.name, e);
  }
  const flakyChecks = [...flaky.values()]
    .map(({ prs, ...e }) => ({ ...e, prs: prs.size }))
    .sort((a, b) => b.flips + b.classifiedFlaky - (a.flips + a.classifiedFlaky) || b.lastAt - a.lastAt)
    .slice(0, 20);

  // ── Waiting time
  const wait = waitingTime(input.events, since, now);
  const waiting = WAIT_BUCKETS.map((on) => ({ on, ms: wait.get(on) ?? 0 }));

  // ── Daily series
  const daily: LoopMetrics["daily"] = [];
  const dayIndex = new Map<string, number>();
  for (let d = since; d <= now; d = startOfDay(d + DAY_MS + 3_600_000)) {
    dayIndex.set(dayKey(d), daily.length);
    daily.push({ day: dayKey(d), start: d, spendUsd: 0, runs: 0, prsReady: 0, prsMerged: 0 });
  }
  const bump = (t: number, f: (row: LoopMetrics["daily"][number]) => void) => {
    const i = dayIndex.get(dayKey(t));
    if (i !== undefined && inRange(t)) f(daily[i]);
  };
  for (const r of spendRuns) bump(spendAt(r), (row) => (row.spendUsd += r.cost_usd));
  for (const r of runsInRange) bump(runStart(r), (row) => row.runs++);
  for (const m of merged) bump(m.mergedAt, (row) => row.prsMerged++);
  // Ready: phase events, plus Gate's "ready" tasks (they predate the event table). One count per PR per day.
  const readySeen = new Set<string>();
  const readyAt = [
    ...input.events.filter((e) => e.phase === "ready").map((e) => ({ pr: e.pr_key, at: e.at })),
    ...input.runs.filter((r) => r.action === "ready").map((r) => ({ pr: r.pr_key, at: r.created_at })),
  ];
  for (const { pr, at } of readyAt) {
    const k = `${pr}\u0000${dayKey(at)}`;
    if (readySeen.has(k) || !inRange(at)) continue;
    readySeen.add(k);
    bump(at, (row) => row.prsReady++);
  }

  const historySince = input.events.length ? Math.min(...input.events.map((e) => e.at)) : null;
  const flipsSince = input.flips.length ? Math.min(...input.flips.map((f) => f.failed_at)) : null;
  return {
    days,
    since,
    until: now,
    history: {
      since: historySince ?? flipsSince,
      needsHistory: ["timeToGreen", "timeToMerge", "waiting", "flakyChecks.flips"],
    },
    kpis: {
      timeToGreen: distribution(toGreen),
      timeToMerge: distribution(toMerge),
      mergedPrs: merged.length,
      mergedWithAgentHelp: mergedWithHelp.length,
      costPerMergedPrUsd: merged.length ? merged.reduce((s, m) => s + m.costUsd, 0) / merged.length : null,
      runsPerMergedPr: merged.length ? merged.reduce((s, m) => s + m.runs, 0) / merged.length : null,
      runsPerActivePr: activePrs.size ? runsInRange.length / activePrs.size : null,
      acceptedFindingsRate: accepted + declined > 0 ? accepted / (accepted + declined) : null,
      spendUsd: spendRuns.reduce((s, r) => s + r.cost_usd, 0),
      todaySpendUsd: spendRuns.filter((r) => spendAt(r) >= today0).reduce((s, r) => s + r.cost_usd, 0),
      runs: runsInRange.length,
    },
    outcomes,
    findings: { reviews, bySeverity },
    verdicts,
    ci: { classification, flakyChecks },
    waiting,
    daily,
    merged: merged.slice(0, 50),
  };
}

function hasTable(db: DatabaseSync, name: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
}

/** Reads every row the metrics need. Only finished runs' result JSONs are read; those never change, so they are cached. */
export function createMetricsLoader(db: DatabaseSync, resultsDir: string) {
  const resultCache = new Map<string, unknown>();

  function readResult(taskId: string): unknown {
    if (resultCache.has(taskId)) return resultCache.get(taskId);
    let parsed: unknown = undefined;
    try {
      parsed = JSON.parse(fs.readFileSync(path.join(resultsDir, `${path.basename(taskId)}.json`), "utf8"));
    } catch {
      // no result file (failed run, or results dir cleaned up)
    }
    resultCache.set(taskId, parsed);
    return parsed;
  }

  function load(): { input: MetricsInput; notes: Map<string, string> } {
    const events = hasTable(db, "pr_patrol_events")
      ? (db
          .prepare("SELECT pr_key, phase, waiting_on, summary, head_sha, at FROM pr_patrol_events ORDER BY at")
          .all() as EventRow[])
      : [];
    const flips = hasTable(db, "pr_patrol_check_flips")
      ? (db
          .prepare("SELECT pr_key, head_sha, name, failed_at, passed_at FROM pr_patrol_check_flips")
          .all() as CheckFlipRow[])
      : [];
    const prs = db.prepare("SELECT pr_key, phase, summary, updated_at FROM pr_patrol_prs").all() as PrStateRow[];
    const actionRows = db
      .prepare("SELECT pr_key, action_key, action, task_id, result_json FROM pr_patrol_actions")
      .all() as Array<ActionStateRow & { result_json: string | null }>;
    const hasCosts = hasTable(db, "claude_costs");
    const taskRows = db
      .prepare(
        `SELECT t.id AS task_id, t.workflow_meta_json AS meta, t.status, a.name AS agent, t.started_at, t.completed_at,
                t.created_at, ${hasCosts ? "COALESCE(c.cost, 0)" : "0"} AS cost_usd, ${hasCosts ? "c.at" : "NULL"} AS cost_at
         FROM tasks t LEFT JOIN agents a ON a.id = t.assigned_agent_id
         ${hasCosts ? "LEFT JOIN (SELECT task_id, SUM(cost_usd) AS cost, MAX(created_at) AS at FROM claude_costs GROUP BY task_id) c ON c.task_id = t.id" : ""}
         WHERE t.workflow_meta_json LIKE ?`,
      )
      .all(PATROL_SOURCE_LIKE) as Array<Omit<RunRow, "pr_key" | "action"> & { meta: string }>;
    const runs: RunRow[] = [];
    for (const { meta, ...t } of taskRows) {
      let m: { pr?: unknown; action?: unknown } = {};
      try {
        m = JSON.parse(meta) as typeof m;
      } catch {
        continue;
      }
      if (typeof m.pr !== "string" || typeof m.action !== "string") continue;
      runs.push({ ...t, pr_key: m.pr, action: m.action, cost_usd: Number(t.cost_usd) || 0 });
    }
    const results = new Map<string, unknown>();
    for (const r of runs) {
      if (r.action === "ready" || r.status !== "done") continue;
      const parsed = readResult(r.task_id);
      if (parsed !== undefined) results.set(r.task_id, parsed);
    }
    const notes = new Map<string, string>();
    for (const a of actionRows) {
      if (!a.task_id || !a.result_json) continue;
      try {
        const note = (JSON.parse(a.result_json) as { note?: unknown } | null)?.note;
        if (typeof note === "string") notes.set(a.task_id, note);
      } catch {
        // malformed result_json: no note
      }
    }
    const actions = actionRows.map(({ result_json: _r, ...a }) => a);
    return { input: { events, prs, runs, actions, flips, results }, notes };
  }

  return { load };
}

export function parseDays(raw: unknown): number {
  const n = Math.round(Number(raw));
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 365) : 30;
}

type RouteApp = {
  get: (p: string, h: (req: { query?: Record<string, unknown> }, res: { json(v: unknown): void }) => void) => void;
};

/** GET /api/pr-patrol/metrics?days=30 */
export function registerMetricsRoutes(app: RouteApp, db: DatabaseSync, resultsDir: string, nowMs: () => number): void {
  const loader = createMetricsLoader(db, resultsDir);
  app.get("/api/pr-patrol/metrics", (req, res) => {
    const { input, notes } = loader.load();
    res.json(computeLoopMetrics(input, { now: nowMs(), days: parseDays(req.query?.days), notes }));
  });
}
