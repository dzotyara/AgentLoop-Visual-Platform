import { useCallback, useEffect, useMemo, useState, type MouseEvent } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  useNodesState,
  type Edge,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { Agent } from "../../types";
import {
  getCliModels,
  getPipeline,
  getPrPatrolStatus,
  savePipeline,
  type PrPatrolPipeline,
  type PrPatrolPipelineDefaults,
  type PrPatrolPr,
  type PrPatrolStepKind,
  type PrPatrolStepSettings,
} from "../../api";
import { usePolling } from "../../hooks/usePolling";
import { buildSpriteMap } from "../AgentAvatar";
import { crewSeatOf, useCrewSeats } from "../../api/crew-seats";
import PixelIcon from "../pixel/PixelIcon";
import { PHASE_META } from "../pr-patrol/pr-ui";
import { PipelineEditorContext, type PipelineEditor } from "./pipeline-context";
import {
  LIVE_COLOR,
  PR_WIRE,
  STEPS,
  activeIndex,
  nodePosition,
  overlayFor,
  type PipelineNodeId,
} from "./pipeline-model";
import { PipelineNode, type PipelineFlowNode } from "./PipelineNode";

const NODE_TYPES: NodeTypes = { step: PipelineNode };
const CANVAS = "#16171b";

function samePipeline(a: PrPatrolPipeline | null, b: PrPatrolPipeline | null): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Default PR for the picker: one an agent works on, else one that needs you, else the newest. */
function pickDefaultPr(prs: PrPatrolPr[]): string {
  const live = prs.filter((p) => p.phase !== "skipped");
  return (
    live.find((p) => p.phase === "working")?.pr_key ??
    live.find((p) => p.phase === "blocked")?.pr_key ??
    live[0]?.pr_key ??
    ""
  );
}

function NumberField({
  label,
  value,
  fallback,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number | null;
  fallback: number | undefined;
  min: number;
  max: number;
  onChange: (v: number | null) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 text-[11px] text-slate-400">
      <span>{label}</span>
      <input
        type="number"
        aria-label={label}
        min={min}
        max={max}
        value={value ?? ""}
        placeholder={fallback !== undefined ? `${fallback} (env)` : "env"}
        onChange={(e) => {
          const raw = e.target.value.trim();
          const n = Number.parseInt(raw, 10);
          onChange(raw === "" || !Number.isFinite(n) ? null : Math.min(max, Math.max(min, n)));
        }}
        className="w-20 rounded-md border border-[#3c3f48] bg-[#1c1d22] px-2 py-0.5 text-right text-slate-200 outline-none placeholder:text-slate-500"
      />
    </label>
  );
}

