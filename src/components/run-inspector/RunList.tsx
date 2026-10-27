import type { ReactNode } from "react";
import type { PrPatrolRunStatus, PrPatrolRunSummary } from "../../api";
import PixelIcon from "../pixel/PixelIcon";
import { ACTION_LABEL } from "../pr-patrol/pr-ui";
import { AgentSprite, spriteFor } from "./RunHeader";
import { STATUS_META, formatCost, formatDuration, formatWhen, shortPr } from "./format";

export type RunFilters = {
  q: string;
  pr: string;
  agent: string;
  action: string;
  status: "" | PrPatrolRunStatus;
};

export const EMPTY_FILTERS: RunFilters = { q: "", pr: "", agent: "", action: "", status: "" };

const ACTIONS = ["review", "fix_review", "address_feedback", "fix_ci", "fix_conflict"];
const STATUSES: PrPatrolRunStatus[] = ["running", "done", "failed"];

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="rounded-full border px-2 py-0.5 text-[11px] transition"
      style={{
        borderColor: active ? "var(--th-focus-ring)" : "var(--th-card-border)",
        background: active ? "var(--th-card-bg-hover)" : "transparent",
        color: active ? "var(--th-text-heading)" : "var(--th-text-secondary)",
      }}
    >
      {children}
    </button>
  );
}

function Row({
  run,
  selected,
  sprite,
  onSelect,
}: {
  run: PrPatrolRunSummary;
  selected: boolean;
  sprite: number;
  onSelect: () => void;
}) {
  const st = STATUS_META[run.status] ?? STATUS_META.failed;
  return (
    <button
      type="button"
      onClick={onSelect}
      data-run-id={run.taskId}
      className="flex w-full items-start gap-2.5 rounded-lg border px-2.5 py-2 text-left transition"
      style={{
        borderColor: selected ? "var(--th-focus-ring)" : "var(--th-card-border)",
        background: selected ? "var(--th-card-bg-hover)" : "var(--th-card-bg)",
      }}
    >
      <AgentSprite sprite={sprite} name={run.agentName} size={32} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-xs">
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${st.dot}`} title={st.label} />
          <span className="font-medium" style={{ color: "var(--th-text-heading)" }}>
            {run.agentName ?? "Agent"}
          </span>
          <span className="truncate" style={{ color: "var(--th-text-secondary)" }}>
            {ACTION_LABEL[run.action] ?? run.action}
          </span>
          <span className="ml-auto shrink-0 font-mono text-[11px]" style={{ color: "var(--th-text-muted)" }}>
            {formatWhen(run.startedAt)}
          </span>
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-[11px]">
          <span className="font-mono" style={{ color: "var(--th-text-secondary)" }}>
            {shortPr(run.pr)}
          </span>
          <span className="font-mono" style={{ color: "var(--th-text-muted)" }}>
            {formatCost(run.costUsd)}
          </span>
          <span className="font-mono" style={{ color: "var(--th-text-muted)" }}>
            {formatDuration(run.durationMs)}
          </span>
          {run.push.status === "pushed" && (
            <span
              className="inline-flex items-center gap-0.5"
              style={{ color: "var(--th-text-muted)" }}
              title="pushed commits"
            >
              <PixelIcon name="git" size={10} />
              {run.push.commits}
            </span>
          )}
        </div>
        <div
          className="mt-0.5 line-clamp-1 text-[11px]"
          style={{ color: "var(--th-text-muted)" }}
          title={run.note ?? ""}
        >
          {run.note ?? run.title}
        </div>
      </div>
    </button>
  );
}

export default function RunList({
  runs,
  total,
  loading,
  error,
  searchCapped,
  filters,
  onFilters,
  agentNames,
  selectedId,
  spriteMap,
  onSelect,
}: {
  runs: PrPatrolRunSummary[];
  total: number;
  loading: boolean;
  error: string | null;
  searchCapped: boolean;
  filters: RunFilters;
  onFilters: (f: RunFilters) => void;
  agentNames: string[];
  selectedId: string | null;
  spriteMap: Map<string, number>;
  onSelect: (taskId: string) => void;
}) {
  const set = (patch: Partial<RunFilters>) => onFilters({ ...filters, ...patch });
  const inputStyle = {
    borderColor: "var(--th-input-border)",
    background: "var(--th-input-bg)",
    color: "var(--th-text-primary)",
  };
  return (
    <div className="flex min-h-0 flex-col gap-2">
      <div className="flex items-center gap-2 rounded-lg border px-2 py-1.5" style={inputStyle}>
        <PixelIcon name="search" size={12} />
        <input
          type="search"
          value={filters.q}
          onChange={(e) => set({ q: e.target.value })}
          placeholder="Search titles, notes, commands, results"
          aria-label="Search runs"
          className="min-w-0 flex-1 bg-transparent text-sm outline-none"
        />
      </div>
      <div className="flex gap-2">
        <input
          value={filters.pr}
          onChange={(e) => set({ pr: e.target.value })}
          placeholder="PR (e.g. 11168)"
          aria-label="Filter by PR"
          className="min-w-0 flex-1 rounded-lg border px-2 py-1 text-xs outline-none"
          style={inputStyle}
        />
        <select
          value={filters.agent}
          onChange={(e) => set({ agent: e.target.value })}
          aria-label="Filter by agent"
          className="rounded-lg border px-2 py-1 text-xs outline-none"
          style={inputStyle}
        >
          <option value="">All agents</option>
          {agentNames.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-wrap gap-1">
        <Chip active={!filters.status} onClick={() => set({ status: "" })}>
          Any status
        </Chip>
        {STATUSES.map((s) => (
          <Chip key={s} active={filters.status === s} onClick={() => set({ status: filters.status === s ? "" : s })}>
            {STATUS_META[s].label}
          </Chip>
        ))}
      </div>
      <div className="flex flex-wrap gap-1">
        <Chip active={!filters.action} onClick={() => set({ action: "" })}>
          All actions
        </Chip>
        {ACTIONS.map((a) => (
          <Chip key={a} active={filters.action === a} onClick={() => set({ action: filters.action === a ? "" : a })}>
            {ACTION_LABEL[a] ?? a}
          </Chip>
        ))}
      </div>
      <div className="flex items-center justify-between text-[11px]" style={{ color: "var(--th-text-muted)" }}>
        <span>
          {loading ? "Loading..." : `${runs.length} of ${total} run(s)`}
          {searchCapped ? " · search stopped early (log scan cap)" : ""}
        </span>
      </div>
      {error && <div className="text-xs text-rose-400">{error}</div>}
      <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto pr-1">
        {runs.map((r) => (
          <Row
            key={r.taskId}
            run={r}
            selected={r.taskId === selectedId}
            sprite={spriteFor(r, spriteMap)}
            onSelect={() => onSelect(r.taskId)}
          />
        ))}
        {!loading && !runs.length && (
          <div className="py-6 text-center text-sm" style={{ color: "var(--th-text-muted)" }}>
            No runs match.
          </div>
        )}
      </div>
    </div>
  );
}
