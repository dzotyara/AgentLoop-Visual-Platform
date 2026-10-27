/**
 * Hand-off into the run inspector from other views (PR page, office, war room): which run to open
 * when the inspector mounts. Module-level, hook-free, like warroom/pr-selection.ts.
 */
let requested: string | null = null;

export function openRunRequest(taskId: string): void {
  requested = taskId;
}

export function takeRunRequest(): string | null {
  const id = requested;
  requested = null;
  return id;
}
