import { describe, expect, it } from "vitest";
import type { Agent, Department, Task } from "../types";
import {
  buildOfficePackPresentation,
  buildOfficePackStarterAgents,
  getOfficePackDecorStyle,
  getOfficePackRoomThemes,
  listOfficePackOptions,
  normalizeOfficeWorkflowPack,
  packScopeKey,
} from "./office-workflow-pack";
import { resolvePackAgentViews, resolvePackDepartmentsForDisplay } from "./office-pack-display";
import { applyOfficePackToTaskInput, filterTasksByOfficePack } from "./task-workflow-pack";

const ROOM_THEME_KEYS = ["ceoOffice", "planning", "dev", "design", "qa", "devsecops", "operations", "breakRoom"];

function makeDepartment(id: string): Department {
  return {
    id,
    name: id.toUpperCase(),
    name_ko: `${id}-ko`,
    name_ja: `${id}-ja`,
    name_zh: `${id}-zh`,
    icon: "🏢",
    color: "#64748b",
    description: `${id} description`,
    prompt: `${id} prompt`,
    sort_order: 1,
    created_at: 1,
  };
}

function makeTask(id: string, workflowPackKey: Task["workflow_pack_key"]): Task {
  return {
    id,
    title: id,
    description: null,
    department_id: null,
    assigned_agent_id: null,
    status: "inbox",
    priority: 3,
    task_type: "general",
    workflow_pack_key: workflowPackKey,
    project_path: null,
    result: null,
    started_at: null,
    completed_at: null,
    created_at: 1,
    updated_at: 1,
  };
}

describe("packScopeKey", () => {
  it("maps the tarkov skin to the development scope", () => {
    expect(packScopeKey("tarkov")).toBe("development");
  });

  it("keeps every other pack in its own scope", () => {
    for (const key of ["development", "novel", "report", "video_preprod", "web_research_report", "roleplay"] as const) {
      expect(packScopeKey(key)).toBe(key);
    }
  });

  it("tarkov is a selectable office pack", () => {
    expect(normalizeOfficeWorkflowPack("tarkov")).toBe("tarkov");
  });
});

describe("tarkov office pack preset", () => {
  it("defines all 8 room themes", () => {
    const themes = getOfficePackRoomThemes("tarkov");
    expect(Object.keys(themes).sort()).toEqual([...ROOM_THEME_KEYS].sort());
    for (const key of ROOM_THEME_KEYS) {
      const theme = themes[key];
      expect(theme).toBeDefined();
      for (const field of ["floor1", "floor2", "wall", "accent"] as const) {
        expect(typeof theme?.[field]).toBe("number");
      }
    }
  });

  it("is listed right after development with the TARKOV slug", () => {
    const options = listOfficePackOptions("en");
    expect(options[0]?.key).toBe("development");
    expect(options[1]).toMatchObject({ key: "tarkov", slug: "TARKOV", label: "Tarkov Hideout" });
  });

  it("uses the tarkov decor style; other packs keep the default decor", () => {
    expect(getOfficePackDecorStyle("tarkov")).toBe("tarkov");
    expect(getOfficePackDecorStyle("development")).toBe("default");
    expect(getOfficePackDecorStyle("video_preprod")).toBe("default");
  });

  it("does not seed a separate starter agent set", () => {
    expect(
      buildOfficePackStarterAgents({
        packKey: "tarkov",
        departments: ["planning", "dev", "design", "qa", "operations", "devsecops"].map(makeDepartment),
      }),
    ).toEqual([]);
  });

  it("renames departments for display but keeps the development descriptions and prompts", () => {
    const presentation = buildOfficePackPresentation({
      packKey: "tarkov",
      locale: "en",
      departments: [makeDepartment("dev"), makeDepartment("qa")],
      agents: [],
      customRoomThemes: {},
    });
    const dev = presentation.departments.find((dept) => dept.id === "dev");
    expect(dev?.name).toBe("Workbench");
    expect(dev?.description).toBe("dev description");
    expect(dev?.prompt).toBe("dev prompt");
    expect(presentation.roomThemes.breakRoom).toEqual(getOfficePackRoomThemes("tarkov").breakRoom);
  });
});

describe("tarkov shares the development agent/task scope", () => {
  it("shows development tasks under tarkov and tarkov-tagged tasks under development", () => {
    const tasks = [
      makeTask("dev-task", "development"),
      makeTask("tarkov-task", "tarkov"),
      makeTask("legacy-task", undefined),
      makeTask("novel-task", "novel"),
    ];
    expect(filterTasksByOfficePack(tasks, "tarkov").map((task) => task.id)).toEqual([
      "dev-task",
      "tarkov-task",
      "legacy-task",
    ]);
    expect(filterTasksByOfficePack(tasks, "development").map((task) => task.id)).toEqual([
      "dev-task",
      "tarkov-task",
      "legacy-task",
    ]);
    expect(filterTasksByOfficePack(tasks, "novel").map((task) => task.id)).toEqual(["novel-task"]);
  });

  it("creates tasks in the development scope while tarkov is active", () => {
    expect(applyOfficePackToTaskInput({ title: "Fix bug" }, "tarkov").workflow_pack_key).toBe("development");
  });

  it("uses the global agents and departments, like development", () => {
    const globalAgents = [{ id: "argus" } as Agent];
    const packAgents = [{ id: "tarkov-seed-1" } as Agent];
    expect(resolvePackAgentViews({ packKey: "tarkov", globalAgents, packAgents }).mergedAgents).toBe(globalAgents);
    const globalDepartments = [makeDepartment("dev")];
    expect(
      resolvePackDepartmentsForDisplay({
        packKey: "tarkov",
        globalDepartments,
        packDepartments: [makeDepartment("planning")],
      }),
    ).toBe(globalDepartments);
  });
});
