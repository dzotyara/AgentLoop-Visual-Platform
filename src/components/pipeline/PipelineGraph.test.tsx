import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrPatrolPipeline, PrPatrolPr, PrPatrolStatus } from "../../api";
import type { Agent } from "../../types";
import PipelineGraph from "./PipelineGraph";
import { locatePr, overlayFor } from "./pipeline-model";

const apiMocks = vi.hoisted(() => ({
  getPrPatrolStatus: vi.fn(),
  getPipeline: vi.fn(),
  savePipeline: vi.fn(),
  getCliModels: vi.fn(),
}));

vi.mock("../../api", () => ({
  getPrPatrolStatus: apiMocks.getPrPatrolStatus,
  getPipeline: apiMocks.getPipeline,
  savePipeline: apiMocks.savePipeline,
  getCliModels: apiMocks.getCliModels,
}));

// React Flow measures nodes with ResizeObserver and reads DOMMatrix from the viewport transform.
class ResizeObserverStub {
  constructor(private cb: ResizeObserverCallback) {}
  observe(target: Element) {
    this.cb([{ target, contentRect: { width: 260, height: 300 } } as unknown as ResizeObserverEntry], this as never);
  }
  unobserve() {}
  disconnect() {}
}
class DOMMatrixStub {
  m22: number;
  constructor(transform?: string) {
    const scale = transform?.match(/scale\(([1-9.])\)/)?.[1];
    this.m22 = scale !== undefined ? Number(scale) : 1;
  }
}
const original = {
  ro: globalThis.ResizeObserver,
  dm: (globalThis as { DOMMatrixReadOnly?: unknown }).DOMMatrixReadOnly,
};
beforeAll(() => {
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
  (globalThis as { DOMMatrixReadOnly?: unknown }).DOMMatrixReadOnly = DOMMatrixStub;
  Object.defineProperties(HTMLElement.prototype, {
    offsetHeight: { configurable: true, get: () => 300 },
    offsetWidth: { configurable: true, get: () => 260 },
  });
});
afterAll(() => {
  globalThis.ResizeObserver = original.ro;
  (globalThis as { DOMMatrixReadOnly?: unknown }).DOMMatrixReadOnly = original.dm;
});

function pipeline(): PrPatrolPipeline {
  const step = { enabled: true, model: null, maxAttempts: null };
  return {
    steps: { fix_conflict: step, fix_ci: step, address_feedback: step, review: step, fix_review: step },
    maxConcurrent: null,
    maxReviewRounds: null,
  };
}

function pr(over: Partial<PrPatrolPr> = {}): PrPatrolPr {
  return {
    pr_key: "o/r#7",
    repo: "o/r",
    number: 7,
    title: "Add thing",
    url: "https://github.com/o/r/pull/7",
    head_sha: "abc",
    phase: "working",
    summary: "Medic: Fix CI",
    waiting_on: null,
    notes: [],
    review_rounds: 1,
    updated_at: 1,
    snapshot: null,
    agent: {
      id: "a-medic",
      name: "Medic",
      action: "fix_ci",
      taskId: "task-live",
      activity: "Reading CI logs",
      activityAt: 1,
      toolCalls: 3,
    },
    actions: [
      { action: "fix_ci", status: "running", attempts: 1, taskId: "task-live", updatedAt: 30, note: null },
      { action: "fix_conflict", status: "done", attempts: 1, taskId: "task-old", updatedAt: 20, note: "merged base" },
    ],
    ...over,
  };
}

function status(prs: PrPatrolPr[]): PrPatrolStatus {
  return {
    enabled: true,
    write: false,
    replyToThreads: false,
    review: true,
    intervalMs: 120_000,
    maxConcurrent: 2,
    lastTick: { at: 1, error: null, prs: prs.length },
    prs,
  };
}

