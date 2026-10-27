import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrPatrolRunDetail, PrPatrolRunSummary } from "../../api";
import type { Agent } from "../../types";
import RunInspector, { openRunRequest } from "./RunInspector";

const apiMocks = vi.hoisted(() => ({ listRuns: vi.fn(), getRun: vi.fn() }));

vi.mock("../../api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api")>()),
  listRuns: apiMocks.listRuns,
  getRun: apiMocks.getRun,
}));

const summary = (over: Partial<PrPatrolRunSummary>): PrPatrolRunSummary => ({
  taskId: "fix-1",
  title: "[fix] [widgets#7] Fix review findings: Widget PR",
  pr: "acme/widgets#7",
  prUrl: "https://github.com/acme/widgets/pull/7",
  action: "fix_review",
  agentId: "agent-patch",
  agentName: "Patch",
  agentSprite: 3,
  status: "done",
  attempts: 1,
  startedAt: Date.now() - 120_000,
  completedAt: Date.now() - 60_000,
  durationMs: 60_000,
  costUsd: 0.42,
  models: ["claude-opus-test"],
  turns: 5,
  note: "pushed 1 commit(s), head abc1234. fixed",
  push: { status: "pushed", commits: 1, head: "abc1234" },
  hasLog: true,
  ...over,
});

const FIX = summary({});
const REVIEW = summary({
  taskId: "review-1",
  action: "review",
  agentId: "agent-argus",
  agentName: "Argus",
  agentSprite: 7,
  note: "review: 1 blocking (P0/P1) of 1 finding(s)",
  push: { status: "none", commits: 0, head: null },
});

const DETAIL: PrPatrolRunDetail = {
  run: FIX,
  runs: [{ index: 0, startedAt: FIX.startedAt, finished: true }],
  log: {
    runIndex: 0,
    runCount: 1,
    startedAt: 1000,
    provider: "claude",
    model: "claude-opus-test",
    cwd: "/w",
    steps: [
      {
        index: 0,
        at: 1000,
        kind: "tool",
        tool: "Edit",
        summary: "Editing parse.ts",
        input: '{"file_path": "/w/src/parse.ts"}',
        output: "The file has been updated.",
        isError: false,
        files: ["src/parse.ts"],
        durationMs: 200,
        parentToolUseId: null,
      },
      {
        index: 1,
        at: 43_000,
        kind: "result",
        tool: null,
        summary: "Finished: 5 turn(s), $0.42, 60s",
        input: null,
        output: "Guarded the null case.",
        isError: false,
        files: [],
        durationMs: null,
        parentToolUseId: null,
      },
    ],
    stepsCapped: false,
    toolCalls: 1,
    errors: 0,
    totals: {
      costUsd: 0.42,
      turns: 5,
      durationMs: 60_000,
      inputTokens: 10,
      outputTokens: 2000,
      cacheReadTokens: 30_000,
      cacheWriteTokens: 400,
      byModel: [
        {
          model: "claude-opus-test",
          costUsd: 0.42,
          inputTokens: 10,
          outputTokens: 2000,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        },
      ],
    },
    finalText: "Guarded the null case.",
    finished: true,
    isError: false,
    truncated: false,
    files: ["src/parse.ts"],
    logCommits: [],
  },
  result: { items: [{ title: "Null deref in parse", verdict: "fixed", reason: "added a guard" }] },
  commits: [
    {
      sha: "abc1234def5678",
      subject: "[fix] guard null in parse",
      author: "Patch",
      date: "2026-01-01T10:00:00Z",
      diff: [
        " src/parse.ts | 2 +-",
        "",
        "diff --git a/src/parse.ts b/src/parse.ts",
        "--- a/src/parse.ts",
        "+++ b/src/parse.ts",
        "@@ -1 +1 @@",
        "-return v.x;",
        "+return v?.x;",
      ].join("\n"),
      diffTruncated: false,
    },
  ],
  commitError: null,
  links: {
    kind: "fix",
    reviewTaskId: "review-1",
    items: [
      {
        key: "Null deref in parse",
        title: "Null deref in parse",
        feedbackId: null,
        verdict: "fixed",
        reason: "added a guard",
        replyText: null,
        commits: [{ sha: "abc1234def5678", subject: "[fix] guard null in parse" }],
        finding: { severity: "P1", file: "src/parse.ts", line: 1, title: "Null deref in parse", detail: null },
        feedback: null,
      },
    ],
  },
};

