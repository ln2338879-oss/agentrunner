import type { RuntimeConfig } from "../config";
import type { RuntimeStore, WorkflowStepRunRow } from "../db/runtime-store";
import { botReportNote, reviewNote } from "../obsidian/templates";
import type { VaultManager } from "../obsidian/vault-manager";
import { statusFromVerdict } from "../review/review-loop";
import { parseReviewVerdict } from "../review/verdict";
import type { AgentAdapter, AgentRole, AgentRunResult, ReviewVerdict } from "../runtime/types";

export interface StepExecutorOptions {
  role: AgentRole;
  owner: string;
  store: RuntimeStore;
  vault: VaultManager;
  agent: AgentAdapter;
  config: RuntimeConfig;
}

export interface StepExecutorResult {
  claimed: boolean;
  taskId?: string;
  stepId?: string;
  status?: "completed" | "failed";
  reportPath?: string;
  verdict?: ReviewVerdict;
  error?: string;
}

export class StepExecutor {
  constructor(private readonly options: StepExecutorOptions) {}

  async runOnce(): Promise<StepExecutorResult> {
    const step = this.claimReadyStep();
    if (!step) return { claimed: false };

    const prompt = this.buildStepPrompt(step);
    const startedAt = new Date().toISOString();

    try {
      const result = await this.options.agent.run({
        taskId: step.taskId,
        role: this.options.role,
        prompt,
        workspacePath: this.options.config.PROJECT_ROOT,
      });
      const output = result.output || result.error || "Step execution returned no output.";
      const reportPath = stepReportPath(step, this.options.role);
      const status = result.ok ? "completed" : "failed";
      const verdict = isReviewAction(step.action) ? parseStepReviewVerdict(result, output) : undefined;

      this.recordTaskRun({ step, prompt, result: { ...result, output }, status, startedAt });
      await this.writeReport({ step, result: { ...result, output }, status, reportPath, verdict });
      this.recordArtifacts({ step, result, reportPath });

      if (result.ok) {
        this.options.store.completeWorkflowStepRun({
          taskId: step.taskId,
          stepId: step.stepId,
          owner: this.options.owner,
          outputRef: reportPath,
        });
        if (verdict) this.recordReviewVerdict({ step, verdict, output, reportPath });
        else this.completeTaskIfDone(step.taskId);
      } else {
        this.options.store.failWorkflowStepRun({
          taskId: step.taskId,
          stepId: step.stepId,
          owner: this.options.owner,
          outputRef: reportPath,
          error: result.error ?? "Step execution failed.",
        });
        if (step.required) this.options.store.updateTaskStatus(step.taskId, "failed");
      }

      return {
        claimed: true,
        taskId: step.taskId,
        stepId: step.stepId,
        status,
        reportPath,
        verdict,
        error: result.error,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.options.store.failWorkflowStepRun({
        taskId: step.taskId,
        stepId: step.stepId,
        owner: this.options.owner,
        error: message,
      });
      if (step.required) this.options.store.updateTaskStatus(step.taskId, "failed");

      this.options.store.recordTaskRun({
        id: `RUN-${step.taskId}-${this.options.role}-${step.stepId}-${Date.now()}`,
        taskId: step.taskId,
        role: this.options.role,
        model: modelNameFor(this.options.role, this.options.config),
        prompt,
        output: "",
        status: "failed",
        error: message,
        startedAt,
        finishedAt: new Date().toISOString(),
      });

      return {
        claimed: true,
        taskId: step.taskId,
        stepId: step.stepId,
        status: "failed",
        error: message,
      };
    }
  }

  private claimReadyStep(): WorkflowStepRunRow | null {
    for (const roleId of claimRoleIdsForAgentRole(this.options.role)) {
      const step = this.options.store.claimReadyWorkflowStep({
        roleId,
        owner: this.options.owner,
        ttlMinutes: this.options.config.TASK_LEASE_MINUTES,
      });
      if (step) return step;
    }
    return null;
  }

  private buildStepPrompt(step: WorkflowStepRunRow): string {
    const taskPrompt = this.options.store.getTaskPrompt(step.taskId);
    const dependencies = this.options.store
      .listWorkflowStepRuns(step.taskId)
      .filter((candidate) => parseDependsOn(step.dependsOnJson).includes(candidate.stepId));
    const dependencySummary = dependencies.length > 0
      ? dependencies.map((dependency) => `- ${dependency.stepId}: ${dependency.outputRef ?? dependency.status}`).join("\n")
      : "No dependencies.";

    if (step.action === "plan") {
      return [
        "# AgentRunner Planning Step",
        "",
        `Task: ${step.taskId}`,
        `Workflow: ${step.workflowId}`,
        `Step: ${step.stepId}`,
        "",
        "Create a concrete execution plan for this workflow. Focus on what the next role should do, acceptance criteria, risks, and artifacts to produce.",
        "Do not execute implementation work in this step.",
        "",
        "## Original Task Request",
        taskPrompt,
        "",
        "## Dependency Outputs",
        dependencySummary,
      ].join("\n");
    }

    if (step.action === "review" || step.action === "arbitrate") {
      return [
        step.action === "review" ? "# AgentRunner Review Step" : "# AgentRunner Arbitration Step",
        "",
        `Task: ${step.taskId}`,
        `Workflow: ${step.workflowId}`,
        `Step: ${step.stepId}`,
        `Action: ${step.action}`,
        "",
        "You must start with exactly one verdict line:",
        "VERDICT: APPROVED",
        "VERDICT: NEEDS_REVISION",
        "VERDICT: BLOCKED",
        "VERDICT: NEEDS_HUMAN",
        "VERDICT: SPLIT_TASK",
        "VERDICT: RETRY_WITH_DIFFERENT_AGENT",
        "",
        "Use APPROVED only when the dependency outputs satisfy the original request.",
        "Use NEEDS_REVISION when the prior worker can fix concrete issues.",
        "Use BLOCKED when execution cannot continue safely or lacks critical information.",
        "Use NEEDS_HUMAN when explicit user approval, credentials, or a human decision is required.",
        "Use SPLIT_TASK when the request should be decomposed into smaller tasks.",
        "Use RETRY_WITH_DIFFERENT_AGENT when another role/provider is more appropriate.",
        "",
        "## Original Task Request",
        taskPrompt,
        "",
        "## Dependency Outputs",
        dependencySummary,
      ].join("\n");
    }

    return [
      "# AgentRunner Workflow Step Execution",
      "",
      `Task: ${step.taskId}`,
      `Workflow: ${step.workflowId}`,
      `Step: ${step.stepId}`,
      `Action: ${step.action}`,
      `Role: ${step.role}`,
      `Resolved Role: ${step.resolvedRoleId}`,
      "",
      "## Original Task Request",
      taskPrompt,
      "",
      "## Dependency Outputs",
      dependencySummary,
      "",
      "Execute only this workflow step. Produce a clear step output and mention any artifacts created.",
    ].join("\n");
  }

  private recordTaskRun(input: {
    step: WorkflowStepRunRow;
    prompt: string;
    result: AgentRunResult;
    status: "completed" | "failed";
    startedAt: string;
  }): void {
    this.options.store.recordTaskRun({
      id: `RUN-${input.step.taskId}-${this.options.role}-${input.step.stepId}-${Date.now()}`,
      taskId: input.step.taskId,
      role: this.options.role,
      model: modelNameFor(this.options.role, this.options.config),
      prompt: input.prompt,
      output: input.result.output,
      status: input.status,
      error: input.result.error,
      startedAt: input.startedAt,
      finishedAt: new Date().toISOString(),
    });
  }

  private async writeReport(input: {
    step: WorkflowStepRunRow;
    result: AgentRunResult;
    status: "completed" | "failed";
    reportPath: string;
    verdict?: ReviewVerdict;
  }): Promise<void> {
    if (input.verdict) {
      await this.options.vault.writeNote(
        input.reportPath,
        reviewNote({
          taskId: input.step.taskId,
          verdict: input.verdict,
          round: nextReviewRound(this.options.store, input.step.taskId),
          body: [
            `# Workflow Step: ${input.step.stepId}`,
            "",
            `Action: ${input.step.action}`,
            `Workflow: ${input.step.workflowId}`,
            "",
            input.result.output,
          ].join("\n"),
        }),
      );
      return;
    }

    await this.options.vault.writeNote(
      input.reportPath,
      botReportNote({
        taskId: input.step.taskId,
        role: this.options.role,
        status: input.status,
        body: [
          `# Workflow Step: ${input.step.stepId}`,
          "",
          `Action: ${input.step.action}`,
          `Workflow: ${input.step.workflowId}`,
          "",
          input.result.output,
          input.result.error ? `\n## Error\n\n${input.result.error}` : "",
        ].join("\n"),
      }),
    );
  }

  private recordArtifacts(input: {
    step: WorkflowStepRunRow;
    result: AgentRunResult;
    reportPath: string;
  }): void {
    this.options.store.recordArtifact({
      id: `ART-${input.step.taskId}-${this.options.role}-${input.step.stepId}-${Date.now()}`,
      taskId: input.step.taskId,
      type: isReviewAction(input.step.action) ? "workflow_step_review" : "workflow_step_report",
      path: input.reportPath,
      createdBy: this.options.role,
    });

    for (const artifact of input.result.artifacts ?? []) {
      this.options.store.recordArtifact({
        id: `ART-${input.step.taskId}-${this.options.role}-${input.step.stepId}-file-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        taskId: input.step.taskId,
        type: this.options.role === "designer" ? "design_image" : "workflow_step_file",
        path: artifact,
        createdBy: this.options.role,
      });
    }
  }

  private recordReviewVerdict(input: {
    step: WorkflowStepRunRow;
    verdict: ReviewVerdict;
    output: string;
    reportPath: string;
  }): void {
    const round = nextReviewRound(this.options.store, input.step.taskId);
    this.options.store.recordReview({
      id: `REV-${input.step.taskId}-${input.step.stepId}-${round}-${Date.now()}`,
      taskId: input.step.taskId,
      verdict: input.verdict,
      round,
      feedback: input.output,
    });
    this.options.store.recordArtifact({
      id: `ART-${input.step.taskId}-${input.step.stepId}-review-${Date.now()}`,
      taskId: input.step.taskId,
      type: "director_review",
      path: input.reportPath,
      createdBy: "director",
    });

    if (input.verdict === "APPROVED") {
      this.skipPendingOptionalSteps(input.step.taskId, "Approved by workflow review step.");
      this.options.store.updateTaskStatus(input.step.taskId, "approved");
      return;
    }

    this.options.store.updateTaskStatus(input.step.taskId, statusFromVerdict(input.verdict));
  }

  private completeTaskIfDone(taskId: string): void {
    const steps = this.options.store.listWorkflowStepRuns(taskId);
    const requiredDone = steps
      .filter((step) => step.required)
      .every((step) => step.status === "completed" || step.status === "skipped");
    if (requiredDone) this.options.store.updateTaskStatus(taskId, "completed");
    else this.options.store.updateTaskStatus(taskId, "running");
  }

  private skipPendingOptionalSteps(taskId: string, reason: string): void {
    for (const step of this.options.store.listWorkflowStepRuns(taskId)) {
      if (!step.required && (step.status === "pending" || step.status === "running")) {
        this.options.store.updateWorkflowStepRun({
          taskId,
          stepId: step.stepId,
          status: "skipped",
          error: reason,
        });
      }
    }
  }
}

export function claimRoleIdForAgentRole(role: AgentRole): string {
  return claimRoleIdsForAgentRole(role)[0] ?? role;
}

export function claimRoleIdsForAgentRole(role: AgentRole): string[] {
  if (role === "factory") return ["generator"];
  if (role === "director") return ["planner", "reviewer", "arbiter"];
  return [role];
}

function parseStepReviewVerdict(result: AgentRunResult, output: string): ReviewVerdict {
  return result.ok ? parseReviewVerdict(output) : "BLOCKED";
}

function isReviewAction(action: string): boolean {
  return action === "review" || action === "arbitrate";
}

function nextReviewRound(store: RuntimeStore, taskId: string): number {
  return store.listTaskReviews(taskId).length + 1;
}

function parseDependsOn(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function stepReportPath(step: WorkflowStepRunRow, role: AgentRole): string {
  const folder = reportFolderForRole(role);
  return `${folder}/${step.taskId}-${step.stepId}-${role}-step.md`;
}

function reportFolderForRole(role: AgentRole): string {
  if (role === "builder") return "05_BuilderReports";
  if (role === "factory") return "06_FactoryOutputs";
  if (role === "designer") return "06_DesignerOutputs";
  return "04_Reviews";
}

function modelNameFor(role: AgentRole, config: RuntimeConfig): string {
  if (role === "factory") return config.OLLAMA_MODEL;
  if (role === "builder") return config.CODEX_COMMAND;
  if (role === "designer") return config.GEMINI_IMAGE_MODEL;
  return config.CLAUDE_CODE_COMMAND;
}
