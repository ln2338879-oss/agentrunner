import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { parse } from "yaml";
import { RoleRegistry } from "../roles/registry";
import { DefaultWorkflowDefinitions } from "./default-workflows";
import {
  WorkflowRegistryConfigSchema,
  type PlannedWorkflowStep,
  type WorkflowDefinition,
  type WorkflowPlan,
  type WorkflowValidationIssue,
} from "./types";
import type { TaskType } from "../runtime/types";

export interface WorkflowRegistryOptions {
  path?: string;
  includeDefaults?: boolean;
  roleRegistry?: RoleRegistry;
}

export class WorkflowRegistry {
  private readonly workflows = new Map<string, WorkflowDefinition>();
  private readonly defaultWorkflow?: string;

  constructor(
    workflows: WorkflowDefinition[] = [],
    private readonly roleRegistry = new RoleRegistry(),
    defaultWorkflow?: string,
  ) {
    this.defaultWorkflow = defaultWorkflow;
    for (const workflow of workflows) this.workflows.set(workflow.id, workflow);
  }

  static async load(options: WorkflowRegistryOptions = {}): Promise<WorkflowRegistry> {
    const roleRegistry = options.roleRegistry ?? new RoleRegistry();
    const includeDefaults = options.includeDefaults ?? true;
    const workflows = includeDefaults ? [...DefaultWorkflowDefinitions] : [];
    let defaultWorkflow: string | undefined;

    if (options.path && existsSync(options.path)) {
      const text = await readFile(options.path, "utf-8");
      const parsed = WorkflowRegistryConfigSchema.parse(parse(text));
      defaultWorkflow = parsed.defaultWorkflow;
      for (const workflow of parsed.workflows) {
        const index = workflows.findIndex((existing) => existing.id === workflow.id);
        if (index >= 0) workflows[index] = workflow;
        else workflows.push(workflow);
      }
    }

    return new WorkflowRegistry(workflows, roleRegistry, defaultWorkflow);
  }

  list(): WorkflowDefinition[] {
    return [...this.workflows.values()];
  }

  resolve(workflowId?: string, taskType?: TaskType): WorkflowDefinition | null {
    if (workflowId) return this.workflows.get(workflowId) ?? null;

    if (taskType) {
      const byTaskType = this.list().find((workflow) => workflow.defaultForTaskTypes.includes(taskType));
      if (byTaskType) return byTaskType;
    }

    if (this.defaultWorkflow) return this.workflows.get(this.defaultWorkflow) ?? null;
    return this.workflows.get("direct-run") ?? this.list()[0] ?? null;
  }

  require(workflowId?: string, taskType?: TaskType): WorkflowDefinition {
    const workflow = this.resolve(workflowId, taskType);
    if (!workflow) throw new Error(`Unknown workflow: ${workflowId ?? taskType ?? "default"}`);
    return workflow;
  }

  validate(workflowId?: string): WorkflowValidationIssue[] {
    const workflows = workflowId ? [this.require(workflowId)] : this.list();
    const issues: WorkflowValidationIssue[] = [];

    for (const workflow of workflows) {
      const stepIds = new Set<string>();
      for (const step of workflow.steps) {
        if (stepIds.has(step.id)) {
          issues.push({ workflowId: workflow.id, stepId: step.id, message: "Duplicate step id." });
        }
        stepIds.add(step.id);

        if (!this.roleRegistry.resolve(step.role)) {
          issues.push({ workflowId: workflow.id, stepId: step.id, message: `Unknown role: ${step.role}.` });
        }
      }

      for (const step of workflow.steps) {
        for (const dependency of step.dependsOn) {
          if (!stepIds.has(dependency)) {
            issues.push({ workflowId: workflow.id, stepId: step.id, message: `Unknown dependency: ${dependency}.` });
          }
        }
      }
    }

    return issues;
  }

  plan(workflowId?: string, taskType?: TaskType): WorkflowPlan {
    const workflow = this.require(workflowId, taskType);
    const issues = this.validate(workflow.id);
    if (issues.length > 0) {
      throw new Error(`Workflow validation failed: ${issues.map((issue) => issue.message).join("; ")}`);
    }

    const steps: PlannedWorkflowStep[] = workflow.steps.map((step) => {
      const role = this.roleRegistry.require(step.role);
      return {
        id: step.id,
        role: step.role,
        resolvedRoleId: role.id,
        action: step.action,
        description: step.description,
        dependsOn: step.dependsOn,
        required: step.required,
        continueOnFailure: step.continueOnFailure,
        requiresReview: role.permissions.requiresReview,
      };
    });

    return {
      workflowId: workflow.id,
      label: workflow.label,
      steps,
    };
  }
}

export function createDefaultWorkflowRegistry(roleRegistry = new RoleRegistry()): WorkflowRegistry {
  return new WorkflowRegistry(DefaultWorkflowDefinitions, roleRegistry);
}
