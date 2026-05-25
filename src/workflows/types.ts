import { z } from "zod";

export const WorkflowActionSchema = z.enum([
  "classify",
  "plan",
  "implement",
  "generate-content",
  "research",
  "review",
  "arbitrate",
  "summarize",
  "notify",
]);

export const WorkflowStepSchema = z.object({
  id: z.string().min(1),
  role: z.string().min(1),
  action: WorkflowActionSchema,
  description: z.string().optional(),
  dependsOn: z.array(z.string()).default([]),
  required: z.boolean().default(true),
  continueOnFailure: z.boolean().default(false),
});

export const WorkflowDefinitionSchema = z.object({
  id: z.string().min(1),
  label: z.string().optional(),
  description: z.string().optional(),
  defaultForTaskTypes: z.array(z.enum(["planning", "implementation", "content", "review"])).default([]),
  steps: z.array(WorkflowStepSchema).min(1),
});

export const WorkflowRegistryConfigSchema = z.object({
  defaultWorkflow: z.string().optional(),
  workflows: z.array(WorkflowDefinitionSchema).default([]),
});

export type WorkflowAction = z.infer<typeof WorkflowActionSchema>;
export type WorkflowStep = z.infer<typeof WorkflowStepSchema>;
export type WorkflowDefinition = z.infer<typeof WorkflowDefinitionSchema>;
export type WorkflowRegistryConfig = z.infer<typeof WorkflowRegistryConfigSchema>;

export interface PlannedWorkflowStep {
  id: string;
  role: string;
  resolvedRoleId: string;
  action: WorkflowAction;
  description?: string;
  dependsOn: string[];
  required: boolean;
  continueOnFailure: boolean;
  requiresReview: boolean;
}

export interface WorkflowPlan {
  workflowId: string;
  label?: string;
  steps: PlannedWorkflowStep[];
}

export interface WorkflowValidationIssue {
  workflowId: string;
  stepId?: string;
  message: string;
}
