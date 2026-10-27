import { describe, expect, it } from "vitest";
import {
  followingFixRun,
  mapFixItems,
  mapReviewFindings,
  parsePushNote,
  precedingReview,
  prMatches,
  sameTitle,
} from "./run-links.ts";

describe("parsePushNote", () => {
  it("reads pushed, dry-run and no-change notes", () => {
    expect(parsePushNote("pushed 2 commit(s), head 6626fab; 3/3 item(s) handled.")).toEqual({
      status: "pushed",
      commits: 2,
      head: "6626fab",
    });
    expect(parsePushNote("1 commit(s) made locally, not pushed (dry run: PR_PATROL_WRITE=0). x")).toEqual({
      status: "dry_run",
      commits: 1,
      head: null,
    });
    expect(parsePushNote("no changes; 1/1 item(s) handled.")).toEqual({ status: "none", commits: 0, head: null });
    expect(parsePushNote(null).status).toBe("none");
  });
});

describe("mapFixItems", () => {
  const commits = [{ sha: "a".repeat(40), subject: "[fix] guard null" }];

  it("attaches the run's commits to fixed items only and matches findings by title", () => {
    const items = mapFixItems(
      {
        items: [
          { title: "Null deref in parse()", verdict: "fixed", reason: "added guard" },
          { title: "Rename foo", verdict: "declined", reason: "name is public API" },
        ],
      },
      commits,
      { findings: [{ severity: "P1", file: "src/p.ts", line: 4, title: "Null deref in `parse()`", detail: null }] },
    );
    expect(items[0]).toMatchObject({ verdict: "fixed", commits, finding: { severity: "P1", line: 4 } });
    expect(items[1]).toMatchObject({ verdict: "declined", commits: [], finding: null });
  });

  it("maps address_feedback items to their comment", () => {
    const feedback = new Map([["IC_1", { author: "bot", path: null, line: null, url: "u", excerpt: "nit: typo" }]]);
    const items = mapFixItems(
      {
        items: [
          { feedback_id: "IC_1", verdict: "fixed-differently", reply_text: "done" },
          { feedback_id: 2, verdict: "no_action" },
        ],
      },
      commits,
      { feedback },
    );
    expect(items[0]).toMatchObject({ key: "IC_1", feedback: { author: "bot" }, commits, replyText: "done" });
    expect(items[1]).toMatchObject({ key: "2", feedback: null, commits: [] });
    expect(mapFixItems(null, commits)).toEqual([]);
  });
});

describe("mapReviewFindings", () => {
  const review = {
    findings: [
      { severity: "p1", file: "a.ts", line: 3, title: "Race in the cache refresh path", detail: "two writers" },
      { severity: "P3", file: "b.ts", title: "Typo" },
    ],
  };

  it("links blocking findings to the following fix run and its verdict", () => {
    const out = mapReviewFindings(review, {
      taskId: "fix-1",
      head: "beef123",
      commits: [{ sha: "beef123", subject: "[fix] lock refresh" }],
      result: { items: [{ title: "Race in the cache refresh path", verdict: "fixed", reason: "mutex" }] },
    });
    expect(out[0]).toMatchObject({
      severity: "P1",
      blocking: true,
      fix: { taskId: "fix-1", verdict: "fixed", commits: [{ sha: "beef123" }] },
    });
    expect(out[1]).toMatchObject({ severity: "P3", blocking: false, fix: null, line: null });
  });

  it("leaves findings unlinked when no fix run exists", () => {
    expect(mapReviewFindings(review, null).every((f) => f.fix === null)).toBe(true);
  });
});

describe("run ordering", () => {
  const runs = [
    { taskId: "r1", action: "review", startedAt: 1 },
    { taskId: "c1", action: "fix_ci", startedAt: 2 },
    { taskId: "f1", action: "fix_review", startedAt: 3 },
    { taskId: "r2", action: "review", startedAt: 4 },
    { taskId: "r3", action: "review", startedAt: 6 },
    { taskId: "f2", action: "fix_review", startedAt: 7 },
  ];

  it("finds the fix run that followed a review, stopping at the next review", () => {
    expect(followingFixRun(runs[0], runs)?.taskId).toBe("f1");
    expect(followingFixRun(runs[3], runs)).toBeNull();
    expect(followingFixRun(runs[4], runs)?.taskId).toBe("f2");
  });

  it("finds the review a fix run answered", () => {
    expect(precedingReview(runs[2], runs)?.taskId).toBe("r1");
    expect(precedingReview(runs[5], runs)?.taskId).toBe("r3");
    expect(precedingReview({ taskId: "x", action: "fix_review", startedAt: 0 }, runs)).toBeNull();
  });
});

describe("matching", () => {
  it("compares titles loosely", () => {
    expect(sameTitle("Null deref in `parse()`", "null deref in parse()")).toBe(true);
    expect(sameTitle("Race in the cache refresh path", "Race in the cache refresh path (P1)")).toBe(true);
    expect(sameTitle("a", "b")).toBe(false);
    expect(sameTitle(null, "b")).toBe(false);
  });

  it("matches PR queries", () => {
    expect(prMatches("acme/widgets#12", "12")).toBe(true);
    expect(prMatches("acme/widgets#12", "#12")).toBe(true);
    expect(prMatches("acme/widgets#120", "12")).toBe(false);
    expect(prMatches("acme/widgets#12", "widgets#12")).toBe(true);
    expect(prMatches("acme/widgets#12", "acme/widgets")).toBe(true);
    expect(prMatches("acme/widgets#12", "")).toBe(true);
  });
});
