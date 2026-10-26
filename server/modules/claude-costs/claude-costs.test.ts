import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { createClaudeCostTracker, parseResultLine } from "./index.ts";

const result = (uuid: string, cost: number) =>
  JSON.stringify({
    type: "result",
    uuid,
    total_cost_usd: cost,
    usage: { input_tokens: 1, output_tokens: 2 },
    modelUsage: { "claude-opus-5-5": { costUSD: cost } },
  });

describe("claude costs", () => {
  it("parses only result events with a cost", () => {
    expect(parseResultLine(result("a", 0.5))?.total_cost_usd).toBe(0.5);
    expect(parseResultLine('{"type":"assistant"}')).toBeNull();
    expect(parseResultLine("not json")).toBeNull();
  });

  it("scans logs incrementally and never double-counts a run", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-"));
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE tasks (id TEXT, title TEXT, assigned_agent_id TEXT, workflow_meta_json TEXT)");
    db.exec("CREATE TABLE agents (id TEXT, name TEXT)");
    db.exec(
      `INSERT INTO agents VALUES ('ag1', 'Medic');
       INSERT INTO tasks VALUES ('t1', 'Fix CI', 'ag1', '{"source":"pr-patrol","pr":"o/r#1"}')`,
    );
    const tracker = createClaudeCostTracker(db, dir, () => Date.now());
    fs.writeFileSync(path.join(dir, "t1.log"), `noise\n${result("u1", 1.25)}\n`);
    expect(tracker.scan()).toBe(1);
    expect(tracker.scan()).toBe(0);
    fs.appendFileSync(path.join(dir, "t1.log"), `${result("u2", 0.75)}\n${result("u3", 9)}`); // u3 line unfinished
    expect(tracker.scan()).toBe(1);

    const s = tracker.summary();
    expect(s.allTime).toEqual({ costUsd: 2, runs: 2 });
    expect(s.byAgent[0]).toMatchObject({ label: "Medic", costUsd: 2 });
    expect(s.byPr[0]).toMatchObject({ key: "o/r#1", costUsd: 2, runs: 2 });
    expect(s.byModel[0]).toMatchObject({ key: "claude-opus-5-5", costUsd: 2 });
  });
});
