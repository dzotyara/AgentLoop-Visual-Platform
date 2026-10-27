import { describe, expect, it } from "vitest";
import type { PrPatrolConfig } from "./config.ts";
import { decide, type PatrolMemory } from "./decide.ts";
import {
  classifyFeedback,
  extractChangesRequestedBy,
  extractFeedback,
  normalizeChecks,
  type PrSnapshot,
} from "./github.ts";

const cfg: PrPatrolConfig = {
  enabled: true,
  write: false,
  replyToThreads: false,
  review: true,
  includeDrafts: false,
  intervalMs: 60_000,
  maxConcurrent: 2,
  fixers: 3,
  reviewers: 3,
  maxAttempts: 2,
  maxReviewRounds: 3,
  maxNitRounds: 5,
  maxP3Rounds: 2,
  searchQuery: "author:@me",
  repoAllowlist: [],
  repoDenylist: [],
  ignoredCommenters: [],
  ignoredChecks: ["merge-gate"],
  workdir: "/tmp/pr-loop-test",
  model: undefined,
};

function snap(over: Partial<PrSnapshot> = {}): PrSnapshot {
  return {
    repo: "o/r",
    number: 1,
    title: "t",
    url: "u",
    state: "OPEN",
    isDraft: false,
    isCrossRepository: false,
    headRefName: "feat",
    headRefOid: "head1",
    baseRefName: "main",
    baseRefOid: "base1",
    mergeable: "MERGEABLE",
    mergeStateStatus: "CLEAN",
    reviewDecision: "APPROVED",
    checks: [{ name: "build", workflow: "CI", state: "success", rawConclusion: "SUCCESS", detailsUrl: null }],
    feedback: [],
    ...over,
  };
}

function mem(over: Partial<PatrolMemory> = {}): PatrolMemory {
  return {
    actions: new Map(),
    handledFeedbackIds: new Set(),
    lastReview: { sha: "head1", blocking: [] },
    reviewRounds: 1,
    ...over,
  };
}

