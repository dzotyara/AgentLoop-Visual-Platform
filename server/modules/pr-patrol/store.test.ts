import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { nitRoundsUsed } from "./decide.ts";
import { countLegacyNitRounds, createPrPatrolStore, ensurePrPatrolSchema, NIT_BUDGET_SINCE_MS } from "./store.ts";

describe("legacy nit rounds", () => {
  it("counts pushed comment rounds from before the nit budget against it, once", () => {
    const db = new DatabaseSync(":memory:");
    ensurePrPatrolSchema(db);
    let t = NIT_BUDGET_SINCE_MS - 60_000;
    const store = createPrPatrolStore(db, () => t);
    const run = (actionKey: string, note: string) => {
      store.startAction("o/r#1", actionKey, "address_feedback", "task");
      store.finishAction("o/r#1", actionKey, "done", { note });
    };
    run("feedback:h1:a", "pushed 1 commit(s), head h2; 1/1 item(s) handled");
    run("feedback:h2:b", "no changes; 1/1 item(s) handled"); // a placeholder: nothing fixed, not a round
    run("feedback:h2:c", "pushed 2 commit(s), head h3");
    t = NIT_BUDGET_SINCE_MS + 60_000;
    run("feedback:h3:d", "pushed 1 commit(s), head h4"); // after the budget existed: a P0/P1 round, never a nit

    expect(countLegacyNitRounds(db)).toBe(2); // what the next start does
    const mem = store.memory("o/r#1");
    expect([...mem.actions.keys()].sort()).toEqual([
      "feedback:h2:b",
      "feedback:h3:d",
      "legacy-nit:feedback:h1:a",
      "legacy-nit:feedback:h2:c",
    ]);
    expect(nitRoundsUsed(mem)).toBe(2);
    expect(countLegacyNitRounds(db)).toBe(0);
  });
});
