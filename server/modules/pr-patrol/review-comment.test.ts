import { describe, expect, it } from "vitest";
import { formatReviewComment, normalizeSeverity } from "./review-comment.ts";

describe("review comment", () => {
  it("normalizes P0-P3 and the legacy scale", () => {
    expect(normalizeSeverity("p1")).toBe("P1");
    expect(normalizeSeverity("critical")).toBe("P0");
    expect(normalizeSeverity("low")).toBe("P3");
    expect(normalizeSeverity("whatever")).toBe("P2");
  });

  it("starts with [review], tallies P0-P3 and lists findings most severe first", () => {
    const body = formatReviewComment({
      findings: [
        { severity: "P3", title: "nit", file: "a.ts" },
        { severity: "P1", title: "real bug", file: "b.ts", line: 7, detail: "breaks x", fix: "guard y" },
      ],
      summary: "Looks mostly fine.",
      reviewer: "Argus",
      headSha: "abcdef1234",
      autoFix: true,
    });
    expect(body.startsWith("[review] 2 finding(s), 1 blocking — P0: 0 · P1: 1 · P2: 0 · P3: 1")).toBe(true);
    expect(body.indexOf("**[P1]**")).toBeLessThan(body.indexOf("**[P3]**"));
    expect(body).toContain("`b.ts:7` — real bug");
    expect(body).toContain("as `[fix]` commits");
  });

  it("says so when there is nothing to fix", () => {
    const body = formatReviewComment({ findings: [], summary: "", reviewer: "Argus", headSha: "abc", autoFix: true });
    expect(body.startsWith("[review] No findings")).toBe(true);
    expect(body).not.toContain("[fix]");
  });
});
