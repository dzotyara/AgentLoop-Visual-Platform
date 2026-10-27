import path from "node:path";
import { describeToolUse } from "./activity.ts";

/**
 * Pure parsing of a Claude Code `--output-format=stream-json` task log (logs/<taskId>.log) into an
 * inspectable run: ordered steps with timings, totals, the final report and the commits the agent made.
 * A log can hold several runs, each opened by `===== task run start <iso> | provider=<p> =====`.
 */

export type RunStepKind = "tool" | "text" | "result" | "error";

export type RunStep = {
  index: number;
  /** Epoch ms of the event, null when the event carried no timestamp. */
  at: number | null;
  kind: RunStepKind;
  tool: string | null;
  /** Human line: "Editing foo.ts", "Running tests", first line of a text block. */
  summary: string;
  /** Trimmed tool input (pretty JSON or the command), null for text. */
  input: string | null;
  /** Trimmed excerpt of the matching tool_result, or the text/result body. */
  output: string | null;
  isError: boolean;
  /** Files this step edited or wrote, relative to the run's cwd when inside it. */
  files: string[];
  /** Tool steps: tool_use to tool_result; other steps: until the next step. Null without timestamps. */
  durationMs: number | null;
  /** Set when the step ran inside a subagent (Task/Agent tool). */
  parentToolUseId: string | null;
};

export type ModelUsage = {
  model: string;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
};

export type RunTotals = {
  costUsd: number;
  turns: number;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  byModel: ModelUsage[];
};

export type LogCommit = { sha: string; subject: string };

export type ParsedRun = {
  startedAt: number | null;
  provider: string | null;
  model: string | null;
  cwd: string | null;
  steps: RunStep[];
  /** More steps than the cap were dropped from the end. */
  stepsCapped: boolean;
  toolCalls: number;
  errors: number;
  /** From the final `result` event; null while running or when the run died before it. */
  totals: RunTotals | null;
  finalText: string | null;
  finished: boolean;
  isError: boolean;
  /** The last line was cut mid-write (run in progress or killed). */
  truncated: boolean;
  /** All files edited/written in the run. */
  files: string[];
  /** Commits seen in `git commit` output ("[branch abc1234] subject"). */
  commits: LogCommit[];
};

export const STEP_CAP = 1500;
const INPUT_CAP = 4000;
const OUTPUT_CAP = 4000;
const VALUE_CAP = 1500;
const RUN_MARKER = /^===== task run start (\S+) \| provider=(\S+) =====\s*$/;
const EDIT_TOOLS = new Set(["Edit", "MultiEdit", "Write", "NotebookEdit"]);

/** Cuts long text, keeping the head and a short tail (errors tend to sit at the end). */
export function trimText(s: string, max: number): string {
  if (s.length <= max) return s;
  const tail = Math.min(800, Math.floor(max / 4));
  const head = max - tail;
  return `${s.slice(0, head)}\n... (${s.length - head - tail} chars cut) ...\n${s.slice(s.length - tail)}`;
}

