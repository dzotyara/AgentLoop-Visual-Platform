import type { Task, WorkflowPackKey } from "../types";
import { normalizeOfficeWorkflowPack, packScopeKey } from "./office-workflow-pack";

export type TaskCreateInput = {
  title: string;
  description?: string;
  department_id?: string;
  task_type?: string;
  priority?: number;
  project_id?: string;
  project_path?: string;
  assigned_agent_id?: string;
  workflow_pack_key?: WorkflowPackKey;
};

// Skin packs (tarkov) share the development task scope in both directions.
export function filterTasksByOfficePack(tasks: Task[], packKey: WorkflowPackKey): Task[] {
  const scopeKey = packScopeKey(packKey);
  return tasks.filter((task) => packScopeKey(normalizeOfficeWorkflowPack(task.workflow_pack_key)) === scopeKey);
}

export function applyOfficePackToTaskInput(input: TaskCreateInput, packKey: WorkflowPackKey): TaskCreateInput {
  return {
    ...input,
    workflow_pack_key: packScopeKey(packKey),
  };
}
