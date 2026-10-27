import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { promisify } from "node:util";
import {
  findingsOf,
  followingFixRun,
  mapFixItems,
  mapReviewFindings,
  parsePushNote,
  precedingReview,
  prMatches,
  type CommitRef,
  type FeedbackLookup,
  type FindingRef,
  type FixItem,
  type PushInfo,
  type ReviewFindingLink,
  type RunRef,
} from "./run-links.ts";
import { parseRunLog, searchableText, type ParsedRun } from "./run-log.ts";

/**
 * Run inspector API: every pr-patrol agent run (a kanban task) with what it did, step by step, what it
 * cost, which commits it pushed and which review findings those commits answered.
 *   GET /api/pr-patrol/runs?pr=&agent=&action=&status=&q=&limit=
 *   GET /api/pr-patrol/runs/:taskId?run=<index>
 * Read-only: the database, logs/<taskId>.log, <workdir>/results/<taskId>.json and the repo clones
 * (a missing commit is fetched from origin; nothing else is ever written there).
 */

const execFileAsync = promisify(execFile);

export type RunStatus = "running" | "done" | "failed";

export type RunSummary = {
  taskId: string;
  title: string;
  pr: string | null;
  prUrl: string | null;
  action: string;
  agentId: string | null;
  agentName: string | null;
  agentSprite: number | null;
  status: RunStatus;
  attempts: number | null;
  startedAt: number | null;
  completedAt: number | null;
  durationMs: number | null;
  costUsd: number | null;
  models: string[];
  turns: number | null;
  note: string | null;
  push: PushInfo;
  hasLog: boolean;
};

export type RunCommit = {
  sha: string;
  subject: string;
  author: string | null;
  date: string | null;
  /** `git show --stat --patch` output, capped. */
  diff: string;
  diffTruncated: boolean;
};

export type RunDetail = {
  run: RunSummary;
  log: (Omit<ParsedRun, "commits"> & { runIndex: number; runCount: number; logCommits: CommitRef[] }) | null;
  runs: Array<{ index: number; startedAt: number | null; finished: boolean }>;
  result: unknown;
  commits: RunCommit[];
  commitError: string | null;
  links:
    | { kind: "fix"; reviewTaskId: string | null; items: FixItem[] }
    | { kind: "review"; fixTaskId: string | null; findings: ReviewFindingLink[] }
    | { kind: "none" };
};

export type RunListQuery = {
  pr?: string;
  agent?: string;
  action?: string;
  status?: string;
  q?: string;
  limit?: number;
};

export type RunList = { runs: RunSummary[]; total: number; scannedLogs: number; searchCapped: boolean };

const CANDIDATE_CAP = 2000;
const SEARCH_LOG_CAP = 400;
const SEARCH_READ_CAP = 8 * 1024 * 1024;
const LOG_READ_CAP = 32 * 1024 * 1024;
const DIFF_CAP = 200 * 1024;
const TASK_ID = /^[A-Za-z0-9-]{1,80}$/;

type Row = {
  id: string;
  title: string;
  task_status: string;
  task_result: string | null;
  started_at: number | null;
  completed_at: number | null;
  created_at: number | null;
  meta: string | null;
  agent_id: string | null;
  agent_name: string | null;
  sprite_number: number | null;
  action_status: RunStatus | null;
  attempts: number | null;
  result_json: string | null;
};

type Meta = { source?: string; pr?: string; url?: string; action?: string };

const parseJson = <T>(s: string | null | undefined): T | null => {
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
};

const BASE_SQL = `
SELECT t.id, t.title, t.status AS task_status, t.result AS task_result, t.started_at, t.completed_at, t.created_at,
       t.workflow_meta_json AS meta, a.id AS agent_id, a.name AS agent_name, a.sprite_number,
       pa.status AS action_status, pa.attempts, pa.result_json
FROM tasks t
LEFT JOIN agents a ON a.id = t.assigned_agent_id
LEFT JOIN pr_patrol_actions pa ON pa.task_id = t.id
WHERE t.workflow_meta_json LIKE '%"source":"pr-patrol"%'`;

