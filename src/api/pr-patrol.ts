import { post, request } from "./core";

export type PrPatrolPhase = "watching" | "working" | "waiting" | "blocked" | "ready" | "merging" | "skipped" | "error";

export type PrPatrolCheck = {
  name: string;
  workflow: string | null;
  state: "success" | "failure" | "pending" | "neutral";
  rawConclusion: string | null;
  detailsUrl: string | null;
  ignored: boolean;
};

export type PrPatrolFeedback = {
  id: string;
  kind: "review_thread" | "review_body" | "pr_comment";
  author: string;
  path: string | null;
  line: number | null;
  url: string | null;
  excerpt: string;
  handled: boolean;
};

export type PrPatrolMergeQueue = { state: string; position: number; enqueuedAt: string };

export type PrPatrolSnapshot = {
  /** Set while the PR sits in GitHub's merge queue. */
  mergeQueue?: PrPatrolMergeQueue | null;
  headRefName: string;
  baseRefName: string;
  isDraft: boolean;
  mergeable: string;
  mergeStateStatus: string;
  reviewDecision: string | null;
  checks: PrPatrolCheck[];
  feedback: PrPatrolFeedback[];
  fetchedAt: number;
};

export type PrPatrolAction = {
  action: string;
  status: "running" | "done" | "failed";
  attempts: number;
  taskId: string | null;
  updatedAt: number;
  note: string | null;
};

export type PrPatrolPr = {
  pr_key: string;
  repo: string;
  number: number;
  title: string;
  url: string;
  head_sha: string;
  phase: PrPatrolPhase;
  summary: string;
  /** Who/what the PR waits for: ci | reviewer | github | you | agent; null while an agent works or it is ready. */
  waiting_on: string | null;
  notes: string[];
  review_rounds: number;
  updated_at: number;
  snapshot: PrPatrolSnapshot | null;
  agent: {
    id: string;
    name: string;
    action: string;
    taskId: string;
    activity: string;
    activityAt: number;
    toolCalls: number;
  } | null;
  actions: PrPatrolAction[];
};

export type PrPatrolStatus = {
  enabled: boolean;
  write: boolean;
  replyToThreads: boolean;
  review: boolean;
  intervalMs: number;
  maxConcurrent: number;
  lastTick: { at: number; error: string | null; prs: number };
  prs: PrPatrolPr[];
};

export function getPrPatrolStatus(): Promise<PrPatrolStatus> {
  return request<PrPatrolStatus>("/api/pr-patrol/status");
}

export function triggerPrPatrolTick(): Promise<{ ok: boolean }> {
  return post<{ ok: boolean }>("/api/pr-patrol/tick");
}

// ---- run inspector (GET /api/pr-patrol/runs, /api/pr-patrol/runs/:taskId) ----

export type PrPatrolRunStatus = "running" | "done" | "failed";

export type PrPatrolPushInfo = { status: "pushed" | "dry_run" | "none"; commits: number; head: string | null };

export type PrPatrolRunSummary = {
  taskId: string;
  title: string;
  pr: string | null;
  prUrl: string | null;
  action: string;
  agentId: string | null;
  agentName: string | null;
  agentSprite: number | null;
  status: PrPatrolRunStatus;
  attempts: number | null;
  startedAt: number | null;
  completedAt: number | null;
  durationMs: number | null;
  costUsd: number | null;
  models: string[];
  turns: number | null;
  note: string | null;
  push: PrPatrolPushInfo;
  hasLog: boolean;
};

export type PrPatrolRunList = {
  runs: PrPatrolRunSummary[];
  total: number;
  scannedLogs: number;
  searchCapped: boolean;
};

export type PrPatrolRunStep = {
  index: number;
  at: number | null;
  kind: "tool" | "text" | "result" | "error";
  tool: string | null;
  summary: string;
  input: string | null;
  output: string | null;
  isError: boolean;
  files: string[];
  durationMs: number | null;
  parentToolUseId: string | null;
};

export type PrPatrolModelUsage = {
  model: string;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
};

export type PrPatrolRunTotals = {
  costUsd: number;
  turns: number;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  byModel: PrPatrolModelUsage[];
};

export type PrPatrolCommitRef = { sha: string; subject: string };

export type PrPatrolRunLog = {
  runIndex: number;
  runCount: number;
  startedAt: number | null;
  provider: string | null;
  model: string | null;
  cwd: string | null;
  steps: PrPatrolRunStep[];
  stepsCapped: boolean;
  toolCalls: number;
  errors: number;
  totals: PrPatrolRunTotals | null;
  finalText: string | null;
  finished: boolean;
  isError: boolean;
  truncated: boolean;
  files: string[];
  logCommits: PrPatrolCommitRef[];
};

export type PrPatrolRunCommit = {
  sha: string;
  subject: string;
  author: string | null;
  date: string | null;
  diff: string;
  diffTruncated: boolean;
};

export type PrPatrolFindingRef = {
  severity: string;
  file: string | null;
  line: number | null;
  title: string;
  detail: string | null;
};

export type PrPatrolFixItem = {
  key: string;
  title: string | null;
  feedbackId: string | null;
  verdict: string;
  reason: string | null;
  replyText: string | null;
  commits: PrPatrolCommitRef[];
  finding: PrPatrolFindingRef | null;
  feedback: { author: string; path: string | null; line: number | null; url: string | null; excerpt: string } | null;
};

export type PrPatrolReviewFindingLink = PrPatrolFindingRef & {
  blocking: boolean;
  fix: {
    taskId: string;
    verdict: string | null;
    reason: string | null;
    commits: PrPatrolCommitRef[];
    head: string | null;
  } | null;
};

export type PrPatrolRunLinks =
  | { kind: "fix"; reviewTaskId: string | null; items: PrPatrolFixItem[] }
  | { kind: "review"; fixTaskId: string | null; findings: PrPatrolReviewFindingLink[] }
  | { kind: "none" };

export type PrPatrolRunDetail = {
  run: PrPatrolRunSummary;
  log: PrPatrolRunLog | null;
  runs: Array<{ index: number; startedAt: number | null; finished: boolean }>;
  result: unknown;
  commits: PrPatrolRunCommit[];
  commitError: string | null;
  links: PrPatrolRunLinks;
};

export type PrPatrolRunQuery = {
  pr?: string;
  agent?: string;
  action?: string;
  status?: string;
  q?: string;
  limit?: number;
};

export function listRuns(query: PrPatrolRunQuery = {}): Promise<PrPatrolRunList> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && String(v).trim() !== "") params.set(k, String(v));
  }
  const qs = params.toString();
  return request<PrPatrolRunList>(`/api/pr-patrol/runs${qs ? `?${qs}` : ""}`);
}

export function getRun(taskId: string, runIndex?: number): Promise<PrPatrolRunDetail> {
  const qs = runIndex != null ? `?run=${runIndex}` : "";
  return request<PrPatrolRunDetail>(`/api/pr-patrol/runs/${encodeURIComponent(taskId)}${qs}`);
}