export default function PipelineGraph({ agents, onOpenRun }: { agents: Agent[]; onOpenRun: (taskId: string) => void }) {
  const { data: status, error: statusError } = usePolling(getPrPatrolStatus, 4000);
  const prs = useMemo(() => status?.prs ?? [], [status]);
  const [prKey, setPrKey] = useState<string | null>(null);
  const selectedKey = prKey ?? pickDefaultPr(prs);
  const pr = prs.find((p) => p.pr_key === selectedKey) ?? null;

  // pipeline settings: the saved copy and a local draft edited from the nodes
  const [saved, setSaved] = useState<PrPatrolPipeline | null>(null);
  const [draft, setDraft] = useState<PrPatrolPipeline | null>(null);
  const [defaults, setDefaults] = useState<PrPatrolPipelineDefaults | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getPipeline()
      .then((r) => {
        if (!alive) return;
        setSaved(r.pipeline);
        setDraft(r.pipeline);
        setDefaults(r.defaults);
      })
      .catch((e: unknown) => alive && setSaveError(e instanceof Error ? e.message : String(e)));
    getCliModels()
      .then((m) => alive && setModels((m.claude ?? []).map((x) => x.slug)))
      .catch(() => {
        // no model list: the selects still offer "default" and the saved value
      });
    return () => {
      alive = false;
    };
  }, []);

  const setStep = useCallback((step: PrPatrolStepKind, patch: Partial<PrPatrolStepSettings>) => {
    setDraft((d) => (d ? { ...d, steps: { ...d.steps, [step]: { ...d.steps[step], ...patch } } } : d));
  }, []);

  const dirty = !samePipeline(saved, draft);
  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setSaveError(null);
    try {
      const r = await savePipeline(draft);
      setSaved(r.pipeline);
      setDraft(r.pipeline);
      setDefaults(r.defaults);
    } catch (e: unknown) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const editor: PipelineEditor = useMemo(
    () => ({ draft, defaults, models, setStep, onOpenRun }),
    [draft, defaults, models, setStep, onOpenRun],
  );

  // live overlay of the picked PR
  const overlay = useMemo(() => overlayFor(pr), [pr]);
  const seats = useCrewSeats();
  /** Sprite and current name of the agent in a step's crew seat (def.agent is the seat, e.g. "Argus"). */
  const seatAgent = useMemo(() => {
    const map = buildSpriteMap(agents);
    return (seat: string | null, fallback: number | null): { sprite: number | null; agentName?: string } => {
      if (!seat) return { sprite: null };
      const agent = agents.find((a) => crewSeatOf(a) === seat);
      return { sprite: (agent && map.get(agent.id)) || fallback, agentName: agent?.name };
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seats: crewSeatOf reads the seat store
  }, [agents, seats]);

  const [nodes, setNodes, onNodesChange] = useNodesState<PipelineFlowNode>(
    STEPS.map((def, i) => ({
      id: def.id,
      type: "step",
      position: nodePosition(i),
      data: { def, live: overlay[def.id], ...seatAgent(def.agent, def.fallbackSprite) },
    })),
  );
  useEffect(() => {
    setNodes((ns) =>
      ns.map((n) => {
        const def = STEPS.find((s) => s.id === n.id) ?? n.data.def;
        return {
          ...n,
          data: { def, live: overlay[n.id as PipelineNodeId], ...seatAgent(def.agent, def.fallbackSprite) },
        };
      }),
    );
  }, [overlay, seatAgent, setNodes]);

  const edges: Edge[] = useMemo(() => {
    const upTo = activeIndex(overlay);
    const active = STEPS[upTo];
    const activeState = active ? overlay[active.id].state : null;
    const color = activeState ? LIVE_COLOR[activeState] : PR_WIRE;
    return STEPS.slice(1).map((def, i) => {
      const onPath = i + 1 <= upTo;
      return {
        id: `${STEPS[i].id}->${def.id}`,
        source: STEPS[i].id,
        sourceHandle: "out",
        target: def.id,
        targetHandle: "in",
        animated: onPath,
        style: { stroke: onPath ? color : `${PR_WIRE}99`, strokeWidth: onPath ? 3 : 2 },
      };
    });
  }, [overlay]);

  const onNodeClick = useCallback(
    (e: MouseEvent, node: PipelineFlowNode) => {
      // clicks on the node's widgets edit settings; only the panel itself opens the run
      if ((e.target as HTMLElement).closest("input,select,button,label")) return;
      const taskId = node.data.live.runTaskId;
      if (taskId) onOpenRun(taskId);
    },
    [onOpenRun],
  );

  const phase = pr ? (PHASE_META[pr.phase] ?? PHASE_META.watching) : null;
  const unplaced = pr && activeIndex(overlay) < 0;

  return (
    <PipelineEditorContext.Provider value={editor}>
      <div className="relative h-full min-h-[560px] w-full overflow-hidden rounded-xl" style={{ background: CANVAS }}>
        <ReactFlow<PipelineFlowNode, Edge>
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          onNodesChange={onNodesChange}
          onNodeClick={onNodeClick}
          nodesConnectable={false}
          edgesFocusable={false}
          colorMode="dark"
          fitView
          fitViewOptions={{ padding: 0.15 }}
          minZoom={0.3}
          maxZoom={1.6}
          proOptions={{ hideAttribution: true }}
          style={{ background: CANVAS }}
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1.6} color="#3a3d47" />
          <Controls showInteractive={false} />
          <MiniMap
            pannable
            zoomable
            maskColor="rgba(10,10,14,0.6)"
            style={{ background: "#1f2026" }}
            nodeColor={(n) => {
              const live = overlay[n.id as PipelineNodeId];
              return live?.state ? LIVE_COLOR[live.state] : "#3c3f48";
            }}
          />
        </ReactFlow>

        {/* top-left: PR picker and where it is */}
        <div
          className="absolute left-3 top-3 z-10 w-[min(360px,calc(100%-24px))] space-y-1.5 rounded-lg border p-2.5 text-xs shadow-xl"
          style={{ background: "#22242aee", borderColor: "#3c3f48" }}
        >
          <label className="flex items-center gap-2 text-slate-300">
            <PixelIcon name="prs" size={16} />
            <select
              aria-label="Pull request"
              value={selectedKey}
              onChange={(e) => setPrKey(e.target.value)}
              className="min-w-0 flex-1 truncate rounded-md border border-[#3c3f48] bg-[#1c1d22] px-2 py-1 text-slate-200 outline-none"
            >
              <option value="">No PR (settings only)</option>
              {prs.map((p) => (
                <option key={p.pr_key} value={p.pr_key}>
                  {p.repo.split("/")[1]} #{p.number} - {(PHASE_META[p.phase] ?? PHASE_META.watching).label}
                  {p.title ? ` - ${p.title.slice(0, 60)}` : ""}
                </option>
              ))}
            </select>
          </label>
          {pr && phase && (
            <div className="flex items-start gap-2 text-[11px]">
              <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${phase.dot}`} />
              <span className="min-w-0 text-slate-300">
                <span className="font-semibold text-slate-100">{phase.label}</span>
                {pr.summary ? <span className="line-clamp-3"> {pr.summary}</span> : null}
                {unplaced && <span className="block text-slate-500">Not at a step of the loop right now.</span>}
              </span>
            </div>
          )}
          {statusError && <div className="text-[11px] text-rose-400">Status unavailable: {statusError}</div>}
        </div>

        {/* top-right: global settings, save */}
        <div
          className="absolute right-3 top-3 z-10 w-56 space-y-1.5 rounded-lg border p-2.5 shadow-xl"
          style={{ background: "#22242aee", borderColor: "#3c3f48" }}
        >
          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
            <PixelIcon name="settings" size={16} />
            Pipeline
          </div>
          <NumberField
            label="Max concurrent agents"
            value={draft?.maxConcurrent ?? null}
            fallback={defaults?.maxConcurrent}
            min={1}
            max={8}
            onChange={(v) => setDraft((d) => (d ? { ...d, maxConcurrent: v } : d))}
          />
          <NumberField
            label="Max review rounds"
            value={draft?.maxReviewRounds ?? null}
            fallback={defaults?.maxReviewRounds}
            min={0}
            max={10}
            onChange={(v) => setDraft((d) => (d ? { ...d, maxReviewRounds: v } : d))}
          />
          <div className="flex items-center gap-1.5 pt-1">
            <button
              type="button"
              disabled={!dirty || saving}
              onClick={() => void save()}
              className="inline-flex flex-1 items-center justify-center gap-1 rounded-md bg-sky-600 px-2 py-1 text-[11px] font-medium text-white disabled:opacity-40"
            >
              <PixelIcon name="check" size={12} />
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              disabled={!dirty || saving}
              onClick={() => setDraft(saved)}
              className="rounded-md border border-[#3c3f48] px-2 py-1 text-[11px] text-slate-300 disabled:opacity-40"
            >
              Reset
            </button>
          </div>
          {dirty && !saving && <div className="text-[10px] text-amber-400">Unsaved changes</div>}
          {saveError && <div className="text-[10px] text-rose-400">{saveError}</div>}
          <div className="text-[10px] leading-snug text-slate-500">
            Empty fields use the env default. The loop reads saved settings on its next tick.
          </div>
        </div>
      </div>
    </PipelineEditorContext.Provider>
  );
}
