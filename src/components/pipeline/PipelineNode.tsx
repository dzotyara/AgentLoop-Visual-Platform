import { memo, type ReactNode } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import PixelIcon from "../pixel/PixelIcon";
import { usePipelineEditor } from "./pipeline-context";
import { LIVE_COLOR, LIVE_LABEL, PR_WIRE, type NodeLive, type StepDef } from "./pipeline-model";

/** `agentName`: the current name of the agent in the step's crew seat (def.agent), which can be renamed. */
export type PipelineNodeData = { def: StepDef; live: NodeLive; sprite: number | null; agentName?: string };
export type PipelineFlowNode = Node<PipelineNodeData, "step">;

const PANEL = "#2a2c33";
const WIDGET = "#1c1d22";
const BORDER = "#3c3f48";

function Port({ side, label }: { side: "in" | "out"; label: string }) {
  return (
    <div className={`flex items-center gap-1.5 text-[10px] text-slate-400 ${side === "out" ? "flex-row-reverse" : ""}`}>
      <span className="inline-block h-2 w-2 rounded-full" style={{ background: PR_WIRE }} />
      <span>{label}</span>
    </div>
  );
}

/** A ComfyUI widget row: label on the left, control on the right, in a dark pill. */
function Widget({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label
      className="nodrag flex items-center justify-between gap-2 rounded-md px-2 py-1 text-[11px]"
      style={{ background: WIDGET, border: `1px solid ${BORDER}` }}
    >
      <span className="shrink-0 text-slate-400">{label}</span>
      {children}
    </label>
  );
}

