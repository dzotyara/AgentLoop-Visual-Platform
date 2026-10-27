import { describe, expect, it } from "vitest";
import {
  commitsFromGitOutput,
  filesTouchedBy,
  formatToolInput,
  parseRun,
  parseRunLog,
  searchableText,
  splitRuns,
  toolResultText,
  trimText,
} from "./run-log.ts";

// Synthetic stream-json fixtures (shape of `claude --print --output-format=stream-json`).
const CWD = "/work/wt/acme__widgets__7";
const ev = (o: Record<string, unknown>) => JSON.stringify(o);
const init = ev({ type: "system", subtype: "init", cwd: CWD, model: "claude-opus-test", session_id: "s1" });
const toolUse = (id: string, name: string, input: Record<string, unknown>, at: string, parent: string | null = null) =>
  ev({
    type: "assistant",
    timestamp: at,
    parent_tool_use_id: parent,
    message: { content: [{ type: "tool_use", id, name, input }] },
  });
const toolResult = (id: string, content: unknown, at: string, isError = false) =>
  ev({
    type: "user",
    timestamp: at,
    message: { content: [{ type: "tool_result", tool_use_id: id, content, ...(isError ? { is_error: true } : {}) }] },
  });
const text = (t: string, at: string) =>
  ev({
    type: "assistant",
    timestamp: at,
    message: {
      content: [
        { type: "thinking", thinking: "" },
        { type: "text", text: t },
      ],
    },
  });
const result = (at: string, extra: Record<string, unknown> = {}) =>
  ev({
    type: "result",
    subtype: "success",
    is_error: false,
    timestamp: at,
    total_cost_usd: 0.42,
    num_turns: 5,
    duration_ms: 61_000,
    result: "Fixed the null check and committed.",
    usage: { input_tokens: 10, output_tokens: 200, cache_read_input_tokens: 3000, cache_creation_input_tokens: 400 },
    modelUsage: {
      "claude-small-test": { costUSD: 0.02, inputTokens: 50, outputTokens: 10 },
      "claude-opus-test": { costUSD: 0.4, inputTokens: 10, outputTokens: 200, cacheReadInputTokens: 3000 },
    },
    ...extra,
  });

const RUN_ONE = [
  init,
  ev({ type: "stream_event", event: { type: "content_block_delta" } }),
  toolUse("t1", "Read", { file_path: `${CWD}/src/a.ts` }, "2026-01-01T10:00:01.000Z"),
  toolResult("t1", "1\tconst a = 1;", "2026-01-01T10:00:01.500Z"),
  toolUse("t2", "Edit", { file_path: `${CWD}/src/a.ts`, old_string: "x", new_string: "y" }, "2026-01-01T10:00:03.000Z"),
  toolResult("t2", "The file has been updated.", "2026-01-01T10:00:03.200Z"),
  toolUse(
    "t3",
    "Bash",
    { command: 'git commit -am "[fix] guard null"', description: "Commit the fix" },
    "2026-01-01T10:00:05.000Z",
  ),
  toolResult("t3", "[pr-patrol/7 abc1234] [fix] guard null\n 1 file changed", "2026-01-01T10:00:06.000Z"),
  toolUse("t4", "Bash", { command: "pnpm vitest run nope.test.ts" }, "2026-01-01T10:00:07.000Z"),
  toolResult("t4", [{ type: "text", text: "Error: no test files" }], "2026-01-01T10:00:09.000Z", true),
  toolUse(
    "t5",
    "Write",
    { file_path: "/home/u/.pr-loop/results/task-1.json", content: '{"summary":"ok"}' },
    "2026-01-01T10:00:10.000Z",
  ),
  toolResult("t5", "File created", "2026-01-01T10:00:10.100Z"),
  text("All done.\nDetails follow.", "2026-01-01T10:00:11.000Z"),
  result("2026-01-01T10:00:12.000Z"),
].join("\n");

