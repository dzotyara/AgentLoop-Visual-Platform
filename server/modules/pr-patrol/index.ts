import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { RuntimeContext } from "../../types/runtime-context.ts";
import { loadPrPatrolConfig } from "./config.ts";
import {
  BLOCKING_SEVERITIES,
  checkId,
  decide,
  nitRoundOpen,
  type ActionKind,
  type Decision,
  type ReviewFinding,
} from "./decide.ts";
import { formatReviewComment, normalizeSeverity } from "./review-comment.ts";
import {
  containsCommit,
  createPr,
  enqueuePr,
  fetchPrSnapshot,
  listPatrolledPrs,
  postPrComment,
  prState,
  replyAndResolveThread,
  rerunFailedRuns,
  updateBranch,
  type PrSnapshot,
} from "./github.ts";
import { breakChecks, breakPrs, createBaseBreakStore, type BaseBreakRow } from "./base-breaks.ts";
import { activityFromStreamLines, createLineSplitter } from "./activity.ts";
import { ACTION_PREFIX, buildBaseFixPrompt, buildPatrolPrompt } from "./prompts.ts";
import { createPipelineStore, effectiveConfig, registerPipelineRoutes, stepPolicy } from "./pipeline.ts";
import { registerMetricsRoutes } from "./metrics.ts";
import { createPrPatrolStore, ensurePrPatrolSchema, prKey } from "./store.ts";
import { createCrew, FIXER_HELPERS, PATROL_AGENTS, REVIEWER_HELPERS, type AgentRole, type CrewSeat } from "./crew.ts";
import { registerRunRoutes } from "./runs.ts";
import {
  prepareBranchWorktree,
  preparePrWorktree,
  pushAgentCommits,
  type PrWorkspace,
  type PushOutcome,
} from "./workspace.ts";

export const PR_PATROL_SOURCE = "pr-patrol";

type RunDecision = Extract<Decision, { kind: "run" }>;
type CrewMember = { id: string; name: string };

const ACTION_ROLE: Record<ActionKind, AgentRole> = {
  review: "reviewer",
  fix_review: "fixer",
  address_feedback: "fixer",
  fix_ci: "ci",
  fix_conflict: "conflict",
};

const ACTION_LABEL: Record<ActionKind, string> = {
  review: "Review",
  fix_review: "Fix review findings",
  address_feedback: "Address review comments",
  fix_ci: "Fix CI",
  fix_conflict: "Resolve merge conflict",
};

type Running = {
  taskId: string;
  action: ActionKind;
  agentId: string;
  agentName: string;
  /** What the agent is doing right now, from its tool calls ("Editing foo.ts"). */
  activity: string;
  activityAt: number;
  toolCalls: number;
};