const REVIEW_DETAIL: PrPatrolRunDetail = {
  ...DETAIL,
  run: REVIEW,
  commits: [],
  result: null,
  links: {
    kind: "review",
    fixTaskId: "fix-1",
    findings: [
      {
        severity: "P1",
        file: "src/parse.ts",
        line: 1,
        title: "Null deref in parse",
        detail: "v can be undefined",
        blocking: true,
        fix: { taskId: "fix-1", verdict: "fixed", reason: "added a guard", commits: [], head: "abc1234" },
      },
    ],
  },
};

const agents = [
  { id: "agent-patch", name: "Patch", sprite_number: 3 },
  { id: "agent-argus", name: "Argus", sprite_number: 7 },
] as unknown as Agent[];

describe("RunInspector", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.listRuns.mockResolvedValue({ runs: [FIX, REVIEW], total: 2, scannedLogs: 0, searchCapped: false });
    apiMocks.getRun.mockImplementation((id: string) => Promise.resolve(id === "review-1" ? REVIEW_DETAIL : DETAIL));
  });

  it("lists runs and shows the newest run's header, timeline, diff and item mapping", async () => {
    render(<RunInspector agents={agents} />);

    expect(await screen.findByText("Editing parse.ts")).toBeInTheDocument();
    expect(apiMocks.getRun).toHaveBeenCalledWith("fix-1", undefined);
    // header: avatar sprite (the Patch seat's operator skin, not the stock sprite_number), PR link, cost
    const avatars = screen.getAllByAltText("Patch") as HTMLImageElement[];
    expect(avatars.some((img) => img.getAttribute("src") === "/sprites/102-D-1.png")).toBe(true);
    expect(screen.getAllByText("widgets#7").length).toBeGreaterThan(0);
    expect(screen.getAllByText("$0.420").length).toBeGreaterThan(0);
    // diff with coloured lines
    expect(screen.getAllByText("[fix] guard null in parse").length).toBeGreaterThan(0);
    expect(screen.getByText("Changes · 1 commit(s)")).toBeInTheDocument();
    expect(document.querySelector('[data-diff-line="add"]')?.textContent).toBe("+return v?.x;");
    expect(document.querySelector('[data-diff-line="del"]')?.textContent).toBe("-return v.x;");
    // item -> commit mapping
    expect(screen.getByText("Items → commits")).toBeInTheDocument();
    expect(screen.getByText("added a guard")).toBeInTheDocument();
    // final report
    expect(screen.getByText("Final report")).toBeInTheDocument();
  });

  it("expands a step to show its input and output", async () => {
    render(<RunInspector agents={agents} />);
    fireEvent.click(await screen.findByText("Editing parse.ts"));
    expect(screen.getByText('{"file_path": "/w/src/parse.ts"}')).toBeInTheDocument();
    expect(screen.getByText("The file has been updated.")).toBeInTheDocument();
  });

  it("opens a run from the list and links review findings to their fix run", async () => {
    render(<RunInspector agents={agents} />);
    await screen.findByText("Editing parse.ts");
    const row = document.querySelector('[data-run-id="review-1"]') as HTMLElement;
    fireEvent.click(row);
    expect(await screen.findByText("Findings → fixes")).toBeInTheDocument();
    expect(apiMocks.getRun).toHaveBeenLastCalledWith("review-1", undefined);
    const table = screen.getByRole("table");
    expect(within(table).getByText("P1")).toBeInTheDocument();
    fireEvent.click(within(table).getByRole("button", { name: /Fix run/ }));
    await waitFor(() => expect(apiMocks.getRun).toHaveBeenLastCalledWith("fix-1", undefined));
  });

  it("passes filters to the API and deep-links a requested run", async () => {
    openRunRequest("review-1");
    render(<RunInspector agents={agents} />);
    expect(await screen.findByText("Findings → fixes")).toBeInTheDocument();
    expect(apiMocks.getRun).toHaveBeenCalledWith("review-1", undefined);

    fireEvent.change(screen.getByLabelText("Search runs"), { target: { value: "parse" } });
    fireEvent.click(screen.getByRole("button", { name: "Failed" }));
    await waitFor(() =>
      expect(apiMocks.listRuns).toHaveBeenLastCalledWith(expect.objectContaining({ q: "parse", status: "failed" })),
    );
  });

  it("honours initialTaskId", async () => {
    render(<RunInspector agents={agents} initialTaskId="review-1" />);
    expect(await screen.findByText("Findings → fixes")).toBeInTheDocument();
  });
});
