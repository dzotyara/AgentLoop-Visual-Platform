import { describe, expect, it } from "vitest";
import { formatReviewComment, normalizeSeverity } from "./review-comment.ts";

describe("review comment", () => {
  it("normalizes P0-P3 and the legacy scale", () => {
    expect(normalizeSeverity("p1")).toBe("P1");
    expect(normalizeSeverity("critical")).toBe("P0");
    expect(normalizeSeverity("low")).toBe("P3");
    expect(normalizeSeverity("whatever")).toBe("P2");
  });

  it("renders the Review Agent card: header, P0-P3 counts, table most severe first, folded details, footer", () => {
    const body = formatReviewComment({
      findings: [
        { severity: "P3", title: "nit", file: "a.ts" },
        { severity: "P1", title: "real | bug", file: "b.ts", line: 7, detail: "breaks x", fix: "guard y" },
      ],
      summary: "Looks mostly fine.",
      reviewer: "Argus",
      headSha: "abcdef1234",
      autoFix: true,
      nitRounds: 5,
    });
    const lines = body.split("\n");
    expect(lines[0]).toBe("### \u{1F916} Review Agent \u00b7 `abcdef1`");
    expect(lines[1]).toBe("**1 blocking** \u00b7 P0 0 \u00b7 P1 1 \u00b7 P2 0 \u00b7 P3 1");
    expect(body.indexOf("| \u{1F534} P1 | `b.ts:7` | real \\| bug |")).toBeGreaterThan(0);
    expect(body.indexOf("P1 |")).toBeLessThan(body.indexOf("P3 |"));
    expect(body).toContain("<details><summary>Details and suggested fixes</summary>");
    expect(body).toContain("_Fix:_ guard y");
    expect(
      body
        .trim()
        .endsWith("<sub>[review] Argus \u00b7 P0/P1 fixed here as [fix] commits \u00b7 P2/P3 up to 5 rounds</sub>"),
    ).toBe(true);
  });

  it("says No findings in one line when the review is clean", () => {
    const body = formatReviewComment({
      findings: [],
      summary: "",
      reviewer: "Argus",
      headSha: "abc1234ff",
      autoFix: true,
    });
    expect(body).toBe(
      "### \u{1F916} Review Agent \u00b7 `abc1234`\n**No findings** \u2014 correctness, silent failures, security\n\n<sub>[review] Argus \u00b7 pr-patrol</sub>",
    );
  });

  it("calls a P2/P3-only round non-blocking", () => {
    const body = formatReviewComment({
      findings: [{ severity: "P2", title: "x" }],
      summary: "",
      reviewer: "Argus",
      headSha: "a",
      autoFix: true,
    });
    expect(body.split("\n")[1]).toBe("**No blocking findings** \u00b7 P0 0 \u00b7 P1 0 \u00b7 P2 1 \u00b7 P3 0");
  });

  it("renders the final review verdict: Approved for merge, or Not approved with the blockers", () => {
    const base = { summary: "", reviewer: "Argus", headSha: "abcdef1234", autoFix: true, final: true };
    const clean = formatReviewComment({ ...base, findings: [] }).split("\n");
    expect(clean[0]).toBe("### 🤖 Review Agent · Final review · `abcdef1`");
    expect(clean[1]).toBe("**✅ Approved for merge** · P0 0 · P1 0 · P2 0 · P3 0");
    expect(clean.at(-1)).toContain("final review: no findings");

    const nits = formatReviewComment({ ...base, findings: [{ severity: "P3", file: "a.ts", title: "nit" }] });
    expect(nits.split("\n")[1]).toBe("**✅ Approved for merge** · P0 0 · P1 0 · P2 0 · P3 1");
    expect(nits).toContain("| ⚪ P3 | `a.ts` | nit |");
    expect(nits).not.toContain("No blocking findings");

    const bad = formatReviewComment({ ...base, findings: [{ severity: "P1", title: "bug" }] });
    expect(bad.split("\n")[1]).toBe("**❌ Not approved: 1 blocking** · P0 0 · P1 1 · P2 0 · P3 0");
    expect(bad).toContain("reviewed again");
  });
});
