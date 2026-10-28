import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { PrPatrolConfig } from "./config.ts";

const execFileAsync = promisify(execFile);

export type CheckState = "success" | "failure" | "pending" | "neutral";

export type PrCheck = {
  name: string;
  workflow: string | null;
  state: CheckState;
  rawConclusion: string | null;
  detailsUrl: string | null;
};

export type PrFeedback = {
  /** Stable id: GraphQL node id of the thread / review / issue comment. */
  id: string;
  /**
   * id + hash of the text. "Handled" is remembered per key, so a comment edited in place (bots post a
   * placeholder and rewrite it with the real review) comes back as new feedback.
   */
  key: string;
  kind: "review_thread" | "review_body" | "pr_comment";
  author: string;
  body: string;
  path: string | null;
  line: number | null;
  url: string | null;
  createdAt: string;
  /** Posted by a GitHub App / bot account (review bots), not a person. */
  bot: boolean;
  /** A bot's placeholder or progress checklist that will be rewritten with the real review. */
  inProgress: boolean;
  /**
   * blocking = P0/P1-level (and every human comment): always fixed. minor = P2/P3 / nits: fixed within the
   * per-PR P2/P3 round budget. none = a bot status summary with nothing to act on.
   */
  severity: "blocking" | "minor" | "none";
  /** minor with nothing above P3 (no P2 / medium): counts against the smaller P3-only round budget too. */
  p3Only?: boolean;
};

/** GitHub merge queue entry: state is QUEUED | AWAITING_CHECKS | MERGEABLE | UNMERGEABLE | LOCKED. */
export type MergeQueueEntry = { state: string; position: number; enqueuedAt: string };

export type PrSnapshot = {
  repo: string; // owner/name
  number: number;
  title: string;
  url: string;
  state: string; // OPEN | CLOSED | MERGED
  isDraft: boolean;
  isCrossRepository: boolean;
  headRefName: string;
  headRefOid: string;
  baseRefName: string;
  baseRefOid: string;
  mergeable: string; // MERGEABLE | CONFLICTING | UNKNOWN
  mergeStateStatus: string;
  reviewDecision: string | null;
  /** Set while the PR sits in GitHub's merge queue. */
  mergeQueue?: MergeQueueEntry | null;
  /** Reviewers whose latest review still requests changes. */
  changesRequestedBy?: string[];
  checks: PrCheck[];
  feedback: PrFeedback[];
};

export async function gh(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("gh", args, {
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, GH_PAGER: "" },
  });
  return stdout;
}

async function ghJson<T>(args: string[]): Promise<T> {
  return JSON.parse(await gh(args)) as T;
}

let cachedLogin: string | null = null;
export async function viewerLogin(): Promise<string> {
  if (!cachedLogin) cachedLogin = (await gh(["api", "user", "--jq", ".login"])).trim();
  return cachedLogin;
}

export async function listPatrolledPrs(cfg: PrPatrolConfig): Promise<Array<{ repo: string; number: number }>> {
  const rows = await ghJson<Array<{ repository: { nameWithOwner: string }; number: number; isDraft: boolean }>>([
    "search",
    "prs",
    "--state",
    "open",
    "--limit",
    "100",
    "--json",
    "repository,number,isDraft",
    // One argument per term: gh quotes an argument holding a space as a phrase,
    // and `--` keeps a negated qualifier such as `-head:release-cut` from parsing as a flag.
    "--",
    ...cfg.searchQuery.split(/\s+/).filter(Boolean),
  ]);
  return rows
    .filter((r) => cfg.includeDrafts || !r.isDraft)
    .map((r) => ({ repo: r.repository.nameWithOwner, number: r.number }))
    .filter((r) => cfg.repoAllowlist.length === 0 || cfg.repoAllowlist.includes(r.repo))
    .filter((r) => !cfg.repoDenylist.includes(r.repo));
}

type RawCheck = {
  __typename: "CheckRun" | "StatusContext";
  name?: string;
  context?: string;
  workflowName?: string;
  status?: string;
  conclusion?: string | null;
  state?: string;
  detailsUrl?: string;
  targetUrl?: string;
  startedAt?: string;
  completedAt?: string;
};

export function normalizeChecks(raw: RawCheck[]): PrCheck[] {
  // statusCheckRollup can carry several runs of the same check (re-runs); keep the latest one.
  const latest = new Map<string, RawCheck>();
  for (const c of raw ?? []) {
    const key = `${c.workflowName ?? ""}::${c.name ?? c.context ?? "?"}`;
    const prev = latest.get(key);
    const at = (x: RawCheck) => x.completedAt || x.startedAt || "";
    if (!prev || at(c) >= at(prev)) latest.set(key, c);
  }
  return [...latest.values()].map((c) => {
    let state: CheckState;
    let rawConclusion: string | null;
    if (c.__typename === "StatusContext") {
      rawConclusion = c.state ?? null;
      state = c.state === "SUCCESS" ? "success" : c.state === "FAILURE" || c.state === "ERROR" ? "failure" : "pending";
    } else {
      rawConclusion = c.conclusion ?? null;
      if (c.status !== "COMPLETED") state = "pending";
      else if (c.conclusion === "SUCCESS") state = "success";
      else if (["FAILURE", "TIMED_OUT", "STARTUP_FAILURE", "ACTION_REQUIRED"].includes(c.conclusion ?? ""))
        state = "failure";
      else state = "neutral"; // SKIPPED, NEUTRAL, CANCELLED, STALE
    }
    return {
      name: c.name ?? c.context ?? "?",
      workflow: c.workflowName ?? null,
      state,
      rawConclusion,
      detailsUrl: c.detailsUrl ?? c.targetUrl ?? null,
    };
  });
}

