import type { PrPatrolStatus } from "../../api";

/** What a patrol agent is doing right now, keyed by agent id; read by the Pixi scene every frame. */
export type LiveAgentWork = {
  prLabel: string; // "neuronet #11087"
  action: string;
  activity: string;
  toolCalls: number;
};

const byAgent = new Map<string, LiveAgentWork>();
let version = 0;

const ACTION_SHORT: Record<string, string> = {
  review: "Review",
  fix_review: "Fix review",
  address_feedback: "Comments",
  fix_ci: "Fix CI",
  fix_conflict: "Conflict",
};

export function setLiveFromStatus(status: PrPatrolStatus): void {
  byAgent.clear();
  for (const pr of status.prs) {
    if (!pr.agent) continue;
    byAgent.set(pr.agent.id, {
      prLabel: `${pr.repo.split("/")[1]} #${pr.number}`,
      action: ACTION_SHORT[pr.agent.action] ?? pr.agent.action,
      activity: pr.agent.activity,
      toolCalls: pr.agent.toolCalls,
    });
  }
  version++;
}

export function getLiveAgentWork(agentId: string): LiveAgentWork | undefined {
  return byAgent.get(agentId);
}

/** Bumps on every update so per-frame readers can skip unchanged data cheaply. */
export function liveVersion(): number {
  return version;
}
