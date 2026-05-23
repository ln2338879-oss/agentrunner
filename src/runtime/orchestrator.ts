import type { RuntimeConfig } from "../config";
import { RuntimeStore } from "../db/runtime-store";
import { botReportNote, taskNote } from "../obsidian/templates";
import { VaultManager } from "../obsidian/vault-manager";
import { runDirectorReview, statusFromVerdict } from "../review/review-loop";
import { classifyTask } from "../router/classify";
import type { AgentAdapter, AgentRole, ReviewVerdict } from "./types";

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

    this.store.createTask({
      id: taskId,
      title,
      type: classified.type,
      assignedTo: classified.assignedTo,
      obsidianPath,
    });

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
    this.store.updateTaskStatus(taskId, "running");

    const startedAt = new Date().toISOString();
    const result = await agent.run({
      taskId,
      role: classified.assignedTo,
      prompt: input.content,
      workspacePath: this.config.PROJECT_ROOT,
    });

    this.store.recordTaskRun({
      id: `RUN-${taskId}-${classified.assignedTo}-${Date.now()}`,
      taskId,
      role: classified.assignedTo,
      model: this.modelNameFor(classified.assignedTo),
      prompt: input.content,
      output: result.output,
      status: result.ok ? "completed" : "failed",
      error: result.error,
      startedAt,
      finishedAt: new Date().toISOString(),
    });

    const reportFolder = classified.assignedTo === "builder" ? "05_BuilderReports" : classified.assignedTo === "factory" ? "06_FactoryOutputs" : "04_Reviews";
    const reportPath = `${reportFolder}/${taskId}-${classified.assignedTo}.md`;

    await this.vault.writeNote(
      reportPath,
      botReportNote({
        taskId,
        role: classified.assignedTo,
        status: result.ok ? "ready_for_review" : "failed",
        body: result.output + (result.error ? `\n\n## Error\n\n${result.error}` : ""),
      }),
    );

    this.store.recordArtifact({
      id: `ART-${taskId}-${classified.assignedTo}-${Date.now()}`,
      taskId,
      type: "agent_report",
      path: reportPath,
      createdBy: classified.assignedTo,
    });

    if (!result.ok) {
      this.store.updateTaskStatus(taskId, "failed");
      return { taskId, assignedTo: classified.assignedTo, obsidianPath, reportPath };
    }

    const review = await runDirectorReview({
      taskId,
      originalPrompt: input.content,
      workerRole: classified.assignedTo,
      workerOutput: result.output,
      director: this.requireAgent("director"),
      store: this.store,
      vault: this.vault,
      config: this.config,
    });

    this.store.setTaskReviewRound(taskId, 1);
    this.store.recordArtifact({
      id: `ART-${taskId}-review-${Date.now()}`,
      taskId,
      type: "director_review",
      path: review.path,
      createdBy: "director",
    });
    this.store.updateTaskStatus(taskId, statusFromVerdict(review.verdict));

    return {
      taskId,
      assignedTo: classified.assignedTo,
      obsidianPath,
      reportPath,
      reviewPath: review.path,
      verdict: review.verdict,
    };
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