const FEEDBACK_QUERY = `
query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviewThreads(first: 100) {
        nodes {
          id isResolved isOutdated path line
          comments(first: 30) { nodes { author { login __typename } body url createdAt } }
        }
      }
      reviews(last: 50) { nodes { id state body url createdAt author { login __typename } } }
      comments(last: 50) { nodes { id body url createdAt author { login __typename } } }
      mergeQueueEntry { state position enqueuedAt }
    }
  }
}`;

type FeedbackResponse = {
  data: {
    repository: {
      pullRequest: {
        mergeQueueEntry?: MergeQueueEntry | null;
        reviewThreads: {
          nodes: Array<{
            id: string;
            isResolved: boolean;
            isOutdated: boolean;
            path: string | null;
            line: number | null;
            comments: {
              nodes: Array<{
                author: { login: string; __typename?: string } | null;
                body: string;
                url: string;
                createdAt: string;
              }>;
            };
          }>;
        };
        reviews: {
          nodes: Array<{
            id: string;
            state: string;
            body: string;
            url: string;
            createdAt: string;
            author: { login: string; __typename?: string } | null;
          }>;
        };
        comments: {
          nodes: Array<{
            id: string;
            body: string;
            url: string;
            createdAt: string;
            author: { login: string; __typename?: string } | null;
          }>;
        };
      };
    };
  };
};

const BLOCKING_RE =
  /\[P[01]\]|\bP[01]\b|\bcritical\b|\bhigh(?:-severity| severity| findings?)\b|must fix|fix the high|security (?:issue|hole|vulnerab)/i;
const NO_BLOCKERS_RE = /no blocking issues|0 blocking|no (?:p0|p1)\b|nothing blocking/i;
const P2_RE = /\[P2\]|\bP2\b|\bmedium\b/i;
const MINOR_RE = /\[P[23]\]|\bP[23]\b|\bnit\b|\bmedium\b|\blow\b|suggest|consider|could be|wording|typo/i;

/** How a comment should be treated by the fixers; see PrFeedback.severity and .inProgress. */
export function classifyFeedback(body: string, bot: boolean): Pick<PrFeedback, "inProgress" | "severity" | "p3Only"> {
  if (!bot) return { inProgress: false, severity: "blocking" };
  const unchecked = /- \[ \]/.test(body);
  const checked = /- \[x\]/i.test(body);
  const placeholder = /claude code is working|i'll analyze this|is working on it|working on your request/i.test(body);
  if ((placeholder || (unchecked && !checked)) && !/\[P[0-3]\]/.test(body))
    return { inProgress: true, severity: "none" };
  if (BLOCKING_RE.test(body) && !NO_BLOCKERS_RE.test(body)) return { inProgress: false, severity: "blocking" };
  if (MINOR_RE.test(body)) return { inProgress: false, severity: "minor", p3Only: !P2_RE.test(body) };
  return { inProgress: false, severity: "none" };
}

function feedbackKey(id: string, body: string): string {
  return `${id}:${createHash("sha1").update(body).digest("hex").slice(0, 12)}`;
}

export function extractFeedback(resp: FeedbackResponse, me: string, ignored: string[]): PrFeedback[] {
  const pr = resp.data.repository.pullRequest;
  const skip = (login: string | undefined) => !login || login === me || ignored.includes(login);
  const out: PrFeedback[] = [];
  for (const t of pr.reviewThreads.nodes) {
    if (t.isResolved || t.isOutdated) continue;
    const comments = t.comments.nodes;
    const last = comments[comments.length - 1];
    // The PR author answered last: the thread waits on the reviewer, not on us.
    if (!last || skip(last.author?.login)) continue;
    const threadBody = comments.map((c) => `@${c.author?.login ?? "?"}: ${c.body}`).join("\n\n---\n\n");
    const threadBot = last.author?.__typename === "Bot";
    out.push({
      bot: threadBot,
      ...classifyFeedback(last.body, threadBot),
      id: t.id,
      key: feedbackKey(t.id, threadBody),
      kind: "review_thread",
      author: last.author?.login ?? "?",
      body: threadBody,
      path: t.path,
      line: t.line,
      url: last.url,
      createdAt: last.createdAt,
    });
  }
  for (const r of pr.reviews.nodes) {
    if (skip(r.author?.login) || !r.body?.trim()) continue;
    if (r.state !== "CHANGES_REQUESTED" && r.state !== "COMMENTED") continue;
    const reviewBot = r.author?.__typename === "Bot";
    out.push({
      bot: reviewBot,
      ...classifyFeedback(r.body, reviewBot),
      id: r.id,
      key: feedbackKey(r.id, r.body),
      kind: "review_body",
      author: r.author?.login ?? "?",
      body: r.body,
      path: null,
      line: null,
      url: r.url,
      createdAt: r.createdAt,
    });
  }
  for (const c of pr.comments.nodes) {
    if (skip(c.author?.login) || !c.body?.trim()) continue;
    const commentBot = c.author?.__typename === "Bot";
    out.push({
      bot: commentBot,
      ...classifyFeedback(c.body, commentBot),
      id: c.id,
      key: feedbackKey(c.id, c.body),
      kind: "pr_comment",
      author: c.author?.login ?? "?",
      body: c.body,
      path: null,
      line: null,
      url: c.url,
      createdAt: c.createdAt,
    });
  }
  return out;
}

