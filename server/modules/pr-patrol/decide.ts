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
  /** Latest finished review of this PR, if any: blocking (P0/P1) and minor (P2/P3) findings. */
  lastReview: { sha: string; blocking: ReviewFinding[]; minor?: ReviewFinding[] } | null;
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
      /** The review of the final head, run once everything else is clean: it authorises the merge. */
      final?: boolean;
    }
  | { kind: "wait"; reason: string; on: WaitingOn; notes: string[] }
  | { kind: "blocked"; reasons: string[]; notes: string[] }
  | {
      kind: "ready";
      notes: string[];
      /** Own review of this exact head that approved it (no P0/P1); absent when the own review is off. */
      approval?: { sha: string; minor: ReviewFinding[] };
    }
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

/** P2/P3 fix rounds already spent on this PR (comment and review nits together). */
export function nitRoundsUsed(mem: PatrolMemory): number {
  return [...mem.actions].filter(([k, a]) => k.includes("-nit:") && a.status === "done").length;
}

/** Of those, rounds that fixed P3-only items (keys `*-p3-nit:*`). */
export function p3RoundsUsed(mem: PatrolMemory): number {
  return [...mem.actions].filter(([k, a]) => k.includes("-p3-nit:") && a.status === "done").length;
}

/**
 * Whether one more P2/P3 round may run: within the P2/P3 budget, and for a P3-only round also within the
 * smaller P3 budget (review bots re-review every push and always find one more nit).
 */
export function nitRoundOpen(
  mem: PatrolMemory,
  cfg: Pick<PrPatrolConfig, "maxNitRounds" | "maxP3Rounds">,
  p3Only: boolean,
): boolean {
  return nitRoundsUsed(mem) < cfg.maxNitRounds && (!p3Only || p3RoundsUsed(mem) < cfg.maxP3Rounds);
}

/** "P2/P3 round cap (5) reached" / "P3-only round cap (2) reached", for notes. */
function nitCapLabel(mem: PatrolMemory, cfg: Pick<PrPatrolConfig, "maxNitRounds" | "maxP3Rounds">): string {
  return nitRoundsUsed(mem) >= cfg.maxNitRounds
    ? `P2/P3 round cap (${cfg.maxNitRounds}) reached`
    : `P3-only round cap (${cfg.maxP3Rounds}) reached`;
}

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

  // P0/P1 (and every human comment) are always fixed; P2/P3 get at most cfg.maxNitRounds rounds per PR (P3-only
  // ones cfg.maxP3Rounds), and a round starts only once CI on the head has finished and Argus has reviewed it, so
  // every push gets a full CI run and no fix lands on top of an unreviewed one.
  // Bot placeholders and status summaries with nothing to act on never cost a run.
  // A disabled own review behaves like PR_PATROL_REVIEW=0 (its stale findings no longer block either).
  const reviewOn = cfg.review && steps.review?.enabled !== false;
  const headReviewed = !reviewOn || mem.lastReview?.sha === head;
  const ciRunning = checks.some((c) => c.state === "pending");
  const pending = s.feedback.filter(
    (f) => !mem.handledFeedbackIds.has(f.key) && !f.inProgress && f.severity !== "none",
  );
  const minorFeedback = pending.filter((f) => f.severity === "minor");
  if (pending.some((f) => f.severity === "blocking")) {
    const key = `feedback:${head}:${shortHash(pending.map((f) => f.key))}`;
    const g = gate(key, "address_feedback");
    if (g === "go") return { kind: "run", action: "address_feedback", key, feedback: pending };
    blocked.push(
      `${pending.length} review comment(s) unhandled: ${g === "disabled" ? DISABLED_LABEL.address_feedback : "fix attempts exhausted"}`,
    );
  } else if (minorFeedback.length > 0) {
    const p3Only = minorFeedback.every((f) => f.p3Only);
    if (!nitRoundOpen(mem, cfg, p3Only)) {
      notes.push(`${nitCapLabel(mem, cfg)}: ${minorFeedback.length} minor comment(s) left for the author`);
    } else if (!ciRunning && headReviewed) {
      const key = `feedback-${p3Only ? "p3-" : ""}nit:${head}:${shortHash(minorFeedback.map((f) => f.key))}`;
      const g = gate(key, "address_feedback");
      if (g === "go") return { kind: "run", action: "address_feedback", key, feedback: minorFeedback };
      if (g !== "done") notes.push(`${minorFeedback.length} minor comment(s) not fixed (${g})`);
    }
  }

  if (cfg.review && !reviewOn) notes.push(DISABLED_LABEL.review);
  if (reviewOn) {
    if (mem.lastReview?.sha === head) {
      const minorFindings = mem.lastReview.minor ?? [];
      if (mem.lastReview.blocking.length === 0 && minorFindings.length > 0) {
        const p3Only = minorFindings.every((f) => f.severity === "P3");
        if (!nitRoundOpen(mem, cfg, p3Only)) {
          notes.push(`${nitCapLabel(mem, cfg)}: ${minorFindings.length} review finding(s) left for the author`);
        } else if (!ciRunning) {
          const key = `fixreview-${p3Only ? "p3-" : ""}nit:${head}`;
          const g = gate(key, "fix_review");
          if (g === "go") return { kind: "run", action: "fix_review", key, findings: minorFindings };
          if (g !== "done") notes.push(`${minorFindings.length} minor review finding(s) not fixed (${g})`);
        }
      }
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
    }
    // Past the round cap the head is still reviewed once, as the final review below, before it can be ready.
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
  // Final review: Argus must have reviewed this exact head with no P0/P1 before Gate may call it ready. After
  // fixes past the review round cap that review runs here, once CI, conflicts, comments and reviewers are clear.
  if (reviewOn) {
    if (mem.lastReview?.sha !== head) {
      const key = `review:${head}`;
      const g = gate(key, "review");
      if (g === "go") return { kind: "run", action: "review", key, final: true };
      return {
        kind: "blocked",
        reasons: [g === "done" ? `final review of ${head.slice(0, 7)} left no result` : "final review failed to run"],
        notes,
      };
    }
    return { kind: "ready", notes, approval: { sha: head, minor: mem.lastReview.minor ?? [] } };
  }
  return { kind: "ready", notes };
}
