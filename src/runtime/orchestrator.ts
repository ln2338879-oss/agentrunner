import { classifyTask } from "../router/classify";
import { RuntimeStore } from "../db/runtime-store";
import { VaultManager } from "../obsidian/vault-manager";
import { botReportNote, taskNote } from "../obsidian/templates";
import type { AgentAdapter, AgentRole } from "./types";

export class Orchestrator {
  private readonly agents = new Map<AgentRole, AgentAdapter>();

  constructor(
    private readonly store: RuntimeStore,
    private readonly vault: VaultManager,
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
  }): Promise<{ taskId: string; assignedTo: AgentRole; obsidianPath: string; reportPath: string }> {
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

    const agent = this.agents.get(classified.assignedTo);
    if (!agent) {
      this.store.updateTaskStatus(taskId, "blocked");
      throw new Error(`No agent registered for role: ${classified.assignedTo}`);
    }

    this.store.updateTaskStatus(taskId, "running");
    const result = await agent.run({
      taskId,
      role: classified.assignedTo,
      prompt: input.content,
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

    this.store.updateTaskStatus(taskId, result.ok ? "needs_revision" : "failed");

    return {
      taskId,
      assignedTo: classified.assignedTo,
      obsidianPath,
      reportPath,
    };
  }
}