/** Logins whose most recent decisive review (approve / request changes / dismissed) requests changes. */
export function extractChangesRequestedBy(resp: FeedbackResponse): string[] {
  const latest = new Map<string, string>();
  for (const r of resp.data.repository.pullRequest.reviews.nodes) {
    const login = r.author?.login;
    if (!login || !["APPROVED", "CHANGES_REQUESTED", "DISMISSED"].includes(r.state)) continue;
    latest.set(login, r.state); // nodes come oldest → newest
  }
  return [...latest].filter(([, state]) => state === "CHANGES_REQUESTED").map(([login]) => login);
}

export async function fetchPrSnapshot(repo: string, number: number, cfg: PrPatrolConfig): Promise<PrSnapshot> {
  const [owner, name] = repo.split("/");
  const view = await ghJson<{
    number: number;
    title: string;
    url: string;
    state: string;
    isDraft: boolean;
    isCrossRepository: boolean;
    headRefName: string;
    headRefOid: string;
    baseRefName: string;
    baseRefOid: string;
    mergeable: string;
    mergeStateStatus: string;
    reviewDecision: string | null;
    statusCheckRollup: RawCheck[];
  }>([
    "pr",
    "view",
    String(number),
    "-R",
    repo,
    "--json",
    "number,title,url,state,isDraft,isCrossRepository,headRefName,headRefOid,baseRefName,baseRefOid,mergeable,mergeStateStatus,reviewDecision,statusCheckRollup",
  ]);
  const feedbackResp = await ghJson<FeedbackResponse>([
    "api",
    "graphql",
    "-f",
    `query=${FEEDBACK_QUERY}`,
    "-F",
    `owner=${owner}`,
    "-F",
    `name=${name}`,
    "-F",
    `number=${number}`,
  ]);
  const me = await viewerLogin();
  return {
    repo,
    number: view.number,
    title: view.title,
    url: view.url,
    state: view.state,
    isDraft: view.isDraft,
    isCrossRepository: view.isCrossRepository,
    headRefName: view.headRefName,
    headRefOid: view.headRefOid,
    baseRefName: view.baseRefName,
    baseRefOid: view.baseRefOid,
    mergeable: view.mergeable,
    mergeStateStatus: view.mergeStateStatus,
    reviewDecision: view.reviewDecision || null,
    changesRequestedBy: extractChangesRequestedBy(feedbackResp),
    mergeQueue: feedbackResp.data.repository.pullRequest.mergeQueueEntry ?? null,
    checks: normalizeChecks(view.statusCheckRollup),
    feedback: extractFeedback(feedbackResp, me, cfg.ignoredCommenters),
  };
}

/** Re-run only the failed jobs of the workflow runs behind the given check URLs. */
export async function rerunFailedRuns(repo: string, checks: PrCheck[]): Promise<string[]> {
  const runIds = new Set<string>();
  for (const c of checks) {
    const m = c.detailsUrl?.match(/\/actions\/runs\/(\d+)/);
    if (m) runIds.add(m[1]);
  }
  const done: string[] = [];
  for (const id of runIds) {
    try {
      await gh(["run", "rerun", id, "--failed", "-R", repo]);
      done.push(id);
    } catch {
      // A run that is still in progress or already re-run refuses; the next tick re-evaluates.
    }
  }
  return done;
}

/** Posts a top-level PR comment as the gh user; returns its URL. */
export async function postPrComment(repo: string, number: number, body: string): Promise<string> {
  const out = await gh(["api", `repos/${repo}/issues/${number}/comments`, "-f", `body=${body}`, "--jq", ".html_url"]);
  return out.trim();
}

export async function replyAndResolveThread(threadId: string, body: string): Promise<void> {
  await gh([
    "api",
    "graphql",
    "-f",
    "query=mutation($id: ID!, $body: String!) { addPullRequestReviewThreadReply(input: {pullRequestReviewThreadId: $id, body: $body}) { comment { id } } }",
    "-f",
    `id=${threadId}`,
    "-f",
    `body=${body}`,
  ]);
  await gh([
    "api",
    "graphql",
    "-f",
    "query=mutation($id: ID!) { resolveReviewThread(input: {threadId: $id}) { thread { id } } }",
    "-f",
    `id=${threadId}`,
  ]);
}
