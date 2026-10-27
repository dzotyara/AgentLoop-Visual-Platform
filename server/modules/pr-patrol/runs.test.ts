import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ensureClaudeCostSchema } from "../claude-costs/index.ts";
import { createRunInspector, registerRunRoutes } from "./runs.ts";
import { ensurePrPatrolSchema } from "./store.ts";

const PR = "acme/widgets#7";
let tmp: string;
let db: DatabaseSync;
let headSha: string;

const ev = (o: Record<string, unknown>) => JSON.stringify(o);
const log = (tool: { name: string; input: Record<string, unknown> }, finalText: string) =>
  [
    "",
    "===== task run start 2026-01-01T10:00:00.000Z | provider=claude =====",
    ev({ type: "system", subtype: "init", cwd: "/w", model: "claude-test" }),
    ev({
      type: "assistant",
      timestamp: "2026-01-01T10:00:01.000Z",
      message: { content: [{ type: "tool_use", id: "t1", ...tool }] },
    }),
    ev({
      type: "user",
      timestamp: "2026-01-01T10:00:02.000Z",
      message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }] },
    }),
    ev({
      type: "result",
      subtype: "success",
      timestamp: "2026-01-01T10:00:03.000Z",
      total_cost_usd: 0.5,
      num_turns: 3,
      duration_ms: 2000,
      result: finalText,
      modelUsage: { "claude-test": { costUSD: 0.5 } },
    }),
    "",
  ].join("\n");

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function addTask(id: string, action: string, startedAt: number, note: string, agent = "agent-patch") {
  db.prepare(
    `INSERT INTO tasks (id, title, status, result, started_at, completed_at, created_at, workflow_meta_json, assigned_agent_id)
     VALUES (?, ?, 'done', ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    `[fix] [widgets#7] ${action}: Widget PR`,
    note,
    startedAt,
    startedAt + 60_000,
    startedAt,
    JSON.stringify({ source: "pr-patrol", pr: PR, url: "https://github.com/acme/widgets/pull/7", action }),
    agent,
  );
  db.prepare(
    `INSERT INTO pr_patrol_actions (pr_key, action_key, action, status, attempts, task_id, result_json, updated_at)
     VALUES (?, ?, ?, 'done', 1, ?, ?, ?)`,
  ).run(PR, `${action}:${id}`, action, id, JSON.stringify({ note }), startedAt);
}

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "runs-test-"));
  const logsDir = path.join(tmp, "logs");
  const workdir = path.join(tmp, "work");
  fs.mkdirSync(logsDir);
  fs.mkdirSync(path.join(workdir, "results"), { recursive: true });

  // a repo clone with one [fix] commit on top of a base commit
  const clone = path.join(workdir, "repos", "acme__widgets");
  fs.mkdirSync(clone, { recursive: true });
  git(clone, "init", "-q");
  git(clone, "config", "user.email", "t@example.com");
  git(clone, "config", "user.name", "T");
  fs.writeFileSync(path.join(clone, "a.ts"), "export const a = 1;\n");
  git(clone, "add", ".");
  git(clone, "commit", "-qm", "base");
  fs.writeFileSync(path.join(clone, "a.ts"), "export const a = 2;\n");
  git(clone, "commit", "-qam", "[fix] bump a");
  headSha = git(clone, "rev-parse", "HEAD");

  db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE agents (id TEXT PRIMARY KEY, name TEXT, sprite_number INTEGER);
    CREATE TABLE tasks (id TEXT PRIMARY KEY, title TEXT, status TEXT, result TEXT, started_at INTEGER,
      completed_at INTEGER, created_at INTEGER, workflow_meta_json TEXT, assigned_agent_id TEXT);
  `);
  ensurePrPatrolSchema(db);
  ensureClaudeCostSchema(db);
  db.prepare("INSERT INTO agents VALUES ('agent-argus', 'Argus', 7), ('agent-patch', 'Patch', 3)").run();

  addTask("review-1", "review", 1000, "review: 1 blocking (P0/P1) of 2 finding(s)", "agent-argus");
  addTask("fix-1", "fix_review", 2000, `pushed 1 commit(s), head ${headSha.slice(0, 7)}. fixed it`);
  addTask("feedback-1", "address_feedback", 3000, "no changes; 1/1 item(s) handled.");
  db.prepare(
    `INSERT INTO claude_costs (run_key, task_id, cost_usd, model_usage_json, num_turns, duration_ms, created_at)
     VALUES ('k1', 'fix-1', 0.5, '{"claude-test":{}}', 3, 2000, 2000)`,
  ).run();

  fs.writeFileSync(
    path.join(workdir, "results", "review-1.json"),
    JSON.stringify({
      verdict: "issues",
      findings: [
        { severity: "P1", file: "a.ts", line: 1, title: "Constant a has the wrong value", detail: "should be 2" },
        { severity: "P3", file: "a.ts", line: 1, title: "Add a doc comment" },
      ],
    }),
  );
  fs.writeFileSync(
    path.join(workdir, "results", "fix-1.json"),
    JSON.stringify({ items: [{ title: "Constant a has the wrong value", verdict: "fixed", reason: "set to 2" }] }),
  );
  fs.writeFileSync(
    path.join(logsDir, "review-1.log"),
    log({ name: "Read", input: { file_path: "/w/a.ts" } }, "Reviewed."),
  );
  fs.writeFileSync(
    path.join(logsDir, "fix-1.log"),
    log(
      { name: "Edit", input: { file_path: "/w/a.ts", old_string: "1", new_string: "2" } },
      "Bumped the zebra constant.",
    ),
  );
});

afterAll(() => {
  db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const inspector = () => createRunInspector({ db, logsDir: path.join(tmp, "logs"), workdir: path.join(tmp, "work") });

describe("listRuns", () => {
  it("lists runs newest first with agent, cost and push info", () => {
    const { runs, total } = inspector().listRuns({});
    expect(total).toBe(3);
    expect(runs.map((r) => r.taskId)).toEqual(["feedback-1", "fix-1", "review-1"]);
    const fix = runs[1];
    expect(fix).toMatchObject({
      pr: PR,
      action: "fix_review",
      agentName: "Patch",
      agentSprite: 3,
      status: "done",
      costUsd: 0.5,
      models: ["claude-test"],
      turns: 3,
      durationMs: 60_000,
      hasLog: true,
      push: { status: "pushed", commits: 1, head: headSha.slice(0, 7) },
    });
    expect(runs[0].costUsd).toBeNull();
  });

  it("filters by pr, agent, action and status", () => {
    const i = inspector();
    expect(i.listRuns({ pr: "7" }).total).toBe(3);
    expect(i.listRuns({ pr: "8" }).total).toBe(0);
    expect(i.listRuns({ agent: "argus" }).runs.map((r) => r.taskId)).toEqual(["review-1"]);
    expect(i.listRuns({ action: "address_feedback" }).total).toBe(1);
    expect(i.listRuns({ status: "failed" }).total).toBe(0);
    expect(i.listRuns({ limit: 1 }).runs).toHaveLength(1);
  });

  it("searches titles, notes and the log's tool inputs / result text", () => {
    const i = inspector();
    expect(i.listRuns({ q: "item(s) handled" }).runs.map((r) => r.taskId)).toEqual(["feedback-1"]);
    const viaLog = i.listRuns({ q: "ZEBRA constant" });
    expect(viaLog.runs.map((r) => r.taskId)).toEqual(["fix-1"]);
    expect(viaLog.scannedLogs).toBeGreaterThan(0);
    expect(i.listRuns({ q: "new_string" }).runs.map((r) => r.taskId)).toEqual(["fix-1"]);
  });
});

describe("getRun", () => {
  it("returns steps, the commit diff and the finding-to-fix mapping for a fix run", async () => {
    const d = await inspector().getRun("fix-1");
    expect(d?.log?.steps.map((s) => s.summary)).toEqual(["Editing a.ts", "Finished: 3 turn(s), $0.50, 2s"]);
    expect(d?.log?.files).toEqual(["a.ts"]);
    expect(d?.commits).toHaveLength(1);
    expect(d?.commits[0]).toMatchObject({ sha: headSha, subject: "[fix] bump a", diffTruncated: false });
    expect(d?.commits[0].diff).toContain("+export const a = 2;");
    expect(d?.commits[0].diff).toContain("1 file changed");
    expect(d?.links).toMatchObject({
      kind: "fix",
      reviewTaskId: "review-1",
      items: [{ verdict: "fixed", commits: [{ sha: headSha }], finding: { severity: "P1", file: "a.ts" } }],
    });
  });

  it("links a review's blocking findings to the fix run that followed", async () => {
    const d = await inspector().getRun("review-1");
    expect(d?.commits).toEqual([]);
    expect(d?.links).toMatchObject({
      kind: "review",
      fixTaskId: "fix-1",
      findings: [
        { severity: "P1", blocking: true, fix: { taskId: "fix-1", verdict: "fixed", commits: [{ sha: headSha }] } },
        { severity: "P3", blocking: false, fix: null },
      ],
    });
  });

  it("handles runs without a log or result and rejects unknown / malformed ids", async () => {
    const d = await inspector().getRun("feedback-1");
    expect(d?.log).toBeNull();
    expect(d?.result).toBeNull();
    expect(d?.links).toMatchObject({ kind: "fix", items: [] });
    expect(await inspector().getRun("nope")).toBeNull();
    expect(await inspector().getRun("../etc/passwd")).toBeNull();
  });

  it("registers both routes", async () => {
    const handlers = new Map<string, (req: any, res: any) => void>();
    registerRunRoutes({
      app: { get: (p, h) => void handlers.set(p, h) },
      db,
      logsDir: path.join(tmp, "logs"),
      workdir: path.join(tmp, "work"),
    });
    expect([...handlers.keys()]).toEqual(["/api/pr-patrol/runs", "/api/pr-patrol/runs/:taskId"]);
    const sent: unknown[] = [];
    const res = { json: (v: unknown) => sent.push(v), status: () => res };
    handlers.get("/api/pr-patrol/runs")?.({ query: { agent: "Argus" }, params: {} }, res);
    expect((sent[0] as { total: number }).total).toBe(1);
    await new Promise<void>((resolve) => {
      handlers.get("/api/pr-patrol/runs/:taskId")?.(
        { query: {}, params: { taskId: "missing" } },
        {
          json: (v: unknown) => {
            sent.push(v);
            resolve();
          },
          status(code: number) {
            sent.push(code);
            return this;
          },
        },
      );
    });
    expect(sent.slice(1)).toEqual([404, { error: "run not found" }]);
  });
});
