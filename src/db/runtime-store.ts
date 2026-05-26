import { mkdir } from "node:fs/promises";
import path from "node:path";
import { Database } from "bun:sqlite";
import { runtimeSchemaSql } from "./schema";
import { extendedRuntimeSchemaSql } from "./extended-schema";
import type { AgentRole, ReviewVerdict, RuntimeTask, TaskStatus, TaskType } from "../runtime/types";
import type { WorkflowPlan } from "../workflows/types";

export type WorkflowStepRunStatus = "pending" | "running" | "completed" | "skipped" | "failed";
export type StartupRecoveryMode = "requeue" | "block";

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

export interface TaskRunRow {
  id: string;
  taskId: string;
  role: string;
  model: string | null;
  status: string;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface WorkflowStepRunRow {
  id: string;
  taskId: string;
  workflowId: string;
  stepId: string;
  stepIndex: number;
  role: string;
  resolvedRoleId: string;
  action: string;
  status: WorkflowStepRunStatus;
  dependsOnJson: string;
  required: number;
  requiresReview: number;
  lockedBy: string | null;
  lockExpiresAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  outputRef: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskTimelineEvent {
  kind: "task" | "workflow_step" | "run" | "review" | "artifact";
  label: string;
  status?: string;
  role?: string;
  path?: string;
  createdAt: string;
}

export interface DashboardStatus {
  generatedAt: string;
  totals: {
    tasks: number;
    openTasks: number;
    blockedTasks: number;
    approvedTasks: number;
  };
  byStatus: Array<{ status: string; count: number }>;
  byRole: Array<{ role: string; status: string; count: number }>;
  workflowStepsByStatus: Array<{ status: string; count: number }>;
  recentFailures: Array<{ id: string; title: string; status: string; assignedTo: string; updatedAt: string }>;
  activeLocks: Array<{ id: string; title: string; assignedTo: string; lockedBy: string | null; lockExpiresAt: string | null }>;
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

export interface StartupRecoveryRow {
  taskId: string;
  taskStatus: string;
  stepId: string | null;
  stepStatus: string | null;
  role: string | null;
  lockedBy: string | null;
  lockExpiresAt: string | null;
}

export interface WorkerHeartbeatRow {
  owner: string;
  role: string;
  pid: number | null;
  status: string;
  lastSeenAt: string;
  metadataJson: string | null;
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
    this.ensureColumn("workflow_step_runs", "locked_by", "TEXT");
    this.ensureColumn("workflow_step_runs", "lock_expires_at", "TEXT");
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

    if (input.workflowPlan) {
      this.initializeWorkflowStepRuns({ taskId: input.id, workflowPlan: input.workflowPlan });
    }

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

  initializeWorkflowStepRuns(input: { taskId: string; workflowPlan: WorkflowPlan }): void {
    const now = new Date().toISOString();
    const insert = this.db.query(`
      INSERT OR IGNORE INTO workflow_step_runs (
        id,
        task_id,
        workflow_id,
        step_id,
        step_index,
        role,
        resolved_role_id,
        action,
        status,
        depends_on_json,
        required,
        requires_review,
        created_at,
        updated_at
      ) VALUES (
        $id,
        $taskId,
        $workflowId,
        $stepId,
        $stepIndex,
        $role,
        $resolvedRoleId,
        $action,
        'pending',
        $dependsOnJson,
        $required,
        $requiresReview,
        $now,
        $now
      )
    `);

    input.workflowPlan.steps.forEach((step, index) => {
      insert.run({
        $id: `WSTEP-${input.taskId}-${step.id}`,
        $taskId: input.taskId,
        $workflowId: input.workflowPlan.workflowId,
        $stepId: step.id,
        $stepIndex: index,
        $role: step.role,
        $resolvedRoleId: step.resolvedRoleId,
        $action: step.action,
        $dependsOnJson: JSON.stringify(step.dependsOn),
        $required: step.required ? 1 : 0,
        $requiresReview: step.requiresReview ? 1 : 0,
        $now: now,
      });
    });
  }

  claimReadyWorkflowStep(input: {
    roleId: string;
    owner: string;
    ttlMinutes: number;
    now?: string;
  }): WorkflowStepRunRow | null {
    const nowIso = input.now ?? new Date().toISOString();
    const expiresAt = new Date(new Date(nowIso).getTime() + input.ttlMinutes * 60_000).toISOString();
    const candidate = this.db.query(`
      SELECT
        step.id as id,
        step.task_id as taskId,
        step.step_id as stepId,
        step.depends_on_json as dependsOnJson
      FROM workflow_step_runs step
      JOIN tasks task ON task.id = step.task_id
      WHERE step.status = 'pending'
        AND step.resolved_role_id = $roleId
        AND task.status IN ('pending', 'running', 'needs_revision')
        AND (step.locked_by IS NULL OR step.lock_expires_at IS NULL OR step.lock_expires_at <= $nowIso)
      ORDER BY task.created_at ASC, step.step_index ASC
    `).all({ $roleId: input.roleId, $nowIso: nowIso }) as Array<{
      id: string;
      taskId: string;
      stepId: string;
      dependsOnJson: string;
    }>;

    const ready = candidate.find((step) => this.workflowStepDependenciesComplete(step.taskId, step.dependsOnJson));
    if (!ready) return null;

    const result = this.db.query(`
      UPDATE workflow_step_runs
      SET status = 'running', locked_by = $owner, lock_expires_at = $expiresAt, started_at = COALESCE(started_at, $nowIso), updated_at = $nowIso
      WHERE id = $id
        AND status = 'pending'
        AND resolved_role_id = $roleId
        AND (locked_by IS NULL OR lock_expires_at IS NULL OR lock_expires_at <= $nowIso)
    `).run({
      $id: ready.id,
      $roleId: input.roleId,
      $owner: input.owner,
      $expiresAt: expiresAt,
      $nowIso: nowIso,
    });

    if (result.changes === 0) return null;
    return this.getWorkflowStepRun(ready.taskId, ready.stepId);
  }

  completeWorkflowStepRun(input: {
    taskId: string;
    stepId: string;
    owner?: string;
    outputRef?: string;
    now?: string;
  }): void {
    this.finishClaimedWorkflowStepRun({ ...input, status: "completed" });
  }

  failWorkflowStepRun(input: {
    taskId: string;
    stepId: string;
    owner?: string;
    outputRef?: string;
    error?: string;
    now?: string;
  }): void {
    this.finishClaimedWorkflowStepRun({ ...input, status: "failed" });
  }

  releaseWorkflowStepLease(input: { taskId: string; stepId: string; owner: string }): void {
    this.db.query(`
      UPDATE workflow_step_runs
      SET locked_by = NULL, lock_expires_at = NULL, updated_at = $updatedAt
      WHERE task_id = $taskId AND step_id = $stepId AND locked_by = $owner
    `).run({
      $taskId: input.taskId,
      $stepId: input.stepId,
      $owner: input.owner,
      $updatedAt: new Date().toISOString(),
    });
  }

  updateWorkflowStepRun(input: {
    taskId: string;
    stepId: string;
    status: WorkflowStepRunStatus;
    outputRef?: string;
    error?: string;
    now?: string;
  }): void {
    const now = input.now ?? new Date().toISOString();
    this.db.query(`
      UPDATE workflow_step_runs
      SET
        status = $status,
        started_at = CASE WHEN $status = 'running' THEN COALESCE(started_at, $now) ELSE started_at END,
        finished_at = CASE WHEN $status IN ('completed', 'skipped', 'failed') THEN $now ELSE finished_at END,
        locked_by = CASE WHEN $status IN ('completed', 'skipped', 'failed') THEN NULL ELSE locked_by END,
        lock_expires_at = CASE WHEN $status IN ('completed', 'skipped', 'failed') THEN NULL ELSE lock_expires_at END,
        output_ref = COALESCE($outputRef, output_ref),
        error = COALESCE($error, error),
        updated_at = $now
      WHERE task_id = $taskId AND step_id = $stepId
    `).run({
      $taskId: input.taskId,
      $stepId: input.stepId,
      $status: input.status,
      $outputRef: input.outputRef ?? null,
      $error: input.error ?? null,
      $now: now,
    });
  }

  requeueWorkflowStepRun(input: {
    taskId: string;
    stepId: string;
    reason?: string;
    now?: string;
  }): void {
    const now = input.now ?? new Date().toISOString();
    this.db.query(`
      UPDATE workflow_step_runs
      SET
        status = 'pending',
        locked_by = NULL,
        lock_expires_at = NULL,
        started_at = NULL,
        finished_at = NULL,
        output_ref = NULL,
        error = $reason,
        updated_at = $now
      WHERE task_id = $taskId AND step_id = $stepId
    `).run({
      $taskId: input.taskId,
      $stepId: input.stepId,
      $reason: input.reason ?? null,
      $now: now,
    });
  }

  getWorkflowStepRun(taskId: string, stepId: string): WorkflowStepRunRow | null {
    return this.workflowStepQuery("WHERE task_id = $taskId AND step_id = $stepId").get({
      $taskId: taskId,
      $stepId: stepId,
    }) as WorkflowStepRunRow | null;
  }

  listWorkflowStepRuns(taskId: string): WorkflowStepRunRow[] {
    return this.workflowStepQuery("WHERE task_id = $taskId ORDER BY step_index ASC").all({
      $taskId: taskId,
    }) as WorkflowStepRunRow[];
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

  getDashboardStatus(): DashboardStatus {
    const byStatus = this.db.query(`
      SELECT status, COUNT(*) as count
      FROM tasks
      GROUP BY status
      ORDER BY count DESC, status ASC
    `).all() as Array<{ status: string; count: number }>;

    const byRole = this.db.query(`
      SELECT assigned_to as role, status, COUNT(*) as count
      FROM tasks
      GROUP BY assigned_to, status
      ORDER BY assigned_to ASC, status ASC
    `).all() as Array<{ role: string; status: string; count: number }>;

    const workflowStepsByStatus = this.db.query(`
      SELECT status, COUNT(*) as count
      FROM workflow_step_runs
      GROUP BY status
      ORDER BY count DESC, status ASC
    `).all() as Array<{ status: string; count: number }>;

    const totalsRow = this.db.query(`
      SELECT
        COUNT(*) as tasks,
        SUM(CASE WHEN status IN ('pending', 'running', 'needs_revision', 'needs_human', 'split_task', 'retry_with_different_agent') THEN 1 ELSE 0 END) as openTasks,
        SUM(CASE WHEN status IN ('blocked', 'failed') THEN 1 ELSE 0 END) as blockedTasks,
        SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approvedTasks
      FROM tasks
    `).get() as { tasks: number; openTasks: number | null; blockedTasks: number | null; approvedTasks: number | null };

    const recentFailures = this.db.query(`
      SELECT id, title, status, assigned_to as assignedTo, updated_at as updatedAt
      FROM tasks
      WHERE status IN ('blocked', 'failed', 'needs_human', 'split_task', 'retry_with_different_agent')
      ORDER BY updated_at DESC
      LIMIT 10
    `).all() as Array<{ id: string; title: string; status: string; assignedTo: string; updatedAt: string }>;

    const activeLocks = this.db.query(`
      SELECT id, title, assigned_to as assignedTo, locked_by as lockedBy, lock_expires_at as lockExpiresAt
      FROM tasks
      WHERE locked_by IS NOT NULL
      ORDER BY lock_expires_at ASC
      LIMIT 10
    `).all() as Array<{ id: string; title: string; assignedTo: string; lockedBy: string | null; lockExpiresAt: string | null }>;

    return {
      generatedAt: new Date().toISOString(),
      totals: {
        tasks: totalsRow.tasks,
        openTasks: totalsRow.openTasks ?? 0,
        blockedTasks: totalsRow.blockedTasks ?? 0,
        approvedTasks: totalsRow.approvedTasks ?? 0,
      },
      byStatus,
      byRole,
      workflowStepsByStatus,
      recentFailures,
      activeLocks,
    };
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

  listTaskRuns(taskId: string): TaskRunRow[] {
    return this.db.query(`
      SELECT
        id,
        task_id as taskId,
        role,
        model,
        status,
        error,
        started_at as startedAt,
        finished_at as finishedAt
      FROM task_runs
      WHERE task_id = $taskId
      ORDER BY started_at ASC
    `).all({ $taskId: taskId }) as TaskRunRow[];
  }

  getTaskTimeline(taskId: string): TaskTimelineEvent[] {
    const task = this.getTask(taskId);
    if (!task) return [];

    const events: TaskTimelineEvent[] = [
      {
        kind: "task",
        label: `Task created: ${task.title}`,
        status: task.status,
        role: task.assignedTo,
        path: task.obsidianPath,
        createdAt: task.createdAt,
      },
      ...this.listWorkflowStepRuns(taskId).map((step): TaskTimelineEvent => ({
        kind: "workflow_step",
        label: `Workflow step ${step.stepIndex + 1}: ${step.stepId}`,
        status: step.status,
        role: step.role,
        path: step.outputRef ?? undefined,
        createdAt: step.startedAt ?? step.updatedAt,
      })),
      ...this.listTaskRuns(taskId).map((run): TaskTimelineEvent => ({
        kind: "run",
        label: `Run ${run.id}`,
        status: run.status,
        role: run.role,
        createdAt: run.startedAt,
      })),
      ...this.listTaskReviews(taskId).map((review): TaskTimelineEvent => ({
        kind: "review",
        label: `Review round ${review.round}: ${review.verdict}`,
        status: review.verdict,
        role: "director",
        createdAt: review.createdAt,
      })),
      ...this.listTaskArtifacts(taskId).map((artifact): TaskTimelineEvent => ({
        kind: "artifact",
        label: artifact.type,
        role: artifact.createdBy,
        path: artifact.path,
        createdAt: artifact.createdAt,
      })),
    ];

    return events.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
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

  recoverInterruptedWorkflowSteps(input: { staleMinutes: number; mode: StartupRecoveryMode }): StartupRecoveryRow[] {
    const staleBefore = new Date(Date.now() - input.staleMinutes * 60_000).toISOString();
    const now = new Date().toISOString();
    const rows = this.db.query(`
      SELECT
        task.id as taskId,
        task.status as taskStatus,
        step.step_id as stepId,
        step.status as stepStatus,
        step.role as role,
        step.locked_by as lockedBy,
        step.lock_expires_at as lockExpiresAt
      FROM workflow_step_runs step
      JOIN tasks task ON task.id = step.task_id
      WHERE step.status = 'running'
        AND task.status IN ('pending', 'running', 'needs_revision')
        AND (step.lock_expires_at IS NULL OR step.lock_expires_at <= $staleBefore OR step.updated_at <= $staleBefore)
      ORDER BY task.created_at ASC, step.step_index ASC
    `).all({ $staleBefore: staleBefore }) as StartupRecoveryRow[];

    if (rows.length === 0) return rows;

    const taskIds = [...new Set(rows.map((row) => row.taskId))];
    const stepUpdate = input.mode === "requeue"
      ? `
        UPDATE workflow_step_runs
        SET status = 'pending', locked_by = NULL, lock_expires_at = NULL, started_at = NULL, finished_at = NULL,
            error = $reason, updated_at = $now
        WHERE status = 'running'
          AND (lock_expires_at IS NULL OR lock_expires_at <= $staleBefore OR updated_at <= $staleBefore)
      `
      : `
        UPDATE workflow_step_runs
        SET status = 'failed', locked_by = NULL, lock_expires_at = NULL, finished_at = $now,
            error = $reason, updated_at = $now
        WHERE status = 'running'
          AND (lock_expires_at IS NULL OR lock_expires_at <= $staleBefore OR updated_at <= $staleBefore)
      `;
    this.db.query(stepUpdate).run({
      $staleBefore: staleBefore,
      $reason: `Startup recovery ${input.mode} after stale running step detection.`,
      $now: now,
    });

    for (const taskId of taskIds) {
      const nextStatus = input.mode === "requeue" ? taskStatusAfterRequeue(this.getTask(taskId)?.status) : "blocked";
      this.db.query(`
        UPDATE tasks
        SET status = $status, locked_by = NULL, lock_expires_at = NULL, updated_at = $now
        WHERE id = $taskId
      `).run({ $taskId: taskId, $status: nextStatus, $now: now });
      this.recordRuntimeEvent({
        kind: "startup_recovery",
        taskId,
        message: `Recovered ${rows.filter((row) => row.taskId === taskId).length} interrupted workflow step(s) with mode=${input.mode}.`,
        metadata: { mode: input.mode, staleBefore },
      });
    }

    return rows;
  }

  recordRuntimeEvent(input: {
    kind: string;
    taskId?: string;
    stepId?: string;
    owner?: string;
    message: string;
    metadata?: unknown;
  }): void {
    this.db.query(`
      INSERT INTO runtime_events (id, kind, task_id, step_id, owner, message, metadata_json, created_at)
      VALUES ($id, $kind, $taskId, $stepId, $owner, $message, $metadataJson, $createdAt)
    `).run({
      $id: `EVT-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      $kind: input.kind,
      $taskId: input.taskId ?? null,
      $stepId: input.stepId ?? null,
      $owner: input.owner ?? null,
      $message: input.message,
      $metadataJson: input.metadata === undefined ? null : JSON.stringify(input.metadata),
      $createdAt: new Date().toISOString(),
    });
  }

  upsertWorkerHeartbeat(input: {
    owner: string;
    role: AgentRole | "scheduler";
    pid?: number;
    status: string;
    metadata?: unknown;
  }): void {
    this.db.query(`
      INSERT INTO worker_heartbeats (owner, role, pid, status, last_seen_at, metadata_json)
      VALUES ($owner, $role, $pid, $status, $lastSeenAt, $metadataJson)
      ON CONFLICT(owner) DO UPDATE SET
        role = excluded.role,
        pid = excluded.pid,
        status = excluded.status,
        last_seen_at = excluded.last_seen_at,
        metadata_json = excluded.metadata_json
    `).run({
      $owner: input.owner,
      $role: input.role,
      $pid: input.pid ?? null,
      $status: input.status,
      $lastSeenAt: new Date().toISOString(),
      $metadataJson: input.metadata === undefined ? null : JSON.stringify(input.metadata),
    });
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

  private finishClaimedWorkflowStepRun(input: {
    taskId: string;
    stepId: string;
    status: "completed" | "failed";
    owner?: string;
    outputRef?: string;
    error?: string;
    now?: string;
  }): void {
    const now = input.now ?? new Date().toISOString();
    const ownerPredicate = input.owner ? "AND locked_by = $owner" : "";
    this.db.query(`
      UPDATE workflow_step_runs
      SET
        status = $status,
        finished_at = $now,
        locked_by = NULL,
        lock_expires_at = NULL,
        output_ref = COALESCE($outputRef, output_ref),
        error = COALESCE($error, error),
        updated_at = $now
      WHERE task_id = $taskId AND step_id = $stepId ${ownerPredicate}
    `).run({
      $taskId: input.taskId,
      $stepId: input.stepId,
      $status: input.status,
      $owner: input.owner ?? null,
      $outputRef: input.outputRef ?? null,
      $error: input.error ?? null,
      $now: now,
    });
  }

  private workflowStepDependenciesComplete(taskId: string, dependsOnJson: string): boolean {
    const dependsOn = parseStringArray(dependsOnJson);
    if (dependsOn.length === 0) return true;
    const rows = this.db.query(`
      SELECT step_id as stepId, status
      FROM workflow_step_runs
      WHERE task_id = $taskId
    `).all({ $taskId: taskId }) as Array<{ stepId: string; status: WorkflowStepRunStatus }>;
    const statusByStep = new Map(rows.map((row) => [row.stepId, row.status]));
    return dependsOn.every((stepId) => statusByStep.get(stepId) === "completed" || statusByStep.get(stepId) === "skipped");
  }

  private workflowStepQuery(whereClause: string) {
    return this.db.query(`
      SELECT
        id,
        task_id as taskId,
        workflow_id as workflowId,
        step_id as stepId,
        step_index as stepIndex,
        role,
        resolved_role_id as resolvedRoleId,
        action,
        status,
        depends_on_json as dependsOnJson,
        required,
        requires_review as requiresReview,
        locked_by as lockedBy,
        lock_expires_at as lockExpiresAt,
        started_at as startedAt,
        finished_at as finishedAt,
        output_ref as outputRef,
        error,
        created_at as createdAt,
        updated_at as updatedAt
      FROM workflow_step_runs
      ${whereClause}
    `);
  }

  private ensureColumn(table: string, column: string, definition: string): void {
    const rows = this.db.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (rows.some((row) => row.name === column)) return;
    this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function taskStatusAfterRequeue(status: string | undefined): TaskStatus {
  if (status === "needs_revision") return "needs_revision";
  return "pending";
}
