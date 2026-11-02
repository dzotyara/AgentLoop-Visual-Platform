import type { DatabaseSync } from "node:sqlite";
import type { ReviewFinding } from "./decide.ts";
import type { PrFeedback } from "./github.ts";

/** pending: waiting for an agent · opened: the follow-up PR is open · nothing: no finding still applied · failed: gave up. */
export type FollowUpStatus = "pending" | "opened" | "nothing" | "failed";

export type FollowUpRow = {
  pr_key: string;
  repo: string;
  number: number;
  title: string;
  url: string;
  base: string;
  findings_json: string;
  status: FollowUpStatus;
  attempts: number;
  fix_pr: number | null;
  fix_url: string | null;
  note: string;
  created_at: number;
  updated_at: number;
};

export function ensureFollowUpSchema(db: DatabaseSync): void {
  db.exec(`
CREATE TABLE IF NOT EXISTS pr_patrol_followups (
  pr_key TEXT PRIMARY KEY,
  repo TEXT NOT NULL,
  number INTEGER NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  base TEXT NOT NULL,
  findings_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  fix_pr INTEGER,
  fix_url TEXT,
  note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_pr_patrol_followups_status ON pr_patrol_followups(status, created_at);
`);
}

/** What the follow-up has to look at: the last review's P2/P3 plus the bots' P2/P3 comments nobody handled. */
export function followUpItems(reviewMinor: ReviewFinding[], comments: PrFeedback[]): ReviewFinding[] {
  return [
    ...reviewMinor,
    ...comments.map((c) => ({
      severity: c.p3Only ? ("P3" as const) : ("P2" as const),
      file: c.path ?? undefined,
      line: c.line ?? undefined,
      title: `Comment by @${c.author}`,
      detail: c.body.slice(0, 4000),
    })),
  ];
}

export const followUpFindings = (row: FollowUpRow): ReviewFinding[] => {
  try {
    const v = JSON.parse(row.findings_json);
    return Array.isArray(v) ? (v as ReviewFinding[]) : [];
  } catch {
    return [];
  }
};

/** One follow-up per merged PR. Recording the same PR twice keeps the first. */
export function createFollowUpStore(db: DatabaseSync, nowMs: () => number) {
  ensureFollowUpSchema(db);

  function get(prKey: string): FollowUpRow | undefined {
    return db.prepare("SELECT * FROM pr_patrol_followups WHERE pr_key = ?").get(prKey) as FollowUpRow | undefined;
  }

  function record(input: {
    prKey: string;
    repo: string;
    number: number;
    title: string;
    url: string;
    base: string;
    items: ReviewFinding[];
  }): void {
    const t = nowMs();
    db.prepare(
      `INSERT OR IGNORE INTO pr_patrol_followups (pr_key, repo, number, title, url, base, findings_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(input.prKey, input.repo, input.number, input.title, input.url, input.base, JSON.stringify(input.items), t, t);
  }

  /** Oldest first, so a burst of merges drains in merge order. */
  function pending(): FollowUpRow[] {
    return db
      .prepare("SELECT * FROM pr_patrol_followups WHERE status = 'pending' ORDER BY created_at")
      .all() as FollowUpRow[];
  }

  function recent(limit: number): FollowUpRow[] {
    return db.prepare("SELECT * FROM pr_patrol_followups ORDER BY created_at DESC LIMIT ?").all(limit) as FollowUpRow[];
  }

  function setOpened(prKey: string, fix: { pr: number; url: string }): void {
    db.prepare(
      "UPDATE pr_patrol_followups SET status = 'opened', fix_pr = ?, fix_url = ?, note = '', updated_at = ? WHERE pr_key = ?",
    ).run(fix.pr, fix.url, nowMs(), prKey);
  }

  function setNothing(prKey: string, note: string): void {
    db.prepare("UPDATE pr_patrol_followups SET status = 'nothing', note = ?, updated_at = ? WHERE pr_key = ?").run(
      note.slice(0, 2000),
      nowMs(),
      prKey,
    );
  }

  /** A run made no PR: retry once, then give up (the findings stay on the merged PR's review card). */
  function fail(prKey: string, note: string, maxAttempts = 2): void {
    const row = get(prKey);
    if (!row) return;
    const attempts = row.attempts + 1;
    db.prepare(
      "UPDATE pr_patrol_followups SET status = ?, attempts = ?, note = ?, updated_at = ? WHERE pr_key = ?",
    ).run(attempts >= maxAttempts ? "failed" : "pending", attempts, note.slice(0, 2000), nowMs(), prKey);
  }

  return { get, record, pending, recent, setOpened, setNothing, fail };
}

export type FollowUpStore = ReturnType<typeof createFollowUpStore>;