describe("decide", () => {
  it("resolves conflicts before anything else", () => {
    const d = decide(snap({ mergeable: "CONFLICTING", checks: [] }), cfg, mem({ lastReview: null, reviewRounds: 0 }));
    expect(d).toMatchObject({ kind: "run", action: "fix_conflict", key: "conflict:head1:base1" });
  });

  it("stops retrying a conflict after maxAttempts", () => {
    const actions = new Map([["conflict:head1:base1", { status: "failed" as const, attempts: 2 }]]);
    const d = decide(snap({ mergeable: "CONFLICTING" }), cfg, mem({ actions }));
    expect(d.kind).toBe("blocked");
  });

  it("fixes failing CI, then feedback, then reviews", () => {
    const failing = snap({
      checks: [{ name: "test", workflow: null, state: "failure", rawConclusion: "FAILURE", detailsUrl: null }],
    });
    expect(decide(failing, cfg, mem())).toMatchObject({ kind: "run", action: "fix_ci" });

    const fb = snap({
      feedback: [
        {
          id: "T1",
          key: "T1:v1",
          bot: false,
          inProgress: false,
          severity: "blocking",
          kind: "review_thread",
          author: "bob",
          body: "x",
          path: "a.ts",
          line: 3,
          url: null,
          createdAt: "",
        },
      ],
    });
    expect(decide(fb, cfg, mem())).toMatchObject({ kind: "run", action: "address_feedback" });
    expect(decide(fb, cfg, mem({ handledFeedbackIds: new Set(["T1:v1"]) })).kind).toBe("ready");

    expect(decide(snap({ headRefOid: "head2" }), cfg, mem())).toMatchObject({
      kind: "run",
      action: "review",
      key: "review:head2",
    });
  });

  it("fixes blocking review findings on the reviewed head", () => {
    const d = decide(snap(), cfg, mem({ lastReview: { sha: "head1", blocking: [{ severity: "P1", title: "bug" }] } }));
    expect(d).toMatchObject({ kind: "run", action: "fix_review", key: "fixreview:head1" });
  });

  it("past the review round cap, reviews the final head once everything else is clean", () => {
    const capped = mem({ reviewRounds: 3 });
    // CI still running on the new head: no final review yet, the loop waits for CI first
    const running = snap({
      headRefOid: "head9",
      checks: [{ name: "build", workflow: "CI", state: "pending", rawConclusion: "", detailsUrl: null }],
    });
    expect(decide(running, cfg, capped)).toMatchObject({ kind: "wait", on: "ci" });
    // all clear: the final review of head9 runs, and only it can make the PR ready
    expect(decide(snap({ headRefOid: "head9" }), cfg, capped)).toMatchObject({
      kind: "run",
      action: "review",
      key: "review:head9",
      final: true,
    });
    const failed = mem({ reviewRounds: 3, actions: new Map([["review:head9", { status: "failed", attempts: 2 }]]) });
    expect(decide(snap({ headRefOid: "head9" }), cfg, failed)).toMatchObject({
      kind: "blocked",
      reasons: ["final review failed to run"],
    });
  });

  it("is ready only with an approving review of this exact head", () => {
    const minor = [{ severity: "P3" as const, title: "nit" }];
    const d = decide(snap(), { ...cfg, maxNitRounds: 0 }, mem({ lastReview: { sha: "head1", blocking: [], minor } }));
    expect(d).toMatchObject({ kind: "ready", approval: { sha: "head1", minor } });
    const blocked = decide(
      snap(),
      cfg,
      mem({
        reviewRounds: 3,
        lastReview: { sha: "head1", blocking: [{ severity: "P1", title: "bug" }] },
        actions: new Map([["fixreview:head1", { status: "failed", attempts: 2 }]]),
      }),
    );
    expect(blocked.kind).toBe("blocked");
    const noReview = decide(snap(), { ...cfg, review: false }, mem({ lastReview: null }));
    expect(noReview).toMatchObject({ kind: "ready" });
    if (noReview.kind === "ready") expect(noReview.approval).toBeUndefined();
  });

  it("keeps a PR with a standing changes-requested review in work", () => {
    const d = decide(snap({ reviewDecision: "CHANGES_REQUESTED", changesRequestedBy: ["FlemHW"] }), cfg, mem());
    expect(d).toMatchObject({ kind: "wait", on: "reviewer" });
    if (d.kind === "wait") expect(d.reason).toContain("@FlemHW requested changes");
    // feedback still gets addressed first
    const fb = snap({
      reviewDecision: "CHANGES_REQUESTED",
      feedback: [
        {
          id: "R1",
          key: "R1:v1",
          bot: false,
          inProgress: false,
          severity: "blocking",
          kind: "review_body",
          author: "bob",
          body: "x",
          path: null,
          line: null,
          url: null,
          createdAt: "",
        },
      ],
    });
    expect(decide(fb, cfg, mem())).toMatchObject({ kind: "run", action: "address_feedback" });
  });

  it("leaves a PR in the merge queue alone, even with failing checks or new comments", () => {
    const d = decide(
      snap({
        mergeQueue: { state: "AWAITING_CHECKS", position: 2, enqueuedAt: "" },
        checks: [{ name: "t", workflow: null, state: "failure", rawConclusion: "FAILURE", detailsUrl: null }],
      }),
      cfg,
      mem(),
    );
    expect(d).toMatchObject({ kind: "merging", reason: "In merge queue: position 2, queue checks running" });
  });

  it("ignores configured checks", () => {
    const gated = snap({
      checks: [{ name: "merge-gate", workflow: null, state: "failure", rawConclusion: "FAILURE", detailsUrl: null }],
    });
    expect(decide(gated, cfg, mem()).kind).toBe("ready");
  });

  it("waits while checks run and is ready once green", () => {
    const pending = snap({
      checks: [{ name: "b", workflow: null, state: "pending", rawConclusion: null, detailsUrl: null }],
    });
    expect(decide(pending, cfg, mem())).toMatchObject({ kind: "wait", on: "ci" });
    expect(decide(snap(), cfg, mem()).kind).toBe("ready");
  });

  it("skips drafts, forks and closed PRs", () => {
    expect(decide(snap({ isDraft: true }), cfg, mem()).kind).toBe("skip");
    expect(decide(snap({ isCrossRepository: true }), cfg, mem()).kind).toBe("skip");
    expect(decide(snap({ state: "MERGED" }), cfg, mem()).kind).toBe("skip");
  });
});

