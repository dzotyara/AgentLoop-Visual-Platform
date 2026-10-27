import { createHash } from "node:crypto";
import type { PrPatrolConfig } from "./config.ts";
import type { PrCheck, PrFeedback, PrSnapshot } from "./github.ts";

export type ActionKind = "fix_conflict" | "fix_ci" | "address_feedback" | "review" | "fix_review";

/** P0 breaks prod / data / security, P1 real bug or broken build, P2 should fix, P3 nit. */
export type Severity = "P0" | "P1" | "P2" | "P3";

export type ReviewFinding = {
  severity: Severity;
  file?: string;
  line?: number;
  title: string;
  detail?: string;
  fix?: string;
};

export type ActionState = { status: "running" | "done" | "failed"; attempts: number };

/**
 * Per-step pipeline overrides (see pipeline.ts): a disabled step is never run, and its condition blocks
 * readiness with "<step> disabled" instead; `maxAttempts` replaces the global cap for that step.
 */
export type StepPolicy = Partial<Record<ActionKind, { enabled?: boolean; maxAttempts?: number | null }>>;

const DISABLED_LABEL: Record<ActionKind, string> = {
  fix_conflict: "conflict fixes disabled",
  fix_ci: "CI fixes disabled",
  address_feedback: "comment fixes disabled",
  review: "own review disabled",
  fix_review: "review fixes disabled",
};

export type PatrolMemory = {
  actions: Map<string, ActionState>;
  /** Keys (id + text hash) of feedback already handled; see PrFeedback.key. */
  handledFeedbackIds: Set<string>;
  /** Latest finished review of this PR, if any. */
  lastReview: { sha: string; blocking: ReviewFinding[] } | null;
  reviewRounds: number;
};

export type Decision =
  | { kind: "skip"; reason: string }
  | {
      kind: "run";
      action: ActionKind;
      key: string;
      failingChecks?: PrCheck[];
      feedback?: PrFeedback[];
      findings?: ReviewFinding[];
    }
  | { kind: "wait"; reason: string; on: WaitingOn; notes: string[] }
  | { kind: "blocked"; reasons: string[]; notes: string[] }
  | { kind: "ready"; notes: string[] }
  | { kind: "merging"; reason: string; notes: string[] };

const MERGE_QUEUE_STATE: Record<string, string> = {
  QUEUED: "waiting for its turn",
  AWAITING_CHECKS: "queue checks running",
  MERGEABLE: "about to merge",
  UNMERGEABLE: "failed queue checks",
  LOCKED: "locked by GitHub",
};

/** Who or what the PR is waiting for when no agent can act: shown next to the reason in the UI. */
export type WaitingOn = "ci" | "reviewer" | "github" | "you" | "agent";

export const BLOCKING_SEVERITIES = new Set<Severity>(["P0", "P1"]);

function shortHash(parts: string[]): string {
  return createHash("sha1")
    .update([...parts].sort().join("\n"))
    .digest("hex")
    .slice(0, 12);
}

/**
 * One step of the auto-fix loop for a single PR, in Auto-fix priority order:
 * merge conflict → failing CI → unhandled review feedback → own review (+ fixing its findings) → wait for CI → ready.
 */
