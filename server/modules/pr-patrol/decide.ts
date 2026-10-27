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

export type PatrolMemory = {
  actions: Map<string, ActionState>;
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
export function decide(s: PrSnapshot, cfg: PrPatrolConfig, mem: PatrolMemory): Decision {
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
  const gate = (key: string): "go" | "done" | "exhausted" => {
    const a = mem.actions.get(key);
    if (a?.status === "done") return "done";
    if (a && a.attempts >= cfg.maxAttempts) return "exhausted";
    return "go";
  };

  if (s.mergeable === "CONFLICTING") {
    const key = `conflict:${head}:${s.baseRefOid}`;
    const g = gate(key);
    if (g === "go") return { kind: "run", action: "fix_conflict", key };
    // Checks on a conflicting head are moot, so nothing below is worth an agent run yet.
    return {
      kind: "blocked",
      reasons: [
        g === "done"
          ? "merge conflict resolved locally, not pushed (dry run)"
          : "merge conflict: fix attempts exhausted",
      ],
      notes,
    };
  }

  const failing = checks.filter((c) => c.state === "failure");
  if (failing.length > 0) {
    const key = `ci:${head}`;
    const g = gate(key);
    if (g === "go") return { kind: "run", action: "fix_ci", key, failingChecks: failing };
    blocked.push(
      g === "done"
        ? `CI failing (${failing.map((c) => c.name).join(", ")}); fix done, waiting for a new head or rerun`
        : `CI failing (${failing.map((c) => c.name).join(", ")}): fix attempts exhausted`,
    );
  }

  const pending = s.feedback.filter((f) => !mem.handledFeedbackIds.has(f.id));
  if (pending.length > 0) {
    const key = `feedback:${head}:${shortHash(pending.map((f) => f.id))}`;
    const g = gate(key);
    if (g === "go") return { kind: "run", action: "address_feedback", key, feedback: pending };
    blocked.push(`${pending.length} review comment(s) unhandled: fix attempts exhausted`);
  }

  if (cfg.review) {
    if (mem.lastReview?.sha === head) {
      if (mem.lastReview.blocking.length > 0) {
        const key = `fixreview:${head}`;
        const g = gate(key);
        if (g === "go") return { kind: "run", action: "fix_review", key, findings: mem.lastReview.blocking };
        blocked.push(
          g === "done"
            ? `${mem.lastReview.blocking.length} review finding(s) fixed locally, not pushed (dry run)`
            : `${mem.lastReview.blocking.length} blocking review finding(s): fix attempts exhausted`,
        );
      }
    } else if (mem.reviewRounds < cfg.maxReviewRounds) {
      const key = `review:${head}`;
      const g = gate(key);
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
