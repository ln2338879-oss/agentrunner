import type { ClassifiedTask } from "./classify";
import type { WorkflowRegistry } from "../workflows/engine";
import type { WorkflowPlan } from "../workflows/types";

export function planWorkflowForTask(input: {
  classified: ClassifiedTask;
  workflowRegistry: WorkflowRegistry;
  workflowId?: string;
}): WorkflowPlan {
  return input.workflowRegistry.plan(input.workflowId, input.classified.type);
}
