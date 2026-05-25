import { mkdir } from "node:fs/promises";
import path from "node:path";
import { Database } from "bun:sqlite";
import { runtimeSchemaSql } from "./schema";
import { extendedRuntimeSchemaSql } from "./extended-schema";
import type { AgentRole, ReviewVerdict, RuntimeTask, TaskStatus, TaskType } from "../runtime/types";
import type { WorkflowPlan } from "../workflows/types";

export interface TaskSummaryRow {
  id: string;
  title: string;
  type: string;
  status: string;
  assignedTo: string;
  currentRound: number;
  obsidianPath: string;
  workflowId: string | null;
  workflowPlanJson: string | null;
  sessionId: string | null;
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

export interface SessionRow {
  id: string;
  discordChannelId: string;
  title: string;
  status: string;
  groupId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SteeringMessageRow {
  id: string;
  taskId: string;
  discordMessageId: string;
  content: string;
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
    this.db.exec(extendedRuntimeSchemaSql);
    this.ensureColumn("tasks", "session_id", "TEXT");
    this.ensureColumn("tasks", "group_id", "TEXT");
    this.ensureColumn("tasks", "workflow_id", "TEXT");
    this.ensureColumn("tasks", "workflow_plan_json", "TEXT");
    this.ensureColumn("messages", "session_id", "TEXT");
    this.ensureColumn("attachments", "local_path", "TEXT");
    this.ensureColumn("attachments", "kind", "TEXT");
  }

