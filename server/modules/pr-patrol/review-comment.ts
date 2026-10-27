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

const ICON: Record<Severity, string> = { P0: "⛔", P1: "🔴", P2: "🟠", P3: "⚪" };

/** Table cells: one line, no pipes, bounded. */
function cell(text: string, max = 140): string {
  const one = text.replace(/\s+/g, " ").replace(/\|/g, "\\|").trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}

/**
 * The review comment for one round ("Review Agent" card): a header with the short head sha, a verdict with
 * P0..P3 counts, a findings table (most severe first), the reasoning and fixes folded in a <details>, and a
 * small footer with the [review] tag and the fix policy.
 */
export function formatReviewComment(input: {
  findings: ReviewFinding[];
  summary: string;
  reviewer: string;
  headSha: string;
  autoFix: boolean;
  /** P2/P3 round budget, for the footer. */
  nitRounds?: number;
}): string {
  const { findings, summary, reviewer, headSha, autoFix, nitRounds = 5 } = input;
  const sorted = [...findings].sort((a, b) => ORDER.indexOf(a.severity) - ORDER.indexOf(b.severity));
  const count = (sev: Severity) => findings.filter((f) => f.severity === sev).length;
  const blocking = count("P0") + count("P1");
  const lines = [`### 🤖 Review Agent · \`${headSha.slice(0, 7)}\``];

  if (findings.length === 0) {
    lines.push("**No findings** — correctness, silent failures, security");
    if (summary.trim())
      lines.push("", `<details><summary>What was reviewed</summary>\n\n${summary.trim()}\n</details>`);
    lines.push("", `<sub>[review] ${reviewer} · pr-patrol</sub>`);
    return lines.join("\n");
  }

  const verdict = blocking > 0 ? `**${blocking} blocking**` : "**No blocking findings**";
  lines.push(
    `${verdict} · ${ORDER.map((sev) => `${sev} ${count(sev)}`).join(" · ")}`,
    "",
    "| | Where | Finding |",
    "|---|---|---|",
  );
  for (const f of sorted) {
    const where = f.file ? `\`${cell(f.file, 80)}${f.line ? `:${f.line}` : ""}\`` : "—";
    lines.push(`| ${ICON[f.severity]} ${f.severity} | ${where} | ${cell(f.title)} |`);
  }

  const details = sorted
    .filter((f) => f.detail || f.fix)
    .map((f) => {
      const where = f.file ? ` \`${f.file}${f.line ? `:${f.line}` : ""}\`` : "";
      const parts = [`**${ICON[f.severity]} ${f.severity}**${where} — ${f.title.trim()}`];
      if (f.detail) parts.push(f.detail.trim());
      if (f.fix) parts.push(`_Fix:_ ${f.fix.trim()}`);
      return parts.join("\n\n");
    });
  if (details.length || summary.trim()) {
    const body = [...(summary.trim() ? [summary.trim()] : []), ...details].join("\n\n---\n\n");
    lines.push("", `<details><summary>Details and suggested fixes</summary>\n\n${body}\n</details>`);
  }

  const policy = autoFix
    ? `P0/P1 fixed here as [fix] commits · P2/P3 up to ${nitRounds} rounds`
    : "P0/P1 block merge · P2/P3 left for the author";
  lines.push("", `<sub>[review] ${reviewer} · ${policy}</sub>`);
  return lines.join("\n");
}
