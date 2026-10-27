import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { RuntimeContext } from "../../types/runtime-context.ts";
import { loadPrPatrolConfig } from "./config.ts";
import { BLOCKING_SEVERITIES, decide, type ActionKind, type Decision, type ReviewFinding } from "./decide.ts";
import { formatReviewComment, normalizeSeverity } from "./review-comment.ts";
import {
  fetchPrSnapshot,
  listPatrolledPrs,
  postPrComment,
  replyAndResolveThread,
  rerunFailedRuns,
  type PrSnapshot,
} from "./github.ts";
import { activityFromStreamLines, createLineSplitter } from "./activity.ts";
import { ACTION_PREFIX, buildPatrolPrompt } from "./prompts.ts";
import { createPipelineStore, effectiveConfig, registerPipelineRoutes, stepPolicy } from "./pipeline.ts";
import { registerMetricsRoutes } from "./metrics.ts";
import { createPrPatrolStore, ensurePrPatrolSchema, prKey } from "./store.ts";
import { preparePrWorktree, pushAgentCommits, type PrWorkspace, type PushOutcome } from "./workspace.ts";

export const PR_PATROL_SOURCE = "pr-patrol";

type RunDecision = Extract<Decision, { kind: "run" }>;
type AgentRole = "reviewer" | "fixer" | "ci" | "conflict" | "gate";

/** The patrol's own staff: they sit in the pixel office and pick up the loop's tasks. */
const PATROL_AGENTS: Record<
  AgentRole,
  { name: string; dept: string; role: string; emoji: string; sprite: number; personality: string }
> = {
  reviewer: {
    name: "Argus",
    dept: "qa",
    role: "senior",
    emoji: "scope",
    sprite: 7,
    personality: "PR reviewer: correctness, silent failures, security",
  },
  fixer: {
    name: "Patch",
    dept: "dev",
    role: "senior",
    emoji: "wrench",
    sprite: 3,
    personality: "Applies review findings and reviewer comments",
  },
  ci: {
    name: "Medic",
    dept: "devsecops",
    role: "senior",
    emoji: "medkit",
    sprite: 9,
    personality: "Reads failing CI logs and fixes the branch",
  },
  conflict: {
    name: "Weaver",
    dept: "dev",
    role: "junior",
    emoji: "bomb",
    sprite: 11,
    personality: "Merges the base branch and resolves conflicts",
  },
  gate: {
    name: "Gate",
    dept: "operations",
    role: "senior",
    emoji: "shield",
    sprite: 5,
    personality: "Declares a PR ready once checks, threads and review are clean",
  },
};