  createTask(input: {
    id: string;
    title: string;
    type: TaskType;
    assignedTo: AgentRole;
    obsidianPath: string;
    sessionId?: string;
    groupId?: string;
    workflowPlan?: WorkflowPlan;
  }): RuntimeTask {
    const now = new Date().toISOString();
    this.db.query(`
      INSERT INTO tasks (id, title, type, status, assigned_to, obsidian_path, current_round, session_id, group_id, workflow_id, workflow_plan_json, created_at, updated_at)
      VALUES ($id, $title, $type, 'pending', $assignedTo, $obsidianPath, 0, $sessionId, $groupId, $workflowId, $workflowPlanJson, $now, $now)
    `).run({
      $id: input.id,
      $title: input.title,
      $type: input.type,
      $assignedTo: input.assignedTo,
      $obsidianPath: input.obsidianPath,
      $sessionId: input.sessionId ?? null,
      $groupId: input.groupId ?? null,
      $workflowId: input.workflowPlan?.workflowId ?? null,
      $workflowPlanJson: input.workflowPlan ? JSON.stringify(input.workflowPlan) : null,
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
        workflow_id as workflowId,
        workflow_plan_json as workflowPlanJson,
        session_id as sessionId,
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
        workflow_id as workflowId,
        workflow_plan_json as workflowPlanJson,
        session_id as sessionId,
        locked_by as lockedBy,
        lock_expires_at as lockExpiresAt,
        created_at as createdAt,
        updated_at as updatedAt
      FROM tasks
      ORDER BY created_at DESC
      LIMIT $limit
    `).all({ $limit: limit }) as TaskSummaryRow[];
  }

  claimPendingTask(input: {
    role: AgentRole;
    owner: string;
    ttlMinutes: number;
  }): TaskSummaryRow | null {
    const now = new Date();
    const nowIso = now.toISOString();
    const expiresAt = new Date(now.getTime() + input.ttlMinutes * 60_000).toISOString();

    const candidate = this.db.query(`
      SELECT id
      FROM tasks
      WHERE status = 'pending'
        AND assigned_to = $role
        AND (locked_by IS NULL OR lock_expires_at IS NULL OR lock_expires_at <= $nowIso)
      ORDER BY created_at ASC
      LIMIT 1
    `).get({
      $role: input.role,
      $nowIso: nowIso,
    }) as { id: string } | null;

    if (!candidate) return null;

    const result = this.db.query(`
      UPDATE tasks
      SET status = 'running', locked_by = $owner, lock_expires_at = $expiresAt, updated_at = $nowIso
      WHERE id = $taskId
        AND status = 'pending'
        AND assigned_to = $role
        AND (locked_by IS NULL OR lock_expires_at IS NULL OR lock_expires_at <= $nowIso)
    `).run({
      $taskId: candidate.id,
      $role: input.role,
      $owner: input.owner,
      $expiresAt: expiresAt,
      $nowIso: nowIso,
    });

    if (result.changes === 0) return null;
    return this.getTask(candidate.id);
  }

  getTaskPrompt(taskId: string): string {
    const message = this.db.query(`
      SELECT content
      FROM messages
      WHERE task_id = $taskId
      ORDER BY created_at ASC
      LIMIT 1
    `).get({ $taskId: taskId }) as { content: string } | null;

    if (message?.content) return message.content;
    return this.getTask(taskId)?.title ?? "";
  }

  getOrCreateSession(input: {
    discordChannelId: string;
    title: string;
    groupId?: string;
  }): SessionRow {
    const existing = this.db.query(`
      SELECT
        id,
        discord_channel_id as discordChannelId,
        title,
        status,
        group_id as groupId,
        created_at as createdAt,
        updated_at as updatedAt
      FROM sessions
      WHERE discord_channel_id = $discordChannelId AND status = 'open'
      ORDER BY updated_at DESC
      LIMIT 1
    `).get({ $discordChannelId: input.discordChannelId }) as SessionRow | null;

    if (existing) return existing;

    const now = new Date().toISOString();
    const id = `SESSION-${Date.now()}`;
    this.db.query(`
      INSERT INTO sessions (id, discord_channel_id, title, status, group_id, created_at, updated_at)
      VALUES ($id, $discordChannelId, $title, 'open', $groupId, $now, $now)
    `).run({
      $id: id,
      $discordChannelId: input.discordChannelId,
      $title: input.title,
      $groupId: input.groupId ?? null,
      $now: now,
    });

    return {
      id,
      discordChannelId: input.discordChannelId,
      title: input.title,
      status: "open",
      groupId: input.groupId ?? null,
      createdAt: now,
      updatedAt: now,
    };
  }

  listRecentSessionMessages(sessionId: string, limit = 8): Array<{ content: string; senderRole: string | null; createdAt: string }> {
    return this.db.query(`
      SELECT content, sender_role as senderRole, created_at as createdAt
      FROM messages
      WHERE session_id = $sessionId
      ORDER BY created_at DESC
      LIMIT $limit
    `).all({ $sessionId: sessionId, $limit: limit }) as Array<{ content: string; senderRole: string | null; createdAt: string }>;
  }

  recordSteeringMessage(input: {
    id: string;
    taskId: string;
    discordMessageId: string;
    content: string;
  }): void {
    this.db.query(`
      INSERT INTO steering_messages (id, task_id, discord_message_id, content, created_at)
      VALUES ($id, $taskId, $discordMessageId, $content, $createdAt)
    `).run({
      $id: input.id,
      $taskId: input.taskId,
      $discordMessageId: input.discordMessageId,
      $content: input.content,
      $createdAt: new Date().toISOString(),
    });
  }

  consumeSteeringMessages(taskId: string): SteeringMessageRow[] {
    const rows = this.db.query(`
      SELECT
        id,
        task_id as taskId,
        discord_message_id as discordMessageId,
        content,
        created_at as createdAt
      FROM steering_messages
      WHERE task_id = $taskId AND consumed_at IS NULL
      ORDER BY created_at ASC
    `).all({ $taskId: taskId }) as SteeringMessageRow[];

    if (rows.length > 0) {
      this.db.query(`
        UPDATE steering_messages
        SET consumed_at = $consumedAt
        WHERE task_id = $taskId AND consumed_at IS NULL
      `).run({
        $taskId: taskId,
        $consumedAt: new Date().toISOString(),
      });
    }

    return rows;
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
    sessionId?: string;
    senderRole?: AgentRole;
    content: string;
  }): void {
    this.db.query(`
      INSERT INTO messages (id, discord_message_id, discord_channel_id, task_id, session_id, sender_role, content, created_at)
      VALUES ($id, $discordMessageId, $discordChannelId, $taskId, $sessionId, $senderRole, $content, $createdAt)
    `).run({
      $id: input.id,
      $discordMessageId: input.discordMessageId,
      $discordChannelId: input.discordChannelId,
      $taskId: input.taskId ?? null,
      $sessionId: input.sessionId ?? null,
      $senderRole: input.senderRole ?? null,
      $content: input.content,
      $createdAt: new Date().toISOString(),
    });
  }

  private ensureColumn(table: string, column: string, definition: string): void {
    const rows = this.db.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (rows.some((row) => row.name === column)) return;
    this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}
