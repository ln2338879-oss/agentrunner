import type { Database } from "bun:sqlite";
import type {
  StartupRecoveryMode,
  TaskSummaryRow,
  WorkflowStepRunRow,
  WorkflowStepRunStatus,
} from "../runtime-store-types";
import type { WorkflowPlan } from "../../workflows/types";
import { parseWorkflowDependencyIds } from "../../workflows/dependencies";
import { recordRuntimeEvent } from "./runtime-events";

interface ClaimReadyWorkflowStepCandidate {
  id: string;
  taskId: string;
  workflowId: string;
  stepId: string;
  attemptNo: number;
  dependsOnJson: string;
}

export function initializeWorkflowStepRuns(
  db: Database,
  input: { taskId: string; workflowPlan: WorkflowPlan },
): void {
  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    const insert = db.query(`
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
        continue_on_failure,
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
        $continueOnFailure,
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
        $continueOnFailure: step.continueOnFailure ? 1 : 0,
        $now: now,
      });
    });
  });
  tx();
}

export function claimReadyWorkflowStep(
  db: Database,
  input: {
    roleId: string;
    owner: string;
    ttlMinutes: number;
    now?: string;
  },
): WorkflowStepRunRow | null {
  const nowIso = input.now ?? new Date().toISOString();
  const expiresAt = new Date(new Date(nowIso).getTime() + input.ttlMinutes * 60_000).toISOString();

  const tx = db.transaction((): { taskId: string; stepId: string } | null => {
    const candidates = db
      .query(
        `
      SELECT
        step.id as id,
        step.task_id as taskId,
        step.workflow_id as workflowId,
        step.step_id as stepId,
        step.attempt_no as attemptNo,
        step.depends_on_json as dependsOnJson
      FROM workflow_step_runs step
      JOIN tasks task ON task.id = step.task_id
      WHERE step.status = 'pending'
        AND step.resolved_role_id = $roleId
        AND task.status IN ('pending', 'running', 'review_ready', 'in_review', 'needs_revision', 'arbiter_requested', 'in_arbitration')
        AND (step.locked_by IS NULL OR step.lock_expires_at IS NULL OR step.lock_expires_at <= $nowIso)
      ORDER BY task.created_at ASC, step.step_index ASC
    `,
      )
      .all({ $roleId: input.roleId, $nowIso: nowIso }) as ClaimReadyWorkflowStepCandidate[];

    const ready = candidates.find((step) =>
      workflowStepDependenciesComplete(db, step.taskId, step.dependsOnJson),
    );
    if (!ready) return null;

    const attemptNo = ready.attemptNo + 1;
    const runId = buildWorkflowStepRunId(ready.taskId, ready.stepId, attemptNo);
    const result = db
      .query(
        `
      UPDATE workflow_step_runs
      SET
        status = 'running',
        locked_by = $owner,
        lock_expires_at = $expiresAt,
        started_at = COALESCE(started_at, $nowIso),
        attempt_no = attempt_no + 1,
        active_run_id = $runId,
        updated_at = $nowIso
      WHERE id = $id
        AND status = 'pending'
        AND resolved_role_id = $roleId
        AND (locked_by IS NULL OR lock_expires_at IS NULL OR lock_expires_at <= $nowIso)
    `,
      )
      .run({
        $id: ready.id,
        $roleId: input.roleId,
        $owner: input.owner,
        $expiresAt: expiresAt,
        $nowIso: nowIso,
        $runId: runId,
      });

    if (result.changes === 0) return null;
    db.query(
      `
      INSERT INTO workflow_step_attempts (
        run_id,
        step_run_id,
        task_id,
        workflow_id,
        step_id,
        attempt_no,
        owner,
        status,
        claimed_at,
        updated_at
      ) VALUES (
        $runId,
        $stepRunId,
        $taskId,
        $workflowId,
        $stepId,
        $attemptNo,
        $owner,
        'running',
        $nowIso,
        $nowIso
      )
    `,
    ).run({
      $runId: runId,
      $stepRunId: ready.id,
      $taskId: ready.taskId,
      $workflowId: ready.workflowId,
      $stepId: ready.stepId,
      $attemptNo: attemptNo,
      $owner: input.owner,
      $nowIso: nowIso,
    });
    recordRuntimeEvent(db, {
      kind: "workflow_step_claimed",
      taskId: ready.taskId,
      stepId: ready.stepId,
      owner: input.owner,
      message: `Workflow step claimed by ${input.owner}.`,
      metadata: { roleId: input.roleId, expiresAt, runId, attemptNo },
    });
    return { taskId: ready.taskId, stepId: ready.stepId };
  });

  const claimed = tx();
  return claimed ? getWorkflowStepRun(db, claimed.taskId, claimed.stepId) : null;
}

export function completeWorkflowStepRun(
  db: Database,
  input: {
    taskId: string;
    stepId: string;
    owner?: string;
    runId?: string | null;
    outputRef?: string;
    now?: string;
  },
): boolean {
  return finishClaimedWorkflowStepRun(db, { ...input, status: "completed" });
}

export function failWorkflowStepRun(
  db: Database,
  input: {
    taskId: string;
    stepId: string;
    owner?: string;
    runId?: string | null;
    outputRef?: string;
    error?: string;
    now?: string;
  },
): boolean {
  return finishClaimedWorkflowStepRun(db, { ...input, status: "failed" });
}

export function releaseWorkflowStepLease(
  db: Database,
  input: { taskId: string; stepId: string; owner: string },
): void {
  db.query(
    `
    UPDATE workflow_step_runs
    SET locked_by = NULL, lock_expires_at = NULL, updated_at = $updatedAt
    WHERE task_id = $taskId AND step_id = $stepId AND locked_by = $owner
  `,
  ).run({
    $taskId: input.taskId,
    $stepId: input.stepId,
    $owner: input.owner,
    $updatedAt: new Date().toISOString(),
  });
}

export function refreshWorkflowStepLease(
  db: Database,
  input: {
    taskId: string;
    stepId: string;
    owner: string;
    ttlMinutes: number;
    now?: string;
  },
): boolean {
  const nowIso = input.now ?? new Date().toISOString();
  const expiresAt = new Date(new Date(nowIso).getTime() + input.ttlMinutes * 60_000).toISOString();
  const result = db
    .query(
      `
    UPDATE workflow_step_runs
    SET lock_expires_at = $expiresAt, updated_at = $nowIso
    WHERE task_id = $taskId
      AND step_id = $stepId
      AND locked_by = $owner
      AND status = 'running'
  `,
    )
    .run({
      $taskId: input.taskId,
      $stepId: input.stepId,
      $owner: input.owner,
      $expiresAt: expiresAt,
      $nowIso: nowIso,
    });

  return result.changes > 0;
}

export function updateWorkflowStepRun(
  db: Database,
  input: {
    taskId: string;
    stepId: string;
    status: WorkflowStepRunStatus;
    outputRef?: string;
    error?: string;
    now?: string;
  },
): void {
  const now = input.now ?? new Date().toISOString();
  db.query(
    `
    UPDATE workflow_step_runs
    SET
      status = $status,
      started_at = CASE WHEN $status = 'running' THEN COALESCE(started_at, $now) ELSE started_at END,
      finished_at = CASE WHEN $status IN ('completed', 'skipped', 'failed') THEN $now ELSE finished_at END,
      locked_by = CASE WHEN $status IN ('completed', 'skipped', 'failed') THEN NULL ELSE locked_by END,
      lock_expires_at = CASE WHEN $status IN ('completed', 'skipped', 'failed') THEN NULL ELSE lock_expires_at END,
      active_run_id = CASE WHEN $status IN ('completed', 'skipped', 'failed') THEN NULL ELSE active_run_id END,
      output_ref = COALESCE($outputRef, output_ref),
      error = COALESCE($error, error),
      updated_at = $now
    WHERE task_id = $taskId AND step_id = $stepId
  `,
  ).run({
    $taskId: input.taskId,
    $stepId: input.stepId,
    $status: input.status,
    $outputRef: input.outputRef ?? null,
    $error: input.error ?? null,
    $now: now,
  });
}

export function requeueWorkflowStepRun(
  db: Database,
  input: {
    taskId: string;
    stepId: string;
    reason?: string;
    now?: string;
  },
): void {
  const now = input.now ?? new Date().toISOString();
  db.query(
    `
    UPDATE workflow_step_runs
    SET
      status = 'pending',
      locked_by = NULL,
      lock_expires_at = NULL,
      started_at = NULL,
      finished_at = NULL,
      active_run_id = NULL,
      output_ref = NULL,
      error = $reason,
      updated_at = $now
    WHERE task_id = $taskId AND step_id = $stepId
  `,
  ).run({
    $taskId: input.taskId,
    $stepId: input.stepId,
    $reason: input.reason ?? null,
    $now: now,
  });
}

export function getWorkflowStepRun(
  db: Database,
  taskId: string,
  stepId: string,
): WorkflowStepRunRow | null {
  return workflowStepQuery(db, "WHERE task_id = $taskId AND step_id = $stepId").get({
    $taskId: taskId,
    $stepId: stepId,
  }) as WorkflowStepRunRow | null;
}

export function listWorkflowStepRuns(db: Database, taskId: string): WorkflowStepRunRow[] {
  return workflowStepQuery(db, "WHERE task_id = $taskId ORDER BY step_index ASC").all({
    $taskId: taskId,
  }) as WorkflowStepRunRow[];
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

export function recoverInterruptedWorkflowSteps(
  db: Database,
  input: {
    staleMinutes: number;
    mode: StartupRecoveryMode;
    getTask: (id: string) => TaskSummaryRow | null;
  },
): StartupRecoveryRow[] {
  const staleBefore = new Date(Date.now() - input.staleMinutes * 60_000).toISOString();
  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    const rows = db
      .query(
        `
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
        AND task.status IN ('pending', 'running', 'review_ready', 'in_review', 'needs_revision', 'arbiter_requested', 'in_arbitration')
        AND (step.lock_expires_at IS NULL OR step.lock_expires_at <= $staleBefore OR step.updated_at <= $staleBefore)
      ORDER BY task.created_at ASC, step.step_index ASC
    `,
      )
      .all({ $staleBefore: staleBefore }) as StartupRecoveryRow[];

    if (rows.length === 0) return rows;

    const taskIds = [...new Set(rows.map((row) => row.taskId))];
    const stepUpdate =
      input.mode === "requeue"
        ? `
        UPDATE workflow_step_runs
        SET status = 'pending', locked_by = NULL, lock_expires_at = NULL, started_at = NULL, finished_at = NULL,
            active_run_id = NULL, error = $reason, updated_at = $now
        WHERE status = 'running'
          AND (lock_expires_at IS NULL OR lock_expires_at <= $staleBefore OR updated_at <= $staleBefore)
      `
        : `
        UPDATE workflow_step_runs
        SET status = 'failed', locked_by = NULL, lock_expires_at = NULL, finished_at = $now,
            active_run_id = NULL, error = $reason, updated_at = $now
        WHERE status = 'running'
          AND (lock_expires_at IS NULL OR lock_expires_at <= $staleBefore OR updated_at <= $staleBefore)
      `;
    db.query(stepUpdate).run({
      $staleBefore: staleBefore,
      $reason: `Startup recovery ${input.mode} after stale running step detection.`,
      $now: now,
    });

    for (const taskId of taskIds) {
      const nextStatus =
        input.mode === "requeue"
          ? taskStatusAfterRequeue(input.getTask(taskId)?.status)
          : "blocked";
      db.query(
        `
        UPDATE tasks
        SET status = $status, locked_by = NULL, lock_expires_at = NULL, updated_at = $now
        WHERE id = $taskId
      `,
      ).run({ $taskId: taskId, $status: nextStatus, $now: now });
      recordRuntimeEvent(db, {
        kind: "startup_recovery",
        taskId,
        message: `Recovered ${rows.filter((row) => row.taskId === taskId).length} interrupted workflow step(s) with mode=${input.mode}.`,
        metadata: { mode: input.mode, staleBefore },
      });
    }

    return rows;
  });

  return tx();
}

function finishClaimedWorkflowStepRun(
  db: Database,
  input: {
    taskId: string;
    stepId: string;
    status: "completed" | "failed";
    owner?: string;
    runId?: string | null;
    outputRef?: string;
    error?: string;
    now?: string;
  },
): boolean {
  const now = input.now ?? new Date().toISOString();
  const ownerPredicate = input.owner ? "AND locked_by = $owner" : "";
  const result = db.query(
    `
    UPDATE workflow_step_runs
    SET
      status = $status,
      finished_at = $now,
      locked_by = NULL,
      lock_expires_at = NULL,
      active_run_id = NULL,
      output_ref = COALESCE($outputRef, output_ref),
      error = COALESCE($error, error),
      updated_at = $now
    WHERE task_id = $taskId
      AND step_id = $stepId
      ${ownerPredicate}
      AND (active_run_id IS NULL OR active_run_id = $runId)
  `,
  ).run({
    $taskId: input.taskId,
    $stepId: input.stepId,
    $status: input.status,
    $owner: input.owner ?? null,
    $runId: input.runId ?? null,
    $outputRef: input.outputRef ?? null,
    $error: input.error ?? null,
    $now: now,
  });

  if (result.changes > 0) {
    if (input.runId) {
      db.query(
        `
        UPDATE workflow_step_attempts
        SET status = $status,
            output_ref = COALESCE($outputRef, output_ref),
            error = COALESCE($error, error),
            finished_at = $now,
            updated_at = $now
        WHERE run_id = $runId
      `,
      ).run({
        $runId: input.runId,
        $status: input.status,
        $outputRef: input.outputRef ?? null,
        $error: input.error ?? null,
        $now: now,
      });
    }
    return true;
  }

  if (input.runId) {
    const current = getWorkflowStepRun(db, input.taskId, input.stepId);
    if (current?.activeRunId && current.activeRunId !== input.runId) {
      db.query(
        `
        UPDATE workflow_step_attempts
        SET status = 'suppressed',
            output_ref = COALESCE($outputRef, output_ref),
            error = COALESCE($error, error),
            finished_at = $now,
            updated_at = $now
        WHERE run_id = $runId
      `,
      ).run({
        $runId: input.runId,
        $outputRef: input.outputRef ?? null,
        $error: input.error ?? null,
        $now: now,
      });
      recordRuntimeEvent(db, {
        kind: "stale_workflow_step_result",
        taskId: input.taskId,
        stepId: input.stepId,
        owner: input.owner,
        message: "Suppressed stale workflow step result.",
        metadata: {
          staleRunId: input.runId,
          activeRunId: current.activeRunId,
          attemptedStatus: input.status,
        },
      });
    }
  }
  return false;
}

function workflowStepDependenciesComplete(
  db: Database,
  taskId: string,
  dependsOnJson: string,
): boolean {
  const dependsOn = parseWorkflowDependencyIds(dependsOnJson);
  if (dependsOn.length === 0) return true;

  const rows = workflowStepQuery(db, "WHERE task_id = $taskId").all({
    $taskId: taskId,
  }) as WorkflowStepRunRow[];
  const byStepId = new Map(rows.map((step) => [step.stepId, step]));
  return dependsOn.every((stepId) => {
    const dependency = byStepId.get(stepId);
    const status = dependency?.status;
    return status === "completed" || status === "skipped" || (status === "failed" && dependency?.continueOnFailure === 1);
  });
}

function workflowStepQuery(db: Database, whereClause: string) {
  return db.query(`
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
      continue_on_failure as continueOnFailure,
      attempt_no as attemptNo,
      active_run_id as activeRunId,
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

function taskStatusAfterRequeue(status: string | undefined | null): "pending" | "needs_revision" {
  if (status === "needs_revision") return "needs_revision";
  return "pending";
}

function buildWorkflowStepRunId(taskId: string, stepId: string, attemptNo: number): string {
  return `RUN-${taskId}-${stepId}-${attemptNo}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
