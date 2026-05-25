import type { RuntimeConfig } from "../config";
import type { RuntimeStore } from "../db/runtime-store";
import { botReportNote } from "../obsidian/templates";
import type { VaultManager } from "../obsidian/vault-manager";
import type { AgentAdapter, AgentRole } from "../runtime/types";

export interface WorkerPollerOptions {
  role: AgentRole;
  owner: string;
  store: RuntimeStore;
  vault: VaultManager;
  agent: AgentAdapter;
  config: RuntimeConfig;
}

export interface WorkerPollResult {
  claimed: boolean;
  taskId?: string;
  status?: "completed" | "failed";
  reportPath?: string;
  error?: string;
}

export class WorkerPoller {
  constructor(private readonly options: WorkerPollerOptions) {}

  async pollOnce(): Promise<WorkerPollResult> {
    const task = this.options.store.claimPendingTask({
      role: this.options.role,
      owner: this.options.owner,
      ttlMinutes: this.options.config.TASK_LEASE_MINUTES,
    });

    if (!task) return { claimed: false };

    const startedAt = new Date().toISOString();
    const prompt = this.options.store.getTaskPrompt(task.id);

    try {
      const result = await this.options.agent.run({
        taskId: task.id,
        role: this.options.role,
        prompt,
        workspacePath: this.options.config.PROJECT_ROOT,
      });

      const status = result.ok ? "completed" : "failed";
      const reportPath = workerReportPath(task.id, this.options.role);

      this.options.store.recordTaskRun({
        id: `RUN-${task.id}-${this.options.role}-${Date.now()}`,
        taskId: task.id,
        role: this.options.role,
        model: modelNameFor(this.options.role, this.options.config),
        prompt,
        output: result.output,
        status,
        error: result.error,
        startedAt,
        finishedAt: new Date().toISOString(),
      });

      await this.options.vault.writeNote(
        reportPath,
        botReportNote({
          taskId: task.id,
          role: this.options.role,
          status,
          body: result.output + (result.error ? `\n\n## Error\n\n${result.error}` : ""),
        }),
      );

      this.options.store.recordArtifact({
        id: `ART-${task.id}-${this.options.role}-${Date.now()}`,
        taskId: task.id,
        type: "worker_report",
        path: reportPath,
        createdBy: this.options.role,
      });

      this.options.store.updateTaskStatus(task.id, status);
      this.options.store.releaseTaskLease({ taskId: task.id, owner: this.options.owner });

      return {
        claimed: true,
        taskId: task.id,
        status,
        reportPath,
        error: result.error,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.options.store.recordTaskRun({
        id: `RUN-${task.id}-${this.options.role}-${Date.now()}`,
        taskId: task.id,
        role: this.options.role,
        model: modelNameFor(this.options.role, this.options.config),
        prompt,
        output: "",
        status: "failed",
        error: message,
        startedAt,
        finishedAt: new Date().toISOString(),
      });
      this.options.store.updateTaskStatus(task.id, "failed");
      this.options.store.releaseTaskLease({ taskId: task.id, owner: this.options.owner });

      return {
        claimed: true,
        taskId: task.id,
        status: "failed",
        error: message,
      };
    }
  }
}

function workerReportPath(taskId: string, role: AgentRole): string {
  if (role === "builder") return `05_BuilderReports/${taskId}-builder-worker.md`;
  if (role === "factory") return `06_FactoryOutputs/${taskId}-factory-worker.md`;
  return `04_Reviews/${taskId}-director-worker.md`;
}

function modelNameFor(role: AgentRole, config: RuntimeConfig): string {
  if (role === "factory") return config.OLLAMA_MODEL;
  if (role === "builder") return config.CODEX_COMMAND;
  return config.CLAUDE_CODE_COMMAND;
}