describe("splitRuns / parseRunLog", () => {
  it("splits a multi-run log on the run markers and parses each run", () => {
    const log = [
      "",
      "===== task run start 2026-01-01T09:00:00.000Z | provider=claude =====",
      init,
      "[Claw-Empire] RUN TIMEOUT (no output for 900s)",
      "",
      "===== task run start 2026-01-01T10:00:00.000Z | provider=claude =====",
      RUN_ONE,
      "",
    ].join("\n");
    const raw = splitRuns(log);
    expect(raw).toHaveLength(2);
    expect(raw[0].startedAt).toBe(Date.parse("2026-01-01T09:00:00.000Z"));
    expect(raw[1].provider).toBe("claude");

    const runs = parseRunLog(log);
    expect(runs).toHaveLength(2);
    expect(runs[0].finished).toBe(false);
    expect(runs[0].steps).toEqual([
      expect.objectContaining({ kind: "error", summary: expect.stringContaining("RUN TIMEOUT") }),
    ]);
    expect(runs[1].finished).toBe(true);
    expect(runs[1].model).toBe("claude-opus-test");
    expect(runs[1].cwd).toBe(CWD);
  });

  it("treats a log without markers as one run", () => {
    expect(parseRunLog(RUN_ONE)).toHaveLength(1);
    expect(parseRunLog("")).toHaveLength(0);
  });
});

describe("parseRun", () => {
  const run = parseRun(RUN_ONE);

  it("orders steps and summarizes tool calls", () => {
    expect(run.steps.map((s) => [s.kind, s.tool, s.summary])).toEqual([
      ["tool", "Read", "Reading a.ts"],
      ["tool", "Edit", "Editing a.ts"],
      ["tool", "Bash", "Commit the fix"],
      ["tool", "Bash", "Running tests"],
      ["tool", "Write", "Writing the result"],
      ["text", null, "All done."],
      ["result", null, "Finished: 5 turn(s), $0.42, 61s"],
    ]);
    expect(run.toolCalls).toBe(5);
  });

  it("pairs tool results, flags errors and computes durations", () => {
    const [read, edit, commit, test, , txt] = run.steps;
    expect(read.output).toBe("1\tconst a = 1;");
    expect(read.durationMs).toBe(500);
    expect(edit.durationMs).toBe(200);
    expect(commit.durationMs).toBe(1000);
    expect(test.isError).toBe(true);
    expect(test.output).toBe("Error: no test files");
    expect(txt.durationMs).toBe(1000); // until the result event
    expect(run.errors).toBe(1);
  });

  it("collects touched files (relative to cwd, result JSON excluded) and commits", () => {
    expect(run.files).toEqual(["src/a.ts"]);
    expect(run.steps[1].files).toEqual(["src/a.ts"]);
    expect(run.commits).toEqual([{ sha: "abc1234", subject: "[fix] guard null" }]);
  });

  it("reads totals and the final text from the result event", () => {
    expect(run.totals).toMatchObject({
      costUsd: 0.42,
      turns: 5,
      durationMs: 61_000,
      outputTokens: 200,
      cacheReadTokens: 3000,
      cacheWriteTokens: 400,
    });
    expect(run.totals?.byModel.map((m) => m.model)).toEqual(["claude-opus-test", "claude-small-test"]);
    expect(run.finalText).toBe("Fixed the null check and committed.");
    expect(run.isError).toBe(false);
    expect(run.startedAt).toBe(Date.parse("2026-01-01T10:00:01.000Z"));
  });

  it("marks a truncated last line and keeps the earlier steps", () => {
    const cut = [
      init,
      toolUse("t1", "Read", { file_path: "/x/y.md" }, "2026-01-01T10:00:01.000Z"),
      '{"type":"assistant","mess',
    ].join("\n");
    const r = parseRun(cut);
    expect(r.truncated).toBe(true);
    expect(r.finished).toBe(false);
    expect(r.totals).toBeNull();
    expect(r.steps).toHaveLength(1);
    expect(r.steps[0].durationMs).toBeNull();
  });

  it("reports a failed result as an error step", () => {
    const r = parseRun(
      [init, result("2026-01-01T10:00:12.000Z", { subtype: "error_max_turns", is_error: true })].join("\n"),
    );
    expect(r.isError).toBe(true);
    expect(r.steps[0]).toMatchObject({ kind: "error", summary: expect.stringMatching(/^Failed/) });
  });

  it("keeps subagent steps with their parent id and caps the step count", () => {
    const r = parseRun(
      [
        init,
        toolUse("p1", "Task", { description: "review angle", prompt: "..." }, "2026-01-01T10:00:00.000Z"),
        toolUse("c1", "Grep", { pattern: "TODO" }, "2026-01-01T10:00:01.000Z", "p1"),
        toolUse("c2", "Grep", { pattern: "FIXME" }, "2026-01-01T10:00:02.000Z", "p1"),
      ].join("\n"),
      {},
      2,
    );
    expect(r.steps).toHaveLength(2);
    expect(r.steps[1].parentToolUseId).toBe("p1");
    expect(r.stepsCapped).toBe(true);
    expect(r.toolCalls).toBe(3);
  });

  it("works on logs whose events carry no timestamps", () => {
    const r = parseRun(
      [
        init,
        ev({
          type: "assistant",
          message: { content: [{ type: "tool_use", id: "a", name: "Glob", input: { pattern: "*.ts" } }] },
        }),
      ].join("\n"),
    );
    expect(r.steps[0]).toMatchObject({ at: null, durationMs: null, summary: "Looking for *.ts" });
    expect(r.startedAt).toBeNull();
  });
});

