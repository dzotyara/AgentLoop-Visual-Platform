// Read-only preview of the auto-fix loop: lists patrolled PRs and prints what the loop would do next.
// Spawns no agents and writes nothing (memory is empty: as if the loop had never run).
import { loadPrPatrolConfig } from "../../server/modules/pr-patrol/config.ts";
import { decide } from "../../server/modules/pr-patrol/decide.ts";
import { fetchPrSnapshot, listPatrolledPrs } from "../../server/modules/pr-patrol/github.ts";

const cfg = loadPrPatrolConfig();
const prs = await listPatrolledPrs(cfg);
console.log(`query "${cfg.searchQuery}": ${prs.length} PR(s), write=${cfg.write}, review=${cfg.review}\n`);
for (const pr of prs) {
  try {
    const s = await fetchPrSnapshot(pr.repo, pr.number, cfg);
    const d = decide(s, cfg, { actions: new Map(), handledFeedbackIds: new Set(), lastReview: null, reviewRounds: 0 });
    const what =
      d.kind === "run"
        ? `RUN ${d.action}${d.failingChecks ? ` [${d.failingChecks.map((c) => c.name).join(", ")}]` : ""}${d.feedback ? ` [${d.feedback.length} item(s)]` : ""}`
        : d.kind === "blocked"
          ? `BLOCKED ${d.reasons.join("; ")}`
          : d.kind === "wait"
            ? `WAIT ${d.reason}`
            : d.kind === "skip"
              ? `SKIP ${d.reason}`
              : "READY";
    const failing = s.checks.filter((c) => c.state === "failure").length;
    console.log(
      `${pr.repo}#${pr.number}  ${what}\n    mergeable=${s.mergeable} checks: ${failing} failing / ${s.checks.length} · feedback: ${s.feedback.length} · ${s.title.slice(0, 70)}`,
    );
  } catch (err) {
    console.log(`${pr.repo}#${pr.number}  ERROR ${(err as Error).message.split("\n")[0]}`);
  }
}
