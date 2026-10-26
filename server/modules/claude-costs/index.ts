import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";

/**
 * Claude spend, from the `result` event Claude Code prints at the end of every `--output-format=stream-json`
 * run (total_cost_usd + per-model usage). Every CLI task run writes logs/<taskId>.log, so a scan of that
 * directory covers pr-patrol agents and stock task runs alike, including runs from before this module existed.
 * Costs are Claude Code's own figures: API list prices, also on a subscription plan.
 */

export type ResultEvent = {
  type: "result";
  uuid?: string;
  session_id?: string;
  total_cost_usd?: number;
  num_turns?: number;
  duration_ms?: number;
  is_error?: boolean;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  modelUsage?: Record<string, { costUSD?: number; inputTokens?: number; outputTokens?: number }>;
};

export function parseResultLine(line: string): ResultEvent | null {
  if (!line.startsWith('{"') || !line.includes('"type":"result"')) return null;
  try {
    const evt = JSON.parse(line) as ResultEvent;
    return evt.type === "result" && typeof evt.total_cost_usd === "number" ? evt : null;
  } catch {
    return null;
  }
}

export function ensureClaudeCostSchema(db: DatabaseSync): void {
  db.exec(`
CREATE TABLE IF NOT EXISTS claude_costs (
  run_key TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  cost_usd REAL NOT NULL,
  model_usage_json TEXT NOT NULL DEFAULT '{}',
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  num_turns INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  is_error INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_claude_costs_created ON claude_costs(created_at);
CREATE INDEX IF NOT EXISTS idx_claude_costs_task ON claude_costs(task_id);
`);
}

type Window = { costUsd: number; runs: number };
type Breakdown = { key: string; label: string; costUsd: number; runs: number };

export type ClaudeCostSummary = {
  today: Window;
  last7d: Window;
  last30d: Window;
  allTime: Window;
  byModel: Breakdown[]; // last 7 days
  byAgent: Breakdown[]; // last 7 days
  byPr: Breakdown[]; // all time, pr-patrol tasks only
  recent: Array<{ taskId: string; title: string; costUsd: number; models: string[]; createdAt: number }>;
  updatedAt: number;
};

