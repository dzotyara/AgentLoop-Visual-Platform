import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import type { ReviewFinding } from "./decide.ts";
import { createFollowUpStore, followUpFindings, followUpItems } from "./followups.ts";
import type { PrFeedback } from "./github.ts";

const input = (items: ReviewFinding[]) => ({
  prKey: "o/r#7",
  repo: "o/r",
  number: 7,
  title: "Add x",
  url: "https://github.com/o/r/pull/7",
  base: "staging",
  items,
});

const comment = (over: Partial<PrFeedback>): PrFeedback =>
  ({
    path: null,
    line: null,
    author: "codex[bot]",
    body: "rename this",
    p3Only: false,
    ...over,
  }) as PrFeedback;

describe("followUpItems", () => {
  it("joins the review's P2/P3 with the bots' comments, keeping their weight and location", () => {
    const review: ReviewFinding = { severity: "P2", title: "edge case" };
    expect(followUpItems([review], [comment({ path: "a.ts", line: 3, p3Only: true })])).toEqual([
      review,
      {
        severity: "P3",
        file: "a.ts",
        line: 3,
        title: "Comment by @codex[bot]",
        detail: "rename this",
      },
    ]);
  });
});

describe("follow-up store", () => {
  const store = () => createFollowUpStore(new DatabaseSync(":memory:"), () => 1);

  it("keeps one follow-up per merged PR", () => {
    const s = store();
    s.record(input([{ severity: "P2", title: "first" }]));
    s.record(input([{ severity: "P3", title: "second" }]));
    expect(s.pending()).toHaveLength(1);
    expect(followUpFindings(s.pending()[0]).map((f) => f.title)).toEqual(["first"]);
  });

  it("leaves pending once a PR is open, or when nothing applied", () => {
    const s = store();
    s.record(input([{ severity: "P2", title: "x" }]));
    s.setOpened("o/r#7", { pr: 9, url: "u" });
    expect(s.pending()).toEqual([]);
    expect(s.get("o/r#7")).toMatchObject({ status: "opened", fix_pr: 9 });
    s.record({ ...input([{ severity: "P2", title: "y" }]), prKey: "o/r#8", number: 8 });
    s.setNothing("o/r#8", "all stale");
    expect(s.pending()).toEqual([]);
  });

  it("retries a failed run once, then gives up", () => {
    const s = store();
    s.record(input([{ severity: "P2", title: "x" }]));
    s.fail("o/r#7", "push rejected");
    expect(s.get("o/r#7")).toMatchObject({ status: "pending", attempts: 1 });
    s.fail("o/r#7", "push rejected");
    expect(s.get("o/r#7")).toMatchObject({ status: "failed", attempts: 2 });
    expect(s.pending()).toEqual([]);
  });
});