describe("helpers", () => {
  it("trims long text keeping head and tail", () => {
    const s = "a".repeat(5000) + "END";
    const t = trimText(s, 1000);
    expect(t.length).toBeLessThan(1100);
    expect(t.endsWith("END")).toBe(true);
    expect(trimText("short", 10)).toBe("short");
  });

  it("formats tool input: Bash command verbatim, long values cut", () => {
    expect(formatToolInput("Bash", { command: "ls -la", description: "x" })).toBe("ls -la");
    const out = formatToolInput("Write", { file_path: "/a", content: "z".repeat(5000) }) ?? "";
    expect(out).toContain('"file_path": "/a"');
    expect(out.length).toBeLessThan(2500);
    expect(formatToolInput("Read", undefined)).toBeNull();
  });

  it("reads tool_result content in both shapes", () => {
    expect(toolResultText("x")).toBe("x");
    expect(toolResultText([{ type: "text", text: "a" }, { type: "image" }, "b"])).toBe("a\nb");
    expect(toolResultText(null)).toBe("");
  });

  it("lists only edited files", () => {
    expect(filesTouchedBy("Read", { file_path: "/w/a.ts" }, "/w")).toEqual([]);
    expect(filesTouchedBy("MultiEdit", { file_path: "/w/a.ts" }, "/w")).toEqual(["a.ts"]);
    expect(filesTouchedBy("Write", { file_path: "/elsewhere/b.ts" }, "/w")).toEqual(["/elsewhere/b.ts"]);
  });

  it("parses git commit output", () => {
    expect(commitsFromGitOutput("[main (root-commit) 0123abc] first\n[pr-patrol/9 deadbeef1] [fix] two")).toEqual([
      { sha: "0123abc", subject: "first" },
      { sha: "deadbeef1", subject: "[fix] two" },
    ]);
  });

  it("builds lower-cased search text from tool inputs, text and the result", () => {
    const s = searchableText(RUN_ONE);
    expect(s).toContain("git commit -am");
    expect(s).toContain("all done.");
    expect(s).toContain("fixed the null check");
    expect(s).not.toContain("const a = 1"); // tool outputs are not searched
    expect(searchableText(RUN_ONE, 20).length).toBeLessThanOrEqual(21);
  });
});
