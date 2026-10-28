import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { breakChecks, breakPrs, createBaseBreakStore } from "./base-breaks.ts";

describe("base breakages", () => {
  const store = () => createBaseBreakStore(new DatabaseSync(":memory:"), () => 1000);
  const rec = { repo: "o/r", base: "staging", baseSha: "s1", detail: "zoom tests time out" };

  it("joins a PR to the breakage its checks belong to instead of opening a second one", () => {
    const b = store();
    const first = b.record({ ...rec, checks: ["test / Tests (shard 0)"], pr: "o/r#1" });
    const second = b.record({ ...rec, checks: ["test / Tests (shard 0)", "test / Tests (shard 2)"], pr: "o/r#2" });
    expect(second.id).toBe(first.id);
    expect(breakChecks(second)).toEqual(["test / Tests (shard 0)", "test / Tests (shard 2)"]);
    expect(breakPrs(second)).toEqual(["o/r#1", "o/r#2"]);
    expect(b.forDecide("o/r", "main")).toEqual([]);
  });

  it("never holds the base-fix PR on its own breakage, and gives up fixing after two failed attempts", () => {
    const b = store();
    const row = b.record({ ...rec, checks: ["x"], pr: "o/r#1" });
    b.setFix(row.id, { pr: 9, url: "u", branch: "pr-loop/base-fix-1" });
    expect(b.forDecide("o/r", "staging", "pr-loop/base-fix-1")).toEqual([]);
    expect(b.forDecide("o/r", "staging", "feat")).toHaveLength(1);
    b.fixFailed(row.id, "closed");
    expect(b.get(row.id)?.status).toBe("open");
    b.fixFailed(row.id, "no fix");
    expect(b.get(row.id)?.status).toBe("abandoned");
    expect(b.forDecide("o/r", "staging")).toHaveLength(1); // PRs keep waiting on it
    b.resolve(row.id, "fixed");
    expect(b.forDecide("o/r", "staging")).toEqual([]);
  });
});
