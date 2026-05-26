import type { RuntimeConfig } from "../config";
import { appendBrowserContext } from "../browser/adapter";
import { RuntimeStore } from "../db/runtime-store";
import type { RuntimeNotifier } from "../discord/notifier";
import { NullNotifier } from "../discord/notifier";
import type { GroupConfigManager } from "../groups/group-config";
import { botReportNote, taskNote } from "../obsidian/templates";
import { VaultManager } from "../obsidian/vault-manager";
import { createPolicyEngine, type PolicyEngine } from "../policies/engine";
import { runDirectorReview, statusFromVerdict } from "../review/review-loop";
import { RoleRegistry } from "../roles/registry";
import { classifyTask } from "../router/classify";
import { planWorkflowForTask } from "../router/workflow-routing";
import { loadSkillContext } from "../skills/context";
import { runShellCommand } from "../utils/command";
import { appendVisionAnalysis } from "../vision/adapter";
import { WorkflowRegistry } from "../workflows/engine";
import type { PlannedWorkflowStep, WorkflowPlan } from "../workflows/types";
import type { AgentAdapter, AgentRole, AgentRunResult, ReviewVerdict } from "./types";

export interface OrchestratorResult {
  taskId: string;
  assignedTo: AgentRole;
  obsidianPath: string;
  reportPath: string;
  reviewPath?: string;
  approvedPath?: string;
  verdict?: ReviewVerdict;
  finalOutput?: string;
}

export class Orchestrator {
  private readonly agents = new Map<AgentRole, AgentAdapter>();
  private notifier: RuntimeNotifier = new NullNotifier();
  private groupConfig: GroupConfigManager | null = null;
  private roleRegistry = new RoleRegistry();
  private workflowRegistry = new WorkflowRegistry([], this.roleRegistry);

  constructor(
    private readonly store: RuntimeStore,
    private readonly vault: VaultManager,
    private readonly config: RuntimeConfig,
  ) {}

  registerAgent(agent: AgentAdapter): void {
    this.agents.set(agent.role, agent);
  }

  setNotifier(notifier: RuntimeNotifier): void {
    this.notifier = notifier;
  }

  setGroupConfig(groupConfig: GroupConfigManager): void {
    this.groupConfig = groupConfig;
  }

  async initialize(): Promise<void> {
    await this.groupConfig?.load();
    this.roleRegistry = await RoleRegistry.load({ path: this.config.ROLES_CONFIG_PATH });
    this.workflowRegistry = await WorkflowRegistry.load({
      path: this.config.WORKFLOWS_CONFIG_PATH,
      roleRegistry: this.roleRegistry,
    });
    await this.vault.ensureDefaultFolders();

    if (this.config.RECOVER_STALE_TASKS_ON_START) {
      const recovered = this.store.recoverStaleTasks({ staleMinutes: this.config.STALE_TASK_MINUTES });
      if (recovered.length > 0) {
        const recoveryPath = `08_Recovery/recovery-${Date.now()}.md`;
        await this.vault.writeNote(
          recoveryPath,
          [
            "---",
            `created_at: ${new Date().toISOString()}`,
            `stale_task_minutes: ${this.config.STALE_TASK_MINUTES}`,
            "---",
            "",
            "# Startup Recovery Report",
            "",
            "The following stale running or revision tasks were marked as BLOCKED during startup recovery.",
            "",
            "| Task | Previous Status | Locked By |",
            "|---|---|---|",
            ...recovered.map((task) => `| ${task.id} | ${task.status} | ${task.lockedBy ?? ""} |`),
            "",
          ].join("\n"),
        );
        await this.notifier.recovery({ count: recovered.length, path: recoveryPath });
      }
    }
  }

