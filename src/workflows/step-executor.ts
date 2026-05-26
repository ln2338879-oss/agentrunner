import type { RuntimeConfig } from "../config";
import type { RuntimeStore, WorkflowStepRunRow } from "../db/runtime-store";
import type { RuntimeNotifier } from "../discord/notifier";
import { botReportNote, reviewNote } from "../obsidian/templates";
import type { VaultManager } from "../obsidian/vault-manager";
import { statusFromVerdict } from "../review/review-loop";
import {
  buildReviewSafetyContext,
  captureReviewSafetySnapshot,
  compareReviewSafetySnapshots,
  type ReviewSafetySnapshot,
} from "../review/review-safety";
import { parseReviewVerdict } from "../review/verdict";
import type { AgentAdapter, AgentRole, AgentRunResult, ReviewVerdict } from "../runtime/types";

export interface StepExecutorOptions {
  role: AgentRole;
  owner: string;
  store: RuntimeStore;
  vault: VaultManager;
  agent: AgentAdapter;
  config: RuntimeConfig;
  notifier?: RuntimeNotifier;
}

export interface StepExecutorResult {
  claimed: boolean;
  taskId?: string;
  stepId?: string;
  status?: "completed" | "failed" | "needs_human";
  reportPath?: string;
  verdict?: ReviewVerdict;
  error?: string;
  output?: string;
}

export class StepExecutor {
  constructor(private readonly options: StepExecutorOptions) {}

