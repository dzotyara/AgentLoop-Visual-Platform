import { describe, expect, it } from "vitest";
import type { PrPatrolConfig } from "./config.ts";
import { decide, type PatrolMemory } from "./decide.ts";
import { extractFeedback, normalizeChecks, type PrSnapshot } from "./github.ts";

const cfg: PrPatrolConfig = {
  enabled: true,
  write: false,
  replyToThreads: false,
  review: true,
  includeDrafts: false,
  intervalMs: 60_000,
  maxConcurrent: 2,
  maxAttempts: 2,
  maxReviewRounds: 3,
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
        { id: "T1", kind: "review_thread", author: "bob", body: "x", path: "a.ts", line: 3, url: null, createdAt: "" },
      ],
    });
    expect(decide(fb, cfg, mem())).toMatchObject({ kind: "run", action: "address_feedback" });
    expect(decide(fb, cfg, mem({ handledFeedbackIds: new Set(["T1"]) })).kind).toBe("ready");

    expect(decide(snap({ headRefOid: "head2" }), cfg, mem())).toMatchObject({
      kind: "run",
      action: "review",
      key: "review:head2",
    });
  });

  it("fixes blocking review findings on the reviewed head", () => {
    const d = decide(
      snap(),
      cfg,
      mem({ lastReview: { sha: "head1", blocking: [{ severity: "high", title: "bug" }] } }),
    );
    expect(d).toMatchObject({ kind: "run", action: "fix_review", key: "fixreview:head1" });
  });

  it("caps review rounds and notes it instead of blocking", () => {
    const d = decide(snap({ headRefOid: "head9" }), cfg, mem({ reviewRounds: 3 }));
    expect(d.kind).toBe("ready");
    if (d.kind === "ready") expect(d.notes.join()).toContain("review round cap");
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
    expect(decide(pending, cfg, mem()).kind).toBe("wait");
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