  async handleUserRequest(input: {
    content: string;
    discordMessageId?: string;
    discordChannelId?: string;
  }): Promise<OrchestratorResult> {
    const group = this.groupConfig?.resolveByChannel(input.discordChannelId) ?? null;
    const policyEngine = createPolicyEngine(group?.effectivePolicy);
    const skillContext = await loadSkillContext({
      skillsDir: this.config.SKILLS_DIR,
      skillIds: group?.effectiveSkills ?? [],
    });
    const baseEffectiveContent = skillContext
      ? [skillContext, "", "# User Request", "", input.content].join("\n")
      : input.content;
    const browserContent = await appendBrowserContext({
      content: baseEffectiveContent,
      config: this.config,
    });
    const effectiveContent = await appendVisionAnalysis({
      content: browserContent,
      config: this.config,
    });

    const classified = classifyTask(input.content);
    const workflowPlan = planWorkflowForTask({
      classified,
      workflowRegistry: this.workflowRegistry,
      workflowId: group?.defaultWorkflow ?? group?.profile?.defaultWorkflow,
    });
    const taskId = `TASK-${Date.now()}`;
    const title = input.content.slice(0, 60).replace(/\s+/g, " ") || "Untitled task";
    const obsidianPath = `01_Tasks/${taskId}.md`;
    const leaseOwner = `orchestrator:${classified.assignedTo}`;

    if (group && !group.allowedRoles.includes(classified.assignedTo)) {
      throw new Error(`Role ${classified.assignedTo} is not allowed in group ${group.id}.`);
    }

    if (classified.assignedTo === "builder") policyEngine.requireAllowed("code_changes");
    if (classified.assignedTo === "factory") policyEngine.requireAllowed("content_generation");
    if (classified.assignedTo === "designer") policyEngine.requireAllowed("image_generation");

    this.store.createTask({
      id: taskId,
      title,
      type: classified.type,
      assignedTo: classified.assignedTo,
      obsidianPath,
      groupId: group?.workspaceId ?? group?.id,
      workflowPlan,
    });

    const leaseAcquired = this.store.acquireTaskLease({
      taskId,
      owner: leaseOwner,
      ttlMinutes: this.config.TASK_LEASE_MINUTES,
    });

    if (!leaseAcquired) {
      this.store.updateTaskStatus(taskId, "blocked");
      await this.notifier.blocked({ taskId, reason: "Task is already locked by another worker." });
      throw new Error(`Task ${taskId} is already locked by another worker.`);
    }

    try {
      this.store.recordMessage({
        id: `MSG-${Date.now()}`,
        discordMessageId: input.discordMessageId ?? taskId,
        discordChannelId: input.discordChannelId ?? "manual",
        taskId,
        senderRole: "director",
        content: input.content,
      });

      await this.vault.writeNote(
        obsidianPath,
        taskNote({
          id: taskId,
          title,
          type: classified.type,
          assignedTo: classified.assignedTo,
          request: effectiveContent,
          discordMessageId: input.discordMessageId,
          discordChannelId: input.discordChannelId,
          workflowPlan,
        }),
      );
      completeSyntheticPlanningSteps({
        store: this.store,
        taskId,
        workflowPlan,
        assignedTo: classified.assignedTo,
        outputRef: obsidianPath,
      });

      await this.notifier.taskCreated({
        taskId,
        role: classified.assignedTo,
        obsidianPath,
        content: input.content,
      });

      const agent = this.requireAgent(classified.assignedTo);
      const workerStep = primaryWorkerStepForRole(workflowPlan, classified.assignedTo);
      const reviewStep = workflowPlan.steps.find((step) => step.action === "review");
      let prompt = effectiveContent;
      let latestReportPath = "";
      let latestReviewPath: string | undefined;
      let latestVerdict: ReviewVerdict | undefined;
      let latestResult: AgentRunResult | undefined;

      for (let round = 1; round <= this.config.MAX_REVIEW_ROUNDS; round += 1) {
        this.store.refreshTaskLease({
          taskId,
          owner: leaseOwner,
          ttlMinutes: this.config.TASK_LEASE_MINUTES,
        });

        this.store.updateTaskStatus(taskId, "running");
        prompt = appendSteeringContext(prompt, this.store.consumeSteeringMessages(taskId));
        markWorkflowStep(this.store, taskId, workerStep, "running");
        const result = await this.runWorkerRound({
          taskId,
          role: classified.assignedTo,
          agent,
          prompt,
          round,
        });
        latestResult = result.result;
        latestReportPath = result.reportPath;

        if (!result.result.ok) {
          markWorkflowStep(this.store, taskId, workerStep, "failed", {
            outputRef: latestReportPath,
            error: result.result.error ?? "Worker failed.",
          });
          this.store.updateTaskStatus(taskId, "failed");
          await this.notifier.failed({ taskId, reportPath: latestReportPath, reason: result.result.error });
          return {
            taskId,
            assignedTo: classified.assignedTo,
            obsidianPath,
            reportPath: latestReportPath,
            finalOutput: result.result.output || result.result.error,
          };
        }

        markWorkflowStep(this.store, taskId, workerStep, "completed", { outputRef: latestReportPath });
        markWorkflowStep(this.store, taskId, reviewStep, "running");
        const review = await runDirectorReview({
          taskId,
          originalPrompt: effectiveContent,
          workerRole: classified.assignedTo,
          workerOutput: result.result.output,
          director: this.requireAgent("director"),
          store: this.store,
          vault: this.vault,
          config: this.config,
          round,
        });

        latestReviewPath = review.path;
        latestVerdict = review.verdict;
        markWorkflowStep(this.store, taskId, reviewStep, "completed", { outputRef: review.path });
        this.store.setTaskReviewRound(taskId, round);
        this.store.recordArtifact({
          id: `ART-${taskId}-review-r${round}-${Date.now()}`,
          taskId,
          type: "director_review",
          path: review.path,
          createdBy: "director",
        });
        await notifyReviewResult(this.notifier, { taskId, verdict: review.verdict, reviewPath: review.path, round, output: review.output });

        if (review.verdict === "APPROVED") {
          markPendingWorkflowSteps(this.store, taskId, workflowPlan, "skipped", "Workflow completed before optional steps were needed.");
          this.store.updateTaskStatus(taskId, "approved");
          const approvedPath = await this.writeApprovedSummary({
            taskId,
            role: classified.assignedTo,
            reportPath: latestReportPath,
            reviewPath: latestReviewPath,
            output: result.result.output,
          });
          await this.runApprovedTaskCommand({
            taskId,
            reportPath: latestReportPath,
            reviewPath: latestReviewPath,
            policyEngine,
          });
          await notifyApproved(this.notifier, {
            taskId,
            approvedPath,
            reportPath: latestReportPath,
            reviewPath: latestReviewPath,
            output: result.result.output,
          });
          return {
            taskId,
            assignedTo: classified.assignedTo,
            obsidianPath,
            reportPath: latestReportPath,
            reviewPath: latestReviewPath,
            approvedPath,
            verdict: latestVerdict,
            finalOutput: result.result.output,
          };
        }

        if (review.verdict !== "NEEDS_REVISION") {
          markPendingWorkflowSteps(this.store, taskId, workflowPlan, "skipped", `Stopped after terminal verdict ${review.verdict}.`);
          const status = statusFromVerdict(review.verdict);
          this.store.updateTaskStatus(taskId, status);
          await this.notifier.blocked({
            taskId,
            reviewPath: latestReviewPath,
            reason: `${review.verdict}: ${review.output}`,
          });
          return {
            taskId,
            assignedTo: classified.assignedTo,
            obsidianPath,
            reportPath: latestReportPath,
            reviewPath: latestReviewPath,
            verdict: latestVerdict,
            finalOutput: result.result.output,
          };
        }

        this.store.updateTaskStatus(taskId, "needs_revision");
        prompt = buildRevisionPrompt({
          originalPrompt: effectiveContent,
          previousOutput: result.result.output,
          reviewFeedback: review.output,
          round,
        });
      }

      markPendingWorkflowSteps(this.store, taskId, workflowPlan, "failed", `Exceeded MAX_REVIEW_ROUNDS=${this.config.MAX_REVIEW_ROUNDS}`);
      this.store.updateTaskStatus(taskId, "failed");
      await this.notifier.failed({
        taskId,
        reportPath: latestReportPath,
        reason: `Exceeded MAX_REVIEW_ROUNDS=${this.config.MAX_REVIEW_ROUNDS}`,
      });
      return {
        taskId,
        assignedTo: classified.assignedTo,
        obsidianPath,
        reportPath: latestReportPath,
        reviewPath: latestReviewPath,
        verdict: latestVerdict ?? (latestResult?.ok ? "NEEDS_REVISION" : "BLOCKED"),
        finalOutput: latestResult?.output,
      };
    } finally {
      this.store.releaseTaskLease({ taskId, owner: leaseOwner });
    }
  }