  async runOnce(): Promise<StepExecutorResult> {
    const step = this.claimReadyStep();
    if (!step) return { claimed: false };

    const prompt = await this.buildRuntimePrompt(step);
    const startedAt = new Date().toISOString();
    const reviewSafetyBefore = await this.captureReviewSafetyBefore(step);

    try {
      let result = await this.options.agent.run({
        taskId: step.taskId,
        role: this.options.role,
        prompt,
        workspacePath: this.options.config.PROJECT_ROOT,
      });
      result = await this.applyReviewSafetyResult(step, result, reviewSafetyBefore);
      const output = result.output || result.error || "Step execution returned no output.";
      const reportPath = stepReportPath(step, this.options.role);
      const runStatus = result.ok ? "completed" : "failed";
      const stepStatus: StepExecutorResult["status"] = result.ok ? "completed" : result.needsHuman ? "needs_human" : "failed";
      const verdict = isReviewAction(step.action) ? parseStepReviewVerdict(result, output) : undefined;

      this.recordTaskRun({ step, prompt, result: { ...result, output }, status: runStatus, startedAt });
      await this.writeReport({ step, result: { ...result, output }, status: runStatus, reportPath, verdict });
      this.recordArtifacts({ step, result, reportPath });

      if (result.ok) {
        this.options.store.completeWorkflowStepRun({
          taskId: step.taskId,
          stepId: step.stepId,
          owner: this.options.owner,
          outputRef: reportPath,
        });
        if (verdict) {
          this.recordReviewVerdict({ step, verdict, output, reportPath });
          await this.notifyReview({ step, verdict, output, reportPath });
        } else {
          this.completeTaskIfDone(step.taskId);
          await this.notifyWorker({ step, output, reportPath });
        }
      } else {
        this.options.store.failWorkflowStepRun({
          taskId: step.taskId,
          stepId: step.stepId,
          owner: this.options.owner,
          outputRef: reportPath,
          error: result.error ?? "Step execution failed.",
        });
        if (result.needsHuman) {
          this.options.store.updateTaskStatus(step.taskId, "needs_human");
          this.options.store.recordRuntimeEvent({
            kind: "human_intervention_required",
            taskId: step.taskId,
            stepId: step.stepId,
            owner: this.options.owner,
            message: result.error ?? "Provider requires human intervention.",
            metadata: {
              role: this.options.role,
              errorKind: result.errorKind,
              reportPath,
            },
          });
          await this.options.notifier?.blocked({
            taskId: step.taskId,
            reviewPath: reportPath,
            reason: result.error ?? "Provider requires human intervention.",
          });
        } else {
          if (step.required) this.options.store.updateTaskStatus(step.taskId, "failed");
          await this.notifyWorker({ step, output, reportPath });
        }
      }

      return {
        claimed: true,
        taskId: step.taskId,
        stepId: step.stepId,
        status: stepStatus,
        reportPath,
        verdict,
        error: result.error,
        output,
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
        output: message,
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

  private async buildRuntimePrompt(step: WorkflowStepRunRow): Promise<string> {
    const prompt = this.buildStepPrompt(step);
    if (!isReviewAction(step.action)) return prompt;

    const context = await buildReviewSafetyContext({
      workspacePath: this.options.config.PROJECT_ROOT,
      config: this.options.config,
    });
    return [prompt, context].join("\n\n");
  }

  private buildStepPrompt(step: WorkflowStepRunRow): string {
    const taskPrompt = this.options.store.getTaskPrompt(step.taskId);
    const dependencies = this.options.store
      .listWorkflowStepRuns(step.taskId)
      .filter((candidate) => parseDependsOn(step.dependsOnJson).includes(candidate.stepId));
    const dependencySummary = dependencies.length > 0
      ? dependencies.map((dependency) => `- ${dependency.stepId}: ${dependency.outputRef ?? dependency.status}`).join("\n")
      : "No dependencies.";
    const revisionFeedback = this.buildRevisionFeedbackSummary(step);

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
        "Use APPROVED only when the dependency outputs satisfy the original request and validation context is acceptable.",
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
        "",
        "## Prior Review Feedback",
        revisionFeedback,
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
      "## Prior Review Feedback",
      revisionFeedback,
      "",
      "Execute only this workflow step. If prior review feedback exists, address it directly before producing new output.",
    ].join("\n");
  }

  private buildRevisionFeedbackSummary(step: WorkflowStepRunRow): string {
    const sections: string[] = [];
    if (step.error) {
      sections.push(["### Current Step Requeue Reason", trimLongFeedback(step.error, 2500)].join("\n\n"));
    }

    const reviews = this.options.store.listTaskReviews(step.taskId);
    if (reviews.length > 0) {
      sections.push(
        reviews
          .slice(-3)
          .map((review) => [
            `### Review Round ${review.round}: ${review.verdict}`,
            trimLongFeedback(review.feedback, 2500),
          ].join("\n\n"))
          .join("\n\n"),
      );
    }

    return sections.length > 0 ? sections.join("\n\n") : "No prior review feedback.";
  }

  private async captureReviewSafetyBefore(step: WorkflowStepRunRow): Promise<ReviewSafetySnapshot | undefined> {
    if (!this.options.config.REVIEW_READ_ONLY_GUARD || !isReviewAction(step.action)) return undefined;
    return captureReviewSafetySnapshot(this.options.config.PROJECT_ROOT);
  }

  private async applyReviewSafetyResult(
    step: WorkflowStepRunRow,
    result: AgentRunResult,
    before?: ReviewSafetySnapshot,
  ): Promise<AgentRunResult> {
    if (!before || !isReviewAction(step.action)) return result;
    const after = await captureReviewSafetySnapshot(this.options.config.PROJECT_ROOT);
    const safety = compareReviewSafetySnapshots(before, after);
    if (safety.ok) return result;

    const output = [
      result.output || result.error || "Review step returned no output.",
      "",
      "## Review Safety Failure",
      safety.violation,
    ].join("\n");

    return {
      ok: false,
      output,
      error: "Review read-only guard detected workspace mutations.",
      artifacts: result.artifacts,
    };
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
        status: input.result.needsHuman ? "needs_human" : input.status,
        body: [
          `# Workflow Step: ${input.step.stepId}`,
          "",
          `Action: ${input.step.action}`,
          `Workflow: ${input.step.workflowId}`,
          input.result.errorKind ? `Error kind: ${input.result.errorKind}` : "",
          input.result.needsHuman ? "Human intervention required: true" : "",
          "",
          input.result.output,
          input.result.error ? `\n## Error\n\n${input.result.error}` : "",
        ].filter(Boolean).join("\n"),
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
      type: input.result.needsHuman ? "human_intervention" : isReviewAction(input.step.action) ? "workflow_step_review" : "workflow_step_report",
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

    if (input.verdict === "NEEDS_REVISION") {
      this.requeueRevisionSteps(input.step, round, input.output);
      return;
    }

    this.options.store.updateTaskStatus(input.step.taskId, statusFromVerdict(input.verdict));
  }

  private requeueRevisionSteps(step: WorkflowStepRunRow, round: number, feedback: string): void {
    if (round >= this.options.config.MAX_REVIEW_ROUNDS) {
      this.options.store.updateTaskStatus(step.taskId, "blocked");
      return;
    }

    const allSteps = this.options.store.listWorkflowStepRuns(step.taskId);
    const dependencyStepIds = parseDependsOn(step.dependsOnJson);
    const revisionTargets = allSteps.filter(
      (candidate) => dependencyStepIds.includes(candidate.stepId) && !isReviewAction(candidate.action),
    );
    const reason = revisionReason(round, feedback);

    for (const target of revisionTargets) {
      this.options.store.requeueWorkflowStepRun({
        taskId: step.taskId,
        stepId: target.stepId,
        reason,
      });
    }

    this.options.store.requeueWorkflowStepRun({
      taskId: step.taskId,
      stepId: step.stepId,
      reason,
    });
    this.options.store.updateTaskStatus(step.taskId, "needs_revision");
  }

  private async notifyWorker(input: {
    step: WorkflowStepRunRow;
    output: string;
    reportPath: string;
  }): Promise<void> {
    await this.options.notifier?.workerReport({
      taskId: input.step.taskId,
      role: this.options.role,
      reportPath: input.reportPath,
      round: workflowStepRound(input.step.stepIndex),
      output: input.output,
    } as Parameters<RuntimeNotifier["workerReport"]>[0] & { output: string });
  }

  private async notifyReview(input: {
    step: WorkflowStepRunRow;
    verdict: ReviewVerdict;
    output: string;
    reportPath: string;
  }): Promise<void> {
    await this.options.notifier?.reviewResult({
      taskId: input.step.taskId,
      verdict: input.verdict,
      reviewPath: input.reportPath,
      round: nextReviewRound(this.options.store, input.step.taskId),
      output: input.output,
    } as Parameters<RuntimeNotifier["reviewResult"]>[0] & { output: string });
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
  if (result.needsHuman) return "NEEDS_HUMAN";
  return result.ok ? parseReviewVerdict(output) : "BLOCKED";
}

function isReviewAction(action: string): boolean {
  return action === "review" || action === "arbitrate";
}

function nextReviewRound(store: RuntimeStore, taskId: string): number {
  return store.listTaskReviews(taskId).length + 1;
}

function workflowStepRound(stepIndex: number): number {
  return stepIndex + 1;
}

function parseDependsOn(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function revisionReason(round: number, feedback: string): string {
  return [`Revision round ${round} requested by review step.`, "", trimLongFeedback(feedback)].join("\n");
}

function trimLongFeedback(value: string, maxLength = 4000): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}\n... [truncated]`;
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