describe("normalizeChecks", () => {
  it("keeps the latest run of a re-run check and maps conclusions", () => {
    const checks = normalizeChecks([
      {
        __typename: "CheckRun",
        name: "test",
        workflowName: "CI",
        status: "COMPLETED",
        conclusion: "FAILURE",
        completedAt: "2026-01-01T00:00:00Z",
      },
      {
        __typename: "CheckRun",
        name: "test",
        workflowName: "CI",
        status: "COMPLETED",
        conclusion: "SUCCESS",
        completedAt: "2026-01-02T00:00:00Z",
      },
      { __typename: "CheckRun", name: "lint", workflowName: "CI", status: "IN_PROGRESS", conclusion: null },
      { __typename: "CheckRun", name: "skip", workflowName: "CI", status: "COMPLETED", conclusion: "SKIPPED" },
      { __typename: "StatusContext", context: "ext", state: "ERROR" },
    ]);
    expect(Object.fromEntries(checks.map((c) => [c.name, c.state]))).toEqual({
      test: "success",
      lint: "pending",
      skip: "neutral",
      ext: "failure",
    });
  });
});

describe("P0/P1 always, P2/P3 within a round budget", () => {
  const fb = (id: string, severity: "blocking" | "minor" | "none", inProgress = false, p3Only = false) => ({
    id,
    key: `${id}:v1`,
    bot: true,
    inProgress,
    severity,
    p3Only,
    kind: "pr_comment" as const,
    author: "claude",
    body: "x",
    path: null,
    line: null,
    url: null,
    createdAt: "",
  });
  const pendingCheck = { name: "t", workflow: null, state: "pending" as const, rawConclusion: null, detailsUrl: null };

  it("ignores bot placeholders and status summaries", () => {
    expect(decide(snap({ feedback: [fb("A", "none", true), fb("B", "none")] }), cfg, mem()).kind).toBe("ready");
  });

  it("fixes blocking feedback right away, even while CI runs", () => {
    const d = decide(snap({ checks: [pendingCheck], feedback: [fb("A", "blocking"), fb("B", "minor")] }), cfg, mem());
    expect(d).toMatchObject({ kind: "run", action: "address_feedback" });
    if (d.kind === "run") expect(d.feedback?.map((f) => f.id)).toEqual(["A", "B"]);
  });

  it("waits for CI before a minor round, then runs it as a nit round", () => {
    expect(decide(snap({ checks: [pendingCheck], feedback: [fb("B", "minor")] }), cfg, mem()).kind).toBe("wait");
    const d = decide(snap({ feedback: [fb("B", "minor")] }), cfg, mem());
    expect(d).toMatchObject({ kind: "run", action: "address_feedback" });
    if (d.kind === "run") expect(d.key.startsWith("feedback-nit:")).toBe(true);
  });

  it("stops minor rounds at the cap and lets the PR become ready", () => {
    const actions = new Map(
      Array.from({ length: 5 }, (_, i) => [`feedback-nit:h${i}:x`, { status: "done" as const, attempts: 1 }]),
    );
    const d = decide(snap({ feedback: [fb("B", "minor")] }), cfg, mem({ actions }));
    expect(d.kind).toBe("ready");
    if (d.kind === "ready") expect(d.notes.join()).toContain("P2/P3 round cap (5)");
  });

  it("fixes minor own-review findings within the budget once CI is done", () => {
    const d = decide(
      snap(),
      cfg,
      mem({ lastReview: { sha: "head1", blocking: [], minor: [{ severity: "P3", title: "nit" }] } }),
    );
    expect(d).toMatchObject({ kind: "run", action: "fix_review", key: "fixreview-p3-nit:head1" });
    const p2 = decide(
      snap(),
      cfg,
      mem({ lastReview: { sha: "head1", blocking: [], minor: [{ severity: "P2", title: "edge case" }] } }),
    );
    expect(p2).toMatchObject({ kind: "run", action: "fix_review", key: "fixreview-nit:head1" });
  });

  it("reviews a head a fix produced before the next P2/P3 round lands on it", () => {
    // head2 came from a [fix] push; the bot already posted a nit on it, Argus has not looked yet
    const s = snap({ headRefOid: "head2", feedback: [fb("B", "minor")] });
    expect(decide(s, cfg, mem({ reviewRounds: 5 }))).toMatchObject({
      kind: "run",
      action: "review",
      key: "review:head2",
    });
    const reviewed = mem({ reviewRounds: 6, lastReview: { sha: "head2", blocking: [] } });
    expect(decide(s, cfg, reviewed)).toMatchObject({ kind: "run", action: "address_feedback" });
  });

  it("gives P3-only rounds a smaller budget than P2 rounds", () => {
    const actions = new Map([
      ["feedback-p3-nit:h0:x", { status: "done" as const, attempts: 1 }],
      ["fixreview-p3-nit:h1", { status: "done" as const, attempts: 1 }],
    ]);
    const p3 = decide(snap({ feedback: [fb("B", "minor", false, true)] }), cfg, mem({ actions }));
    expect(p3.kind).toBe("ready");
    if (p3.kind === "ready") expect(p3.notes.join()).toContain("P3-only round cap (2)");
    // a P2 still gets a round: 2 of 5 P2/P3 rounds used
    const p2 = decide(snap({ feedback: [fb("C", "minor")] }), cfg, mem({ actions }));
    expect(p2).toMatchObject({ kind: "run", action: "address_feedback" });
    if (p2.kind === "run") expect(p2.key.startsWith("feedback-nit:")).toBe(true);
    const first = decide(snap({ feedback: [fb("B", "minor", false, true)] }), cfg, mem());
    if (first.kind === "run") expect(first.key.startsWith("feedback-p3-nit:")).toBe(true);
  });
});