  private async runWorkerRound(input: {
    taskId: string;
    role: AgentRole;
    agent: AgentAdapter;
    prompt: string;
    round: number;
  }): Promise<{ result: AgentRunResult; reportPath: string }> {
    const startedAt = new Date().toISOString();
    const result = await input.agent.run({
      taskId: input.taskId,
      role: input.role,
      prompt: input.prompt,
      workspacePath: this.config.PROJECT_ROOT,
    });

    this.store.recordTaskRun({
      id: `RUN-${input.taskId}-${input.role}-r${input.round}-${Date.now()}`,
      taskId: input.taskId,
      role: input.role,
      model: this.modelNameFor(input.role),
      prompt: input.prompt,
      output: result.output,
      status: result.ok ? "completed" : "failed",
      error: result.error,
      startedAt,
      finishedAt: new Date().toISOString(),
    });

    const reportFolder = reportFolderForRole(input.role);
    const reportPath = `${reportFolder}/${input.taskId}-${input.role}-round-${input.round}.md`;

    await this.vault.writeNote(
      reportPath,
      botReportNote({
        taskId: input.taskId,
        role: input.role,
        status: result.ok ? "ready_for_review" : "failed",
        body: result.output + (result.error ? `\n\n## Error\n\n${result.error}` : ""),
      }),
    );

    this.store.recordArtifact({
      id: `ART-${input.taskId}-${input.role}-r${input.round}-${Date.now()}`,
      taskId: input.taskId,
      type: "agent_report",
      path: reportPath,
      createdBy: input.role,
    });
    for (const artifact of result.artifacts ?? []) {
      this.store.recordArtifact({
        id: `ART-${input.taskId}-${input.role}-file-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        taskId: input.taskId,
        type: input.role === "designer" ? "design_image" : "agent_file",
        path: artifact,
        createdBy: input.role,
      });
    }
    await notifyWorkerReport(this.notifier, {
      taskId: input.taskId,
      role: input.role,
      reportPath,
      round: input.round,
      output: result.output,
    });

    return { result, reportPath };
  }

  private async writeApprovedSummary(input: {
    taskId: string;
    role: AgentRole;
    reportPath: string;
    reviewPath: string;
    output: string;
  }): Promise<string> {
    const approvedPath = `07_Approved/${input.taskId}-approved.md`;
    await this.vault.writeNote(
      approvedPath,
      [
        "---",
        `task_id: ${input.taskId}`,
        `role: ${input.role}`,
        "status: approved",
        `report: ${input.reportPath}`,
        `review: ${input.reviewPath}`,
        `approved_at: ${new Date().toISOString()}`,
        "---",
        "",
        "# Approved Task",
        "",
        `Report: ${input.reportPath}`,
        "",
        `Review: ${input.reviewPath}`,
        "",
        "## Final Output",
        "",
        input.output,
      ].join("\n"),
    );
    this.store.recordArtifact({
      id: `ART-${input.taskId}-approved-${Date.now()}`,
      taskId: input.taskId,
      type: "approved_summary",
      path: approvedPath,
      createdBy: "director",
    });
    return approvedPath;
  }

  private async runApprovedTaskCommand(input: {
    taskId: string;
    reportPath: string;
    reviewPath: string;
    policyEngine: PolicyEngine;
  }): Promise<void> {
    if (!this.config.APPROVED_TASK_COMMAND) return;
    const decision = input.policyEngine.decide("approved_task_command");
    if (decision.status !== "allowed") {
      const path = `07_Approved/${input.taskId}-approved-command-policy.md`;
      await this.vault.writeNote(
        path,
        [
          "---",
          `task_id: ${input.taskId}`,
          `action: ${decision.action}`,
          `policy_status: ${decision.status}`,
          `created_at: ${new Date().toISOString()}`,
          "---",
          "",
          "# Approved Task Command Policy Decision",
          "",
          decision.reason,
        ].join("\n"),
      );
      this.store.recordArtifact({
        id: `ART-${input.taskId}-approved-command-policy-${Date.now()}`,
        taskId: input.taskId,
        type: "policy_decision",
        path,
        createdBy: "director",
      });
      return;
    }

    const commandInput = [
      `TASK_ID=${input.taskId}`,
      `REPORT_PATH=${input.reportPath}`,
      `REVIEW_PATH=${input.reviewPath}`,
    ].join("\n");
    const result = await runShellCommand({
      command: this.config.APPROVED_TASK_COMMAND,
      cwd: this.config.PROJECT_ROOT,
      input: commandInput,
      timeoutMs: this.config.APPROVED_TASK_COMMAND_TIMEOUT_MS,
    });
    const path = `07_Approved/${input.taskId}-approved-command.md`;
    await this.vault.writeNote(
      path,
      [
        "---",
        `task_id: ${input.taskId}`,
        `ok: ${result.ok}`,
        `exit_code: ${result.exitCode ?? "null"}`,
        `created_at: ${new Date().toISOString()}`,
        "---",
        "",
        "# Approved Task Command Result",
        "",
        "## Stdout",
        "```text",
        result.stdout || "",
        "```",
        "",
        "## Stderr",
        "```text",
        result.stderr || "",
        "```",
      ].join("\n"),
    );
    this.store.recordArtifact({
      id: `ART-${input.taskId}-approved-command-${Date.now()}`,
      taskId: input.taskId,
      type: "approved_command",
      path,
      createdBy: "director",
    });
  }

  private requireAgent(role: AgentRole): AgentAdapter {
    const agent = this.agents.get(role);
    if (!agent) throw new Error(`No agent registered for role: ${role}`);
    return agent;
  }

  private modelNameFor(role: AgentRole): string {
    if (role === "factory") return this.config.OLLAMA_MODEL;
    if (role === "builder") return this.config.CODEX_COMMAND;
    if (role === "designer") return this.config.GEMINI_IMAGE_MODEL;
    return this.config.CLAUDE_CODE_COMMAND;
  }
}

function completeSyntheticPlanningSteps(input: {
  store: RuntimeStore;
  taskId: string;
  workflowPlan: WorkflowPlan;
  assignedTo: AgentRole;
  outputRef: string;
}): void {
  if (input.assignedTo === "director") return;
  for (const step of input.workflowPlan.steps.filter((candidate) => candidate.action === "plan")) {
    markWorkflowStep(input.store, input.taskId, step, "running");
    markWorkflowStep(input.store, input.taskId, step, "completed", { outputRef: input.outputRef });
  }
}

function primaryWorkerStepForRole(workflowPlan: WorkflowPlan, role: AgentRole): PlannedWorkflowStep | undefined {
  const actionByRole: Record<AgentRole, string> = {
    director: "plan",
    builder: "implement",
    factory: "generate-content",
    designer: "generate-image",
  };
  return workflowPlan.steps.find((step) => step.action === actionByRole[role]) ?? workflowPlan.steps[0];
}

function markWorkflowStep(
  store: RuntimeStore,
  taskId: string,
  step: PlannedWorkflowStep | undefined,
  status: "running" | "completed" | "skipped" | "failed",
  options: { outputRef?: string; error?: string } = {},
): void {
  if (!step) return;
  store.updateWorkflowStepRun({
    taskId,
    stepId: step.id,
    status,
    outputRef: options.outputRef,
    error: options.error,
  });
}

function markPendingWorkflowSteps(
  store: RuntimeStore,
  taskId: string,
  workflowPlan: WorkflowPlan,
  status: "skipped" | "failed",
  error: string,
): void {
  const pendingStepIds = new Set(
    store.listWorkflowStepRuns(taskId)
      .filter((step) => step.status === "pending" || step.status === "running")
      .map((step) => step.stepId),
  );

  for (const step of workflowPlan.steps.filter((candidate) => pendingStepIds.has(candidate.id))) {
    store.updateWorkflowStepRun({
      taskId,
      stepId: step.id,
      status: step.required ? status : "skipped",
      error,
    });
  }
}

function reportFolderForRole(role: AgentRole): string {
  if (role === "builder") return "05_BuilderReports";
  if (role === "factory") return "06_FactoryOutputs";
  if (role === "designer") return "06_DesignerOutputs";
  return "04_Reviews";
}

function buildRevisionPrompt(input: {
  originalPrompt: string;
  previousOutput: string;
  reviewFeedback: string;
  round: number;
}): string {
  return [
    input.originalPrompt,
    "",
    `# Revision Request Round ${input.round + 1}`,
    "",
    "The Director returned NEEDS_REVISION. Revise the result using the feedback below.",
    "",
    "## Previous Output",
    input.previousOutput,
    "",
    "## Director Feedback",
    input.reviewFeedback,
  ].join("\n");
}

function appendSteeringContext(
  prompt: string,
  messages: Array<{ content: string; createdAt: string }>,
): string {
  if (messages.length === 0) return prompt;
  return [
    prompt,
    "",
    "# Mid-turn Steering",
    "",
    "Apply these user instructions before continuing the next worker round.",
    "",
    ...messages.map((message) => `- ${message.createdAt}: ${message.content}`),
  ].join("\n");
}

type WorkerReportTurnInput = Parameters<RuntimeNotifier["workerReport"]>[0] & { output?: string };
type ReviewTurnInput = Parameters<RuntimeNotifier["reviewResult"]>[0] & { output?: string };
type ApprovedTurnInput = Parameters<RuntimeNotifier["approved"]>[0] & { output?: string };

async function notifyWorkerReport(notifier: RuntimeNotifier, input: WorkerReportTurnInput): Promise<void> {
  await notifier.workerReport(input);
}

async function notifyReviewResult(notifier: RuntimeNotifier, input: ReviewTurnInput): Promise<void> {
  await notifier.reviewResult(input);
}

async function notifyApproved(notifier: RuntimeNotifier, input: ApprovedTurnInput): Promise<void> {
  await notifier.approved(input);
}