const oneLine = (s: string, n: number) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 3)}...` : t;
};

function parseTime(v: unknown): number | null {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const t = typeof v === "number" ? v : Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

/** Splits a log into runs. Text before the first marker (if any) is a run with no header. */
export function splitRuns(text: string): Array<{ startedAt: number | null; provider: string | null; body: string }> {
  const lines = text.split("\n");
  const runs: Array<{ startedAt: number | null; provider: string | null; lines: string[] }> = [];
  let cur: (typeof runs)[number] | null = null;
  for (const line of lines) {
    const m = RUN_MARKER.exec(line);
    if (m) {
      cur = { startedAt: parseTime(m[1]), provider: m[2], lines: [] };
      runs.push(cur);
      continue;
    }
    if (!cur) {
      if (!line.trim()) continue;
      cur = { startedAt: null, provider: null, lines: [] };
      runs.push(cur);
    }
    cur.lines.push(line);
  }
  return runs.map((r) => ({ startedAt: r.startedAt, provider: r.provider, body: r.lines.join("\n") }));
}

/** Pretty, trimmed tool input: the command for Bash, compact JSON with long values cut otherwise. */
export function formatToolInput(name: string, input: Record<string, unknown> | undefined): string | null {
  if (!input || typeof input !== "object") return null;
  if (name === "Bash" && typeof input.command === "string") return trimText(input.command, INPUT_CAP);
  const cut: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    cut[k] = typeof v === "string" && v.length > VALUE_CAP ? trimText(v, VALUE_CAP) : v;
  }
  return trimText(JSON.stringify(cut, null, 2), INPUT_CAP);
}

/** tool_result content is a string or an array of blocks ({type:"text", text}). */
export function toolResultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => (typeof b === "string" ? b : b && typeof b === "object" && "text" in b ? String(b.text) : ""))
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function relFile(file: string, cwd: string | null): string {
  if (cwd && file.startsWith(cwd.endsWith("/") ? cwd : `${cwd}/`)) return path.relative(cwd, file);
  return file;
}

/** Files a tool call edits or writes; empty for reads. Writes of the agent's result JSON are ignored. */
export function filesTouchedBy(name: string, input: Record<string, unknown> | undefined, cwd: string | null): string[] {
  if (!EDIT_TOOLS.has(name) || !input) return [];
  const file =
    typeof input.file_path === "string"
      ? input.file_path
      : typeof input.notebook_path === "string"
        ? input.notebook_path
        : "";
  if (!file) return [];
  if (name === "Write" && /[/\\]results[/\\][^/\\]+\.json$/.test(file) && file.includes(".pr-loop")) return [];
  return [relFile(file, cwd)];
}

const COMMIT_LINE = /^\[[^\]\n]*?\s([0-9a-f]{7,40})\]\s+(.+)$/gm;

/** Commits from `git commit` output: "[pr-patrol/12 abc1234] [fix] subject" (also "(root-commit)"). */
export function commitsFromGitOutput(text: string): LogCommit[] {
  const out: LogCommit[] = [];
  for (const m of text.matchAll(COMMIT_LINE)) out.push({ sha: m[1], subject: m[2].trim() });
  return out;
}

type AnyEvent = {
  type?: string;
  subtype?: string;
  timestamp?: string;
  parent_tool_use_id?: string | null;
  cwd?: string;
  model?: string;
  message?: { content?: unknown };
  // result event
  is_error?: boolean;
  result?: unknown;
  total_cost_usd?: number;
  num_turns?: number;
  duration_ms?: number;
  usage?: Record<string, number | undefined>;
  modelUsage?: Record<string, Record<string, number | undefined>>;
};

function totalsFrom(evt: AnyEvent): RunTotals {
  const u = evt.usage ?? {};
  const byModel: ModelUsage[] = Object.entries(evt.modelUsage ?? {}).map(([model, m]) => ({
    model,
    costUsd: Number(m.costUSD ?? 0),
    inputTokens: Number(m.inputTokens ?? 0),
    outputTokens: Number(m.outputTokens ?? 0),
    cacheReadTokens: Number(m.cacheReadInputTokens ?? 0),
    cacheWriteTokens: Number(m.cacheCreationInputTokens ?? 0),
  }));
  byModel.sort((a, b) => b.costUsd - a.costUsd);
  return {
    costUsd: Number(evt.total_cost_usd ?? 0),
    turns: Number(evt.num_turns ?? 0),
    durationMs: Number(evt.duration_ms ?? 0),
    inputTokens: Number(u.input_tokens ?? 0),
    outputTokens: Number(u.output_tokens ?? 0),
    cacheReadTokens: Number(u.cache_read_input_tokens ?? 0),
    cacheWriteTokens: Number(u.cache_creation_input_tokens ?? 0),
    byModel,
  };
}

/** Parses the body of one run (the lines after its marker). */
export function parseRun(
  body: string,
  meta: { startedAt?: number | null; provider?: string | null } = {},
  stepCap = STEP_CAP,
): ParsedRun {
  const run: ParsedRun = {
    startedAt: meta.startedAt ?? null,
    provider: meta.provider ?? null,
    model: null,
    cwd: null,
    steps: [],
    stepsCapped: false,
    toolCalls: 0,
    errors: 0,
    totals: null,
    finalText: null,
    finished: false,
    isError: false,
    truncated: false,
    files: [],
    commits: [],
  };
  const byToolId = new Map<string, RunStep>();
  const resultAt = new Map<RunStep, number>();
  const files = new Set<string>();
  const commits = new Map<string, LogCommit>();
  const push = (s: Omit<RunStep, "index">): RunStep | null => {
    if (run.steps.length >= stepCap) {
      run.stepsCapped = true;
      return null;
    }
    const step = { ...s, index: run.steps.length };
    run.steps.push(step);
    return step;
  };

  const lines = body.split("\n");
  let lastNonEmpty = lines.length - 1;
  while (lastNonEmpty >= 0 && !lines[lastNonEmpty].trim()) lastNonEmpty--;

  lines.forEach((line, i) => {
    if (!line.trim()) return;
    if (!line.startsWith("{")) {
      push({
        at: null,
        kind: "error",
        tool: null,
        summary: oneLine(line, 160),
        input: null,
        output: trimText(line, OUTPUT_CAP),
        isError: true,
        files: [],
        durationMs: null,
        parentToolUseId: null,
      });
      run.errors++;
      return;
    }
    let evt: AnyEvent;
    try {
      evt = JSON.parse(line) as AnyEvent;
    } catch {
      if (i === lastNonEmpty) run.truncated = true;
      return;
    }
    const at = parseTime(evt.timestamp);
    const parent = evt.parent_tool_use_id ?? null;
    if (evt.type === "system" && evt.subtype === "init") {
      run.cwd = typeof evt.cwd === "string" ? evt.cwd : null;
      run.model = typeof evt.model === "string" ? evt.model : null;
      return;
    }
    if (evt.type === "assistant") {
      const blocks = Array.isArray(evt.message?.content) ? (evt.message.content as Array<Record<string, any>>) : [];
      for (const b of blocks) {
        if (b?.type === "tool_use" && typeof b.name === "string") {
          const input = b.input && typeof b.input === "object" ? (b.input as Record<string, unknown>) : undefined;
          const touched = filesTouchedBy(b.name, input, run.cwd);
          touched.forEach((f) => files.add(f));
          run.toolCalls++;
          const step = push({
            at,
            kind: "tool",
            tool: b.name,
            summary: describeToolUse(b.name, input),
            input: formatToolInput(b.name, input),
            output: null,
            isError: false,
            files: touched,
            durationMs: null,
            parentToolUseId: parent,
          });
          if (step && typeof b.id === "string") byToolId.set(b.id, step);
        } else if (b?.type === "text" && typeof b.text === "string" && b.text.trim()) {
          push({
            at,
            kind: "text",
            tool: null,
            summary: oneLine(b.text.split("\n").find((l: string) => l.trim()) ?? b.text, 160),
            input: null,
            output: trimText(b.text, OUTPUT_CAP),
            isError: false,
            files: [],
            durationMs: null,
            parentToolUseId: parent,
          });
        }
      }
      return;
    }
    if (evt.type === "user") {
      const blocks = Array.isArray(evt.message?.content) ? (evt.message.content as Array<Record<string, any>>) : [];
      for (const b of blocks) {
        if (b?.type !== "tool_result") continue;
        const step = typeof b.tool_use_id === "string" ? byToolId.get(b.tool_use_id) : undefined;
        const text = toolResultText(b.content);
        if (step?.tool === "Bash") for (const c of commitsFromGitOutput(text)) commits.set(c.sha, c);
        if (!step) continue;
        step.output = text ? trimText(text, OUTPUT_CAP) : step.output;
        if (b.is_error) {
          step.isError = true;
          run.errors++;
        }
        if (at != null) resultAt.set(step, at);
      }
      return;
    }
    if (evt.type === "result") {
      run.finished = true;
      run.isError = Boolean(evt.is_error) || (evt.subtype != null && evt.subtype !== "success");
      run.totals = totalsFrom(evt);
      run.finalText = typeof evt.result === "string" ? evt.result : null;
      const t = run.totals;
      push({
        at,
        kind: run.isError ? "error" : "result",
        tool: null,
        summary: `${run.isError ? "Failed" : "Finished"}: ${t.turns} turn(s), $${t.costUsd.toFixed(2)}, ${Math.round(t.durationMs / 1000)}s`,
        input: null,
        output: run.finalText ? trimText(run.finalText, OUTPUT_CAP) : null,
        isError: run.isError,
        files: [],
        durationMs: null,
        parentToolUseId: null,
      });
      if (run.isError) run.errors++;
    }
  });

  // Durations: a tool runs until its result; anything else lasts until the next timed step.
  const steps = run.steps;
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    if (s.at == null) continue;
    const done = resultAt.get(s);
    if (done != null) {
      s.durationMs = Math.max(0, done - s.at);
      continue;
    }
    const next = steps.slice(i + 1).find((n) => n.at != null);
    if (next?.at != null) s.durationMs = Math.max(0, next.at - s.at);
  }
  if (run.startedAt == null) run.startedAt = steps.find((s) => s.at != null)?.at ?? null;
  run.files = [...files];
  run.commits = [...commits.values()];
  return run;
}

/** Every run in a log, oldest first. */
export function parseRunLog(text: string, stepCap = STEP_CAP): ParsedRun[] {
  return splitRuns(text).map((r) => parseRun(r.body, r, stepCap));
}

/**
 * What a run search matches against: tool inputs, assistant text and the final result text.
 * Tool outputs are left out on purpose (file dumps would match nearly anything). Lower-cased, capped.
 */
export function searchableText(text: string, cap = 1_000_000): string {
  const parts: string[] = [];
  let size = 0;
  const add = (s: string) => {
    if (size >= cap || !s) return;
    const piece = s.slice(0, cap - size);
    parts.push(piece);
    size += piece.length + 1;
  };
  for (const line of text.split("\n")) {
    if (size >= cap) break;
    if (!line.startsWith("{")) continue;
    if (!line.includes('"type":"assistant"') && !line.includes('"type":"result"')) continue;
    let evt: AnyEvent;
    try {
      evt = JSON.parse(line) as AnyEvent;
    } catch {
      continue;
    }
    if (evt.type === "result" && typeof evt.result === "string") add(evt.result);
    if (evt.type !== "assistant" || !Array.isArray(evt.message?.content)) continue;
    for (const b of evt.message.content as Array<Record<string, any>>) {
      if (b?.type === "tool_use" && b.input) add(JSON.stringify(b.input));
      else if (b?.type === "text" && typeof b.text === "string") add(b.text);
    }
  }
  return parts.join("\n").toLowerCase();
}