describe("classifyFeedback", () => {
  it("tells placeholders, blockers, nits and summaries apart", () => {
    expect(classifyFeedback("**Claude Code is working…** - [ ] Gather context", true)).toEqual({
      inProgress: true,
      severity: "none",
    });
    expect(classifyFeedback("- [x] done\n### Review\n**[P1]** shard timeout ignored", true).severity).toBe("blocking");
    expect(classifyFeedback("LGTM. Three P3 notes: wording in docs", true)).toMatchObject({
      severity: "minor",
      p3Only: true,
    });
    expect(classifyFeedback("**[P2]** unhandled edge case; **[P3]** naming", true)).toMatchObject({
      severity: "minor",
      p3Only: false,
    });
    expect(classifyFeedback("Decision: No blocking issues found. 0 findings.", true).severity).toBe("none");
    expect(classifyFeedback("please rename this", false).severity).toBe("blocking");
  });
});

describe("feedback keys", () => {
  it("treats a comment edited in place as new feedback", () => {
    const fb = (body: string) =>
      extractFeedback(
        {
          data: {
            repository: {
              pullRequest: {
                reviewThreads: { nodes: [] },
                reviews: { nodes: [] },
                comments: { nodes: [{ id: "C1", body, url: "", createdAt: "", author: { login: "claude" } }] },
              },
            },
          },
        },
        "me",
        [],
      )[0];
    const placeholder = fb("Claude is working on it…");
    const review = fb("Review: [P1] the shard timeout is ignored");
    expect(placeholder.id).toBe(review.id);
    expect(placeholder.key).not.toBe(review.key);
    const handled = new Set([placeholder.key]);
    expect(decide(snap({ feedback: [review] }), cfg, mem({ handledFeedbackIds: handled }))).toMatchObject({
      kind: "run",
      action: "address_feedback",
    });
  });
});

describe("extractChangesRequestedBy", () => {
  it("keeps reviewers whose latest decisive review requests changes", () => {
    const resp = {
      data: {
        repository: {
          pullRequest: {
            reviewThreads: { nodes: [] },
            comments: { nodes: [] },
            reviews: {
              nodes: [
                { id: "1", state: "CHANGES_REQUESTED", body: "", url: "", createdAt: "", author: { login: "amy" } },
                { id: "2", state: "CHANGES_REQUESTED", body: "", url: "", createdAt: "", author: { login: "bob" } },
                { id: "3", state: "COMMENTED", body: "", url: "", createdAt: "", author: { login: "bob" } },
                { id: "4", state: "APPROVED", body: "", url: "", createdAt: "", author: { login: "amy" } },
              ],
            },
          },
        },
      },
    };
    expect(extractChangesRequestedBy(resp)).toEqual(["bob"]);
  });
});

describe("extractFeedback", () => {
  it("keeps unresolved threads where someone else spoke last, plus others' review bodies and comments", () => {
    const fb = extractFeedback(
      {
        data: {
          repository: {
            pullRequest: {
              reviewThreads: {
                nodes: [
                  {
                    id: "T1",
                    isResolved: false,
                    isOutdated: false,
                    path: "a",
                    line: 1,
                    comments: { nodes: [{ author: { login: "bob" }, body: "fix", url: "", createdAt: "" }] },
                  },
                  {
                    id: "T2",
                    isResolved: true,
                    isOutdated: false,
                    path: "a",
                    line: 2,
                    comments: { nodes: [{ author: { login: "bob" }, body: "x", url: "", createdAt: "" }] },
                  },
                  {
                    id: "T3",
                    isResolved: false,
                    isOutdated: false,
                    path: "a",
                    line: 3,
                    comments: {
                      nodes: [
                        { author: { login: "bob" }, body: "x", url: "", createdAt: "" },
                        { author: { login: "me" }, body: "done", url: "", createdAt: "" },
                      ],
                    },
                  },
                ],
              },
              reviews: {
                nodes: [
                  {
                    id: "R1",
                    state: "CHANGES_REQUESTED",
                    body: "please",
                    url: "",
                    createdAt: "",
                    author: { login: "bob" },
                  },
                  { id: "R2", state: "APPROVED", body: "lgtm", url: "", createdAt: "", author: { login: "bob" } },
                ],
              },
              comments: {
                nodes: [
                  { id: "C1", body: "deploy preview", url: "", createdAt: "", author: { login: "vercel[bot]" } },
                  { id: "C2", body: "[P1] bug", url: "", createdAt: "", author: { login: "claude" } },
                ],
              },
            },
          },
        },
      },
      "me",
      ["vercel[bot]"],
    );
    expect(fb.map((f) => f.id)).toEqual(["T1", "R1", "C2"]);
  });
});

