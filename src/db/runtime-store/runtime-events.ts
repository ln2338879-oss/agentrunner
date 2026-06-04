import type { Database } from "bun:sqlite";
import type { AgentRole } from "../../runtime/types";

export interface RecordRuntimeEventInput {
  kind: string;
  taskId?: string;
  stepId?: string;
  owner?: string;
  message: string;
  metadata?: unknown;
}

export function recordRuntimeEvent(db: Database, input: RecordRuntimeEventInput): void {
  db.query(
    `
    INSERT INTO runtime_events (id, kind, task_id, step_id, owner, message, metadata_json, created_at)
    VALUES ($id, $kind, $taskId, $stepId, $owner, $message, $metadataJson, $createdAt)
  `,
  ).run({
    $id: `EVT-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    $kind: input.kind,
    $taskId: input.taskId ?? null,
    $stepId: input.stepId ?? null,
    $owner: input.owner ?? null,
    $message: input.message,
    $metadataJson: input.metadata ? JSON.stringify(input.metadata) : null,
    $createdAt: new Date().toISOString(),
  });
}

export function upsertWorkerHeartbeat(
  db: Database,
  input: {
    owner: string;
    role: AgentRole | "scheduler";
    pid?: number;
    status: string;
    metadata?: unknown;
  },
): void {
  db.query(
    `
    INSERT INTO worker_heartbeats (owner, role, pid, status, last_seen_at, metadata_json)
    VALUES ($owner, $role, $pid, $status, $lastSeenAt, $metadataJson)
    ON CONFLICT(owner) DO UPDATE SET
      role = excluded.role,
      pid = excluded.pid,
      status = excluded.status,
      last_seen_at = excluded.last_seen_at,
      metadata_json = excluded.metadata_json
  `,
  ).run({
    $owner: input.owner,
    $role: input.role,
    $pid: input.pid ?? null,
    $status: input.status,
    $lastSeenAt: new Date().toISOString(),
    $metadataJson: input.metadata ? JSON.stringify(input.metadata) : null,
  });
}
