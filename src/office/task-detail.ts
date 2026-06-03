import type { RuntimeStore } from "../db/runtime-store";
import { getTaskDiscordReference } from "../dashboard/discord-links";

export interface OfficeTaskDetail {
  task: NonNullable<ReturnType<RuntimeStore["getTask"]>>;
  workflowPlan: unknown;
  workflowSteps: ReturnType<RuntimeStore["listWorkflowStepRuns"]>;
  runs: ReturnType<RuntimeStore["listTaskRuns"]>;
  artifacts: ReturnType<RuntimeStore["listTaskArtifacts"]>;
  reviews: ReturnType<RuntimeStore["listTaskReviews"]>;
  timeline: ReturnType<RuntimeStore["getTaskTimeline"]>;
  discord: ReturnType<typeof getTaskDiscordReference>;
}

export function buildOfficeTaskList(store: RuntimeStore, limit: number): { tasks: ReturnType<RuntimeStore["listRecentTasks"]> } {
  return { tasks: store.listRecentTasks(limit) };
}

export function buildOfficeTaskDetail(store: RuntimeStore, taskId: string): OfficeTaskDetail | null {
  const task = store.getTask(taskId);
  if (!task) return null;

  return {
    task,
    workflowPlan: parseWorkflowPlan(task.workflowPlanJson),
    workflowSteps: store.listWorkflowStepRuns(taskId),
    runs: store.listTaskRuns(taskId),
    artifacts: store.listTaskArtifacts(taskId),
    reviews: store.listTaskReviews(taskId),
    timeline: store.getTaskTimeline(taskId),
    discord: getTaskDiscordReference(store, taskId),
  };
}

function parseWorkflowPlan(value: string | null): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return { parseError: true, raw: value };
  }
}