function StepSettings({ def }: { def: StepDef }) {
  const { draft, defaults, models, setStep } = usePipelineEditor();
  if (!def.step) {
    return <div className="text-[10px] italic text-slate-500">Fixed step of the loop: no settings</div>;
  }
  const step = def.step;
  const s = draft?.steps[step];
  if (!s) return <div className="text-[10px] text-slate-500">Loading settings…</div>;
  const options = s.model && !models.includes(s.model) ? [s.model, ...models] : models;
  const envReviewOff = step === "review" && defaults?.review === false;
  return (
    <div className="space-y-1">
      <Widget label="enabled">
        <button
          type="button"
          role="switch"
          aria-checked={s.enabled}
          aria-label={`${def.title} enabled`}
          onClick={() => setStep(step, { enabled: !s.enabled })}
          className="nodrag relative h-4 w-8 rounded-full transition"
          style={{ background: s.enabled ? "#3b82f6" : "#4b5060" }}
        >
          <span
            className="absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all"
            style={{ left: s.enabled ? 17 : 2 }}
          />
        </button>
      </Widget>
      <Widget label="model">
        <select
          aria-label={`${def.title} model`}
          value={s.model ?? "default"}
          onChange={(e) => setStep(step, { model: e.target.value === "default" ? null : e.target.value })}
          className="nodrag nowheel min-w-0 max-w-[150px] truncate bg-transparent text-right text-slate-200 outline-none"
        >
          <option value="default">default</option>
          {options.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </Widget>
      <Widget label="max attempts">
        <input
          aria-label={`${def.title} max attempts`}
          type="number"
          min={1}
          max={10}
          value={s.maxAttempts ?? ""}
          placeholder={defaults ? `${defaults.maxAttempts} (env)` : "env"}
          onChange={(e) => {
            const raw = e.target.value.trim();
            const n = Number.parseInt(raw, 10);
            setStep(step, { maxAttempts: raw === "" || !Number.isFinite(n) ? null : Math.min(10, Math.max(1, n)) });
          }}
          className="nodrag w-16 bg-transparent text-right text-slate-200 outline-none placeholder:text-slate-500"
        />
      </Widget>
      {envReviewOff && <div className="text-[10px] text-amber-400">Own review is off by env (PR_PATROL_REVIEW=0)</div>}
    </div>
  );
}

function LiveStrip({ live }: { live: NodeLive }) {
  const { onOpenRun } = usePipelineEditor();
  const o = live.outcome;
  if (!live.state && !o) return null;
  return (
    <div className="space-y-1 border-t pt-1.5" style={{ borderColor: BORDER }}>
      {live.state && (
        <div className="flex items-start gap-1.5 text-[11px]" style={{ color: LIVE_COLOR[live.state] }}>
          <span
            className={`mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full ${live.state === "working" ? "animate-pulse" : ""}`}
            style={{ background: LIVE_COLOR[live.state] }}
          />
          <span className="min-w-0">
            <span className="font-semibold" data-testid="live-state">
              {LIVE_LABEL[live.state]}
            </span>
            {live.reason && <span className="line-clamp-2 text-slate-300"> {live.reason}</span>}
          </span>
        </div>
      )}
      {o && (
        <div className="flex items-center gap-1.5 text-[10px]" title={o.note ?? undefined} data-testid="last-outcome">
          <PixelIcon name={o.status === "done" ? "check" : o.status === "failed" ? "cross" : "pending"} size={12} />
          <span
            className={
              o.status === "done" ? "text-emerald-400" : o.status === "failed" ? "text-rose-400" : "text-sky-400"
            }
          >
            last run {o.status}
            {o.attempts > 1 ? ` (${o.attempts} attempts)` : ""}
          </span>
          {o.note && <span className="truncate text-slate-500">{o.note}</span>}
        </div>
      )}
      {live.runTaskId && (
        <button
          type="button"
          onClick={() => onOpenRun(live.runTaskId as string)}
          className="nodrag inline-flex items-center gap-1 text-[10px] text-sky-300 hover:underline"
        >
          <PixelIcon name="terminal" size={12} />
          Open run
        </button>
      )}
    </div>
  );
}

function PipelineNodeImpl({ data }: NodeProps<PipelineFlowNode>) {
  const { def, live, sprite, agentName } = data;
  const glow =
    live.active && live.state ? LIVE_COLOR[live.state] : live.state === "blocked" ? LIVE_COLOR.blocked : null;
  const { draft } = usePipelineEditor();
  const disabled = def.step ? draft?.steps[def.step]?.enabled === false : false;
  return (
    <div
      data-testid={`pipeline-node-${def.id}`}
      data-state={live.state ?? "idle"}
      data-active={live.active ? "true" : "false"}
      className={`rounded-lg text-left shadow-xl ${live.active && live.state === "working" ? "animate-pulse" : ""}`}
      style={{
        width: 260,
        background: PANEL,
        border: `1px solid ${glow ?? BORDER}`,
        boxShadow: glow ? `0 0 0 2px ${glow}, 0 0 28px ${glow}88` : "0 6px 18px rgba(0,0,0,0.45)",
        opacity: disabled ? 0.55 : 1,
        cursor: live.runTaskId ? "pointer" : "default",
      }}
    >
      <Handle
        type="target"
        position={Position.Left}
        id="in"
        style={{ background: PR_WIRE, borderColor: PANEL, top: 52 }}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="out"
        style={{ background: PR_WIRE, borderColor: PANEL, top: 52 }}
      />
      <div
        className="flex items-center gap-1.5 rounded-t-lg px-2.5 py-1.5 text-xs font-semibold text-white"
        style={{ background: def.accent }}
      >
        <PixelIcon name={def.icon} size={16} />
        <span className="truncate">{def.title}</span>
        {disabled && <span className="ml-auto rounded bg-black/30 px-1.5 text-[10px] font-normal">bypassed</span>}
        {!disabled && live.passed && (
          <span className="ml-auto text-[10px] font-normal text-white/70" title="the PR passed this step">
            clear
          </span>
        )}
      </div>
      <div className="flex items-center justify-between px-2.5 pt-1.5">
        <Port side="in" label="PR" />
        <Port side="out" label="next" />
      </div>
      <div className="space-y-2 px-2.5 pb-2.5 pt-1.5">
        <div className="flex items-center gap-2">
          {sprite ? (
            <img
              src={`/sprites/${sprite}-D-1.png`}
              alt={agentName ?? def.agent ?? ""}
              width={32}
              height={32}
              draggable={false}
              className="shrink-0 rounded"
              style={{ imageRendering: "pixelated", background: WIDGET }}
            />
          ) : (
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded" style={{ background: WIDGET }}>
              <PixelIcon name={def.icon} size={16} />
            </span>
          )}
          <div className="min-w-0">
            <div className="text-xs font-medium text-slate-100">{agentName ?? def.agent ?? "GitHub"}</div>
            <div className="line-clamp-2 text-[10px] leading-snug text-slate-400">{def.blurb}</div>
          </div>
        </div>
        <StepSettings def={def} />
        <LiveStrip live={live} />
      </div>
    </div>
  );
}

export const PipelineNode = memo(PipelineNodeImpl);
