import type { RuntimeConfig } from "../config";
import type { RuntimeStore, StartupRecoveryMode, StartupRecoveryRow } from "../db/runtime-store";
import type { VaultManager } from "../obsidian/vault-manager";

export interface StartupRecoveryResult {
  recovered: StartupRecoveryRow[];
  mode: StartupRecoveryMode;
  reportPath?: string;
}

export async function runStartupRecovery(input: {
  store: RuntimeStore;
  vault: VaultManager;
  config: RuntimeConfig;
  owner: string;
}): Promise<StartupRecoveryResult> {
  const mode = normalizeStartupRecoveryMode(input.config.STARTUP_RECOVERY_MODE);

  if (!input.config.RECOVER_STALE_TASKS_ON_START) {
    input.store.recordRuntimeEvent({
      kind: "startup_recovery_skipped",
      owner: input.owner,
      message: "Startup recovery skipped by configuration.",
      metadata: { owner: input.owner },
    });
    return { recovered: [], mode };
  }

  const recovered = input.store.recoverInterruptedWorkflowSteps({
    staleMinutes: input.config.STALE_TASK_MINUTES,
    mode,
  });

  if (recovered.length === 0) {
    input.store.recordRuntimeEvent({
      kind: "startup_recovery_noop",
      owner: input.owner,
      message: "Startup recovery found no interrupted workflow steps.",
      metadata: {
        owner: input.owner,
        mode,
        staleTaskMinutes: input.config.STALE_TASK_MINUTES,
      },
    });
    return { recovered, mode };
  }

  const reportPath = `08_Recovery/startup-recovery-${Date.now()}.md`;
  await input.vault.writeNote(reportPath, renderStartupRecoveryReport({
    recovered,
    mode,
    owner: input.owner,
    staleTaskMinutes: input.config.STALE_TASK_MINUTES,
  }));

  input.store.recordRuntimeEvent({
    kind: "startup_recovery_report",
    owner: input.owner,
    message: `Startup recovery handled ${recovered.length} interrupted workflow step(s).`,
    metadata: {
      owner: input.owner,
      mode,
      staleTaskMinutes: input.config.STALE_TASK_MINUTES,
      reportPath,
      recoveredCount: recovered.length,
    },
  });

  return { recovered, mode, reportPath };
}

export function startWorkerHeartbeat(input: {
  store: RuntimeStore;
  owner: string;
  role: "director" | "builder" | "factory" | "designer" | "scheduler";
  config: RuntimeConfig;
  metadata?: unknown;
}): () => void {
  const writeHeartbeat = () => {
    input.store.upsertWorkerHeartbeat({
      owner: input.owner,
      role: input.role,
      pid: process.pid,
      status: "running",
      metadata: input.metadata,
    });
  };

  writeHeartbeat();
  const interval = setInterval(writeHeartbeat, input.config.WORKER_HEARTBEAT_INTERVAL_MS);
  return () => {
    clearInterval(interval);
    input.store.upsertWorkerHeartbeat({
      owner: input.owner,
      role: input.role,
      pid: process.pid,
      status: "stopped",
      metadata: input.metadata,
    });
  };
}

function normalizeStartupRecoveryMode(value: string): StartupRecoveryMode {
  return value === "block" ? "block" : "requeue";
}

function renderStartupRecoveryReport(input: {
  recovered: StartupRecoveryRow[];
  mode: StartupRecoveryMode;
  owner: string;
  staleTaskMinutes: number;
}): string {
  return [
    "---",
    `created_at: ${new Date().toISOString()}`,
    `owner: ${input.owner}`,
    `mode: ${input.mode}`,
    `stale_task_minutes: ${input.staleTaskMinutes}`,
    `recovered_count: ${input.recovered.length}`,
    "---",
    "",
    "# Startup Recovery Report",
    "",
    input.mode === "requeue"
      ? "Interrupted running workflow steps were returned to pending so the scheduler or worker can retry them."
      : "Interrupted running workflow steps were failed and their parent tasks were blocked.",
    "",
    "| Task | Task Status | Step | Step Status | Role | Locked By | Lock Expires |",
    "|---|---|---|---|---|---|---|",
    ...input.recovered.map((row) => [
      row.taskId,
      row.taskStatus,
      row.stepId ?? "",
      row.stepStatus ?? "",
      row.role ?? "",
      row.lockedBy ?? "",
      row.lockExpiresAt ?? "",
    ].map(escapeTableCell).join(" | ")).map((row) => `| ${row} |`),
    "",
  ].join("\n");
}

function escapeTableCell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}