export function createPrPatrol(ctx: RuntimeContext) {
  const { app, db, broadcast, appendTaskLog, spawnCliAgent, activeProcesses, nowMs, logsDir, notifyCeo } = ctx as any;
  const cfg = loadPrPatrolConfig();
  ensurePrPatrolSchema(db);
  const store = createPrPatrolStore(db, nowMs);
  const pipeline = createPipelineStore(db, nowMs);
  const breaks = createBaseBreakStore(db, nowMs);
  /** Runs in flight, by PR key (and `base:<id>` for a base fix). */
  const running = new Map<string, Running>();
  /** Latest snapshot per patrolled PR this tick, for base-breakage upkeep. */
  const snapshots = new Map<string, PrSnapshot>();
  /** (breakage, head) pairs already checked for "this PR proves the base fixed". */
  const probed = new Set<string>();
  /** Last enqueue per PR: GitHub shows the queue entry a moment later, so do not enqueue twice meanwhile. */
  const lastEnqueue = new Map<string, number>();
  let timer: ReturnType<typeof setInterval> | null = null;
  let ticking = false;
  let lastTick: { at: number; error: string | null; prs: number } = { at: 0, error: null, prs: 0 };

  /** Crew seats bound to agent rows by id: renaming an agent in the office keeps its seat. */
  const crewSeats = createCrew(db, (row) => broadcast("agent_created", row));
  const agentId = (role: AgentRole) => crewSeats.agentId(PATROL_AGENTS[role]);
  const member = (id: string, seatKey: string): CrewMember => ({ id, name: crewSeats.name(id, seatKey) });

  const pool = (seats: CrewSeat[]): CrewMember[] => seats.map((seat) => member(crewSeats.agentId(seat), seat.key));
  /** Patch first, then as many helpers as PR_PATROL_FIXERS allows; names are read fresh (agents get renamed). */
  const fixers = (): CrewMember[] => pool([PATROL_AGENTS.fixer, ...FIXER_HELPERS.slice(0, cfg.fixers - 1)]);
  /** Argus first, then as many helpers as PR_PATROL_REVIEWERS allows. */
  const reviewers = (): CrewMember[] => pool([PATROL_AGENTS.reviewer, ...REVIEWER_HELPERS.slice(0, cfg.reviewers - 1)]);
  const crewFor = (role: AgentRole): CrewMember[] =>
    role === "fixer" ? fixers() : role === "reviewer" ? reviewers() : pool([PATROL_AGENTS[role]]);

  /** A free crew member for the role, or null when all of them are on other PRs. */
  function pickAgent(role: AgentRole): CrewMember | null {
    const busy = new Set([...running.values()].map((r) => r.agentId));
    return crewFor(role).find((m) => !busy.has(m.id)) ?? null;
  }

  function setAgent(id: string, working: boolean, taskId: string | null, success = false): void {
    if (working) {
      db.prepare("UPDATE agents SET status = 'working', current_task_id = ? WHERE id = ?").run(taskId, id);
    } else {
      db.prepare(
        `UPDATE agents SET status = 'idle', current_task_id = NULL,
           stats_tasks_done = stats_tasks_done + ?, stats_xp = stats_xp + ? WHERE id = ?`,
      ).run(success ? 1 : 0, success ? 10 : 0, id);
    }
    broadcast("agent_status", db.prepare("SELECT * FROM agents WHERE id = ?").get(id));
  }

  function createTask(
    s: Pick<PrSnapshot, "repo" | "number" | "url">,
    title: string,
    role: AgentRole,
    status: "in_progress" | "done",
    description: string,
    action: string,
    assignee?: string,
  ): string {
    const id = randomUUID();
    const t = nowMs();
    const a = PATROL_AGENTS[role];
    db.prepare(
      `INSERT INTO tasks (id, title, description, department_id, assigned_agent_id, status, priority, task_type,
         workflow_meta_json, project_path, started_at, completed_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, 'development', ?, NULL, ?, ?, ?, ?)`,
    ).run(
      id,
      title,
      description,
      a.dept,
      assignee ?? agentId(role),
      status,
      JSON.stringify({
        source: PR_PATROL_SOURCE,
        pr: s.number > 0 ? prKey(s.repo, s.number) : s.repo,
        url: s.url,
        action,
      }),
      t,
      status === "done" ? t : null,
      t,
      t,
    );
    appendTaskLog(id, "system", `${PR_PATROL_SOURCE}: ${title} — ${s.url}`);
    broadcast("task_update", db.prepare("SELECT * FROM tasks WHERE id = ?").get(id));
    return id;
  }

  function finishTask(taskId: string, ok: boolean, result: string): void {
    const t = nowMs();
    db.prepare("UPDATE tasks SET status = ?, result = ?, completed_at = ?, updated_at = ? WHERE id = ?").run(
      ok ? "done" : "cancelled",
      result.slice(0, 4000),
      t,
      t,
      taskId,
    );
    db.prepare("UPDATE subtasks SET status = 'done' WHERE task_id = ? AND status != 'done'").run(taskId);
    appendTaskLog(taskId, ok ? "system" : "error", result.slice(0, 2000));
    broadcast("task_update", db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId));
  }

  function readResult(resultPath: string): any {
    try {
      return JSON.parse(fs.readFileSync(resultPath, "utf8"));
    } catch {
      return null;
    }
  }

  const pushNote = (p: PushOutcome): string =>
    p.status === "pushed"
      ? `pushed ${p.commits} commit(s), head ${p.head.slice(0, 7)}`
      : p.status === "dry_run"
        ? `${p.commits} commit(s) made locally, not pushed (dry run: PR_PATROL_WRITE=0)`
        : p.status === "rejected"
          ? `push rejected: ${p.error}`
          : p.status === "dirty"
            ? `agent left uncommitted changes:\n${p.files}`
            : p.status === "rewrote_history"
              ? "agent rewrote branch history; nothing pushed"
              : "no changes";
  const advanced = (p: PushOutcome) => p.status === "pushed" || p.status === "dry_run";

  /** Applies one finished agent run to the PR: push, record review/feedback state, side effects. */
  async function settle(
    key: string,
    s: PrSnapshot,
    d: RunDecision,
    ws: PrWorkspace,
    result: any,
    exitCode: number,
  ): Promise<{ ok: boolean; note: string }> {
    const summary = typeof result?.summary === "string" ? result.summary : "";
    if (!result) return { ok: false, note: `agent exited with code ${exitCode} and wrote no result` };

    if (d.action === "review") {
      const findings: ReviewFinding[] = (Array.isArray(result.findings) ? result.findings : []).map(
        (f: ReviewFinding) => ({ ...f, severity: normalizeSeverity(f.severity) }),
      );
      const blocking = findings.filter((f) => BLOCKING_SEVERITIES.has(f.severity));
      const minor = findings.filter((f) => !BLOCKING_SEVERITIES.has(f.severity));
      // An approving final review gets its card from Gate on "ready" (one card per head, with the verdict);
      // a final review with P0/P1 posts "Not approved" now, and one whose P2/P3 still get a round posts as usual.
      const approving =
        d.final === true &&
        blocking.length === 0 &&
        (minor.length === 0 ||
          !nitRoundOpen(
            store.memory(key),
            cfg,
            minor.every((f) => f.severity === "P3"),
          ));
      store.recordReview(key, ws.startSha, blocking, minor);
      const list = findings
        .map((f) => `- [${f.severity}] ${f.file ?? ""}${f.line ? `:${f.line}` : ""} ${f.title}`)
        .join("\n");
      // The review goes on the PR as a [review] comment (write mode only); the fixes follow as [fix] commits.
      let posted = approving ? "final review approved: Gate posts the card on ready" : "not posted (dry run)";
      if (cfg.write && !approving) {
        try {
          const body = formatReviewComment({
            findings,
            summary,
            reviewer: crewSeats.name(agentId("reviewer"), PATROL_AGENTS.reviewer.key),
            headSha: ws.startSha,
            final: d.final === true && blocking.length > 0,
          });
          posted = `posted ${await postPrComment(s.repo, s.number, body)}`;
        } catch (err) {
          posted = `comment failed: ${(err as Error).message.slice(0, 200)}`;
        }
      }
      return {
        ok: true,
        note: `review: ${blocking.length} blocking (P0/P1) of ${findings.length} finding(s); ${posted}. ${summary}\n${list}`,
      };
    }

    const push = await pushAgentCommits(ws, s, cfg.write, ACTION_PREFIX[d.action]);
    const items: any[] = Array.isArray(result.items) ? result.items : [];

    if (d.action === "fix_ci") {
      if (result.classification === "base" && push.status === "no_changes") {
        const failing = d.failingChecks ?? [];
        const named: string[] = Array.isArray(result.base_checks) ? result.base_checks.map(String) : [];
        const picked = failing
          .filter((c) => named.length === 0 || named.some((n) => n === checkId(c) || n === c.name))
          .map(checkId);
        const checks = picked.length ? picked : failing.map(checkId);
        const b = breaks.record({
          repo: s.repo,
          base: s.baseRefName,
          baseSha: s.baseRefOid,
          checks,
          detail: summary,
          pr: key,
        });
        return {
          ok: true,
          note: `base breakage: ${checks.join(", ")} fail on ${s.baseRefName} too (breakage ${b.id}); the PR waits for the base fix. ${summary}`,
        };
      }
      const infra = result.classification === "flaky" || result.classification === "infra";
      if (push.status === "no_changes" && infra) {
        const reruns = cfg.write ? await rerunFailedRuns(s.repo, d.failingChecks ?? []) : [];
        return {
          ok: true,
          note: `${result.classification} failure; ${cfg.write ? `re-ran failed jobs of ${reruns.length} run(s)` : "rerun skipped (dry run)"}. ${summary}`,
        };
      }
      return { ok: advanced(push), note: `${pushNote(push)}. ${summary}` };
    }

    if (d.action === "fix_conflict") return { ok: advanced(push), note: `${pushNote(push)}. ${summary}` };

    if (d.action === "fix_review") {
      const allDeclined = items.length > 0 && items.every((i) => i.verdict === "declined");
      if (push.status === "no_changes" && allDeclined) {
        store.recordReview(key, ws.startSha, []); // findings judged invalid: nothing left to block on
        return { ok: true, note: `all findings declined. ${summary}` };
      }
      return { ok: advanced(push), note: `${pushNote(push)}. ${summary}` };
    }

    // address_feedback
    if (!(advanced(push) || push.status === "no_changes")) return { ok: false, note: `${pushNote(push)}. ${summary}` };
    // The agent answers per comment id; remember the exact version it saw (id + text hash).
    const keyById = new Map((d.feedback ?? []).map((f) => [f.id, f.key]));
    const handled = items
      .filter((i) => i.verdict !== "blocked")
      .map((i) => keyById.get(String(i.feedback_id)))
      .filter((k): k is string => Boolean(k));
    store.addHandledFeedback(key, handled);
    let replied = 0;
    if (cfg.write && cfg.replyToThreads && push.status !== "dry_run") {
      for (const i of items) {
        const fb = d.feedback?.find((f) => f.id === i.feedback_id);
        if (fb?.kind !== "review_thread" || !i.reply_text || !String(i.verdict).startsWith("fixed")) continue;
        try {
          await replyAndResolveThread(fb.id, `${ACTION_PREFIX[d.action]} ${i.reply_text}`);
          replied++;
        } catch (err) {
          appendTaskLog(running.get(key)?.taskId, "error", `thread reply failed: ${(err as Error).message}`);
        }
      }
    }
    return {
      ok: true,
      note: `${pushNote(push)}; ${handled.length}/${d.feedback?.length ?? 0} item(s) handled${replied ? `, ${replied} thread(s) replied+resolved` : ""}. ${summary}`,
    };
  }

  /**
   * Model for a run: the pipeline's per-step override, then the agent's own pick, then Settings → Claude main
   * model, then PR_PATROL_MODEL; none = CLI default.
   */
  function resolveModel(agentId: string, action: ActionKind): string | undefined {
    const stepModel = pipeline.get().steps[action]?.model;
    if (stepModel) return stepModel;
    const agent = db.prepare("SELECT cli_model FROM agents WHERE id = ?").get(agentId) as
      | { cli_model: string | null }
      | undefined;
    if (agent?.cli_model) return agent.cli_model;
    try {
      const row = db.prepare("SELECT value FROM settings WHERE key = 'providerModelConfig'").get() as
        | { value: string }
        | undefined;
      const model = row ? (JSON.parse(row.value) as { claude?: { model?: string } }).claude?.model : undefined;
      if (model) return model;
    } catch {
      // malformed settings row: fall through to the env default
    }
    return cfg.model;
  }

  /** Live "what is the agent doing" line, pushed to the office and the PR page. Throttled per PR. */
  const lastActivityBroadcast = new Map<string, number>();
  function setActivity(key: string, activity: string): void {
    const run = running.get(key);
    if (!run) return;
    run.activity = activity;
    run.activityAt = nowMs();
    const last = lastActivityBroadcast.get(key) ?? 0;
    if (run.activityAt - last < 800) return;
    lastActivityBroadcast.set(key, run.activityAt);
    broadcast("pr_patrol_activity", {
      pr: key,
      agentId: run.agentId,
      action: run.action,
      activity,
      toolCalls: run.toolCalls,
      at: run.activityAt,
    });
  }

  async function launch(key: string, s: PrSnapshot, d: RunDecision, crew: CrewMember, role: AgentRole): Promise<void> {
    const aId = crew.id;
    const label = d.escalated ? `${ACTION_LABEL[d.action]} (escalated)` : ACTION_LABEL[d.action];
    const title = `${ACTION_PREFIX[d.action]} [${s.repo.split("/")[1]}#${s.number}] ${label}: ${s.title}`.slice(0, 200);
    const taskId = createTask(
      s,
      title,
      role,
      "in_progress",
      `${s.url}\nhead ${s.headRefOid}\naction ${d.key}`,
      d.action,
      aId,
    );
    running.set(key, {
      taskId,
      action: d.action,
      agentId: aId,
      agentName: crew.name,
      activity: "Preparing the worktree",
      activityAt: nowMs(),
      toolCalls: 0,
    });
    store.startAction(key, d.key, d.action, taskId);
    store.setPhase(key, "working", `${crew.name}: ${label}`);
    setAgent(aId, true, taskId);

    const done = async (ok: boolean, note: string) => {
      store.finishAction(key, d.key, ok ? "done" : "failed", { note });
      finishTask(taskId, ok, note);
      setAgent(aId, false, null, ok);
      running.delete(key);
      setTimeout(() => void tick(), 5_000); // keep the loop moving without waiting a full interval
    };

    let ws: PrWorkspace;
    try {
      ws = await preparePrWorktree(cfg.workdir, s);
    } catch (err) {
      await done(false, `worktree setup failed: ${(err as Error).message}`);
      return;
    }
    db.prepare("UPDATE tasks SET project_path = ? WHERE id = ?").run(ws.path, taskId);

    const resultDir = path.join(cfg.workdir, "results");
    fs.mkdirSync(resultDir, { recursive: true });
    const resultPath = path.join(resultDir, `${taskId}.json`);
    const history = d.escalated ? store.actionNotes(key, `ci:${s.headRefOid}`) : [];
    const prompt = buildPatrolPrompt(s, d, resultPath, history);
    const model = resolveModel(aId, d.action);
    if (model) appendTaskLog(taskId, "system", `${PR_PATROL_SOURCE}: model ${model}`);
    const child = spawnCliAgent(taskId, "claude", prompt, ws.path, path.join(logsDir, `${taskId}.log`), model);
    setActivity(key, "Starting Claude Code");
    child.stdout?.on(
      "data",
      createLineSplitter((lines) => {
        const acts = activityFromStreamLines(lines);
        const run = running.get(key);
        if (run && acts.length) run.toolCalls += acts.length;
        if (acts.length) setActivity(key, acts[acts.length - 1]);
      }),
    );
    // A spawn failure emits "error" and may or may not emit "close": settle exactly once either way.
    let settled = false;
    child.on("error", (err: Error) => {
      if (settled) return;
      settled = true;
      void done(false, `could not start claude: ${err.message}`);
    });
    child.on("close", (code: number | null) => {
      activeProcesses.delete(taskId);
      if (settled) return;
      settled = true;
      settle(key, s, d, ws, readResult(resultPath), code ?? 1)
        .then((r) => done(r.ok, r.note))
        .catch((err) => done(false, `settle failed: ${(err as Error).message}`));
    });
  }

  async function patrolOne(repo: string, number: number): Promise<void> {
    const key = prKey(repo, number);
    const s = await fetchPrSnapshot(repo, number, cfg);
    store.upsertPr({ pr_key: key, repo, number, title: s.title, url: s.url, head_sha: s.headRefOid });
    const handled = store.memory(key).handledFeedbackIds;
    store.setSnapshot(key, {
      headRefName: s.headRefName,
      baseRefName: s.baseRefName,
      isDraft: s.isDraft,
      mergeable: s.mergeable,
      mergeStateStatus: s.mergeStateStatus,
      reviewDecision: s.reviewDecision,
      mergeQueue: s.mergeQueue ?? null,
      checks: s.checks.map((c) => ({ ...c, ignored: cfg.ignoredChecks.includes(c.name) })),
      feedback: s.feedback.map((f) => ({
        id: f.id,
        kind: f.kind,
        author: f.author,
        path: f.path,
        line: f.line,
        url: f.url,
        excerpt: f.body.slice(0, 280),
        handled: handled.has(f.key) || f.inProgress || f.severity === "none",
        severity: f.severity,
        inProgress: f.inProgress,
      })),
      fetchedAt: nowMs(),
    });
    snapshots.set(key, s);
    const redSince = store.trackRed(
      key,
      s.checks.some((c) => c.state === "failure" && !cfg.ignoredChecks.includes(c.name)),
    );
    if (running.has(key)) return;

    // Pipeline settings (edited from the loop graph) are re-read on every tick, layered over the env config.
    const pipe = pipeline.get();
    const eff = effectiveConfig(cfg, pipe);
    const baseBreaks = breaks.forDecide(s.repo, s.baseRefName, s.headRefName);
    const mem = store.memory(key);
    const d = decide(s, eff, mem, stepPolicy(pipe), { baseBreaks, now: nowMs(), redSince });
    switch (d.kind) {
      case "skip":
        store.setPhase(key, "skipped", d.reason);
        return;
      case "wait":
        store.setPhase(key, "waiting", d.reason, d.notes, d.on);
        if (d.on === "base") {
          const failing = new Set(s.checks.filter((c) => c.state === "failure").map(checkId));
          for (const b of baseBreaks) if (b.checks.some((c) => failing.has(c))) breaks.addPr(b.id, key);
        }
        return;
      case "sync":
        await syncBase(key, s, d.key, d.reason);
        return;
      case "blocked":
        store.setPhase(key, "blocked", d.reasons.join("; "), d.notes, "you");
        return;
      case "merging":
        store.setPhase(key, "merging", d.reason, d.notes, "github");
        return;
      case "ready":
        store.setPhase(
          key,
          "ready",
          d.approval
            ? "checks green, no conflicts, feedback handled, final review approved"
            : "checks green, no conflicts, feedback handled",
          d.notes,
        );
        if (store.markReady(key, s.headRefOid)) {
          if (d.approval && cfg.write) {
            const body = formatReviewComment({
              findings: d.approval.minor,
              summary: "",
              reviewer: crewSeats.name(agentId("reviewer"), PATROL_AGENTS.reviewer.key),
              headSha: d.approval.sha,
              final: true,
            });
            await postPrComment(s.repo, s.number, body).catch((err) =>
              console.warn(`[pr-patrol] final review card on ${key} failed: ${(err as Error).message}`),
            );
          }
          const note = `Ready: ${s.url}${d.notes.length ? ` (${d.notes.join("; ")})` : ""}`;
          createTask(
            s,
            `[ready] [${repo.split("/")[1]}#${number}] ${s.title}`.slice(0, 200),
            "gate",
            "done",
            note,
            "ready",
          );
          notifyCeo?.(`[ready] ${repo}#${number} is ready to merge — ${s.title}`);
        }
        if (cfg.autoEnqueue && (d.approval || !eff.review)) await autoEnqueue(key, s, mem, d.notes);
        return;
      case "run": {
        if (running.size >= eff.maxConcurrent) {
          store.setPhase(key, "watching", `queued: ${ACTION_LABEL[d.action]} (all agent slots busy)`, [], "agent");
          return;
        }
        const role: AgentRole = d.escalated ? "fixer" : ACTION_ROLE[d.action];
        const crew = pickAgent(role);
        if (!crew) {
          const members = crewFor(role);
          const who = members.length > 1 ? `all ${members.length} ${role}s are` : `${members[0].name} is`;
          store.setPhase(key, "watching", `queued: ${ACTION_LABEL[d.action]} (${who} busy on other PRs)`, [], "agent");
          return;
        }
        // Not awaited: a first clone of a big repo would otherwise stall the tick and idle the other slots.
        // launch() claims its `running` slot synchronously, before its first await.
        void launch(key, s, d, crew, role).catch((err) => {
          running.delete(key);
          store.setPhase(key, "error", `launch failed: ${(err as Error).message.slice(0, 400)}`, [], "you");
        });
      }
    }
  }

  /** Weaver merges the base into the PR on GitHub ("Update branch"): the new head gets fresh CI rounds. */
  async function syncBase(key: string, s: PrSnapshot, actionKey: string, reason: string): Promise<void> {
    if (!cfg.write) {
      store.setPhase(key, "waiting", `${reason}: would merge ${s.baseRefName} in (dry run)`, [], "agent");
      return;
    }
    const title = `[fix] [${s.repo.split("/")[1]}#${s.number}] Merge ${s.baseRefName} in: ${s.title}`.slice(0, 200);
    const taskId = createTask(s, title, "conflict", "in_progress", `${s.url}\n${reason}`, "sync_base");
    store.startAction(key, actionKey, "sync_base", taskId);
    let ok = true;
    let note: string;
    try {
      await updateBranch(s.repo, s.number, s.headRefOid);
      note = `merged ${s.baseRefName} into the branch (${reason}); CI reruns on the new head`;
    } catch (err) {
      ok = false;
      note = `merging ${s.baseRefName} in failed: ${(err as Error).message.slice(0, 300)}`;
    }
    store.finishAction(key, actionKey, ok ? "done" : "failed", { note });
    finishTask(taskId, ok, note);
    store.setPhase(key, "waiting", note, [], ok ? "ci" : "agent");
  }

  /**
   * Gate puts a ready PR into the merge queue, and back in after an ejection that left the head unchanged
   * (up to cfg.maxEnqueuesPerHead per head). Repos without a merge queue refuse; the PR then stays "ready".
   */
  async function autoEnqueue(key: string, s: PrSnapshot, mem: ReturnType<typeof store.memory>, notes: string[]) {
    if (!cfg.write || !s.nodeId) return;
    if (nowMs() - (lastEnqueue.get(key) ?? 0) < 10 * 60_000) return;
    const head = s.headRefOid;
    const done = [...mem.actions].filter(([k, a]) => k.startsWith(`enqueue:${head}:`) && a.status === "done").length;
    if (done >= cfg.maxEnqueuesPerHead) return;
    const actionKey = `enqueue:${head}:${done}`;
    if ((mem.actions.get(actionKey)?.attempts ?? 0) >= cfg.maxAttempts) return;
    lastEnqueue.set(key, nowMs());
    const taskId = createTask(
      s,
      `[ready] [${s.repo.split("/")[1]}#${s.number}] Enqueue: ${s.title}`.slice(0, 200),
      "gate",
      "in_progress",
      s.url,
      "enqueue",
    );
    store.startAction(key, actionKey, "enqueue", taskId);
    try {
      const position = await enqueuePr(s.nodeId);
      const note = `${done ? "re-added" : "added"} to the merge queue${position ? ` (position ${position})` : ""}`;
      store.finishAction(key, actionKey, "done", { note });
      finishTask(taskId, true, note);
      store.setPhase(key, "merging", `Gate ${note}`, notes, "github");
    } catch (err) {
      const note = `enqueue failed: ${(err as Error).message.slice(0, 300)}`;
      store.finishAction(key, actionKey, "failed", { note });
      finishTask(taskId, false, note);
    }
  }

  /** Medic opens one fix PR against the base for a breakage that holds enough PRs; the loop then patrols it. */
  async function launchBaseFix(b: BaseBreakRow, prs: string[]): Promise<void> {
    const runKey = `base:${b.id}`;
    const crew = pickAgent("ci");
    if (!crew || running.has(runKey) || running.size >= effectiveConfig(cfg, pipeline.get()).maxConcurrent) return;
    const branch = `pr-loop/base-fix-${b.id}-${b.fix_attempts + 1}`;
    const checks = breakChecks(b);
    const pseudo = { repo: b.repo, number: 0, url: `https://github.com/${b.repo}/tree/${b.base}` };
    const taskId = createTask(
      pseudo,
      `[fix] [${b.repo.split("/")[1]}:${b.base}] Fix the base: ${checks.join(", ")}`.slice(0, 200),
      "ci",
      "in_progress",
      `${checks.join("\n")}\nholding: ${prs.join(", ")}`,
      "fix_base",
      crew.id,
    );
    running.set(runKey, {
      taskId,
      action: "fix_ci",
      agentId: crew.id,
      agentName: crew.name,
      activity: "Preparing the worktree",
      activityAt: nowMs(),
      toolCalls: 0,
    });
    setAgent(crew.id, true, taskId);
    const done = (ok: boolean, note: string) => {
      if (!ok) breaks.fixFailed(b.id, note);
      finishTask(taskId, ok, note);
      setAgent(crew.id, false, null, ok);
      running.delete(runKey);
    };
    let ws: PrWorkspace;
    try {
      ws = await prepareBranchWorktree(cfg.workdir, b.repo, b.base, branch);
    } catch (err) {
      done(false, `worktree setup failed: ${(err as Error).message}`);
      return;
    }
    db.prepare("UPDATE tasks SET project_path = ? WHERE id = ?").run(ws.path, taskId);
    const resultDir = path.join(cfg.workdir, "results");
    fs.mkdirSync(resultDir, { recursive: true });
    const resultPath = path.join(resultDir, `${taskId}.json`);
    const prompt = buildBaseFixPrompt({ repo: b.repo, base: b.base, branch, checks, detail: b.detail, prs, resultPath });
    const model = resolveModel(crew.id, "fix_ci");
    const child = spawnCliAgent(taskId, "claude", prompt, ws.path, path.join(logsDir, `${taskId}.log`), model);
    child.stdout?.on(
      "data",
      createLineSplitter((lines) => {
        const acts = activityFromStreamLines(lines);
        const run = running.get(runKey);
        if (run && acts.length) {
          run.toolCalls += acts.length;
          run.activity = acts[acts.length - 1];
          run.activityAt = nowMs();
        }
      }),
    );
    let settled = false;
    child.on("error", (err: Error) => {
      if (settled) return;
      settled = true;
      done(false, `could not start claude: ${err.message}`);
    });
    child.on("close", (code: number | null) => {
      activeProcesses.delete(taskId);
      if (settled) return;
      settled = true;
      void (async () => {
        const result = readResult(resultPath);
        if (!result) return done(false, `agent exited with code ${code ?? 1} and wrote no result`);
        const push = await pushAgentCommits(ws, { repo: b.repo, headRefName: branch }, cfg.write, "[fix]");
        if (push.status !== "pushed") return done(false, `${pushNote(push)}. ${result.summary ?? ""}`);
        const links = prs.map((k) => `- ${k}`).join("\n");
        const body = `${String(result.body ?? result.summary ?? "").trim()}

---
Opened by AgentLoop pr-patrol: these checks fail on \`${b.base}\` itself and hold these PRs:
${links}

🤖 Generated with [Claude Code](https://claude.com/claude-code)`;
        const title = String(result.title ?? "").trim() || `Fix ${checks.join(", ")} on ${b.base}`;
        try {
          const pr = await createPr(b.repo, { base: b.base, head: branch, title, body });
          breaks.setFix(b.id, { pr: pr.number, url: pr.url, branch });
          done(true, `opened ${pr.url}. ${result.summary ?? ""}`);
        } catch (err) {
          done(false, `branch ${branch} pushed, opening the PR failed: ${(err as Error).message.slice(0, 300)}`);
        }
      })().catch((err) => done(false, `base fix failed: ${(err as Error).message}`));
    });
  }

  /** PRs this breakage holds right now: same repo + base, failing at least one of its checks. */
  function heldBy(b: BaseBreakRow): Array<[string, PrSnapshot]> {
    const checks = new Set(breakChecks(b));
    return [...snapshots].filter(
      ([, s]) =>
        s.repo === b.repo &&
        s.baseRefName === b.base &&
        s.headRefName !== b.fix_branch &&
        s.checks.some((c) => c.state === "failure" && checks.has(checkId(c))),
    );
  }

  /** The base is fixed: Weaver merges it into every PR the breakage held, so their CI runs on the fix. */
  async function resolveBreak(b: BaseBreakRow, reason: string): Promise<void> {
    breaks.resolve(b.id, reason);
    for (const [key, s] of heldBy(b)) {
      if (running.has(key)) continue;
      const actionKey = `sync-base:${b.id}:${s.headRefOid}`;
      if (store.memory(key).actions.get(actionKey)?.status === "done") continue;
      await syncBase(key, s, actionKey, reason);
    }
  }

  /**
   * Base breakages, once per tick: resolve the ones whose fix PR merged, or that a PR containing the broken base
   * now passes; drop the ones no PR fails any more; open a fix PR for the ones holding enough PRs.
   */
  async function maintainBreaks(): Promise<void> {
    for (const b of breaks.live()) {
      const checks = breakChecks(b);
      if (b.fix_pr) {
        const st = await prState(b.repo, b.fix_pr).catch(() => null);
        if (st?.merged) {
          await resolveBreak(b, `base fix #${b.fix_pr} merged`);
          continue;
        }
        if (st?.state === "CLOSED") breaks.fixFailed(b.id, `fix PR #${b.fix_pr} was closed unmerged`);
      }
      let fixed = false;
      for (const [, s] of snapshots) {
        if (s.repo !== b.repo || s.baseRefName !== b.base) continue;
        if (!checks.every((id) => s.checks.some((c) => checkId(c) === id && c.state === "success"))) continue;
        const probe = `${b.id}:${s.headRefOid}`;
        if (probed.has(probe)) continue;
        probed.add(probe);
        if (await containsCommit(b.repo, b.base_sha, s.headRefOid).catch(() => false)) {
          await resolveBreak(b, `${s.repo}#${s.number} contains the broken ${b.base} and passes ${checks.join(", ")}`);
          fixed = true;
          break;
        }
      }
      if (fixed) continue;
      const held = heldBy(b);
      if (held.length === 0 && nowMs() - b.updated_at > 6 * 3_600_000) {
        breaks.resolve(b.id, "no open PR fails these checks any more");
        continue;
      }
      const prs = [...new Set([...breakPrs(b).filter((k) => snapshots.has(k)), ...held.map(([k]) => k)])];
      if (cfg.baseFix && cfg.write && b.status === "open" && !b.fix_pr && prs.length >= cfg.baseFixMinPrs)
        await launchBaseFix(b, prs);
    }
  }

  /** One message a day listing the PRs that wait on you, instead of a ping per PR. */
  function needsYouDigest(): void {
    db.exec("CREATE TABLE IF NOT EXISTS pr_patrol_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    const row = db.prepare("SELECT value FROM pr_patrol_meta WHERE key = 'needs_you_digest_at'").get() as
      | { value: string }
      | undefined;
    if (nowMs() - Number(row?.value ?? 0) < 24 * 3_600_000) return;
    const blocked = store.listPrs().filter((r) => r.phase === "blocked");
    if (blocked.length === 0) return;
    const lines = blocked.map((r) => `- ${r.repo.split("/")[1]}#${r.number} ${r.title}: ${r.summary}`.slice(0, 300));
    notifyCeo?.(`[needs you] ${blocked.length} PR(s) the agents could not finish:\n${lines.join("\n")}`);
    db.prepare(
      "INSERT INTO pr_patrol_meta (key, value) VALUES ('needs_you_digest_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    ).run(String(nowMs()));
  }

  async function tick(): Promise<void> {
    if (ticking) return;
    ticking = true;
    try {
      const prs = await listPatrolledPrs(cfg);
      for (const pr of prs) {
        try {
          await patrolOne(pr.repo, pr.number);
        } catch (err) {
          const key = prKey(pr.repo, pr.number);
          store.upsertPr({ pr_key: key, repo: pr.repo, number: pr.number, title: "", url: "", head_sha: "" });
          store.setPhase(key, "error", (err as Error).message.slice(0, 500), [], "you");
        }
      }
      const open = new Set(prs.map((p) => prKey(p.repo, p.number)));
      for (const k of snapshots.keys()) if (!open.has(k)) snapshots.delete(k);
      store.forgetMissing(open);
      await maintainBreaks().catch((err) => console.warn(`[pr-patrol] base breakages: ${(err as Error).message}`));
      needsYouDigest();
      lastTick = { at: nowMs(), error: null, prs: prs.length };
    } catch (err) {
      lastTick = { at: nowMs(), error: (err as Error).message.slice(0, 500), prs: lastTick.prs };
    } finally {
      ticking = false;
      broadcast("pr_patrol_update", status());
    }
  }

  function status() {
    return {
      enabled: cfg.enabled,
      write: cfg.write,
      replyToThreads: cfg.replyToThreads,
      review: cfg.review,
      intervalMs: cfg.intervalMs,
      maxConcurrent: effectiveConfig(cfg, pipeline.get()).maxConcurrent,
      lastTick,
      running: Object.fromEntries(running),
      /** Agent id -> crew seat (Argus, Patch, Rivet, Splice, Medic, Weaver, Gate), stable across renames. */
      crew: crewSeats.seats(),
      /** Base branches broken for every PR into them, and the fix PR Medic opened, if any. */
      baseBreaks: breaks.live().map((b) => ({
        id: b.id,
        repo: b.repo,
        base: b.base,
        checks: breakChecks(b),
        prs: breakPrs(b),
        status: b.status,
        fixPr: b.fix_pr,
        fixUrl: b.fix_url,
        note: b.note,
        since: b.first_seen,
      })),
      prs: store.listPrs().map((r) => {
        const run = running.get(r.pr_key);
        return {
          ...r,
          notes: JSON.parse(r.notes_json) as string[],
          snapshot: r.snapshot_json ? JSON.parse(r.snapshot_json) : null,
          agent: run
            ? {
                id: run.agentId,
                name: run.agentName,
                action: run.action,
                taskId: run.taskId,
                activity: run.activity,
                activityAt: run.activityAt,
                toolCalls: run.toolCalls,
              }
            : null,
          actions: store.listActions(r.pr_key).map((a) => ({
            action: a.action,
            status: a.status,
            attempts: a.attempts,
            taskId: a.task_id,
            updatedAt: a.updated_at,
            note: (a.result_json ? (JSON.parse(a.result_json)?.note as string | undefined) : undefined) ?? null,
          })),
        };
      }),
    };
  }

  function registerRoutes(): void {
    registerRunRoutes({ app, db, logsDir, workdir: cfg.workdir });
    app.get("/api/pr-patrol/status", (_req: unknown, res: { json(v: unknown): void }) => res.json(status()));
    registerMetricsRoutes(app, db, path.join(cfg.workdir, "results"), nowMs);
    app.post("/api/pr-patrol/tick", (_req: unknown, res: { json(v: unknown): void }) => {
      void tick();
      res.json({ ok: true });
    });
    registerPipelineRoutes(app, pipeline, cfg);
  }

  function start(): void {
    if (!cfg.enabled) {
      console.log("[pr-patrol] disabled (PR_PATROL_ENABLED=0)");
      return;
    }
    const interrupted = store.failInterruptedActions();
    const redo = store.syncWriteMode(cfg.write);
    if (redo) console.log(`[pr-patrol] write mode on: ${redo} dry-run fix(es) will be redone and pushed`);
    // Rows left in_progress by a crash: the stock orphan recovery skips patrol tasks, so close them here.
    db.prepare(
      "UPDATE tasks SET status = 'cancelled', updated_at = ? WHERE status = 'in_progress' AND workflow_meta_json LIKE ?",
    ).run(nowMs(), `%"source":"${PR_PATROL_SOURCE}"%`);
    for (const role of Object.keys(PATROL_AGENTS) as AgentRole[]) agentId(role); // bind every seat up front
    fixers(); // and the helper fixers and reviewers, so they show in the office
    reviewers();
    console.log(
      `[pr-patrol] on: query "${cfg.searchQuery}", every ${cfg.intervalMs / 1000}s, write=${cfg.write}, review=${cfg.review}` +
        (interrupted ? `, ${interrupted} interrupted action(s) will retry` : ""),
    );
    setTimeout(() => void tick(), 8_000);
    timer = setInterval(() => void tick(), cfg.intervalMs);
  }

  function stop(): void {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return { registerRoutes, start, stop, tick, status };
}
