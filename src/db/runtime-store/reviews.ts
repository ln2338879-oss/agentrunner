import type { Database } from "bun:sqlite";
import type {
  ArtifactRow,
  ReviewRow,
  TaskRunRow,
  VerificationEvidenceKind,
  VerificationEvidenceRow,
  VerificationEvidenceStatus,
} from "../runtime-store-types";
import type { AgentRole, ReviewVerdict } from "../../runtime/types";

export function listTaskArtifacts(db: Database, taskId: string): ArtifactRow[] {
  return db
    .query(
      `
    SELECT type, path, created_by as createdBy, created_at as createdAt
    FROM artifacts
    WHERE task_id = $taskId
    ORDER BY created_at ASC
  `,
    )
    .all({ $taskId: taskId }) as ArtifactRow[];
}

export function listVerificationEvidence(db: Database, taskId: string): VerificationEvidenceRow[] {
  return db
    .query(
      `
    SELECT
      id,
      task_id as taskId,
      step_id as stepId,
      kind,
      command,
      status,
      artifact_path as artifactPath,
      summary,
      created_by as createdBy,
      metadata_json as metadataJson,
      created_at as createdAt
    FROM verification_evidence
    WHERE task_id = $taskId
    ORDER BY created_at ASC
  `,
    )
    .all({ $taskId: taskId }) as VerificationEvidenceRow[];
}

export function listTaskReviews(db: Database, taskId: string): ReviewRow[] {
  return db
    .query(
      `
    SELECT verdict, round, feedback, created_at as createdAt
    FROM reviews
    WHERE task_id = $taskId
    ORDER BY round ASC, created_at ASC
  `,
    )
    .all({ $taskId: taskId }) as ReviewRow[];
}

export function listTaskRuns(db: Database, taskId: string): TaskRunRow[] {
  return db
    .query(
      `
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
  `,
    )
    .all({ $taskId: taskId }) as TaskRunRow[];
}

export function recordTaskRun(
  db: Database,
  input: {
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
  },
): void {
  db.query(
    `
    INSERT INTO task_runs (id, task_id, role, model, prompt, output, status, error, started_at, finished_at)
    VALUES ($id, $taskId, $role, $model, $prompt, $output, $status, $error, $startedAt, $finishedAt)
  `,
  ).run({
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

export function recordArtifact(
  db: Database,
  input: {
    id: string;
    taskId: string;
    type: string;
    path: string;
    createdBy: AgentRole;
  },
): void {
  db.query(
    `
    INSERT INTO artifacts (id, task_id, type, path, created_by, created_at)
    VALUES ($id, $taskId, $type, $path, $createdBy, $createdAt)
  `,
  ).run({
    $id: input.id,
    $taskId: input.taskId,
    $type: input.type,
    $path: input.path,
    $createdBy: input.createdBy,
    $createdAt: new Date().toISOString(),
  });
}

export function recordVerificationEvidence(
  db: Database,
  input: {
    id: string;
    taskId: string;
    stepId?: string;
    kind: VerificationEvidenceKind;
    command?: string;
    status: VerificationEvidenceStatus;
    artifactPath?: string;
    summary: string;
    createdBy: string;
    metadata?: Record<string, unknown>;
    createdAt?: string;
  },
): void {
  db.query(
    `
    INSERT INTO verification_evidence (
      id,
      task_id,
      step_id,
      kind,
      command,
      status,
      artifact_path,
      summary,
      created_by,
      metadata_json,
      created_at
    ) VALUES (
      $id,
      $taskId,
      $stepId,
      $kind,
      $command,
      $status,
      $artifactPath,
      $summary,
      $createdBy,
      $metadataJson,
      $createdAt
    )
  `,
  ).run({
    $id: input.id,
    $taskId: input.taskId,
    $stepId: input.stepId ?? null,
    $kind: input.kind,
    $command: input.command ?? null,
    $status: input.status,
    $artifactPath: input.artifactPath ?? null,
    $summary: input.summary,
    $createdBy: input.createdBy,
    $metadataJson: input.metadata ? JSON.stringify(input.metadata) : null,
    $createdAt: input.createdAt ?? new Date().toISOString(),
  });
}

export function recordReview(
  db: Database,
  input: {
    id: string;
    taskId: string;
    verdict: ReviewVerdict;
    round: number;
    feedback: string;
  },
): void {
  db.query(
    `
    INSERT INTO reviews (id, task_id, verdict, round, feedback, created_at)
    VALUES ($id, $taskId, $verdict, $round, $feedback, $createdAt)
  `,
  ).run({
    $id: input.id,
    $taskId: input.taskId,
    $verdict: input.verdict,
    $round: input.round,
    $feedback: input.feedback,
    $createdAt: new Date().toISOString(),
  });
}
