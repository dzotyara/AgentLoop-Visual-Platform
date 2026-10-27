import type { PrPatrolAction, PrPatrolPr, PrPatrolStepKind } from "../../api";
import type { PixelIconName } from "../pixel/PixelIcon";

/**
 * The pr-patrol loop as a graph: one node per step, in the priority order decide() checks them
 * (server/modules/pr-patrol/decide.ts). Agent steps carry a `step` and are configurable; the merge-queue
 * hold, the CI wait and the Gate are fixed parts of the loop.
 */

export type PipelineNodeId =
  | "merge_queue"
  | "fix_conflict"
  | "fix_ci"
  | "address_feedback"
  | "review"
  | "fix_review"
  | "wait_ci"
  | "ready";

export type StepDef = {
  id: PipelineNodeId;
  title: string;
  /** Patrol agent that runs (or owns) the step; null for steps no agent runs. */
  agent: string | null;
  /** Sprite the server gives that agent (pr-patrol PATROL_AGENTS), used if the agent row is not loaded. */
  fallbackSprite: number | null;
  icon: PixelIconName;
  blurb: string;
  /** Title-bar colour, ComfyUI style. */
  accent: string;
  step: PrPatrolStepKind | null;
};

export const STEPS: StepDef[] = [
  {
    id: "merge_queue",
    title: "Merge queue hold",
    agent: null,
    fallbackSprite: null,
    icon: "queue",
    blurb: "In GitHub's merge queue: agents stay off the branch",
    accent: "#5b4a8a",
    step: null,
  },
  {
    id: "fix_conflict",
    title: "Conflict",
    agent: "Weaver",
    fallbackSprite: 11,
    icon: "conflict",
    blurb: "Merges the base branch and resolves conflicts",
    accent: "#8a4a4a",
    step: "fix_conflict",
  },
  {
    id: "fix_ci",
    title: "CI",
    agent: "Medic",
    fallbackSprite: 9,
    icon: "ci",
    blurb: "Reads failing CI logs; fixes the branch or re-runs flaky jobs",
    accent: "#8a6a3a",
    step: "fix_ci",
  },
  {
    id: "address_feedback",
    title: "Comments",
    agent: "Patch",
    fallbackSprite: 3,
    icon: "chat",
    blurb: "Judges review comments, fixes the valid ones",
    accent: "#3a6a8a",
    step: "address_feedback",
  },
  {
    id: "review",
    title: "Review",
    agent: "Argus",
    fallbackSprite: 7,
    icon: "review",
    blurb: "Own review of the new head, P0-P3 findings",
    accent: "#3a7a5a",
    step: "review",
  },
  {
    id: "fix_review",
    title: "Review fixes",
    agent: "Patch",
    fallbackSprite: 3,
    icon: "fix",
    blurb: "Verifies blocking (P0/P1) findings, fixes or declines them",
    accent: "#3a5a8a",
    step: "fix_review",
  },
  {
    id: "wait_ci",
    title: "Wait for CI",
    agent: null,
    fallbackSprite: null,
    icon: "clock",
    blurb: "Checks running, mergeability or a reviewer pending",
    accent: "#5a5f6a",
    step: null,
  },
  {
    id: "ready",
    title: "Ready",
    agent: "Gate",
    fallbackSprite: 5,
    icon: "ready",
    blurb: "Checks green, feedback handled, review clean",
    accent: "#2f7a4f",
    step: null,
  },
];

export const STEP_INDEX: Record<PipelineNodeId, number> = Object.fromEntries(STEPS.map((s, i) => [s.id, i])) as Record<
  PipelineNodeId,
  number
>;

/** Wire type of the loop: every port carries a PR. ComfyUI colours wires by type. */
export const PR_WIRE = "#d6b65a";

export type LiveState = "working" | "waiting" | "blocked" | "ready" | "merging" | "queued";

export const LIVE_COLOR: Record<LiveState, string> = {
  working: "#38bdf8",
  waiting: "#f59e0b",
  queued: "#f59e0b",
  blocked: "#f43f5e",
  ready: "#10b981",
  merging: "#8b5cf6",
};

export const LIVE_LABEL: Record<LiveState, string> = {
  working: "Working",
  waiting: "Waiting",
  queued: "Queued",
  blocked: "Needs you",
  ready: "Ready",
  merging: "Merge queue",
};

export type NodeOutcome = Pick<PrPatrolAction, "status" | "note" | "taskId" | "attempts" | "updatedAt">;

export type NodeLive = {
  /** The PR sits at this node. */
  active: boolean;
  state: LiveState | null;
  /** Why it is in that state (phase summary / blocked reason / agent activity). */
  reason: string | null;
  /** The PR passed this node on its way to the active one. */
  passed: boolean;
  /** Last run of this step for the PR. */
  outcome: NodeOutcome | null;
  /** Run to open on click: the live run while working, else the last one. */
  runTaskId: string | null;
};

const BLOCKED_PATTERNS: Array<[RegExp, PipelineNodeId]> = [
  [/merge conflict/i, "fix_conflict"],
  [/^CI failing/i, "fix_ci"],
  [/review comment\(s\) unhandled/i, "address_feedback"],
  [/own review/i, "review"],
  [/review finding/i, "fix_review"],
];

