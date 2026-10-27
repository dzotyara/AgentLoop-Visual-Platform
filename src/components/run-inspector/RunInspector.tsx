import { useEffect, useMemo, useRef, useState } from "react";
import { getRun, listRuns, type PrPatrolRunDetail, type PrPatrolRunList } from "../../api";
import type { Agent } from "../../types";
import { buildSpriteMap } from "../AgentAvatar";
import PixelIcon from "../pixel/PixelIcon";
import { Section } from "../pr-patrol/pr-ui";
import DiffView from "./DiffView";
import FindingsTable from "./FindingsTable";
import RunHeader, { spriteFor } from "./RunHeader";
import RunList, { EMPTY_FILTERS, type RunFilters } from "./RunList";
import RunTimeline from "./RunTimeline";
import { takeRunRequest } from "./run-request";

export { openRunRequest, takeRunRequest } from "./run-request";

const LIST_POLL_MS = 15_000;
const DETAIL_POLL_MS = 5_000;
const SEARCH_DEBOUNCE_MS = 300;
const PATROL_AGENTS = ["Argus", "Patch", "Medic", "Weaver"];

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function RunDetailPane({
  detail,
  sprite,
  onOpenRun,
  onPickRun,
}: {
  detail: PrPatrolRunDetail;
  sprite: number;
  onOpenRun: (taskId: string) => void;
  onPickRun: (index: number) => void;
}) {
  const { log, commits, links } = detail;
  const [showResult, setShowResult] = useState(false);
  const linkTitle = links.kind === "review" ? "Findings → fixes" : "Items → commits";
  return (
    <div className="flex flex-col gap-4">
      <div
        className="rounded-xl border px-4 py-3"
        style={{ borderColor: "var(--th-card-border)", background: "var(--th-card-bg)" }}
      >
        <RunHeader detail={detail} sprite={sprite} />
      </div>

      <Section
        title={`Timeline${log ? ` · ${log.steps.length} step(s)` : ""}`}
        right={
          detail.runs.length > 1 && log ? (
            <select
              value={log.runIndex}
              onChange={(e) => onPickRun(Number(e.target.value))}
              aria-label="Pick a run of this task"
              className="rounded border px-1.5 py-0.5 text-[11px]"
              style={{
                borderColor: "var(--th-input-border)",
                background: "var(--th-input-bg)",
                color: "var(--th-text-primary)",
              }}
            >
              {detail.runs.map((r) => (
                <option key={r.index} value={r.index}>
                  Run {r.index + 1} of {detail.runs.length}
                  {r.startedAt ? ` · ${new Date(r.startedAt).toLocaleTimeString()}` : ""}
                  {r.finished ? "" : " (unfinished)"}
                </option>
              ))}
            </select>
          ) : null
        }
      >
        {log ? (
          <RunTimeline steps={log.steps} start={log.startedAt} capped={log.stepsCapped} truncated={log.truncated} />
        ) : (
          <div className="text-sm" style={{ color: "var(--th-text-muted)" }}>
            No log for this run.
          </div>
        )}
      </Section>

      {(commits.length > 0 || detail.commitError) && (
        <Section title={`Changes · ${commits.length} commit(s)`}>
          {detail.commitError && (
            <div className="mb-2 flex items-center gap-1.5 text-xs text-amber-500">
              <PixelIcon name="warning" size={12} /> {detail.commitError}
            </div>
          )}
          <DiffView commits={commits} />
        </Section>
      )}

      {links.kind !== "none" && (
        <Section title={linkTitle}>
          <FindingsTable links={links} onOpenRun={onOpenRun} />
        </Section>
      )}

      {log?.finalText && (
        <Section title="Final report">
          <pre
            className="whitespace-pre-wrap break-words text-sm leading-relaxed"
            style={{ color: "var(--th-text-primary)", fontFamily: "inherit" }}
          >
            {log.finalText}
          </pre>
        </Section>
      )}

      {detail.result != null && (
        <Section
          title="Agent result JSON"
          right={
            <button
              type="button"
              onClick={() => setShowResult((v) => !v)}
              className="text-[11px] text-sky-500 hover:underline"
            >
              {showResult ? "Hide" : "Show"}
            </button>
          }
        >
          {showResult ? (
            <pre
              className="max-h-96 overflow-auto rounded-md px-3 py-2 font-mono text-[11px]"
              style={{ background: "var(--th-input-bg)", color: "var(--th-text-secondary)" }}
            >
              {JSON.stringify(detail.result, null, 2)}
            </pre>
          ) : (
            <div className="text-xs" style={{ color: "var(--th-text-muted)" }}>
              What the agent wrote to its result file.
            </div>
          )}
        </Section>
      )}
    </div>
  );
}