function readTail(file: string, max: number): string | null {
  let fd: number | null = null;
  try {
    const size = fs.statSync(file).size;
    fd = fs.openSync(file, "r");
    // Big logs: keep the tail, which holds the latest run.
    const len = Math.min(size, max);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    return buf.toString("utf8");
  } catch {
    return null;
  } finally {
    if (fd != null) fs.closeSync(fd);
  }
}

async function git(cwd: string, args: string[], timeout = 60_000): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    timeout,
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  return stdout;
}

export function createRunInspector(opts: { db: DatabaseSync; logsDir: string; workdir: string }) {
  const { db, logsDir, workdir } = opts;
  const searchCache = new Map<string, { mtimeMs: number; size: number; text: string }>();
  const diffCache = new Map<string, { diff: string; truncated: boolean }>();

  const logPath = (taskId: string) => path.join(logsDir, `${taskId}.log`);
  const resultPath = (taskId: string) => path.join(workdir, "results", `${taskId}.json`);

  function hasTable(name: string): boolean {
    return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
  }

  function costs(ids: string[]): Map<string, { cost: number; turns: number; duration: number; models: string[] }> {
    const out = new Map<string, { cost: number; turns: number; duration: number; models: string[] }>();
    if (!ids.length || !hasTable("claude_costs")) return out;
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      const rows = db
        .prepare(
          `SELECT task_id, cost_usd, num_turns, duration_ms, model_usage_json FROM claude_costs
           WHERE task_id IN (${chunk.map(() => "?").join(",")})`,
        )
        .all(...chunk) as Array<{
        task_id: string;
        cost_usd: number;
        num_turns: number;
        duration_ms: number;
        model_usage_json: string;
      }>;
      for (const r of rows) {
        const c = out.get(r.task_id) ?? { cost: 0, turns: 0, duration: 0, models: [] };
        c.cost += r.cost_usd;
        c.turns += r.num_turns;
        c.duration += r.duration_ms;
        for (const m of Object.keys(parseJson<Record<string, unknown>>(r.model_usage_json) ?? {})) {
          if (!c.models.includes(m)) c.models.push(m);
        }
        out.set(r.task_id, c);
      }
    }
    return out;
  }

  function toSummary(r: Row, cost?: { cost: number; turns: number; duration: number; models: string[] }): RunSummary {
    const meta = parseJson<Meta>(r.meta) ?? {};
    const note = parseJson<{ note?: string }>(r.result_json)?.note ?? r.task_result ?? null;
    const status: RunStatus =
      r.action_status ?? (r.task_status === "in_progress" ? "running" : r.task_status === "done" ? "done" : "failed");
    const durationMs =
      r.started_at && r.completed_at ? Math.max(0, r.completed_at - r.started_at) : cost ? cost.duration || null : null;
    return {
      taskId: r.id,
      title: r.title,
      pr: meta.pr ?? null,
      prUrl: meta.url ?? null,
      action: meta.action ?? "unknown",
      agentId: r.agent_id,
      agentName: r.agent_name,
      agentSprite: r.sprite_number,
      status,
      attempts: r.attempts,
      startedAt: r.started_at ?? r.created_at,
      completedAt: r.completed_at,
      durationMs,
      costUsd: cost ? cost.cost : null,
      models: cost?.models ?? [],
      turns: cost ? cost.turns : null,
      note,
      push: parsePushNote(note),
      hasLog: fs.existsSync(logPath(r.id)),
    };
  }

  function logMatches(taskId: string, q: string): boolean {
    const file = logPath(taskId);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(file);
    } catch {
      return false;
    }
    let hit = searchCache.get(file);
    if (!hit || hit.mtimeMs !== stat.mtimeMs || hit.size !== stat.size) {
      const raw = readTail(file, SEARCH_READ_CAP) ?? "";
      hit = { mtimeMs: stat.mtimeMs, size: stat.size, text: searchableText(raw) };
      searchCache.delete(file);
      searchCache.set(file, hit);
      if (searchCache.size > 300) searchCache.delete(searchCache.keys().next().value as string);
    }
    return hit.text.includes(q);
  }

  function listRuns(query: RunListQuery): RunList {
    const limit = Math.max(1, Math.min(500, Math.floor(query.limit ?? 100)));
    const rows = (
      db.prepare(`${BASE_SQL} ORDER BY COALESCE(t.started_at, t.created_at) DESC LIMIT ?`).all(CANDIDATE_CAP) as Row[]
    ).filter((r) => (parseJson<Meta>(r.meta)?.action ?? "") !== "ready");

    const agent = query.agent?.trim().toLowerCase();
    const action = query.action?.trim();
    const status = query.status?.trim();
    const filtered = rows.filter((r) => {
      const meta = parseJson<Meta>(r.meta) ?? {};
      if (query.pr?.trim() && !prMatches(meta.pr ?? "", query.pr)) return false;
      if (agent && r.agent_id?.toLowerCase() !== agent && r.agent_name?.toLowerCase() !== agent) return false;
      if (action && meta.action !== action) return false;
      if (status) {
        const s =
          r.action_status ??
          (r.task_status === "in_progress" ? "running" : r.task_status === "done" ? "done" : "failed");
        if (s !== status) return false;
      }
      return true;
    });

    const q = query.q?.trim().toLowerCase();
    let scannedLogs = 0;
    let searchCapped = false;
    let matched = filtered;
    if (q) {
      matched = [];
      for (const r of filtered) {
        const note = parseJson<{ note?: string }>(r.result_json)?.note ?? r.task_result ?? "";
        const cheap = `${r.title}\n${note}\n${parseJson<Meta>(r.meta)?.pr ?? ""}\n${r.id}`.toLowerCase();
        if (cheap.includes(q)) {
          matched.push(r);
          continue;
        }
        if (scannedLogs >= SEARCH_LOG_CAP) {
          searchCapped = true;
          continue;
        }
        scannedLogs++;
        if (logMatches(r.id, q)) matched.push(r);
      }
    }
    const page = matched.slice(0, limit);
    const cost = costs(page.map((r) => r.id));
    return {
      runs: page.map((r) => toSummary(r, cost.get(r.id))),
      total: matched.length,
      scannedLogs,
      searchCapped,
    };
  }

  function rowById(taskId: string): Row | null {
    return (db.prepare(`${BASE_SQL} AND t.id = ?`).get(taskId) as Row | undefined) ?? null;
  }

  function samePrRuns(pr: string): Array<RunRef & { note: string | null }> {
    const rows = db.prepare(`${BASE_SQL} AND t.workflow_meta_json LIKE ?`).all(`%"pr":${JSON.stringify(pr)}%`) as Row[];
    return rows
      .map((r) => {
        const meta = parseJson<Meta>(r.meta) ?? {};
        return {
          taskId: r.id,
          action: meta.action ?? "",
          startedAt: r.started_at ?? r.created_at ?? 0,
          pr: meta.pr,
          note: parseJson<{ note?: string }>(r.result_json)?.note ?? r.task_result ?? null,
        };
      })
      .filter((r) => r.pr === pr);
  }

  function readResult(taskId: string): unknown {
    try {
      return JSON.parse(fs.readFileSync(resultPath(taskId), "utf8"));
    } catch {
      return null;
    }
  }

  function feedbackLookup(pr: string): FeedbackLookup {
    const out: FeedbackLookup = new Map();
    if (!hasTable("pr_patrol_prs")) return out;
    const row = db.prepare("SELECT snapshot_json FROM pr_patrol_prs WHERE pr_key = ?").get(pr) as
      | { snapshot_json: string | null }
      | undefined;
    const snap = parseJson<{ feedback?: Array<Record<string, any>> }>(row?.snapshot_json);
    for (const f of snap?.feedback ?? []) {
      if (typeof f.id !== "string") continue;
      out.set(f.id, {
        author: String(f.author ?? ""),
        path: f.path ?? null,
        line: f.line ?? null,
        url: f.url ?? null,
        excerpt: String(f.excerpt ?? ""),
      });
    }
    return out;
  }

  function clonePath(pr: string): string | null {
    const repo = pr.split("#")[0];
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return null;
    return path.join(workdir, "repos", repo.replace("/", "__"));
  }

  async function resolveSha(clone: string, sha: string): Promise<string | null> {
    try {
      return (await git(clone, ["rev-parse", "--verify", "-q", `${sha}^{commit}`], 15_000)).trim() || null;
    } catch {
      return null;
    }
  }

  /** The run's commits with their diffs, from the repo clone. Fetches a pushed head from origin if missing. */
  async function loadCommits(
    pr: string,
    push: PushInfo,
    logCommits: CommitRef[],
  ): Promise<{ commits: RunCommit[]; error: string | null }> {
    if (push.status !== "pushed" && !logCommits.length) return { commits: [], error: null };
    const clone = clonePath(pr);
    if (!clone || !fs.existsSync(path.join(clone, ".git"))) {
      return { commits: [], error: `no local clone of ${pr.split("#")[0]} under ${path.join(workdir, "repos")}` };
    }
    const listed: Array<{ sha: string; subject: string; author: string | null; date: string | null }> = [];
    try {
      if (push.status === "pushed" && push.head) {
        let head = await resolveSha(clone, push.head);
        if (!head) {
          const n = pr.split("#")[1] ?? "";
          if (/^\d+$/.test(n)) {
            await git(clone, ["fetch", "--no-tags", "--quiet", "origin", `pull/${n}/head`], 120_000).catch(
              () => undefined,
            );
          }
          head = await resolveSha(clone, push.head);
        }
        if (!head) return { commits: [], error: `commit ${push.head} is not in the clone and could not be fetched` };
        const out = await git(clone, [
          "log",
          "--first-parent",
          `-n${Math.max(1, Math.min(push.commits || 1, 20))}`,
          "--format=%H%x1f%s%x1f%an%x1f%aI",
          head,
        ]);
        for (const line of out.split("\n").filter(Boolean)) {
          const [sha, subject, author, date] = line.split("\x1f");
          listed.push({ sha, subject, author: author || null, date: date || null });
        }
      } else {
        // Dry run: commits only ever lived in the worktree; show the ones still in the clone's object store.
        for (const c of logCommits.slice(0, 20)) {
          const sha = await resolveSha(clone, c.sha);
          if (sha) listed.push({ sha, subject: c.subject, author: null, date: null });
        }
        if (!listed.length) return { commits: [], error: "the run's local commits are no longer in the clone" };
      }
    } catch (err) {
      return { commits: [], error: `git: ${(err as Error).message.slice(0, 300)}` };
    }

    let budget = DIFF_CAP;
    const commits: RunCommit[] = [];
    for (const c of listed) {
      let d = diffCache.get(c.sha);
      if (!d) {
        try {
          const raw = await git(clone, ["show", "--stat", "--patch", "--no-color", "--format=", c.sha], 120_000);
          d =
            raw.length > DIFF_CAP ? { diff: raw.slice(0, DIFF_CAP), truncated: true } : { diff: raw, truncated: false };
          diffCache.set(c.sha, d);
          if (diffCache.size > 100) diffCache.delete(diffCache.keys().next().value as string);
        } catch (err) {
          d = { diff: `(git show failed: ${(err as Error).message.slice(0, 200)})`, truncated: false };
        }
      }
      const diff = d.diff.length > budget ? d.diff.slice(0, Math.max(0, budget)) : d.diff;
      budget -= diff.length;
      commits.push({ ...c, diff, diffTruncated: d.truncated || diff.length < d.diff.length });
    }
    return { commits, error: null };
  }

  async function getRun(taskId: string, runIndex?: number): Promise<RunDetail | null> {
    if (!TASK_ID.test(taskId)) return null;
    const row = rowById(taskId);
    if (!row) return null;
    const summary = toSummary(row, costs([taskId]).get(taskId));

    const raw = readTail(logPath(taskId), LOG_READ_CAP);
    const parsed = raw ? parseRunLog(raw) : [];
    const idx =
      runIndex != null && Number.isInteger(runIndex) && runIndex >= 0 && runIndex < parsed.length
        ? runIndex
        : parsed.length - 1;
    const chosen = idx >= 0 ? parsed[idx] : null;
    const log = chosen
      ? (({ commits, ...rest }) => ({ ...rest, runIndex: idx, runCount: parsed.length, logCommits: commits }))(chosen)
      : null;

    const result = readResult(taskId);
    const pr = summary.pr;
    const { commits, error } = pr
      ? await loadCommits(pr, summary.push, chosen?.commits ?? [])
      : { commits: [], error: null };
    const commitRefs: CommitRef[] = commits.map((c) => ({ sha: c.sha, subject: c.subject }));

    let links: RunDetail["links"] = { kind: "none" };
    if (pr && (summary.action === "fix_review" || summary.action === "address_feedback")) {
      let reviewTaskId: string | null = null;
      let findings: FindingRef[] | undefined;
      if (summary.action === "fix_review") {
        const self: RunRef = { taskId, action: summary.action, startedAt: summary.startedAt ?? 0 };
        const review = precedingReview(self, samePrRuns(pr));
        reviewTaskId = review?.taskId ?? null;
        findings = review ? findingsOf(readResult(review.taskId)) : undefined;
      }
      links = {
        kind: "fix",
        reviewTaskId,
        items: mapFixItems(result, commitRefs, {
          findings,
          feedback: summary.action === "address_feedback" ? feedbackLookup(pr) : undefined,
        }),
      };
    } else if (pr && summary.action === "review") {
      const siblings = samePrRuns(pr);
      const fix = followingFixRun({ taskId, action: "review", startedAt: summary.startedAt ?? 0 }, siblings);
      let fixRun: Parameters<typeof mapReviewFindings>[1] = null;
      if (fix) {
        const fixNote = siblings.find((s) => s.taskId === fix.taskId)?.note ?? null;
        const fixPush = parsePushNote(fixNote);
        const fixCommits = await loadCommits(pr, fixPush, []).catch(() => ({ commits: [] as RunCommit[] }));
        fixRun = {
          taskId: fix.taskId,
          result: readResult(fix.taskId),
          commits: fixCommits.commits.map((c) => ({ sha: c.sha, subject: c.subject })),
          head: fixPush.head,
        };
      }
      links = { kind: "review", fixTaskId: fix?.taskId ?? null, findings: mapReviewFindings(result, fixRun) };
    }

    return {
      run: summary,
      log,
      runs: parsed.map((r, i) => ({ index: i, startedAt: r.startedAt, finished: r.finished })),
      result,
      commits,
      commitError: error,
      links,
    };
  }

  return { listRuns, getRun };
}

type Req = { query: Record<string, unknown>; params: Record<string, string> };
type Res = { json(v: unknown): void; status(code: number): Res };
type App = { get(path: string, handler: (req: Req, res: Res) => void): void };

const qs = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

export function registerRunRoutes(ctx: { app: App; db: DatabaseSync; logsDir: string; workdir: string }): void {
  const inspector = createRunInspector(ctx);
  ctx.app.get("/api/pr-patrol/runs", (req, res) => {
    try {
      res.json(
        inspector.listRuns({
          pr: qs(req.query.pr),
          agent: qs(req.query.agent),
          action: qs(req.query.action),
          status: qs(req.query.status),
          q: qs(req.query.q),
          limit: qs(req.query.limit) ? Number(req.query.limit) || undefined : undefined,
        }),
      );
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });
  ctx.app.get("/api/pr-patrol/runs/:taskId", (req, res) => {
    const run = qs(req.query.run);
    inspector
      .getRun(req.params.taskId, run != null ? Number(run) : undefined)
      .then((detail) => (detail ? res.json(detail) : res.status(404).json({ error: "run not found" })))
      .catch((err: Error) => res.status(500).json({ error: err.message }));
  });
}