/** Extra fixers beyond Patch, enabled by PR_PATROL_FIXERS (each works a different PR). */
const FIXER_HELPERS: Array<(typeof PATROL_AGENTS)[AgentRole]> = [
  {
    name: "Rivet",
    dept: "dev",
    role: "junior",
    emoji: "wrench",
    sprite: 4,
    personality: "Second fixer: review findings and comments on another PR",
  },
  {
    name: "Splice",
    dept: "dev",
    role: "junior",
    emoji: "wrench",
    sprite: 6,
    personality: "Third fixer: review findings and comments on another PR",
  },
];

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
  const running = new Map<string, Running>();
  let timer: ReturnType<typeof setInterval> | null = null;
  let ticking = false;
  let lastTick: { at: number; error: string | null; prs: number } = { at: 0, error: null, prs: 0 };

  /** Agent row for a crew member, created on first use; avatars are pixel-icon names. */
  function ensureAgent(a: (typeof PATROL_AGENTS)[AgentRole]): string {
    const existing = db.prepare("SELECT id FROM agents WHERE name = ?").get(a.name) as { id: string } | undefined;
    if (existing) {
      db.prepare("UPDATE agents SET avatar_emoji = ? WHERE id = ? AND avatar_emoji != ?").run(
        a.emoji,
        existing.id,
        a.emoji,
      );
      return existing.id;
    }
    const id = randomUUID();
    db.prepare(
      `INSERT INTO agents (id, name, name_ko, department_id, role, cli_provider, avatar_emoji, sprite_number, personality)
       VALUES (?, ?, ?, ?, ?, 'claude', ?, ?, ?)`,
    ).run(id, a.name, a.name, a.dept, a.role, a.emoji, a.sprite, a.personality);
    broadcast("agent_created", db.prepare("SELECT * FROM agents WHERE id = ?").get(id));
    return id;
  }

  function ensureAgents(): Record<AgentRole, string> {
    const ids = {} as Record<AgentRole, string>;
    for (const [role, a] of Object.entries(PATROL_AGENTS) as Array<[AgentRole, (typeof PATROL_AGENTS)[AgentRole]]>) {
      if (role === "fixer") {
        ids[role] = ensureAgent(a);
        continue;
      }
      const existing = db.prepare("SELECT id FROM agents WHERE name = ?").get(a.name) as { id: string } | undefined;
      if (existing) {
        // avatars are pixel-icon names now (the UI shows no emoji); migrate rows created with emoji
        db.prepare("UPDATE agents SET avatar_emoji = ? WHERE id = ? AND avatar_emoji != ?").run(
          a.emoji,
          existing.id,
          a.emoji,
        );
        ids[role] = existing.id;
        continue;
      }
      const id = randomUUID();
      db.prepare(
        `INSERT INTO agents (id, name, name_ko, department_id, role, cli_provider, avatar_emoji, sprite_number, personality)
         VALUES (?, ?, ?, ?, ?, 'claude', ?, ?, ?)`,
      ).run(id, a.name, a.name, a.dept, a.role, a.emoji, a.sprite, a.personality);
      broadcast("agent_created", db.prepare("SELECT * FROM agents WHERE id = ?").get(id));
      ids[role] = id;
    }
    return ids;
  }

  let agentIds: Record<AgentRole, string> | null = null;
  const agentId = (role: AgentRole) => (agentIds ??= ensureAgents())[role];

  let fixerCrew: CrewMember[] | null = null;
  /** Patch first, then as many helpers as PR_PATROL_FIXERS allows. */
  const fixers = (): CrewMember[] =>
    (fixerCrew ??= [
      { id: agentId("fixer"), name: PATROL_AGENTS.fixer.name },
      ...FIXER_HELPERS.slice(0, cfg.fixers - 1).map((a) => ({ id: ensureAgent(a), name: a.name })),
    ]);

  /** A free crew member for the role, or null when all of them are on other PRs. */
  function pickAgent(role: AgentRole): CrewMember | null {
    const busy = new Set([...running.values()].map((r) => r.agentId));
    const pool = role === "fixer" ? fixers() : [{ id: agentId(role), name: PATROL_AGENTS[role].name }];
    return pool.find((m) => !busy.has(m.id)) ?? null;
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
    s: PrSnapshot,
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
      JSON.stringify({ source: PR_PATROL_SOURCE, pr: prKey(s.repo, s.number), url: s.url, action }),
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
      store.recordReview(key, ws.startSha, blocking);
      const list = findings
        .map((f) => `- [${f.severity}] ${f.file ?? ""}${f.line ? `:${f.line}` : ""} ${f.title}`)
        .join("\n");
      // The review goes on the PR as a [review] comment (write mode only); the fixes follow as [fix] commits.
      let posted = "not posted (dry run)";
      if (cfg.write) {
        try {
          const body = formatReviewComment({
            findings,
            summary,
            reviewer: PATROL_AGENTS.reviewer.name,
            headSha: ws.startSha,
            autoFix: true,
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

  async function launch(key: string, s: PrSnapshot, d: RunDecision, crew: CrewMember): Promise<void> {
    const role = ACTION_ROLE[d.action];
    const aId = crew.id;
    const title =
      `${ACTION_PREFIX[d.action]} [${s.repo.split("/")[1]}#${s.number}] ${ACTION_LABEL[d.action]}: ${s.title}`.slice(
        0,
        200,
      );
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
    store.setPhase(key, "working", `${crew.name}: ${ACTION_LABEL[d.action]}`);
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
    const prompt = buildPatrolPrompt(s, d, resultPath);
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
        handled: handled.has(f.key),
      })),
      fetchedAt: nowMs(),
    });
    if (running.has(key)) return;

    // Pipeline settings (edited from the loop graph) are re-read on every tick, layered over the env config.
    const pipe = pipeline.get();
    const eff = effectiveConfig(cfg, pipe);
    const d = decide(s, eff, store.memory(key), stepPolicy(pipe));
    switch (d.kind) {
      case "skip":
        store.setPhase(key, "skipped", d.reason);
        return;
      case "wait":
        store.setPhase(key, "waiting", d.reason, d.notes, d.on);
        return;
      case "blocked":
        store.setPhase(key, "blocked", d.reasons.join("; "), d.notes, "you");
        return;
      case "merging":
        store.setPhase(key, "merging", d.reason, d.notes, "github");
        return;
      case "ready":
        store.setPhase(key, "ready", "checks green, no conflicts, feedback handled, review clean", d.notes);
        if (store.markReady(key, s.headRefOid)) {
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
        return;
      case "run":
        if (running.size >= eff.maxConcurrent) {
          store.setPhase(key, "watching", `queued: ${ACTION_LABEL[d.action]} (all agent slots busy)`, [], "agent");
          return;
        }
        const crew = pickAgent(ACTION_ROLE[d.action]);
        if (!crew) {
          const role = ACTION_ROLE[d.action];
          const who = role === "fixer" ? `all ${fixers().length} fixers are` : `${PATROL_AGENTS[role].name} is`;
          store.setPhase(key, "watching", `queued: ${who} busy on other PRs`, [], "agent");
          return;
        }
        // Not awaited: a first clone of a big repo would otherwise stall the tick and idle the other slots.
        // launch() claims its `running` slot synchronously, before its first await.
        void launch(key, s, d, crew).catch((err) => {
          running.delete(key);
          store.setPhase(key, "error", `launch failed: ${(err as Error).message.slice(0, 400)}`, [], "you");
        });
    }
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
      store.forgetMissing(new Set(prs.map((p) => prKey(p.repo, p.number))));
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
    agentIds = ensureAgents();
    fixers(); // create the helper fixers up front so they show in the office
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