/** "queued: <label> ..." / "queued: <Agent> is busy ..." from the server's ACTION_LABEL and agent names. */
const QUEUED_PATTERNS: Array<[RegExp, PipelineNodeId]> = [
  [/Fix review findings/i, "fix_review"],
  [/Address review comments/i, "address_feedback"],
  [/Resolve merge conflict/i, "fix_conflict"],
  [/Fix CI/i, "fix_ci"],
  [/queued: Review\b/i, "review"],
  [/\bWeaver\b/, "fix_conflict"],
  [/\bMedic\b/, "fix_ci"],
  [/\bArgus\b/, "review"],
  [/\bPatch\b/, "address_feedback"],
];

export type PrLocation = {
  active: PipelineNodeId | null;
  state: LiveState | null;
  reason: string | null;
  /** Every node a blocked reason points at (the first is `active`). */
  blockedAt: PipelineNodeId[];
};

/** Where on the graph a PR is, from its phase, live agent and summary. */
export function locatePr(pr: PrPatrolPr): PrLocation {
  const none: PrLocation = { active: null, state: null, reason: pr.summary || null, blockedAt: [] };
  switch (pr.phase) {
    case "merging":
      return { active: "merge_queue", state: "merging", reason: pr.summary, blockedAt: [] };
    case "ready":
      return { active: "ready", state: "ready", reason: pr.summary, blockedAt: [] };
    case "waiting":
      return { active: "wait_ci", state: "waiting", reason: pr.summary, blockedAt: [] };
    case "working": {
      const action = pr.agent?.action;
      const node = STEPS.find((s) => s.step && s.step === action)?.id ?? null;
      return node ? { active: node, state: "working", reason: pr.agent?.activity || pr.summary, blockedAt: [] } : none;
    }
    case "blocked": {
      const reasons = pr.summary.split("; ").filter(Boolean);
      const at: PipelineNodeId[] = [];
      for (const r of reasons) {
        const hit = BLOCKED_PATTERNS.find(([re]) => re.test(r))?.[1];
        if (hit && !at.includes(hit)) at.push(hit);
      }
      at.sort((a, b) => STEP_INDEX[a] - STEP_INDEX[b]);
      return at.length ? { active: at[0], state: "blocked", reason: pr.summary, blockedAt: at } : none;
    }
    case "watching": {
      const hit = QUEUED_PATTERNS.find(([re]) => re.test(pr.summary))?.[1] ?? null;
      return hit ? { active: hit, state: "queued", reason: pr.summary, blockedAt: [] } : none;
    }
    default:
      return none;
  }
}

/** Most recent run per step (actions arrive newest first, but do not rely on it). */
export function lastOutcomes(actions: PrPatrolAction[]): Partial<Record<PipelineNodeId, NodeOutcome>> {
  const out: Partial<Record<PipelineNodeId, NodeOutcome>> = {};
  for (const a of [...actions].sort((x, y) => y.updatedAt - x.updatedAt)) {
    const node = STEPS.find((s) => s.step === a.action)?.id;
    if (!node || out[node]) continue;
    out[node] = { status: a.status, note: a.note, taskId: a.taskId, attempts: a.attempts, updatedAt: a.updatedAt };
  }
  return out;
}

export function emptyLive(): NodeLive {
  return { active: false, state: null, reason: null, passed: false, outcome: null, runTaskId: null };
}

/** Per-node live overlay for one PR (or a blank graph without one). */
export function overlayFor(pr: PrPatrolPr | null): Record<PipelineNodeId, NodeLive> {
  const out = Object.fromEntries(STEPS.map((s) => [s.id, emptyLive()])) as Record<PipelineNodeId, NodeLive>;
  if (!pr) return out;
  const loc = locatePr(pr);
  const outcomes = lastOutcomes(pr.actions ?? []);
  const activeIdx = loc.active ? STEP_INDEX[loc.active] : -1;
  for (const s of STEPS) {
    const live = out[s.id];
    const idx = STEP_INDEX[s.id];
    live.outcome = outcomes[s.id] ?? null;
    live.runTaskId = live.outcome?.taskId ?? null;
    live.passed = idx < activeIdx;
    if (loc.blockedAt.includes(s.id)) {
      live.state = "blocked";
      live.reason =
        pr.summary.split("; ").find((r) => BLOCKED_PATTERNS.some(([re, id]) => id === s.id && re.test(r))) ?? null;
    }
  }
  if (loc.active) {
    const live = out[loc.active];
    live.active = true;
    live.state = loc.state;
    live.reason = live.reason ?? loc.reason;
    if (loc.state === "working" && pr.agent?.taskId) live.runTaskId = pr.agent.taskId;
  }
  return out;
}

/** Index of the active node, -1 without one: edges up to it animate. */
export function activeIndex(overlay: Record<PipelineNodeId, NodeLive>): number {
  const hit = STEPS.find((s) => overlay[s.id].active);
  return hit ? STEP_INDEX[hit.id] : -1;
}

/** Two rows of four, left to right, like a ComfyUI workflow laid out on a canvas. */
export const NODE_WIDTH = 260;
export function nodePosition(index: number): { x: number; y: number } {
  const row = Math.floor(index / 4);
  const col = index % 4;
  return { x: col * (NODE_WIDTH + 90), y: row * 420 };
}
