import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { DEFAULT_WORKFLOW_PACK_SEEDS, isDevScopedSkinPack, isWorkflowPackKey, packScopeKey } from "./definitions.ts";
import { parseWorkflowPackKeyInput } from "./department-scope.ts";
import { resolveWorkflowPackKeyForTask } from "./task-pack-resolver.ts";
import { syncOfficePackAgentsForPack } from "../../routes/collab/office-pack-agent-hydration.ts";

describe("tarkov skin pack scoping", () => {
  it("is a registered pack key that scopes to development", () => {
    expect(isWorkflowPackKey("tarkov")).toBe(true);
    expect(isDevScopedSkinPack("tarkov")).toBe(true);
    expect(packScopeKey("tarkov")).toBe("development");
    expect(packScopeKey("novel")).toBe("novel");
    expect(isDevScopedSkinPack("development")).toBe(false);
  });

  it("has a seed that mirrors development and is never keyword-routed", () => {
    const dev = DEFAULT_WORKFLOW_PACK_SEEDS.find((seed) => seed.key === "development");
    const tarkov = DEFAULT_WORKFLOW_PACK_SEEDS.find((seed) => seed.key === "tarkov");
    expect(tarkov?.name).toBe("Tarkov Hideout");
    expect(tarkov?.promptPreset).toEqual(dev?.promptPreset);
    expect(tarkov?.qaRules).toEqual(dev?.qaRules);
    expect(tarkov?.routingKeywords).toEqual([]);
  });

  it("department/agent scope inputs resolve tarkov to development", () => {
    expect(parseWorkflowPackKeyInput("tarkov")).toBe("development");
    expect(parseWorkflowPackKeyInput('"tarkov"')).toBe("development");
    expect(parseWorkflowPackKeyInput("report")).toBe("report");
  });

  it("tasks created with the tarkov pack are stored as development tasks", () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec("CREATE TABLE projects (id TEXT PRIMARY KEY, default_pack_key TEXT NOT NULL DEFAULT 'development')");
      db.exec("CREATE TABLE tasks (id TEXT PRIMARY KEY, workflow_pack_key TEXT NOT NULL DEFAULT 'development')");
      expect(resolveWorkflowPackKeyForTask({ db, explicitPackKey: "tarkov" })).toBe("development");
    } finally {
      db.close();
    }
  });

  it("never hydrates a separate agent set for tarkov", () => {
    // No tables: any DB access would throw, proving the skin pack short-circuits.
    const db = new DatabaseSync(":memory:");
    try {
      const profiles = JSON.stringify({
        tarkov: {
          departments: [{ id: "dev", name: "Workbench" }],
          agents: [{ id: "tarkov-seed-1", name: "Scout", department_id: "dev", role: "senior" }],
        },
      });
      expect(syncOfficePackAgentsForPack(db, profiles, "tarkov", () => 1)).toEqual({
        departmentsSynced: 0,
        agentsSynced: 0,
      });
    } finally {
      db.close();
    }
  });
});
