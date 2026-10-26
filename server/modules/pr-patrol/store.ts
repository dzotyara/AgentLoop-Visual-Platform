import type { DatabaseSync } from "node:sqlite";
import type { ActionState, PatrolMemory, ReviewFinding } from "./decide.ts";

export type PrPhase = "watching" | "working" | "waiting" | "blocked" | "ready" | "skipped" | "error";

export type PrRow = {
  pr_key: string;
  repo: string;
  number: number;
  title: string;
  url: string;
  head_sha: string;
  phase: PrPhase;
  summary: string;
  notes_json: string;
  review_rounds: number;
  last_review_sha: string | null;
  last_review_json: string | null;
  handled_feedback_json: string;
  ready_sha: string | null;
  snapshot_json: string | null;
  updated_at: number;
};

export type ActionRow = {
  pr_key: string;
  action_key: string;
  action: string;
  status: "running" | "done" | "failed";
  attempts: number;
  task_id: string | null;
  result_json: string | null;
  updated_at: number;
};

export function ensurePrPatrolSchema(db: DatabaseSync): void {
  db.exec(`
CREATE TABLE IF NOT EXISTS pr_patrol_prs (
  pr_key TEXT PRIMARY KEY,
  repo TEXT NOT NULL,
  number INTEGER NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  head_sha TEXT NOT NULL DEFAULT '',
  phase TEXT NOT NULL DEFAULT 'watching',
  summary TEXT NOT NULL DEFAULT '',
  notes_json TEXT NOT NULL DEFAULT '[]',
  review_rounds INTEGER NOT NULL DEFAULT 0,
  last_review_sha TEXT,
  last_review_json TEXT,
  handled_feedback_json TEXT NOT NULL DEFAULT '[]',
  ready_sha TEXT,
  updated_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS pr_patrol_actions (
  pr_key TEXT NOT NULL,
  action_key TEXT NOT NULL,
  action TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('running','done','failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  task_id TEXT,
  result_json TEXT,
  updated_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (pr_key, action_key)
);
`);
  const cols = db.prepare("PRAGMA table_info(pr_patrol_prs)").all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === "snapshot_json")) db.exec("ALTER TABLE pr_patrol_prs ADD COLUMN snapshot_json TEXT");
}

export function prKey(repo: string, number: number): string {
  return `${repo}#${number}`;
}

