import { useState } from "react";
import type { PrPatrolRunStep } from "../../api";
import PixelIcon, { type PixelIconName } from "../pixel/PixelIcon";
import { formatDuration, formatOffset } from "./format";

const TOOL_ICON: Record<string, PixelIconName> = {
  Bash: "terminal",
  Read: "eye",
  Edit: "edit",
  MultiEdit: "edit",
  Write: "file",
  NotebookEdit: "edit",
  Grep: "search",
  Glob: "folder",
  Task: "team",
  Agent: "team",
  TodoWrite: "tasks",
  WebFetch: "globe",
  WebSearch: "globe",
};

function stepIcon(s: PrPatrolRunStep): PixelIconName {
  if (s.kind === "error" || s.isError) return "error";
  if (s.kind === "result") return "check";
  if (s.kind === "text") return "chat";
  return (s.tool && TOOL_ICON[s.tool]) || "wrench";
}

function Block({ label, text }: { label: string; text: string }) {
  return (
    <div className="mt-1.5">
      <div
        className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide"
        style={{ color: "var(--th-text-muted)" }}
      >
        {label}
      </div>
      <pre
        className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md px-2.5 py-1.5 font-mono text-[11px] leading-snug"
        style={{ background: "var(--th-input-bg)", color: "var(--th-text-secondary)" }}
      >
        {text}
      </pre>
    </div>
  );
}

function StepRow({ step, start }: { step: PrPatrolRunStep; start: number | null }) {
  const [open, setOpen] = useState(false);
  const expandable = Boolean(step.input || step.output);
  const tone = step.kind === "error" || step.isError ? "text-rose-400" : undefined;
  return (
    <li className="relative pl-7" style={{ marginLeft: step.parentToolUseId ? 20 : 0 }} data-step-kind={step.kind}>
      <span
        className="absolute left-0 top-1 flex h-5 w-5 items-center justify-center rounded-full border"
        style={{ borderColor: "var(--th-card-border)", background: "var(--th-bg-surface)" }}
      >
        <PixelIcon name={stepIcon(step)} size={12} />
      </span>
      <button
        type="button"
        disabled={!expandable}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={expandable ? open : undefined}
        className="flex w-full items-baseline gap-2 rounded px-1 py-0.5 text-left text-sm enabled:hover:bg-[var(--th-bg-surface-hover)]"
      >
        <span className="w-14 shrink-0 font-mono text-[11px]" style={{ color: "var(--th-text-muted)" }}>
          {formatOffset(step.at, start)}
        </span>
        {step.tool && (
          <span className="shrink-0 font-mono text-[11px]" style={{ color: "var(--th-label-color)" }}>
            {step.tool}
          </span>
        )}
        <span
          className={`min-w-0 flex-1 truncate ${tone ?? ""}`}
          style={tone ? undefined : { color: "var(--th-text-primary)" }}
        >
          {step.summary}
        </span>
        {step.files.length > 0 && (
          <span
            className="hidden shrink-0 truncate font-mono text-[10px] md:inline"
            style={{ color: "var(--th-text-muted)", maxWidth: 180 }}
          >
            {step.files.join(", ")}
          </span>
        )}
        <span className="shrink-0 font-mono text-[11px]" style={{ color: "var(--th-text-muted)" }}>
          {step.durationMs != null ? formatDuration(step.durationMs) : ""}
        </span>
        {expandable && <PixelIcon name={open ? "minus" : "plus"} size={10} className="shrink-0 opacity-60" />}
      </button>
      {open && (
        <div className="pb-2 pl-1">
          {step.input && <Block label="Input" text={step.input} />}
          {step.output && <Block label={step.kind === "tool" ? "Output" : "Text"} text={step.output} />}
        </div>
      )}
    </li>
  );
}

export default function RunTimeline({
  steps,
  start,
  capped,
  truncated,
}: {
  steps: PrPatrolRunStep[];
  start: number | null;
  capped?: boolean;
  truncated?: boolean;
}) {
  const [onlyTools, setOnlyTools] = useState(false);
  const shown = onlyTools ? steps.filter((s) => s.kind !== "text") : steps;
  if (!steps.length) {
    return (
      <div className="text-sm" style={{ color: "var(--th-text-muted)" }}>
        No steps recorded.
      </div>
    );
  }
  return (
    <div>
      <label className="mb-2 flex items-center gap-1.5 text-[11px]" style={{ color: "var(--th-text-muted)" }}>
        <input type="checkbox" checked={onlyTools} onChange={(e) => setOnlyTools(e.target.checked)} />
        Hide assistant text
      </label>
      <ol className="relative flex flex-col gap-0.5 border-l pl-0" style={{ borderColor: "transparent" }}>
        {shown.map((s) => (
          <StepRow key={s.index} step={s} start={start} />
        ))}
      </ol>
      {(capped || truncated) && (
        <div className="mt-2 flex items-center gap-1.5 text-[11px] text-amber-500">
          <PixelIcon name="warning" size={12} />
          {capped
            ? "Step list capped; later steps are not shown."
            : "The log ends mid-line (run still writing, or killed)."}
        </div>
      )}
    </div>
  );
}
