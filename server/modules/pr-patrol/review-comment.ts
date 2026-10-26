import type { ReviewFinding, Severity } from "./decide.ts";

const LEGACY: Record<string, Severity> = { critical: "P0", high: "P1", medium: "P2", low: "P3" };

/** Accepts P0..P3 in any case, and the older critical/high/medium/low scale; unknown → P2. */
export function normalizeSeverity(raw: unknown): Severity {
  const s = String(raw ?? "")
    .trim()
    .toUpperCase();
  if (s === "P0" || s === "P1" || s === "P2" || s === "P3") return s;
  return LEGACY[s.toLowerCase()] ?? "P2";
}

const ORDER: Severity[] = ["P0", "P1", "P2", "P3"];

/** The `[review]` PR comment for one review round. */
export function formatReviewComment(input: {
  findings: ReviewFinding[];
  summary: string;
  reviewer: string;
  headSha: string;
  autoFix: boolean;
}): string {
  const { findings, summary, reviewer, headSha, autoFix } = input;
  const sorted = [...findings].sort((a, b) => ORDER.indexOf(a.severity) - ORDER.indexOf(b.severity));
  const count = (sev: Severity) => findings.filter((f) => f.severity === sev).length;
  const blocking = count("P0") + count("P1");
  const tally = ORDER.map((sev) => `${sev}: ${count(sev)}`).join(" · ");
  const lines = [
    `[review] ${findings.length === 0 ? "No findings" : `${findings.length} finding(s), ${blocking} blocking`} — ${tally}`,
    "",
    `_Automated review by ${reviewer} (pr-patrol) of \`${headSha.slice(0, 7)}\`: correctness, silent failures, security._`,
  ];
  if (summary.trim()) lines.push("", summary.trim());
  for (const f of sorted) {
    const where = f.file ? ` \`${f.file}${f.line ? `:${f.line}` : ""}\`` : "";
    lines.push("", `- **[${f.severity}]**${where} — ${f.title}`);
    if (f.detail) lines.push(`  ${f.detail.trim().replace(/\n+/g, " ")}`);
    if (f.fix) lines.push(`  _Fix:_ ${f.fix.trim().replace(/\n+/g, " ")}`);
  }
  if (blocking > 0) {
    lines.push(
      "",
      autoFix
        ? "P0/P1 findings will be fixed automatically in this PR as `[fix]` commits; P2/P3 are left for the author."
        : "P0/P1 findings block merge; P2/P3 are left for the author.",
    );
  }
  return lines.join("\n");
}