export function decide(s: PrSnapshot, cfg: PrPatrolConfig, mem: PatrolMemory, steps: StepPolicy = {}): Decision {
  if (s.state !== "OPEN") return { kind: "skip", reason: `PR is ${s.state.toLowerCase()}` };
  if (s.isDraft && !cfg.includeDrafts) return { kind: "skip", reason: "draft" };
  if (s.isCrossRepository) return { kind: "skip", reason: "fork PR: its branch cannot be pushed from here" };
  // In the merge queue the PR belongs to GitHub: any push would drop it from the queue, so agents stay off.
  if (s.mergeQueue) {
    const state = MERGE_QUEUE_STATE[s.mergeQueue.state] ?? s.mergeQueue.state.toLowerCase();
    return { kind: "merging", reason: `In merge queue: position ${s.mergeQueue.position}, ${state}`, notes: [] };
  }

  const checks = s.checks.filter((c) => !cfg.ignoredChecks.includes(c.name));
  const head = s.headRefOid;
  const blocked: string[] = [];
  const notes: string[] = [];
  const gate = (key: string, action: ActionKind): "go" | "done" | "exhausted" | "disabled" => {
    const a = mem.actions.get(key);
    if (a?.status === "done") return "done";
    if (steps[action]?.enabled === false) return "disabled";
    if (a && a.attempts >= (steps[action]?.maxAttempts ?? cfg.maxAttempts)) return "exhausted";
    return "go";
  };

  if (s.mergeable === "CONFLICTING") {
    const key = `conflict:${head}:${s.baseRefOid}`;
    const g = gate(key, "fix_conflict");
    if (g === "go") return { kind: "run", action: "fix_conflict", key };
    // Checks on a conflicting head are moot, so nothing below is worth an agent run yet (also when disabled).
    return {
      kind: "blocked",
      reasons: [
        g === "done"
          ? "merge conflict resolved locally, not pushed (dry run)"
          : g === "disabled"
            ? `merge conflict: ${DISABLED_LABEL.fix_conflict}`
            : "merge conflict: fix attempts exhausted",
      ],
      notes,
    };
  }

  const failing = checks.filter((c) => c.state === "failure");
  if (failing.length > 0) {
    const key = `ci:${head}`;
    const g = gate(key, "fix_ci");
    if (g === "go") return { kind: "run", action: "fix_ci", key, failingChecks: failing };
    const names = failing.map((c) => c.name).join(", ");
    blocked.push(
      g === "done"
        ? `CI failing (${names}); fix done, waiting for a new head or rerun`
        : g === "disabled"
          ? `CI failing (${names}): ${DISABLED_LABEL.fix_ci}`
          : `CI failing (${names}): fix attempts exhausted`,
    );
  }

  const pending = s.feedback.filter((f) => !mem.handledFeedbackIds.has(f.key));
  if (pending.length > 0) {
    const key = `feedback:${head}:${shortHash(pending.map((f) => f.key))}`;
    const g = gate(key, "address_feedback");
    if (g === "go") return { kind: "run", action: "address_feedback", key, feedback: pending };
    blocked.push(
      `${pending.length} review comment(s) unhandled: ${g === "disabled" ? DISABLED_LABEL.address_feedback : "fix attempts exhausted"}`,
    );
  }

  // A disabled own review behaves like PR_PATROL_REVIEW=0 (its stale findings no longer block either).
  const reviewOn = cfg.review && steps.review?.enabled !== false;
  if (cfg.review && !reviewOn) notes.push(DISABLED_LABEL.review);
  if (reviewOn) {
    if (mem.lastReview?.sha === head) {
      if (mem.lastReview.blocking.length > 0) {
        const key = `fixreview:${head}`;
        const g = gate(key, "fix_review");
        if (g === "go") return { kind: "run", action: "fix_review", key, findings: mem.lastReview.blocking };
        const n = mem.lastReview.blocking.length;
        blocked.push(
          g === "done"
            ? `${n} review finding(s) fixed locally, not pushed (dry run)`
            : g === "disabled"
              ? `${n} blocking review finding(s): ${DISABLED_LABEL.fix_review}`
              : `${n} blocking review finding(s): fix attempts exhausted`,
        );
      }
    } else if (mem.reviewRounds < cfg.maxReviewRounds) {
      const key = `review:${head}`;
      const g = gate(key, "review");
      if (g === "go") return { kind: "run", action: "review", key };
      if (g === "exhausted") blocked.push("own review failed to run");
    } else {
      notes.push(`review round cap (${cfg.maxReviewRounds}) reached: head ${head.slice(0, 7)} not re-reviewed`);
    }
  } else if (s.reviewDecision === "REVIEW_REQUIRED") notes.push("waiting for a human approval");
  if (s.mergeStateStatus === "BEHIND") notes.push("branch is behind its base");

  if (blocked.length > 0) return { kind: "blocked", reasons: blocked, notes };
  const running = checks.filter((c) => c.state === "pending");
  if (running.length > 0) return { kind: "wait", reason: `CI running (${running.length} check(s))`, on: "ci", notes };
  if (s.mergeable === "UNKNOWN")
    return { kind: "wait", reason: "GitHub is still computing mergeability", on: "github", notes };
  // A standing "changes requested" review keeps the PR in work until the reviewer lifts it, even when the
  // loop has handled every comment: only that reviewer can clear it.
  if (s.reviewDecision === "CHANGES_REQUESTED") {
    const who = s.changesRequestedBy?.length ? s.changesRequestedBy.map((r) => `@${r}`).join(", ") : "a reviewer";
    return {
      kind: "wait",
      reason: `${who} requested changes: waiting for them to re-review or dismiss`,
      on: "reviewer",
      notes,
    };
  }
  return { kind: "ready", notes };
}