describe("decide with pipeline step overrides", () => {
  const failingCheck = {
    name: "test",
    workflow: null,
    state: "failure" as const,
    rawConclusion: "FAILURE",
    detailsUrl: null,
  };
  const comment = {
    id: "T1",
    key: "T1:v1",
    bot: false,
    inProgress: false,
    severity: "blocking" as const,
    kind: "review_thread" as const,
    author: "bob",
    body: "x",
    path: "a.ts",
    line: 3,
    url: null,
    createdAt: "",
  };

  it("skips disabled CI fixes, falls through to feedback, and blocks readiness with a reason", () => {
    const steps = { fix_ci: { enabled: false } };
    const s = snap({ checks: [failingCheck], feedback: [comment] });
    expect(decide(s, cfg, mem(), steps)).toMatchObject({ kind: "run", action: "address_feedback" });

    const d = decide(snap({ checks: [failingCheck] }), cfg, mem(), steps);
    expect(d.kind).toBe("blocked");
    if (d.kind === "blocked") expect(d.reasons).toEqual(["CI failing (test): CI fixes disabled"]);
  });

  it("falls through a disabled comment fixer to the own review", () => {
    const d = decide(snap({ headRefOid: "head2", feedback: [comment] }), cfg, mem(), {
      address_feedback: { enabled: false },
    });
    expect(d).toMatchObject({ kind: "run", action: "review", key: "review:head2" });
  });

  it("blocks on a conflict without running anything when conflict fixes are disabled", () => {
    const d = decide(snap({ mergeable: "CONFLICTING" }), cfg, mem(), { fix_conflict: { enabled: false } });
    expect(d).toMatchObject({ kind: "blocked", reasons: ["merge conflict: conflict fixes disabled"] });
  });

  it("treats a disabled own review like review off, and blocks on findings when review fixes are disabled", () => {
    const off = decide(snap({ headRefOid: "head2" }), cfg, mem(), { review: { enabled: false } });
    expect(off.kind).toBe("ready");
    if (off.kind === "ready") expect(off.notes).toContain("own review disabled");

    const findings = mem({ lastReview: { sha: "head1", blocking: [{ severity: "P1", title: "bug" }] } });
    const d = decide(snap(), cfg, findings, { fix_review: { enabled: false } });
    expect(d).toMatchObject({ kind: "blocked", reasons: ["1 blocking review finding(s): review fixes disabled"] });
  });

  it("uses the per-step max attempts instead of the global cap", () => {
    const s = snap({ checks: [failingCheck] });
    const tried = mem({ actions: new Map([["ci:head1", { status: "failed" as const, attempts: 2 }]]) });
    // global cap is 2: exhausted
    expect(decide(s, cfg, tried).kind).toBe("blocked");
    // step cap 4: retry
    expect(decide(s, cfg, tried, { fix_ci: { maxAttempts: 4 } })).toMatchObject({ kind: "run", action: "fix_ci" });
    // step cap 1 on a fresh-ish action: exhausted after one attempt
    const once = mem({ actions: new Map([["ci:head1", { status: "failed" as const, attempts: 1 }]]) });
    expect(decide(s, cfg, once).kind).toBe("run");
    const d = decide(s, cfg, once, { fix_ci: { maxAttempts: 1 } });
    expect(d.kind).toBe("blocked");
    if (d.kind === "blocked") expect(d.reasons[0]).toContain("fix attempts exhausted");
    // a null override keeps the global cap
    expect(decide(s, cfg, once, { fix_ci: { maxAttempts: null } }).kind).toBe("run");
  });
});
