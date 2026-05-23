import { mkdir } from "node:fs/promises";
import path from "node:path";
import { Database } from "bun:sqlite";
import { runtimeSchemaSql } from "./schema";
import type { AgentRole, RuntimeTask, TaskStatus, TaskType } from "../runtime/types";

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
