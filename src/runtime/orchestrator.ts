import type { RuntimeConfig } from "../config";
import { RuntimeStore } from "../db/runtime-store";
import { botReportNote, taskNote } from "../obsidian/templates";
import { VaultManager } from "../obsidian/vault-manager";
import { runDirectorReview, statusFromVerdict } from "../review/review-loop";
import { classifyTask } from "../router/classify";
import type { AgentAdapter, AgentRole, AgentRunResult, ReviewVerdict } from "./types";

export class Orchestrator {
  private readonly agents = new Map<AgentRole, AgentAdapter>();

  constructor(
    private readonly store: RuntimeStore,
    private readonly vault: VaultManager,
    private readonly config: RuntimeConfig,
  ) {}

  registerAgent(agent: AgentAdapter): void {
    this.agents.set(agent.role, agent);
  }

  async initialize(): Promise<void> {
    await this.vault.ensureDefaultFolders();
  }

  async handleUserRequest(input: {
    content: string;
    discordMessageId?: string;
    discordChannelId?: string;
  }): Promise<{
    taskId: string;
    assignedTo: AgentRole;
    obsidianPath: string;
    reportPath: string;
    reviewPath?: string;
    verdict?: ReviewVerdict;
  }> {
    const classified = classifyTask(input.content);
    const taskId = `TASK-${Date.now()}`;
    const title = input.content.slice(0, 60).replace(/\s+/g, " ") || "Untitled task";
    const obsidianPath = `01_Tasks/${taskId}.md`;
    const leaseOwner = `orchestrator:${classified.assignedTo}`;

    this.store.createTask({
      id: taskId,
      title,
      type: classified.type,
      assignedTo: classified.assignedTo,
      obsidianPath,
    });

    const leaseAcquired = this.store.acquireTaskLease({
      taskId,
      owner: leaseOwner,
      ttlMinutes: this.config.TASK_LEASE_MINUTES,
    });

    if (!leaseAcquired) {
      this.store.updateTaskStatus(taskId, "blocked");
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
          request: input.content,
          discordMessageId: input.discordMessageId,
          discordChannelId: input.discordChannelId,
        }),
      );

      const agent = this.requireAgent(classified.assignedTo);
      let prompt = input.content;
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
          this.store.updateTaskStatus(taskId, "failed");
          return {
            taskId,
            assignedTo: classified.assignedTo,
            obsidianPath,
            reportPath: latestReportPath,
          };
        }

        const review = await runDirectorReview({
          taskId,
          originalPrompt: input.content,
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
        this.store.setTaskReviewRound(taskId, round);
        this.store.recordArtifact({
          id: `ART-${taskId}-review-r${round}-${Date.now()}`,
          taskId,
          type: "director_review",
          path: review.path,
          createdBy: "director",
        });

        if (review.verdict === "APPROVED") {
          this.store.updateTaskStatus(taskId, "approved");
          return {
            taskId,
            assignedTo: classified.assignedTo,
            obsidianPath,
            reportPath: latestReportPath,
            reviewPath: latestReviewPath,
            verdict: latestVerdict,
          };
        }

        if (review.verdict === "BLOCKED") {
          this.store.updateTaskStatus(taskId, "blocked");
          return {
            taskId,
            assignedTo: classified.assignedTo,
            obsidianPath,
            reportPath: latestReportPath,
            reviewPath: latestReviewPath,
            verdict: latestVerdict,
          };
        }

        this.store.updateTaskStatus(taskId, "needs_revision");
        prompt = buildRevisionPrompt({
          originalPrompt: input.content,
          previousOutput: result.result.output,
          reviewFeedback: review.output,
          round,
        });
      }

      this.store.updateTaskStatus(taskId, "failed");
      return {
        taskId,
        assignedTo: classified.assignedTo,
        obsidianPath,
        reportPath: latestReportPath,
        reviewPath: latestReviewPath,
        verdict: latestVerdict ?? (latestResult?.ok ? "NEEDS_REVISION" : "BLOCKED"),
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

    const reportFolder = input.role === "builder" ? "05_BuilderReports" : input.role === "factory" ? "06_FactoryOutputs" : "04_Reviews";
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

    return { result, reportPath };
  }

  private requireAgent(role: AgentRole): AgentAdapter {
    const agent = this.agents.get(role);
    if (!agent) throw new Error(`No agent registered for role: ${role}`);
    return agent;
  }

  private modelNameFor(role: AgentRole): string {
    if (role === "factory") return this.config.OLLAMA_MODEL;
    if (role === "builder") return this.config.CODEX_COMMAND;
    return this.config.CLAUDE_CODE_COMMAND;
  }
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