describe("PipelineGraph", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.getPrPatrolStatus.mockResolvedValue(status([pr()]));
    apiMocks.getPipeline.mockResolvedValue({
      pipeline: pipeline(),
      defaults: { maxConcurrent: 2, maxAttempts: 2, maxReviewRounds: 3, model: null, review: true },
    });
    apiMocks.getCliModels.mockResolvedValue({ claude: [{ slug: "opus" }, { slug: "claude-sonnet-5" }] });
    apiMocks.savePipeline.mockImplementation(async (p: PrPatrolPipeline) => ({
      pipeline: p,
      defaults: { maxConcurrent: 2, maxAttempts: 2, maxReviewRounds: 3, model: null, review: true },
    }));
  });

  it("renders every loop step and lights the node the PR is at", async () => {
    const onOpenRun = vi.fn();
    render(<PipelineGraph agents={[] as Agent[]} onOpenRun={onOpenRun} />);

    for (const id of [
      "merge_queue",
      "fix_conflict",
      "fix_ci",
      "address_feedback",
      "review",
      "fix_review",
      "wait_ci",
      "ready",
    ]) {
      expect(await screen.findByTestId(`pipeline-node-${id}`)).toBeInTheDocument();
    }

    await waitFor(() => expect(screen.getByTestId("pipeline-node-fix_ci")).toHaveAttribute("data-state", "working"));
    const ci = screen.getByTestId("pipeline-node-fix_ci");
    expect(ci).toHaveAttribute("data-active", "true");
    expect(ci).toHaveTextContent("Reading CI logs");
    expect(screen.getByTestId("pipeline-node-review")).toHaveAttribute("data-active", "false");
    // the conflict step shows its last outcome, with the note on hover
    const conflict = screen.getByTestId("pipeline-node-fix_conflict");
    expect(conflict).toHaveTextContent("last run done");
    expect(conflict.querySelector("[data-testid=last-outcome]")).toHaveAttribute("title", "merged base");

    // clicking the active node opens its live run
    fireEvent.click(ci);
    expect(onOpenRun).toHaveBeenCalledWith("task-live");
  });

  it("edits a step's settings and saves the pipeline", async () => {
    render(<PipelineGraph agents={[] as Agent[]} onOpenRun={vi.fn()} />);
    const toggle = await screen.findByLabelText("CI enabled");
    await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "true"));
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "false");
    fireEvent.change(screen.getByLabelText("CI max attempts"), { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: /Save/ }));
    await waitFor(() => expect(apiMocks.savePipeline).toHaveBeenCalled());
    expect(apiMocks.savePipeline.mock.calls[0][0].steps.fix_ci).toEqual({
      enabled: false,
      model: null,
      maxAttempts: 4,
    });
  });
});

describe("pipeline-model", () => {
  it("places blocked, waiting, merging and queued PRs on their nodes", () => {
    expect(locatePr(pr({ phase: "merging", agent: null, summary: "In merge queue" })).active).toBe("merge_queue");
    expect(locatePr(pr({ phase: "waiting", agent: null, summary: "CI running (2 check(s))" })).active).toBe("wait_ci");
    expect(locatePr(pr({ phase: "ready", agent: null, summary: "ok" })).active).toBe("ready");
    expect(
      locatePr(pr({ phase: "watching", agent: null, summary: "queued: Fix review findings (all agent slots busy)" }))
        .active,
    ).toBe("fix_review");
    const blocked = locatePr(
      pr({
        phase: "blocked",
        agent: null,
        summary: "CI failing (test): CI fixes disabled; 1 blocking review finding(s): fix attempts exhausted",
      }),
    );
    expect(blocked).toMatchObject({ active: "fix_ci", state: "blocked", blockedAt: ["fix_ci", "fix_review"] });
  });

  it("marks steps before the active one as passed", () => {
    const o = overlayFor(pr({ phase: "ready", agent: null, summary: "ok" }));
    expect(o.review.passed).toBe(true);
    expect(o.ready).toMatchObject({ active: true, state: "ready", passed: false });
    expect(overlayFor(null).fix_ci).toMatchObject({ active: false, state: null });
  });
});
