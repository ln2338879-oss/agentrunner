import type { RuntimeConfig } from "../config";
import { appendBrowserContext } from "../browser/adapter";
import { RuntimeStore } from "../db/runtime-store";
import type { RuntimeNotifier } from "../discord/notifier";
import { NullNotifier } from "../discord/notifier";
import type { GroupConfigManager } from "../groups/group-config";
import { taskNote } from "../obsidian/templates";
import { VaultManager } from "../obsidian/vault-manager";
import { createPolicyEngine, type PolicyEngine } from "../policies/engine";
import { RoleRegistry } from "../roles/registry";
import { classifyTask } from "../router/classify";
import { planWorkflowForTask } from "../router/workflow-routing";
import { loadSkillContext } from "../skills/context";
import { runShellCommand } from "../utils/command";
import { appendVisionAnalysis } from "../vision/adapter";
import { WorkflowRegistry } from "../workflows/engine";
import { StepScheduler, type StepSchedulerCycleResult } from "../workflows/step-scheduler";
import type { WorkflowPlan } from "../workflows/types";
import { runStartupRecovery } from "./startup-recovery";
import type { AgentAdapter, AgentRole, ReviewVerdict } from "./types";

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

    const recovery = await runStartupRecovery({
      store: this.store,
      vault: this.vault,
      config: this.config,
      owner: `orchestrator:${process.pid}`,
    });
    if (recovery.reportPath) {
      await this.notifier.recovery({ count: recovery.recovered.length, path: recovery.reportPath });
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
      await this.notifier.taskCreated({
        taskId,
        role: classified.assignedTo,
        obsidianPath,
        content: input.content,
      });

      const workflowResult = await this.runInlineWorkflow({
        taskId,
        workflowPlan,
        assignedTo: classified.assignedTo,
        leaseOwner,
      });
      return await this.buildHandleResult({
        taskId,
        assignedTo: classified.assignedTo,
        obsidianPath,
        workflowResult,
        policyEngine,
      });
    } finally {
      this.store.releaseTaskLease({ taskId, owner: leaseOwner });
    }
  }

  private async runInlineWorkflow(input: {
    taskId: string;
    workflowPlan: WorkflowPlan;
    assignedTo: AgentRole;
    leaseOwner: string;
  }): Promise<InlineWorkflowSummary> {
    const scheduler = new StepScheduler({
      store: this.store,
      vault: this.vault,
      config: this.config,
      agents: [...this.agents.values()],
      ownerPrefix: input.leaseOwner,
      maxStepsPerCycle: Math.max(input.workflowPlan.steps.length + this.config.MAX_REVIEW_ROUNDS, 1),
      notifier: this.notifier,
    });
    const cycle = await scheduler.runCycle();

    for (const _result of cycle.results) {
      this.store.refreshTaskLease({
        taskId: input.taskId,
        owner: input.leaseOwner,
        ttlMinutes: this.config.TASK_LEASE_MINUTES,
      });
    }

    return summarizeInlineWorkflow(input.assignedTo, cycle);
  }

  private async buildHandleResult(input: {
    taskId: string;
    assignedTo: AgentRole;
    obsidianPath: string;
    workflowResult: InlineWorkflowSummary;
    policyEngine: PolicyEngine;
  }): Promise<OrchestratorResult> {
    const latestReportPath = input.workflowResult.reportPath ?? input.obsidianPath;
    const latestReviewPath = input.workflowResult.reviewPath;
    const latestVerdict = input.workflowResult.verdict;
    const latestOutput = input.workflowResult.output;
    const task = this.store.getTask(input.taskId);

    if (task?.status === "approved" && latestVerdict === "APPROVED") {
      const approvedPath = await this.writeApprovedSummary({
        taskId: input.taskId,
        role: input.assignedTo,
        reportPath: latestReportPath,
        reviewPath: latestReviewPath ?? latestReportPath,
        output: latestOutput ?? "",
      });
      await this.runApprovedTaskCommand({
        taskId: input.taskId,
        reportPath: latestReportPath,
        reviewPath: latestReviewPath ?? latestReportPath,
        policyEngine: input.policyEngine,
      });
      await this.notifier.approved({
        taskId: input.taskId,
        approvedPath,
        reportPath: latestReportPath,
        reviewPath: latestReviewPath ?? latestReportPath,
      });
      return {
        taskId: input.taskId,
        assignedTo: input.assignedTo,
        obsidianPath: input.obsidianPath,
        reportPath: latestReportPath,
        reviewPath: latestReviewPath,
        approvedPath,
        verdict: latestVerdict,
        finalOutput: latestOutput,
      };
    }

    if (task?.status === "failed") {
      await this.notifier.failed({
        taskId: input.taskId,
        reportPath: latestReportPath,
        reason: input.workflowResult.error,
      });
    } else if (!latestVerdict && input.workflowResult.processed === 0) {
      this.store.updateTaskStatus(input.taskId, "blocked");
      await this.notifier.blocked({ taskId: input.taskId, reason: "No workflow step could be executed." });
    }

    return {
      taskId: input.taskId,
      assignedTo: input.assignedTo,
      obsidianPath: input.obsidianPath,
      reportPath: latestReportPath,
      reviewPath: latestReviewPath,
      verdict: latestVerdict,
      finalOutput: input.workflowResult.error ?? latestOutput,
    };
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
    const decision = input.policyEngine.decideCommand(this.config.APPROVED_TASK_COMMAND, {
      baseAction: "approved_task_command",
    });
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
}

interface InlineWorkflowSummary {
  processed: number;
  reportPath?: string;
  reviewPath?: string;
  verdict?: ReviewVerdict;
  output?: string;
  error?: string;
}

function summarizeInlineWorkflow(assignedTo: AgentRole, cycle: StepSchedulerCycleResult): InlineWorkflowSummary {
  const reviewResult = [...cycle.results].reverse().find((result) => result.verdict);
  const workerResult =
    [...cycle.results].reverse().find((result) => result.role === assignedTo && !result.verdict) ??
    [...cycle.results].reverse().find((result) => !result.verdict);
  const failedResult = [...cycle.results].reverse().find((result) => result.status === "failed" || result.status === "needs_human");

  return {
    processed: cycle.processed,
    reportPath: workerResult?.reportPath ?? reviewResult?.reportPath,
    reviewPath: reviewResult?.reportPath,
    verdict: reviewResult?.verdict,
    output: workerResult?.output ?? reviewResult?.output,
    error: failedResult?.error,
  };
}
