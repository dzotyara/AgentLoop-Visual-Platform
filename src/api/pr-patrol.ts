import { post, put, request } from "./core";

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
