/**
 * Pure helpers for the run inspector: what a run's settle note says about pushed commits, and how
 * review findings map to the fix runs and commits that addressed them.
 */

export type PushInfo = {
  status: "pushed" | "dry_run" | "none";
  commits: number;
  /** Short head sha from the note ("head 6626fab"), pushed runs only. */
  head: string | null;
};

/** Reads the push part of a settle note: "pushed 2 commit(s), head 6626fab; ..." / "1 commit(s) made locally". */
export function parsePushNote(note: string | null | undefined): PushInfo {
  const text = note ?? "";
  const pushed = /pushed (\d+) commit\(s\), head ([0-9a-f]{7,40})/.exec(text);
  if (pushed) return { status: "pushed", commits: Number(pushed[1]), head: pushed[2] };
  const local = /(\d+) commit\(s\) made locally/.exec(text);
  if (local) return { status: "dry_run", commits: Number(local[1]), head: null };
  return { status: "none", commits: 0, head: null };
}

export type CommitRef = { sha: string; subject: string };

export type FindingRef = {
  severity: string;
  file: string | null;
  line: number | null;
  title: string;
  detail: string | null;
};

export type FixItem = {
  /** Finding title (fix_review) or feedback id (address_feedback). */
  key: string;
  title: string | null;
  feedbackId: string | null;
  verdict: string;
  reason: string | null;
  replyText: string | null;
  /** The commits of this run when the item was fixed; empty otherwise. */
  commits: CommitRef[];
  /** The review finding the item answers (fix_review), when it could be matched by title. */
  finding: FindingRef | null;
  /** The PR comment the item answers (address_feedback), when it is still in the PR snapshot. */
  feedback: { author: string; path: string | null; line: number | null; url: string | null; excerpt: string } | null;
};

export type FeedbackLookup = Map<string, NonNullable<FixItem["feedback"]>>;

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Normalized title for matching a fix item to its finding. */
export function normTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/[`'"*_]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function sameTitle(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  const x = normTitle(a);
  const y = normTitle(b);
  if (!x || !y) return false;
  return x === y || (Math.min(x.length, y.length) >= 12 && (x.includes(y) || y.includes(x)));
}

export const isFixedVerdict = (v: string) => v.startsWith("fixed");

export function findingsOf(result: unknown): FindingRef[] {
  const list = (result as { findings?: unknown })?.findings;
  if (!Array.isArray(list)) return [];
  return list
    .filter((f) => f && typeof f === "object")
    .map((f: Record<string, unknown>) => ({
      severity: (str(f.severity) ?? "P3").toUpperCase(),
      file: str(f.file),
      line: num(f.line),
      title: str(f.title) ?? "(untitled finding)",
      detail: str(f.detail),
    }));
}

/** fix_review / address_feedback: each result item with the run's commits (if fixed) and what it answers. */
export function mapFixItems(
  result: unknown,
  commits: CommitRef[],
  opts: { findings?: FindingRef[]; feedback?: FeedbackLookup } = {},
): FixItem[] {
  const items = (result as { items?: unknown })?.items;
  if (!Array.isArray(items)) return [];
  return items
    .filter((i) => i && typeof i === "object")
    .map((i: Record<string, unknown>) => {
      const title = str(i.title);
      const feedbackId = i.feedback_id != null ? String(i.feedback_id) : null;
      const verdict = str(i.verdict) ?? "unknown";
      return {
        key: title ?? feedbackId ?? "?",
        title,
        feedbackId,
        verdict,
        reason: str(i.reason),
        replyText: str(i.reply_text),
        commits: isFixedVerdict(verdict) ? commits : [],
        finding: title ? (opts.findings?.find((f) => sameTitle(f.title, title)) ?? null) : null,
        feedback: feedbackId ? (opts.feedback?.get(feedbackId) ?? null) : null,
      };
    });
}

export type LinkedFix = {
  taskId: string;
  verdict: string | null;
  reason: string | null;
  commits: CommitRef[];
  head: string | null;
};

export type ReviewFindingLink = FindingRef & {
  blocking: boolean;
  /** The fix_review run that took the finding, null when none ran (yet) or the finding is P2/P3. */
  fix: LinkedFix | null;
};

export const BLOCKING = new Set(["P0", "P1"]);

/** review: each finding, linked to the fix run that followed (blocking findings only get one). */
export function mapReviewFindings(
  result: unknown,
  fixRun: { taskId: string; result: unknown; commits: CommitRef[]; head: string | null } | null,
): ReviewFindingLink[] {
  const fixItems = fixRun ? mapFixItems(fixRun.result, fixRun.commits) : [];
  return findingsOf(result).map((f) => {
    const blocking = BLOCKING.has(f.severity);
    if (!blocking || !fixRun) return { ...f, blocking, fix: null };
    const item = fixItems.find((i) => sameTitle(i.title, f.title));
    return {
      ...f,
      blocking,
      fix: {
        taskId: fixRun.taskId,
        verdict: item?.verdict ?? null,
        reason: item?.reason ?? null,
        commits: item ? item.commits : fixRun.commits,
        head: fixRun.head,
      },
    };
  });
}

export type RunRef = { taskId: string; action: string; startedAt: number };

/** The fix_review run that answered a review: the first one after it, before the PR's next review. */
export function followingFixRun(review: RunRef, samePr: RunRef[]): RunRef | null {
  const later = samePr.filter((r) => r.startedAt > review.startedAt).sort((a, b) => a.startedAt - b.startedAt);
  for (const r of later) {
    if (r.action === "review") return null;
    if (r.action === "fix_review") return r;
  }
  return null;
}

/** The review a fix_review run answered: the latest review before it. */
export function precedingReview(fix: RunRef, samePr: RunRef[]): RunRef | null {
  const earlier = samePr
    .filter((r) => r.action === "review" && r.startedAt < fix.startedAt)
    .sort((a, b) => b.startedAt - a.startedAt);
  return earlier[0] ?? null;
}

/** Accepts "owner/repo#12", "repo#12", "#12" or "12" against a stored pr key. */
export function prMatches(prKey: string, query: string): boolean {
  const q = query.trim();
  if (!q) return true;
  if (prKey === q) return true;
  const [repo, n] = prKey.split("#");
  if (/^#?\d+$/.test(q)) return n === q.replace(/^#/, "");
  const short = `${repo.split("/")[1] ?? repo}#${n}`;
  return short === q || prKey.toLowerCase().includes(q.toLowerCase());
}
