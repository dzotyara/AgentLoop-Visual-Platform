import { request } from "./core";

export type ClaudeCostWindow = { costUsd: number; runs: number };
export type ClaudeCostBreakdown = { key: string; label: string; costUsd: number; runs: number };

export type ClaudeCostSummary = {
  today: ClaudeCostWindow;
  last7d: ClaudeCostWindow;
  last30d: ClaudeCostWindow;
  allTime: ClaudeCostWindow;
  byModel: ClaudeCostBreakdown[];
  byAgent: ClaudeCostBreakdown[];
  byPr: ClaudeCostBreakdown[];
  recent: Array<{ taskId: string; title: string; costUsd: number; models: string[]; createdAt: number }>;
  updatedAt: number;
};

export function getClaudeCosts(): Promise<ClaudeCostSummary> {
  return request<ClaudeCostSummary>("/api/claude-costs");
}

export function formatUsd(v: number): string {
  if (v >= 100) return `$${v.toFixed(0)}`;
  if (v >= 1) return `$${v.toFixed(2)}`;
  return `$${v.toFixed(3)}`;
}