export default function RunInspector({ initialTaskId, agents }: { initialTaskId?: string | null; agents: Agent[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(() => takeRunRequest() ?? initialTaskId ?? null);
  const [runIndex, setRunIndex] = useState<number | undefined>(undefined);
  const [filters, setFilters] = useState<RunFilters>(EMPTY_FILTERS);
  const [list, setList] = useState<PrPatrolRunList | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [detail, setDetail] = useState<PrPatrolRunDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [knownAgents, setKnownAgents] = useState<string[]>([]);
  const spriteMap = useMemo(() => buildSpriteMap(agents), [agents]);

  useEffect(() => {
    if (initialTaskId) {
      setSelectedId(initialTaskId);
      setRunIndex(undefined);
    }
  }, [initialTaskId]);

  // ---- run list: debounced filters, periodic refresh, stale responses dropped ----
  const debounced = useDebounced(filters, SEARCH_DEBOUNCE_MS);
  const listSeq = useRef(0);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const seq = ++listSeq.current;
      try {
        const res = await listRuns({
          q: debounced.q,
          pr: debounced.pr,
          agent: debounced.agent,
          action: debounced.action,
          status: debounced.status,
          limit: 200,
        });
        if (!alive || seq !== listSeq.current) return;
        setList(res);
        setListError(null);
        setKnownAgents((prev) => {
          const names = new Set(prev);
          for (const r of res.runs) if (r.agentName) names.add(r.agentName);
          return names.size === prev.length ? prev : [...names].sort();
        });
      } catch (err) {
        if (alive && seq === listSeq.current) setListError(err instanceof Error ? err.message : String(err));
      } finally {
        if (alive && seq === listSeq.current) setListLoading(false);
      }
    };
    setListLoading(true);
    void load();
    const timer = setInterval(() => void load(), LIST_POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [debounced]);

  const runs = useMemo(() => list?.runs ?? [], [list]);
  const effectiveId = selectedId ?? runs[0]?.taskId ?? null;

  // ---- selected run detail; refreshed while the run is still going ----
  const detailSeq = useRef(0);
  const running = detail?.run.taskId === effectiveId && detail?.run.status === "running";
  useEffect(() => {
    if (!effectiveId) {
      setDetail(null);
      return;
    }
    let alive = true;
    const load = async (initial: boolean) => {
      const seq = ++detailSeq.current;
      if (initial) setDetailLoading(true);
      try {
        const d = await getRun(effectiveId, runIndex);
        if (!alive || seq !== detailSeq.current) return;
        setDetail(d);
        setDetailError(null);
      } catch (err) {
        if (alive && seq === detailSeq.current) setDetailError(err instanceof Error ? err.message : String(err));
      } finally {
        if (alive && seq === detailSeq.current) setDetailLoading(false);
      }
    };
    void load(true);
    const timer = running ? setInterval(() => void load(false), DETAIL_POLL_MS) : null;
    return () => {
      alive = false;
      if (timer) clearInterval(timer);
    };
  }, [effectiveId, runIndex, running]);

  const agentNames = useMemo(() => {
    const names = new Set(knownAgents);
    for (const a of agents) if (PATROL_AGENTS.includes(a.name)) names.add(a.name);
    return [...names].sort();
  }, [knownAgents, agents]);

  const select = (taskId: string) => {
    setSelectedId(taskId);
    setRunIndex(undefined);
  };

  const shownDetail = detail && detail.run.taskId === effectiveId ? detail : null;

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 lg:flex-row">
      <aside className="flex max-h-[45vh] min-h-0 w-full shrink-0 flex-col lg:max-h-none lg:w-[340px]">
        <RunList
          runs={runs}
          total={list?.total ?? 0}
          loading={listLoading && !list}
          error={listError}
          searchCapped={list?.searchCapped ?? false}
          filters={filters}
          onFilters={setFilters}
          agentNames={agentNames}
          selectedId={effectiveId}
          spriteMap={spriteMap}
          onSelect={select}
        />
      </aside>
      <main className="min-h-0 min-w-0 flex-1 overflow-y-auto">
        {detailError && !shownDetail && (
          <div className="p-4 text-sm text-rose-400">Could not load the run: {detailError}</div>
        )}
        {!effectiveId && !listLoading && (
          <div className="p-8 text-sm" style={{ color: "var(--th-text-muted)" }}>
            No agent runs yet.
          </div>
        )}
        {effectiveId && !shownDetail && detailLoading && (
          <div className="p-8 text-sm" style={{ color: "var(--th-text-muted)" }}>
            Loading run...
          </div>
        )}
        {shownDetail && (
          <RunDetailPane
            detail={shownDetail}
            sprite={spriteFor(shownDetail.run, spriteMap)}
            onOpenRun={select}
            onPickRun={(i) => setRunIndex(i)}
          />
        )}
      </main>
    </div>
  );
}
