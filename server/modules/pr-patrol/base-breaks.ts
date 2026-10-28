import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { BaseBreak } from "./decide.ts";

/** open: PRs wait on it · fixing: Medic's fix PR is open · abandoned: no fix PR could be made (PRs still wait) · resolved. */
export type BaseBreakStatus = "open" | "fixing" | "abandoned" | "resolved";

export type BaseBreakRow = {
  id: string;
  repo: string;
  base: string;
  /** Base head when the breakage was first seen: a PR containing a later base that passes the checks proves it fixed. */
  base_sha: string;
  checks_json: string;
  detail: string;
  prs_json: string;
  status: BaseBreakStatus;
  fix_pr: number | null;
  fix_url: string | null;
  fix_branch: string | null;
  fix_attempts: number;
  note: string;
  first_seen: number;
  updated_at: number;
  resolved_at: number | null;
};

export function ensureBaseBreakSchema(db: DatabaseSync): void {
  db.exec(`
CREATE TABLE IF NOT EXISTS pr_patrol_base_breaks (
  id TEXT PRIMARY KEY,
  repo TEXT NOT NULL,
  base TEXT NOT NULL,
  base_sha TEXT NOT NULL DEFAULT '',
  checks_json TEXT NOT NULL DEFAULT '[]',
  detail TEXT NOT NULL DEFAULT '',
  prs_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'open',
  fix_pr INTEGER,
  fix_url TEXT,
  fix_branch TEXT,
  fix_attempts INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  first_seen INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0,
  resolved_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_pr_patrol_base_breaks_repo ON pr_patrol_base_breaks(repo, base, status);
`);
}

const parse = (json: string): string[] => {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
};

export const breakChecks = (row: BaseBreakRow): string[] => parse(row.checks_json);
export const breakPrs = (row: BaseBreakRow): string[] => parse(row.prs_json);

/**
 * Base breakages per repo + base branch. One breakage per overlapping set of checks: when Medic reports the same
 * checks broken on the base from another PR, that PR joins the breakage instead of opening a second one.
 */
export function createBaseBreakStore(db: DatabaseSync, nowMs: () => number) {
  ensureBaseBreakSchema(db);

  function get(id: string): BaseBreakRow | undefined {
    return db.prepare("SELECT * FROM pr_patrol_base_breaks WHERE id = ?").get(id) as BaseBreakRow | undefined;
  }

  /** Not yet resolved, newest first. */
  function live(repo?: string, base?: string): BaseBreakRow[] {
    const rows = db
      .prepare("SELECT * FROM pr_patrol_base_breaks WHERE status != 'resolved' ORDER BY first_seen DESC")
      .all() as BaseBreakRow[];
    return rows.filter((r) => (repo === undefined || r.repo === repo) && (base === undefined || r.base === base));
  }

  /** Breakages a PR waits on; a base-fix PR never waits on the breakage it fixes. */
  function forDecide(repo: string, base: string, headRef?: string): BaseBreak[] {
    return live(repo, base)
      .filter((r) => !headRef || r.fix_branch !== headRef)
      .map((r) => ({ id: r.id, checks: breakChecks(r), fixPr: r.fix_pr, fixUrl: r.fix_url }));
  }

  /** Medic found `checks` failing because of the base: join the breakage these checks belong to, or open one. */
  function record(input: {
    repo: string;
    base: string;
    baseSha: string;
    checks: string[];
    detail: string;
    pr: string;
  }): BaseBreakRow {
    const t = nowMs();
    const hit = live(input.repo, input.base).find((r) => breakChecks(r).some((c) => input.checks.includes(c)));
    if (hit) {
      const checks = [...new Set([...breakChecks(hit), ...input.checks])];
      const prs = [...new Set([...breakPrs(hit), input.pr])];
      db.prepare(
        "UPDATE pr_patrol_base_breaks SET checks_json = ?, prs_json = ?, detail = ?, updated_at = ? WHERE id = ?",
      ).run(JSON.stringify(checks), JSON.stringify(prs), input.detail.slice(0, 8000) || hit.detail, t, hit.id);
      return get(hit.id)!;
    }
    const id = createHash("sha1")
      .update(`${input.repo}\n${input.base}\n${[...input.checks].sort().join("\n")}\n${t}`)
      .digest("hex")
      .slice(0, 10);
    db.prepare(
      `INSERT INTO pr_patrol_base_breaks (id, repo, base, base_sha, checks_json, detail, prs_json, first_seen, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.repo,
      input.base,
      input.baseSha,
      JSON.stringify(input.checks),
      input.detail.slice(0, 8000),
      JSON.stringify([input.pr]),
      t,
      t,
    );
    return get(id)!;
  }

  /** A PR is waiting on this breakage (counts toward the base fix threshold). */
  function addPr(id: string, pr: string): void {
    const row = get(id);
    if (!row || breakPrs(row).includes(pr)) return;
    db.prepare("UPDATE pr_patrol_base_breaks SET prs_json = ?, updated_at = ? WHERE id = ?").run(
      JSON.stringify([...breakPrs(row), pr]),
      nowMs(),
      id,
    );
  }

  function setFix(id: string, fix: { pr: number; url: string; branch: string }): void {
    db.prepare(
      "UPDATE pr_patrol_base_breaks SET status = 'fixing', fix_pr = ?, fix_url = ?, fix_branch = ?, note = '', updated_at = ? WHERE id = ?",
    ).run(fix.pr, fix.url, fix.branch, nowMs(), id);
  }

  /** A fix attempt made no PR, or its PR was closed unmerged: retry once, then stop trying (PRs keep waiting). */
  function fixFailed(id: string, note: string, maxAttempts = 2): void {
    const row = get(id);
    if (!row) return;
    const attempts = row.fix_attempts + 1;
    db.prepare(
      "UPDATE pr_patrol_base_breaks SET status = ?, fix_attempts = ?, fix_pr = NULL, fix_url = NULL, note = ?, updated_at = ? WHERE id = ?",
    ).run(attempts >= maxAttempts ? "abandoned" : "open", attempts, note.slice(0, 2000), nowMs(), id);
  }

  function resolve(id: string, note: string): void {
    const t = nowMs();
    db.prepare(
      "UPDATE pr_patrol_base_breaks SET status = 'resolved', note = ?, resolved_at = ?, updated_at = ? WHERE id = ?",
    ).run(note.slice(0, 2000), t, t, id);
  }

  return { get, live, forDecide, record, addPr, setFix, fixFailed, resolve };
}

export type BaseBreakStore = ReturnType<typeof createBaseBreakStore>;