export function createClaudeCostTracker(db: DatabaseSync, logsDir: string, nowMs: () => number) {
  ensureClaudeCostSchema(db);
  const insert = db.prepare(`
INSERT OR IGNORE INTO claude_costs (run_key, task_id, cost_usd, model_usage_json, input_tokens, output_tokens,
  cache_read_tokens, cache_write_tokens, num_turns, duration_ms, is_error, created_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  /** Bytes already scanned per log file; a file that shrank (rotated/rewritten) is rescanned from 0. */
  const offsets = new Map<string, number>();

  /** True when the run was new. */
  function record(taskId: string, evt: ResultEvent, at: number): boolean {
    const u = evt.usage ?? {};
    const r = insert.run(
      evt.uuid ?? `${taskId}:${evt.session_id ?? at}`,
      taskId,
      evt.total_cost_usd ?? 0,
      JSON.stringify(evt.modelUsage ?? {}),
      u.input_tokens ?? 0,
      u.output_tokens ?? 0,
      u.cache_read_input_tokens ?? 0,
      u.cache_creation_input_tokens ?? 0,
      evt.num_turns ?? 0,
      evt.duration_ms ?? 0,
      evt.is_error ? 1 : 0,
      at,
    );
    return Number(r.changes) > 0;
  }

  /** Reads only the bytes appended since the last scan; stamps new runs with the file's mtime. */
  function scan(): number {
    let added = 0;
    let files: string[];
    try {
      files = fs.readdirSync(logsDir).filter((f) => f.endsWith(".log"));
    } catch {
      return 0;
    }
    for (const file of files) {
      const full = path.join(logsDir, file);
      let stat: fs.Stats;
      try {
        stat = fs.statSync(full);
      } catch {
        continue;
      }
      const from = (offsets.get(file) ?? 0) > stat.size ? 0 : (offsets.get(file) ?? 0);
      if (stat.size === from) continue;
      const fd = fs.openSync(full, "r");
      try {
        const buf = Buffer.alloc(stat.size - from);
        fs.readSync(fd, buf, 0, buf.length, from);
        const text = buf.toString("utf8");
        const lastNl = text.lastIndexOf("\n");
        if (lastNl < 0) continue; // no complete line yet
        offsets.set(file, from + Buffer.byteLength(text.slice(0, lastNl + 1)));
        const taskId = file.slice(0, -".log".length);
        for (const line of text.slice(0, lastNl).split("\n")) {
          const evt = parseResultLine(line);
          if (!evt) continue;
          if (record(taskId, evt, Math.round(stat.mtimeMs))) added++;
        }
      } finally {
        fs.closeSync(fd);
      }
    }
    return added;
  }

  function window(sinceMs: number): Window {
    const r = db
      .prepare("SELECT COALESCE(SUM(cost_usd), 0) AS c, COUNT(*) AS n FROM claude_costs WHERE created_at >= ?")
      .get(sinceMs) as { c: number; n: number };
    return { costUsd: r.c, runs: r.n };
  }

  function summary(): ClaudeCostSummary {
    const now = nowMs();
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const since7 = now - 7 * 86_400_000;

    const byModel = new Map<string, Breakdown>();
    for (const row of db
      .prepare("SELECT model_usage_json FROM claude_costs WHERE created_at >= ?")
      .all(since7) as Array<{ model_usage_json: string }>) {
      let usage: ResultEvent["modelUsage"] = {};
      try {
        usage = JSON.parse(row.model_usage_json);
      } catch {
        continue;
      }
      for (const [model, m] of Object.entries(usage ?? {})) {
        const b = byModel.get(model) ?? { key: model, label: model, costUsd: 0, runs: 0 };
        b.costUsd += m.costUSD ?? 0;
        b.runs += 1;
        byModel.set(model, b);
      }
    }

    const byAgent = db
      .prepare(
        `SELECT COALESCE(a.id, 'unassigned') AS key, COALESCE(a.name, 'Unassigned') AS label,
                SUM(c.cost_usd) AS costUsd, COUNT(*) AS runs
         FROM claude_costs c LEFT JOIN tasks t ON t.id = c.task_id LEFT JOIN agents a ON a.id = t.assigned_agent_id
         WHERE c.created_at >= ? GROUP BY key ORDER BY costUsd DESC`,
      )
      .all(since7) as Breakdown[];

    const byPr = (
      db
        .prepare(
          `SELECT t.workflow_meta_json AS meta, SUM(c.cost_usd) AS costUsd, COUNT(*) AS runs
           FROM claude_costs c JOIN tasks t ON t.id = c.task_id
           WHERE t.workflow_meta_json LIKE '%"source":"pr-patrol"%' GROUP BY t.workflow_meta_json`,
        )
        .all() as Array<{ meta: string; costUsd: number; runs: number }>
    ).reduce((acc, row) => {
      let pr = "?";
      try {
        pr = (JSON.parse(row.meta) as { pr?: string }).pr ?? "?";
      } catch {
        // keep "?"
      }
      const b = acc.get(pr) ?? { key: pr, label: pr, costUsd: 0, runs: 0 };
      b.costUsd += row.costUsd;
      b.runs += row.runs;
      acc.set(pr, b);
      return acc;
    }, new Map<string, Breakdown>());

    const recent = (
      db
        .prepare(
          `SELECT c.task_id AS taskId, COALESCE(t.title, c.task_id) AS title, c.cost_usd AS costUsd,
                  c.model_usage_json AS mu, c.created_at AS createdAt
           FROM claude_costs c LEFT JOIN tasks t ON t.id = c.task_id ORDER BY c.created_at DESC LIMIT 10`,
        )
        .all() as Array<{ taskId: string; title: string; costUsd: number; mu: string; createdAt: number }>
    ).map(({ mu, ...r }) => {
      let models: string[] = [];
      try {
        models = Object.keys(JSON.parse(mu) as object);
      } catch {
        // no models
      }
      return { ...r, models };
    });

    return {
      today: window(startOfDay.getTime()),
      last7d: window(since7),
      last30d: window(now - 30 * 86_400_000),
      allTime: window(0),
      byModel: [...byModel.values()].sort((a, b) => b.costUsd - a.costUsd),
      byAgent,
      byPr: [...byPr.values()].sort((a, b) => b.costUsd - a.costUsd),
      recent,
      updatedAt: now,
    };
  }

  return { scan, summary, record };
}

export function startClaudeCostTracking(ctx: {
  app: { get: (path: string, handler: (req: unknown, res: { json(v: unknown): void }) => void) => void };
  db: DatabaseSync;
  logsDir: string;
  nowMs: () => number;
  broadcast?: (type: string, payload: unknown) => void;
}): void {
  const tracker = createClaudeCostTracker(ctx.db, ctx.logsDir, ctx.nowMs);
  tracker.scan();
  setInterval(() => {
    if (tracker.scan() > 0) ctx.broadcast?.("claude_costs_update", tracker.summary());
  }, 20_000);
  ctx.app.get("/api/claude-costs", (_req, res) => {
    tracker.scan();
    res.json(tracker.summary());
  });
}