export function createPrPatrolStore(db: DatabaseSync, nowMs: () => number) {
  function getPr(key: string): PrRow | undefined {
    return db.prepare("SELECT * FROM pr_patrol_prs WHERE pr_key = ?").get(key) as PrRow | undefined;
  }

  function upsertPr(row: Pick<PrRow, "pr_key" | "repo" | "number" | "title" | "url" | "head_sha">): void {
    db.prepare(
      `INSERT INTO pr_patrol_prs (pr_key, repo, number, title, url, head_sha, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(pr_key) DO UPDATE SET title = excluded.title, url = excluded.url, head_sha = excluded.head_sha`,
    ).run(row.pr_key, row.repo, row.number, row.title, row.url, row.head_sha, nowMs());
  }

  function setPhase(key: string, phase: PrPhase, summary: string, notes: string[] = []): void {
    db.prepare("UPDATE pr_patrol_prs SET phase = ?, summary = ?, notes_json = ?, updated_at = ? WHERE pr_key = ?").run(
      phase,
      summary,
      JSON.stringify(notes),
      nowMs(),
      key,
    );
  }

  /** Last seen GitHub state of the PR, for the UI. */
  function setSnapshot(key: string, snapshot: unknown): void {
    db.prepare("UPDATE pr_patrol_prs SET snapshot_json = ? WHERE pr_key = ?").run(JSON.stringify(snapshot), key);
  }

  function listActions(key: string, limit = 20): ActionRow[] {
    return db
      .prepare("SELECT * FROM pr_patrol_actions WHERE pr_key = ? ORDER BY updated_at DESC LIMIT ?")
      .all(key, limit) as ActionRow[];
  }

  function markReady(key: string, sha: string): boolean {
    const row = getPr(key);
    if (row?.ready_sha === sha) return false;
    db.prepare("UPDATE pr_patrol_prs SET ready_sha = ? WHERE pr_key = ?").run(sha, key);
    return true;
  }

  function memory(key: string): PatrolMemory {
    const row = getPr(key);
    const actions = new Map<string, ActionState>();
    for (const a of db
      .prepare("SELECT action_key, status, attempts FROM pr_patrol_actions WHERE pr_key = ?")
      .all(key) as Array<{ action_key: string; status: ActionState["status"]; attempts: number }>) {
      actions.set(a.action_key, { status: a.status, attempts: a.attempts });
    }
    return {
      actions,
      handledFeedbackIds: new Set<string>(JSON.parse(row?.handled_feedback_json ?? "[]")),
      lastReview:
        row?.last_review_sha && row.last_review_json
          ? { sha: row.last_review_sha, blocking: JSON.parse(row.last_review_json) as ReviewFinding[] }
          : null,
      reviewRounds: row?.review_rounds ?? 0,
    };
  }

  function startAction(key: string, actionKey: string, action: string, taskId: string): void {
    db.prepare(
      `INSERT INTO pr_patrol_actions (pr_key, action_key, action, status, attempts, task_id, updated_at)
       VALUES (?, ?, ?, 'running', 1, ?, ?)
       ON CONFLICT(pr_key, action_key) DO UPDATE SET status = 'running', attempts = attempts + 1,
         task_id = excluded.task_id, updated_at = excluded.updated_at`,
    ).run(key, actionKey, action, taskId, nowMs());
  }

  function finishAction(key: string, actionKey: string, status: "done" | "failed", result: unknown): void {
    db.prepare(
      "UPDATE pr_patrol_actions SET status = ?, result_json = ?, updated_at = ? WHERE pr_key = ? AND action_key = ?",
    ).run(status, JSON.stringify(result ?? null), nowMs(), key, actionKey);
  }

  function recordReview(key: string, sha: string, blocking: ReviewFinding[]): void {
    db.prepare(
      "UPDATE pr_patrol_prs SET last_review_sha = ?, last_review_json = ?, review_rounds = review_rounds + 1 WHERE pr_key = ?",
    ).run(sha, JSON.stringify(blocking), key);
  }

  function addHandledFeedback(key: string, ids: string[]): void {
    const set = memory(key).handledFeedbackIds;
    for (const id of ids) set.add(id);
    db.prepare("UPDATE pr_patrol_prs SET handled_feedback_json = ? WHERE pr_key = ?").run(
      JSON.stringify([...set]),
      key,
    );
  }

  /** Runs interrupted by a restart never report back; let the loop retry them. */
  function failInterruptedActions(): number {
    const r = db
      // The restart, not the agent, ended the run: give the attempt back.
      .prepare(
        "UPDATE pr_patrol_actions SET status = 'failed', attempts = MAX(attempts - 1, 0), updated_at = ? WHERE status = 'running'",
      )
      .run(nowMs());
    return Number(r.changes ?? 0);
  }

  function listPrs(): PrRow[] {
    return db.prepare("SELECT * FROM pr_patrol_prs ORDER BY updated_at DESC").all() as PrRow[];
  }

  function forgetMissing(openKeys: Set<string>): void {
    for (const row of listPrs()) {
      if (!openKeys.has(row.pr_key) && row.phase !== "skipped")
        setPhase(row.pr_key, "skipped", "no longer open / not patrolled");
    }
  }

  return {
    getPr,
    upsertPr,
    setPhase,
    markReady,
    setSnapshot,
    listActions,
    memory,
    startAction,
    finishAction,
    recordReview,
    addHandledFeedback,
    failInterruptedActions,
    listPrs,
    forgetMissing,
  };
}

export type PrPatrolStore = ReturnType<typeof createPrPatrolStore>;
