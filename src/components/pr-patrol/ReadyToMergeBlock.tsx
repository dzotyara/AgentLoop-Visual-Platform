import { formatUsd, type ClaudeCostSummary, type PrPatrolPr } from "../../api";
import { checksSummary, timeAgo } from "./pr-ui";

/**
 * PRs the loop has cleared: checks green, no conflicts, feedback handled, own review clean.
 * Merging stays with the author; the block links to GitHub and to the PR's details.
 */
export default function ReadyToMergeBlock({
  prs,
  costs,
  compact = false,
  onSelect,
}: {
  prs: PrPatrolPr[];
  costs?: ClaudeCostSummary | null;
  compact?: boolean;
  onSelect?: (prKey: string) => void;
}) {
  if (prs.length === 0) return null;
  return (
    <section
      className="rounded-xl border px-3 py-3"
      style={{ borderColor: "rgba(16,185,129,0.45)", background: "rgba(16,185,129,0.07)" }}
    >
      <header className="mb-2 flex items-center gap-2">
        <h3 className="text-sm font-semibold text-emerald-500">✅ Ready to merge</h3>
        <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-500">
          {prs.length}
        </span>
        <span className="text-[11px]" style={{ color: "var(--th-text-muted)" }}>
          checks green · no conflicts · comments handled · review clean
        </span>
      </header>
      <div className={`grid gap-2 ${compact ? "sm:grid-cols-2 xl:grid-cols-3" : "md:grid-cols-2 xl:grid-cols-3"}`}>
        {prs.map((pr) => {
          const checks = checksSummary(pr.snapshot?.checks ?? []);
          const spend = costs?.byPr.find((b) => b.key === pr.pr_key);
          return (
            <div
              key={pr.pr_key}
              className="flex min-w-0 flex-col gap-1 rounded-lg border px-3 py-2"
              style={{ borderColor: "rgba(16,185,129,0.35)", background: "var(--th-bg-surface)" }}
            >
              <div className="flex items-center gap-2 text-[11px]" style={{ color: "var(--th-text-muted)" }}>
                <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
                {pr.repo} #{pr.number}
                <span className="ml-auto shrink-0">{timeAgo(pr.updated_at)}</span>
              </div>
              <div
                className="line-clamp-2 text-sm font-medium leading-snug"
                style={{ color: "var(--th-text-primary)" }}
              >
                {pr.title}
              </div>
              {!compact && pr.snapshot && (
                <div className="truncate font-mono text-[11px]" style={{ color: "var(--th-text-muted)" }}>
                  {pr.snapshot.headRefName} → {pr.snapshot.baseRefName}
                </div>
              )}
              <div className="flex flex-wrap items-center gap-x-2 text-[11px]">
                <span className="text-emerald-500">✓ {checks.text}</span>
                {spend && <span className="text-violet-400">· {formatUsd(spend.costUsd)} agent spend</span>}
              </div>
              {pr.notes.length > 0 && (
                <div className="text-[11px] text-amber-500">{pr.notes.map((n) => `· ${n}`).join(" ")}</div>
              )}
              <div className="mt-1 flex items-center gap-3 text-xs">
                <a
                  href={pr.url}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-emerald-500 hover:underline"
                >
                  Open on GitHub ↗
                </a>
                {onSelect && (
                  <button
                    type="button"
                    onClick={() => onSelect(pr.pr_key)}
                    className="hover:underline"
                    style={{ color: "var(--th-text-secondary)" }}
                  >
                    Details
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
