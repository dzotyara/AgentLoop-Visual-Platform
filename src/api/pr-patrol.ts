import { post, put, request } from "./core";
import { setCrewSeats } from "./crew-seats";

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
  /** Agent id -> crew seat (Argus, Patch, Rivet, Splice, Medic, Weaver, Gate); stable when agents are renamed. */
  crew?: Record<string, string>;
  prs: PrPatrolPr[];
};

export async function getPrPatrolStatus(): Promise<PrPatrolStatus> {
  const status = await request<PrPatrolStatus>("/api/pr-patrol/status");
  setCrewSeats(status.crew);
  return status;
}

export function triggerPrPatrolTick(): Promise<{ ok: boolean }> {
  return post<{ ok: boolean }>("/api/pr-patrol/tick");
}

/** Agent steps of the loop that the pipeline settings can configure (server: pipeline.ts PIPELINE_STEPS). */
export type PrPatrolStepKind = "fix_conflict" | "fix_ci" | "address_feedback" | "review" | "fix_review";

/** `null` = use the env default (see PrPatrolPipelineDefaults). */
export type PrPatrolStepSettings = { enabled: boolean; model: string | null; maxAttempts: number | null };

export type PrPatrolPipeline = {
  steps: Record<PrPatrolStepKind, PrPatrolStepSettings>;
  maxConcurrent: number | null;
  maxReviewRounds: number | null;
};

export type PrPatrolPipelineDefaults = {
  maxConcurrent: number;
  maxAttempts: number;
  maxReviewRounds: number;
  model: string | null;
  review: boolean;
};

export type PrPatrolPipelineResponse = { pipeline: PrPatrolPipeline; defaults: PrPatrolPipelineDefaults };

/** Partial update: unknown keys are rejected with 400 `invalid_pipeline`; model "default" or null clears it. */
export type PrPatrolPipelineUpdate = {
  steps?: Partial<Record<PrPatrolStepKind, Partial<PrPatrolStepSettings>>>;
  maxConcurrent?: number | null;
  maxReviewRounds?: number | null;
};

export function getPipeline(): Promise<PrPatrolPipelineResponse> {
  return request<PrPatrolPipelineResponse>("/api/pr-patrol/pipeline");
}

export function savePipeline(update: PrPatrolPipelineUpdate): Promise<PrPatrolPipelineResponse> {
  return put<PrPatrolPipelineResponse>("/api/pr-patrol/pipeline", update);
}

export type LoopMetricsDistribution = { medianMs: number | null; p90Ms: number | null; n: number };
export type LoopMetricsWaitBucket = "ci" | "reviewer" | "github" | "you" | "agent" | "ready";

/** GET /api/pr-patrol/metrics: see server/modules/pr-patrol/metrics.ts. */
export type LoopMetrics = {
  days: number;
  since: number;
  until: number;
  /** First recorded phase event (null: none yet); metrics in needsHistory only cover time after it. */
  history: { since: number | null; needsHistory: string[] };
  kpis: {
    timeToGreen: LoopMetricsDistribution;
    timeToMerge: LoopMetricsDistribution;
    mergedPrs: number;
    mergedWithAgentHelp: number;
    costPerMergedPrUsd: number | null;
    runsPerMergedPr: number | null;
    runsPerActivePr: number | null;
    acceptedFindingsRate: number | null;
    spendUsd: number;
    todaySpendUsd: number;
    runs: number;
  };
  outcomes: Array<{
    action: string;
    agent: string;
    runs: number;
    done: number;
    failed: number;
    running: number;
    costUsd: number;
    medianDurationMs: number | null;
  }>;
  findings: { reviews: number; bySeverity: Record<"P0" | "P1" | "P2" | "P3", number> };
  verdicts: Array<{ action: string; accepted: number; declined: number; noAction: number; blocked: number }>;
  ci: {
    classification: Record<"branch" | "flaky" | "infra" | "unknown", number>;
    flakyChecks: Array<{ name: string; flips: number; classifiedFlaky: number; prs: number; lastAt: number }>;
  };
  waiting: Array<{ on: LoopMetricsWaitBucket; ms: number }>;
  daily: Array<{ day: string; start: number; spendUsd: number; runs: number; prsReady: number; prsMerged: number }>;
  merged: Array<{
    prKey: string;
    mergedAt: number;
    runs: number;
    costUsd: number;
    timeToGreenMs: number | null;
    timeToMergeMs: number | null;
  }>;
};

export function getLoopMetrics(days: number): Promise<LoopMetrics> {
  return request<LoopMetrics>(`/api/pr-patrol/metrics?days=${encodeURIComponent(String(days))}`);
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
