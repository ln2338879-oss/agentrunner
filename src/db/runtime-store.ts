import { mkdir } from "node:fs/promises";
import path from "node:path";
import { Database } from "bun:sqlite";
import { runtimeSchemaSql } from "./schema";
import type { AgentRole, ReviewVerdict, RuntimeTask, TaskStatus, TaskType } from "../runtime/types";

export interface TaskSummaryRow {
  id: string;
  title: string;
  type: string;
  status: string;
  assignedTo: string;
  currentRound: number;
  obsidianPath: string;
  lockedBy: string | null;
  lockExpiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ArtifactRow {
  type: string;
  path: string;
  createdBy: string;
  createdAt: string;
}

export interface ReviewRow {
  verdict: string;
  round: number;
  feedback: string;
  createdAt: string;
}

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

  getTask(id: string): TaskSummaryRow | null {
    return this.db.query(`
      SELECT
        id,
        title,
        type,
        status,
        assigned_to as assignedTo,
        current_round as currentRound,
        obsidian_path as obsidianPath,
        locked_by as lockedBy,
        lock_expires_at as lockExpiresAt,
        created_at as createdAt,
        updated_at as updatedAt
      FROM tasks
      WHERE id = $id
    `).get({ $id: id }) as TaskSummaryRow | null;
  }

  listRecentTasks(limit = 10): TaskSummaryRow[] {
    return this.db.query(`
      SELECT
        id,
        title,
        type,
        status,
        assigned_to as assignedTo,
        current_round as currentRound,
        obsidian_path as obsidianPath,
        locked_by as lockedBy,
        lock_expires_at as lockExpiresAt,
        created_at as createdAt,
        updated_at as updatedAt
      FROM tasks
      ORDER BY created_at DESC
      LIMIT $limit
    `).all({ $limit: limit }) as TaskSummaryRow[];
  }

  listTaskArtifacts(taskId: string): ArtifactRow[] {
    return this.db.query(`
      SELECT type, path, created_by as createdBy, created_at as createdAt
      FROM artifacts
      WHERE task_id = $taskId
      ORDER BY created_at ASC
    `).all({ $taskId: taskId }) as ArtifactRow[];
  }

  listTaskReviews(taskId: string): ReviewRow[] {
    return this.db.query(`
      SELECT verdict, round, feedback, created_at as createdAt
      FROM reviews
      WHERE task_id = $taskId
      ORDER BY round ASC, created_at ASC
    `).all({ $taskId: taskId }) as ReviewRow[];
  }

  acquireTaskLease(input: { taskId: string; owner: string; ttlMinutes: number }): boolean {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + input.ttlMinutes * 60_000).toISOString();
    const nowIso = now.toISOString();

    const result = this.db.query(`
      UPDATE tasks
      SET locked_by = $owner, lock_expires_at = $expiresAt, updated_at = $nowIso
      WHERE id = $taskId
        AND (locked_by IS NULL OR lock_expires_at IS NULL OR lock_expires_at <= $nowIso OR locked_by = $owner)
    `).run({
      $taskId: input.taskId,
      $owner: input.owner,
      $expiresAt: expiresAt,
      $nowIso: nowIso,
    });

    return result.changes > 0;
  }

  refreshTaskLease(input: { taskId: string; owner: string; ttlMinutes: number }): void {
    const expiresAt = new Date(Date.now() + input.ttlMinutes * 60_000).toISOString();
    this.db.query(`
      UPDATE tasks
      SET lock_expires_at = $expiresAt, updated_at = $updatedAt
      WHERE id = $taskId AND locked_by = $owner
    `).run({
      $taskId: input.taskId,
      $owner: input.owner,
      $expiresAt: expiresAt,
      $updatedAt: new Date().toISOString(),
    });
  }

  releaseTaskLease(input: { taskId: string; owner: string }): void {
    this.db.query(`
      UPDATE tasks
      SET locked_by = NULL, lock_expires_at = NULL, updated_at = $updatedAt
      WHERE id = $taskId AND locked_by = $owner
    `).run({
      $taskId: input.taskId,
      $owner: input.owner,
      $updatedAt: new Date().toISOString(),
    });
  }

  recoverStaleTasks(input: { staleMinutes: number }): Array<{ id: string; status: string; lockedBy: string | null }> {
    const staleBefore = new Date(Date.now() - input.staleMinutes * 60_000).toISOString();
    const rows = this.db.query(`
      SELECT id, status, locked_by as lockedBy
      FROM tasks
      WHERE status IN ('running', 'needs_revision')
        AND (lock_expires_at IS NULL OR lock_expires_at <= $staleBefore OR updated_at <= $staleBefore)
    `).all({ $staleBefore: staleBefore }) as Array<{ id: string; status: string; lockedBy: string | null }>;

    this.db.query(`
      UPDATE tasks
      SET status = 'blocked', locked_by = NULL, lock_expires_at = NULL, updated_at = $updatedAt
      WHERE status IN ('running', 'needs_revision')
        AND (lock_expires_at IS NULL OR lock_expires_at <= $staleBefore OR updated_at <= $staleBefore)
    `).run({
      $staleBefore: staleBefore,
      $updatedAt: new Date().toISOString(),
    });

    return rows;
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
