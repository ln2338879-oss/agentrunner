import { mkdir } from "node:fs/promises";
import path from "node:path";
import { Database } from "bun:sqlite";
import { runtimeSchemaSql } from "./schema";
import type { AgentRole, ReviewVerdict, RuntimeTask, TaskStatus, TaskType } from "../runtime/types";

export class RuntimeStore {
  private readonly db: Database;

  constructor(private readonly databasePath: string) {
    this.db = new Database(databasePath);
  }

  static async open(databasePath: string): Promise<RuntimeStore> {
    await mkdir(path.dirname(databasePath), { recursive: true });
    const store = new RuntimeStore(databasePath);
    store.migrate();
    return store;
  }

  migrate(): void {
    this.db.exec(runtimeSchemaSql);
  }

  createTask(input: {
    id: string;
    title: string;
    type: TaskType;
    assignedTo: AgentRole;
    obsidianPath: string;
  }): RuntimeTask {
    const now = new Date().toISOString();
    this.db.query(`
      INSERT INTO tasks (id, title, type, status, assigned_to, obsidian_path, current_round, created_at, updated_at)
      VALUES ($id, $title, $type, 'pending', $assignedTo, $obsidianPath, 0, $now, $now)
    `).run({
      $id: input.id,
      $title: input.title,
      $type: input.type,
      $assignedTo: input.assignedTo,
      $obsidianPath: input.obsidianPath,
      $now: now,
    });

    return {
      id: input.id,
      title: input.title,
      type: input.type,
      status: "pending",
      assignedTo: input.assignedTo,
      obsidianPath: input.obsidianPath,
      currentRound: 0,
      createdAt: now,
      updatedAt: now,
    };
  }

  updateTaskStatus(id: string, status: TaskStatus): void {
    this.db.query(`
      UPDATE tasks SET status = $status, updated_at = $updatedAt WHERE id = $id
    `).run({ $id: id, $status: status, $updatedAt: new Date().toISOString() });
  }

  setTaskReviewRound(id: string, round: number): void {
    this.db.query(`
      UPDATE tasks SET current_round = $round, updated_at = $updatedAt WHERE id = $id
    `).run({ $id: id, $round: round, $updatedAt: new Date().toISOString() });
  }

  recordTaskRun(input: {
    id: string;
    taskId: string;
    role: AgentRole;
    model?: string;
    prompt: string;
    output?: string;
    status: "running" | "completed" | "failed";
    error?: string;
    startedAt: string;
    finishedAt?: string;
  }): void {
    this.db.query(`
      INSERT INTO task_runs (id, task_id, role, model, prompt, output, status, error, started_at, finished_at)
      VALUES ($id, $taskId, $role, $model, $prompt, $output, $status, $error, $startedAt, $finishedAt)
    `).run({
      $id: input.id,
      $taskId: input.taskId,
      $role: input.role,
      $model: input.model ?? null,
      $prompt: input.prompt,
      $output: input.output ?? null,
      $status: input.status,
      $error: input.error ?? null,
      $startedAt: input.startedAt,
      $finishedAt: input.finishedAt ?? null,
    });
  }

  recordArtifact(input: {
    id: string;
    taskId: string;
    type: string;
    path: string;
    createdBy: AgentRole;
  }): void {
    this.db.query(`
      INSERT INTO artifacts (id, task_id, type, path, created_by, created_at)
      VALUES ($id, $taskId, $type, $path, $createdBy, $createdAt)
    `).run({
      $id: input.id,
      $taskId: input.taskId,
      $type: input.type,
      $path: input.path,
      $createdBy: input.createdBy,
      $createdAt: new Date().toISOString(),
    });
  }

  recordReview(input: {
    id: string;
    taskId: string;
    verdict: ReviewVerdict;
    round: number;
    feedback: string;
  }): void {
    this.db.query(`
      INSERT INTO reviews (id, task_id, verdict, round, feedback, created_at)
      VALUES ($id, $taskId, $verdict, $round, $feedback, $createdAt)
    `).run({
      $id: input.id,
      $taskId: input.taskId,
      $verdict: input.verdict,
      $round: input.round,
      $feedback: input.feedback,
      $createdAt: new Date().toISOString(),
    });
  }

  recordMessage(input: {
    id: string;
    discordMessageId: string;
    discordChannelId: string;
    taskId?: string;
    senderRole?: AgentRole;
    content: string;
  }): void {
    this.db.query(`
      INSERT INTO messages (id, discord_message_id, discord_channel_id, task_id, sender_role, content, created_at)
      VALUES ($id, $discordMessageId, $discordChannelId, $taskId, $senderRole, $content, $createdAt)
    `).run({
      $id: input.id,
      $discordMessageId: input.discordMessageId,
      $discordChannelId: input.discordChannelId,
      $taskId: input.taskId ?? null,
      $senderRole: input.senderRole ?? null,
      $content: input.content,
      $createdAt: new Date().toISOString(),
    });
  }
}
