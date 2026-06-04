import type { Database } from "bun:sqlite";
import type { DashboardStatus, TaskSummaryRow } from "../runtime-store-types";
import type { AgentRole, RuntimeTask, TaskStatus, TaskType } from "../../runtime/types";
import type { WorkflowPlan } from "../../workflows/types";
import { recordRuntimeEvent } from "./runtime-events";

export function createTask(
  db: Database,
  input: {
    id: string;
    title: string;
    type: TaskType;
    assignedTo: AgentRole;
    obsidianPath: string;
    sessionId?: string;
    groupId?: string;
    workflowPlan?: WorkflowPlan;
    initializeWorkflowStepRuns: (input: { taskId: string; workflowPlan: WorkflowPlan }) => void;
  },
): RuntimeTask {
  const now = new Date().toISOString();
  db.query(
    `
    INSERT INTO tasks (id, title, type, status, assigned_to, obsidian_path, current_round, session_id, group_id, workflow_id, workflow_plan_json, created_at, updated_at)
    VALUES ($id, $title, $type, 'pending', $assignedTo, $obsidianPath, 0, $sessionId, $groupId, $workflowId, $workflowPlanJson, $now, $now)
  `,
  ).run({
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
    input.initializeWorkflowStepRuns({ taskId: input.id, workflowPlan: input.workflowPlan });
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

export function updateTaskStatus(db: Database, id: string, status: TaskStatus): void {
  db.query(
    `
    UPDATE tasks SET status = $status, updated_at = $updatedAt WHERE id = $id
  `,
  ).run({ $id: id, $status: status, $updatedAt: new Date().toISOString() });
}

export function setTaskReviewRound(db: Database, id: string, round: number): void {
  db.query(
    `
    UPDATE tasks SET current_round = $round, updated_at = $updatedAt WHERE id = $id
  `,
  ).run({ $id: id, $round: round, $updatedAt: new Date().toISOString() });
}

export function getTask(db: Database, id: string): TaskSummaryRow | null {
  return db
    .query(
      `
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
  `,
    )
    .get({ $id: id }) as TaskSummaryRow | null;
}

export function listRecentTasks(db: Database, limit = 10): TaskSummaryRow[] {
  return db
    .query(
      `
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
  `,
    )
    .all({ $limit: limit }) as TaskSummaryRow[];
}

export function getDashboardStatus(db: Database): DashboardStatus {
  const byStatus = db
    .query(
      `
    SELECT status, COUNT(*) as count
    FROM tasks
    GROUP BY status
    ORDER BY count DESC, status ASC
  `,
    )
    .all() as Array<{ status: string; count: number }>;

  const byRole = db
    .query(
      `
    SELECT assigned_to as role, status, COUNT(*) as count
    FROM tasks
    GROUP BY assigned_to, status
    ORDER BY assigned_to ASC, status ASC
  `,
    )
    .all() as Array<{ role: string; status: string; count: number }>;

  const workflowStepsByStatus = db
    .query(
      `
    SELECT status, COUNT(*) as count
    FROM workflow_step_runs
    GROUP BY status
    ORDER BY count DESC, status ASC
  `,
    )
    .all() as Array<{ status: string; count: number }>;

  const totalsRow = db
    .query(
      `
    SELECT
      COUNT(*) as tasks,
      SUM(CASE WHEN status IN ('pending', 'running', 'needs_revision', 'needs_human', 'split_task', 'retry_with_different_agent') THEN 1 ELSE 0 END) as openTasks,
      SUM(CASE WHEN status IN ('blocked', 'failed') THEN 1 ELSE 0 END) as blockedTasks,
      SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approvedTasks
    FROM tasks
  `,
    )
    .get() as {
    tasks: number;
    openTasks: number | null;
    blockedTasks: number | null;
    approvedTasks: number | null;
  };

  const recentFailures = db
    .query(
      `
    SELECT id, title, status, assigned_to as assignedTo, updated_at as updatedAt
    FROM tasks
    WHERE status IN ('blocked', 'failed', 'needs_human', 'split_task', 'retry_with_different_agent')
    ORDER BY updated_at DESC
    LIMIT 10
  `,
    )
    .all() as Array<{
    id: string;
    title: string;
    status: string;
    assignedTo: string;
    updatedAt: string;
  }>;

  const activeLocks = db
    .query(
      `
    SELECT id, title, assigned_to as assignedTo, locked_by as lockedBy, lock_expires_at as lockExpiresAt
    FROM tasks
    WHERE locked_by IS NOT NULL
    ORDER BY lock_expires_at ASC
    LIMIT 10
  `,
    )
    .all() as Array<{
    id: string;
    title: string;
    assignedTo: string;
    lockedBy: string | null;
    lockExpiresAt: string | null;
  }>;

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

export function claimPendingTask(
  db: Database,
  input: {
    role: AgentRole;
    owner: string;
    ttlMinutes: number;
    getTask: (id: string) => TaskSummaryRow | null;
  },
): TaskSummaryRow | null {
  const now = new Date();
  const nowIso = now.toISOString();
  const expiresAt = new Date(now.getTime() + input.ttlMinutes * 60_000).toISOString();

  const tx = db.transaction((): string | null => {
    const candidate = db
      .query(
        `
      SELECT id
      FROM tasks
      WHERE status = 'pending'
        AND assigned_to = $role
        AND (locked_by IS NULL OR lock_expires_at IS NULL OR lock_expires_at <= $nowIso)
      ORDER BY created_at ASC
      LIMIT 1
    `,
      )
      .get({
        $role: input.role,
        $nowIso: nowIso,
      }) as { id: string } | null;

    if (!candidate) return null;

    const result = db
      .query(
        `
      UPDATE tasks
      SET status = 'running', locked_by = $owner, lock_expires_at = $expiresAt, updated_at = $nowIso
      WHERE id = $taskId
        AND status = 'pending'
        AND assigned_to = $role
        AND (locked_by IS NULL OR lock_expires_at IS NULL OR lock_expires_at <= $nowIso)
    `,
      )
      .run({
        $taskId: candidate.id,
        $role: input.role,
        $owner: input.owner,
        $expiresAt: expiresAt,
        $nowIso: nowIso,
      });

    if (result.changes === 0) return null;
    recordRuntimeEvent(db, {
      kind: "task_claimed",
      taskId: candidate.id,
      owner: input.owner,
      message: `Task claimed by ${input.owner}.`,
      metadata: { role: input.role, expiresAt },
    });
    return candidate.id;
  });

  const claimedTaskId = tx();
  return claimedTaskId ? input.getTask(claimedTaskId) : null;
}

export function acquireTaskLease(
  db: Database,
  input: { taskId: string; owner: string; ttlMinutes: number },
): boolean {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + input.ttlMinutes * 60_000).toISOString();
  const nowIso = now.toISOString();

  const result = db
    .query(
      `
    UPDATE tasks
    SET locked_by = $owner, lock_expires_at = $expiresAt, updated_at = $nowIso
    WHERE id = $taskId
      AND (locked_by IS NULL OR lock_expires_at IS NULL OR lock_expires_at <= $nowIso OR locked_by = $owner)
  `,
    )
    .run({
      $taskId: input.taskId,
      $owner: input.owner,
      $expiresAt: expiresAt,
      $nowIso: nowIso,
    });

  return result.changes > 0;
}

export function refreshTaskLease(
  db: Database,
  input: { taskId: string; owner: string; ttlMinutes: number },
): void {
  const expiresAt = new Date(Date.now() + input.ttlMinutes * 60_000).toISOString();
  db.query(
    `
    UPDATE tasks
    SET lock_expires_at = $expiresAt, updated_at = $updatedAt
    WHERE id = $taskId AND locked_by = $owner
  `,
  ).run({
    $taskId: input.taskId,
    $owner: input.owner,
    $expiresAt: expiresAt,
    $updatedAt: new Date().toISOString(),
  });
}

export function releaseTaskLease(db: Database, input: { taskId: string; owner: string }): void {
  db.query(
    `
    UPDATE tasks
    SET locked_by = NULL, lock_expires_at = NULL, updated_at = $updatedAt
    WHERE id = $taskId AND locked_by = $owner
  `,
  ).run({
    $taskId: input.taskId,
    $owner: input.owner,
    $updatedAt: new Date().toISOString(),
  });
}

export function recoverStaleTasks(
  db: Database,
  input: { staleMinutes: number },
): Array<{ id: string; status: string; lockedBy: string | null }> {
  const staleBefore = new Date(Date.now() - input.staleMinutes * 60_000).toISOString();
  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    const rows = db
      .query(
        `
      SELECT id, status, locked_by as lockedBy
      FROM tasks
      WHERE status IN ('running', 'needs_revision')
        AND (lock_expires_at IS NULL OR lock_expires_at <= $staleBefore OR updated_at <= $staleBefore)
    `,
      )
      .all({ $staleBefore: staleBefore }) as Array<{
      id: string;
      status: string;
      lockedBy: string | null;
    }>;

    db.query(
      `
      UPDATE tasks
      SET status = 'blocked', locked_by = NULL, lock_expires_at = NULL, updated_at = $updatedAt
      WHERE status IN ('running', 'needs_revision')
        AND (lock_expires_at IS NULL OR lock_expires_at <= $staleBefore OR updated_at <= $staleBefore)
    `,
    ).run({
      $staleBefore: staleBefore,
      $updatedAt: now,
    });

    return rows;
  });

  return tx();
}
