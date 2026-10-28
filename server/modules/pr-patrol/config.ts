import os from "node:os";
import path from "node:path";

export type PrPatrolConfig = {
  enabled: boolean;
  /** Write mode: push fixes, rerun flaky CI, (optionally) reply to threads. Off = dry run: agents commit locally only. */
  write: boolean;
  replyToThreads: boolean;
  review: boolean;
  includeDrafts: boolean;
  intervalMs: number;
  maxConcurrent: number;
  /** Fixer pool size (Patch + helpers): fix_review / address_feedback runs on different PRs in parallel. */
  fixers: number;
  /** Reviewer pool size (Argus + helpers): reviews of different PRs run in parallel. */
  reviewers: number;
  maxAttempts: number;
  /** Own reviews per PR. High on purpose: every head a fix produces gets reviewed before more fixes land. */
  maxReviewRounds: number;
  /** P2/P3 fix rounds per PR (bot comments + own review). P0/P1 are always fixed, outside this budget. */
  maxNitRounds: number;
  /** Of those, rounds for P3-only findings (no P2): stops nit ping-pong with review bots that re-review each push. */
  maxP3Rounds: number;
  searchQuery: string;
  repoAllowlist: string[];
  repoDenylist: string[];
  ignoredCommenters: string[];
  /** Check names that never count as failing or pending (e.g. merge-queue gates no commit can fix). */
  ignoredChecks: string[];
  /**
   * Head branches of release PRs the loop never touches (no review, no fixes, no comments): a release is cut
   * from staging as is, and any commit on it breaks the release-head verification.
   */
  releaseHeads: string[];
  /** CI fix rounds per head: a rerun that fails again gets another look, up to this many, then the PR waits on you. */
  maxCiRoundsPerHead: number;
  /**
   * When the CI rounds run out: one escalated round by a fixer, then the base is merged in (up to maxBaseSyncs
   * per PR); the PR waits on you only once CI has been red for needsYouAfterMs. Off = it waits on you at once.
   */
  escalate: boolean;
  maxBaseSyncs: number;
  needsYouAfterMs: number;
  /** Gate puts a ready PR (final review approved) into the merge queue, and back after an ejection. */
  autoEnqueue: boolean;
  /** Enqueues per head: the first one plus re-enqueues after ejections. */
  maxEnqueuesPerHead: number;
  /** Medic opens one fix PR against the base when a base breakage holds at least baseFixMinPrs PRs. */
  baseFix: boolean;
  baseFixMinPrs: number;
  workdir: string;
  model: string | undefined;
};

function envFlag(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  return !["0", "false", "no", "off"].includes(raw.trim().toLowerCase());
}

function envInt(name: string, fallback: number, min: number): number {
  const n = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(n) && n >= min ? n : fallback;
}

function envList(name: string, fallback: string[] = []): string[] {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function loadPrPatrolConfig(): PrPatrolConfig {
  return {
    enabled: envFlag("PR_PATROL_ENABLED", true),
    write: envFlag("PR_PATROL_WRITE", false),
    replyToThreads: envFlag("PR_PATROL_REPLY_THREADS", false),
    review: envFlag("PR_PATROL_REVIEW", true),
    includeDrafts: envFlag("PR_PATROL_INCLUDE_DRAFTS", false),
    intervalMs: envInt("PR_PATROL_INTERVAL_MS", 120_000, 15_000),
    maxConcurrent: envInt("PR_PATROL_MAX_CONCURRENT", 8, 1),
    fixers: Math.min(3, envInt("PR_PATROL_FIXERS", 3, 1)),
    reviewers: Math.min(3, envInt("PR_PATROL_REVIEWERS", 3, 1)),
    maxAttempts: envInt("PR_PATROL_MAX_ATTEMPTS", 2, 1),
    maxReviewRounds: envInt("PR_PATROL_MAX_REVIEW_ROUNDS", 12, 0),
    maxNitRounds: envInt("PR_PATROL_MAX_NIT_ROUNDS", 5, 0),
    maxP3Rounds: envInt("PR_PATROL_MAX_P3_ROUNDS", 2, 0),
    searchQuery: process.env.PR_PATROL_QUERY?.trim() || "author:@me",
    repoAllowlist: envList("PR_PATROL_REPOS"),
    repoDenylist: envList("PR_PATROL_EXCLUDE_REPOS"),
    ignoredCommenters: envList("PR_PATROL_IGNORE_COMMENTERS", [
      "github-actions[bot]",
      "vercel[bot]",
      "netlify[bot]",
      "codecov[bot]",
      "sonarcloud[bot]",
      "dependabot[bot]",
      "changeset-bot[bot]",
    ]),
    ignoredChecks: envList("PR_PATROL_IGNORE_CHECKS"),
    releaseHeads: envList("PR_PATROL_RELEASE_HEADS", ["release-cut"]),
    maxCiRoundsPerHead: envInt("PR_PATROL_MAX_CI_ROUNDS_PER_HEAD", 3, 1),
    escalate: envFlag("PR_PATROL_ESCALATE", true),
    maxBaseSyncs: envInt("PR_PATROL_MAX_BASE_SYNCS", 1, 0),
    needsYouAfterMs: envInt("PR_PATROL_NEEDS_YOU_AFTER_H", 24, 0) * 3_600_000,
    autoEnqueue: envFlag("PR_PATROL_AUTO_ENQUEUE", true),
    maxEnqueuesPerHead: envInt("PR_PATROL_MAX_ENQUEUES_PER_HEAD", 2, 1),
    baseFix: envFlag("PR_PATROL_BASE_FIX", true),
    baseFixMinPrs: envInt("PR_PATROL_BASE_FIX_MIN_PRS", 2, 1),
    workdir: process.env.PR_PATROL_WORKDIR?.trim() || path.join(os.homedir(), ".pr-loop"),
    model: process.env.PR_PATROL_MODEL?.trim() || undefined,
  };
}
